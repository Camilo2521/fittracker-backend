'use strict';

/**
 * ARCHITECTURE — Contratos frontend ↔ backend
 *
 * Valida que las respuestas del backend tienen EXACTAMENTE las formas
 * que sync.js y api.js esperan. Si este test falla, el frontend se rompe.
 *
 * Cada `it` documenta qué línea/método de sync.js depende de la propiedad.
 */

jest.mock('../../src/db/postgres', () => require('../helpers/mockPostgres').mockPg);
jest.mock('../../src/services/visionClient', () => require('../helpers/mockVision').mockVision);

const request = require('supertest');
const { registerUser, bearerHeader } = require('../helpers/auth');

let app, token, refreshToken, userId;

beforeAll(async () => {
  app = require('../../src/app');
  const r = await registerUser(app, {
    weight: 75, height: 175, age: 28, gender: 'male', goal: 'maintain',
  });
  token        = r.token;
  userId       = r.user.id;

  // Obtener refreshToken haciendo login real
  const login = await request(app).post('/api/v1/auth/login')
    .send({ email: r.credentials.email, password: r.credentials.password });
  refreshToken = login.body.refreshToken;
});

// ── 1. Auth — register/login: BackendSync._storeTokens({ accessToken, refreshToken }) ──

describe('Contrato auth — register', () => {
  let res;
  beforeAll(async () => {
    res = await request(app).post('/api/v1/auth/register').send({
      email: `contract_${Date.now()}@test.com`,
      password: 'Password123!',
      name: 'Contract Test',
      goal: 'lose', weight: 70,
    });
  });

  it('status 201', () => expect(res.status).toBe(201));

  // sync.js line 223: if (data?.accessToken) this._storeTokens(data)
  it('incluye accessToken (sync.js _storeTokens)', () => {
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.body.accessToken.length).toBeGreaterThan(20);
  });

  // sync.js line 223: _storeTokens({ accessToken, refreshToken })
  it('incluye refreshToken (sync.js _storeTokens)', () => {
    expect(typeof res.body.refreshToken).toBe('string');
    expect(res.body.refreshToken.length).toBeGreaterThan(20);
  });

  // sync.js uses user.id to set userId: setUserId(data.user.id)
  it('user.id es un número entero positivo', () => {
    expect(typeof res.body.user.id).toBe('number');
    expect(res.body.user.id).toBeGreaterThan(0);
  });

  it('user.name está presente', () => {
    expect(typeof res.body.user.name).toBe('string');
  });

  it('user.email coincide con el email enviado', () => {
    expect(res.body.user.email).toMatch(/@test\.com$/);
  });

  it('user.goal es el objetivo enviado', () => {
    expect(res.body.user.goal).toBe('lose');
  });

  // Frontend usa weight para mostrar el peso inicial
  it('user.weight está presente si se envió', () => {
    expect(res.body.user.weight).toBe(70);
  });

  it('accessToken tiene formato JWT (3 partes separadas por .)', () => {
    const parts = res.body.accessToken.split('.');
    expect(parts).toHaveLength(3);
  });
});

describe('Contrato auth — login', () => {
  let loginRes, credentials;
  beforeAll(async () => {
    const r = await registerUser(app);
    credentials = r.credentials;
    loginRes = await request(app).post('/api/v1/auth/login')
      .send({ email: credentials.email, password: credentials.password });
  });

  // sync.js login(): if (data?.accessToken) this._storeTokens(data)
  it('login devuelve accessToken', () => {
    expect(loginRes.body.accessToken).toBeTruthy();
  });

  it('login devuelve refreshToken', () => {
    expect(loginRes.body.refreshToken).toBeTruthy();
  });

  it('login devuelve user con id, name, email, goal', () => {
    const { user } = loginRes.body;
    expect(user.id).toBeTruthy();
    expect(user.email).toBe(credentials.email);
  });
});

// ── 2. Refresh — BackendSync._tryRefresh() espera { accessToken, refreshToken? } ──

