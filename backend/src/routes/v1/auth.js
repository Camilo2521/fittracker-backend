'use strict';

const express      = require('express');
const router       = express.Router();
const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');
const crypto       = require('crypto');
const pg           = require('../../db/postgres');
const n8n          = require('../../services/n8nWebhookService');
const email        = require('../../services/emailService');
const asyncHandler = require('../../utils/asyncHandler');
const { authLimiter }                               = require('../../middleware/rateLimiter');
const { validateDate, validateNumber, abort }       = require('../../utils/validate');
const { VALID_GOALS, VALID_GENDERS, VALID_ACTIVITY_LEVELS } = require('../../utils/constants');

const JWT_SECRET           = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('[auth] JWT_SECRET no está configurado. Añade JWT_SECRET a backend/.env');
const JWT_ACCESS_EXPIRES   = process.env.JWT_ACCESS_EXPIRES || process.env.JWT_EXPIRES || '15m';
const REFRESH_EXPIRES_DAYS = parseInt(process.env.JWT_REFRESH_DAYS || '30', 10);

function _sign(account) {
  return jwt.sign(
    { id: account.id, email: account.correo ?? account.email, name: account.nombre ?? account.name },
    JWT_SECRET,
    { expiresIn: JWT_ACCESS_EXPIRES }
  );
}

function _safeUser(acc) {
  return {
    id:                   acc.id,
    name:                 acc.nombre,
    email:                acc.correo,
    goal:                 acc.objetivo,
    weight:               acc.peso,
    height_cm:            acc.altura_cm,
    age:                  acc.edad,
    gender:               acc.genero,
    activity_level:       acc.nivel_actividad,
    activityLevel:        acc.nivel_actividad,
    restrictions:         acc.restricciones,
    target_weight:        acc.peso_meta,
    start_weight:         acc.peso_inicio,
    completed_onboarding: acc.onboarding_completado,
    created_at:           acc.creado_en,
    updated_at:           acc.actualizado_en,
  };
}

function _hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function _parsePage(query, defaultLimit, maxLimit = 100) {
  const limit  = Math.min(Math.max(parseInt(query.limit  || defaultLimit, 10), 1), maxLimit);
  const offset = Math.max(parseInt(query.offset || '0', 10), 0);
  return { limit, offset };
}

async function _issueTokens(account, req) {
  const accessToken  = _sign(account);
  const raw          = crypto.randomBytes(64).toString('hex');
  const tokenHash    = _hashToken(raw);
  const expiresAt    = new Date(Date.now() + REFRESH_EXPIRES_DAYS * 86_400_000);

  await pg.query(
    `INSERT INTO tokens_refresco (cuenta_id, hash_token, expira_en, agente_usuario, ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [account.id, tokenHash, expiresAt, req.headers['user-agent'] || null, req.ip || null]
  );

  return { accessToken, refreshToken: raw };
}

/**
 * @swagger
 * tags:
 *   - name: Auth
 *     description: Registro, login y perfil de usuario
 *   - name: Logs
 *     description: Registro de entrenamientos, dietas y progreso
 */

/**
 * @swagger
 * /api/v1/auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Registrar nuevo usuario
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:         { type: string, example: usuario@email.com }
 *               password:      { type: string, example: "123456" }
 *               name:          { type: string, example: Camilo }
 *               goal:          { type: string, enum: [lose, gain, maintain] }
 *               weight:        { type: number, example: 75 }
 *               height:        { type: number, example: 175 }
 *               age:           { type: integer, example: 28 }
 *               gender:        { type: string, enum: [male, female, other] }
 *               activityLevel: { type: string, enum: [sedentary, light, moderate, active, very_active] }
 *     responses:
 *       201: { description: Usuario creado, token JWT }
 *       409: { description: Email ya registrado }
 */
router.post('/register', authLimiter, asyncHandler(async (req, res) => {
  const {
    email, password, name = '',
    goal = 'maintain', weight, height, age, gender,
    activityLevel = 'moderate', restrictions = '',
  } = req.body;

  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });
  if (password.length < 8)  return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Email inválido' });
  if (weight       !== undefined && abort(res, [validateNumber(weight,  'weight',  { min: 30, max: 500 })])) return;
  if (height       !== undefined && abort(res, [validateNumber(height,  'height',  { min: 50, max: 280 })])) return;
  if (age          !== undefined && abort(res, [validateNumber(age,     'age',     { min: 5,  max: 120 })])) return;
  if (restrictions && restrictions.length > 500) return res.status(400).json({ error: 'restrictions no puede superar 500 caracteres' });
  if (name         && name.length         >  100) return res.status(400).json({ error: 'name no puede superar 100 caracteres' });

  const exists = await pg.query('SELECT id FROM cuentas WHERE correo = $1', [email.trim()]);
  if (exists.rows.length) return res.status(409).json({ error: 'Este email ya está registrado' });

  const hash = await bcrypt.hash(password, 10);
  // El onboarding se considera completo solo si se tienen todos los datos físicos
  // necesarios para calcular BMR/TDEE (peso, altura, edad, género y objetivo).
  const onboardingCompleto = !!(weight && height && age && gender && goal);

  const { rows } = await pg.query(
    `INSERT INTO cuentas
       (correo, hash_contrasena, nombre, objetivo, peso, altura_cm, edad, genero, nivel_actividad, restricciones, onboarding_completado)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      email.trim(), hash, name.trim(),
      goal, weight || null, height || null, age || null, gender || null,
      activityLevel, restrictions,
      onboardingCompleto,
    ]
  );
  const { accessToken, refreshToken } = await _issueTokens(rows[0], req);
  res.status(201).json({ accessToken, refreshToken, user: _safeUser(rows[0]) });
}));

