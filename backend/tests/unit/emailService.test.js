'use strict';

/**
 * UNIT — services/emailService.js
 *
 * Cubre los tres caminos del servicio:
 *  1. Sin SMTP_HOST → dev mode (console.warn + preview link)
 *  2. Con SMTP_HOST → sendMail con éxito (messageId)
 *  3. Con SMTP_HOST → sendMail lanza excepción (propagación)
 *  4. Transporter en caché (_transporter singleton reutilizado)
 *  5. Variables de entorno opcionales: SMTP_SECURE, SMTP_FROM, FRONTEND_URL
 */

const nodemailer = require('nodemailer');

// Controlamos el transport mock sin afectar otros tests
let mockSendMail;
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: (...args) => mockSendMail(...args),
  })),
}));

// Snapshot de env antes de cada test
let savedEnv;
beforeEach(() => {
  savedEnv = { ...process.env };
  // Limpia variables SMTP para aislar cada test
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_SECURE;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.SMTP_FROM;
  delete process.env.FRONTEND_URL;
  // Fuerza recarga del módulo para resetear el singleton _transporter
  jest.resetModules();
  jest.mock('nodemailer', () => ({
    createTransport: jest.fn(() => ({
      sendMail: (...args) => mockSendMail(...args),
    })),
  }));
  mockSendMail = jest.fn();
});

afterEach(() => {
  // Restaura el entorno original
  Object.assign(process.env, savedEnv);
  Object.keys(process.env).forEach(k => {
    if (!(k in savedEnv)) delete process.env[k];
  });
});

function loadService() {
  return require('../../src/services/emailService');
}

// ── 1. Sin SMTP_HOST — modo desarrollo ───────────────────────────────────────

describe('sendPasswordReset sin SMTP_HOST (modo desarrollo)', () => {
  it('devuelve { preview: resetLink } sin llamar a sendMail', async () => {
    const { sendPasswordReset } = loadService();
    const result = await sendPasswordReset('user@test.com', 'tok123');
    expect(result).toHaveProperty('preview');
    expect(result.preview).toMatch(/tok123/);
    expect(result.preview).toMatch(/reset-password/);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('usa FRONTEND_URL del entorno si está definida', async () => {
    process.env.FRONTEND_URL = 'https://app.fittracker.io';
    const { sendPasswordReset } = loadService();
    const result = await sendPasswordReset('x@test.com', 'abc');
    expect(result.preview).toMatch(/https:\/\/app\.fittracker\.io/);
  });

  it('usa http://localhost:5173 por defecto si no hay FRONTEND_URL', async () => {
    const { sendPasswordReset } = loadService();
    const result = await sendPasswordReset('x@test.com', 'abc');
    expect(result.preview).toMatch(/localhost:5173/);
  });

  it('emite console.warn con el link (sin throws)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { sendPasswordReset } = loadService();
    await sendPasswordReset('x@test.com', 'tok-dev');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('SMTP'));
    // Second warn call: console.warn('[email]', resetLink) — token in second arg
    expect(warn).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('tok-dev'));
    warn.mockRestore();
  });
});

// ── 2. Con SMTP_HOST — envío exitoso ──────────────────────────────────────────

describe('sendPasswordReset con SMTP_HOST configurado', () => {
  beforeEach(() => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '465';
    process.env.SMTP_SECURE = 'true';
    process.env.SMTP_USER = 'fit@example.com';
    process.env.SMTP_PASS = 'secret';
    process.env.SMTP_FROM = 'FitTracker <fit@example.com>';
    process.env.FRONTEND_URL = 'https://myapp.com';
  });

  it('llama a sendMail y devuelve { messageId }', async () => {
    mockSendMail.mockResolvedValue({ messageId: '<msg-001@smtp.example.com>' });
    const { sendPasswordReset } = loadService();
    const result = await sendPasswordReset('dest@test.com', 'reset-token-xyz');
    expect(result).toEqual({ messageId: '<msg-001@smtp.example.com>' });
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });

  it('el mail enviado incluye el token en el enlace', async () => {
    mockSendMail.mockResolvedValue({ messageId: 'id' });
    const { sendPasswordReset } = loadService();
    await sendPasswordReset('dest@test.com', 'TOKEN_UNICO');
    const opts = mockSendMail.mock.calls[0][0];
    expect(opts.html).toMatch(/TOKEN_UNICO/);
    expect(opts.text).toMatch(/TOKEN_UNICO/);
    expect(opts.to).toBe('dest@test.com');
    expect(opts.subject).toMatch(/contraseña/i);
  });

  it('usa SMTP_FROM como campo from', async () => {
    mockSendMail.mockResolvedValue({ messageId: 'id' });
    const { sendPasswordReset } = loadService();
    await sendPasswordReset('dest@test.com', 'tok');
    const opts = mockSendMail.mock.calls[0][0];
    expect(opts.from).toBe('FitTracker <fit@example.com>');
  });

  it('usa SMTP_USER como from si no hay SMTP_FROM', async () => {
    delete process.env.SMTP_FROM;
    mockSendMail.mockResolvedValue({ messageId: 'id' });
    const { sendPasswordReset } = loadService();
    await sendPasswordReset('dest@test.com', 'tok');
    const opts = mockSendMail.mock.calls[0][0];
    expect(opts.from).toBe('fit@example.com');
  });

  it('usa noreply@fittracker.app si no hay SMTP_FROM ni SMTP_USER', async () => {
    delete process.env.SMTP_FROM;
    delete process.env.SMTP_USER;
    mockSendMail.mockResolvedValue({ messageId: 'id' });
    const { sendPasswordReset } = loadService();
    await sendPasswordReset('dest@test.com', 'tok');
    const opts = mockSendMail.mock.calls[0][0];
    expect(opts.from).toBe('noreply@fittracker.app');
  });

  it('nodemailer.createTransport recibe secure:true cuando SMTP_SECURE=true', async () => {
    mockSendMail.mockResolvedValue({ messageId: 'id' });
    const { sendPasswordReset } = loadService();
    await sendPasswordReset('dest@test.com', 'tok');
    const nodemailerMock = require('nodemailer');
    const createArgs = nodemailerMock.createTransport.mock.calls[0][0];
    expect(createArgs.secure).toBe(true);
    expect(createArgs.port).toBe(465);
  });
});

// ── 3. Con SMTP_HOST — sendMail falla ────────────────────────────────────────

describe('sendPasswordReset con SMTP_HOST — fallo de envío', () => {
  beforeEach(() => {
    process.env.SMTP_HOST = 'smtp.broken.com';
  });

  it('propaga la excepción de sendMail al caller', async () => {
    mockSendMail.mockRejectedValue(new Error('Connection timed out'));
    const { sendPasswordReset } = loadService();
    await expect(sendPasswordReset('dest@test.com', 'tok'))
      .rejects.toThrow('Connection timed out');
  });
});

// ── 4. Singleton _transporter ─────────────────────────────────────────────────

describe('_getTransporter — singleton', () => {
  it('crea el transporter solo una vez para múltiples llamadas', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    mockSendMail.mockResolvedValue({ messageId: 'id1' });
    const { sendPasswordReset } = loadService();
    await sendPasswordReset('a@test.com', 't1');
    await sendPasswordReset('b@test.com', 't2');
    const nodemailerMock = require('nodemailer');
    // createTransport solo se llama una vez gracias al caché
    expect(nodemailerMock.createTransport).toHaveBeenCalledTimes(1);
  });
});
