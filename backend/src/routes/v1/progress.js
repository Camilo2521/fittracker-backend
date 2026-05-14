'use strict';

const express      = require('express');
const router       = express.Router();
const pg           = require('../../db/postgres');
const { requireAuth }  = require('./auth');
const asyncHandler     = require('../../utils/asyncHandler');
const { validateNumber, validateEnum, abort } = require('../../utils/validate');
const { VALID_GOALS, VALID_GENDERS, VALID_ACTIVITY_LEVELS } = require('../../utils/constants');
const { calcMetrics } = require('../../utils/metrics');
const vision       = require('../../services/visionClient');

/**
 * POST /api/v1/progress/metrics
 * Calcula IMC, TMB y TDEE a partir del perfil en PostgreSQL.
 */
router.post('/metrics', requireAuth, asyncHandler(async (req, res) => {
  const {
    weight: bodyWeight, heightCm: bodyHeight, age: bodyAge,
    gender: bodyGender, activityLevel: bodyActivity, goal: bodyGoal,
  } = req.body;
  const userId = req.accountId;

  if (abort(res, [
    validateNumber(bodyWeight,  'weight',        { min: 30,  max: 500 }),
    validateNumber(bodyHeight,  'heightCm',      { min: 50,  max: 280 }),
    validateNumber(bodyAge,     'age',           { min: 5,   max: 120 }),
    validateEnum(bodyGender,    'gender',        VALID_GENDERS),
    validateEnum(bodyActivity,  'activityLevel', VALID_ACTIVITY_LEVELS),
    validateEnum(bodyGoal,      'goal',          VALID_GOALS),
  ])) return;

  const { rows } = await pg.query('SELECT * FROM cuentas WHERE id = $1', [userId]);
  const user = rows[0];

  // El cuerpo de la petición tiene prioridad; el perfil guardado es el fallback.
  const weight   = bodyWeight   || user?.peso;
  const height   = bodyHeight   || user?.altura_cm;
  const age      = bodyAge      || user?.edad;
  const gender   = bodyGender   || user?.genero          || 'male';
  const activity = bodyActivity || user?.nivel_actividad || 'moderate';
  const goal     = bodyGoal     || user?.objetivo        || 'maintain';

  if (!weight || !height || !age) {
    return res.status(422).json({
      error:   'Perfil físico incompleto',
      missing: [
        !weight && 'weight',
        !height && 'heightCm',
        !age    && 'age',
      ].filter(Boolean),
    });
  }

  const { bmi, bmr, tdee, calorie_target } = calcMetrics(
    Number(weight), Number(height), Number(age), gender, activity, goal
  );

  // Persistir: una fila por usuario por día — UPSERT idempotente (migración 008).
  pg.query(
    `INSERT INTO metricas_fisicas (cuenta_id, imc, tmb, gasto_calorico, meta_calorica, fecha_calculo)
     VALUES ($1,$2,$3,$4,$5, CURRENT_DATE)
     ON CONFLICT (cuenta_id, fecha_calculo) DO UPDATE
     SET imc=EXCLUDED.imc, tmb=EXCLUDED.tmb,
         gasto_calorico=EXCLUDED.gasto_calorico, meta_calorica=EXCLUDED.meta_calorica`,
    [userId, bmi, bmr, tdee, calorie_target]
  ).catch(e => console.warn('[progress] No se pudo persistir métricas:', e.message));

  res.json({ bmi, bmr, tdee, calorie_target });
}));

/**
 * GET /api/v1/progress/metrics
 * Historial de métricas físicas del usuario autenticado.
 */
router.get('/metrics', requireAuth, asyncHandler(async (req, res) => {
  const limit  = Math.min(Math.max(parseInt(req.query.limit  || '30', 10), 1), 100);
  const offset = Math.max(parseInt(req.query.offset || '0',  10), 0);
  let data, count;
  try {
    [data, count] = await Promise.all([
      pg.query(
        `SELECT fecha_calculo, imc, tmb, gasto_calorico, meta_calorica
         FROM metricas_fisicas
         WHERE cuenta_id = $1
         ORDER BY fecha_calculo DESC
         LIMIT $2 OFFSET $3`,
        [req.accountId, limit, offset]
      ),
      pg.query(
        'SELECT COUNT(*)::int AS total FROM metricas_fisicas WHERE cuenta_id = $1',
        [req.accountId]
      ),
    ]);
  } catch (e) {
    if (e?.code === '42P01') return res.json({ data: [], total: 0, limit, offset });
    throw e;
  }
  res.json({ data: data.rows, total: count.rows[0].total, limit, offset });
}));

/**
 * GET /api/v1/progress/forecast
 * Predicción de peso corporal con ProgressNet (red neuronal + modelo físico).
 * Requiere que el servicio Python esté corriendo.
 */
