"""
Router API Analitik Keluarga (Tahap 6 - Admin Saja).
- Akses data analitik keluarga hanya untuk admin (member & child ditolak 403 Forbidden).
- Endpoint transparansi 'Apa yang dipantau' (/transparency) terbuka untuk semua peran.
- Setiap akses ke data keluarga dicatat di audit log.
- Tombol 'Hapus semua data keluarga' dengan konfirmasi menghapus seluruh log & ringkasan.
"""

from datetime import datetime, timezone
import json
import logging
from typing import Any, List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from server.app.api.deps import get_current_user, record_audit_log, require_role
from server.app.core.config import settings
from server.app.core.database import get_db
from server.app.core.family.rules_engine import generate_local_family_summary
from server.app.models.camera import AIWorkerHeartbeat, Camera
from server.app.models.device import Device
from server.app.models.family import (
    CameraZone,
    FamilyDailySummary,
    FamilyEventLog,
    FamilyInvitation,
    FamilySettings,
)
from server.app.models.user import User

logger = logging.getLogger("server.family.api")

router = APIRouter(prefix="/family", tags=["Family Analytics"])


# --- Schemas ---
class ZoneCreateRequest(BaseModel):
    camera_id: str
    name: str = Field(..., min_length=1, max_length=100)
    zone_type: str = Field(..., pattern="^(belajar|umum|berbahaya)$")
    polygon: List[List[float]]  # [[x, y], ...]


class ZoneUpdateRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    zone_type: Optional[str] = Field(None, pattern="^(belajar|umum|berbahaya)$")
    polygon: Optional[List[List[float]]] = None


class FamilySettingsUpdateRequest(BaseModel):
    enabled: Optional[bool] = None
    study_zone_enabled: Optional[bool] = None
    study_gap_tolerance_minutes: Optional[int] = Field(None, ge=1, le=60)
    late_night_enabled: Optional[bool] = None
    late_night_start: Optional[str] = None
    late_night_end: Optional[str] = None
    late_night_min_minutes: Optional[int] = Field(None, ge=1, le=120)
    fall_detection_enabled: Optional[bool] = None
    fall_stationary_seconds: Optional[int] = Field(None, ge=5, le=300)
    inactivity_enabled: Optional[bool] = None
    inactivity_min_minutes: Optional[int] = Field(None, ge=10, le=720)
    hazard_zone_enabled: Optional[bool] = None
    allow_assistant_family_summary: Optional[bool] = None
    stats_retention_days: Optional[int] = Field(None, ge=7, le=365)
    events_retention_days: Optional[int] = Field(None, ge=1, le=180)


class FamilyInviteRequest(BaseModel):
    email: str = Field(..., min_length=1, max_length=100)


class FamilyInviteRespondRequest(BaseModel):
    action: str = Field(..., pattern="^(accept|reject)$")


