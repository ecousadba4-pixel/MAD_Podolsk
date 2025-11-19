from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query, Request, status
from fastapi.responses import Response

from ..models import DashboardResponse
from ..visit_logger import VisitLogRequest, log_dashboard_visit
from ..pdf import build_dashboard_pdf
from ..queries import fetch_available_months, fetch_plan_vs_fact_for_month, fetch_work_daily_breakdown

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


@router.get("/dashboard/work-breakdown")
def get_work_breakdown(month: MonthQuery, work: Annotated[str, Query(..., description="Название вида работы")]) -> list[dict]:
    """Возвращает подневную расшифровку объёмов (`total_volume`) по указанной работе за месяц.

    Возвращает массив объектов с полями `date`, `amount` и `unit`.
    """
    rows = fetch_work_daily_breakdown(month, work)
    return [
        {
            "date": r.date.isoformat(),
            "amount": r.amount,
            "unit": r.unit,
            "total_amount": r.total_amount,
        }
        for r in rows
    ]
