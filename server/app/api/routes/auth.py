import asyncio
import datetime
import json
import logging
import os
import random
import sqlite3
import sys
import time
from collections import defaultdict
from typing import Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger("server.auth")

from server.app.api.deps import get_current_user, record_audit_log, require_role
from server.app.core.config import settings
from server.app.core.database import get_db
from server.app.core.email_service import email_service
from server.app.core.google_auth import google_auth_service
from server.app.core.security import (
    create_access_token,
    create_refresh_token_string,
    create_temp_token,
    decode_token,
    generate_recovery_codes,
    generate_totp_secret,
    get_totp_uri,
    hash_code,
    hash_password,
    verify_password,
    verify_recovery_code,
    verify_totp,
)
from server.app.core.setup_manager import (
    has_proxy_headers,
    init_setup_code_if_needed,
    is_lan_or_localhost,
    verify_and_consume_setup_code,
)
from server.app.models.automation import NotificationLog
from server.app.models.family import FamilyInvitation
from server.app.models.user import InviteCode, OtpCode, RefreshToken, User

router = APIRouter(prefix="/auth", tags=["auth"])

# --- In-Memory Rate Limiter untuk Pengiriman Email OTP / QR (Max 3x per 15 Menit) ---
_otp_rate_history: dict[str, list[float]] = defaultdict(list)

# --- In-Memory Rate Limiter Login Berbasis IP (Max 10 kegagalan per 60 Detik) ---
_login_fail_history: dict[str, list[float]] = defaultdict(list)


def check_otp_rate_limit(key: str, max_requests: int = 3, window_seconds: int = 900) -> bool:
    now = time.time()
    valid_window = [t for t in _otp_rate_history[key] if now - t < window_seconds]
    if len(valid_window) >= max_requests:
        return False
    valid_window.append(now)
    _otp_rate_history[key] = valid_window
    return True


def check_login_ip_rate_limit(client_ip: str, max_requests: int = 10, window_seconds: int = 60) -> bool:
    now = time.time()
    valid_window = [t for t in _login_fail_history[client_ip] if now - t < window_seconds]
    _login_fail_history[client_ip] = valid_window
    return len(valid_window) < max_requests


def record_login_ip_failure(client_ip: str):
    _login_fail_history[client_ip].append(time.time())


# --- Pydantic Schemas ---
class SetupAdminRequest(BaseModel):
    setup_code: str = Field(..., description="Kode sekali pakai dari konsol server")
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=8, max_length=128)


class LoginRequest(BaseModel):
    username: str = Field(..., description="Username atau alamat Email")
    password: str


class RegisterRequest(BaseModel):
    full_name: Optional[str] = Field(None, max_length=100)
    username: str = Field(..., min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9_\-]+$")
    email: str = Field(..., min_length=5, max_length=100)
    password: str = Field(..., min_length=6, max_length=128)
    invite_code: Optional[str] = None


class GoogleAuthRequest(BaseModel):
    id_token: Optional[str] = None
    code: Optional[str] = None
    access_token: Optional[str] = None
    redirect_uri: Optional[str] = None
    invite_code: Optional[str] = None


class LinkGoogleRequest(BaseModel):
    id_token: Optional[str] = None
    code: Optional[str] = None
    access_token: Optional[str] = None
    redirect_uri: Optional[str] = None


class ForgotPasswordRequest(BaseModel):
    email: str = Field(..., min_length=5, max_length=100)


class ResetPasswordRequest(BaseModel):
    email: str = Field(..., min_length=5, max_length=100)
    otp: Optional[str] = None
    otp_code: Optional[str] = None
    new_password: str = Field(..., min_length=6, max_length=128)

    @property
    def valid_otp(self) -> str:
        return (self.otp or self.otp_code or "").strip()


class SendQrEmailRequest(BaseModel):
    device_id: str
    claim_token: Optional[str] = None
    claim_code: Optional[str] = None
    pairing_code: Optional[str] = None

    @property
    def token(self) -> str:
        return (self.claim_token or self.claim_code or "").strip()


class RedeemInviteRequest(BaseModel):
    invite_code: str = Field(..., min_length=4, max_length=32)


class SetPasswordRequest(BaseModel):
    new_password: str = Field(..., min_length=6, max_length=128)
    old_password: Optional[str] = None


class CreateInviteCodeRequest(BaseModel):
    role: Literal["anggota", "member", "child"] = "anggota"
    expires_in_hours: Optional[int] = 48


class Verify2FARequest(BaseModel):
    temp_token: str
    code: str = Field(..., description="6 digit TOTP atau recovery code")


class RefreshRequest(BaseModel):
    refresh_token: Optional[str] = Field(None, description="Opsional jika menggunakan httpOnly cookie")


class CreateUserRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=6, max_length=128)
    role: Literal["anggota", "member", "child", "biasa"] = "anggota"


