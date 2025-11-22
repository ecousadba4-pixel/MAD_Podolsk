from __future__ import annotations

"""Общие константы для бэкенда MAD Podolsk.

Собраны значения, которые используются в нескольких модулях и не завязаны
жёстко на реализацию конкретного файла.
"""

# HTTP / API
API_PREFIX = "/api"
DASHBOARD_BASE_PATH = f"{API_PREFIX}/dashboard"
HEALTH_PATH = "/health"

# Отображение значений
EMPTY_DISPLAY_VALUE = "–"
THOUSANDS_SEPARATOR = " "
PERCENT_SUFFIX = " %"

# Таймзона проекта
TZ_MOSCOW_NAME = "Europe/Moscow"

# Категории и коды
CATEGORY_SUMMER = "лето"
CATEGORY_WINTER = "зима"
CATEGORY_VNR_1 = "внерегл_ч_1"
CATEGORY_VNR_2 = "внерегл_ч_2"

CATEGORY_SEASONAL = {CATEGORY_SUMMER, CATEGORY_WINTER}
CATEGORY_VNR_CODES = {CATEGORY_VNR_1, CATEGORY_VNR_2}

CATEGORY_VNR_LABEL = "внерегламент"

# PDF / отчёты
LAST_UPDATED_DATETIME_FORMAT = "%d.%m.%Y %H:%M МСК"
MIN_VALUE_THRESHOLD = 1.0
PAGE_NUMBER_OFFSET_X_MM = 15
PAGE_NUMBER_OFFSET_Y_MM = 10

SUMMARY_LABEL_PLAN = "План"
SUMMARY_LABEL_FACT = "Факт"
SUMMARY_LABEL_COMPLETION = "Выполнение"
SUMMARY_LABEL_DELTA = "Отклонение"

TABLE_HEADER_SMETA = "Смета"
TABLE_HEADER_PLAN = "План"
TABLE_HEADER_FACT = "Факт"
TABLE_HEADER_DELTA = "Отклонение"

UNTITLED_WORK_LABEL = "Без названия"
