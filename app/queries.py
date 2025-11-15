from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, InvalidOperation
import math
from typing import Any

from psycopg2.extras import RealDictCursor

from .db import get_connection
from .models import DashboardItem, DashboardSummary


ITEMS_SQL = """
    SELECT
        COALESCE(
            NULLIF(TRIM(BOTH FROM rates.smeta_code), ''),
            NULLIF(TRIM(BOTH FROM pvf.smeta), ''),
            NULLIF(TRIM(BOTH FROM pvf.smeta_name), ''),
            NULLIF(TRIM(BOTH FROM pvf.smeta_title), ''),
            NULLIF(TRIM(BOTH FROM pvf.section), '')
        ) AS category,
        COALESCE(
            NULLIF(TRIM(BOTH FROM pvf.smeta), ''),
            NULLIF(TRIM(BOTH FROM pvf.smeta_name), ''),
            NULLIF(TRIM(BOTH FROM pvf.smeta_title), ''),
            NULLIF(TRIM(BOTH FROM pvf.section), '')
        ) AS smeta,
        COALESCE(
            NULLIF(TRIM(BOTH FROM pvf.work_name), ''),
            NULLIF(TRIM(BOTH FROM pvf.work_title), ''),
            NULLIF(TRIM(BOTH FROM pvf.description), '')
        ) AS work_name,
        COALESCE(NULLIF(TRIM(BOTH FROM pvf.description), ''), '') AS description,
        pvf.unit,
        pvf.planned_volume,
        pvf.planned_amount,
        pvf.fact_volume_done AS fact_volume,
        pvf.fact_amount_done AS fact_amount,
        pvf.delta_amount_done AS delta_amount,
        pvf.delta_amount_done_pct AS delta_pct
    FROM skpdi_plan_vs_fact_monthly AS pvf
    LEFT JOIN skpdi_rates AS rates
        ON TRIM(LOWER(rates.work_name)) = TRIM(LOWER(pvf.description))
    WHERE pvf.month_start = %s
    ORDER BY ABS(COALESCE(pvf.delta_amount_done, 0)) DESC, pvf.description;
"""

LAST_UPDATED_SQL = """
    SELECT
        GREATEST(
            COALESCE((SELECT MAX(loaded_at) FROM skpdi_fact_agg), 'epoch'::timestamptz),
            COALESCE((SELECT MAX(loaded_at) FROM skpdi_plan_agg), 'epoch'::timestamptz)
        ) AS last_updated;
"""

SUMMARY_SQL = """
    SELECT
        SUM(planned_amount) AS planned_total,
        SUM(fact_amount_done) AS fact_total,
        CASE WHEN SUM(planned_amount) <> 0
            THEN SUM(fact_amount_done) / SUM(planned_amount)
        END AS completion_pct,
        SUM(fact_amount_done) - SUM(planned_amount) AS delta_amount,
        CASE WHEN SUM(planned_amount) <> 0
            THEN (SUM(fact_amount_done) - SUM(planned_amount)) / SUM(planned_amount)
        END AS delta_pct
    FROM skpdi_plan_vs_fact_monthly
    WHERE month_start = %s;
"""


def _to_float(value: Any) -> float | None:
    """Преобразует значения из БД в float, убирая NaN/Inf."""

    if value is None:
        return None

    numeric: float
    if isinstance(value, (int, float, Decimal)):
        numeric = float(value)
    else:
        try:
            numeric = float(value)
        except (TypeError, ValueError, InvalidOperation):
            return None

    if not math.isfinite(numeric):
        return None

    return numeric


def fetch_plan_vs_fact_for_month(
    month_start: date,
) -> tuple[list[DashboardItem], DashboardSummary | None, datetime | None]:
    """
    Читает данные из view skpdi_plan_vs_fact_monthly для конкретного месяца
    и собирает summary.
    Возвращает: (items, summary, last_updated)
    """

    items: list[DashboardItem]
    summary: DashboardSummary | None = None
    last_updated: datetime | None = None

    month_value = month_start.isoformat()

    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(ITEMS_SQL, (month_value,))
            rows = cur.fetchall()

        items = []
        for row in rows:
            items.append(
                DashboardItem(
                    category=row.get("category") or row.get("smeta"),
                    smeta=row.get("smeta"),
                    work_name=row.get("work_name") or row.get("description"),
                    description=row.get("description") or "",
                    unit=row.get("unit"),
                    planned_volume=_to_float(row.get("planned_volume")),
                    planned_amount=_to_float(row.get("planned_amount")),
                    fact_volume=_to_float(row.get("fact_volume")),
                    fact_amount=_to_float(row.get("fact_amount")),
                    delta_amount=_to_float(row.get("delta_amount")),
                    delta_pct=_to_float(row.get("delta_pct")),
                )
            )

        with conn.cursor() as cur:
            cur.execute(LAST_UPDATED_SQL)
            res = cur.fetchone()
            if res:
                last_updated = res[0]

        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(SUMMARY_SQL, (month_value,))
            summary_row = cur.fetchone()
            if summary_row and summary_row["planned_total"] is not None:
                summary = DashboardSummary(
                    planned_amount=_to_float(summary_row["planned_total"]) or 0.0,
                    fact_amount=_to_float(summary_row["fact_total"]) or 0.0,
                    completion_pct=_to_float(summary_row["completion_pct"]),
                    delta_amount=_to_float(summary_row["delta_amount"]) or 0.0,
                    delta_pct=_to_float(summary_row["delta_pct"]),
                )

    return items, summary, last_updated
