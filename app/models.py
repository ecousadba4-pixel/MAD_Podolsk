from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel


class DashboardItem(BaseModel):
    smeta: str | None = None
    work_name: str | None = None
    description: str
    unit: str | None = None

    planned_volume: float | None = None
    planned_amount: float | None = None

    fact_volume: float | None = None
    fact_amount: float | None = None

    delta_amount: float | None = None
    delta_pct: float | None = None


class DashboardSummary(BaseModel):
    planned_amount: float
    fact_amount: float
    completion_pct: float | None = None
    delta_amount: float
    delta_pct: float | None = None


class DashboardResponse(BaseModel):
    month: date
    last_updated: datetime | None
    summary: DashboardSummary | None
    items: list[DashboardItem]
    has_data: bool
