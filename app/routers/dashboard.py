from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Query

from ..models import DashboardResponse
from ..queries import fetch_plan_vs_fact_for_month

router = APIRouter()


@router.get("/dashboard", response_model=DashboardResponse)
def get_dashboard(
    month: date = Query(..., description="Первый день месяца, напр. 2025-11-01"),
):
    """
    Основной эндпоинт для дашборда.
    Берём данные из skpdi_plan_vs_fact_monthly по month_start.
    """
    items, summary, last_updated_iso = fetch_plan_vs_fact_for_month(month)

    last_updated: Optional[datetime] = None
    if last_updated_iso:
        try:
            last_updated = datetime.fromisoformat(last_updated_iso)
        except Exception:
            last_updated = None

    return DashboardResponse(
        month=month,
        last_updated=last_updated,
        summary=summary,
        items=items,
        has_data=bool(items),
    )
