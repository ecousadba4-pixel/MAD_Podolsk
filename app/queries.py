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


def fetch_plan_vs_fact_for_month(month_start: date) -> Tuple[List[DashboardItem], DashboardSummary, Optional[str]]:
    """
    Читает данные из view skpdi_plan_vs_fact_monthly для конкретного месяца
    и собирает summary.
    Возвращает: (items, summary, last_updated_iso)
    """
    items: List[DashboardItem] = []

    conn = get_connection()
    last_updated_iso: Optional[str] = None
    try:
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

        # summary по данным
        planned_total = sum(_to_float(i.planned_amount) or 0.0 for i in items)
        fact_total = sum(_to_float(i.fact_amount) or 0.0 for i in items)
        delta = fact_total - planned_total
        completion = (fact_total / planned_total) if planned_total else None
        delta_pct = (delta / planned_total) if planned_total else None

        summary = DashboardSummary(
            planned_amount=planned_total,
            fact_amount=fact_total,
            completion_pct=completion,
            delta_amount=delta,
            delta_pct=delta_pct,
        )

        return items, summary, last_updated_iso

    finally:
        conn.close()
