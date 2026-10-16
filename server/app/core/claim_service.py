import datetime
import hashlib
import hmac
import logging
import re
import secrets
import threading
import time
from typing import Any, Dict, Optional, Tuple

from fastapi import HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from server.app.core.device_queue import device_queue
from server.app.core.mqtt_auth import generate_device_mqtt_credentials
from server.app.models.claim_session import ClaimSession
from server.app.models.device import Channel, Device
from server.app.models.user import User

logger = logging.getLogger("server.claim_service")


class ClaimRateLimiter:
    """
    Rate limiter for device claiming:
    5 failed attempts per 10 minutes per account, per IP, and global.
    10-minute lockout on threshold reach.
    """

    def __init__(self):
        self._lock = threading.Lock()
        # key -> list of failed timestamps
        self._failures: Dict[str, list[float]] = {}
        # key -> locked_until timestamp
        self._lockouts: Dict[str, float] = {}

    def check_rate_limit(self, user_id: int, client_ip: str) -> None:
        now = time.time()
        window = 600.0  # 10 minutes
        lockout_duration = 600.0  # 10 minutes lockout

        with self._lock:
            # Check lockouts
            keys_to_check = [f"user:{user_id}", f"ip:{client_ip}", "global"]
            for key in keys_to_check:
                locked_until = self._lockouts.get(key, 0.0)
                if now < locked_until:
                    logger.warning("Claim rate limit lockout active for %s", key)
                    raise HTTPException(
                        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                        detail="Terlalu banyak percobaan. Coba lagi nanti.",
                    )

            # Clean expired failures
            for key in list(self._failures.keys()):
                self._failures[key] = [t for t in self._failures[key] if now - t < window]
                if not self._failures[key]:
                    self._failures.pop(key, None)

    def record_failure(self, user_id: int, client_ip: str) -> None:
        now = time.time()
        window = 600.0
        lockout_duration = 600.0
        threshold = 5

        with self._lock:
            for key in [f"user:{user_id}", f"ip:{client_ip}", "global"]:
                history = self._failures.setdefault(key, [])
                history.append(now)
                # Keep within window
                history = [t for t in history if now - t < window]
                self._failures[key] = history
                if len(history) >= threshold:
                    self._lockouts[key] = now + lockout_duration
                    logger.warning("Claim rate limit triggered for %s. Locked for 10 minutes.", key)

    def reset_for_testing(self) -> None:
        with self._lock:
            self._failures.clear()
            self._lockouts.clear()


claim_rate_limiter = ClaimRateLimiter()


def hash_secret(secret_val: str) -> str:
    """Compute constant-time SHA-256 hash."""
    clean = str(secret_val).strip()
    return hashlib.sha256(clean.encode("utf-8")).hexdigest()


async def create_claim_session(
    db: AsyncSession,
    device_id: str,
    ttl_seconds: int = 120,
) -> Dict[str, Any]:
    """
    Create a new single-use 120-second rotating claim session for a device.
    Enforces I5, I6, I7.
    """
    now = datetime.datetime.utcnow()
    thirty_days_ago = now - datetime.timedelta(days=30)

    # 1. Fetch past hashes for this device within 30 days
    past_hashes_query = select(ClaimSession.code_hash).where(
        ClaimSession.device_id == device_id,
        ClaimSession.created_at >= thirty_days_ago,
    )
    res_past = await db.execute(past_hashes_query)
    used_code_hashes = set(res_past.scalars().all())

    # 2. Fetch currently active code hashes for other devices
    active_hashes_query = select(ClaimSession.code_hash).where(
        ClaimSession.status == "aktif",
        ClaimSession.expires_at > now,
    )
    res_active = await db.execute(active_hashes_query)
    active_other_hashes = set(res_active.scalars().all())

    # 3. Generate unique code and token
    code = ""
    qr_token = ""
    code_hash = ""
    qr_hash = ""

    for _ in range(50):
        # 6-digit cryptographically secure decimal
        candidate_code = "%06d" % secrets.randbelow(1000000)
        c_hash = hash_secret(candidate_code)

        if c_hash in used_code_hashes or c_hash in active_other_hashes:
            continue

        # QR token: 128+ bit URL-safe token
        candidate_token = secrets.token_urlsafe(24)
        t_hash = hash_secret(candidate_token)

        code = candidate_code
        qr_token = candidate_token
        code_hash = c_hash
        qr_hash = t_hash
        break

    if not code:
        # Fallback high-entropy code
        code = "%06d" % secrets.randbelow(1000000)
        qr_token = secrets.token_urlsafe(24)
        code_hash = hash_secret(code)
        qr_hash = hash_secret(qr_token)

    # 4. Revoke any existing active session for this device
    await db.execute(
        update(ClaimSession)
        .where(ClaimSession.device_id == device_id, ClaimSession.status == "aktif")
        .values(status="dicabut")
    )

    # 5. Insert new session
    expires_at = now + datetime.timedelta(seconds=ttl_seconds)
    session = ClaimSession(
        device_id=device_id,
        code_hash=code_hash,
        qr_token_hash=qr_hash,
        status="aktif",
        created_at=now,
        expires_at=expires_at,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    # Register in device_queue for legacy / in-memory sync
    device_queue.register_pair_code(
        pair_code=code,
        device_id=device_id,
        device_key=qr_token,
        status={"session_id": session.id, "expires_at": expires_at.timestamp()},
    )

    claim_url = f"https://aujasena.my.id/#t={qr_token}"

    return {
        "device_id": device_id,
        "pair_code": code,
        "qr_token": qr_token,
        "expires_in": ttl_seconds,
        "claim_url": claim_url,
    }
