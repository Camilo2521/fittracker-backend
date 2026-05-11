'use strict';

/**
 * FUNCTIONAL TEST — 03: PDF Generation
 * ─────────────────────────────────────────────────────────────────────────────
 * Verifica que:
 *   • POST /api/v1/pdf/diet requiere dietData
 *   • Cuando Python devuelve un buffer → responde con PDF binario correcto
 *   • Los headers Content-Type, Content-Disposition y Content-Length son correctos
 *   • El nombre del archivo PDF contiene la semana
 *   • Cuando Python no está disponible → 503 con mensaje claro
 *   • El buffer PDF tiene la firma mágica de un PDF válido (%PDF-)
 *   • El endpoint acepta userName personalizado
 */

jest.mock('../../src/db/postgres', () => require('../helpers/mockPostgres').mockPg);
jest.mock('../../src/services/visionClient', () => require('../helpers/mockVision').mockVision);

const request = require('supertest');
const { mockVision } = require('../helpers/mockVision');
const { registerUser, bearerHeader } = require('../helpers/auth');

let app, token;
beforeAll(async () => {
  app = require('../../src/app');
  ({ token } = await registerUser(app));
});

// Payload de dieta de prueba
const sampleDiet = {
  weekStart: '2024-06-03',
  goal: 'lose',
  dailyCalorieTarget: 1800,
  source: 'ia',
  days: ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'].map(day => ({
    day,
    totalCalories: 1800,
    meals: [
      { name: 'Desayuno',  calories: 360, description: 'Avena con frutos rojos' },
      { name: 'Almuerzo',  calories: 630, description: 'Pechuga + arroz integral' },
      { name: 'Merienda',  calories: 180, description: 'Yogur griego' },
      { name: 'Cena',      calories: 540, description: 'Salmón + brócoli' },
      { name: 'Extra',     calories:  90, description: 'Frutos secos' },
    ],
  })),
  notes: 'Déficit calórico de 400 kcal. Hidratación 2.5 L/día.',
};

