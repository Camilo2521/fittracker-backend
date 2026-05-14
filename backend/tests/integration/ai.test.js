'use strict';

/**
 * INTEGRATION — routes/v1/ai.js
 *
 * Cubre todos los branches no ejercidos:
 *  • /chat  → Ollama ok, Ollama error→fallback, local, intents, memoria
 *  • /chat/stream → SSE local, Ollama stream, errores
 *  • /ai/status, /ai/memory GET+DELETE, /body-scan
 *  • _extractMemories — todas las ramas regex
 *  • _saveMemories    — rama de error (ROLLBACK)
 *  • _buildSystemPrompt — bloque de métricas + bloque de memorias
 */

jest.mock('../../src/db/postgres', () => require('../helpers/mockPostgres').mockPg);
jest.mock('../../src/services/visionClient', () => require('../helpers/mockVision').mockVision);

const mockOllama = {
  isAvailable: jest.fn().mockResolvedValue(false),
  chat:        jest.fn(),
  chatStream:  jest.fn(),
  listModels:  jest.fn().mockResolvedValue([]),
  getModel:    () => 'llama3.2',
};
jest.mock('../../src/services/ollamaService', () => mockOllama);

const request = require('supertest');
const { mockPg, resetMocks } = require('../helpers/mockPostgres');
const { registerUser, bearerHeader } = require('../helpers/auth');

let app, token;

beforeAll(async () => {
  app = require('../../src/app');
  const r = await registerUser(app, { weight: 80, height: 175, age: 30, gender: 'male', goal: 'lose' });
  token = r.token;
});

afterEach(() => {
  jest.clearAllMocks();
  mockOllama.isAvailable.mockResolvedValue(false);
  mockOllama.listModels.mockResolvedValue([]);
});

afterAll(() => resetMocks());

// ── Helper ────────────────────────────────────────────────────────────────────
function chat(msg, profile = {}, extra = {}) {
  return request(app).post('/api/v1/ai/chat').send({
    messages:    [{ role: 'user', content: msg }],
    userProfile: profile,
    ...extra,
  });
}

// ── 1. Validación básica ──────────────────────────────────────────────────────

