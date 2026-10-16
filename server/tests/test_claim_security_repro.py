import asyncio
import datetime
import time
from httpx import ASGITransport, AsyncClient
import pyotp
import pytest
from sqlalchemy import select

from server.app.core.database import AsyncSessionLocal, Base, engine, init_sqlite_wal
from server.app.core.device_queue import device_queue
from server.app.core.setup_manager import get_current_setup_code, reset_setup_code_for_testing
from server.app.main import app
from server.app.models.device import Channel, Device
from server.app.models.user import User


@pytest.fixture(autouse=True)
async def setup_clean_db():
    await init_sqlite_wal()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    reset_setup_code_for_testing()
    with device_queue._lock:
        device_queue._pair_codes.clear()
        device_queue._queues.clear()
    yield


async def create_user(client: AsyncClient, username: str, role: str = "member", family_id: int | None = None):
    # Setup admin first if not exists
    s_status = await client.get("/api/auth/setup-status")
    if not s_status.json()["is_setup"]:
        code = get_current_setup_code()
        s_res = await client.post(
            "/api/auth/setup-admin",
            json={"setup_code": code, "username": "admin_root", "password": "PasswordAdmin123!"},
        )
        totp_secret = s_res.json()["totp_secret"]
        l_res = await client.post(
            "/api/auth/login",
            json={"username": "admin_root", "password": "PasswordAdmin123!"},
        )
        v_res = await client.post(
            "/api/auth/verify-2fa",
            json={"temp_token": l_res.json()["temp_token"], "code": pyotp.TOTP(totp_secret).now()},
        )
        root_token = v_res.json()["access_token"]
        if username == "admin_root":
            return root_token, 1

    # Register new user
    r_res = await client.post(
        "/api/auth/register",
        json={
            "username": username,
            "email": f"{username}@example.com",
            "password": "PasswordUser123!",
            "full_name": f"User {username}",
        },
    )
    user_data = r_res.json()
    u_id = user_data["user"]["id"]

    # If role needs update in DB
    async with AsyncSessionLocal() as session:
        u = await session.get(User, u_id)
        if u:
            u.role = role
            u.is_approved = True
            if family_id:
                u.family_id = family_id
            await session.commit()

    return user_data["access_token"], u_id


@pytest.mark.asyncio
async def test_repro_a_account_b_claims_device_already_bound_to_account_a():
    """
    Reproduksi Bug (a) & Invarian I1:
    Akun B mengklaim perangkat yang sudah terikat ke Akun A.
    Harus DITOLAK dengan status HTTP 409 Conflict (bukan 403 atau 200).
    """
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("127.0.0.1", 50000)),
        base_url="http://test",
    ) as client:
        token_a, id_a = await create_user(client, "admin_a", role="admin")
        token_b, id_b = await create_user(client, "admin_b", role="admin")

        # Buat perangkat yang terikat ke Akun A
        async with AsyncSessionLocal() as session:
            dev = Device(
                id="esp32_559ed8",
                owner_id=id_a,
                name="Lampu Utama",
                room="Ruang Tamu",
                device_type="esp32",
                is_online=True,
            )
            session.add(dev)
            await session.commit()

        # Daftarkan pair code aktif untuk perangkat tersebut
        device_queue.register_pair_code("123456", "esp32_559ed8")

        # Akun B mencoba mengklaim perangkat yang sudah terikat ke Akun A
        headers_b = {"Authorization": f"Bearer {token_b}"}
        claim_res = await client.post(
            "/api/devices/claim",
            json={"device_id": "esp32_559ed8", "pair_code": "123456"},
            headers=headers_b,
        )

        # Invarian I1 mewajibkan HTTP 409 Conflict jika perangkat sudah terikat ke keluarga lain
        assert claim_res.status_code == 409, f"Diharapkan 409 Conflict, tetapi mendapat {claim_res.status_code}: {claim_res.text}"


