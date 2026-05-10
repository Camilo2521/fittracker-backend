'use strict';

const express = require('express');
const router  = express.Router();
const pg      = require('../../db/postgres');

const N8N_SECRET = process.env.N8N_SECRET || '';

if (!N8N_SECRET) {
  console.warn('[n8n] N8N_SECRET no configurado — los endpoints de n8n están sin protección. Añade N8N_SECRET a backend/.env en producción.');
}

function verifyN8nSecret(req, res, next) {
  if (!N8N_SECRET) return next();
  if ((req.headers['x-n8n-secret'] || '') !== N8N_SECRET) {
    console.warn('[n8n] callback rechazado — secreto inválido desde', req.ip);
    return res.status(401).json({ error: 'Unauthorized: invalid n8n secret' });
  }
  next();
}

// ── POST /api/v1/n8n/build-prompt ────────────────────────────────────────────
router.post('/build-prompt', verifyN8nSecret, (req, res) => {
  const { event, accountId, user = {}, data = {}, context: ctx = {} } = req.body;
  if (!event) return res.status(400).json({ error: 'event es requerido' });

  const goalLabel = { lose: 'bajar de peso', gain: 'ganar músculo', maintain: 'mantener la forma' };
  const goal      = goalLabel[user.goal] || 'mejorar su condición física';
  const name      = user.name  || 'Usuario';
  const kg        = user.weight ? `${user.weight} kg` : '? kg';
  const edad      = user.age   ? `${user.age} años`   : '? años';

  let prompt = '', suggestionType = event;

  if (event === 'workout.logged') {
    const exList = (data.exercises || [])
      .map(e => (typeof e === 'string' ? e : e.name || '')).filter(Boolean).slice(0, 6).join(', ');
    const dur  = data.durationMin ? `${data.durationMin} min` : 'duración no registrada';
    const recs = ctx.recentWorkouts || 0;
    prompt = `Eres FitBot, coach de fitness profesional. Responde SIEMPRE en español. Máximo 3 frases directas y motivadoras.\n\nUsuario: ${name}, objetivo: ${goal}, peso: ${kg}, edad: ${edad}.\nAcaba de completar: "${data.routineName || 'Sesión libre'}" (${dur}). Ejercicios: ${exList || 'varios'}.\nSesiones esta semana: ${recs}/${ctx.weeklyTarget || 4} objetivo.\n\nDa: (1) feedback del entrenamiento, (2) consejo técnico de mejora, (3) motivación alineada a su objetivo.`;

  } else if (event === 'diet.logged') {
    const kcal = data.totalKcal ? `${Math.round(data.totalKcal)} kcal` : '? kcal';
    const rest = user.restrictions || 'ninguna';
    prompt = `Eres FitBot, nutricionista deportivo. Responde SIEMPRE en español. Máximo 3 frases claras y accionables.\n\nUsuario: ${name}, objetivo: ${goal}, peso: ${kg}.\nRegistró alimentación: ${data.planName || 'comida del día'}, ${kcal}, restricciones: ${rest}.\n\nDa: (1) análisis calórico para su objetivo, (2) ajuste nutricional concreto, (3) tip práctico para mañana.`;

  } else if (event === 'progress.updated') {
    const wChange = (ctx.weightChange !== null && ctx.weightChange !== undefined)
      ? (ctx.weightChange >= 0 ? `+${ctx.weightChange}` : String(ctx.weightChange)) + ' kg vs. medición anterior'
      : 'primera medición';
    const medidas = [
      data.waistCm && `cintura ${data.waistCm}cm`,
      data.armCm   && `brazo ${data.armCm}cm`,
    ].filter(Boolean).join(', ');
    prompt = `Eres FitBot, coach de fitness. Responde SIEMPRE en español. Máximo 3 frases con datos concretos.\n\nUsuario: ${name}, objetivo: ${goal}.\nPeso actual: ${data.weight || '?'}kg (${wChange}).${medidas ? ` Medidas: ${medidas}.` : ''}\n\nDa: (1) interpretación del cambio de peso, (2) consejo basado en medidas corporales, (3) hábito a mantener esta semana.`;

  } else {
    const wk   = ctx.weeklyWorkouts || 0;
    const tg   = ctx.targetWorkouts  || 4;
    const cum  = tg > 0 ? Math.round((wk / tg) * 100) : 0;
    const kcal = ctx.avgKcal ? `${ctx.avgKcal} kcal/día` : 'sin datos';
    const wCh  = (ctx.weightChange !== null && ctx.weightChange !== undefined)
      ? (ctx.weightChange >= 0 ? `+${ctx.weightChange}` : String(ctx.weightChange)) + ' kg'
      : 'sin cambio';
    prompt = `Eres FitBot, coach personal. Responde SIEMPRE en español. Máximo 4 frases. Tono positivo y honesto.\n\nCheck-in semanal de ${name}, objetivo: ${goal}.\nEntrenamientos: ${wk}/${tg} (${cum}%), nutrición: ${ctx.weeklyDietLogs || 0} días, ${kcal}, peso: ${wCh}.\n\nDa: (1) balance honesto de la semana, (2) qué salió bien, (3) ajuste concreto para la próxima semana, (4) objetivo SMART para los próximos 7 días.`;
    suggestionType = 'weekly.checkin';
  }

  res.json({ prompt, accountId, event, suggestionType, model: 'claude-haiku-4-5-20251001', max_tokens: 400 });
});