/**
 * @swagger
 * /api/v1/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Iniciar sesión
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:    { type: string, example: usuario@email.com }
 *               password: { type: string, example: "123456" }
 *     responses:
 *       200: { description: Token JWT + datos de usuario }
 *       401: { description: Credenciales incorrectas }
 */
router.post('/login', authLimiter, asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });

  const { rows } = await pg.query('SELECT * FROM cuentas WHERE correo = $1', [email.trim()]);
  const account  = rows[0];
  if (!account) return res.status(401).json({ error: 'Email o contraseña incorrectos' });

  const ok = await bcrypt.compare(password, account.hash_contrasena);
  if (!ok)  return res.status(401).json({ error: 'Email o contraseña incorrectos' });

  const { accessToken, refreshToken } = await _issueTokens(account, req);
  res.json({ accessToken, refreshToken, user: _safeUser(account) });
}));

/**
 * @swagger
 * /api/v1/auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Obtener perfil del usuario autenticado
 *     responses:
 *       200: { description: Datos del usuario }
 *       401: { description: Token requerido }
 */
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await pg.query('SELECT * FROM cuentas WHERE id = $1', [req.accountId]);
  if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json(_safeUser(rows[0]));
}));

/**
 * @swagger
 * /api/v1/auth/profile:
 *   put:
 *     tags: [Auth]
 *     summary: Actualizar perfil del usuario
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:          { type: string }
 *               goal:          { type: string, enum: [lose, gain, maintain] }
 *               weight:        { type: number }
 *               height:        { type: number }
 *               age:           { type: integer }
 *               gender:        { type: string }
 *               activityLevel: { type: string }
 *               restrictions:  { type: string }
 *     responses:
 *       200: { description: Perfil actualizado }
 */
