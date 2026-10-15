import datetime
import hashlib
import json
import secrets
from typing import Any, Optional
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
import jwt
import pyotp

from server.app.core.config import settings

ph = PasswordHasher()


def hash_password(password: str) -> str:
    """Hash password using Argon2id."""
    return ph.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """Verify password against Argon2id hash."""
    try:
        return ph.verify(password_hash, password)
    except VerifyMismatchError:
        return False
    except Exception:
        return False


def hash_code(code: str) -> str:
    """Hash a recovery code or refresh token using SHA-256."""
    return hashlib.sha256(f"{code}:{settings.SECRET_KEY}".encode("utf-8")).hexdigest()


def generate_recovery_codes(count: int = 8) -> tuple[list[str], list[str]]:
    """Generate plaintext recovery codes and their hashes for storage."""
    plain_codes = []
    hashed_codes = []
    for _ in range(count):
        part1 = secrets.token_hex(2).upper()
        part2 = secrets.token_hex(2).upper()
        code = f"{part1}-{part2}"
        plain_codes.append(code)
        hashed_codes.append(hash_code(code))
    return plain_codes, hashed_codes


def verify_recovery_code(code: str, stored_json: Optional[str]) -> tuple[bool, Optional[str]]:
    """Verify code against stored hashed recovery codes.
    Returns (is_valid, updated_json_with_code_consumed).
    """
    if not stored_json:
        return False, None
    try:
        hashes = json.loads(stored_json)
        input_hash = hash_code(code.strip().upper())
        if input_hash in hashes:
            hashes.remove(input_hash)
            return True, json.dumps(hashes)
    except Exception:
        return False, None
    return False, None


def generate_totp_secret() -> str:
    """Generate base32 secret for TOTP 2FA."""
    return pyotp.random_base32()


def get_totp_uri(secret: str, username: str) -> str:
    """Generate otpauth:// URI for authenticator apps."""
    totp = pyotp.TOTP(secret)
    return totp.provisioning_uri(name=username, issuer_name="Rumah Smart Home")


def verify_totp(secret: str, code: str) -> bool:
    """Verify 6-digit TOTP code (with 1 step drift tolerance)."""
    if not secret or not code:
        return False
    totp = pyotp.TOTP(secret)
    return totp.verify(code.strip(), valid_window=1)


def create_access_token(user_id: int, username: str, role: str | None) -> str:
    """Generate short-lived JWT access token."""
    expire = datetime.datetime.utcnow() + datetime.timedelta(
        minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )
    payload = {
        "sub": str(user_id),
        "username": username,
        "role": role,
        "type": "access",
        "exp": expire,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")


def create_temp_token(user_id: int, username: str, expires_minutes: int = 5) -> str:
    """Generate temporary token for pending 2FA step."""
    expire = datetime.datetime.utcnow() + datetime.timedelta(minutes=expires_minutes)
    payload = {
        "sub": str(user_id),
        "username": username,
        "type": "2fa_pending",
        "exp": expire,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")


def create_refresh_token_string() -> str:
    """Generate a random cryptographic string for refresh token."""
    return secrets.token_urlsafe(48)


def decode_token(token: str) -> dict[str, Any]:
    """Decode and validate JWT token signature and expiration."""
    return jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
