from __future__ import annotations

from contextlib import AbstractContextManager, contextmanager
from functools import wraps
import logging
import time
from threading import Lock
from typing import Callable, Iterator, Protocol, TypeVar

from psycopg2 import InterfaceError, OperationalError, connect
from psycopg2.extensions import connection as PGConnection
from psycopg2.pool import ThreadedConnectionPool

from .config import get_settings

logger = logging.getLogger(__name__)

T = TypeVar("T")


DB_RETRYABLE_ERRORS = (OperationalError, InterfaceError)
DB_RETRY_DELAY_SEC = 0.7


def retry_db_operation(
    *,
    retries: int = 1,
    delay_sec: float = DB_RETRY_DELAY_SEC,
    label: str = "database operation",
):
    """Декоратор для повторного выполнения операции при ошибках БД."""

    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @wraps(func)
        def wrapper(*args, **kwargs):
            attempt = 0
            while True:
                try:
                    return func(*args, **kwargs)
                except DB_RETRYABLE_ERRORS:
                    if attempt >= retries:
                        raise
                    attempt += 1
                    logger.warning(
                        "Ошибка при выполнении %s, повтор через %.1f с (попытка %d/%d)",
                        label,
                        delay_sec,
                        attempt,
                        retries + 1,
                        exc_info=False,
                    )
                    time.sleep(delay_sec)

        return wrapper

    return decorator


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
            error_msg = str(exc).lower()
            if "ssl" in error_msg or "certificate" in error_msg or "tls" in error_msg:
                logger.error(
                    "SSL/TLS ошибка соединения с БД. DB_DSN уже содержит sslmode=disable. "
                    "Проверьте состояние сетевого соединения и доступность БД, а также правильность хоста и портов. Ошибка: %s",
                    exc,
                )
            else:
                logger.error(
                    "Ошибка проверки соединения с БД: %s",
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

                logger.info(
                    "Инициализация пула соединений с БД (с параметром sslmode)"
                )
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
