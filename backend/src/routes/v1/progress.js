'use strict';

const express = require('express');
const router  = express.Router();
const pg      = require('../../db/postgres');
const { requireAuth } = require('./auth');
const { validateNumber, validateEnum, abort } = require('../../utils/validate');
const { ACTIVITY_FACTORS, VALID_GOALS, VALID_GENDERS, VALID_ACTIVITY_LEVELS, BMR_DEFICIT, BMR_SURPLUS } = require('../../utils/constants');

/**
 * POST /api/v1/progress/metrics
 * Calcula IMC, TMB y TDEE a partir del perfil en PostgreSQL.
 */
router.post('/metrics', requireAuth, async (req, res) => {
  const {
    weight: bodyWeight, heightCm: bodyHeight, age: bodyAge,
    gender: bodyGender, activityLevel: bodyActivity, goal: bodyGoal,
  } = req.body;
  const userId = req.accountId;
  if (abort(res, [
    validateNumber(bodyWeight,   'weight',        { min: 30,  max: 500 }),
    validateNumber(bodyHeight,   'heightCm',      { min: 50,  max: 280 }),
    validateNumber(bodyAge,      'age',           { min: 5,   max: 120 }),
    validateEnum(bodyGender,     'gender',        VALID_GENDERS),
    validateEnum(bodyActivity,   'activityLevel', VALID_ACTIVITY_LEVELS),
    validateEnum(bodyGoal,       'goal',          VALID_GOALS),
  ])) return;

  const { rows } = await pg.query('SELECT * FROM cuentas WHERE id = $1', [userId]);
  const user = rows[0];

  const weight   = bodyWeight  || user?.peso;
  const height   = bodyHeight  || user?.altura_cm;
  const age      = bodyAge     || user?.edad;
  const gender   = bodyGender  || user?.genero          || 'male';
  const activity = bodyActivity || user?.nivel_actividad || 'moderate';
  const goal     = bodyGoal    || user?.objetivo        || 'maintain';

  if (!weight || !height || !age) {
    return res.status(422).json({
      error:   'Perfil físico incompleto',
      missing: [
        !weight && 'weight',
        !height && 'heightCm (height_cm)',
        !age    && 'age',
      ].filter(Boolean),
    });
  }

  const bmi = weight / ((height / 100) ** 2);
  const bmr = gender === 'female'
    ? 10 * weight + 6.25 * height - 5 * age - 161
    : 10 * weight + 6.25 * height - 5 * age + 5;

  const tdee = bmr * (ACTIVITY_FACTORS[activity] || ACTIVITY_FACTORS.moderate);
  let calorieTarget = goal === 'lose' ? tdee - BMR_DEFICIT : goal === 'gain' ? tdee + BMR_SURPLUS : tdee;

  const metrics = {
    bmi:            Math.round(bmi * 10) / 10,
    bmr:            Math.round(bmr),
    tdee:           Math.round(tdee),
    calorie_target: Math.round(calorieTarget),
  };

  // Persistir en PostgreSQL (fire-and-forget)
  pg.query(
    `INSERT INTO metricas_fisicas (cuenta_id, imc, tmb, gasto_calorico, meta_calorica)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (cuenta_id, medido_en) DO UPDATE
     SET imc=$2, tmb=$3, gasto_calorico=$4, meta_calorica=$5`,
    [userId, metrics.bmi, metrics.bmr, metrics.tdee, metrics.calorie_target]
  ).catch(e => console.warn('[progress] No se pudo persistir métricas:', e.message));

  res.json(metrics);
});

/**
 * GET /api/v1/progress/metrics
 * Historial de métricas físicas del usuario autenticado.
 */
router.get('/metrics', requireAuth, async (req, res) => {
  const limit  = Math.min(Math.max(parseInt(req.query.limit  || '30', 10), 1), 100);
  const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);
  try {
    const [data, count] = await Promise.all([
      pg.query(
        `SELECT medido_en, imc, tmb, gasto_calorico, meta_calorica
         FROM metricas_fisicas
         WHERE cuenta_id = $1
         ORDER BY medido_en DESC
         LIMIT $2 OFFSET $3`,
        [req.accountId, limit, offset]
      ),
      pg.query('SELECT COUNT(*)::int AS total FROM metricas_fisicas WHERE cuenta_id = $1', [req.accountId]),
    ]);
    res.json({ data: data.rows, total: count.rows[0].total, limit, offset });
  } catch (e) {
    if (e?.code === '42P01') return res.json({ data: [], total: 0, limit, offset });
    res.status(503).json({ error: 'Servicio de métricas no disponible' });
  }
});

module.exports = router;
