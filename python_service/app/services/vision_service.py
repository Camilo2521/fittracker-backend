"""
Fase 2 — Análisis de forma y ángulos articulares.
Recibe landmarks de MediaPipe (33 puntos), calcula ángulos clave
y devuelve puntuación de forma + consejos de corrección.
"""
import math
from app.schemas.vision import Landmark, FormFeedback

# ── Índices MediaPipe Pose ──────────────────────────────────
MP = {
    "nose": 0,
    "l_shoulder": 11, "r_shoulder": 12,
    "l_elbow": 13,    "r_elbow": 14,
    "l_wrist": 15,    "r_wrist": 16,
    "l_hip": 23,      "r_hip": 24,
    "l_knee": 25,     "r_knee": 26,
    "l_ankle": 27,    "r_ankle": 28,
}


def _angle(a: Landmark, b: Landmark, c: Landmark) -> float:
    """Ángulo en el punto B formado por los segmentos BA y BC (grados)."""
    ax, ay = a.x - b.x, a.y - b.y
    cx, cy = c.x - b.x, c.y - b.y
    dot = ax * cx + ay * cy
    mag = math.sqrt(ax**2 + ay**2) * math.sqrt(cx**2 + cy**2)
    if mag < 1e-6:
        return 0.0
    return math.degrees(math.acos(max(-1.0, min(1.0, dot / mag))))


def _avg_angle(lm: list[Landmark], a: str, b: str, c: str) -> float:
    left  = _angle(lm[MP[f"l_{a}"]], lm[MP[f"l_{b}"]], lm[MP[f"l_{c}"]])
    right = _angle(lm[MP[f"r_{a}"]], lm[MP[f"r_{b}"]], lm[MP[f"r_{c}"]])
    return (left + right) / 2


# ── Analizadores por ejercicio ─────────────────────────────

def _analyze_squat(lm: list[Landmark]) -> FormFeedback:
    knee_angle = _avg_angle(lm, "hip", "knee", "ankle")
    hip_angle  = _avg_angle(lm, "shoulder", "hip", "knee")
    issues, tips = [], []

    if knee_angle > 100:
        issues.append("Rodillas poco dobladas")
        tips.append("Baja más las caderas, busca 90° en las rodillas")
    if knee_angle < 60:
        issues.append("Rodillas excesivamente dobladas")
        tips.append("No bajes más allá del paralelo si sientes dolor")

    # Espalda recta: ángulo cadera-hombro-cadera (inclinación torso)
    torso = _angle(lm[MP["l_shoulder"]], lm[MP["l_hip"]], lm[MP["l_knee"]])
    if torso < 50:
        issues.append("Espalda muy inclinada hacia adelante")
        tips.append("Mantén el pecho erguido y la mirada al frente")

    # Puntuación: penalizar desviaciones de 90° en rodilla
    score = max(0.0, 100 - abs(knee_angle - 90) * 1.5 - len(issues) * 5)

    return FormFeedback(
        form_score=round(score, 1),
        angles={"knee": round(knee_angle, 1), "hip": round(hip_angle, 1), "torso": round(torso, 1)},
        issues=issues,
        tips=tips if tips else ["¡Buena forma! Sigue así"],
    )


def _analyze_pushup(lm: list[Landmark]) -> FormFeedback:
    elbow_angle   = _avg_angle(lm, "shoulder", "elbow", "wrist")
    shoulder_angle = _avg_angle(lm, "elbow", "shoulder", "hip")
    issues, tips = [], []

    if elbow_angle > 160:
        issues.append("Brazos casi extendidos — fase de bajada incompleta")
        tips.append("Baja hasta que los codos formen ~90°")
    if elbow_angle < 70:
        issues.append("Codos demasiado doblados")
        tips.append("Controla la bajada, no toques el suelo con el pecho")
    if shoulder_angle > 70:
        issues.append("Codos muy abiertos hacia los lados")
        tips.append("Mantén los codos a ~45° del cuerpo")

    # Alineación cadera-hombro-tobillo
    hip_drop = abs(lm[MP["l_hip"]].y - (lm[MP["l_shoulder"]].y + lm[MP["l_ankle"]].y) / 2)
    if hip_drop > 0.05:
        issues.append("Caderas caídas o elevadas")
        tips.append("Activa el core para mantener el cuerpo en línea recta")

    score = max(0.0, 100 - abs(elbow_angle - 90) * 1.2 - len(issues) * 5)

    return FormFeedback(
        form_score=round(score, 1),
        angles={"elbow": round(elbow_angle, 1), "shoulder": round(shoulder_angle, 1)},
        issues=issues,
        tips=tips if tips else ["¡Excelente forma!"],
    )


