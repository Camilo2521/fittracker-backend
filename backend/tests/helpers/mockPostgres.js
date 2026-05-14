'use strict';

const bcrypt = require('bcryptjs');

const TEST_PASSWORD = 'Password123!';
const TEST_HASH     = bcrypt.hashSync(TEST_PASSWORD, 10);

// ── Stateful in-memory store ──────────────────────────────────────────────────
let _users          = new Map(); // email → user row
let _userIdSeq      = 1;
let _docIdSeq       = 100;
let _logIdSeq       = 200;

// Per-account stores
let _chatHistory    = new Map(); // accountId → [{rol, contenido, creado_en}]
let _workoutLogs    = new Map(); // accountId → [{id, fecha, nombre_rutina, ejercicios_json, ...}]
let _dietLogs       = new Map(); // accountId → [{id, fecha, nombre_plan, comidas_json, ...}]
let _progressLogs   = new Map(); // accountId → [{id, fecha, peso, ...}]
let _aiSuggestions  = new Map(); // accountId → [{id, tipo_sugerencia, contenido, creado_en}]
let _meals          = new Map(); // accountId → [{id, fecha, nombre, calorias, ...}]
let _recoveryTokens = new Map(); // hash → {id, cuenta_id, hash_token, utilizado, expira_en}
let _refreshTokens  = new Map(); // hash → {id, cuenta_id, hash_token, expira_en, revocado}
let _settings       = new Map(); // accountId → {[clave]: valor}
let _waterIntake    = new Map(); // `${accountId}_${fecha}` → {id, fecha, vasos, ml}
let _dailyChecks    = new Map(); // `${accountId}_${fecha}` → {id, fecha, controles_json}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _makeUser(overrides = {}) {
  const id = overrides.id ?? _userIdSeq++;
  return {
    id,
    nombre:                overrides.nombre                ?? 'Test User',
    correo:                overrides.correo                ?? `test_${id}@test.com`,
    hash_contrasena:       overrides.hash_contrasena       ?? TEST_HASH,
    objetivo:              overrides.objetivo              ?? null,
    peso:                  overrides.peso                  ?? null,
    altura_cm:             overrides.altura_cm             ?? null,
    edad:                  overrides.edad                  ?? null,
    genero:                overrides.genero                ?? null,
    nivel_actividad:       overrides.nivel_actividad       ?? null,
    restricciones:         overrides.restricciones         ?? '',
    peso_meta:             overrides.peso_meta             ?? null,
    peso_inicio:           overrides.peso_inicio           ?? null,
    onboarding_completado: overrides.onboarding_completado ?? false,
    creado_en:             overrides.creado_en             ?? new Date(),
    actualizado_en:        overrides.actualizado_en        ?? new Date(),
  };
}

function _findById(id) {
  return [..._users.values()].find(u => u.id === id);
}

function _ensureUser(id) {
  let user = _findById(id);
  if (!user) {
    user = _makeUser({ id });
    _users.set(user.correo, user);
  }
  return user;
}

function _makeClient() {
  return {
    query:   jest.fn().mockImplementation(async (sql, params) => _smartQuery(sql, params)),
    release: jest.fn(),
  };
}

const _clientInstance = _makeClient();

