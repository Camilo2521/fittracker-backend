'use strict';

const FLAGS = {
  vision_v2:    process.env.FEATURE_VISION_V2    === 'true',
  rag_enabled:  process.env.FEATURE_RAG_ENABLED  === 'true',
  weekly_pdf:   process.env.FEATURE_WEEKLY_PDF   === 'true',
  yolo_enabled: process.env.FEATURE_YOLO_ENABLED === 'true',
};

/**
 * Middleware que bloquea una ruta si el feature flag no está habilitado.
 * La comprobación se realiza en tiempo de petición (no en tiempo de carga)
 * para que los tests puedan sobreescribir process.env antes de cada suite.
 * Uso: router.post('/sessions', featureFlags.require('vision_v2'), handler)
 */
function require(flag) {
  const envKey = `FEATURE_${flag.toUpperCase()}`;
  return function featureFlagGuard(req, res, next) {
    if (process.env[envKey] !== 'true') {
      return res.status(501).json({
        error: `Feature '${flag}' no habilitada en este servidor`,
        flag,
        hint: `Configura la variable de entorno ${envKey} = true`,
      });
    }
    next();
  };
}

module.exports = { require, FLAGS };
