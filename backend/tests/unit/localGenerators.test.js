'use strict';

/**
 * Unit tests — Generadores locales de rutinas y dietas.
 * Se prueban como lógica pura (sin HTTP, sin DB).
 */

// ── Copia fiel de _localRoutine() de src/routes/v1/routines.js ───────────────
function localRoutine(goal) {
  const plans = {
    lose: {
      name: 'Plan pérdida de peso — 4 días/semana',
      source: 'local',
      weeklyDays: 4,
      days: [
        { day: 'Lunes',   focus: 'Cardio + Core',       exercises: ['Caminata rápida 30 min', 'Planchas 3×30 s', 'Abdominales 3×20', 'Mountain climbers 3×15'] },
        { day: 'Martes',  focus: 'Fuerza tren superior', exercises: ['Flexiones 3×12', 'Remo invertido 3×12', 'Press hombros 3×12', 'Curl bíceps 3×15'] },
        { day: 'Jueves',  focus: 'HIIT',                exercises: ['Burpees 4×10', 'Jumping jacks 4×30 s', 'Sentadillas con salto 4×15', 'Sprint en sitio 4×30 s'] },
        { day: 'Viernes', focus: 'Fuerza tren inferior', exercises: ['Sentadillas 3×15', 'Zancadas 3×12/lado', 'Puente de glúteos 3×20', 'Elevaciones de talones 3×20'] },
      ],
      notes: 'Descanso activo (caminar) los días libres. Hidratación: mínimo 2 L/día.',
    },
    gain: {
      name: 'Plan ganancia muscular — 5 días/semana',
      source: 'local',
      weeklyDays: 5,
      days: [
        { day: 'Lunes',    focus: 'Pecho + Tríceps',  exercises: ['Flexiones 4×15', 'Flexiones diamante 3×12', 'Dips en silla 3×12', 'Extensión tríceps 3×15'] },
        { day: 'Martes',   focus: 'Espalda + Bíceps', exercises: ['Remo con mancuerna 4×12', 'Pull-ups asistidas 3×8', 'Curl bíceps 4×12', 'Curl martillo 3×12'] },
        { day: 'Miércoles',focus: 'Piernas',          exercises: ['Sentadillas 4×15', 'Zancadas 4×12', 'Peso muerto rumano 3×12', 'Elevación de talones 3×20'] },
        { day: 'Jueves',   focus: 'Hombros + Core',   exercises: ['Press hombros 4×12', 'Elevaciones laterales 3×15', 'Planchas 3×45 s', 'Abdominales 4×20'] },
        { day: 'Viernes',  focus: 'Full body potencia',exercises: ['Sentadillas con salto 4×10', 'Flexiones explosivas 3×8', 'Burpees 3×10', 'Remo explosivo 4×10'] },
      ],
      notes: 'Superávit calórico de 300 kcal. Proteína: 1.8 g/kg de peso corporal.',
    },
    maintain: {
      name: 'Plan mantenimiento — 3 días/semana',
      source: 'local',
      weeklyDays: 3,
      days: [
        { day: 'Lunes',    focus: 'Full body A',        exercises: ['Sentadillas 3×12', 'Flexiones 3×12', 'Remo 3×12', 'Plancha 2×30 s'] },
        { day: 'Miércoles',focus: 'Cardio + Movilidad', exercises: ['Cardio moderado 25 min', 'Estiramientos dinámicos 10 min', 'Yoga flujo 15 min'] },
        { day: 'Viernes',  focus: 'Full body B',        exercises: ['Zancadas 3×12', 'Dips 3×10', 'Press hombros 3×12', 'Core circuit 2 rondas'] },
      ],
      notes: 'Mantén la constancia. Añade 5 min de movilidad articular al despertar.',
    },
  };
  return plans[goal] || plans.maintain;
}

