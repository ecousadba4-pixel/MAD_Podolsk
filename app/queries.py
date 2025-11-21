from __future__ import annotations

import logging
import calendar
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Callable, TypeVar

from psycopg2 import InterfaceError, OperationalError
from psycopg2.extras import RealDictCursor

from .db import get_connection
from .retry import db_retry
from .models import (
    DashboardItem,
    DashboardSummary,
    DailyReportItem,
    DailyReportResponse,
    DailyRevenue,
    DailyWorkVolume,
)
from .query_builder import FactQueryBuilder
from .utils import (
    to_float,
    normalize_string,
    safe_get_from_dict,
    get_month_start,
    get_next_month_start,
    extract_dict_strings,
)

logger = logging.getLogger(__name__)


_PLAN_BASE_CATEGORIES = {"лето", "зима"}
_VNR_CATEGORY_CODES = {"внерегл_ч_1", "внерегл_ч_2"}
_VNR_PLAN_SHARE = Decimal("0.43")

_DB_RETRYABLE_ERRORS = (OperationalError, InterfaceError)
_DB_RETRY_DELAY_SEC = 0.7
_DB_RETRY_BACKOFF = 1.0  # Можно увеличить (>1.0) для экспоненциальной задержки

T = TypeVar("T")


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

CONTRACT_TOTAL_SQL = """
    SELECT COALESCE(SUM(contract_amount), 0) AS contract_total
    FROM podolsk_mad_2025_contract_amount;
"""

CONTRACT_EXECUTED_SQL = """
    SELECT COALESCE(SUM(category_amount), 0) AS executed_total
    FROM skpdi_fact_monthly_cat_mv;
"""

SUMMARY_SQL = """
    WITH agg AS (
        SELECT
            SUM(CASE
                    WHEN COALESCE(TRIM(LOWER(smeta_code)), '') IN ('внерегл_ч_1', 'внерегл_ч_2')
                        THEN 0
                    ELSE planned_amount
                END) AS planned_total,
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


"""Функции получения данных из БД.

Все публичные функции ниже помечены декоратором `@db_retry` для повторных 
попыток при временных ошибках соединения/курсов (OperationalError, InterfaceError).
"""


DAILY_FACT_SQL = """-- legacy reference (используется билдер FactQueryBuilder)
SELECT
    date_done::date AS work_date,
    SUM(total_amount) AS fact_total
FROM skpdi_fact_with_money
WHERE month_start = %s AND status = 'Рассмотрено'
GROUP BY work_date
HAVING SUM(total_amount) IS NOT NULL
ORDER BY work_date;"""

DAILY_REPORT_SQL = """-- legacy reference (используется билдер FactQueryBuilder)
SELECT
    COALESCE(smeta_code, '') AS smeta_code,
    COALESCE(smeta_section, '') AS smeta_section,
    COALESCE(description, '') AS description,
    unit,
    SUM(total_volume) AS total_volume,
    SUM(total_amount) AS total_amount
FROM skpdi_fact_with_money
WHERE date_done::date = %s AND status = 'Рассмотрено'
GROUP BY smeta_code, smeta_section, description, unit
ORDER BY total_amount DESC NULLS LAST, description;"""

AVAILABLE_DAYS_SQL = """-- legacy reference (используется билдер FactQueryBuilder)
SELECT DISTINCT date_done::date AS work_date
FROM skpdi_fact_with_money
WHERE date_trunc('month', date_done) = date_trunc('month', CURRENT_DATE)
    AND status = 'Рассмотрено'
