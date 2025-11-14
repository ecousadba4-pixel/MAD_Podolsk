from datetime import date
from decimal import Decimal
from typing import List, Optional, Tuple

from .db import get_connection
from .models import DashboardItem, DashboardSummary


def _to_float(x) -> Optional[float]:
    if x is None:
        return None
    if isinstance(x, (int, float)):
        return float(x)
    if isinstance(x, Decimal):
        return float(x)
    try:
        return float(x)
    except Exception:
        return None


def fetch_plan_vs_fact_for_month(
    month_start: date,
) -> Tuple[List[DashboardItem], Optional[DashboardSummary], Optional[str]]:
    """
    Читает данные из view skpdi_plan_vs_fact_monthly для конкретного месяца
    и собирает summary.
    Возвращает: (items, summary, last_updated_iso)
    """
    items: List[DashboardItem] = []

    last_updated_iso: Optional[str] = None
    summary: Optional[DashboardSummary] = None

    with get_connection() as conn:
        with conn.cursor() as cur:
            # Основные строки
            cur.execute(
                """
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
                """,
                (month_start,),
            )
            rows = cur.fetchall()

            for row in rows:
                (
                    _month,
                    description,
                    unit,
                    planned_volume,
                    planned_amount,
                    fact_volume_done,
                    fact_amount_done,
                    _delta_vol,
                    delta_amount_done,
                    _delta_vol_pct,
                    delta_amount_done_pct,
                ) = row

                item = DashboardItem(
                    description=description,
                    unit=unit,
                    planned_volume=_to_float(planned_volume),
                    planned_amount=_to_float(planned_amount),
                    fact_volume=_to_float(fact_volume_done),
                    fact_amount=_to_float(fact_amount_done),
                    delta_amount=_to_float(delta_amount_done),
                    delta_pct=_to_float(delta_amount_done_pct),
                )
                items.append(item)

            # last_updated берём из факта/плана
            cur.execute(
                """
                SELECT
                    GREATEST(
                        COALESCE((SELECT MAX(loaded_at) FROM skpdi_fact_agg), 'epoch'::timestamptz),
                        COALESCE((SELECT MAX(loaded_at) FROM skpdi_plan_agg), 'epoch'::timestamptz)
                    ) AS last_updated;
                """
            )
            res = cur.fetchone()
            if res and res[0]:
                last_updated_iso = res[0].isoformat()

            cur.execute(
                """
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
                """,
                (month_start,),
            )
            summary_row = cur.fetchone()
            if summary_row and summary_row[0] is not None:
                summary = DashboardSummary(
                    planned_amount=_to_float(summary_row[0]) or 0.0,
                    fact_amount=_to_float(summary_row[1]) or 0.0,
                    completion_pct=_to_float(summary_row[2]),
                    delta_amount=_to_float(summary_row[3]) or 0.0,
                    delta_pct=_to_float(summary_row[4]),
                )

    return items, summary, last_updated_iso
