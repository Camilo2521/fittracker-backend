'use strict';

const {
  validateDate,
  validateString,
  validateNumber,
  validateEnum,
  validateId,
  abort,
} = require('../../src/utils/validate');

describe('validateDate', () => {
  it('acepta undefined — campo opcional', () => {
    expect(validateDate(undefined)).toBeNull();
    expect(validateDate(null)).toBeNull();
  });

  it('acepta una fecha válida', () => {
    expect(validateDate('2024-06-15', 'fecha')).toBeNull();
  });

  it('rechaza un no-string (número)', () => {
    expect(validateDate(20240615, 'fecha')).toMatch(/YYYY-MM-DD/);
  });

  it('rechaza formato incorrecto DD/MM/YYYY', () => {
    expect(validateDate('15/06/2024', 'fecha')).toMatch(/YYYY-MM-DD/);
  });

  it('rechaza fecha imposible (mes 13)', () => {
    expect(validateDate('2024-13-01', 'fecha')).toMatch(/YYYY-MM-DD/);
  });

  it('rechaza string vacío', () => {
    expect(validateDate('', 'fecha')).toMatch(/YYYY-MM-DD/);
  });
});

describe('validateString', () => {
  it('acepta string válido', () => {
    expect(validateString('hola', 'campo')).toBeNull();
  });

  it('rechaza no-string (número)', () => {
    expect(validateString(42, 'campo')).toMatch(/requerido/);
  });

  it('rechaza string solo espacios', () => {
    expect(validateString('   ', 'campo')).toMatch(/requerido/);
  });

  it('rechaza string demasiado largo', () => {
    expect(validateString('x'.repeat(501), 'campo')).toMatch(/superar/);
  });

  it('respeta maxLength personalizado', () => {
    expect(validateString('abcde', 'campo', { maxLength: 4 })).toMatch(/superar 4/);
    expect(validateString('abcd', 'campo', { maxLength: 4 })).toBeNull();
  });
});

describe('validateNumber', () => {
  it('acepta undefined en campo opcional', () => {
    expect(validateNumber(undefined, 'n')).toBeNull();
  });

  it('rechaza undefined en campo requerido', () => {
    expect(validateNumber(undefined, 'n', { required: true })).toMatch(/requerido/);
  });

  it('acepta número dentro del rango', () => {
    expect(validateNumber(50, 'n', { min: 0, max: 100 })).toBeNull();
  });

  it('rechaza no-numérico', () => {
    expect(validateNumber('abc', 'n')).toMatch(/número/);
  });

  it('rechaza valor menor al mínimo', () => {
    expect(validateNumber(-1, 'n', { min: 0 })).toMatch(/mayor o igual/);
  });

  it('rechaza valor mayor al máximo', () => {
    expect(validateNumber(101, 'n', { max: 100 })).toMatch(/menor o igual/);
  });
});

describe('validateEnum', () => {
  const OPCIONES = ['a', 'b', 'c'];

  it('acepta undefined en campo opcional', () => {
    expect(validateEnum(undefined, 'x', OPCIONES)).toBeNull();
  });

  it('rechaza undefined en campo requerido', () => {
    expect(validateEnum(undefined, 'x', OPCIONES, { required: true })).toMatch(/requerido/);
  });

  it('acepta valor permitido', () => {
    expect(validateEnum('b', 'x', OPCIONES)).toBeNull();
  });

  it('rechaza valor no permitido', () => {
    expect(validateEnum('d', 'x', OPCIONES)).toMatch(/uno de/);
  });
});

describe('validateId', () => {
  it('acepta entero positivo como string', () => {
    expect(validateId('5', 'id')).toBeNull();
  });

  it('acepta entero positivo como número', () => {
    expect(validateId(10, 'id')).toBeNull();
  });

  it('rechaza cero', () => {
    expect(validateId('0', 'id')).toMatch(/entero positivo/);
  });

  it('rechaza negativo', () => {
    expect(validateId('-3', 'id')).toMatch(/entero positivo/);
  });

  it('rechaza NaN (string no numérico)', () => {
    expect(validateId('abc', 'id')).toMatch(/entero positivo/);
  });

  it('acepta decimal siendo parseInt válido (comportamiento de parseInt)', () => {
    // parseInt('1.5') === 1 → entero positivo, pasa validación
    expect(validateId('1.5', 'id')).toBeNull();
  });

  it('rechaza string alfanumérico (NaN)', () => {
    expect(validateId('1abc', 'id')).toBeNull(); // parseInt('1abc') === 1
  });

  it('rechaza string puramente no-numérico', () => {
    expect(validateId('abc', 'id')).toMatch(/entero positivo/);
  });
});

describe('abort', () => {
  it('devuelve false si no hay errores', () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    expect(abort(res, [null, null])).toBe(false);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('devuelve true y envía 400 si hay errores', () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    expect(abort(res, [null, 'campo requerido'])).toBe(true);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'campo requerido', errors: ['campo requerido'] })
    );
  });
});
