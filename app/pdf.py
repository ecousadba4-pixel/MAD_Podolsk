from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from datetime import date, datetime
from io import BytesIO
from pathlib import Path
from typing import Iterable, Sequence
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from .font_storage import ensure_embedded_fonts
from .models import DashboardItem, DashboardSummary

LOGGER = logging.getLogger(__name__)

FONT_DIR = Path(__file__).resolve().parent / "fonts"
ensure_embedded_fonts(FONT_DIR)
BODY_FONT = "DejaVuSans"
BODY_FONT_BOLD = "DejaVuSans-Bold"
DEFAULT_FONT = "Helvetica"
DEFAULT_FONT_BOLD = "Helvetica-Bold"

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

FONT_FALLBACKS: dict[str, str] = {
    BODY_FONT: DEFAULT_FONT,
    BODY_FONT_BOLD: DEFAULT_FONT_BOLD,
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


def _register_fonts() -> dict[str, str]:
    resolved: dict[str, str] = {}
    registered = set(pdfmetrics.getRegisteredFontNames())
    for font_name, file_candidates in FONT_ALTERNATIVES.items():
        if font_name in registered:
            resolved[font_name] = font_name
            continue
        font_path = _resolve_font_path(file_candidates)
        if font_path is None:
            fallback = FONT_FALLBACKS.get(font_name, DEFAULT_FONT)
            readable_names = ", ".join(file_candidates)
            LOGGER.warning(
                "Не удалось найти подходящий файл шрифта для '%s'. "
                "Ожидались файлы: %s. Используется встроенный шрифт '%s'.",
                font_name,
                readable_names,
                fallback,
            )
            resolved[font_name] = fallback
            continue
        pdfmetrics.registerFont(TTFont(font_name, str(font_path)))
        registered.add(font_name)
        resolved[font_name] = font_name
    return resolved


REGISTERED_FONTS = _register_fonts()
BODY_FONT_NAME = REGISTERED_FONTS[BODY_FONT]
BODY_FONT_BOLD_NAME = REGISTERED_FONTS[BODY_FONT_BOLD]

TABLE_TEXT_STYLE = ParagraphStyle(
    "TableText",
    fontName=BODY_FONT_NAME,
    fontSize=8.5,
    leading=10,
    spaceAfter=0,
    spaceBefore=0,
)

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


def _paragraph(text: str, style: ParagraphStyle = TABLE_TEXT_STYLE) -> Paragraph:
    sanitized = escape(text or "").replace("\n", "<br/>")
    return Paragraph(sanitized, style)


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
                ("FONTNAME", (0, 0), (-1, -1), BODY_FONT_NAME),
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
            ]
        )
    )
    return table


def _build_group_items_table(group: CategoryGroup, width: float) -> Table:
    header = ["Работа", "План", "Факт", "Отклонение"]
    rows: list[list[object]] = [header]
    for item in group.items:
        delta = _calculate_delta(item)
        work_name = item.work_name or item.description or "Без названия"
        rows.append(
            [
                _paragraph(work_name),
                _format_money(item.planned_amount),
                _format_money(item.fact_amount),
                _format_money(delta),
            ]
        )
    table = Table(
        rows,
        colWidths=[
            width * 0.52,
            width * 0.16,
            width * 0.16,
            width * 0.16,
        ],
    )
    table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, 0), BODY_FONT_BOLD_NAME),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f8fafc")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#0f172a")),
                ("FONTNAME", (0, 1), (-1, -1), BODY_FONT_NAME),
                ("FONTSIZE", (0, 0), (-1, -1), 8.3),
                ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 3),
                ("RIGHTPADDING", (0, 0), (-1, -1), 3),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f1f5f9")]),
            ]
        )
    )
    return table


def _build_items_table(groups: Iterable[CategoryGroup], width: float) -> Table:
    header = ["Смета", "План", "Факт", "Отклонение"]
    data: list[list[object]] = [header]
    category_rows: list[int] = []
    nested_rows: list[int] = []
    row_idx = 1
    for group in groups:
        data.append(
            [
                _paragraph(group.title),
                _format_money(group.planned_total),
                _format_money(group.fact_total),
                _format_money(group.delta_total),
            ]
        )
        category_rows.append(row_idx)
        row_idx += 1
        if group.items:
            nested_table = _build_group_items_table(group, width)
            data.append([nested_table, "", "", ""])
            nested_rows.append(row_idx)
            row_idx += 1
    table = Table(
        data,
        repeatRows=1,
        colWidths=[
            width * 0.43,
            width * 0.19,
            width * 0.19,
            width * 0.19,
        ],
    )
    style_commands: list[tuple] = [
        ("FONTNAME", (0, 0), (-1, 0), BODY_FONT_BOLD_NAME),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#111827")),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("FONTNAME", (0, 1), (-1, -1), BODY_FONT_NAME),
        ("FONTSIZE", (0, 0), (-1, -1), 8.6),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, colors.HexColor("#cbd5f5")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
    ]
    for idx in category_rows:
        style_commands.extend(
            [
                ("FONTNAME", (0, idx), (-1, idx), BODY_FONT_BOLD_NAME),
                ("BACKGROUND", (0, idx), (-1, idx), colors.HexColor("#eef2ff")),
                ("LINEABOVE", (0, idx), (-1, idx), 0.25, colors.HexColor("#e0e7ff")),
                ("LINEBELOW", (0, idx), (-1, idx), 0.25, colors.HexColor("#c7d2fe")),
            ]
        )
    for idx in nested_rows:
        style_commands.extend(
            [
                ("SPAN", (0, idx), (-1, idx)),
                ("BACKGROUND", (0, idx), (-1, idx), colors.HexColor("#f8fafc")),
                ("LEFTPADDING", (0, idx), (-1, idx), 2),
                ("RIGHTPADDING", (0, idx), (-1, idx), 2),
                ("TOPPADDING", (0, idx), (-1, idx), 2),
                ("BOTTOMPADDING", (0, idx), (-1, idx), 4),
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
        leftMargin=15 * mm,
        rightMargin=15 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
    )
    title_style = ParagraphStyle(
        "Title",
        fontName=BODY_FONT_BOLD_NAME,
        fontSize=15,
        leading=18,
        spaceAfter=4,
    )
    meta_style = ParagraphStyle(
        "Meta",
        fontName=BODY_FONT_NAME,
        fontSize=10,
        leading=12,
        spaceAfter=1,
    )
    story: list = []
    story.append(Paragraph("Сводный отчёт по работам", title_style))
    story.append(Paragraph(f"Месяц: <b>{_format_month(month)}</b>", meta_style))
    story.append(Paragraph(f"Данные обновлены: {_format_last_updated(last_updated)}", meta_style))
    story.append(Paragraph("Факт содержит только заявки в статусе «Рассмотрено».", meta_style))
    story.append(Spacer(1, 6))
    story.append(_build_summary_table(summary, doc.width))
    story.append(Spacer(1, 8))
    groups = _group_items(items)
    if not groups:
        story.append(Paragraph("Нет данных по выбранному месяцу.", meta_style))
    else:
        story.append(_build_items_table(groups, doc.width))
    doc.build(story)
    return buffer.getvalue()
