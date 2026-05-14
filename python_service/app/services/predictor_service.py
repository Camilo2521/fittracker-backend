"""
FitTracker — Servicio de predicción de progreso corporal con red neuronal.

Arquitectura de dos capas:
  1. Modelo físico (energy balance): disponible desde el primer día, sin entrenamiento.
  2. ProgressNet (MLP PyTorch): aprende el residual sobre el modelo físico cuando el
     usuario tiene ≥ MIN_NEURAL_POINTS registros de peso. El modelo global se entrena
     con datos sintéticos al arrancar el servicio; luego se afina por usuario.

Estrategia de predicción:
  - < MIN_NEURAL_POINTS datos → modelo físico puro
  - ≥ MIN_NEURAL_POINTS datos → blend (física + residual neuronal)
"""
from __future__ import annotations

import json
import logging
import math
import os
import random
import time
from datetime import date, timedelta
from pathlib import Path
from typing import Optional

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

from app.schemas.predictor import (
    ActivityEntry, CalorieEntry, ForecastResponse, ForecastRequest,
    PredictionPoint, UserProfile, WeightEntry,
)

logger = logging.getLogger("fittracker.predictor")

# ── Constantes ────────────────────────────────────────────────────────────────

HORIZONS        = [7, 14, 30, 60, 90]   # días a predecir
INPUT_DIM       = 18                     # dimensión del vector de entrada
MIN_NEURAL_PTS  = 10                     # mínimo de pesadas para activar la NN
KCAL_PER_KG     = 7_700.0               # kcal necesarias para cambiar 1 kg de grasa
MODELS_DIR      = Path(os.environ.get("MODELS_DIR", "./models/predictor"))
GLOBAL_MODEL_PATH   = MODELS_DIR / "global_base.pt"
GLOBAL_SCALER_PATH  = MODELS_DIR / "global_scaler.json"


# ── Red neuronal ─────────────────────────────────────────────────────────────

class ProgressNet(nn.Module):
    """
    MLP con normalización por capas para predicción de peso corporal.

    Aprende el *residual* sobre el modelo físico de balance energético, lo que
    hace que el entrenamiento sea mucho más estable y eficiente en datos escasos.

    Input  : vector de 18 features (perfil + historia + predicciones físicas)
    Output : 5 residuales en kg (uno por horizonte: 7/14/30/60/90 días)
    """

    def __init__(self, input_dim: int = INPUT_DIM):
        super().__init__()
        self.encoder = nn.Sequential(
            nn.Linear(input_dim, 128),
            nn.LayerNorm(128),
            nn.GELU(),
            nn.Dropout(0.15),
        )
        self.block1 = nn.Sequential(
            nn.Linear(128, 64),
            nn.LayerNorm(64),
            nn.GELU(),
            nn.Dropout(0.10),
        )
        self.block2 = nn.Sequential(
            nn.Linear(64, 32),
            nn.GELU(),
        )
        self.head = nn.Linear(32, len(HORIZONS))

        # Inicialización conservadora — la NN parte cerca de "no residual"
        nn.init.zeros_(self.head.weight)
        nn.init.zeros_(self.head.bias)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h = self.encoder(x)
        h = self.block1(h)
        h = self.block2(h)
        return self.head(h)


# ── Scaler simple (sin sklearn) ───────────────────────────────────────────────

class MinMaxScaler:
    """Min-max scaler serializable a JSON."""

    def __init__(self):
        self.mins: list[float] = []
        self.maxs: list[float] = []
        self.fitted = False

    def fit(self, X: np.ndarray) -> "MinMaxScaler":
        self.mins = X.min(axis=0).tolist()
        self.maxs = X.max(axis=0).tolist()
        self.fitted = True
        return self

    def transform(self, X: np.ndarray) -> np.ndarray:
        mn = np.array(self.mins)
        mx = np.array(self.maxs)
        rng = mx - mn
        rng[rng < 1e-8] = 1.0
        return (X - mn) / rng

    def fit_transform(self, X: np.ndarray) -> np.ndarray:
        return self.fit(X).transform(X)

    def save(self, path: Path) -> None:
        path.write_text(json.dumps({"mins": self.mins, "maxs": self.maxs}))

    @classmethod
    def load(cls, path: Path) -> "MinMaxScaler":
        d = json.loads(path.read_text())
        s = cls()
        s.mins, s.maxs = d["mins"], d["maxs"]
        s.fitted = True
        return s


