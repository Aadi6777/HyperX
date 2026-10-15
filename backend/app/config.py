import os
from pydantic import BaseModel

class Settings(BaseModel):
    PROJECT_NAME: str = "HyperX"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    
    # Database
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        os.getenv(
            "SPRING_DATASOURCE_URL",
            "postgresql+asyncpg://hyperx_user:hyperx_secure_pass_2026@localhost:5432/hyperx_db"
        ).replace("jdbc:postgresql://", "postgresql+asyncpg://")
    )
    SQLITE_FALLBACK_URL: str = "sqlite+aiosqlite:///./hyperx_local.db"
    
    # Security
    JWT_SECRET_KEY: str = os.getenv("JWT_SECRET_KEY", "hyperx-ultra-secure-jwt-secret-key-32-bytes-minimum-length-2026")
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7 # 7 days
    
    # Server
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("SERVER_PORT", os.getenv("PORT", "8080")))
    CORS_ORIGINS: list[str] = ["*"]

settings = Settings()
