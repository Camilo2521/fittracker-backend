"""
Frames Router — Análisis de frames de video con YOLOv8 en tiempo real.
POST /frames/analyze/{exercise_type}   multipart: frame=<JPEG bytes>
GET  /frames/session/{session_id}/summary
DELETE /frames/session/{session_id}
"""
from fastapi import APIRouter, Depends, File, UploadFile, HTTPException, Path
from app.auth import verify_internal_token
from app.config import get_settings

router = APIRouter(prefix="/frames", tags=["frames"])


@router.post(
    "/analyze/{exercise_type}",
    dependencies=[Depends(verify_internal_token)],
)
async def analyze_frame(
    exercise_type: str = Path(..., description="squat | pushup | plank | lunge"),
    session_id:    str = "default",
    frame: UploadFile = File(..., description="Frame JPEG del video"),
):
    """
    Recibe un frame JPEG y devuelve:
    { reps, phase, form_score, angles, issues, tips, keypoints }

    Si FEATURE_YOLO_ENABLED=true usa YOLOv8; si no, usa análisis de landmarks.
    """
    settings = get_settings()

    frame_bytes = await frame.read()
    if not frame_bytes:
        raise HTTPException(status_code=400, detail="Frame vacío")

    if settings.feature_yolo_enabled:
        try:
            from app.services.yolo_service import analyze_frame_yolo
            return analyze_frame_yolo(session_id, exercise_type, frame_bytes)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error YOLO: {e}")

    # Fallback: sin YOLO retornar feedback básico
    return {
        "reps": 0,
        "phase": "unknown",
        "form_score": 0,
        "angles": {},
        "issues": ["YOLO no habilitado"],
        "tips":   ["Activa FEATURE_YOLO_ENABLED=true"],
        "keypoints": [],
    }


@router.get(
    "/session/{session_id}/summary",
    dependencies=[Depends(verify_internal_token)],
)
async def session_summary(session_id: str):
    """Resumen acumulado de reps y form_score para una sesión."""
    from app.services.yolo_service import get_session_summary
    return get_session_summary(session_id)


@router.delete(
    "/session/{session_id}",
    dependencies=[Depends(verify_internal_token)],
)
async def clear_session(session_id: str):
    """Limpia el estado acumulado de una sesión."""
    from app.services.yolo_service import clear_session as _clear
    _clear(session_id)
    return {"cleared": session_id}
