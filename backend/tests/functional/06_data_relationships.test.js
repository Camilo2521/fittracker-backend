'use strict';

/**
 * FUNCTIONAL TEST — 06: Data Relationships & Referential Integrity
 * ─────────────────────────────────────────────────────────────────────────────
 * Verifica que:
 *   • ON DELETE CASCADE elimina los datos dependientes automáticamente
 *   • ON DELETE SET NULL preserva los registros huérfanos (progress_measurements)
 *   • Los índices compuestos aceleran las consultas reales
 *   • Las transacciones son atómicas (todo o nada)
 *   • El aislamiento de datos entre usuarios es total
 *   • Los datos de un usuario nunca aparecen en las consultas de otro
 *   • UPSERT (INSERT OR IGNORE, INSERT OR REPLACE) funciona correctamente
 *   • Las operaciones concurrentes (transacciones SQLite) son seguras
 */

jest.mock('../../src/db/postgres', () => require('../helpers/mockPostgres').mockPg);
jest.mock('../../src/services/visionClient', () => require('../helpers/mockVision').mockVision);

const request = require('supertest');
const { registerUser, bearerHeader } = require('../helpers/auth');

let app, db;
beforeAll(() => {
  app = require('../../src/app');
  db  = require('../../src/db/connection');
});

// ── 1. CASCADE DELETE en accounts ─────────────────────────────────────────────

describe.skip('ON DELETE CASCADE — sistema de cuentas (accounts)', () => {

  it('eliminar account borra chat_history asociado', () => {
    const acc = db.prepare(
      "INSERT INTO accounts (email, password_hash, name) VALUES ('cascade_chat@t.com','h','C')"
    ).run();
    const id = acc.lastInsertRowid;
    db.prepare("INSERT INTO chat_history (account_id, role, content) VALUES (?,'user','msg1')").run(id);
    db.prepare("INSERT INTO chat_history (account_id, role, content) VALUES (?,'assistant','msg2')").run(id);
    const before = db.prepare("SELECT COUNT(*) as c FROM chat_history WHERE account_id=?").get(id).c;
    expect(before).toBe(2);
    db.prepare("DELETE FROM accounts WHERE id=?").run(id);
    const after = db.prepare("SELECT COUNT(*) as c FROM chat_history WHERE account_id=?").get(id).c;
    expect(after).toBe(0);
  });

  it('eliminar account borra workout_logs asociados', () => {
    const acc = db.prepare(
      "INSERT INTO accounts (email, password_hash, name) VALUES ('cascade_wlog@t.com','h','W')"
    ).run();
    const id = acc.lastInsertRowid;
    db.prepare("INSERT INTO workout_logs (account_id, date, exercises) VALUES (?,'2024-01-01','[]')").run(id);
    db.prepare("INSERT INTO workout_logs (account_id, date, exercises) VALUES (?,'2024-01-02','[]')").run(id);
    db.prepare("DELETE FROM accounts WHERE id=?").run(id);
    const after = db.prepare("SELECT COUNT(*) as c FROM workout_logs WHERE account_id=?").get(id).c;
    expect(after).toBe(0);
  });

  it('eliminar account borra diet_logs asociados', () => {
    const acc = db.prepare(
      "INSERT INTO accounts (email, password_hash, name) VALUES ('cascade_dlog@t.com','h','D')"
    ).run();
    const id = acc.lastInsertRowid;
    db.prepare("INSERT INTO diet_logs (account_id, date, meals) VALUES (?,'2024-01-01','[]')").run(id);
    db.prepare("DELETE FROM accounts WHERE id=?").run(id);
    const after = db.prepare("SELECT COUNT(*) as c FROM diet_logs WHERE account_id=?").get(id).c;
    expect(after).toBe(0);
  });

  it('eliminar account borra progress_logs asociados', () => {
    const acc = db.prepare(
      "INSERT INTO accounts (email, password_hash, name) VALUES ('cascade_plog@t.com','h','P')"
    ).run();
    const id = acc.lastInsertRowid;
    db.prepare("INSERT INTO progress_logs (account_id, date) VALUES (?,'2024-01-01')").run(id);
    db.prepare("DELETE FROM accounts WHERE id=?").run(id);
    const after = db.prepare("SELECT COUNT(*) as c FROM progress_logs WHERE account_id=?").get(id).c;
    expect(after).toBe(0);
  });

  it('eliminar account borra ai_suggestions asociadas', () => {
    const acc = db.prepare(
      "INSERT INTO accounts (email, password_hash, name) VALUES ('cascade_ai@t.com','h','A')"
    ).run();
    const id = acc.lastInsertRowid;
    db.prepare("INSERT INTO ai_suggestions (account_id, suggestion_type, content) VALUES (?,'nutrition','test')").run(id);
    db.prepare("DELETE FROM accounts WHERE id=?").run(id);
    const after = db.prepare("SELECT COUNT(*) as c FROM ai_suggestions WHERE account_id=?").get(id).c;
    expect(after).toBe(0);
  });

  it('user_memories NO tiene FK declarado → sin CASCADE automático (bug conocido)', () => {
    // MEJORA PENDIENTE: user_memories.account_id debería tener FK con ON DELETE CASCADE.
    // Este test documenta el comportamiento actual y sirve de alerta para la siguiente migración.
    const acc = db.prepare(
      "INSERT INTO accounts (email, password_hash, name) VALUES ('cascade_mem@t.com','h','M')"
    ).run();
    const id = acc.lastInsertRowid;
    db.prepare("INSERT INTO user_memories (account_id, key, value) VALUES (?,'diet','vegano')").run(id);
    db.prepare("DELETE FROM accounts WHERE id=?").run(id);
    // Sin FK, el registro persiste como huérfano — comportamiento documentado, NO deseado
    const after = db.prepare("SELECT COUNT(*) as c FROM user_memories WHERE account_id=?").get(id).c;
    expect(after).toBe(1);
  });
});

