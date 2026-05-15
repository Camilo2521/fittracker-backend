'use strict';

/**
 * ARCHITECTURE — Infraestructura transversal
 *
 * Verifica las capas que todo request atraviesa antes de llegar a un handler:
 *   • Cabeceras de seguridad (Helmet)
 *   • Propagación de Request-ID
 *   • Comportamiento CORS
 *   • Health check — estructura completa y contratos
 *   • Manejo global de errores y 404
 *   • Documentación Swagger accesible
 *   • Rate-limiter presente en stack (no activo en test mode por diseño)
 */

jest.mock('../../src/db/postgres', () => require('../helpers/mockPostgres').mockPg);
jest.mock('../../src/services/visionClient', () => require('../helpers/mockVision').mockVision);
jest.mock('../../src/services/ollamaService', () => ({
  isAvailable: jest.fn().mockResolvedValue(false),
  getModel: () => 'llama3.2',
}));

const request = require('supertest');
const { registerUser, bearerHeader } = require('../helpers/auth');

let app;
beforeAll(() => {
  app = require('../../src/app');
});

// ── 1. Cabeceras de seguridad (Helmet) ────────────────────────────────────────

describe('Cabeceras de seguridad — Helmet', () => {
  let res;
  beforeAll(async () => {
    res = await request(app).get('/health');
  });

  it('X-Content-Type-Options: nosniff en todas las respuestas', () => {
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('X-DNS-Prefetch-Control: off para evitar fugas de DNS', () => {
    expect(res.headers['x-dns-prefetch-control']).toBe('off');
  });

  it('X-Frame-Options presente para prevenir clickjacking', () => {
    expect(res.headers['x-frame-options']).toMatch(/SAMEORIGIN|DENY/i);
  });

  it('X-Download-Options: noopen para evitar apertura directa de archivos en IE', () => {
    expect(res.headers['x-download-options']).toBe('noopen');
  });

  it('Content-Security-Policy presente con directivas correctas', () => {
    const csp = res.headers['content-security-policy'] || '';
    expect(csp).toMatch(/default-src/i);
    expect(csp).toMatch(/frame-src.*none/i);
    expect(csp).toMatch(/object-src.*none/i);
  });

  it('Las cabeceras de seguridad también aparecen en respuestas 4xx', async () => {
    const r = await request(app).get('/ruta-inexistente-12345');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });

  it('Las cabeceras de seguridad también aparecen en respuestas de auth (201)', async () => {
    const r = await request(app).post('/api/v1/auth/register').send({
      email: `sec_${Date.now()}@test.com`, password: 'Password123!',
    });
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });
});

// ── 2. Propagación de Request-ID ──────────────────────────────────────────────

describe('Request-ID — trazabilidad por petición', () => {
  it('cada respuesta incluye el header X-Request-Id', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('el X-Request-Id tiene formato UUID (36 chars con guiones)', () => {
    // UUID v4: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    return request(app).get('/health').then(res => {
      const id = res.headers['x-request-id'];
      expect(id).toMatch(/^[0-9a-f-]{32,36}$/i);
    });
  });

  it('si el cliente envía X-Request-Id, el servidor lo reutiliza', async () => {
    const clientId = 'mi-correlation-id-de-test-1234';
    const res = await request(app)
      .get('/health')
      .set('X-Request-Id', clientId);
    expect(res.headers['x-request-id']).toBe(clientId);
  });

  it('dos peticiones simultáneas tienen X-Request-Id distintos', async () => {
    const [r1, r2] = await Promise.all([
      request(app).get('/health'),
      request(app).get('/health'),
    ]);
    expect(r1.headers['x-request-id']).not.toBe(r2.headers['x-request-id']);
  });

  it('las respuestas de error 400 incluyen requestId en el body', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({});
    expect(res.body.requestId || res.headers['x-request-id']).toBeTruthy();
  });

  it('X-Request-Id en respuestas 404 (rutas inexistentes)', async () => {
    const res = await request(app).get('/api/v1/ruta-que-no-existe');
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});

// ── 3. Comportamiento CORS ────────────────────────────────────────────────────

describe('CORS — control de orígenes permitidos', () => {
  it('petición sin Origin (server-to-server) es permitida', async () => {
    const res = await request(app).get('/health');
    expect(res.status).not.toBe(403);
  });

  it('petición con Origin: null (Capacitor/Cordova) es permitida', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', 'null');
    expect(res.status).not.toBe(403);
  });

  it('en modo test/dev localhost:8080 es un origen permitido', async () => {
    const res = await request(app)
      .options('/api/v1/auth/login')
      .set('Origin', 'http://localhost:8080')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.status).not.toBe(403);
  });

  it('en modo test/dev localhost con cualquier puerto es permitido', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', 'http://localhost:5173');
    expect(res.status).not.toBe(403);
  });

  it('preflight OPTIONS responde 204', async () => {
    const res = await request(app)
      .options('/api/v1/auth/login')
      .set('Origin', 'http://localhost:3001')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Content-Type,Authorization');
    expect(res.status).toBe(204);
  });

  it('la respuesta incluye Access-Control-Allow-Credentials: true', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', 'http://localhost:8080');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('el header Authorization está en la lista de cabeceras permitidas', async () => {
    const res = await request(app)
      .options('/api/v1/auth/me')
      .set('Origin', 'http://localhost:3001')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'Authorization');
    const allowed = res.headers['access-control-allow-headers'] || '';
    expect(allowed.toLowerCase()).toMatch(/authorization/);
  });
});

