import base64
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import time
from typing import Dict, List, Optional

from server.app.core.config import BASE_DIR, settings

MOSQUITTO_DIR = BASE_DIR / "server" / "data" / "mosquitto"
MOSQUITTO_DIR.mkdir(parents=True, exist_ok=True)

PASSWD_FILE = MOSQUITTO_DIR / "mosquitto.passwd"
ACL_FILE = MOSQUITTO_DIR / "mosquitto.acl"
CONF_FILE = MOSQUITTO_DIR / "mosquitto.conf"


def hash_mosquitto_password(password: str, iterations: int = 1000) -> str:
    """Generate Mosquitto $7$ (PBKDF2-SHA512) password hash."""
    salt = os.urandom(12)
    salt_b64 = base64.b64encode(salt).decode("ascii")
    derived = hashlib.pbkdf2_hmac("sha512", password.encode("utf-8"), salt, iterations)
    hash_b64 = base64.b64encode(derived).decode("ascii")
    return f"$7${iterations}${salt_b64}${hash_b64}"


def ensure_mosquitto_config(server_password: Optional[str] = None):
    """Ensure initial Mosquitto config, password, and ACL files exist."""
    MOSQUITTO_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Pastikan server account ada di password file jika belum ada
    server_user = settings.MQTT_USERNAME
    server_pwd = server_password or settings.MQTT_PASSWORD or "rumah_secret_pass"

    users = get_all_passwd_users()
    if server_user not in users:
        add_or_update_mqtt_user(server_user, server_pwd)

    # 2. Pastikan file ACL terisi
    sync_acl_file(list(users.keys()))

    # 3. Buat file konfigurasi mosquitto.conf jika belum ada
    if not CONF_FILE.exists():
        conf_content = f"""# Konfigurasi Mosquitto untuk Rumah Smart Home
# Dibatasi hanya mendengarkan di LAN (port 1883)
listener 1883 0.0.0.0
allow_anonymous false
password_file {PASSWD_FILE.as_posix()}
acl_file {ACL_FILE.as_posix()}
persistence true
persistence_location {(MOSQUITTO_DIR / "data").as_posix()}/
"""
        CONF_FILE.write_text(conf_content, encoding="utf-8")
        (MOSQUITTO_DIR / "data").mkdir(parents=True, exist_ok=True)


def get_all_passwd_users() -> Dict[str, str]:
    """Read all username:hash pairs from mosquitto.passwd."""
    users = {}
    if PASSWD_FILE.exists():
        for line in PASSWD_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and ":" in line:
                u, h = line.split(":", 1)
                users[u.strip()] = h.strip()
    return users


def add_or_update_mqtt_user(username: str, password: str) -> None:
    """Add or update username in Mosquitto password file."""
    # Coba gunakan utilitas mosquitto_passwd jika terpasang
    mosq_passwd_bin = None
    for candidate in [
        r"C:\Program Files\mosquitto\mosquitto_passwd.exe",
        "mosquitto_passwd",
    ]:
        try:
            res = subprocess.run([candidate, "-v"], capture_output=True, timeout=2)
            mosq_passwd_bin = candidate
            break
        except Exception:
            continue

    if mosq_passwd_bin:
        try:
            subprocess.run(
                [mosq_passwd_bin, "-b", str(PASSWD_FILE), username, password],
                check=True,
                capture_output=True,
                timeout=5,
            )
            return
        except Exception:
            pass

    # Fallback murni Python
    users = get_all_passwd_users()
    users[username] = hash_mosquitto_password(password)
    lines = [f"{u}:{h}" for u, h in users.items()]
    PASSWD_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")


def remove_mqtt_user(username: str) -> None:
    """Remove user from password file."""
    users = get_all_passwd_users()
    if username in users:
        del users[username]
        lines = [f"{u}:{h}" for u, h in users.items()]
        PASSWD_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")