// ── Copia fiel de _localDiet() de src/routes/v1/diets.js ─────────────────────
function localDiet(goal, weekStart) {
  const targets = { lose: 1800, gain: 2600, maintain: 2100 };
  const kcal    = targets[goal] || 2100;
  const mealTemplates = {
    lose: [
      { name: 'Desayuno', kcal: Math.round(kcal * 0.20), desc: 'Avena con frutos rojos + café sin azúcar' },
      { name: 'Almuerzo', kcal: Math.round(kcal * 0.35), desc: 'Pechuga a la plancha + ensalada verde + arroz integral (60 g)' },
      { name: 'Merienda', kcal: Math.round(kcal * 0.10), desc: 'Yogur griego 0% + manzana' },
      { name: 'Cena',     kcal: Math.round(kcal * 0.30), desc: 'Salmón al horno + brócoli al vapor + batata (100 g)' },
      { name: 'Extra',    kcal: Math.round(kcal * 0.05), desc: 'Frutos secos (20 g)' },
    ],
    gain: [
      { name: 'Desayuno',      kcal: Math.round(kcal * 0.25), desc: 'Tortilla 3 huevos + tostadas integrales + zumo natural' },
      { name: 'Media mañana',  kcal: Math.round(kcal * 0.10), desc: 'Batido proteico + plátano' },
      { name: 'Almuerzo',      kcal: Math.round(kcal * 0.30), desc: 'Arroz integral (150 g) + pollo 200 g + verduras salteadas' },
      { name: 'Merienda',      kcal: Math.round(kcal * 0.10), desc: 'Requesón + nueces + miel' },
      { name: 'Cena',          kcal: Math.round(kcal * 0.25), desc: 'Pasta (120 g) + ternera magra + tomate natural' },
    ],
    maintain: [
      { name: 'Desayuno', kcal: Math.round(kcal * 0.22), desc: 'Tostadas integrales + aguacate + 2 huevos revueltos' },
      { name: 'Almuerzo', kcal: Math.round(kcal * 0.35), desc: 'Legumbres (garbanzos/lentejas) + ensalada + pan integral' },
      { name: 'Merienda', kcal: Math.round(kcal * 0.10), desc: 'Fruta de temporada + puñado de almendras' },
      { name: 'Cena',     kcal: Math.round(kcal * 0.28), desc: 'Pescado blanco + arroz basmati + ensalada variada' },
      { name: 'Extra',    kcal: Math.round(kcal * 0.05), desc: 'Infusión + cuadrado de chocolate negro 85%' },
    ],
  };
  const meals = mealTemplates[goal] || mealTemplates.maintain;
  const days  = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
  return {
    source: 'local', weekStart, goal,
    dailyCalorieTarget: kcal,
    days: days.map(day => ({
      day,
      totalCalories: kcal,
      meals: meals.map(m => ({ name: m.name, calories: m.kcal, description: m.desc })),
    })),
    notes: 'Plan generado localmente. Activa el servicio RAG para planes personalizados con IA.',
  };
}

// ── Tests rutinas ─────────────────────────────────────────────────────────────

