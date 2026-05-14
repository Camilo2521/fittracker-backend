'use strict';

/**
 * UNIT — src/db/migrate.js
 *
 * Cubre los caminos no alcanzados por los tests de integración:
 *  1. Sin DATABASE_URL/PG_CONNECTION_STRING → salida temprana
 *  2. Directorio de migraciones no encontrado → warn + return
 *  3. _migracionesExiste = true en getApplied → usa _migraciones (post-005)
 *  4. _legacyMigrationsExiste = true → usa _migrations (pre-005)
 *  5. Instalación nueva → getApplied devuelve []
 *  6. count > 0 → imprime resumen de migraciones
 *  7. applyMigration inserta en _migraciones cuando existe
 *  8. applyMigration inserta en _migrations cuando solo legacy existe
 *  9. Error en SQL → ROLLBACK + re-lanza
 *
 * Usa jest.doMock (no hoisted) para poder referenciar variables de ámbito externo.
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

let mockClient; // asignado en cada buildAndRegisterPgMock

/**
 * Construye mockClient y registra el mock de postgres via jest.doMock.
 * Debe llamarse DESPUÉS de jest.resetModules() y ANTES de require migrate.js.
 */
function mockBuildAndRegisterPg({ migraciones = null, legacy = null, sqlError = null } = {}) {
  mockClient = {
    query: jest.fn().mockImplementation(async (sql) => {
      const s = (sql || '').trim().toUpperCase();
      if (s.includes("TO_REGCLASS('PUBLIC._MIGRACIONES')")) return { rows: [{ t: migraciones }] };
      if (s.includes("TO_REGCLASS('PUBLIC._MIGRATIONS')"))  return { rows: [{ t: legacy }] };
      if (s.startsWith('SELECT ARCHIVO FROM _MIGRACIONES'))  return { rows: [] };
      if (s.startsWith('SELECT FILENAME FROM _MIGRATIONS'))  return { rows: [] };
      if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };
      if (s.startsWith('INSERT INTO _MIGRACIONES') || s.startsWith('INSERT INTO _MIGRATIONS')) {
        return { rows: [], rowCount: 1 };
      }
      if (sqlError) throw sqlError;
      return { rows: [], rowCount: 0 };
    }),
    release: jest.fn(),
  };
  jest.doMock('../../src/db/postgres', () => ({
    pool: { connect: jest.fn().mockResolvedValue(mockClient) },
  }));
}

function mockBuildFs({ exists = true, files = [], readContent = 'SELECT 1;' } = {}) {
  const realFs = jest.requireActual('fs');
  jest.doMock('fs', () => ({
    ...realFs,
    existsSync:   jest.fn().mockReturnValue(exists),
    readdirSync:  jest.fn().mockReturnValue(files),
    readFileSync: jest.fn().mockReturnValue(readContent),
  }));
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let savedDBUrl, savedPGConn;

beforeEach(() => {
  jest.resetModules();
  savedDBUrl  = process.env.DATABASE_URL;
  savedPGConn = process.env.PG_CONNECTION_STRING;
});

afterEach(() => {
  if (savedDBUrl  !== undefined) process.env.DATABASE_URL          = savedDBUrl;
  else                           delete process.env.DATABASE_URL;
  if (savedPGConn !== undefined) process.env.PG_CONNECTION_STRING  = savedPGConn;
  else                           delete process.env.PG_CONNECTION_STRING;
});

// ── 1. Sin configuración de base de datos ─────────────────────────────────────

describe('runMigrations — sin DATABASE_URL ni PG_CONNECTION_STRING', () => {
  it('retorna sin conectar a la base de datos', async () => {
    delete process.env.DATABASE_URL;
    delete process.env.PG_CONNECTION_STRING;
    mockBuildAndRegisterPg();
    mockBuildFs();

    const { runMigrations } = require('../../src/db/migrate');
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runMigrations();

    expect(log).toHaveBeenCalledWith(expect.stringContaining('Sin DATABASE_URL'));
    expect(mockClient.query).not.toHaveBeenCalled();
    log.mockRestore();
  });
});

// ── 2. Directorio de migraciones no encontrado ────────────────────────────────

describe('runMigrations — directorio de migraciones inexistente', () => {
  beforeEach(() => { process.env.DATABASE_URL = 'postgresql://test'; });

  it('emite console.warn y retorna sin aplicar nada', async () => {
    mockBuildAndRegisterPg({ migraciones: '_migraciones' });
    mockBuildFs({ exists: false });

    const { runMigrations } = require('../../src/db/migrate');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await runMigrations();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('migraciones'),
      expect.any(String),
    );
    warn.mockRestore();
  });
});

