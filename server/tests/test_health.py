import pytest
from httpx import ASGITransport, AsyncClient

from server.app.core.database import init_sqlite_wal
from server.app.main import app


@pytest.fixture(autouse=True)
async def setup_db():
    await init_sqlite_wal()
    yield


@pytest.mark.asyncio
async def test_root_endpoint():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "online"
        assert "health" in data


@pytest.mark.asyncio
async def test_health_check_endpoint():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["app"] == "Nexa Home Server"
        assert data["database"]["status"] == "connected"
        assert data["database"]["journal_mode"].lower() == "wal"
