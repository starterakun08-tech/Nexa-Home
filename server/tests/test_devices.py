import datetime
import json
from httpx import ASGITransport, AsyncClient
import pyotp
import pytest
from sqlalchemy import select

from server.app.core.automation_engine import process_telemetry_automations
from server.app.core.database import AsyncSessionLocal, Base, engine, init_sqlite_wal
from server.app.core.mqtt_auth import get_all_passwd_users, PASSWD_FILE, ACL_FILE
from server.app.core.mqtt_client import mqtt_service
from server.app.core.setup_manager import get_current_setup_code, reset_setup_code_for_testing
from server.app.main import app
from server.app.models.automation import Automation, NotificationLog
from server.app.models.device import Channel, Device, TelemetryLog
from server.app.models.user import User


@pytest.fixture(autouse=True)
async def setup_clean_db():
    await init_sqlite_wal()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    reset_setup_code_for_testing()
    yield


async def create_admin_and_login(client: AsyncClient):
    await client.get("/api/auth/setup-status")
    code = get_current_setup_code()
    s_res = await client.post(
        "/api/auth/setup-admin",
        json={"setup_code": code, "username": "admin", "password": "PasswordAdmin123!"},
    )
    totp_secret = s_res.json()["totp_secret"]

    l_res = await client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "PasswordAdmin123!"},
    )
    v_res = await client.post(
        "/api/auth/verify-2fa",
        json={"temp_token": l_res.json()["temp_token"], "code": pyotp.TOTP(totp_secret).now()},
    )
    return v_res.json()["access_token"]


@pytest.mark.asyncio
async def test_device_creation_and_mqtt_acl():
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("127.0.0.1", 50000)),
        base_url="http://test",
    ) as client:
        token = await create_admin_and_login(client)
        headers = {"Authorization": f"Bearer {token}"}

        # 1. Tambah perangkat baru
        create_res = await client.post(
            "/api/devices",
            json={
                "id": "esp32_ruang_tengah",
                "name": "ESP32 Ruang Tengah",
                "room": "Ruang Tamu",
                "device_type": "esp32",
            },
            headers=headers,
        )
        assert create_res.status_code == 201
        data = create_res.json()
        assert data["status"] == "ok"
        assert "mqtt_credentials" in data
        assert data["mqtt_credentials"]["username"] == "esp32_ruang_tengah"
        assert data["mqtt_credentials"]["password"].startswith("dev_")

        # 2. Verifikasi berkas Mosquitto passwd & ACL terisi
        passwd_users = get_all_passwd_users()
        assert "esp32_ruang_tengah" in passwd_users

        acl_content = ACL_FILE.read_text(encoding="utf-8")
        assert "user esp32_ruang_tengah" in acl_content
        assert "topic readwrite home/esp32_ruang_tengah/#" in acl_content

        # 3. Ambil daftar perangkat
        list_res = await client.get("/api/devices", headers=headers)
        assert list_res.status_code == 200
        devices = list_res.json()["devices"]
        assert len(devices) == 1
        dev = devices[0]
        assert dev["id"] == "esp32_ruang_tengah"
        assert len(dev["channels"]) >= 5
        channel_keys = [c["channel_key"] for c in dev["channels"]]
        assert "lamp_tengah" in channel_keys
        assert "mq2" in channel_keys

        # 4. Rotasi kredensial
        rot_res = await client.post(
            "/api/devices/esp32_ruang_tengah/revoke-credentials",
            headers=headers,
        )
        assert rot_res.status_code == 200
        new_pwd = rot_res.json()["mqtt_credentials"]["password"]
        assert new_pwd != data["mqtt_credentials"]["password"]

        # 5. Hapus perangkat -> kredensial dihapus dari ACL
        del_res = await client.delete("/api/devices/esp32_ruang_tengah", headers=headers)
        assert del_res.status_code == 200

        acl_after = ACL_FILE.read_text(encoding="utf-8")
        assert "user esp32_ruang_tengah" not in acl_after


