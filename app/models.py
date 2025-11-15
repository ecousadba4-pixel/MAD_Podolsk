from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel


class DashboardItem(BaseModel):
    category: str | None = None
    smeta: str | None = None
    work_name: str | None = None
    description: str

    planned_amount: float | None = None
    fact_amount: float | None = None

    delta_amount: float | None = None


class DashboardSummary(BaseModel):
    planned_amount: float
    fact_amount: float
    completion_pct: float | None = None
    delta_amount: float


class DashboardResponse(BaseModel):
    month: date
    last_updated: datetime | None
    summary: DashboardSummary | None
    items: list[DashboardItem]
    has_data: bool
