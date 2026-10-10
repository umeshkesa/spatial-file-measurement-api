"""Database engine / session management."""

from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.db.base import Base

_engine = None
_session_factory: sessionmaker | None = None


def _connect_args(url: str) -> dict:
    if url.startswith("sqlite"):
        return {"check_same_thread": False}
    return {}


def get_engine(url: str | None = None):
    """Return a cached engine for the given (or configured) URL."""
    global _engine
    if url is None:
        url = get_settings().database_url
        if _engine is not None:
            return _engine
        _engine = create_engine(url, connect_args=_connect_args(url), future=True)
        return _engine
    return create_engine(url, connect_args=_connect_args(url), future=True)


def get_session_factory(engine=None) -> sessionmaker:
    global _session_factory
    if engine is None:
        engine = get_engine()
        if _session_factory is not None:
            return _session_factory
        _session_factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
        return _session_factory
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def init_db(url: str | None = None) -> None:
    """Create tables if they do not exist (used at startup and in tests)."""
    from app.models import feature_record, file_record  # noqa: F401

    engine = get_engine(url) if url else get_engine()
    Base.metadata.create_all(bind=engine)


def get_db() -> Generator[Session, None, None]:
    factory = get_session_factory()
    session = factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def reset_engine_cache() -> None:
    global _engine, _session_factory
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _session_factory = None
