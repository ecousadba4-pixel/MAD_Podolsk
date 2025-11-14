from datetime import date, datetime
from typing import Optional, List

from pydantic import BaseModel


class DashboardItem(BaseModel):
    description: str
    unit: Optional[str] = None

    planned_volume: Optional[float] = None
    planned_amount: Optional[float] = None

    fact_volume: Optional[float] = None
    fact_amount: Optional[float] = None

    delta_amount: Optional[float] = None
    delta_pct: Optional[float] = None


class DashboardSummary(BaseModel):
    planned_amount: float
    fact_amount: float
    completion_pct: Optional[float] = None
    delta_amount: float
    delta_pct: Optional[float] = None


class DashboardResponse(BaseModel):
    month: date
    last_updated: Optional[datetime]
    summary: DashboardSummary
    items: List[DashboardItem]