# ── Extracción de features ────────────────────────────────────────────────────

def _goal_code(goal: str) -> float:
    return {"lose": 0.0, "maintain": 0.5, "gain": 1.0}.get(goal, 0.5)

def _gender_code(gender: str) -> float:
    return {"female": 0.0, "other": 0.5, "male": 1.0}.get(gender, 0.5)

def _activity_tdee_multiplier(level: Optional[str]) -> float:
    return {
        "sedentary":   1.2,
        "light":       1.375,
        "moderate":    1.55,
        "active":      1.725,
        "very_active": 1.9,
    }.get(level or "moderate", 1.55)

def _bmr(weight_kg: float, height_cm: float, age: int, gender: str) -> float:
    """Harris-Benedict revisada (Mifflin-St Jeor)."""
    if gender == "male":
        return 10 * weight_kg + 6.25 * height_cm - 5 * age + 5
    return 10 * weight_kg + 6.25 * height_cm - 5 * age - 161

def _physics_delta(daily_deficit_kcal: float, days: int) -> float:
    """Cambio de peso esperado por balance calórico (kg)."""
    return -(daily_deficit_kcal * days) / KCAL_PER_KG


def build_feature_vector(
    profile: UserProfile,
    weights: list[WeightEntry],
    activities: list[ActivityEntry],
    calories: list[CalorieEntry],
) -> np.ndarray:
    """
    Construye el vector de 18 features que consume ProgressNet.

    Features:
     0  weight_norm          peso actual / 130
     1  height_norm          altura / 200
     2  age_norm             edad / 70
     3  gender               0=female, 0.5=other, 1=male
     4  goal                 0=lose, 0.5=maintain, 1=gain
     5  tdee_norm            TDEE / 3500
     6  target_norm          calorie_target / 3500
     7  deficit_ratio        (target - TDEE) / 1000, clamp[-1,1]
     8  w7_trend             cambio kg/día últimos 7d, clamp[-0.3,0.3]
     9  w14_trend            cambio kg/día últimos 14d
    10  w_volatility         desv. estándar del peso últimos 14d (normalizado)
    11  cal_adherence        kcal_real / kcal_target, clamp[0,2]
    12  workout_freq         entrenos/semana últimas 4 sem., / 7
    13  consistency          fracción de días con algún registro (últimos 30d)
    14  days_tracked         log1p(n_puntos) / log1p(90)
    15  physics_7d_kg        delta físico a 7d (kg), clamp[-15,15] / 15
    16  physics_14d_kg       delta físico a 14d (kg)
    17  physics_30d_kg       delta físico a 30d (kg)
    """
    w  = profile.weight_kg
    h  = profile.height_cm
    a  = profile.age
    g  = profile.gender

    # TDEE y calorie target
    bmr  = _bmr(w, h, a, g)
    mult = _activity_tdee_multiplier(profile.activity_level)
    tdee = profile.tdee or (bmr * mult)
    target = profile.calorie_target or tdee

    daily_deficit = target - tdee  # negativo = déficit calórico

    # Tendencias del peso
    sorted_w = sorted(weights, key=lambda x: x.date)
    n = len(sorted_w)

    def _slope(entries: list[WeightEntry], days: int) -> float:
        cutoff = entries[-1].date - timedelta(days=days) if entries else date.today()
        window = [e for e in entries if e.date >= cutoff]
        if len(window) < 2:
            return 0.0
        span = (window[-1].date - window[0].date).days or 1
        return (window[-1].weight - window[0].weight) / span

    w7_trend  = _slope(sorted_w, 7)
    w14_trend = _slope(sorted_w, 14)

    last14 = [e.weight for e in sorted_w if sorted_w and
              e.date >= sorted_w[-1].date - timedelta(days=14)]
    w_vol = float(np.std(last14)) if len(last14) > 1 else 0.0

    # Adherencia calórica (últimos 14 días)
    cal_adherence = 1.0
    if calories and target > 0:
        cutoff = date.today() - timedelta(days=14)
        recent_cal = [c.calories for c in calories if c.date >= cutoff]
        if recent_cal:
            cal_adherence = float(np.mean(recent_cal)) / target

    # Frecuencia de entrenamiento (últimas 4 semanas)
    workout_freq = 0.0
    if activities:
        cutoff = date.today() - timedelta(days=28)
        recent_act = [a for a in activities if a.date >= cutoff]
        workout_freq = len(recent_act) / 4.0  # entrenos/semana

    # Consistencia (% de días con cualquier log últimos 30d)
    days_with_log: set[date] = set()
    cutoff30 = date.today() - timedelta(days=30)
    for e in weights:
        if e.date >= cutoff30:
            days_with_log.add(e.date)
    for e in calories:
        if e.date >= cutoff30:
            days_with_log.add(e.date)
    consistency = len(days_with_log) / 30.0

    # Predicciones físicas
    phys7  = _physics_delta(daily_deficit, 7)
    phys14 = _physics_delta(daily_deficit, 14)
    phys30 = _physics_delta(daily_deficit, 30)

    feat = np.array([
        w / 130.0,
        h / 200.0,
        a / 70.0,
        _gender_code(g),
        _goal_code(profile.goal),
        tdee / 3500.0,
        target / 3500.0,
        float(np.clip(daily_deficit / 1000.0, -1.0, 1.0)),
        float(np.clip(w7_trend, -0.3, 0.3)),
        float(np.clip(w14_trend, -0.3, 0.3)),
        float(np.clip(w_vol / 2.0, 0.0, 1.0)),
        float(np.clip(cal_adherence, 0.0, 2.0)),
        float(np.clip(workout_freq / 7.0, 0.0, 1.0)),
        float(np.clip(consistency, 0.0, 1.0)),
        math.log1p(n) / math.log1p(90),
        float(np.clip(phys7 / 15.0, -1.0, 1.0)),
        float(np.clip(phys14 / 15.0, -1.0, 1.0)),
        float(np.clip(phys30 / 15.0, -1.0, 1.0)),
    ], dtype=np.float32)

    return feat


