import datetime
import secrets
import pytest
from httpx import AsyncClient, ASGITransport
from server.app.main import app
from server.app.core.database import get_db, async_session_factory
from server.app.core.security import create_access_token, hash_password
from server.app.models.device import Device, Channel
from server.app.models.user import User
from server.app.core.mqtt_auth import get_all_passwd_users, PASSWD_FILE

@pytest.mark.asyncio
async def test_unbind_device_full_flow():
    uid = secrets.token_hex(4)
    owner_username = f"owner_unbind_{uid}"
    member_username = f"member_unbind_{uid}"
    dev_online_id = f"esp32_on_{uid}"
    dev_offline_id = f"esp32_off_{uid}"

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        async with async_session_factory() as session:
            # 1. Create owner user and normal user
            owner = User(
                username=owner_username,
                password_hash=hash_password("Password123!"),
                role="pemilik",
                is_active=True,
                is_approved=True,
            )
            member_user = User(
                username=member_username,
                password_hash=hash_password("Password123!"),
                role="member",
                is_active=True,
                is_approved=True,
            )
            session.add_all([owner, member_user])
            await session.commit()
            await session.refresh(owner)
            await session.refresh(member_user)

            # Create devices: online device & offline device
            now = datetime.datetime.utcnow()
            dev_online = Device(
                id=dev_online_id,
                name="Device Online Test",
                room="Ruang Tamu",
                owner_id=owner.id,
                is_online=True,
                last_seen_at=now,
                mqtt_password_hash="some_hash",
            )
            dev_offline = Device(
                id=dev_offline_id,
                name="Device Offline Test",
                room="Kamar",
                owner_id=owner.id,
                is_online=False,
                last_seen_at=now - datetime.timedelta(minutes=30),
                mqtt_password_hash="some_hash",
            )
            session.add_all([dev_online, dev_offline])
            await session.commit()

        owner_token = create_access_token(owner.id, owner.username, owner.role)
        member_token = create_access_token(member_user.id, member_user.username, member_user.role)

        owner_headers = {"Authorization": f"Bearer {owner_token}"}
        member_headers = {"Authorization": f"Bearer {member_token}"}

        # TEST 1: Unbind without permission (member user -> 403)
        res_403 = await client.post(f"/api/devices/{dev_online_id}/unbind", headers=member_headers)
        assert res_403.status_code == 403, f"Expected 403, got {res_403.status_code}: {res_403.text}"

        # TEST 2: Device not found (404)
        res_404 = await client.post("/api/devices/esp32_nonexistent/unbind", headers=owner_headers)
        assert res_404.status_code == 404, f"Expected 404, got {res_404.status_code}: {res_404.text}"

        # TEST 3: Unbind online device
        res_online = await client.post(f"/api/devices/{dev_online_id}/unbind", headers=owner_headers)
        assert res_online.status_code == 200
        data_online = res_online.json()
        assert data_online["status"] == "ok"
        assert data_online["is_online"] is True
        assert data_online["factory_reset_sent"] is True

        # TEST 4: Idempotent call (double click / calling again)
        res_idempotent = await client.post(f"/api/devices/{dev_online_id}/unbind", headers=owner_headers)
        assert res_idempotent.status_code == 200
        assert res_idempotent.json()["status"] == "ok"

        # TEST 5: Unbind offline device
        res_offline = await client.post(f"/api/devices/{dev_offline_id}/unbind", headers=owner_headers)
        assert res_offline.status_code == 200
        data_offline = res_offline.json()
        assert data_offline["status"] == "ok"
        assert data_offline["is_online"] is False
        assert data_offline["factory_reset_sent"] is False

        # TEST 6: Verify list_devices no longer returns unbound devices
        res_list = await client.get("/api/devices", headers=owner_headers)
        assert res_list.status_code == 200
        listed_ids = [d["id"] for d in res_list.json().get("devices", [])]
        assert dev_online_id not in listed_ids
        assert dev_offline_id not in listed_ids

        # TEST 7: Verify BUG-03 fix (member without family_id gets 403 on /cmd)
        res_cmd = await client.post(
            f"/api/devices/{dev_online_id}/cmd",
            headers=member_headers,
            json={"channel": "lamp", "action": "set", "value": True},
        )
        assert res_cmd.status_code in (400, 403)
