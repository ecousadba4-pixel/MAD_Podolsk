from __future__ import annotations

from contextlib import AbstractContextManager, contextmanager
import logging
from threading import Lock
from typing import Iterator, Protocol

from psycopg import Connection, connect

try:
    from psycopg_pool import ConnectionPool
except ModuleNotFoundError:  # pragma: no cover - optional dependency
    ConnectionPool = None  # type: ignore[assignment]

from .config import get_settings

logger = logging.getLogger(__name__)


class _ConnectionProvider(Protocol):
    def connection(self) -> AbstractContextManager[Connection]:
        """Возвращает контекстный менеджер с подключением."""

    def close(self) -> None:
        """Закрывает ресурсы провайдера."""


class _SimpleConnectionPool:
    """Fallback-пул на случай отсутствия psycopg_pool."""

    def __init__(self, conninfo: str) -> None:
        self._conninfo = conninfo

    @contextmanager
    def connection(self) -> Iterator[Connection]:
        with connect(self._conninfo) as conn:
            yield conn

    def close(self) -> None:  # pragma: no cover - нечего закрывать
        return None


_pool: _ConnectionProvider | None = None
_pool_lock = Lock()


def _create_pool(dsn: str) -> _ConnectionProvider:
    if ConnectionPool is None:
        logger.warning(
            "psycopg_pool не установлен. Использую последовательные подключения без пула.",
        )
        return _SimpleConnectionPool(conninfo=dsn)

    return ConnectionPool(
        conninfo=dsn,
        open=True,
        min_size=1,
        max_size=10,
        timeout=5,
    )


def _get_pool() -> _ConnectionProvider:
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

                _pool = _create_pool(dsn)
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
