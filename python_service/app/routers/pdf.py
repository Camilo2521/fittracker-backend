"""
PDF Router — Genera y descarga el plan de dieta semanal en PDF.
POST /pdf/diet   { diet_data: {...}, user_name: "..." }
"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Any

from app.auth import verify_internal_token
from fastapi import Depends

router = APIRouter(prefix="/pdf", tags=["pdf"])


class DietPdfRequest(BaseModel):
    diet_data: dict[str, Any]
    user_name: str = "Usuario"


@router.post(
    "/diet",
    dependencies=[Depends(verify_internal_token)],
    response_class=Response,
    responses={200: {"content": {"application/pdf": {}}}},
)
async def generate_diet_pdf(payload: DietPdfRequest):
    try:
        from app.services.pdf_service import generate_diet_pdf as _gen
        pdf_bytes = _gen(payload.diet_data, payload.user_name)
        week = payload.diet_data.get("weekStart") or payload.diet_data.get("week_start", "semana")
        filename = f"fittracker-dieta-{week}.pdf"
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generando PDF: {e}")
