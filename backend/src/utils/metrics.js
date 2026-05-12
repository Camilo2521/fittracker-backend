'use strict';

const { ACTIVITY_FACTORS, BMR_DEFICIT, BMR_SURPLUS } = require('./constants');

/**
 * Fórmula Mifflin-St Jeor (1990).
 * Más precisa que Harris-Benedict para población contemporánea.
 * Validada en múltiples meta-análisis como la más exacta para personas no atletas.
 *
 * @param {number} weight    - Peso en kg
 * @param {number} height    - Altura en cm
 * @param {number} age       - Edad en años
 * @param {string} gender    - 'male' | 'female' | cualquier otro valor → male offset
 * @returns {number} BMR en kcal/día, redondeado al entero más cercano
 */
function calcBMR(weight, height, age, gender) {
  const base = 10 * weight + 6.25 * height - 5 * age;
  return Math.round(gender === 'female' ? base - 161 : base + 5);
}

/**
 * TDEE (Total Daily Energy Expenditure).
 * BMR × factor de actividad de Harris et al.
 *
 * @param {number} bmr           - BMR calculado
 * @param {string} activityLevel - Clave de ACTIVITY_FACTORS
 * @returns {number} TDEE en kcal/día
 */
function calcTDEE(bmr, activityLevel) {
  return Math.round(bmr * (ACTIVITY_FACTORS[activityLevel] || ACTIVITY_FACTORS.moderate));
}

/**
 * Meta calórica diaria ajustada al objetivo del usuario.
 *
 * @param {number} tdee
 * @param {string} goal - 'lose' | 'gain' | 'maintain'
 * @returns {number} Calorías objetivo
 */
function calcCalorieTarget(tdee, goal) {
  if (goal === 'lose') return tdee - BMR_DEFICIT;
  if (goal === 'gain') return tdee + BMR_SURPLUS;
  return tdee;
}

/**
 * Índice de Masa Corporal (kg/m²).
 *
 * @param {number} weight - kg
 * @param {number} height - cm
 * @returns {number} IMC con un decimal
 */
function calcBMI(weight, height) {
  return Math.round((weight / ((height / 100) ** 2)) * 10) / 10;
}

/**
 * Calcula todas las métricas físicas en una sola llamada.
 * Punto de entrada principal — úsalo siempre en lugar de las funciones individuales
 * salvo que necesites solo una métrica puntual.
 *
 * @param {number} weight
 * @param {number} height
 * @param {number} age
 * @param {string} gender
 * @param {string} activityLevel
 * @param {string} goal
 * @returns {{ bmi: number, bmr: number, tdee: number, calorie_target: number }}
 */
function calcMetrics(weight, height, age, gender, activityLevel, goal) {
  const bmr            = calcBMR(weight, height, age, gender);
  const tdee           = calcTDEE(bmr, activityLevel);
  const calorie_target = calcCalorieTarget(tdee, goal);
  const bmi            = calcBMI(weight, height);
  return { bmi, bmr, tdee, calorie_target };
}

/**
 * Proteína diaria recomendada (g/día).
 * 1.7 g/kg en mantenimiento, 2.0 g/kg en hipertrofia, 1.6 g/kg en definición.
 */
function calcProteinTarget(weight, goal) {
  const factors = { gain: 2.0, lose: 1.6, maintain: 1.7 };
  return Math.round(weight * (factors[goal] || factors.maintain));
}

module.exports = { calcBMR, calcTDEE, calcCalorieTarget, calcBMI, calcMetrics, calcProteinTarget };
