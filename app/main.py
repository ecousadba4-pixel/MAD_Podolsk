from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import close_pool
from .routers import dashboard


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
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"

        return response

    app.include_router(dashboard.router, prefix="/api")

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.on_event("shutdown")
    async def _shutdown() -> None:  # noqa: WPS430 - FastAPI hook
        close_pool()

    return app


app = create_app()