// ── 2. CASCADE DELETE en users (frontend schema) ───────────────────────────────

describe.skip('ON DELETE CASCADE — users frontend (migration 001)', () => {
  function createUser(extId) {
    db.prepare("INSERT OR IGNORE INTO users (external_id, name) VALUES (?,?)").run(extId, extId);
    return extId;
  }

  it('eliminar user borra weights', () => {
    const uid = createUser('casc_w_usr');
    db.prepare("INSERT INTO weights (user_id, date, value) VALUES (?,'2024-01-01',75.0)").run(uid);
    db.prepare("DELETE FROM users WHERE external_id=?").run(uid);
    const after = db.prepare("SELECT COUNT(*) as c FROM weights WHERE user_id=?").get(uid).c;
    expect(after).toBe(0);
  });

  it('eliminar user borra goals', () => {
    const uid = createUser('casc_g_usr');
    db.prepare("INSERT INTO goals (user_id, goal, target_weight) VALUES (?,'lose',65)").run(uid);
    db.prepare("DELETE FROM users WHERE external_id=?").run(uid);
    const after = db.prepare("SELECT COUNT(*) as c FROM goals WHERE user_id=?").get(uid).c;
    expect(after).toBe(0);
  });

  it('eliminar user borra daily_checks', () => {
    const uid = createUser('casc_dc_usr');
    db.prepare("INSERT INTO daily_checks (user_id, date, checks) VALUES (?,'2024-01-01','{}')").run(uid);
    db.prepare("DELETE FROM users WHERE external_id=?").run(uid);
    const after = db.prepare("SELECT COUNT(*) as c FROM daily_checks WHERE user_id=?").get(uid).c;
    expect(after).toBe(0);
  });

  it('eliminar user borra workouts, nutrition, meals, exercises', () => {
    const uid = createUser('casc_all_usr');
    db.prepare("INSERT INTO workouts (user_id, date, type, duration, intensity) VALUES (?,'2024-01-01','cardio',30,'low')").run(uid);
    db.prepare("INSERT INTO nutrition (user_id, date, calories) VALUES (?,'2024-01-01',1800)").run(uid);
    db.prepare("INSERT INTO meals    (user_id, date, name, calories) VALUES (?,'2024-01-01','Desayuno',400)").run(uid);
    db.prepare("DELETE FROM users WHERE external_id=?").run(uid);
    const w = db.prepare("SELECT COUNT(*) as c FROM workouts  WHERE user_id=?").get(uid).c;
    const n = db.prepare("SELECT COUNT(*) as c FROM nutrition WHERE user_id=?").get(uid).c;
    const m = db.prepare("SELECT COUNT(*) as c FROM meals     WHERE user_id=?").get(uid).c;
    expect(w + n + m).toBe(0);
  });
});

// ── 3. ON DELETE SET NULL — progress_measurements ─────────────────────────────

