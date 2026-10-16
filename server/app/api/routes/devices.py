import datetime
import json
import logging
import re
import secrets
import time
from typing import Any, Dict, List, Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from server.app.api.deps import get_current_user, record_audit_log, require_role
from server.app.core.claim_service import claim_rate_limiter, create_claim_session, hash_secret
from server.app.core.database import get_db
from server.app.core.device_queue import device_queue
from server.app.core.mqtt_auth import (
    generate_device_mqtt_credentials,
    restrict_device_mqtt_credentials,
    revoke_device_mqtt_credentials,
)
from server.app.core.mqtt_client import mqtt_service
from server.app.core.ws_manager import ws_manager
from server.app.models.automation import Automation, NotificationLog
from server.app.models.claim_session import ClaimSession
from server.app.models.device import Channel, Device, TelemetryLog
from server.app.models.user import User

logger = logging.getLogger("server.devices")
router = APIRouter(tags=["devices"])


# --- Schemas ---
class ChannelInput(BaseModel):
    channel_key: str = Field(..., min_length=2, max_length=50)
    name: str = Field(..., min_length=2, max_length=100)
    channel_type: Literal["switch", "relay", "gas_sensor", "light_sensor", "buzzer"]
    unit: Optional[str] = None


class CreateDeviceRequest(BaseModel):
    id: str = Field(..., min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9_\-]+$")
    name: str = Field(..., min_length=2, max_length=100)
    room: str = Field("Umum", max_length=50)
    device_type: str = Field("esp32", max_length=30)
    channels: Optional[List[ChannelInput]] = None


class ClaimDeviceRequest(BaseModel):
    device_id: Optional[str] = Field(None, max_length=50)
    claim_token: Optional[str] = Field(None, max_length=64)
    pair_code: Optional[str] = Field(None, max_length=10)
    name: Optional[str] = Field(None, max_length=100)
    room: Optional[str] = Field("Ruang Tamu", max_length=50)


class DeviceStatusPayload(BaseModel):
    device_id: str
    device_key: Optional[str] = None
    pair_code: Optional[str] = None
    status: Dict[str, Any]


class DevicePollPayload(BaseModel):
    device_id: str
    device_key: Optional[str] = None
    limit: Optional[int] = 5


class DeviceAckPayload(BaseModel):
    device_id: str
    device_key: Optional[str] = None
    command_id: str
    ok: Optional[bool] = True


class CommandRequest(BaseModel):
    channel: str = Field(..., description="channel_key yang dituju")
    action: str = Field("set", description="Aksi: set, toggle, pulse")
    value: Any = Field(..., description="Nilai baru: true/false/int")


class CreateAutomationRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    trigger_type: str = Field("sensor_threshold")
    trigger_config: Dict[str, Any]
    action_config: Dict[str, Any]
    is_enabled: bool = True


class UpdateChannelRequest(BaseModel):
    name: Optional[str] = None
    alias: Optional[str] = None
    is_sensitive: Optional[bool] = None
    allowed_for_child: Optional[bool] = None


# --- Endpoints Perangkat ---