def _is_cookie_secure(request: Optional[Request] = None) -> bool:
    """Tentukan apakah cookie refresh token harus memiliki flag secure."""
    is_testing = "pytest" in sys.modules or os.environ.get("APP_ENV") == "test" or os.environ.get("TESTING") == "true"
    if is_testing:
        return False
    env = (settings.APP_ENV or "development").strip().lower()
    if env in ("development", "test"):
        return False
    if request:
        proto = request.headers.get("x-forwarded-proto", "").lower()
        if proto == "http" and request.url.scheme == "http":
            return False
    return True


async def _create_user_session(
    user: User,
    response: Response,
    db: AsyncSession,
    client_ip: str,
    action: str = "auth.login_success",
    extra_audit: Optional[dict] = None,
    user_agent: str = "Browser / Client Nexa Home",
    request: Optional[Request] = None,
) -> dict:
    access_token = create_access_token(user.id, user.username, user.role)
    refresh_token = create_refresh_token_string()
    refresh_hash = hash_code(refresh_token)

    db_rt = RefreshToken(
        user_id=user.id,
        token_hash=refresh_hash,
        expires_at=datetime.datetime.utcnow() + datetime.timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )
    db.add(db_rt)

    # Reset kegagalan login & kunci akun setelah berhasil masuk
    user.failed_login_attempts = 0
    user.locked_until = None

    # Deteksi login baru (IP berubah atau pertama kali login)
    is_new_login = (user.last_login_at is None) or (user.last_login_ip != client_ip)
    if is_new_login:
        try:
            notif = NotificationLog(
                event_type="auth_login_new",
                message=f"Login baru terdeteksi untuk akun '{user.username}' dari IP {client_ip}.",
                severity="info",
            )
            db.add(notif)
        except Exception as notif_err:
            logger.warning(f"[Auth] Could not create login notification: {notif_err}")

        if user.email and getattr(user, "email_verified", False):
            try:
                asyncio.create_task(
                    email_service.send_login_alert_email(
                        to_email=user.email,
                        username=user.username,
                        ip_address=client_ip,
                        user_agent=user_agent,
                    )
                )
            except Exception:
                pass

    user.last_login_at = datetime.datetime.utcnow()
    user.last_login_ip = client_ip

    try:
        await db.commit()
    except (sqlite3.OperationalError, SQLAlchemyError) as db_err:
        await db.rollback()
        logger.error(f"[Auth] Database commit failed in _create_user_session for '{user.username}': {db_err}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Gagal menyimpan sesi login karena gangguan database. Silakan coba kembali.",
        )

    details = {"ip": client_ip, "role": user.role}
    if extra_audit:
        details.update(extra_audit)

    try:
        await record_audit_log(
            db=db,
            action=action,
            user_id=user.id,
            username=user.username,
            details=details,
            ip_address=client_ip,
        )
    except Exception as audit_err:
        logger.warning(f"[Auth] Could not record audit log: {audit_err}")

    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        samesite="lax",
        secure=_is_cookie_secure(request),
        path="/api/auth",
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400,
    )

    return {
        "status": "ok",
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "full_name": user.full_name,
            "role": user.role,
            "email_verified": user.email_verified,
            "is_approved": bool(getattr(user, "is_approved", True)),
            "is_google_linked": bool(user.google_id),
        },
    }



# --- Endpoints ---
@router.get("/setup-status")
async def get_setup_status(db: AsyncSession = Depends(get_db)):
    """Check if initial admin setup has been completed."""
    count_query = select(func.count()).select_from(User).where(User.role.in_(["admin", "pemilik"]))
    result = await db.execute(count_query)
    admin_count = result.scalar() or 0

    has_admin = admin_count > 0
    init_setup_code_if_needed(has_admin)

    return {
        "is_setup": has_admin,
        "admin_exists": has_admin,
        "setup_code_required": not has_admin,
    }


