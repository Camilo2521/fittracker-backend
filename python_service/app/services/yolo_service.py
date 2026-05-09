"""
YOLOv8 Pose Service — Conteo preciso de repeticiones con suavizado de ángulos.
"""
import math
import time
import logging
import numpy as np

logger = logging.getLogger("fittracker.yolo")

# ── Modelo (lazy load) ────────────────────────────────────────────────────────

_model = None

def _get_model():
    global _model
    if _model is not None:
        return _model
    try:
        from ultralytics import YOLO
        from app.config import get_settings
        _model = YOLO(get_settings().yolo_model_path)
        logger.info("✅ YOLOv8 pose model cargado")
    except Exception as e:
        logger.error(f"❌ No se pudo cargar YOLOv8: {e}")
        raise
    return _model

# ── Keypoints COCO 17 ─────────────────────────────────────────────────────────
KP = {
    "nose": 0,
    "l_shoulder": 5,  "r_shoulder": 6,
    "l_elbow":    7,  "r_elbow":    8,
    "l_wrist":    9,  "r_wrist":   10,
    "l_hip":     11,  "r_hip":     12,
    "l_knee":    13,  "r_knee":    14,
    "l_ankle":   15,  "r_ankle":   16,
}

# ── Estado por sesión ─────────────────────────────────────────────────────────
_session_state: dict[str, dict] = {}

def _get_state(session_id: str) -> dict:
    if session_id not in _session_state:
        _session_state[session_id] = {
            "reps":          0,
            "phase":         "up",
            "form_scores":   [],
            "last_rep_t":    0.0,
            "phase_enter_t": time.time(),
            "angle_ema":     {},
            "no_detect":     0,
            "ang_min":       999.0,
            "ang_max":       0.0,
        }
    return _session_state[session_id]

def clear_session(session_id: str):
    _session_state.pop(session_id, None)

# ── Geometría ─────────────────────────────────────────────────────────────────

def _angle(a, b, c) -> float:
    """Ángulo en B entre BA y BC (grados)."""
    ax, ay = a[0] - b[0], a[1] - b[1]
    cx, cy = c[0] - b[0], c[1] - b[1]
    dot = ax * cx + ay * cy
    mag = math.sqrt(ax**2 + ay**2) * math.sqrt(cx**2 + cy**2)
    if mag < 1e-6:
        return 180.0
    return math.degrees(math.acos(max(-1.0, min(1.0, dot / mag))))

def _get_kp(kp_xy, kp_conf, name: str):
    """Devuelve ((x,y), confidence). Retorna (0,0), 0 si no disponible."""
    idx = KP.get(name)
    if idx is None or idx >= len(kp_xy):
        return (0.0, 0.0), 0.0
    conf = float(kp_conf[idx]) if kp_conf is not None and idx < len(kp_conf) else 1.0
    return (float(kp_xy[idx][0]), float(kp_xy[idx][1])), conf

def _smooth(state: dict, key: str, val: float, alpha: float = 0.45) -> float:
    """EMA del ángulo para reducir jitter de keypoints."""
    prev = state["angle_ema"].get(key, val)
    smoothed = alpha * val + (1.0 - alpha) * prev
    state["angle_ema"][key] = smoothed
    return smoothed

def _avg_angle(state, kp_xy, kp_conf, key, p1l, pl, p2l, p1r, pr, p2r, alpha=0.45):
    """
    Ángulo promedio izq+der con filtrado por confianza y suavizado EMA.
    Devuelve (ángulo_suavizado, datos_ok).
    """
    a1, c1 = _get_kp(kp_xy, kp_conf, p1l)
    b1, c2 = _get_kp(kp_xy, kp_conf, pl)
    e1, c3 = _get_kp(kp_xy, kp_conf, p2l)
    a2, c4 = _get_kp(kp_xy, kp_conf, p1r)
    b2, c5 = _get_kp(kp_xy, kp_conf, pr)
    e2, c6 = _get_kp(kp_xy, kp_conf, p2r)

    CONF_MIN = 0.25
    l_ok = c1 > CONF_MIN and c2 > CONF_MIN and c3 > CONF_MIN
    r_ok = c4 > CONF_MIN and c5 > CONF_MIN and c6 > CONF_MIN

    if l_ok and r_ok:
        raw = (_angle(a1, b1, e1) + _angle(a2, b2, e2)) / 2
    elif l_ok:
        raw = _angle(a1, b1, e1)
    elif r_ok:
        raw = _angle(a2, b2, e2)
    else:
        return state["angle_ema"].get(key, 180.0), False

    return _smooth(state, key, raw, alpha), True

