from __future__ import annotations

from contextlib import contextmanager
from threading import Lock
from typing import Iterator

from psycopg import Connection
from psycopg_pool import ConnectionPool

from .config import get_settings

_pool: ConnectionPool | None = None
_pool_lock = Lock()


def _get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                dsn = get_settings().db_dsn
                if not dsn:
                    msg = (
                        "Переменная окружения DB_DSN не задана. "
                        "Невозможно установить соединение с базой данных."
                    )
                    raise RuntimeError(msg)

                _pool = ConnectionPool(
                    conninfo=dsn,
                    open=True,
                    min_size=1,
                    max_size=10,
                    timeout=5,
                )
    return _pool


@contextmanager
def get_connection() -> Iterator[Connection]:
    """Получение соединения из пула с автоматическим возвратом."""

    pool = _get_pool()
    with pool.connection() as conn:
        yield conn


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None
