'use strict';

jest.mock('../../src/db/postgres',       () => require('../helpers/mockPostgres').mockPg);
jest.mock('../../src/services/visionClient', () => require('../helpers/mockVision').mockVision);

const request = require('supertest');
const { registerUser, bearerHeader } = require('../helpers/auth');
const { mockVision, resetMocks } = require('../helpers/mockVision');

let app, token;

const SAMPLE_DIET = {
  weekStart:          '2026-05-12',
  dailyCalorieTarget: 2100,
  days: [
    { day: 'Lunes',   meals: [{ name: 'Desayuno', calories: 462 }, { name: 'Almuerzo', calories: 735 }] },
    { day: 'Martes',  meals: [{ name: 'Desayuno', calories: 462 }] },
    { day: 'Miércoles', meals: [] },
    { day: 'Jueves',  meals: [] },
    { day: 'Viernes', meals: [] },
    { day: 'Sábado',  meals: [] },
    { day: 'Domingo', meals: [] },
  ],
};

beforeAll(async () => {
  app = require('../../src/app');
  ({ token } = await registerUser(app));
});

beforeEach(() => resetMocks());

// ── Autenticación ─────────────────────────────────────────────────────────────

describe('POST /api/v1/pdf/diet — autenticación', () => {
  it('sin token → 401', async () => {
    const res = await request(app).post('/api/v1/pdf/diet').send({ dietData: SAMPLE_DIET });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });
});

// ── Validación de inputs ──────────────────────────────────────────────────────

describe('POST /api/v1/pdf/diet — validación', () => {
  it('sin dietData → 400', async () => {
    const res = await request(app)
      .post('/api/v1/pdf/diet')
      .set(bearerHeader(token))
      .send({ userName: 'Test' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/dietData/i);
  });

  it('body vacío → 400', async () => {
    const res = await request(app)
      .post('/api/v1/pdf/diet')
      .set(bearerHeader(token))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

// ── Python service no disponible → 503 ───────────────────────────────────────

describe('POST /api/v1/pdf/diet — Python service caído', () => {
  it('cuando Python retorna null → 503', async () => {
    mockVision.generateDietPdf.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/v1/pdf/diet')
      .set(bearerHeader(token))
      .send({ dietData: SAMPLE_DIET, userName: 'Ana' });

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/pdf|disponible/i);
  });
});

// ── Happy path: PDF generado ──────────────────────────────────────────────────

describe('POST /api/v1/pdf/diet — generación exitosa', () => {
  it('cuando Python retorna buffer → 200 con Content-Type application/pdf', async () => {
    const fakePdf = Buffer.from('%PDF-1.4 fake content');
    mockVision.generateDietPdf.mockResolvedValueOnce(fakePdf);

    const res = await request(app)
      .post('/api/v1/pdf/diet')
      .set(bearerHeader(token))
      .send({ dietData: SAMPLE_DIET, userName: 'María' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/i);
    expect(res.headers['content-disposition']).toMatch(/attachment/i);
    expect(res.headers['content-disposition']).toMatch(/fittracker-dieta/i);
  });

  it('el nombre de archivo contiene la fecha weekStart del plan', async () => {
    const fakePdf = Buffer.from('%PDF-1.4 fake');
    mockVision.generateDietPdf.mockResolvedValueOnce(fakePdf);

    const res = await request(app)
      .post('/api/v1/pdf/diet')
      .set(bearerHeader(token))
      .send({ dietData: SAMPLE_DIET, userName: 'Luis' });

    expect(res.headers['content-disposition']).toContain('2026-05-12');
  });

  it('visionClient.generateDietPdf recibe dietData y userName correctos', async () => {
    const fakePdf = Buffer.from('%PDF-1.4');
    mockVision.generateDietPdf.mockResolvedValueOnce(fakePdf);

    await request(app)
      .post('/api/v1/pdf/diet')
      .set(bearerHeader(token))
      .send({ dietData: SAMPLE_DIET, userName: 'Test User' });

    expect(mockVision.generateDietPdf).toHaveBeenCalledWith(SAMPLE_DIET, 'Test User');
  });

  it('userName por defecto es "Usuario" si no se envía', async () => {
    const fakePdf = Buffer.from('%PDF-1.4');
    mockVision.generateDietPdf.mockResolvedValueOnce(fakePdf);

    await request(app)
      .post('/api/v1/pdf/diet')
      .set(bearerHeader(token))
      .send({ dietData: SAMPLE_DIET });

    expect(mockVision.generateDietPdf).toHaveBeenCalledWith(SAMPLE_DIET, 'Usuario');
  });
});
