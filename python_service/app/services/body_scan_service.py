"""
Body Scan Service — Estimación antropométrica con YOLOv8-pose.
Analiza una foto frontal de cuerpo completo y devuelve:
  tipo corporal, IMC estimado, % grasa, y recomendaciones de objetivo/actividad.
"""
import math
import logging
import numpy as np

logger = logging.getLogger("fittracker.bodyscan")

# Índices COCO-17
KP = {
    "nose": 0,
    "l_eye": 1, "r_eye": 2,
    "l_ear": 3, "r_ear": 4,
    "l_shoulder": 5, "r_shoulder": 6,
    "l_elbow":    7, "r_elbow":    8,
    "l_wrist":    9, "r_wrist":   10,
    "l_hip":     11, "r_hip":     12,
    "l_knee":    13, "r_knee":    14,
    "l_ankle":   15, "r_ankle":   16,
}

_GOAL_LABELS = {
    "lose":     "Perder peso",
    "maintain": "Mantener peso",
    "gain":     "Ganar masa muscular",
}
_ACTIVITY_LABELS = {
    "sedentary":  "Sedentario",
    "light":      "Ligero",
    "moderate":   "Moderado",
    "active":     "Activo",
    "very_active": "Muy activo",
}
_CORE_KPS = ["l_shoulder", "r_shoulder", "l_hip", "r_hip"]


def _get(kp_xy, kp_conf, name, min_conf=0.25):
    idx = KP.get(name)
    if idx is None or idx >= len(kp_xy):
        return None
    c = float(kp_conf[idx]) if kp_conf is not None and idx < len(kp_conf) else 1.0
    if c < min_conf:
        return None
    return (float(kp_xy[idx][0]), float(kp_xy[idx][1]))


def _d(a, b):
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)