@pytest.mark.asyncio
async def test_device_command_and_role_permissions():
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("127.0.0.1", 50000)),
        base_url="http://test",
    ) as client:
        admin_token = await create_admin_and_login(client)
        admin_headers = {"Authorization": f"Bearer {admin_token}"}

        # Buat user member & child
        await client.post(
            "/api/auth/users",
            json={"username": "ibu_ani", "password": "MemberPass123!", "role": "member"},
            headers=admin_headers,
        )
        await client.post(
            "/api/auth/users",
            json={"username": "anak_budi", "password": "ChildPass123!", "role": "child"},
            headers=admin_headers,
        )

        m_login = await client.post("/api/auth/login", json={"username": "ibu_ani", "password": "MemberPass123!"})
        member_token = m_login.json()["access_token"]
        member_headers = {"Authorization": f"Bearer {member_token}"}

        c_login = await client.post("/api/auth/login", json={"username": "anak_budi", "password": "ChildPass123!"})
        child_token = c_login.json()["access_token"]
        child_headers = {"Authorization": f"Bearer {child_token}"}

        # Admin buat perangkat
        await client.post(
            "/api/devices",
            json={"id": "esp32_test", "name": "ESP32 Test", "room": "Kamar"},
            headers=admin_headers,
        )

        # 1. Member mencoba kirim perintah saklar -> diizinkan
        cmd_res = await client.post(
            "/api/devices/esp32_test/cmd",
            json={"channel": "lamp_tengah", "action": "set", "value": True},
            headers=member_headers,
        )
        assert cmd_res.status_code == 200
        assert cmd_res.json()["current_value"] == "true"

        # 2. Child mencoba kirim perintah saklar -> ditolak (403)
        child_cmd = await client.post(
            "/api/devices/esp32_test/cmd",
            json={"channel": "lamp_tengah", "action": "set", "value": False},
            headers=child_headers,
        )
        assert child_cmd.status_code == 403

        # 3. Non-admin mencoba tambah perangkat -> ditolak (403)
        unauth_create = await client.post(
            "/api/devices",
            json={"id": "esp32_fake", "name": "Fake", "room": "Kamar"},
            headers=member_headers,
        )
        assert unauth_create.status_code == 403


@pytest.mark.asyncio
async def test_mqtt_incoming_state_availability_and_retention():
    # Inisialisasi data perangkat di DB
    async with AsyncSessionLocal() as db:
        dev = Device(id="esp32_node1", name="Node 1", room="Dapur", is_online=False)
        ch_gas = Channel(device_id="esp32_node1", channel_key="mq2", name="MQ2", channel_type="gas_sensor", current_value="0")
        ch_lamp = Channel(device_id="esp32_node1", channel_key="lamp_tengah", name="Lampu", channel_type="switch", current_value="false")
        db.add_all([dev, ch_gas, ch_lamp])
        await db.commit()

    # 1. Uji penanganan pesan availability LWT
    await mqtt_service.handle_incoming_message("home/esp32_node1/availability", "online")
    async with AsyncSessionLocal() as db:
        dev = (await db.execute(select(Device).where(Device.id == "esp32_node1"))).scalar_one()
        assert dev.is_online is True

    # 2. Uji penanganan pesan state sensor & channels
    state_payload = {
        "channels": {"lamp_tengah": True},
        "sensors": {"mq2": 450.0, "is_dark": False},
        "ts": int(datetime.datetime.utcnow().timestamp()),
    }
    await mqtt_service.handle_incoming_message("home/esp32_node1/state", json.dumps(state_payload))

    async with AsyncSessionLocal() as db:
        ch = (await db.execute(select(Channel).where(Channel.device_id == "esp32_node1", Channel.channel_key == "lamp_tengah"))).scalar_one()
        assert ch.current_value == "true"

        logs = (await db.execute(select(TelemetryLog).where(TelemetryLog.device_id == "esp32_node1"))).scalars().all()
        assert len(logs) >= 1
        assert logs[0].value_num == 450.0

    # 3. Uji LWT offline
    await mqtt_service.handle_incoming_message("home/esp32_node1/availability", "offline")
    async with AsyncSessionLocal() as db:
        dev = (await db.execute(select(Device).where(Device.id == "esp32_node1"))).scalar_one()
        assert dev.is_online is False
        notifs = (await db.execute(select(NotificationLog).where(NotificationLog.event_type == "device_offline"))).scalars().all()
        assert len(notifs) >= 1

    # 4. Uji pembersihan retensi data lama
    async with AsyncSessionLocal() as db:
        old_time = datetime.datetime.utcnow() - datetime.timedelta(days=100)
        old_log = TelemetryLog(device_id="esp32_node1", channel_key="mq2", value_num=100.0, created_at=old_time)
        db.add(old_log)
        await db.commit()

    await mqtt_service.cleanup_retention_data(retention_days=90)
    async with AsyncSessionLocal() as db:
        remaining = (await db.execute(select(TelemetryLog).where(TelemetryLog.device_id == "esp32_node1"))).scalars().all()
        # Data lama 100 hari lalu harus terhapus, data baru tetap ada
        assert all(r.created_at > (datetime.datetime.utcnow() - datetime.timedelta(days=90)) for r in remaining)


