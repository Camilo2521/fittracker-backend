'use strict';

/**
 * FUNCTIONAL TEST — 04: Tracking Precision
 * ─────────────────────────────────────────────────────────────────────────────
 * Verifica que:
 *   • El registro de peso actualiza el perfil del usuario automáticamente
 *   • Las métricas BMI/BMR/TDEE son matemáticamente exactas
 *   • Múltiples registros de progreso se almacenan correctamente con fechas
 *   • El historial de entrenamientos preserva los JSON de ejercicios con fidelidad
 *   • Los logs de dieta preservan las comidas con fidelidad
 *   • El targeting calórico es correcto para todos los objetivos
 *   • La hidratación se calcula con la fórmula correcta
 *   • Los datos de seguimiento están ordenados por fecha (DESC)
 */

jest.mock('../../src/db/postgres', () => require('../helpers/mockPostgres').mockPg);
jest.mock('../../src/services/visionClient', () => require('../helpers/mockVision').mockVision);

const request = require('supertest');
const { registerUser, bearerHeader } = require('../helpers/auth');

let app, db;
beforeAll(() => {
  app = require('../../src/app');
  db  = require('../../src/db/connection');
});

// ── 1. Tracking de peso ────────────────────────────────────────────────────────

describe('Tracking de peso — precisión y persistencia', () => {
  let token, userId;
  beforeAll(async () => {
    const r = await registerUser(app, { weight: 80, height: 175, age: 30, gender: 'male', goal: 'lose' });
    token = r.token; userId = r.user.id;
  });

  it('el perfil inicial refleja el peso de registro', async () => {
    const me = await request(app).get('/api/v1/auth/me').set(bearerHeader(token));
    expect(me.body.weight).toBe(80);
  });

  it('registrar un progress-log actualiza el peso del perfil', async () => {
    await request(app).post('/api/v1/auth/progress-log')
      .set(bearerHeader(token)).send({ weight: 78.5, date: '2024-04-10' });
    const me = await request(app).get('/api/v1/auth/me').set(bearerHeader(token));
    expect(me.body.weight).toBe(78.5);
  });

  it('múltiples registros de peso en distintas fechas se almacenan todos', async () => {
    const weights = [78.0, 77.5, 77.2, 76.8, 76.3];
    for (const [i, w] of weights.entries()) {
      await request(app).post('/api/v1/auth/progress-log')
        .set(bearerHeader(token))
        .send({ weight: w, date: `2024-04-${11 + i}` });
    }
    const logs = await request(app).get('/api/v1/auth/progress-logs')
      .set(bearerHeader(token));
    expect(logs.body.data.length).toBeGreaterThanOrEqual(5);
  });

  it('el último peso registrado prevalece en el perfil', async () => {
    await request(app).post('/api/v1/auth/progress-log')
      .set(bearerHeader(token)).send({ weight: 75.0, date: '2024-04-20' });
    const me = await request(app).get('/api/v1/auth/me').set(bearerHeader(token));
    expect(me.body.weight).toBe(75.0);
  });

  it('progress-log sin weight no rompe el sistema', async () => {
    const res = await request(app).post('/api/v1/auth/progress-log')
      .set(bearerHeader(token))
      .send({ date: '2024-04-21', waistCm: 88, hipCm: 98, chestCm: 100 });
    expect(res.status).toBe(200);
  });

  it('los logs incluyen todas las medidas corporales enviadas', async () => {
    await request(app).post('/api/v1/auth/progress-log')
      .set(bearerHeader(token))
      .send({ date: '2024-04-22', weight: 74.5, bodyFat: 18.5, chestCm: 99, waistCm: 86, hipCm: 96, armCm: 35 });
    const logs = await request(app).get('/api/v1/auth/progress-logs').set(bearerHeader(token));
    const today = logs.body.data.find(l => l.fecha === '2024-04-22');
    expect(today.peso).toBe(74.5);
    expect(today.grasa_corporal).toBe(18.5);
    expect(today.pecho_cm).toBe(99);
    expect(today.cintura_cm).toBe(86);
    expect(today.cadera_cm).toBe(96);
    expect(today.brazo_cm).toBe(35);
  });

  it('el historial de progreso devuelve máximo 90 registros', async () => {
    const logs = await request(app).get('/api/v1/auth/progress-logs').set(bearerHeader(token));
    expect(logs.body.data.length).toBeLessThanOrEqual(90);
  });
});

// ── 2. Precisión de métricas BMI / BMR / TDEE ─────────────────────────────────

