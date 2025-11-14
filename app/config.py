from functools import lru_cache
from typing import List, Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Конфигурация приложения с валидацией переменных окружения."""

    db_dsn: Optional[str] = Field(None, env="DB_DSN")
    allowed_origins: str = Field("*", env="ALLOWED_ORIGINS")

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False)

    @field_validator("db_dsn")
    def validate_dsn(cls, value: Optional[str]) -> Optional[str]:  # noqa: D417
        if value is None:
            return None

        value = value.strip()
        if not value:
            return None
        if "//" not in value:
            raise ValueError("DB_DSN должен быть полноценной строкой подключения")
        return value

    @property
    def allowed_origins_list(self) -> List[str]:
        raw = self.allowed_origins.strip()
        if raw == "*":
            return ["*"]
        return [origin.strip() for origin in raw.split(",") if origin.strip()]

@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

DB_DSN = settings.db_dsn
ALLOWED_ORIGINS = settings.allowed_origins_list
