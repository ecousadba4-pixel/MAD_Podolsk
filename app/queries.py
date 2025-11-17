from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from psycopg2.extras import RealDictCursor

from .db import get_connection
from .models import DashboardItem, DashboardSummary, DailyRevenue


ITEMS_SQL = """
    SELECT
        pvf.*, 
        rates.smeta_code AS category_code
    FROM skpdi_plan_vs_fact_monthly AS pvf
    LEFT JOIN skpdi_rates AS rates
        ON TRIM(LOWER(rates.work_name)) = TRIM(LOWER(pvf.description))
    WHERE pvf.month_start = %s
    ORDER BY ABS(COALESCE(pvf.delta_amount_done, 0)) DESC, pvf.description;
"""

AVAILABLE_MONTHS_SQL = """
    SELECT DISTINCT month_start
    FROM skpdi_plan_vs_fact_monthly
    WHERE planned_amount IS NOT NULL OR fact_amount_done IS NOT NULL
    ORDER BY month_start DESC
    LIMIT %s;
"""

LAST_UPDATED_SQL = """
    SELECT COALESCE(MAX(loaded_at), 'epoch'::timestamptz) AS last_updated
    FROM (
        SELECT loaded_at FROM skpdi_fact_agg
        UNION ALL
        SELECT loaded_at FROM skpdi_plan_agg
    ) AS loads;
"""

SUMMARY_SQL = """
    WITH agg AS (
        SELECT
            SUM(planned_amount) AS planned_total,
            SUM(fact_amount_done) AS fact_total
        FROM skpdi_plan_vs_fact_monthly
        WHERE month_start = %s
    )
    SELECT
        planned_total,
        fact_total,
        CASE WHEN planned_total <> 0 THEN fact_total / planned_total END AS completion_pct,
        fact_total - planned_total AS delta_amount
    FROM agg;
"""

DAILY_FACT_SQL = """
    SELECT
        date_done::date AS work_date,
        SUM(total_amount) AS fact_total
    FROM skpdi_fact_with_money
    WHERE month_start = %s
    GROUP BY work_date
    HAVING SUM(total_amount) IS NOT NULL
    ORDER BY work_date;
"""


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float, Decimal)):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _extract_strings(row: dict[str, Any]) -> tuple[str | None, str | None, str | None, str]:
    description = row.get("description") or ""
    category = row.get("category_code") or row.get("smeta")
    smeta = (
        row.get("smeta")
        or row.get("smeta_name")
        or row.get("smeta_title")
        or row.get("section")
    )
    work_name = row.get("work_name") or row.get("work_title") or description
    return category, smeta, work_name, description


def _aggregate_items_streaming(cursor) -> list[DashboardItem]:
    """
    Агрегирует строки запроса используя курсор напрямую (потоковая обработка).
    Минимизирует использование памяти для больших результатов.
    Cursor должен быть RealDictCursor и находиться в контексте транзакции.
    """
    items_map: dict[tuple[str | None, str | None, str | None, str], dict[str, Any]] = {}
    
    for row in cursor:
        category, smeta, work_name, description = _extract_strings(row)
        key = (category, smeta, work_name, description)

        item = items_map.get(key)
        if item is None:
            item = {
                "category": category,
                "smeta": smeta,
                "work_name": work_name,
                "description": description,
                "planned_amount": None,
                "fact_amount": None,
            }
            items_map[key] = item

        planned_value = _to_float(row.get("planned_amount"))
        if planned_value is not None:
            item["planned_amount"] = (item["planned_amount"] or 0.0) + planned_value

        fact_value = _to_float(row.get("fact_amount_done"))
        if fact_value is not None:
            item["fact_amount"] = (item["fact_amount"] or 0.0) + fact_value

    aggregated_items = []
    for item in items_map.values():
        aggregated_items.append(
            DashboardItem(
                category=item["category"],
                smeta=item["smeta"],
                work_name=item["work_name"],
                description=item["description"],
                planned_amount=item["planned_amount"],
                fact_amount=item["fact_amount"],
                # delta_amount будет вычислено через field_validator в DashboardItem
            )
        )

    return aggregated_items


def _fetch_daily_fact_totals(conn, month_start: date) -> list[DailyRevenue]:
    daily_rows: list[DailyRevenue] = []
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        try:
            cur.execute(DAILY_FACT_SQL, (month_start,))
            for row in cur.fetchall() or []:
                amount = _to_float(row.get("fact_total"))
                work_date = row.get("work_date")
                if amount is None or work_date is None:
                    continue
                daily_rows.append(DailyRevenue(date=work_date, amount=amount))
        except Exception:
            # Если таблицы или поля отсутствуют, просто возвращаем пустой список,
            # чтобы не ломать основной сценарий.
            conn.rollback()
            return []

    return daily_rows


def _calculate_daily_average(daily_rows: list[DailyRevenue]) -> float | None:
    if not daily_rows:
        return None
    today = date.today()
    amounts_without_today = [
        row.amount for row in daily_rows if row.amount is not None and row.date != today
    ]
    if not amounts_without_today:
        return None
    return sum(amounts_without_today) / len(amounts_without_today)


def fetch_plan_vs_fact_for_month(
    month_start: date,
) -> tuple[list[DashboardItem], DashboardSummary | None, datetime | None]:
    """
    Читает данные из view skpdi_plan_vs_fact_monthly для конкретного месяца
    и собирает summary. Использует потоковую обработку для оптимизации памяти.
    Возвращает: (items, summary, last_updated)
    """

    items: list[DashboardItem]
    summary: DashboardSummary | None = None
    last_updated: datetime | None = None

    with get_connection() as conn:
        # Потоковая обработка основных данных - не загружаем всё в память
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(ITEMS_SQL, (month_start,))
            items = _aggregate_items_streaming(cur)

        daily_revenue = _fetch_daily_fact_totals(conn, month_start)
        average_daily_revenue = _calculate_daily_average(daily_revenue)

        with conn.cursor() as cur:
            cur.execute(LAST_UPDATED_SQL)
            res = cur.fetchone()
            if res:
                last_updated = res[0]

        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(SUMMARY_SQL, (month_start,))
            summary_row = cur.fetchone() or {}
            has_financial_data = (
                summary_row.get("planned_total") is not None
                or summary_row.get("fact_total") is not None
                or bool(daily_revenue)
            )
            if has_financial_data:
                summary = DashboardSummary(
                    planned_amount=_to_float(summary_row.get("planned_total")) or 0.0,
                    fact_amount=_to_float(summary_row.get("fact_total")) or 0.0,
                    completion_pct=_to_float(summary_row.get("completion_pct")),
                    delta_amount=_to_float(summary_row.get("delta_amount")) or 0.0,
                    average_daily_revenue=average_daily_revenue,
                    daily_revenue=daily_revenue,
                )

    return items, summary, last_updated


def fetch_available_months(limit: int = 12) -> list[date]:
    """Возвращает список месяцев, за которые есть данные."""

    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(AVAILABLE_MONTHS_SQL, (limit,))
        rows = cur.fetchall() or []
    return [row[0] for row in rows if row and row[0] is not None]
