'use strict';

/**
 * Variables de entorno para la suite de tests.
 * Se carga ANTES de que cualquier módulo de la app se requiera (setupFiles).
 */
const os   = require('os');
const path = require('path');

process.env.NODE_ENV   = 'test';
process.env.JWT_SECRET = 'test-secret-key-for-jest-only-32chars!!';
// Cada proceso worker de Jest obtiene su propio archivo SQLite en /tmp
process.env.DB_PATH    = path.join(os.tmpdir(), `fittracker_test_${process.pid}.db`);
process.env.PORT       = '0';          // Puerto aleatorio → sin conflictos
process.env.PYTHON_SERVICE_URL  = 'http://localhost:9999'; // Puerto que no existe
process.env.CORS_ORIGINS        = 'http://localhost:8080';

// Feature flags OFF por defecto en tests (cada test los activa si los necesita)
process.env.FEATURE_RAG_ENABLED  = 'false';
process.env.FEATURE_VISION_V2    = 'false';
process.env.FEATURE_WEEKLY_PDF   = 'false';
