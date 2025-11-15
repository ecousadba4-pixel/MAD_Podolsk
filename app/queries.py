from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from psycopg2.extras import RealDictCursor

from .db import get_connection
from .models import DashboardItem, DashboardSummary


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


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float, Decimal)):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _calc_delta(plan: float | None, fact: float | None) -> float | None:
    if plan is None and fact is None:
        return None
    plan_value = plan or 0.0
    fact_value = fact or 0.0
    return fact_value - plan_value


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


def _aggregate_items(rows: list[dict[str, Any]]) -> list[DashboardItem]:
    """Агрегирует строки в DashboardItem. Принимает список для обратной совместимости."""
    items_map: dict[tuple[str | None, str | None, str | None, str], dict[str, Any]] = {}

    for row in rows:
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
                delta_amount=_calc_delta(item["planned_amount"], item["fact_amount"]),
            )
        )

    return aggregated_items


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
                delta_amount=_calc_delta(item["planned_amount"], item["fact_amount"]),
            )
        )

    return aggregated_items


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

        with conn.cursor() as cur:
            cur.execute(LAST_UPDATED_SQL)
            res = cur.fetchone()
            if res:
                last_updated = res[0]

        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(SUMMARY_SQL, (month_start,))
            summary_row = cur.fetchone()
            if summary_row and summary_row["planned_total"] is not None:
                summary = DashboardSummary(
                    planned_amount=_to_float(summary_row["planned_total"]) or 0.0,
                    fact_amount=_to_float(summary_row["fact_total"]) or 0.0,
                    completion_pct=_to_float(summary_row["completion_pct"]),
                    delta_amount=_to_float(summary_row["delta_amount"]) or 0.0,
                )

    return items, summary, last_updated
