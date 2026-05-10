'use strict';

const express = require('express');
const router  = express.Router();
const { validateEnum, abort } = require('../../utils/validate');
const { VALID_EXERCISE_TYPES } = require('../../utils/constants');
const { requireAuth } = require('./auth');

const PYTHON_BASE = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';
const { generateInternalToken } = require('../../utils/internalToken');

/**
 * POST /api/v1/yolo/analyze/:exerciseType
 * Multipart/form-data: frame=<JPEG>
 * Query param: session_id
 *
 * Proxy directo al microservicio Python para mantener la latencia baja.
 * Devuelve { reps, phase, form_score, angles, issues, tips, keypoints }.
 */
router.post('/analyze/:exerciseType', requireAuth, async (req, res) => {
  const { exerciseType } = req.params;
  if (abort(res, [validateEnum(exerciseType, 'exerciseType', VALID_EXERCISE_TYPES, { required: true })])) return;
  const sessionId = req.query.session_id || 'default';

  // Pasar el body multipart tal cual al servicio Python
  const pythonUrl = `${PYTHON_BASE}/frames/analyze/${exerciseType}?session_id=${sessionId}`;

  try {
    // Re-stream el body (multer ya no es necesario — pasamos raw)
    const chunks = [];
    req.on('data', c => chunks.push(c));
    await new Promise(resolve => req.on('end', resolve));
    const body = Buffer.concat(chunks);

    const pyRes = await fetch(pythonUrl, {
      method:  'POST',
      headers: {
        'x-internal-token': generateInternalToken(),
        'content-type':     req.headers['content-type'],  // multipart boundary
        'content-length':   body.length,
      },
      body,
      signal: AbortSignal.timeout(6000),
    });

    const data = await pyRes.json().catch(() => ({}));
    res.status(pyRes.status).json(data);
  } catch (err) {
    console.error('[yolo] POST /analyze error:', err.message);
    res.status(503).json({ error: 'Servicio YOLO no disponible' });
  }
});

/**
 * GET /api/v1/yolo/session/:sessionId/summary
 */
router.get('/session/:sessionId/summary', requireAuth, async (req, res) => {
  try {
    const pyRes = await fetch(
      `${PYTHON_BASE}/frames/session/${req.params.sessionId}/summary`,
      { headers: { 'x-internal-token': generateInternalToken() }, signal: AbortSignal.timeout(4000) }
    );
    res.status(pyRes.status).json(await pyRes.json());
  } catch (err) {
    console.error('[yolo] GET /summary error:', err.message);
    res.status(503).json({ error: 'Servicio YOLO no disponible' });
  }
});

/**
 * DELETE /api/v1/yolo/session/:sessionId
 */
router.delete('/session/:sessionId', requireAuth, async (req, res) => {
  try {
    const pyRes = await fetch(
      `${PYTHON_BASE}/frames/session/${req.params.sessionId}`,
      { method: 'DELETE', headers: { 'x-internal-token': generateInternalToken() }, signal: AbortSignal.timeout(4000) }
    );
    res.status(pyRes.status).json(await pyRes.json());
  } catch (err) {
    console.error('[yolo] DELETE /session error:', err.message);
    res.status(503).json({ error: 'Servicio YOLO no disponible' });
  }
});

module.exports = router;
