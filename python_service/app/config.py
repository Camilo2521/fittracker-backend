from pydantic_settings import BaseSettings
from functools import lru_cache
import logging
import warnings

logger = logging.getLogger("fittracker.config")

_INSECURE_SECRET = "changeme"


class Settings(BaseSettings):
    database_url:      str = "sqlite+aiosqlite:///./fittracker_lite.db"
    database_url_sync: str = "sqlite:///./fittracker_lite.db"

    internal_api_secret: str = _INSECURE_SECRET

    openai_api_key: str = ""

    # Ollama (LLM local — alternativa a OpenAI para RAG)
    ollama_url:   str = "http://127.0.0.1:11434"
    ollama_model: str = "llama3.2"

    yolo_model_path: str = "yolov8n-pose.pt"

    feature_yolo_enabled: bool = True
    feature_rag_enabled:  bool = False

    environment: str = "development"

    cors_origins: str = "http://localhost:3000,http://localhost:8080"

    class Config:
        env_file = ".env"
        case_sensitive = False


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if s.internal_api_secret == _INSECURE_SECRET:
        msg = (
            "[config] INTERNAL_API_SECRET no configurado — usando valor por defecto inseguro. "
            "Configura INTERNAL_API_SECRET en python_service/.env antes de desplegar a producción."
        )
        if s.environment == "production":
            raise RuntimeError(msg)
        warnings.warn(msg)
    return s
