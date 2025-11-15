from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query

from ..models import DashboardResponse
from ..queries import fetch_plan_vs_fact_for_month

router = APIRouter()

MonthQuery = Annotated[
    date,
    Query(..., description="Первый день месяца, напр. 2025-11-01"),
]


@router.get("/dashboard", response_model=DashboardResponse)
def get_dashboard(month: MonthQuery) -> DashboardResponse:
    """Основной эндпоинт для дашборда."""

    items, summary, last_updated = fetch_plan_vs_fact_for_month(month)
    return DashboardResponse(
        month=month,
        last_updated=last_updated,
        summary=summary,
        items=items,
        has_data=bool(items),
    )
