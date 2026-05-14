'use strict';

const express         = require('express');
const router          = express.Router();
const pg              = require('../../db/postgres');
const { requireAuth } = require('./auth');
const asyncHandler    = require('../../utils/asyncHandler');

/**
 * @swagger
 * tags:
 *   name: Hábitos
 *   description: Seguimiento diario de agua y controles de hábitos
 *
 * /api/v1/habits/water:
 *   get:
 *     tags: [Hábitos]
 *     summary: Obtener consumo de agua del día
 *     parameters:
 *       - in: query
 *         name: date
 *         schema: { type: string, example: "2026-05-13" }
 *         description: Fecha (por defecto hoy)
 *     responses:
 *       200:
 *         description: Vasos consumidos
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 vasos: { type: number }
 *                 ml:    { type: number }
 *                 fecha: { type: string }
 *   put:
 *     tags: [Hábitos]
 *     summary: Registrar consumo de agua (upsert)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [vasos]
 *             properties:
 *               vasos: { type: number, example: 6 }
 *               ml:    { type: number, example: 1500 }
 *               date:  { type: string, example: "2026-05-13" }
 *     responses:
 *       200: { description: Registro guardado }
 *       400: { description: vasos inválido }
 *
 * /api/v1/habits/daily-check:
 *   get:
 *     tags: [Hábitos]
 *     summary: Obtener controles diarios del día
 *     parameters:
 *       - in: query
 *         name: date
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Objeto de controles { [hábito]: boolean }
 *   put:
 *     tags: [Hábitos]
 *     summary: Guardar controles diarios (upsert)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [checks]
 *             properties:
 *               checks:
 *                 type: object
 *                 additionalProperties: { type: boolean }
 *                 example: { agua: true, ejercicio: false }
 *               date: { type: string, example: "2026-05-13" }
 *     responses:
 *       200: { description: Controles guardados }
 *       400: { description: checks inválido }
 */

// ── Water intake ───────────────────────────────────────────────────────────────

/**
 * GET /api/v1/habits/water?date=YYYY-MM-DD
 * Returns water intake for the given day (defaults to today).
 */
router.get('/water', requireAuth, asyncHandler(async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const { rows } = await pg.query(
    'SELECT id, fecha, vasos, ml, creado_en FROM consumo_agua WHERE cuenta_id = $1 AND fecha = $2',
    [req.accountId, date]
  );
  res.json(rows[0] || { vasos: 0, ml: 0, fecha: date });
}));

/**
 * PUT /api/v1/habits/water
 * Upserts water intake for today (or the provided date).
 * Body: { vasos: number, ml?: number, date?: 'YYYY-MM-DD' }
 */
router.put('/water', requireAuth, asyncHandler(async (req, res) => {
  const { vasos, ml, date } = req.body;

  if (vasos == null || typeof vasos !== 'number' || vasos < 0) {
    return res.status(400).json({ error: 'vasos debe ser un número >= 0' });
  }

  const fecha  = date || new Date().toISOString().slice(0, 10);
  const mlVal  = (typeof ml === 'number' && ml >= 0) ? ml : Math.round(vasos * 250);

  const { rows } = await pg.query(
    `INSERT INTO consumo_agua (cuenta_id, fecha, vasos, ml)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (cuenta_id, fecha) DO UPDATE
       SET vasos = EXCLUDED.vasos,
           ml    = EXCLUDED.ml
     RETURNING id, fecha, vasos, ml`,
    [req.accountId, fecha, vasos, mlVal]
  );

  res.json(rows[0] || { fecha, vasos: Number(vasos), ml: mlVal });
}));

// ── Daily habit checks ──────────────────────────────────────────────────────────

/**
 * GET /api/v1/habits/daily-check?date=YYYY-MM-DD
 * Returns the habit checklist for the given day (defaults to today).
 */
router.get('/daily-check', requireAuth, asyncHandler(async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const { rows } = await pg.query(
    'SELECT id, fecha, controles_json, creado_en FROM controles_diarios WHERE cuenta_id = $1 AND fecha = $2',
    [req.accountId, date]
  );
  const row = rows[0];
  // Normalize: expose both `controles_json` (DB name) and `checks` (frontend name)
  res.json(row
    ? { ...row, checks: row.controles_json }
    : { controles_json: {}, checks: {}, fecha: date }
  );
}));

/**
 * PUT /api/v1/habits/daily-check
 * Upserts the habit checklist for today (or the provided date).
 * Body: { checks: { [habit]: boolean }, date?: 'YYYY-MM-DD' }
 */
router.put('/daily-check', requireAuth, asyncHandler(async (req, res) => {
  const { checks, date } = req.body;

  if (!checks || typeof checks !== 'object' || Array.isArray(checks)) {
    return res.status(400).json({ error: 'checks debe ser un objeto { [habit]: boolean }' });
  }

  // Only allow boolean values to prevent injection of arbitrary data
  for (const [k, v] of Object.entries(checks)) {
    if (typeof v !== 'boolean') {
      return res.status(400).json({ error: `checks.${k} debe ser boolean` });
    }
  }

  const fecha = date || new Date().toISOString().slice(0, 10);

  const { rows } = await pg.query(
    `INSERT INTO controles_diarios (cuenta_id, fecha, controles_json)
     VALUES ($1, $2, $3)
     ON CONFLICT (cuenta_id, fecha) DO UPDATE
       SET controles_json = EXCLUDED.controles_json
     RETURNING id, fecha, controles_json`,
    [req.accountId, fecha, JSON.stringify(checks)]
  );

  const row = rows[0];
  res.json(row
    ? { ...row, checks: row.controles_json }
    : { fecha, controles_json: checks, checks }
  );
}));

module.exports = router;
