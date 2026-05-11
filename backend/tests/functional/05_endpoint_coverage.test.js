'use strict';

/**
 * FUNCTIONAL TEST — 05: Endpoint Coverage & Optimization
 * ─────────────────────────────────────────────────────────────────────────────
 * Verifica que:
 *   • Todos los endpoints responden (no 404 inesperado)
 *   • Los tiempos de respuesta son aceptables para endpoints no-IA (< 500ms)
 *   • Las respuestas de error tienen siempre un campo "error" legible
 *   • Los Content-Type son correctos
 *   • Los campos requeridos están en todas las respuestas
 *   • Los límites de payload (1MB) se aplican
 *   • El manejo de métodos HTTP incorrectos devuelve 404
 *   • Los endpoints de lectura son idempotentes (GET repetido = mismo resultado)
 */

jest.mock('../../src/db/postgres', () => require('../helpers/mockPostgres').mockPg);
jest.mock('../../src/services/visionClient', () => require('../helpers/mockVision').mockVision);
jest.mock('../../src/services/ollamaService', () => ({
  isAvailable: jest.fn().mockResolvedValue(false),
  getModel: () => 'llama3.2',
}));

const request = require('supertest');
const { registerUser, bearerHeader } = require('../helpers/auth');

let app;
beforeAll(() => {
  app = require('../../src/app');
});

// ── Helper de tiempo ───────────────────────────────────────────────────────────
async function timed(fn) {
  const start = Date.now();
  const res   = await fn();
  return { res, ms: Date.now() - start };
}

// ── 1. Catálogo completo de endpoints — todos responden ───────────────────────

describe('Cobertura de endpoints — catálogo completo', () => {
  let token, userId;
  beforeAll(async () => {
    const r = await registerUser(app, { weight: 70, height: 175, age: 28, gender: 'male' });
    token  = r.token;
    userId = String(r.user.id);
  });

  const publicEndpoints = [
    { method: 'get',  path: '/health',                 desc: 'Health check' },
    { method: 'post', path: '/api/v1/auth/register',   desc: 'Registro (email dup → 409)' },
    { method: 'post', path: '/api/v1/auth/login',      desc: 'Login (malas creds → 401)' },
  ];

  const publicWithBody = [
    { method: 'post', path: '/api/v1/progress/metrics', body: { userId: 'x', weight: 70, heightCm: 175, age: 28 }, desc: 'Métricas' },
    { method: 'post', path: '/api/v1/routines/generate', body: { userId: 'x', goal: 'maintain' }, desc: 'Generar rutina' },
    { method: 'post', path: '/api/v1/diets/generate',   body: { userId: 'x', weekStart: '2024-01-01' }, desc: 'Generar dieta' },
    { method: 'post', path: '/api/v1/ai/chat',          body: { messages: [{ role: 'user', content: 'Hola' }] }, desc: 'AI chat' },
    { method: 'get',  path: '/api/v1/ai/status',        body: null, desc: 'AI status' },
    { method: 'get',  path: '/api/v1/ai/memory',        body: null, desc: 'AI memory' },
  ];

  it.each(publicEndpoints)('$method $path — $desc responde sin 500', async ({ method, path }) => {
    const res = await request(app)[method](path).send({});
    expect(res.status).not.toBe(500);
    expect(res.status).not.toBe(404);
  });

  it.each(publicWithBody)('$method $path — $desc responde sin 500', async ({ method, path, body }) => {
    const req = request(app)[method](path);
    if (body) req.send(body);
    const res = await req;
    expect(res.status).not.toBe(500);
  });

  const authEndpoints = [
    { method: 'get',  path: '/api/v1/auth/me' },
    { method: 'get',  path: '/api/v1/auth/chat-history' },
    { method: 'get',  path: '/api/v1/auth/workout-logs' },
    { method: 'get',  path: '/api/v1/auth/diet-logs' },
    { method: 'get',  path: '/api/v1/auth/progress-logs' },
    { method: 'get',  path: '/api/v1/auth/ai-suggestions' },
  ];

  it.each(authEndpoints)('$method $path — autenticado → 200', async ({ method, path }) => {
    const res = await request(app)[method](path).set(bearerHeader(token));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/i);
  });
});

// ── 2. Tiempos de respuesta ────────────────────────────────────────────────────

