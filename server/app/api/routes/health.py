import time
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from server.app.core.config import settings
from server.app.core.database import get_db

router = APIRouter(tags=["health"])

_SERVER_START_TIME = time.time()


@router.get("/health")
async def health_check(db: AsyncSession = Depends(get_db)):
    """Health check endpoint validating server uptime and SQLite WAL status."""
    db_status = "unknown"
    journal_mode = "unknown"

    try:
        res = await db.execute(text("SELECT 1;"))
        res.scalar()
        db_status = "connected"

        # Cek pragma journal_mode di SQLite
        if "sqlite" in settings.DATABASE_URL:
            jm_res = await db.execute(text("PRAGMA journal_mode;"))
            journal_mode = jm_res.scalar()
    except Exception as e:
        db_status = f"error: {str(e)}"

    uptime_seconds = int(time.time() - _SERVER_START_TIME)

    return {
        "status": "ok",
        "app": "Nexa Home Server",
        "version": "0.1.0",
        "environment": settings.APP_ENV,
        "uptime_seconds": uptime_seconds,
        "database": {
            "status": db_status,
            "journal_mode": journal_mode,
        },
    }
