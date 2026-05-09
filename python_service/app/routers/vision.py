"""
Vision Router — Fase 2: sesiones reales en PostgreSQL + análisis de forma.
Fase 3 (YOLOv8) se activa con FEATURE_YOLO_ENABLED=true.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text

from app.auth import verify_internal_token
from app.config import get_settings
from app.database import get_db
from app.models.rep_session import RepSession, RepSet
from app.schemas.vision import (
    SessionCreate, SessionOut, FrameAnalysis, FormFeedback,
    SessionComplete,
)
from app.services.vision_service import analyze_frame, estimate_calories

router = APIRouter(prefix="/vision", tags=["vision"])


# ── POST /vision/sessions ───────────────────────────────────
@router.post("/sessions", dependencies=[Depends(verify_internal_token)],
             response_model=SessionOut, status_code=201)
async def create_session(
    payload: SessionCreate,
    db: AsyncSession = Depends(get_db),
):
    session = RepSession(
        id=uuid.uuid4(),
        external_id=payload.external_id,
        exercise_type=payload.exercise_type,
        mode="yolov8" if get_settings().feature_yolo_enabled else "mediapipe",
        started_at=datetime.now(timezone.utc),
        total_reps=0,
        total_sets=0,
        created_at=datetime.now(timezone.utc),
    )
    db.add(session)
    await db.flush()
    await db.refresh(session)
    return _to_out(session)


# ── GET /vision/sessions/{session_id} ──────────────────────
@router.get("/sessions/{session_id}", dependencies=[Depends(verify_internal_token)],
            response_model=SessionOut)
async def get_session(session_id: str, db: AsyncSession = Depends(get_db)):
    session = await _get_or_404(db, session_id)
    return _to_out(session)


# ── POST /vision/sessions/{session_id}/complete ────────────
@router.post("/sessions/{session_id}/complete",
             dependencies=[Depends(verify_internal_token)],
             response_model=SessionOut)
async def complete_session(
    session_id: str,
    payload: SessionComplete,
    db: AsyncSession = Depends(get_db),
):
    session = await _get_or_404(db, session_id)

    session.ended_at      = datetime.now(timezone.utc)
    session.total_reps    = payload.total_reps
    session.total_sets    = payload.total_sets
    session.calories_burned = payload.calories_burned
    session.avg_form_score  = payload.avg_form_score
    session.notes           = payload.notes

    # Persistir sets individuales si los manda el cliente
    if payload.sets:
        for s in payload.sets:
            db.add(RepSet(
                id=uuid.uuid4(),
                session_id=session.id,
                set_number=s.set_number,
                reps=s.reps,
                duration_sec=s.duration_sec,
                form_score=s.form_score,
                keypoints_json=s.keypoints_json,
                created_at=datetime.now(timezone.utc),
            ))

    await db.flush()
    await db.refresh(session)
    return _to_out(session)


# ── POST /vision/analyze ────────────────────────────────────
@router.post("/analyze", dependencies=[Depends(verify_internal_token)],
             response_model=FormFeedback)
async def analyze(payload: FrameAnalysis):
    """
    Recibe landmarks de MediaPipe desde el cliente y devuelve
    puntuación de forma + consejos de corrección en tiempo real.
    No requiere conexión a BD — es análisis stateless por frame.
    """
    settings = get_settings()

    # Fase 3: si YOLO está habilitado, usar YOLOv8 pose
    if settings.feature_yolo_enabled:
        try:
            from app.services.yolo_service import analyze_frame_yolo
            return analyze_frame_yolo(payload.session_id, payload.landmarks)
        except ImportError:
            pass  # fallback a MediaPipe analysis

    # Fase 2: análisis de ángulos con landmarks de MediaPipe
    # Necesitamos el exercise_type → lo buscamos por session_id si viene
    return analyze_frame("squat", payload.landmarks)


# ── POST /vision/analyze/{exercise_type} ───────────────────
@router.post("/analyze/{exercise_type}",
             dependencies=[Depends(verify_internal_token)],
             response_model=FormFeedback)
async def analyze_exercise(exercise_type: str, payload: FrameAnalysis):
    """Versión con exercise_type explícito en la URL."""
    return analyze_frame(exercise_type, payload.landmarks)


# ── Helpers ─────────────────────────────────────────────────

async def _get_or_404(db: AsyncSession, session_id: str) -> RepSession:
    try:
        uid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="session_id inválido")
    result = await db.execute(select(RepSession).where(RepSession.id == uid))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Sesión no encontrada")
    return session


def _to_out(s: RepSession) -> SessionOut:
    return SessionOut(
        id=str(s.id),
        external_id=s.external_id,
        exercise_type=s.exercise_type,
        mode=s.mode,
        started_at=s.started_at,
        ended_at=s.ended_at,
        total_reps=s.total_reps,
        total_sets=s.total_sets,
        calories_burned=s.calories_burned,
        avg_form_score=s.avg_form_score,
        notes=s.notes,
    )
