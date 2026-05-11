'use strict';

jest.mock('../../src/db/postgres', () => require('../helpers/mockPostgres').mockPg);
jest.mock('../../src/services/visionClient', () => require('../helpers/mockVision').mockVision);

const request = require('supertest');

let app;
beforeAll(() => {
  app = require('../../src/app');
});

describe('GET /health', () => {
  it('responde con status HTTP (200 o 503 según postgres)', async () => {
    const res = await request(app).get('/health');
    expect([200, 503]).toContain(res.status);
  });

  it('incluye campo status', async () => {
    const res = await request(app).get('/health');
    expect(['ok', 'error']).toContain(res.body.status);
  });

  it('incluye checks para node, postgres y python', async () => {
    const res = await request(app).get('/health');
    expect(res.body.checks).toHaveProperty('node');
    expect(res.body.checks).toHaveProperty('postgres');
    expect(res.body.checks).toHaveProperty('python');
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
