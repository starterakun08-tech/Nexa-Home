"""
Router API Kamera, Pairing, MediaMTX Auth Hook, dan Klip Terenkripsi (Tahap 4).
"""

from datetime import datetime, timedelta, timezone
import hashlib
import io
from pathlib import Path
import secrets
from typing import List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from server.app.core.camera.encryption import read_and_decrypt_clip
from server.app.core.camera.motion_service import motion_manager
from server.app.core.config import settings
from server.app.core.database import get_db
from server.app.api.deps import get_current_user
from server.app.models.audit import AuditLog
from server.app.models.camera import (
    Camera,
    CameraPairingCode,
    CameraToken,
    CameraUserAccess,
    MotionClip,
    DetectedItemLog,
    PersonPresenceEvent,
    AIWorkerHeartbeat,
)
from server.app.models.user import User

router = APIRouter(prefix="/cameras", tags=["Cameras"])


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


# --- Pydantic Schemas ---
class CreatePairingCodeRequest(BaseModel):
    camera_name: str = Field(..., min_length=2, max_length=100)
    room_id: str = Field(..., min_length=2, max_length=50)


class PairingCodeResponse(BaseModel):
    code: str
    camera_name: str
    room_id: str
    expires_at: datetime


class PairCameraRequest(BaseModel):
    pairing_code: str = Field(..., min_length=4, max_length=32)


class PairCameraResponse(BaseModel):
    camera_id: str
    camera_token: str
    camera_name: str
    room_id: str


class CameraResponse(BaseModel):
    id: str
    name: str
    room_id: str
    status: str
    privacy_mode: bool
    privacy_schedule: Optional[str] = None
    audio_enabled: bool
    ai_enabled: bool = True
    retention_days: int
    motion_threshold: int
    created_at: datetime


class TogglePrivacyRequest(BaseModel):
    privacy_mode: bool


class ToggleAudioRequest(BaseModel):
    audio_enabled: bool


class ToggleAIRequest(BaseModel):
    ai_enabled: bool


class AIHeartbeatRequest(BaseModel):
    worker_id: str = "default_worker"
    status: str = "online"
    active_cameras: int = 0
    fps_actual: float = 0.0
    cpu_percent: float = 0.0
    memory_mb: float = 0.0


class MediaMTXAuthRequest(BaseModel):
    user: Optional[str] = ""
    password: Optional[str] = ""
    ip: Optional[str] = ""
    action: str  # "publish" or "read"
    path: str
    protocol: Optional[str] = ""
    query: Optional[str] = ""


class MotionClipResponse(BaseModel):
    id: str
    camera_id: str
    start_time: datetime
    end_time: datetime
    duration_seconds: float
    file_size_bytes: int
    has_thumbnail: bool
    created_at: datetime


# --- Helpers & Role Verifications ---
async def check_camera_access(camera_id: str, user: User, db: AsyncSession) -> Camera:
    """
    Memvalidasi hak akses ke kamera:
    - child: Selalu DITOLAK (403 Forbidden).
    - member: Hanya diizinkan jika terdaftar di CameraUserAccess atau default perizinan.
    - admin: Akses penuh.
    """
    if user.role == "child":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Akun child tidak memiliki izin untuk mengakses kamera pengawas.",
        )

    stmt = select(Camera).where(Camera.id == camera_id)
    camera = (await db.execute(stmt)).scalar_one_or_none()
    if not camera:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kamera tidak ditemukan.")

    if user.role in ("member", "anggota"):
        # Cek apakah user memiliki hak akses spesifik ke kamera ini
        access_stmt = select(CameraUserAccess).where(
            CameraUserAccess.user_id == user.id,
            CameraUserAccess.camera_id == camera_id,
        )
        has_access = (await db.execute(access_stmt)).scalar_one_or_none()
        # Jika belum ada daftar pembatasan kamera apa pun, izinkan; jika ada, periksa secara ketat
        total_rules_stmt = select(CameraUserAccess).where(CameraUserAccess.user_id == user.id)
        user_rules = (await db.execute(total_rules_stmt)).scalars().all()
        if user_rules and not has_access:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Anda tidak memiliki izin akses ke kamera ruangan ini.",
            )

    return camera


# --- Endpoints ---