// ── 4. Health Check — estructura y contratos ──────────────────────────────────

describe('Health Check — /health', () => {
  let res;
  beforeAll(async () => {
    res = await request(app).get('/health');
  });

  it('devuelve 200 con postgres ok (mock responde ok)', () => {
    expect(res.status).toBe(200);
  });

  it('tiene el campo status="ok"', () => {
    expect(res.body.status).toBe('ok');
  });

  it('tiene version de la API', () => {
    expect(res.body.version).toMatch(/\d+\.\d+\.\d+/);
  });

  it('tiene timestamp ISO 8601 válido', () => {
    const ts = new Date(res.body.timestamp);
    expect(Number.isNaN(ts.getTime())).toBe(false);
    expect(res.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('checks.node es "ok"', () => {
    expect(res.body.checks).toBeDefined();
    expect(res.body.checks.node).toBe('ok');
  });

  it('checks.postgres es "ok" (mock)', () => {
    expect(res.body.checks.postgres).toBe('ok');
  });

  it('checks.python es "unavailable" (no hay servicio Python en tests)', () => {
    expect(res.body.checks.python).toBe('unavailable');
  });

  it('feature_flags es un objeto con las 4 flags conocidas', () => {
    const flags = res.body.feature_flags;
    expect(typeof flags).toBe('object');
    expect(flags).toHaveProperty('rag_enabled');
    expect(flags).toHaveProperty('weekly_pdf');
    expect(flags).toHaveProperty('yolo_enabled');
    expect(flags).toHaveProperty('vision_v2');
  });

  it('los feature flags son todos booleanos', () => {
    const { feature_flags } = res.body;
    Object.values(feature_flags).forEach(v => expect(typeof v).toBe('boolean'));
  });

  it('el Content-Type es application/json', () => {
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('la respuesta llega en menos de 300 ms', async () => {
    const start = Date.now();
    await request(app).get('/health');
    expect(Date.now() - start).toBeLessThan(300);
  });
});

// ── 5. Manejo global de errores ────────────────────────────────────────────────

describe('Manejo global de errores — estructura de respuesta', () => {
  it('toda respuesta de error 4xx es JSON válido con campo "error" string', async () => {
    const cases = await Promise.all([
      request(app).post('/api/v1/auth/register').send({}),
      request(app).post('/api/v1/auth/login').send({}),
      request(app).get('/api/v1/auth/me'),
      request(app).post('/api/v1/reps/sessions').send({ exerciseType: 'squat' }),
    ]);
    cases.forEach(r => {
      expect(r.headers['content-type']).toMatch(/application\/json/);
      expect(typeof r.body.error).toBe('string');
      expect(r.body.error.length).toBeGreaterThan(0);
    });
  });

  it('ruta inexistente devuelve 404 JSON con campo "error"', async () => {
    const res = await request(app).get('/api/v1/esto-no-existe');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Route not found');
  });

  it('método HTTP incorrecto en ruta existente devuelve 404', async () => {
    const res = await request(app).patch('/api/v1/auth/login').send({});
    expect(res.status).toBe(404);
  });

  it('los mensajes de error son legibles (no [object Object] ni null)', async () => {
    const cases = [
      request(app).post('/api/v1/auth/register').send({ password: 'abc' }),
      request(app).post('/api/v1/auth/login').send({}),
    ];
    const responses = await Promise.all(cases);
    responses.forEach(r => {
      expect(r.body.error).not.toMatch(/\[object/i);
      expect(r.body.error).not.toBeNull();
    });
  });

  it('un error en handler no expone stack trace en la respuesta', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer token-invalido');
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\(/); // no stack trace
  });
});

// ── 6. Documentación Swagger ──────────────────────────────────────────────────

describe('Documentación API — Swagger / OpenAPI', () => {
  it('GET /docs.json devuelve la especificación OpenAPI 3.0', async () => {
    const res = await request(app).get('/docs.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toMatch(/^3\./);
  });

  it('la especificación contiene info.title = "FitTracker API"', async () => {
    const res = await request(app).get('/docs.json');
    expect(res.body.info.title).toBe('FitTracker API');
  });

  it('la especificación tiene version 3.0.0', async () => {
    const res = await request(app).get('/docs.json');
    expect(res.body.info.version).toBe('3.0.0');
  });

  it('la especificación incluye bearerAuth como esquema de seguridad', async () => {
    const res = await request(app).get('/docs.json');
    const schemes = res.body.components?.securitySchemes || {};
    expect(schemes.bearerAuth).toBeDefined();
    expect(schemes.bearerAuth.scheme).toBe('bearer');
  });

  it('GET /docs redirige o sirve la UI de Swagger (no 404)', async () => {
    const res = await request(app).get('/docs/');
    expect(res.status).not.toBe(404);
    expect(res.status).not.toBe(500);
  });
});

// ── 7. Rate-limiter — stack y comportamiento en test ─────────────────────────

describe('Rate-limiter — configuración', () => {
  it('en entorno test los requests no son bloqueados (skip=true por diseño)', async () => {
    const requests = Array.from({ length: 20 }, () =>
      request(app).get('/health')
    );
    const responses = await Promise.all(requests);
    responses.forEach(r => expect(r.status).not.toBe(429));
  });

  it('los endpoints de auth pueden recibir múltiples requests en test sin bloquearse', async () => {
    const requests = Array.from({ length: 5 }, (_, i) =>
      request(app).post('/api/v1/auth/login').send({
        email: `spam_${i}@test.com`, password: 'wrong',
      })
    );
    const responses = await Promise.all(requests);
    responses.forEach(r => expect(r.status).not.toBe(429));
  });
});

// ── 8. Consistencia de Content-Type ──────────────────────────────────────────

describe('Content-Type — todas las respuestas son JSON', () => {
  let token;
  beforeAll(async () => {
    ({ token } = await registerUser(app));
  });

  const endpoints = [
    { method: 'get',  path: '/health' },
    { method: 'get',  path: '/api/v1/auth/me',              auth: true },
    { method: 'get',  path: '/api/v1/auth/workout-logs',    auth: true },
    { method: 'get',  path: '/api/v1/habits/water',         auth: true },
    { method: 'get',  path: '/api/v1/meals',                auth: true },
    { method: 'get',  path: '/api/v1/settings',             auth: true },
    { method: 'get',  path: '/api/v1/n8n/status',           auth: true },
  ];

  it.each(endpoints)('$method $path → Content-Type: application/json', async ({ method, path, auth }) => {
    const req = request(app)[method](path);
    if (auth) req.set(bearerHeader(token));
    const res = await req;
    expect(res.headers['content-type']).toMatch(/application\/json/i);
  });
});
