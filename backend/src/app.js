/**
 * FitTracker Backend API — v3.0.0
 * Base de datos: PostgreSQL (único motor)
 */

require('dotenv').config();

const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const morgan     = require('morgan');
const requestId  = require('./middleware/requestId');
const { generalLimiter } = require('./middleware/rateLimiter');
const { runMigrations }       = require('./db/migrate');
const { startTokenCleanup }   = require('./db/tokenCleanup');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── MIDDLEWARE ────────────────────────────────────────────────
app.use(requestId);
app.set('trust proxy', 1);

// CSP estricta para toda la API — sin unsafe-inline
app.use(helmet({
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'"],
      styleSrc:    ["'self'"],
      imgSrc:      ["'self'", 'data:'],
      connectSrc:  ["'self'"],
      frameSrc:    ["'none'"],
      objectSrc:   ["'none'"],
    },
  },
}));
app.use(generalLimiter);

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:8080')
  .split(',')
  .map(o => o.trim());

const isDev = (process.env.NODE_ENV || 'development') !== 'production';

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin || origin === 'null') return cb(null, true);
    // En desarrollo se permiten todos los localhost (puertos dinámicos del dev server)
    if (isDev && /^https?:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    const err = new Error(`Origin ${origin} not allowed by CORS`);
    err.status = 403;
    cb(err);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id', 'x-internal-token'],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ── SWAGGER ───────────────────────────────────────────────────
const swaggerUi    = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');

const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title:       'FitTracker API',
      version:     '3.0.0',
      description: 'API REST del backend de FitTracker — autenticación, IA, rutinas, dietas, progreso y más.',
    },
    servers: [{ url: 'http://localhost:3000', description: 'Local' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/routes/v1/*.js'],
});

// Swagger UI necesita unsafe-inline para sus scripts/estilos embebidos;
// se aplica solo a /docs para no relajar la CSP del resto de la API.
app.use('/docs', helmet({
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],
      styleSrc:   ["'self'", "'unsafe-inline'", 'https:'],
      imgSrc:     ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
    },
  },
}));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { explorer: true }));
app.get('/docs.json', (_req, res) => res.json(swaggerSpec));

// ── ROUTES ────────────────────────────────────────────────────
app.use('/api/v1', require('./routes/v1'));

// ── HEALTH CHECK ──────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  const pg         = require('./db/postgres');
  const { FLAGS }  = require('./middleware/featureFlags');

  const checks = { node: 'ok', postgres: 'unknown', python: 'unknown' };

  checks.postgres = await pg.healthCheck();

  try {
    const pyRes = await fetch(
      `${process.env.PYTHON_SERVICE_URL || 'http://localhost:8000'}/health`,
      { signal: AbortSignal.timeout(6000) }
    );
    const data = await pyRes.json();
    checks.python = data.status || 'ok';
  } catch { checks.python = 'unavailable'; }

  const pgOk = checks.postgres === 'ok';

  res.status(pgOk ? 200 : 503).json({
    status:        pgOk ? 'ok' : 'error',
    version:       '3.0.0',
    timestamp:     new Date().toISOString(),
    checks,
    feature_flags: FLAGS,
  });
});

// ── ERROR HANDLING ────────────────────────────────────────────
app.use((err, req, res, _next) => {
  const status  = err.status || 500;
  const message = err.expose || process.env.NODE_ENV !== 'production'
    ? err.message
    : 'Internal server error';
  console.error(`[error] [${req.id}] ${status} — ${err.message}`);
  res.status(status).json({ error: message, requestId: req.id });
});

app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));

// ── START ─────────────────────────────────────────────────────
async function start() {
  await runMigrations();

  startTokenCleanup();

  app.listen(PORT, '0.0.0.0', () => {
    const { FLAGS } = require('./middleware/featureFlags');
    console.log(`✅ FitTracker API v3 running on http://localhost:${PORT}`);
    console.log(`   Environment  : ${process.env.NODE_ENV || 'development'}`);
    console.log(`   Database     : PostgreSQL (${process.env.DATABASE_URL?.replace(/:([^:@]+)@/, ':***@') || 'no config'})`);
    console.log(`   Python svc   : ${process.env.PYTHON_SERVICE_URL || 'http://localhost:8000'}`);
    console.log(`   Flags activos: ${Object.entries(FLAGS).filter(([,v])=>v).map(([k])=>k).join(', ') || 'ninguno'}`);
    console.log(`   Swagger      : http://localhost:${PORT}/docs`);
  });
}

start().catch(err => {
  console.error('Error fatal al iniciar:', err);
  process.exit(1);
});

module.exports = app;
