'use strict';

jest.mock('../../src/db/postgres', () => require('../helpers/mockPostgres').mockPg);
jest.mock('../../src/services/visionClient', () => {
  const { mockVision } = require('../helpers/mockVision');
  return mockVision;
});

const request = require('supertest');
const { mockVision, resetMocks } = require('../helpers/mockVision');
const { mockPg } = require('../helpers/mockPostgres');

let app;
beforeAll(() => {
  app = require('../../src/app');
});
afterEach(() => {
  resetMocks();
});

// ── POST /api/v1/reps/sessions ────────────────────────────────────────────────

describe('POST /api/v1/reps/sessions', () => {
  describe('Validación', () => {
    it('rechaza sin userId (400)', async () => {
      const res = await request(app).post('/api/v1/reps/sessions').send({ exerciseType: 'squat' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/userId/i);
    });

    it('rechaza sin exerciseType (400)', async () => {
      const res = await request(app).post('/api/v1/reps/sessions').send({ userId: 'u1' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/exerciseType/i);
    });

    it('rechaza body completamente vacío (400)', async () => {
      const res = await request(app).post('/api/v1/reps/sessions').send({});
      expect(res.status).toBe(400);
    });
  });

  describe('Modo fallback (Python no disponible)', () => {
    it('devuelve sessionId local cuando Python no responde', async () => {
      // mockVision.createSession devuelve fallback por defecto
      const res = await request(app).post('/api/v1/reps/sessions').send({
        userId: 'u1', exerciseType: 'squat',
      });
      expect(res.status).toBe(200);
      expect(res.body.sessionId).toMatch(/^local_/);
      expect(res.body.fallback).toBe(true);
    });

    it('el modo offline es "mediapipe"', async () => {
      const res = await request(app).post('/api/v1/reps/sessions').send({
        userId: 'u1', exerciseType: 'pushup',
      });
      expect(res.body.mode).toBe('mediapipe');
    });

    it('incluye mensaje informativo', async () => {
      const res = await request(app).post('/api/v1/reps/sessions').send({
        userId: 'u1', exerciseType: 'lunge',
      });
      expect(res.body.message).toBeTruthy();
    });
  });

  describe('Modo online (Python disponible)', () => {
    it('devuelve la respuesta del servicio Python cuando está disponible', async () => {
      mockVision.createSession.mockResolvedValueOnce({
        ok: true,
        data: { sessionId: 'py-session-abc', mode: 'yolo', status: 'active' },
      });
      const res = await request(app).post('/api/v1/reps/sessions').send({
        userId: 'u1', exerciseType: 'squat',
      });
      expect(res.status).toBe(201);
      expect(res.body.sessionId).toBe('py-session-abc');
      expect(res.body.mode).toBe('yolo');
    });

    it('propaga el status code de error de Python', async () => {
      mockVision.createSession.mockResolvedValueOnce({
        ok: false, fallback: false, status: 422,
        data: { error: 'exerciseType no soportado' },
      });
      const res = await request(app).post('/api/v1/reps/sessions').send({
        userId: 'u1', exerciseType: 'invalid_exercise',
      });
      expect(res.status).toBe(422);
    });
  });
});

// ── POST /api/v1/reps/sessions/:id/complete ───────────────────────────────────

describe('POST /api/v1/reps/sessions/:id/complete', () => {
  describe('Sesión local (id empieza con "local_")', () => {
    it('completa una sesión local devolviendo los stats enviados', async () => {
      const res = await request(app)
        .post('/api/v1/reps/sessions/local_1234567890/complete')
        .send({ totalReps: 30, totalSets: 3, exerciseType: 'squat', caloriesBurned: 120, avgFormScore: 0.85 });
      expect(res.status).toBe(200);
      expect(res.body.totalReps).toBe(30);
      expect(res.body.totalSets).toBe(3);
      expect(res.body.caloriesBurned).toBe(120);
      expect(res.body.avgFormScore).toBe(0.85);
      expect(res.body.persisted).toBe(true);
    });

    it('devuelve ceros cuando no se envían stats', async () => {
      const res = await request(app)
        .post('/api/v1/reps/sessions/local_9999/complete')
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.totalReps).toBe(0);
      expect(res.body.caloriesBurned).toBe(0);
    });

    it('mode siempre es "mediapipe" para sesiones locales', async () => {
      const res = await request(app)
        .post('/api/v1/reps/sessions/local_abc/complete')
        .send({ totalReps: 10 });
      expect(res.body.mode).toBe('mediapipe');
    });

    it('sessionId en la respuesta coincide con el del path', async () => {
      const id  = 'local_1111111111';
      const res = await request(app)
        .post(`/api/v1/reps/sessions/${id}/complete`)
        .send({ totalReps: 20 });
      expect(res.body.sessionId).toBe(id);
    });
  });

  describe('Sesión remota (Python)', () => {
    it('propaga la respuesta del servicio Python al completar', async () => {
      mockVision.completeSession.mockResolvedValueOnce({
        ok: true,
        data: { sessionId: 'py-abc', totalReps: 45, calories: 180, summary: 'great form' },
      });
      const res = await request(app)
        .post('/api/v1/reps/sessions/py-abc/complete')
        .send({ totalReps: 45 });
      expect(res.status).toBe(200);
      expect(res.body.totalReps).toBe(45);
    });

    it('devuelve 502 cuando Python falla', async () => {
      mockVision.completeSession.mockResolvedValueOnce({
        ok: false, fallback: false, status: 502, data: { error: 'session not found' },
      });
      const res = await request(app)
        .post('/api/v1/reps/sessions/py-xyz/complete')
        .send({});
      expect(res.status).toBe(502);
    });
  });
});

// ── GET /api/v1/reps/sessions/:id ─────────────────────────────────────────────

describe('GET /api/v1/reps/sessions/:id', () => {
  it('devuelve los datos de sesión cuando Python responde', async () => {
    mockVision.getSession.mockResolvedValueOnce({
      ok: true, data: { sessionId: 'py-abc', totalReps: 30, status: 'completed' },
    });
    const res = await request(app).get('/api/v1/reps/sessions/py-abc');
    expect(res.status).toBe(200);
    expect(res.body.totalReps).toBe(30);
  });

  it('devuelve 502 cuando Python no responde', async () => {
    const res = await request(app).get('/api/v1/reps/sessions/py-xyz');
    expect(res.status).toBe(502);
  });
});

// ── GET /api/v1/reps/history/:userId ──────────────────────────────────────────

describe('GET /api/v1/reps/history/:userId', () => {
  it('devuelve array vacío cuando postgres no tiene datos', async () => {
    mockPg.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/v1/reps/history/user-abc');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('devuelve los datos de postgres cuando existen', async () => {
    mockPg.query.mockResolvedValueOnce({
      rows: [
        { id: 1, exercise_type: 'squat', total_reps: 30, started_at: '2024-04-01T10:00:00Z' },
        { id: 2, exercise_type: 'pushup', total_reps: 20, started_at: '2024-04-02T10:00:00Z' },
      ],
    });
    const res = await request(app).get('/api/v1/reps/history/user-abc');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].exercise_type).toBe('squat');
  });

  it('devuelve 500 ante error de base de datos', async () => {
    mockPg.query.mockRejectedValueOnce(new Error('DB error'));
    const res = await request(app).get('/api/v1/reps/history/user-abc');
    expect(res.status).toBe(500);
  });
});
