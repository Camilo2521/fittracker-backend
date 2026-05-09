'use strict';

const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const pg       = require('../../db/postgres');
const n8n      = require('../../services/n8nWebhookService');
const { authLimiter }                               = require('../../middleware/rateLimiter');
const { validateDate, validateNumber, abort }       = require('../../utils/validate');
const { VALID_GOALS, VALID_GENDERS, VALID_ACTIVITY_LEVELS } = require('../../utils/constants');

const JWT_SECRET           = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('[auth] JWT_SECRET no está configurado. Añade JWT_SECRET a backend/.env');
const JWT_ACCESS_EXPIRES   = process.env.JWT_ACCESS_EXPIRES || process.env.JWT_EXPIRES || '15m';
const REFRESH_EXPIRES_DAYS = parseInt(process.env.JWT_REFRESH_DAYS || '30', 10);

function _sign(account) {
  return jwt.sign(
    { id: account.id, email: account.email, name: account.name },
    JWT_SECRET,
    { expiresIn: JWT_ACCESS_EXPIRES }
  );
}

function _safeUser(acc) {
  const { password_hash, ...safe } = acc;
  return safe;
}

function _hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function _issueTokens(account, req) {
  const accessToken  = _sign(account);
  const raw          = crypto.randomBytes(64).toString('hex');
  const tokenHash    = _hashToken(raw);
  const expiresAt    = new Date(Date.now() + REFRESH_EXPIRES_DAYS * 86_400_000);

  await pg.query(
    `INSERT INTO refresh_tokens (account_id, token_hash, expires_at, user_agent, ip)
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
router.post('/register', authLimiter, async (req, res) => {
  const {
    email, password, name = '',
    goal = 'maintain', weight, height, age, gender,
    activityLevel = 'moderate', restrictions = '',
  } = req.body;

  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });
  if (password.length < 8)  return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Email inválido' });
  if (weight  !== undefined && abort(res, [validateNumber(weight,  'weight',  { min: 30, max: 500 })])) return;
  if (height  !== undefined && abort(res, [validateNumber(height,  'height',  { min: 50, max: 280 })])) return;
  if (age     !== undefined && abort(res, [validateNumber(age,     'age',     { min: 5,  max: 120 })])) return;

  try {
    const exists = await pg.query('SELECT id FROM accounts WHERE email = $1', [email.trim()]);
    if (exists.rows.length) return res.status(409).json({ error: 'Este email ya está registrado' });

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pg.query(
      `INSERT INTO accounts
         (email, password_hash, name, goal, weight, height_cm, age, gender, activity_level, restrictions)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        email.trim(), hash, name.trim(),
        goal, weight || null, height || null, age || null, gender || null,
        activityLevel, restrictions,
      ]
    );
    const { accessToken, refreshToken } = await _issueTokens(rows[0], req);
    res.status(201).json({ accessToken, refreshToken, user: _safeUser(rows[0]) });
  } catch (err) {
    console.error('[auth] register error:', err);
    res.status(500).json({ error: 'Error al registrar usuario' });
  }
});

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
router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });

  try {
    const { rows } = await pg.query('SELECT * FROM accounts WHERE email = $1', [email.trim()]);
    const account  = rows[0];
    if (!account) return res.status(401).json({ error: 'Email o contraseña incorrectos' });

    const ok = await bcrypt.compare(password, account.password_hash);
    if (!ok)  return res.status(401).json({ error: 'Email o contraseña incorrectos' });

    const { accessToken, refreshToken } = await _issueTokens(account, req);
    res.json({ accessToken, refreshToken, user: _safeUser(account) });
  } catch (err) {
    console.error('[auth] login error:', err);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

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
router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await pg.query('SELECT * FROM accounts WHERE id = $1', [req.accountId]);
  if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json(_safeUser(rows[0]));
});

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
router.put('/profile', requireAuth, async (req, res) => {
  const { name, goal, weight, height, age, gender, activityLevel, restrictions } = req.body;
  const { rows } = await pg.query(
    `UPDATE accounts SET
       name           = COALESCE($1, name),
       goal           = COALESCE($2, goal),
       weight         = COALESCE($3, weight),
       height_cm      = COALESCE($4, height_cm),
       age            = COALESCE($5, age),
       gender         = COALESCE($6, gender),
       activity_level = COALESCE($7, activity_level),
       restrictions   = COALESCE($8, restrictions)
     WHERE id = $9
     RETURNING *`,
    [
      name || null, goal || null, weight || null, height || null,
      age || null, gender || null, activityLevel || null, restrictions || null,
      req.accountId,
    ]
  );
  res.json(_safeUser(rows[0]));
});

// ── GET /api/v1/auth/chat-history ────────────────────────────────────────────
router.get('/chat-history', requireAuth, async (req, res) => {
  const { rows } = await pg.query(
    'SELECT role, content, created_at FROM chat_history WHERE account_id = $1 ORDER BY created_at ASC LIMIT 40',
    [req.accountId]
  );
  res.json(rows);
});

