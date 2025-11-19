from __future__ import annotations

from functools import cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Конфигурация приложения с валидацией переменных окружения."""

    db_dsn: str | None = Field(None, env="DB_DSN")
    allowed_origins: str = Field("*", env="ALLOWED_ORIGINS")

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False)

    @field_validator("db_dsn")
    @classmethod
    def validate_dsn(cls, value: str | None) -> str | None:  # noqa: D417
        if value is None:
            return None

        value = value.strip()
        if not value:
            return None
        if "//" not in value:
            msg = "DB_DSN должен быть полноценной строкой подключения"
            raise ValueError(msg)
        
        # Добавляем параметры SSL по умолчанию, если их нет
        if "sslmode" not in value:
            separator = "&" if "?" in value else "?"
            value = f"{value}{separator}sslmode=disable"
        
        return value

    @property
    def allowed_origins_list(self) -> list[str]:
        raw = self.allowed_origins.strip()
        if raw == "*":
            return ["*"]
        return [origin.strip() for origin in raw.split(",") if origin.strip()]


@cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