ORDER BY work_date DESC;"""


# Функции _to_float, _safe_get_from_row и _extract_strings перенесены в utils.py
# Используются: to_float, safe_get_from_dict, extract_dict_strings


def _calculate_vnr_plan(items: list["DashboardItem"]) -> float:
    """Вычисляет план для внерегламента как 43% от планов по сметам лето и зима."""

    base_total = Decimal(0)
    for item in items:
        if item.planned_amount is None:
            continue
        category = (item.category or "").strip().lower()
        if category in _PLAN_BASE_CATEGORIES:
            base_total += Decimal(str(item.planned_amount))

    if base_total <= 0:
        return 0.0

    return float(base_total * _VNR_PLAN_SHARE)


def _is_vnr_row(row: dict[str, Any]) -> bool:
    smeta_code = normalize_string(
        safe_get_from_dict(row, "smeta_code", "category_code", default="")
    ).lower()
    return smeta_code in _VNR_CATEGORY_CODES


def _build_vnr_plan_item(plan_value: float, items: list["DashboardItem"]) -> "DashboardItem | None":
    if plan_value <= 0:
        return None

    category = None
    smeta = None
    description = "внерегламент"

    for item in items:
        category_code = (item.category or "").strip().lower()
        if category_code in _VNR_CATEGORY_CODES:
            category = category or item.category or item.smeta
            smeta = smeta or item.smeta or item.category
            description = item.smeta or item.description or description
            if category and smeta:
                break

    fallback = smeta or category or description
    return DashboardItem(
        category=category or fallback,
        smeta=fallback,
        work_name=None,
        description=description or fallback,
        planned_amount=plan_value,
        fact_amount=None,
        category_plan_only=True,
    )


def _update_summary_with_vnr_plan(
    summary: "DashboardSummary | None",
    plan_adjustment: float,
    items: list["DashboardItem"],
    average_daily_revenue: float | None,
    daily_revenue: list[DailyRevenue] | None,
) -> "DashboardSummary | None":
    if plan_adjustment <= 0:
        return summary

    if summary:
        planned_total = (summary.planned_amount or 0.0) + plan_adjustment
        fact_total = summary.fact_amount or 0.0
        summary.planned_amount = planned_total
        summary.fact_amount = fact_total
        summary.delta_amount = fact_total - planned_total
        summary.completion_pct = fact_total / planned_total if planned_total else None
        return summary

    fact_total = 0.0
    for item in items:
        if item.fact_amount is not None:
            fact_total += item.fact_amount

    planned_total = plan_adjustment
    return DashboardSummary(
        planned_amount=planned_total,
        fact_amount=fact_total,
        completion_pct=fact_total / planned_total if planned_total else None,
        delta_amount=fact_total - planned_total,
        average_daily_revenue=average_daily_revenue,
        daily_revenue=daily_revenue,
    )


def _aggregate_items_streaming(cursor) -> list[DashboardItem]:
    """
    Агрегирует строки запроса используя курсор напрямую (потоковая обработка).
    Минимизирует использование памяти для больших результатов.
    Cursor должен быть RealDictCursor и находиться в контексте транзакции.
    """
    items_map: dict[tuple[str | None, str | None, str | None, str], dict[str, Any]] = {}
    
    for row in cursor:
        category, smeta, work_name, description = extract_dict_strings(row)
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

        planned_value = None if _is_vnr_row(row) else to_float(row.get("planned_amount"))
        if planned_value is not None:
            item["planned_amount"] = (item["planned_amount"] or 0.0) + planned_value

        fact_value = to_float(row.get("fact_amount_done"))
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
    """Извлекает дневные суммы фактических работ используя билдер."""
    daily_rows: list[DailyRevenue] = []
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        try:
            sql, params = (
                FactQueryBuilder()
                .select(
                    "date_done::date AS work_date",
                    "SUM(total_amount) AS fact_total",
                )
                .month_start(month_start)
                .status()
                .group_by("work_date")
                .having("SUM(total_amount) IS NOT NULL")
                .order_by("work_date")
                .build()
            )
            cur.execute(sql, params)
            rows = cur.fetchall() or []
            for row in rows:
                amount = to_float(row.get("fact_total"))
                work_date = row.get("work_date")
                if amount is None or work_date is None:
                    continue
                daily_rows.append(DailyRevenue(date=work_date, amount=amount))
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Не удалось загрузить дневные суммы за %s: %s. Используется пустой список.",
                month_start,
                exc,
                exc_info=True,
            )
            conn.rollback()
            return []

    return daily_rows


WORK_BREAKDOWN_SQL = """-- legacy reference (используется билдер FactQueryBuilder)
SELECT
    date_done::date AS work_date,
    SUM(COALESCE(total_volume, 0)) AS total_volume,
    MAX(COALESCE(unit::text, '')) AS unit,
    SUM(COALESCE(total_amount, 0)) AS total_amount
FROM skpdi_fact_with_money
WHERE date_done::date >= %s
  AND date_done::date < %s
  AND status = 'Рассмотрено'
  AND COALESCE(description::text, '') ILIKE %s
