"""FastAPI application factory."""

from __future__ import annotations

import uuid

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.api.routes import router as files_router
from app.core.config import get_settings
from app.core.exceptions import AppError
from app.core.logging import configure_logging, get_logger, set_request_id
from app.db.session import get_engine, init_db

log = get_logger(__name__)


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)
    init_db()

    app = FastAPI(title=settings.app_name, version=settings.api_version)

    @app.middleware("http")
    async def request_id_middleware(request: Request, call_next):
        rid = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:12]
        set_request_id(rid)
        response = await call_next(request)
        response.headers["X-Request-ID"] = rid
        return response

    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError):
        rid = request.headers.get("X-Request-ID", "-")
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": exc.code, "message": exc.message, "request_id": rid}},
        )

    @app.exception_handler(Exception)
    async def unhandled_handler(request: Request, exc: Exception):
        log.exception("Unhandled error: %s", exc)
        rid = request.headers.get("X-Request-ID", "-")
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "code": "INTERNAL_ERROR",
                    "message": "An unexpected internal error occurred.",
                    "request_id": rid,
                }
            },
        )

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok"}

    @app.get("/ready")
    def ready() -> dict:
        try:
            engine = get_engine()
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return {"status": "ready", "database": "ok"}
        except Exception as exc:
            log.warning("Readiness check failed: %s", exc)
            return JSONResponse(
                status_code=503,
                content={"status": "not_ready", "database": "unreachable"},
            )  # type: ignore[return-value]

    app.include_router(files_router)
    return app


app = create_app()