router.put('/profile', requireAuth, asyncHandler(async (req, res) => {
  const {
    name, goal, weight, height, age, gender, activityLevel, restrictions,
    target_weight,             // from syncGoal / syncUserProfile
    height_cm,                 // alias used by some callers
    heightCm,                  // camelCase alias sent by frontend
  } = req.body;
  const heightVal = height || height_cm || heightCm || null;

  // Read current row first so COALESCE can decide the final values
  const { rows: current } = await pg.query(
    'SELECT objetivo, peso, altura_cm, edad, genero FROM cuentas WHERE id = $1',
    [req.accountId]
  );
  if (!current.length) return res.status(404).json({ error: 'Usuario no encontrado' });

  const cur = current[0];
  const finalGoal   = goal        || cur.objetivo;
  const finalWeight = weight      || cur.peso;
  const finalHeight = heightVal   || cur.altura_cm;
  const finalAge    = age         || cur.edad;
  const finalGender = gender      || cur.genero;
  // Onboarding complete only when all fields required for BMR/TDEE are present
  const onboardingCompleto = !!(finalGoal && finalWeight && finalHeight && finalAge && finalGender);

  const { rows } = await pg.query(
    `UPDATE cuentas SET
       nombre               = COALESCE($1,  nombre),
       objetivo             = COALESCE($2,  objetivo),
       peso                 = COALESCE($3,  peso),
       altura_cm            = COALESCE($4,  altura_cm),
       edad                 = COALESCE($5,  edad),
       genero               = COALESCE($6,  genero),
       nivel_actividad      = COALESCE($7,  nivel_actividad),
       restricciones        = COALESCE($8,  restricciones),
       peso_meta            = COALESCE($9,  peso_meta),
       onboarding_completado = $11
     WHERE id = $10
     RETURNING *`,
    [
      name || null, goal || null, weight || null, heightVal || null,
      age || null, gender || null, activityLevel || null, restrictions || null,
      target_weight || null,
      req.accountId,
      onboardingCompleto,
    ]
  );
  if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json(_safeUser(rows[0]));
}));

// ── GET /api/v1/auth/chat-history ────────────────────────────────────────────
router.get('/chat-history', requireAuth, asyncHandler(async (req, res) => {
  const { limit, offset } = _parsePage(req.query, 40);
  const [data, count] = await Promise.all([
    pg.query(
      'SELECT rol, contenido, creado_en FROM historial_chat WHERE cuenta_id = $1 ORDER BY creado_en ASC LIMIT $2 OFFSET $3',
      [req.accountId, limit, offset]
    ),
    pg.query('SELECT COUNT(*)::int AS total FROM historial_chat WHERE cuenta_id = $1', [req.accountId]),
  ]);
  res.json({ data: data.rows, total: count.rows[0].total, limit, offset });
}));

// ── POST /api/v1/auth/chat-history ───────────────────────────────────────────
router.post('/chat-history', requireAuth, asyncHandler(async (req, res) => {
  const { messages = [] } = req.body;
  const valid = messages.filter(m => m.role && m.content);
  if (!valid.length) return res.json({ saved: 0 });

  // Batch INSERT: una sola query para todos los mensajes
  const values  = [];
  const params  = [];
  valid.forEach((m, i) => {
    const base = i * 3;
    values.push(`($${base + 1}, $${base + 2}, $${base + 3})`);
    params.push(req.accountId, m.role, m.content);
  });

  const client = await pg.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO historial_chat (cuenta_id, rol, contenido) VALUES ${values.join(',')}
       ON CONFLICT DO NOTHING`,
      params
    );
    await client.query('COMMIT');
    res.json({ saved: valid.length });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}));

// ── POST /api/v1/auth/workout-log ─────────────────────────────────────────────
router.post('/workout-log', requireAuth, asyncHandler(async (req, res) => {
  const { date, routineName, exercises = [], durationMin, notes } = req.body;
  if (routineName && routineName.length > 200) return res.status(400).json({ error: 'routineName no puede superar 200 caracteres' });
  if (notes       && notes.length       > 1000) return res.status(400).json({ error: 'notes no puede superar 1000 caracteres' });
  if (!Array.isArray(exercises)) return res.status(400).json({ error: 'exercises debe ser un array' });
  if (exercises.length > 100) return res.status(400).json({ error: 'exercises no puede superar 100 elementos' });
  const logDate = date || new Date().toISOString().slice(0, 10);

  const { rows } = await pg.query(
    `INSERT INTO registros_entrenamiento (cuenta_id, fecha, nombre_rutina, ejercicios_json, duracion_min, notas)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [req.accountId, logDate, routineName || null, JSON.stringify(exercises), durationMin || null, notes || null]
  );

  // Fire-and-forget evento n8n
  n8n.buildUserContext(req.accountId).then(ctx => {
    if (ctx) n8n.emit('workout.logged', {
      accountId: req.accountId, ...ctx,
      data: { routineName: routineName || null, exercises, durationMin: durationMin || null, date: logDate, notes: notes || null },
    });
  }).catch(() => {});

  res.json({ id: rows[0].id });
}));