describe('POST /ai/chat — validación', () => {
  it('sin messages → 400', async () => {
    const res = await request(app).post('/api/v1/ai/chat').send({ messages: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/requerido/i);
  });

  it('sin body → 400', async () => {
    const res = await request(app).post('/api/v1/ai/chat').send({});
    expect(res.status).toBe(400);
  });
});

// ── 2. Local AI — todos los intents ──────────────────────────────────────────

describe('POST /ai/chat — modo local (Ollama no disponible)', () => {
  const profile = { name: 'Test', goal: 'lose', weight: 75, height: 170, age: 28, gender: 'male', activityLevel: 'moderate' };

  it('intent greet — saludo inicial', async () => {
    const res = await chat('hola buenas', profile);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('local');
    expect(res.body.content).toMatch(/FitBot|coach|objetivo/i);
  });

  it('intent routine — pide rutina de entrenamiento', async () => {
    const res = await chat('quiero una rutina de entrenamiento', profile);
    expect(res.status).toBe(200);
    expect(res.body.content).toMatch(/rutina|ROUTINE_PLAN/i);
  });

  it('intent cardio — pide plan de cardio', async () => {
    const res = await chat('necesito hacer cardio esta semana', profile);
    expect(res.status).toBe(200);
    expect(res.body.content).toBeTruthy();
  });

  it('intent diet — pide plan de dieta', async () => {
    const res = await chat('dame un plan de dieta semanal', profile);
    expect(res.status).toBe(200);
    expect(res.body.content).toMatch(/dieta|DIET_PLAN/i);
  });

  it('intent calories/bmi — pregunta por calorías', async () => {
    const res = await chat('cuántas calorías necesito al día', profile);
    expect(res.status).toBe(200);
    expect(res.body.content).toMatch(/TMB|TDEE|kcal/i);
  });

  it('intent bmi — pregunta por IMC', async () => {
    const res = await chat('cuál es mi IMC y si tengo sobrepeso', profile);
    expect(res.status).toBe(200);
    expect(res.body.content).toMatch(/IMC|métricas/i);
  });

  it('intent protein/supplement — proteínas y suplementos', async () => {
    const res = await chat('cuánta proteína necesito y qué suplementos tomar', profile);
    expect(res.status).toBe(200);
    expect(res.body.content).toMatch(/[Pp]roteína|g\/día/);
  });

  it('intent sleep — consejos de sueño', async () => {
    const res = await chat('tengo problemas para dormir y recuperarme', profile);
    expect(res.status).toBe(200);
    expect(res.body.content).toMatch(/sueño|suplemento/i);
  });

  it('intent hydration — hidratación', async () => {
    const res = await chat('cuánta agua debo beber al día', profile);
    expect(res.status).toBe(200);
    expect(res.body.content).toMatch(/L\/día|agua/i);
  });

  it('intent injury — lesión', async () => {
    const res = await chat('tengo lesión en la rodilla, el hombro me duele mucho', profile);
    expect(res.status).toBe(200);
    expect(res.body.content).toMatch(/médico|RICE|lesion/i);
  });

  it('intent motivation — motivación', async () => {
    const res = await chat('no puedo más, estoy cansado y difícil seguir', profile);
    expect(res.status).toBe(200);
    expect(res.body.content).toMatch(/hábito|motivaci/i);
  });

  it('intent progress — progreso', async () => {
    const res = await chat('no veo progreso, el peso no baja', profile);
    expect(res.status).toBe(200);
    expect(res.body.content).toMatch(/báscula|pésate|perímetros/i);
  });

  it('intent adjust — ajustar plan', async () => {
    const res = await chat('ajusta mi rutina, quiero menos carbohidratos', profile);
    expect(res.status).toBe(200);
    expect(res.body.content).toMatch(/ajustamos|Rutina|Dieta/i);
  });

  it('intent supplement (solo suplemento) — sin proteína', async () => {
    const res = await chat('qué vitaminas y omega-3 recomiendas', profile);
    expect(res.status).toBe(200);
    expect(res.body.content).toBeTruthy();
  });

  it('nombre detectado en mensaje — saludo personalizado', async () => {
    const res = await chat('Hola, me llamo Pedro', profile);
    expect(res.status).toBe(200);
    expect(res.body.content).toMatch(/Pedro/);
  });

  it('mejora de vida / bienestar general', async () => {
    const res = await chat('quiero mejorar mi estilo de vida y hábitos saludables', profile);
    expect(res.status).toBe(200);
    expect(res.body.content).toMatch(/fitness|consisten|hidrataci/i);
  });

  it('intent general sin historial previo → respuesta genérica', async () => {
    const res = await chat('algo que no encaja en ningún intent xyzzy', profile);
    expect(res.status).toBe(200);
    expect(res.body.content).toMatch(/FitBot|coach|rutina/i);
  });

  it('intent general CON historial previo → sugerencia contextual', async () => {
    const res = await request(app).post('/api/v1/ai/chat').send({
      messages: [
        { role: 'user',      content: 'primera pregunta' },
        { role: 'assistant', content: 'primera respuesta' },
        { role: 'user',      content: 'algo random xyz' },
      ],
      userProfile: profile,
    });
    expect(res.status).toBe(200);
    expect(res.body.content).toMatch(/Entiendo|Genera|rutina|dieta/i);
  });

  it('perfil sin nombre ni datos → respuesta con defaults', async () => {
    const res = await chat('hola', {});
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('local');
  });

  it('systemPrompt con métricas (w+h+a completos)', async () => {
    const res = await chat('cuántas calorías necesito', {
      weight: 80, height: 175, age: 30, gender: 'male', activityLevel: 'moderate', goal: 'lose',
    });
    expect(res.status).toBe(200);
    expect(res.body.content).toMatch(/TMB|TDEE|kcal/i);
  });

  it('systemPrompt sin métricas (perfil vacío)', async () => {
    const res = await chat('cuántas calorías', { goal: 'lose' });
    expect(res.status).toBe(200);
    expect(res.body.content).toBeTruthy();
  });
});

// ── 3. _extractMemories — todas las ramas ────────────────────────────────────

describe('Extracción automática de memoria desde el mensaje', () => {
  const profile = { id: 999, name: 'Test', goal: 'gain' };

  it('lesión detectada: "lesionado en el hombro"', async () => {
    const res = await chat('estoy lesionado en el hombro izquierdo', profile);
    expect(res.status).toBe(200);
  });

  it('dieta: soy vegetariano', async () => {
    const res = await chat('soy vegetariano, ¿qué dieta me das?', profile);
    expect(res.status).toBe(200);
  });

  it('dieta: soy vegano', async () => {
    const res = await chat('soy vegano desde hace 2 años', profile);
    expect(res.status).toBe(200);
  });

  it('intolerancia: sin lactosa', async () => {
    const res = await chat('soy intolerante a la lactosa', profile);
    expect(res.status).toBe(200);
  });

  it('intolerancia: sin gluten / celíaco', async () => {
    const res = await chat('soy celíaco, nada con gluten', profile);
    expect(res.status).toBe(200);
  });

  it('alergia: sin mariscos', async () => {
    const res = await chat('soy alérgico a los mariscos', profile);
    expect(res.status).toBe(200);
  });

  it('horario: entreno por las mañanas', async () => {
    const res = await chat('prefiero entrenar por las mañanas', profile);
    expect(res.status).toBe(200);
  });

  it('horario: entreno por las tardes', async () => {
    const res = await chat('entreno en la tarde siempre', profile);
    expect(res.status).toBe(200);
  });

  it('horario: entreno de noche', async () => {
    const res = await chat('entreno de noche después del trabajo', profile);
    expect(res.status).toBe(200);
  });

  it('equipamiento: sin equipo', async () => {
    const res = await chat('solo tengo peso corporal, sin equipo en casa', profile);
    expect(res.status).toBe(200);
  });

  it('equipamiento: gym completo', async () => {
    const res = await chat('tengo gym en casa con pesas y todo', profile);
    expect(res.status).toBe(200);
  });

  it('equipamiento: solo mancuernas', async () => {
    const res = await chat('solo tengo mancuernas en casa', profile);
    expect(res.status).toBe(200);
  });

  it('equipamiento: banda elástica', async () => {
    const res = await chat('tengo una banda elástica nada más', profile);
    expect(res.status).toBe(200);
  });

  it('preferencia: entrenos cortos', async () => {
    const res = await chat('tengo poco tiempo, quiero entrenos cortos y rápidos', profile);
    expect(res.status).toBe(200);
  });

  it('preferencia: entrenos largos', async () => {
    const res = await chat('tengo mucho tiempo y me gustan los entrenos de larga duración', profile);
    expect(res.status).toBe(200);
  });

  it('no le gusta ejercicio: "odio las sentadillas"', async () => {
    const res = await chat('odio las sentadillas, me molestan mucho', profile);
    expect(res.status).toBe(200);
  });

  it('meta: perder kg', async () => {
    const res = await chat('quiero perder 8 kg en 3 meses', profile);
    expect(res.status).toBe(200);
  });

  it('meta: ganar kg', async () => {
    const res = await chat('quiero ganar 5 kg de músculo', profile);
    expect(res.status).toBe(200);
  });

  it('solicitud de memoria explícita: "recuérdalo"', async () => {
    const res = await chat('mi color favorito es azul, recuérdalo', profile);
    expect(res.status).toBe(200);
  });
});

// ── 4. Ollama disponible — rama de éxito ─────────────────────────────────────

describe('POST /ai/chat — Ollama disponible', () => {
  beforeEach(() => {
    mockOllama.isAvailable.mockResolvedValue(true);
    mockOllama.chat.mockResolvedValue('Respuesta generada por Ollama.');
  });

  it('usa Ollama cuando está disponible', async () => {
    const res = await chat('dame una rutina', { goal: 'lose' });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('ollama');
    expect(res.body.model).toBe('llama3.2');
    expect(res.body.content).toBe('Respuesta generada por Ollama.');
  });

  it('Ollama disponible pero falla → fallback local', async () => {
    mockOllama.chat.mockRejectedValue(new Error('Connection refused'));
    const res = await chat('hola', { goal: 'lose', name: 'X' });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('local');
  });
});

// ── 5. Ollama con accountId y memorias almacenadas ────────────────────────────

describe('POST /ai/chat — con accountId y memorias', () => {
  it('con accountId válido persiste y carga memorias', async () => {
    // Primero guardamos una memoria via mensaje
    await chat('soy vegetariano y celíaco, recuérdalo', { id: 42, goal: 'maintain' });
    // Segunda petición carga el contexto
    const res = await chat('qué dieta me recomiendas', { id: 42, goal: 'maintain' });
    expect(res.status).toBe(200);
  });

  it('buildSystemPrompt inyecta bloque de memorias cuando existen', async () => {
    // Forzamos que el mock devuelva una memoria guardada
    mockPg.query.mockImplementationOnce(async () => ({
      rows: [
        { clave: 'dieta', valor: 'vegetariano/a' },
        { clave: 'lesion', valor: 'rodilla' },
      ],
    }));
    const res = await chat('dame consejo', { id: 43, goal: 'lose' });
    expect(res.status).toBe(200);
  });
});

// ── 6. _saveMemories — rama de error (ROLLBACK) ───────────────────────────────

describe('_saveMemories — error en transacción', () => {
  it('hace ROLLBACK cuando el INSERT falla y no lanza excepción al caller', async () => {
    const faultyClient = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] }) // BEGIN ok
        .mockRejectedValueOnce(new Error('DB constraint violation')), // INSERT falla
      release: jest.fn(),
    };
    mockPg.pool.connect.mockResolvedValueOnce(faultyClient);

    // El mensaje dispara _extractMemories → intenta _saveMemories que fallará internamente
    const res = await chat('soy vegetariano y celíaco', { id: 77, goal: 'maintain' });
    // Aunque _saveMemories falló, el chat continúa normalmente
    expect(res.status).toBe(200);
    expect(faultyClient.release).toHaveBeenCalled();
  });
});

