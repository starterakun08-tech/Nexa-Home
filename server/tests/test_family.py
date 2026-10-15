"""
Unit & Integration Test untuk Analitik Keluarga (Tahap 6).
Mencakup:
1. Keamanan RBAC: non-admin (member & child) ditolak 403, dicatat di audit log.
2. Transparansi 'Apa yang dipantau' (/transparency) terbuka untuk semua peran tanpa data sensitif.
3. Saklar Asisten: mati = 'dinonaktifkan' & tanpa data keluar; hidup = angka agregat tanpa nama.
4. Urutan aturan sintetis:
   - Zona Belajar (duduk + toleransi jeda)
   - Larut Malam (jam 23:00 - 04:30 + penanda HP)
   - Kemungkinan Jatuh (berbaring + diam >= 30 detik, peringatan segera)
   - Tidak Bergerak Lama (>= 120 menit)
   - Zona Berbahaya (alarm gas aktif)
5. Tombol 'Hapus semua data keluarga' benar-benar menghapus data.
6. Ketahanan status AI: jika heartbeat stale, status 'offline' / 'AI tidak aktif'.
"""

import asyncio
from datetime import datetime, time, timedelta, timezone
import json
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from server.app.core.assistant.tools import AssistantToolExecutor
from server.app.core.config import settings
from server.app.core.database import Base, get_db
from server.app.core.family.rules_engine import FamilyRulesEngine, generate_local_family_summary
from server.app.core.family.zone_checker import is_person_in_zone, point_in_polygon
from server.app.core.security import create_access_token
from server.app.main import app
from server.app.models.audit import AuditLog
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


@pytest_asyncio.fixture
async def test_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    sm = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    yield sm
    await engine.dispose()


@pytest_asyncio.fixture
async def client(test_db):
    async def override_get_db():
        async with test_db() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_non_admin_forbidden_and_audit_logging(test_db, client):
    """Pengujian keamanan: Non-admin mendapat 403 Forbidden pada seluruh endpoint data keluarga."""
    async with test_db() as db:
        admin = User(id=1, username="admin_user", role="admin", password_hash="test_hash")
        member = User(id=2, username="member_user", role="member", password_hash="test_hash")
        child = User(id=3, username="child_user", role="child", password_hash="test_hash")
        db.add_all([admin, member, child])
        await db.commit()

    admin_token = create_access_token(1, "admin_user", "admin")
    member_token = create_access_token(2, "member_user", "member")
    child_token = create_access_token(3, "child_user", "child")

    protected_endpoints = [
        ("GET", "/api/family/settings"),
        ("PUT", "/api/family/settings"),
        ("GET", "/api/family/zones"),
        ("POST", "/api/family/zones"),
        ("GET", "/api/family/summary"),
        ("GET", "/api/family/events"),
        ("DELETE", "/api/family/data?confirm=true"),
    ]

    for method, ep in protected_endpoints:
        # Member -> 403
        headers_m = {"Authorization": f"Bearer {member_token}"}
        resp_m = await client.request(method, ep, headers=headers_m, json={})
        assert resp_m.status_code == 403, f"Member should be 403 on {ep}, got {resp_m.status_code}"

        # Child -> 403
        headers_c = {"Authorization": f"Bearer {child_token}"}
        resp_c = await client.request(method, ep, headers=headers_c, json={})
        assert resp_c.status_code == 403, f"Child should be 403 on {ep}, got {resp_c.status_code}"

    # Admin diizinkan pada GET settings
    headers_a = {"Authorization": f"Bearer {admin_token}"}
    resp_a = await client.get("/api/family/settings", headers=headers_a)
    assert resp_a.status_code == 200

    # Periksa audit log tercatat untuk akses admin
    async with test_db() as db:
        stmt = select(AuditLog).where(AuditLog.action == "family.settings.read")
        audit_entry = (await db.execute(stmt)).scalar_one_or_none()
        assert audit_entry is not None
        assert audit_entry.username == "admin_user"


