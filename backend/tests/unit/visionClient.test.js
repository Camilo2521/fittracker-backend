'use strict';

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock('../../src/utils/internalToken', () => ({
  generateInternalToken: () => 'test-token',
}));

const visionClient = require('../../src/services/visionClient');

beforeEach(() => {
  mockFetch.mockReset();
});

// ── createSession() ───────────────────────────────────────────────────────────

describe('createSession()', () => {
  it('devuelve datos cuando el servicio Python responde ok', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ session_id: 'sess-abc' }),
    });
    const result = await visionClient.createSession('user1', 'squat');
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ session_id: 'sess-abc' });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/vision/sessions'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('devuelve ok:false con status cuando el servidor responde con error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ error: 'Invalid exercise type' }),
    });
    const result = await visionClient.createSession('user1', '???');
    expect(result.ok).toBe(false);
    expect(result.status).toBe(422);
  });

  it('devuelve fallback cuando fetch lanza AbortError (timeout)', async () => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    mockFetch.mockRejectedValueOnce(err);
    const result = await visionClient.createSession('user1', 'squat');
    expect(result.ok).toBe(false);
    expect(result.fallback).toBe(true);
  });

  it('devuelve fallback cuando fetch lanza error de red', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await visionClient.createSession('user1', 'pushup');
    expect(result.ok).toBe(false);
    expect(result.fallback).toBe(true);
    expect(result.error).toMatch(/ECONNREFUSED/);
  });
});

// ── completeSession() ─────────────────────────────────────────────────────────

describe('completeSession()', () => {
  it('devuelve datos cuando la respuesta es ok', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ reps: 10, quality: 'good' }),
    });
    const result = await visionClient.completeSession('sess-abc', { reps: 10 });
    expect(result.ok).toBe(true);
    expect(result.data.reps).toBe(10);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/vision/sessions/sess-abc/complete'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('devuelve fallback ante error de red', async () => {
    mockFetch.mockRejectedValueOnce(new Error('timeout'));
    const result = await visionClient.completeSession('sess-abc', {});
    expect(result.fallback).toBe(true);
  });
});

// ── getSession() ──────────────────────────────────────────────────────────────

describe('getSession()', () => {
  it('devuelve la sesión con sus datos', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ session_id: 'sess-abc', status: 'completed', reps: 12 }),
    });
    const result = await visionClient.getSession('sess-abc');
    expect(result.ok).toBe(true);
    expect(result.data.session_id).toBe('sess-abc');
    expect(result.data.reps).toBe(12);
  });

  it('devuelve ok:false para sesión inexistente (404)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: 'not found' }),
    });
    const result = await visionClient.getSession('no-existe');
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });
});

// ── generateDietPdf() ─────────────────────────────────────────────────────────

describe('generateDietPdf()', () => {
  it('devuelve Buffer con el PDF cuando la respuesta es ok', async () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => pdfBytes.buffer,
    });
    const result = await visionClient.generateDietPdf({ plan: 'test' }, 'Ana García');
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result[0]).toBe(0x25);
  });

  it('devuelve null cuando la respuesta no es ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const result = await visionClient.generateDietPdf({}, 'Usuario');
    expect(result).toBeNull();
  });

  it('devuelve null cuando fetch lanza error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('connection refused'));
    const result = await visionClient.generateDietPdf({}, 'Usuario');
    expect(result).toBeNull();
  });

  it('usa "Usuario" como nombre por defecto si no se pasa', async () => {
    const fakeBytes = new Uint8Array([1, 2, 3]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => fakeBytes.buffer,
    });
    await visionClient.generateDietPdf({ plan: 'x' });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.user_name).toBe('Usuario');
  });
});

// ── generateDiet() ────────────────────────────────────────────────────────────

describe('generateDiet()', () => {
  it('devuelve el plan cuando la respuesta es ok', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ plan: { dias: [] }, source: 'rag' }),
    });
    const result = await visionClient.generateDiet({ goal: 'lose', weight: 70 }, '2024-01-01');
    expect(result.ok).toBe(true);
    expect(result.data).toHaveProperty('plan');
  });

  it('envía el weekStart y el perfil del usuario al endpoint /rag/diet', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });
    await visionClient.generateDiet({ goal: 'gain', weight: 80 }, '2024-06-03');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/rag/diet'),
      expect.objectContaining({ method: 'POST' })
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.week_start).toBe('2024-06-03');
    expect(body.user_profile.goal).toBe('gain');
  });

  it('devuelve fallback ante error de red', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await visionClient.generateDiet({}, '2024-01-01');
    expect(result.fallback).toBe(true);
  });
});

// ── generateRoutine() ─────────────────────────────────────────────────────────

describe('generateRoutine()', () => {
  it('devuelve la rutina cuando la respuesta es ok', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ routine: { days: [], source: 'rag' } }),
    });
    const result = await visionClient.generateRoutine({ goal: 'maintain' });
    expect(result.ok).toBe(true);
    expect(result.data).toHaveProperty('routine');
  });

  it('envía el perfil del usuario al endpoint /rag/routine', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });
    await visionClient.generateRoutine({ goal: 'lose', weight: 65, activity_level: 'moderate' });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/rag/routine'),
      expect.objectContaining({ method: 'POST' })
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.user_profile.goal).toBe('lose');
  });

  it('devuelve fallback cuando el servicio Python no está disponible', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await visionClient.generateRoutine({ goal: 'lose' });
    expect(result.ok).toBe(false);
    expect(result.fallback).toBe(true);
  });
});

// ── Headers internos ──────────────────────────────────────────────────────────

describe('Headers de autenticación interna', () => {
  it('incluye x-internal-token en todas las peticiones', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    await visionClient.createSession('u1', 'squat');
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['x-internal-token']).toBe('test-token');
  });

  it('incluye Content-Type: application/json', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    await visionClient.getSession('sess-1');
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['Content-Type']).toBe('application/json');
  });
});
