from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
import uuid


class SessionCreate(BaseModel):
    external_id: str
    exercise_type: str  # squat, pushup, plank, lunge, deadlift


class Landmark(BaseModel):
    x: float
    y: float
    z: float = 0.0
    visibility: float = 1.0


class FrameAnalysis(BaseModel):
    session_id: str
    landmarks: list[Landmark]  # 33 MediaPipe pose landmarks
    timestamp_ms: int = 0


class FormFeedback(BaseModel):
    form_score: float = Field(..., ge=0, le=100)
    angles: dict[str, float]
    issues: list[str]
    tips: list[str]


class SetData(BaseModel):
    set_number: int
    reps: int
    duration_sec: Optional[float] = None
    form_score: Optional[float] = None
    keypoints_json: Optional[dict] = None


class SessionComplete(BaseModel):
    total_reps: int = 0
    total_sets: int = 1
    calories_burned: Optional[float] = None
    avg_form_score: Optional[float] = None
    notes: Optional[str] = None
    sets: Optional[list[SetData]] = None


class SessionOut(BaseModel):
    id: str
    external_id: str
    exercise_type: str
    mode: str
    started_at: datetime
    ended_at: Optional[datetime] = None
    total_reps: int
    total_sets: int
    calories_burned: Optional[float] = None
    avg_form_score: Optional[float] = None
    notes: Optional[str] = None
