"""Application error types with stable machine-readable codes."""

from __future__ import annotations


class AppError(Exception):
    """Base application error mapped to a JSON error response."""

    def __init__(self, code: str, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


class InvalidFileError(AppError):
    def __init__(self, message: str) -> None:
        super().__init__("INVALID_FILE", message, 400)


class UnsupportedMediaError(AppError):
    def __init__(self, message: str) -> None:
        super().__init__("UNSUPPORTED_MEDIA_TYPE", message, 415)


class PayloadTooLargeError(AppError):
    def __init__(self, message: str) -> None:
        super().__init__("PAYLOAD_TOO_LARGE", message, 413)


class InvalidGeodataError(AppError):
    def __init__(self, message: str) -> None:
        super().__init__("INVALID_GEODATA", message, 422)


class MissingCrsError(AppError):
    def __init__(self, message: str) -> None:
        super().__init__("MISSING_CRS", message, 422)


class NotFoundError(AppError):
    def __init__(self, message: str) -> None:
        super().__init__("NOT_FOUND", message, 404)
