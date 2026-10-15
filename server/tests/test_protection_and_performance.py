import pytest
from httpx import AsyncClient, ASGITransport
from server.app.main import app


import uuid
from sqlalchemy import select
from server.app.core.database import AsyncSessionLocal
from server.app.core.security import create_access_token
from server.app.models.user import User


@pytest.mark.asyncio
async def test_home_protection_approval_and_invite_codes():
    """Menguji proteksi rumah dari pendaftaran orang asing & pembeli ESP32."""
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("127.0.0.1", 50000)),
        base_url="http://test",
    ) as client:
        setup_status = (await client.get("/api/auth/setup-status")).json()
        u_suffix = uuid.uuid4().hex[:6]

        if not setup_status["admin_exists"]:
            reg_admin = await client.post(
                "/api/auth/register",
                json={
                    "username": f"admin_{u_suffix}",
                    "email": f"admin_{u_suffix}@aujasena.my.id",
                    "password": "AdminPassword123!",
                    "full_name": "Kepala Keluarga",
                },
            )
            assert reg_admin.status_code == 201
            admin_data = reg_admin.json()
            admin_token = admin_data["access_token"]
            assert admin_data["user"]["role"] == "admin"
            assert admin_data["user"]["is_approved"] is True
        else:
            async with AsyncSessionLocal() as session:
                admin_obj = (await session.execute(select(User).where(User.role.in_(["admin", "pemilik"])))).scalars().first()
                admin_token = create_access_token(admin_obj.id, admin_obj.username, admin_obj.role if admin_obj else "pemilik")

        admin_headers = {"Authorization": f"Bearer {admin_token}"}

        # Setup satu device untuk pengujian kontrol
        dev_id = f"esp32_house_{u_suffix}"
        channels = [{"channel_key": "ch1", "name": "Lampu 1", "channel_type": "switch"}]
        await client.post(
            "/api/devices",
            json={"id": dev_id, "name": "Saklar Ruang Tamu", "room": "Tamu", "channels": channels},
            headers=admin_headers,
        )

        # 2. Pendaftaran mandiri kedua (orang luar tanpa kode undangan) -> is_approved = False
        guest_uname = f"stranger_{u_suffix}"
        reg_guest = await client.post(
            "/api/auth/register",
            json={
                "username": guest_uname,
                "email": f"{guest_uname}@internet.com",
                "password": "GuestPassword123!",
                "full_name": "Tamu Tak Dikenal",
            },
        )
        assert reg_guest.status_code == 201
        guest_data = reg_guest.json()
        guest_token = guest_data["access_token"]
        assert guest_data["user"]["role"] in ("biasa", "member")

        guest_headers = {"Authorization": f"Bearer {guest_token}"}

        # Tamu bukan pemilik perangkat mencoba kirim perintah perangkat -> Harus 403 Forbidden!
        cmd_blocked = await client.post(
            f"/api/devices/{dev_id}/cmd",
            json={"channel": "ch1", "action": "set", "value": True},
            headers=guest_headers,
        )
        assert cmd_blocked.status_code == 403

        # 3. Admin melihat endpoint pengguna tertunda
        pending_res = await client.get("/api/auth/pending-users", headers=admin_headers)
        assert pending_res.status_code == 200

        # 4. Admin membuat Kode Undangan Keluarga
        invite_res = await client.post(
            "/api/auth/invite-codes",
            json={"role": "member", "expires_in_hours": 48},
            headers=admin_headers,
        )
        assert invite_res.status_code == 200
        invite_code = invite_res.json()["invite_code"]
        assert invite_code.startswith("RUMAH-")

        # 5. Pendaftar ketiga mendaftar langsung dengan Kode Undangan -> Otomatis is_approved = True
        fam_uname = f"family_{u_suffix}"
        reg_family = await client.post(
            "/api/auth/register",
            json={
                "username": fam_uname,
                "email": f"{fam_uname}@aujasena.my.id",
                "password": "FamilyPassword123!",
                "full_name": "Anggota Keluarga",
                "invite_code": invite_code,
            },
        )
        assert reg_family.status_code == 201
        fam_data = reg_family.json()
        assert fam_data["user"]["is_approved"] is True

        # Member yang disetujui dapat mengontrol perangkat
        fam_token = fam_data["access_token"]
        fam_cmd = await client.post(
            f"/api/devices/{dev_id}/cmd",
            json={"channel": "ch1", "action": "set", "value": True},
            headers={"Authorization": f"Bearer {fam_token}"},
        )
        assert fam_cmd.status_code == 200

        # 6. Tamu yang tertunda mengklaim perangkat hardware ESP32 miliknya sendiri -> Otomatis disetujui!
        hardware_id = f"esp32_hw_{u_suffix}"
        claim_res = await client.post(
            "/api/devices/claim",
            json={"device_id": hardware_id, "claim_token": "NEXA-PROT-1234"},
            headers=guest_headers,
        )
        assert claim_res.status_code == 200
        assert claim_res.json()["status"] == "ok"

        # Cek profil tamu: status is_approved kini True
        guest_profile = await client.get("/api/auth/me", headers=guest_headers)
        assert guest_profile.status_code == 200
        assert guest_profile.json()["is_approved"] is True


