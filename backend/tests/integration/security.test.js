'use strict';

/**
 * Security tests — Verifica que los controles de seguridad estén en su lugar.
 * No cubre exploits completos (eso requiere un pentest real), sino que verifica
 * que las protecciones básicas respondan correctamente.
 */

jest.mock('../../src/db/postgres', () => require('../helpers/mockPostgres').mockPg);
jest.mock('../../src/services/visionClient', () => require('../helpers/mockVision').mockVision);

const request = require('supertest');
const { registerUser, bearerHeader } = require('../helpers/auth');

let app, token;
beforeAll(async () => {
  app = require('../../src/app');
  ({ token } = await registerUser(app));
});

describe('Headers de seguridad (Helmet)', () => {
  it('no expone X-Powered-By', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('incluye X-Content-Type-Options', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('Autenticación — Bearer token obligatorio', () => {
  const PROTECTED = [
    // auth
    ['GET',    '/api/v1/auth/me'],
    ['PUT',    '/api/v1/auth/profile'],
    ['GET',    '/api/v1/auth/chat-history'],
    ['POST',   '/api/v1/auth/chat-history'],
    ['POST',   '/api/v1/auth/workout-log'],
    ['GET',    '/api/v1/auth/workout-logs'],
    ['POST',   '/api/v1/auth/diet-log'],
    ['GET',    '/api/v1/auth/diet-logs'],
    ['POST',   '/api/v1/auth/progress-log'],
    ['GET',    '/api/v1/auth/progress-logs'],
    ['POST',   '/api/v1/auth/ai-suggestion'],
    ['GET',    '/api/v1/auth/ai-suggestions'],
    // habits
    ['GET',    '/api/v1/habits/water'],
    ['PUT',    '/api/v1/habits/water'],
    ['GET',    '/api/v1/habits/daily-check'],
    ['PUT',    '/api/v1/habits/daily-check'],
    // meals
    ['POST',   '/api/v1/meals'],
    ['GET',    '/api/v1/meals'],
    // settings
    ['GET',    '/api/v1/settings'],
    ['GET',    '/api/v1/settings/theme'],
    ['PUT',    '/api/v1/settings/theme'],
    ['DELETE', '/api/v1/settings/theme'],
    // reps
    ['POST',   '/api/v1/reps/sessions'],
    ['POST',   '/api/v1/reps/sessions/local_123/complete'],
    ['GET',    '/api/v1/reps/sessions/session123'],
    ['GET',    '/api/v1/reps/history'],
    // n8n (Bearer-protected)
    ['GET',    '/api/v1/n8n/status'],
  ];

  it.each(PROTECTED)('%s %s devuelve 401 sin token', async (method, path) => {
    const res = await request(app)[method.toLowerCase()](path).send({});
    expect(res.status).toBe(401);
  });
});

describe('Aislamiento de datos entre usuarios', () => {
  let token1, user1, token2, user2;

  beforeAll(async () => {
    ({ token: token1, user: user1 } = await registerUser(app));
    ({ token: token2, user: user2 } = await registerUser(app));
  });

  it('usuario A no ve los workout logs de usuario B', async () => {
    // Usuario A sube un log
    await request(app)
      .post('/api/v1/auth/workout-log')
      .set(bearerHeader(token1))
      .send({ routineName: 'Rutina Secreta de A', exercises: [] });

    // Usuario B consulta sus logs — no debe ver el de A
    const res = await request(app)
      .get('/api/v1/auth/workout-logs')
      .set(bearerHeader(token2));

    const names = (res.body.data || []).map(l => l.nombre_rutina);
    expect(names).not.toContain('Rutina Secreta de A');
  });

  it('usuario A no puede leer /me con el token de usuario B', async () => {
    const resA = await request(app).get('/api/v1/auth/me').set(bearerHeader(token1));
    const resB = await request(app).get('/api/v1/auth/me').set(bearerHeader(token2));
    expect(resA.body.email).toBe(user1.email);
    expect(resB.body.email).toBe(user2.email);
    expect(resA.body.email).not.toBe(resB.body.email);
  });

  it('actualizar perfil de A con token de B no afecta a A', async () => {
    await request(app)
      .put('/api/v1/auth/profile')
      .set(bearerHeader(token2))
      .send({ name: 'Hacked by B' });

    const resA = await request(app).get('/api/v1/auth/me').set(bearerHeader(token1));
    expect(resA.body.name).not.toBe('Hacked by B');
  });
});

describe('Límite de payload', () => {
  it('rechaza cuerpos JSON > 1 MB con 413', async () => {
    const huge = 'x'.repeat(1_100_000);
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'a@b.com', password: 'abc123', name: huge });
    expect([413, 400]).toContain(res.status); // Express lo corta en 413
  });
});

describe('CORS', () => {
  it('permite origen permitido', async () => {
    const res = await request(app)
      .options('/api/v1/auth/login')
      .set('Origin', 'http://localhost:8080')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.status).toBe(204);
  });

  it('rechaza origen no permitido con error CORS', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', 'http://evil-site.com');
    // Helmet + CORS: bien podría ser 500 o el header ausente
    const hasHeader = !!res.headers['access-control-allow-origin'];
    if (hasHeader) {
      expect(res.headers['access-control-allow-origin']).not.toBe('http://evil-site.com');
    } else {
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
  });
});

describe('Inyección SQL — resistencia básica', () => {
  it('email con comillas simples no rompe el servidor', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({
      email: "' OR '1'='1", password: 'noop',
    });
    expect([400, 401]).toContain(res.status);
    expect(res.status).not.toBe(500);
  });

  it('password con metacaracteres SQL no rompe el servidor', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: `sqli_${Date.now()}@test.com`,
      password: "'; DROP TABLE accounts; --",
    });
    // La contraseña tiene < 6 chars útiles... pero el punto es que no crashea
    expect(res.status).not.toBe(500);
  });
});

