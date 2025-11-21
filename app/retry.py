from __future__ import annotations

import asyncio
import functools
import logging
import time
from typing import Any, Callable, TypeVar

from psycopg2 import InterfaceError, OperationalError

T = TypeVar("T")

logger = logging.getLogger(__name__)


def db_retry(
    *,
    retries: int = 1,
    delay_sec: float = 0.7,
    backoff: float = 1.0,
    exceptions: tuple[type[Exception], ...] = (OperationalError, InterfaceError),
    label: str | None = None,
    logger_: logging.Logger | None = None,
) -> Callable[[Callable[..., T]], Callable[..., T]]:
    """Декоратор для повторных попыток выполнения операций с БД.

    Typical usage:
        @db_retry(retries=2, delay_sec=1.0)
        def load_data(...):
            with get_connection() as conn:
                ...

    Параметры:
        retries: количество дополнительных попыток (не включая первую).
        delay_sec: базовая задержка перед повторной попыткой.
        backoff: множитель задержки (если >1.0, задержка растёт экспоненциально).
        exceptions: кортеж исключений, при которых выполняется повтор.
        label: метка операции для логов (по умолчанию имя функции).
        logger_: кастомный логгер (если None используется модульный).
    Возвращает:
        Обёрнутую функцию с логикой повторных попыток.
    """

    log = logger_ or logger

    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        is_async = asyncio.iscoroutinefunction(func)

        def _log_retry(attempt: int, current_delay: float, total: int, exc: Exception) -> None:
            log.warning(
                "Ошибка при выполнении %s, повтор через %.2f с (попытка %d/%d): %s",
                label or func.__name__,
                current_delay,
                attempt,
                total,
                exc,
                exc_info=False,
            )

        if is_async:
            @functools.wraps(func)
            async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
                attempt = 0
                current_delay = delay_sec
                total_attempts = retries + 1
                while True:
                    try:
                        return await func(*args, **kwargs)
                    except exceptions as exc:  # noqa: BLE001
                        if attempt >= retries:
                            raise
                        attempt += 1
                        _log_retry(attempt, current_delay, total_attempts, exc)
                        await asyncio.sleep(current_delay)
                        current_delay *= backoff if backoff > 1.0 else current_delay

            return async_wrapper  # type: ignore[return-value]

        @functools.wraps(func)
        def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
            attempt = 0
            current_delay = delay_sec
            total_attempts = retries + 1
            while True:
                try:
                    return func(*args, **kwargs)
                except exceptions as exc:  # noqa: BLE001
                    if attempt >= retries:
                        raise
                    attempt += 1
                    _log_retry(attempt, current_delay, total_attempts, exc)
                    time.sleep(current_delay)
                    current_delay *= backoff if backoff > 1.0 else current_delay

        return sync_wrapper  # type: ignore[return-value]

    return decorator


__all__ = ["db_retry"]
