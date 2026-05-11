'use strict';

const jwt     = require('jsonwebtoken');
const request = require('supertest');

/**
 * Genera un JWT válido para tests sin necesitar llamar al endpoint de registro.
 * Útil cuando solo se necesita pasar requireAuth sin un flujo de registro completo.
 */
function makeToken(userId = 1, overrides = {}) {
  return jwt.sign(
    { id: userId, email: `user_${userId}@test.com`, name: 'Test User', ...overrides },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

/**
 * Registra un usuario de prueba y devuelve { token, user }.
 * Usa un email único por invocación para evitar colisiones en la DB in-memory.
 */
async function registerUser(app, overrides = {}) {
  const defaults = {
    email:    `user_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`,
    password: 'Password123!',
    name:     'Test User',
    goal:     'maintain',
    weight:   75,
    height:   175,
    age:      28,
    gender:   'male',
    activityLevel: 'moderate',
  };
  const body = { ...defaults, ...overrides };
  const res  = await request(app).post('/api/v1/auth/register').send(body);
  if (res.status !== 201) {
    throw new Error(`registerUser failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return { token: res.body.accessToken, user: res.body.user, credentials: body };
}

/**
 * Devuelve el header Authorization listo para usar con supertest.
 */
function bearerHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

module.exports = { registerUser, bearerHeader, makeToken };
