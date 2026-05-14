'use strict';

const { generateInternalToken } = require('../utils/internalToken');

const PYTHON_BASE = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';
const TIMEOUT_MS  = 8_000;

function _headers(extra = {}) {
  return {
    'Content-Type':     'application/json',
    'x-internal-token': generateInternalToken(),
    ...extra,
  };
}

async function _fetch(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${PYTHON_BASE}${path}`, {
      ...options,
      headers: { ..._headers(options.headers || {}), ...(options._rawHeaders || {}) },
      signal: controller.signal,
    });
    if (options._raw) return res;           // caller wants raw Response (PDF)
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn('[visionClient] Timeout conectando a Python service');
    } else {
      console.warn('[visionClient] Python service no disponible:', err.message);
    }
    return { ok: false, fallback: true, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

// ── Sesiones de repeticiones ──────────────────────────────────────────────────

async function createSession(externalId, exerciseType) {
  return _fetch('/vision/sessions', {
    method: 'POST',
    body: JSON.stringify({ external_id: externalId, exercise_type: exerciseType }),
  });
}

async function completeSession(sessionId, payload) {
  return _fetch(`/vision/sessions/${sessionId}/complete`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

async function getSession(sessionId) {
  return _fetch(`/vision/sessions/${sessionId}`);
}

// ── PDF ───────────────────────────────────────────────────────────────────────

/**
 * Genera el PDF del plan de dieta y devuelve el Buffer de bytes.
 * Retorna null si el servicio Python no está disponible.
 */
async function generateDietPdf(dietData, userName = 'Usuario') {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000); // PDF puede tardar
    const res = await fetch(`${PYTHON_BASE}/pdf/diet`, {
      method:  'POST',
      headers: _headers(),
      body:    JSON.stringify({ diet_data: dietData, user_name: userName }),
      signal:  controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
}

// ── RAG ───────────────────────────────────────────────────────────────────────

async function generateDiet(userProfile, weekStart) {
  return _fetch('/rag/diet', {
    method: 'POST',
    body: JSON.stringify({ user_profile: userProfile, week_start: weekStart }),
  });
}

async function generateRoutine(userProfile) {
  return _fetch('/rag/routine', {
    method: 'POST',
    body: JSON.stringify({ user_profile: userProfile }),
  });
}

// ── Predictor neuronal ────────────────────────────────────────────────────────

async function getForecast(payload) {
  return _fetch('/predictor/forecast', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

async function getPredictorStatus() {
  return _fetch('/predictor/status');
}

module.exports = {
  createSession, completeSession, getSession,
  generateDietPdf,
  generateDiet, generateRoutine,
  getForecast, getPredictorStatus,
};