# ── Datos sintéticos para entrenamiento global ────────────────────────────────

def _generate_synthetic_samples(n: int = 12_000, seed: int = 42) -> tuple[np.ndarray, np.ndarray]:
    """
    Genera n trayectorias de peso sintéticas que siguen principios de ciencia
    del ejercicio para pre-entrenar el modelo global.

    Devuelve (X, y) donde:
      X : (n, INPUT_DIM) features
      y : (n, 5)  residuales reales sobre modelo físico [7,14,30,60,90 días]
    """
    rng = np.random.default_rng(seed)

    goals   = ["lose", "gain", "maintain"]
    genders = ["male", "female"]

    X_list, y_list = [], []

    for _ in range(n):
        goal   = rng.choice(goals)
        gender = rng.choice(genders)
        weight = float(rng.uniform(55, 115))
        height = float(rng.uniform(155, 195))
        age    = int(rng.integers(18, 60))
        act_lvl = rng.choice(["sedentary", "light", "moderate", "active", "very_active"])

        bmr  = _bmr(weight, height, age, gender)
        mult = _activity_tdee_multiplier(act_lvl)
        tdee_val = bmr * mult

        if goal == "lose":
            deficit = float(rng.uniform(200, 700))
            target_cal = tdee_val - deficit
        elif goal == "gain":
            surplus = float(rng.uniform(100, 400))
            target_cal = tdee_val + surplus
        else:
            target_cal = tdee_val + float(rng.uniform(-100, 100))

        daily_deficit = target_cal - tdee_val  # kg / semana

        # Simular historia de 90 días
        n_days_tracked = int(rng.integers(14, 90))
        true_daily_change = -(daily_deficit / KCAL_PER_KG)  # kg/día (negativo = bajar)

        # Adherencia real: ±20% con deriva
        adherence = float(rng.normal(0.88, 0.12))
        adherence = max(0.5, min(1.3, adherence))
        actual_daily_change = true_daily_change * adherence

        # Historia de pesos simulada (con ruido de retención de agua ±0.4 kg)
        weights_sim: list[WeightEntry] = []
        today = date.today()
        for d in range(n_days_tracked):
            day = today - timedelta(days=n_days_tracked - d)
            day_w = weight - actual_daily_change * (n_days_tracked - d)
            noise = float(rng.normal(0, 0.35))
            weights_sim.append(WeightEntry(date=day, weight=max(35.0, day_w + noise)))

        # Actividad simulada
        workout_days = int(rng.integers(0, 7))
        act_sim: list[ActivityEntry] = [
            ActivityEntry(date=today - timedelta(days=i), workouts=1, duration=45)
            for i in range(min(28, n_days_tracked))
            if i % max(1, 7 // max(1, workout_days)) == 0
        ]

        # Calorías simuladas
        cal_sim: list[CalorieEntry] = [
            CalorieEntry(date=today - timedelta(days=i),
                         calories=max(500, target_cal * adherence + float(rng.normal(0, 80))))
            for i in range(min(14, n_days_tracked))
        ]

        prof = UserProfile(
            weight_kg=weight, height_cm=height, age=age, gender=gender,
            goal=goal, tdee=tdee_val, calorie_target=target_cal,
            activity_level=act_lvl,
        )

        feat = build_feature_vector(prof, weights_sim, act_sim, cal_sim)

        # Etiquetas: residual real (cambio verdadero - cambio físico)
        residuals = []
        for h_days in HORIZONS:
            true_delta = actual_daily_change * h_days + float(rng.normal(0, 0.3 * math.sqrt(h_days)))
            phys_delta = _physics_delta(daily_deficit, h_days)
            residuals.append(true_delta - phys_delta)

        X_list.append(feat)
        y_list.append(residuals)

    return np.array(X_list, dtype=np.float32), np.array(y_list, dtype=np.float32)


# ── Entrenamiento ─────────────────────────────────────────────────────────────

def _train_model(
    model: ProgressNet,
    X: np.ndarray,
    y: np.ndarray,
    epochs: int = 80,
    lr: float = 1e-3,
    batch_size: int = 256,
) -> float:
    """Entrena el modelo y devuelve el RMSE final en kg."""
    device = torch.device("cpu")
    model.to(device).train()

    Xt = torch.tensor(X, dtype=torch.float32, device=device)
    yt = torch.tensor(y, dtype=torch.float32, device=device)

    dataset = TensorDataset(Xt, yt)
    loader  = DataLoader(dataset, batch_size=batch_size, shuffle=True)

    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)
    criterion = nn.HuberLoss(delta=1.0)

    for _ in range(epochs):
        for xb, yb in loader:
            optimizer.zero_grad()
            loss = criterion(model(xb), yb)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
        scheduler.step()

    model.eval()
    with torch.no_grad():
        preds = model(Xt).cpu().numpy()
    rmse = float(np.sqrt(np.mean((preds - y) ** 2)))
    return rmse