GROUP BY work_date
ORDER BY work_date;"""


@db_retry(
    retries=1,
    delay_sec=_DB_RETRY_DELAY_SEC,
    backoff=_DB_RETRY_BACKOFF,
    exceptions=_DB_RETRYABLE_ERRORS,
    label="fetch_work_daily_breakdown",
)
def fetch_work_daily_breakdown(month_start: date, work_identifier: str) -> list[DailyWorkVolume]:
    """Возвращает список по-дневных объёмов (total_volume) для указанной строки работ за месяц.

    В результате возвращается список объектов с полями `date`, `amount` и `unit`.
    Поиск выполняется по полю `description` с приведением к нижнему регистру (ILIKE).
    """

    results: list[DailyWorkVolume] = []
    if not work_identifier:
        return results

    # На фронтенд может прийти любая дата внутри месяца, поэтому нормализуем
    # значение к первому дню месяца, чтобы захватывать весь период.
    month_start = get_month_start(month_start)

    rows: list[DailyWorkVolume] = []
    next_month_start = get_next_month_start(month_start)
    with get_connection() as conn:
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                work_param = f"%{work_identifier.strip()}%"
                sql, params = (
                    FactQueryBuilder()
                    .select(
                        "date_done::date AS work_date",
                        "SUM(COALESCE(total_volume, 0)) AS total_volume",
                        "MAX(COALESCE(unit::text, '')) AS unit",
                        "SUM(COALESCE(total_amount, 0)) AS total_amount",
                    )
                    .date_range(month_start, next_month_start)
                    .status()
                    .ilike_description(work_param)
                    .group_by("work_date")
                    .order_by("work_date")
                    .build()
                )
                cur.execute(sql, params)
                fetched = cur.fetchall() or []
                for row in fetched:
                    work_date = row.get("work_date")
                    vol = to_float(row.get("total_volume"))
                    unit = normalize_string(row.get("unit"))
                    total_amount = to_float(row.get("total_amount"))
                    if work_date is None or vol is None:
                        continue
                    rows.append(
                        DailyWorkVolume(
                            date=work_date,
                            amount=vol,
                            unit=unit,
                            total_amount=total_amount,
                        )
                    )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Не удалось загрузить подневную расшифровку для '%s' за %s: %s",
                work_identifier,
                month_start,
                exc,
                exc_info=True,
            )
            conn.rollback()
            return []
    return rows


def _fetch_contract_progress(conn, _selected_month: date) -> dict[str, float] | None:
    """Возвращает агрегаты по контракту и выполнению, логирует и возвращает None при ошибке."""

    # Для карточки «Выполнение контракта» факты текущего месяца должны
    # рассчитываться относительно реального текущего календарного месяца,
    # а не выбранного пользователем периода. Поэтому месяц получения данных
    # вычисляем от сегодняшней даты.
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(CONTRACT_TOTAL_SQL)
            contract_row = cur.fetchone() or {}
            contract_total = to_float(contract_row.get("contract_total")) or 0.0

        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(CONTRACT_EXECUTED_SQL)
            executed_row = cur.fetchone() or {}
            executed_total = to_float(executed_row.get("executed_total")) or 0.0

        return {
            "contract_total": contract_total,
            "executed_total": executed_total,
        }
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "Не удалось загрузить агрегаты по контракту за %s: %s",
            date.today().replace(day=1),
            exc,
            exc_info=True,
        )
        conn.rollback()
        return None


def _calculate_daily_average(
    month_start: date,
    daily_rows: list[DailyRevenue],
    fact_total: float | None,
) -> float | None:
    """Вычисляет среднедневную выручку для выбранного месяца."""
    today = date.today()
    current_month_start = today.replace(day=1)

    # Для прошлых месяцев: берём явный fact_total если он есть,
    # иначе суммируем доступные дневные записи. Если данных нет — возвращаем None.
    if month_start != current_month_start:
        if fact_total is not None:
            total = fact_total
        else:
            total = sum((row.amount for row in daily_rows if row.amount is not None), 0.0)

        if total == 0.0:
            return None

        days_in_month = calendar.monthrange(month_start.year, month_start.month)[1]
        return total / days_in_month

    # Для текущего месяца: усредняем по доступным дням, исключая данные за сегодня.
    if not daily_rows:
        return None

    past_days_amounts = [row.amount for row in daily_rows if row.amount is not None and row.date != today]
    if not past_days_amounts:
        return None

    return sum(past_days_amounts) / len(past_days_amounts)


@db_retry(
    retries=1,
    delay_sec=_DB_RETRY_DELAY_SEC,
    backoff=_DB_RETRY_BACKOFF,
    exceptions=_DB_RETRYABLE_ERRORS,
    label="fetch_plan_vs_fact_for_month",
)
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
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(ITEMS_SQL, (month_start,))
            items = _aggregate_items_streaming(cur)

        vnr_plan_amount = _calculate_vnr_plan(items)
        vnr_plan_item = _build_vnr_plan_item(vnr_plan_amount, items)
        if vnr_plan_item:
            items.append(vnr_plan_item)

        month_fact_total = sum(item.fact_amount or 0.0 for item in items if item.fact_amount is not None)

        daily_revenue = _fetch_daily_fact_totals(conn, month_start)
        average_daily_revenue = _calculate_daily_average(
            month_start,
            daily_revenue,
            month_fact_total,
        )

        contract_progress = _fetch_contract_progress(conn, month_start)

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
                    planned_amount=to_float(summary_row.get("planned_total")) or 0.0,
                    fact_amount=to_float(summary_row.get("fact_total")) or 0.0,
                    completion_pct=to_float(summary_row.get("completion_pct")),
                    delta_amount=to_float(summary_row.get("delta_amount")) or 0.0,
                    average_daily_revenue=average_daily_revenue,
                    daily_revenue=daily_revenue,
                )

        if summary is None and contract_progress is not None:
            summary = DashboardSummary(
                planned_amount=0.0,
                fact_amount=0.0,
                completion_pct=None,
                delta_amount=0.0,
                contract_amount=contract_progress.get("contract_total"),
                contract_executed=contract_progress.get("executed_total"),
                contract_completion_pct=None,
                average_daily_revenue=average_daily_revenue,
                daily_revenue=daily_revenue,
            )

        if summary and contract_progress is not None:
            summary.contract_amount = contract_progress.get("contract_total")
            summary.contract_executed = contract_progress.get("executed_total")
            if summary.contract_amount:
                summary.contract_completion_pct = summary.contract_executed / summary.contract_amount

        summary = _update_summary_with_vnr_plan(
            summary=summary,
            plan_adjustment=vnr_plan_amount,
            items=items,
            average_daily_revenue=average_daily_revenue,
            daily_revenue=daily_revenue,
        )

    return items, summary, last_updated


@db_retry(
    retries=1,
    delay_sec=_DB_RETRY_DELAY_SEC,
    backoff=_DB_RETRY_BACKOFF,
    exceptions=_DB_RETRYABLE_ERRORS,
    label="fetch_available_months",
)
def fetch_available_months(limit: int = 12) -> list[date]:
    """Возвращает список месяцев, за которые есть данные."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(AVAILABLE_MONTHS_SQL, (limit,))
        rows = cur.fetchall() or []
    return [row[0] for row in rows if row and row[0] is not None]


