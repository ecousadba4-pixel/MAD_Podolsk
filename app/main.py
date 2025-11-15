from __future__ import annotations

from fastapi import FastAPI
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

    app.include_router(dashboard.router, prefix="/api")

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.on_event("shutdown")
    async def _shutdown() -> None:  # noqa: WPS430 - FastAPI hook
        close_pool()

    return app


app = create_app()