@pytest.mark.asyncio
async def test_automation_rules_engine():
    async with AsyncSessionLocal() as db:
        # Aturan 1: Jika gas >= 1500 -> Buat notifikasi kritis
        auto_gas = Automation(
            name="Alarm Kebocoran Gas",
            is_enabled=True,
            trigger_type="sensor_threshold",
            trigger_config=json.dumps({"device_id": "esp32_node1", "sensor": "mq2", "op": ">=", "value": 1500}),
            action_config=json.dumps({"type": "notify", "message": "Bahaya gas bocor!", "severity": "critical"}),
        )
        # Aturan 2: Jika gelap (is_dark == True) -> Nyalakan lampu
        auto_dark = Automation(
            name="Lampu Otomatis saat Gelap",
            is_enabled=True,
            trigger_type="sensor_threshold",
            trigger_config=json.dumps({"device_id": "esp32_node1", "sensor": "is_dark", "op": "==", "value": True}),
            action_config=json.dumps({"type": "device_cmd", "device_id": "esp32_node1", "channel": "lamp_tengah", "action": "set", "value": True}),
        )
        db.add_all([auto_gas, auto_dark])
        await db.commit()

        # Uji pemicuan saat sensor gas normal (mq2 = 300) -> tidak terpicu
        triggered = await process_telemetry_automations(
            db=db,
            device_id="esp32_node1",
            sensors={"mq2": 300, "is_dark": False},
            channels={},
        )
        assert len(triggered) == 0

        # Uji pemicuan saat gas tinggi (mq2 = 1650) -> terpicu!
        triggered_alarm = await process_telemetry_automations(
            db=db,
            device_id="esp32_node1",
            sensors={"mq2": 1650, "is_dark": False},
            channels={},
        )
        assert len(triggered_alarm) == 1
        assert triggered_alarm[0]["name"] == "Alarm Kebocoran Gas"

        # Verifikasi notifikasi kritis tersimpan di DB
        notifs = (await db.execute(select(NotificationLog).where(NotificationLog.severity == "critical"))).scalars().all()
        assert len(notifs) >= 1
        assert "Bahaya gas bocor" in notifs[0].message


@pytest.mark.asyncio
async def test_claim_device_flow():
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("127.0.0.1", 50000)),
        base_url="http://test",
    ) as client:
        token = await create_admin_and_login(client)
        headers = {"Authorization": f"Bearer {token}"}

        # 1. Device buat claim session 120s
        cs_res = await client.post("/api/devices/esp32_c45a89/claim-session")
        assert cs_res.status_code == 200
        cs_data = cs_res.json()
        pair_code = cs_data["pairing_code"]

        # 2. Pengelola klaim perangkat baru via pairing token
        claim_res = await client.post(
            "/api/devices/claim",
            headers=headers,
            json={
                "device_id": "esp32_c45a89",
                "claim_token": pair_code,
                "name": "ESP32 Lampu Teras",
                "room": "Teras Depan",
            },
        )
        assert claim_res.status_code == 200
        data = claim_res.json()
        assert data["status"] == "ok"
        assert "Sambungan telah berhasil" in data["message"]
        assert data["device"]["id"] == "esp32_c45a89"
        assert data["device"]["name"] == "ESP32 Lampu Teras"

        # 3. Cek perangkat terdaftar di list devices dengan kanal lengkap
        list_res = await client.get("/api/devices", headers=headers)
        assert list_res.status_code == 200
        devs = list_res.json()["devices"]
        claimed_dev = next((d for d in devs if d["id"] == "esp32_c45a89"), None)
        assert claimed_dev is not None
        assert claimed_dev["room"] == "Teras Depan"
        assert claimed_dev["owner_id"] is not None
        assert len(claimed_dev["channels"]) >= 5

        # 4. Invariant I6: Menggunakan kode yang sama ditolak (400 Kode sudah terpakai)
        reuse_res = await client.post(
            "/api/devices/claim",
            headers=headers,
            json={
                "device_id": "esp32_c45a89",
                "claim_token": pair_code,
                "name": "ESP32 Lampu Teras Baru",
                "room": "Balkon",
            },
        )
        assert reuse_res.status_code == 400
        assert "terpakai" in reuse_res.json()["detail"].lower()

        # 5. Invariant I1: Klaim ulang perangkat yang sudah terdaftar dengan sesi baru ditolak 409 Conflict
        cs_res2 = await client.post("/api/devices/esp32_c45a89/claim-session")
        assert cs_res2.status_code == 200
        new_pair_code = cs_res2.json()["pairing_code"]

        reclaim_res = await client.post(
            "/api/devices/claim",
            headers=headers,
            json={
                "device_id": "esp32_c45a89",
                "claim_token": new_pair_code,
                "name": "ESP32 Lampu Teras Baru",
                "room": "Balkon",
            },
        )
        assert reclaim_res.status_code == 409
        assert "sudah terdaftar" in reclaim_res.json()["detail"].lower()