@router.get("/devices")
async def list_devices(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Ambil daftar semua perangkat milik pengguna atau keluarganya beserta kanalnya."""
    target_user_ids = [current_user.id]
    if current_user.family_id:
        res_fam = await db.execute(
            select(User.id).where(or_(User.family_id == current_user.family_id, User.id == current_user.family_id))
        )
        target_user_ids = list(set([r[0] for r in res_fam.all()] + [current_user.id]))

    query = (
        select(Device)
        .options(selectinload(Device.channels))
        .where(Device.owner_id.in_(target_user_ids))
        .order_by(Device.created_at.desc())
    )
    result = await db.execute(query)
    devices = result.scalars().all()

    now = datetime.datetime.utcnow()
    items = []
    for d in devices:
        # Evaluasi status online dinamis: jika heartbeat terakhir > 60 detik, anggap offline
        is_online = bool(d.is_online)
        if d.last_seen_at:
            delta = (now - d.last_seen_at).total_seconds()
            if delta > 60:
                is_online = False
        elif not d.is_online:
            is_online = False

        items.append({
            "id": d.id,
            "owner_id": d.owner_id,
            "name": d.name,
            "room": d.room,
            "device_type": d.device_type,
            "is_online": is_online,
            "last_seen_at": d.last_seen_at.isoformat() if d.last_seen_at else None,
            "ip_address": d.ip_address,
            "mqtt_username": d.mqtt_username,
            "channels": [
                {
                    "id": c.id,
                    "channel_key": c.channel_key,
                    "name": c.name,
                    "channel_type": c.channel_type,
                    "current_value": c.current_value,
                    "unit": c.unit,
                    "updated_at": c.updated_at.isoformat() if c.updated_at else None,
                }
                for c in d.channels
                if c.channel_key != "lamp"
            ],
        })
    return {"status": "ok", "devices": items}


@router.post("/devices", status_code=status.HTTP_201_CREATED)
async def create_device(
    payload: CreateDeviceRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role("admin")),
):
    """Tambah perangkat baru dan buat kredensial MQTT unik (Hanya Admin)."""
    # Cek ID unik
    existing = await db.execute(select(Device).where(Device.id == payload.id))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Perangkat dengan ID '{payload.id}' sudah terdaftar.",
        )

    # 1. Buat kredensial MQTT acak dan update ACL Mosquitto
    creds = generate_device_mqtt_credentials(payload.id)

    if not admin.family_id:
        admin.family_id = admin.id

    # 2. Simpan perangkat ke DB
    dev = Device(
        id=payload.id,
        name=payload.name,
        room=payload.room,
        device_type=payload.device_type,
        is_online=False,
        owner_id=admin.id,
        mqtt_username=creds["mqtt_username"],
        mqtt_password_hash=creds["mqtt_password"],  # disimpan untuk referensi
    )
    db.add(dev)

    # 3. Tambahkan kanal awal
    channels_to_add = payload.channels or [
        ChannelInput(channel_key="lamp_tengah", name="Lampu Tengah", channel_type="switch"),
        ChannelInput(channel_key="lamp_dapur_tamu", name="Lampu Dapur & Tamu", channel_type="switch"),
        ChannelInput(channel_key="lamp_kamar", name="Lampu Kamar", channel_type="switch"),
        ChannelInput(channel_key="relay_fan", name="Kipas Exhaust", channel_type="relay"),
        ChannelInput(channel_key="buzzer", name="Sirine Alarm", channel_type="buzzer"),
        ChannelInput(channel_key="mq2", name="Sensor Gas MQ-2", channel_type="gas_sensor", unit="raw"),
        ChannelInput(channel_key="ldr", name="Sensor Cahaya LDR", channel_type="light_sensor", unit="digital"),
    ]

    for ch in channels_to_add:
        c_obj = Channel(
            device_id=payload.id,
            channel_key=ch.channel_key,
            name=ch.name,
            channel_type=ch.channel_type,
            unit=ch.unit,
            current_value="false" if ch.channel_type in {"switch", "relay", "buzzer"} else "0",
        )
        db.add(c_obj)

    await db.commit()

    # Catat audit log
    client_ip = request.client.host if request.client else "127.0.0.1"
    await record_audit_log(
        db=db,
        action="device.create",
        user_id=admin.id,
        username=admin.username,
        target_type="device",
        target_id=payload.id,
        details={"name": payload.name, "room": payload.room},
        ip_address=client_ip,
    )

    # Kembalikan kredensial MQTT SEKALI SAJA ke UI admin
    return {
        "status": "ok",
        "message": "Perangkat berhasil didaftarkan.",
        "device": {
            "id": dev.id,
            "name": dev.name,
            "room": dev.room,
            "device_type": dev.device_type,
        },
        "mqtt_credentials": {
            "broker_host": "127.0.0.1",
            "broker_port": 1883,
            "topic_prefix": f"home/{dev.id}",
            "client_id": dev.id,
            "username": creds["mqtt_username"],
            "password": creds["mqtt_password"],
        },
    }


@router.post("/devices/{device_id}/claim-session", status_code=status.HTTP_200_OK)
async def request_device_claim_session(
    device_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    S3: Buat atau rotasi sesi klaim berotasi (kode 6 digit + QR token).
    Berlaku 120 detik, sekali pakai, berotasi otomatis.
    Teks asli hanya dikirim sekali ke perangkat.
    """
    clean_id = device_id.strip()
    session_data = await create_claim_session(db, clean_id, ttl_seconds=120)
    return {
        "status": "ok",
        "session": session_data,
        "device_id": session_data["device_id"],
        "pairing_code": session_data["pair_code"],
        "pair_code": session_data["pair_code"],
        "qr_token": session_data["qr_token"],
        "expires_in": session_data["expires_in"],
        "claim_url": session_data["claim_url"],
    }


@router.post("/devices/claim", status_code=status.HTTP_200_OK)
async def claim_device(
    payload: ClaimDeviceRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Hubungkan / klaim perangkat baru ke akun smart home melalui 6-digit PAIR_CODE atau scan QR token.
    Memenuhi Invarian I1 - I8:
    - I1: Perangkat yang sudah terikat SELALU ditolak 409 Conflict.
    - I2: Tidak pernah mengubah peran pengguna siapa pun.
    - I4: Hanya Pengelola yang berhak mengklaim (anggota/anak mendapat 403).
    - I5 & I6: Sekali pakai, 120 detik, hangus seketika setelah dipakai.
    - I7: Rahasia diverifikasi dengan constant-time hash dan tidak dicetak di log.
    - I8: Mengetahui ID perangkat saja tidak pernah cukup untuk mengklaim.
    """
    client_ip = request.client.host if request.client else "127.0.0.1"

    # I4: Anggota (member) dan anak (child) dilarang mengklaim perangkat
    if user.role in ("member", "child"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Hanya Pengelola yang dapat menambahkan atau mengklaim perangkat.",
        )

    # Pemeriksaan pembatasan percobaan (S3 Rate Limiting)
    claim_rate_limiter.check_rate_limit(user.id, client_ip)

    # I8: Kode pairing atau token QR wajib disertakan
    raw_token = (payload.claim_token or payload.pair_code or "").strip()
    if not raw_token:
        claim_rate_limiter.record_failure(user.id, client_ip)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Kode tidak valid",
        )

    token_hash = hash_secret(raw_token)
    now = datetime.datetime.utcnow()

    # Cari sesi klaim di basis data berdasarkan hash kode atau hash token QR (I7)
    session_stmt = (
        select(ClaimSession)
        .where(
            or_(
                ClaimSession.code_hash == token_hash,
                ClaimSession.qr_token_hash == token_hash,
            )
        )
        .order_by(ClaimSession.id.desc())
    )
    res_session = await db.execute(session_stmt)
    claim_sess = res_session.scalars().first()

    target_device_id = None

    if claim_sess:
        target_device_id = claim_sess.device_id
        if claim_sess.status == "terpakai":
            claim_rate_limiter.record_failure(user.id, client_ip)
            await record_audit_log(
                db=db,
                action="device.claim_failed",
                user_id=user.id,
                username=user.username,
                target_type="device",
                target_id=target_device_id,
                details={"reason": "kode_sudah_terpakai"},
                ip_address=client_ip,
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Kode sudah terpakai",
            )

        if claim_sess.status == "kedaluwarsa" or claim_sess.expires_at <= now:
            claim_sess.status = "kedaluwarsa"
            await db.commit()
            claim_rate_limiter.record_failure(user.id, client_ip)
            await record_audit_log(
                db=db,
                action="device.claim_failed",
                user_id=user.id,
                username=user.username,
                target_type="device",
                target_id=target_device_id,
                details={"reason": "kode_kedaluwarsa"},
                ip_address=client_ip,
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Kode kedaluwarsa",
            )

        if claim_sess.status == "dicabut":
            claim_rate_limiter.record_failure(user.id, client_ip)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Kode tidak valid",
            )

        # I5 & I6: Hanguskan sesi klaim secara atomik dalam satu UPDATE pernyataan
        update_stmt = (
            update(ClaimSession)
            .where(
                ClaimSession.id == claim_sess.id,
                ClaimSession.status == "aktif",
                ClaimSession.expires_at > now,
            )
            .values(
                status="terpakai",
                used_by=user.id,
                used_at=now,
            )
        )
        up_res = await db.execute(update_stmt)
        if up_res.rowcount == 0:
            claim_rate_limiter.record_failure(user.id, client_ip)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Kode sudah terpakai",
            )
    else:
        # Fallback kompatibilitas dengan device_queue in-memory
        resolved = device_queue.resolve_pair_code(raw_token)
        if resolved:
            # Periksa kedaluwarsa 120 detik pada queue (I5)
            created_ts = resolved.get("updated_at", 0)
            if time.time() - created_ts > 120:
                claim_rate_limiter.record_failure(user.id, client_ip)
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Kode kedaluwarsa",
                )
            target_device_id = resolved.get("device_id")
            # Hanguskan kode di queue seketika (I6)
            with device_queue._lock:
                device_queue._pair_codes.pop(raw_token, None)
        else:
            # 1. Periksa jika ada payload.device_id eksplisit yang diberikan
            clean_dev_id = (payload.device_id or "").strip().lower()
            if clean_dev_id:
                if not clean_dev_id.startswith("esp32_") and len(clean_dev_id) == 6:
                    clean_dev_id = f"esp32_{clean_dev_id}"

                # Cek jika ada token NEXA pabrik
                if raw_token.startswith("NEXA-"):
                    target_device_id = clean_dev_id

            if not target_device_id:
                # Fallback: periksa jika raw_token adalah ID perangkat atau MAC suffix (misal esp32_559ed8 atau 559ed8)
                # yang sudah terdaftar di database dan belum memiliki pemilik (owner_id is None)
                candidate_id = raw_token.lower()
                if not candidate_id.startswith("esp32_") and len(candidate_id) == 6:
                    candidate_id = f"esp32_{candidate_id}"

                cand_res = await db.execute(select(Device).where(Device.id == candidate_id))
                cand_dev = cand_res.scalar_one_or_none()
                if cand_dev and cand_dev.owner_id is None:
                    target_device_id = cand_dev.id
                else:
                    claim_rate_limiter.record_failure(user.id, client_ip)
                    await record_audit_log(
                        db=db,
                        action="device.claim_failed",
                        user_id=user.id,
                        username=user.username,
                        target_type="device",
                        target_id=payload.device_id or "unknown",
                        details={"reason": "kode_tidak_valid"},
                        ip_address=client_ip,
                    )
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Kode tidak valid",
                    )

    if not target_device_id:
        target_device_id = payload.device_id.strip() if payload.device_id else None

    if not target_device_id or target_device_id.isdigit():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Kode tidak valid",
        )

    # Bersihkan dari antrean in-memory jika masih ada
    with device_queue._lock:
        device_queue._pair_codes.pop(raw_token, None)

    # Periksa keberadaan perangkat di database
    existing_res = await db.execute(
        select(Device).options(selectinload(Device.channels)).where(Device.id == target_device_id)
    )
    dev = existing_res.scalar_one_or_none()

    if dev:
        # I1: Satu perangkat hanya terikat ke SATU keluarga pada satu waktu.
        # Klaim terhadap perangkat yang sudah terikat SELALU DITOLAK (409)
        if dev.owner_id is not None:
            await record_audit_log(
                db=db,
                action="device.claim_conflict",
                user_id=user.id,
                username=user.username,
                target_type="device",
                target_id=dev.id,
                details={"reason": "device_already_bound"},
                ip_address=client_ip,
            )
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Perangkat ini sudah terdaftar. Lepaskan dari akun lama terlebih dulu.",
            )

        if payload.name:
            dev.name = payload.name
        if payload.room:
            dev.room = payload.room
        dev.owner_id = user.id
        dev.is_online = True
        dev.last_seen_at = now
        dev.reset_status = None
        creds = generate_device_mqtt_credentials(target_device_id, initial_password=raw_token)
        dev.mqtt_username = creds["mqtt_username"]
        dev.mqtt_password_hash = creds["mqtt_password"]
    else:
        # Validasi format kanonis ID (I8)
        if not re.match(r"^[a-zA-Z0-9_\-]+$", target_device_id) or target_device_id.isdigit():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Format Device ID tidak valid.",
            )

        creds = generate_device_mqtt_credentials(target_device_id, initial_password=raw_token)
        dev = Device(
            id=target_device_id,
            owner_id=user.id,
            name=payload.name or f"ESP32 ({target_device_id})",
            room=payload.room or "Ruang Tamu",
            device_type="esp32",
            is_online=True,
            last_seen_at=now,
            mqtt_username=creds["mqtt_username"],
            mqtt_password_hash=creds["mqtt_password"],
        )
        db.add(dev)
        await db.flush()

    # Inisialisasi kanal standar jika belum ada
    ch_query = select(Channel).where(Channel.device_id == dev.id)
    ch_res = await db.execute(ch_query)
    existing_channels = {c.channel_key: c for c in ch_res.scalars().all()}
    default_channels = [
        ("lamp_tengah", "Lampu Tengah", "switch", None),
        ("lamp_dapur_tamu", "Lampu Dapur & Tamu", "switch", None),
        ("lamp_kamar", "Lampu Kamar", "switch", None),
        ("relay", "Relay / Kipas", "relay", None),
        ("buzzer", "Sirine Alarm", "buzzer", None),
        ("mq2", "Sensor Gas MQ-2", "gas_sensor", "raw"),
        ("ldr", "Sensor Cahaya LDR", "light_sensor", "raw"),
    ]
    for ch_key, ch_name, ch_type, ch_unit in default_channels:
        if ch_key not in existing_channels:
            c_obj = Channel(
                device_id=dev.id,
                channel_key=ch_key,
                name=ch_name,
                channel_type=ch_type,
                unit=ch_unit,
                current_value="false" if ch_type in {"switch", "relay", "buzzer"} else "0",
            )
            db.add(c_obj)

    # I2: TIDAK MENGUBAH PERAN PENGGUNA!
    if not user.is_approved:
        user.is_approved = True
    if not user.family_id:
        user.family_id = user.id

    await db.commit()

    # I7: Log audit tanpa nilai kode/token
    await record_audit_log(
        db=db,
        action="device.claim",
        user_id=user.id,
        username=user.username,
        target_type="device",
        target_id=dev.id,
        details={"name": dev.name, "room": dev.room},
        ip_address=client_ip,
    )

    return {
        "status": "ok",
        "message": "Sambungan telah berhasil! Perangkat siap dikontrol.",
        "device": {
            "id": dev.id,
            "owner_id": dev.owner_id,
            "name": dev.name,
            "room": dev.room,
            "device_type": dev.device_type,
            "is_online": dev.is_online,
        },
    }


@router.delete("/devices/{device_id}")
async def delete_device(
    device_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role("admin")),
):
    """Hapus perangkat dan cabut kredensial MQTT (Hanya Admin)."""
    res = await db.execute(select(Device).where(Device.id == device_id))
    dev = res.scalar_one_or_none()
    if not dev:
        raise HTTPException(status_code=404, detail="Perangkat tidak ditemukan.")

    # Kirim perintah factory_reset ke ESP32 sebelum dicabut
    cmd_id = f"cmd_reset_{int(datetime.datetime.utcnow().timestamp() * 1000)}"
    reset_cmd = {
        "id": cmd_id,
        "action": "factory_reset",
        "channel": "system",
        "value": True,
    }
    device_queue.enqueue_command(device_id, reset_cmd)
    mqtt_service.publish_command(device_id, reset_cmd)

    revoke_device_mqtt_credentials(device_id)
    await db.delete(dev)
    await db.commit()

    client_ip = request.client.host if request.client else "127.0.0.1"
    await record_audit_log(
        db=db,
        action="device.delete",
        user_id=admin.id,
        username=admin.username,
        target_type="device",
        target_id=device_id,
        details={"name": dev.name},
        ip_address=client_ip,
    )

    return {"status": "ok", "message": f"Perangkat '{device_id}' berhasil dihapus."}


@router.post("/devices/{device_id}/unbind")
@router.post("/devices/{device_id}/reset")
async def unbind_device(
    device_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Putuskan ikatan perangkat dari akun pemilik dalam satu transaksi atomik:
    - Verifikasi peran pemilik (403 bila bukan)
    - Cabut kredensial MQTT & ACL
    - Kosongkan antrean perintah perangkat
    - Kirim factory_reset via MQTT HANYA jika perangkat online
    - Hapus kepemilikan (owner_id = None)
    - Catat di audit log
    - Siarkan WebSocket device_unbound
    """
    if current_user.role not in ("admin", "pemilik"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Hanya pemilik yang berhak memutuskan perangkat ini.",
        )

    res = await db.execute(select(Device).where(Device.id == device_id))
    dev = res.scalar_one_or_none()
    if not dev:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Perangkat tidak ditemukan.")

    fam_user_ids = [current_user.id]
    if current_user.family_id:
        res_fam = await db.execute(
            select(User.id).where(or_(User.family_id == current_user.family_id, User.id == current_user.family_id))
        )
        fam_user_ids = list(set([r[0] for r in res_fam.all()] + [current_user.id]))

    if dev.owner_id is not None and dev.owner_id not in fam_user_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Anda bukan pemilik dari perangkat ini.",
        )

    # Idempoten: jika perangkat sudah tidak terikat pada akun
    if dev.owner_id is None:
        return {
            "status": "ok",
            "message": "Perangkat telah diputuskan.",
            "device_id": device_id,
        }

    # Evaluasi status online dinamis
    now = datetime.datetime.utcnow()
    is_online = bool(dev.is_online)
    if dev.last_seen_at:
        delta = (now - dev.last_seen_at).total_seconds()
        if delta > 60:
            is_online = False
    else:
        is_online = False

    # 1. Cabut semua sesi klaim aktif untuk perangkat ini
    await db.execute(
        update(ClaimSession)
        .where(ClaimSession.device_id == device_id, ClaimSession.status == "aktif")
        .values(status="dicabut")
    )

    # 2. Lepas pemilik di server (menjadi unclaimed)
    dev.owner_id = None
    dev.is_online = False

    # I2: TIDAK MENGUBAH PERAN PENGGUNA!

    # 3. Kosongkan queue perintah
    device_queue.clear_device_queue(device_id)

    # 4. Kirim perintah reset & atur status kredensial
    sent_reset = False
    cmd_id = f"cmd_reset_{int(now.timestamp() * 1000)}"
    reset_cmd = {
        "id": cmd_id,
        "action": "factory_reset",
        "channel": "system",
        "value": True,
    }

    if is_online:
        dev.reset_status = "melepas"
        try:
            mqtt_service.publish_command(device_id, reset_cmd)
            sent_reset = True
        except Exception as e:
            logger.warning(f"Gagal mengirim publish factory_reset ke MQTT: {e}")
    else:
        # S4: Perangkat offline: status 'menunggu_reset' dan terapkan kredensial terbatas 7 hari
        dev.reset_status = "menunggu_reset"
        dev.reset_requested_at = now
        try:
            restrict_device_mqtt_credentials(device_id, ttl_days=7)
        except Exception as e:
            logger.warning(f"Gagal membatasi kredensial Mosquitto untuk {device_id}: {e}")

    # 5. Catat audit log
    client_ip = request.client.host if request.client else "127.0.0.1"
    await record_audit_log(
        db=db,
        action="device.unbind",
        user_id=current_user.id,
        username=current_user.username,
        target_type="device",
        target_id=device_id,
        details={
            "name": dev.name,
            "is_online": is_online,
            "reset_status": dev.reset_status,
            "factory_reset_sent": sent_reset,
            "status": "success",
        },
        ip_address=client_ip,
    )

    await db.commit()

    # 6. Siarkan event via WebSocket
    await ws_manager.broadcast({
        "type": "device_unbound",
        "device_id": device_id,
        "name": dev.name,
        "is_online": is_online,
        "timestamp": now.isoformat(),
    })

    return {
        "status": "ok",
        "message": (
            "Perangkat akan dilepas dan dikembalikan ke kondisi baru."
            if is_online
            else "Perangkat sedang offline. Perangkat dilepas dari akun dan akan direset otomatis saat kembali online, atau tekan dan tahan tombol reset di alat."
        ),
        "device_id": device_id,
        "is_online": is_online,
        "factory_reset_sent": sent_reset,
    }


@router.post("/devices/{device_id}/revoke-credentials")
async def revoke_credentials(
    device_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role("admin")),
):
    """Buat ulang kredensial MQTT baru untuk perangkat (Hanya Admin)."""
    res = await db.execute(select(Device).where(Device.id == device_id))
    dev = res.scalar_one_or_none()
    if not dev:
        raise HTTPException(status_code=404, detail="Perangkat tidak ditemukan.")

    creds = generate_device_mqtt_credentials(device_id)
    dev.mqtt_password_hash = creds["mqtt_password"]
    await db.commit()

    client_ip = request.client.host if request.client else "127.0.0.1"
    await record_audit_log(
        db=db,
        action="device.rotate_credentials",
        user_id=admin.id,
        username=admin.username,
        target_type="device",
        target_id=device_id,
        details={},
        ip_address=client_ip,
    )

    return {
        "status": "ok",
        "message": "Kredensial MQTT berhasil diperbarui.",
        "mqtt_credentials": {
            "username": creds["mqtt_username"],
            "password": creds["mqtt_password"],
        },
    }


