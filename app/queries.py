from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from psycopg2.extras import RealDictCursor

from .db import get_connection
from .models import DashboardItem, DashboardSummary


ITEMS_SQL = """
    SELECT
        month_start,
        description,
        unit,
        planned_volume,
        planned_amount,
        fact_volume_done,
        fact_amount_done,
        delta_volume_done,
        delta_amount_done,
        delta_volume_done_pct,
        delta_amount_done_pct
    FROM skpdi_plan_vs_fact_monthly
    WHERE month_start = %s
    ORDER BY ABS(COALESCE(delta_amount_done, 0)) DESC, description;
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
    if value is None:
        return None
    if isinstance(value, (int, float, Decimal)):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


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

    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(ITEMS_SQL, (month_start,))
            rows = cur.fetchall()

        items = [
            DashboardItem(
                description=row["description"],
                unit=row["unit"],
                planned_volume=_to_float(row["planned_volume"]),
                planned_amount=_to_float(row["planned_amount"]),
                fact_volume=_to_float(row["fact_volume_done"]),
                fact_amount=_to_float(row["fact_amount_done"]),
                delta_amount=_to_float(row["delta_amount_done"]),
                delta_pct=_to_float(row["delta_amount_done_pct"]),
            )
            for row in rows
        ]

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
                    delta_pct=_to_float(summary_row["delta_pct"]),
                )

    return items, summary, last_updated
