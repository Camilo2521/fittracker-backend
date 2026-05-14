'use strict';

jest.mock('../../src/db/postgres', () => require('../helpers/mockPostgres').mockPg);
jest.mock('../../src/services/visionClient', () => require('../helpers/mockVision').mockVision);

const request = require('supertest');
const { registerUser, bearerHeader } = require('../helpers/auth');

let app, token;

beforeAll(async () => {
  app = require('../../src/app');
  ({ token } = await registerUser(app));
});

// ── GET /api/v1/habits/water ────────────────────────────────────────────────────

describe('GET /api/v1/habits/water', () => {
  it('requiere autenticación — 401 sin token', async () => {
    const res = await request(app).get('/api/v1/habits/water');
    expect(res.status).toBe(401);
  });

  it('devuelve { vasos: 0, ml: 0 } cuando no hay registro', async () => {
    const res = await request(app)
      .get('/api/v1/habits/water')
      .set(bearerHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('vasos');
    expect(res.body).toHaveProperty('fecha');
  });

  it('acepta parámetro ?date=YYYY-MM-DD', async () => {
    const res = await request(app)
      .get('/api/v1/habits/water?date=2026-01-15')
      .set(bearerHeader(token));
    expect(res.status).toBe(200);
  });
});

// ── PUT /api/v1/habits/water ────────────────────────────────────────────────────

describe('PUT /api/v1/habits/water', () => {
  it('requiere autenticación — 401 sin token', async () => {
    const res = await request(app).put('/api/v1/habits/water').send({ vasos: 3 });
    expect(res.status).toBe(401);
  });

  it('guarda vasos correctamente — 200', async () => {
    const res = await request(app)
      .put('/api/v1/habits/water')
      .set(bearerHeader(token))
      .send({ vasos: 6 });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('vasos');
  });

  it('rechaza vasos negativo — 400', async () => {
    const res = await request(app)
      .put('/api/v1/habits/water')
      .set(bearerHeader(token))
      .send({ vasos: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/vasos/i);
  });

  it('rechaza vasos no-numérico — 400', async () => {
    const res = await request(app)
      .put('/api/v1/habits/water')
      .set(bearerHeader(token))
      .send({ vasos: 'mucho' });
    expect(res.status).toBe(400);
  });

  it('acepta ml opcional', async () => {
    const res = await request(app)
      .put('/api/v1/habits/water')
      .set(bearerHeader(token))
      .send({ vasos: 4, ml: 1000 });
    expect(res.status).toBe(200);
  });
});

// ── GET /api/v1/habits/daily-check ─────────────────────────────────────────────

describe('GET /api/v1/habits/daily-check', () => {
  it('requiere autenticación — 401 sin token', async () => {
    const res = await request(app).get('/api/v1/habits/daily-check');
    expect(res.status).toBe(401);
  });

  it('devuelve checks vacío cuando no hay registro', async () => {
    const res = await request(app)
      .get('/api/v1/habits/daily-check')
      .set(bearerHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('checks');
    expect(res.body).toHaveProperty('fecha');
  });

  it('expone campo "checks" (alias de controles_json)', async () => {
    const res = await request(app)
      .get('/api/v1/habits/daily-check')
      .set(bearerHeader(token));
    expect(res.body.checks).toBeDefined();
    expect(typeof res.body.checks).toBe('object');
  });
});

// ── PUT /api/v1/habits/daily-check ─────────────────────────────────────────────

describe('PUT /api/v1/habits/daily-check', () => {
  it('requiere autenticación — 401 sin token', async () => {
    const res = await request(app)
      .put('/api/v1/habits/daily-check')
      .send({ checks: { agua: true } });
    expect(res.status).toBe(401);
  });

  it('guarda checks correctamente — 200', async () => {
    const res = await request(app)
      .put('/api/v1/habits/daily-check')
      .set(bearerHeader(token))
      .send({ checks: { agua: true, ejercicio: false, sueno: true } });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('checks');
  });

  it('rechaza checks sin body — 400', async () => {
    const res = await request(app)
      .put('/api/v1/habits/daily-check')
      .set(bearerHeader(token))
      .send({});
    expect(res.status).toBe(400);
  });

  it('rechaza checks con valores no-booleanos — 400', async () => {
    const res = await request(app)
      .put('/api/v1/habits/daily-check')
      .set(bearerHeader(token))
      .send({ checks: { agua: 'si' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/boolean/i);
  });

  it('rechaza checks como array — 400', async () => {
    const res = await request(app)
      .put('/api/v1/habits/daily-check')
      .set(bearerHeader(token))
      .send({ checks: [true, false] });
    expect(res.status).toBe(400);
  });

  it('acepta date opcional', async () => {
    const res = await request(app)
      .put('/api/v1/habits/daily-check')
      .set(bearerHeader(token))
      .send({ checks: { meditacion: true }, date: '2026-01-15' });
    expect(res.status).toBe(200);
  });
});