@router.post("/setup-admin", status_code=status.HTTP_201_CREATED)
async def setup_admin(
    payload: SetupAdminRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    # 1. Tolak permintaan dari reverse proxy / tunnel
    if has_proxy_headers(dict(request.headers)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Setup wizard tidak dapat diakses melalui reverse proxy atau tunnel.",
        )

    # 2. Validasi IP (hanya localhost atau LAN privat)
    client_ip = request.client.host if request.client else "127.0.0.1"
    if not is_lan_or_localhost(client_ip):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Setup wizard hanya dapat diakses melalui jaringan lokal (LAN) atau localhost.",
        )

    # 3. Cek apakah admin sudah ada
    count_query = select(func.count()).select_from(User).where(User.role == "admin")
    result = await db.execute(count_query)
    if (result.scalar() or 0) > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Sistem telah memiliki admin terdaftar. Setup wizard telah ditutup.",
        )

    # 3. Verifikasi kode sekali pakai
    if not verify_and_consume_setup_code(payload.setup_code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Kode setup tidak valid atau telah digunakan.",
        )

    # 4. Hash password dan buat data TOTP 2FA
    pwd_hash = hash_password(payload.password)
    totp_secret = generate_totp_secret()
    totp_uri = get_totp_uri(totp_secret, payload.username)
    plain_codes, hashed_codes = generate_recovery_codes(8)

    admin_user = User(
        username=payload.username.strip(),
        password_hash=pwd_hash,
        role="admin",
        totp_secret=totp_secret,
        recovery_codes=json.dumps(hashed_codes),
        is_active=True,
    )
    db.add(admin_user)
    await db.commit()
    await db.refresh(admin_user)

    # Catat audit log
    await record_audit_log(
        db=db,
        action="auth.setup_admin",
        user_id=admin_user.id,
        username=admin_user.username,
        target_type="user",
        target_id=str(admin_user.id),
        details={"ip": client_ip, "message": "Inisialisasi akun admin pertama"},
        ip_address=client_ip,
    )

    return {
        "status": "ok",
        "message": "Akun admin berhasil diinisialisasi.",
        "user": {
            "id": admin_user.id,
            "username": admin_user.username,
            "role": admin_user.role,
        },
        "totp_secret": totp_secret,
        "totp_uri": totp_uri,
        "recovery_codes": plain_codes,
    }


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(
    payload: RegisterRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Pendaftaran akun mandiri untuk pengguna baru."""
    client_ip = request.client.host if request.client else "127.0.0.1"
    clean_username = payload.username.strip()
    clean_email = payload.email.strip().lower()

    # Cek username
    check_u = await db.execute(select(User).where(func.lower(User.username) == clean_username.lower()))
    if check_u.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Nama pengguna '{clean_username}' sudah terdaftar.",
        )

    # Cek email
    check_e = await db.execute(select(User).where(func.lower(User.email) == clean_email))
    if check_e.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Alamat email '{clean_email}' sudah digunakan akun lain.",
        )

    # Cek apakah sistem sudah memiliki admin/pemilik
    admin_count = (await db.execute(select(func.count()).select_from(User).where(User.role.in_(["admin", "pemilik"])))).scalar() or 0
    assigned_role = "admin" if admin_count == 0 else "biasa"
    is_approved = True
    user_family_id = None

    # Validasi kode undangan keluarga jika ada
    if payload.invite_code:
        inv_res = await db.execute(
            select(InviteCode).where(
                InviteCode.code == payload.invite_code.strip().upper(),
                InviteCode.is_used == False,
            )
        )
        inv = inv_res.scalar_one_or_none()
        if inv and (inv.expires_at is None or inv.expires_at > datetime.datetime.utcnow()):
            is_approved = True
            assigned_role = inv.role or "member"
            inv.is_used = True
            if inv.created_by_id:
                creator = await db.get(User, inv.created_by_id)
                if creator:
                    user_family_id = creator.family_id or creator.id

    new_user = User(
        username=clean_username,
        email=clean_email,
        full_name=payload.full_name.strip() if payload.full_name else clean_username,
        password_hash=hash_password(payload.password),
        role=assigned_role,
        family_id=user_family_id,
        is_active=True,
        email_verified=False,
        is_approved=is_approved,
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)

    return await _create_user_session(
        user=new_user,
        response=response,
        db=db,
        client_ip=client_ip,
        action="auth.register_success",
        request=request,
    )


@router.post("/login")
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Authenticate user with username or email and password. Returns 2FA challenge for admin."""
    client_ip = request.client.host if request.client else "127.0.0.1"
    user_agent = request.headers.get("user-agent", "Browser / Client Nexa Home")
    ident = (payload.username or "").strip()

    if not ident:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nama pengguna atau email wajib diisi.",
        )

    # 1. Rate Limiting berbasis IP (Max 10 kegagalan per 60 detik)
    if not check_login_ip_rate_limit(client_ip):
        try:
            await record_audit_log(
                db=db,
                action="auth.rate_limited",
                username=payload.username,
                details={"ip": client_ip, "reason": "terlalu_banyak_percobaan_gagal_ip"},
                ip_address=client_ip,
            )
        except Exception as audit_err:
            logger.warning(f"[Auth] Audit log rate_limit warning: {audit_err}")

        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Terlalu banyak percobaan login yang gagal dari IP ini. Silakan tunggu 1 menit sebelum mencoba lagi.",
        )

    try:
        query = select(User).where(
            (func.lower(User.username) == ident.lower()) | (func.lower(User.email) == ident.lower())
        )
        result = await db.execute(query)
        user = result.scalar_one_or_none()
    except (sqlite3.OperationalError, SQLAlchemyError) as db_err:
        logger.error(f"[Auth] Database query error for '{ident}': {db_err}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Layanan database sedang tidak tersedia. Silakan coba sesaat lagi.",
        )
    except Exception as e:
        logger.error(f"[Auth] Unexpected error finding user '{ident}': {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Terjadi kesalahan pada sistem saat memproses login.",
        )

    if not user:
        record_login_ip_failure(client_ip)
        try:
            await record_audit_log(
                db=db,
                action="auth.login_failed",
                username=payload.username,
                details={"ip": client_ip, "reason": "pengguna_tidak_ditemukan"},
                ip_address=client_ip,
            )
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Nama pengguna atau kata sandi tidak sesuai.",
        )

    # 2. Periksa Kunci Akun Sementara (Account Lockout 15 Menit)
    if user.locked_until and user.locked_until > datetime.datetime.utcnow():
        rem_seconds = int((user.locked_until - datetime.datetime.utcnow()).total_seconds())
        rem_minutes = max(1, (rem_seconds + 59) // 60)
        try:
            await record_audit_log(
                db=db,
                action="auth.account_locked_attempt",
                user_id=user.id,
                username=user.username,
                details={"ip": client_ip, "remaining_seconds": rem_seconds},
                ip_address=client_ip,
            )
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Akun ini terkunci sementara karena 5 kali percobaan gagal berturut-turut. Silakan coba lagi dalam {rem_minutes} menit.",
        )

    # 3. Validasi akun yang terdaftar via Google tanpa password hash
    if user.password_hash is None or not str(user.password_hash).strip():
        logger.info(f"[Auth] User '{user.username}' attempted password login without password_hash.")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Akun ini terdaftar via Google. Silakan masuk menggunakan Google atau atur kata sandi melalui Lupa Kata Sandi.",
        )

    # 4. Verifikasi Kata Sandi (Argon2id) secara aman
    try:
        is_pwd_valid = verify_password(payload.password, str(user.password_hash))
    except Exception as argon_err:
        logger.error(f"[Auth] Argon2 verification error for '{ident}': {argon_err}", exc_info=True)
        is_pwd_valid = False

    if not is_pwd_valid:
        record_login_ip_failure(client_ip)
        user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
        lockout_triggered = False

        if user.failed_login_attempts >= 5:
            user.locked_until = datetime.datetime.utcnow() + datetime.timedelta(minutes=15)
            lockout_triggered = True

        try:
            await db.commit()
        except Exception as commit_err:
            logger.error(f"[Auth] Failed to commit failed_login_attempts for '{ident}': {commit_err}")
            await db.rollback()

        if lockout_triggered:
            try:
                await record_audit_log(
                    db=db,
                    action="auth.account_locked",
                    user_id=user.id,
                    username=user.username,
                    details={
                        "ip": client_ip,
                        "reason": "5_kali_gagal_berturut_turut",
                        "locked_until": str(user.locked_until),
                    },
                    ip_address=client_ip,
                )
            except Exception:
                pass
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Akun ini telah dikunci sementara selama 15 menit karena 5 kali salah kata sandi berturut-turut.",
            )

        try:
            await record_audit_log(
                db=db,
                action="auth.login_failed",
                user_id=user.id,
                username=payload.username,
                details={
                    "ip": client_ip,
                    "reason": "kata_sandi_salah",
                    "failed_attempts": user.failed_login_attempts,
                },
                ip_address=client_ip,
            )
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Nama pengguna atau kata sandi tidak sesuai.",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Akun ini telah dinonaktifkan.",
        )

    # Jika memiliki 2FA aktif: wajib selesaikan tantangan 2FA
    if user.totp_secret:
        temp_token = create_temp_token(user.id, user.username)
        return {
            "status": "2fa_required",
            "temp_token": temp_token,
            "message": "Verifikasi 2FA diperlukan.",
        }

    return await _create_user_session(
        user=user,
        response=response,
        db=db,
        client_ip=client_ip,
        action="auth.login_success",
        user_agent=user_agent,
        request=request,
    )


