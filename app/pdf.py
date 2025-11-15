from __future__ import annotations

import os
import logging
from dataclasses import dataclass, field
from datetime import date, datetime
from io import BytesIO
from pathlib import Path
from typing import Iterable, Sequence

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from .models import DashboardItem, DashboardSummary

logger = logging.getLogger(__name__)

FONT_DIR = Path(__file__).resolve().parent / "fonts"
BODY_FONT = "DejaVuSans"
BODY_FONT_BOLD = "DejaVuSans-Bold"
DEFAULT_BODY_FONT = "Helvetica"
DEFAULT_BODY_FONT_BOLD = "Helvetica-Bold"

FONT_ALTERNATIVES: dict[str, list[str]] = {
    BODY_FONT: [
        "DejaVuSans.ttf",
        "FreeSans.ttf",
        "LiberationSans-Regular.ttf",
    ],
    BODY_FONT_BOLD: [
        "DejaVuSans-Bold.ttf",
        "FreeSansBold.ttf",
        "LiberationSans-Bold.ttf",
    ],
}


def _font_search_roots() -> list[Path]:
    env_paths = [
        Path(p).expanduser()
        for p in os.environ.get("MAD_PDF_FONT_PATHS", "").split(os.pathsep)
        if p
    ]
    return env_paths + [
        FONT_DIR,
        Path("/usr/share/fonts/truetype/dejavu"),
        Path("/usr/share/fonts/truetype/freefont"),
        Path("/usr/share/fonts/truetype/liberation"),
        Path("/usr/local/share/fonts"),
        Path.home() / ".local/share/fonts",
        Path.home() / ".fonts",
    ]


def _resolve_font_path(file_names: Sequence[str]) -> Path | None:
    search_roots = _font_search_roots()
    for file_name in file_names:
        direct_candidate = Path(file_name).expanduser()
        if direct_candidate.is_file():
            return direct_candidate
        for root in search_roots:
            if root.exists() and root.is_file():
                candidate = root
            else:
                candidate = root / file_name
            if candidate.is_file():
                return candidate
    return None


def _register_fonts() -> tuple[str, str]:
    resolved: dict[str, str | None] = {
        BODY_FONT: BODY_FONT if BODY_FONT in pdfmetrics.getRegisteredFontNames() else None,
        BODY_FONT_BOLD: BODY_FONT_BOLD
        if BODY_FONT_BOLD in pdfmetrics.getRegisteredFontNames()
        else None,
    }
    missing_messages: list[str] = []
    for font_name, file_candidates in FONT_ALTERNATIVES.items():
        if resolved.get(font_name):
            continue
        font_path = _resolve_font_path(file_candidates)
        if font_path is None:
            readable_names = ", ".join(file_candidates)
            missing_messages.append(
                f"'{font_name}': {readable_names}"
            )
            continue
        pdfmetrics.registerFont(TTFont(font_name, str(font_path)))
        resolved[font_name] = font_name

    if missing_messages:
        logger.warning(
            "Не удалось зарегистрировать кириллические шрифты (%s). "
            "Используем стандартные Helvetica — PDF может отображать квадраты вместо текста.",
            "; ".join(missing_messages),
        )

    body_font = resolved.get(BODY_FONT) or DEFAULT_BODY_FONT
    body_font_bold = resolved.get(BODY_FONT_BOLD) or DEFAULT_BODY_FONT_BOLD
    return body_font, body_font_bold


ACTIVE_BODY_FONT, ACTIVE_BODY_FONT_BOLD = _register_fonts()

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
                ("FONTNAME", (0, 0), (-1, -1), ACTIVE_BODY_FONT),
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
        ("FONTNAME", (0, 0), (-1, 0), ACTIVE_BODY_FONT_BOLD),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#111827")),
        ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
        ("FONTNAME", (0, 1), (-1, -1), ACTIVE_BODY_FONT),
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
                ("FONTNAME", (0, idx), (-1, idx), ACTIVE_BODY_FONT_BOLD),
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
        fontName=ACTIVE_BODY_FONT_BOLD,
        fontSize=16,
        leading=20,
        spaceAfter=6,
    )
    meta_style = ParagraphStyle(
        "Meta",
        fontName=ACTIVE_BODY_FONT,
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