// ── Smart query dispatcher ────────────────────────────────────────────────────
function _smartQuery(sql = '', params = []) {
  const s = sql.trim().toUpperCase();

  // ── COUNT(*) — catch before generic SELECT ───────────────────────────────
  if (/SELECT\s+COUNT\s*\(\s*\*\s*\)/.test(s)) {
    const accountId = String(params[0]);
    let total = 0;
    if      (s.includes('FROM HISTORIAL_CHAT'))          total = (_chatHistory.get(accountId) || []).length;
    else if (s.includes('FROM REGISTROS_ENTRENAMIENTO')) total = (_workoutLogs.get(accountId) || []).length;
    else if (s.includes('FROM REGISTROS_DIETA'))         total = (_dietLogs.get(accountId) || []).length;
    else if (s.includes('FROM REGISTROS_PROGRESO'))      total = (_progressLogs.get(accountId) || []).length;
    else if (s.includes('FROM SUGERENCIAS_IA'))          total = (_aiSuggestions.get(accountId) || []).length;
    // metricas_fisicas, tokens_refresco, etc. → 0
    // Devolver múltiples alias (total, c, count) para cubrir distintas queries
    return { rows: [{ total, c: total, count: total }], rowCount: 1 };
  }

  // ── INSERT ────────────────────────────────────────────────────────────────
  if (s.startsWith('INSERT INTO CUENTAS')) {
    const email = (params[0] ?? '').toLowerCase();
    const user  = _makeUser({
      correo:              email,
      hash_contrasena:     params[1],
      nombre:              params[2],
      objetivo:            params[3]  ?? null,
      peso:                params[4]  ?? null,
      altura_cm:           params[5]  ?? null,
      edad:                params[6]  ?? null,
      genero:              params[7]  ?? null,
      nivel_actividad:     params[8]  ?? null,
      restricciones:       params[9]  ?? '',
      onboarding_completado: params[10] ?? false,
    });
    _users.set(email, user);
    return { rows: [user], rowCount: 1 };
  }

  if (s.startsWith('INSERT INTO TOKENS_RECUPERACION')) {
    const id = _logIdSeq++;
    const record = { id, cuenta_id: params[0], hash_token: params[1], utilizado: false, expira_en: params[2] };
    _recoveryTokens.set(params[1], record);
    return { rows: [], rowCount: 1 };
  }

  if (s.startsWith('INSERT INTO TOKENS')) {
    const id = _logIdSeq++;
    const record = { id, cuenta_id: params[0], hash_token: params[1], expira_en: params[2], revocado: false };
    _refreshTokens.set(params[1], record);
    return { rows: [], rowCount: 1 };
  }

  if (s.startsWith('INSERT INTO DOCUMENTOS_NUTRICION')) {
    return { rows: [{ id: _docIdSeq++ }], rowCount: 1 };
  }

  if (s.startsWith('INSERT INTO HISTORIAL_CHAT')) {
    // Batch INSERT: params = [accountId, rol, contenido, accountId, rol, contenido, ...]
    const accountId = String(params[0]);
    if (!_chatHistory.has(accountId)) _chatHistory.set(accountId, []);
    const history = _chatHistory.get(accountId);
    for (let i = 0; i < params.length; i += 3) {
      if (params[i + 1]) {
        history.push({ rol: params[i + 1], contenido: params[i + 2], creado_en: new Date() });
      }
    }
    return { rows: [], rowCount: 1 };
  }

  if (s.startsWith('INSERT INTO REGISTROS_ENTRENAMIENTO')) {
    const id = _logIdSeq++;
    const accountId = String(params[0]);
    const log = {
      id, cuenta_id: accountId,
      fecha: params[1], nombre_rutina: params[2],
      ejercicios_json: _tryParse(params[3], []),
      duracion_min: params[4], notas: params[5],
    };
    if (!_workoutLogs.has(accountId)) _workoutLogs.set(accountId, []);
    _workoutLogs.get(accountId).push(log);
    return { rows: [{ id }], rowCount: 1 };
  }

  if (s.startsWith('INSERT INTO REGISTROS_DIETA')) {
    const id = _logIdSeq++;
    const accountId = String(params[0]);
    const log = {
      id, cuenta_id: accountId,
      fecha: params[1], nombre_plan: params[2],
      comidas_json: _tryParse(params[3], []),
      total_kcal: params[4], notas: params[5],
    };
    if (!_dietLogs.has(accountId)) _dietLogs.set(accountId, []);
    _dietLogs.get(accountId).push(log);
    return { rows: [{ id }], rowCount: 1 };
  }

  if (s.startsWith('INSERT INTO REGISTROS_PROGRESO')) {
    const id = _logIdSeq++;
    const accountId = String(params[0]);
    const log = {
      id, cuenta_id: accountId,
      fecha: params[1], peso: params[2], grasa_corporal: params[3],
      pecho_cm: params[4], cintura_cm: params[5], cadera_cm: params[6],
      brazo_cm: params[7], notas: params[8],
    };
    if (!_progressLogs.has(accountId)) _progressLogs.set(accountId, []);
    _progressLogs.get(accountId).push(log);
    return { rows: [{ id }], rowCount: 1 };
  }

  if (s.startsWith('INSERT INTO COMIDAS_DETECTADAS')) {
    const id = _logIdSeq++;
    const accountId = String(params[0]);
    const meal = {
      id, cuenta_id: accountId,
      fecha: params[1], nombre: params[2],
      calorias: params[3], proteinas: params[4],
      carbohidratos: params[5], grasas: params[6],
      detectado_por: params[7], confianza: params[8],
    };
    if (!_meals.has(accountId)) _meals.set(accountId, []);
    _meals.get(accountId).push(meal);
    return { rows: [meal], rowCount: 1 };
  }

  if (s.startsWith('INSERT INTO SUGERENCIAS_IA')) {
    const id = _logIdSeq++;
    const accountId = String(params[0]);
    const suggestion = {
      id, cuenta_id: accountId,
      tipo_sugerencia: params[1], contenido: params[2],
      respuesta_usuario: params[3], creado_en: new Date(),
    };
    if (!_aiSuggestions.has(accountId)) _aiSuggestions.set(accountId, []);
    _aiSuggestions.get(accountId).push(suggestion);
    return { rows: [{ id }], rowCount: 1 };
  }

  // ── UPDATE ────────────────────────────────────────────────────────────────

  // UPDATE cuentas SET ... COALESCE ... RETURNING * (profile update)
  if (s.startsWith('UPDATE CUENTAS SET') && s.includes('COALESCE') && s.includes('RETURNING')) {
    const id     = Number(params[params.length - 1]);
    const user   = _ensureUser(id);
    const fields = ['nombre', 'objetivo', 'peso', 'altura_cm', 'edad', 'genero', 'nivel_actividad', 'restricciones'];
    fields.forEach((field, i) => { if (params[i] !== null && params[i] !== undefined) user[field] = params[i]; });
    user.onboarding_completado = true;
    user.actualizado_en        = new Date();
    return { rows: [user], rowCount: 1 };
  }

  // UPDATE cuentas SET hash_contrasena = $1 WHERE id = $2 (password reset)
  if (s.startsWith('UPDATE CUENTAS SET HASH_CONTRASENA')) {
    const newHash = params[0];
    const id      = Number(params[1]);
    const user    = _ensureUser(id);
    user.hash_contrasena = newHash;
    return { rows: [], rowCount: 1 };
  }

  // UPDATE cuentas SET peso = $1 WHERE id = $2 (progress-log weight sync)
  if (s.startsWith('UPDATE CUENTAS SET PESO') && !s.includes('RETURNING')) {
    const id   = Number(params[1]);
    const user = _ensureUser(id);
    user.peso  = params[0];
    return { rows: [], rowCount: 1 };
  }

  // configuracion (settings)
  if (s.startsWith('INSERT INTO CONFIGURACION')) {
    const accountId = String(params[0]);
    const clave = params[1];
    const valor = params[2];
    if (!_settings.has(accountId)) _settings.set(accountId, {});
    _settings.get(accountId)[clave] = valor;
    return { rows: [{ clave, valor }], rowCount: 1 };
  }

  // consumo_agua (water intake)
  if (s.startsWith('INSERT INTO CONSUMO_AGUA')) {
    const accountId = String(params[0]);
    const fecha = params[1];
    const vasos = params[2];
    const ml    = params[3];
    const key   = `${accountId}_${fecha}`;
    const record = { id: _logIdSeq++, fecha, vasos, ml };
    _waterIntake.set(key, record);
    return { rows: [record], rowCount: 1 };
  }

  // controles_diarios (daily checks)
  if (s.startsWith('INSERT INTO CONTROLES_DIARIOS')) {
    const accountId = String(params[0]);
    const fecha = params[1];
    const controles_json = (() => { try { return JSON.parse(params[2]); } catch { return params[2] || {}; } })();
    const key   = `${accountId}_${fecha}`;
    const record = { id: _logIdSeq++, fecha, controles_json };
    _dailyChecks.set(key, record);
    return { rows: [record], rowCount: 1 };
  }

  // sesiones_rep (rep counter sessions)
  if (s.startsWith('INSERT INTO SESIONES_REP')) {
    return { rows: [], rowCount: 1 };
  }

  // Generic UPDATE / DELETE
  if (s.startsWith('INSERT') || s.startsWith('UPDATE') || s.startsWith('DELETE')) {
    return { rows: [], rowCount: 1 };
  }

  // ── SELECT ────────────────────────────────────────────────────────────────

  // CTE — weekly-users (n8n route): must be checked BEFORE individual FROM handlers
  // because the CTE body also contains FROM registros_entrenamiento
  if (s.includes('WITH ACTIVOS') && s.includes('FROM CUENTAS')) {
    const activeUsers = [..._users.values()].slice(0, 5).map(u => ({
      id:               u.id,
      nombre:           u.nombre,
      objetivo:         u.objetivo         || 'maintain',
      peso:             u.peso             ?? null,
      altura_cm:        u.altura_cm        ?? null,
      edad:             u.edad             ?? null,
      genero:           u.genero           || 'male',
      nivel_actividad:  u.nivel_actividad  || 'moderate',
      restricciones:    u.restricciones    || '',
      weekly_workouts:  3,
      weekly_diet_logs: 4,
      avg_kcal:         1800,
      last_weight:      u.peso ?? null,
      prev_weight:      u.peso != null ? u.peso + 0.5 : null,
    }));
    return { rows: activeUsers, rowCount: activeUsers.length };
  }

  // historial_chat
  if (s.includes('FROM HISTORIAL_CHAT')) {
    const accountId = String(params[0]);
    return { rows: _chatHistory.get(accountId) || [], rowCount: 0 };
  }

  // registros_entrenamiento
  if (s.includes('FROM REGISTROS_ENTRENAMIENTO')) {
    const accountId = String(params[0]);
    return { rows: _workoutLogs.get(accountId) || [], rowCount: 0 };
  }

  // registros_dieta
  if (s.includes('FROM REGISTROS_DIETA')) {
    const accountId = String(params[0]);
    return { rows: _dietLogs.get(accountId) || [], rowCount: 0 };
  }

  // registros_progreso
  if (s.includes('FROM REGISTROS_PROGRESO')) {
    const accountId = String(params[0]);
    return { rows: _progressLogs.get(accountId) || [], rowCount: 0 };
  }

  // comidas_detectadas
  if (s.includes('FROM COMIDAS_DETECTADAS')) {
    const accountId = String(params[0]);
    return { rows: _meals.get(accountId) || [], rowCount: 0 };
  }

  // sugerencias_ia
  if (s.includes('FROM SUGERENCIAS_IA')) {
    const accountId = String(params[0]);
    return { rows: _aiSuggestions.get(accountId) || [], rowCount: 0 };
  }

  // configuracion (settings)
  if (s.includes('FROM CONFIGURACION')) {
    const accountId = String(params[0]);
    const store = _settings.get(accountId) || {};
    if (params[1] !== undefined) {
      // GET /:key — params[1] = clave
      const clave = params[1];
      return clave in store
        ? { rows: [{ clave, valor: store[clave] }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    // GET all — return sorted array of { clave, valor }
    const rows = Object.entries(store).sort(([a], [b]) => a.localeCompare(b))
      .map(([clave, valor]) => ({ clave, valor }));
    return { rows, rowCount: rows.length };
  }

  // consumo_agua (water intake)
  if (s.includes('FROM CONSUMO_AGUA')) {
    const accountId = String(params[0]);
    const fecha = params[1];
    const key = `${accountId}_${fecha}`;
    const record = _waterIntake.get(key);
    return record ? { rows: [record], rowCount: 1 } : { rows: [], rowCount: 0 };
  }

  // sesiones_rep (rep counter sessions — table renamed from rep_sessions in migration 011)
  if (s.includes('FROM SESIONES_REP')) {
    const accountId = String(params[0]);
    return { rows: [], rowCount: 0, total: 0 };
  }

  // controles_diarios (daily checks)
  if (s.includes('FROM CONTROLES_DIARIOS')) {
    const accountId = String(params[0]);
    const fecha = params[1];
    const key = `${accountId}_${fecha}`;
    const record = _dailyChecks.get(key);
    return record ? { rows: [record], rowCount: 1 } : { rows: [], rowCount: 0 };
  }

  // SELECT id FROM cuentas WHERE correo (duplicate check)
  if (s.includes('FROM CUENTAS') && s.includes('CORREO')) {
    const email = (params[0] ?? '').toLowerCase();
    if (/SELECT\s+ID\s+FROM/.test(s)) {
      const existing = _users.get(email);
      return existing ? { rows: [{ id: existing.id }] } : { rows: [] };
    }
    // SELECT * FROM cuentas WHERE correo (login, forgot-password)
    const existing = _users.get(email);
    return existing ? { rows: [existing] } : { rows: [] };
  }

  // SELECT * FROM cuentas WHERE id
  if (s.includes('FROM CUENTAS') && (s.includes('WHERE ID') || s.includes('WHERE A.ID'))) {
    const id   = Number(params[0]);
    const user = _ensureUser(id);
    return { rows: [user], rowCount: 1 };
  }

  // tokens_recuperacion (password reset)
  if (s.includes('FROM TOKENS_RECUPERACION')) {
    const hash = params[0];
    const record = _recoveryTokens.get(hash);
    return record ? { rows: [record], rowCount: 1 } : { rows: [], rowCount: 0 };
  }

  // tokens_refresco — supports JOIN + hash-based lookup for refresh route
  if (s.includes('FROM TOKENS_REFRESCO') || s.includes('TOKENS_REFRESCO RT')) {
    if (s.includes('HASH_TOKEN')) {
      const hash = params[0];
      const rt = _refreshTokens.get(hash);
      if (!rt) return { rows: [], rowCount: 0 };
      const account = _findById(rt.cuenta_id);
      if (!account) return { rows: [], rowCount: 0 };
      return {
        rows: [{ ...rt, acc_id: account.id, correo: account.correo, nombre: account.nombre }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  }

  return { rows: [], rowCount: 0 };
}

function _tryParse(val, fallback) {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return fallback; }
}

// ── Mock exports ──────────────────────────────────────────────────────────────
const mockPg = {
  query:       jest.fn().mockImplementation(async (sql, params) => _smartQuery(sql, params)),
  healthCheck: jest.fn().mockResolvedValue('ok'),
  pool: {
    connect: jest.fn().mockResolvedValue(_clientInstance),
  },
};

function resetMocks() {
  _users.clear();
  _userIdSeq    = 1;
  _docIdSeq     = 100;
  _logIdSeq     = 200;
  _chatHistory.clear();
  _workoutLogs.clear();
  _dietLogs.clear();
  _progressLogs.clear();
  _aiSuggestions.clear();
  _meals.clear();
  _recoveryTokens.clear();
  _refreshTokens.clear();
  _settings.clear();
  _waterIntake.clear();
  _dailyChecks.clear();

  mockPg.query.mockImplementation(async (sql, params) => _smartQuery(sql, params));
  mockPg.healthCheck.mockResolvedValue('ok');

  _clientInstance.query.mockImplementation(async (sql, params) => _smartQuery(sql, params));
  _clientInstance.release.mockReset();

  mockPg.pool.connect.mockReset();
  mockPg.pool.connect.mockResolvedValue(_clientInstance);
}

function plantRecoveryToken(accountId, rawToken) {
  const crypto = require('crypto');
  const hash   = crypto.createHash('sha256').update(rawToken).digest('hex');
  const id     = _logIdSeq++;
  const record = { id, cuenta_id: accountId, hash_token: hash, utilizado: false, expira_en: new Date(Date.now() + 3_600_000) };
  _recoveryTokens.set(hash, record);
  return record;
}

module.exports = { mockPg, resetMocks, TEST_PASSWORD, TEST_HASH, makeUser: _makeUser, plantRecoveryToken };