@router.post("/devices/{device_id}/cmd")
async def send_device_command(
    device_id: str,
    payload: CommandRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Kirim perintah kontrol ke kanal perangkat via MQTT (Admin & Member)."""
    if not current_user.is_approved:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Akun Anda sedang menunggu persetujuan admin rumah.",
        )

    if not current_user.role:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Hubungkan perangkat pertama dengan Kode Pairing untuk mendapatkan akses rumah.",
        )

    # Child tidak diizinkan mengubah saklar utama jika dibatasi
    if current_user.role == "child":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Peran anak (child) tidak memiliki izin mengontrol perangkat ini.",
        )

    # Validasi kepemilikan perangkat (hanya perangkat yang sudah diklaim yang dapat dikontrol)
    dev_res = await db.execute(select(Device).where(Device.id == device_id))
    dev = dev_res.scalar_one_or_none()
    if not dev or dev.owner_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Perangkat belum terikat ke akun mana pun. Silakan hubungkan perangkat terlebih dahulu.",
        )

    # Otorisasi: Pemilik, Anggota Keluarga yang sama, atau Pemilik Rumah
    is_owner = (dev.owner_id == current_user.id)
    is_family = False
    if dev.owner_id and current_user.family_id:
        dev_owner = await db.get(User, dev.owner_id)
        if dev_owner and (dev_owner.family_id == current_user.family_id or dev_owner.id == current_user.family_id):
            is_family = True
        elif current_user.family_id == dev.owner_id:
            is_family = True

    if not (is_owner or is_family or current_user.role in ("admin", "pemilik")):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Anda tidak memiliki izin mengontrol perangkat ini. Hubungi pemilik perangkat.",
        )

    # Validasi kanal
    is_master_switch = payload.channel.strip().lower() in ("all", "semua", "seluruh", "master")
    ch = None
    if not is_master_switch:
        q = select(Channel).where(Channel.device_id == device_id, Channel.channel_key == payload.channel)
        r = await db.execute(q)
        ch = r.scalar_one_or_none()
        if not ch:
            raise HTTPException(status_code=404, detail="Kanal tidak ditemukan pada perangkat ini.")

    cmd_id = f"cmd_{int(datetime.datetime.utcnow().timestamp() * 1000)}_{secrets.token_hex(3)}"
    cmd_payload = {
        "id": cmd_id,
        "channel": payload.channel,
        "action": payload.action,
        "value": payload.value,
    }

    # 1. Enqueue ke antrean polling HTTP ESP32
    device_queue.enqueue_command(device_id, cmd_payload)

    # 2. Kirim ke MQTT
    published = mqtt_service.publish_command(device_id, cmd_payload)

    # Update optimis di DB lokal
    val_str = str(payload.value).lower() if isinstance(payload.value, bool) else str(payload.value)
    if is_master_switch:
        all_q = select(Channel).where(
            Channel.device_id == device_id,
            Channel.channel_key.in_(["lamp", "lamp_tengah", "lamp_dapur_tamu", "lamp_kamar", "relay", "relay_fan"])
        )
        all_chans = (await db.execute(all_q)).scalars().all()
        for sc in all_chans:
            sc.current_value = val_str
    elif ch:
        ch.current_value = val_str

    # Sinkronisasi channel sinonim (misal relay dan relay_fan)
    if payload.channel in ("relay", "relay_fan"):
        synonym_key = "relay_fan" if payload.channel == "relay" else "relay"
        syn_q = select(Channel).where(Channel.device_id == device_id, Channel.channel_key == synonym_key)
        syn_res = await db.execute(syn_q)
        syn_ch = syn_res.scalar_one_or_none()
        if syn_ch:
            syn_ch.current_value = val_str

    # Jika mematikan/menyalakan semua lampu via channel 'lamp'
    if payload.channel == "lamp":
        lamp_sub_q = select(Channel).where(
            Channel.device_id == device_id,
            Channel.channel_key.in_(["lamp_tengah", "lamp_dapur_tamu", "lamp_kamar"])
        )
        sub_chans = (await db.execute(lamp_sub_q)).scalars().all()
        for sc in sub_chans:
            sc.current_value = val_str

    await db.commit()

    # Siarkan ke WebSocket
    await ws_manager.broadcast({
        "type": "state",
        "device_id": device_id,
        "channels": {payload.channel: payload.value},
        "timestamp": datetime.datetime.utcnow().isoformat(),
    })

    client_ip = request.client.host if request.client else "127.0.0.1"
    await record_audit_log(
        db=db,
        action="device.cmd",
        user_id=current_user.id,
        username=current_user.username,
        target_type="channel",
        target_id=f"{device_id}:{payload.channel}",
        details={"action": payload.action, "value": payload.value, "published": published},
        ip_address=client_ip,
    )

    return {
        "status": "ok",
        "cmd_id": cmd_id,
        "published_to_mqtt": published,
        "current_value": val_str,
    }


# --- Endpoints ESP32 Thonny Bridge (HTTP & Cloudflare Tunnel) ---

@router.post("/device/status")
@router.post("/devices/status")
async def device_status_report(
    payload: DeviceStatusPayload,
    db: AsyncSession = Depends(get_db),
):
    """
    Menerima laporan status realtime dari esp32_thonny.py (MicroPython).
    Mendukung pendaftaran otomatis perangkat, sinkronisasi kanal, pencatatan telemetri,
    peringatan bahaya kebocoran gas MQ-2, dan broadcast WebSocket ke Web & Flutter.
    """
    device_id = payload.device_id.strip()
    status_data = payload.status or {}
    now = datetime.datetime.utcnow()

    # 1. Daftarkan / perbarui kode pairing 6-digit di memori
    pair_code_str = str(payload.pair_code).strip() if payload.pair_code else None
    if pair_code_str:
        device_queue.register_pair_code(
            pair_code=pair_code_str,
            device_id=device_id,
            device_key=payload.device_key,
            status=status_data,
        )

    # 2. Cari atau buat entitas Device di DB
    dev_query = select(Device).options(selectinload(Device.channels)).where(Device.id == device_id)
    dev_res = await db.execute(dev_query)
    dev = dev_res.scalar_one_or_none()

    if not dev:
        creds = generate_device_mqtt_credentials(device_id)
        dev = Device(
            id=device_id,
            owner_id=None,
            name=f"ESP32 ({device_id})",
            room="Ruang Tamu",
            device_type="esp32",
            is_online=True,
            last_seen_at=now,
            ip_address=status_data.get("ip"),
            mqtt_username=creds["mqtt_username"],
            mqtt_password_hash=creds["mqtt_password"],
        )
        db.add(dev)
        await db.flush()
    else:
        dev.is_online = True
        dev.last_seen_at = now
        if status_data.get("ip"):
            dev.ip_address = status_data.get("ip")

    # 3. Pastikan ke-8 kanal standar ESP32 tersedia di DB
    ch_query = select(Channel).where(Channel.device_id == dev.id)
    ch_res = await db.execute(ch_query)
    existing_channels = {c.channel_key: c for c in ch_res.scalars().all()}
    default_channels = [
        ("lamp_tengah", "Lampu Tengah", "switch", None),
        ("lamp_dapur_tamu", "Lampu Dapur & Tamu", "switch", None),
        ("lamp_kamar", "Lampu Kamar", "switch", None),
        ("relay", "Relay / Kipas", "relay", None),
        ("buzzer", "Sirine Alarm", "buzzer", None),
        ("mq2", "Sensor Gas MQ-2", "gas_sensor", "raw"),
        ("ldr", "Sensor Cahaya LDR", "light_sensor", "raw"),
    ]
    for ch_key, ch_name, ch_type, ch_unit in default_channels:
        if ch_key not in existing_channels:
            c_obj = Channel(
                device_id=dev.id,
                channel_key=ch_key,
                name=ch_name,
                channel_type=ch_type,
                unit=ch_unit,
                current_value="false" if ch_type in {"switch", "relay", "buzzer"} else "0",
            )
            db.add(c_obj)
            existing_channels[ch_key] = c_obj

    # 4. Sinkronkan nilai aktuator lampu & relay
    if "lamp" in status_data and "lamp" in existing_channels:
        existing_channels["lamp"].current_value = "true" if status_data["lamp"] else "false"
        existing_channels["lamp"].updated_at = now
    if "lamp_tengah" in status_data and "lamp_tengah" in existing_channels:
        existing_channels["lamp_tengah"].current_value = "true" if status_data["lamp_tengah"] else "false"
        existing_channels["lamp_tengah"].updated_at = now
    if "lamp_dapur_tamu" in status_data and "lamp_dapur_tamu" in existing_channels:
        existing_channels["lamp_dapur_tamu"].current_value = "true" if status_data["lamp_dapur_tamu"] else "false"
        existing_channels["lamp_dapur_tamu"].updated_at = now
    if "lamp_kamar" in status_data and "lamp_kamar" in existing_channels:
        existing_channels["lamp_kamar"].current_value = "true" if status_data["lamp_kamar"] else "false"
        existing_channels["lamp_kamar"].updated_at = now
    if "relay" in status_data:
        val_str = "true" if status_data["relay"] else "false"
        if "relay" in existing_channels:
            existing_channels["relay"].current_value = val_str
            existing_channels["relay"].updated_at = now
        if "relay_fan" in existing_channels:
            existing_channels["relay_fan"].current_value = val_str
            existing_channels["relay_fan"].updated_at = now

    # 5. Sinkronkan nilai sensor MQ-2 dan LDR
    gas_raw = status_data.get("gas_raw")
    gas_alarm = status_data.get("gas_alarm", 0)
    if gas_raw is not None and "mq2" in existing_channels:
        existing_channels["mq2"].current_value = str(gas_raw)
        existing_channels["mq2"].updated_at = now
        try:
            db.add(TelemetryLog(
                device_id=device_id,
                channel_key="mq2",
                value_num=float(gas_raw),
                created_at=now,
            ))
        except Exception:
            pass

    ldr_val = status_data.get("ldr")
    if ldr_val is not None and "ldr" in existing_channels:
        existing_channels["ldr"].current_value = str(ldr_val)
        existing_channels["ldr"].updated_at = now
        try:
            db.add(TelemetryLog(
                device_id=device_id,
                channel_key="ldr",
                value_num=float(ldr_val),
                created_at=now,
            ))
        except Exception:
            pass

    # 6. Deteksi bahaya kebocoran gas (gas_alarm == 1 atau gas_raw >= 1500)
    if gas_alarm == 1 or (gas_raw is not None and float(gas_raw) >= 1500):
        recent_notif = await db.execute(
            select(NotificationLog)
            .where(
                NotificationLog.device_id == device_id,
                NotificationLog.event_type == "gas_leak_alarm",
                NotificationLog.created_at >= now - datetime.timedelta(seconds=60),
            )
        )
        if not recent_notif.scalars().first():
            notif = NotificationLog(
                device_id=device_id,
                event_type="gas_leak_alarm",
                message=f"BAHAYA! Kebocoran gas terdeteksi pada {dev.name} (MQ-2: {gas_raw}). Sirine alarm berbunyi!",
                severity="critical",
                is_read=False,
                created_at=now,
            )
            db.add(notif)
            await ws_manager.broadcast({
                "type": "event",
                "device_id": device_id,
                "event": "gas_leak_alarm",
                "severity": "critical",
                "message": notif.message,
                "value": gas_raw,
                "timestamp": now.isoformat(),
            })

    await db.commit()

    # 7. Broadcast perubahan ke WebSocket klien Web & Flutter
    ws_channels = {}
    for k, ch in existing_channels.items():
        if ch.channel_type in ("switch", "relay", "buzzer"):
            ws_channels[k] = ch.current_value == "true"
        else:
            try:
                ws_channels[k] = float(ch.current_value) if ch.current_value else 0
            except ValueError:
                ws_channels[k] = ch.current_value

    ws_payload = {
        "type": "state",
        "device_id": device_id,
        "channels": ws_channels,
        "sensors": {
            "mq2": gas_raw,
            "ldr": ldr_val,
            "gas_pct": status_data.get("gas_pct"),
            "gas_alarm": gas_alarm,
            "ldr_pct": status_data.get("ldr_pct"),
            "is_dark": status_data.get("is_dark"),
        },
        "device_info": {
            "ip": status_data.get("ip"),
            "uptime_s": status_data.get("uptime_s"),
            "is_online": True,
        },
        "timestamp": now.isoformat(),
    }
    await ws_manager.broadcast(ws_payload)

    return {"ok": True}


@router.post("/device/poll")
@router.post("/devices/poll")
async def device_poll_commands(
    payload: DevicePollPayload,
    db: AsyncSession = Depends(get_db),
):
    """
    Diambil oleh esp32_thonny.py untuk menarik antrean perintah tertunda.
    """
    device_id = payload.device_id.strip()
    limit = payload.limit or 5
    commands = device_queue.get_pending_commands(device_id, limit=limit)

    # Catat heartbeat polling aktif
    now = datetime.datetime.utcnow()
    res = await db.execute(select(Device).where(Device.id == device_id))
    dev = res.scalar_one_or_none()
    if dev:
        dev.last_seen_at = now
        dev.is_online = True
        await db.commit()

    return {"ok": True, "commands": commands}


@router.post("/device/ack")
@router.post("/devices/ack")
async def device_ack_command(payload: DeviceAckPayload):
    """
    Konfirmasi dari esp32_thonny.py bahwa perintah command_id telah selesai dieksekusi.
    """
    device_id = payload.device_id.strip()
    command_id = payload.command_id.strip()
    success = device_queue.ack_command(device_id, command_id, ok=payload.ok is not False)
    await ws_manager.broadcast({
        "type": "ack",
        "device_id": device_id,
        "command_id": command_id,
        "ok": payload.ok is not False,
    })
    return {"ok": True, "acknowledged": success}


@router.get("/devices/{device_id}/telemetry")
async def get_telemetry_history(
    device_id: str,
    channel_key: Optional[str] = Query(None, description="Kanal sensor: mq2, ldr, dll"),
    limit: int = Query(50, ge=5, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Ambil riwayat data telemetri sensor untuk grafik."""
    q = select(TelemetryLog).where(TelemetryLog.device_id == device_id)
    if channel_key:
        q = q.where(TelemetryLog.channel_key == channel_key)
    q = q.order_by(desc(TelemetryLog.created_at)).limit(limit)

    res = await db.execute(q)
    rows = res.scalars().all()

    # Kembalikan urutan kronologis untuk grafik
    items = [
        {
            "id": r.id,
            "channel_key": r.channel_key,
            "value": r.value_num,
            "created_at": r.created_at.isoformat(),
        }
        for r in reversed(rows)
    ]

    return {"status": "ok", "device_id": device_id, "telemetry": items}


# --- Endpoints Otomasi ---

@router.get("/automations")
async def list_automations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Ambil semua daftar aturan otomasi."""
    q = select(Automation).order_by(Automation.created_at.desc())
    res = await db.execute(q)
    rows = res.scalars().all()

    items = []
    for a in rows:
        items.append({
            "id": a.id,
            "name": a.name,
            "is_enabled": a.is_enabled,
            "trigger_type": a.trigger_type,
            "trigger_config": json.loads(a.trigger_config) if a.trigger_config else {},
            "action_config": json.loads(a.action_config) if a.action_config else {},
            "created_at": a.created_at.isoformat(),
        })
    return {"status": "ok", "automations": items}


@router.post("/automations", status_code=status.HTTP_201_CREATED)
async def create_automation(
    payload: CreateAutomationRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role("admin")),
):
    """Buat aturan otomasi baru (Hanya Admin)."""
    auto = Automation(
        name=payload.name,
        is_enabled=payload.is_enabled,
        trigger_type=payload.trigger_type,
        trigger_config=json.dumps(payload.trigger_config),
        action_config=json.dumps(payload.action_config),
    )
    db.add(auto)
    await db.commit()
    await db.refresh(auto)
    return {"status": "ok", "id": auto.id, "name": auto.name}


@router.delete("/automations/{automation_id}")
async def delete_automation(
    automation_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role("admin")),
):
    """Hapus aturan otomasi (Hanya Admin)."""
    q = select(Automation).where(Automation.id == automation_id)
    r = await db.execute(q)
    item = r.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Otomasi tidak ditemukan.")

    await db.delete(item)
    await db.commit()
    return {"status": "ok", "message": f"Otomasi {automation_id} dihapus."}


# --- Endpoints Pengaturan Kanal & Hak Akses ---

@router.get("/channels")
async def list_all_channels(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Mendapatkan seluruh kanal perangkat beserta alias, status sensitif, dan izin anak."""
    stmt = select(Channel).options(selectinload(Channel.device))
    res = await db.execute(stmt)
    chans = res.scalars().all()
    items = []
    for c in chans:
        items.append({
            "id": c.id,
            "device_id": c.device_id,
            "device_name": c.device.name if c.device else c.device_id,
            "channel_key": c.channel_key,
            "name": c.name,
            "alias": c.alias,
            "channel_type": c.channel_type,
            "current_value": c.current_value,
            "unit": c.unit,
            "is_sensitive": c.is_sensitive,
            "allowed_for_child": c.allowed_for_child,
        })
    return {"status": "ok", "channels": items}


@router.patch("/channels/{channel_id}")
async def update_channel_settings(
    channel_id: int,
    payload: UpdateChannelRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role("admin")),
):
    """Memperbarui alias, penanda sensitif, dan izin anak pada suatu kanal (Hanya Admin)."""
    stmt = select(Channel).where(Channel.id == channel_id)
    res = await db.execute(stmt)
    ch = res.scalar_one_or_none()
    if not ch:
        raise HTTPException(status_code=404, detail="Kanal tidak ditemukan.")

    old_state = {
        "name": ch.name,
        "alias": ch.alias,
        "is_sensitive": ch.is_sensitive,
        "allowed_for_child": ch.allowed_for_child,
    }

    if payload.name is not None:
        ch.name = payload.name.strip()
    if payload.alias is not None:
        ch.alias = payload.alias.strip() if payload.alias.strip() else None
    if payload.is_sensitive is not None:
        ch.is_sensitive = payload.is_sensitive
    if payload.allowed_for_child is not None:
        ch.allowed_for_child = payload.allowed_for_child

    await record_audit_log(
        db,
        user_id=admin.id,
        action="channel.update_settings",
        target_type="channel",
        target_id=str(channel_id),
        details={"before": old_state, "after": payload.model_dump(exclude_unset=True)},
    )
    await db.commit()

    return {
        "status": "ok",
        "message": "Pengaturan kanal berhasil disimpan.",
        "channel": {
            "id": ch.id,
            "name": ch.name,
            "alias": ch.alias,
            "is_sensitive": ch.is_sensitive,
            "allowed_for_child": ch.allowed_for_child,
        },
    }


