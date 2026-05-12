'use strict';

const express      = require('express');
const router       = express.Router();
const pg           = require('../../db/postgres');
const { requireAuth }  = require('./auth');
const asyncHandler     = require('../../utils/asyncHandler');
const { validateNumber, validateEnum, abort } = require('../../utils/validate');
const { VALID_GOALS, VALID_GENDERS, VALID_ACTIVITY_LEVELS } = require('../../utils/constants');
const { calcMetrics } = require('../../utils/metrics');

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

module.exports = router;