@router.get("/google/url")
async def get_google_auth_url(redirect_uri: Optional[str] = Query(None)):
    """Dapatkan URL consent login Google OAuth2."""
    is_testing = "pytest" in sys.modules or os.environ.get("APP_ENV") == "test" or os.environ.get("TESTING") == "true"
    if not is_testing and (not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Layanan Google OAuth belum dikonfigurasi di server (.env).",
        )
    url = google_auth_service.get_auth_url(redirect_uri)
    return {"status": "ok", "url": url}


@router.post("/google")
async def google_auth(
    payload: GoogleAuthRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Login atau pendaftaran otomatis menggunakan akun Google OAuth2."""
    client_ip = request.client.host if request.client else "127.0.0.1"
    is_testing = "pytest" in sys.modules or os.environ.get("APP_ENV") == "test" or os.environ.get("TESTING") == "true"
    is_mock = bool(payload.id_token and payload.id_token.startswith("mock_google_"))

    if not is_testing and not is_mock and (not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Layanan Google OAuth belum dikonfigurasi di server (.env).",
        )

    try:
        g_info = await google_auth_service.verify_google_credentials(
            id_token=payload.id_token,
            code=payload.code,
            access_token=payload.access_token,
            redirect_uri=payload.redirect_uri,
        )
    except ValueError as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve),
        )
    except Exception as e:
        logger.error(f"[GoogleAuth] Verification error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Verifikasi Google gagal: {e}",
        )

    google_sub = g_info["sub"]
    google_email = g_info["email"].lower()
    google_name = g_info["name"]

    # 1. Cek apakah ada akun yang sudah tertaut dengan google_id ini
    res = await db.execute(select(User).where(User.google_id == google_sub))
    user = res.scalar_one_or_none()

    # 2. Jika belum, cek akun manual dengan email sama -> Auto Account Linking!
    if not user and google_email:
        res_email = await db.execute(select(User).where(func.lower(User.email) == google_email))
        user_by_email = res_email.scalar_one_or_none()
        if user_by_email:
            user = user_by_email
            user.google_id = google_sub
            user.email_verified = True
            user.is_approved = True
            await db.commit()
            await db.refresh(user)

    # 3. Jika belum terdaftar sama sekali -> Auto Register!
    if not user:
        admin_count = (await db.execute(select(func.count()).select_from(User).where(User.role.in_(["admin", "pemilik"])))).scalar() or 0
        assigned_role = "admin" if admin_count == 0 else "biasa"
        user_family_id = None

        if payload.invite_code:
            inv_res = await db.execute(
                select(InviteCode).where(
                    InviteCode.code == payload.invite_code.strip().upper(),
                    InviteCode.is_used == False,
                )
            )
            inv = inv_res.scalar_one_or_none()
            if inv and (inv.expires_at is None or inv.expires_at > datetime.datetime.utcnow()):
                assigned_role = inv.role or "member"
                inv.is_used = True
                if inv.created_by_id:
                    creator = await db.get(User, inv.created_by_id)
                    if creator:
                        user_family_id = creator.family_id or creator.id

        base_uname = google_email.split("@")[0].replace(".", "_")
        check_u = await db.execute(select(User).where(func.lower(User.username) == base_uname.lower()))
        final_uname = base_uname
        if check_u.scalar_one_or_none():
            final_uname = f"{base_uname}_{random.randint(100, 999)}"

        user = User(
            username=final_uname,
            email=google_email,
            full_name=google_name,
            google_id=google_sub,
            email_verified=True,
            password_hash=None,
            role=assigned_role,
            family_id=user_family_id,
            is_active=True,
            is_approved=True,  # Pengguna Google otomatis langsung disetujui (langsung masuk ke dashboard)
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)

    # Jika akun sebelumnya belum disetujui, login dengan Google otomatis mengaktifkannya
    if not user.is_approved:
        user.is_approved = True
        await db.commit()
        await db.refresh(user)

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Akun ini telah dinonaktifkan.",
        )

    user_agent = request.headers.get("user-agent", "Browser / Client Nexa Home")
    return await _create_user_session(
        user=user,
        response=response,
        db=db,
        client_ip=client_ip,
        action="auth.google_login",
        extra_audit={"google_email": google_email},
        user_agent=user_agent,
        request=request,
    )


@router.post("/link-google")
async def link_google(
    payload: LinkGoogleRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Tautkan akun yang sedang aktif ke akun Google."""
    is_testing = "pytest" in sys.modules or os.environ.get("APP_ENV") == "test" or os.environ.get("TESTING") == "true"
    is_mock = bool(payload.id_token and payload.id_token.startswith("mock_google_"))

    if not is_testing and not is_mock and (not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Layanan Google OAuth belum dikonfigurasi di server (.env).",
        )

    try:
        g_info = await google_auth_service.verify_google_credentials(
            id_token=payload.id_token,
            code=payload.code,
            access_token=payload.access_token,
            redirect_uri=payload.redirect_uri,
        )
    except ValueError as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Verifikasi Google gagal: {e}",
        )

    google_sub = g_info["sub"]
    google_email = g_info["email"]

    # Cek apakah google_id ini sudah tertaut di akun pengguna lain
    existing = (await db.execute(select(User).where(User.google_id == google_sub, User.id != current_user.id))).scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Akun Google ini telah ditautkan pada pengguna lain.",
        )

    current_user.google_id = google_sub
    if not current_user.email:
        current_user.email = google_email
    current_user.email_verified = True
    await db.commit()

    return {
        "status": "ok",
        "message": f"Akun Google ({google_email}) berhasil ditautkan.",
        "google_email": google_email,
    }


