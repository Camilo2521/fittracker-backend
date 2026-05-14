"""
Schemas Pydantic para el servicio de predicción de progreso corporal.
"""
from __future__ import annotations
from pydantic import BaseModel, Field
from typing import Optional
from datetime import date


# ── Entrada ───────────────────────────────────────────────────────────────────

class UserProfile(BaseModel):
    weight_kg:       float = Field(..., gt=20, lt=300, description="Peso actual en kg")
    height_cm:       float = Field(..., gt=100, lt=250)
    age:             int   = Field(..., gt=5, lt=120)
    gender:          str   = Field(..., pattern="^(male|female|other)$")
    goal:            str   = Field(..., pattern="^(lose|gain|maintain)$")
    tdee:            Optional[float] = Field(None, gt=500, lt=8000)
    calorie_target:  Optional[float] = Field(None, gt=500, lt=8000)
    activity_level:  Optional[str]   = None


class WeightEntry(BaseModel):
    date:   date
    weight: float = Field(..., gt=20, lt=300)


class ActivityEntry(BaseModel):
    date:     date
    workouts: int   = Field(0, ge=0)
    duration: float = Field(0.0, ge=0)   # minutos


class CalorieEntry(BaseModel):
    date:     date
    calories: float = Field(..., gt=0, lt=10000)


class ForecastRequest(BaseModel):
    user_id:          int
    profile:          UserProfile
    weight_history:   list[WeightEntry]  = Field(default_factory=list)
    activity_history: list[ActivityEntry] = Field(default_factory=list)
    calorie_history:  list[CalorieEntry]  = Field(default_factory=list)


# ── Salida ────────────────────────────────────────────────────────────────────

class PredictionPoint(BaseModel):
    days:       int
    date:       date
    weight:     float  = Field(..., description="Peso predicho en kg")
    lower:      float  = Field(..., description="Límite inferior del intervalo 80%")
    upper:      float  = Field(..., description="Límite superior del intervalo 80%")
    confidence: float  = Field(..., ge=0.0, le=1.0)


class ForecastResponse(BaseModel):
    user_id:       int
    model_type:    str   = Field(..., description="'neural' | 'physics' | 'hybrid'")
    data_points:   int
    current_weight: float
    predictions:   list[PredictionPoint]
    trend:         str   = Field(..., description="'losing' | 'gaining' | 'stable'")
    weekly_rate:   float = Field(..., description="kg por semana estimados")
    goal_eta_days: Optional[int] = Field(None, description="Días estimados para alcanzar el objetivo")
    insights:      list[str]    = Field(default_factory=list)
    rmse:          Optional[float] = None
