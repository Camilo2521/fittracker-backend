'use strict';

/**
 * Envuelve un route handler async para Express 4.
 *
 * Express 4 no captura automáticamente promesas rechazadas en handlers
 * async — generaría un UnhandledPromiseRejection que en Node ≥ 15 termina
 * el proceso. Este wrapper pasa cualquier error rechazado a next() para que
 * llegue al middleware de error global definido en app.js.
 *
 * Uso:
 *   router.get('/ruta', asyncHandler(async (req, res) => { ... }));
 *   router.post('/ruta', requireAuth, asyncHandler(async (req, res) => { ... }));
 */
const asyncHandler = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = asyncHandler;
