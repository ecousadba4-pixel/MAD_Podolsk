from contextlib import contextmanager
from threading import Lock
from typing import Iterator, Optional

import psycopg2
from psycopg2.pool import SimpleConnectionPool
from psycopg2.extensions import connection as PgConnection

from .config import DB_DSN

_pool: Optional[SimpleConnectionPool] = None
_pool_lock = Lock()


def _get_pool() -> SimpleConnectionPool:
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                _pool = SimpleConnectionPool(1, 10, dsn=DB_DSN)
    return _pool


@contextmanager
def get_connection() -> Iterator[PgConnection]:
    """Получение соединения из пула с автоматическим возвратом."""

    pool = _get_pool()
    conn = pool.getconn()
    try:
        yield conn
    finally:
        pool.putconn(conn)