// ── 7. POST /ai/chat/stream ───────────────────────────────────────────────────

describe('POST /ai/chat/stream', () => {
  it('sin messages → 400', async () => {
    const res = await request(app).post('/api/v1/ai/chat/stream').send({ messages: [] });
    expect(res.status).toBe(400);
  });

  it('modo local → SSE con data: lines', async () => {
    const res = await request(app)
      .post('/api/v1/ai/chat/stream')
      .send({ messages: [{ role: 'user', content: 'hola' }], userProfile: { goal: 'lose' } })
      .buffer(true)
      .parse((r, cb) => {
        let d = '';
        r.on('data', c => { d += c; });
        r.on('end', () => cb(null, d));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.body).toMatch(/data:/);
    expect(res.body).toMatch(/"done":true/);
    expect(res.body).toMatch(/"source":"local"/);
  });

  it('Ollama disponible → stream SSE desde Ollama', async () => {
    async function* fakeStream() { yield 'Hola '; yield 'desde Ollama'; }
    mockOllama.isAvailable.mockResolvedValue(true);
    mockOllama.chatStream.mockReturnValue(fakeStream());

    const res = await request(app)
      .post('/api/v1/ai/chat/stream')
      .send({ messages: [{ role: 'user', content: 'hola' }], userProfile: { goal: 'gain' } })
      .buffer(true)
      .parse((r, cb) => {
        let d = '';
        r.on('data', c => { d += c; });
        r.on('end', () => cb(null, d));
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatch(/"done":true/);
    expect(res.body).toMatch(/"source":"ollama"/);
  });

  it('Ollama disponible pero stream falla → fallback local', async () => {
    async function* errorStream() { throw new Error('Stream broken'); yield 'never'; }
    mockOllama.isAvailable.mockResolvedValue(true);
    mockOllama.chatStream.mockReturnValue(errorStream());

    const res = await request(app)
      .post('/api/v1/ai/chat/stream')
      .send({ messages: [{ role: 'user', content: 'hola' }], userProfile: { goal: 'lose' } })
      .buffer(true)
      .parse((r, cb) => {
        let d = '';
        r.on('data', c => { d += c; });
        r.on('end', () => cb(null, d));
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatch(/data:/);
  });

  it('error interno en stream → envía evento de error y cierra', async () => {
    // Forzamos un error en _loadMemories para llegar al catch global del stream
    mockPg.query.mockRejectedValueOnce(new Error('DB timeout'));

    const res = await request(app)
      .post('/api/v1/ai/chat/stream')
      .send({
        messages:    [{ role: 'user', content: 'test' }],
        userProfile: { id: 55, goal: 'lose' },
      })
      .buffer(true)
      .parse((r, cb) => {
        let d = '';
        r.on('data', c => { d += c; });
        r.on('end', () => cb(null, d));
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatch(/"done":true/);
  });
});

// ── 8. GET /ai/status ─────────────────────────────────────────────────────────

describe('GET /ai/status', () => {
  it('Ollama no disponible → active_mode: local, models_available: []', async () => {
    mockOllama.isAvailable.mockResolvedValue(false);
    const res = await request(app).get('/api/v1/ai/status');
    expect(res.status).toBe(200);
    expect(res.body.ollama).toBe(false);
    expect(res.body.active_mode).toBe('local');
    expect(Array.isArray(res.body.models_available)).toBe(true);
  });

  it('Ollama disponible → active_mode: ollama, modelos listados', async () => {
    mockOllama.isAvailable.mockResolvedValue(true);
    mockOllama.listModels.mockResolvedValue([{ name: 'llama3.2' }, { name: 'mistral' }]);
    const res = await request(app).get('/api/v1/ai/status');
    expect(res.status).toBe(200);
    expect(res.body.ollama).toBe(true);
    expect(res.body.active_mode).toBe('ollama');
    expect(res.body.models_available.length).toBe(2);
  });
});

// ── 9. GET + DELETE /ai/memory ────────────────────────────────────────────────

describe('GET /ai/memory y DELETE /ai/memory/:key', () => {
  it('GET devuelve lista de memorias del usuario (puede estar vacía)', async () => {
    const res = await request(app).get('/api/v1/ai/memory').set(bearerHeader(token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET sin auth → 401', async () => {
    const res = await request(app).get('/api/v1/ai/memory');
    expect(res.status).toBe(401);
  });

  it('DELETE /ai/memory/:key elimina la clave y devuelve { deleted }', async () => {
    const res = await request(app)
      .delete('/api/v1/ai/memory/dieta')
      .set(bearerHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe('dieta');
  });

  it('DELETE /ai/memory/:key sin auth → 401', async () => {
    const res = await request(app).delete('/api/v1/ai/memory/dieta');
    expect(res.status).toBe(401);
  });
});

// ── 10. POST /body-scan (eliminado — ruta no registrada) ─────────────────────

describe('POST /ai/body-scan', () => {
  it('devuelve 404 — ruta no registrada', async () => {
    const res = await request(app).post('/api/v1/ai/body-scan').send({});
    expect(res.status).toBe(404);
  });
});

// ── 11. Edge cases de _localAI y _buildDiet ───────────────────────────────────

describe('_localAI y _buildDiet — ramas de perfil', () => {
  it('dieta goal=gain con perfil completo calcula métricas reales', async () => {
    const res = await chat('dame plan de dieta semanal', {
      goal: 'gain', weight: 70, height: 175, age: 25, gender: 'male',
    });
    expect(res.status).toBe(200);
    expect(res.body.content).toMatch(/DIET_PLAN|dieta/i);
  });

  it('dieta goal=maintain devuelve plan de mantenimiento', async () => {
    const res = await chat('mi plan de dieta semanal', { goal: 'maintain' });
    expect(res.status).toBe(200);
    expect(res.body.content).toMatch(/DIET_PLAN|dieta|kcal/i);
  });

  it('rutina goal=maintain devuelve plan de 3 días', async () => {
    const res = await chat('quiero mi rutina de entrenamiento', { goal: 'maintain' });
    expect(res.status).toBe(200);
    expect(res.body.content).toMatch(/ROUTINE_PLAN|rutina/i);
  });

  it('hidratación con peso conocido calcula litros', async () => {
    const res = await chat('cuánta agua debo beber', { goal: 'lose', weight: 90 });
    expect(res.status).toBe(200);
    expect(res.body.content).toMatch(/L\/día|litros|agua/i);
  });

  it('IMC con perfil incompleto (sin peso) devuelve nota de precisión', async () => {
    const res = await chat('cuál es mi IMC', { goal: 'lose' });
    expect(res.status).toBe(200);
    expect(res.body.content).toMatch(/IMC|métricas|perfil incompleto/i);
  });
});
