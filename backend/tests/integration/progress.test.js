'use strict';

jest.mock('../../src/db/postgres', () => require('../helpers/mockPostgres').mockPg);
jest.mock('../../src/services/visionClient', () => require('../helpers/mockVision').mockVision);

const request = require('supertest');

let app;
beforeAll(() => {
  app = require('../../src/app');
});

describe('POST /api/v1/progress/metrics', () => {

  describe('Validación de entrada', () => {
    it('rechaza sin userId (400)', async () => {
      const res = await request(app).post('/api/v1/progress/metrics').send({
        weight: 75, heightCm: 175, age: 30,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/userId/i);
    });

    it('rechaza perfil incompleto sin peso (422)', async () => {
      const res = await request(app).post('/api/v1/progress/metrics').send({
        userId: 'user-abc', heightCm: 175, age: 30,
      });
      expect(res.status).toBe(422);
      expect(res.body.missing).toContain('weight (current_weight)');
    });

    it('rechaza perfil incompleto sin altura (422)', async () => {
      const res = await request(app).post('/api/v1/progress/metrics').send({
        userId: 'user-abc', weight: 75, age: 30,
      });
      expect(res.status).toBe(422);
      expect(res.body.missing).toContain('heightCm (height_cm)');
    });

    it('rechaza perfil incompleto sin edad (422)', async () => {
      const res = await request(app).post('/api/v1/progress/metrics').send({
        userId: 'user-abc', weight: 75, heightCm: 175,
      });
      expect(res.status).toBe(422);
      expect(res.body.missing).toContain('age');
    });

    it('lista todos los campos faltantes cuando faltan varios', async () => {
      const res = await request(app).post('/api/v1/progress/metrics').send({
        userId: 'user-abc',
      });
      expect(res.status).toBe(422);
      expect(res.body.missing.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Cálculos de métricas — hombre moderado, goal maintain', () => {
    let body;
    beforeAll(async () => {
      const res = await request(app).post('/api/v1/progress/metrics').send({
        userId: 'test-user-1', weight: 75, heightCm: 175, age: 30,
        gender: 'male', activityLevel: 'moderate', goal: 'maintain',
      });
      body = res.body;
    });

    it('devuelve 200', async () => {
      const res = await request(app).post('/api/v1/progress/metrics').send({
        userId: 'test-user-1', weight: 75, heightCm: 175, age: 30,
      });
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
      const res = await request(app).post('/api/v1/progress/metrics').send({
        userId: 'user-lose', weight: 90, heightCm: 180, age: 35,
        gender: 'male', activityLevel: 'moderate', goal: 'lose',
      });
      expect(res.status).toBe(200);
      expect(res.body.calorie_target).toBe(res.body.tdee - 400);
    });
  });

  describe('Objetivo "gain" — superávit calórico', () => {
    it('calorie_target = tdee + 300', async () => {
      const res = await request(app).post('/api/v1/progress/metrics').send({
        userId: 'user-gain', weight: 65, heightCm: 175, age: 25,
        gender: 'male', activityLevel: 'active', goal: 'gain',
      });
      expect(res.status).toBe(200);
      expect(res.body.calorie_target).toBe(res.body.tdee + 300);
    });
  });

  describe('Diferencias por género', () => {
    async function getMetrics(gender) {
      const res = await request(app).post('/api/v1/progress/metrics').send({
        userId: `user-gender-${gender}`, weight: 70, heightCm: 170,
        age: 30, gender, activityLevel: 'moderate', goal: 'maintain',
      });
      return res.body;
    }

    it('hombre tiene BMR > mujer con mismo perfil físico', async () => {
      const male   = await getMetrics('male');
      const female = await getMetrics('female');
      expect(male.bmr).toBeGreaterThan(female.bmr);
    });
  });

  describe('Niveles de actividad', () => {
    const cases = [
      ['sedentary', 1.2],
      ['light',     1.375],
      ['active',    1.725],
      ['very_active',1.9],
    ];

    it.each(cases)('nivel "%s" produce TDEE mayor que sedentario', async (level) => {
      if (level === 'sedentary') return;
      const [sedRes, levelRes] = await Promise.all([
        request(app).post('/api/v1/progress/metrics').send({ userId: `u-sed`, weight: 75, heightCm: 175, age: 30, gender: 'male', activityLevel: 'sedentary', goal: 'maintain' }),
        request(app).post('/api/v1/progress/metrics').send({ userId: `u-${level}`, weight: 75, heightCm: 175, age: 30, gender: 'male', activityLevel: level, goal: 'maintain' }),
      ]);
      expect(levelRes.body.tdee).toBeGreaterThan(sedRes.body.tdee);
    });
  });

  describe('Estructura de respuesta', () => {
    it('devuelve bmi, bmr, tdee y calorie_target', async () => {
      const res = await request(app).post('/api/v1/progress/metrics').send({
        userId: 'struct-test', weight: 70, heightCm: 175, age: 28,
      });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('bmi');
      expect(res.body).toHaveProperty('bmr');
      expect(res.body).toHaveProperty('tdee');
      expect(res.body).toHaveProperty('calorie_target');
    });

    it('todos los valores son números positivos', async () => {
      const res = await request(app).post('/api/v1/progress/metrics').send({
        userId: 'positives-test', weight: 70, heightCm: 175, age: 28,
      });
      for (const key of ['bmi', 'bmr', 'tdee', 'calorie_target']) {
        expect(res.body[key]).toBeGreaterThan(0);
      }
    });
  });
});

describe('GET /api/v1/progress/:userId/metrics', () => {
  it('devuelve array (vacío si postgres no disponible)', async () => {
    const res = await request(app).get('/api/v1/progress/user-123/metrics');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
