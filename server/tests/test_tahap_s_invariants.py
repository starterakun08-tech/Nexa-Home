import asyncio
import datetime
import hashlib
import time
from httpx import ASGITransport, AsyncClient
import pyotp
import pytest
from sqlalchemy import select, update

from server.app.core.claim_service import claim_rate_limiter, create_claim_session, hash_secret
from server.app.core.database import AsyncSessionLocal, Base, engine, init_sqlite_wal
from server.app.core.device_queue import device_queue
from server.app.core.mqtt_auth import get_all_passwd_users, get_restricted_devices, ACL_FILE
from server.app.core.mqtt_client import mqtt_service
from server.app.core.setup_manager import get_current_setup_code, reset_setup_code_for_testing
from server.app.main import app
from server.app.models.claim_session import ClaimSession
from server.app.models.device import Device
from server.app.models.user import User


@pytest.fixture(autouse=True)
async def setup_clean_db():
    await init_sqlite_wal()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    from server.app.core.database import check_and_migrate_db
    await check_and_migrate_db()

    reset_setup_code_for_testing()
    claim_rate_limiter.reset_for_testing()
    with device_queue._lock:
        device_queue._pair_codes.clear()
        device_queue._queues.clear()
    yield


async def setup_family_and_users(client: AsyncClient):
    # Setup initial manager (budi)
    await client.get("/api/auth/setup-status")
    code = get_current_setup_code()
    s_res = await client.post(
        "/api/auth/setup-admin",
        json={"setup_code": code, "username": "budi", "password": "PasswordAdmin123!"},
    )
    assert s_res.status_code == 201, f"Setup admin failed: {s_res.text}"
    totp_secret = s_res.json()["totp_secret"]
    l_res = await client.post(
        "/api/auth/login",
        json={"username": "budi", "password": "PasswordAdmin123!"},
    )
    v_res = await client.post(
        "/api/auth/verify-2fa",
        json={"temp_token": l_res.json()["temp_token"], "code": pyotp.TOTP(totp_secret).now()},
    )
    budi_token = v_res.json()["access_token"]
    budi_id = v_res.json()["user"]["id"]

    # Register member (siti)
    r1 = await client.post(
        "/api/auth/register",
        json={"username": "siti", "email": "siti@example.com", "password": "PasswordUser123!", "full_name": "Siti"},
    )
    siti_token = r1.json()["access_token"]
    siti_id = r1.json()["user"]["id"]

    # Register child (anak)
    r2 = await client.post(
        "/api/auth/register",
        json={"username": "anak", "email": "anak@example.com", "password": "PasswordUser123!", "full_name": "Anak"},
    )
    anak_token = r2.json()["access_token"]
    anak_id = r2.json()["user"]["id"]

    # Register outsider manager (risang in separate family)
    r3 = await client.post(
        "/api/auth/register",
        json={"username": "risang", "email": "risang@example.com", "password": "PasswordUser123!", "full_name": "Risang"},
    )
    risang_token = r3.json()["access_token"]
    risang_id = r3.json()["user"]["id"]

    async with AsyncSessionLocal() as session:
        # Siti -> member in budi's family
        u_siti = await session.get(User, siti_id)
        u_siti.role = "member"
        u_siti.family_id = budi_id
        u_siti.is_approved = True

        # Anak -> child in budi's family
        u_anak = await session.get(User, anak_id)
        u_anak.role = "child"
        u_anak.family_id = budi_id
        u_anak.is_approved = True

        # Risang -> manager in own family
        u_risang = await session.get(User, risang_id)
        u_risang.role = "admin"
        u_risang.family_id = risang_id
        u_risang.is_approved = True

        await session.commit()

    return {
        "budi": {"token": budi_token, "id": budi_id},
        "siti": {"token": siti_token, "id": siti_id},
        "anak": {"token": anak_token, "id": anak_id},
        "risang": {"token": risang_token, "id": risang_id},
    }


