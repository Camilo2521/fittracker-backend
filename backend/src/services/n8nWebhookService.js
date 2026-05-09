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
    'SELECT * FROM accounts WHERE id = $1', [accountId]
  );
  const profile = profileRows[0];
  if (!profile) return null;

  const [workoutRes, dietRes, progressRes] = await Promise.all([
    pg.query(
      `SELECT COUNT(*) AS c FROM workout_logs
       WHERE account_id = $1 AND date >= CURRENT_DATE - INTERVAL '7 days'`,
      [accountId]
    ),
    pg.query(
      `SELECT COUNT(*) AS c FROM diet_logs
       WHERE account_id = $1 AND date >= CURRENT_DATE - INTERVAL '7 days'`,
      [accountId]
    ),
    pg.query(
      'SELECT weight, date FROM progress_logs WHERE account_id = $1 ORDER BY date DESC LIMIT 2',
      [accountId]
    ),
  ]);

  const lastProgress  = progressRes.rows;
  const weightChange  = lastProgress.length >= 2
    ? parseFloat((lastProgress[0].weight - lastProgress[1].weight).toFixed(1))
    : null;

  return {
    user: {
      name:          profile.name,
      goal:          profile.goal,
      weight:        profile.weight,
      height:        profile.height_cm,
      age:           profile.age,
      gender:        profile.gender,
      activityLevel: profile.activity_level,
      restrictions:  profile.restrictions,
    },
    context: {
      recentWorkouts:  parseInt(workoutRes.rows[0].c, 10),
      recentDietLogs:  parseInt(dietRes.rows[0].c, 10),
      weeklyTarget:    4,
      weightChange,
      lastWeightDate:  lastProgress[0]?.date || null,
    },
  };
}

module.exports = { emit, buildUserContext };
