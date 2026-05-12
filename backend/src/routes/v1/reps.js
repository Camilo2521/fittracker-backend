'use strict';

const express            = require('express');
const router             = express.Router();
const vision             = require('../../services/visionClient');
const pg                 = require('../../db/postgres');
const { requireAuth }    = require('./auth');
const asyncHandler       = require('../../utils/asyncHandler');
const { validateEnum, abort } = require('../../utils/validate');
const { VALID_EXERCISE_TYPES } = require('../../utils/constants');

/**
 * Persiste una sesión completada en rep_sessions.
 * Fire-and-forget: los errores de DB se loguean sin propagar al cliente.
 */
async function _persistSession(accountId, {
  exerciseType, mode, startedAt, endedAt,
  totalReps, totalSets, caloriesBurned, avgFormScore,
}) {
  try {
    await pg.query(
      `INSERT INTO rep_sessions
         (cuenta_id, tipo_ejercicio, modo, iniciado_en, finalizado_en,
          total_repeticiones, total_series, calorias_quemadas, puntuacion_forma_promedio)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        accountId,
        exerciseType   || 'unknown',
        mode           || 'mediapipe',
        startedAt      || new Date(),
        endedAt        || new Date(),
        totalReps      || 0,
        totalSets      || 0,
        caloriesBurned ?? null,
        avgFormScore   ?? null,
      ]
    );
  } catch (e) {
    console.error('[reps] persist session error:', e.message);
  }
}

/**
 * POST /api/v1/reps/sessions
 * Crea una nueva sesión de conteo de repeticiones.
 * Si Python no está disponible → responde con modo local (fallback).
 */
router.post('/sessions', requireAuth, asyncHandler(async (req, res) => {
  const { exerciseType } = req.body;
  if (!exerciseType) return res.status(400).json({ error: 'exerciseType es requerido' });
  if (abort(res, [validateEnum(exerciseType, 'exerciseType', VALID_EXERCISE_TYPES, { required: true })])) return;

  const result = await vision.createSession(req.accountId, exerciseType);

  if (!result.ok && result.fallback) {
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
}));

/**
 * POST /api/v1/reps/sessions/:id/complete
 * Cierra una sesión, persiste los resultados en PostgreSQL y devuelve el resumen.
 */
router.post('/sessions/:id/complete', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (id.startsWith('local_')) {
    const { totalReps, totalSets, exerciseType, caloriesBurned, avgFormScore } = req.body;
    const startedAt = new Date(parseInt(id.replace('local_', ''), 10));

    await _persistSession(req.accountId, {
      exerciseType, mode: 'mediapipe', startedAt, endedAt: new Date(),
      totalReps, totalSets, caloriesBurned, avgFormScore,
    });

    return res.json({
      sessionId:      id,
      mode:           'mediapipe',
      totalReps:      totalReps      || 0,
      totalSets:      totalSets      || 0,
      caloriesBurned: caloriesBurned || 0,
      avgFormScore:   avgFormScore   || 0,
      persisted:      true,
    });
  }

  const result = await vision.completeSession(id, req.body);
  if (!result.ok) {
    return res.status(result.status || 502).json(result.data || { error: 'Error completando sesión' });
  }

  const d = result.data;
  await _persistSession(req.accountId, {
    exerciseType:   d.exerciseType   ?? d.exercise_type,
    mode:           d.mode           ?? 'mediapipe',
    startedAt:      d.startedAt      ?? d.started_at,
    endedAt:        d.endedAt        ?? d.ended_at ?? new Date(),
    totalReps:      d.totalReps      ?? d.total_reps,
    totalSets:      d.totalSets      ?? d.total_sets,
    caloriesBurned: d.caloriesBurned ?? d.calories_burned,
    avgFormScore:   d.avgFormScore   ?? d.avg_form_score,
  });

  res.json(d);
}));

/**
 * GET /api/v1/reps/sessions/:id
 * Devuelve el estado de una sesión activa desde el servicio Python.
 */
router.get('/sessions/:id', requireAuth, asyncHandler(async (req, res) => {
  const result = await vision.getSession(req.params.id);
  if (!result.ok) {
    return res.status(result.status || 502).json(result.data || { error: 'Sesión no encontrada' });
  }
  res.json(result.data);
}));

/**
 * GET /api/v1/reps/history
 * Historial paginado de sesiones completadas del usuario autenticado.
 */
router.get('/history', requireAuth, asyncHandler(async (req, res) => {
  const limit  = Math.min(Math.max(parseInt(req.query.limit  || '20', 10), 1), 100);
  const offset = Math.max(parseInt(req.query.offset || '0',  10), 0);

  const [data, count] = await Promise.all([
    pg.query(
      `SELECT id, tipo_ejercicio, modo, iniciado_en, finalizado_en,
              total_repeticiones, total_series, calorias_quemadas,
              puntuacion_forma_promedio
       FROM rep_sessions
       WHERE cuenta_id = $1
       ORDER BY iniciado_en DESC
       LIMIT $2 OFFSET $3`,
      [req.accountId, limit, offset]
    ),
    pg.query(
      'SELECT COUNT(*)::int AS total FROM rep_sessions WHERE cuenta_id = $1',
      [req.accountId]
    ),
  ]);

  res.json({ data: data.rows, total: count.rows[0].total, limit, offset });
}));

module.exports = router;
