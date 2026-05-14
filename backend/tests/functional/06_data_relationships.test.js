'use strict';

jest.mock('../../src/db/postgres', () => require('../helpers/mockPostgres').mockPg);
jest.mock('../../src/services/visionClient', () => require('../helpers/mockVision').mockVision);

const request = require('supertest');
const { registerUser, bearerHeader } = require('../helpers/auth');

let app;
beforeAll(() => {
  app = require('../../src/app');
});

// ── Aislamiento total de datos entre usuarios ─────────────────────────────────

describe('Aislamiento de datos — usuarios no ven datos ajenos', () => {
  let tokenA, tokenB, userA, userB;

  beforeAll(async () => {
    const rA = await registerUser(app, { name: 'Alice' });
    const rB = await registerUser(app, { name: 'Bob' });
    tokenA = rA.token; userA = rA.user;
    tokenB = rB.token; userB = rB.user;
  });

  it('Alice no ve workout-logs de Bob', async () => {
    await request(app).post('/api/v1/auth/workout-log')
      .set(bearerHeader(tokenB))
      .send({ routineName: 'Entreno secreto de Bob', exercises: [] });
    const res = await request(app).get('/api/v1/auth/workout-logs').set(bearerHeader(tokenA));
    const names = (res.body.data || []).map(l => l.nombre_rutina);
    expect(names).not.toContain('Entreno secreto de Bob');
  });

  it('Bob no ve los diet-logs de Alice', async () => {
    await request(app).post('/api/v1/auth/diet-log')
      .set(bearerHeader(tokenA))
      .send({ planName: 'Dieta privada de Alice', meals: [] });
    const res = await request(app).get('/api/v1/auth/diet-logs').set(bearerHeader(tokenB));
    const names = (res.body.data || []).map(l => l.nombre_plan);
    expect(names).not.toContain('Dieta privada de Alice');
  });

  it('Alice no ve las AI suggestions de Bob', async () => {
    await request(app).post('/api/v1/auth/ai-suggestion')
      .set(bearerHeader(tokenB))
      .send({ content: 'Sugerencia privada de Bob' });
    const res = await request(app).get('/api/v1/auth/ai-suggestions').set(bearerHeader(tokenA));
    const contents = (res.body.data || []).map(s => s.contenido);
    expect(contents).not.toContain('Sugerencia privada de Bob');
  });

  it('Bob no ve el chat-history de Alice', async () => {
    await request(app).post('/api/v1/auth/chat-history')
      .set(bearerHeader(tokenA))
      .send({ messages: [{ role: 'user', content: 'Mensaje íntimo de Alice' }] });
    const res = await request(app).get('/api/v1/auth/chat-history').set(bearerHeader(tokenB));
    const contents = (res.body.data || []).map(m => m.contenido);
    expect(contents).not.toContain('Mensaje íntimo de Alice');
  });

  it('el perfil de Alice no es accesible con el token de Bob', async () => {
    const resA = await request(app).get('/api/v1/auth/me').set(bearerHeader(tokenA));
    const resB = await request(app).get('/api/v1/auth/me').set(bearerHeader(tokenB));
    expect(resA.body.name).toBe('Alice');
    expect(resB.body.name).toBe('Bob');
    expect(resA.body.id).not.toBe(resB.body.id);
  });
});
