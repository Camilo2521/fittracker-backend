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

const WEEK = '2024-04-01';

// ── POST /api/v1/diets/generate ───────────────────────────────────────────────

describe('POST /api/v1/diets/generate', () => {
  describe('Autenticación', () => {
    it('rechaza sin token (401)', async () => {
      const res = await request(app).post('/api/v1/diets/generate').send({ weekStart: WEEK });
      expect(res.status).toBe(401);
    });
  });

  describe('Validación', () => {
    it('acepta sin weekStart usando la semana actual (200)', async () => {
      const res = await request(app)
        .post('/api/v1/diets/generate')
        .set(bearerHeader(TOKEN))
        .send({ goal: 'lose' });
      expect(res.status).toBe(200);
    });
  });

  describe('Generador local — RAG deshabilitado', () => {
    it('devuelve plan lose con 1800 kcal/día', async () => {
      const res = await request(app)
        .post('/api/v1/diets/generate')
        .set(bearerHeader(TOKEN))
        .send({ weekStart: WEEK, goal: 'lose' });
      expect(res.status).toBe(200);
      expect(res.body.dailyCalorieTarget).toBe(1800);
    });

    it('devuelve plan gain con 2600 kcal/día', async () => {
      const res = await request(app)
        .post('/api/v1/diets/generate')
        .set(bearerHeader(TOKEN))
        .send({ weekStart: WEEK, goal: 'gain' });
      expect(res.status).toBe(200);
      expect(res.body.dailyCalorieTarget).toBe(2600);
    });

    it('devuelve plan maintain con 2100 kcal/día', async () => {
      const res = await request(app)
        .post('/api/v1/diets/generate')
        .set(bearerHeader(TOKEN))
        .send({ weekStart: WEEK, goal: 'maintain' });
      expect(res.status).toBe(200);
      expect(res.body.dailyCalorieTarget).toBe(2100);
    });

    it('el plan tiene 7 días', async () => {
      const res = await request(app)
        .post('/api/v1/diets/generate')
        .set(bearerHeader(TOKEN))
        .send({ weekStart: WEEK, goal: 'maintain' });
      expect(res.body.days).toHaveLength(7);
    });

    it('weekStart se refleja en la respuesta', async () => {
      const res = await request(app)
        .post('/api/v1/diets/generate')
        .set(bearerHeader(TOKEN))
        .send({ weekStart: '2024-06-03', goal: 'lose' });
      expect(res.body.weekStart).toBe('2024-06-03');
    });

    it('source es "local"', async () => {
      const res = await request(app)
        .post('/api/v1/diets/generate')
        .set(bearerHeader(TOKEN))
        .send({ weekStart: WEEK, goal: 'maintain' });
      expect(res.body.source).toBe('local');
    });

    it('cada día tiene al menos 3 comidas', async () => {
      const res = await request(app)
        .post('/api/v1/diets/generate')
        .set(bearerHeader(TOKEN))
        .send({ weekStart: WEEK, goal: 'lose' });
      res.body.days.forEach(day => {
        expect(day.meals.length).toBeGreaterThanOrEqual(3);
      });
    });

    it('cada comida tiene name, calories y description', async () => {
      const res = await request(app)
        .post('/api/v1/diets/generate')
        .set(bearerHeader(TOKEN))
        .send({ weekStart: WEEK, goal: 'maintain' });
      res.body.days[0].meals.forEach(meal => {
        expect(meal).toHaveProperty('name');
        expect(meal).toHaveProperty('calories');
        expect(meal).toHaveProperty('description');
        expect(meal.calories).toBeGreaterThan(0);
      });
    });

    it('goal desconocido hace fallback a 2100 kcal (maintain)', async () => {
      const res = await request(app)
        .post('/api/v1/diets/generate')
        .set(bearerHeader(TOKEN))
        .send({ weekStart: WEEK, goal: 'alien' });
      expect(res.body.dailyCalorieTarget).toBe(2100);
    });
  });

  describe('Ruta RAG habilitada (FLAGS.rag_enabled = true)', () => {
    beforeEach(() => { FLAGS.rag_enabled = true; });
    afterEach(()  => { FLAGS.rag_enabled = false; mockVision.generateDiet.mockReset(); });

    it('devuelve datos del servicio RAG cuando ok=true', async () => {
      mockVision.generateDiet.mockResolvedValueOnce({
        ok:   true,
        data: { source: 'rag', dailyCalorieTarget: 1900, days: [] },
      });
      const res = await request(app)
        .post('/api/v1/diets/generate')
        .set(bearerHeader(TOKEN))
        .send({ weekStart: WEEK, goal: 'lose' });
      expect(res.status).toBe(200);
      expect(res.body.source).toBe('rag');
      expect(res.body.dailyCalorieTarget).toBe(1900);
    });

    it('hace fallback a dieta local cuando RAG devuelve ok=false', async () => {
      mockVision.generateDiet.mockResolvedValueOnce({ ok: false, fallback: true });
      const res = await request(app)
        .post('/api/v1/diets/generate')
        .set(bearerHeader(TOKEN))
        .send({ weekStart: WEEK, goal: 'maintain' });
      expect(res.status).toBe(200);
      expect(res.body.source).toBe('local');
    });
  });
});