// ── POST /api/v1/n8n/callback ─────────────────────────────────────────────────
router.post('/callback', verifyN8nSecret, async (req, res) => {
  const { accountId, event, suggestion, suggestionType } = req.body;
  if (!accountId)  return res.status(400).json({ error: 'accountId es requerido' });
  if (!suggestion) return res.status(400).json({ error: 'suggestion es requerido' });

  try {
    const { rows: accs } = await pg.query('SELECT id, nombre FROM cuentas WHERE id = $1', [accountId]);
    if (!accs.length) return res.status(404).json({ error: 'Cuenta no encontrada' });

    const type = suggestionType || event || 'n8n_coaching';
    const { rows } = await pg.query(
      'INSERT INTO sugerencias_ia (cuenta_id, tipo_sugerencia, contenido) VALUES ($1,$2,$3) RETURNING id',
      [accountId, type, suggestion]
    );

    console.log(`[n8n] ✅ Sugerencia guardada — cuenta ${accountId} (${accs[0].nombre}) tipo="${type}" id=${rows[0].id}`);
    res.json({ ok: true, id: rows[0].id, accountId, type });
  } catch (err) {
    console.error('[n8n] callback error:', err.message);
    res.status(500).json({ error: 'Error guardando sugerencia' });
  }
});

// ── GET /api/v1/n8n/status ────────────────────────────────────────────────────
router.get('/status', async (req, res) => {
  const webhookUrl = process.env.N8N_WEBHOOK_URL || null;
  const safeUrl    = webhookUrl
    ? webhookUrl.replace(/(\/webhook\/)[^?]+/, '$1***')
    : null;

  try {
    const { rows } = await pg.query(
      `SELECT COUNT(*) AS c FROM sugerencias_ia
       WHERE tipo_sugerencia LIKE 'n8n%'
          OR tipo_sugerencia IN ('workout.logged','diet.logged','progress.updated','weekly.checkin')`
    );
    res.json({
      configured:       !!webhookUrl,
      webhook_url:      safeUrl,
      secret_set:       !!N8N_SECRET,
      n8n_suggestions:  parseInt(rows[0].c, 10),
      events_supported: ['workout.logged', 'diet.logged', 'progress.updated', 'weekly.checkin'],
    });
  } catch (err) {
    console.error('[n8n] status error:', err.message);
    res.status(500).json({ error: 'Error consultando estado' });
  }
});

// ── GET /api/v1/n8n/weekly-users ─────────────────────────────────────────────
router.get('/weekly-users', verifyN8nSecret, async (req, res) => {
  try {
    const { rows } = await pg.query(`
      SELECT DISTINCT
        a.id,
        a.nombre,
        a.objetivo,
        a.peso,
        a.altura_cm,
        a.edad,
        a.genero,
        a.nivel_actividad,
        a.restricciones,
        (SELECT COUNT(*) FROM registros_entrenamiento w WHERE w.cuenta_id = a.id AND w.fecha >= CURRENT_DATE - INTERVAL '7 days')  AS weekly_workouts,
        (SELECT COUNT(*) FROM registros_dieta         d WHERE d.cuenta_id = a.id AND d.fecha >= CURRENT_DATE - INTERVAL '7 days')  AS weekly_diet_logs,
        (SELECT AVG(total_kcal) FROM registros_dieta  d WHERE d.cuenta_id = a.id AND d.fecha >= CURRENT_DATE - INTERVAL '7 days' AND d.total_kcal IS NOT NULL) AS avg_kcal,
        (SELECT peso FROM registros_progreso          p WHERE p.cuenta_id = a.id ORDER BY fecha DESC LIMIT 1)          AS last_weight,
        (SELECT peso FROM registros_progreso          p WHERE p.cuenta_id = a.id ORDER BY fecha DESC OFFSET 1 LIMIT 1) AS prev_weight
      FROM cuentas a
      WHERE a.id IN (
        SELECT cuenta_id FROM registros_entrenamiento WHERE fecha >= CURRENT_DATE - INTERVAL '14 days'
        UNION
        SELECT cuenta_id FROM registros_dieta         WHERE fecha >= CURRENT_DATE - INTERVAL '14 days'
        UNION
        SELECT cuenta_id FROM registros_progreso      WHERE fecha >= CURRENT_DATE - INTERVAL '14 days'
      )
    `);

    const enriched = rows.map(u => ({
      accountId: u.id,
      user: {
        name: u.nombre, goal: u.objetivo, weight: u.peso,
        height: u.altura_cm, age: u.edad, gender: u.genero,
        activityLevel: u.nivel_actividad, restrictions: u.restricciones,
      },
      context: {
        weeklyWorkouts: parseInt(u.weekly_workouts, 10),
        weeklyDietLogs: parseInt(u.weekly_diet_logs, 10),
        targetWorkouts: 4,
        avgKcal:        u.avg_kcal ? Math.round(u.avg_kcal) : null,
        weightChange:   (u.last_weight && u.prev_weight)
          ? parseFloat((u.last_weight - u.prev_weight).toFixed(1))
          : null,
      },
      event: 'weekly.checkin',
    }));

    res.json({ users: enriched, count: enriched.length, week: new Date().toISOString().slice(0, 10) });
  } catch (err) {
    console.error('[n8n] weekly-users error:', err.message);
    res.status(500).json({ error: 'Error consultando usuarios semanales' });
  }
});

module.exports = router;
