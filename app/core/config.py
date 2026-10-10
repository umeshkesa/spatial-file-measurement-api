"""Application configuration loaded from environment variables."""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central application settings."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Spatial File Measurement API"
    api_version: str = "v1"
    database_url: str = "sqlite:///./spatial.db"
    storage_dir: str = "./uploads"
    max_upload_bytes: int = 26_214_400  # 25 MiB
    max_archive_entries: int = 500
    max_extracted_bytes: int = 209_715_200  # 200 MiB
    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()


def reset_settings_cache() -> None:
    get_settings.cache_clear()