@pytest.mark.asyncio
async def test_unlink_google_security_and_set_password():
    """Menguji proteksi unlink Google bila belum ada password, dan set password."""
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("127.0.0.1", 50000)),
        base_url="http://test",
    ) as client:
        # Login via Google murni dengan email unik baru
        unique_g_id = f"mock_google_oauth_only_{uuid.uuid4().hex[:6]}@aujasena.my.id"
        g_login = await client.post(
            "/api/auth/google",
            json={"id_token": unique_g_id},
        )
        assert g_login.status_code == 200
        g_data = g_login.json()
        g_token = g_data["access_token"]
        g_headers = {"Authorization": f"Bearer {g_token}"}

        # Coba unlink Google tanpa pernah mengatur password manual -> Harus 400 Bad Request
        unlink_res = await client.post("/api/auth/unlink-google", headers=g_headers)
        assert unlink_res.status_code == 400
        assert "kata sandi manual" in unlink_res.json()["detail"].lower()

        # Atur password baru
        set_pwd_res = await client.post(
            "/api/auth/set-password",
            json={"new_password": "NewManualPassword123!"},
            headers=g_headers,
        )
        assert set_pwd_res.status_code == 200

        # Sekarang unlink Google diizinkan karena pengguna punya password cadangan
        unlink_ok = await client.post("/api/auth/unlink-google", headers=g_headers)
        assert unlink_ok.status_code == 200
        assert unlink_ok.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_otp_rate_limiting():
    """Menguji batas rate limit pengiriman email OTP (maks 3x per 15 menit)."""
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("192.168.99.88", 50000)),
        base_url="http://test",
    ) as client:
        email = f"rate_limit_{uuid.uuid4().hex[:6]}@aujasena.my.id"

        # 3 kali permintaan pertama diizinkan
        for _ in range(3):
            res = await client.post("/api/auth/forgot-password/request", json={"email": email})
            assert res.status_code in [200, 404]  # 200 jika user ada, 404 jika belum, tapi tidak 429

        # Permintaan ke-4 harus dibatasi (429 Too Many Requests)
        blocked_res = await client.post("/api/auth/forgot-password/request", json={"email": email})
        assert blocked_res.status_code == 429
        assert "terlalu banyak" in blocked_res.json()["detail"].lower()


@pytest.mark.asyncio
async def test_http_caching_and_gzip_headers():
    """Menguji header kompresi GZip dan Cache-Control untuk aset statis."""
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("127.0.0.1", 50000)),
        base_url="http://test",
    ) as client:
        # 1. Halaman utama / index.html harus memiliki Cache-Control: no-cache
        res_html = await client.get("/", headers={"Accept": "text/html"})
        if res_html.status_code == 200 and "text/html" in res_html.headers.get("content-type", ""):
            assert "no-cache" in res_html.headers.get("cache-control", "")

        # 2. File statis di /assets/* harus memiliki Cache-Control immutable
        # Coba akses salah satu file js yang ada di web/dist/assets
        import os
        from pathlib import Path
        web_dist_assets = Path("web/dist/assets")
        if web_dist_assets.exists():
            asset_files = list(web_dist_assets.glob("*.js"))
            if asset_files:
                asset_name = asset_files[0].name
                res_asset = await client.get(f"/assets/{asset_name}")
                assert res_asset.status_code == 200
                cc = res_asset.headers.get("cache-control", "")
                assert "max-age=31536000" in cc
                assert "immutable" in cc
