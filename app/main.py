from __future__ import annotations
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import settings
from .db import close_pool
from .routers import dashboard


NO_CACHE_HEADERS = {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
}


def _apply_no_cache(response):
    response.headers.update(NO_CACHE_HEADERS)


class NoCacheStaticFiles(StaticFiles):
    """StaticFiles, принуждающий браузер всегда запрашивать свежие ассеты."""

    async def get_response(self, path, scope):  # noqa: WPS110 - переопределение API Starlette
        response = await super().get_response(path, scope)
        if response.status_code < 400:
            _apply_no_cache(response)
        return response


def create_app() -> FastAPI:
    app = FastAPI(title="SKPDI Dashboard API")

    allow_all_origins = "*" in settings.allowed_origins_list
    allow_origins = ["*"] if allow_all_origins else settings.allowed_origins_list

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allow_origins,
        allow_credentials=not allow_all_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def disable_cache_for_html(request: Request, call_next):
        response = await call_next(request)
        content_type = response.headers.get("content-type", "")

        # Чтобы новый фронтенд загружался сразу после деплоя,
        # отключаем кеширование HTML-оболочки (она содержит ссылки на свежие ассеты).
        if content_type.startswith("text/html") and "cache-control" not in response.headers:
            _apply_no_cache(response)

        return response

    app.include_router(dashboard.router, prefix="/api")

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    static_root = Path(__file__).resolve().parent.parent / "docs"
    app.mount(
        "/",
        NoCacheStaticFiles(directory=str(static_root), html=True),
        name="frontend",
    )

    @app.on_event("shutdown")
    async def _shutdown() -> None:  # noqa: WPS430 - FastAPI hook
        close_pool()

    return app


app = create_app()
