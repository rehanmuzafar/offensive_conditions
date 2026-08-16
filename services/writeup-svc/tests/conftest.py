"""Pytest configuration."""

from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator, Iterator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("DB_HOST", os.environ.get("TEST_DB_HOST", "localhost"))
os.environ.setdefault("DB_NAME", os.environ.get("TEST_DB_NAME", "offcon_test"))
os.environ.setdefault("DB_USER", os.environ.get("TEST_DB_USER", "postgres"))
os.environ.setdefault("DB_PASSWORD", os.environ.get("TEST_DB_PASSWORD", "postgres"))
os.environ.setdefault("REDIS_DB", "15")
os.environ.setdefault("AUTH_JWT_PUBLIC_KEY_PATH", "./testdata/jwt.pub")


@pytest.fixture(scope="session")
def event_loop() -> Iterator[asyncio.AbstractEventLoop]:
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="session")
async def db_engine():
    from app.core.config import get_settings

    settings = get_settings()
    engine = create_async_engine(settings.database_url, echo=False)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(db_engine) -> AsyncIterator[AsyncSession]:
    factory = async_sessionmaker(db_engine, expire_on_commit=False)
    async with factory() as session:
        yield session
        await session.rollback()


@pytest_asyncio.fixture
async def app_client() -> AsyncIterator[AsyncClient]:
    from app.main import create_app

    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client
