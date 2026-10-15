import asyncio
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from sqlalchemy import select
from server.app.core.security import hash_password
from server.app.core.database import AsyncSessionLocal
from server.app.models.user import User

TOTP_SECRET_TEST = "JBSWY3DPEHPK3PXP"  # Standard test TOTP secret

import json
from server.app.core.security import hash_code

RECOVERY_CODES_TEST = ["123456", "112233", "999999", "777888", "555666"]

async def seed_users():
    async with AsyncSessionLocal() as db:
        users_to_ensure = [
            ("budi", "Password123!", "admin", TOTP_SECRET_TEST),
            ("siti", "Password123!", "member", None),
            ("anak", "Password123!", "child", None),
        ]

        for username, password, role, totp in users_to_ensure:
            q = select(User).where(User.username == username)
            res = await db.execute(q)
            existing = res.scalar_one_or_none()

            pw_hash = hash_password(password)
            recov_json = json.dumps([hash_code(c) for c in RECOVERY_CODES_TEST]) if role == "admin" else None
            if existing:
                existing.role = role
                existing.password_hash = pw_hash
                existing.is_approved = True if role == "admin" else existing.is_approved
                if totp is not None:
                    existing.totp_secret = totp
                if recov_json is not None:
                    existing.recovery_codes = recov_json
                print(f"[Seed] User '{username}' updated (role: {role}).")
            else:
                new_u = User(
                    username=username,
                    password_hash=pw_hash,
                    role=role,
                    is_approved=True if role == "admin" else False,
                    totp_secret=totp,
                    recovery_codes=recov_json,
                )
                db.add(new_u)
                print(f"[Seed] User '{username}' created (role: {role}).")

        await db.commit()
    print("[Seed] Selesai seeding pengguna tes.")

if __name__ == "__main__":
    asyncio.run(seed_users())