// ── GET /api/v1/auth/workout-logs ─────────────────────────────────────────────
router.get('/workout-logs', requireAuth, asyncHandler(async (req, res) => {
  const { limit, offset } = _parsePage(req.query, 20);
  const { from, to } = req.query; // filtros opcionales YYYY-MM-DD

  const conditions  = ['cuenta_id = $1'];
  const whereParams = [req.accountId];
  if (from) { conditions.push(`fecha >= $${whereParams.push(from)}`); }
  if (to)   { conditions.push(`fecha <= $${whereParams.push(to)}`);   }
  const where = conditions.join(' AND ');

  const pageIdx  = whereParams.length;
  const dataParams = [...whereParams, limit, offset];

  const [data, count] = await Promise.all([
    pg.query(
      `SELECT * FROM registros_entrenamiento WHERE ${where} ORDER BY fecha DESC LIMIT $${pageIdx + 1} OFFSET $${pageIdx + 2}`,
      dataParams
    ),
    pg.query(`SELECT COUNT(*)::int AS total FROM registros_entrenamiento WHERE ${where}`, whereParams),
  ]);
  res.json({ data: data.rows, total: count.rows[0].total, limit, offset });
}));

// ── POST /api/v1/auth/diet-log ────────────────────────────────────────────────
router.post('/diet-log', requireAuth, asyncHandler(async (req, res) => {
  const { date, planName, meals = [], totalKcal, notes } = req.body;
  if (!Array.isArray(meals)) return res.status(400).json({ error: 'meals debe ser un array' });
  if (meals.length > 100) return res.status(400).json({ error: 'meals no puede superar 100 elementos' });
  const logDate = date || new Date().toISOString().slice(0, 10);

  const { rows } = await pg.query(
    `INSERT INTO registros_dieta (cuenta_id, fecha, nombre_plan, comidas_json, total_kcal, notas)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [req.accountId, logDate, planName || null, JSON.stringify(meals), totalKcal || null, notes || null]
  );

  n8n.buildUserContext(req.accountId).then(ctx => {
    if (ctx) n8n.emit('diet.logged', {
      accountId: req.accountId, ...ctx,
      data: { planName: planName || null, meals, totalKcal: totalKcal || null, date: logDate, notes: notes || null },
    });
  }).catch(() => {});

  res.json({ id: rows[0].id });
}));

// ── GET /api/v1/auth/diet-logs ────────────────────────────────────────────────
router.get('/diet-logs', requireAuth, asyncHandler(async (req, res) => {
  const { limit, offset } = _parsePage(req.query, 20);
  const [data, count] = await Promise.all([
    pg.query(
      'SELECT * FROM registros_dieta WHERE cuenta_id = $1 ORDER BY fecha DESC LIMIT $2 OFFSET $3',
      [req.accountId, limit, offset]
    ),
    pg.query('SELECT COUNT(*)::int AS total FROM registros_dieta WHERE cuenta_id = $1', [req.accountId]),
  ]);
  res.json({ data: data.rows, total: count.rows[0].total, limit, offset });
}));

// ── POST /api/v1/auth/progress-log ───────────────────────────────────────────
router.post('/progress-log', requireAuth, asyncHandler(async (req, res) => {
  const { date, weight, bodyFat, chestCm, waistCm, hipCm, armCm, notes } = req.body;
  const logDate = date || new Date().toISOString().slice(0, 10);

  const { rows } = await pg.query(
    `INSERT INTO registros_progreso (cuenta_id, fecha, peso, grasa_corporal, pecho_cm, cintura_cm, cadera_cm, brazo_cm, notas)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [req.accountId, logDate, weight || null, bodyFat || null, chestCm || null, waistCm || null, hipCm || null, armCm || null, notes || null]
  );

  if (weight) {
    await pg.query('UPDATE cuentas SET peso = $1 WHERE id = $2', [weight, req.accountId]);
  }

  n8n.buildUserContext(req.accountId).then(ctx => {
    if (ctx) n8n.emit('progress.updated', {
      accountId: req.accountId, ...ctx,
      data: { weight: weight || null, bodyFat: bodyFat || null, chestCm: chestCm || null, waistCm: waistCm || null, hipCm: hipCm || null, armCm: armCm || null, date: logDate },
    });
  }).catch(() => {});

  res.json({ id: rows[0].id });
}));