// ── POST /api/v1/auth/chat-history ───────────────────────────────────────────
router.post('/chat-history', requireAuth, async (req, res) => {
  const { messages = [] } = req.body;
  const valid = messages.filter(m => m.role && m.content);
  if (!valid.length) return res.json({ saved: 0 });

  const client = await pg.pool.connect();
  try {
    await client.query('BEGIN');
    for (const m of valid) {
      await client.query(
        'INSERT INTO chat_history (account_id, role, content) VALUES ($1,$2,$3)',
        [req.accountId, m.role, m.content]
      );
    }
    await client.query('COMMIT');
    res.json({ saved: valid.length });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// ── POST /api/v1/auth/workout-log ─────────────────────────────────────────────
router.post('/workout-log', requireAuth, async (req, res) => {
  const { date, routineName, exercises = [], durationMin, notes } = req.body;
  const logDate = date || new Date().toISOString().slice(0, 10);

  const { rows } = await pg.query(
    `INSERT INTO workout_logs (account_id, date, routine_name, exercises, duration_min, notes)
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
});

// ── GET /api/v1/auth/workout-logs ─────────────────────────────────────────────
router.get('/workout-logs', requireAuth, async (req, res) => {
  const { rows } = await pg.query(
    'SELECT * FROM workout_logs WHERE account_id = $1 ORDER BY date DESC LIMIT 60',
    [req.accountId]
  );
  res.json(rows);
});

// ── POST /api/v1/auth/diet-log ────────────────────────────────────────────────
router.post('/diet-log', requireAuth, async (req, res) => {
  const { date, planName, meals = [], totalKcal, notes } = req.body;
  const logDate = date || new Date().toISOString().slice(0, 10);

  const { rows } = await pg.query(
    `INSERT INTO diet_logs (account_id, date, plan_name, meals, total_kcal, notes)
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
});

// ── GET /api/v1/auth/diet-logs ────────────────────────────────────────────────
router.get('/diet-logs', requireAuth, async (req, res) => {
  const { rows } = await pg.query(
    'SELECT * FROM diet_logs WHERE account_id = $1 ORDER BY date DESC LIMIT 60',
    [req.accountId]
  );
  res.json(rows);
});

// ── POST /api/v1/auth/progress-log ───────────────────────────────────────────
router.post('/progress-log', requireAuth, async (req, res) => {
  const { date, weight, bodyFat, chestCm, waistCm, hipCm, armCm, notes } = req.body;
  const logDate = date || new Date().toISOString().slice(0, 10);

  const { rows } = await pg.query(
    `INSERT INTO progress_logs (account_id, date, weight, body_fat, chest_cm, waist_cm, hip_cm, arm_cm, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [req.accountId, logDate, weight || null, bodyFat || null, chestCm || null, waistCm || null, hipCm || null, armCm || null, notes || null]
  );

  if (weight) {
    await pg.query('UPDATE accounts SET weight = $1 WHERE id = $2', [weight, req.accountId]);
  }

  n8n.buildUserContext(req.accountId).then(ctx => {
    if (ctx) n8n.emit('progress.updated', {
      accountId: req.accountId, ...ctx,
      data: { weight: weight || null, bodyFat: bodyFat || null, chestCm: chestCm || null, waistCm: waistCm || null, hipCm: hipCm || null, armCm: armCm || null, date: logDate },
    });
  }).catch(() => {});

  res.json({ id: rows[0].id });
});

// ── GET /api/v1/auth/progress-logs ───────────────────────────────────────────
router.get('/progress-logs', requireAuth, async (req, res) => {
  const { rows } = await pg.query(
    'SELECT * FROM progress_logs WHERE account_id = $1 ORDER BY date DESC LIMIT 90',
    [req.accountId]
  );
  res.json(rows);
});

// ── POST /api/v1/auth/ai-suggestion ──────────────────────────────────────────
router.post('/ai-suggestion', requireAuth, async (req, res) => {
  const { suggestionType, content, userFeedback } = req.body;
  if (!content) return res.status(400).json({ error: 'content es requerido' });
  const { rows } = await pg.query(
    `INSERT INTO ai_suggestions (account_id, suggestion_type, content, user_feedback)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [req.accountId, suggestionType || 'general', content, userFeedback || null]
  );
  res.json({ id: rows[0].id });
});

// ── GET /api/v1/auth/ai-suggestions ──────────────────────────────────────────
router.get('/ai-suggestions', requireAuth, async (req, res) => {
  const { rows } = await pg.query(
    'SELECT * FROM ai_suggestions WHERE account_id = $1 ORDER BY created_at DESC LIMIT 30',
    [req.accountId]
  );
  res.json(rows);
});

// ── POST /api/v1/auth/refresh ─────────────────────────────────────────────────
router.post('/refresh', authLimiter, async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'refreshToken requerido' });

  try {
    const hash = _hashToken(refreshToken);
    const { rows } = await pg.query(
      `SELECT rt.*, a.id AS acc_id, a.email, a.name
       FROM refresh_tokens rt
       JOIN accounts a ON a.id = rt.account_id
       WHERE rt.token_hash = $1`,
      [hash]
    );

    const record = rows[0];
    if (!record)                          return res.status(401).json({ error: 'Token inválido' });
    if (record.revoked)                   return res.status(401).json({ error: 'Token revocado' });
    if (new Date(record.expires_at) < new Date()) {
      await pg.query('UPDATE refresh_tokens SET revoked = TRUE WHERE id = $1', [record.id]);
      return res.status(401).json({ error: 'Token expirado' });
    }

    const accessToken = _sign({ id: record.acc_id, email: record.email, name: record.name });
    res.json({ accessToken });
  } catch (err) {
    console.error('[auth] refresh error:', err);
    res.status(500).json({ error: 'Error al refrescar token' });
  }
});

// ── POST /api/v1/auth/logout ──────────────────────────────────────────────────
router.post('/logout', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(200).json({ ok: true });

  try {
    const hash = _hashToken(refreshToken);
    await pg.query('UPDATE refresh_tokens SET revoked = TRUE WHERE token_hash = $1', [hash]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[auth] logout error:', err);
    res.status(500).json({ error: 'Error al cerrar sesión' });
  }
});

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
