'use strict';

/**
 * E2E — Experiencia del cliente: 4 personas reales
 *
 * Cada bloque simula un flujo de usuario completo tal como lo viviría
 * alguien usando la app móvil. Los asserts verifican lo que el usuario
 * VE en pantalla, no solo los status codes.
 *
 * Personas:
 *   1. Ana    — nueva usuaria, quiere perder peso
 *   2. Carlos — olvidó su contraseña y la recupera
 *   3. Laura  — atleta experimentada que sigue su progreso
 *   4. Multi-user — aislamiento de datos entre cuentas
 */

jest.mock('../../src/db/postgres', () => require('../helpers/mockPostgres').mockPg);
jest.mock('../../src/services/visionClient', () => require('../helpers/mockVision').mockVision);
jest.mock('../../src/services/ollamaService', () => ({
  isAvailable: jest.fn().mockResolvedValue(false),
  getModel: () => 'llama3.2',
  chat:     jest.fn().mockResolvedValue('Buen trabajo, sigue así!'),
}));

const request = require('supertest');
const { plantRecoveryToken, resetMocks } = require('../helpers/mockPostgres');

let app;
beforeAll(() => {
  app = require('../../src/app');
});

// ═══════════════════════════════════════════════════════════════════════════
// PERSONA 1 — Ana: nueva usuaria, quiere perder peso
// Flujo: registro → perfil → primer peso → dieta → entrenamiento → sugerencia IA
// ═══════════════════════════════════════════════════════════════════════════