describe('Optimización — tiempos de respuesta (< 500 ms para endpoints síncronos)', () => {
  let token;
  beforeAll(async () => {
    ({ token } = await registerUser(app));
  });

  it('GET /health < 100 ms', async () => {
    const { ms } = await timed(() => request(app).get('/health'));
    expect(ms).toBeLessThan(100);
  });

  it('GET /api/v1/auth/me < 50 ms (SQLite síncrono)', async () => {
    const { ms } = await timed(() => request(app).get('/api/v1/auth/me').set(bearerHeader(token)));
    expect(ms).toBeLessThan(50);
  });

  it('GET /api/v1/auth/workout-logs < 50 ms', async () => {
    const { ms } = await timed(() => request(app).get('/api/v1/auth/workout-logs').set(bearerHeader(token)));
    expect(ms).toBeLessThan(50);
  });

  it('POST /api/v1/progress/metrics < 100 ms', async () => {
    const { ms } = await timed(() =>
      request(app).post('/api/v1/progress/metrics').send({
        userId: 'perf_test', weight: 70, heightCm: 175, age: 28,
      })
    );
    expect(ms).toBeLessThan(100);
  });

  it('POST /api/v1/routines/generate < 100 ms', async () => {
    const { ms } = await timed(() =>
      request(app).post('/api/v1/routines/generate').send({ userId: 'perf_rt', goal: 'lose' })
    );
    expect(ms).toBeLessThan(100);
  });

  it('POST /api/v1/diets/generate < 100 ms', async () => {
    const { ms } = await timed(() =>
      request(app).post('/api/v1/diets/generate').send({ userId: 'perf_dt', weekStart: '2024-01-01' })
    );
    expect(ms).toBeLessThan(100);
  });

  it('POST /api/v1/ai/chat (modo local) < 200 ms', async () => {
    const { ms } = await timed(() =>
      request(app).post('/api/v1/ai/chat').send({
        messages: [{ role: 'user', content: 'Hola' }],
        userProfile: { goal: 'maintain' },
      })
    );
    expect(ms).toBeLessThan(200);
  });

  it('POST /api/v1/auth/register < 500 ms (bcrypt)', async () => {
    const { ms } = await timed(() =>
      request(app).post('/api/v1/auth/register').send({
        email: `perf_${Date.now()}@test.com`,
        password: 'Test1234!',
      })
    );
    expect(ms).toBeLessThan(500);
  });
});

// ── 3. Estructura de respuestas de error ──────────────────────────────────────

describe('Estructura de respuestas de error — siempre JSON con campo "error"', () => {
  let token;
  beforeAll(async () => ({ token } = await registerUser(app)));

  const errorCases = [
    { desc: 'registro sin email',       method: 'post', path: '/api/v1/auth/register',  body: { password: 'abc123' }, expectedStatus: 400 },
    { desc: 'login sin campos',         method: 'post', path: '/api/v1/auth/login',     body: {}, expectedStatus: 400 },
    { desc: 'progress sin userId',      method: 'post', path: '/api/v1/progress/metrics', body: { weight: 70 }, expectedStatus: 401 },
    { desc: 'routines sin userId',      method: 'post', path: '/api/v1/routines/generate', body: {}, expectedStatus: 401 },
    { desc: 'diets sin userId',         method: 'post', path: '/api/v1/diets/generate', body: { weekStart: '2024-01-01' }, expectedStatus: 401 },
    { desc: 'diets doc sin title',      method: 'post', path: '/api/v1/diets/documents', body: { content: 'x' }, expectedStatus: 401 },
    { desc: 'pdf sin dietData',         method: 'post', path: '/api/v1/pdf/diet',       body: {}, expectedStatus: 401 },
    { desc: 'reps sin userId',          method: 'post', path: '/api/v1/reps/sessions',  body: { exerciseType: 'squat' }, expectedStatus: 401 },
    { desc: 'ai/chat messages vacíos',  method: 'post', path: '/api/v1/ai/chat',        body: { messages: [] }, expectedStatus: 400 },
    { desc: 'ai body-scan sin imagen',  method: 'post', path: '/api/v1/ai/body-scan',   body: {}, expectedStatus: 501 },
    { desc: 'ai memory delete sin id',  method: 'delete', path: '/api/v1/ai/memory/k', body: {}, expectedStatus: 401 },
    { desc: 'ruta no registrada',       method: 'get',  path: '/api/v1/nonexistent',   body: null, expectedStatus: 404 },
  ];

  it.each(errorCases)(
    '$desc → $expectedStatus con campo "error" en JSON',
    async ({ method, path, body, expectedStatus }) => {
      const req = request(app)[method](path);
      if (body) req.send(body);
      const res = await req;
      expect(res.status).toBe(expectedStatus);
      expect(res.headers['content-type']).toMatch(/application\/json/i);
      expect(res.body).toHaveProperty('error');
      expect(typeof res.body.error).toBe('string');
      expect(res.body.error.length).toBeGreaterThan(0);
    }
  );

  it('los mensajes de error son legibles (no son objetos ni null)', async () => {
    const cases = [
      request(app).post('/api/v1/auth/register').send({ password: 'abc' }),
      request(app).post('/api/v1/auth/login').send({}),
      request(app).post('/api/v1/progress/metrics').send({ userId: 'x' }),
    ];
    const responses = await Promise.all(cases);
    responses.forEach(res => {
      expect(typeof res.body.error).toBe('string');
      expect(res.body.error).not.toMatch(/\[object Object\]/);
    });
  });
});

// ── 4. Idempotencia de GETs ───────────────────────────────────────────────────

