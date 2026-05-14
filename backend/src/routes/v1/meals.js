'use strict';

const express         = require('express');
const router          = express.Router();
const pg              = require('../../db/postgres');
const { requireAuth } = require('./auth');
const asyncHandler    = require('../../utils/asyncHandler');

/**
 * @swagger
 * tags:
 *   name: Comidas
 *   description: Comidas detectadas por IA o entrada manual
 *
 * /api/v1/meals:
 *   post:
 *     tags: [Comidas]
 *     summary: Guardar comida detectada
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, calories]
 *             properties:
 *               name:       { type: string,  example: "Arroz con pollo" }
 *               calories:   { type: number,  example: 450 }
 *               protein:    { type: number,  example: 32 }
 *               carbs:      { type: number,  example: 48 }
 *               fat:        { type: number,  example: 10 }
 *               confidence: { type: number,  example: 0.91 }
 *               detectedBy: { type: string,  example: "ia" }
 *               date:       { type: string,  example: "2026-05-13" }
 *     responses:
 *       201: { description: Comida guardada }
 *       400: { description: name o calories inválidos }
 *   get:
 *     tags: [Comidas]
 *     summary: Obtener comidas del día con totales
 *     parameters:
 *       - in: query
 *         name: date
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *     responses:
 *       200:
 *         description: Lista de comidas + totales calóricos
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:   { type: array }
 *                 date:   { type: string }
 *                 totals:
 *                   type: object
 *                   properties:
 *                     calories: { type: number }
 *                     protein:  { type: number }
 *                     carbs:    { type: number }
 *                     fat:      { type: number }
 */

/**
 * POST /api/v1/meals
 * Guarda una comida detectada (por IA o entrada manual).
 * Body: { name, date?, calories, protein?, carbs?, fat?, confidence?, detectedBy? }
 */
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const { name, date, calories, protein, carbs, fat, confidence, detectedBy } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name es requerido' });
  }
  if (calories == null || isNaN(Number(calories)) || Number(calories) < 0) {
    return res.status(400).json({ error: 'calories debe ser un número >= 0' });
  }

  const fecha = date || new Date().toISOString().slice(0, 10);

  const { rows } = await pg.query(
    `INSERT INTO comidas_detectadas
       (cuenta_id, fecha, nombre, calorias, proteinas, carbohidratos, grasas, detectado_por, confianza)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, fecha, nombre, calorias, proteinas, carbohidratos, grasas, detectado_por, confianza`,
    [
      req.accountId,
      fecha,
      name.trim(),
      Number(calories)           || 0,
      Number(protein)            || 0,
      Number(carbs)              || 0,
      Number(fat)                || 0,
      detectedBy || 'ia',
      confidence != null ? Number(confidence) : null,
    ]
  );

  res.status(201).json(rows[0] || { fecha, nombre: name.trim(), calorias: Number(calories) || 0 });
}));

/**
 * GET /api/v1/meals?date=YYYY-MM-DD
 * Devuelve las comidas detectadas del usuario en una fecha (por defecto hoy).
 */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const date  = req.query.date || new Date().toISOString().slice(0, 10);
  const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10), 1), 200);

  const { rows } = await pg.query(
    `SELECT id, fecha, nombre, calorias, proteinas, carbohidratos, grasas, detectado_por, confianza, creado_en
     FROM comidas_detectadas
     WHERE cuenta_id = $1 AND fecha = $2
     ORDER BY creado_en DESC
     LIMIT $3`,
    [req.accountId, date, limit]
  );

  const totals = rows.reduce(
    (acc, r) => ({
      calories: acc.calories + (r.calorias   || 0),
      protein:  acc.protein  + (r.proteinas  || 0),
      carbs:    acc.carbs    + (r.carbohidratos || 0),
      fat:      acc.fat      + (r.grasas     || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  res.json({ data: rows, date, totals });
}));

module.exports = router;
