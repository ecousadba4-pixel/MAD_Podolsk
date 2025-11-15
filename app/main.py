from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import ALLOWED_ORIGINS
from .routers import dashboard

app = FastAPI(title="SKPDI Dashboard API")

# CORS
allow_all_origins = "*" in ALLOWED_ORIGINS

if allow_all_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# Роуты
app.include_router(dashboard.router, prefix="/api")


@app.get("/health")
def health():
    return {"status": "ok"}
