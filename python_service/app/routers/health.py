from fastapi import APIRouter
from sqlalchemy import text
from app.database import get_engine
from app.config import get_settings
import time

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check():
    settings = get_settings()
    checks = {
        "postgres":  "unknown",
        "yolo":      "disabled",
        "rag":       "disabled",
        "embedder":  "disabled",
    }
    start = time.time()

    # Postgres
    try:
        engine = get_engine()
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        checks["postgres"] = "ok"
    except Exception as e:
        checks["postgres"] = f"error: {e}"

    # Feature flags
    if settings.feature_yolo_enabled:
        try:
            from ultralytics import YOLO  # noqa: F401
            checks["yolo"] = "ok"
        except ImportError:
            checks["yolo"] = "error: ultralytics no instalado"

    if settings.feature_rag_enabled:
        try:
            from sentence_transformers import SentenceTransformer  # noqa: F401
            checks["embedder"] = "ok"
            # RAG funciona con OpenAI o con Ollama local
            if settings.openai_api_key:
                checks["rag"] = "ok (openai)"
            elif settings.ollama_url:
                checks["rag"] = "ok (ollama)"
            else:
                checks["rag"] = "error: configura OPENAI_API_KEY u OLLAMA_URL"
        except ImportError:
            checks["embedder"] = "error: sentence-transformers no instalado"

    latency_ms = round((time.time() - start) * 1000)
    all_ok = all(v.startswith("ok") or v == "disabled" for v in checks.values())

    return {
        "status":     "ok" if all_ok else "degraded",
        "checks":     checks,
        "version":    "2.0.0",
        "latency_ms": latency_ms,
    }
