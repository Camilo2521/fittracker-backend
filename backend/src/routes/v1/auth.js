'use strict';

const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const pg       = require('../../db/postgres');
const n8n      = require('../../services/n8nWebhookService');
const email    = require('../../services/emailService');
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
  const { limit, offset } = _parsePage(req.query, 40);
  const [data, count] = await Promise.all([
    pg.query(
      'SELECT role, content, created_at FROM chat_history WHERE account_id = $1 ORDER BY created_at ASC LIMIT $2 OFFSET $3',
      [req.accountId, limit, offset]
    ),
    pg.query('SELECT COUNT(*)::int AS total FROM chat_history WHERE account_id = $1', [req.accountId]),
  ]);
  res.json({ data: data.rows, total: count.rows[0].total, limit, offset });
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
  const { limit, offset } = _parsePage(req.query, 20);
  const { from, to } = req.query; // filtros opcionales YYYY-MM-DD

  const conditions = ['account_id = $1'];
  const params     = [req.accountId];
  if (from) { conditions.push(`date >= $${params.push(from)}`); }
  if (to)   { conditions.push(`date <= $${params.push(to)}`);   }
  const where = conditions.join(' AND ');

  const [data, count] = await Promise.all([
    pg.query(
      `SELECT * FROM workout_logs WHERE ${where} ORDER BY date DESC LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}`,
      params
    ),
    pg.query(`SELECT COUNT(*)::int AS total FROM workout_logs WHERE ${where}`, params.slice(0, -2)),
  ]);
  res.json({ data: data.rows, total: count.rows[0].total, limit, offset });
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
  const { limit, offset } = _parsePage(req.query, 20);
  const [data, count] = await Promise.all([
    pg.query(
      'SELECT * FROM diet_logs WHERE account_id = $1 ORDER BY date DESC LIMIT $2 OFFSET $3',
      [req.accountId, limit, offset]
    ),
    pg.query('SELECT COUNT(*)::int AS total FROM diet_logs WHERE account_id = $1', [req.accountId]),
  ]);
  res.json({ data: data.rows, total: count.rows[0].total, limit, offset });
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
  const { limit, offset } = _parsePage(req.query, 30);
  const [data, count] = await Promise.all([
    pg.query(
      'SELECT * FROM progress_logs WHERE account_id = $1 ORDER BY date DESC LIMIT $2 OFFSET $3',
      [req.accountId, limit, offset]
    ),
    pg.query('SELECT COUNT(*)::int AS total FROM progress_logs WHERE account_id = $1', [req.accountId]),
  ]);
  res.json({ data: data.rows, total: count.rows[0].total, limit, offset });
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
  const { limit, offset } = _parsePage(req.query, 20);
  const [data, count] = await Promise.all([
    pg.query(
      'SELECT * FROM ai_suggestions WHERE account_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [req.accountId, limit, offset]
    ),
    pg.query('SELECT COUNT(*)::int AS total FROM ai_suggestions WHERE account_id = $1', [req.accountId]),
  ]);
  res.json({ data: data.rows, total: count.rows[0].total, limit, offset });
});

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
router.post('/forgot-password', authLimiter, async (req, res) => {
  const { email: userEmail } = req.body;
  if (!userEmail) return res.status(400).json({ error: 'Email requerido' });

  // Respuesta genérica siempre para no revelar si el email existe
  const generic = { ok: true, message: 'Si ese email está registrado, recibirás un enlace en breve' };

  try {
    const { rows } = await pg.query('SELECT id, email FROM accounts WHERE email = $1', [userEmail.trim()]);
    if (!rows.length) return res.json(generic);

    const account  = rows[0];
    const raw      = crypto.randomBytes(32).toString('hex');
    const hash     = _hashToken(raw);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

    // Invalida tokens anteriores del usuario y crea uno nuevo
    await pg.query('UPDATE password_reset_tokens SET used = TRUE WHERE account_id = $1 AND used = FALSE', [account.id]);
    await pg.query(
      'INSERT INTO password_reset_tokens (account_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [account.id, hash, expiresAt]
    );

    await email.sendPasswordReset(account.email, raw);
    res.json(generic);
  } catch (err) {
    console.error('[auth] forgot-password error:', err);
    res.json(generic); // No revelar el error al cliente
  }
});

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
router.post('/reset-password', authLimiter, async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password)      return res.status(400).json({ error: 'Token y contraseña requeridos' });
  if (password.length < 8)      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });

  const client = await pg.pool.connect();
  try {
    const hash = _hashToken(token);
    const { rows } = await client.query(
      'SELECT * FROM password_reset_tokens WHERE token_hash = $1',
      [hash]
    );

    const record = rows[0];
    if (!record || record.used)                        return res.status(400).json({ error: 'Token inválido o ya utilizado' });
    if (new Date(record.expires_at) < new Date())      return res.status(400).json({ error: 'Token expirado. Solicita uno nuevo' });

    const newHash = await bcrypt.hash(password, 10);

    await client.query('BEGIN');
    await client.query('UPDATE accounts SET password_hash = $1 WHERE id = $2', [newHash, record.account_id]);
    await client.query('UPDATE password_reset_tokens SET used = TRUE WHERE id = $1', [record.id]);
    // Revocar todos los refresh tokens activos de esta cuenta
    await client.query('UPDATE refresh_tokens SET revoked = TRUE WHERE account_id = $1', [record.account_id]);
    await client.query('COMMIT');

    res.json({ ok: true, message: 'Contraseña actualizada correctamente' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[auth] reset-password error:', err);
    res.status(500).json({ error: 'Error al restablecer la contraseña' });
  } finally {
    client.release();
  }
});

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
router.delete('/me', requireAuth, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Se requiere la contraseña para confirmar el borrado' });

  const client = await pg.pool.connect();
  try {
    const { rows } = await client.query('SELECT password_hash FROM accounts WHERE id = $1', [req.accountId]);
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });

    const ok = await bcrypt.compare(password, rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Contraseña incorrecta' });

    await client.query('BEGIN');
    // progress_measurements usa ON DELETE SET NULL — borrar explícitamente
    await client.query('DELETE FROM progress_measurements WHERE account_id = $1', [req.accountId]);
    // El resto de tablas caen por CASCADE al borrar la cuenta
    await client.query('DELETE FROM accounts WHERE id = $1', [req.accountId]);
    await client.query('COMMIT');

    res.json({ ok: true, message: 'Cuenta y todos los datos eliminados correctamente' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[auth] delete account error:', err);
    res.status(500).json({ error: 'Error al eliminar la cuenta' });
  } finally {
    client.release();
  }
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
