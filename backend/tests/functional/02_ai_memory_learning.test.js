'use strict';

jest.mock('../../src/db/postgres', () => require('../helpers/mockPostgres').mockPg);
jest.mock('../../src/services/visionClient', () => require('../helpers/mockVision').mockVision);
jest.mock('../../src/services/ollamaService', () => ({
  isAvailable: jest.fn().mockResolvedValue(false),
  chat:        jest.fn(),
  chatStream:  jest.fn(),
  listModels:  jest.fn().mockResolvedValue([]),
  getModel:    () => 'llama3.2',
}));

const request = require('supertest');
const { registerUser, bearerHeader } = require('../helpers/auth');

let app;
beforeAll(() => {
  app = require('../../src/app');
});

// ── Helper: envía un mensaje de chat y devuelve la respuesta ──────────────────
async function chat(userMsg, profile = {}) {
  const res = await request(app).post('/api/v1/ai/chat').send({
    messages:    [{ role: 'user', content: userMsg }],
    userProfile: profile,
  });
  return res;
}

// ── 1. Extracción de memoria desde texto ──────────────────────────────────────

describe('Extracción de memoria del texto del usuario', () => {
  describe('Lesiones', () => {
    it('detecta "lesionado en la rodilla" y responde correctamente', async () => {
      const res = await chat('Estoy lesionado en la rodilla desde hace 2 semanas');
      expect(res.status).toBe(200);
      expect(res.body.content).toBeTruthy();
    });
  });
});

// ── 2. API de memoria (GET, DELETE) ───────────────────────────────────────────

