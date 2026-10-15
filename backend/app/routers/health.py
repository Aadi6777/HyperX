from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db, active_db_url
from app.schemas import HealthResponseDto

router = APIRouter(prefix="/api/v1", tags=["Health"])

@router.get("/health", response_model=HealthResponseDto)
async def get_health(db: AsyncSession = Depends(get_db)):
    db_status = "CONNECTED"
    try:
        await db.execute(text("SELECT 1"))
    except Exception as e:
        db_status = f"DISCONNECTED: {str(e)}"

    return HealthResponseDto(
        status="UP",
        service="HyperX Backend (Python / FastAPI)",
        version="1.0.0",
        database=db_status,
        timestamp=datetime.now(timezone.utc)
    )