@pytest.mark.asyncio
async def test_invariants_i1_and_i4_exclusive_binding_and_role_permission():
    """
    I1: Satu perangkat hanya terikat ke SATU keluarga pada satu waktu.
        Klaim terhadap perangkat yang sudah terikat SELALU DITOLAK (409 Conflict), tanpa mengubah state.
    I4: Hanya Pengelola yang boleh menambah (klaim) dan memutus perangkat. Anggota dan anak mendapat 403.
    """
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("127.0.0.1", 50000)),
        base_url="http://test",
    ) as client:
        users = await setup_family_and_users(client)

        # 1. Buat sesi klaim resmi untuk esp32_lampu
        async with AsyncSessionLocal() as session:
            sess_data = await create_claim_session(session, "esp32_lampu", ttl_seconds=120)

        # 2. Anggota biasa (siti) mencoba klaim -> I4 HARUS 403
        h_siti = {"Authorization": f"Bearer {users['siti']['token']}"}
        res_siti = await client.post(
            "/api/devices/claim",
            json={"device_id": "esp32_lampu", "pair_code": sess_data["pair_code"]},
            headers=h_siti,
        )
        assert res_siti.status_code == 403, f"Member lolos klaim! Status: {res_siti.status_code}"

        # 3. Anak (anak) mencoba klaim -> I4 HARUS 403
        h_anak = {"Authorization": f"Bearer {users['anak']['token']}"}
        res_anak = await client.post(
            "/api/devices/claim",
            json={"device_id": "esp32_lampu", "pair_code": sess_data["pair_code"]},
            headers=h_anak,
        )
        assert res_anak.status_code == 403, f"Anak lolos klaim! Status: {res_anak.status_code}"

        # 4. Pengelola sah (budi) mengklaim -> Berhasil (200)
        h_budi = {"Authorization": f"Bearer {users['budi']['token']}"}
        res_budi = await client.post(
            "/api/devices/claim",
            json={"device_id": "esp32_lampu", "pair_code": sess_data["pair_code"]},
            headers=h_budi,
        )
        assert res_budi.status_code == 200

        # Verifikasi perangkat terikat ke budi
        async with AsyncSessionLocal() as session:
            dev = await session.get(Device, "esp32_lampu")
            assert dev.owner_id == users["budi"]["id"]

        # 5. Buat sesi klaim baru untuk perangkat yang sama
        async with AsyncSessionLocal() as session:
            sess_data_2 = await create_claim_session(session, "esp32_lampu", ttl_seconds=120)

        # 6. Pengelola keluarga lain (risang) mencoba mengklaim perangkat budi yang sudah terikat
        h_risang = {"Authorization": f"Bearer {users['risang']['token']}"}
        res_risang = await client.post(
            "/api/devices/claim",
            json={"device_id": "esp32_lampu", "pair_code": sess_data_2["pair_code"]},
            headers=h_risang,
        )
        # I1: HARUS DITOLAK 409 CONFLICT!
        assert res_risang.status_code == 409
        assert "sudah terdaftar" in res_risang.json()["detail"].lower()

        # Verifikasi state perangkat TIDAK BERUBAH
        async with AsyncSessionLocal() as session:
            dev = await session.get(Device, "esp32_lampu")
            assert dev.owner_id == users["budi"]["id"]  # Tetap milik budi!


@pytest.mark.asyncio
async def test_invariants_i2_and_i3_single_manager_and_role_immutability():
    """
    I2: Klaim, pairing, undangan, penerimaan undangan, dan pemutusan perangkat TIDAK PERNAH mengubah peran siapa pun.
    I3: Pengelola keluarga tepat SATU. Ditegakkan di tingkat database (indeks unik parsial) DAN di logika server.
        Tidak ada jalur API untuk membuat pengelola kedua.
    """
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("127.0.0.1", 50000)),
        base_url="http://test",
    ) as client:
        users = await setup_family_and_users(client)

        # Coba ubah peran siti menjadi admin via API -> HARUS DITOLAK (400)
        h_budi = {"Authorization": f"Bearer {users['budi']['token']}"}
        res_role = await client.patch(
            f"/api/family/members/{users['siti']['id']}/role",
            json={"role": "admin"},
            headers=h_budi,
        )
        assert res_role.status_code == 400
        assert "skrip pemulihan" in res_role.json()["detail"].lower()

        # Coba ubah peran Pengelola (budi) via API -> HARUS DITOLAK (403)
        res_mgr_change = await client.patch(
            f"/api/family/members/{users['budi']['id']}/role",
            json={"role": "member"},
            headers=h_budi,
        )
        assert res_mgr_change.status_code == 403

        # Coba keluarkan Pengelola (budi) via API -> HARUS DITOLAK (403)
        res_del_mgr = await client.delete(
            f"/api/family/members/{users['budi']['id']}",
            headers=h_budi,
        )
        assert res_del_mgr.status_code == 403

        # Buktikan constraint basis data SQLite secara langsung
        import sqlite3
        con = sqlite3.connect("server/data/test_rumah.db")
        cur = con.cursor()
        try:
            # Mencoba membuat pengelola kedua untuk keluarga yang sama di SQLite
            cur.execute(
                f"UPDATE users SET role = 'admin', family_id = {users['budi']['id']} WHERE id = {users['siti']['id']};"
            )
            con.commit()
            pytest.fail("Database constraint gagal! Berhasil membuat pengelola kedua di SQLite.")
        except sqlite3.IntegrityError:
            pass  # Berhasil ditolak oleh idx_one_manager_per_family!
        finally:
            con.close()