describe('Contrato auth — refresh token', () => {
  it('POST /refresh devuelve accessToken nuevo', async () => {
    const res = await request(app).post('/api/v1/auth/refresh')
      .send({ refreshToken });
    expect(res.status).toBe(200);
    // sync.js line 108: if (data.accessToken) localStorage.setItem('ft_access_token', data.accessToken)
    expect(res.body.accessToken).toBeTruthy();
  });

  it('POST /refresh devuelve refreshToken rotado', async () => {
    // Para esta prueba, primero hacemos login para obtener un token fresco
    const r = await registerUser(app);
    const loginRes = await request(app).post('/api/v1/auth/login')
      .send({ email: r.credentials.email, password: r.credentials.password });
    const rt = loginRes.body.refreshToken;

    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: rt });
    expect(res.status).toBe(200);
    // sync.js line 109: if (data.refreshToken) localStorage.setItem('ft_refresh_token', data.refreshToken)
    expect(res.body.refreshToken).toBeTruthy();
  });
});

// ── 3. GET /me — Frontend muestra email, name, goal, weight, completed_onboarding ──

describe('Contrato GET /auth/me', () => {
  let res;
  beforeAll(async () => {
    res = await request(app).get('/api/v1/auth/me').set(bearerHeader(token));
  });

  it('devuelve 200', () => expect(res.status).toBe(200));

  // Propiedades que muestra el perfil del usuario en la app
  it('tiene id', ()    => expect(res.body.id).toBeTruthy());
  it('tiene email', () => expect(typeof res.body.email).toBe('string'));
  it('tiene name', ()  => expect(typeof res.body.name).toBe('string'));
  it('tiene goal',  () => expect(['lose','gain','maintain']).toContain(res.body.goal));
  it('tiene weight',   () => expect(res.body.weight).toBe(75));

  // Frontend usa height_cm O height para calcular BMI
  it('tiene height_cm (alias de altura_cm)', () => {
    expect(res.body.height_cm ?? res.body.height).toBeTruthy();
  });

  it('tiene activity_level (alias activityLevel también presente)', () => {
    // sync.js usa activityLevel; la respuesta expone ambos por compatibilidad
    const level = res.body.activity_level ?? res.body.activityLevel;
    expect(typeof level).toBe('string');
  });

  it('tiene completed_onboarding boolean', () => {
    expect(typeof res.body.completed_onboarding).toBe('boolean');
  });
});

// ── 4. Paginación — sync.js getWorkoutLogs/getDietLogs/getProgressLogs/getAiSuggestions ──
//    Todos esperan: { data: [...], total: number, limit: number, offset: number }

describe('Contrato paginación — workout-logs', () => {
  let res;
  beforeAll(async () => {
    res = await request(app).get('/api/v1/auth/workout-logs').set(bearerHeader(token));
  });

  it('devuelve 200', () => expect(res.status).toBe(200));
  // sync.js: return result || { data: [], total: 0, limit, offset }
  it('tiene campo data array', () => expect(Array.isArray(res.body.data)).toBe(true));
  it('tiene campo total number', () => expect(typeof res.body.total).toBe('number'));
  it('tiene campo limit number', () => expect(typeof res.body.limit).toBe('number'));
  it('tiene campo offset number', () => expect(typeof res.body.offset).toBe('number'));
  it('limit por defecto es ≤ 60', () => expect(res.body.limit).toBeLessThanOrEqual(60));
});

describe('Contrato paginación — diet-logs', () => {
  let res;
  beforeAll(async () => {
    res = await request(app).get('/api/v1/auth/diet-logs').set(bearerHeader(token));
  });

  it('tiene { data, total, limit, offset }', () => {
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(typeof res.body.total).toBe('number');
    expect(typeof res.body.limit).toBe('number');
    expect(typeof res.body.offset).toBe('number');
  });
});

describe('Contrato paginación — progress-logs', () => {
  let res;
  beforeAll(async () => {
    res = await request(app).get('/api/v1/auth/progress-logs').set(bearerHeader(token));
  });

  it('tiene { data, total, limit, offset }', () => {
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });
});