@router.post("/unlink-google")
async def unlink_google(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Putuskan penautan akun Google."""
    if not current_user.password_hash:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Anda harus mengatur kata sandi manual terlebih dahulu sebelum memutuskan tautan Google.",
        )

    current_user.google_id = None
    await db.commit()
    return {"status": "ok", "message": "Penautan akun Google berhasil diputuskan."}


@router.post("/forgot-password/request")
async def forgot_password_request(
    payload: ForgotPasswordRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Kirim kode OTP 6-digit ke email untuk pemulihan kata sandi."""
    clean_email = payload.email.strip().lower()
    client_ip = request.client.host if request.client else "127.0.0.1"

    # Rate limiting: max 3 per 15 minutes per email/IP
    if not check_otp_rate_limit(f"email:{clean_email}") or not check_otp_rate_limit(f"ip:{client_ip}"):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Terlalu banyak permintaan OTP. Batas maksimal 3 kali per 15 menit. Silakan coba lagi nanti.",
        )

    res = await db.execute(select(User).where(func.lower(User.email) == clean_email))
    user = res.scalar_one_or_none()

    if user:
        otp_code = f"{random.randint(100000, 999999)}"
        otp_entry = OtpCode(
            email=clean_email,
            code=otp_code,
            purpose="password_reset",
            expires_at=datetime.datetime.utcnow() + datetime.timedelta(minutes=15),
            is_used=False,
        )
        db.add(otp_entry)
        await db.commit()

        await email_service.send_otp_email(clean_email, otp_code, purpose="password_reset")

    return {
        "status": "ok",
        "message": "Jika email Anda terdaftar, kode OTP 6-digit telah dikirimkan ke kotak masuk Anda.",
    }


