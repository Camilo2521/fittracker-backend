'use strict';

/**
 * Mock de la capa PostgreSQL. Todos los tests usan SQLite :memory: como
 * fuente de verdad; Postgres es opcional y se simula aquí.
 */
const mockPg = {
  query:       jest.fn().mockResolvedValue({ rows: [] }),
  healthCheck: jest.fn().mockResolvedValue('unavailable'),
};

function resetMocks() {
  mockPg.query.mockReset();
  mockPg.query.mockResolvedValue({ rows: [] });
  mockPg.healthCheck.mockResolvedValue('unavailable');
}

module.exports = { mockPg, resetMocks };
