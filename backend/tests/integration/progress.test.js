'use strict';

jest.mock('../../src/db/postgres', () => require('../helpers/mockPostgres').mockPg);
jest.mock('../../src/services/visionClient', () => require('../helpers/mockVision').mockVision);

const request = require('supertest');
const { makeToken, bearerHeader } = require('../helpers/auth');

const TOKEN = makeToken(1);

let app;
beforeAll(() => {
  app = require('../../src/app');
});

describe('POST /api/v1/progress/metrics', () => {

  describe('Autenticación', () => {
    it('rechaza sin token (401)', async () => {
      const res = await request(app).post('/api/v1/progress/metrics').send({
        weight: 75, heightCm: 175, age: 30,
      });
      expect(res.status).toBe(401);
    });
  });

  describe('Validación de entrada', () => {
    it('rechaza perfil incompleto sin peso (422)', async () => {
      const res = await request(app)
        .post('/api/v1/progress/metrics')
        .set(bearerHeader(TOKEN))
        .send({ heightCm: 175, age: 30, gender: 'male', activityLevel: 'moderate', goal: 'maintain' });
      expect(res.status).toBe(422);
      expect(res.body.missing).toContain('weight');
    });

    it('rechaza perfil incompleto sin altura (422)', async () => {
      const res = await request(app)
        .post('/api/v1/progress/metrics')
        .set(bearerHeader(TOKEN))
        .send({ weight: 75, age: 30, gender: 'male', activityLevel: 'moderate', goal: 'maintain' });
      expect(res.status).toBe(422);
      expect(res.body.missing).toContain('heightCm');
    });

    it('rechaza perfil incompleto sin edad (422)', async () => {
      const res = await request(app)
        .post('/api/v1/progress/metrics')
        .set(bearerHeader(TOKEN))
        .send({ weight: 75, heightCm: 175, gender: 'male', activityLevel: 'moderate', goal: 'maintain' });
      expect(res.status).toBe(422);
      expect(res.body.missing).toContain('age');
    });

    it('lista todos los campos faltantes cuando faltan varios', async () => {
      const res = await request(app)
        .post('/api/v1/progress/metrics')
        .set(bearerHeader(TOKEN))
        .send({ gender: 'male', activityLevel: 'moderate', goal: 'maintain' });
      expect(res.status).toBe(422);
      expect(res.body.missing.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Cálculos de métricas — hombre moderado, goal maintain', () => {
    let body;
    beforeAll(async () => {
      const res = await request(app)
        .post('/api/v1/progress/metrics')
        .set(bearerHeader(TOKEN))
        .send({ weight: 75, heightCm: 175, age: 30, gender: 'male', activityLevel: 'moderate', goal: 'maintain' });
      body = res.body;
    });

    it('devuelve 200', async () => {
      const res = await request(app)
        .post('/api/v1/progress/metrics')
        .set(bearerHeader(TOKEN))
        .send({ weight: 75, heightCm: 175, age: 30, gender: 'male', activityLevel: 'moderate', goal: 'maintain' });
      expect(res.status).toBe(200);
    });

    it('BMI tiene 1 decimal', () => {
      expect(body.bmi).toBeCloseTo(24.5, 0);
      expect(String(body.bmi).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(1);
    });

    it('BMR está en rango fisiológico para el perfil dado', () => {
      expect(body.bmr).toBeGreaterThan(1400);
      expect(body.bmr).toBeLessThan(2200);
    });

    it('TDEE es mayor que BMR', () => {
      expect(body.tdee).toBeGreaterThan(body.bmr);
    });

    it('calorie_target == tdee para goal "maintain"', () => {
      expect(body.calorie_target).toBe(body.tdee);
    });
  });

  describe('Objetivo "lose" — déficit calórico', () => {
    it('calorie_target = tdee - 400', async () => {
      const res = await request(app)
        .post('/api/v1/progress/metrics')
        .set(bearerHeader(TOKEN))
        .send({ weight: 90, heightCm: 180, age: 35, gender: 'male', activityLevel: 'moderate', goal: 'lose' });
      expect(res.status).toBe(200);
      expect(res.body.calorie_target).toBe(res.body.tdee - 400);
    });
  });

  describe('Objetivo "gain" — superávit calórico', () => {
    it('calorie_target = tdee + 300', async () => {
      const res = await request(app)
        .post('/api/v1/progress/metrics')
        .set(bearerHeader(TOKEN))
        .send({ weight: 65, heightCm: 175, age: 25, gender: 'male', activityLevel: 'active', goal: 'gain' });
      expect(res.status).toBe(200);
      expect(res.body.calorie_target).toBe(res.body.tdee + 300);
    });
  });

  describe('Diferencias por género', () => {
    it('hombre tiene BMR > mujer con mismo perfil físico', async () => {
      const [maleRes, femaleRes] = await Promise.all([
        request(app).post('/api/v1/progress/metrics').set(bearerHeader(TOKEN))
          .send({ weight: 70, heightCm: 170, age: 30, gender: 'male', activityLevel: 'moderate', goal: 'maintain' }),
        request(app).post('/api/v1/progress/metrics').set(bearerHeader(TOKEN))
          .send({ weight: 70, heightCm: 170, age: 30, gender: 'female', activityLevel: 'moderate', goal: 'maintain' }),
      ]);
      expect(maleRes.body.bmr).toBeGreaterThan(femaleRes.body.bmr);
    });
  });

  describe('Niveles de actividad', () => {
    const levels = ['light', 'active', 'very_active'];

    it.each(levels)('nivel "%s" produce TDEE mayor que sedentario', async (level) => {
      const [sedRes, levelRes] = await Promise.all([
        request(app).post('/api/v1/progress/metrics').set(bearerHeader(TOKEN))
          .send({ weight: 75, heightCm: 175, age: 30, gender: 'male', activityLevel: 'sedentary', goal: 'maintain' }),
        request(app).post('/api/v1/progress/metrics').set(bearerHeader(TOKEN))
          .send({ weight: 75, heightCm: 175, age: 30, gender: 'male', activityLevel: level, goal: 'maintain' }),
      ]);
      expect(levelRes.body.tdee).toBeGreaterThan(sedRes.body.tdee);
    });
  });

  describe('Estructura de respuesta', () => {
    it('devuelve bmi, bmr, tdee y calorie_target', async () => {
      const res = await request(app)
        .post('/api/v1/progress/metrics')
        .set(bearerHeader(TOKEN))
        .send({ weight: 70, heightCm: 175, age: 28, gender: 'male', activityLevel: 'moderate', goal: 'maintain' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('bmi');
      expect(res.body).toHaveProperty('bmr');
      expect(res.body).toHaveProperty('tdee');
      expect(res.body).toHaveProperty('calorie_target');
    });

    it('todos los valores son números positivos', async () => {
      const res = await request(app)
        .post('/api/v1/progress/metrics')
        .set(bearerHeader(TOKEN))
        .send({ weight: 70, heightCm: 175, age: 28, gender: 'male', activityLevel: 'moderate', goal: 'maintain' });
      for (const key of ['bmi', 'bmr', 'tdee', 'calorie_target']) {
        expect(res.body[key]).toBeGreaterThan(0);
      }
    });
  });
});

describe('GET /api/v1/progress/metrics', () => {
  it('rechaza sin token (401)', async () => {
    const res = await request(app).get('/api/v1/progress/metrics');
    expect(res.status).toBe(401);
  });

  it('devuelve paginación vacía cuando postgres no disponible', async () => {
    const res = await request(app)
      .get('/api/v1/progress/metrics')
      .set(bearerHeader(TOKEN));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