@db_retry(
    retries=1,
    delay_sec=_DB_RETRY_DELAY_SEC,
    backoff=_DB_RETRY_BACKOFF,
    exceptions=_DB_RETRYABLE_ERRORS,
    label="fetch_available_days",
)
def fetch_available_days() -> list[date]:
    """Возвращает список дат текущего месяца (через билдер), по которым есть фактические данные."""
    with get_connection() as conn, conn.cursor() as cur:
        sql, params = (
            FactQueryBuilder()
            .distinct()
            .select("date_done::date AS work_date")
            .current_month()
            .status()
            .order_by("work_date DESC")
            .build()
        )
        cur.execute(sql, params)
        rows = cur.fetchall() or []
    return [row[0] for row in rows if row and row[0] is not None]


@db_retry(
    retries=1,
    delay_sec=_DB_RETRY_DELAY_SEC,
    backoff=_DB_RETRY_BACKOFF,
    exceptions=_DB_RETRYABLE_ERRORS,
    label="fetch_daily_report",
)
def fetch_daily_report(target_date: date) -> DailyReportResponse:
    """Возвращает детализацию фактических работ за выбранный день, используя билдер."""
    target_date = target_date or date.today()

    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            sql, params = (
                FactQueryBuilder()
                .select(
                    "COALESCE(smeta_code, '') AS smeta_code",
                    "COALESCE(smeta_section, '') AS smeta_section",
                    "COALESCE(description, '') AS description",
                    "unit",
                    "SUM(total_volume) AS total_volume",
                    "SUM(total_amount) AS total_amount",
                )
                .date_equals(target_date)
                .status()
                .group_by("smeta_code", "smeta_section", "description", "unit")
                .order_by("total_amount DESC NULLS LAST", "description")
                .build()
            )
            cur.execute(sql, params)
            rows = cur.fetchall() or []

        last_updated = None
        with conn.cursor() as cur:
            cur.execute(LAST_UPDATED_SQL)
            res = cur.fetchone()
            if res:
                last_updated = res[0]

    items: list[DailyReportItem] = []
    for row in rows:
        items.append(
            DailyReportItem(
                smeta=normalize_string(row.get("smeta_code")) or None,
                work_type=normalize_string(row.get("smeta_section")) or None,
                description=normalize_string(row.get("description"), default="Без названия"),
                unit=normalize_string(row.get("unit")) or None,
                total_volume=to_float(row.get("total_volume")),
                total_amount=to_float(row.get("total_amount")),
            )
        )

    return DailyReportResponse(
        date=target_date,
        last_updated=last_updated,
        items=items,
        has_data=bool(items),
    )