// ── GET /api/v1/diets/current ─────────────────────────────────────────────────

describe('GET /api/v1/diets/current', () => {
  it('rechaza sin token (401)', async () => {
    const res = await request(app).get('/api/v1/diets/current');
    expect(res.status).toBe(401);
  });

  it('devuelve 404 cuando no hay plan en postgres (rows vacíos)', async () => {
    mockPg.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get('/api/v1/diets/current')
      .set(bearerHeader(TOKEN));
    expect(res.status).toBe(404);
  });

  it('devuelve 404 amigable cuando la tabla no existe (42P01)', async () => {
    const err = new Error('relation "diet_plans" does not exist');
    err.code = '42P01';
    mockPg.query.mockRejectedValueOnce(err);
    const res = await request(app)
      .get('/api/v1/diets/current')
      .set(bearerHeader(TOKEN));
    expect(res.status).toBe(404);
  });

  it('devuelve 503 ante error de conexión', async () => {
    mockPg.query.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const res = await request(app)
      .get('/api/v1/diets/current')
      .set(bearerHeader(TOKEN));
    expect(res.status).toBe(503);
  });
});

// ── PUT /api/v1/diets/meals/:mealId ──────────────────────────────────────────

describe('PUT /api/v1/diets/meals/:mealId', () => {
  it('rechaza sin token (401)', async () => {
    const res = await request(app).put('/api/v1/diets/meals/9999').send({ name: 'Avena' });
    expect(res.status).toBe(401);
  });

  it('actualiza una comida (200 o 404 si no existe)', async () => {
    const res = await request(app)
      .put('/api/v1/diets/meals/9999')
      .set(bearerHeader(TOKEN))
      .send({ name: 'Avena', calories: 350, protein: 12, carbs: 60, fat: 5 });
    expect([200, 404]).toContain(res.status);
  });

  it('acepta alias de campos (protein_g, carbs_g, fat_g)', async () => {
    const res = await request(app)
      .put('/api/v1/diets/meals/9999')
      .set(bearerHeader(TOKEN))
      .send({ protein_g: 12, carbs_g: 60, fat_g: 5 });
    expect([200, 404]).toContain(res.status);
  });
});

// ── POST /api/v1/diets/documents ─────────────────────────────────────────────

describe('POST /api/v1/diets/documents', () => {
  it('rechaza sin token (401)', async () => {
    const res = await request(app).post('/api/v1/diets/documents')
      .send({ title: 'Test', content: 'Test content' });
    expect(res.status).toBe(401);
  });

  it('guarda un documento y devuelve id (201)', async () => {
    const res = await request(app)
      .post('/api/v1/diets/documents')
      .set(bearerHeader(TOKEN))
      .send({ title: 'Guía proteínas', content: 'La proteína es esencial para...', type: 'nutrition' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.id).toBeGreaterThan(0);
  });

  it('rechaza sin title (400)', async () => {
    const res = await request(app)
      .post('/api/v1/diets/documents')
      .set(bearerHeader(TOKEN))
      .send({ content: 'Sin título' });
    expect(res.status).toBe(400);
  });

  it('rechaza sin content (400)', async () => {
    const res = await request(app)
      .post('/api/v1/diets/documents')
      .set(bearerHeader(TOKEN))
      .send({ title: 'Sin contenido' });
    expect(res.status).toBe(400);
  });

  it('segunda inserción genera un id diferente', async () => {
    const [r1, r2] = await Promise.all([
      request(app).post('/api/v1/diets/documents').set(bearerHeader(TOKEN))
        .send({ title: 'Doc 1', content: 'Contenido A' }),
      request(app).post('/api/v1/diets/documents').set(bearerHeader(TOKEN))
        .send({ title: 'Doc 2', content: 'Contenido B' }),
    ]);
    expect(r1.body.id).not.toBe(r2.body.id);
  });
});
