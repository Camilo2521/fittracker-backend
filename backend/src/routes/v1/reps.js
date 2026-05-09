'use strict';

const express = require('express');
const router  = express.Router();
const vision  = require('../../services/visionClient');
const pg      = require('../../db/postgres');
const { validateEnum, abort } = require('../../utils/validate');
const { VALID_EXERCISE_TYPES } = require('../../utils/constants');

/**
 * POST /api/v1/reps/sessions
 * Crea una nueva sesión de conteo de repeticiones.
 * Si Python no está disponible → responde con modo local (fallback).
 */
router.post('/sessions', async (req, res) => {
  const { userId, exerciseType } = req.body;
  if (!userId || !exerciseType) {
    return res.status(400).json({ error: 'userId y exerciseType son requeridos' });
  }
  if (abort(res, [validateEnum(exerciseType, 'exerciseType', VALID_EXERCISE_TYPES, { required: true })])) return;

  const result = await vision.createSession(userId, exerciseType);

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
router.post('/sessions/:id/complete', async (req, res) => {
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
router.get('/sessions/:id', async (req, res) => {
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
router.get('/history/:userId', async (req, res) => {
  try {
    const result = await pg.query(
      `SELECT id, exercise_type, mode, started_at, ended_at,
              total_reps, total_sets, calories_burned, avg_form_score
       FROM rep_sessions
       WHERE account_id = $1
       ORDER BY started_at DESC
       LIMIT 50`,
      [req.params.userId]
    );
    res.json(result?.rows || []);
  } catch (e) {
    console.error('[reps] history error:', e.message);
    res.status(500).json({ error: 'Error consultando historial' });
  }
});

module.exports = router;