// Crea un Buffer que simula un PDF mínimo válido
function makeFakePdfBuffer(weekLabel = '2024-06-03') {
  const content = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n`;
  return Buffer.from(content, 'utf-8');
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('POST /api/v1/pdf/diet — Validación', () => {
  it('rechaza sin dietData → 400', async () => {
    const res = await request(app).post('/api/v1/pdf/diet').set(bearerHeader(token)).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/dietData/i);
  });

  it('rechaza body vacío → 400', async () => {
    const res = await request(app).post('/api/v1/pdf/diet').set(bearerHeader(token)).send({ userName: 'María' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/pdf/diet — Servicio Python NO disponible', () => {
  beforeEach(() => {
    mockVision.generateDietPdf.mockResolvedValue(null); // Python retorna null
  });

  it('devuelve 503 con mensaje de error', async () => {
    const res = await request(app).post('/api/v1/pdf/diet').set(bearerHeader(token)).send({ dietData: sampleDiet });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/pdf no disponible/i);
  });

  it('el Content-Type sigue siendo JSON en el error', async () => {
    const res = await request(app).post('/api/v1/pdf/diet').set(bearerHeader(token)).send({ dietData: sampleDiet });
    expect(res.headers['content-type']).toMatch(/application\/json/i);
  });
});

describe('POST /api/v1/pdf/diet — Servicio Python disponible', () => {
  const pdfBuffer = makeFakePdfBuffer();

  beforeEach(() => {
    mockVision.generateDietPdf.mockResolvedValue(pdfBuffer);
  });

  it('devuelve 200 con el PDF binario', async () => {
    const res = await request(app)
      .post('/api/v1/pdf/diet')
      .set(bearerHeader(token))
      .send({ dietData: sampleDiet })
      .buffer(true)
      .parse((res, callback) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
  });

  it('Content-Type es application/pdf', async () => {
    const res = await request(app)
      .post('/api/v1/pdf/diet')
      .set(bearerHeader(token))
      .send({ dietData: sampleDiet });
    expect(res.headers['content-type']).toMatch(/application\/pdf/i);
  });

  it('Content-Disposition es "attachment" con filename que contiene la semana', async () => {
    const res = await request(app)
      .post('/api/v1/pdf/diet')
      .set(bearerHeader(token))
      .send({ dietData: sampleDiet });
    const disposition = res.headers['content-disposition'];
    expect(disposition).toMatch(/attachment/i);
    expect(disposition).toMatch(/2024-06-03/);
    expect(disposition).toMatch(/\.pdf/i);
  });

  it('el nombre del archivo es "fittracker-dieta-{weekStart}.pdf"', async () => {
    const res = await request(app)
      .post('/api/v1/pdf/diet')
      .set(bearerHeader(token))
      .send({ dietData: sampleDiet });
    expect(res.headers['content-disposition'])
      .toMatch(/fittracker-dieta-2024-06-03\.pdf/i);
  });

  it('Content-Length coincide con el tamaño del buffer', async () => {
    const res = await request(app)
      .post('/api/v1/pdf/diet')
      .set(bearerHeader(token))
      .send({ dietData: sampleDiet });
    const contentLength = parseInt(res.headers['content-length'], 10);
    expect(contentLength).toBe(pdfBuffer.length);
  });

  it('el body binario comienza con la firma mágica %PDF-', async () => {
    const res = await request(app)
      .post('/api/v1/pdf/diet')
      .set(bearerHeader(token))
      .send({ dietData: sampleDiet })
      .buffer(true)
      .parse((res, cb) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    const signature = res.body.toString('ascii', 0, 5);
    expect(signature).toBe('%PDF-');
  });

  it('acepta userName personalizado', async () => {
    const res = await request(app)
      .post('/api/v1/pdf/diet')
      .set(bearerHeader(token))
      .send({ dietData: sampleDiet, userName: 'María García' });
    expect(res.status).toBe(200);
    // Verificamos que visionClient recibió el userName
    expect(mockVision.generateDietPdf).toHaveBeenCalledWith(
      expect.anything(), 'María García'
    );
  });

  it('userName por defecto es "Usuario" si no se envía', async () => {
    await request(app)
      .post('/api/v1/pdf/diet')
      .set(bearerHeader(token))
      .send({ dietData: sampleDiet });
    expect(mockVision.generateDietPdf).toHaveBeenCalledWith(
      expect.anything(), 'Usuario'
    );
  });
});

describe('POST /api/v1/pdf/diet — Nombre de archivo fallback', () => {
  it('usa "semana" como fallback si dietData no tiene weekStart', async () => {
    const pdfBuffer = makeFakePdfBuffer();
    mockVision.generateDietPdf.mockResolvedValue(pdfBuffer);
    const dietSinSemana = { ...sampleDiet };
    delete dietSinSemana.weekStart;
    const res = await request(app)
      .post('/api/v1/pdf/diet')
      .set(bearerHeader(token))
      .send({ dietData: dietSinSemana });
    expect(res.headers['content-disposition']).toMatch(/semana/);
  });

  it('acepta week_start (snake_case) como alternativa', async () => {
    const pdfBuffer = makeFakePdfBuffer();
    mockVision.generateDietPdf.mockResolvedValue(pdfBuffer);
    const dietSnake = { ...sampleDiet, week_start: '2024-07-01' };
    delete dietSnake.weekStart;
    const res = await request(app)
      .post('/api/v1/pdf/diet')
      .set(bearerHeader(token))
      .send({ dietData: dietSnake });
    expect(res.headers['content-disposition']).toMatch(/2024-07-01/);
  });
});

describe('POST /api/v1/pdf/diet — visionClient recibe el payload correcto', () => {
  it('le pasa dietData y userName al visionClient', async () => {
    const pdfBuffer = makeFakePdfBuffer();
    mockVision.generateDietPdf.mockResolvedValue(pdfBuffer);
    mockVision.generateDietPdf.mockClear();
    await request(app)
      .post('/api/v1/pdf/diet')
      .set(bearerHeader(token))
      .send({ dietData: sampleDiet, userName: 'Carlos Ruiz' });
    expect(mockVision.generateDietPdf).toHaveBeenCalledTimes(1);
    const [passedData, passedName] = mockVision.generateDietPdf.mock.calls[0];
    expect(passedData).toEqual(sampleDiet);
    expect(passedName).toBe('Carlos Ruiz');
  });
});