// ── n8n — secreto de servidor requerido ──────────────────────────────────────

describe('n8n — secreto de servidor requerido (x-n8n-secret)', () => {
  it.each([
    ['POST', '/api/v1/n8n/build-prompt', { event: 'workout.logged', accountId: '1' }],
    ['POST', '/api/v1/n8n/callback',     { accountId: '1', suggestion: 'Test' }],
    ['GET',  '/api/v1/n8n/weekly-users', null],
  ])('%s %s sin secreto → 401', async (method, path, body) => {
    const req = request(app)[method.toLowerCase()](path);
    if (body) req.send(body);
    const res = await req;
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });
});

// ── Hábitos — validación de inputs ───────────────────────────────────────────

describe('Hábitos — validación de inputs', () => {
  it('PUT /habits/water sin vasos → 400', async () => {
    const res = await request(app)
      .put('/api/v1/habits/water')
      .set(bearerHeader(token))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/vasos/i);
  });

  it('PUT /habits/water vasos negativo → 400', async () => {
    const res = await request(app)
      .put('/api/v1/habits/water')
      .set(bearerHeader(token))
      .send({ vasos: -1 });
    expect(res.status).toBe(400);
  });

  it('PUT /habits/daily-check sin checks → 400', async () => {
    const res = await request(app)
      .put('/api/v1/habits/daily-check')
      .set(bearerHeader(token))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/checks/i);
  });

  it('PUT /habits/daily-check con array en lugar de objeto → 400', async () => {
    const res = await request(app)
      .put('/api/v1/habits/daily-check')
      .set(bearerHeader(token))
      .send({ checks: ['agua'] });
    expect(res.status).toBe(400);
  });

  it('PUT /habits/daily-check con valor no-boolean → 400', async () => {
    const res = await request(app)
      .put('/api/v1/habits/daily-check')
      .set(bearerHeader(token))
      .send({ checks: { agua: 'sí' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/boolean/i);
  });
});

// ── Comidas — validación de inputs ───────────────────────────────────────────

