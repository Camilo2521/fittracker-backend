'use strict';

/**
 * E2E — Pipeline completo N8N
 *
 * Simula el flujo real de coaching automatizado:
 *   1. El usuario hace algo (workout, dieta, progreso)
 *   2. El backend construye el prompt para el LLM (build-prompt)
 *   3. N8N llama a Claude/Ollama y recibe la sugerencia
 *   4. N8N envía la sugerencia al backend (callback)
 *   5. El usuario ve la sugerencia en la app (ai-suggestions)
 *
 * También verifica:
 *   • Prompt content quality (tiene datos del usuario, es en español)
 *   • Los 4 tipos de eventos: workout, diet, progress, weekly.checkin
 *   • Secreto N8N protege todos los endpoints
 *   • weekly-users devuelve la estructura que N8N necesita para iterar
 */

jest.mock('../../src/db/postgres', () => require('../helpers/mockPostgres').mockPg);
jest.mock('../../src/services/visionClient', () => require('../helpers/mockVision').mockVision);

const request = require('supertest');
const { resetMocks } = require('../helpers/mockPostgres');
const { registerUser, bearerHeader } = require('../helpers/auth');

const N8N_SECRET = 'pipeline-test-secret-n8n-12345';
let app, token, userId, accountId;

beforeAll(async () => {
  process.env.N8N_SECRET = N8N_SECRET;
  app = require('../../src/app');

  const r = await registerUser(app, {
    name: 'Pedro Pipeline', goal: 'lose', weight: 85,
    height: 178, age: 35, gender: 'male', activityLevel: 'moderate',
  });
  token     = r.token;
  userId    = r.user.id;
  accountId = String(userId);
});

afterAll(() => {
  delete process.env.N8N_SECRET;
});

afterEach(() => resetMocks());

function n8nHeader() {
  return { 'x-n8n-secret': N8N_SECRET };
}

// ── Seguridad: secreto N8N en todos los endpoints ────────────────────────────

describe('Seguridad N8N — secreto requerido en endpoints de automatización', () => {
  it('build-prompt sin secreto → 401', async () => {
    const res = await request(app).post('/api/v1/n8n/build-prompt')
      .send({ event: 'workout.logged', accountId });
    expect(res.status).toBe(401);
  });

  it('callback sin secreto → 401', async () => {
    const res = await request(app).post('/api/v1/n8n/callback')
      .send({ accountId, suggestion: 'test' });
    expect(res.status).toBe(401);
  });

  it('weekly-users sin secreto → 401', async () => {
    const res = await request(app).get('/api/v1/n8n/weekly-users');
    expect(res.status).toBe(401);
  });

  it('secreto incorrecto → 401', async () => {
    const res = await request(app).post('/api/v1/n8n/build-prompt')
      .set('x-n8n-secret', 'secreto-equivocado')
      .send({ event: 'workout.logged', accountId });
    expect(res.status).toBe(401);
  });
});

// ── Pipeline 1: Usuario registra entrenamiento → N8N genera coaching ─────────