describe.skip('ON DELETE SET NULL — progress_measurements', () => {
  it('al eliminar un user, su measurement queda con user_id = NULL (no se borra)', () => {
    const uid = 'pm_null_test';
    db.prepare("INSERT OR IGNORE INTO users (external_id, name) VALUES (?,?)").run(uid, uid);
    db.prepare("INSERT INTO progress_measurements (user_id, type) VALUES (?,'progress_measurement')").run(uid);
    db.prepare("DELETE FROM users WHERE external_id=?").run(uid);
    const measurement = db.prepare("SELECT * FROM progress_measurements WHERE user_id IS NULL").get();
    // El registro sigue existiendo pero con user_id = NULL
    expect(measurement).toBeTruthy();
  });
});

// ── 4. Aislamiento total de datos entre usuarios ───────────────────────────────

describe('Aislamiento de datos — usuarios no ven datos ajenos', () => {
  let tokenA, userA, tokenB, userB;

  beforeAll(async () => {
    const rA = await registerUser(app, { name: 'Alice' });
    const rB = await registerUser(app, { name: 'Bob' });
    tokenA = rA.token; userA = rA.user;
    tokenB = rB.token; userB = rB.user;
  });

  it('Alice no ve workout-logs de Bob', async () => {
    await request(app).post('/api/v1/auth/workout-log')
      .set(bearerHeader(tokenB))
      .send({ routineName: 'Entreno secreto de Bob', exercises: [] });
    const res = await request(app).get('/api/v1/auth/workout-logs').set(bearerHeader(tokenA));
    const names = (res.body.data || []).map(l => l.nombre_rutina);
    expect(names).not.toContain('Entreno secreto de Bob');
  });

  it('Bob no ve los diet-logs de Alice', async () => {
    await request(app).post('/api/v1/auth/diet-log')
      .set(bearerHeader(tokenA))
      .send({ planName: 'Dieta privada de Alice', meals: [] });
    const res = await request(app).get('/api/v1/auth/diet-logs').set(bearerHeader(tokenB));
    const names = (res.body.data || []).map(l => l.nombre_plan);
    expect(names).not.toContain('Dieta privada de Alice');
  });

  it('Alice no ve las AI suggestions de Bob', async () => {
    await request(app).post('/api/v1/auth/ai-suggestion')
      .set(bearerHeader(tokenB))
      .send({ content: 'Sugerencia privada de Bob' });
    const res = await request(app).get('/api/v1/auth/ai-suggestions').set(bearerHeader(tokenA));
    const contents = (res.body.data || []).map(s => s.contenido);
    expect(contents).not.toContain('Sugerencia privada de Bob');
  });

  it('Bob no ve el chat-history de Alice', async () => {
    await request(app).post('/api/v1/auth/chat-history')
      .set(bearerHeader(tokenA))
      .send({ messages: [{ role: 'user', content: 'Mensaje íntimo de Alice' }] });
    const res = await request(app).get('/api/v1/auth/chat-history').set(bearerHeader(tokenB));
    const contents = (res.body.data || []).map(m => m.contenido);
    expect(contents).not.toContain('Mensaje íntimo de Alice');
  });

  it.skip('la memoria de IA de Alice no contamina la de Bob (SQLite)', () => {
    // Skipped: acceso directo a SQLite ya no aplica tras migración a PostgreSQL
  });

  it('el perfil de Alice no es accesible con el token de Bob', async () => {
    const resA = await request(app).get('/api/v1/auth/me').set(bearerHeader(tokenA));
    const resB = await request(app).get('/api/v1/auth/me').set(bearerHeader(tokenB));
    expect(resA.body.name).toBe('Alice');
    expect(resB.body.name).toBe('Bob');
    expect(resA.body.id).not.toBe(resB.body.id);
  });
});

// ── 5. Transacciones atómicas ─────────────────────────────────────────────────

describe.skip('Transacciones atómicas — SQLite', () => {

  it('insert múltiple en chat_history dentro de una transacción es atómico', () => {
    const acc = db.prepare(
      "INSERT INTO accounts (email, password_hash, name) VALUES ('tx_test@t.com','h','T')"
    ).run();
    const id = acc.lastInsertRowid;
    const insert = db.prepare("INSERT INTO chat_history (account_id, role, content) VALUES (?,?,?)");
    const msgs = [
      [id, 'user',      'Mensaje 1'],
      [id, 'assistant', 'Respuesta 1'],
      [id, 'user',      'Mensaje 2'],
    ];
    const tx = db.transaction((rows) => {
      for (const row of rows) insert.run(...row);
    });
    tx(msgs);
    const count = db.prepare("SELECT COUNT(*) as c FROM chat_history WHERE account_id=?").get(id).c;
    expect(count).toBe(3);
  });

  it('una transacción que falla no deja datos parciales', () => {
    const acc = db.prepare(
      "INSERT INTO accounts (email, password_hash, name) VALUES ('tx_fail@t.com','h','F')"
    ).run();
    const id = acc.lastInsertRowid;
    const insert = db.prepare("INSERT INTO chat_history (account_id, role, content) VALUES (?,?,?)");
    const badTx = db.transaction(() => {
      insert.run(id, 'user', 'Msg antes del fallo');
      throw new Error('Fallo deliberado en transacción');
    });
    expect(() => badTx()).toThrow('Fallo deliberado en transacción');
    const count = db.prepare("SELECT COUNT(*) as c FROM chat_history WHERE account_id=?").get(id).c;
    expect(count).toBe(0); // rollback — nada se guardó
  });
});