describe('Persona 1 — Ana: nueva usuaria, objetivo perder peso', () => {
  let token, userId;
  const email    = `ana_${Date.now()}@fittracker.test`;
  const password = 'Ana2024Fit!';
  afterAll(() => resetMocks());

  it('1.1 Ana se registra con datos completos de onboarding', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email, password,
      name: 'Ana García',
      goal: 'lose',
      weight: 82, height: 163, age: 29,
      gender: 'female', activityLevel: 'light',
      restrictions: 'sin gluten',
    });

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.name).toBe('Ana García');
    expect(res.body.user.goal).toBe('lose');
    expect(res.body.user.weight).toBe(82);
    token  = res.body.accessToken;
    userId = res.body.user.id;
  });

  it('1.2 Ana ve su perfil correctamente en pantalla "Yo"', async () => {
    const res = await request(app).get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Ana García');
    expect(res.body.email).toBe(email);
    expect(res.body.goal).toBe('lose');
    expect(res.body.weight).toBe(82);
    expect(res.body.restrictions).toBe('sin gluten');
  });

  it('1.3 Ana recibe sus métricas físicas al ingresar datos', async () => {
    const res = await request(app).post('/api/v1/progress/metrics')
      .set('Authorization', `Bearer ${token}`)
      .send({
        weight: 82, heightCm: 163, age: 29,
        gender: 'female', activityLevel: 'light', goal: 'lose',
      });

    expect(res.status).toBe(200);
    // La app muestra BMI en pantalla
    expect(res.body.bmi).toBeGreaterThan(25);  // Ana está en sobrepeso leve
    expect(res.body.bmi).toBeLessThan(35);
    // La app muestra las calorías objetivo
    expect(res.body.calorie_target).toBeGreaterThan(1400);
    expect(res.body.calorie_target).toBeLessThan(2200);
    // La app muestra TMB
    expect(res.body.bmr).toBeGreaterThan(1300);
  });

  it('1.4 Ana genera su plan de dieta semanal (local fallback, RAG desactivado)', async () => {
    const res = await request(app).post('/api/v1/diets/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({ weekStart: '2026-05-12', goal: 'lose' });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('local');
    expect(res.body.dailyCalorieTarget).toBe(1800); // objetivo perder peso
    expect(res.body.days).toHaveLength(7);
    // Cada día tiene comidas con nombres y calorías
    const primerDia = res.body.days[0];
    expect(primerDia.meals.length).toBeGreaterThanOrEqual(3);
    primerDia.meals.forEach(m => {
      expect(m.name).toBeTruthy();
      expect(m.calories).toBeGreaterThan(0);
    });
    // La app muestra las notas del plan
    expect(res.body.notes).toBeTruthy();
  });

  it('1.5 Ana genera su rutina de entrenamiento', async () => {
    const res = await request(app).post('/api/v1/routines/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({ goal: 'lose' });

    expect(res.status).toBe(200);
    expect(res.body.weeklyDays).toBe(4); // plan pérdida de peso = 4 días
    // Cada día tiene ejercicios
    res.body.days.forEach(day => {
      expect(day.day).toBeTruthy();
      expect(day.focus).toBeTruthy();
      expect(day.exercises.length).toBeGreaterThan(0);
    });
  });

  it('1.6 Ana registra su primer entrenamiento', async () => {
    const res = await request(app).post('/api/v1/auth/workout-log')
      .set('Authorization', `Bearer ${token}`)
      .send({
        date: '2026-05-14',
        routineName: 'Cardio + Core (Lunes)',
        exercises: [
          { name: 'Caminata rápida', duration: 30 },
          { name: 'Planchas', sets: 3, reps: 30 },
        ],
        durationMin: 40,
        notes: 'Primera sesión. Sentí el core.',
      });

    expect(res.status).toBe(200);
    expect(res.body.id).toBeGreaterThan(0);
  });

  it('1.7 Ana ve su historial de entrenamientos (pantalla "Historial")', async () => {
    const res = await request(app).get('/api/v1/auth/workout-logs')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    const ultimo = res.body.data[0];
    expect(ultimo.nombre_rutina).toBe('Cardio + Core (Lunes)');
    expect(ultimo.duracion_min).toBe(40);
  });

  it('1.8 Ana registra lo que comió hoy (log de dieta)', async () => {
    const res = await request(app).post('/api/v1/auth/diet-log')
      .set('Authorization', `Bearer ${token}`)
      .send({
        date: '2026-05-14',
        planName: 'Día 1 pérdida de peso',
        meals: [
          { name: 'Avena con frutos rojos', calories: 360 },
          { name: 'Pechuga a la plancha + ensalada', calories: 630 },
          { name: 'Salmón al horno + brócoli', calories: 540 },
        ],
        totalKcal: 1530,
      });

    expect(res.status).toBe(200);
    expect(res.body.id).toBeGreaterThan(0);
  });

  it('1.9 Ana registra comidas individuales con macros (pantalla "Nutrición")', async () => {
    const res = await request(app).post('/api/v1/meals')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Yogur griego',
        calories: 180, protein: 15, carbs: 12, fat: 5,
        date: '2026-05-14',
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeGreaterThan(0);
  });

  it('1.10 Ana ve sus comidas del día con totales de macros', async () => {
    const res = await request(app).get('/api/v1/meals?date=2026-05-14')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.totals).toBeDefined();
    expect(res.body.totals.calories).toBeGreaterThan(0);
  });

  it('1.11 Ana registra su progreso de peso y ve que se actualizó su perfil', async () => {
    const res = await request(app).post('/api/v1/auth/progress-log')
      .set('Authorization', `Bearer ${token}`)
      .send({ date: '2026-05-14', weight: 81.5, waistCm: 88 });

    expect(res.status).toBe(200);

    // El perfil se actualiza con el nuevo peso
    const profile = await request(app).get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(profile.body.weight).toBe(81.5);
  });

  it('1.12 Ana configura sus hábitos diarios (agua y checks)', async () => {
    const agua = await request(app).put('/api/v1/habits/water')
      .set('Authorization', `Bearer ${token}`)
      .send({ vasos: 8, date: '2026-05-14' });
    expect(agua.status).toBe(200);
    expect(agua.body.vasos).toBe(8);

    const checks = await request(app).put('/api/v1/habits/daily-check')
      .set('Authorization', `Bearer ${token}`)
      .send({ checks: { ejercicio: true, agua: true, sueno: true }, date: '2026-05-14' });
    expect(checks.status).toBe(200);
    expect(checks.body.checks.ejercicio).toBe(true);
  });

  it('1.13 Ana ve el estado de salud del servidor (la app puede funcionar)', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks.node).toBe('ok');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PERSONA 2 — Carlos: olvidó su contraseña, la recupera y vuelve a entrar
// Flujo: login fallido → forgot-password → reset → login exitoso → ve datos
// ═══════════════════════════════════════════════════════════════════════════

describe('Persona 2 — Carlos: recuperación de contraseña', () => {
  let carlosToken;
  const email    = `carlos_${Date.now()}@fittracker.test`;
  const password = 'CarlosPass2024!';
  const newPass  = 'CarlosNuevo2024!';
  afterAll(() => resetMocks());

  it('2.1 Carlos se registra y tiene historial previo', async () => {
    const reg = await request(app).post('/api/v1/auth/register')
      .send({ email, password, name: 'Carlos Ruiz', goal: 'maintain', weight: 78 });
    expect(reg.status).toBe(201);
    carlosToken = reg.body.accessToken;

    // Tiene datos en el sistema
    await request(app).post('/api/v1/auth/workout-log')
      .set('Authorization', `Bearer ${carlosToken}`)
      .send({ date: '2026-05-01', routineName: 'Full body', exercises: [], durationMin: 60 });
  });

  it('2.2 Carlos intenta login con contraseña incorrecta — ve error claro', async () => {
    const res = await request(app).post('/api/v1/auth/login')
      .send({ email, password: 'ContraseñaMal1!' });

    expect(res.status).toBe(401);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    // El mensaje NO debe revelar si el email existe
    expect(res.body.error).not.toMatch(/no existe/i);
  });

  it('2.3 Carlos solicita reset de contraseña — recibe 200 genérico (seguridad)', async () => {
    const res = await request(app).post('/api/v1/auth/forgot-password')
      .send({ email });

    // Siempre 200 para no revelar si el email existe (OWASP)
    expect(res.status).toBe(200);
    expect(typeof res.body.message).toBe('string');
  });

  it('2.4 Carlos usa un token de reset falso — recibe error de validación', async () => {
    const res = await request(app).post('/api/v1/auth/reset-password')
      .send({ token: 'token-invalido-que-no-existe', password: newPass });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('2.5 Carlos recibe el token real (plantado por el sistema) y resetea su contraseña', async () => {
    // En producción esto llega por email. En test usamos el helper.
    // GET /me devuelve el usuario directamente (no { user: {...} })
    const profile = (await request(app).get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${carlosToken}`)).body;

    const rawToken = 'token-reset-carlos-para-test-suite';
    plantRecoveryToken(profile.id, rawToken);

    const res = await request(app).post('/api/v1/auth/reset-password')
      .send({ token: rawToken, password: newPass });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.message).toMatch(/actualizada/i);
  });

  it('2.6 Carlos hace login con la nueva contraseña — accede con éxito', async () => {
    const res = await request(app).post('/api/v1/auth/login')
      .send({ email, password: newPass });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    carlosToken = res.body.accessToken;
  });

  it('2.7 Carlos recupera su historial previo tras el reset', async () => {
    const res = await request(app).get('/api/v1/auth/workout-logs')
      .set('Authorization', `Bearer ${carlosToken}`);

    expect(res.status).toBe(200);
    const names = res.body.data.map(l => l.nombre_rutina);
    expect(names).toContain('Full body');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PERSONA 3 — Laura: atleta, gana músculo, exporta su progreso
// Flujo: register → múltiples entrenamientos → historial → exportar CSV
// ═══════════════════════════════════════════════════════════════════════════

describe('Persona 3 — Laura: atleta, seguimiento avanzado', () => {
  let token;
  const email    = `laura_${Date.now()}@fittracker.test`;
  const password = 'LauraFit2024!';
  afterAll(() => resetMocks());

  it('3.1 Laura se registra como atleta avanzada (gain + active)', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email, password,
      name: 'Laura Martínez',
      goal: 'gain', weight: 62, height: 170, age: 26,
      gender: 'female', activityLevel: 'active',
    });
    expect(res.status).toBe(201);
    token = res.body.accessToken;
  });

  it('3.2 Laura registra 3 entrenamientos de fuerza distintos', async () => {
    const workouts = [
      { date: '2026-05-12', routineName: 'Pecho + Tríceps', durationMin: 55,
        exercises: [{ name: 'Flexiones', sets: 4, reps: 15 }, { name: 'Dips', sets: 3, reps: 12 }] },
      { date: '2026-05-13', routineName: 'Espalda + Bíceps', durationMin: 60,
        exercises: [{ name: 'Remo', sets: 4, reps: 12 }, { name: 'Curl bíceps', sets: 4, reps: 12 }] },
      { date: '2026-05-14', routineName: 'Piernas', durationMin: 70,
        exercises: [{ name: 'Sentadillas', sets: 4, reps: 15 }, { name: 'Zancadas', sets: 3, reps: 12 }] },
    ];

    for (const w of workouts) {
      const res = await request(app).post('/api/v1/auth/workout-log')
        .set('Authorization', `Bearer ${token}`).send(w);
      expect(res.status).toBe(200);
    }
  });

  it('3.3 Laura ve su historial de 3 entrenamientos en pantalla "Historial"', async () => {
    const res = await request(app).get('/api/v1/auth/workout-logs')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    const nombres = res.body.data.map(l => l.nombre_rutina);
    expect(nombres).toContain('Piernas');
    expect(nombres).toContain('Pecho + Tríceps');
    expect(nombres).toContain('Espalda + Bíceps');
  });

  it('3.4 Laura exporta su historial de workouts como CSV', async () => {
    const res = await request(app).get('/api/v1/auth/export/csv?type=workouts')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/i);
    // El CSV tiene al menos la cabecera
    expect(res.text).toMatch(/fecha|rutina|duracion/i);
    // Y los datos de Laura
    expect(res.text).toMatch(/Piernas|Pecho/);
  });

  it('3.5 Laura registra su progreso corporal (peso + medidas)', async () => {
    const progresos = [
      { date: '2026-05-12', weight: 62.0, waistCm: 68, armCm: 32 },
      { date: '2026-05-14', weight: 62.3, waistCm: 68, armCm: 32.5 },
    ];
    for (const p of progresos) {
      const res = await request(app).post('/api/v1/auth/progress-log')
        .set('Authorization', `Bearer ${token}`).send(p);
      expect(res.status).toBe(200);
    }
  });

  it('3.6 Laura exporta su progreso completo (workout + dieta + progreso)', async () => {
    const res = await request(app).get('/api/v1/auth/export/csv')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    // Export genérico exporta workouts por defecto
    expect(res.headers['content-type']).toMatch(/text\/csv/i);
  });

  it('3.7 Laura genera una rutina personalizada de ganancia muscular', async () => {
    const res = await request(app).post('/api/v1/routines/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({ goal: 'gain' });

    expect(res.status).toBe(200);
    expect(res.body.weeklyDays).toBe(5);
    // Verifica que los ejercicios de fuerza están presentes
    const allExercises = res.body.days.flatMap(d => d.exercises);
    expect(allExercises.length).toBeGreaterThan(10);
  });

  it('3.8 Laura ve sus métricas físicas calculadas', async () => {
    const res = await request(app).post('/api/v1/progress/metrics')
      .set('Authorization', `Bearer ${token}`)
      .send({
        weight: 62.3, heightCm: 170, age: 26,
        gender: 'female', activityLevel: 'active', goal: 'gain',
      });

    expect(res.status).toBe(200);
    expect(res.body.bmi).toBeGreaterThan(18);
    expect(res.body.bmi).toBeLessThan(25); // Laura está en peso normal
    // En ganancia, el objetivo calórico es mayor al TDEE
    expect(res.body.calorie_target).toBeGreaterThan(res.body.tdee - 1); // gain: +300-400 kcal
  });

  it('3.9 Laura configura sus ajustes personalizados', async () => {
    await request(app).put('/api/v1/settings/notifications')
      .set('Authorization', `Bearer ${token}`)
      .send({ value: 'daily_08:00' });

    await request(app).put('/api/v1/settings/units')
      .set('Authorization', `Bearer ${token}`)
      .send({ value: 'metric' });

    const all = await request(app).get('/api/v1/settings')
      .set('Authorization', `Bearer ${token}`);

    expect(all.body.notifications).toBe('daily_08:00');
    expect(all.body.units).toBe('metric');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PERSONA 4 — Aislamiento multi-usuario
// Los datos de un usuario NUNCA son visibles para otro
// ═══════════════════════════════════════════════════════════════════════════

describe('Persona 4 — Aislamiento de datos entre usuarios', () => {
  let tokenA, tokenB;
  const emailA = `usera_${Date.now()}@test.com`;
  const emailB = `userb_${Date.now()}@test.com`;
  afterAll(() => resetMocks());

  beforeAll(async () => {
    const [rA, rB] = await Promise.all([
      request(app).post('/api/v1/auth/register')
        .send({ email: emailA, password: 'Pass1234!', name: 'Usuario A' }),
      request(app).post('/api/v1/auth/register')
        .send({ email: emailB, password: 'Pass1234!', name: 'Usuario B' }),
    ]);
    tokenA = rA.body.accessToken;
    tokenB = rB.body.accessToken;

    // Usuario A crea datos privados
    await Promise.all([
      request(app).post('/api/v1/auth/workout-log')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ routineName: 'Secreto de Usuario A', exercises: [] }),
      request(app).post('/api/v1/meals')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Comida privada A', calories: 500, date: '2026-05-14' }),
      request(app).put('/api/v1/settings/secret_setting')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ value: 'dato_privado_A' }),
    ]);
  });

  it('4.1 Usuario B no puede ver los workout-logs de Usuario A', async () => {
    const res = await request(app).get('/api/v1/auth/workout-logs')
      .set('Authorization', `Bearer ${tokenB}`);

    const nombres = res.body.data.map(l => l.nombre_rutina);
    expect(nombres).not.toContain('Secreto de Usuario A');
  });

  it('4.2 Usuario B no puede ver las comidas de Usuario A', async () => {
    const res = await request(app).get('/api/v1/meals')
      .set('Authorization', `Bearer ${tokenB}`);

    const names = res.body.data.map(m => m.nombre ?? m.name);
    expect(names).not.toContain('Comida privada A');
  });

  it('4.3 Usuario B no puede ver los settings de Usuario A', async () => {
    const res = await request(app).get('/api/v1/settings')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.body.secret_setting).toBeUndefined();
  });

  it('4.4 Usuario B no puede ver el perfil de Usuario A', async () => {
    const meB = await request(app).get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(meB.body.email).toBe(emailB);
    expect(meB.body.email).not.toBe(emailA);
  });

  it('4.5 Token de A no puede ser usado en rutas de B (JWT firmado)', async () => {
    // El token de A sigue siendo válido, pero /me devuelve el perfil de A, no de B
    const meA = await request(app).get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(meA.body.email).toBe(emailA);
  });

  it('4.6 Un token caducado/inválido no puede acceder a datos de ningún usuario', async () => {
    const res = await request(app).get('/api/v1/auth/me')
      .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6OTk5fQ.invalid');
    expect(res.status).toBe(401);
  });

  it('4.7 Ambos usuarios pueden usar la app simultáneamente sin interferir', async () => {
    const [resA, resB] = await Promise.all([
      request(app).get('/api/v1/auth/workout-logs').set('Authorization', `Bearer ${tokenA}`),
      request(app).get('/api/v1/auth/workout-logs').set('Authorization', `Bearer ${tokenB}`),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const nombresA = resA.body.data.map(l => l.nombre_rutina);
    const nombresB = resB.body.data.map(l => l.nombre_rutina);

    expect(nombresA).toContain('Secreto de Usuario A');
    expect(nombresB).not.toContain('Secreto de Usuario A');
  });
});