@pytest.mark.asyncio
async def test_invariants_i5_i6_single_use_burn_and_qr_or_code():
    """
    I5: Kode pairing dan token QR berasal dari SATU sesi klaim. Memakai salah satunya langsung menghanguskan keduanya.
    I6: Kode/QR yang sudah terpakai tidak pernah bisa dipakai lagi dengan pesan 'Kode sudah terpakai'.
    """
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("127.0.0.1", 50000)),
        base_url="http://test",
    ) as client:
        users = await setup_family_and_users(client)
        h_budi = {"Authorization": f"Bearer {users['budi']['token']}"}

        # 1. Buat sesi klaim
        async with AsyncSessionLocal() as session:
            sess_data = await create_claim_session(session, "esp32_single_use_test", ttl_seconds=120)

        code = sess_data["pair_code"]
        qr_token = sess_data["qr_token"]

        # 2. Klaim memakai token QR
        res_qr = await client.post(
            "/api/devices/claim",
            json={"device_id": "esp32_single_use_test", "claim_token": qr_token},
            headers=h_budi,
        )
        assert res_qr.status_code == 200

        # Lepaskan perangkat untuk uji pakai ulang kode
        res_unbind = await client.post("/api/devices/esp32_single_use_test/unbind", headers=h_budi)
        assert res_unbind.status_code == 200

        # 3. Coba klaim memakai KODE PAIRING dari sesi yang sama -> HARUS DITOLAK 'Kode sudah terpakai'
        res_code_reuse = await client.post(
            "/api/devices/claim",
            json={"device_id": "esp32_single_use_test", "pair_code": code},
            headers=h_budi,
        )
        assert res_code_reuse.status_code == 400
        assert "sudah terpakai" in res_code_reuse.json()["detail"].lower()


@pytest.mark.asyncio
async def test_invariants_i7_and_i8_hashes_and_id_alone_insufficient():
    """
    I7: Rahasia disimpan sebagai hash di server, dibandingkan dengan perbandingan waktu-konstan, tidak pernah masuk log.
    I8: Mengetahui ID perangkat saja tidak pernah cukup untuk mengklaimnya.
    """
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("127.0.0.1", 50000)),
        base_url="http://test",
    ) as client:
        users = await setup_family_and_users(client)
        h_budi = {"Authorization": f"Bearer {users['budi']['token']}"}

        # Buat sesi klaim
        async with AsyncSessionLocal() as session:
            sess = await create_claim_session(session, "esp32_secret_test", ttl_seconds=120)

        # Periksa tabel claim_sessions di DB: pastikan hanya hash sha256 yang tersimpan, bukan plaintext
        async with AsyncSessionLocal() as session:
            cs = await session.scalar(select(ClaimSession).where(ClaimSession.device_id == "esp32_secret_test"))
            assert cs.code_hash != sess["pair_code"]
            assert cs.code_hash == hashlib.sha256(sess["pair_code"].encode()).hexdigest()
            assert cs.qr_token_hash == hashlib.sha256(sess["qr_token"].encode()).hexdigest()

        # I8: Coba klaim HANYA dengan device_id tanpa kode/token -> HARUS DITOLAK 400
        res_no_code = await client.post(
            "/api/devices/claim",
            json={"device_id": "esp32_secret_test"},
            headers=h_budi,
        )
        assert res_no_code.status_code == 400
        assert "tidak valid" in res_no_code.json()["detail"].lower()


@pytest.mark.asyncio
async def test_concurrent_claims_race_condition():
    """
    Tes Balapan Klaim Bersamaan (Concurrency Race Condition):
    Dua klaim bersamaan untuk perangkat atau kode yang sama: TEPAT SATU BERHASIL.
    """
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("127.0.0.1", 50000)),
        base_url="http://test",
    ) as client:
        users = await setup_family_and_users(client)
        h_budi = {"Authorization": f"Bearer {users['budi']['token']}"}
        h_risang = {"Authorization": f"Bearer {users['risang']['token']}"}

        async with AsyncSessionLocal() as session:
            sess = await create_claim_session(session, "esp32_race_dev", ttl_seconds=120)

        # Dua request secara serentak
        task1 = client.post(
            "/api/devices/claim",
            json={"device_id": "esp32_race_dev", "pair_code": sess["pair_code"]},
            headers=h_budi,
        )
        task2 = client.post(
            "/api/devices/claim",
            json={"device_id": "esp32_race_dev", "pair_code": sess["pair_code"]},
            headers=h_risang,
        )

        res1, res2 = await asyncio.gather(task1, task2)

        # Tepat satu berhasil 200, yang lain gagal (400 atau 409)
        statuses = [res1.status_code, res2.status_code]
        assert statuses.count(200) == 1, f"Bukan tepat 1 yang berhasil: {statuses}"
        assert (400 in statuses) or (409 in statuses), f"Request kedua tidak ditolak dengan benar: {statuses}"