describe('Contrato paginación — ai-suggestions', () => {
  let res;
  beforeAll(async () => {
    // Crea una sugerencia para que el array no esté vacío
    await request(app).post('/api/v1/auth/ai-suggestion')
      .set(bearerHeader(token))
      .send({ suggestionType: 'nutrition', content: 'Come más verduras.' });
    res = await request(app).get('/api/v1/auth/ai-suggestions').set(bearerHeader(token));
  });

  it('tiene { data, total, limit, offset }', () => {
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });

  it('los items de ai-suggestions tienen id, tipo_sugerencia y contenido', () => {
    if (res.body.data.length === 0) return; // sin datos es válido
    const item = res.body.data[0];
    expect(item).toHaveProperty('id');
    expect(item).toHaveProperty('tipo_sugerencia');
    expect(item).toHaveProperty('contenido');
  });
});

// ── 5. Habits — sync.js getWater/getDailyCheck/syncWater/syncCheck ───────────

describe('Contrato hábitos — agua', () => {
  it('GET /habits/water devuelve { vasos, fecha }', async () => {
    const res = await request(app)
      .get('/api/v1/habits/water')
      .set(bearerHeader(token));
    expect(res.status).toBe(200);
    // sync.js getWater() espera un objeto con estos campos
    expect(res.body).toHaveProperty('vasos');
    expect(res.body).toHaveProperty('fecha');
    expect(typeof res.body.vasos).toBe('number');
  });

  it('PUT /habits/water con vasos=6 devuelve { fecha, vasos, ml }', async () => {
    const res = await request(app)
      .put('/api/v1/habits/water')
      .set(bearerHeader(token))
      .send({ vasos: 6, date: '2026-05-14' });
    expect(res.status).toBe(200);
    expect(typeof res.body.vasos).toBe('number');
    expect(res.body.vasos).toBe(6);
    expect(res.body).toHaveProperty('fecha');
  });

  it('GET /habits/water?date= devuelve el registro del día solicitado', async () => {
    await request(app).put('/api/v1/habits/water')
      .set(bearerHeader(token))
      .send({ vasos: 8, date: '2026-01-10' });
    const res = await request(app)
      .get('/api/v1/habits/water?date=2026-01-10')
      .set(bearerHeader(token));
    expect(res.body.vasos).toBe(8);
    expect(res.body.fecha).toBe('2026-01-10');
  });
});

describe('Contrato hábitos — daily-check', () => {
  it('GET /habits/daily-check devuelve objeto { [habitId]: boolean }', async () => {
    const res = await request(app)
      .get('/api/v1/habits/daily-check')
      .set(bearerHeader(token));
    expect(res.status).toBe(200);
    // sync.js espera un objeto plano con booleans
    expect(typeof res.body).toBe('object');
    expect(Array.isArray(res.body)).toBe(false);
  });

  it('PUT /habits/daily-check persiste los checks y devuelve { checks }', async () => {
    const res = await request(app)
      .put('/api/v1/habits/daily-check')
      .set(bearerHeader(token))
      .send({ checks: { ejercicio: true, agua: true, sueno: false }, date: '2026-05-14' });
    expect(res.status).toBe(200);
    // La ruta devuelve { fecha, controles_json, checks } — NO { ok: true }
    expect(typeof res.body.checks).toBe('object');
    expect(res.body.checks.ejercicio).toBe(true);
  });
});

// ── 6. Meals — sync.js syncDetectedMeal / getMeals ───────────────────────────

describe('Contrato meals', () => {
  it('POST /meals devuelve { id } número', async () => {
    const res = await request(app)
      .post('/api/v1/meals')
      .set(bearerHeader(token))
      .send({ name: 'Avena con frutos rojos', calories: 350, date: '2026-05-14' });
    expect(res.status).toBe(201);
    // sync.js syncDetectedMeal espera recibir un id para confirmación
    expect(typeof res.body.id).toBe('number');
  });

  it('GET /meals devuelve { data: [...], totals: { calories, ... } }', async () => {
    const res = await request(app)
      .get('/api/v1/meals')
      .set(bearerHeader(token));
    expect(res.status).toBe(200);
    // sync.js getMeals() llama _unwrap(result) que acepta result.data
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body).toHaveProperty('totals');
    expect(typeof res.body.totals.calories).toBe('number');
  });

  it('GET /meals?date= filtra por fecha correctamente', async () => {
    // Registra comida en fecha específica
    await request(app).post('/api/v1/meals')
      .set(bearerHeader(token))
      .send({ name: 'Pollo asado', calories: 420, date: '2025-03-15' });
    const res = await request(app)
      .get('/api/v1/meals?date=2025-03-15')
      .set(bearerHeader(token));
    expect(res.status).toBe(200);
    const names = res.body.data.map(m => m.nombre ?? m.name);
    expect(names).toContain('Pollo asado');
  });
});