def analyze_body(image_b64: str, gender: str = "male") -> dict:
    """
    Analiza imagen base64 (data URL o raw base64) y retorna estimaciones.
    """
    import base64
    import cv2

    # ── Decodificación ────────────────────────────────────────────────────────
    try:
        raw = image_b64.split(",", 1)[1] if "," in image_b64 else image_b64
        img = cv2.imdecode(np.frombuffer(base64.b64decode(raw), np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("cv2 devolvió None")
    except Exception as e:
        logger.error(f"[body_scan] decode error: {e}")
        return {"personDetected": False, "error": "Imagen inválida"}

    # Escalar: min 480px, max 1280px en lado mayor
    h, w = img.shape[:2]
    mx = max(h, w)
    if mx < 480:
        img = cv2.resize(img, (int(w * 480 / mx), int(h * 480 / mx)))
    elif mx > 1280:
        img = cv2.resize(img, (int(w * 1280 / mx), int(h * 1280 / mx)))

    # ── Inferencia YOLO-pose ───────────────────────────────────────────────────
    from app.services.yolo_service import _get_model
    try:
        model = _get_model()
    except Exception as e:
        logger.warning(f"[body_scan] YOLO no disponible: {e}")
        return {"personDetected": False, "error": "Modelo de visión no disponible temporalmente"}

    results = model(img, verbose=False, conf=0.3)
    if not results or results[0].keypoints is None or len(results[0].keypoints.xy) == 0:
        return {"personDetected": False, "error": "No se detectó ninguna persona en la imagen"}

    res      = results[0]
    kp_all   = res.keypoints.xy.cpu().numpy()
    cf_all   = res.keypoints.conf.cpu().numpy() if res.keypoints.conf is not None else None
    boxes    = res.boxes.xyxy.cpu().numpy()

    # Persona con mayor bounding box
    areas  = [(b[2]-b[0])*(b[3]-b[1]) for b in boxes]
    bi     = int(np.argmax(areas))
    kp_xy  = kp_all[bi]
    kp_conf = cf_all[bi] if cf_all is not None else None

    # Verificar keypoints mínimos
    for name in _CORE_KPS:
        if _get(kp_xy, kp_conf, name) is None:
            return {
                "personDetected": True,
                "error": "Posiciónate de frente, cuerpo completo visible y bien iluminado."
            }

    return _compute_metrics(kp_xy, kp_conf, gender)


def _compute_metrics(kp_xy, kp_conf, gender: str) -> dict:
    def g(n): return _get(kp_xy, kp_conf, n)

    nose  = g("nose")
    l_sh  = g("l_shoulder"); r_sh  = g("r_shoulder")
    l_hip = g("l_hip");      r_hip = g("r_hip")
    l_ank = g("l_ankle");    r_ank = g("r_ankle")
    l_el  = g("l_elbow");    r_el  = g("r_elbow")

    # ── Anclajes ──────────────────────────────────────────────────────────────
    mid_sh  = ((l_sh[0]+r_sh[0])/2,   (l_sh[1]+r_sh[1])/2)
    mid_hip = ((l_hip[0]+r_hip[0])/2, (l_hip[1]+r_hip[1])/2)

    shoulder_w = _d(l_sh, r_sh)
    hip_w      = _d(l_hip, r_hip)
    torso_h    = _d(mid_sh, mid_hip)

    # Altura total en píxeles (nose→tobillo, fallbacks progresivos)
    if l_ank and r_ank and nose:
        mid_ank = ((l_ank[0]+r_ank[0])/2, (l_ank[1]+r_ank[1])/2)
        body_h  = _d(nose, mid_ank)
    elif nose:
        # Nose→hip ≈ 40 % de la altura
        body_h = _d(nose, mid_hip) / 0.40
    else:
        # Torso ≈ 35 % de la altura
        body_h = torso_h / 0.35

    if body_h < 40:
        return {"personDetected": False, "error": "Imagen demasiado pequeña — aléjate un poco."}

    # ── Ratios normalizados ────────────────────────────────────────────────────
    w_sh   = shoulder_w / body_h          # típico 0.22–0.32
    w_hip  = hip_w      / body_h          # típico 0.18–0.28
    shr    = shoulder_w / max(hip_w, 1.0) # hombro/cadera
    bwi    = (w_sh + w_hip) / 2           # body width index

    # Ancho de cintura estimado (punto más estrecho, ~40% desde hombros hacia cadera)
    w_waist = (shoulder_w * 0.60 + hip_w * 0.40) / body_h * 0.82

    # ── Estimación de grasa corporal (formulación 2D calibrada) ───────────────
    # Mujeres tienen ~8–10% más BF que hombres para la misma silueta
    gender_offset = 9.0 if gender == "female" else 0.0
    body_fat = gender_offset + 32 * w_waist + 22 * w_hip - 12 * max(0, shr - 1.0)
    lo_bf    = 5.0 if gender == "male" else 12.0
    body_fat = max(lo_bf, min(50.0, round(body_fat, 1)))

    # ── Estimación de IMC (proxy 2D) ───────────────────────────────────────────
    bmi_est = max(15.0, min(42.0, round(13.0 + bwi * 68 + 28 * w_waist, 1)))

    # ── Tipo corporal ──────────────────────────────────────────────────────────
    if gender == "female":
        if shr > 1.18 and body_fat < 25:
            body_type, body_type_label = "athletic", "Atlético / Mesomorfo"
        elif shr < 0.92:
            body_type, body_type_label = "pear", "Pera / Ginoide"
        elif body_fat > 32:
            body_type, body_type_label = "endomorph", "Endomorfo"
        elif body_fat < 20:
            body_type, body_type_label = "ectomorph", "Ectomorfo / Delgada"
        else:
            body_type, body_type_label = "mesomorph", "Mesomorfo / Equilibrado"
    else:
        if shr > 1.25 and body_fat < 18:
            body_type, body_type_label = "athletic", "Atlético / Mesomorfo"
        elif shr > 1.15:
            body_type, body_type_label = "mesomorph", "Mesomorfo"
        elif body_fat > 25:
            body_type, body_type_label = "endomorph", "Endomorfo"
        elif body_fat < 12:
            body_type, body_type_label = "ectomorph", "Ectomorfo / Delgado"
        else:
            body_type, body_type_label = "balanced", "Equilibrado"

    # ── Objetivo recomendado ───────────────────────────────────────────────────
    if bmi_est < 18.5:
        bmi_range, recommended_goal = "Bajo peso (<18.5)", "gain"
    elif bmi_est < 25.0:
        bmi_range, recommended_goal = "Peso normal (18.5–25)", "maintain"
    elif bmi_est < 30.0:
        bmi_range, recommended_goal = "Sobrepeso (25–30)", "lose"
    else:
        bmi_range, recommended_goal = "Obesidad (>30)", "lose"

    # ── Nivel de actividad recomendado ─────────────────────────────────────────
    if body_fat < 12 or body_type in ("athletic",):
        recommended_activity = "active"
    elif body_fat > 32 or bmi_est > 30:
        recommended_activity = "light"
    else:
        recommended_activity = "moderate"

    # ── Observaciones personalizadas ───────────────────────────────────────────
    obs = []
    if shr > 1.22:
        obs.append("Proporción hombro–cadera favorable para el desarrollo muscular.")
    if body_fat > 28:
        obs.append("Nivel de grasa elevado; prioriza cardio y déficit calórico moderado.")
    elif body_fat < 11 and gender == "male":
        obs.append("Bajo % graso; aumenta ingesta proteica y superávit calórico.")
    elif body_fat < 16 and gender == "female":
        obs.append("Bajo % graso; asegura ingesta calórica suficiente.")
    if bmi_est > 27:
        obs.append("Inicia con entrenamiento de bajo impacto para proteger articulaciones.")
    if not obs:
        obs.append("Buena composición detectada — mantén la constancia en tus hábitos.")

    # ── Confianza promedio ─────────────────────────────────────────────────────
    conf_vals = [
        float(kp_conf[KP[n]]) for n in _CORE_KPS
        if kp_conf is not None and KP[n] < len(kp_conf)
    ]
    detection_conf = round(float(np.mean(conf_vals)) if conf_vals else 0.7, 2)

    return {
        "personDetected":           True,
        "confidence":               detection_conf,
        "bodyType":                 body_type,
        "bodyTypeLabel":            body_type_label,
        "estimatedBMIRange":        bmi_range,
        "estimatedBMI":             bmi_est,
        "estimatedBodyFat":         body_fat,
        "shoulderHipRatio":         round(shr, 2),
        "recommendedGoal":          recommended_goal,
        "recommendedGoalLabel":     _GOAL_LABELS[recommended_goal],
        "recommendedActivity":      recommended_activity,
        "recommendedActivityLabel": _ACTIVITY_LABELS[recommended_activity],
        "observations":             " ".join(obs),
    }
