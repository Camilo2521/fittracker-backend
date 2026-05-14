'use strict';

jest.mock('../../src/db/postgres', () => require('../helpers/mockPostgres').mockPg);
jest.mock('../../src/services/visionClient', () => require('../helpers/mockVision').mockVision);

const request = require('supertest');
const { mockPg } = require('../helpers/mockPostgres');
const { mockVision } = require('../helpers/mockVision');
const { makeToken, bearerHeader } = require('../helpers/auth');
const { FLAGS } = require('../../src/middleware/featureFlags');

const TOKEN = makeToken(1);

let app;
beforeAll(() => {
  app = require('../../src/app');
});

// ── POST /api/v1/routines/generate ────────────────────────────────────────────

describe('POST /api/v1/routines/generate', () => {
  describe('Autenticación', () => {
    it('rechaza sin token (401)', async () => {
      const res = await request(app).post('/api/v1/routines/generate').send({ goal: 'lose' });
      expect(res.status).toBe(401);
    });
  });

  describe('Generador local — RAG deshabilitado', () => {
    it('devuelve plan "lose" con 4 días', async () => {
      const res = await request(app)
        .post('/api/v1/routines/generate')
        .set(bearerHeader(TOKEN))
        .send({ goal: 'lose' });
      expect(res.status).toBe(200);
      expect(res.body.weeklyDays).toBe(4);
      expect(res.body.days).toHaveLength(4);
    });

    it('devuelve plan "gain" con 5 días', async () => {
      const res = await request(app)
        .post('/api/v1/routines/generate')
        .set(bearerHeader(TOKEN))
        .send({ goal: 'gain' });
      expect(res.status).toBe(200);
      expect(res.body.weeklyDays).toBe(5);
    });

    it('devuelve plan "maintain" con 3 días', async () => {
      const res = await request(app)
        .post('/api/v1/routines/generate')
        .set(bearerHeader(TOKEN))
        .send({ goal: 'maintain' });
      expect(res.status).toBe(200);
      expect(res.body.weeklyDays).toBe(3);
    });

    it('objetivo desconocido hace fallback a "maintain" (3 días)', async () => {
      const res = await request(app)
        .post('/api/v1/routines/generate')
        .set(bearerHeader(TOKEN))
        .send({ goal: 'alien' });
      expect(res.status).toBe(200);
      expect(res.body.weeklyDays).toBe(3);
    });

    it('source es "local"', async () => {
      const res = await request(app)
        .post('/api/v1/routines/generate')
        .set(bearerHeader(TOKEN))
        .send({ goal: 'maintain' });
      expect(res.body.source).toBe('local');
    });

    it('cada día tiene exercises array no vacío', async () => {
      const res = await request(app)
        .post('/api/v1/routines/generate')
        .set(bearerHeader(TOKEN))
        .send({ goal: 'lose' });
      res.body.days.forEach(day => {
        expect(Array.isArray(day.exercises)).toBe(true);
        expect(day.exercises.length).toBeGreaterThan(0);
      });
    });

    it('cada día tiene un foco (focus) definido', async () => {
      const res = await request(app)
        .post('/api/v1/routines/generate')
        .set(bearerHeader(TOKEN))
        .send({ goal: 'gain' });
      res.body.days.forEach(day => {
        expect(day.focus).toBeTruthy();
      });
    });

    it('incluye notas de entrenamiento', async () => {
      const res = await request(app)
        .post('/api/v1/routines/generate')
        .set(bearerHeader(TOKEN))
        .send({ goal: 'lose' });
      expect(res.body.notes).toBeTruthy();
    });
  });

  describe('Fallback cuando RAG falla', () => {
    it('si visionClient falla, devuelve rutina local igualmente', async () => {
      const res = await request(app)
        .post('/api/v1/routines/generate')
        .set(bearerHeader(TOKEN))
        .send({ goal: 'lose' });
      expect(res.status).toBe(200);
      expect(res.body.source).toBe('local');
    });
  });

  describe('Ruta RAG habilitada (FLAGS.rag_enabled = true)', () => {
    beforeEach(() => { FLAGS.rag_enabled = true; });
    afterEach(()  => { FLAGS.rag_enabled = false; mockVision.generateRoutine.mockReset(); });

    it('devuelve datos del servicio RAG cuando ok=true', async () => {
      mockVision.generateRoutine.mockResolvedValueOnce({
        ok:   true,
        data: { source: 'rag', weeklyDays: 5, days: [] },
      });
      const res = await request(app)
        .post('/api/v1/routines/generate')
        .set(bearerHeader(TOKEN))
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.source).toBe('rag');
    });

    it('hace fallback a rutina local cuando RAG devuelve ok=false', async () => {
      mockVision.generateRoutine.mockResolvedValueOnce({ ok: false, fallback: true });
      const res = await request(app)
        .post('/api/v1/routines/generate')
        .set(bearerHeader(TOKEN))
        .send({ goal: 'maintain' });
      expect(res.status).toBe(200);
      expect(res.body.source).toBe('local');
    });
  });
});

// ── GET /api/v1/routines/active ───────────────────────────────────────────────

describe('GET /api/v1/routines/active', () => {
  it('rechaza sin token (401)', async () => {
    const res = await request(app).get('/api/v1/routines/active');
    expect(res.status).toBe(401);
  });

  it('devuelve 404 cuando no hay rutina activa en postgres', async () => {
    mockPg.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get('/api/v1/routines/active')
      .set(bearerHeader(TOKEN));
    expect(res.status).toBe(404);
  });

  it('devuelve 404 con mensaje amigable cuando la tabla no existe', async () => {
    const pgError = new Error('relation "routines" does not exist');
    pgError.code = '42P01';
    mockPg.query.mockRejectedValueOnce(pgError);
    const res = await request(app)
      .get('/api/v1/routines/active')
      .set(bearerHeader(TOKEN));
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/disponible/i);
  });

  it('devuelve 503 ante error de conexión inesperado', async () => {
    mockPg.query.mockRejectedValueOnce(new Error('connection refused'));
    const res = await request(app)
      .get('/api/v1/routines/active')
      .set(bearerHeader(TOKEN));
    expect(res.status).toBe(503);
  });
});