# =============================================================================
# 1. TRANSPARANSI "APA YANG DIPANTAU" (Terbuka untuk SEMUA akun tanpa data sensitif)
# =============================================================================
@router.get("/transparency")
async def get_monitoring_transparency(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Halaman transparansi 'Apa yang dipantau' yang bisa dibuka oleh semua akun:
    Daftar fitur yang aktif dan kamera yang dipakai, TANPA data metrik keluarga.
    """
    stmt_cfg = select(FamilySettings).where(FamilySettings.id == "default")
    fam_cfg = (await db.execute(stmt_cfg)).scalar_one_or_none()

    stmt_cams = select(Camera).where(Camera.status == "online", Camera.privacy_mode == False)
    cameras = (await db.execute(stmt_cams)).scalars().all()

    stmt_zones = select(CameraZone)
    zones = (await db.execute(stmt_zones)).scalars().all()

    # Periksa status worker AI (ketahanan: jika heartbeat stale > 15s -> worker offline)
    stmt_hb = select(AIWorkerHeartbeat).where(AIWorkerHeartbeat.id == "vision_worker_1")
    hb = (await db.execute(stmt_hb)).scalar_one_or_none()

    worker_online = False
    if hb and hb.last_heartbeat:
        last_hb = hb.last_heartbeat.replace(tzinfo=timezone.utc) if hb.last_heartbeat.tzinfo is None else hb.last_heartbeat
        time_diff = (datetime.now(timezone.utc) - last_hb).total_seconds()
        worker_online = time_diff <= settings.VISION_HEARTBEAT_TIMEOUT_SECONDS

    features_status = {
        "master_enabled": fam_cfg.enabled if fam_cfg else False,
        "study_zone_monitoring": fam_cfg.study_zone_enabled if fam_cfg else False,
        "late_night_activity_monitoring": fam_cfg.late_night_enabled if fam_cfg else False,
        "fall_detection_monitoring": fam_cfg.fall_detection_enabled if fam_cfg else False,
        "inactivity_monitoring": fam_cfg.inactivity_enabled if fam_cfg else False,
        "hazard_zone_monitoring": fam_cfg.hazard_zone_enabled if fam_cfg else False,
        "assistant_integration": fam_cfg.allow_assistant_family_summary if fam_cfg else False,
    }

    camera_list = [
        {"id": c.id, "name": c.name, "room_id": c.room_id or "default"}
        for c in cameras
    ]

    zone_list = [
        {"id": z.id, "camera_id": z.camera_id, "name": z.name, "zone_type": z.zone_type}
        for z in zones
    ]

    return {
        "status": "success",
        "ai_worker_status": "online" if worker_online else "offline",
        "disclaimer": "Bukan alat medis. Hanya angka dan kejadian dari kamera ruang umum, tanpa menyimpan video dan tanpa pengenalan wajah.",
        "active_features": features_status,
        "monitored_cameras": camera_list,
        "monitored_zones": zone_list,
    }


# =============================================================================
# 2. KONFIGURASI DAN SAKLAR (Admin Saja)
# =============================================================================
@router.get("/settings")
async def get_family_settings(
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """Mengambil konfigurasi analitik keluarga dan saklar fitur."""
    await record_audit_log(
        db,
        action="family.settings.read",
        user_id=current_user.id,
        username=current_user.username,
        target_type="family_settings",
    )

    stmt = select(FamilySettings).where(FamilySettings.id == "default")
    fam_cfg = (await db.execute(stmt)).scalar_one_or_none()

    if not fam_cfg:
        fam_cfg = FamilySettings(id="default")
        db.add(fam_cfg)
        await db.commit()
        await db.refresh(fam_cfg)

    return {
        "status": "success",
        "settings": {
            "enabled": fam_cfg.enabled,
            "study_zone_enabled": fam_cfg.study_zone_enabled,
            "study_gap_tolerance_minutes": fam_cfg.study_gap_tolerance_minutes,
            "late_night_enabled": fam_cfg.late_night_enabled,
            "late_night_start": fam_cfg.late_night_start,
            "late_night_end": fam_cfg.late_night_end,
            "late_night_min_minutes": fam_cfg.late_night_min_minutes,
            "fall_detection_enabled": fam_cfg.fall_detection_enabled,
            "fall_stationary_seconds": fam_cfg.fall_stationary_seconds,
            "inactivity_enabled": fam_cfg.inactivity_enabled,
            "inactivity_min_minutes": fam_cfg.inactivity_min_minutes,
            "hazard_zone_enabled": fam_cfg.hazard_zone_enabled,
            "allow_assistant_family_summary": fam_cfg.allow_assistant_family_summary,
            "stats_retention_days": fam_cfg.stats_retention_days,
            "events_retention_days": fam_cfg.events_retention_days,
            "updated_at": fam_cfg.updated_at.isoformat() if fam_cfg.updated_at else None,
        },
    }


@router.put("/settings")
async def update_family_settings(
    req: FamilySettingsUpdateRequest,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """Memperbarui konfigurasi analitik keluarga dan saklar fitur."""
    stmt = select(FamilySettings).where(FamilySettings.id == "default")
    fam_cfg = (await db.execute(stmt)).scalar_one_or_none()

    if not fam_cfg:
        fam_cfg = FamilySettings(id="default")
        db.add(fam_cfg)

    updates = req.model_dump(exclude_unset=True)
    for k, v in updates.items():
        setattr(fam_cfg, k, v)

    fam_cfg.updated_at = datetime.now(timezone.utc)
    await db.commit()

    await record_audit_log(
        db,
        action="family.settings.update",
        user_id=current_user.id,
        username=current_user.username,
        target_type="family_settings",
        details=updates,
    )

    return {"status": "success", "message": "Pengaturan keluarga berhasil diperbarui."}


# =============================================================================
# 3. ZONA POLIGON (Admin Saja)
# =============================================================================
@router.get("/zones")
async def list_zones(
    camera_id: Optional[str] = None,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """Mengambil daftar zona poligon kamera."""
    await record_audit_log(
        db,
        action="family.zones.read",
        user_id=current_user.id,
        username=current_user.username,
        target_type="camera_zones",
    )

    stmt = select(CameraZone)
    if camera_id:
        stmt = stmt.where(CameraZone.camera_id == camera_id)

    zones = (await db.execute(stmt)).scalars().all()
    results = []
    for z in zones:
        try:
            poly = json.loads(z.polygon_json)
        except Exception:
            poly = []
        results.append({
            "id": z.id,
            "camera_id": z.camera_id,
            "name": z.name,
            "zone_type": z.zone_type,
            "polygon": poly,
            "created_at": z.created_at.isoformat() if z.created_at else None,
        })

    return {"status": "success", "zones": results}


@router.post("/zones")
async def create_zone(
    req: ZoneCreateRequest,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """Menambahkan zona poligon baru untuk kamera."""
    cam = await db.get(Camera, req.camera_id)
    if not cam:
        raise HTTPException(status_code=404, detail="Kamera tidak ditemukan.")

    new_zone = CameraZone(
        id=str(uuid.uuid4()),
        camera_id=req.camera_id,
        name=req.name,
        zone_type=req.zone_type,
        polygon_json=json.dumps(req.polygon),
    )
    db.add(new_zone)
    await db.commit()

    await record_audit_log(
        db,
        action="family.zones.create",
        user_id=current_user.id,
        username=current_user.username,
        target_type="camera_zone",
        target_id=new_zone.id,
        details={"camera_id": req.camera_id, "name": req.name, "zone_type": req.zone_type},
    )

    return {"status": "success", "id": new_zone.id, "message": f"Zona '{req.name}' berhasil dibuat."}


@router.put("/zones/{zone_id}")
async def update_zone(
    zone_id: str,
    req: ZoneUpdateRequest,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """Memperbarui zona poligon."""
    zone = await db.get(CameraZone, zone_id)
    if not zone:
        raise HTTPException(status_code=404, detail="Zona tidak ditemukan.")

    if req.name is not None:
        zone.name = req.name
    if req.zone_type is not None:
        zone.zone_type = req.zone_type
    if req.polygon is not None:
        zone.polygon_json = json.dumps(req.polygon)

    zone.updated_at = datetime.now(timezone.utc)
    await db.commit()

    await record_audit_log(
        db,
        action="family.zones.update",
        user_id=current_user.id,
        username=current_user.username,
        target_type="camera_zone",
        target_id=zone_id,
    )

    return {"status": "success", "message": "Zona berhasil diperbarui."}


@router.delete("/zones/{zone_id}")
async def delete_zone(
    zone_id: str,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """Menghapus zona poligon."""
    zone = await db.get(CameraZone, zone_id)
    if not zone:
        raise HTTPException(status_code=404, detail="Zona tidak ditemukan.")

    await db.delete(zone)
    await db.commit()

    await record_audit_log(
        db,
        action="family.zones.delete",
        user_id=current_user.id,
        username=current_user.username,
        target_type="camera_zone",
        target_id=zone_id,
    )

    return {"status": "success", "message": "Zona berhasil dihapus."}


# =============================================================================
# 4. RINGKASAN DAN KEJADIAN KELUARGA (Admin Saja)
# =============================================================================
@router.get("/summary")
async def get_family_summary(
    range_type: str = Query("today", alias="range", pattern="^(today|week)$"),
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """
    Mengambil ringkasan aktivitas keluarga harian atau mingguan.
    Hanya angka agregat tanpa nama per orang.
    """
    await record_audit_log(
        db,
        action="family.summary.read",
        user_id=current_user.id,
        username=current_user.username,
        target_type="family_summary",
        details={"range": range_type},
    )

    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # Pastikan ringkasan hari ini dibuat jika belum ada
    stmt_today = select(FamilyDailySummary).where(FamilyDailySummary.date == today_str)
    summary_today = (await db.execute(stmt_today)).scalar_one_or_none()
    if not summary_today:
        summary_today = await generate_local_family_summary(today_str)

    if range_type == "today":
        return {
            "status": "success",
            "range": "today",
            "date": today_str,
            "data": {
                "study_minutes": summary_today.study_minutes,
                "late_night_count": summary_today.late_night_count,
                "fall_incident_count": summary_today.fall_incident_count,
                "inactivity_count": summary_today.inactivity_count,
                "hazard_alert_count": summary_today.hazard_alert_count,
                "summary_text": summary_today.summary_text,
            },
        }
    else:
        # 7 hari terakhir
        stmt_week = select(FamilyDailySummary).order_by(FamilyDailySummary.date.desc()).limit(7)
        past_summaries = (await db.execute(stmt_week)).scalars().all()
        items = [
            {
                "date": s.date,
                "study_minutes": s.study_minutes,
                "late_night_count": s.late_night_count,
                "fall_incident_count": s.fall_incident_count,
                "inactivity_count": s.inactivity_count,
                "hazard_alert_count": s.hazard_alert_count,
                "summary_text": s.summary_text,
            }
            for s in reversed(past_summaries)
        ]
        return {"status": "success", "range": "week", "history": items}


@router.get("/events")
async def list_family_events(
    event_type: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """Mengambil riwayat kejadian peringatan keluarga (Admin Saja)."""
    await record_audit_log(
        db,
        action="family.events.read",
        user_id=current_user.id,
        username=current_user.username,
        target_type="family_events",
    )

    stmt = select(FamilyEventLog).order_by(FamilyEventLog.created_at.desc())
    if event_type:
        stmt = stmt.where(FamilyEventLog.event_type == event_type)
    stmt = stmt.limit(limit)

    logs = (await db.execute(stmt)).scalars().all()
    results = []
    for l in logs:
        try:
            meta = json.loads(l.metadata_json)
        except Exception:
            meta = {}
        results.append({
            "id": l.id,
            "event_type": l.event_type,
            "camera_id": l.camera_id,
            "room_id": l.room_id,
            "title": l.title,
            "description": l.description,
            "severity": l.severity,
            "metadata": meta,
            "is_reviewed": l.is_reviewed,
            "created_at": l.created_at.isoformat() if l.created_at else None,
        })

    return {"status": "success", "events": results}


@router.put("/events/{event_id}/review")
async def mark_event_reviewed(
    event_id: str,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """Menandai peringatan sudah dilihat / ditinjau oleh admin."""
    event = await db.get(FamilyEventLog, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Kejadian tidak ditemukan.")

    event.is_reviewed = True
    await db.commit()

    await record_audit_log(
        db,
        action="family.events.review",
        user_id=current_user.id,
        username=current_user.username,
        target_type="family_event",
        target_id=event_id,
    )

    return {"status": "success", "message": "Peringatan ditandai sudah dilihat."}


# =============================================================================
# 5. HAPUS SEMUA DATA KELUARGA (Admin Saja dengan Konfirmasi)
# =============================================================================
@router.delete("/data")
async def clear_all_family_data(
    confirm: bool = Query(False, description="Harus bernilai True untuk konfirmasi penghapusan permanen"),
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """
    Menghapus seluruh rekaman kejadian dan ringkasan statistik keluarga.
    Hanya dapat dijalankan oleh admin dengan konfirmasi eksplisit.
    """
    if not confirm:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Konfirmasi diperlukan: tambahkan parameter ?confirm=true untuk menghapus permanen.",
        )

    # 1. Hapus seluruh kejadian analitik keluarga
    stmt_del_events = delete(FamilyEventLog)
    await db.execute(stmt_del_events)

    # 2. Hapus seluruh ringkasan statistik harian
    stmt_del_summaries = delete(FamilyDailySummary)
    await db.execute(stmt_del_summaries)

    await db.commit()

    # Catat audit log dengan aksi kritis
    await record_audit_log(
        db,
        action="family.data.purge_all",
        user_id=current_user.id,
        username=current_user.username,
        target_type="family_data",
        details={"severity": "CRITICAL", "message": "Seluruh log analitik dan ringkasan keluarga telah dihapus permanen oleh admin."},
    )

    logger.warning(f"Admin {current_user.username} (ID {current_user.id}) telah menghapus seluruh data analitik keluarga.")
    return {"status": "success", "message": "Semua data kejadian dan ringkasan statistik keluarga berhasil dihapus permanen."}


# =============================================================================
# 6. MANAJEMEN UNDANGAN KELUARGA & KEPEMILIKAN RUMAH
# =============================================================================

@router.post("/invite", status_code=status.HTTP_201_CREATED)
async def invite_family_member(
    payload: FamilyInviteRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Kirim undangan bergabung ke rumah untuk anggota keluarga baru.
    Hanya dapat diakses oleh pemilik perangkat / admin rumah.
    """
    # 1. Validasi hak akses (harus admin atau memiliki setidaknya 1 perangkat)
    is_owner = current_user.role == "admin"
    if not is_owner:
        dev_count = await db.scalar(
            select(func.count()).select_from(Device).where(Device.owner_id == current_user.id)
        )
        if dev_count and dev_count > 0:
            is_owner = True
            current_user.role = "admin"  # Upgrade role jika sudah punya perangkat

    if not is_owner:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Hanya pemilik perangkat atau admin rumah yang dapat mengundang anggota keluarga.",
        )

    target_email = payload.email.strip()
    if not target_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email atau username tujuan tidak boleh kosong.",
        )

    # 2. Cegah mengundang diri sendiri
    if current_user.email and current_user.email.lower() == target_email.lower():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tidak dapat mengundang akun Anda sendiri.",
        )
    if current_user.username.lower() == target_email.lower():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tidak dapat mengundang akun Anda sendiri.",
        )

    # 3. Cek apakah calon anggota sudah masuk di keluarga yang sama
    owner_family_id = current_user.family_id or current_user.id
    user_stmt = select(User).where(
        or_(
            func.lower(User.email) == target_email.lower(),
            func.lower(User.username) == target_email.lower(),
        )
    )
    existing_target_user = (await db.execute(user_stmt)).scalar_one_or_none()
    if not existing_target_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Email '{target_email}' belum terdaftar. Undangan hanya dapat dikirim ke akun yang sudah terdaftar.",
        )
    if existing_target_user.family_id == owner_family_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Pengguna '{target_email}' sudah menjadi anggota keluarga Anda.",
        )

    # 4. Cegah duplikasi undangan aktif (status pending)
    pending_stmt = select(FamilyInvitation).where(
        FamilyInvitation.inviter_id == current_user.id,
        func.lower(FamilyInvitation.invitee_email) == target_email.lower(),
        FamilyInvitation.status == "pending",
    )
    existing_invite = (await db.execute(pending_stmt)).scalar_one_or_none()
    if existing_invite:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Undangan aktif untuk '{target_email}' sudah dikirim dan sedang menunggu respons.",
        )

    # Pastikan inviter memiliki family_id
    if not current_user.family_id:
        current_user.family_id = current_user.id
        await db.flush()

    # 5. Buat undangan keluarga baru
    invitation = FamilyInvitation(
        inviter_id=current_user.id,
        invitee_email=target_email.lower(),
        status="pending",
    )
    db.add(invitation)
    await db.commit()
    await db.refresh(invitation)

    client_ip = request.client.host if request.client else "127.0.0.1"
    await record_audit_log(
        db=db,
        action="family.invite",
        user_id=current_user.id,
        username=current_user.username,
        target_type="family_invitation",
        target_id=str(invitation.id),
        details={"invitee_email": target_email.lower()},
        ip_address=client_ip,
    )

    return {
        "status": "ok",
        "message": f"Undangan keluarga berhasil dikirimkan ke '{target_email}'.",
        "invitation": {
            "id": invitation.id,
            "inviter_id": invitation.inviter_id,
            "invitee_email": invitation.invitee_email,
            "status": invitation.status,
            "created_at": invitation.created_at.isoformat(),
        },
    }