// ── 6. UPSERT (INSERT OR IGNORE / INSERT OR REPLACE) ─────────────────────────

describe.skip('UPSERT — comportamiento correcto', () => {

  it('INSERT OR IGNORE en daily_checks no borra el registro existente', () => {
    const uid = 'upsert_dc';
    db.prepare("INSERT OR IGNORE INTO users (external_id, name) VALUES (?,?)").run(uid, uid);
    db.prepare("INSERT INTO daily_checks (user_id, date, checks) VALUES (?,'2024-03-01','{\"c1\":true}')").run(uid);
    db.prepare("INSERT OR IGNORE INTO daily_checks (user_id, date, checks) VALUES (?,'2024-03-01','{\"c2\":true}')").run(uid);
    const row = db.prepare("SELECT checks FROM daily_checks WHERE user_id=? AND date='2024-03-01'").get(uid);
    expect(row.checks).toBe('{"c1":true}'); // el original persiste
  });

  it('INSERT OR IGNORE en water_intake no duplica el registro', () => {
    const uid = 'upsert_wi';
    db.prepare("INSERT OR IGNORE INTO users (external_id, name) VALUES (?,?)").run(uid, uid);
    db.prepare("INSERT INTO water_intake (user_id, date, glasses) VALUES (?,'2024-03-01',6)").run(uid);
    db.prepare("INSERT OR IGNORE INTO water_intake (user_id, date, glasses) VALUES (?,'2024-03-01',8)").run(uid);
    const rows = db.prepare("SELECT * FROM water_intake WHERE user_id=? AND date='2024-03-01'").all(uid);
    expect(rows).toHaveLength(1); // no hay duplicados
    expect(rows[0].glasses).toBe(6); // el primero prevalece
  });

  it('settings UPSERT actualiza el valor', () => {
    const uid = 'upsert_st';
    db.prepare("INSERT OR IGNORE INTO users (external_id, name) VALUES (?,?)").run(uid, uid);
    db.prepare("INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (?,'theme','dark')").run(uid);
    db.prepare("INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (?,'theme','light')").run(uid);
    const row = db.prepare("SELECT value FROM settings WHERE user_id=? AND key='theme'").get(uid);
    expect(row.value).toBe('light');
    const all = db.prepare("SELECT * FROM settings WHERE user_id=? AND key='theme'").all(uid);
    expect(all).toHaveLength(1);
  });
});

// ── 7. Índices — verificación funcional via EXPLAIN ───────────────────────────

describe.skip('Índices — usados en consultas reales (EXPLAIN QUERY PLAN)', () => {

  it('idx_weights_user_date es usado en consultas por user_id y date', () => {
    const uid = 'idx_verify';
    db.prepare("INSERT OR IGNORE INTO users (external_id, name) VALUES (?,?)").run(uid, uid);
    const plan = db.prepare(
      "EXPLAIN QUERY PLAN SELECT * FROM weights WHERE user_id=? AND date > '2024-01-01' ORDER BY date DESC"
    ).all(uid);
    const planStr = plan.map(r => r.detail).join(' ').toLowerCase();
    // SQLite usa el índice o la PK — el plan no debe hacer full scan completo
    expect(planStr).toMatch(/search|using index|covering/i);
  });

  it('idx_chat_history_account es usado en consultas de historial', () => {
    const plan = db.prepare(
      "EXPLAIN QUERY PLAN SELECT * FROM chat_history WHERE account_id=? ORDER BY created_at DESC LIMIT 40"
    ).all(1);
    const planStr = plan.map(r => r.detail).join(' ').toLowerCase();
    expect(planStr).toMatch(/search|using index|covering/i);
  });
});