@pytest.mark.asyncio
async def test_end_to_end_user_pairing_and_family_lifecycle():
    """
    Skenario end-to-end yang wajib diuji dan LULUS:
    a) User baru register (role awal kosong/unassigned).
    b) Perangkat membuat kode pairing baru -> User menginput kode pairing pertama kali -> Berhasil tersambung (tidak invalid) -> Role user otomatis menjadi admin (Pemilik).
    c) Admin mengundang user ke-2 -> User ke-2 menerima undangan -> Role user ke-2 menjadi member (Anggota) & bisa mengakses data keluarga.
    d) Admin mengeluarkan (kick) atau Anggota keluar dari keluarga -> Berhasil dan role kembali ke awal.
    """
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("127.0.0.1", 50000)),
        base_url="http://test",
    ) as client:
        # Inisialisasi root admin
        await create_admin_and_login(client)

        # a) User baru register (role awal kosong/unassigned)
        r1 = await client.post(
            "/api/auth/register",
            json={
                "username": "user_baru_1",
                "email": "user1@example.com",
                "password": "PasswordUser123!",
                "full_name": "User Baru Satu",
            },
        )
        assert r1.status_code == 201
        u1_data = r1.json()
        token1 = u1_data["access_token"]
        u1_id = u1_data["user"]["id"]
        assert u1_data["user"]["role"] in (None, "unassigned")
        h1 = {"Authorization": f"Bearer {token1}"}

        # b) Perangkat membuat kode pairing baru via register-pairing / claim-session
        cs_res = await client.post("/api/devices/esp32_kamar_tidur/claim-session")
        assert cs_res.status_code == 200
        p_code = cs_res.json()["pairing_code"]

        # User menginput kode pairing pertama kali (dengan tanda strip untuk uji normalisasi string)
        formatted_code = f"{p_code[:3]}-{p_code[3:]}" if len(p_code) == 6 else p_code
        claim_res = await client.post(
            "/api/devices/claim",
            headers=h1,
            json={
                "device_id": "esp32_kamar_tidur",
                "pair_code": formatted_code,
                "name": "ESP32 Kamar Tidur",
                "room": "Kamar Tidur",
            },
        )
        assert claim_res.status_code == 200, f"Claim failed: {claim_res.text}"
        assert claim_res.json()["status"] == "ok"

        # Verifikasi peran user 1 seketika naik menjadi 'admin' (Pemilik)
        me1_res = await client.get("/api/auth/me", headers=h1)
        assert me1_res.status_code == 200
        assert me1_res.json()["role"] == "admin"

        # c) User ke-2 mendaftar terlebih dahulu (role awal unassigned / None)
        r2 = await client.post(
            "/api/auth/register",
            json={
                "username": "user_baru_2",
                "email": "user2@example.com",
                "password": "PasswordUser123!",
                "full_name": "User Baru Dua",
            },
        )
        assert r2.status_code == 201
        token2 = r2.json()["access_token"]
        u2_id = r2.json()["user"]["id"]
        assert r2.json()["user"]["role"] in (None, "unassigned")
        h2 = {"Authorization": f"Bearer {token2}"}

        # Admin (user 1) mengundang user ke-2
        inv_res = await client.post(
            "/api/family/invitations",
            headers=h1,
            json={"invitee_email": "user2@example.com"},
        )
        assert inv_res.status_code in (200, 201), f"Invite failed: {inv_res.text}"
        inv_id = inv_res.json()["invitation"]["id"]

        # User ke-2 menerima undangan
        acc_res = await client.post(f"/api/family/invitations/{inv_id}/accept", headers=h2)
        assert acc_res.status_code == 200

        # Verifikasi role user 2 menjadi 'member' (Anggota) & terikat ke family user 1
        me2_res = await client.get("/api/auth/me", headers=h2)
        assert me2_res.status_code == 200
        assert me2_res.json()["role"] == "member"
        assert me2_res.json()["family_id"] == u1_id

        # d) Admin mengeluarkan (kick) user 2
        kick_res = await client.delete(f"/api/family/members/{u2_id}", headers=h1)
        assert kick_res.status_code == 200

        # Role user 2 kembali ke awal (None / unassigned) dan family_id terlepas
        async with AsyncSessionLocal() as session:
            u2_db = await session.get(User, u2_id)
            assert u2_db.family_id is None
            assert u2_db.role in (None, "unassigned")



