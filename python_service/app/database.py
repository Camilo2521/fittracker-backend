from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.config import get_settings


class Base(DeclarativeBase):
    pass


def _get_engine():
    settings = get_settings()
    url = settings.database_url
    # SQLite no soporta pool_size/max_overflow
    is_sqlite = url.startswith("sqlite")
    kwargs = {"echo": (settings.environment == "development")}
    if not is_sqlite:
        kwargs["pool_size"]    = 5
        kwargs["max_overflow"] = 10
    return create_async_engine(url, **kwargs)


_engine = None
_SessionLocal = None


def get_engine():
    global _engine
    if _engine is None:
        _engine = _get_engine()
    return _engine


def get_session_factory():
    global _SessionLocal
    if _SessionLocal is None:
        _SessionLocal = async_sessionmaker(
            bind=get_engine(),
            class_=AsyncSession,
            expire_on_commit=False,
        )
    return _SessionLocal


async def get_db() -> AsyncSession:
    factory = get_session_factory()
    async with factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
