"""Initialize the SQLite database (create tables)."""

from __future__ import annotations

from app.db.session import init_db


def main() -> None:
    init_db()
    print("Database initialized.")


if __name__ == "__main__":
    main()