@router.post("/forgot-password/reset")
async def forgot_password_reset(
    payload: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
):
    """Verifikasi OTP dan setel kata sandi baru."""
    clean_email = payload.email.strip().lower()
    clean_otp = payload.valid_otp
    if not clean_otp or len(clean_otp) != 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Format kode OTP harus 6 digit angka.",
        )

    query = select(OtpCode).where(
        func.lower(OtpCode.email) == clean_email,
        OtpCode.code == clean_otp,
        OtpCode.purpose == "password_reset",
        OtpCode.is_used == False,
        OtpCode.expires_at > datetime.datetime.utcnow(),
    )
    otp_record = (await db.execute(query)).scalar_one_or_none()
    if not otp_record:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Kode OTP tidak valid atau telah kedaluwarsa.",
        )

    user_res = await db.execute(select(User).where(func.lower(User.email) == clean_email))
    user = user_res.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pengguna tidak ditemukan.")

    user.password_hash = hash_password(payload.new_password)
    otp_record.is_used = True

    # Cabut semua refresh token lama
    rts = (await db.execute(select(RefreshToken).where(RefreshToken.user_id == user.id))).scalars().all()
    for rt in rts:
        rt.revoked = True

    await db.commit()
    return {"status": "ok", "message": "Kata sandi berhasil diperbarui. Silakan masuk kembali."}


@router.post("/send-qr-email")
async def send_qr_email(
    payload: SendQrEmailRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
):
    """Kirim data pairing dan gambar QR Code perangkat ke email pengguna aktif."""
    if not current_user.email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Akun Anda belum memiliki alamat email tersimpan. Silakan atur email di profil Anda terlebih dahulu.",
        )

    client_ip = request.client.host if request.client else "127.0.0.1"

    # Rate limiting: max 3 per 15 minutes per email/IP
    if not check_otp_rate_limit(f"email:{current_user.email}") or not check_otp_rate_limit(f"ip:{client_ip}"):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Terlalu banyak permintaan kirim QR. Batas maksimal 3 kali per 15 menit.",
        )

    claim_token = payload.token
    if not claim_token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Claim token/code wajib diisi.")

    success = await email_service.send_device_qr_email(
        to_email=current_user.email,
        device_id=payload.device_id,
        claim_token=claim_token,
        pairing_code=payload.pairing_code,
    )
    if not success:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Gagal mengirim email QR Code.")

    return {
        "status": "ok",
        "message": f"QR Code dan kode klaim berhasil dikirimkan ke {current_user.email}.",
    }



