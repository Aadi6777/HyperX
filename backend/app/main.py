import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import init_db
from app.routers import auth, workspaces, health
from app.signaling import signaling_manager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("hyperx")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing HyperX Python backend...")
    await init_db()
    logger.info("HyperX database setup complete.")
    yield
    logger.info("HyperX backend shutting down.")

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="HyperX Enterprise P2P & CRDT Collaboration Platform",
    lifespan=lifespan
)

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS if settings.CORS_ORIGINS != ["*"] else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API Routers
app.include_router(health.router)
app.include_router(auth.router)
app.include_router(workspaces.router)

# WebSocket Signaling Endpoint
@app.websocket("/ws/signaling")
async def websocket_signaling_endpoint(websocket: WebSocket):
    await signaling_manager.connect(websocket)
    try:
        while True:
            text_data = await websocket.receive_text()
            await signaling_manager.handle_message(websocket, text_data)
    except WebSocketDisconnect:
        await signaling_manager.disconnect(websocket)
    except Exception as e:
        logger.warning(f"WebSocket error: {e}")
        await signaling_manager.disconnect(websocket)

@app.get("/")
async def root():
    return {
        "service": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "status": "ONLINE"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=settings.HOST, port=settings.PORT, reload=True)