def _analyze_plank(lm: list[Landmark]) -> FormFeedback:
    # Alineación: hombro, cadera, tobillo deben ser colineales
    sh_y  = (lm[MP["l_shoulder"]].y + lm[MP["r_shoulder"]].y) / 2
    hip_y = (lm[MP["l_hip"]].y     + lm[MP["r_hip"]].y)     / 2
    ank_y = (lm[MP["l_ankle"]].y   + lm[MP["r_ankle"]].y)   / 2
    issues, tips = [], []

    hip_drop = hip_y - (sh_y + ank_y) / 2
    if hip_drop > 0.04:
        issues.append("Caderas caídas")
        tips.append("Eleva las caderas y activa el abdomen")
    elif hip_drop < -0.04:
        issues.append("Caderas elevadas")
        tips.append("Baja las caderas hasta alinearlas con hombros y tobillos")

    alignment_score = max(0.0, 100 - abs(hip_drop) * 800)
    score = max(0.0, alignment_score - len(issues) * 8)

    return FormFeedback(
        form_score=round(score, 1),
        angles={"hip_alignment_offset_px": round(hip_drop * 100, 2)},
        issues=issues,
        tips=tips if tips else ["Alineación perfecta, mantén la respiración"],
    )


def _analyze_lunge(lm: list[Landmark]) -> FormFeedback:
    # Rodilla delantera (izquierda) y trasera (derecha)
    front_knee = _angle(lm[MP["l_hip"]], lm[MP["l_knee"]], lm[MP["l_ankle"]])
    back_knee  = _angle(lm[MP["r_hip"]], lm[MP["r_knee"]], lm[MP["r_ankle"]])
    issues, tips = [], []

    if front_knee > 110:
        issues.append("Rodilla delantera poco doblada")
        tips.append("Da un paso más largo o baja más las caderas")
    if front_knee < 70:
        issues.append("Rodilla delantera muy por encima de los dedos del pie")
        tips.append("Da un paso más largo hacia adelante")

    score = max(0.0, 100 - abs(front_knee - 90) * 1.5 - len(issues) * 5)

    return FormFeedback(
        form_score=round(score, 1),
        angles={"front_knee": round(front_knee, 1), "back_knee": round(back_knee, 1)},
        issues=issues,
        tips=tips if tips else ["¡Buena posición de estocada!"],
    )


# ── Dispatcher ─────────────────────────────────────────────

_ANALYZERS = {
    "squat":    _analyze_squat,
    "sentadilla": _analyze_squat,
    "pushup":   _analyze_pushup,
    "push_up":  _analyze_pushup,
    "flexion":  _analyze_pushup,
    "plank":    _analyze_plank,
    "plancha":  _analyze_plank,
    "lunge":    _analyze_lunge,
    "estocada": _analyze_lunge,
}


def analyze_frame(exercise_type: str, landmarks: list[Landmark]) -> FormFeedback:
    if len(landmarks) < 29:
        return FormFeedback(
            form_score=0,
            angles={},
            issues=["No se detectó la pose completa"],
            tips=["Asegúrate de estar completamente visible en cámara"],
        )
    analyzer = _ANALYZERS.get(exercise_type.lower(), _analyze_squat)
    return analyzer(landmarks)


def estimate_calories(exercise_type: str, total_reps: int, weight_kg: float = 70.0) -> float:
    """Estimación simple por MET × peso × tiempo estimado."""
    met = {"squat": 5.0, "pushup": 8.0, "plank": 4.0, "lunge": 5.5}.get(exercise_type, 5.0)
    duration_min = total_reps * 3 / 60  # ~3 seg por rep
    return round(met * weight_kg * duration_min / 60, 1)
