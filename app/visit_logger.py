from __future__ import annotations

import logging
from typing import Any, Iterable

from fastapi import Request
from pydantic import BaseModel, Field, field_validator
from psycopg2 import IntegrityError

from .db import get_connection

logger = logging.getLogger(__name__)

_unique_index_created = False

CREATE_UNIQUE_SESSION_INDEX_SQL = """
    CREATE UNIQUE INDEX IF NOT EXISTS dashboard_visits_user_session_uidx
        ON dashboard_visits (user_id, session_id);
"""

UPSERT_VISIT_SQL = """
    INSERT INTO dashboard_visits (
        endpoint,
        client_ip,
        user_agent,
        user_id,
        session_id,
        session_duration_sec,
        device_type,
        browser,
        os
    )
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
    ON CONFLICT (user_id, session_id) DO UPDATE
        SET visited_at = CURRENT_TIMESTAMP,
            endpoint = EXCLUDED.endpoint,
            client_ip = EXCLUDED.client_ip,
            user_agent = EXCLUDED.user_agent,
            session_duration_sec = COALESCE(
                GREATEST(
                    dashboard_visits.session_duration_sec,
                    EXCLUDED.session_duration_sec
                ),
                EXCLUDED.session_duration_sec,
                dashboard_visits.session_duration_sec
            ),
            device_type = EXCLUDED.device_type,
            browser = EXCLUDED.browser,
            os = EXCLUDED.os;
"""


class VisitLogRequest(BaseModel):
    """Данные, которые фронтенд должен передать для фиксирования визита."""

    endpoint: str = Field(default="/dashboard", description="Страница, которую открыл пользователь")
    user_id: str | None = Field(
        default=None,
        description="Анонимный идентификатор пользователя из localStorage/cookie",
    )
    session_id: str | None = Field(
        default=None,
        description="Идентификатор сессии без персональных данных (UUID v4)",
    )
    session_duration_sec: int | None = Field(
        default=None,
        ge=0,
        description="Длительность сессии на клиенте в секундах",
    )

    @field_validator("endpoint")
    @classmethod
    def ensure_starts_with_slash(cls, value: str) -> str:
        return value if value.startswith("/") else f"/{value}"


def _get_client_ip(request: Request) -> str | None:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        first_ip = forwarded_for.split(",")[0].strip()
        if first_ip:
            return first_ip
    client = request.client
    if client:
        return client.host
    return None


def _get_user_id(request: Request) -> str | None:
    """Возвращает анонимный постоянный идентификатор пользователя.

    Ожидается, что фронтенд сохраняет его в localStorage/cookie и прокидывает в
    заголовке `X-User-Id` или cookie `user_id`.
    """

    user_id = request.headers.get("x-user-id") or request.cookies.get("user_id")
    if user_id:
        return user_id.strip() or None
    return None


def _get_session_id(request: Request) -> str | None:
    """Возвращает идентификатор сессии (UUID v4 без персональных данных)."""

    session_id = request.headers.get("x-session-id") or request.cookies.get(
        "session_id"
    )
    if session_id:
        return session_id.strip() or None
    return None


def _get_session_duration(request: Request) -> int | None:
    """Пытается извлечь длительность сессии в секундах из заголовка."""

    duration_raw = request.headers.get("x-session-duration-sec")
    if not duration_raw:
        return None
    try:
        duration = int(duration_raw)
    except (TypeError, ValueError):
        return None
    return duration if duration >= 0 else None


def _parse_user_agent(user_agent: str | None) -> tuple[str | None, str | None, str | None]:
    """Грубый парсер User-Agent для определения устройства, браузера и ОС."""

    if not user_agent:
        return None, None, None

    ua_lower = user_agent.lower()

    device_type: str | None
    if "mobi" in ua_lower or "android" in ua_lower or "iphone" in ua_lower:
        device_type = "mobile"
    else:
        device_type = "desktop"

    browser: str | None = None
    if "edg" in ua_lower:
        browser = "edge"
    elif "chrome" in ua_lower and "edg" not in ua_lower and "chromium" not in ua_lower:
        browser = "chrome"
    elif "safari" in ua_lower and "chrome" not in ua_lower:
        browser = "safari"
    elif "firefox" in ua_lower:
        browser = "firefox"
    elif "opr" in ua_lower or "opera" in ua_lower:
        browser = "opera"
    elif "trident" in ua_lower or "msie" in ua_lower:
        browser = "ie"

    os: str | None = None
    if "windows" in ua_lower:
        os = "windows"
    elif "android" in ua_lower:
        os = "android"
    elif "iphone" in ua_lower or "ipad" in ua_lower or "ios" in ua_lower:
        os = "ios"
    elif "mac os x" in ua_lower or "macintosh" in ua_lower:
        os = "macos"
    elif "linux" in ua_lower:
        os = "linux"

    return device_type, browser, os


def _ensure_unique_index(cur) -> None:
    global _unique_index_created
    if _unique_index_created:
        return

    try:
        cur.execute(CREATE_UNIQUE_SESSION_INDEX_SQL)
    except Exception as exc:  # pragma: no cover - защита от неожиданных ошибок
        logger.warning(
            "Не удалось создать уникальный индекс по user_id и session_id: %s", exc
        )
    else:
        _unique_index_created = True


def log_dashboard_visit(
    *,
    request: Request,
    endpoint: str,
    user_id: str | None = None,
    session_id: str | None = None,
    session_duration_sec: int | None = None,
) -> None:
    """Фиксирует посещение дашборда в базе данных.
    
    Асинхронные ошибки БД игнорируются чтобы не повлиять на основной запрос.
    """

    client_ip = _get_client_ip(request)
    user_agent = request.headers.get("user-agent")
    user_id = user_id or _get_user_id(request)
    session_id = session_id or _get_session_id(request)
    session_duration = (
        session_duration_sec
        if session_duration_sec is not None
        else _get_session_duration(request)
    )
    device_type, browser, os = _parse_user_agent(user_agent)

    values: Iterable[Any] = (
        endpoint,
        client_ip,
        user_agent,
        user_id,
        session_id,
        session_duration,
        device_type,
        browser,
        os,
    )

    try:
        with get_connection() as conn, conn.cursor() as cur:
            _ensure_unique_index(cur)
            cur.execute(UPSERT_VISIT_SQL, values)
            conn.commit()
    except IntegrityError as exc:
        logger.debug(
            "Duplicate visit record для %s (user_id=%s, session_id=%s): %s. Это нормально.",
            endpoint,
            user_id,
            session_id,
            exc,
        )
        try:
            conn.rollback()
        except Exception:
            pass
    except Exception as exc:  # pragma: no cover - запись не должна падать приложение
        logger.warning(
            "Не удалось записать посещение дашборда: %s", exc, exc_info=True
        )
