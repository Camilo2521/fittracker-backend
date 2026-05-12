'use strict';

const express         = require('express');
const router          = express.Router();
const pg              = require('../../db/postgres');
const { requireAuth } = require('./auth');
const asyncHandler    = require('../../utils/asyncHandler');

const KEY_MAX_LENGTH   = 64;
const VALUE_MAX_LENGTH = 4096;

function validKey(key) {
  return typeof key === 'string' && key.length > 0 && key.length <= KEY_MAX_LENGTH && /^[\w.-]+$/.test(key);
}

/**
 * GET /api/v1/settings
 * Returns all settings for the authenticated user as { key: value } map.
 */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await pg.query(
    'SELECT clave, valor FROM configuracion WHERE cuenta_id = $1 ORDER BY clave',
    [req.accountId]
  );
  const settings = Object.fromEntries(rows.map(r => [r.clave, r.valor]));
  res.json(settings);
}));

/**
 * GET /api/v1/settings/:key
 * Returns a single setting value.
 */
router.get('/:key', requireAuth, asyncHandler(async (req, res) => {
  const { key } = req.params;
  if (!validKey(key)) return res.status(400).json({ error: 'Clave inválida' });

  const { rows } = await pg.query(
    'SELECT clave, valor FROM configuracion WHERE cuenta_id = $1 AND clave = $2',
    [req.accountId, key]
  );
  if (!rows.length) return res.status(404).json({ error: 'Configuración no encontrada' });
  res.json({ key: rows[0].clave, value: rows[0].valor });
}));

/**
 * PUT /api/v1/settings/:key
 * Upserts a single setting. Body: { value: string }
 */
router.put('/:key', requireAuth, asyncHandler(async (req, res) => {
  const { key } = req.params;
  if (!validKey(key)) return res.status(400).json({ error: 'Clave inválida' });

  const { value } = req.body;
  if (value == null) return res.status(400).json({ error: 'value es requerido' });
  if (typeof value !== 'string') return res.status(400).json({ error: 'value debe ser string' });
  if (value.length > VALUE_MAX_LENGTH) {
    return res.status(400).json({ error: `value no puede superar ${VALUE_MAX_LENGTH} caracteres` });
  }

  const { rows } = await pg.query(
    `INSERT INTO configuracion (cuenta_id, clave, valor)
     VALUES ($1, $2, $3)
     ON CONFLICT (cuenta_id, clave) DO UPDATE SET valor = EXCLUDED.valor
     RETURNING clave, valor`,
    [req.accountId, key, value]
  );
  res.json({ key: rows[0]?.clave || key, value: rows[0]?.valor ?? value });
}));

/**
 * DELETE /api/v1/settings/:key
 * Removes a single setting.
 */
router.delete('/:key', requireAuth, asyncHandler(async (req, res) => {
  const { key } = req.params;
  if (!validKey(key)) return res.status(400).json({ error: 'Clave inválida' });

  const { rowCount } = await pg.query(
    'DELETE FROM configuracion WHERE cuenta_id = $1 AND clave = $2',
    [req.accountId, key]
  );
  if (!rowCount) return res.status(404).json({ error: 'Configuración no encontrada' });
  res.status(204).send();
}));

module.exports = router;