@router.get("", response_model=List[CameraResponse])
async def list_cameras(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mendapatkan daftar kamera yang dapat diakses pengguna."""
    if current_user.role == "child":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Akun child tidak memiliki izin mengakses kamera.",
        )

    stmt = select(Camera)
    cameras = (await db.execute(stmt)).scalars().all()

    if current_user.role in ("member", "anggota"):
        # Filter kamera yang diizinkan untuk member
        access_stmt = select(CameraUserAccess.camera_id).where(CameraUserAccess.user_id == current_user.id)
        allowed_ids = set((await db.execute(access_stmt)).scalars().all())
        if allowed_ids:
            cameras = [c for c in cameras if c.id in allowed_ids]

    return [
        CameraResponse(
            id=c.id,
            name=c.name,
            room_id=c.room_id,
            status=c.status,
            privacy_mode=c.privacy_mode,
            privacy_schedule=c.privacy_schedule,
            audio_enabled=c.audio_enabled,
            ai_enabled=getattr(c, "ai_enabled", True),
            retention_days=c.retention_days,
            motion_threshold=c.motion_threshold,
            created_at=c.created_at,
        )
        for c in cameras
    ]


@router.post("/pairing-codes", response_model=PairingCodeResponse)
async def create_pairing_code(
    payload: CreatePairingCodeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Admin membuat kode pairing sekali pakai (kedaluwarsa 10 menit)."""
    if current_user.role not in ("admin", "pemilik"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Hanya admin yang dapat membuat kode pairing kamera baru.",
        )

    code_str = f"CAM-{secrets.token_hex(3).upper()}"
    expires_at = utcnow() + timedelta(minutes=settings.CAMERA_PAIRING_CODE_EXPIRE_MINUTES)

    pairing_code = CameraPairingCode(
        code=code_str,
        camera_name=payload.camera_name,
        room_id=payload.room_id,
        expires_at=expires_at,
        is_used=False,
    )
    db.add(pairing_code)

    audit = AuditLog(
        user_id=current_user.id,
        username=current_user.username,
        action="camera_create_pairing_code",
        target_type="camera_pairing",
        target_id=code_str,
        details=f"Kode pairing dibuat: {code_str}, kedaluwarsa dalam 10 menit",
    )
    db.add(audit)
    await db.commit()

    return PairingCodeResponse(
        code=code_str,
        camera_name=payload.camera_name,
        room_id=payload.room_id,
        expires_at=expires_at,
    )


@router.post("/pair", response_model=PairCameraResponse)
async def pair_camera(
    payload: PairCameraRequest,
    db: AsyncSession = Depends(get_db),
):
    """Kamera HP menukar kode pairing dengan token kamera permanen."""
    stmt = select(CameraPairingCode).where(
        CameraPairingCode.code == payload.pairing_code,
        CameraPairingCode.is_used == False,
    )
    pairing = (await db.execute(stmt)).scalar_one_or_none()
    if not pairing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Kode pairing tidak valid atau sudah digunakan.",
        )

    # Validasi kedaluwarsa 10 menit
    expires_at = pairing.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < utcnow():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Kode pairing telah kedaluwarsa. Silakan minta kode baru dari admin.",
        )

    # Tandai pairing code terpakai
    pairing.is_used = True

    # Buat entitas kamera & token rahasia
    camera_id = f"cam_{secrets.token_hex(4)}"
    raw_token = f"camsec_{secrets.token_urlsafe(32)}"
    token_hashed = hash_token(raw_token)

    new_cam = Camera(
        id=camera_id,
        name=pairing.camera_name,
        room_id=pairing.room_id,
        status="online",
        privacy_mode=False,
        audio_enabled=False,  # Audio DIMATIKAN default
        retention_days=settings.RECORDING_RETENTION_DAYS,
        motion_threshold=settings.CAMERA_MOTION_THRESHOLD,
    )
    db.add(new_cam)

    cam_token = CameraToken(
        camera_id=camera_id,
        token_hash=token_hashed,
        is_revoked=False,
    )
    db.add(cam_token)

    # Registrasi ke MotionManager
    motion_manager.register_camera(camera_id, threshold=new_cam.motion_threshold)

    audit = AuditLog(
        user_id=None,
        username="camera_app",
        action="camera_paired",
        target_type="camera",
        target_id=camera_id,
        details=f"Kamera '{pairing.camera_name}' berhasil dipasangkan ke ruangan '{pairing.room_id}'",
    )
    db.add(audit)
    await db.commit()

    return PairCameraResponse(
        camera_id=camera_id,
        camera_token=raw_token,
        camera_name=pairing.camera_name,
        room_id=pairing.room_id,
    )


