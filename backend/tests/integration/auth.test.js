'use strict';

jest.mock('../../src/db/postgres', () => require('../helpers/mockPostgres').mockPg);
jest.mock('../../src/services/visionClient', () => require('../helpers/mockVision').mockVision);

const request = require('supertest');
const { registerUser, bearerHeader } = require('../helpers/auth');

let app;
beforeAll(() => {
  app = require('../../src/app');
});

// ── Registro ───────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/register', () => {
  it('crea un usuario y devuelve token + user (201)', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: `reg_${Date.now()}@test.com`,
      password: 'Secret123!',
      name: 'Ana García',
    });
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.email).toMatch(/@test\.com$/);
  });

  it('normaliza el email a minúsculas', async () => {
    const email = `UPPER_${Date.now()}@Test.COM`;
    const res = await request(app).post('/api/v1/auth/register').send({
      email, password: 'Secret123!',
    });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(email.toLowerCase());
  });

  it('no devuelve password_hash en la respuesta', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: `nohash_${Date.now()}@test.com`, password: 'Secret123!',
    });
    expect(res.body.user.password_hash).toBeUndefined();
  });

  it('rechaza email duplicado con 409', async () => {
    const email = `dup_${Date.now()}@test.com`;
    await request(app).post('/api/v1/auth/register').send({ email, password: 'Password123!' });
    const res = await request(app).post('/api/v1/auth/register').send({ email, password: 'Password123!' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/registrado/i);
  });

  it('rechaza sin email con 400', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({ password: 'abc12345' });
    expect(res.status).toBe(400);
  });

  it('rechaza sin contraseña con 400', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({ email: 'a@b.com' });
    expect(res.status).toBe(400);
  });

  it('rechaza contraseña < 8 caracteres con 400', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: `short_${Date.now()}@test.com`, password: '1234567',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/8 car/i);
  });

  it('rechaza email con formato inválido con 400', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: 'notanemail', password: 'Password123!',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email inv/i);
  });

  it('guarda goal, weight, age y gender correctamente', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: `full_${Date.now()}@test.com`, password: 'Password123!',
      goal: 'lose', weight: 90, height: 180, age: 35, gender: 'male',
    });
    expect(res.status).toBe(201);
    expect(res.body.user.goal).toBe('lose');
    expect(res.body.user.weight).toBe(90);
    expect(res.body.user.age).toBe(35);
  });
});

// ── Login ──────────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/login', () => {
  let credentials;
  beforeAll(async () => {
    const { credentials: creds } = await registerUser(app);
    credentials = creds;
  });

  it('devuelve token con credenciales correctas (200)', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({
      email: credentials.email, password: credentials.password,
    });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
  });

  it('el login es case-insensitive para el email', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({
      email: credentials.email.toUpperCase(), password: credentials.password,
    });
    expect(res.status).toBe(200);
  });

  it('rechaza contraseña incorrecta con 401', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({
      email: credentials.email, password: 'WrongPassword!',
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/incorrectos/i);
  });

  it('rechaza email inexistente con 401 (no 404 — timing safe)', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({
      email: 'ghost@nowhere.com', password: 'abc12345',
    });
    expect(res.status).toBe(401);
  });

  it('rechaza petición sin campos con 400', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({});
    expect(res.status).toBe(400);
  });

  it('no devuelve password_hash en la respuesta', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({
      email: credentials.email, password: credentials.password,
    });
    expect(res.body.user.password_hash).toBeUndefined();
  });
});

// ── GET /me ────────────────────────────────────────────────────────────────────

