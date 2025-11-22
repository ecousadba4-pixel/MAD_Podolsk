from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from datetime import date, datetime, timezone, timedelta
from io import BytesIO
from pathlib import Path
from typing import Iterable, Sequence
from xml.sax.saxutils import escape

from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from .constants import (
    CATEGORY_VNR_1,
    CATEGORY_VNR_2,
    CATEGORY_VNR_LABEL,
    LAST_UPDATED_DATETIME_FORMAT,
    MIN_VALUE_THRESHOLD,
    PAGE_NUMBER_OFFSET_X_MM,
    PAGE_NUMBER_OFFSET_Y_MM,
    SUMMARY_LABEL_COMPLETION,
    SUMMARY_LABEL_DELTA,
    SUMMARY_LABEL_FACT,
    SUMMARY_LABEL_PLAN,
    TABLE_HEADER_DELTA,
    TABLE_HEADER_FACT,
    TABLE_HEADER_PLAN,
    TABLE_HEADER_SMETA,
    TZ_MOSCOW_NAME,
    UNTITLED_WORK_LABEL,
)
from .font_storage import ensure_embedded_fonts
from .models import DashboardItem, DashboardSummary
from .utils import format_money, format_percent, normalize_string

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

try:
    MOSCOW_TZ = ZoneInfo(TZ_MOSCOW_NAME)
except ZoneInfoNotFoundError:
    LOGGER.warning(
        "Не удалось загрузить таймзону Europe/Moscow из системной базы. "
        "Используется фиксированное смещение UTC+3."
    )
    MOSCOW_TZ = timezone(timedelta(hours=3))

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
            if not root.exists():
                continue
            if root.is_file():
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
    fontSize=7.5,
    leading=8.2,
    spaceAfter=0,
    spaceBefore=0,
)

NESTED_TABLE_TEXT_STYLE = ParagraphStyle(
    "NestedTableText",
    parent=TABLE_TEXT_STYLE,
    leftIndent=8,
)

TITLE_STYLE = ParagraphStyle(
    "Title",
    fontName=BODY_FONT_BOLD_NAME,
    fontSize=15,
    leading=18,
    spaceAfter=4,
)

