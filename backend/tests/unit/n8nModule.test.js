'use strict';

/**
 * UNIT — src/routes/v1/n8n.js (carga del módulo)
 *
 * Cubre las validaciones que ocurren al importar el módulo:
 *  1. NODE_ENV=production + sin N8N_SECRET → lanza Error (líneas 13-14)
 *  2. NODE_ENV=development + sin N8N_SECRET → console.warn (líneas 16-17)
 *
 * Estas ramas no pueden cubrirse desde tests de integración porque todos
 * los tests de n8n configuran N8N_SECRET en beforeAll antes de require(app).
 */

// Mocks de las dependencias del router (se re-aplican en cada beforeEach tras resetModules)
function applyDependencyMocks() {
  jest.mock('../../src/db/postgres', () => ({
    query: jest.fn().mockResolvedValue({ rows: [] }),
    pool:  { connect: jest.fn() },
  }));
  jest.mock('../../src/routes/v1/auth', () => ({
    requireAuth: (_req, _res, next) => next(),
  }));
  jest.mock('../../src/utils/asyncHandler', () => fn => (req, res, next) => fn(req, res, next));
}

let savedNodeEnv, savedN8nSecret;

beforeEach(() => {
  savedNodeEnv   = process.env.NODE_ENV;
  savedN8nSecret = process.env.N8N_SECRET;
  jest.resetModules();
  applyDependencyMocks();
});

afterEach(() => {
  process.env.NODE_ENV = savedNodeEnv;
  if (savedN8nSecret !== undefined) process.env.N8N_SECRET = savedN8nSecret;
  else delete process.env.N8N_SECRET;
});

// ── 1. Producción sin N8N_SECRET ──────────────────────────────────────────────

describe('n8n.js — producción sin N8N_SECRET', () => {
  it('lanza Error al importar el módulo', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.N8N_SECRET;

    expect(() => require('../../src/routes/v1/n8n'))
      .toThrow(/N8N_SECRET.*obligatorio/i);
  });
});

// ── 2. Desarrollo sin N8N_SECRET ──────────────────────────────────────────────

describe('n8n.js — desarrollo sin N8N_SECRET', () => {
  it('emite console.warn sin lanzar error', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.N8N_SECRET;

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => require('../../src/routes/v1/n8n')).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('N8N_SECRET'));
    warn.mockRestore();
  });
});