@router.post("/verify-2fa")
async def verify_2fa(
    payload: Verify2FARequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Verify TOTP 6-digit code or one-time recovery code."""
    client_ip = request.client.host if request.client else "127.0.0.1"

    try:
        token_data = decode_token(payload.temp_token)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token tantangan 2FA tidak valid atau telah kedaluwarsa.",
        )

    if token_data.get("type") != "2fa_pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tipe token bukan untuk verifikasi 2FA.",
        )

    user_id = int(token_data.get("sub", 0))
    query = select(User).where(User.id == user_id, User.is_active == True)
    result = await db.execute(query)
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Pengguna tidak ditemukan.",
        )

    # 1. Coba verifikasi kode TOTP
    code_clean = payload.code.strip()
    is_valid = verify_totp(user.totp_secret, code_clean)
    used_recovery = False

    # 2. Jika TOTP gagal, coba verifikasi recovery code
    if not is_valid and user.recovery_codes:
        ok, updated_json = verify_recovery_code(code_clean, user.recovery_codes)
        if ok:
            is_valid = True
            used_recovery = True
            user.recovery_codes = updated_json

    if not is_valid:
        await record_audit_log(
            db=db,
            action="auth.2fa_failed",
            user_id=user.id,
            username=user.username,
            details={"ip": client_ip},
            ip_address=client_ip,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Kode 2FA atau kode pemulihan salah.",
        )

    # Berhasil verifikasi 2FA
    user_agent = request.headers.get("user-agent", "Browser / Client Nexa Home")
    session_data = await _create_user_session(
        user=user,
        response=response,
        db=db,
        client_ip=client_ip,
        action="auth.login_2fa_success",
        extra_audit={"used_recovery_code": used_recovery},
        user_agent=user_agent,
    )
    session_data["used_recovery_code"] = used_recovery
    return session_data


@router.post("/refresh")
async def refresh_access_token(
    request: Request,
    response: Response,
    payload: Optional[RefreshRequest] = None,
    db: AsyncSession = Depends(get_db),
):
    """Issue a new access token using a valid refresh token (from body or httpOnly cookie)."""
    token_str = (payload.refresh_token if payload and payload.refresh_token else None) or request.cookies.get("refresh_token")
    if not token_str:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token tidak ditemukan atau tidak disertakan.",
        )

    rt_hash = hash_code(token_str)
    query = (
        select(RefreshToken)
        .where(
            RefreshToken.token_hash == rt_hash,
            RefreshToken.revoked == False,
            RefreshToken.expires_at > datetime.datetime.utcnow(),
        )
    )
    result = await db.execute(query)
    db_rt = result.scalar_one_or_none()

    if not db_rt:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token tidak valid atau telah kedaluwarsa.",
        )

    # Ambil user terkait
    user_query = select(User).where(User.id == db_rt.user_id, User.is_active == True)
    user_res = await db.execute(user_query)
    user = user_res.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Pengguna tidak ditemukan atau tidak aktif.",
        )

    # Rotasi Refresh Token: cabut token lama, buat token baru
    db_rt.revoked = True

    new_refresh_token = create_refresh_token_string()
    new_rt_hash = hash_code(new_refresh_token)
    new_db_rt = RefreshToken(
        user_id=user.id,
        token_hash=new_rt_hash,
        expires_at=datetime.datetime.utcnow() + datetime.timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        revoked=False,
    )
    db.add(new_db_rt)
    await db.commit()

    response.set_cookie(
        key="refresh_token",
        value=new_refresh_token,
        httponly=True,
        samesite="lax",
        secure=_is_cookie_secure(request),
        path="/api/auth",
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400,
    )

    new_access_token = create_access_token(user.id, user.username, user.role)
    return {
        "status": "ok",
        "access_token": new_access_token,
        "refresh_token": new_refresh_token,
        "token_type": "bearer",
    }


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    payload: Optional[RefreshRequest] = None,
    db: AsyncSession = Depends(get_db),
):
    """Logout current user, revoke refresh token, and clear httpOnly cookie."""
    token_str = (payload.refresh_token if payload and payload.refresh_token else None) or request.cookies.get("refresh_token")
    if token_str:
        rt_hash = hash_code(token_str)
        query = select(RefreshToken).where(RefreshToken.token_hash == rt_hash)
        res = await db.execute(query)
        db_rt = res.scalar_one_or_none()
        if db_rt:
            db_rt.revoked = True
            await db.commit()

    response.delete_cookie(key="refresh_token", path="/api/auth")
    return {"status": "ok", "message": "Berhasil keluar."}



@router.get("/me")
async def get_me(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return profile information of current authenticated user."""
    # Sinkronisasi keanggotaan keluarga jika user pernah menerima undangan tapi family_id belum tersimpan
    if not current_user.family_id and current_user.role != "admin":
        user_emails = [current_user.username.lower()]
        if current_user.email:
            user_emails.append(current_user.email.lower())
            user_emails.append(current_user.email.split("@")[0].lower())

        inv_stmt = (
            select(FamilyInvitation)
            .where(
                FamilyInvitation.status == "accepted",
                func.lower(FamilyInvitation.invitee_email).in_(user_emails),
            )
            .order_by(FamilyInvitation.updated_at.desc())
        )
        acc_inv = (await db.execute(inv_stmt)).scalars().first()
        if acc_inv:
            inviter = await db.get(User, acc_inv.inviter_id)
            if inviter:
                if not inviter.family_id:
                    inviter.family_id = inviter.id
                    db.add(inviter)
                current_user.family_id = inviter.family_id
                current_user.role = "member"
                current_user.is_approved = True
                current_user.email_verified = True
                db.add(current_user)
                await db.commit()

    return {
        "id": current_user.id,
        "username": current_user.username,
        "email": current_user.email,
        "full_name": current_user.full_name,
        "role": current_user.role,
        "family_id": current_user.family_id,
        "email_verified": current_user.email_verified,
        "is_approved": bool(getattr(current_user, "is_approved", True)),
        "is_google_linked": bool(current_user.google_id),
        "has_password": bool(current_user.password_hash),
        "created_at": current_user.created_at.isoformat(),
    }


@router.post("/redeem-invite")
async def redeem_invite(
    payload: RedeemInviteRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Gunakan kode undangan keluarga untuk mendapatkan akses persetujuan instan."""
    code_str = payload.invite_code.strip().upper()
    inv_res = await db.execute(select(InviteCode).where(
        InviteCode.code == code_str,
        InviteCode.is_used == False,
    ))
    inv = inv_res.scalar_one_or_none()
    if not inv or (inv.expires_at and inv.expires_at < datetime.datetime.utcnow()):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Kode undangan tidak valid atau telah kedaluwarsa.")

    current_user.role = "member"
    current_user.is_approved = True
    if inv.created_by_id:
        creator = await db.get(User, inv.created_by_id)
        if creator and creator.family_id:
            current_user.family_id = creator.family_id
        elif creator:
            current_user.family_id = creator.id

    inv.is_used = True
    inv.used_by_id = current_user.id
    await db.commit()
    return {"status": "ok", "message": "Kode undangan berhasil digunakan. Anda kini telah bergabung sebagai Anggota Keluarga."}


@router.post("/set-password")
async def set_password(
    payload: SetPasswordRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Atur atau ubah kata sandi manual akun."""
    if current_user.password_hash:
        if not payload.old_password or not verify_password(payload.old_password, current_user.password_hash):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Kata sandi lama tidak sesuai.")
    current_user.password_hash = hash_password(payload.new_password)
    await db.commit()
    return {"status": "ok", "message": "Kata sandi manual berhasil disimpan."}


@router.get("/pending-users")
async def list_pending_users(
    current_admin: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """Daftar pengguna yang masih menunggu persetujuan Admin Rumah (Admin saja)."""
    res = await db.execute(select(User).where(User.is_approved == False))
    users = res.scalars().all()
    return [
        {
            "id": u.id,
            "username": u.username,
            "email": u.email,
            "full_name": u.full_name,
            "role": u.role,
            "is_google_linked": bool(u.google_id),
            "created_at": u.created_at.isoformat(),
        }
        for u in users
    ]


@router.post("/users/{user_id}/approve")
async def approve_user(
    user_id: int,
    current_admin: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """Setujui akun pengguna baru agar dapat mengakses kontrol rumah (Admin saja)."""
    res = await db.execute(select(User).where(User.id == user_id))
    user = res.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pengguna tidak ditemukan.")
    user.is_approved = True
    await db.commit()
    return {"status": "ok", "message": f"Pengguna '{user.username}' berhasil disetujui."}


@router.post("/users/{user_id}/reject")
async def reject_user(
    user_id: int,
    current_admin: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """Tolak atau hapus akun pengguna yang tidak dikenal (Admin saja)."""
    res = await db.execute(select(User).where(User.id == user_id))
    user = res.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pengguna tidak ditemukan.")
    if user.role == "admin":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tidak dapat menolak akun admin.")
    await db.delete(user)
    await db.commit()
    return {"status": "ok", "message": f"Pengguna '{user.username}' telah ditolak/dihapus."}


@router.post("/invite-codes")
async def create_invite_code(
    payload: CreateInviteCodeRequest,
    current_admin: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """Buat kode undangan keluarga baru (Admin saja)."""
    code_str = f"RUMAH-{random.randint(1000, 9999)}"
    expires = datetime.datetime.utcnow() + datetime.timedelta(hours=payload.expires_in_hours or 48)
    inv = InviteCode(
        code=code_str,
        created_by_id=current_admin.id,
        role=payload.role,
        is_used=False,
        expires_at=expires,
    )
    db.add(inv)
    await db.commit()
    await db.refresh(inv)
    return {
        "status": "ok",
        "invite_code": inv.code,
        "role": inv.role,
        "expires_at": inv.expires_at.isoformat(),
    }


@router.get("/invite-codes")
async def list_invite_codes(
    current_admin: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """Daftar kode undangan aktif (Admin saja)."""
    res = await db.execute(select(InviteCode).order_by(InviteCode.id.desc()).limit(50))
    invs = res.scalars().all()
    return [
        {
            "id": inv.id,
            "code": inv.code,
            "role": inv.role,
            "is_used": inv.is_used,
            "expires_at": inv.expires_at.isoformat() if inv.expires_at else None,
            "created_at": inv.created_at.isoformat(),
        }
        for inv in invs
    ]


@router.post("/users", status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: CreateUserRequest,
    current_admin: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """Admin-only endpoint to create family members or child accounts."""
    check_query = select(User).where(User.username == payload.username.strip())
    existing = (await db.execute(check_query)).scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Nama pengguna '{payload.username}' sudah terdaftar.",
        )

    new_user = User(
        username=payload.username.strip(),
        password_hash=hash_password(payload.password),
        role=payload.role,
        family_id=current_admin.family_id or current_admin.id,
        is_active=True,
        is_approved=True,
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)

    await record_audit_log(
        db=db,
        action="user.create",
        user_id=current_admin.id,
        username=current_admin.username,
        target_type="user",
        target_id=str(new_user.id),
        details={"created_user": new_user.username, "role": new_user.role},
    )

    return {
        "status": "ok",
        "user": {
            "id": new_user.id,
            "username": new_user.username,
            "role": new_user.role,
        },
    }