@pytest.mark.asyncio
async def test_transparency_accessible_by_all_roles(test_db, client):
    """Halaman transparansi dapat diakses oleh semua peran dan tidak membocorkan data metrik."""
    async with test_db() as db:
        admin = User(id=1, username="admin_user", role="admin", password_hash="test_hash")
        child = User(id=3, username="child_user", role="child", password_hash="test_hash")
        cam = Camera(id="cam_living", name="Kamera Ruang Tamu", room_id="living_room", status="online")
        db.add_all([admin, child, cam])
        await db.commit()

    child_token = create_access_token(3, "child_user", "child")
    headers = {"Authorization": f"Bearer {child_token}"}

    resp = await client.get("/api/family/transparency", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "success"
    assert "Bukan alat medis" in data["disclaimer"]
    assert "active_features" in data
    assert "monitored_cameras" in data
    # Pastikan TIDAK ada metrik durasi, kejadian, atau log orang
    assert "events" not in data
    assert "study_minutes" not in data


@pytest.mark.asyncio
async def test_assistant_family_summary_switch(test_db):
    """Uji saklar asisten: mati = dinonaktifkan tanpa data; hidup = hanya angka agregat."""
    admin_user = User(id=1, username="admin_user", role="admin", password_hash="test_hash")

    async with test_db() as db:
        db.add(admin_user)
        fam_cfg = FamilySettings(id="default", allow_assistant_family_summary=False)
        db.add(fam_cfg)
        await db.commit()

        executor = AssistantToolExecutor(db, admin_user)

        # 1. Saat saklar MATI -> tolak jujur
        res_off = await executor.execute_tool("get_family_summary", {"range": "hari_ini"})
        assert res_off.get("status") == "disabled"
        assert res_off.get("result") == "dinonaktifkan"
        assert "dinonaktifkan oleh administrator" in res_off.get("message")

        # 2. Nyalakan saklar
        fam_cfg.allow_assistant_family_summary = True
        today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        summary = FamilyDailySummary(
            id="sum_1",
            date=today_str,
            study_minutes=145,
            late_night_count=1,
            fall_incident_count=0,
            inactivity_count=0,
            hazard_alert_count=0,
            summary_text="Total 2 jam 25 menit di Zona Belajar.",
        )
        db.add(summary)
        await db.commit()

        # 3. Saat saklar HIDUP -> kembalikan angka agregat tanpa nama
        res_on = await executor.execute_tool("get_family_summary", {"range": "hari_ini"})
        assert res_on.get("status") == "success"
        assert res_on.get("study_minutes") == 145
        assert res_on.get("late_night_count") == 1
        assert "names" not in res_on


@pytest.mark.asyncio
async def test_synthetic_rules_study_activity():
    """Aturan 1: Sesi belajar dengan toleransi jeda <= N menit."""
    engine = FamilyRulesEngine()
    fam_cfg = FamilySettings(enabled=True, study_zone_enabled=True, study_gap_tolerance_minutes=5)
    zone = CameraZone(
        id="zone_study_1",
        camera_id="cam_1",
        name="Meja Belajar",
        zone_type="belajar",
        polygon_json="[[0.1, 0.1], [0.5, 0.1], [0.5, 0.5], [0.1, 0.5]]",
    )

    t0 = datetime(2026, 10, 13, 14, 0, 0, tzinfo=timezone.utc)

    # Frame 1: Duduk di zona belajar + buku terdeteksi
    person_in = [{"bbox": (0.2, 0.2, 0.4, 0.45), "posture": "duduk"}]
    other_items = [{"class_name": "book"}]
    ev1 = await engine.evaluate_frame("cam_1", "room_1", "Ruang Belajar", person_in, other_items, [zone], fam_cfg, t0)
    assert len(ev1) == 0  # Sesi baru mulai

    # Frame 2: 30 menit kemudian, masih duduk
    t1 = t0 + timedelta(minutes=30)
    ev2 = await engine.evaluate_frame("cam_1", "room_1", "Ruang Belajar", person_in, other_items, [zone], fam_cfg, t1)
    assert len(ev2) == 0

    # Frame 3: Melewati batas toleransi jeda 6 menit (> 5 menit config)
    t2 = t1 + timedelta(minutes=6)
    ev3 = await engine.evaluate_frame("cam_1", "room_1", "Ruang Belajar", [], [], [zone], fam_cfg, t2)
    assert len(ev3) == 1
    ev = ev3[0]
    assert ev.event_type == "study_activity"
    assert "Meja Belajar" in ev.title
    meta = json.loads(ev.metadata_json)
    assert meta["duration_minutes"] >= 30
    assert meta["book_detected"] is True


@pytest.mark.asyncio
async def test_synthetic_rules_late_night_activity():
    """Aturan 2: Aktivitas larut malam pada jam 23:00 - 04:30 >= N menit."""
    engine = FamilyRulesEngine()
    fam_cfg = FamilySettings(
        enabled=True,
        late_night_enabled=True,
        late_night_start="23:00",
        late_night_end="04:30",
        late_night_min_minutes=15,
    )

    # Waktu pukul 01:00 dini hari
    t0 = datetime(2026, 10, 13, 1, 0, 0)
    person = [{"bbox": (0.2, 0.2, 0.4, 0.8), "posture": "berdiri"}]

    # Menit ke-0: Baru masuk ruang tamu
    ev0 = await engine.evaluate_frame("cam_1", "living_room", "Ruang Tamu", person, [], [], fam_cfg, t0)
    assert len(ev0) == 0

    # Menit ke-15: Melewati batas 15 menit tanpa HP
    t15 = t0 + timedelta(minutes=15)
    ev15 = await engine.evaluate_frame("cam_1", "living_room", "Ruang Tamu", person, [], [], fam_cfg, t15)
    assert len(ev15) == 1
    assert ev15[0].event_type == "late_night"
    assert "deteksi HP sering terlewat" in ev15[0].description
    assert "bermain HP" not in ev15[0].description


@pytest.mark.asyncio
async def test_synthetic_rules_fall_detection():
    """Aturan 3: Postur berubah ke berbaring dan tidak bergerak >= 30 detik."""
    engine = FamilyRulesEngine()
    fam_cfg = FamilySettings(enabled=True, fall_detection_enabled=True, fall_stationary_seconds=30)

    t0 = datetime(2026, 10, 13, 10, 0, 0, tzinfo=timezone.utc)
    person_fall = [{"bbox": (100, 200, 300, 280), "posture": "berbaring", "foot_point": (200.0, 280.0)}]

    # Detik 0: Mulai berbaring
    ev0 = await engine.evaluate_frame("cam_1", "living_room", "Ruang Tamu", person_fall, [], [], fam_cfg, t0)
    assert len(ev0) == 0

    # Detik 30: Tetap berbaring dan tidak bergerak
    t30 = t0 + timedelta(seconds=30)
    ev30 = await engine.evaluate_frame("cam_1", "living_room", "Ruang Tamu", person_fall, [], [], fam_cfg, t30)
    assert len(ev30) == 1
    assert ev30[0].event_type == "fall_detected"
    assert ev30[0].severity == "critical"
    assert "Kemungkinan ada yang jatuh" in ev30[0].description


@pytest.mark.asyncio
async def test_synthetic_rules_hazardous_zone():
    """Aturan 5: Orang di zona berbahaya saat alarm gas aktif."""
    engine = FamilyRulesEngine()
    fam_cfg = FamilySettings(enabled=True, hazard_zone_enabled=True)
    zone_dapur = CameraZone(
        id="zone_dapur_1",
        camera_id="cam_kitchen",
        name="Area Kompor",
        zone_type="berbahaya",
        polygon_json="[[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]",
    )

    now = datetime(2026, 10, 13, 12, 0, 0, tzinfo=timezone.utc)
    person = [{"bbox": (0.3, 0.3, 0.5, 0.7), "posture": "berdiri"}]

    # 1. Alarm gas mati -> tidak ada kejadian
    ev_safe = await engine.evaluate_frame("cam_kitchen", "kitchen", "Dapur", person, [], [zone_dapur], fam_cfg, now, is_gas_alarm_active=False)
    assert len(ev_safe) == 0

    # 2. Alarm gas aktif -> peringatan kritis segera
    ev_hazard = await engine.evaluate_frame("cam_kitchen", "kitchen", "Dapur", person, [], [zone_dapur], fam_cfg, now, is_gas_alarm_active=True)
    assert len(ev_hazard) == 1
    assert ev_hazard[0].event_type == "hazardous_zone"
    assert ev_hazard[0].severity == "critical"
    assert "alarm gas aktif" in ev_hazard[0].description


@pytest.mark.asyncio
async def test_clear_all_family_data(test_db, client):
    """Pengujian tombol 'Hapus semua data keluarga' dengan konfirmasi."""
    async with test_db() as db:
        admin = User(id=1, username="admin_user", role="admin", password_hash="test_hash")
        ev = FamilyEventLog(
            id="ev_1",
            event_type="late_night",
            camera_id="cam_1",
            room_id="living",
            title="Test Event",
            description="Test Description",
        )
        sm = FamilyDailySummary(
            id="sm_1",
            date="2026-10-13",
            summary_text="Test Summary",
        )
        db.add_all([admin, ev, sm])
        await db.commit()

    admin_token = create_access_token(1, "admin_user", "admin")
    headers = {"Authorization": f"Bearer {admin_token}"}

    # Tanpa konfirmasi -> 400 Bad Request
    resp_bad = await client.delete("/api/family/data", headers=headers)
    assert resp_bad.status_code == 400

    # Dengan konfirmasi -> 200 OK dan data terhapus
    resp_ok = await client.delete("/api/family/data?confirm=true", headers=headers)
    assert resp_ok.status_code == 200

    async with test_db() as db:
        events_rem = (await db.execute(select(FamilyEventLog))).scalars().all()
        summaries_rem = (await db.execute(select(FamilyDailySummary))).scalars().all()
        assert len(events_rem) == 0
        assert len(summaries_rem) == 0


@pytest.mark.asyncio
async def test_ai_worker_resilience_status(test_db, client):
    """Ketahanan: Jika worker AI mati (heartbeat stale), transparansi menampilkan offline / 'AI tidak aktif'."""
    async with test_db() as db:
        user = User(id=1, username="test_user", role="admin", password_hash="test_hash")
        # Heartbeat 60 detik yang lalu (timeout 15 detik)
        stale_time = datetime.now(timezone.utc) - timedelta(seconds=60)
        hb = AIWorkerHeartbeat(id="vision_worker_1", status="online", last_heartbeat=stale_time)
        db.add_all([user, hb])
        await db.commit()

    token = create_access_token(1, "test_user", "admin")
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.get("/api/family/transparency", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["ai_worker_status"] == "offline"


@pytest.mark.asyncio
async def test_family_invite_unauthorized(test_db, client):
    """Member biasa tanpa perangkat tidak diizinkan mengundang keluarga (403)."""
    async with test_db() as db:
        member = User(id=10, username="regular_member", role="member", password_hash="hash")
        db.add(member)
        await db.commit()

    token = create_access_token(10, "regular_member", "member")
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.post("/api/family/invite", json={"email": "target@example.com"}, headers=headers)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_family_invite_success_and_duplicate_prevention(test_db, client):
    """Pemilik rumah dapat mengundang anggota keluarga, dan sistem mencegah duplikasi undangan aktif."""
    async with test_db() as db:
        admin = User(id=1, username="owner_admin", email="owner@home.com", role="admin", password_hash="hash")
        target = User(id=2, username="dtrbimu", email="dtrbimu@example.com", role="member", password_hash="hash")
        db.add_all([admin, target])
        await db.commit()

    token = create_access_token(1, "owner_admin", "admin")
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Kirim undangan berhasil
    resp = await client.post("/api/family/invite", json={"email": "dtrbimu@example.com"}, headers=headers)
    assert resp.status_code == 201
    data = resp.json()
    assert data["status"] == "ok"
    assert data["invitation"]["invitee_email"] == "dtrbimu@example.com"
    assert data["invitation"]["status"] == "pending"

    # 2. Coba kirim lagi ke email yang sama (duplikat aktif) -> 400 Bad Request
    resp_dup = await client.post("/api/family/invite", json={"email": "dtrbimu@example.com"}, headers=headers)
    assert resp_dup.status_code == 400
    assert "sudah dikirim" in resp_dup.json()["detail"].lower()

    # 3. Coba undang diri sendiri -> 400 Bad Request
    resp_self = await client.post("/api/family/invite", json={"email": "owner@home.com"}, headers=headers)
    assert resp_self.status_code == 400
    assert "sendiri" in resp_self.json()["detail"].lower()


@pytest.mark.asyncio
async def test_get_my_family_invitations(test_db, client):
    """Target undangan (misal: dtrbimu) dapat melihat daftar undangan yang tertuju padanya."""
    async with test_db() as db:
        admin = User(id=1, username="pemilik_rumah", full_name="Budi Santoso", role="admin", password_hash="hash")
        target_user = User(id=2, username="dtrbimu", email="dtrbimu@gmail.com", role="member", password_hash="hash")
        db.add_all([admin, target_user])
        await db.commit()

    admin_token = create_access_token(1, "pemilik_rumah", "admin")
    target_token = create_access_token(2, "dtrbimu", "member")

    # Admin mengundang dtrbimu
    await client.post(
        "/api/family/invite",
        json={"email": "dtrbimu"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    # dtrbimu memeriksa undangan masuk
    resp = await client.get("/api/family/invitations", headers={"Authorization": f"Bearer {target_token}"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert len(data["invitations"]) == 1
    inv = data["invitations"][0]
    assert inv["invitee_email"] == "dtrbimu"
    assert inv["inviter_name"] == "Budi Santoso"
    assert inv["status"] == "pending"


@pytest.mark.asyncio
async def test_respond_family_invitation_accept_and_device_access(test_db, client):
    """
    Ketika undangan diterima (action: accept):
    1. Status undangan berubah menjadi accepted.
    2. Target user otomatis masuk ke grup keluarga pemilik perangkat.
    3. Target user otomatis mendapatkan akses ke perangkat milik keluarga tersebut.
    """
    async with test_db() as db:
        owner = User(id=1, username="owner", role="admin", password_hash="hash", family_id=1)
        invitee = User(id=2, username="dtrbimu", email="dtrbimu@gmail.com", role="member", password_hash="hash")
        dev = Device(
            id="esp32_smart_lamp",
            name="Lampu Pintar",
            room="Ruang Tamu",
            device_type="esp32",
            is_online=True,
            owner_id=1,
        )
        db.add_all([owner, invitee, dev])
        await db.commit()

    owner_token = create_access_token(1, "owner", "admin")
    invitee_token = create_access_token(2, "dtrbimu", "member")

    # 1. Sebelum menerima: invitee belum punya family_id
    invitee_headers = {"Authorization": f"Bearer {invitee_token}"}
    devices_before = await client.get("/api/devices", headers=invitee_headers)
    assert len(devices_before.json()["devices"]) == 0

    # 2. Owner mengundang invitee
    inv_res = await client.post(
        "/api/family/invite",
        json={"email": "dtrbimu@gmail.com"},
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    inv_id = inv_res.json()["invitation"]["id"]

    # 3. Invitee menerima undangan (accept)
    respond_res = await client.post(
        f"/api/family/invitations/{inv_id}/respond",
        json={"action": "accept"},
        headers=invitee_headers,
    )
    assert respond_res.status_code == 200
    assert respond_res.json()["status"] == "ok"

    # 4. Verifikasi di DB: family_id terhubung & status accepted
    async with test_db() as db:
        u = await db.get(User, 2)
        assert u.family_id == 1
        inv = await db.get(FamilyInvitation, inv_id)
        assert inv.status == "accepted"

    # 5. Setelah menerima: invitee langsung memiliki akses sah ke perangkat keluarga!
    devices_after = await client.get("/api/devices", headers=invitee_headers)
    assert len(devices_after.json()["devices"]) == 1
    assert devices_after.json()["devices"][0]["id"] == "esp32_smart_lamp"


@pytest.mark.asyncio
async def test_respond_family_invitation_reject(test_db, client):
    """Ketika undangan ditolak (action: reject), status berubah menjadi rejected dan keluarga tidak berubah."""
    async with test_db() as db:
        owner = User(id=1, username="owner", role="admin", password_hash="hash", family_id=1)
        invitee = User(id=2, username="dtrbimu", email="dtrbimu@gmail.com", role="member", password_hash="hash")
        db.add_all([owner, invitee])
        await db.commit()

    owner_token = create_access_token(1, "owner", "admin")
    invitee_token = create_access_token(2, "dtrbimu", "member")

    inv_res = await client.post(
        "/api/family/invite",
        json={"email": "dtrbimu@gmail.com"},
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    inv_id = inv_res.json()["invitation"]["id"]

    # Reject
    respond_res = await client.post(
        f"/api/family/invitations/{inv_id}/respond",
        json={"action": "reject"},
        headers={"Authorization": f"Bearer {invitee_token}"},
    )
    assert respond_res.status_code == 200

    async with test_db() as db:
        u = await db.get(User, 2)
        assert u.family_id is None
        inv = await db.get(FamilyInvitation, inv_id)
        assert inv.status == "rejected"