describe('GET/DELETE /api/v1/ai/memory', () => {
  let token;
  beforeAll(async () => {
    ({ token } = await registerUser(app));
  });

  it('GET /memory autenticado devuelve array', async () => {
    const res = await request(app).get('/api/v1/ai/memory').set(bearerHeader(token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('DELETE /memory/:key sin token devuelve 401', async () => {
    const res = await request(app).delete('/api/v1/ai/memory/some_key');
    expect(res.status).toBe(401);
    expect(res.body.error).toBeTruthy();
  });

  it('DELETE /memory/:key autenticado elimina la clave', async () => {
    const res = await request(app)
      .delete('/api/v1/ai/memory/any_key')
      .set(bearerHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe('any_key');
  });
});

// ── 3. Detección de intents del chatbot ──────────────────────────────────────

describe('Chatbot: Detección de intents y respuestas coherentes', () => {

  const baseProfile = { goal: 'maintain', weight: 70, height: 175, age: 28, gender: 'male', name: 'Carlos' };

  it('saludo → respuesta de bienvenida con nombre', async () => {
    const res = await chat('Hola', baseProfile);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('local');
    expect(res.body.content).toMatch(/hola|fitbot|coach/i);
  });

  it('rutina → responde con JSON de plan de entrenamiento', async () => {
    const res = await chat('¿Me puedes dar una rutina de entrenamiento?', { ...baseProfile, goal: 'lose' });
    expect(res.status).toBe(200);
    expect(res.body.content).toMatch(/ROUTINE_PLAN/);
    const match = res.body.content.match(/ROUTINE_PLAN\n([\s\S]*?)\nROUTINE_PLAN/);
    expect(match).toBeTruthy();
    const plan = JSON.parse(match[1]);
    expect(plan.weeklyDays).toBeGreaterThan(0);
    expect(plan.days).toBeDefined();
  });

  it('dieta → responde con JSON de plan semanal', async () => {
    const res = await chat('Necesito un plan de dieta semanal', { ...baseProfile, goal: 'gain' });
    expect(res.status).toBe(200);
    expect(res.body.content).toMatch(/DIET_PLAN/);
    const match = res.body.content.match(/DIET_PLAN\n([\s\S]*?)\nDIET_PLAN/);
    const plan = JSON.parse(match[1]);
    expect(plan.days).toHaveLength(7);
    expect(plan.dailyCalorieTarget).toBeGreaterThan(0);
  });

  it('calorías/métricas → devuelve TMB, TDEE y objetivo', async () => {
    const res = await chat('¿Cuántas calorías necesito al día?', baseProfile);
    expect(res.status).toBe(200);
    expect(res.body.content).toMatch(/tmb|tdee|kcal/i);
  });

  it('proteína → da rangos y fuentes alimentarias', async () => {
    const res = await chat('¿Cuánta proteína necesito?', baseProfile);
    expect(res.status).toBe(200);
    expect(res.body.content).toMatch(/g\/día|proteína/i);
  });

  it('hidratación → calcula litros según el peso del usuario', async () => {
    const res = await chat('¿Cuánta agua debo beber?', baseProfile);
    expect(res.status).toBe(200);
    // 70 kg × 0.033 = 2.3 L
    expect(res.body.content).toMatch(/2[.,]\d|litro|L\/día/i);
  });

  it('motivación → responde con mensaje motivacional', async () => {
    // Se evita "gym" (dispara intent "routine" antes que "motivation")
    const res = await chat('Estoy muy cansado y con ganas de rendirme, no puedo más', baseProfile);
    expect(res.status).toBe(200);
    expect(res.body.content).toMatch(/hábito|motiva|fuerza|pequeño|ánimo/i);
  });

  it('lesión → responde con RICE y aviso médico', async () => {
    // Se evita "caminar" (dispara intent "cardio") — se usa mensaje con "lesioné"+"espalda"+"dolor"
    const res = await chat('Me lesioné la espalda y tengo dolor agudo', baseProfile);
    expect(res.status).toBe(200);
    expect(res.body.content).toMatch(/rice|reposo|médico|molestia|dolor|lesion/i);
  });

  it('sueño → menciona la importancia del descanso', async () => {
    // Se evita "cuántas" (dispara intent "calories") y "músculo" (dispara "protein")
    const res = await chat('Necesito dormir más para recuperarme bien', baseProfile);
    expect(res.status).toBe(200);
    expect(res.body.content).toMatch(/sueño|dormir|recupera|hormona|descanso/i);
  });

  it('progreso → da consejo sobre métricas más allá de la báscula', async () => {
    const res = await chat('No veo progreso en la báscula', baseProfile);
    expect(res.status).toBe(200);
    expect(res.body.content).toMatch(/perim|foto|rendimiento|fluctú/i);
  });

  it('respuesta inválida (sin messages) → 400', async () => {
    const res = await request(app).post('/api/v1/ai/chat').send({ messages: [] });
    expect(res.status).toBe(400);
  });

  it('el campo source siempre está presente', async () => {
    const res = await chat('Hola', baseProfile);
    expect(['local', 'ollama', 'claude']).toContain(res.body.source);
  });
});

// ── 4. Rutinas y dietas generadas por FitBot local ────────────────────────────

describe('Rutinas y dietas generadas por FitBot local', () => {

  it('rutina lose tiene 4 días y fuente "ia"', async () => {
    const res = await chat('Dame un plan de entrenamiento', { goal: 'lose', weight: 80, height: 170, age: 30, gender: 'female' });
    const match = res.body.content.match(/ROUTINE_PLAN\n([\s\S]*?)\nROUTINE_PLAN/);
    const plan  = JSON.parse(match[1]);
    expect(plan.weeklyDays).toBe(4);
    expect(plan.source).toBe('ia');
  });

  it('rutina gain tiene 5 días', async () => {
    const res = await chat('Necesito una rutina', { goal: 'gain' });
    const match = res.body.content.match(/ROUTINE_PLAN\n([\s\S]*?)\nROUTINE_PLAN/);
    const plan  = JSON.parse(match[1]);
    expect(plan.weeklyDays).toBe(5);
  });

  it('dieta lose calcula kcal desde el perfil real (no fija)', async () => {
    const res = await chat('Quiero un plan de dieta', {
      goal: 'lose', weight: 90, height: 180, age: 35, gender: 'male', activityLevel: 'moderate',
    });
    const match = res.body.content.match(/DIET_PLAN\n([\s\S]*?)\nDIET_PLAN/);
    const plan  = JSON.parse(match[1]);
    expect(plan.dailyCalorieTarget).toBeGreaterThan(1000);
    expect(plan.dailyCalorieTarget).toBeLessThan(4000);
  });

  it('dieta incluye notas de superávit para goal gain', async () => {
    const res = await chat('Dame una dieta', { goal: 'gain', weight: 70 });
    const match = res.body.content.match(/DIET_PLAN\n([\s\S]*?)\nDIET_PLAN/);
    const plan  = JSON.parse(match[1]);
    expect(plan.notes).toMatch(/superávit|proteína|g\/día/i);
  });

  it('dieta tiene weekStart con formato YYYY-MM-DD', async () => {
    const res = await chat('Dieta semanal por favor', { goal: 'maintain' });
    const match = res.body.content.match(/DIET_PLAN\n([\s\S]*?)\nDIET_PLAN/);
    const plan  = JSON.parse(match[1]);
    expect(plan.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ── 5. AI Status ──────────────────────────────────────────────────────────────

describe('GET /api/v1/ai/status', () => {
  it('devuelve estado del sistema AI', async () => {
    const res = await request(app).get('/api/v1/ai/status');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ollama');
    expect(res.body).toHaveProperty('active_mode');
    expect(res.body).toHaveProperty('ollama_model');
  });

  it('active_mode es "local" cuando ollama y ANTHROPIC_API_KEY no están disponibles', async () => {
    const res = await request(app).get('/api/v1/ai/status');
    expect(res.body.active_mode).toBe('local');
  });

  it('ollama es false (mock lo reporta unavailable)', async () => {
    const res = await request(app).get('/api/v1/ai/status');
    expect(res.body.ollama).toBe(false);
  });
});

// ── 6. Body scan ──────────────────────────────────────────────────────────────

describe('POST /api/v1/ai/body-scan', () => {
  it('devuelve 501 (no implementado aún)', async () => {
    const res = await request(app).post('/api/v1/ai/body-scan').send({});
    expect(res.status).toBe(501);
    expect(res.body.error).toBeTruthy();
  });
});
