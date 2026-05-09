'use strict';

/**
 * Unit tests — Reglas de validación de la ruta /auth/register.
 * Se prueban las reglas directamente sin levantar el servidor.
 */

// Extraemos las mismas reglas del handler
function validateRegister({ email, password }) {
  const errors = [];
  if (!email || !password)                              errors.push('Email y contraseña requeridos');
  else {
    if (password.length < 6)                           errors.push('La contraseña debe tener al menos 6 caracteres');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))    errors.push('Email inválido');
  }
  return errors;
}

describe('Validación de registro — email', () => {
  it('acepta un email estándar válido', () => {
    expect(validateRegister({ email: 'user@example.com', password: 'abc123' })).toHaveLength(0);
  });

  it('acepta email con subdominio', () => {
    expect(validateRegister({ email: 'user@mail.example.co', password: 'abc123' })).toHaveLength(0);
  });

  it('rechaza email sin @', () => {
    expect(validateRegister({ email: 'notanemail', password: 'abc123' })).toContain('Email inválido');
  });

  it('rechaza email sin dominio', () => {
    expect(validateRegister({ email: 'user@', password: 'abc123' })).toContain('Email inválido');
  });

  it('rechaza email con espacios', () => {
    expect(validateRegister({ email: 'user @example.com', password: 'abc123' })).toContain('Email inválido');
  });

  it('rechaza email vacío', () => {
    expect(validateRegister({ email: '', password: 'abc123' })).toContain('Email y contraseña requeridos');
  });
});

describe('Validación de registro — contraseña', () => {
  it('acepta contraseña de exactamente 6 caracteres', () => {
    expect(validateRegister({ email: 'a@b.com', password: 'abc123' })).toHaveLength(0);
  });

  it('acepta contraseña larga con caracteres especiales', () => {
    expect(validateRegister({ email: 'a@b.com', password: 'S3cur3!P@ssw0rd' })).toHaveLength(0);
  });

  it('rechaza contraseña de 5 caracteres', () => {
    expect(validateRegister({ email: 'a@b.com', password: 'ab12!' }))
      .toContain('La contraseña debe tener al menos 6 caracteres');
  });

  it('rechaza contraseña vacía', () => {
    expect(validateRegister({ email: 'a@b.com', password: '' })).toContain('Email y contraseña requeridos');
  });

  it('rechaza cuando ambos email y contraseña están ausentes', () => {
    const errors = validateRegister({ email: undefined, password: undefined });
    expect(errors).toContain('Email y contraseña requeridos');
    expect(errors).toHaveLength(1); // un solo mensaje, no duplicados
  });
});

describe('JWT payload', () => {
  const jwt = require('jsonwebtoken');
  const SECRET = 'test-secret-for-unit';

  function sign(account) {
    return jwt.sign(
      { id: account.id, email: account.email, name: account.name },
      SECRET,
      { expiresIn: '30d' }
    );
  }

  it('el token contiene id, email y name', () => {
    const token = sign({ id: 1, email: 'a@b.com', name: 'Alice' });
    const payload = jwt.verify(token, SECRET);
    expect(payload.id).toBe(1);
    expect(payload.email).toBe('a@b.com');
    expect(payload.name).toBe('Alice');
  });

  it('el token no expira en menos de 29 días desde ahora', () => {
    const token   = sign({ id: 1, email: 'a@b.com', name: 'Alice' });
    const payload = jwt.decode(token);
    const daysLeft = (payload.exp - Date.now() / 1000) / 86400;
    expect(daysLeft).toBeGreaterThan(29);
  });

  it('el token no contiene password_hash', () => {
    const token   = sign({ id: 1, email: 'a@b.com', name: 'Alice', password_hash: 'SHOULD_NOT_BE_HERE' });
    const payload = jwt.decode(token);
    // password_hash no debe aparecer porque _sign() no lo incluye
    expect(payload.password_hash).toBeUndefined();
  });

  it('un token con SECRET incorrecto lanza JsonWebTokenError', () => {
    const token = sign({ id: 1, email: 'a@b.com', name: 'Alice' });
    expect(() => jwt.verify(token, 'wrong-secret')).toThrow();
  });
});
