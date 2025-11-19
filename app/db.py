from __future__ import annotations

from contextlib import AbstractContextManager, contextmanager
import logging
from threading import Lock
from typing import Iterator, Protocol

from psycopg2 import OperationalError, connect
from psycopg2.extensions import connection as PGConnection
from psycopg2.pool import ThreadedConnectionPool

from .config import get_settings

logger = logging.getLogger(__name__)


class _ConnectionProvider(Protocol):
    def connection(self) -> AbstractContextManager[PGConnection]:
        """Возвращает контекстный менеджер с подключением."""

    def close(self) -> None:
        """Закрывает ресурсы провайдера."""


class _ThreadSafeConnectionPool:
    """Обёртка над ThreadedConnectionPool с безопасным контекстом."""

    def __init__(self, conninfo: str, *, min_size: int = 1, max_size: int = 10) -> None:
        self._pool = ThreadedConnectionPool(minconn=min_size, maxconn=max_size, dsn=conninfo)

    def _get_valid_connection(self) -> PGConnection:
        conn = self._pool.getconn()
        try:
            self._ensure_connection_alive(conn)
        except Exception as exc:
            logger.error(
                "Ошибка при проверке соединения с БД, закрываю и возвращаю в пул: %s",
                exc,
                exc_info=True,
            )
            self._pool.putconn(conn, close=True)

            logger.info("Пробую получить новое соединение после ошибки проверки.")
            conn = self._pool.getconn()
            try:
                self._ensure_connection_alive(conn)
            except Exception:
                self._pool.putconn(conn, close=True)
                raise
        return conn

    @staticmethod
    def _ensure_connection_alive(conn: PGConnection) -> None:
        if conn.closed:
            msg = "Соединение с базой данных закрыто"
            raise OperationalError(msg)

        if not conn.autocommit:
            conn.rollback()

        try:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
        except OperationalError as exc:
            if "SSL" in str(exc):
                logger.error(
                    "SSL ошибка соединения с БД. Убедитесь, что DB_DSN содержит корректные SSL параметры. "
                    "Рекомендуется добавить '?sslmode=disable' если SSL не требуется. Ошибка: %s",
                    exc,
                )
            raise

    @contextmanager
    def connection(self) -> Iterator[PGConnection]:
        conn = self._get_valid_connection()
        try:
            yield conn
        except Exception as exc:
            logger.warning(
                "Ошибка при использовании соединения из пула, закрываю соединение: %s",
                exc,
                exc_info=False,
            )
            self._pool.putconn(conn, close=True)
            raise
        else:
            self._pool.putconn(conn)

    def close(self) -> None:
        self._pool.closeall()


class _DirectConnectionProvider:
    """Запасной вариант без пула (последовательные подключения)."""

    def __init__(self, conninfo: str) -> None:
        self._conninfo = conninfo

    @contextmanager
    def connection(self) -> Iterator[PGConnection]:
        conn = connect(self._conninfo)
        try:
            yield conn
        finally:
            conn.close()

    def close(self) -> None:  # pragma: no cover - нечего закрывать
        return None


_pool: _ConnectionProvider | None = None
_pool_lock = Lock()


def _create_pool(dsn: str) -> _ConnectionProvider:
    try:
        return _ThreadSafeConnectionPool(conninfo=dsn)
    except Exception as exc:  # pragma: no cover - защита от неожиданных ошибок
        logger.error(
            "Не удалось создать ThreadedConnectionPool: %s. Переключаюсь на последовательные подключения.",
            exc,
            exc_info=True,
        )
        return _DirectConnectionProvider(conninfo=dsn)


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
def get_connection() -> Iterator[PGConnection]:
    """Получение соединения из пула с автоматическим возвратом."""

    pool = _get_pool()
    with pool.connection() as conn:
        yield conn


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None