META_STYLE = ParagraphStyle(
    "Meta",
    fontName=BODY_FONT_NAME,
    fontSize=10,
    leading=12,
    spaceAfter=1,
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

MERGED_CATEGORY_OVERRIDES: dict[str, str] = {
    CATEGORY_VNR_1: CATEGORY_VNR_LABEL,
    CATEGORY_VNR_2: CATEGORY_VNR_LABEL,
}


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


# Функции _format_money и _format_percent перенесены в utils.py
# Используются: format_money, format_percent


class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states: list[dict] = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        # Не фиксируем страницу сразу, чтобы избежать повторного рендеринга без номера
        # страницы. Настоящее отображение происходит в save(), когда уже известен
        # итоговый счётчик.
        self._startPage()

    def save(self):
        total_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self._draw_page_number(total_pages)
            super().showPage()
        super().save()

    def _draw_page_number(self, page_count: int):
        self.setFont(BODY_FONT_NAME, 8)
        page_number = f"{self._pageNumber} / {page_count}"
        x = self._pagesize[0] - PAGE_NUMBER_OFFSET_X_MM * mm
        y = PAGE_NUMBER_OFFSET_Y_MM * mm
        self.drawRightString(x, y, page_number)


def _calculate_delta(item: DashboardItem) -> float:
    if item.delta_amount is not None:
        return item.delta_amount
    planned = item.planned_amount or 0.0
    fact = item.fact_amount or 0.0
    return fact - planned


def _resolve_category_name(
    raw_key: str | None,
    title_hint: str | None = None,
) -> tuple[str, str]:
    candidate = normalize_string(raw_key)
    hint = normalize_string(title_hint)
    fallback = candidate or hint or "Прочее"
    override = MERGED_CATEGORY_OVERRIDES.get(fallback.lower())
    if override:
        return override, override
    key = candidate or fallback
    title = hint or fallback
    return key, title


def _group_items(items: Sequence[DashboardItem]) -> list[CategoryGroup]:
    groups: dict[str, CategoryGroup] = {}
    for item in items:
        if item.planned_amount is None and item.fact_amount is None:
            # В отчет не должны попадать строки без данных по плану и факту
            continue
        planned_value = item.planned_amount or 0.0
        fact_value = item.fact_amount or 0.0
        if planned_value < MIN_VALUE_THRESHOLD and fact_value < MIN_VALUE_THRESHOLD:
            # Исключаем строки, где план и факт одновременно меньше 1
            continue
        is_plan_only = getattr(item, "category_plan_only", False)
        key, title = _resolve_category_name(
            item.category or item.smeta,
            item.smeta or item.category,
        )
        group = groups.get(key)
        if group is None:
            group = CategoryGroup(key=key, title=title)
            groups[key] = group
        if not is_plan_only:
            group.items.append(item)
        if item.planned_amount is not None:
            group.planned_total += item.planned_amount
        if item.fact_amount is not None:
            group.fact_total += item.fact_amount
    for group in groups.values():
        group.items.sort(key=_work_sort_key)
    return sorted(
        groups.values(),
        key=lambda g: (-(g.planned_total or 0.0), g.title.lower()),
    )


def _work_sort_key(item: DashboardItem) -> tuple:
    planned = item.planned_amount
    fact = item.fact_amount
    planned_order = 0 if planned is not None else 1
    primary_value = planned if planned is not None else (fact or 0.0)
    fact_value = fact or 0.0
    return (
        planned_order,
        -primary_value,
        -fact_value,
        (item.work_name or item.description or ""),
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
    dt = value
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    dt = dt.astimezone(MOSCOW_TZ)
    return dt.strftime(LAST_UPDATED_DATETIME_FORMAT)


def _build_summary_table(summary: DashboardSummary | None, width: float) -> Table:
    planned = summary.planned_amount if summary else None
    fact = summary.fact_amount if summary else None
    completion = summary.completion_pct if summary else None
    delta = summary.delta_amount if summary else None
    data = [
        [SUMMARY_LABEL_PLAN, format_money(planned)],
        [SUMMARY_LABEL_FACT, format_money(fact)],
        [SUMMARY_LABEL_COMPLETION, format_percent(completion)],
        [SUMMARY_LABEL_DELTA, format_money(delta)],
    ]
    table = Table(data, colWidths=[width * 0.35, width * 0.65])
    table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, -1), BODY_FONT_NAME),
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ("TOPPADDING", (0, 0), (-1, -1), 1),
            ]
        )
    )
    return table


