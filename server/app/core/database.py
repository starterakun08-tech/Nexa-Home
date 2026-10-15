import logging
from collections.abc import AsyncGenerator
from pathlib import Path
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import declarative_base

from server.app.core.config import BASE_DIR, settings

logger = logging.getLogger("server.database")


def _get_database_url() -> str:
    url = settings.DATABASE_URL
    if "sqlite" in url and "///" in url:
        path_part = url.split("///", 1)[1]
        if path_part and not path_part.startswith(":memory:"):
            db_path = Path(path_part)
            if not db_path.is_absolute():
                # If path starts with ./data or data, resolve to server/data if preferred or project root
                if str(path_part).startswith("./data") or str(path_part).startswith("data"):
                    db_path = BASE_DIR / "server" / path_part.lstrip("./")
                else:
                    db_path = BASE_DIR / db_path
            db_path.parent.mkdir(parents=True, exist_ok=True)
            return f"sqlite+aiosqlite:///{db_path.as_posix()}"
    return url


DB_URL = _get_database_url()

# Engine SQLite async
engine = create_async_engine(
    DB_URL,
    echo=False,
    connect_args={"check_same_thread": False} if "sqlite" in DB_URL else {},
)

# Async session factory
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)
async_session_factory = AsyncSessionLocal

Base = declarative_base()


def import_all_models() -> None:
    """Import all model modules to ensure Base.metadata is fully populated."""
    try:
        import server.app.models.user  # noqa: F401
        import server.app.models.audit  # noqa: F401
        import server.app.models.automation  # noqa: F401
        import server.app.models.device  # noqa: F401
        import server.app.models.camera  # noqa: F401
        import server.app.models.family  # noqa: F401
        import server.app.models.assistant  # noqa: F401
    except Exception as e:
        logger.warning(f"Error importing model modules: {e}")


async def init_sqlite_wal() -> None:
    """Initialize SQLite pragmas (WAL mode, normal synchronous, foreign keys)."""
    if "sqlite" in settings.DATABASE_URL:
        async with engine.begin() as conn:
            await conn.execute(text("PRAGMA journal_mode = WAL;"))
            await conn.execute(text("PRAGMA synchronous = NORMAL;"))
            await conn.execute(text("PRAGMA foreign_keys = ON;"))


async def check_and_migrate_db() -> None:
    """Ensure all tables exist and newly added columns exist in SQLite users table for backward compatibility."""
    import_all_models()
    await init_sqlite_wal()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        if "sqlite" in settings.DATABASE_URL:
            result = await conn.execute(text("PRAGMA table_info(users);"))
            columns = [row[1] for row in result.fetchall()]
            if columns:
                if "email" not in columns:
                    await conn.execute(text("ALTER TABLE users ADD COLUMN email VARCHAR(100);"))
                if "full_name" not in columns:
                    await conn.execute(text("ALTER TABLE users ADD COLUMN full_name VARCHAR(100);"))
                if "google_id" not in columns:
                    await conn.execute(text("ALTER TABLE users ADD COLUMN google_id VARCHAR(100);"))
                if "email_verified" not in columns:
                    await conn.execute(text("ALTER TABLE users ADD COLUMN email_verified BOOLEAN DEFAULT 0 NOT NULL;"))
                if "is_approved" not in columns:
                    await conn.execute(text("ALTER TABLE users ADD COLUMN is_approved BOOLEAN DEFAULT 1 NOT NULL;"))
                if "failed_login_attempts" not in columns:
                    await conn.execute(text("ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER DEFAULT 0 NOT NULL;"))
                if "locked_until" not in columns:
                    await conn.execute(text("ALTER TABLE users ADD COLUMN locked_until DATETIME;"))
                if "last_login_at" not in columns:
                    await conn.execute(text("ALTER TABLE users ADD COLUMN last_login_at DATETIME;"))
                if "last_login_ip" not in columns:
                    await conn.execute(text("ALTER TABLE users ADD COLUMN last_login_ip VARCHAR(50);"))
                if "family_id" not in columns:
                    await conn.execute(text("ALTER TABLE users ADD COLUMN family_id INTEGER;"))

            dev_result = await conn.execute(text("PRAGMA table_info(devices);"))
            dev_columns = [row[1] for row in dev_result.fetchall()]
            if dev_columns:
                if "owner_id" not in dev_columns:
                    await conn.execute(text("ALTER TABLE devices ADD COLUMN owner_id INTEGER;"))

            family_result = await conn.execute(text("PRAGMA table_info(family_settings);"))
            family_columns = [row[1] for row in family_result.fetchall()]
            if family_columns and "hazard_stay_duration_seconds" not in family_columns:
                await conn.execute(
                    text("ALTER TABLE family_settings ADD COLUMN hazard_stay_duration_seconds INTEGER;")
                )


_db_initialized = False


async def ensure_db_ready() -> None:
    """Ensure database schema is ready and migrated."""
    global _db_initialized
    if not _db_initialized:
        try:
            await check_and_migrate_db()
            _db_initialized = True
        except Exception as e:
            logger.error(f"[Database] Error initializing database schema: {e}", exc_info=True)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency injection to provide database session per request."""
    if not _db_initialized:
        await ensure_db_ready()

    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
