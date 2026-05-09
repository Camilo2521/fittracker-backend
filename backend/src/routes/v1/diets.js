'use strict';

const express   = require('express');
const router    = express.Router();
const { FLAGS } = require('../../middleware/featureFlags');
const vision    = require('../../services/visionClient');
const pg        = require('../../db/postgres');
const { generateInternalToken } = require('../../utils/internalToken');
const { validateDate, validateId, validateString, validateEnum, abort } = require('../../utils/validate');
const { VALID_GOALS } = require('../../utils/constants');

const PYTHON_BASE = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

/**
 * @swagger
 * tags:
 *   name: Dietas
 *   description: Planes de alimentación semanales
 *
 * /api/v1/diets/generate:
 *   post:
 *     tags: [Dietas]
 *     summary: Generar plan de dieta semanal
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId, weekStart]
 *             properties:
 *               userId:    { type: string, example: "1" }
 *               weekStart: { type: string, example: "2026-05-05" }
 *               goal:      { type: string, enum: [lose, gain, maintain] }
 *     responses:
 *       200: { description: Plan de dieta semanal con calorías por comida }
 */
router.post('/generate', async (req, res) => {
  const { userId, weekStart } = req.body;
  if (!userId || !weekStart) {
    return res.status(400).json({ error: 'userId y weekStart son requeridos' });
  }
  if (abort(res, [
    validateId(userId, 'userId'),
    validateDate(weekStart, 'weekStart'),
    validateEnum(req.body.goal, 'goal', VALID_GOALS),
  ])) return;

  const { rows } = await pg.query('SELECT * FROM accounts WHERE id = $1', [userId]);
  const user = rows[0];

  if (FLAGS.rag_enabled && user) {
    const result = await vision.generateDiet({
      external_id:    userId,
      goal:           user.goal,
      current_weight: user.weight,
      target_weight:  user.target_weight,
      height_cm:      user.height_cm,
      age:            user.age,
      gender:         user.gender,
      activity_level: user.activity_level || 'moderate',
      restrictions:   user.restrictions || null,
    }, weekStart);
    if (result.ok) return res.json(result.data);
  }

  const goal = user?.goal || req.body.goal || 'maintain';
  return res.json(_localDiet(goal, weekStart));
});

/**
 * GET /api/v1/diets/:userId/current
 */
router.get('/:userId/current', async (req, res) => {
  const weekStart = _currentWeekStart();
  try {
    const result = await pg.query(`SELECT dp.*, json_agg(
         json_build_object(
           'day_of_week', dd.day_of_week,
           'total_calories', dd.total_calories,
           'meals', (SELECT json_agg(dm.*) FROM diet_meals dm WHERE dm.day_id = dd.id)
         ) ORDER BY dd.day_of_week
       ) AS days
       FROM diet_plans dp
       JOIN diet_days dd ON dd.plan_id = dp.id
       WHERE dp.account_id = $1 AND dp.week_start = $2
       GROUP BY dp.id`,
      [req.params.userId, weekStart]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'No hay plan de dieta para esta semana' });
    res.json(result.rows[0]);
  } catch (e) {
    if (e?.code === '42P01') return res.status(404).json({ error: 'Feature no disponible aún' });
    console.error('[diets] GET current error:', e.message);
    res.status(503).json({ error: 'Servicio de dietas no disponible' });
  }
});

/**
 * PUT /api/v1/diets/meals/:mealId
 */