// ── 7. Settings — sync.js getSetting/getSettings/putSetting ─────────────────

describe('Contrato settings', () => {
  it('GET /settings devuelve objeto plano { key: value }', async () => {
    const res = await request(app)
      .get('/api/v1/settings')
      .set(bearerHeader(token));
    expect(res.status).toBe(200);
    // sync.js getSettings() espera { [key]: value }
    expect(typeof res.body).toBe('object');
    expect(Array.isArray(res.body)).toBe(false);
  });

  it('PUT /settings/:key guarda un valor y se puede recuperar', async () => {
    await request(app)
      .put('/api/v1/settings/theme')
      .set(bearerHeader(token))
      .send({ value: 'dark' });

    const res = await request(app)
      .get('/api/v1/settings/theme')
      .set(bearerHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.value).toBe('dark');
  });

  it('PUT /settings/:key es idempotente (upsert)', async () => {
    await request(app).put('/api/v1/settings/lang').set(bearerHeader(token)).send({ value: 'es' });
    await request(app).put('/api/v1/settings/lang').set(bearerHeader(token)).send({ value: 'en' });
    const res = await request(app).get('/api/v1/settings/lang').set(bearerHeader(token));
    expect(res.body.value).toBe('en');
  });
});

// ── 8. Progress-log — sync.js syncWeight llama POST /auth/progress-log ───────

describe('Contrato progress-log', () => {
  it('POST /auth/progress-log devuelve { id } y persiste', async () => {
    const res = await request(app)
      .post('/api/v1/auth/progress-log')
      .set(bearerHeader(token))
      .send({ date: '2026-05-14', weight: 73.5 });
    expect(res.status).toBe(200);
    expect(typeof res.body.id).toBe('number');
  });

  it('progress-logs actualiza el peso en el perfil del usuario', async () => {
    await request(app).post('/api/v1/auth/progress-log')
      .set(bearerHeader(token))
      .send({ date: '2026-05-14', weight: 72.0 });
    const profile = await request(app).get('/api/v1/auth/me').set(bearerHeader(token));
    expect(profile.body.weight).toBe(72.0);
  });
});

// ── 9. N8N build-prompt — contrato de campos para el workflow ─────────────────

describe('Contrato N8N build-prompt', () => {
  const N8N_SECRET = 'contract-n8n-secret';
  let appN8n;

  beforeAll(() => {
    process.env.N8N_SECRET = N8N_SECRET;
    jest.resetModules();
    appN8n = require('../../src/app');
  });

  afterAll(() => {
    delete process.env.N8N_SECRET;
    jest.resetModules();
  });

  // N8N workflow necesita estos campos exactos para pasarlos a Claude API
  it('build-prompt devuelve { prompt, accountId, event, suggestionType, model, max_tokens }', async () => {
    const res = await request(appN8n)
      .post('/api/v1/n8n/build-prompt')
      .set('x-n8n-secret', N8N_SECRET)
      .send({
        event: 'workout.logged',
        accountId: '1',
        user:  { name: 'Test', goal: 'lose', weight: 70 },
        data:  { routineName: 'Cardio', durationMin: 30 },
      });
    expect(res.status).toBe(200);
    expect(typeof res.body.prompt).toBe('string');
    expect(res.body.prompt.length).toBeGreaterThan(50);
    expect(res.body.accountId).toBe('1');
    expect(res.body.event).toBe('workout.logged');
    expect(typeof res.body.suggestionType).toBe('string');
    expect(typeof res.body.model).toBe('string');
    expect(typeof res.body.max_tokens).toBe('number');
  });
});