describe('Idempotencia — GETs consecutivos devuelven el mismo resultado', () => {
  let token;
  beforeAll(async () => {
    const r = await registerUser(app);
    token = r.token;
    // Añade algo de datos
    await request(app).post('/api/v1/auth/workout-log')
      .set(bearerHeader(token)).send({ routineName: 'Test idempotente', exercises: [] });
  });

  it('/api/v1/auth/workout-logs es idempotente', async () => {
    const [r1, r2] = await Promise.all([
      request(app).get('/api/v1/auth/workout-logs').set(bearerHeader(token)),
      request(app).get('/api/v1/auth/workout-logs').set(bearerHeader(token)),
    ]);
    expect(r1.body).toEqual(r2.body);
  });

  it('/api/v1/auth/me es idempotente', async () => {
    const [r1, r2] = await Promise.all([
      request(app).get('/api/v1/auth/me').set(bearerHeader(token)),
      request(app).get('/api/v1/auth/me').set(bearerHeader(token)),
    ]);
    expect(r1.body.email).toBe(r2.body.email);
  });

  it('/api/v1/progress/metrics es idempotente', async () => {
    const body = { userId: 'idem_test', weight: 70, heightCm: 175, age: 28 };
    const [r1, r2] = await Promise.all([
      request(app).post('/api/v1/progress/metrics').send(body),
      request(app).post('/api/v1/progress/metrics').send(body),
    ]);
    expect(r1.body.bmi).toBe(r2.body.bmi);
    expect(r1.body.bmr).toBe(r2.body.bmr);
  });
});

// ── 5. Content-Type y formatos de respuesta ────────────────────────────────────

describe('Content-Type — todas las respuestas JSON tienen el header correcto', () => {
  let token;
  beforeAll(async () => ({ token } = await registerUser(app)));

  const jsonEndpoints = [
    { method: 'get', path: '/health' },
    { method: 'get', path: '/api/v1/ai/status' },
    { method: 'get', path: '/api/v1/ai/memory' },
  ];

  it.each(jsonEndpoints)('$method $path → Content-Type: application/json', async ({ method, path }) => {
    const res = await request(app)[method](path);
    expect(res.headers['content-type']).toMatch(/application\/json/i);
  });
});

// ── 6. Límite de payload ──────────────────────────────────────────────────────

describe('Límite de payload (1MB)', () => {
  it('payload > 1MB devuelve 413 o 400 (Express lo corta)', async () => {
    const largeContent = 'x'.repeat(1_100_000);
    const res = await request(app)
      .post('/api/v1/diets/documents')
      .send({ title: 'Oversized', content: largeContent });
    expect([413, 400]).toContain(res.status);
  });
});

// ── 7. Métodos HTTP incorrectos ────────────────────────────────────────────────

describe('Métodos HTTP incorrectos', () => {
  it('DELETE /health → 404 (no definido)', async () => {
    const res = await request(app).delete('/health');
    expect(res.status).toBe(404);
  });

  it('PUT /api/v1/auth/login → 404', async () => {
    const res = await request(app).put('/api/v1/auth/login').send({});
    expect(res.status).toBe(404);
  });

  it('GET /api/v1/auth/register → 404', async () => {
    const res = await request(app).get('/api/v1/auth/register');
    expect(res.status).toBe(404);
  });
});

// ── 8. Paginación y límites de resultados ─────────────────────────────────────

describe('Límites de resultados — no se devuelven conjuntos infinitos', () => {
  let token;
  beforeAll(async () => {
    ({ token } = await registerUser(app));
    // Crea 5 AI suggestions
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/v1/auth/ai-suggestion')
        .set(bearerHeader(token))
        .send({ content: `Sugerencia de prueba ${i + 1}` });
    }
  });

  it('workout-logs devuelve máximo 60', async () => {
    const res = await request(app).get('/api/v1/auth/workout-logs').set(bearerHeader(token));
    expect(res.body.data.length).toBeLessThanOrEqual(60);
  });

  it('diet-logs devuelve máximo 60', async () => {
    const res = await request(app).get('/api/v1/auth/diet-logs').set(bearerHeader(token));
    expect(res.body.data.length).toBeLessThanOrEqual(60);
  });

  it('progress-logs devuelve máximo 90', async () => {
    const res = await request(app).get('/api/v1/auth/progress-logs').set(bearerHeader(token));
    expect(res.body.data.length).toBeLessThanOrEqual(90);
  });

  it('ai-suggestions devuelve máximo 30', async () => {
    const res = await request(app).get('/api/v1/auth/ai-suggestions').set(bearerHeader(token));
    expect(res.body.data.length).toBeLessThanOrEqual(30);
  });

  it('chat-history devuelve máximo 40 mensajes', async () => {
    const res = await request(app).get('/api/v1/auth/chat-history').set(bearerHeader(token));
    expect(res.body.data.length).toBeLessThanOrEqual(40);
  });
});