RESTRICTED_FILE = MOSQUITTO_DIR / "restricted_devices.json"


def get_restricted_devices() -> Dict[str, float]:
    """Read restricted devices and their expiration timestamp from file."""
    if RESTRICTED_FILE.exists():
        try:
            return json.loads(RESTRICTED_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_restricted_devices(data: Dict[str, float]) -> None:
    try:
        RESTRICTED_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")
    except Exception:
        pass


def sync_acl_file(device_ids: List[str]) -> None:
    """Regenerate Mosquitto ACL file based on current active devices."""
    server_user = settings.MQTT_USERNAME
    restricted = get_restricted_devices()
    now_ts = time.time()

    # Clean expired restrictions (older than 7 days)
    active_restricted = {k: exp for k, exp in restricted.items() if exp > now_ts}
    if len(active_restricted) != len(restricted):
        save_restricted_devices(active_restricted)

    lines = [
        "# ==================================================================",
        "# Rumah Mosquitto Access Control List (ACL)",
        "# Dihasilkan secara otomatis oleh Backend Rumah",
        "# ==================================================================",
        "",
        f"# Hak akses penuh untuk server backend",
        f"user {server_user}",
        "topic readwrite #",
        "",
    ]

    for dev_id in sorted(device_ids):
        if dev_id == server_user:
            continue
        lines.append(f"# Perangkat: {dev_id}")
        lines.append(f"user {dev_id}")
        if dev_id in active_restricted:
            # S4: Kredensial terbatas (hanya subscribe cmd dan publish ack)
            lines.append(f"topic read home/{dev_id}/cmd")
            lines.append(f"topic write home/{dev_id}/ack")
        else:
            lines.append(f"topic readwrite home/{dev_id}/#")
        lines.append("")

    ACL_FILE.write_text("\n".join(lines), encoding="utf-8")


def restrict_device_mqtt_credentials(device_id: str, ttl_days: int = 7) -> None:
    """
    S4: Batasi kredensial perangkat offline menjadi kredensial TERBATAS.
    ACL hanya boleh subscribe topik cmd miliknya dan publish ack miliknya.
    Berlaku selama 7 hari menunggu reset ack dari perangkat saat online.
    """
    restricted = get_restricted_devices()
    restricted[device_id] = time.time() + (ttl_days * 86400)
    save_restricted_devices(restricted)

    users = get_all_passwd_users()
    sync_acl_file(list(users.keys()))
    reload_mosquitto_broker()


def generate_device_mqtt_credentials(device_id: str) -> Dict[str, str]:
    """Generate a random secure password for a device, update password file & ACL."""
    # Hapus dari pembatasan jika sebelumnya pernah dibatasi
    restricted = get_restricted_devices()
    if device_id in restricted:
        del restricted[device_id]
        save_restricted_devices(restricted)

    password = f"dev_{secrets.token_urlsafe(16)}"
    add_or_update_mqtt_user(device_id, password)

    users = get_all_passwd_users()
    sync_acl_file(list(users.keys()))
    reload_mosquitto_broker()

    return {
        "mqtt_username": device_id,
        "mqtt_password": password,
    }


def revoke_device_mqtt_credentials(device_id: str) -> None:
    """Remove device credentials from Mosquitto password file and ACL."""
    restricted = get_restricted_devices()
    if device_id in restricted:
        del restricted[device_id]
        save_restricted_devices(restricted)

    remove_mqtt_user(device_id)
    users = get_all_passwd_users()
    sync_acl_file(list(users.keys()))
    reload_mosquitto_broker()


def reload_mosquitto_broker() -> None:
    """Attempt to reload or restart Mosquitto service without raising error."""
    try:
        # Pada Windows Service
        subprocess.run(
            ["powershell", "-NoProfile", "-Command", "Restart-Service -Name mosquitto -ErrorAction SilentlyContinue"],
            capture_output=True,
            timeout=5,
        )
    except Exception:
        pass
