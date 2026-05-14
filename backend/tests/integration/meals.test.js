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

// ── POST /api/v1/meals ──────────────────────────────────────────────────────────

describe('POST /api/v1/meals', () => {
  it('requiere autenticación — 401 sin token', async () => {
    const res = await request(app)
      .post('/api/v1/meals')
      .send({ name: 'Arroz', calories: 200 });
    expect(res.status).toBe(401);
  });

  it('guarda una comida detectada — 201', async () => {
    const res = await request(app)
      .post('/api/v1/meals')
      .set(bearerHeader(token))
      .send({ name: 'Pollo a la plancha', calories: 320 });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('nombre');
  });

  it('guarda con todos los campos opcionales — 201', async () => {
    const res = await request(app)
      .post('/api/v1/meals')
      .set(bearerHeader(token))
      .send({
        name: 'Ensalada César',
        calories: 250,
        protein: 18,
        carbs: 12,
        fat: 14,
        confidence: 0.87,
        detectedBy: 'ia',
        date: '2026-01-15',
      });
    expect(res.status).toBe(201);
  });

  it('rechaza sin name — 400', async () => {
    const res = await request(app)
      .post('/api/v1/meals')
      .set(bearerHeader(token))
      .send({ calories: 200 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/i);
  });

  it('rechaza name vacío — 400', async () => {
    const res = await request(app)
      .post('/api/v1/meals')
      .set(bearerHeader(token))
      .send({ name: '   ', calories: 200 });
    expect(res.status).toBe(400);
  });

  it('rechaza calories negativo — 400', async () => {
    const res = await request(app)
      .post('/api/v1/meals')
      .set(bearerHeader(token))
      .send({ name: 'Agua', calories: -10 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/calories/i);
  });

  it('rechaza sin calories — 400', async () => {
    const res = await request(app)
      .post('/api/v1/meals')
      .set(bearerHeader(token))
      .send({ name: 'Pan' });
    expect(res.status).toBe(400);
  });
});

// ── GET /api/v1/meals ───────────────────────────────────────────────────────────

describe('GET /api/v1/meals', () => {
  it('requiere autenticación — 401 sin token', async () => {
    const res = await request(app).get('/api/v1/meals');
    expect(res.status).toBe(401);
  });

  it('devuelve { data, date, totals } — 200', async () => {
    const res = await request(app)
      .get('/api/v1/meals')
      .set(bearerHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('date');
    expect(res.body).toHaveProperty('totals');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('totals tiene calories, protein, carbs, fat', async () => {
    const res = await request(app)
      .get('/api/v1/meals')
      .set(bearerHeader(token));
    const { totals } = res.body;
    expect(totals).toHaveProperty('calories');
    expect(totals).toHaveProperty('protein');
    expect(totals).toHaveProperty('carbs');
    expect(totals).toHaveProperty('fat');
  });

  it('acepta parámetro ?date=YYYY-MM-DD', async () => {
    const res = await request(app)
      .get('/api/v1/meals?date=2026-01-15')
      .set(bearerHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.date).toBe('2026-01-15');
  });
});
