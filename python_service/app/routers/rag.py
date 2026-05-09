"""
RAG Router — Fase 4: dieta y rutina generadas con OpenAI + pgvector.
Requiere FEATURE_RAG_ENABLED=true y OPENAI_API_KEY configurada.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
import uuid

from app.auth import verify_internal_token
from app.config import get_settings
from app.database import get_db
from app.models.document import RagQuery
from app.schemas.rag import (
    DietRequest, RoutineRequest, IngestRequest,
    DietPlanOut, RoutinePlanOut, RagQueryOut,
)
from app.services import rag_service

router = APIRouter(prefix="/rag", tags=["rag"])


def _require_rag():
    if not get_settings().feature_rag_enabled:
        raise HTTPException(status_code=501, detail={
            "error": "Feature 'rag_enabled' no habilitada",
            "flag":  "FEATURE_RAG_ENABLED",
            "hint":  "Configura FEATURE_RAG_ENABLED=true y OPENAI_API_KEY",
        })


# ── POST /rag/diet ──────────────────────────────────────────
@router.post("/diet", dependencies=[Depends(verify_internal_token)],
             response_model=DietPlanOut)
async def generate_diet(
    payload: DietRequest,
    db: AsyncSession = Depends(get_db),
):
    _require_rag()
    try:
        return await rag_service.generate_diet(
            payload.user_profile, payload.week_start, db
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error generando dieta: {e}")


# ── POST /rag/routine ───────────────────────────────────────
@router.post("/routine", dependencies=[Depends(verify_internal_token)],
             response_model=RoutinePlanOut)
async def generate_routine(
    payload: RoutineRequest,
    db: AsyncSession = Depends(get_db),
):
    _require_rag()
    try:
        return await rag_service.generate_routine(
            payload.user_profile, payload.days_per_week, db
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error generando rutina: {e}")


# ── POST /rag/ingest ────────────────────────────────────────
@router.post("/ingest", dependencies=[Depends(verify_internal_token)])
async def ingest_documents(
    payload: IngestRequest,
    db: AsyncSession = Depends(get_db),
):
    _require_rag()
    try:
        count = await rag_service.ingest_document(
            payload.source, payload.title, payload.content,
            payload.chunk_size, db,
        )
        return {"chunks_ingested": count, "source": payload.source}
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error ingiriendo documentos: {e}")


# ── GET /rag/queries/{external_id} ─────────────────────────
@router.get("/queries/{external_id}", dependencies=[Depends(verify_internal_token)],
            response_model=list[RagQueryOut])
async def get_rag_history(
    external_id: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(RagQuery)
        .where(RagQuery.external_id == external_id)
        .order_by(desc(RagQuery.created_at))
        .limit(50)
    )
    rows = result.scalars().all()
    return [
        RagQueryOut(
            id=str(r.id),
            query_type=r.query_type,
            created_at=r.created_at,
            tokens_in=r.tokens_in,
            tokens_out=r.tokens_out,
            latency_ms=r.latency_ms,
        )
        for r in rows
    ]