// ── GET /api/v1/auth/progress-logs ───────────────────────────────────────────
router.get('/progress-logs', requireAuth, asyncHandler(async (req, res) => {
  const { limit, offset } = _parsePage(req.query, 30);
  const [data, count] = await Promise.all([
    pg.query(
      'SELECT * FROM registros_progreso WHERE cuenta_id = $1 ORDER BY fecha DESC LIMIT $2 OFFSET $3',
      [req.accountId, limit, offset]
    ),
    pg.query('SELECT COUNT(*)::int AS total FROM registros_progreso WHERE cuenta_id = $1', [req.accountId]),
  ]);
  res.json({ data: data.rows, total: count.rows[0].total, limit, offset });
}));

// ── GET /api/v1/auth/export/csv ──────────────────────────────────────────────
// ?type=workouts (default) | progress | diets
router.get('/export/csv', requireAuth, asyncHandler(async (req, res) => {
  const type = req.query.type || 'workouts';

  const VALID_TYPES = new Set(['workouts', 'progress', 'diets']);
  if (!VALID_TYPES.has(type)) {
    return res.status(400).json({ error: `type debe ser uno de: ${[...VALID_TYPES].join(', ')}` });
  }

  let rows, headers, mapper;

  if (type === 'progress') {
    const { rows: r } = await pg.query(
      `SELECT fecha, peso, grasa_corporal, pecho_cm, cintura_cm, cadera_cm, brazo_cm, notas
       FROM registros_progreso WHERE cuenta_id = $1 ORDER BY fecha DESC`,
      [req.accountId]
    );
    rows    = r;
    headers = 'fecha,peso_kg,grasa_corporal_%,pecho_cm,cintura_cm,cadera_cm,brazo_cm,notas\n';
    mapper  = r =>
      `${r.fecha},${r.peso ?? ''},${r.grasa_corporal ?? ''},${r.pecho_cm ?? ''},` +
      `${r.cintura_cm ?? ''},${r.cadera_cm ?? ''},${r.brazo_cm ?? ''},"${(r.notas || '').replace(/"/g, '""')}"`;

  } else if (type === 'diets') {
    const { rows: r } = await pg.query(
      `SELECT fecha, nombre_plan, total_kcal, notas
       FROM registros_dieta WHERE cuenta_id = $1 ORDER BY fecha DESC`,
      [req.accountId]
    );
    rows    = r;
    headers = 'fecha,plan,kcal_totales,notas\n';
    mapper  = r =>
      `${r.fecha},"${(r.nombre_plan || '').replace(/"/g, '""')}",${r.total_kcal ?? ''},"${(r.notas || '').replace(/"/g, '""')}"`;

  } else {
    // workouts
    const { rows: r } = await pg.query(
      `SELECT fecha, nombre_rutina, duracion_min, notas
       FROM registros_entrenamiento WHERE cuenta_id = $1 ORDER BY fecha DESC`,
      [req.accountId]
    );
    rows    = r;
    headers = 'fecha,rutina,duracion_min,notas\n';
    mapper  = r =>
      `${r.fecha},"${(r.nombre_rutina || '').replace(/"/g, '""')}",${r.duracion_min ?? ''},"${(r.notas || '').replace(/"/g, '""')}"`;
  }

  const csv = headers + rows.map(mapper).join('\n');
  res.set({
    'Content-Type':        'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="fittracker-${type}-${new Date().toISOString().slice(0, 10)}.csv"`,
  });
  res.send('﻿' + csv); // BOM para Excel
}));