@pytest.mark.asyncio
async def test_repro_b_successful_claim_must_not_alter_user_role():
    """
    Reproduksi Bug (b) & Invarian I2:
    Klaim perangkat TIDAK BOLEH mengubah peran pengguna siapa pun menjadi 'pemilik'.
    Sebelumnya, setiap klaim mengubah role pengguna menjadi 'pemilik'.
    """
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("127.0.0.1", 50000)),
        base_url="http://test",
    ) as client:
        # Akun A adalah pengelola utama
        token_a, id_a = await create_user(client, "admin_a", role="admin")

        # Daftarkan sesi pairing perangkat baru
        device_queue.register_pair_code("654321", "esp32_new_dev")

        headers_a = {"Authorization": f"Bearer {token_a}"}
        claim_res = await client.post(
            "/api/devices/claim",
            json={"device_id": "esp32_new_dev", "pair_code": "654321"},
            headers=headers_a,
        )
        assert claim_res.status_code == 200

        # Verifikasi peran Akun A TIDAK berubah menjadi 'pemilik' (harus tetap 'admin')
        async with AsyncSessionLocal() as session:
            user_a = await session.get(User, id_a)
            assert user_a.role == "admin", f"Peran admin_a berubah menjadi {user_a.role}! Invarian I2 dilanggar."


@pytest.mark.asyncio
async def test_repro_c_used_pair_code_cannot_be_reused():
    """
    Reproduksi Bug (c) & Invarian I5/I6:
    Kode pairing sekali pakai (single-use). Memakai kode pairing langsung menghanguskannya.
    Pemakaian ulang kode yang sama harus DITOLAK ('Kode sudah terpakai').
    """
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("127.0.0.1", 50000)),
        base_url="http://test",
    ) as client:
        token_a, id_a = await create_user(client, "admin_a", role="admin")
        device_queue.register_pair_code("777888", "esp32_single_use")

        headers_a = {"Authorization": f"Bearer {token_a}"}

        # Klaim pertama
        res1 = await client.post(
            "/api/devices/claim",
            json={"device_id": "esp32_single_use", "pair_code": "777888"},
            headers=headers_a,
        )
        assert res1.status_code == 200

        # Putuskan perangkat agar dapat diklaim kembali
        async with AsyncSessionLocal() as session:
            dev = await session.get(Device, "esp32_single_use")
            dev.owner_id = None
            await session.commit()

        # Klaim kedua memakai KODE YANG SAMA persis
        res2 = await client.post(
            "/api/devices/claim",
            json={"device_id": "esp32_single_use", "pair_code": "777888"},
            headers=headers_a,
        )

        # Invarian I6: Kode yang sudah dipakai TIDAK PERNAH bisa dipakai lagi
        assert res2.status_code in (400, 409), f"Klaim dengan kode bekas lolos! Status: {res2.status_code}"
        assert "terpakai" in res2.text.lower() or "tidak valid" in res2.text.lower()


@pytest.mark.asyncio
async def test_repro_d_expired_code_must_be_rejected():
    """
    Reproduksi Bug (d) & Invarian I5:
    Kode pairing hanya berlaku 120 detik.
    Kode berumur > 120 detik (misal 130 detik) harus DITOLAK ('Kode kedaluwarsa').
    Saat ini kode masih diterima hingga 1800 detik (30 menit).
    """
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("127.0.0.1", 50000)),
        base_url="http://test",
    ) as client:
        token_a, id_a = await create_user(client, "admin_a", role="admin")

        # Daftarkan pair code yang dibuat 130 detik yang lalu
        with device_queue._lock:
            device_queue._pair_codes["999000"] = {
                "pair_code": "999000",
                "device_id": "esp32_expired_dev",
                "device_key": "key_expired",
                "status": {},
                "updated_at": time.time() - 130,  # 130 detik lalu (> 120 detik)
            }

        headers_a = {"Authorization": f"Bearer {token_a}"}
        res = await client.post(
            "/api/devices/claim",
            json={"device_id": "esp32_expired_dev", "pair_code": "999000"},
            headers=headers_a,
        )

        # Harus DITOLAK karena > 120 detik
        assert res.status_code in (400, 410), f"Kode berumur 130 detik masih diterima! Status: {res.status_code}: {res.text}"
        assert "kedaluwarsa" in res.text.lower()
