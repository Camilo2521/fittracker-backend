from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class UserProfile(BaseModel):
    external_id: str
    goal: str = "maintain"          # lose | gain | maintain
    current_weight: Optional[float] = None
    target_weight: Optional[float] = None
    height_cm: Optional[float] = None
    age: Optional[int] = None
    gender: Optional[str] = None    # male | female | other
    activity_level: str = "moderate"
    restrictions: Optional[str] = None  # vegetarian, gluten-free, etc.


class DietRequest(BaseModel):
    user_profile: UserProfile
    week_start: str  # YYYY-MM-DD


class RoutineRequest(BaseModel):
    user_profile: UserProfile
    days_per_week: int = Field(default=3, ge=1, le=7)


class IngestRequest(BaseModel):
    source: str
    title: str
    content: str
    chunk_size: int = 500


class MealOut(BaseModel):
    meal_type: str
    name: str
    calories: float
    protein_g: float
    carbs_g: float
    fat_g: float
    quantity_g: Optional[float] = None


class DayOut(BaseModel):
    day_of_week: int
    total_calories: float
    meals: list[MealOut]


class DietPlanOut(BaseModel):
    week_start: str
    goal: str
    calorie_target: float
    protein_g: float
    carbs_g: float
    fat_g: float
    days: list[DayOut]
    sources_used: list[str] = []


class ExerciseOut(BaseModel):
    name: str
    sets: Optional[int] = None
    reps: Optional[str] = None
    rest_sec: Optional[int] = None


class RoutineDayOut(BaseModel):
    day_index: int
    focus: str
    exercises: list[ExerciseOut]


class RoutinePlanOut(BaseModel):
    name: str
    goal: str
    weeks: int
    days_per_week: int
    days: list[RoutineDayOut]
    sources_used: list[str] = []


class RagQueryOut(BaseModel):
    id: str
    query_type: str
    created_at: datetime
    tokens_in: Optional[int] = None
    tokens_out: Optional[int] = None
    latency_ms: Optional[int] = None