describe('Comidas — validación de inputs', () => {
  it('POST /meals sin name → 400', async () => {
    const res = await request(app)
      .post('/api/v1/meals')
      .set(bearerHeader(token))
      .send({ calories: 300 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/i);
  });

  it('POST /meals sin calories → 400', async () => {
    const res = await request(app)
      .post('/api/v1/meals')
      .set(bearerHeader(token))
      .send({ name: 'Arroz con pollo' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/calories/i);
  });

  it('POST /meals calories negativas → 400', async () => {
    const res = await request(app)
      .post('/api/v1/meals')
      .set(bearerHeader(token))
      .send({ name: 'Arroz', calories: -50 });
    expect(res.status).toBe(400);
  });
});

// ── Configuración — validación y acceso ──────────────────────────────────────

describe('Configuración — validación y acceso', () => {
  it('PUT /settings/:key clave demasiado larga → 400', async () => {
    const res = await request(app)
      .put(`/api/v1/settings/${'k'.repeat(65)}`)
      .set(bearerHeader(token))
      .send({ value: 'dark' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/clave/i);
  });

  it('PUT /settings/:key sin value → 400', async () => {
    const res = await request(app)
      .put('/api/v1/settings/theme')
      .set(bearerHeader(token))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/value/i);
  });

  it('PUT /settings/:key value no-string → 400', async () => {
    const res = await request(app)
      .put('/api/v1/settings/theme')
      .set(bearerHeader(token))
      .send({ value: 42 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/string/i);
  });

  it('GET /settings/:key clave no encontrada → 404', async () => {
    const res = await request(app)
      .get('/api/v1/settings/clave-inexistente-xyz')
      .set(bearerHeader(token));
    expect(res.status).toBe(404);
  });
});

// ── Reps — validación de ejercicio ───────────────────────────────────────────

describe('Reps — validación de exerciseType', () => {
  it('POST /reps/sessions sin exerciseType → 400', async () => {
    const res = await request(app)
      .post('/api/v1/reps/sessions')
      .set(bearerHeader(token))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exerciseType/i);
  });

  it('POST /reps/sessions tipo inválido → 400', async () => {
    const res = await request(app)
      .post('/api/v1/reps/sessions')
      .set(bearerHeader(token))
      .send({ exerciseType: 'VOLTERETA_LATERAL' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('POST /reps/sessions tipo válido (squat) → modo fallback 200', async () => {
    const res = await request(app)
      .post('/api/v1/reps/sessions')
      .set(bearerHeader(token))
      .send({ exerciseType: 'squat' });
    expect(res.status).toBe(200);
    expect(res.body.fallback).toBe(true);
    expect(res.body.mode).toBe('mediapipe');
  });
});

// ── Aislamiento de datos — comidas ────────────────────────────────────────────

describe('Aislamiento de datos — comidas', () => {
  let tokenA, tokenB;

  beforeAll(async () => {
    ({ token: tokenA } = await registerUser(app));
    ({ token: tokenB } = await registerUser(app));
  });

  it('usuario A no ve las comidas de usuario B', async () => {
    await request(app)
      .post('/api/v1/meals')
      .set(bearerHeader(tokenA))
      .send({ name: 'Cena secreta de A', calories: 850 });

    const res = await request(app)
      .get('/api/v1/meals')
      .set(bearerHeader(tokenB));

    expect(res.status).toBe(200);
    const names = (res.body.data || []).map(m => m.nombre);
    expect(names).not.toContain('Cena secreta de A');
  });

  it('usuario B sí ve sus propias comidas', async () => {
    await request(app)
      .post('/api/v1/meals')
      .set(bearerHeader(tokenB))
      .send({ name: 'Desayuno de B', calories: 400 });

    const res = await request(app)
      .get('/api/v1/meals')
      .set(bearerHeader(tokenB));

    expect(res.status).toBe(200);
    const names = (res.body.data || []).map(m => m.nombre);
    expect(names).toContain('Desayuno de B');
  });
});
