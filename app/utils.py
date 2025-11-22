"""Утилиты для обработки данных: проверка пустых значений, нормализация, конвертация."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any

from .constants import EMPTY_DISPLAY_VALUE, THOUSANDS_SEPARATOR, PERCENT_SUFFIX


def to_float(value: Any) -> float | None:
    """Безопасное преобразование значения в float.
    
    Args:
        value: Значение для преобразования (None, int, float, Decimal, str).
    
    Returns:
        float или None, если преобразование невозможно.
    """
    if value is None:
        return None
    if isinstance(value, (int, float, Decimal)):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def normalize_string(value: Any, default: str = "") -> str:
    """Нормализует строку: убирает пробелы, возвращает значение по умолчанию для пустых.
    
    Args:
        value: Значение для нормализации.
        default: Значение по умолчанию для пустых строк.
    
    Returns:
        Нормализованная строка.
    """
    if value is None:
        return default
    result = str(value).strip()
    return result if result else default


def safe_get_from_dict(
    data: dict[str, Any],
    *keys: str,
    default: Any = None,
) -> Any:
    """Безопасно получить значение из словаря, пытаясь несколько ключей по порядку.
    
    Args:
        data: Словарь для поиска.
        *keys: Ключи для поиска (в порядке приоритета).
        default: Значение по умолчанию, если ни один ключ не найден.
    
    Returns:
        Первое найденное непустое значение или default.
    """
    for key in keys:
        value = data.get(key)
        if value:
            return value
    return default


def get_month_start(month_date: date) -> date:
    """Нормализует дату к первому дню месяца.
    
    Args:
        month_date: Любая дата внутри месяца.
    
    Returns:
        Первый день месяца.
    """
    return month_date.replace(day=1)


def get_next_month_start(month_start: date) -> date:
    """Возвращает первый день следующего месяца.
    
    Args:
        month_start: Первый день текущего месяца.
    
    Returns:
        Первый день следующего месяца.
    """
    # Переходим на 28-е число, добавляем 4 дня (гарантированно попадем в следующий месяц)
    # и нормализуем к первому дню
    return (month_start.replace(day=28) + timedelta(days=4)).replace(day=1)


def is_empty_value(value: Any) -> bool:
    """Проверяет, является ли значение пустым (None, пустая строка после strip, 0).
    
    Args:
        value: Значение для проверки.
    
    Returns:
        True, если значение считается пустым.
    """
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (int, float, Decimal)):
        return value == 0
    return False


def coalesce(*values: Any) -> Any:
    """Возвращает первое непустое значение из списка.
    
    Args:
        *values: Значения для проверки.
    
    Returns:
        Первое непустое значение или None.
    """
    for value in values:
        if not is_empty_value(value):
            return value
    return None


def format_money(value: float | None) -> str:
    """Форматирует денежное значение с разделителями тысяч.
    
    Args:
        value: Денежное значение.
    
    Returns:
        Отформатированная строка или EMPTY_DISPLAY_VALUE для None.
    """
    if value is None:
        return EMPTY_DISPLAY_VALUE
    return f"{value:,.0f}".replace(",", THOUSANDS_SEPARATOR)


def format_percent(value: float | None, decimals: int = 1) -> str:
    """Форматирует процентное значение.
    
    Args:
        value: Значение в диапазоне [0, 1] (например, 0.85 для 85%).
        decimals: Количество десятичных знаков.
    
    Returns:
        Отформатированная строка или EMPTY_DISPLAY_VALUE для None.
    """
    if value is None:
        return EMPTY_DISPLAY_VALUE
    return f"{value * 100:.{decimals}f}{PERCENT_SUFFIX}"


def extract_dict_strings(
    row: dict[str, Any],
    category_keys: tuple[str, ...] = ("category_code", "smeta"),
    smeta_keys: tuple[str, ...] = ("smeta", "smeta_name", "smeta_title", "section"),
    work_keys: tuple[str, ...] = ("work_name", "work_title"),
    description_keys: tuple[str, ...] = ("description",),
    default_description: str = "",
) -> tuple[str | None, str | None, str | None, str]:
    """Извлекает и нормализует строковые поля из словаря строки БД.
    
    Args:
        row: Словарь с данными строки.
        category_keys: Ключи для поля "категория".
        smeta_keys: Ключи для поля "смета".
        work_keys: Ключи для поля "название работы".
        description_keys: Ключи для поля "описание".
        default_description: Значение по умолчанию для описания.
    
    Returns:
        Кортеж (category, smeta, work_name, description).
    """
    description = safe_get_from_dict(row, *description_keys, default=default_description)
    category = safe_get_from_dict(row, *category_keys)
    smeta = safe_get_from_dict(row, *smeta_keys)
    work_name = safe_get_from_dict(row, *work_keys, default=description)
    
    return category, smeta, work_name, description
