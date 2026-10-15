import uuid
import pytest
from httpx import ASGITransport, AsyncClient
from server.app.main import app


@pytest.mark.asyncio
async def test_register_and_login_with_email():
    uid = uuid.uuid4().hex[:6]
    uname = f"fauzi_{uid}"
    email = f"fauzi_{uid}@example.com"
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Register user baru
        reg_payload = {
            "full_name": "Ahmad Fauzi",
            "username": uname,
            "email": email,
            "password": "Password123!",
        }
        r_reg = await ac.post("/api/auth/register", json=reg_payload)
        assert r_reg.status_code == 201
        data = r_reg.json()
        assert data["status"] == "ok"
        assert data["user"]["email"] == email
        assert "access_token" in data

        # Login menggunakan EMAIL
        login_payload = {
            "username": email,
            "password": "Password123!",
        }
        r_login = await ac.post("/api/auth/login", json=login_payload)
        assert r_login.status_code == 200
        l_data = r_login.json()
        assert l_data["status"] == "ok"
        assert l_data["user"]["username"] == uname

        # Login menggunakan USERNAME
        login_u_payload = {
            "username": uname,
            "password": "Password123!",
        }
        r_login_u = await ac.post("/api/auth/login", json=login_u_payload)
        assert r_login_u.status_code == 200


@pytest.mark.asyncio
async def test_google_auth_and_account_linking():
    uid = uuid.uuid4().hex[:6]
    g_email = f"dewi_{uid}@gmail.com"
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 1. Google OAuth user baru
        g_payload = {"id_token": f"mock_google_{g_email}"}
        r_g = await ac.post("/api/auth/google", json=g_payload)
        assert r_g.status_code == 200
        data = r_g.json()
        assert data["status"] == "ok"
        assert data["user"]["email"] == g_email
        assert data["user"]["is_google_linked"] is True
        token = data["access_token"]

        # Cek /api/auth/me
        r_me = await ac.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert r_me.status_code == 200
        me = r_me.json()
        assert me["is_google_linked"] is True
        assert me["email"] == g_email

        # 2. Register manual dengan email lain
        rian_uname = f"rian_{uid}"
        rian_email = f"rian_{uid}@example.com"
        reg_payload = {
            "full_name": "Rian Pratama",
            "username": rian_uname,
            "email": rian_email,
            "password": "Password123!",
        }
        r_reg = await ac.post("/api/auth/register", json=reg_payload)
        assert r_reg.status_code == 201
        rian_token = r_reg.json()["access_token"]

        # 3. Tautkan akun Google via /api/auth/link-google
        r_link = await ac.post(
            "/api/auth/link-google",
            headers={"Authorization": f"Bearer {rian_token}"},
            json={"id_token": f"mock_google_link_{uid}@gmail.com"},
        )
        assert r_link.status_code == 200
        assert r_link.json()["status"] == "ok"

        # Cek status penautan
        r_me_rian = await ac.get("/api/auth/me", headers={"Authorization": f"Bearer {rian_token}"})
        assert r_me_rian.json()["is_google_linked"] is True


@pytest.mark.asyncio
async def test_forgot_password_and_otp_reset():
    uid = uuid.uuid4().hex[:6]
    email = f"siti_{uid}@example.com"
    uname = f"siti_{uid}"
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Register user
        r_reg = await ac.post(
            "/api/auth/register",
            json={
                "full_name": "Siti Rahma",
                "username": uname,
                "email": email,
                "password": "OldPassword123!",
            },
        )
        assert r_reg.status_code == 201

        # 1. Minta OTP reset kata sandi
        r_req = await ac.post("/api/auth/forgot-password/request", json={"email": email})
        assert r_req.status_code == 200

        # Ambil OTP langsung dari DB untuk simulasi input
        from server.app.core.database import AsyncSessionLocal
        from server.app.models.user import OtpCode
        from sqlalchemy import select

        async with AsyncSessionLocal() as db:
            otp_res = await db.execute(
                select(OtpCode).where(OtpCode.email == email, OtpCode.is_used == False)
            )
            otp_record = otp_res.scalars().first()
            assert otp_record is not None
            valid_otp = otp_record.code

        # 2. Reset password menggunakan OTP
        r_reset = await ac.post(
            "/api/auth/forgot-password/reset",
            json={
                "email": email,
                "otp": valid_otp,
                "new_password": "NewSecretPassword999!",
            },
        )
        assert r_reset.status_code == 200
        assert r_reset.json()["status"] == "ok"

        # 3. Login dengan password baru
        r_login = await ac.post(
            "/api/auth/login",
            json={"username": email, "password": "NewSecretPassword999!"},
        )
        assert r_login.status_code == 200


