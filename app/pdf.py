from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from io import BytesIO
from typing import Iterable, Sequence

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from .models import DashboardItem, DashboardSummary

BODY_FONT = "Helvetica"
BODY_FONT_BOLD = "Helvetica-Bold"

MONTH_LABELS = [
    "январь",
    "февраль",
    "март",
    "апрель",
    "май",
    "июнь",
    "июль",
    "август",
    "сентябрь",
    "октябрь",
    "ноябрь",
    "декабрь",
]


@dataclass
class CategoryGroup:
    key: str
    title: str
    items: list[DashboardItem] = field(default_factory=list)
    planned_total: float = 0.0
    fact_total: float = 0.0

    @property
    def delta_total(self) -> float:
        return (self.fact_total or 0.0) - (self.planned_total or 0.0)


def _format_money(value: float | None) -> str:
    if value is None:
        return "—"
    return f"{value:,.0f}".replace(",", " ") + " ₽"


def _format_percent(value: float | None) -> str:
    if value is None:
        return "—"
    return f"{value * 100:.1f} %"


def _calculate_delta(item: DashboardItem) -> float:
    if item.delta_amount is not None:
        return item.delta_amount
    planned = item.planned_amount or 0.0
    fact = item.fact_amount or 0.0
    return fact - planned


def _group_items(items: Sequence[DashboardItem]) -> list[CategoryGroup]:
    groups: dict[str, CategoryGroup] = {}
    for item in items:
        key = (item.smeta or item.category or "Прочее").strip() or "Прочее"
        title = (item.smeta or item.category or "Прочее").strip() or "Прочее"
        group = groups.get(key)
        if group is None:
            group = CategoryGroup(key=key, title=title)
            groups[key] = group
        group.items.append(item)
        if item.planned_amount is not None:
            group.planned_total += item.planned_amount
        if item.fact_amount is not None:
            group.fact_total += item.fact_amount
    return sorted(
        groups.values(),
        key=lambda g: (-(g.planned_total or 0.0), g.title.lower()),
    )


def _format_month(month: date) -> str:
    name = MONTH_LABELS[month.month - 1]
    return f"{name.capitalize()} {month.year}"


def _format_last_updated(value: datetime | None) -> str:
    if not value:
        return "нет данных"
    return value.strftime("%d.%m.%Y %H:%M")


def _build_summary_table(summary: DashboardSummary | None, width: float) -> Table:
    planned = summary.planned_amount if summary else None
    fact = summary.fact_amount if summary else None
    completion = summary.completion_pct if summary else None
    delta = summary.delta_amount if summary else None
    data = [
        ["План", _format_money(planned)],
        ["Факт", _format_money(fact)],
        ["Выполнение", _format_percent(completion)],
        ["Отклонение", _format_money(delta)],
    ]
    table = Table(data, colWidths=[width * 0.35, width * 0.65])
    table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, -1), BODY_FONT),
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
            ]
        )
    )
    return table


def _build_items_table(groups: Iterable[CategoryGroup], width: float) -> Table:
    header = ["Смета", "Работа", "План", "Факт", "Отклонение"]
    data: list[list[str]] = [header]
    category_rows: list[int] = []
    row_idx = 1
    for group in groups:
        data.append(
            [
                group.title,
                "Итого по смете",
                _format_money(group.planned_total),
                _format_money(group.fact_total),
                _format_money(group.delta_total),
            ]
        )
        category_rows.append(row_idx)
        row_idx += 1
        for item in group.items:
            delta = _calculate_delta(item)
            work_name = item.work_name or item.description or "Без названия"
            data.append(
                [
                    "",
                    work_name,
                    _format_money(item.planned_amount),
                    _format_money(item.fact_amount),
                    _format_money(delta),
                ]
            )
            row_idx += 1
    table = Table(
        data,
        repeatRows=1,
        colWidths=[
            width * 0.26,
            width * 0.34,
            width * 0.13,
            width * 0.13,
            width * 0.14,
        ],
    )
    style_commands: list[tuple] = [
        ("FONTNAME", (0, 0), (-1, 0), BODY_FONT_BOLD),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#111827")),
        ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
        ("FONTNAME", (0, 1), (-1, -1), BODY_FONT),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, colors.HexColor("#cbd5f5")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f9fafb")]),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
    ]
    for idx in category_rows:
        style_commands.extend(
            [
                ("FONTNAME", (0, idx), (-1, idx), BODY_FONT_BOLD),
                ("BACKGROUND", (0, idx), (-1, idx), colors.HexColor("#eef2ff")),
            ]
        )
    table.setStyle(TableStyle(style_commands))
    return table


def build_dashboard_pdf(
    month: date,
    last_updated: datetime | None,
    items: Sequence[DashboardItem],
    summary: DashboardSummary | None,
) -> bytes:
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=20 * mm,
        bottomMargin=20 * mm,
    )
    title_style = ParagraphStyle(
        "Title",
        fontName=BODY_FONT_BOLD,
        fontSize=16,
        leading=20,
        spaceAfter=6,
    )
    meta_style = ParagraphStyle(
        "Meta",
        fontName=BODY_FONT,
        fontSize=10,
        leading=13,
        spaceAfter=2,
    )
    story: list = []
    story.append(Paragraph("Сводный отчёт по работам", title_style))
    story.append(Paragraph(f"Месяц: <b>{_format_month(month)}</b>", meta_style))
    story.append(Paragraph(f"Данные обновлены: {_format_last_updated(last_updated)}", meta_style))
    story.append(Paragraph("Факт содержит только заявки в статусе «Рассмотрено».", meta_style))
    story.append(Spacer(1, 10))
    story.append(_build_summary_table(summary, doc.width))
    story.append(Spacer(1, 12))
    groups = _group_items(items)
    if not groups:
        story.append(Paragraph("Нет данных по выбранному месяцу.", meta_style))
    else:
        story.append(_build_items_table(groups, doc.width))
    doc.build(story)
    return buffer.getvalue()
