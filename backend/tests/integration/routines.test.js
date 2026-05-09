'use strict';

jest.mock('../../src/db/postgres', () => require('../helpers/mockPostgres').mockPg);
jest.mock('../../src/services/visionClient', () => require('../helpers/mockVision').mockVision);

const request = require('supertest');
const { mockPg } = require('../helpers/mockPostgres');

let app;
beforeAll(() => {
  app = require('../../src/app');
});

// ── POST /api/v1/routines/generate ────────────────────────────────────────────

describe('POST /api/v1/routines/generate', () => {
  describe('Validación', () => {
    it('rechaza sin userId (400)', async () => {
      const res = await request(app).post('/api/v1/routines/generate').send({ goal: 'lose' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/userId/i);
    });
  });

  describe('Generador local — RAG deshabilitado', () => {
    it('devuelve plan "lose" con 4 días', async () => {
      const res = await request(app).post('/api/v1/routines/generate').send({
        userId: 'user-test', goal: 'lose',
      });
      expect(res.status).toBe(200);
      expect(res.body.weeklyDays).toBe(4);
      expect(res.body.days).toHaveLength(4);
    });

    it('devuelve plan "gain" con 5 días', async () => {
      const res = await request(app).post('/api/v1/routines/generate').send({
        userId: 'user-test', goal: 'gain',
      });
      expect(res.status).toBe(200);
      expect(res.body.weeklyDays).toBe(5);
    });

    it('devuelve plan "maintain" con 3 días', async () => {
      const res = await request(app).post('/api/v1/routines/generate').send({
        userId: 'user-test', goal: 'maintain',
      });
      expect(res.status).toBe(200);
      expect(res.body.weeklyDays).toBe(3);
    });

    it('objetivo desconocido hace fallback a "maintain" (3 días)', async () => {
      const res = await request(app).post('/api/v1/routines/generate').send({
        userId: 'user-test', goal: 'alien',
      });
      expect(res.status).toBe(200);
      expect(res.body.weeklyDays).toBe(3);
    });

    it('source es "local"', async () => {
      const res = await request(app).post('/api/v1/routines/generate').send({
        userId: 'user-test', goal: 'maintain',
      });
      expect(res.body.source).toBe('local');
    });

    it('cada día tiene exercises array no vacío', async () => {
      const res = await request(app).post('/api/v1/routines/generate').send({
        userId: 'user-test', goal: 'lose',
      });
      res.body.days.forEach(day => {
        expect(Array.isArray(day.exercises)).toBe(true);
        expect(day.exercises.length).toBeGreaterThan(0);
      });
    });

    it('cada día tiene un foco (focus) definido', async () => {
      const res = await request(app).post('/api/v1/routines/generate').send({
        userId: 'user-test', goal: 'gain',
      });
      res.body.days.forEach(day => {
        expect(day.focus).toBeTruthy();
      });
    });

    it('incluye notas de entrenamiento', async () => {
      const res = await request(app).post('/api/v1/routines/generate').send({
        userId: 'user-test', goal: 'lose',
      });
      expect(res.body.notes).toBeTruthy();
    });
  });

  describe('Fallback cuando RAG falla', () => {
    it('si visionClient falla, devuelve rutina local igualmente', async () => {
      // mockVision ya devuelve fallback por defecto
      const res = await request(app).post('/api/v1/routines/generate').send({
        userId: 'user-test', goal: 'lose',
      });
      expect(res.status).toBe(200);
      expect(res.body.source).toBe('local');
    });
  });
});

// ── GET /api/v1/routines/:userId/active ───────────────────────────────────────

describe('GET /api/v1/routines/:userId/active', () => {
  it('devuelve 404 cuando no hay rutina activa en postgres', async () => {
    // Mock devuelve rows vacíos
    mockPg.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/v1/routines/user-xyz/active');
    expect(res.status).toBe(404);
  });

  it('devuelve 404 con mensaje amigable cuando la tabla no existe', async () => {
    const pgError = new Error('relation "routines" does not exist');
    pgError.code = '42P01';
    mockPg.query.mockRejectedValueOnce(pgError);
    const res = await request(app).get('/api/v1/routines/user-xyz/active');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/disponible/i);
  });

  it('devuelve 503 ante error de conexión inesperado', async () => {
    mockPg.query.mockRejectedValueOnce(new Error('connection refused'));
    const res = await request(app).get('/api/v1/routines/user-xyz/active');
    expect(res.status).toBe(503);
  });
});
