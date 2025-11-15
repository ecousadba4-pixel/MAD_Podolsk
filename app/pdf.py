from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timezone, timedelta
from html import escape
from io import BytesIO
from pathlib import Path
from typing import Sequence

from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from weasyprint import HTML

from .font_storage import ensure_embedded_fonts
from .models import DashboardItem, DashboardSummary

LOGGER = logging.getLogger(__name__)

FONT_DIR = Path(__file__).resolve().parent / "fonts"
ensure_embedded_fonts(FONT_DIR)

try:
    MOSCOW_TZ = ZoneInfo("Europe/Moscow")
except ZoneInfoNotFoundError:
    LOGGER.warning(
        "Не удалось загрузить таймзону Europe/Moscow из системной базы. "
        "Используется фиксированное смещение UTC+3."
    )
    MOSCOW_TZ = timezone(timedelta(hours=3))

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
    "внерегл_ч_1": "внерегламент",
    "внерегл_ч_2": "внерегламент",
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


def _resolve_category_name(
    raw_key: str | None,
    title_hint: str | None = None,
) -> tuple[str, str]:
    candidate = (raw_key or "").strip()
    hint = (title_hint or "").strip()
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
        key, title = _resolve_category_name(
            item.category or item.smeta,
            item.smeta or item.category,
        )
        group = groups.get(key)
        if group is None:
            group = CategoryGroup(key=key, title=title)
            groups[key] = group
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
    return dt.strftime("%d.%m.%Y %H:%M МСК")


def build_dashboard_pdf(
    month: date,
    last_updated: datetime | None,
    items: Sequence[DashboardItem],
    summary: DashboardSummary | None,
) -> bytes:
    groups = _group_items(items)
    html = _render_html(month, last_updated, summary, groups)
    buffer = BytesIO()
    HTML(string=html, base_url=str(Path(__file__).resolve().parent)).write_pdf(buffer)
    return buffer.getvalue()


def _render_html(
    month: date,
    last_updated: datetime | None,
    summary: DashboardSummary | None,
    groups: Sequence[CategoryGroup],
) -> str:
    month_label = escape(_format_month(month))
    updated_label = escape(_format_last_updated(last_updated))
    summary_html = _render_summary_section(summary)
    items_html = _render_items_table(groups)
    return f"""
<!DOCTYPE html>
<html lang=\"ru\">
  <head>
    <meta charset=\"utf-8\" />
    <style>
      @font-face {{
        font-family: 'MADDejaVu';
        src: url('fonts/DejaVuSans.ttf') format('truetype');
        font-weight: 400;
      }}
      @font-face {{
        font-family: 'MADDejaVu';
        src: url('fonts/DejaVuSans-Bold.ttf') format('truetype');
        font-weight: 600;
      }}
      body {{
        font-family: 'MADDejaVu', 'DejaVu Sans', 'Arial', sans-serif;
        margin: 24px 32px;
        color: #111827;
        font-size: 12px;
      }}
      h1 {{
        font-size: 22px;
        margin: 0 0 6px 0;
      }}
      .meta {{
        margin: 2px 0;
        color: #374151;
      }}
      .notice {{
        margin-top: 4px;
      }}
      .summary-table {{
        width: 280px;
        border-collapse: collapse;
        margin: 14px 0;
      }}
      .summary-table th {{
        text-align: left;
        font-weight: 600;
        padding: 4px 6px;
      }}
      .summary-table td {{
        text-align: right;
        padding: 4px 6px;
      }}
      .items-table {{
        width: 100%;
        border-collapse: collapse;
        margin-top: 10px;
        font-size: 11px;
      }}
      .items-table th {{
        text-align: left;
        padding: 6px 6px;
        background: #f3f4f6;
        border-bottom: 1px solid #cbd5f5;
      }}
      .items-table th.numeric {{
        text-align: right;
      }}
      .items-table td {{
        padding: 5px 6px;
        vertical-align: top;
      }}
      .items-table td.numeric {{
        text-align: right;
      }}
      .category-row {{
        background: #eef2ff;
        font-weight: 600;
        border-top: 1px solid #e0e7ff;
        border-bottom: 1px solid #c7d2fe;
      }}
      .item-row-alt {{
        background: #f8fafc;
      }}
      .item-name {{
        padding-left: 16px;
      }}
    </style>
  </head>
  <body>
    <h1>Сводный отчёт по работам Подольск</h1>
    <p class=\"meta\">Месяц: <strong>{month_label}</strong></p>
    <p class=\"meta\">Данные обновлены: {updated_label}</p>
    <p class=\"meta notice\">Факт содержит только заявки в статусе «Рассмотрено».</p>
    {summary_html}
    {items_html}
  </body>
</html>
"""


def _render_summary_section(summary: DashboardSummary | None) -> str:
    planned = summary.planned_amount if summary else None
    fact = summary.fact_amount if summary else None
    completion = summary.completion_pct if summary else None
    delta = summary.delta_amount if summary else None
    rows = [
        ("План", _format_money(planned)),
        ("Факт", _format_money(fact)),
        ("Выполнение", _format_percent(completion)),
        ("Отклонение", _format_money(delta)),
    ]
    rendered_rows = "".join(
        f"<tr><th>{escape(title)}</th><td>{escape(value)}</td></tr>" for title, value in rows
    )
    return f"<table class=\"summary-table\"><tbody>{rendered_rows}</tbody></table>"


def _render_items_table(groups: Sequence[CategoryGroup]) -> str:
    if not groups:
        return "<p class=\"meta\">Нет данных по выбранному месяцу.</p>"
    header = (
        "<thead><tr>"
        "<th>Смета</th>"
        "<th class=\"numeric\">План</th>"
        "<th class=\"numeric\">Факт</th>"
        "<th class=\"numeric\">Отклонение</th>"
        "</tr></thead>"
    )
    body_rows: list[str] = []
    for group in groups:
        body_rows.append(
            "<tr class=\"category-row\">"
            f"<td>{escape(group.title)}</td>"
            f"<td class=\"numeric\">{escape(_format_money(group.planned_total))}</td>"
            f"<td class=\"numeric\">{escape(_format_money(group.fact_total))}</td>"
            f"<td class=\"numeric\">{escape(_format_money(group.delta_total))}</td>"
            "</tr>"
        )
        for idx, item in enumerate(group.items):
            delta = _calculate_delta(item)
            work_name = item.work_name or item.description or "Без названия"
            row_class = "item-row-alt" if idx % 2 else ""
            class_attr = "item-row" if not row_class else f"item-row {row_class}"
            body_rows.append(
                f"<tr class=\"{class_attr}\">"
                f"<td class=\"item-name\">{escape(work_name)}</td>"
                f"<td class=\"numeric\">{escape(_format_money(item.planned_amount))}</td>"
                f"<td class=\"numeric\">{escape(_format_money(item.fact_amount))}</td>"
                f"<td class=\"numeric\">{escape(_format_money(delta))}</td>"
                "</tr>"
            )
    body = "<tbody>" + "".join(body_rows) + "</tbody>"
    return f"<table class=\"items-table\">{header}{body}</table>"
