import logging
import os
import sys
from typing import Any, Dict, List, Optional
import httpx
from server.app.core.config import settings

logger = logging.getLogger("server.google_auth")


def get_allowed_redirect_uris() -> List[str]:
    """Mengembalikan daftar redirect URI yang diizinkan (whitelist)."""
    allowed: List[str] = []
    if settings.GOOGLE_REDIRECT_URI and settings.GOOGLE_REDIRECT_URI.strip():
        allowed.append(settings.GOOGLE_REDIRECT_URI.strip())

    base_origins = [
        settings.BASE_PUBLIC_URL,
        "https://aujasena.my.id",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ]
    for origin in base_origins:
        if origin:
            clean = origin.rstrip("/")
            login_url = f"{clean}/login"
            if login_url not in allowed:
                allowed.append(login_url)
    return allowed


def resolve_redirect_uri(redirect_uri: Optional[str] = None) -> str:
    """
    Validasi dan sinkronkan redirect URI berdasarkan whitelist.
    Prioritaskan redirect_uri dari client jika ada dalam whitelist.
    Fallback ke GOOGLE_REDIRECT_URI atau BASE_PUBLIC_URL/login.
    """
    allowed = get_allowed_redirect_uris()
    if redirect_uri:
        clean_uri = redirect_uri.strip().rstrip("/")
        for a in allowed:
            if clean_uri == a.rstrip("/"):
                return a
        logger.warning(
            f"[GoogleAuth] Redirect URI '{redirect_uri}' tidak ada di whitelist ({allowed}). "
            f"Fallback ke default."
        )

    if settings.GOOGLE_REDIRECT_URI and settings.GOOGLE_REDIRECT_URI.strip():
        return settings.GOOGLE_REDIRECT_URI.strip()
    return f"{settings.BASE_PUBLIC_URL.rstrip('/')}/login"


class GoogleAuthService:
    @classmethod
    def get_auth_url(cls, redirect_uri: Optional[str] = None, state: Optional[str] = None) -> str:
        """Menghasilkan URL consent Google OAuth2."""
        valid_redirect_uri = resolve_redirect_uri(redirect_uri)
        client_id = settings.GOOGLE_CLIENT_ID
        scope = "openid email profile"
        base_url = "https://accounts.google.com/o/oauth2/v2/auth"
        params = [
            f"client_id={client_id}",
            f"redirect_uri={valid_redirect_uri}",
            "response_type=code",
            f"scope={scope.replace(' ', '%20')}",
            "access_type=offline",
            "prompt=select_account",
        ]
        if state:
            params.append(f"state={state}")
        return f"{base_url}?{'&'.join(params)}"

    @classmethod
    async def verify_google_credentials(
        cls,
        id_token: Optional[str] = None,
        code: Optional[str] = None,
        access_token: Optional[str] = None,
        redirect_uri: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Verifikasi kredensial Google (ID Token, Auth Code, atau Access Token).
        Mengembalikan dict: { 'sub': str, 'email': str, 'name': str, 'email_verified': bool }
        """
        is_testing = "pytest" in sys.modules or os.environ.get("APP_ENV") == "test" or os.environ.get("TESTING") == "true"
        env = (settings.APP_ENV or "development").strip().lower()
        is_dev = env == "development"

        # 1. Dukungan mock untuk pengujian otomatis (Unit Test / Dev Mock)
        if id_token and id_token.startswith("mock_google_"):
            # Tutup celah keamanan: Larang keras dev mock token di production / non-development
            if not is_testing and not is_dev:
                logger.warning(f"[GoogleAuth] Penolakan mock token di environment '{env}': {id_token[:20]}")
                raise ValueError("Dev mock token tidak diizinkan di luar environment development/testing.")

            # Di environment development, jika GOOGLE_CLIENT_ID sudah aktif, jangan izinkan bypass mock
            if settings.GOOGLE_CLIENT_ID and not is_testing:
                raise ValueError("Dev mock token tidak diizinkan saat GOOGLE_CLIENT_ID aktif di luar pengujian.")

            email_part = id_token.replace("mock_google_", "")
            if "@" not in email_part:
                email_part = f"{email_part}@gmail.com"
            return {
                "sub": f"google_sub_{abs(hash(email_part)) % 1000000}",
                "email": email_part.lower(),
                "name": email_part.split("@")[0].title(),
                "email_verified": True,
            }

        # 2. Validasi konfigurasi jika bukan mock dan bukan testing
        if not is_testing:
            if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET:
                raise ValueError("Layanan Google OAuth belum dikonfigurasi di server (.env).")

        async with httpx.AsyncClient(timeout=10.0) as client:
            # 3. Jika menerima Auth Code dari redirect flow
            if code:
                token_url = "https://oauth2.googleapis.com/token"
                valid_redirect_uri = resolve_redirect_uri(redirect_uri)
                r_token = await client.post(
                    token_url,
                    data={
                        "code": code,
                        "client_id": settings.GOOGLE_CLIENT_ID,
                        "client_secret": settings.GOOGLE_CLIENT_SECRET,
                        "redirect_uri": valid_redirect_uri,
                        "grant_type": "authorization_code",
                    },
                )
                if r_token.status_code != 200:
                    logger.error(f"[GoogleAuth] Token exchange failed: {r_token.text}")
                    raise ValueError("Gagal menukar kode otorisasi Google.")

                token_json = r_token.json()
                id_token = token_json.get("id_token")
                access_token = token_json.get("access_token")

            # 4. Jika ada ID Token, verifikasi via endpoint resmi Google tokeninfo
            if id_token:
                verify_url = f"https://oauth2.googleapis.com/tokeninfo?id_token={id_token}"
                res = await client.get(verify_url)
                if res.status_code != 200:
                    logger.error(f"[GoogleAuth] ID Token verification failed: {res.text}")
                    raise ValueError("ID Token Google tidak valid atau telah kedaluwarsa.")

                data = res.json()
                # Jika GOOGLE_CLIENT_ID diset, verifikasi audience
                if settings.GOOGLE_CLIENT_ID and data.get("aud") != settings.GOOGLE_CLIENT_ID:
                    logger.warning("[GoogleAuth] Client ID mismatch pada Google Token.")

                return {
                    "sub": data.get("sub"),
                    "email": data.get("email", "").lower(),
                    "name": data.get("name") or data.get("email", "").split("@")[0],
                    "email_verified": data.get("email_verified") in [True, "true", "True", 1],
                }

            # 5. Jika menggunakan Access Token langsung
            if access_token:
                userinfo_url = "https://www.googleapis.com/oauth2/v3/userinfo"
                res = await client.get(userinfo_url, headers={"Authorization": f"Bearer {access_token}"})
                if res.status_code != 200:
                    raise ValueError("Access Token Google tidak valid.")

                data = res.json()
                return {
                    "sub": data.get("sub"),
                    "email": data.get("email", "").lower(),
                    "name": data.get("name") or data.get("email", "").split("@")[0],
                    "email_verified": data.get("email_verified", True),
                }

        raise ValueError("Kredensial Google (id_token, code, atau access_token) diperlukan.")


google_auth_service = GoogleAuthService()
