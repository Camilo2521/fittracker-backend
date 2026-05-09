'use strict';

jest.mock('../../src/db/postgres', () => require('../helpers/mockPostgres').mockPg);
jest.mock('../../src/services/visionClient', () => require('../helpers/mockVision').mockVision);

const request = require('supertest');

let app;
beforeAll(() => {
  app = require('../../src/app');
});

describe('GET /health', () => {
  it('responde 200 cuando SQLite está operativo', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });

  it('devuelve status "ok" o "degraded" (postgres es opcional)', async () => {
    const res = await request(app).get('/health');
    expect(['ok', 'degraded']).toContain(res.body.status);
  });

  it('SQLite siempre reporta "ok"', async () => {
    const res = await request(app).get('/health');
    expect(res.body.checks.sqlite).toBe('ok');
  });

  it('Python service reporta "unavailable" (no corriendo en tests)', async () => {
    const res = await request(app).get('/health');
    expect(res.body.checks.python).toBe('unavailable');
  });

  it('incluye campo version', async () => {
    const res = await request(app).get('/health');
    expect(res.body.version).toBeDefined();
  });

  it('incluye timestamp ISO válido', async () => {
    const res = await request(app).get('/health');
    expect(() => new Date(res.body.timestamp)).not.toThrow();
    expect(res.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('incluye feature_flags en la respuesta', async () => {
    const res = await request(app).get('/health');
    expect(res.body.feature_flags).toBeDefined();
    expect(typeof res.body.feature_flags).toBe('object');
  });

  it('Content-Type es application/json', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});

describe('Rutas inexistentes', () => {
  it('devuelve 404 para rutas no registradas', async () => {
    const res = await request(app).get('/api/v1/nonexistent-route');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Route not found');
  });

  it('devuelve 404 para métodos no definidos', async () => {
    const res = await request(app).delete('/health');
    expect(res.status).toBe(404);
  });
});