describe('GET /api/v1/auth/me', () => {
  let token, user;
  beforeAll(async () => {
    ({ token, user } = await registerUser(app));
  });

  it('devuelve el perfil del usuario autenticado', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set(bearerHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(user.email);
  });

  it('rechaza sin token con 401', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('rechaza token malformado con 401', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer INVALIDTOKEN');
    expect(res.status).toBe(401);
  });

  it('rechaza token con secreto incorrecto con 401', async () => {
    const jwt = require('jsonwebtoken');
    const fakeToken = jwt.sign({ id: 999, email: 'x@x.com' }, 'wrong-secret');
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${fakeToken}`);
    expect(res.status).toBe(401);
  });
});

// ── PUT /profile ───────────────────────────────────────────────────────────────

describe('PUT /api/v1/auth/profile', () => {
  let token;
  beforeAll(async () => {
    ({ token } = await registerUser(app));
  });

  it('actualiza el nombre correctamente', async () => {
    const res = await request(app)
      .put('/api/v1/auth/profile')
      .set(bearerHeader(token))
      .send({ name: 'Nombre Actualizado' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Nombre Actualizado');
  });

  it('actualiza el objetivo y el peso', async () => {
    const res = await request(app)
      .put('/api/v1/auth/profile')
      .set(bearerHeader(token))
      .send({ goal: 'gain', weight: 80 });
    expect(res.status).toBe(200);
    expect(res.body.goal).toBe('gain');
    expect(res.body.weight).toBe(80);
  });

  it('actualización parcial no sobreescribe campos no enviados', async () => {
    await request(app)
      .put('/api/v1/auth/profile')
      .set(bearerHeader(token))
      .send({ name: 'Nombre Fijo' });
    const res = await request(app)
      .put('/api/v1/auth/profile')
      .set(bearerHeader(token))
      .send({ weight: 99 });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Nombre Fijo');
    expect(res.body.weight).toBe(99);
  });

  it('requiere autenticación', async () => {
    const res = await request(app).put('/api/v1/auth/profile').send({ name: 'X' });
    expect(res.status).toBe(401);
  });
});

// ── Chat history ───────────────────────────────────────────────────────────────

describe('Chat history', () => {
  let token;
  beforeAll(async () => {
    ({ token } = await registerUser(app));
  });

  it('GET /chat-history devuelve array vacío para usuario nuevo', async () => {
    const res = await request(app)
      .get('/api/v1/auth/chat-history')
      .set(bearerHeader(token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('POST /chat-history guarda mensajes y GET los devuelve', async () => {
    await request(app)
      .post('/api/v1/auth/chat-history')
      .set(bearerHeader(token))
      .send({
        messages: [
          { role: 'user',      content: '¿Cuántas calorías necesito?' },
          { role: 'assistant', content: 'Depende de tu objetivo...' },
        ],
      });
    const res = await request(app)
      .get('/api/v1/auth/chat-history')
      .set(bearerHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    const roles = res.body.data.map(m => m.rol);
    expect(roles).toContain('user');
    expect(roles).toContain('assistant');
  });

  it('filtra mensajes sin role o content', async () => {
    const res = await request(app)
      .post('/api/v1/auth/chat-history')
      .set(bearerHeader(token))
      .send({ messages: [{ role: '', content: '' }, { role: 'user', content: 'válido' }] });
    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(1);
  });
});

// ── Workout logs ───────────────────────────────────────────────────────────────

describe('Workout logs', () => {
  let token;
  beforeAll(async () => {
    ({ token } = await registerUser(app));
  });

  it('POST /workout-log crea un log y devuelve id', async () => {
    const res = await request(app)
      .post('/api/v1/auth/workout-log')
      .set(bearerHeader(token))
      .send({
        date: '2024-04-01',
        routineName: 'Piernas A',
        exercises: [{ name: 'Sentadilla', sets: 4, reps: 12, weight: 80 }],
        durationMin: 45,
        notes: 'Buen entrenamiento',
      });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeGreaterThan(0);
  });

  it('GET /workout-logs devuelve los logs con ejercicios_json parseado', async () => {
    const res = await request(app)
      .get('/api/v1/auth/workout-logs')
      .set(bearerHeader(token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(Array.isArray(res.body.data[0]?.ejercicios_json)).toBe(true);
  });

  it('devuelve máximo 60 logs', async () => {
    const res = await request(app)
      .get('/api/v1/auth/workout-logs')
      .set(bearerHeader(token));
    expect(res.body.data.length).toBeLessThanOrEqual(60);
  });
});

// ── Diet logs ──────────────────────────────────────────────────────────────────

describe('Diet logs', () => {
  let token;
  beforeAll(async () => {
    ({ token } = await registerUser(app));
  });

  it('POST /diet-log crea un registro de dieta', async () => {
    const res = await request(app)
      .post('/api/v1/auth/diet-log')
      .set(bearerHeader(token))
      .send({
        date: '2024-04-01',
        planName: 'Pérdida de peso',
        meals: [{ name: 'Desayuno', calories: 400 }],
        totalKcal: 1800,
      });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeGreaterThan(0);
  });

  it('GET /diet-logs devuelve los logs con comidas_json parseado', async () => {
    const res = await request(app)
      .get('/api/v1/auth/diet-logs')
      .set(bearerHeader(token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data[0]?.comidas_json)).toBe(true);
  });
});

// ── Progress logs ──────────────────────────────────────────────────────────────

describe('Progress logs', () => {
  let token;
  beforeAll(async () => {
    ({ token } = await registerUser(app));
  });

  it('POST /progress-log crea un log de progreso', async () => {
    const res = await request(app)
      .post('/api/v1/auth/progress-log')
      .set(bearerHeader(token))
      .send({ date: '2024-04-01', weight: 82.5, waistCm: 90, hipCm: 100 });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeGreaterThan(0);
  });

  it('actualiza el peso del perfil al registrar un log con weight', async () => {
    await request(app)
      .post('/api/v1/auth/progress-log')
      .set(bearerHeader(token))
      .send({ weight: 79.0 });
    const me = await request(app)
      .get('/api/v1/auth/me')
      .set(bearerHeader(token));
    expect(me.body.weight).toBe(79.0);
  });

  it('GET /progress-logs devuelve los registros', async () => {
    const res = await request(app)
      .get('/api/v1/auth/progress-logs')
      .set(bearerHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });
});

// ── AI suggestions ─────────────────────────────────────────────────────────────

describe('AI Suggestions', () => {
  let token;
  beforeAll(async () => {
    ({ token } = await registerUser(app));
  });

  it('POST /ai-suggestion guarda una sugerencia', async () => {
    const res = await request(app)
      .post('/api/v1/auth/ai-suggestion')
      .set(bearerHeader(token))
      .send({ suggestionType: 'nutrition', content: 'Come más proteína en el desayuno.' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeGreaterThan(0);
  });

  it('POST /ai-suggestion rechaza si falta content (400)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/ai-suggestion')
      .set(bearerHeader(token))
      .send({ suggestionType: 'nutrition' });
    expect(res.status).toBe(400);
  });

  it('GET /ai-suggestions devuelve las sugerencias guardadas', async () => {
    await request(app)
      .post('/api/v1/auth/ai-suggestion')
      .set(bearerHeader(token))
      .send({ content: 'Añade 10 min de caminar al día.' });
    const res = await request(app)
      .get('/api/v1/auth/ai-suggestions')
      .set(bearerHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('devuelve máximo 30 sugerencias', async () => {
    const res = await request(app)
      .get('/api/v1/auth/ai-suggestions')
      .set(bearerHeader(token));
    expect(res.body.data.length).toBeLessThanOrEqual(30);
  });
});