# ── Contadores por ejercicio ──────────────────────────────────────────────────

MIN_REP_INTERVAL = 0.5   # segundos mínimos entre reps
PHASE_TIMEOUT    = 5.0   # si lleva >5s en "down" sin subir, se resetea

def _check_phase_timeout(state: dict):
    """Evita que la fase quede bloqueada en 'down' para siempre."""
    if state["phase"] == "down":
        if time.time() - state.get("phase_enter_t", time.time()) > PHASE_TIMEOUT:
            state["phase"] = "up"
            state["angle_ema"] = {}   # resetear EMA para re-calibrar

def _enter_phase(state: dict, new_phase: str):
    state["phase"] = new_phase
    state["phase_enter_t"] = time.time()

def _count_squat(kp_xy, kp_conf, state: dict) -> dict:
    knee_ang, ok = _avg_angle(state, kp_xy, kp_conf,
        "knee", "l_hip", "l_knee", "l_ankle",
                "r_hip", "r_knee", "r_ankle", alpha=0.6)

    tips, issues = [], []
    _check_phase_timeout(state)

    if ok:
        # Actualizar rango observado para umbrales adaptativos
        hist_min = state.setdefault("ang_min", knee_ang)
        hist_max = state.setdefault("ang_max", knee_ang)
        state["ang_min"] = min(hist_min, knee_ang)
        state["ang_max"] = max(hist_max, knee_ang)

        # Umbral adaptativo: DOWN = min_observado + 15°, UP = max_observado - 15°
        # Con floor/ceil para no volverse demasiado permisivo
        down_thr = min(state["ang_min"] + 20, 130)   # máximo 130°
        up_thr   = max(state["ang_max"] - 20, 135)   # mínimo 135°

        if knee_ang < down_thr and state["phase"] == "up":
            _enter_phase(state, "down")
        elif knee_ang > up_thr and state["phase"] == "down":
            now = time.time()
            if now - state["last_rep_t"] > MIN_REP_INTERVAL:
                _enter_phase(state, "up")
                state["reps"] += 1
                state["last_rep_t"] = now

        if knee_ang > (down_thr + 10): tips.append("Baja más las caderas")
        elif knee_ang < 80:             tips.append("¡Excelente profundidad!")

        score = max(0.0, 100.0 - abs(knee_ang - 90) * 1.0)
    else:
        tips.append("Colócate de lado o de frente a la cámara")
        score = 0.0

    state["form_scores"].append(score)
    return {
        "reps":        state["reps"],
        "phase":       state["phase"],
        "phase_label": "⬇ Abajo" if state["phase"] == "down" else "⬆ Arriba",
        "form_score":  round(score, 1),
        "angles":      {"knee": round(knee_ang, 1)},
        "issues":      issues,
        "tips":        tips or (["¡Buena forma!"] if state["phase"] == "up" else ["Baja controlado"]),
    }


