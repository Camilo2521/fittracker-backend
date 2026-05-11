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
    const accountId = params[0];
    let total = 0;
    if      (s.includes('FROM HISTORIAL_CHAT'))          total = (_chatHistory.get(accountId) || []).length;
    else if (s.includes('FROM REGISTROS_ENTRENAMIENTO')) total = (_workoutLogs.get(accountId) || []).length;
    else if (s.includes('FROM REGISTROS_DIETA'))         total = (_dietLogs.get(accountId) || []).length;
    else if (s.includes('FROM REGISTROS_PROGRESO'))      total = (_progressLogs.get(accountId) || []).length;
    else if (s.includes('FROM SUGERENCIAS_IA'))          total = (_aiSuggestions.get(accountId) || []).length;
    // metricas_fisicas, tokens_refresco, etc. → 0
    return { rows: [{ total }], rowCount: 1 };
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

  if (s.startsWith('INSERT INTO TOKENS')) {
    return { rows: [], rowCount: 1 };
  }

  if (s.startsWith('INSERT INTO DOCUMENTOS_NUTRICION')) {
    return { rows: [{ id: _docIdSeq++ }], rowCount: 1 };
  }

  if (s.startsWith('INSERT INTO HISTORIAL_CHAT')) {
    // Batch INSERT: params = [accountId, rol, contenido, accountId, rol, contenido, ...]
    const accountId = params[0];
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
    const accountId = params[0];
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
    const accountId = params[0];
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
    const accountId = params[0];
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

  if (s.startsWith('INSERT INTO SUGERENCIAS_IA')) {
    const id = _logIdSeq++;
    const accountId = params[0];
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

  // UPDATE cuentas SET peso = $1 WHERE id = $2 (progress-log weight sync)
  if (s.startsWith('UPDATE CUENTAS SET PESO') && !s.includes('RETURNING')) {
    const id   = Number(params[1]);
    const user = _ensureUser(id);
    user.peso  = params[0];
    return { rows: [], rowCount: 1 };
  }

  // Generic UPDATE / DELETE
  if (s.startsWith('INSERT') || s.startsWith('UPDATE') || s.startsWith('DELETE')) {
    return { rows: [], rowCount: 1 };
  }

  // ── SELECT ────────────────────────────────────────────────────────────────

  // historial_chat
  if (s.includes('FROM HISTORIAL_CHAT')) {
    const accountId = params[0];
    return { rows: _chatHistory.get(accountId) || [], rowCount: 0 };
  }

  // registros_entrenamiento
  if (s.includes('FROM REGISTROS_ENTRENAMIENTO')) {
    const accountId = params[0];
    return { rows: _workoutLogs.get(accountId) || [], rowCount: 0 };
  }

  // registros_dieta
  if (s.includes('FROM REGISTROS_DIETA')) {
    const accountId = params[0];
    return { rows: _dietLogs.get(accountId) || [], rowCount: 0 };
  }

  // registros_progreso
  if (s.includes('FROM REGISTROS_PROGRESO')) {
    const accountId = params[0];
    return { rows: _progressLogs.get(accountId) || [], rowCount: 0 };
  }

  // sugerencias_ia
  if (s.includes('FROM SUGERENCIAS_IA')) {
    const accountId = params[0];
    return { rows: _aiSuggestions.get(accountId) || [], rowCount: 0 };
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

  // tokens_refresco
  if (s.includes('FROM TOKENS_REFRESCO') || s.includes('TOKENS_REFRESCO RT')) {
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

  mockPg.query.mockImplementation(async (sql, params) => _smartQuery(sql, params));
  mockPg.healthCheck.mockResolvedValue('ok');

  _clientInstance.query.mockImplementation(async (sql, params) => _smartQuery(sql, params));
  _clientInstance.release.mockReset();

  mockPg.pool.connect.mockReset();
  mockPg.pool.connect.mockResolvedValue(_clientInstance);
}

module.exports = { mockPg, resetMocks, TEST_PASSWORD, TEST_HASH, makeUser: _makeUser };
