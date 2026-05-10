'use strict';

const pg           = require('../db/postgres');
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const N8N_SECRET      = process.env.N8N_SECRET || '';

function emit(eventType, payload) {
  if (!N8N_WEBHOOK_URL) return;

  const body = JSON.stringify({
    event:     eventType,
    timestamp: new Date().toISOString(),
    source:    'fittracker-backend-v3',
    ...payload,
  });

  fetch(N8N_WEBHOOK_URL, {
    method:  'POST',
    headers: {
      'Content-Type':       'application/json',
      'x-n8n-secret':       N8N_SECRET,
      'x-fittracker-event': eventType,
    },
    body,
    signal: AbortSignal.timeout(6000),
  }).then(r => {
    if (!r.ok) console.warn(`[n8n] webhook respondió ${r.status} para evento "${eventType}"`);
  }).catch(err => {
    console.warn(`[n8n] no se pudo enviar "${eventType}":`, err.message);
  });
}

async function buildUserContext(accountId) {
  const { rows: profileRows } = await pg.query(
    'SELECT * FROM cuentas WHERE id = $1', [accountId]
  );
  const profile = profileRows[0];
  if (!profile) return null;

  const [workoutRes, dietRes, progressRes] = await Promise.all([
    pg.query(
      `SELECT COUNT(*) AS c FROM registros_entrenamiento
       WHERE cuenta_id = $1 AND fecha >= CURRENT_DATE - INTERVAL '7 days'`,
      [accountId]
    ),
    pg.query(
      `SELECT COUNT(*) AS c FROM registros_dieta
       WHERE cuenta_id = $1 AND fecha >= CURRENT_DATE - INTERVAL '7 days'`,
      [accountId]
    ),
    pg.query(
      'SELECT peso, fecha FROM registros_progreso WHERE cuenta_id = $1 ORDER BY fecha DESC LIMIT 2',
      [accountId]
    ),
  ]);

  const lastProgress  = progressRes.rows;
  const weightChange  = lastProgress.length >= 2
    ? parseFloat((lastProgress[0].peso - lastProgress[1].peso).toFixed(1))
    : null;

  return {
    user: {
      name:          profile.nombre,
      goal:          profile.objetivo,
      weight:        profile.peso,
      height:        profile.altura_cm,
      age:           profile.edad,
      gender:        profile.genero,
      activityLevel: profile.nivel_actividad,
      restrictions:  profile.restricciones,
    },
    context: {
      recentWorkouts:  parseInt(workoutRes.rows[0].c, 10),
      recentDietLogs:  parseInt(dietRes.rows[0].c, 10),
      weeklyTarget:    4,
      weightChange,
      lastWeightDate:  lastProgress[0]?.fecha || null,
    },
  };
}

module.exports = { emit, buildUserContext };