def _count_pushup(kp_xy, kp_conf, state: dict) -> dict:
    elbow_ang, ok = _avg_angle(state, kp_xy, kp_conf,
        "elbow", "l_shoulder", "l_elbow", "l_wrist",
                 "r_shoulder", "r_elbow", "r_wrist", alpha=0.6)

    tips, issues = [], []
    _check_phase_timeout(state)

    if ok:
        state["ang_min"] = min(state.setdefault("ang_min", elbow_ang), elbow_ang)
        state["ang_max"] = max(state.setdefault("ang_max", elbow_ang), elbow_ang)

        down_thr = min(state["ang_min"] + 25, 120)
        up_thr   = max(state["ang_max"] - 20, 140)

        if elbow_ang < down_thr and state["phase"] == "up":
            _enter_phase(state, "down")
        elif elbow_ang > up_thr and state["phase"] == "down":
            now = time.time()
            if now - state["last_rep_t"] > MIN_REP_INTERVAL:
                _enter_phase(state, "up")
                state["reps"] += 1
                state["last_rep_t"] = now

        if elbow_ang > 155: tips.append("Baja más — busca 90° en codos")
        elif elbow_ang < 75: tips.append("¡Excelente bajada!")

        l_hip, ch = _get_kp(kp_xy, kp_conf, "l_hip")
        l_sh,  cs = _get_kp(kp_xy, kp_conf, "l_shoulder")
        l_ank, ca = _get_kp(kp_xy, kp_conf, "l_ankle")
        if ch > 0.3 and cs > 0.3 and ca > 0.3:
            mid_y = (l_sh[1] + l_ank[1]) / 2
            if abs(l_hip[1] - mid_y) > 25:
                issues.append("Caderas caídas")
                tips.append("Activa el core")

        score = max(0.0, 100.0 - abs(elbow_ang - 90) * 1.0 - len(issues) * 8)
    else:
        tips.append("Asegúrate de que la cámara te vea de lado")
        score = 0.0

    state["form_scores"].append(score)
    return {
        "reps":        state["reps"],
        "phase":       state["phase"],
        "phase_label": "⬇ Bajando" if state["phase"] == "down" else "⬆ Subiendo",
        "form_score":  round(score, 1),
        "angles":      {"elbow": round(elbow_ang, 1)},
        "issues":      issues,
        "tips":        tips or ["¡Excelente forma!"],
    }


def _count_plank(kp_xy, kp_conf, state: dict) -> dict:
    l_sh,  cs = _get_kp(kp_xy, kp_conf, "l_shoulder")
    l_hip, ch = _get_kp(kp_xy, kp_conf, "l_hip")
    l_ank, ca = _get_kp(kp_xy, kp_conf, "l_ankle")

    tips, issues = [], []

    if cs > 0.25 and ch > 0.25 and ca > 0.25:
        mid_y = (l_sh[1] + l_ank[1]) / 2
        hip_off = l_hip[1] - mid_y
        hip_off_s = _smooth(state, "hip_off", hip_off, 0.3)
        if abs(hip_off_s) > 18:
            issues.append("Caderas desalineadas")
            tips.append("Sube las caderas" if hip_off_s > 0 else "Baja las caderas")
        score = max(0.0, 100.0 - abs(hip_off_s) * 2.2)
        ang_val = round(hip_off_s, 1)
    else:
        tips.append("Colócate de lado a la cámara")
        score = 0.0
        ang_val = 0.0

    state["form_scores"].append(score)
    return {
        "reps":       0,
        "phase":      "hold",
        "phase_label": "Aguanta",
        "form_score": round(score, 1),
        "angles":     {"hip_offset": ang_val},
        "issues":     issues,
        "tips":       tips or ["Alineación perfecta — ¡sigue!"],
    }


