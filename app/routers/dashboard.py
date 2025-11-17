from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query
from fastapi.responses import Response

from ..models import DashboardResponse
from ..pdf import build_dashboard_pdf
from ..queries import fetch_available_months, fetch_plan_vs_fact_for_month

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


@router.get("/dashboard/pdf")
def get_dashboard_pdf(month: MonthQuery) -> Response:
    """Отдаёт тот же отчёт, но сразу в формате PDF."""

    items, summary, last_updated = fetch_plan_vs_fact_for_month(month)
    pdf_bytes = build_dashboard_pdf(month, last_updated, items, summary)
    file_name = f"mad-podolsk-otchet-{month.strftime('%Y-%m')}.pdf"
    headers = {"Content-Disposition": f'attachment; filename="{file_name}"'}
    return Response(content=pdf_bytes, media_type="application/pdf", headers=headers)


@router.post("/dashboard/cache/invalidate", status_code=204)
def invalidate_dashboard_cache() -> None:
    """Совместимость: кэш отключён, эндпоинт оставлен пустым."""

    return None


@router.get("/dashboard/months")
def get_available_months(limit: Annotated[int | None, Query(gt=0, le=24)] = 12) -> dict[str, list[date]]:
    """Возвращает список месяцев, для которых есть данные."""

    months = fetch_available_months(limit=limit or 12)
    return {"months": months}
