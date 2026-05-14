'use strict';

jest.mock('../../src/db/postgres',       () => require('../helpers/mockPostgres').mockPg);
jest.mock('../../src/services/visionClient', () => require('../helpers/mockVision').mockVision);

const request = require('supertest');
const { registerUser, bearerHeader } = require('../helpers/auth');

let app, token;

beforeAll(async () => {
  app = require('../../src/app');
  ({ token } = await registerUser(app));
});

// ── Feature flag OFF (default en tests) ──────────────────────────────────────

describe('YOLO — feature flag deshabilitado (FEATURE_YOLO_ENABLED=false)', () => {
  it('POST /analyze/:type → 501 cuando el flag está apagado', async () => {
    const res = await request(app)
      .post('/api/v1/yolo/analyze/squat')
      .set(bearerHeader(token))
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('fake-frame'));
    expect(res.status).toBe(501);
    expect(res.body).toHaveProperty('error');
    expect(res.body.flag).toBe('yolo_enabled');
  });

  it('GET /session/:id/summary → 501 cuando el flag está apagado', async () => {
    const res = await request(app)
      .get('/api/v1/yolo/session/abc123/summary')
      .set(bearerHeader(token));
    expect(res.status).toBe(501);
    expect(res.body.flag).toBe('yolo_enabled');
  });

  it('DELETE /session/:id → 501 cuando el flag está apagado', async () => {
    const res = await request(app)
      .delete('/api/v1/yolo/session/abc123')
      .set(bearerHeader(token));
    expect(res.status).toBe(501);
    expect(res.body.flag).toBe('yolo_enabled');
  });
});

// ── Auth required ─────────────────────────────────────────────────────────────

describe('YOLO — autenticación requerida', () => {
  it('POST /analyze/:type → 401 sin token', async () => {
    const res = await request(app)
      .post('/api/v1/yolo/analyze/squat')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('frame'));
    expect(res.status).toBe(401);
  });

  it('GET /session/:id/summary → 401 sin token', async () => {
    const res = await request(app).get('/api/v1/yolo/session/abc/summary');
    expect(res.status).toBe(401);
  });

  it('DELETE /session/:id → 401 sin token', async () => {
    const res = await request(app).delete('/api/v1/yolo/session/abc');
    expect(res.status).toBe(401);
  });
});

// ── Feature flag ON ───────────────────────────────────────────────────────────

describe('YOLO — feature flag habilitado (FEATURE_YOLO_ENABLED=true)', () => {
  beforeAll(() => { process.env.FEATURE_YOLO_ENABLED = 'true'; });
  afterAll(()  => { process.env.FEATURE_YOLO_ENABLED = 'false'; });

  it('POST /analyze/:type — tipo inválido → 400', async () => {
    const res = await request(app)
      .post('/api/v1/yolo/analyze/EJERCICIO_INVALIDO')
      .set(bearerHeader(token))
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('frame'));
    // El guard de validación de exerciseType devuelve 400
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('POST /analyze/:type — Python no disponible → 503', async () => {
    const res = await request(app)
      .post('/api/v1/yolo/analyze/squat')
      .set(bearerHeader(token))
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('fake-jpeg-frame'));
    // Python service está en localhost:9999 (no existe en tests) → 503
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/yolo|disponible/i);
  });

  it('GET /session/:id/summary — Python no disponible → 503', async () => {
    const res = await request(app)
      .get('/api/v1/yolo/session/session123/summary')
      .set(bearerHeader(token));
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/yolo|disponible/i);
  });

  it('DELETE /session/:id — Python no disponible → 503', async () => {
    const res = await request(app)
      .delete('/api/v1/yolo/session/session123')
      .set(bearerHeader(token));
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/yolo|disponible/i);
  });
});

// ── Tipos de ejercicio válidos ────────────────────────────────────────────────

describe('YOLO — validación de exerciseType', () => {
  beforeAll(() => { process.env.FEATURE_YOLO_ENABLED = 'true'; });
  afterAll(()  => { process.env.FEATURE_YOLO_ENABLED = 'false'; });

  const VALID_TYPES = ['squat', 'pushup', 'deadlift', 'curl', 'lunge', 'plank'];

  it.each(VALID_TYPES)('tipo válido "%s" no devuelve 400', async (type) => {
    const res = await request(app)
      .post(`/api/v1/yolo/analyze/${type}`)
      .set(bearerHeader(token))
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('frame'));
    // 503 = llegó al proxy (Python no disponible en tests) — esto es correcto
    expect(res.status).not.toBe(400);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(501);
  });
});