def _count_lunge(kp_xy, kp_conf, state: dict) -> dict:
    knee_ang, ok = _avg_angle(state, kp_xy, kp_conf,
        "knee", "l_hip", "l_knee", "l_ankle",
                "r_hip", "r_knee", "r_ankle", alpha=0.6)
    tips, issues = [], []
    _check_phase_timeout(state)
    if ok:
        state["ang_min"] = min(state.setdefault("ang_min", knee_ang), knee_ang)
        state["ang_max"] = max(state.setdefault("ang_max", knee_ang), knee_ang)
        down_thr = min(state["ang_min"] + 20, 125)
        up_thr   = max(state["ang_max"] - 20, 138)
        if knee_ang < down_thr and state["phase"] == "up":
            _enter_phase(state, "down")
        elif knee_ang > up_thr and state["phase"] == "down":
            now = time.time()
            if now - state["last_rep_t"] > MIN_REP_INTERVAL:
                _enter_phase(state, "up")
                state["reps"] += 1
                state["last_rep_t"] = now
        score = max(0.0, 100.0 - abs(knee_ang - 90) * 1.0)
        if knee_ang > 130: tips.append("Baja más la rodilla trasera")
    else:
        score = 0.0
        tips.append("Colócate de lado a la cámara")
    state["form_scores"].append(score)
    return {
        "reps": state["reps"], "phase": state["phase"],
        "phase_label": "⬇ Abajo" if state["phase"] == "down" else "⬆ Arriba",
        "form_score": round(score, 1),
        "angles": {"knee": round(knee_ang, 1)},
        "issues": issues, "tips": tips or ["¡Bien!"],
    }


_COUNTERS = {
    "squat":      _count_squat,
    "sentadilla": _count_squat,
    "lunge":      _count_lunge,
    "zancada":    _count_lunge,
    "pushup":     _count_pushup,
    "push_up":    _count_pushup,
    "flexion":    _count_pushup,
    "flexión":    _count_pushup,
    "plank":      _count_plank,
    "plancha":    _count_plank,
}

# ── API pública ───────────────────────────────────────────────────────────────

def analyze_frame_yolo(session_id: str, exercise_type: str, frame_bytes: bytes) -> dict:
    import cv2
    model = _get_model()
    state = _get_state(session_id)

    img = cv2.imdecode(np.frombuffer(frame_bytes, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return _no_person(state)

    # Escalar a mínimo 480px de ancho para mejor detección
    h, w = img.shape[:2]
    if w < 480:
        scale = 480 / w
        img = cv2.resize(img, (int(w * scale), int(h * scale)))

    results = model(img, verbose=False, conf=0.3)
    if not results or results[0].keypoints is None or len(results[0].keypoints.xy) == 0:
        state["no_detect"] = state.get("no_detect", 0) + 1
        # Devuelve reps actuales (no resetea) — hasta 10 frames sin persona
        if state["no_detect"] > 10:
            return _no_person(state, msg="Colócate frente a la cámara")
        return {
            "reps": state["reps"], "phase": state["phase"],
            "phase_label": "", "form_score": 0,
            "angles": {}, "issues": [], "tips": ["Ajusta tu posición"], "keypoints": [],
        }

    state["no_detect"] = 0
    res     = results[0]
    kp_xy   = res.keypoints.xy.cpu().numpy()    # (N, 17, 2)
    kp_conf_all = res.keypoints.conf.cpu().numpy() if res.keypoints.conf is not None else None
    boxes   = res.boxes.xyxy.cpu().numpy()

    # Persona con mayor bounding box
    areas  = [(b[2]-b[0])*(b[3]-b[1]) for b in boxes]
    best_i = int(np.argmax(areas))
    kp     = kp_xy[best_i]
    conf   = kp_conf_all[best_i] if kp_conf_all is not None else None

    counter = _COUNTERS.get(exercise_type.lower(), _count_squat)
    result  = counter(kp, conf, state)
    result["keypoints"] = [{"x": float(pt[0]), "y": float(pt[1])} for pt in kp]
    return result


def _no_person(state: dict, msg: str = "No se detectó ninguna persona") -> dict:
    return {
        "reps":       state["reps"],
        "phase":      state["phase"],
        "phase_label": "",
        "form_score": 0,
        "angles":     {},
        "issues":     [msg],
        "tips":       [],
        "keypoints":  [],
    }


def get_session_summary(session_id: str) -> dict:
    state = _session_state.get(session_id, {})
    scores = state.get("form_scores", [])
    return {
        "total_reps":      state.get("reps", 0),
        "avg_form_score":  round(sum(scores) / len(scores), 1) if scores else 0,
        "frames_analyzed": len(scores),
    }