def _build_items_table(groups: Iterable[CategoryGroup], width: float) -> Table:
    header = [
        TABLE_HEADER_SMETA,
        TABLE_HEADER_PLAN,
        TABLE_HEADER_FACT,
        TABLE_HEADER_DELTA,
    ]
    data: list[list[object]] = [header]
    category_rows: list[int] = []
    item_rows: list[int] = []
    item_row_backgrounds: list[tuple[int, colors.Color]] = []
    total_planned = 0.0
    total_fact = 0.0
    value_font_size = 7.6
    eight_digit_sample = "99999999"
    padding = 8  # left + right padding per column
    value_width = pdfmetrics.stringWidth(
        eight_digit_sample,
        BODY_FONT_NAME,
        value_font_size,
    )
    header_width = max(
        pdfmetrics.stringWidth(text, BODY_FONT_BOLD_NAME, value_font_size)
        for text in header[1:]
    )
    value_column_width = max(value_width, header_width) + padding
    total_value_width = value_column_width * 3
    if total_value_width >= width:
        value_column_width = width / 4
        total_value_width = value_column_width * 3
    plan_fact_column_width = max(value_column_width - 4, value_column_width * 0.8)
    total_value_width = value_column_width + 2 * plan_fact_column_width
    description_width = width - total_value_width
    row_idx = 1
    for group in groups:
        data.append(
            [
                _paragraph(group.title),
                format_money(group.planned_total),
                format_money(group.fact_total),
                format_money(group.delta_total),
            ]
        )
        category_rows.append(row_idx)
        row_idx += 1
        if group.items:
            for idx, item in enumerate(group.items):
                delta = _calculate_delta(item)
                work_name = item.work_name or item.description or UNTITLED_WORK_LABEL
                data.append(
                    [
                        _paragraph(work_name, NESTED_TABLE_TEXT_STYLE),
                        format_money(item.planned_amount),
                        format_money(item.fact_amount),
                        format_money(delta),
                    ]
                )
                item_rows.append(row_idx)
                if idx % 2:
                    bg = colors.HexColor("#f8fafc")
                else:
                    bg = colors.white
                item_row_backgrounds.append((row_idx, bg))
                row_idx += 1
        total_planned += group.planned_total
        total_fact += group.fact_total
    if row_idx > 1:
        total_delta = (total_fact or 0.0) - (total_planned or 0.0)
        data.append(
            [
                _paragraph(
                    "Итого",
                    ParagraphStyle(
                        "TotalRow", parent=TABLE_TEXT_STYLE, fontName=BODY_FONT_BOLD_NAME
                    ),
                ),
                format_money(total_planned),
                format_money(total_fact),
                format_money(total_delta),
            ]
        )
        total_row_idx = row_idx
        row_idx += 1
    table = Table(
        data,
        repeatRows=1,
        colWidths=[
            description_width,
            plan_fact_column_width,
            plan_fact_column_width,
            value_column_width,
        ],
    )
    style_commands: list[tuple] = [
        ("FONTNAME", (0, 0), (-1, 0), BODY_FONT_BOLD_NAME),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#111827")),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("FONTNAME", (0, 1), (-1, -1), BODY_FONT_NAME),
        ("FONTSIZE", (0, 0), (-1, -1), 7.6),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, colors.HexColor("#cbd5f5")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
    ]
    style_commands.extend(
        [
            ("RIGHTPADDING", (1, 0), (1, -1), 2),
            ("LEFTPADDING", (2, 0), (2, -1), 2),
        ]
    )
    for idx in category_rows:
        style_commands.extend(
            [
                ("FONTNAME", (0, idx), (-1, idx), BODY_FONT_BOLD_NAME),
                ("BACKGROUND", (0, idx), (-1, idx), colors.HexColor("#eef2ff")),
                ("LINEABOVE", (0, idx), (-1, idx), 0.25, colors.HexColor("#e0e7ff")),
                ("LINEBELOW", (0, idx), (-1, idx), 0.25, colors.HexColor("#c7d2fe")),
            ]
        )
    for idx, background in item_row_backgrounds:
        style_commands.append(("BACKGROUND", (0, idx), (-1, idx), background))
    for idx in item_rows:
        style_commands.append(("LEFTPADDING", (0, idx), (0, idx), 10))
    if row_idx > 1:
        style_commands.extend(
            [
                ("FONTNAME", (0, total_row_idx), (-1, total_row_idx), BODY_FONT_BOLD_NAME),
                ("BACKGROUND", (0, total_row_idx), (-1, total_row_idx), colors.HexColor("#e5e7eb")),
                ("LINEABOVE", (0, total_row_idx), (-1, total_row_idx), 0.5, colors.HexColor("#d1d5db")),
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
    story: list = []
    story.append(Paragraph("Сводный отчёт по работам Подольск", TITLE_STYLE))
    story.append(Paragraph(f"Месяц: <b>{_format_month(month)}</b>", META_STYLE))
    story.append(Paragraph(f"Данные обновлены: {_format_last_updated(last_updated)}", META_STYLE))
    story.append(Paragraph("Факт содержит только заявки в статусе «Рассмотрено».", META_STYLE))
    story.append(Spacer(1, 6))
    story.append(_build_summary_table(summary, doc.width))
    story.append(Spacer(1, 8))
    groups = _group_items(items)
    if not groups:
        story.append(Paragraph("Нет данных по выбранному месяцу.", META_STYLE))
    else:
        story.append(_build_items_table(groups, doc.width))
    doc.build(story, canvasmaker=NumberedCanvas)
    return buffer.getvalue()