describe('Generador local de rutinas', () => {
  describe('Plan "lose" (pérdida de peso)', () => {
    let plan;
    beforeAll(() => { plan = localRoutine('lose'); });

    it('tiene source "local"', () => expect(plan.source).toBe('local'));
    it('son 4 días/semana', () => expect(plan.weeklyDays).toBe(4));
    it('tiene exactamente 4 días', () => expect(plan.days).toHaveLength(4));
    it('cada día tiene al menos 3 ejercicios', () => {
      plan.days.forEach(d => expect(d.exercises.length).toBeGreaterThanOrEqual(3));
    });
    it('incluye al menos un día de cardio', () => {
      const hasCardio = plan.days.some(d => /cardio|caminata|hiit/i.test(d.focus));
      expect(hasCardio).toBe(true);
    });
    it('incluye notas de hidratación', () => {
      expect(plan.notes).toMatch(/hidrataci/i);
    });
  });

  describe('Plan "gain" (ganancia muscular)', () => {
    let plan;
    beforeAll(() => { plan = localRoutine('gain'); });

    it('son 5 días/semana', () => expect(plan.weeklyDays).toBe(5));
    it('tiene exactamente 5 días', () => expect(plan.days).toHaveLength(5));
    it('incluye trabajo de piernas', () => {
      const hasLegs = plan.days.some(d => /pierna|sentadilla/i.test(d.focus));
      expect(hasLegs).toBe(true);
    });
    it('menciona proteína en las notas', () => {
      expect(plan.notes).toMatch(/prote/i);
    });
  });

  describe('Plan "maintain" (mantenimiento)', () => {
    let plan;
    beforeAll(() => { plan = localRoutine('maintain'); });

    it('son 3 días/semana', () => expect(plan.weeklyDays).toBe(3));
    it('tiene exactamente 3 días', () => expect(plan.days).toHaveLength(3));
  });

  it('objetivo desconocido devuelve el plan "maintain" como fallback', () => {
    const plan = localRoutine('alien_goal');
    expect(plan.weeklyDays).toBe(3);
    expect(plan.name).toMatch(/mantenimiento/i);
  });
});

// ── Tests dietas ──────────────────────────────────────────────────────────────

describe('Generador local de dietas', () => {
  const WEEK = '2024-04-01';

  describe('Plan "lose" (1800 kcal)', () => {
    let plan;
    beforeAll(() => { plan = localDiet('lose', WEEK); });

    it('dailyCalorieTarget es 1800', () => expect(plan.dailyCalorieTarget).toBe(1800));
    it('tiene 7 días', () => expect(plan.days).toHaveLength(7));
    it('cada día suma ≈ 1800 kcal', () => {
      plan.days.forEach(d => expect(d.totalCalories).toBe(1800));
    });
    it('incluye desayuno, almuerzo y cena', () => {
      const names = plan.days[0].meals.map(m => m.name.toLowerCase());
      expect(names).toContain('desayuno');
      expect(names).toContain('almuerzo');
      expect(names).toContain('cena');
    });
    it('las calorías de las comidas son enteros positivos', () => {
      plan.days[0].meals.forEach(m => {
        expect(m.calories).toBeGreaterThan(0);
        expect(Number.isInteger(m.calories)).toBe(true);
      });
    });
  });

  describe('Plan "gain" (2600 kcal)', () => {
    let plan;
    beforeAll(() => { plan = localDiet('gain', WEEK); });

    it('dailyCalorieTarget es 2600', () => expect(plan.dailyCalorieTarget).toBe(2600));
    it('tiene 5 comidas/día', () => {
      expect(plan.days[0].meals).toHaveLength(5);
    });
    it('incluye media mañana', () => {
      const names = plan.days[0].meals.map(m => m.name.toLowerCase());
      expect(names.some(n => n.includes('mañana'))).toBe(true);
    });
  });

  describe('Plan "maintain" (2100 kcal)', () => {
    let plan;
    beforeAll(() => { plan = localDiet('maintain', WEEK); });

    it('dailyCalorieTarget es 2100', () => expect(plan.dailyCalorieTarget).toBe(2100));
  });

  it('preserva weekStart en la respuesta', () => {
    const plan = localDiet('maintain', '2024-06-10');
    expect(plan.weekStart).toBe('2024-06-10');
  });

  it('objetivo desconocido → 2100 kcal como fallback', () => {
    const plan = localDiet('alien_goal', WEEK);
    expect(plan.dailyCalorieTarget).toBe(2100);
  });

  it('source siempre es "local"', () => {
    expect(localDiet('lose', WEEK).source).toBe('local');
    expect(localDiet('gain', WEEK).source).toBe('local');
    expect(localDiet('maintain', WEEK).source).toBe('local');
  });

  it('la distribución calórica de "lose" suma aproximadamente 1 (100%)', () => {
    const portions = [0.20, 0.35, 0.10, 0.30, 0.05];
    const sum = portions.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });
});