// ── 3. _migraciones existe → path post-005 ───────────────────────────────────

describe('runMigrations — _migraciones existe (instancia post-005)', () => {
  beforeEach(() => { process.env.DATABASE_URL = 'postgresql://test'; });

  it('lee de _migraciones (columna "archivo")', async () => {
    mockBuildAndRegisterPg({ migraciones: '_migraciones' });
    mockBuildFs({ files: [] });

    const { runMigrations } = require('../../src/db/migrate');
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runMigrations();

    const calls = mockClient.query.mock.calls.map(c => (c[0] || '').trim().toUpperCase());
    expect(calls.some(q => q.startsWith('SELECT ARCHIVO FROM _MIGRACIONES'))).toBe(true);
    expect(calls.some(q => q.includes('CREATE TABLE'))).toBe(false);
    log.mockRestore();
  });

  it('count > 0 → imprime resumen de migraciones aplicadas', async () => {
    mockBuildAndRegisterPg({ migraciones: '_migraciones' });
    mockBuildFs({ files: ['001_test.sql'] });

    const { runMigrations } = require('../../src/db/migrate');
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runMigrations();

    expect(log).toHaveBeenCalledWith(expect.stringContaining('migración(es) aplicada(s)'));
    log.mockRestore();
  });

  it('applyMigration inserta en _migraciones (columna archivo)', async () => {
    mockBuildAndRegisterPg({ migraciones: '_migraciones' });
    mockBuildFs({ files: ['006_test.sql'] });

    const { runMigrations } = require('../../src/db/migrate');
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runMigrations();

    const inserts = mockClient.query.mock.calls
      .map(c => (c[0] || '').trim().toUpperCase())
      .filter(q => q.startsWith('INSERT INTO _MIGRACIONES'));
    expect(inserts.length).toBeGreaterThan(0);
    log.mockRestore();
  });
});

// ── 4. Solo _migrations legacy existe (pre-005) ───────────────────────────────

describe('runMigrations — solo tabla legacy _migrations existe', () => {
  beforeEach(() => { process.env.DATABASE_URL = 'postgresql://test'; });

  it('lee de _migrations (columna "filename")', async () => {
    mockBuildAndRegisterPg({ legacy: '_migrations' });
    mockBuildFs({ files: [] });

    const { runMigrations } = require('../../src/db/migrate');
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runMigrations();

    const calls = mockClient.query.mock.calls.map(c => (c[0] || '').trim().toUpperCase());
    expect(calls.some(q => q.startsWith('SELECT FILENAME FROM _MIGRATIONS'))).toBe(true);
    log.mockRestore();
  });

  it('applyMigration inserta en _migrations (columna filename)', async () => {
    mockBuildAndRegisterPg({ legacy: '_migrations' });
    mockBuildFs({ files: ['003_test.sql'] });

    const { runMigrations } = require('../../src/db/migrate');
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runMigrations();

    const inserts = mockClient.query.mock.calls
      .map(c => (c[0] || '').trim().toUpperCase())
      .filter(q => q.startsWith('INSERT INTO _MIGRATIONS'));
    expect(inserts.length).toBeGreaterThan(0);
    log.mockRestore();
  });
});

// ── 5. Instalación nueva — ninguna tabla existe ───────────────────────────────

describe('runMigrations — instalación nueva (sin tabla de tracking)', () => {
  beforeEach(() => { process.env.DATABASE_URL = 'postgresql://test'; });

  it('getApplied devuelve [] y el proceso no lanza error', async () => {
    mockBuildAndRegisterPg(); // migraciones=null, legacy=null
    mockBuildFs({ files: [] });

    const { runMigrations } = require('../../src/db/migrate');
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});

    await expect(runMigrations()).resolves.toBeUndefined();
    log.mockRestore();
  });
});

// ── 6. Error en SQL → ROLLBACK + re-lanza ────────────────────────────────────

describe('applyMigration — error durante ejecución del SQL', () => {
  beforeEach(() => { process.env.DATABASE_URL = 'postgresql://test'; });

  it('hace ROLLBACK y runMigrations propaga el error', async () => {
    const sqlErr = new Error('duplicate key value');

    mockBuildAndRegisterPg({ migraciones: '_migraciones', sqlError: sqlErr });
    mockBuildFs({ files: ['001_broken.sql'] });

    const { runMigrations } = require('../../src/db/migrate');
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(runMigrations()).rejects.toThrow('duplicate key value');

    const calls = mockClient.query.mock.calls.map(c => (c[0] || '').trim().toUpperCase());
    expect(calls).toContain('ROLLBACK');
    errSpy.mockRestore();
  });
});