describe('Precisión de métricas físicas (Mifflin-St Jeor)', () => {
  let token;
  beforeAll(async () => {
    ({ token } = await registerUser(app));
  });

  const cases = [
    // [desc, input, expectedBMI, expectedBMR, expectedTDEE_moderate, goal, expectedTarget]
    {
      desc: 'hombre 75kg 180cm 30a moderado maintain',
      input: { userId:'m1', weight:75, heightCm:180, age:30, gender:'male', activityLevel:'moderate', goal:'maintain' },
      bmi: 23.1,
      bmr: 1730,        // 10×75+6.25×180-5×30+5
      tdee: 2681,       // 1730×1.55
      target: 2681,
    },
    {
      desc: 'mujer 60kg 165cm 25a light lose',
      input: { userId:'f1', weight:60, heightCm:165, age:25, gender:'female', activityLevel:'light', goal:'lose' },
      bmi: 22.0,
      bmr: 1345,        // 10×60+6.25×165-5×25-161
      tdee: 1850,       // 1345×1.375
      target: 1450,     // 1850-400
    },
    {
      desc: 'hombre 90kg 185cm 35a active gain',
      input: { userId:'m2', weight:90, heightCm:185, age:35, gender:'male', activityLevel:'active', goal:'gain' },
      bmi: 26.3,
      bmr: 1886,        // 10×90=900, 6.25×185=1156.25, 5×35=175, +5 → 1886.25→1886
      tdee: 3254,       // 1886×1.725=3253.4→3254
      target: 3554,     // 3254+300
    },
  ];

  for (const tc of cases) {
    describe(tc.desc, () => {
      let body;
      beforeAll(async () => {
        const res = await request(app).post('/api/v1/progress/metrics')
          .set(bearerHeader(token))
          .send(tc.input);
        body = res.body;
      });

      it('BMI es correcto (±0.5)', () => {
        expect(Math.abs(body.bmi - tc.bmi)).toBeLessThanOrEqual(0.5);
      });

      it('BMR es correcto (±10 kcal)', () => {
        expect(Math.abs(body.bmr - tc.bmr)).toBeLessThanOrEqual(10);
      });

      it('TDEE es correcto (±15 kcal)', () => {
        expect(Math.abs(body.tdee - tc.tdee)).toBeLessThanOrEqual(15);
      });

      it('calorie_target es correcto (±15 kcal)', () => {
        expect(Math.abs(body.calorie_target - tc.target)).toBeLessThanOrEqual(15);
      });

      it('todos los valores son números enteros o con 1 decimal', () => {
        expect(typeof body.bmi).toBe('number');
        expect(Number.isInteger(body.bmr)).toBe(true);
        expect(Number.isInteger(body.tdee)).toBe(true);
        expect(Number.isInteger(body.calorie_target)).toBe(true);
      });
    });
  }

  it('TDEE es siempre mayor que BMR', async () => {
    const res = await request(app).post('/api/v1/progress/metrics')
      .set(bearerHeader(token))
      .send({ weight: 70, heightCm: 170, age: 28 });
    expect(res.body.tdee).toBeGreaterThan(res.body.bmr);
  });

  it('calorie_target lose es siempre menor que TDEE', async () => {
    const res = await request(app).post('/api/v1/progress/metrics')
      .set(bearerHeader(token))
      .send({ weight: 70, heightCm: 170, age: 28, goal: 'lose' });
    expect(res.body.calorie_target).toBeLessThan(res.body.tdee);
  });

  it('calorie_target gain es siempre mayor que TDEE', async () => {
    const res = await request(app).post('/api/v1/progress/metrics')
      .set(bearerHeader(token))
      .send({ weight: 70, heightCm: 170, age: 28, goal: 'gain' });
    expect(res.body.calorie_target).toBeGreaterThan(res.body.tdee);
  });
});

// ── 3. Tracking de entrenamientos ─────────────────────────────────────────────