router.put('/meals/:mealId', async (req, res) => {
  const { name, calories, protein, carbs, fat, protein_g, carbs_g, fat_g } = req.body;
  const prot = protein ?? protein_g;
  const carb = carbs   ?? carbs_g;
  const fatV = fat     ?? fat_g;
  try {
    await pg.query(
      `UPDATE diet_meals
       SET name            = COALESCE($1, name),
           calories        = COALESCE($2, calories),
           protein_g       = COALESCE($3, protein_g),
           carbs_g         = COALESCE($4, carbs_g),
           fat_g           = COALESCE($5, fat_g),
           manual_override = TRUE
       WHERE id = $6`,
      [name || null, calories || null, prot || null, carb || null, fatV || null, req.params.mealId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[diets] PUT /meals error:', err.message);
    res.status(500).json({ error: 'Error actualizando comida' });
  }
});

/**
 * POST /api/v1/diets/documents
 */
router.post('/documents', async (req, res) => {
  const { title, content, type = 'nutrition' } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'title y content son requeridos' });
  if (abort(res, [
    validateString(title,   'title',   { maxLength: 200 }),
    validateString(content, 'content', { maxLength: 50000 }),
  ])) return;
  try {
    const { rows } = await pg.query(
      'INSERT INTO nutrition_documents (title, content, type) VALUES ($1,$2,$3) RETURNING id',
      [title, content, type]
    );
    fetch(`${PYTHON_BASE}/rag/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-token': generateInternalToken() },
      body: JSON.stringify({ title, content, doc_type: type }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
    res.status(201).json({ success: true, id: rows[0].id });
  } catch (err) {
    console.error('[diets] POST /documents error:', err.message);
    res.status(500).json({ error: 'Error guardando documento' });
  }
});

// ── Local diet generator ──────────────────────────────────────────────────────

function _localDiet(goal, weekStart) {
  const targets = { lose: 1800, gain: 2600, maintain: 2100 };
  const kcal    = targets[goal] || 2100;

  const mealTemplates = {
    lose: [
      { name: 'Desayuno',  kcal: Math.round(kcal * 0.20), desc: 'Avena con frutos rojos + café sin azúcar' },
      { name: 'Almuerzo',  kcal: Math.round(kcal * 0.35), desc: 'Pechuga a la plancha + ensalada verde + arroz integral (60 g)' },
      { name: 'Merienda',  kcal: Math.round(kcal * 0.10), desc: 'Yogur griego 0% + manzana' },
      { name: 'Cena',      kcal: Math.round(kcal * 0.30), desc: 'Salmón al horno + brócoli al vapor + batata (100 g)' },
      { name: 'Extra',     kcal: Math.round(kcal * 0.05), desc: 'Frutos secos (20 g)' },
    ],
    gain: [
      { name: 'Desayuno',     kcal: Math.round(kcal * 0.25), desc: 'Tortilla 3 huevos + tostadas integrales + zumo natural' },
      { name: 'Media mañana', kcal: Math.round(kcal * 0.10), desc: 'Batido proteico + plátano' },
      { name: 'Almuerzo',     kcal: Math.round(kcal * 0.30), desc: 'Arroz integral (150 g) + pollo 200 g + verduras salteadas' },
      { name: 'Merienda',     kcal: Math.round(kcal * 0.10), desc: 'Requesón + nueces + miel' },
      { name: 'Cena',         kcal: Math.round(kcal * 0.25), desc: 'Pasta (120 g) + ternera magra + tomate natural' },
    ],
    maintain: [
      { name: 'Desayuno',  kcal: Math.round(kcal * 0.22), desc: 'Tostadas integrales + aguacate + 2 huevos revueltos' },
      { name: 'Almuerzo',  kcal: Math.round(kcal * 0.35), desc: 'Legumbres (garbanzos/lentejas) + ensalada + pan integral' },
      { name: 'Merienda',  kcal: Math.round(kcal * 0.10), desc: 'Fruta de temporada + puñado de almendras' },
      { name: 'Cena',      kcal: Math.round(kcal * 0.28), desc: 'Pescado blanco + arroz basmati + ensalada variada' },
      { name: 'Extra',     kcal: Math.round(kcal * 0.05), desc: 'Infusión + cuadrado de chocolate negro 85%' },
    ],
  };

  const meals = mealTemplates[goal] || mealTemplates.maintain;
  const days  = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];

  return {
    source: 'local', weekStart, goal, dailyCalorieTarget: kcal,
    days: days.map(day => ({
      day,
      totalCalories: kcal,
      meals: meals.map(m => ({ name: m.name, calories: m.kcal, description: m.desc })),
    })),
    notes: 'Plan generado localmente. Activa el servicio RAG para planes personalizados con IA.',
  };
}

function _currentWeekStart() {
  const d   = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff)).toISOString().split('T')[0];
}

module.exports = router;
