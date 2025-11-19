from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, field_validator


class DashboardItem(BaseModel):
    category: str | None = None
    smeta: str | None = None
    work_name: str | None = None
    description: str
    category_plan_only: bool = False

    planned_amount: float | None = None
    fact_amount: float | None = None
    delta_amount: float | None = None

    @field_validator("delta_amount", mode="before")
    @classmethod
    def compute_delta_if_missing(cls, v: float | None, info) -> float | None:
        """Автоматически вычисляет delta_amount если он не задан."""
        if v is not None:
            return v
        
        planned = info.data.get("planned_amount")
        fact = info.data.get("fact_amount")
        
        if planned is None and fact is None:
            return None
        
        plan_val = planned or 0.0
        fact_val = fact or 0.0
        return fact_val - plan_val


class DailyRevenue(BaseModel):
    date: date
    amount: float


class DailyWorkVolume(BaseModel):
    date: date
    amount: float
    unit: str = ""
    total_amount: float = 0.0


class DashboardSummary(BaseModel):
    planned_amount: float
    fact_amount: float
    completion_pct: float | None = None
    delta_amount: float
    contract_amount: float | None = None
    contract_executed: float | None = None
    contract_completion_pct: float | None = None
    average_daily_revenue: float | None = None
    daily_revenue: list[DailyRevenue] | None = None


class DashboardResponse(BaseModel):
    month: date
    last_updated: datetime | None
    summary: DashboardSummary | None
    items: list[DashboardItem]
    has_data: bool