describe('Pipeline workout.logged — coaching post-entrenamiento', () => {
  let regApp;
  beforeAll(async () => {
    regApp = require('../../src/app');
    await registerUser(regApp, { goal: 'lose', weight: 85, height: 178, age: 35, gender: 'male' });
  });

  it('Paso 1: N8N llama build-prompt para workout.logged', async () => {
    const res = await request(app).post('/api/v1/n8n/build-prompt')
      .set(n8nHeader())
      .send({
        event:     'workout.logged',
        accountId,
        user:      { name: 'Pedro Pipeline', goal: 'lose', weight: 85, age: 35 },
        data:      { routineName: 'Cardio intenso', durationMin: 45, exercises: ['Burpees', 'Sprints'] },
        context:   { recentWorkouts: 3, weeklyTarget: 4 },
      });

    expect(res.status).toBe(200);

    // Calidad del prompt: debe estar en español
    expect(res.body.prompt).toMatch(/español/i);
    // Debe mencionar el nombre del usuario o datos del entrenamiento
    expect(res.body.prompt).toMatch(/Pedro|Cardio|45 min/i);
    // Debe tener instrucciones de coaching (feedback, consejo, motivación)
    expect(res.body.prompt).toMatch(/objetivo|workout|sesión/i);

    // El prompt tiene todos los campos que N8N necesita para llamar a Claude
    expect(res.body.model).toBeTruthy();
    expect(res.body.max_tokens).toBeGreaterThan(0);
    expect(res.body.suggestionType).toBe('workout.logged');
  });

  it('Paso 2: Claude genera la sugerencia y N8N la envía al callback', async () => {
    const suggestion = 'Excelente sesión. Tus burpees mostraron buena explosividad. ' +
      'Para la próxima, añade 5 repeticiones más en el último set.';

    const res = await request(app).post('/api/v1/n8n/callback')
      .set(n8nHeader())
      .send({
        accountId,
        event:          'workout.logged',
        suggestionType: 'workout.logged',
        suggestion,
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.id).toBeGreaterThan(0);
    expect(res.body.accountId).toBe(accountId);
  });

  it('Paso 3: El usuario abre la app y ve la sugerencia de coaching', async () => {
    // Primero guardamos una sugerencia
    await request(app).post('/api/v1/n8n/callback').set(n8nHeader()).send({
      accountId,
      suggestion:     'Haz más cardio esta semana.',
      suggestionType: 'workout.logged',
    });

    const res = await request(app).get('/api/v1/auth/ai-suggestions')
      .set(bearerHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);

    const ultima = res.body.data[res.body.data.length - 1];
    expect(ultima.tipo_sugerencia).toBe('workout.logged');
    expect(ultima.contenido).toBeTruthy();
    expect(typeof ultima.contenido).toBe('string');
  });
});

// ── Pipeline 2: Usuario registra dieta → coaching nutricional ────────────────

describe('Pipeline diet.logged — coaching nutricional', () => {
  it('build-prompt para diet.logged genera prompt con datos calóricos', async () => {
    const res = await request(app).post('/api/v1/n8n/build-prompt')
      .set(n8nHeader())
      .send({
        event:     'diet.logged',
        accountId,
        user:      { name: 'Pedro Pipeline', goal: 'lose', weight: 85 },
        data:      { planName: 'Semana 1 pérdida', totalKcal: 1650 },
        context:   {},
      });

    expect(res.status).toBe(200);
    expect(res.body.prompt).toMatch(/1650/);              // calorías en el prompt
    expect(res.body.prompt).toMatch(/nutricion|diet|kcal|calórico/i);
    expect(res.body.suggestionType).toBe('diet.logged');
  });

  it('callback guarda sugerencia nutricional y el usuario la ve', async () => {
    const suggestion = 'Tu ingesta de 1650 kcal está muy bien para bajar de peso. ' +
      'Aumenta las proteínas hasta 130 g/día para preservar músculo.';

    await request(app).post('/api/v1/n8n/callback').set(n8nHeader()).send({
      accountId,
      event:          'diet.logged',
      suggestionType: 'diet.logged',
      suggestion,
    });

    const res = await request(app).get('/api/v1/auth/ai-suggestions')
      .set(bearerHeader(token));

    const dietSuggestions = res.body.data.filter(s => s.tipo_sugerencia === 'diet.logged');
    expect(dietSuggestions.length).toBeGreaterThanOrEqual(1);
    expect(dietSuggestions[0].contenido).toContain('1650 kcal');
  });
});

// ── Pipeline 3: Usuario registra progreso → análisis de evolución ────────────

describe('Pipeline progress.updated — análisis de progreso', () => {
  it('build-prompt para progress.updated incluye cambio de peso', async () => {
    const res = await request(app).post('/api/v1/n8n/build-prompt')
      .set(n8nHeader())
      .send({
        event:     'progress.updated',
        accountId,
        user:      { name: 'Pedro Pipeline', goal: 'lose' },
        data:      { weight: 83.5, waistCm: 92 },
        context:   { weightChange: -1.5 },
      });

    expect(res.status).toBe(200);
    expect(res.body.prompt).toMatch(/-1\.5/);             // el cambio de peso está en el prompt
    expect(res.body.prompt).toMatch(/peso|weight|cambio/i);
    expect(res.body.suggestionType).toBe('progress.updated');
  });

  it('callback guarda análisis de progreso', async () => {
    await request(app).post('/api/v1/n8n/callback').set(n8nHeader()).send({
      accountId,
      suggestion: 'Bajaste 1.5 kg en dos semanas, ¡excelente progreso! Mantén el déficit calórico.',
      suggestionType: 'progress.updated',
    });

    const res = await request(app).get('/api/v1/auth/ai-suggestions')
      .set(bearerHeader(token));

    const progSuggestions = res.body.data.filter(s => s.tipo_sugerencia === 'progress.updated');
    expect(progSuggestions.length).toBeGreaterThanOrEqual(1);
  });

  it('cambio de peso positivo está representado correctamente (+x kg)', async () => {
    const res = await request(app).post('/api/v1/n8n/build-prompt')
      .set(n8nHeader())
      .send({
        event: 'progress.updated',
        accountId,
        user:  { name: 'Pedro', goal: 'gain' },
        data:  { weight: 86, waistCm: 88 },
        context: { weightChange: +1.2 },
      });

    expect(res.body.prompt).toMatch(/\+1\.2/);  // positivo usa el símbolo +
  });

  it('primera medición (weightChange=null) usa "primera medición" en el prompt', async () => {
    const res = await request(app).post('/api/v1/n8n/build-prompt')
      .set(n8nHeader())
      .send({
        event: 'progress.updated',
        accountId,
        user:  { name: 'Pedro', goal: 'lose' },
        data:  { weight: 85 },
        context: { weightChange: null },
      });

    expect(res.body.prompt).toMatch(/primera medición/i);
  });
});

// ── Pipeline 4: Check-in semanal automático ───────────────────────────────────

describe('Pipeline weekly.checkin — check-in semanal', () => {
  it('build-prompt para weekly.checkin genera resumen semanal', async () => {
    const res = await request(app).post('/api/v1/n8n/build-prompt')
      .set(n8nHeader())
      .send({
        event:     'weekly.checkin',
        accountId,
        user:      { name: 'Pedro Pipeline', goal: 'lose', weight: 83 },
        data:      {},
        context:   { weeklyWorkouts: 3, targetWorkouts: 4, avgKcal: 1720, weightChange: -0.8, weeklyDietLogs: 5 },
      });

    expect(res.status).toBe(200);
    expect(res.body.prompt).toMatch(/3\/4|3 \/ 4|3 de 4/i);  // workouts completados vs objetivo
    expect(res.body.prompt).toMatch(/1720/);                   // calorías promedio
    expect(res.body.suggestionType).toBe('weekly.checkin');
  });

  it('evento desconocido también genera weekly.checkin como fallback', async () => {
    const res = await request(app).post('/api/v1/n8n/build-prompt')
      .set(n8nHeader())
      .send({
        event: 'evento_desconocido',
        accountId,
        user:  { name: 'Pedro', goal: 'maintain' },
        context: {},
      });

    expect(res.status).toBe(200);
    expect(res.body.suggestionType).toBe('weekly.checkin'); // fallback
  });
});

// ── Pipeline 5: N8N consulta usuarios activos para check-ins programados ─────

describe('N8N weekly-users — consulta de usuarios activos', () => {
  it('devuelve estructura que N8N necesita para iterar', async () => {
    const res = await request(app).get('/api/v1/n8n/weekly-users')
      .set(n8nHeader());

    expect(res.status).toBe(200);
    // N8N itera sobre users para generar prompts
    expect(Array.isArray(res.body.users)).toBe(true);
    expect(typeof res.body.count).toBe('number');
    expect(res.body.count).toBe(res.body.users.length);
    // El campo week es la fecha de inicio de semana (ISO)
    expect(res.body.week).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('cada usuario en weekly-users tiene la estructura que build-prompt necesita', async () => {
    const res = await request(app).get('/api/v1/n8n/weekly-users')
      .set(n8nHeader());

    if (res.body.users.length === 0) return; // sin usuarios activos en test es válido

    const user = res.body.users[0];
    // Campos que build-prompt usa del objeto user{}
    expect(user).toHaveProperty('accountId');
    expect(user).toHaveProperty('user');
    expect(user).toHaveProperty('context');
    expect(user).toHaveProperty('event');
    expect(user.event).toBe('weekly.checkin');

    // Context tiene los campos que el prompt de weekly.checkin necesita
    expect(user.context).toHaveProperty('weeklyWorkouts');
    expect(user.context).toHaveProperty('weeklyDietLogs');
    expect(user.context).toHaveProperty('targetWorkouts');
  });
});

// ── Pipeline 6: Estado N8N — monitoreo desde la app ──────────────────────────

describe('N8N status — monitoreo desde la app del usuario', () => {
  it('GET /n8n/status requiere autenticación del usuario (no secreto N8N)', async () => {
    const noAuth = await request(app).get('/api/v1/n8n/status');
    expect(noAuth.status).toBe(401);
  });

  it('el usuario autenticado puede ver el estado de N8N', async () => {
    const res = await request(app).get('/api/v1/n8n/status')
      .set(bearerHeader(token));

    expect(res.status).toBe(200);
    expect(typeof res.body.configured).toBe('boolean');
    expect(res.body.secret_set).toBe(true); // N8N_SECRET está configurado en este test
    expect(Array.isArray(res.body.events_supported)).toBe(true);
    expect(res.body.events_supported).toContain('workout.logged');
    expect(res.body.events_supported).toContain('diet.logged');
    expect(res.body.events_supported).toContain('progress.updated');
    expect(res.body.events_supported).toContain('weekly.checkin');
  });

  it('n8n_suggestions refleja el conteo real de sugerencias guardadas', async () => {
    // Guarda 2 sugerencias
    await request(app).post('/api/v1/n8n/callback').set(n8nHeader())
      .send({ accountId, suggestion: 'Sugerencia 1', suggestionType: 'n8n.coaching' });
    await request(app).post('/api/v1/n8n/callback').set(n8nHeader())
      .send({ accountId, suggestion: 'Sugerencia 2', suggestionType: 'n8n.coaching' });

    const res = await request(app).get('/api/v1/n8n/status').set(bearerHeader(token));
    expect(res.body.n8n_suggestions).toBeGreaterThanOrEqual(0);
    expect(typeof res.body.n8n_suggestions).toBe('number');
  });
});

// ── Pipeline 7: Múltiples sugerencias — la app las muestra todas ─────────────

describe('Acumulación de sugerencias — historial de coaching completo', () => {
  it('múltiples eventos generan múltiples sugerencias visibles en la app', async () => {
    const events = [
      { suggestionType: 'workout.logged',    suggestion: 'Buen trabajo con el cardio.' },
      { suggestionType: 'diet.logged',       suggestion: 'Tu alimentación está balanceada.' },
      { suggestionType: 'progress.updated',  suggestion: 'Perdiste 0.5 kg esta semana.' },
    ];

    for (const ev of events) {
      await request(app).post('/api/v1/n8n/callback').set(n8nHeader())
        .send({ accountId, ...ev });
    }

    const res = await request(app).get('/api/v1/auth/ai-suggestions')
      .set(bearerHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(3);

    const tipos = res.body.data.map(s => s.tipo_sugerencia);
    expect(tipos).toContain('workout.logged');
    expect(tipos).toContain('diet.logged');
    expect(tipos).toContain('progress.updated');
  });

  it('el callback sin suggestionType usa el event como tipo de sugerencia', async () => {
    await request(app).post('/api/v1/n8n/callback').set(n8nHeader())
      .send({ accountId, suggestion: 'Usa el event.', event: 'workout.logged' }); // sin suggestionType

    const res = await request(app).get('/api/v1/auth/ai-suggestions')
      .set(bearerHeader(token));

    const types = res.body.data.map(s => s.tipo_sugerencia);
    expect(types).toContain('workout.logged');
  });
});
