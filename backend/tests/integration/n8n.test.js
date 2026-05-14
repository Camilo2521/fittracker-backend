'use strict';

jest.mock('../../src/db/postgres',       () => require('../helpers/mockPostgres').mockPg);
jest.mock('../../src/services/visionClient', () => require('../helpers/mockVision').mockVision);

const request = require('supertest');
const { registerUser, bearerHeader } = require('../helpers/auth');

let app, token, accountId;

const N8N_SECRET = 'test-n8n-secret-for-jest';

beforeAll(async () => {
  process.env.N8N_SECRET = N8N_SECRET;
  app = require('../../src/app');
  const r = await registerUser(app);
  token     = r.token;
  accountId = String(r.user.id);
});

afterAll(() => {
  delete process.env.N8N_SECRET;
});

function n8nHeader() {
  return { 'x-n8n-secret': N8N_SECRET };
}

// ── POST /api/v1/n8n/build-prompt ────────────────────────────────────────────

describe('POST /api/v1/n8n/build-prompt', () => {
  it('sin secreto → 401', async () => {
    const res = await request(app)
      .post('/api/v1/n8n/build-prompt')
      .send({ event: 'workout.logged', accountId });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('sin event → 400', async () => {
    const res = await request(app)
      .post('/api/v1/n8n/build-prompt')
      .set(n8nHeader())
      .send({ accountId });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/event/i);
  });

  it('event workout.logged → prompt con datos del workout', async () => {
    const res = await request(app)
      .post('/api/v1/n8n/build-prompt')
      .set(n8nHeader())
      .send({
        event:     'workout.logged',
        accountId,
        user:      { name: 'Ana', goal: 'lose', weight: 65, age: 28 },
        data:      { routineName: 'Full body A', durationMin: 45, exercises: ['Sentadillas', 'Flexiones'] },
        context:   { recentWorkouts: 3, weeklyTarget: 4 },
      });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('prompt');
    expect(res.body.prompt).toMatch(/Ana|workout|Full body/i);
    expect(res.body.event).toBe('workout.logged');
    expect(res.body).toHaveProperty('model');
    expect(res.body).toHaveProperty('max_tokens');
  });

  it('event diet.logged → prompt con datos de nutrición', async () => {
    const res = await request(app)
      .post('/api/v1/n8n/build-prompt')
      .set(n8nHeader())
      .send({
        event: 'diet.logged',
        accountId,
        user:  { name: 'Carlos', goal: 'gain', weight: 75 },
        data:  { planName: 'Volumen semana 3', totalKcal: 3200 },
      });
    expect(res.status).toBe(200);
    expect(res.body.prompt).toMatch(/Carlos|diet|3200/i);
  });

  it('event progress.updated → prompt con cambio de peso', async () => {
    const res = await request(app)
      .post('/api/v1/n8n/build-prompt')
      .set(n8nHeader())
      .send({
        event:   'progress.updated',
        accountId,
        user:    { name: 'Laura', goal: 'lose', weight: 70 },
        data:    { weight: 70, waistCm: 80 },
        context: { weightChange: -0.5 },
      });
    expect(res.status).toBe(200);
    expect(res.body.prompt).toMatch(/Laura|-0\.5/);
  });

  it('event desconocido → prompt de weekly checkin por defecto', async () => {
    const res = await request(app)
      .post('/api/v1/n8n/build-prompt')
      .set(n8nHeader())
      .send({
        event:   'weekly.checkin',
        accountId,
        user:    { name: 'Pedro', goal: 'maintain' },
        context: { weeklyWorkouts: 2, targetWorkouts: 4 },
      });
    expect(res.status).toBe(200);
    expect(res.body.suggestionType).toBe('weekly.checkin');
  });
});

// ── POST /api/v1/n8n/callback ─────────────────────────────────────────────────

describe('POST /api/v1/n8n/callback', () => {
  it('sin secreto → 401', async () => {
    const res = await request(app)
      .post('/api/v1/n8n/callback')
      .send({ accountId, suggestion: 'Haz más cardio', event: 'workout.logged' });
    expect(res.status).toBe(401);
  });

  it('sin accountId → 400', async () => {
    const res = await request(app)
      .post('/api/v1/n8n/callback')
      .set(n8nHeader())
      .send({ suggestion: 'Haz más cardio' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/accountId/i);
  });

  it('sin suggestion → 400', async () => {
    const res = await request(app)
      .post('/api/v1/n8n/callback')
      .set(n8nHeader())
      .send({ accountId });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/suggestion/i);
  });

  it('sin suggestionType usa el event como tipo', async () => {
    const res = await request(app)
      .post('/api/v1/n8n/callback')
      .set(n8nHeader())
      .send({ accountId, suggestion: 'Descansa bien esta noche.', event: 'progress.updated' });
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('progress.updated');
  });

  it('payload válido → 200 con id de sugerencia guardada', async () => {
    const res = await request(app)
      .post('/api/v1/n8n/callback')
      .set(n8nHeader())
      .send({
        accountId,
        suggestion:     'Excelente sesión. Añade 5 kg la próxima semana.',
        event:          'workout.logged',
        suggestionType: 'workout.logged',
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body).toHaveProperty('id');
    expect(res.body.accountId).toBe(accountId);
  });
});

// ── GET /api/v1/n8n/status ────────────────────────────────────────────────────

describe('GET /api/v1/n8n/status', () => {
  it('sin token → 401', async () => {
    const res = await request(app).get('/api/v1/n8n/status');
    expect(res.status).toBe(401);
  });

  it('con token → 200 con estructura correcta', async () => {
    const res = await request(app)
      .get('/api/v1/n8n/status')
      .set(bearerHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('configured');
    expect(res.body).toHaveProperty('secret_set');
    expect(res.body).toHaveProperty('events_supported');
    expect(Array.isArray(res.body.events_supported)).toBe(true);
    expect(res.body.events_supported).toContain('workout.logged');
    expect(typeof res.body.n8n_suggestions).toBe('number');
  });

  it('el webhook_url está ofuscado si está configurado', async () => {
    process.env.N8N_WEBHOOK_URL = 'http://n8n.local:5678/webhook/fittracker-events';
    const res = await request(app)
      .get('/api/v1/n8n/status')
      .set(bearerHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    // La URL real no debe aparecer completa — el path del webhook está enmascarado
    expect(res.body.webhook_url).not.toContain('fittracker-events');
    delete process.env.N8N_WEBHOOK_URL;
  });
});

// ── GET /api/v1/n8n/weekly-users ─────────────────────────────────────────────

describe('GET /api/v1/n8n/weekly-users', () => {
  it('sin secreto → 401', async () => {
    const res = await request(app).get('/api/v1/n8n/weekly-users');
    expect(res.status).toBe(401);
  });

  it('con secreto → 200 con estructura de usuarios', async () => {
    const res = await request(app)
      .get('/api/v1/n8n/weekly-users')
      .set(n8nHeader());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('users');
    expect(Array.isArray(res.body.users)).toBe(true);
    expect(res.body).toHaveProperty('count');
    expect(res.body).toHaveProperty('week');
  });

  it('usuario sin peso → weightChange es null', async () => {
    // Register a user without physical data — peso stays null in the mock store
    await request(app).post('/api/v1/auth/register').send({
      email: `nopeso_${Date.now()}@test.com`,
      password: 'Password123!',
      name: 'Sin Peso',
    });

    const res = await request(app)
      .get('/api/v1/n8n/weekly-users')
      .set(n8nHeader());

    expect(res.status).toBe(200);
    const nullWeightUser = res.body.users.find(u => u.context.weightChange === null);
    expect(nullWeightUser).toBeDefined();
  });
});
