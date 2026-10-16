import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from server.app.core.database import Base, get_db
from server.app.core.security import create_access_token, hash_password
from server.app.main import app
from server.app.models.user import User


@pytest_asyncio.fixture
async def test_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    sm = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    yield sm
    await engine.dispose()


@pytest_asyncio.fixture
async def client(test_db):
    async def override_get_db():
        async with test_db() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_member_can_leave_family_successfully(client, test_db):
    # 1. Create owner and member in same family
    async with test_db() as session:
        owner = User(
            id=1,
            username="pemilik_rumah",
            password_hash=hash_password("pass123"),
            role="pemilik",
            is_active=True,
            is_approved=True,
            family_id=1,
        )
        member = User(
            id=2,
            username="anggota_keluarga",
            password_hash=hash_password("pass123"),
            role="member",
            is_active=True,
            is_approved=True,
            family_id=1,
        )
        session.add_all([owner, member])
        await session.commit()

    token_member = create_access_token(2, "anggota_keluarga", "member")
    headers = {"Authorization": f"Bearer {token_member}"}

    # 2. Member calls POST /api/family/leave
    res = await client.post("/api/family/leave", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert "berhasil keluar" in data["message"].lower()

    # 3. Check DB: member now has family_id=None and role='biasa'
    async with test_db() as session:
        u = await session.get(User, 2)
        assert u.family_id is None
        assert u.role in (None, "unassigned")


@pytest.mark.asyncio
async def test_user_without_family_cannot_leave(client, test_db):
    async with test_db() as session:
        user_alone = User(
            id=3,
            username="user_alone",
            password_hash=hash_password("pass123"),
            role="biasa",
            is_active=True,
            is_approved=True,
            family_id=None,
        )
        session.add(user_alone)
        await session.commit()

    token = create_access_token(3, "user_alone", "biasa")
    res = await client.post("/api/family/leave", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 400
    assert "belum bergabung" in res.json()["detail"].lower()


@pytest.mark.asyncio
async def test_owner_with_active_members_cannot_leave(client, test_db):
    async with test_db() as session:
        owner = User(
            id=10,
            username="pemilik_aktif",
            password_hash=hash_password("pass123"),
            role="pemilik",
            is_active=True,
            is_approved=True,
            family_id=10,
        )
        member = User(
            id=11,
            username="anggota_aktif",
            password_hash=hash_password("pass123"),
            role="member",
            is_active=True,
            is_approved=True,
            family_id=10,
        )
        session.add_all([owner, member])
        await session.commit()

    token_owner = create_access_token(10, "pemilik_aktif", "pemilik")
    res = await client.post("/api/family/leave", headers={"Authorization": f"Bearer {token_owner}"})
    assert res.status_code == 400
    assert "tidak dapat keluar" in res.json()["detail"].lower()
