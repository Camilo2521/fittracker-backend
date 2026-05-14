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

// ── GET /api/v1/settings ────────────────────────────────────────────────────────

describe('GET /api/v1/settings', () => {
  it('requiere autenticación — 401 sin token', async () => {
    const res = await request(app).get('/api/v1/settings');
    expect(res.status).toBe(401);
  });

  it('devuelve objeto de configuración — 200', async () => {
    const res = await request(app)
      .get('/api/v1/settings')
      .set(bearerHeader(token));
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe('object');
    expect(Array.isArray(res.body)).toBe(false);
  });
});

// ── GET /api/v1/settings/:key ───────────────────────────────────────────────────

describe('GET /api/v1/settings/:key', () => {
  it('requiere autenticación — 401 sin token', async () => {
    const res = await request(app).get('/api/v1/settings/theme');
    expect(res.status).toBe(401);
  });

  it('devuelve 404 cuando la clave no existe', async () => {
    const res = await request(app)
      .get('/api/v1/settings/clave-que-no-existe')
      .set(bearerHeader(token));
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no encontrada/i);
  });

  it('rechaza clave con caracteres inválidos — 400', async () => {
    const res = await request(app)
      .get('/api/v1/settings/clave con espacios')
      .set(bearerHeader(token));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/clave/i);
  });
});

// ── PUT /api/v1/settings/:key ───────────────────────────────────────────────────

describe('PUT /api/v1/settings/:key', () => {
  it('requiere autenticación — 401 sin token', async () => {
    const res = await request(app)
      .put('/api/v1/settings/theme')
      .send({ value: 'dark' });
    expect(res.status).toBe(401);
  });

  it('guarda una configuración — 200 con key y value', async () => {
    const res = await request(app)
      .put('/api/v1/settings/theme')
      .set(bearerHeader(token))
      .send({ value: 'dark' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('key');
    expect(res.body).toHaveProperty('value');
  });

  it('rechaza sin value — 400', async () => {
    const res = await request(app)
      .put('/api/v1/settings/theme')
      .set(bearerHeader(token))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/value/i);
  });

  it('rechaza value no-string — 400', async () => {
    const res = await request(app)
      .put('/api/v1/settings/notifications')
      .set(bearerHeader(token))
      .send({ value: true });
    expect(res.status).toBe(400);
  });

  it('rechaza clave inválida — 400', async () => {
    const res = await request(app)
      .put('/api/v1/settings/clave invalida!')
      .set(bearerHeader(token))
      .send({ value: 'test' });
    expect(res.status).toBe(400);
  });

  it('rechaza value demasiado largo — 400', async () => {
    const res = await request(app)
      .put('/api/v1/settings/tema')
      .set(bearerHeader(token))
      .send({ value: 'x'.repeat(4097) });
    expect(res.status).toBe(400);
  });

  it('acepta claves con puntos y guiones bajos', async () => {
    const res = await request(app)
      .put('/api/v1/settings/ui.theme.dark_mode')
      .set(bearerHeader(token))
      .send({ value: 'true' });
    expect(res.status).toBe(200);
  });
});

// ── DELETE /api/v1/settings/:key ────────────────────────────────────────────────

describe('DELETE /api/v1/settings/:key', () => {
  it('requiere autenticación — 401 sin token', async () => {
    const res = await request(app).delete('/api/v1/settings/theme');
    expect(res.status).toBe(401);
  });

  it('rechaza clave inválida — 400', async () => {
    const res = await request(app)
      .delete('/api/v1/settings/clave mala')
      .set(bearerHeader(token));
    expect(res.status).toBe(400);
  });
});