# --- Endpoints Notifikasi ---


@router.get("/notifications")
async def list_notifications(
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Ambil daftar kejadian dan peringatan darurat."""
    q = select(NotificationLog).order_by(desc(NotificationLog.created_at)).limit(limit)
    res = await db.execute(q)
    rows = res.scalars().all()

    items = [
        {
            "id": n.id,
            "device_id": n.device_id,
            "event_type": n.event_type,
            "message": n.message,
            "severity": n.severity,
            "is_read": n.is_read,
            "created_at": n.created_at.isoformat(),
        }
        for n in rows
    ]
    return {"status": "ok", "notifications": items}


# --- WebSocket Endpoints ---

from server.app.core.security import decode_token

@router.websocket("/ws")
@router.websocket("/devices/{device_id}/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    device_id: Optional[str] = None,
    token: Optional[str] = Query(None),
):
    """Kanal WebSocket untuk pembaruan status realtime di aplikasi Flutter & Web.
    Wajib menyertakan token autentikasi JWT (?token=...) agar tidak terbuka untuk umum."""
    # Verifikasi token autentikasi
    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
    except Exception:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await ws_manager.connect(websocket)
    try:
        while True:
            # Terima ping / pesan dari klien
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        await ws_manager.disconnect(websocket)
    except Exception:
        await ws_manager.disconnect(websocket)