describe('Tracking de entrenamientos — fidelidad de datos', () => {
  let token;
  const exercises = [
    { name: 'Sentadilla', sets: 4, reps: 12, weight: 80, notes: 'Profunda' },
    { name: 'Press banca', sets: 3, reps: 10, weight: 60 },
    { name: 'Peso muerto', sets: 4, reps: 8,  weight: 100 },
  ];

  beforeAll(async () => {
    ({ token } = await registerUser(app));
  });

  it('preserva el JSON de ejercicios con todos los campos', async () => {
    const post = await request(app).post('/api/v1/auth/workout-log')
      .set(bearerHeader(token))
      .send({ date: '2024-05-01', routineName: 'Push Pull Legs', exercises, durationMin: 65, notes: 'PR en sentadilla' });
    expect(post.status).toBe(200);
    const logs = await request(app).get('/api/v1/auth/workout-logs').set(bearerHeader(token));
    const log  = logs.body.data.find(l => l.nombre_rutina === 'Push Pull Legs');
    expect(log).toBeDefined();
    expect(log.ejercicios_json).toEqual(exercises);
    expect(log.duracion_min).toBe(65);
    expect(log.notas).toBe('PR en sentadilla');
  });

  it('ejercicios vacíos se almacenan como array vacío', async () => {
    await request(app).post('/api/v1/auth/workout-log')
      .set(bearerHeader(token))
      .send({ date: '2024-05-02', routineName: 'Cardio ligero', exercises: [] });
    const logs = await request(app).get('/api/v1/auth/workout-logs').set(bearerHeader(token));
    const log  = logs.body.data.find(l => l.nombre_rutina === 'Cardio ligero');
    expect(Array.isArray(log.ejercicios_json)).toBe(true);
    expect(log.ejercicios_json).toHaveLength(0);
  });

  it('fecha por defecto es la fecha actual si no se envía', async () => {
    const post = await request(app).post('/api/v1/auth/workout-log')
      .set(bearerHeader(token))
      .send({ routineName: 'Sin fecha', exercises: [] });
    expect(post.status).toBe(200);
    const logs = await request(app).get('/api/v1/auth/workout-logs').set(bearerHeader(token));
    const log  = logs.body.data.find(l => l.nombre_rutina === 'Sin fecha');
    expect(log.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('múltiples entrenamientos en el mismo día se almacenan todos', async () => {
    for (let i = 1; i <= 3; i++) {
      await request(app).post('/api/v1/auth/workout-log')
        .set(bearerHeader(token))
        .send({ date: '2024-05-10', routineName: `Sesión ${i}`, exercises: [] });
    }
    const logs = await request(app).get('/api/v1/auth/workout-logs').set(bearerHeader(token));
    const sesiones = logs.body.data.filter(l => l.fecha === '2024-05-10');
    expect(sesiones.length).toBeGreaterThanOrEqual(3);
  });
});

// ── 4. Tracking de nutrición ──────────────────────────────────────────────────

describe('Tracking de nutrición — fidelidad de datos', () => {
  let token;
  const meals = [
    { name: 'Desayuno',  calories: 450, protein: 30, carbs: 55, fat: 10, description: 'Avena con proteína' },
    { name: 'Almuerzo',  calories: 650, protein: 45, carbs: 70, fat: 15, description: 'Pechuga + arroz' },
    { name: 'Cena',      calories: 500, protein: 35, carbs: 40, fat: 18, description: 'Salmón + verduras' },
  ];

  beforeAll(async () => {
    ({ token } = await registerUser(app));
  });

  it('preserva el JSON de comidas con macro exactos', async () => {
    const post = await request(app).post('/api/v1/auth/diet-log')
      .set(bearerHeader(token))
      .send({ date: '2024-05-01', planName: 'Plan pérdida', meals, totalKcal: 1600 });
    expect(post.status).toBe(200);
    const logs = await request(app).get('/api/v1/auth/diet-logs').set(bearerHeader(token));
    const log  = logs.body.data.find(l => l.nombre_plan === 'Plan pérdida');
    expect(log.comidas_json).toEqual(meals);
    expect(log.total_kcal).toBe(1600);
  });

  it('preserva la fecha correctamente', async () => {
    await request(app).post('/api/v1/auth/diet-log')
      .set(bearerHeader(token))
      .send({ date: '2024-06-15', planName: 'Log de prueba', meals: [], totalKcal: 0 });
    const logs = await request(app).get('/api/v1/auth/diet-logs').set(bearerHeader(token));
    const log  = logs.body.data.find(l => l.nombre_plan === 'Log de prueba');
    expect(log.fecha).toBe('2024-06-15');
  });

  it('notas del plan se almacenan si se envían', async () => {
    await request(app).post('/api/v1/auth/diet-log')
      .set(bearerHeader(token))
      .send({ date: '2024-06-16', planName: 'Con notas', meals: [], notes: 'Día difícil, comí fuera' });
    const logs = await request(app).get('/api/v1/auth/diet-logs').set(bearerHeader(token));
    const log  = logs.body.data.find(l => l.nombre_plan === 'Con notas');
    expect(log.notas).toBe('Día difícil, comí fuera');
  });
});

// ── 5. Distribución calórica de dietas generadas ──────────────────────────────

describe('Distribución calórica de dietas generadas — validación matemática', () => {
  let token;
  beforeAll(async () => {
    ({ token } = await registerUser(app));
  });

  it('plan "lose": las calorías de comidas suman ~100% del objetivo diario', async () => {
    const res = await request(app).post('/api/v1/diets/generate')
      .set(bearerHeader(token))
      .send({ weekStart: '2024-05-01', goal: 'lose' });
    const day  = res.body.days[0];
    const sum  = day.meals.reduce((acc, m) => acc + m.calories, 0);
    const pct  = sum / res.body.dailyCalorieTarget;
    // La suma de proporciones (0.20+0.35+0.10+0.30+0.05) = 1.00 → pequeño error de redondeo
    expect(pct).toBeGreaterThan(0.95);
    expect(pct).toBeLessThan(1.05);
  });

  it('plan "gain": las calorías diarias coinciden con el objetivo', async () => {
    const res = await request(app).post('/api/v1/diets/generate')
      .set(bearerHeader(token))
      .send({ weekStart: '2024-05-01', goal: 'gain' });
    expect(res.body.dailyCalorieTarget).toBe(2600);
    res.body.days.forEach(d => expect(d.totalCalories).toBe(2600));
  });

  it('plan "maintain": todas las comidas tienen calories > 0', async () => {
    const res = await request(app).post('/api/v1/diets/generate')
      .set(bearerHeader(token))
      .send({ weekStart: '2024-05-01', goal: 'maintain' });
    res.body.days.forEach(day => {
      day.meals.forEach(meal => {
        expect(meal.calories).toBeGreaterThan(0);
      });
    });
  });
});

// ── 6. Precisión de hidratación del AI ───────────────────────────────────────

describe('Cálculo de hidratación — fórmula 0.033 L/kg', () => {
  jest.mock('../../src/services/ollamaService', () => ({
    isAvailable: jest.fn().mockResolvedValue(false),
    getModel: () => 'llama3.2',
  }));

  const hydrationCases = [
    { weight: 60, expected: 2.0 },
    { weight: 70, expected: 2.3 },
    { weight: 80, expected: 2.6 },
    { weight: 100, expected: 3.3 },
  ];

  it.each(hydrationCases)(
    'peso $weight kg → ~$expected L/día',
    async ({ weight, expected }) => {
      const res = await request(app).post('/api/v1/ai/chat').send({
        messages:    [{ role: 'user', content: '¿Cuánta agua debo beber?' }],
        userProfile: { weight, goal: 'maintain' },
      });
      expect(res.status).toBe(200);
      // JS formatea 2.0 como "2" en template literals — el regex acepta enteros y decimales
      const match = res.body.content.match(/(\d+(?:[.,]\d+)?)\s*L/i);
      if (match) {
        const litros = parseFloat(match[1].replace(',', '.'));
        expect(Math.abs(litros - expected)).toBeLessThanOrEqual(0.3);
      }
      expect(res.body.content).toMatch(/\d+(?:[.,]\d+)?\s*L|litro/i);
    }
  );
});

// ── 7. Rutinas generadas — consistencia de datos ──────────────────────────────

describe('Rutinas generadas — consistencia y completitud', () => {
  let token;
  beforeAll(async () => {
    ({ token } = await registerUser(app));
  });

  it.each(['lose', 'gain', 'maintain'])('rutina "%s" tiene días únicos', async (goal) => {
    const res = await request(app).post('/api/v1/routines/generate')
      .set(bearerHeader(token))
      .send({ goal });
    const days = res.body.days.map(d => d.day);
    const unique = new Set(days);
    expect(unique.size).toBe(days.length); // sin repetidos
  });

  it('los ejercicios son strings no vacíos', async () => {
    const res = await request(app).post('/api/v1/routines/generate')
      .set(bearerHeader(token))
      .send({ goal: 'gain' });
    res.body.days.forEach(day => {
      day.exercises.forEach(ex => {
        expect(typeof ex).toBe('string');
        expect(ex.length).toBeGreaterThan(3);
      });
    });
  });

  it('las notas son un string informativo', async () => {
    const res = await request(app).post('/api/v1/routines/generate')
      .set(bearerHeader(token))
      .send({ goal: 'lose' });
    expect(typeof res.body.notes).toBe('string');
    expect(res.body.notes.length).toBeGreaterThan(10);
  });
});
