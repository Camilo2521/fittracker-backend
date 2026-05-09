'use strict';

const FLAGS = {
  vision_v2:   process.env.FEATURE_VISION_V2    === 'true',
  rag_enabled: process.env.FEATURE_RAG_ENABLED  === 'true',
  weekly_pdf:  process.env.FEATURE_WEEKLY_PDF   === 'true',
};

/**
 * Middleware que bloquea una ruta si el feature flag no está habilitado.
 * Uso: router.post('/sessions', featureFlags.require('vision_v2'), handler)
 */
function require(flag) {
  return function featureFlagGuard(req, res, next) {
    if (!FLAGS[flag]) {
      return res.status(501).json({
        error: `Feature '${flag}' no habilitada en este servidor`,
        flag,
        hint: `Configura la variable de entorno FEATURE_${flag.toUpperCase()} = true`,
      });
    }
    next();
  };
}

module.exports = { require, FLAGS };