// ── POST /api/v1/auth/ai-suggestion ──────────────────────────────────────────
router.post('/ai-suggestion', requireAuth, asyncHandler(async (req, res) => {
  const { suggestionType, content, userFeedback } = req.body;
  if (!content) return res.status(400).json({ error: 'content es requerido' });
  const { rows } = await pg.query(
    `INSERT INTO sugerencias_ia (cuenta_id, tipo_sugerencia, contenido, respuesta_usuario)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [req.accountId, suggestionType || 'general', content, userFeedback || null]
  );
  res.json({ id: rows[0].id });
}));

// ── GET /api/v1/auth/ai-suggestions ──────────────────────────────────────────
router.get('/ai-suggestions', requireAuth, asyncHandler(async (req, res) => {
  const { limit, offset } = _parsePage(req.query, 20);
  const [data, count] = await Promise.all([
    pg.query(
      'SELECT * FROM sugerencias_ia WHERE cuenta_id = $1 ORDER BY creado_en DESC LIMIT $2 OFFSET $3',
      [req.accountId, limit, offset]
    ),
    pg.query('SELECT COUNT(*)::int AS total FROM sugerencias_ia WHERE cuenta_id = $1', [req.accountId]),
  ]);
  res.json({ data: data.rows, total: count.rows[0].total, limit, offset });
}));

// ── POST /api/v1/auth/forgot-password ────────────────────────────────────────
/**
 * @swagger
 * /api/v1/auth/forgot-password:
 *   post:
 *     tags: [Auth]
 *     summary: Solicitar enlace de recuperación de contraseña
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, example: usuario@email.com }
 *     responses:
 *       200: { description: Si el email existe, se enviará un enlace }
 */
router.post('/forgot-password', authLimiter, asyncHandler(async (req, res) => {
  const { email: userEmail } = req.body;
  if (!userEmail) return res.status(400).json({ error: 'Email requerido' });

  // Respuesta genérica siempre para no revelar si el email existe
  const generic = { ok: true, message: 'Si ese email está registrado, recibirás un enlace en breve' };

  try {
    const { rows } = await pg.query('SELECT id, correo FROM cuentas WHERE correo = $1', [userEmail.trim()]);
    if (!rows.length) return res.json(generic);

    const account  = rows[0];
    const raw      = crypto.randomBytes(32).toString('hex');
    const hash     = _hashToken(raw);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

    // Invalida tokens anteriores del usuario y crea uno nuevo
    await pg.query('UPDATE tokens_recuperacion SET utilizado = TRUE WHERE cuenta_id = $1 AND utilizado = FALSE', [account.id]);
    await pg.query(
      'INSERT INTO tokens_recuperacion (cuenta_id, hash_token, expira_en) VALUES ($1, $2, $3)',
      [account.id, hash, expiresAt]
    );

    await email.sendPasswordReset(account.correo, raw);
    res.json(generic);
  } catch (err) {
    console.error('[auth] forgot-password error:', err);
    res.json(generic); // Deliberate: don't propagate — generic response regardless of DB errors
  }
}));

// ── POST /api/v1/auth/reset-password ─────────────────────────────────────────
/**
 * @swagger
 * /api/v1/auth/reset-password:
 *   post:
 *     tags: [Auth]
 *     summary: Restablecer contraseña con token recibido por email
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, password]
 *             properties:
 *               token:    { type: string }
 *               password: { type: string, example: "nueva_contraseña" }
 *     responses:
 *       200: { description: Contraseña actualizada }
 *       400: { description: Token inválido, expirado o contraseña muy corta }
 */
router.post('/reset-password', authLimiter, asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token y contraseña requeridos' });
  if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });

  const client = await pg.pool.connect();
  try {
    const hash = _hashToken(token);
    const { rows } = await client.query(
      'SELECT * FROM tokens_recuperacion WHERE hash_token = $1',
      [hash]
    );

    const record = rows[0];
    if (!record || record.utilizado)             return res.status(400).json({ error: 'Token inválido o ya utilizado' });
    if (new Date(record.expira_en) < new Date()) return res.status(400).json({ error: 'Token expirado. Solicita uno nuevo' });

    const newHash = await bcrypt.hash(password, 10);

    await client.query('BEGIN');
    await client.query('UPDATE cuentas SET hash_contrasena = $1 WHERE id = $2', [newHash, record.cuenta_id]);
    await client.query('UPDATE tokens_recuperacion SET utilizado = TRUE WHERE id = $1', [record.id]);
    await client.query('UPDATE tokens_refresco SET revocado = TRUE WHERE cuenta_id = $1', [record.cuenta_id]);
    await client.query('COMMIT');

    res.json({ ok: true, message: 'Contraseña actualizada correctamente' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}));

// ── DELETE /api/v1/auth/me ────────────────────────────────────────────────────
/**
 * @swagger
 * /api/v1/auth/me:
 *   delete:
 *     tags: [Auth]
 *     summary: Eliminar cuenta y todos los datos del usuario (GDPR)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [password]
 *             properties:
 *               password: { type: string, example: "mi_contraseña" }
 *     responses:
 *       200: { description: Cuenta eliminada correctamente }
 *       400: { description: Contraseña requerida }
 *       401: { description: Contraseña incorrecta }
 */
router.delete('/me', requireAuth, asyncHandler(async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Se requiere la contraseña para confirmar el borrado' });

  const client = await pg.pool.connect();
  try {
    const { rows } = await client.query('SELECT hash_contrasena FROM cuentas WHERE id = $1', [req.accountId]);
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });

    const ok = await bcrypt.compare(password, rows[0].hash_contrasena);
    if (!ok) return res.status(401).json({ error: 'Contraseña incorrecta' });

    await client.query('BEGIN');
    // mediciones_progreso usa ON DELETE SET NULL — borrar explícitamente antes del CASCADE
    await client.query('DELETE FROM mediciones_progreso WHERE cuenta_id = $1', [req.accountId]);
    await client.query('DELETE FROM cuentas WHERE id = $1', [req.accountId]);
    await client.query('COMMIT');

    res.json({ ok: true, message: 'Cuenta y todos los datos eliminados correctamente' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}));

// ── POST /api/v1/auth/refresh ─────────────────────────────────────────────────
router.post('/refresh', authLimiter, asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'refreshToken requerido' });

  const client = await pg.pool.connect();
  try {
    const hash = _hashToken(refreshToken);
    const { rows } = await client.query(
      `SELECT rt.*, a.id AS acc_id, a.correo, a.nombre
       FROM tokens_refresco rt
       JOIN cuentas a ON a.id = rt.cuenta_id
       WHERE rt.hash_token = $1`,
      [hash]
    );

    const record = rows[0];
    if (!record)         return res.status(401).json({ error: 'Token inválido' });
    if (record.revocado) return res.status(401).json({ error: 'Token revocado' });
    if (new Date(record.expira_en) < new Date()) {
      await client.query('UPDATE tokens_refresco SET revocado = TRUE WHERE id = $1', [record.id]);
      return res.status(401).json({ error: 'Token expirado' });
    }

    // Rotación: revocar el token usado y emitir un par nuevo en la misma transacción
    const account = { id: record.acc_id, correo: record.correo, nombre: record.nombre };
    await client.query('BEGIN');
    await client.query('UPDATE tokens_refresco SET revocado = TRUE WHERE id = $1', [record.id]);
    const tokens = await _issueTokens(account, req);
    await client.query('COMMIT');

    res.json(tokens);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}));

// ── POST /api/v1/auth/logout ──────────────────────────────────────────────────
router.post('/logout', asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(200).json({ ok: true });

  const hash = _hashToken(refreshToken);
  await pg.query('UPDATE tokens_refresco SET revocado = TRUE WHERE hash_token = $1', [hash]);
  res.json({ ok: true });
}));

// ── Middleware ────────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.accountId = payload.id;
    req.account   = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

module.exports = router;
module.exports.requireAuth = requireAuth;
