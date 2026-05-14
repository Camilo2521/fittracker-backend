'use strict';

const express          = require('express');
const router           = express.Router();
const pg               = require('../../db/postgres');
const ollama           = require('../../services/ollamaService');
const { requireAuth }  = require('./auth');
const asyncHandler     = require('../../utils/asyncHandler');
const { validateId, abort } = require('../../utils/validate');
const { calcMetrics, calcProteinTarget } = require('../../utils/metrics');

// ── Memory helpers (PostgreSQL) ────────────────────────────────────────────────

async function _loadMemories(accountId) {
  if (!accountId) return [];
  const { rows } = await pg.query(
    'SELECT clave, valor FROM memorias_usuario WHERE cuenta_id = $1 ORDER BY actualizado_en DESC',
    [accountId]
  );
  return rows;
}

async function _saveMemories(accountId, pairs) {
  if (!accountId || !pairs.length) return;
  const client = await pg.pool.connect();
  try {
    await client.query('BEGIN');
    for (const { key, value } of pairs) {
      await client.query(
        `INSERT INTO memorias_usuario (cuenta_id, clave, valor)
         VALUES ($1,$2,$3)
         ON CONFLICT (cuenta_id, clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = NOW()`,
        [accountId, key, String(value)]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[ai] _saveMemories error:', err.message);
  } finally {
    client.release();
  }
}

// Auto-extract facts from the user's message
function _extractMemories(msg) {
  const m   = msg.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const out = [];

  const injM = m.match(/(?:lesion(?:ado|ada)?|duele|dolor)\s+(?:en|de)\s+(?:la\s|el\s|mi\s)?(\w+)/);
  if (injM) out.push({ key: 'lesion', value: injM[1] });

  if (/vegetariano|vegetariana/.test(m)) out.push({ key: 'dieta', value: 'vegetariano/a' });
  if (/\bvegano|vegana\b/.test(m))       out.push({ key: 'dieta', value: 'vegano/a' });
  if (/intolerante.*lactosa|sin lactosa/.test(m)) out.push({ key: 'intolerancia', value: 'lactosa' });
  if (/sin gluten|celiaco|celiaca/.test(m))       out.push({ key: 'intolerancia', value: 'gluten' });
  if (/sin mariscos|alergico.*mariscos/.test(m))  out.push({ key: 'alergia', value: 'mariscos' });

  if (/entreno.*ma[n]ana|ma[n]ana.*entreno|por las ma[n]anas/.test(m)) out.push({ key: 'horario_entreno', value: 'mañana' });
  if (/entreno.*tarde|tarde.*entreno|por las tardes/.test(m))          out.push({ key: 'horario_entreno', value: 'tarde' });
  if (/entreno.*noche|noche.*entreno|por las noches/.test(m))          out.push({ key: 'horario_entreno', value: 'noche' });

  if (/sin equipo|en casa sin|sin pesas|peso corporal solo/.test(m))  out.push({ key: 'equipamiento', value: 'ninguno (peso corporal)' });
  if (/tengo.*gym|voy al gym|tengo pesas|tengo barra|gym en casa/.test(m)) out.push({ key: 'equipamiento', value: 'gym completo' });
  if (/solo.*mancuernas|tengo mancuernas/.test(m)) out.push({ key: 'equipamiento', value: 'mancuernas' });
  if (/tengo.*banda|banda.*elastica/.test(m))       out.push({ key: 'equipamiento', value: 'bandas elásticas' });

  if (/poco tiempo|entrenos cortos|rapido/.test(m)) out.push({ key: 'pref_duracion', value: 'entrenos cortos' });
  if (/mucho tiempo|larga duracion|mas de una hora/.test(m)) out.push({ key: 'pref_duracion', value: 'entrenos largos' });

  const dislikeM = m.match(/(?:odio|detesto|no me gusta(?:n)?)\s+(?:hacer\s+|los?\s+|las?\s+)?(\w+)/);
  if (dislikeM) out.push({ key: `no_gusta_${dislikeM[1]}`, value: 'true' });

  const loseM = m.match(/(?:perder|bajar)\s+(\d+)\s*kg/);
  if (loseM) out.push({ key: 'meta_kg_perder', value: loseM[1] + ' kg' });
  const gainM = m.match(/(?:ganar|subir)\s+(\d+)\s*kg/);
  if (gainM) out.push({ key: 'meta_kg_ganar', value: gainM[1] + ' kg' });

  if (/rec[uú]erdalo|guarda eso|anota esto/.test(m)) out.push({ key: 'solicita_memoria', value: msg.slice(0, 120) });

  return out;
}

// ── System prompt ──────────────────────────────────────────────────────────────
function _buildSystemPrompt(p = {}, memories = []) {
  const goalLabel = {
    lose:     'perder peso y reducir grasa corporal',
    gain:     'ganar masa muscular e hipertrofia',
    maintain: 'mantener el peso y mejorar la composición corporal',
  };
  const actLabel = {
    sedentary:   'sedentario (poco o ningún ejercicio)',
    light:       'ligeramente activo (1-2 días/semana)',
    moderate:    'moderadamente activo (3-4 días/semana)',
    active:      'muy activo (5-6 días/semana)',
    very_active: 'atleta / entrenamiento intenso diario',
  };

  const w = p.weight, h = p.height, a = p.age;
  let metricsBlock = '';
  if (w && h && a) {
    const { bmr, tdee, calorie_target, bmi } = calcMetrics(
      Number(w), Number(h), Number(a), p.gender, p.activityLevel, p.goal
    );
    const prot = calcProteinTarget(Number(w), p.goal);
    metricsBlock = `\nMÉTRICAS CALCULADAS:\n- TMB: ${bmr} kcal/día | TDEE: ${tdee} kcal/día | Meta calórica: ${calorie_target} kcal/día\n- IMC: ${bmi} | Proteína objetivo: ${prot} g/día`;
  }

  const profileLines = [
    `Nombre: ${p.name || 'no indicado'}`,
    `Objetivo: ${goalLabel[p.goal] || 'mejorar condición física'}`,
    w ? `Peso: ${w} kg` : 'Peso: no registrado',
    h ? `Altura: ${h} cm` : 'Altura: no registrada',
    a ? `Edad: ${a} años` : 'Edad: no registrada',
    `Sexo: ${p.gender === 'male' ? 'masculino' : p.gender === 'female' ? 'femenino' : 'no indicado'}`,
    `Nivel de actividad: ${actLabel[p.activityLevel] || 'no indicado'}`,
    p.restrictions ? `Restricciones/alergias: ${p.restrictions}` : null,
  ].filter(Boolean).map(l => `- ${l}`).join('\n');

  const memBlock = memories.length
    ? `\nDATOS RECORDADOS DE CONVERSACIONES ANTERIORES:\n${memories.map(m => `- ${m.clave}: ${m.valor}`).join('\n')}`
    : '';

  return `Eres FitBot, el asistente de fitness y nutrición personal de la app FitTracker. Eres un coach experto, cercano y directo.

PERFIL DEL USUARIO:
${profileLines}${metricsBlock}${memBlock}

CAPACIDADES:
- Generar rutinas de entrenamiento completas y personalizadas (días, ejercicios, series, reps, descanso)
- Crear planes de dieta semanales con calorías y macros exactos según el perfil
- Calcular métricas: TMB, TDEE, IMC, calorías objetivo, proteína diaria
- Dar consejos de recuperación, sueño, hidratación y suplementación
- Motivar y ayudar a superar bloqueos mentales
- Adaptar entrenamientos a lesiones, equipo disponible u horarios
- Responder preguntas libres sobre fitness, nutrición y bienestar

REGLAS DE COMPORTAMIENTO:
1. Responde SIEMPRE en español, con tono motivador y profesional
2. Usa el nombre del usuario cuando sea natural hacerlo
3. Sé específico y accionable — nada de respuestas vagas
4. Para rutinas: incluye días de la semana, ejercicios con series×reps, descanso entre series
5. Para dietas: incluye kcal totales, proteína/carbs/grasa y ejemplos de comidas reales
6. Para métricas: usa los datos del perfil para calcular valores exactos
7. Respuestas normales: 3-5 líneas máximo. Planes completos cuando se pidan explícitamente
8. Usa markdown (negritas, listas con guiones) para estructurar la información
9. Si el perfil tiene datos incompletos, usa lo disponible y sugiere completarlo
10. Recuerda y usa el contexto de la conversación — no repitas información ya dada
11. No saludes en cada mensaje — solo en el primero o cuando sea natural`;
}

// ── Local AI fallback ─────────────────────────────────────────────────────────
const _INTENTS = {
  greet:      /^(hola|buenos|buenas|hey|hi|saludos|qu[eé] tal|como est|ola)/i,
  routine:    /rutina|entrenamiento|ejercicio|workout|gym|gimn|plan de tren|entrena|semana de ejerc/i,
  diet:       /dieta|comida|alimenta|nutrici|plan de diet|semana de comida|qu[eé] como|comer|meal plan|men[uú]/i,
  calories:   /calor|kcal|tdee|tmb|bmr|metabol|cu[aá]ntas|necesit.*comer|cu[aá]nto como/i,
  bmi:        /imc|bmi|peso ideal|estoy gordo|sobrepeso|bajo peso/i,
  protein:    /prote[ií]na|m[uú]sculo|masa muscular|whey|batido|suplemento/i,
  cardio:     /cardio|correr|caminar|ciclismo|nataci[oó]n|aer[oó]bic/i,
  sleep:      /dormir|sue[nñ]o|descanso|recupera/i,
  motivation: /motiva|[aá]nimo|no puedo|cansado|dif[ií]cil|costando|dejar|rendirse|fuerza/i,
  progress:   /progreso|avance|resultado|peso baj|peso sub|cambio|mejorar/i,
  hydration:  /agua|hidrat|l[ií]quid|beber/i,
  supplement: /suplemento|vitamina|creatina|prote[ií]n.*polvo|pre-entreno|omega/i,
  injury:     /lesi[oó]n|lesionado|dolor|rodilla|espalda|hombro.*duele/i,
  adjust:     /ajusta|cambia|modifica|quita|a[nñ]ade|m[aá]s.*prote[ií]na|menos.*carbo|sin.*gluten/i,
};

function _detect(msg) {
  for (const [intent, re] of Object.entries(_INTENTS)) {
    if (re.test(msg)) return intent;
  }
  return 'general';
}

function _calcMetrics(p) {
  const w = p.weight || 70, h = p.height || 170, a = p.age || 25;
  const { bmr, tdee, calorie_target, bmi } = calcMetrics(
    Number(w), Number(h), Number(a), p.gender, p.activityLevel, p.goal
  );
  return { tmb: bmr, tdee, target: calorie_target, bmi };
}

function _buildRoutine(goal) {
  const plans = {
    lose: {
      name: 'Plan quema grasa — 4 días/semana', weeklyDays: 4, source: 'ia',
      days: [
        { day: 'Lunes',   focus: 'Cardio + Core',    exercises: ['Caminata rápida 35 min', 'Plancha 4×40 s', 'Abdominales bicicleta 3×20', 'Mountain climbers 3×15', 'Jumping jacks 3×30 s'] },
        { day: 'Martes',  focus: 'Tren superior',    exercises: ['Flexiones 4×12', 'Remo mancuerna 3×12/lado', 'Curl bíceps 3×15', 'Press hombros 3×12', 'Fondos silla 3×10'] },
        { day: 'Jueves',  focus: 'HIIT + Cardio',    exercises: ['Burpees 4×10', 'Sprint 30 s × 8', 'Sentadillas con salto 4×12', 'Step-ups 3×20', 'Cuerda de salto 5 min'] },
        { day: 'Viernes', focus: 'Tren inferior',    exercises: ['Sentadillas goblet 4×15', 'Zancadas 3×12/lado', 'Puente de glúteos 4×20', 'Peso muerto rumano 3×12', 'Elevaciones de talones 3×20'] },
      ],
      notes: 'Déficit calórico de 300-400 kcal. Cardio ligero los días libres. Hidratación: 2.5 L/día.',
    },
    gain: {
      name: 'Plan hipertrofia — 5 días/semana', weeklyDays: 5, source: 'ia',
      days: [
        { day: 'Lunes',     focus: 'Pecho + Tríceps',    exercises: ['Flexiones 5×15', 'Flexiones diamante 4×12', 'Dips 4×10', 'Press hombros 4×12', 'Extensiones tríceps 3×15'] },
        { day: 'Martes',    focus: 'Espalda + Bíceps',   exercises: ['Pull-ups 4×8', 'Remo mancuerna 4×12/lado', 'Curl bíceps martillo 4×12', 'Curl concentrado 3×12', 'Face pulls 3×15'] },
        { day: 'Miércoles', focus: 'Piernas potencia',   exercises: ['Sentadillas 5×10', 'Peso muerto 4×8', 'Zancadas mancuerna 3×12', 'Hip thrust 4×15', 'Leg curl tumbado 3×12'] },
        { day: 'Jueves',    focus: 'Hombros + Core',     exercises: ['Press Arnold 4×12', 'Elevaciones laterales 4×15', 'Pájaros 3×12', 'Plancha 4×45 s', 'Russian twist 3×20'] },
        { day: 'Viernes',   focus: 'Full body potencia', exercises: ['Sentadillas con salto 4×8', 'Flexiones explosivas 3×8', 'Thruster 3×10', 'Burpees 3×8', 'Sprint 6×20 s'] },
      ],
      notes: 'Superávit calórico de 250-300 kcal. Proteína: 1.8-2 g/kg. Duerme 8 h para recuperación óptima.',
    },
    maintain: {
      name: 'Plan mantenimiento — 3 días/semana', weeklyDays: 3, source: 'ia',
      days: [
        { day: 'Lunes',     focus: 'Full body A',        exercises: ['Sentadillas 3×12', 'Flexiones 3×12', 'Remo mancuerna 3×12', 'Plancha 3×35 s', 'Curl bíceps 3×12'] },
        { day: 'Miércoles', focus: 'Cardio + Movilidad', exercises: ['Cardio moderado 30 min', 'Yoga flujo 15 min', 'Estiramientos dinámicos 10 min', 'Movilidad cadera 5 min'] },
        { day: 'Viernes',   focus: 'Full body B',        exercises: ['Zancadas 3×12/lado', 'Dips 3×10', 'Press hombros 3×12', 'Peso muerto 3×10', 'Core 3×40 s'] },
      ],
      notes: '5 min de movilidad articular al despertar. La consistencia supera la intensidad.',
    },
  };
  return plans[goal] || plans.maintain;
}

function _buildDiet(goal, p) {
  const targets = { lose: 1750, gain: 2650, maintain: 2100 };
  let kcal = targets[goal] || 2100;
  if (p.weight && p.height && p.age) {
    const { target } = _calcMetrics(p);
    kcal = target;
  }
  const mealSets = {
    lose: [
      { name: 'Desayuno',     calories: Math.round(kcal * .20), description: 'Avena 60 g con frutos rojos + café sin azúcar' },
      { name: 'Media mañana', calories: Math.round(kcal * .08), description: 'Yogur griego 0% 150 g + 1 manzana' },
      { name: 'Almuerzo',     calories: Math.round(kcal * .35), description: 'Pechuga a la plancha 180 g + arroz integral 60 g + ensalada' },
      { name: 'Merienda',     calories: Math.round(kcal * .07), description: 'Pepino con hummus 30 g o puñado de edamame' },
      { name: 'Cena',         calories: Math.round(kcal * .30), description: 'Salmón al horno 150 g + brócoli al vapor + batata 80 g' },
    ],
    gain: [
      { name: 'Desayuno',     calories: Math.round(kcal * .22), description: '3 huevos revueltos + tostadas integrales + zumo natural' },
      { name: 'Media mañana', calories: Math.round(kcal * .12), description: 'Batido proteico 30 g + plátano + mantequilla de cacahuete 15 g' },
      { name: 'Almuerzo',     calories: Math.round(kcal * .28), description: 'Arroz integral 150 g + pollo 200 g + verduras salteadas en AOVE' },
      { name: 'Pre-entreno',  calories: Math.round(kcal * .08), description: 'Avena 40 g con leche + dátiles 3 uds' },
      { name: 'Post-entreno', calories: Math.round(kcal * .10), description: 'Batido proteico + plátano (dentro de 30 min)' },
      { name: 'Cena',         calories: Math.round(kcal * .20), description: 'Pasta integral 120 g + ternera magra 150 g + tomate' },
    ],
    maintain: [
      { name: 'Desayuno', calories: Math.round(kcal * .22), description: 'Tostadas integrales + aguacate ½ + 2 huevos revueltos' },
      { name: 'Almuerzo', calories: Math.round(kcal * .35), description: 'Legumbres 200 g + ensalada variada + pan integral' },
      { name: 'Merienda', calories: Math.round(kcal * .10), description: 'Fruta de temporada + almendras 20 g' },
      { name: 'Cena',     calories: Math.round(kcal * .28), description: 'Merluza al horno 160 g + arroz basmati 80 g + ensalada' },
      { name: 'Extra',    calories: Math.round(kcal * .05), description: 'Infusión + onza chocolate negro 85%' },
    ],
  };
  const meals = mealSets[goal] || mealSets.maintain;
  const days  = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const ws    = new Date(); ws.setDate(ws.getDate() - ws.getDay() + (ws.getDay() === 0 ? -6 : 1));
  return {
    weekStart: ws.toISOString().split('T')[0],
    source: 'ia', goal,
    dailyCalorieTarget: kcal,
    days: days.map(day => ({ day, totalCalories: kcal, meals })),
    notes: goal === 'lose'
      ? `Déficit de ~${Math.round(kcal * 0.17)} kcal/día. Distribuye proteína en 4-5 tomas.`
      : goal === 'gain'
      ? `Superávit limpio. Come cada 3-4 h. Proteína: ${Math.round((p.weight || 70) * 1.8)} g/día.`
      : 'Balance calórico. Variedad de colores en el plato para micronutrientes completos.',
  };
}

function _localAI(userMsg, p, history) {
  const msg    = userMsg.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const intent = _detect(msg);
  const name   = p.name || 'amigo';
  const goal   = p.goal || 'maintain';
  const goalTxt = { lose: 'perder peso', gain: 'ganar músculo', maintain: 'mantener tu peso' }[goal];
  const prev   = history.length > 2;

  const nameMatch = msg.match(/(?:me llamo|mi nombre es|soy)\s+([a-záéíóúñ]+)/i);
  if (nameMatch) {
    const detectedName = nameMatch[1].charAt(0).toUpperCase() + nameMatch[1].slice(1);
    return `¡Encantado, **${detectedName}**! 👋 Soy FitBot, tu coach personal de fitness. Estoy aquí para ayudarte con:\n\n- 🏋️ **Rutinas** de entrenamiento personalizadas\n- 🥗 **Planes de dieta** semanales\n- 🔢 **Calorías**, IMC y métricas\n- 💪 **Motivación** y consejos\n\n¿Qué necesitas hoy, ${detectedName}?`;
  }

  if (/mejorar.*vida|vida.*mejor|bienestar|salud.*general|mejor.*persona|cambiar.*vida|empezar.*fit|estilo.*vida|habitos/i.test(msg)) {
    const { tdee } = _calcMetrics(p);
    return `Mejorar tu vida con el fitness es una decisión que transforma todo, ${name}. Por dónde empezar:\n\n1. 🏋️ **Muévete 30 min/día** — no tiene que ser intenso, caminar cuenta\n2. 🥗 **Come real** — reduce ultraprocesados, añade proteína en cada comida\n3. 😴 **Duerme 7-8 h** — sin sueño, nada funciona bien\n4. 💧 **Hidratación** — ${p.weight ? Math.round(p.weight * 0.033 * 10) / 10 : 2.5} L de agua al día\n5. 📈 **Consistencia > intensidad** — 3 días/semana durante 3 meses > 7 días durante 2 semanas\n\n¿Te genero una **rutina** o un **plan de dieta** personalizado para empezar?`;
  }

  if (intent === 'greet')     return `¡Hola${p.name ? `, **${p.name}**` : ''}! Soy FitBot, tu coach personal. 💪\n\nTu objetivo es **${goalTxt}**. Dime qué necesitas:\n- 🏋️ **Rutina** de entrenamiento\n- 🥗 **Plan de dieta** semanal\n- 🔢 **Calorías** y métricas\n- 💬 Cualquier duda de fitness\n\n¿Por dónde empezamos?`;
  if (intent === 'routine' || intent === 'cardio') {
    const plan = _buildRoutine(goal);
    return `¡Aquí tu rutina para **${goalTxt}**, ${name}! 💪\n\n<<<ROUTINE_PLAN\n${JSON.stringify(plan)}\nROUTINE_PLAN>>>\n\n¿Quieres ajustar algo?`;
  }
  if (intent === 'diet') {
    const plan = _buildDiet(goal, p);
    return `¡Tu plan de dieta semanal, ${name}! 🥗\n\n**${plan.dailyCalorieTarget} kcal/día** para **${goalTxt}**.\n\n<<<DIET_PLAN\n${JSON.stringify(plan)}\nDIET_PLAN>>>\n\n¿Necesitas ajustar algo?`;
  }
  if (intent === 'calories' || intent === 'bmi') {
    const { tmb, tdee, target, bmi } = _calcMetrics(p);
    return `📊 **Tus métricas** ${!p.weight || !p.height ? '*(perfil incompleto — actualízalo para más precisión)*' : ''}:\n\n- **TMB**: **${tmb} kcal/día**\n- **TDEE**: **${tdee} kcal/día**\n- **Objetivo para ${goalTxt}**: **${target} kcal/día**\n${bmi ? `- **IMC**: **${bmi}**` : ''}\n\n¿Te genero una dieta ajustada a estas calorías?`;
  }
  if (intent === 'protein' || intent === 'supplement') {
    const kg = p.weight || 70;
    return `💊 **Proteína**: ${Math.round(kg * 1.6)}–${Math.round(kg * 2.2)} g/día.\n\nFuentes: pollo (31 g/100 g), huevos (6 g/ud), atún (26 g/100 g), yogur griego (10 g/100 g).\n\n**Suplementos útiles**: creatina 3-5 g/día, omega-3 1-2 g/día, vitamina D3 en invierno.`;
  }
  if (intent === 'sleep')      return `😴 **El sueño es tu suplemento más potente**, ${name}. 7-9 h de sueño libera el 80% de la hormona del crecimiento diaria. Sin pantallas 1 h antes de dormir. Temperatura 17-19°C. Sin esto, los entrenamientos rinden un 30% menos.`;
  if (intent === 'hydration') {
    const L = p.weight ? Math.round(p.weight * 0.033 * 10) / 10 : 2.5;
    return `💧 Tu peso sugiere **${L} L/día**. Añade 500 ml por hora de ejercicio intenso. Orina amarillo pálido = buena hidratación.`;
  }
  if (intent === 'injury')     return `⚠️ Siento las molestias, ${name}. Sin ser médico: RICE (Reposo, Hielo, Compresión, Elevación) las primeras 48-72 h. Si el dolor es agudo, persiste en reposo o hay hinchazón notable → médico. Puedo ajustarte la rutina para no cargar la zona afectada. ¿Qué zona es?`;
  if (intent === 'motivation') return `${name}, los hábitos vencen a la motivación. La motivación va y viene — los resultados se construyen cuando actúas aunque no tengas ganas. ¿Qué es lo más pequeño que puedes hacer HOY por **${goalTxt}**? Empieza ahí. 🔥`;
  if (intent === 'progress')   return `📈 Más allá de la báscula: mide perímetros cada 2 semanas, fotos cada 4, y sobre todo rendimiento (más reps, más peso). El peso fluctúa 1-3 kg por agua. Pésate 1 vez/semana, en ayunas, mismo día.`;
  if (intent === 'adjust')     return `Claro, ${name}. ¿Qué ajustamos?\n- 🏋️ **Rutina**: días, ejercicios, intensidad\n- 🥗 **Dieta**: comidas, horarios, ingredientes\n- 📊 **Calorías**: objetivo\n\nCuéntame y lo regenero.`;

  const lastBot = history.filter(m => m.role === 'assistant').slice(-1)[0]?.content || '';
  if (prev && lastBot) {
    return `Entiendo, ${name}. Para ayudarte mejor con eso, cuéntame más o prueba con algo concreto:\n\n- 🏋️ "**Genera mi rutina**" — plan de entrenamiento personalizado\n- 🥗 "**Mi plan de dieta**" — menú semanal con calorías\n- 🔢 "**Mis calorías**" — TDEE, IMC y métricas\n- 💪 "**Necesito motivación**"\n- 😴 "**Consejos para dormir mejor**"\n\n¿Qué te interesa más?`;
  }
  return `¡Hola${p.name ? `, **${p.name}**` : ''}! Soy FitBot, tu coach de fitness personal. 💪\n\nPuedo ayudarte con **${goalTxt}**. Prueba:\n- 🏋️ "Genera mi rutina"\n- 🥗 "Mi plan de dieta semanal"\n- 🔢 "¿Cuántas calorías necesito?"\n- 💪 "Necesito motivación"\n\n¿Por dónde empezamos?`;
}

/**
 * @swagger
 * tags:
 *   name: IA
 *   description: Chat con FitBot, estado del modelo y memoria
 *
 * /api/v1/ai/chat:
 *   post:
 *     tags: [IA]
 *     summary: Enviar mensaje al asistente FitBot (Ollama local)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [messages]
 *             properties:
 *               messages:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     role:    { type: string, enum: [user, assistant] }
 *                     content: { type: string }
 *               userProfile:
 *                 type: object
 *     responses:
 *       200:
 *         description: Respuesta del asistente
 */
router.post('/chat', asyncHandler(async (req, res) => {
  const { messages = [], userProfile = {} } = req.body;
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'messages[] requerido' });
  }

  const accountId = userProfile.id || req.body.accountId || null;
  const lastMsg   = messages[messages.length - 1]?.content || '';

  const newMems = _extractMemories(lastMsg);
  if (newMems.length) await _saveMemories(accountId, newMems);

  const memories     = await _loadMemories(accountId);
  const systemPrompt = _buildSystemPrompt(userProfile, memories);
  const history      = messages.slice(-30).map(m => ({ role: m.role, content: m.content }));

  if (await ollama.isAvailable()) {
    try {
      const reply = await ollama.chat(history, systemPrompt);
      return res.json({ content: reply, source: 'ollama', model: ollama.getModel() });
    } catch (err) {
      console.warn('[FitBot] Ollama error, fallback:', err.message);
    }
  }

  res.json({ content: _localAI(lastMsg, userProfile, messages), source: 'local' });
}));