@pytest.mark.asyncio
async def test_send_qr_email():
    uid = uuid.uuid4().hex[:6]
    email = f"owner_{uid}@example.com"
    uname = f"owner_{uid}"
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r_reg = await ac.post(
            "/api/auth/register",
            json={
                "full_name": "Device Owner",
                "username": uname,
                "email": email,
                "password": "Password123!",
            },
        )
        assert r_reg.status_code == 201
        token = r_reg.json()["access_token"]

        # Kirim QR code perangkat ke email
        r_qr = await ac.post(
            "/api/auth/send-qr-email",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "device_id": "esp32-livingroom",
                "claim_token": "claim_tok_998877",
                "pairing_code": "PAIR-4455",
            },
        )
        assert r_qr.status_code == 200
        assert r_qr.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_login_user_without_password_hash_returns_400():
    """Memastikan akun yang terdaftar via Google OAuth (password_hash=None) mengembalikan 400 bukan 500."""
    uid = uuid.uuid4().hex[:6]
    g_email = f"google_only_{uid}@gmail.com"
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 1. Daftar via Google
        r_g = await ac.post("/api/auth/google", json={"id_token": f"mock_google_{g_email}"})
        assert r_g.status_code == 200

        # 2. Coba login manual dengan kata sandi biasa -> harus 400 (bukan 500)
        r_login = await ac.post(
            "/api/auth/login",
            json={"username": g_email, "password": "AnyRandomPassword123!"},
        )
        assert r_login.status_code == 400
        data = r_login.json()
        assert "Google" in data["detail"]


@pytest.mark.asyncio
async def test_login_empty_identifier_returns_400():
    """Memastikan login dengan identifier kosong mengembalikan 400 dengan pesan yang jelas."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r_login = await ac.post(
            "/api/auth/login",
            json={"username": "   ", "password": "Password123!"},
        )
        assert r_login.status_code == 400
        assert "wajib diisi" in r_login.json()["detail"]


@pytest.mark.asyncio
async def test_redirect_uri_whitelist_and_resolution():
    """Memastikan resolve_redirect_uri mengenali origin yang diizinkan dan default fallback."""
    from server.app.core.google_auth import resolve_redirect_uri, get_allowed_redirect_uris

    allowed = get_allowed_redirect_uris()
    assert "https://aujasena.my.id/login" in allowed
    assert "http://localhost:5173/login" in allowed

    # Matched URI
    assert resolve_redirect_uri("http://localhost:5173/login") == "http://localhost:5173/login"
    assert resolve_redirect_uri("https://aujasena.my.id/login") == "https://aujasena.my.id/login"

    # Unmatched URI -> fallback ke default
    fallback = resolve_redirect_uri("https://malicious-site.com/steal-token")
    assert fallback in ("https://aujasena.my.id/login", "http://localhost:5173/login")


@pytest.mark.asyncio
async def test_mock_google_token_rejection_in_non_dev():
    """Memastikan mock_google_ token ditolak di luar dev/test environment."""
    from server.app.core.google_auth import google_auth_service
    from server.app.core.config import settings

    # Simulasikan production di luar testing flag
    import sys
    sys_modules = sys.modules.copy()

    # Ketika bukan test dan APP_ENV = production
    old_env = settings.APP_ENV
    try:
        settings.APP_ENV = "production"
        # Memanggil verify_google_credentials langsung dengan sys.modules ditrik
        # Kita uji logikanya:
        with pytest.raises(ValueError, match="Dev mock token tidak diizinkan"):
            # Sengaja hapus pytest dari sys.modules sementara
            real_pytest = sys.modules.pop("pytest", None)
            try:
                await google_auth_service.verify_google_credentials(id_token="mock_google_hacker@gmail.com")
            finally:
                if real_pytest is not None:
                    sys.modules["pytest"] = real_pytest
    finally:
        settings.APP_ENV = old_env

