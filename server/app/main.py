import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from server.app.api.routes.assistant import router as assistant_router
from server.app.api.routes.audit import router as audit_router
from server.app.api.routes.auth import router as auth_router
from server.app.api.routes.cameras import router as cameras_router
from server.app.api.routes.devices import router as devices_router
from server.app.api.routes.family import router as family_router
from server.app.api.routes.health import router as health_router
from server.app.api.routes.protected_test import router as test_router
from server.app.core.config import BASE_DIR, settings
from server.app.core.database import Base, engine, init_sqlite_wal, check_and_migrate_db
from server.app.core.logging_config import setup_rotating_logging
from server.app.core.mqtt_auth import ensure_mosquitto_config
from server.app.core.mqtt_client import mqtt_service
from server.app.models.audit import AuditLog
from server.app.models.automation import Automation, NotificationLog
from server.app.models.camera import Camera, AIWorkerHeartbeat, DetectedItemLog, MotionClip  # noqa
from server.app.models.device import Channel, Device, TelemetryLog


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 0. Inisialisasi rotasi log otomatis (RotatingFileHandler max 10MB)
    setup_rotating_logging()

    # 1. Inisialisasi pragmas SQLite WAL
    await init_sqlite_wal()

    # 2. Buat tabel database jika belum ada & migrasi kolom baru
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await check_and_migrate_db()


    # 3. Konfigurasi awal file Mosquitto
    try:
        ensure_mosquitto_config()
    except Exception as e:
        print(f"[Mosquitto] Init config warning: {e}")

    # 4. Mulai background worker MQTT client
    loop = asyncio.get_running_loop()
    try:
        mqtt_service.start(loop)
    except Exception as e:
        print(f"[MQTT] Service start warning: {e}")

    yield

    # Shutdown
    mqtt_service.stop()


app = FastAPI(
    title="Nexa Home — Smart Home API",
    description="Backend API inti untuk sistem Nexa Home & Pengawasan Keluarga",
    version="0.2.0",
    lifespan=lifespan,
)

from fastapi.middleware.gzip import GZipMiddleware

# GZip middleware untuk kompresi payload JSON & static assets (>500 bytes)
app.add_middleware(GZipMiddleware, minimum_size=500)

# CORS middleware ketat (whitelist domain publik dan origin dev lokal)
ALLOWED_ORIGINS = [
    "https://aujasena.my.id",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    """Pasang header keamanan HTTP standar industri (Tahap 7 Security Hardening)."""
    response = await call_next(request)

    # 1. Anti MIME-sniffing
    response.headers["X-Content-Type-Options"] = "nosniff"

    # 2. Anti Clickjacking
    response.headers["X-Frame-Options"] = "DENY"

    # 3. Kebijakan Referrer
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

    # 4. HSTS (Strict-Transport-Security)
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

    # 5. XSS Protection
    response.headers["X-XSS-Protection"] = "1; mode=block"

    # 6. Permissions Policy
    response.headers["Permissions-Policy"] = "microphone=(self), camera=(self)"

    # 7. Content-Security-Policy (Kompatibel dengan aujasena.my.id, Google OAuth, WebRTC & WebSockets)
    csp_directives = [
        "default-src 'self' https://aujasena.my.id",
        "script-src 'self' 'unsafe-inline' https://accounts.google.com https://apis.google.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' data: https://fonts.gstatic.com",
        "img-src 'self' data: blob: https://lh3.googleusercontent.com https://*.googleusercontent.com",
        "media-src 'self' blob: data: http://127.0.0.1:8889 https://aujasena.my.id",
        "connect-src 'self' https://aujasena.my.id wss://aujasena.my.id ws://localhost:8000 wss://localhost:8000 http://localhost:8000 http://127.0.0.1:8000 http://127.0.0.1:8889 https://accounts.google.com https://oauth2.googleapis.com",
        "frame-src 'self' https://accounts.google.com",
        "object-src 'none'",
        "base-uri 'self'",
    ]
    response.headers["Content-Security-Policy"] = "; ".join(csp_directives)

    return response

# API routes
app.include_router(health_router, prefix="/api")
app.include_router(auth_router, prefix="/api")
app.include_router(devices_router, prefix="/api")
app.include_router(cameras_router, prefix="/api")
app.include_router(audit_router, prefix="/api")
app.include_router(assistant_router, prefix="/api")
app.include_router(family_router, prefix="/api")
app.include_router(test_router, prefix="/api")


from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

WEB_DIST_DIR = BASE_DIR / "web" / "dist"


class CachedStaticFiles(StaticFiles):
    """StaticFiles dengan Cache-Control immutable untuk hashed bundles."""
    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


if (WEB_DIST_DIR / "assets").exists():
    app.mount("/assets", CachedStaticFiles(directory=str(WEB_DIST_DIR / "assets")), name="web_assets")

if (WEB_DIST_DIR / "fonts").exists():
    app.mount("/fonts", CachedStaticFiles(directory=str(WEB_DIST_DIR / "fonts")), name="web_fonts")


@app.get("/")
async def root(request: Request):
    accept = request.headers.get("accept", "")
    if "text/html" in accept and (WEB_DIST_DIR / "index.html").exists():
        response = FileResponse(WEB_DIST_DIR / "index.html")
        response.headers["Cache-Control"] = "no-cache"
        return response
    return {
        "name": "Nexa Home Backend",
        "status": "online",
        "version": "0.2.0",
        "docs": "/docs",
        "health": "/api/health",
        "setup_status": "/api/auth/setup-status",
    }


@app.get("/{full_path:path}")
async def serve_spa_or_root(full_path: str):
    # Jangan cegat path API atau docs
    if full_path.startswith("api/") or full_path.startswith("docs") or full_path.startswith("openapi.json"):
        return {"error": "Not Found"}

    if (WEB_DIST_DIR / "index.html").exists():
        target_file = WEB_DIST_DIR / full_path
        if full_path and target_file.is_file():
            response = FileResponse(target_file)
            if "assets/" in full_path or full_path.endswith((".js", ".css", ".woff2", ".woff")):
                response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            return response
        response = FileResponse(WEB_DIST_DIR / "index.html")
        response.headers["Cache-Control"] = "no-cache"
        return response

    return {"error": "Not Found"}

