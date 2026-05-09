"""
FitTracker Python Service — FastAPI entry point
Puerto: 8000
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from app.routers import health, vision, rag
from app.routers import pdf, frames
from app.config import get_settings
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("fittracker.python")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    logger.info("⚡ FitTracker Python Service iniciando")
    logger.info(f"   DB             : {settings.database_url[:40]}...")
    logger.info(f"   YOLO habilitado: {settings.feature_yolo_enabled}")
    logger.info(f"   RAG habilitado : {settings.feature_rag_enabled}")

    # Crear tablas SQLite si no existen (modo lite sin migración)
    if "sqlite" in settings.database_url:
        try:
            from app.database import get_engine, Base
            from app.models import rep_session, document  # noqa: registra modelos
            async with get_engine().begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            logger.info("   SQLite tables  : OK")
        except Exception as e:
            logger.warning(f"   SQLite init    : {e}")

    yield
    logger.info("🛑 Python Service apagándose")


app = FastAPI(
    title="FitTracker Vision & RAG Service",
    version="2.0.0",
    description="YOLOv8 + PDF + RAG. Accesible desde Node.js.",
    docs_url="/docs",
    redoc_url=None,
    lifespan=lifespan,
)

# CORS — configurable via CORS_ORIGINS env var (comma-separated)
_cors_origins = [o.strip() for o in get_settings().cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "x-internal-token"],
)

# Routers
app.include_router(health.router)
app.include_router(vision.router)
app.include_router(frames.router)
app.include_router(pdf.router)
app.include_router(rag.router)