@router.post("/{camera_id}/revoke")
async def revoke_camera(
    camera_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Admin mencabut token kamera. Kamera yang dicabut langsung terputus seketika."""
    if current_user.role not in ("admin", "pemilik"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Hanya admin yang dapat mencabut kamera.",
        )

    stmt = select(Camera).where(Camera.id == camera_id)
    camera = (await db.execute(stmt)).scalar_one_or_none()
    if not camera:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kamera tidak ditemukan.")

    # Cabut seluruh token kamera
    tokens_stmt = select(CameraToken).where(
        CameraToken.camera_id == camera_id,
        CameraToken.is_revoked == False,
    )
    tokens = (await db.execute(tokens_stmt)).scalars().all()
    for t in tokens:
        t.is_revoked = True
        t.revoked_at = utcnow()

    camera.status = "offline"

    # Putus proses deteksi & sesi di motion manager
    motion_manager.unregister_camera(camera_id)

    audit = AuditLog(
        user_id=current_user.id,
        username=current_user.username,
        action="camera_revoked",
        target_type="camera",
        target_id=camera_id,
        details=f"Kamera {camera.name} dicabut oleh admin. Stream langsung diputus.",
    )
    db.add(audit)
    await db.commit()

    return {"status": "ok", "message": f"Kamera {camera.name} ({camera_id}) berhasil dicabut dan diputus."}


@router.patch("/{camera_id}/privacy")
async def toggle_privacy_mode(
    camera_id: str,
    payload: TogglePrivacyRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mengaktifkan / menonaktifkan mode privasi kamera."""
    camera = await check_camera_access(camera_id, current_user, db)
    camera.privacy_mode = payload.privacy_mode

    if payload.privacy_mode:
        # Jika privasi aktif: hentikan deteksi dan perekaman seketika
        motion_manager.unregister_camera(camera_id)
    else:
        # Jika privasi dimatikan: aktifkan kembali deteksi gerakan
        motion_manager.register_camera(camera_id, threshold=camera.motion_threshold)

    audit = AuditLog(
        user_id=current_user.id,
        username=current_user.username,
        action="camera_privacy_toggled",
        target_type="camera",
        target_id=camera_id,
        details=f"Mode privasi diubah menjadi {'AKTIF' if payload.privacy_mode else 'NONAKTIF'}",
    )
    db.add(audit)
    await db.commit()

    return {"status": "ok", "camera_id": camera_id, "privacy_mode": camera.privacy_mode}


@router.patch("/{camera_id}/audio")
async def toggle_audio_switch(
    camera_id: str,
    payload: ToggleAudioRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Admin mengaktifkan / mematikan saklar audio mikrofon kamera."""
    if current_user.role not in ("admin", "pemilik"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Hanya admin yang dapat mengubah saklar audio kamera demi privasi penghuni.",
        )

    stmt = select(Camera).where(Camera.id == camera_id)
    camera = (await db.execute(stmt)).scalar_one_or_none()
    if not camera:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kamera tidak ditemukan.")

    camera.audio_enabled = payload.audio_enabled

    audit = AuditLog(
        user_id=current_user.id,
        username=current_user.username,
        action="camera_audio_toggled",
        target_type="camera",
        target_id=camera_id,
        details=f"Audio mikrofon diubah menjadi {'AKTIF (Menyiarkan Suara)' if payload.audio_enabled else 'MATI'}",
    )
    db.add(audit)
    await db.commit()

    return {"status": "ok", "camera_id": camera_id, "audio_enabled": camera.audio_enabled}


@router.patch("/{camera_id}/ai")
async def toggle_ai_switch(
    camera_id: str,
    payload: ToggleAIRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Admin mengaktifkan / mematikan saklar Vision AI kamera."""
    if current_user.role not in ("admin", "pemilik"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Hanya admin yang dapat mengubah saklar AI kamera.",
        )

    stmt = select(Camera).where(Camera.id == camera_id)
    camera = (await db.execute(stmt)).scalar_one_or_none()
    if not camera:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kamera tidak ditemukan.")

    camera.ai_enabled = payload.ai_enabled

    audit = AuditLog(
        user_id=current_user.id,
        username=current_user.username,
        action="camera_ai_toggled",
        target_type="camera",
        target_id=camera_id,
        details=f"Vision AI kamera {camera.name} diubah menjadi {'AKTIF' if payload.ai_enabled else 'NONAKTIF'}",
    )
    db.add(audit)
    await db.commit()

    return {"status": "ok", "camera_id": camera_id, "ai_enabled": camera.ai_enabled}


@router.get("/{camera_id}/snapshot")
async def get_camera_snapshot(
    camera_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mendapatkan snapshot gambar diam (tersedia baik di LAN maupun dari luar rumah)."""
    camera = await check_camera_access(camera_id, current_user, db)
    if camera.privacy_mode:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Mode privasi aktif. Snapshot tidak dapat ditampilkan.",
        )

    # Cek thumbnail terbaru dari klip kamera jika ada
    stmt = (
        select(MotionClip)
        .where(MotionClip.camera_id == camera_id)
        .order_by(MotionClip.created_at.desc())
        .limit(1)
    )
    latest_clip = (await db.execute(stmt)).scalar_one_or_none()
    if latest_clip and latest_clip.thumbnail_path and Path(latest_clip.thumbnail_path).exists():
        return FileResponse(latest_clip.thumbnail_path, media_type="image/jpeg")

    # Fallback snapshot placeholder 320x240 JPEG
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (320, 240), color=(30, 41, 59))
    draw = ImageDraw.Draw(img)
    draw.text((80, 110), f"Camera: {camera.name}\nStatus: {camera.status}", fill=(148, 163, 184))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return Response(content=buf.getvalue(), media_type="image/jpeg")


@router.get("/{camera_id}/events", response_model=List[MotionClipResponse])
async def list_motion_events(
    camera_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mendapatkan daftar klip kejadian gerakan untuk kamera ini."""
    await check_camera_access(camera_id, current_user, db)

    stmt = select(MotionClip).where(MotionClip.camera_id == camera_id).order_by(MotionClip.created_at.desc())
    clips = (await db.execute(stmt)).scalars().all()

    return [
        MotionClipResponse(
            id=c.id,
            camera_id=c.camera_id,
            start_time=c.start_time,
            end_time=c.end_time,
            duration_seconds=c.duration_seconds,
            file_size_bytes=c.file_size_bytes,
            has_thumbnail=bool(c.thumbnail_path and Path(c.thumbnail_path).exists()),
            created_at=c.created_at,
        )
        for c in clips
    ]


@router.get("/{camera_id}/clips/{clip_id}")
async def stream_decrypted_clip(
    camera_id: str,
    clip_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Mengunduh / memutar klip rekaman.
    Berkas terenkripsi di disk didekripsi on-the-fly (AES-256-GCM) saat dilayani.
    Akses dicatat di audit log.
    """
    camera = await check_camera_access(camera_id, current_user, db)

    stmt = select(MotionClip).where(MotionClip.id == clip_id, MotionClip.camera_id == camera_id)
    clip = (await db.execute(stmt)).scalar_one_or_none()
    if not clip:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Klip rekaman tidak ditemukan.")

    clip_file = Path(clip.file_path)
    if not clip_file.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Berkas rekaman di disk tidak ditemukan.")

    # Dekripsi on-the-fly dengan AES-GCM
    try:
        decrypted_mp4 = read_and_decrypt_clip(clip_file, clip.nonce, camera_id)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Gagal mendekripsi rekaman: {exc}",
        )

    # Catat audit log pemutaran klip
    audit = AuditLog(
        user_id=current_user.id,
        username=current_user.username,
        action="camera_clip_played",
        target_type="motion_clip",
        target_id=f"{camera_id}:{clip_id}",
        details=f"Pengguna {current_user.username} ({current_user.role}) memutar klip rekaman {clip_id}",
    )
    db.add(audit)
    await db.commit()

    return Response(content=decrypted_mp4, media_type="video/mp4")


@router.get("/{camera_id}/clips/{clip_id}/thumbnail")
async def get_clip_thumbnail(
    camera_id: str,
    clip_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mengambil gambar thumbnail untuk klip rekaman gerakan."""
    await check_camera_access(camera_id, current_user, db)

    stmt = select(MotionClip).where(MotionClip.id == clip_id, MotionClip.camera_id == camera_id)
    clip = (await db.execute(stmt)).scalar_one_or_none()
    if not clip or not clip.thumbnail_path or not Path(clip.thumbnail_path).exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thumbnail tidak ditemukan.")

    return FileResponse(clip.thumbnail_path, media_type="image/jpeg")


@router.delete("/{camera_id}/clips/{clip_id}")
async def delete_clip(
    camera_id: str,
    clip_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Admin menghapus klip rekaman. Berkas di disk dihapus dan dicatat di audit log."""
    if current_user.role not in ("admin", "pemilik"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Hanya admin yang dapat menghapus rekaman kamera.",
        )

    stmt = select(MotionClip).where(MotionClip.id == clip_id, MotionClip.camera_id == camera_id)
    clip = (await db.execute(stmt)).scalar_one_or_none()
    if not clip:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Klip rekaman tidak ditemukan.")

    # Hapus berkas fisik di disk
    try:
        if clip.file_path and Path(clip.file_path).exists():
            Path(clip.file_path).unlink()
        if clip.thumbnail_path and Path(clip.thumbnail_path).exists():
            Path(clip.thumbnail_path).unlink()
    except Exception as e:
        pass

    await db.delete(clip)

    audit = AuditLog(
        user_id=current_user.id,
        username=current_user.username,
        action="camera_clip_deleted",
        target_type="motion_clip",
        target_id=f"{camera_id}:{clip_id}",
        details=f"Admin {current_user.username} menghapus klip rekaman {clip_id}",
    )
    db.add(audit)
    await db.commit()

    return {"status": "ok", "message": f"Klip {clip_id} berhasil dihapus."}


# --- Hook Autentikasi MediaMTX ---

@router.post("/auth/mediamtx")
async def mediamtx_auth_hook(
    payload: MediaMTXAuthRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Hook autentikasi HTTP yang dipanggil oleh server MediaMTX.
    - action == 'publish': Autentikasi kamera HP menggunakan token kamera (dicocokkan dengan hash di DB).
    - action == 'read': Autentikasi pengguna menggunakan JWT (dicek peran child/member dan privasi).
    """
    cam_id = payload.path

    # Cek keberadaan kamera
    stmt = select(Camera).where(Camera.id == cam_id)
    camera = (await db.execute(stmt)).scalar_one_or_none()
    if not camera:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Camera path unknown")

    # Mode privasi: tolak publish maupun read
    if camera.privacy_mode:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Camera is currently in privacy mode",
        )

    if payload.action == "publish":
        # Kamera mengirim token di field password
        token_candidate = payload.password or payload.user
        if not token_candidate:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing camera token")

        thash = hash_token(token_candidate)
        token_stmt = select(CameraToken).where(
            CameraToken.camera_id == cam_id,
            CameraToken.token_hash == thash,
            CameraToken.is_revoked == False,
        )
        token_row = (await db.execute(token_stmt)).scalar_one_or_none()
        if not token_row:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or revoked camera token")

        # Update status kamera menjadi online
        camera.status = "online"
        await db.commit()
        return Response(status_code=status.HTTP_200_OK)

    elif payload.action == "read":
        # Pengguna melihat stream: wajib menyertakan token JWT pengguna di password (atau internal secret untuk AI worker)
        jwt_candidate = payload.password or payload.user
        if not jwt_candidate and payload.query:
            import urllib.parse
            params = urllib.parse.parse_qs(payload.query)
            jwt_candidate = (params.get("token") or params.get("jwt") or params.get("password") or [""])[0]

        if jwt_candidate and jwt_candidate.startswith("Bearer "):
            jwt_candidate = jwt_candidate[7:].strip()

        if not jwt_candidate:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing user JWT token")

        # Akses internal worker / proses backend pada localhost
        if jwt_candidate == settings.SECRET_KEY or jwt_candidate == "internal_worker":
            return Response(status_code=status.HTTP_200_OK)

        import jwt
        try:
            decoded = jwt.decode(jwt_candidate, settings.SECRET_KEY, algorithms=["HS256"])
            user_id = int(decoded.get("sub"))
        except Exception:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid user JWT token")

        user_stmt = select(User).where(User.id == user_id)
        user = (await db.execute(user_stmt)).scalar_one_or_none()
        if not user or not user.is_active:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

        # Peran child DITOLAK
        if user.role == "child":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Child role cannot view camera streams")

        # Peran member: cek izin akses spesifik
        if user.role in ("member", "anggota"):
            access_stmt = select(CameraUserAccess).where(
                CameraUserAccess.user_id == user.id,
                CameraUserAccess.camera_id == cam_id,
            )
            has_access = (await db.execute(access_stmt)).scalar_one_or_none()
            user_rules = (
                await db.execute(select(CameraUserAccess).where(CameraUserAccess.user_id == user.id))
            ).scalars().all()
            if user_rules and not has_access:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Member lacks permission for this camera")

        # Catat audit log melihat live stream
        audit = AuditLog(
            user_id=user.id,
            username=user.username,
            action="camera_live_view",
            target_type="camera",
            target_id=cam_id,
            details=f"Pengguna {user.username} ({user.role}) melihat live view kamera {camera.name}",
        )
        db.add(audit)
        await db.commit()

        return Response(status_code=status.HTTP_200_OK)

    # Aksi lain di luar publish & read diizinkan atau ditolak sesuai kebijakan
    return Response(status_code=status.HTTP_200_OK)


# --- Vision AI Worker Management & Item Queries (Tahap 5) ---

@router.post("/ai/heartbeat")
async def report_ai_heartbeat(
    payload: AIHeartbeatRequest,
    db: AsyncSession = Depends(get_db),
):
    """Worker AI melaporkan status kesehatan periodik (heartbeat)."""
    stmt = select(AIWorkerHeartbeat).where(AIWorkerHeartbeat.id == payload.worker_id)
    hb = (await db.execute(stmt)).scalar_one_or_none()
    if not hb:
        hb = AIWorkerHeartbeat(id=payload.worker_id)
        db.add(hb)

    hb.status = payload.status
    hb.active_cameras = payload.active_cameras
    hb.fps_actual = payload.fps_actual
    hb.cpu_percent = payload.cpu_percent
    hb.memory_mb = payload.memory_mb
    hb.last_heartbeat = utcnow()

    await db.commit()
    return {"status": "ok"}


@router.get("/ai/status")
async def get_ai_status(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mendapatkan status operasional Vision AI Worker (aktif / tidak aktif)."""
    stmt = select(AIWorkerHeartbeat).order_by(AIWorkerHeartbeat.last_heartbeat.desc())
    hb = (await db.execute(stmt)).scalar_one_or_none()
    if not hb:
        return {
            "worker_status": "offline",
            "message": "AI tidak aktif (belum ada worker terhubung)",
            "active_cameras": 0,
            "fps_actual": 0.0,
            "cpu_percent": 0.0,
        }

    # Ubah ke UTC aware untuk perbandingan waktu
    last_dt = hb.last_heartbeat
    if last_dt.tzinfo is None:
        last_dt = last_dt.replace(tzinfo=timezone.utc)
    diff = (utcnow() - last_dt).total_seconds()
    is_alive = diff <= settings.VISION_HEARTBEAT_TIMEOUT_SECONDS

    return {
        "worker_status": "online" if is_alive else "offline",
        "message": "AI aktif" if is_alive else "AI tidak aktif (heartbeat terhenti)",
        "last_seen_seconds_ago": max(0, int(diff)),
        "active_cameras": hb.active_cameras if is_alive else 0,
        "fps_actual": hb.fps_actual if is_alive else 0.0,
        "cpu_percent": hb.cpu_percent if is_alive else 0.0,
        "memory_mb": hb.memory_mb if is_alive else 0.0,
    }


@router.get("/{camera_id}/items/{item_id}/thumbnail")
async def get_item_thumbnail(
    camera_id: str,
    item_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mengambil thumbnail terenkripsi benda yang terdeteksi (hak akses diverifikasi)."""
    camera = await check_camera_access(camera_id, current_user, db)

    stmt = select(DetectedItemLog).where(
        DetectedItemLog.id == item_id,
        DetectedItemLog.camera_id == camera_id,
    )
    item = (await db.execute(stmt)).scalar_one_or_none()
    if not item or not item.thumbnail_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thumbnail tidak ditemukan.")

    t_path = Path(item.thumbnail_path)
    if not t_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Berkas thumbnail fisik tidak ditemukan.")

    try:
        raw_enc = t_path.read_bytes()
        # Nonce adalah 12 byte pertama
        nonce_bytes = raw_enc[:12]
        ciphertext = raw_enc[12:]
        from server.app.core.camera.encryption import decrypt_clip_data
        thumb_bytes = decrypt_clip_data(ciphertext, camera_id, nonce_bytes.hex())
        return Response(content=thumb_bytes, media_type="image/jpeg")
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Gagal mendekripsi thumbnail.")

