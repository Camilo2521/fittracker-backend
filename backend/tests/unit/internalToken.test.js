'use strict';

describe('generateInternalToken()', () => {
  afterEach(() => {
    jest.resetModules();
    delete process.env.INTERNAL_API_SECRET;
    process.env.NODE_ENV = 'test';
  });

  it('devuelve formato {ts}.dev_unsigned cuando no hay secret', () => {
    jest.isolateModules(() => {
      delete process.env.INTERNAL_API_SECRET;
      const { generateInternalToken } = require('../../src/utils/internalToken');
      const token = generateInternalToken();
      expect(token).toMatch(/^\d+\.dev_unsigned$/);
    });
  });

  it('el timestamp del token está dentro de ±5 s del tiempo actual', () => {
    jest.isolateModules(() => {
      delete process.env.INTERNAL_API_SECRET;
      const { generateInternalToken } = require('../../src/utils/internalToken');
      const token = generateInternalToken();
      const ts  = parseInt(token.split('.')[0], 10);
      const now = Math.floor(Date.now() / 1000);
      expect(Math.abs(ts - now)).toBeLessThanOrEqual(5);
    });
  });

  it('devuelve token HMAC-SHA256 cuando el secret está configurado', () => {
    jest.isolateModules(() => {
      process.env.INTERNAL_API_SECRET = 'test-secret-for-hmac-32bytes-abc';
      const { generateInternalToken } = require('../../src/utils/internalToken');
      const token = generateInternalToken();
      // Formato esperado: {unix_ts}.{64-char hex}
      expect(token).toMatch(/^\d+\.[0-9a-f]{64}$/);
    });
  });

  it('el token HMAC NO contiene "dev_unsigned"', () => {
    jest.isolateModules(() => {
      process.env.INTERNAL_API_SECRET = 'super-secret-value-for-testing-x';
      const { generateInternalToken } = require('../../src/utils/internalToken');
      const token = generateInternalToken();
      expect(token).not.toContain('dev_unsigned');
    });
  });

  it('dos tokens generados consecutivamente tienen timestamps iguales o crecientes', () => {
    jest.isolateModules(() => {
      process.env.INTERNAL_API_SECRET = 'another-secret-32bytes-for-test!';
      const { generateInternalToken } = require('../../src/utils/internalToken');
      const t1 = parseInt(generateInternalToken().split('.')[0], 10);
      const t2 = parseInt(generateInternalToken().split('.')[0], 10);
      expect(t2).toBeGreaterThanOrEqual(t1);
    });
  });

  it('lanza error al cargar el módulo en producción sin secret', () => {
    jest.isolateModules(() => {
      delete process.env.INTERNAL_API_SECRET;
      process.env.NODE_ENV = 'production';
      expect(() => require('../../src/utils/internalToken')).toThrow('INTERNAL_API_SECRET');
    });
  });

  it('emite advertencia en desarrollo cuando no hay secret configurado', () => {
    jest.isolateModules(() => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      delete process.env.INTERNAL_API_SECRET;
      process.env.NODE_ENV = 'development';
      require('../../src/utils/internalToken');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('INTERNAL_API_SECRET'));
      warnSpy.mockRestore();
    });
  });
});