@router.get("/invitations")
async def get_my_family_invitations(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Mengambil daftar undangan yang masuk (status = 'pending')
    berdasarkan email atau username user yang sedang login saat ini.
    """
    conditions = [
        func.lower(FamilyInvitation.invitee_email) == current_user.username.lower()
    ]
    if current_user.email:
        conditions.append(
            func.lower(FamilyInvitation.invitee_email) == current_user.email.lower()
        )
        user_part = current_user.email.split("@")[0].lower()
        conditions.append(
            func.lower(FamilyInvitation.invitee_email) == user_part
        )

    stmt = (
        select(FamilyInvitation)
        .options(selectinload(FamilyInvitation.inviter))
        .where(
            or_(*conditions),
            FamilyInvitation.status == "pending",
        )
        .order_by(FamilyInvitation.created_at.desc())
    )
    res = await db.execute(stmt)
    invitations = res.scalars().all()

    items = []
    for inv in invitations:
        inviter_name = "Pemilik Rumah"
        inviter_email = None
        if inv.inviter:
            inviter_name = inv.inviter.full_name or inv.inviter.username
            inviter_email = inv.inviter.email

        items.append({
            "id": inv.id,
            "inviter_id": inv.inviter_id,
            "inviter_name": inviter_name,
            "inviter_email": inviter_email,
            "invitee_email": inv.invitee_email,
            "status": inv.status,
            "created_at": inv.created_at.isoformat() if inv.created_at else None,
        })

    return {
        "status": "ok",
        "invitations": items,
    }


@router.post("/invitations/{invitation_id}/respond")
async def respond_to_family_invitation(
    invitation_id: int,
    payload: FamilyInviteRespondRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Menanggapi undangan masuk (action: 'accept' atau 'reject').
    Jika 'accept', user dimasukkan ke keluarga yang sama dengan pemilik perangkat.
    """
    stmt = (
        select(FamilyInvitation)
        .options(selectinload(FamilyInvitation.inviter))
        .where(FamilyInvitation.id == invitation_id)
    )
    inv = (await db.execute(stmt)).scalar_one_or_none()
    if not inv:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Undangan tidak ditemukan.",
        )

    if inv.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Undangan sudah berstatus '{inv.status}' dan tidak dapat diubah lagi.",
        )

    # Validasi bahwa user yang login memang target undangan (atau admin sistem)
    user_emails = [current_user.username.lower()]
    if current_user.email:
        user_emails.append(current_user.email.lower())
        user_emails.append(current_user.email.split("@")[0].lower())

    if inv.invitee_email.lower() not in user_emails and current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Anda tidak memiliki izin untuk menanggapi undangan ini.",
        )

    client_ip = request.client.host if request.client else "127.0.0.1"

    if payload.action == "accept":
        inv.status = "accepted"
        inv.updated_at = datetime.now(timezone.utc)

        # Cari family_id dari inviter
        inviter = inv.inviter or (await db.get(User, inv.inviter_id))
        target_family_id = inv.inviter_id
        if inviter:
            if not inviter.family_id:
                inviter.family_id = inviter.id
            target_family_id = inviter.family_id

        # Masukkan user ke keluarga pemilik rumah
        current_user.family_id = target_family_id
        current_user.is_approved = True

        await record_audit_log(
            db=db,
            action="family.invitation_accepted",
            user_id=current_user.id,
            username=current_user.username,
            target_type="family_invitation",
            target_id=str(inv.id),
            details={
                "inviter_id": inv.inviter_id,
                "family_id": target_family_id,
                "action": "accept",
            },
            ip_address=client_ip,
        )
        await db.commit()

        return {
            "status": "ok",
            "message": "Undangan keluarga berhasil diterima! Anda kini telah terhubung ke rumah.",
            "family_id": target_family_id,
        }
    else:
        inv.status = "rejected"
        inv.updated_at = datetime.now(timezone.utc)

        await record_audit_log(
            db=db,
            action="family.invitation_rejected",
            user_id=current_user.id,
            username=current_user.username,
            target_type="family_invitation",
            target_id=str(inv.id),
            details={"inviter_id": inv.inviter_id, "action": "reject"},
            ip_address=client_ip,
        )
        await db.commit()

        return {
            "status": "ok",
            "message": "Undangan keluarga telah ditolak.",
        }


