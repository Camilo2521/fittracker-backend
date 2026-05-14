'use strict';

const mockFetch = jest.fn();
global.fetch = mockFetch;

let svc;

beforeEach(() => {
  mockFetch.mockReset();
  jest.resetModules();
  svc = require('../../src/services/ollamaService');
});

// ── isAvailable() ─────────────────────────────────────────────────────────────

describe('isAvailable()', () => {
  it('devuelve true cuando Ollama responde ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    expect(await svc.isAvailable()).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/tags'),
      expect.any(Object)
    );
  });

  it('devuelve false cuando la respuesta no es ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });
    expect(await svc.isAvailable()).toBe(false);
  });

  it('devuelve false cuando fetch lanza error de red', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await svc.isAvailable()).toBe(false);
  });
});

// ── chat() ────────────────────────────────────────────────────────────────────

describe('chat()', () => {
  it('devuelve el contenido del mensaje cuando la respuesta es ok', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: { content: 'Hola, soy FitBot' } }),
    });
    const result = await svc.chat([{ role: 'user', content: 'Hola' }], 'Eres un coach');
    expect(result).toBe('Hola, soy FitBot');
  });

  it('devuelve string vacío si message.content es undefined', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: {} }),
    });
    expect(await svc.chat([], 'prompt')).toBe('');
  });

  it('lanza error cuando la respuesta no es ok', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });
    await expect(svc.chat([], 'prompt')).rejects.toThrow('Ollama 500');
  });

  it('inserta el systemPrompt como primer mensaje (role: system)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: { content: 'ok' } }),
    });
    await svc.chat([{ role: 'user', content: 'pregunta' }], 'mi-system-prompt');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'mi-system-prompt' });
    expect(body.stream).toBe(false);
  });

  it('incluye las opciones de temperatura y top_p', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: { content: '' } }),
    });
    await svc.chat([], 'p');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.options).toMatchObject({ temperature: 0.72, top_p: 0.9 });
  });
});

// ── listModels() ──────────────────────────────────────────────────────────────

describe('listModels()', () => {
  it('devuelve array de nombres de modelos', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [{ name: 'llama3.2' }, { name: 'mistral' }] }),
    });
    expect(await svc.listModels()).toEqual(['llama3.2', 'mistral']);
  });

  it('devuelve [] cuando models está ausente en la respuesta', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    expect(await svc.listModels()).toEqual([]);
  });

  it('devuelve [] cuando la respuesta no es ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });
    expect(await svc.listModels()).toEqual([]);
  });

  it('devuelve [] cuando fetch lanza error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('timeout'));
    expect(await svc.listModels()).toEqual([]);
  });
});

// ── getModel() ────────────────────────────────────────────────────────────────

describe('getModel()', () => {
  it('devuelve "llama3.2" como modelo por defecto', () => {
    delete process.env.OLLAMA_MODEL;
    jest.resetModules();
    const freshSvc = require('../../src/services/ollamaService');
    expect(freshSvc.getModel()).toBe('llama3.2');
  });

  it('devuelve el valor de OLLAMA_MODEL cuando está configurado', () => {
    process.env.OLLAMA_MODEL = 'gemma2';
    jest.resetModules();
    const freshSvc = require('../../src/services/ollamaService');
    expect(freshSvc.getModel()).toBe('gemma2');
    delete process.env.OLLAMA_MODEL;
  });
});

// ── chatStream() ──────────────────────────────────────────────────────────────

describe('chatStream()', () => {
  it('lanza error cuando la respuesta no es ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });
    const stream = svc.chatStream([], 'prompt');
    await expect(stream.next()).rejects.toThrow('Ollama stream 503');
  });

  it('emite fragmentos de contenido y termina al recibir done:true', async () => {
    const lines = [
      JSON.stringify({ message: { content: 'Hola ' } }),
      JSON.stringify({ message: { content: 'mundo' } }),
      JSON.stringify({ done: true }),
    ].join('\n') + '\n';

    const encoder = new TextEncoder();
    const bytes   = encoder.encode(lines);
    let called = false;
    const mockReader = {
      read: jest.fn().mockImplementation(async () => {
        if (!called) { called = true; return { done: false, value: bytes }; }
        return { done: true, value: undefined };
      }),
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: { getReader: () => mockReader },
    });

    const tokens = [];
    for await (const tok of svc.chatStream([], 'prompt')) {
      tokens.push(tok);
    }
    expect(tokens).toEqual(['Hola ', 'mundo']);
  });

  it('ignora líneas JSON malformadas sin lanzar error', async () => {
    const lines = 'not-json\n' + JSON.stringify({ message: { content: 'ok' } }) + '\n';
    const encoder = new TextEncoder();
    const bytes   = encoder.encode(lines);
    let called = false;
    const mockReader = {
      read: jest.fn().mockImplementation(async () => {
        if (!called) { called = true; return { done: false, value: bytes }; }
        return { done: true, value: undefined };
      }),
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: { getReader: () => mockReader },
    });

    const tokens = [];
    for await (const tok of svc.chatStream([], 'p')) {
      tokens.push(tok);
    }
    expect(tokens).toEqual(['ok']);
  });
});
