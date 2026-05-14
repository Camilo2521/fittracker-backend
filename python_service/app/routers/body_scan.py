"""
Router: Body Scan — POST /body-scan
Análisis antropométrico de una foto de cuerpo completo.
"""
from fastapi import HTTPException
from fastapi.routing import APIRouter
from pydantic import BaseModel
from typing import Optional
from app.auth import verify_internal_token
from fastapi import Depends

router = APIRouter(prefix="/body-scan", tags=["body-scan"])


class BodyScanRequest(BaseModel):
    image_b64: str
    gender: Optional[str] = "male"


@router.post("", dependencies=[Depends(verify_internal_token)])
async def body_scan(req: BodyScanRequest):
    """
    Analiza una imagen base64 de cuerpo completo con YOLOv8-pose.
    Retorna tipo corporal, IMC estimado, % grasa y recomendaciones.
    """
    from app.services.body_scan_service import analyze_body
    result = analyze_body(req.image_b64, req.gender or "male")
    if result.get("error") and not result.get("personDetected"):
        raise HTTPException(status_code=422, detail=result["error"])
    return result