@router.get("/members")
async def get_family_members(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mengambil daftar anggota keluarga dalam rumah yang sama."""
    fam_id = current_user.family_id or current_user.id
    stmt = (
        select(User)
        .where(
            or_(
                User.family_id == fam_id,
                User.id == fam_id,
                User.id == current_user.id,
            )
        )
        .order_by(User.id.asc())
    )
    res = await db.execute(stmt)
    members = res.scalars().all()

    return {
        "status": "ok",
        "family_id": fam_id,
        "members": [
            {
                "id": m.id,
                "username": m.username,
                "full_name": m.full_name,
                "email": m.email,
                "role": m.role,
                "is_owner": m.id == fam_id or m.role == "admin",
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in members
        ],
    }


@router.get("/sent-invitations")
async def get_sent_family_invitations(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mengambil daftar undangan yang pernah dikirim oleh pemilik rumah saat ini."""
    stmt = (
        select(FamilyInvitation)
        .where(FamilyInvitation.inviter_id == current_user.id)
        .order_by(FamilyInvitation.created_at.desc())
    )
    res = await db.execute(stmt)
    invs = res.scalars().all()

    return {
        "status": "ok",
        "invitations": [
            {
                "id": inv.id,
                "invitee_email": inv.invitee_email,
                "status": inv.status,
                "created_at": inv.created_at.isoformat() if inv.created_at else None,
                "updated_at": inv.updated_at.isoformat() if inv.updated_at else None,
            }
            for inv in invs
        ],
    }

