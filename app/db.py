import psycopg2
from .config import DB_DSN


def get_connection():
    """
    Простой connect per request.
    Для нагрузки этого уровня более чем достаточно.
    """
    if not DB_DSN:
        raise RuntimeError("DB_DSN не задан в переменных окружения")
    return psycopg2.connect(DB_DSN)
