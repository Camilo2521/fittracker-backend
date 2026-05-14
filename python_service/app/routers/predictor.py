"""
Router FastAPI — Predicción de progreso corporal con ProgressNet.

Endpoints:
  POST /predictor/forecast   — Predicción para un usuario
  GET  /predictor/status     — Estado del servicio (modelo cargado, etc.)
"""
from fastapi import APIRouter, Depends, HTTPException
from app.auth import verify_internal_token
from app.schemas.predictor import ForecastRequest, ForecastResponse
from app.services.predictor_service import predictor
import logging

logger = logging.getLogger("fittracker.predictor.router")
router = APIRouter(prefix="/predictor", tags=["Predictor"])


@router.post(
    "/forecast",
    response_model=ForecastResponse,
    dependencies=[Depends(verify_internal_token)],
    summary="Predicción de peso corporal con red neuronal",
)
async def forecast(req: ForecastRequest) -> ForecastResponse:
    """
    Recibe el perfil del usuario y su historial de pesos, actividad y calorías.
    Devuelve predicciones a 7, 14, 30, 60 y 90 días con intervalos de confianza.

    - Con < 10 registros de peso: modelo físico de balance calórico
    - Con ≥ 10 registros: MLP neuronal (ProgressNet) fine-tuned por usuario
    """
    if not predictor._ready:
        raise HTTPException(503, detail="Modelo no inicializado — el servicio está arrancando")

    try:
        return predictor.forecast(req)
    except Exception as exc:
        logger.exception(f"[predictor] Error en forecast user {req.user_id}: {exc}")
        raise HTTPException(500, detail=f"Error en predicción: {str(exc)}")


@router.get(
    "/status",
    dependencies=[Depends(verify_internal_token)],
    summary="Estado del servicio de predicción",
)
async def status() -> dict:
    return {
        "ready":        predictor._ready,
        "global_model": predictor._global_model is not None,
        "user_models":  len(predictor._user_models),
        "min_data_pts": 10,
        "horizons_days": [7, 14, 30, 60, 90],
    }
