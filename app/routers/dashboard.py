from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query, Request, status
from fastapi.responses import Response

from ..models import DashboardResponse, WorkDetailsResponse
from ..visit_logger import VisitLogRequest, log_dashboard_visit
from ..pdf import build_dashboard_pdf
from ..queries import (
    fetch_available_months,
    fetch_plan_vs_fact_for_month,
    fetch_work_daily_volumes,
)

router = APIRouter()

MonthQuery = Annotated[
    date,
    Query(..., description="Первый день месяца, напр. 2025-11-01"),
]


@router.get("/dashboard", response_model=DashboardResponse)
def get_dashboard(month: MonthQuery, request: Request) -> DashboardResponse:
    """Основной эндпоинт для дашборда."""

    items, summary, last_updated = fetch_plan_vs_fact_for_month(month)

    log_dashboard_visit(request=request, endpoint=str(request.url.path))

    return DashboardResponse(
        month=month,
        last_updated=last_updated,
        summary=summary,
        items=items,
        has_data=bool(items),
    )


@router.get("/dashboard/pdf")
def get_dashboard_pdf(month: MonthQuery, request: Request) -> Response:
    """Отдаёт тот же отчёт, но сразу в формате PDF."""

    items, summary, last_updated = fetch_plan_vs_fact_for_month(month)
    log_dashboard_visit(request=request, endpoint=str(request.url.path))
    pdf_bytes = build_dashboard_pdf(month, last_updated, items, summary)
    file_name = f"mad-podolsk-otchet-{month.strftime('%Y-%m')}.pdf"
    headers = {"Content-Disposition": f'attachment; filename="{file_name}"'}
    return Response(content=pdf_bytes, media_type="application/pdf", headers=headers)


@router.get("/dashboard/months")
def get_available_months(limit: Annotated[int | None, Query(gt=0, le=24)] = 12) -> dict[str, list[date]]:
    """Возвращает список месяцев, для которых есть данные."""

    months = fetch_available_months(limit=limit or 12)
    return {"months": months}


@router.post("/dashboard/visit", status_code=status.HTTP_204_NO_CONTENT)
def log_dashboard_visit_endpoint(payload: VisitLogRequest, request: Request) -> Response:
    """Записывает единичный визит пользователя на дашборд.

    Запрос должен отправляться фронтендом один раз за визит с передачей всех
    клиентских метрик, чтобы в базе появлялась ровно одна запись.
    """

    log_dashboard_visit(
        request=request,
        endpoint=payload.endpoint,
        user_id=payload.user_id,
        session_id=payload.session_id,
        session_duration_sec=payload.session_duration_sec,
    )

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/dashboard/work-details", response_model=WorkDetailsResponse)
def get_work_details(
    month: MonthQuery,
    work_key: Annotated[str, Query(min_length=1, max_length=512)],
    work_name: Annotated[str | None, Query(max_length=512)] = None,
    description: Annotated[str | None, Query(max_length=1024)] = None,
    smeta: Annotated[str | None, Query(max_length=512)] = None,
) -> WorkDetailsResponse:
    """Возвращает помесячные объёмы выбранной работы."""

    identifiers = [work_key, work_name, description, smeta]
    days = fetch_work_daily_volumes(month, identifiers=identifiers)

    return WorkDetailsResponse(
        work_key=work_key,
        work_name=work_name,
        description=description,
        smeta=smeta,
        days=days,
    )