@pytest.mark.asyncio
async def test_rotation_1000_sessions_no_collision():
    """
    Tes Rotasi (S3):
    Buat minimal 1000 sesi berurutan untuk satu perangkat dan buktikan tidak ada nilai kode yang sama.
    """
    generated_codes = set()
    generated_qr = set()

    async with AsyncSessionLocal() as session:
        for _ in range(1000):
            sess = await create_claim_session(session, "esp32_stress_dev", ttl_seconds=120)
            code = sess["pair_code"]
            qr = sess["qr_token"]

            assert code not in generated_codes, f"Terjadi kolisi kode pairing: {code}"
            assert qr not in generated_qr, f"Terjadi kolisi token QR: {qr}"

            generated_codes.add(code)
            generated_qr.add(qr)

    assert len(generated_codes) == 1000


@pytest.mark.asyncio
async def test_claim_rate_limiting_lockout():
    """
    Tes Pembatasan Percobaan (S3):
    5 percobaan gagal per 10 menit mengunci akun dengan 429 'Terlalu banyak percobaan. Coba lagi nanti.'
    """
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("127.0.0.1", 50000)),
        base_url="http://test",
    ) as client:
        users = await setup_family_and_users(client)
        h_budi = {"Authorization": f"Bearer {users['budi']['token']}"}

        # Lakukan 5 percobaan klaim dengan kode salah
        for i in range(5):
            res_fail = await client.post(
                "/api/devices/claim",
                json={"device_id": "esp32_fail_dev", "pair_code": f"00000{i}"},
                headers=h_budi,
            )
            assert res_fail.status_code == 400

        # Percobaan ke-6 HARUS 429
        res_lock = await client.post(
            "/api/devices/claim",
            json={"device_id": "esp32_fail_dev", "pair_code": "123456"},
            headers=h_budi,
        )
        assert res_lock.status_code == 429
        assert "terlalu banyak percobaan" in res_lock.json()["detail"].lower()


@pytest.mark.asyncio
async def test_unbind_online_and_offline_reset_flow():
    """
    Tes Alur Putus Perangkat (S4):
    - Online: kirim perintah reset QoS 1 (non-retained). Terima ack -> hapus kredensial Mosquitto.
    - Offline: terapkan kredensial TERBATAS (ACL cmd/ack, berlaku 7 hari) dan status 'menunggu_reset'.
    """
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("127.0.0.1", 50000)),
        base_url="http://test",
    ) as client:
        users = await setup_family_and_users(client)
        h_budi = {"Authorization": f"Bearer {users['budi']['token']}"}

        # 1. Uji Unbind Offline
        async with AsyncSessionLocal() as session:
            sess_off = await create_claim_session(session, "esp32_offline_dev", ttl_seconds=120)

        # Klaim perangkat
        await client.post(
            "/api/devices/claim",
            json={"device_id": "esp32_offline_dev", "pair_code": sess_off["pair_code"]},
            headers=h_budi,
        )

        # Set perangkat offline
        async with AsyncSessionLocal() as session:
            dev = await session.get(Device, "esp32_offline_dev")
            dev.is_online = False
            dev.last_seen_at = datetime.datetime.utcnow() - datetime.timedelta(seconds=60)
            await session.commit()

        # Putuskan perangkat offline
        res_unb_off = await client.post("/api/devices/esp32_offline_dev/unbind", headers=h_budi)
        assert res_unb_off.status_code == 200
        assert "sedang offline" in res_unb_off.json()["message"]

        # Verifikasi status menunggu_reset dan kredensial terbatas di Mosquitto
        async with AsyncSessionLocal() as session:
            dev = await session.get(Device, "esp32_offline_dev")
            assert dev.owner_id is None
            assert dev.reset_status == "menunggu_reset"

        restricted = get_restricted_devices()
        assert "esp32_offline_dev" in restricted

        acl_content = ACL_FILE.read_text(encoding="utf-8")
        assert "topic read home/esp32_offline_dev/cmd" in acl_content
        assert "topic write home/esp32_offline_dev/ack" in acl_content

        # 2. Uji Ack Reset dari perangkat: saat perangkat online kembali dan kirim ack
        await mqtt_service.handle_incoming_message(
            "home/esp32_offline_dev/ack",
            '{"id": "cmd_reset_123", "action": "factory_reset", "ok": true}',
        )

        # Kredensial Mosquitto harus telah dihapus
        passwd_users = get_all_passwd_users()
        assert "esp32_offline_dev" not in passwd_users
        restricted = get_restricted_devices()
        assert "esp32_offline_dev" not in restricted