def _finetune_model(
    base_model: ProgressNet,
    X_user: np.ndarray,
    y_user: np.ndarray,
    epochs: int = 40,
    lr: float = 5e-4,
) -> tuple[ProgressNet, float]:
    """Fine-tune ligero sobre los datos reales del usuario."""
    import copy
    model = copy.deepcopy(base_model)
    model.train()

    Xt = torch.tensor(X_user, dtype=torch.float32)
    yt = torch.tensor(y_user, dtype=torch.float32)

    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-3)
    criterion = nn.HuberLoss(delta=0.5)

    dataset = TensorDataset(Xt, yt)
    loader  = DataLoader(dataset, batch_size=min(32, len(X_user)), shuffle=True)

    for _ in range(epochs):
        for xb, yb in loader:
            optimizer.zero_grad()
            criterion(model(xb), yb).backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()

    model.eval()
    with torch.no_grad():
        preds = model(Xt).cpu().numpy()
    rmse = float(np.sqrt(np.mean((preds - yt.numpy()) ** 2)))
    return model, rmse


# ── Gestor del modelo global ──────────────────────────────────────────────────

class PredictorService:
    """
    Singleton que gestiona el modelo global y los modelos personalizados por usuario.
    Se inicializa una vez al arrancar el servicio FastAPI.
    """

    def __init__(self):
        self._global_model: Optional[ProgressNet] = None
        self._scaler: Optional[MinMaxScaler] = None
        self._user_models: dict[int, ProgressNet] = {}
        self._ready = False

    def bootstrap(self) -> None:
        """Carga o entrena el modelo global. Llamar en el lifespan de FastAPI."""
        MODELS_DIR.mkdir(parents=True, exist_ok=True)

        if GLOBAL_MODEL_PATH.exists() and GLOBAL_SCALER_PATH.exists():
            logger.info("[predictor] Cargando modelo global pre-entrenado…")
            self._global_model = ProgressNet()
            self._global_model.load_state_dict(
                torch.load(GLOBAL_MODEL_PATH, map_location="cpu", weights_only=True)
            )
            self._global_model.eval()
            self._scaler = MinMaxScaler.load(GLOBAL_SCALER_PATH)
            logger.info("[predictor] Modelo global cargado ✓")
        else:
            logger.info("[predictor] Entrenando modelo global con datos sintéticos…")
            t0 = time.time()
            X, y = _generate_synthetic_samples(n=12_000)
            self._scaler = MinMaxScaler()
            X_scaled = self._scaler.fit_transform(X)
            self._global_model = ProgressNet()
            rmse = _train_model(self._global_model, X_scaled, y)
            elapsed = time.time() - t0
            torch.save(self._global_model.state_dict(), GLOBAL_MODEL_PATH)
            self._scaler.save(GLOBAL_SCALER_PATH)
            logger.info(f"[predictor] Modelo global entrenado — RMSE: {rmse:.3f} kg, tiempo: {elapsed:.1f}s ✓")

        self._ready = True

    # ── Predicción ──────────────────────────────────────────────────────────

    def forecast(self, req: ForecastRequest) -> ForecastResponse:
        if not self._ready:
            raise RuntimeError("PredictorService no inicializado — llama a bootstrap() primero")

        profile    = req.profile
        weights    = sorted(req.weight_history, key=lambda x: x.date)
        activities = req.activity_history
        calories   = req.calorie_history
        n_pts      = len(weights)

        current_w  = weights[-1].weight if weights else profile.weight_kg

        # ── Decidir qué modelo usar ──────────────────────────────────────────
        use_neural = n_pts >= MIN_NEURAL_PTS and self._global_model is not None

        # Features para la NN
        feat_raw = build_feature_vector(profile, weights, activities, calories)
        feat_scaled = (
            self._scaler.transform(feat_raw.reshape(1, -1))[0]
            if self._scaler else feat_raw
        )

        # Obtener (o afinar) el modelo del usuario
        model = self._global_model
        rmse_val = None
        model_type = "physics"

        if use_neural:
            if req.user_id not in self._user_models and n_pts >= 20:
                model, rmse_val = self._build_user_model(
                    req.user_id, profile, weights, activities, calories
                )
            elif req.user_id in self._user_models:
                model = self._user_models[req.user_id]
                model_type = "neural"
            else:
                model_type = "neural"

        # ── Predicciones del modelo físico ───────────────────────────────────
        bmr  = _bmr(profile.weight_kg, profile.height_cm, profile.age, profile.gender)
        mult = _activity_tdee_multiplier(profile.activity_level)
        tdee_val  = profile.tdee or (bmr * mult)
        target_cal = profile.calorie_target or tdee_val
        daily_deficit = target_cal - tdee_val

        phys_deltas = [_physics_delta(daily_deficit, d) for d in HORIZONS]

        # ── Residual neuronal ─────────────────────────────────────────────────
        neural_residuals = np.zeros(len(HORIZONS))
        if use_neural and model is not None:
            feat_t = torch.tensor(feat_scaled, dtype=torch.float32).unsqueeze(0)
            with torch.no_grad():
                neural_residuals = model(feat_t).squeeze().cpu().numpy()

        # ── Combinar ──────────────────────────────────────────────────────────
        weight_blend = min(1.0, (n_pts - MIN_NEURAL_PTS) / 20.0) if use_neural else 0.0

        predictions: list[PredictionPoint] = []
        today = date.today()

        for i, h_days in enumerate(HORIZONS):
            pred_delta = phys_deltas[i] + weight_blend * float(neural_residuals[i])
            pred_weight = current_w + pred_delta

            # Intervalo de confianza: incertidumbre crece con el horizonte
            uncertainty = 0.5 * math.sqrt(h_days / 7.0) * (1.0 - weight_blend * 0.3)
            confidence  = max(0.40, 0.92 - 0.006 * h_days - 0.15 * (1.0 - weight_blend))

            predictions.append(PredictionPoint(
                days       = h_days,
                date       = today + timedelta(days=h_days),
                weight     = round(pred_weight, 2),
                lower      = round(pred_weight - uncertainty, 2),
                upper      = round(pred_weight + uncertainty, 2),
                confidence = round(confidence, 3),
            ))

        # ── Métricas de resumen ───────────────────────────────────────────────
        weekly_rate = round((phys_deltas[0] * (1.0 + weight_blend * float(neural_residuals[0]) / max(1e-9, abs(phys_deltas[0])))) if phys_deltas[0] != 0 else 0.0, 3)
        weekly_rate = round(_physics_delta(daily_deficit, 7), 3)

        trend = (
            "losing"  if weekly_rate < -0.05
            else "gaining" if weekly_rate > 0.05
            else "stable"
        )

        # ETA al objetivo: peso meta del usuario
        goal_weight = (
            profile.weight_kg * 0.90 if profile.goal == "lose"
            else profile.weight_kg * 1.10 if profile.goal == "gain"
            else None
        )
        goal_eta = None
        if goal_weight and weekly_rate != 0:
            weeks_needed = abs(goal_weight - current_w) / abs(weekly_rate)
            goal_eta = int(weeks_needed * 7)

        insights = _generate_insights(profile, predictions, trend, n_pts)

        return ForecastResponse(
            user_id        = req.user_id,
            model_type     = model_type,
            data_points    = n_pts,
            current_weight = round(current_w, 2),
            predictions    = predictions,
            trend          = trend,
            weekly_rate    = weekly_rate,
            goal_eta_days  = goal_eta,
            insights       = insights,
            rmse           = round(rmse_val, 3) if rmse_val else None,
        )

    def _build_user_model(
        self,
        user_id: int,
        profile: UserProfile,
        weights: list[WeightEntry],
        activities: list[ActivityEntry],
        calories: list[CalorieEntry],
    ) -> tuple[ProgressNet, float]:
        """
        Construye ventanas deslizantes sobre el historial del usuario para
        generar muestras de entrenamiento y hace fine-tuning del modelo global.
        """
        sorted_w = sorted(weights, key=lambda x: x.date)
        X_user, y_user = [], []

        for i in range(MIN_NEURAL_PTS, len(sorted_w)):
            window = sorted_w[:i]
            bmr_u  = _bmr(profile.weight_kg, profile.height_cm, profile.age, profile.gender)
            tdee_u = profile.tdee or (bmr_u * _activity_tdee_multiplier(profile.activity_level))
            target_u = profile.calorie_target or tdee_u
            deficit_u = target_u - tdee_u

            feat = build_feature_vector(
                UserProfile(
                    weight_kg      = window[-1].weight,
                    height_cm      = profile.height_cm,
                    age            = profile.age,
                    gender         = profile.gender,
                    goal           = profile.goal,
                    tdee           = tdee_u,
                    calorie_target = target_u,
                    activity_level = profile.activity_level,
                ),
                window, activities, calories,
            )
            feat_s = self._scaler.transform(feat.reshape(1, -1))[0]

            # Etiqueta: residual real sobre predicción física
            residuals = []
            for h_days in HORIZONS:
                future_idx = next(
                    (j for j in range(i, len(sorted_w))
                     if (sorted_w[j].date - window[-1].date).days >= h_days),
                    None
                )
                if future_idx is not None:
                    true_delta = sorted_w[future_idx].weight - window[-1].weight
                    phys_delta = _physics_delta(deficit_u, h_days)
                    residuals.append(true_delta - phys_delta)
                else:
                    residuals.append(0.0)

            X_user.append(feat_s)
            y_user.append(residuals)

        if len(X_user) < 3:
            return self._global_model, None

        X_u = np.array(X_user, dtype=np.float32)
        y_u = np.array(y_user, dtype=np.float32)
        model, rmse = _finetune_model(self._global_model, X_u, y_u)
        self._user_models[user_id] = model
        logger.info(f"[predictor] Modelo afinado para user {user_id} — RMSE: {rmse:.3f} kg")
        return model, rmse


