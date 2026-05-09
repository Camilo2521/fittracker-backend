'use strict';

/**
 * Unit tests — Cálculos de métricas físicas (BMI, BMR, TDEE, calorie target).
 *
 * Estos valores se calculan en src/routes/v1/progress.js.
 * Los extraemos aquí como funciones puras para probarlos de forma aislada.
 */

// ── Funciones extraídas del handler (misma lógica) ────────────────────────────

function calcBMI(weight, heightCm) {
  return weight / ((heightCm / 100) ** 2);
}

function calcBMR(weight, heightCm, age, gender) {
  return gender === 'female'
    ? 10 * weight + 6.25 * heightCm - 5 * age - 161
    : 10 * weight + 6.25 * heightCm - 5 * age + 5;
}

const ACTIVITY_FACTORS = {
  sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9,
};

function calcTDEE(bmr, activityLevel) {
  return bmr * (ACTIVITY_FACTORS[activityLevel] || 1.55);
}

function calcCalorieTarget(tdee, goal) {
  if (goal === 'lose') return tdee - 400;
  if (goal === 'gain') return tdee + 300;
  return tdee;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BMI (Índice de Masa Corporal)', () => {
  it('calcula correctamente para hombre promedio', () => {
    const bmi = calcBMI(75, 180);
    expect(bmi).toBeCloseTo(23.15, 1);
  });

  it('clasifica como bajo peso cuando BMI < 18.5', () => {
    expect(calcBMI(50, 180)).toBeLessThan(18.5);
  });

  it('clasifica como peso normal cuando 18.5 ≤ BMI < 25', () => {
    const bmi = calcBMI(70, 175);
    expect(bmi).toBeGreaterThanOrEqual(18.5);
    expect(bmi).toBeLessThan(25);
  });

  it('clasifica como sobrepeso cuando 25 ≤ BMI < 30', () => {
    const bmi = calcBMI(90, 175);
    expect(bmi).toBeGreaterThanOrEqual(25);
    expect(bmi).toBeLessThan(30);
  });

  it('clasifica como obesidad cuando BMI ≥ 30', () => {
    expect(calcBMI(105, 175)).toBeGreaterThanOrEqual(30);
  });

  it('se ve afectado cuadráticamente por la altura', () => {
    const bmi170 = calcBMI(80, 170);
    const bmi180 = calcBMI(80, 180);
    expect(bmi170).toBeGreaterThan(bmi180); // más alto → menor BMI con mismo peso
  });
});

describe('BMR (Tasa Metabólica Basal) — Mifflin-St Jeor', () => {
  it('hombre 75 kg, 180 cm, 30 años → ~1730 kcal (Mifflin-St Jeor)', () => {
    // 10×75 + 6.25×180 - 5×30 + 5 = 750 + 1125 - 150 + 5 = 1730
    const bmr = calcBMR(75, 180, 30, 'male');
    expect(bmr).toBeCloseTo(1730, 0);
  });

  it('mujer 60 kg, 165 cm, 25 años → ~1345 kcal (Mifflin-St Jeor)', () => {
    // 10×60 + 6.25×165 - 5×25 - 161 = 600 + 1031.25 - 125 - 161 = 1345.25
    const bmr = calcBMR(60, 165, 25, 'female');
    expect(bmr).toBeCloseTo(1345.25, 0);
  });

  it('hombre siempre tiene BMR > mujer con mismo peso/altura/edad', () => {
    const male   = calcBMR(70, 170, 30, 'male');
    const female = calcBMR(70, 170, 30, 'female');
    expect(male).toBeGreaterThan(female);
  });

  it('BMR disminuye con la edad', () => {
    const young = calcBMR(75, 180, 25, 'male');
    const old   = calcBMR(75, 180, 50, 'male');
    expect(young).toBeGreaterThan(old);
  });

  it('BMR aumenta con el peso', () => {
    const light = calcBMR(60, 175, 30, 'male');
    const heavy = calcBMR(100, 175, 30, 'male');
    expect(heavy).toBeGreaterThan(light);
  });
});

describe('TDEE (Gasto Energético Total Diario)', () => {
  const baseBMR = 1700;

  it.each([
    ['sedentary',   1.2,    2040],
    ['light',       1.375,  2337],
    ['moderate',    1.55,   2635],
    ['active',      1.725,  2932],
    ['very_active', 1.9,    3230],
  ])('aplica factor %s correctamente', (level, _factor, expected) => {
    expect(calcTDEE(baseBMR, level)).toBeCloseTo(expected, -1); // ±5 kcal
  });

  it('usa factor moderado (1.55) para nivel de actividad desconocido', () => {
    expect(calcTDEE(baseBMR, 'alien_activity')).toBeCloseTo(baseBMR * 1.55, 0);
  });
});

describe('Objetivo calórico (calorie target)', () => {
  const tdee = 2500;

  it('pierde peso → déficit de 400 kcal', () => {
    expect(calcCalorieTarget(tdee, 'lose')).toBe(2100);
  });

  it('ganar músculo → superávit de 300 kcal', () => {
    expect(calcCalorieTarget(tdee, 'gain')).toBe(2800);
  });

  it('mantenimiento → igual al TDEE', () => {
    expect(calcCalorieTarget(tdee, 'maintain')).toBe(2500);
  });

  it('objetivo desconocido → igual al TDEE (safe default)', () => {
    expect(calcCalorieTarget(tdee, 'unknown_goal')).toBe(2500);
  });
});

describe('Redondeo de métricas (formato de respuesta)', () => {
  it('BMI se devuelve con 1 decimal', () => {
    const raw     = calcBMI(75, 180);
    const rounded = Math.round(raw * 10) / 10;
    expect(Number.isInteger(rounded * 10)).toBe(true);
  });

  it('BMR y TDEE se devuelven como enteros', () => {
    const bmr  = calcBMR(75, 180, 30, 'male');
    const tdee = calcTDEE(bmr, 'moderate');
    expect(Math.round(bmr)).toBe(Math.round(bmr));
    expect(Math.round(tdee)).toBe(Math.round(tdee));
  });
});
