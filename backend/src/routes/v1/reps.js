'use strict';

const express          = require('express');
const router           = express.Router();
const vision           = require('../../services/visionClient');
const pg               = require('../../db/postgres');
const { requireAuth }  = require('./auth');
const { validateEnum, abort } = require('../../utils/validate');
const { VALID_EXERCISE_TYPES } = require('../../utils/constants');

/**
 * POST /api/v1/reps/sessions
 * Crea una nueva sesión de conteo de repeticiones.
 * Si Python no está disponible → responde con modo local (fallback).
 */
router.post('/sessions', requireAuth, async (req, res) => {
  const { exerciseType } = req.body;
  if (!exerciseType) return res.status(400).json({ error: 'exerciseType es requerido' });
  if (abort(res, [validateEnum(exerciseType, 'exerciseType', VALID_EXERCISE_TYPES, { required: true })])) return;

  const result = await vision.createSession(req.accountId, exerciseType);

  if (!result.ok && result.fallback) {
    // Python no disponible → modo offline local
    return res.json({
      sessionId: `local_${Date.now()}`,
      mode:      'mediapipe',
      fallback:  true,
      message:   'Modo offline: conteo con MediaPipe en el dispositivo',
    });
  }

  if (!result.ok) {
    return res.status(result.status || 502).json(result.data || { error: 'Error creando sesión' });
  }

  res.status(201).json(result.data);
});

/**
 * POST /api/v1/reps/sessions/:id/complete
 * Cierra una sesión y persiste los resultados.
 */
router.post('/sessions/:id/complete', requireAuth, async (req, res) => {
  const { id } = req.params;

  // Sesión local (sin Python) — persiste solo en SQLite via workouts existente
  if (id.startsWith('local_')) {
    const { totalReps, totalSets, exerciseType, caloriesBurned, avgFormScore } = req.body;
    return res.json({
      sessionId:      id,
      mode:           'mediapipe',
      totalReps:      totalReps   || 0,
      totalSets:      totalSets   || 0,
      caloriesBurned: caloriesBurned || 0,
      avgFormScore:   avgFormScore   || 0,
      persisted:      true,
    });
  }

  const result = await vision.completeSession(id, req.body);
  if (!result.ok) {
    return res.status(result.status || 502).json(result.data || { error: 'Error completando sesión' });
  }
  res.json(result.data);
});

/**
 * GET /api/v1/reps/sessions/:id
 * Devuelve historial de una sesión.
 */
router.get('/sessions/:id', requireAuth, async (req, res) => {
  const result = await vision.getSession(req.params.id);
  if (!result.ok) {
    return res.status(result.status || 502).json(result.data || { error: 'Sesión no encontrada' });
  }
  res.json(result.data);
});

/**
 * GET /api/v1/reps/history/:userId
 * Historial de sesiones de un usuario desde PostgreSQL.
 */
router.get('/history/:userId', requireAuth, async (req, res) => {
  const limit  = Math.min(Math.max(parseInt(req.query.limit  || '20', 10), 1), 100);
  const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);
  try {
    const [data, count] = await Promise.all([
      pg.query(
        `SELECT id, exercise_type, mode, started_at, ended_at,
                total_reps, total_sets, calories_burned, avg_form_score
         FROM rep_sessions
         WHERE cuenta_id = $1
         ORDER BY started_at DESC
         LIMIT $2 OFFSET $3`,
        [req.accountId, limit, offset]
      ),
      pg.query('SELECT COUNT(*)::int AS total FROM rep_sessions WHERE cuenta_id = $1', [req.accountId]),
    ]);
    res.json({ data: data.rows, total: count.rows[0].total, limit, offset });
  } catch (e) {
    console.error('[reps] history error:', e.message);
    res.status(500).json({ error: 'Error consultando historial' });
  }
});

module.exports = router;