# ── Insights en lenguaje natural ──────────────────────────────────────────────

def _generate_insights(
    profile: UserProfile,
    predictions: list[PredictionPoint],
    trend: str,
    n_pts: int,
) -> list[str]:
    insights = []

    if n_pts < MIN_NEURAL_PTS:
        insights.append(
            f"Registra tu peso {MIN_NEURAL_PTS - n_pts} veces más para activar el "
            "modelo neuronal personalizado y obtener predicciones más precisas."
        )

    if trend == "losing" and profile.goal == "lose":
        insights.append("Vas por buen camino hacia tu objetivo de pérdida de peso.")
    elif trend == "gaining" and profile.goal == "gain":
        insights.append("Tu progreso de ganancia muscular está avanzando según lo esperado.")
    elif trend == "stable" and profile.goal == "maintain":
        insights.append("Mantienes tu peso estable — exactamente el objetivo.")
    elif trend != ("losing" if profile.goal == "lose" else "gaining" if profile.goal == "gain" else "stable"):
        insights.append(
            "La tendencia actual no está alineada con tu objetivo. "
            "Revisa tu déficit calórico con el asistente IA."
        )

    p30 = next((p for p in predictions if p.days == 30), None)
    if p30 and abs(p30.weight - profile.weight_kg) >= 1.5:
        direction = "bajar" if p30.weight < profile.weight_kg else "subir"
        insights.append(
            f"En 30 días el modelo estima {direction} "
            f"{abs(p30.weight - profile.weight_kg):.1f} kg "
            f"(intervalo: {p30.lower}–{p30.upper} kg)."
        )

    if predictions[0].confidence < 0.60:
        insights.append(
            "La confianza de la predicción es baja. "
            "Registra más días consecutivos para mejorar la precisión."
        )

    return insights[:4]


# ── Instancia global (importada por el router) ────────────────────────────────

predictor = PredictorService()
