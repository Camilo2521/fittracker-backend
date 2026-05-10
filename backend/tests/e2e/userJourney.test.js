'use strict';

/**
 * E2E — Flujo completo de usuario.
 *
 * Simula el ciclo de vida de un usuario real:
 * registro → login → actualización de perfil → registro de peso →
 * consulta de métricas → generación de rutina → generación de dieta →
 * sesión de repeticiones → historial → logout (token inválido)
 *
 * Este test no usa mocks parciales: todo pasa por SQLite :memory: real.
 * Solo mockeamos postgres y visionClient porque son servicios externos.
 */

jest.mock('../../src/db/postgres', () => require('../helpers/mockPostgres').mockPg);
jest.mock('../../src/services/visionClient', () => require('../helpers/mockVision').mockVision);

const request = require('supertest');

let app;
beforeAll(() => {
  app = require('../../src/app');
});

describe('Flujo completo de usuario — "María fitness journey"', () => {
  let token, userId;
  const email    = `maria_${Date.now()}@fittracker.test`;
  const password = 'FitPass2024!';

  // ── 1. Registro ────────────────────────────────────────────────────────────

  it('1. Se registra con éxito y obtiene token JWT', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email, password,
      name: 'María López',
      goal: 'lose', weight: 80, height: 165, age: 32, gender: 'female',
      activityLevel: 'light',
    });
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.goal).toBe('lose');
    token  = res.body.accessToken;
    userId = res.body.user.id;
  });

  // ── 2. Login ───────────────────────────────────────────────────────────────

  it('2. Hace login y recibe un token válido', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    token = res.body.accessToken;
  });

  // ── 3. Consulta su perfil ─────────────────────────────────────────────────

  it('3. Consulta /me y ve su perfil correcto', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(email);
    expect(res.body.name).toBe('María López');
    expect(res.body.goal).toBe('lose');
  });

  // ── 4. Actualiza su objetivo ───────────────────────────────────────────────

  it('4. Actualiza su objetivo a "maintain" después de alcanzar la meta', async () => {
    const res = await request(app)
      .put('/api/v1/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ goal: 'maintain', name: 'María L. (actualizada)' });
    expect(res.status).toBe(200);
    expect(res.body.goal).toBe('maintain');
    expect(res.body.name).toBe('María L. (actualizada)');
  });

  // ── 5. Registra progreso (peso) ────────────────────────────────────────────

  it('5. Registra su peso actual', async () => {
    const res = await request(app)
      .post('/api/v1/auth/progress-log')
      .set('Authorization', `Bearer ${token}`)
      .send({ date: '2024-04-15', weight: 72.5, waistCm: 78, hipCm: 97 });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeGreaterThan(0);
  });

  it('5b. Su perfil refleja el nuevo peso', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.weight).toBe(72.5);
  });

  // ── 6. Consulta métricas físicas ──────────────────────────────────────────

  it('6. Consulta sus métricas físicas (BMI, BMR, TDEE)', async () => {
    const res = await request(app).post('/api/v1/progress/metrics').send({
      userId: String(userId),
      weight: 72.5, heightCm: 165, age: 32,
      gender: 'female', activityLevel: 'light', goal: 'maintain',
    });
    expect(res.status).toBe(200);
    expect(res.body.bmi).toBeLessThan(30);          // No es obesidad
    expect(res.body.calorie_target).toBe(res.body.tdee); // maintain
    expect(res.body.bmr).toBeGreaterThan(1200);
  });

  // ── 7. Genera su rutina de entrenamiento ──────────────────────────────────

  it('7. Genera una rutina de mantenimiento', async () => {
    const res = await request(app).post('/api/v1/routines/generate').send({
      userId: String(userId), goal: 'maintain',
    });
    expect(res.status).toBe(200);
    expect(res.body.weeklyDays).toBe(3);
    expect(res.body.source).toBe('local');
    expect(res.body.days.length).toBeGreaterThan(0);
  });

  // ── 8. Genera su plan de dieta ────────────────────────────────────────────

  it('8. Genera un plan de dieta para la semana', async () => {
    const res = await request(app).post('/api/v1/diets/generate').send({
      userId: String(userId), weekStart: '2024-04-15', goal: 'maintain',
    });
    expect(res.status).toBe(200);
    expect(res.body.dailyCalorieTarget).toBe(2100);
    expect(res.body.days).toHaveLength(7);
  });

  // ── 9. Registra un entrenamiento ──────────────────────────────────────────

  it('9. Registra un entrenamiento completado', async () => {
    const res = await request(app)
      .post('/api/v1/auth/workout-log')
      .set('Authorization', `Bearer ${token}`)
      .send({
        date: '2024-04-15',
        routineName: 'Full body A',
        exercises: [
          { name: 'Sentadillas', sets: 3, reps: 12, weight: 40 },
          { name: 'Flexiones',   sets: 3, reps: 12, weight: 0 },
        ],
        durationMin: 40,
      });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeGreaterThan(0);
  });

  // ── 10. Inicia sesión de repeticiones (modo offline) ─────────────────────

  it('10. Inicia una sesión de rep counting en modo offline', async () => {
    const res = await request(app).post('/api/v1/reps/sessions').send({
      userId: String(userId), exerciseType: 'squat',
    });
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toMatch(/^local_/);
    expect(res.body.fallback).toBe(true);
  });

  it('10b. Completa la sesión y persiste los resultados', async () => {
    const res = await request(app)
      .post('/api/v1/reps/sessions/local_999999999/complete')
      .send({ totalReps: 36, totalSets: 3, exerciseType: 'squat', caloriesBurned: 90, avgFormScore: 0.92 });
    expect(res.status).toBe(200);
    expect(res.body.totalReps).toBe(36);
    expect(res.body.avgFormScore).toBe(0.92);
  });

  // ── 11. Consulta historial de entrenamiento ───────────────────────────────

  it('11. Consulta el historial de entrenamientos', async () => {
    const res = await request(app)
      .get('/api/v1/auth/workout-logs')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.some(l => l.routine_name === 'Full body A')).toBe(true);
  });

  // ── 12. Guarda un log de dieta ────────────────────────────────────────────

  it('12. Registra lo que comió hoy', async () => {
    const res = await request(app)
      .post('/api/v1/auth/diet-log')
      .set('Authorization', `Bearer ${token}`)
      .send({
        date: '2024-04-15',
        planName: 'Mantenimiento semana 15',
        meals: [
          { name: 'Desayuno', calories: 462 },
          { name: 'Almuerzo', calories: 735 },
          { name: 'Cena',     calories: 588 },
        ],
        totalKcal: 1785,
      });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeGreaterThan(0);
  });

  // ── 13. Recibe sugerencia de IA ───────────────────────────────────────────

  it('13. Guarda una sugerencia de IA', async () => {
    const res = await request(app)
      .post('/api/v1/auth/ai-suggestion')
      .set('Authorization', `Bearer ${token}`)
      .send({
        suggestionType: 'nutrition',
        content: 'Considera añadir más verduras de hoja verde en la cena.',
        userFeedback: 'helpful',
      });
    expect(res.status).toBe(200);
  });

  // ── 14. Consulta el estado del servidor ──────────────────────────────────

  it('14. El servidor reporta estado saludable', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.checks.sqlite).toBe('ok');
  });

  // ── 15. Intento de acceso con token inválido (simulación de logout) ───────

  it('15. Token inválido (logout simulado) → 401', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer token-invalido-post-logout');
    expect(res.status).toBe(401);
  });

  // ── 16. Un segundo usuario no accede a los datos del primero ─────────────

  it('16. Un intruso no puede ver los logs de María con otro token', async () => {
    const intruder = await request(app).post('/api/v1/auth/register').send({
      email: `intruder_${Date.now()}@test.com`, password: 'intruder123',
    });
    const intruderToken = intruder.body.token;

    const res = await request(app)
      .get('/api/v1/auth/workout-logs')
      .set('Authorization', `Bearer ${intruderToken}`);

    const names = res.body.map(l => l.routine_name);
    expect(names).not.toContain('Full body A');
  });
});