// ── POST /api/v1/ai/chat/stream ────────────────────────────────────────────────
router.post('/chat/stream', async (req, res) => {
  const { messages = [], userProfile = {} } = req.body;
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'messages[] requerido' });
  }

  res.writeHead(200, {
    'Content-Type':      'text/event-stream; charset=utf-8',
    'Cache-Control':     'no-cache',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = obj => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    const accountId   = userProfile.id || req.body.accountId || null;
    const lastMsg     = messages[messages.length - 1]?.content || '';

    const newMems = _extractMemories(lastMsg);
    if (newMems.length) await _saveMemories(accountId, newMems);

    const memories     = await _loadMemories(accountId);
    const systemPrompt = _buildSystemPrompt(userProfile, memories);
    const history      = messages.slice(-30).map(m => ({ role: m.role, content: m.content }));

    if (await ollama.isAvailable()) {
      try {
        for await (const chunk of ollama.chatStream(history, systemPrompt)) {
          send({ t: chunk });
        }
        send({ done: true, source: 'ollama', model: ollama.getModel() });
        return res.end();
      } catch (err) {
        console.warn('[FitBot] Ollama stream error:', err.message);
      }
    }

    const reply = _localAI(lastMsg, userProfile, messages);
    for (const w of reply.split(/(?<=\s)/)) {
      send({ t: w });
      await new Promise(r => setTimeout(r, 15));
    }
    send({ done: true, source: 'local' });
  } catch (err) {
    console.error('[FitBot] stream error:', err.message);
    send({ error: 'Error interno del asistente', done: true });
  }
  res.end();
});

/**
 * @swagger
 * /api/v1/ai/status:
 *   get:
 *     tags: [IA]
 *     summary: Estado del modelo de IA local (Ollama)
 *     security: []
 *     responses:
 *       200:
 *         description: Estado de Ollama y modelos disponibles
 */
router.get('/status', asyncHandler(async (_req, res) => {
  const ollamaOk = await ollama.isAvailable();
  const models   = ollamaOk ? await ollama.listModels() : [];
  res.json({
    ollama:           ollamaOk,
    ollama_model:     ollama.getModel(),
    models_available: models,
    active_mode:      ollamaOk ? 'ollama' : 'local',
  });
}));

// ── GET /api/v1/ai/memory ──────────────────────────────────────────────────────
router.get('/memory', requireAuth, asyncHandler(async (req, res) => {
  res.json(await _loadMemories(req.accountId));
}));

// ── DELETE /api/v1/ai/memory/:key ─────────────────────────────────────────────
router.delete('/memory/:key', requireAuth, asyncHandler(async (req, res) => {
  await pg.query('DELETE FROM memorias_usuario WHERE cuenta_id = $1 AND clave = $2', [req.accountId, req.params.key]);
  res.json({ deleted: req.params.key });
}));

module.exports = router;
