import logging
from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from app.config import settings

logger = logging.getLogger("hyperx.database")

Base = declarative_base()

def get_engine():
    # If DATABASE_URL starts with postgres://, replace with postgresql+asyncpg://
    db_url = settings.DATABASE_URL
    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql+asyncpg://", 1)
    elif db_url.startswith("postgresql://"):
        db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    
    # Asyncpg expects ssl= instead of sslmode=
    if "sslmode=require" in db_url:
        db_url = db_url.replace("sslmode=require", "ssl=require")
    elif "sslmode=prefer" in db_url:
        db_url = db_url.replace("sslmode=prefer", "ssl=prefer")
        
    try:
        engine = create_async_engine(
            db_url,
            echo=False,
            future=True,
            pool_pre_ping=True
        )
        return engine, db_url
    except Exception as e:
        logger.warning(f"Could not initialize primary database engine: {e}. Falling back to SQLite.")
        fallback_engine = create_async_engine(
            settings.SQLITE_FALLBACK_URL,
            echo=False,
            future=True
        )
        return fallback_engine, settings.SQLITE_FALLBACK_URL

engine, active_db_url = get_engine()
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False
)

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()

async def init_db():
    global engine, AsyncSessionLocal, active_db_url
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info(f"Database initialized successfully with URL: {active_db_url}")
    except Exception as e:
        logger.warning(f"Failed to connect to primary DB ({active_db_url}): {e}. Switching to SQLite fallback.")
        engine = create_async_engine(settings.SQLITE_FALLBACK_URL, echo=False, future=True)
        active_db_url = settings.SQLITE_FALLBACK_URL
        AsyncSessionLocal = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info(f"SQLite database initialized successfully at {settings.SQLITE_FALLBACK_URL}")
