'use strict';

const mockQuery = jest.fn();

jest.mock('../../src/db/postgres', () => ({
  query: (...args) => mockQuery(...args),
}));

const { runCleanup } = require('../../src/db/tokenCleanup');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('runCleanup', () => {
  it('no loguea cuando no hay tokens eliminados', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ tokens_refresco_eliminados: 0, tokens_recuperacion_eliminados: 0 }],
    });
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runCleanup();

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('loguea cuando se eliminan refresh tokens', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ tokens_refresco_eliminados: 3, tokens_recuperacion_eliminados: 0 }],
    });
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runCleanup();

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('3 refresh'));
    spy.mockRestore();
  });

  it('loguea cuando se eliminan tokens de recuperación', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ tokens_refresco_eliminados: 0, tokens_recuperacion_eliminados: 2 }],
    });
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runCleanup();

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('2 recuperación'));
    spy.mockRestore();
  });

  it('loguea con error si la query falla', async () => {
    mockQuery.mockRejectedValue(new Error('DB down'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await runCleanup();

    expect(spy).toHaveBeenCalledWith('[token-cleanup] error:', 'DB down');
    spy.mockRestore();
  });
});
