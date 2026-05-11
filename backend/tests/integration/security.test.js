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

let app;
beforeAll(() => {
  app = require('../../src/app');
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
    ['GET',  '/api/v1/auth/me'],
    ['PUT',  '/api/v1/auth/profile'],
    ['GET',  '/api/v1/auth/chat-history'],
    ['POST', '/api/v1/auth/chat-history'],
    ['POST', '/api/v1/auth/workout-log'],
    ['GET',  '/api/v1/auth/workout-logs'],
    ['POST', '/api/v1/auth/diet-log'],
    ['GET',  '/api/v1/auth/diet-logs'],
    ['POST', '/api/v1/auth/progress-log'],
    ['GET',  '/api/v1/auth/progress-logs'],
    ['POST', '/api/v1/auth/ai-suggestion'],
    ['GET',  '/api/v1/auth/ai-suggestions'],
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
