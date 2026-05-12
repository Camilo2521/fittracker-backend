'use strict';

const express         = require('express');
const router          = express.Router();
const { FLAGS }       = require('../../middleware/featureFlags');
const vision          = require('../../services/visionClient');
const pg              = require('../../db/postgres');
const { requireAuth } = require('./auth');
const asyncHandler    = require('../../utils/asyncHandler');
const { validateEnum, abort } = require('../../utils/validate');
const { VALID_GOALS } = require('../../utils/constants');

/**
 * @swagger
 * tags:
 *   name: Rutinas
 *   description: Generación de rutinas de entrenamiento
 *
 * /api/v1/routines/generate:
 *   post:
 *     tags: [Rutinas]
 *     summary: Generar rutina de entrenamiento personalizada
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               goal:   { type: string, enum: [lose, gain, maintain] }
 *     responses:
 *       200: { description: Plan de rutina semanal }
 */
router.post('/generate', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await pg.query('SELECT * FROM cuentas WHERE id = $1', [req.accountId]);
  const user = rows[0];

  if (FLAGS.rag_enabled && user) {
    const result = await vision.generateRoutine({
      external_id:    req.accountId,
      goal:           user.objetivo,
      current_weight: user.peso,
      height_cm:      user.altura_cm,
      age:            user.edad,
      activity_level: user.nivel_actividad || 'moderate',
    });
    if (result.ok) return res.json(result.data);
  }

  // req.body.goal takes precedence; unknown goals fall back to 'maintain' in the generator
  const goal = req.body.goal || user?.objetivo || 'maintain';
  return res.json(_localRoutine(goal));
}));

/**
 * GET /api/v1/routines/active
 */
router.get('/active', requireAuth, asyncHandler(async (req, res) => {
  let result;
  try {
    result = await pg.query(
      `SELECT r.*, json_agg(
         json_build_object(
           'indice_dia', rd.indice_dia,
           'enfoque', rd.enfoque,
           'ejercicios', (
             SELECT json_agg(re.* ORDER BY re.orden)
             FROM ejercicios_rutina re WHERE re.dia_id = rd.id
           )
         ) ORDER BY rd.indice_dia
       ) AS dias
       FROM rutinas r
       JOIN dias_rutina rd ON rd.rutina_id = r.id
       WHERE r.cuenta_id = $1 AND r.activo = TRUE
       GROUP BY r.id
       LIMIT 1`,
      [req.accountId]
    );
  } catch (e) {
    if (e?.code === '42P01') return res.status(404).json({ error: 'Feature no disponible aún' });
    return res.status(503).json({ error: 'Servicio de rutinas no disponible' });
  }
  if (!result.rows.length) return res.status(404).json({ error: 'No hay rutina activa' });
  res.json(result.rows[0]);
}));

// ── Local routine generator ───────────────────────────────────────────────────

function _localRoutine(goal) {
  const plans = {
    lose: {
      name: 'Plan pérdida de peso — 4 días/semana',
      source: 'local', weeklyDays: 4,
      days: [
        { day: 'Lunes',   focus: 'Cardio + Core',        exercises: ['Caminata rápida 30 min', 'Planchas 3×30 s', 'Abdominales 3×20', 'Mountain climbers 3×15'] },
        { day: 'Martes',  focus: 'Fuerza tren superior',  exercises: ['Flexiones 3×12', 'Remo invertido 3×12', 'Press hombros 3×12', 'Curl bíceps 3×15'] },
        { day: 'Jueves',  focus: 'HIIT',                  exercises: ['Burpees 4×10', 'Jumping jacks 4×30 s', 'Sentadillas con salto 4×15', 'Sprint en sitio 4×30 s'] },
        { day: 'Viernes', focus: 'Fuerza tren inferior',  exercises: ['Sentadillas 3×15', 'Zancadas 3×12/lado', 'Puente de glúteos 3×20', 'Elevaciones de talones 3×20'] },
      ],
      notes: 'Descanso activo (caminar) los días libres. Hidratación: mínimo 2 L/día.',
    },
    gain: {
      name: 'Plan ganancia muscular — 5 días/semana',
      source: 'local', weeklyDays: 5,
      days: [
        { day: 'Lunes',     focus: 'Pecho + Tríceps',   exercises: ['Flexiones 4×15', 'Flexiones diamante 3×12', 'Dips en silla 3×12', 'Extensión tríceps 3×15'] },
        { day: 'Martes',    focus: 'Espalda + Bíceps',  exercises: ['Remo con mancuerna 4×12', 'Pull-ups asistidas 3×8', 'Curl bíceps 4×12', 'Curl martillo 3×12'] },
        { day: 'Miércoles', focus: 'Piernas',           exercises: ['Sentadillas 4×15', 'Zancadas 4×12', 'Peso muerto rumano 3×12', 'Elevación de talones 3×20'] },
        { day: 'Jueves',    focus: 'Hombros + Core',    exercises: ['Press hombros 4×12', 'Elevaciones laterales 3×15', 'Planchas 3×45 s', 'Abdominales 4×20'] },
        { day: 'Viernes',   focus: 'Full body potencia', exercises: ['Sentadillas con salto 4×10', 'Flexiones explosivas 3×8', 'Burpees 3×10', 'Remo explosivo 4×10'] },
      ],
      notes: 'Superávit calórico de 300 kcal. Proteína: 1.8 g/kg de peso corporal.',
    },
    maintain: {
      name: 'Plan mantenimiento — 3 días/semana',
      source: 'local', weeklyDays: 3,
      days: [
        { day: 'Lunes',     focus: 'Full body A',        exercises: ['Sentadillas 3×12', 'Flexiones 3×12', 'Remo 3×12', 'Plancha 2×30 s'] },
        { day: 'Miércoles', focus: 'Cardio + Movilidad', exercises: ['Cardio moderado 25 min', 'Estiramientos dinámicos 10 min', 'Yoga flujo 15 min'] },
        { day: 'Viernes',   focus: 'Full body B',        exercises: ['Zancadas 3×12', 'Dips 3×10', 'Press hombros 3×12', 'Core circuit 2 rondas'] },
      ],
      notes: 'Mantén la constancia. Añade 5 min de movilidad articular al despertar.',
    },
  };
  return plans[goal] || plans.maintain;
}

module.exports = router;