router.get('/forecast', requireAuth, asyncHandler(async (req, res) => {
  const userId = req.accountId;

  // ── 1. Perfil del usuario ──────────────────────────────────────────────────
  const { rows: userRows } = await pg.query(
    'SELECT peso, altura_cm, edad, genero, nivel_actividad, objetivo FROM cuentas WHERE id = $1',
    [userId]
  );
  const user = userRows[0];
  if (!user?.peso || !user?.altura_cm || !user?.edad) {
    return res.status(422).json({
      error: 'Perfil físico incompleto. Completa peso, altura y edad antes de usar la predicción.',
    });
  }

  // Métricas actuales (última fila)
  const { rows: metRows } = await pg.query(
    `SELECT gasto_calorico, meta_calorica FROM metricas_fisicas
     WHERE cuenta_id = $1 ORDER BY fecha_calculo DESC LIMIT 1`,
    [userId]
  );
  const metrics = metRows[0] || {};

  // ── 2. Historial de peso (registros_progreso) ──────────────────────────────
  const { rows: wRows } = await pg.query(
    `SELECT fecha::text AS date, peso AS weight
     FROM registros_progreso
     WHERE cuenta_id = $1 AND peso IS NOT NULL
     ORDER BY fecha ASC
     LIMIT 180`,
    [userId]
  );

  // ── 3. Historial de actividad (registros_entrenamiento) ───────────────────
  const { rows: aRows } = await pg.query(
    `SELECT fecha::text AS date,
            COUNT(*)::int AS workouts,
            COALESCE(AVG(duracion_min), 45)::float AS duration
     FROM registros_entrenamiento
     WHERE cuenta_id = $1
     GROUP BY fecha ORDER BY fecha ASC LIMIT 120`,
    [userId]
  );

  // ── 4. Historial calórico (registros_dieta) ────────────────────────────────
  const { rows: cRows } = await pg.query(
    `SELECT fecha::text AS date,
            SUM(total_kcal)::float AS calories
     FROM registros_dieta
     WHERE cuenta_id = $1
     GROUP BY fecha ORDER BY fecha ASC LIMIT 60`,
    [userId]
  );

  // ── 5. Llamar al servicio Python ───────────────────────────────────────────
  const payload = {
    user_id: userId,
    profile: {
      weight_kg:      Number(user.peso),
      height_cm:      Number(user.altura_cm),
      age:            Number(user.edad),
      gender:         user.genero    || 'other',
      goal:           user.objetivo  || 'maintain',
      tdee:           metrics.gasto_calorico  ? Number(metrics.gasto_calorico)  : null,
      calorie_target: metrics.meta_calorica   ? Number(metrics.meta_calorica)   : null,
      activity_level: user.nivel_actividad || 'moderate',
    },
    weight_history:   wRows,
    activity_history: aRows,
    calorie_history:  cRows,
  };

  const result = await vision.getForecast(payload);

  if (!result.ok) {
    // Servicio Python no disponible — devolver predicción física de emergencia
    const { calcMetrics: cm } = require('../../utils/metrics');
    const { bmi, tdee, calorie_target } = cm(
      Number(user.peso), Number(user.altura_cm), Number(user.edad),
      user.genero || 'male', user.nivel_actividad || 'moderate', user.objetivo || 'maintain'
    );
    const deficitPerDay = calorie_target - tdee;
    const physDelta = (d) => -(deficitPerDay * d) / 7700;
    const today = new Date();
    const fmt   = (d) => new Date(today.getTime() + d * 86400000).toISOString().slice(0, 10);

    return res.json({
      user_id:        userId,
      model_type:     'physics',
      data_points:    wRows.length,
      current_weight: Number(user.peso),
      weekly_rate:    Math.round(physDelta(7) * 1000) / 1000,
      trend:          deficitPerDay < -50 ? 'losing' : deficitPerDay > 50 ? 'gaining' : 'stable',
      goal_eta_days:  null,
      predictions: [7, 14, 30, 60, 90].map(d => ({
        days:       d,
        date:       fmt(d),
        weight:     Math.round((Number(user.peso) + physDelta(d)) * 100) / 100,
        lower:      Math.round((Number(user.peso) + physDelta(d) - 0.5 * Math.sqrt(d / 7)) * 100) / 100,
        upper:      Math.round((Number(user.peso) + physDelta(d) + 0.5 * Math.sqrt(d / 7)) * 100) / 100,
        confidence: Math.max(0.4, 0.9 - 0.006 * d),
      })),
      insights: ['Servicio de IA no disponible — mostrando predicción física de balance calórico.'],
    });
  }

  res.json(result.data);
}));

module.exports = router;
