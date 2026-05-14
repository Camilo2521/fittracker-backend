'use strict';

const pg = require('./postgres');

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hora

async function runCleanup() {
  try {
    const { rows } = await pg.query('SELECT * FROM cleanup_expired_tokens()');
    const { tokens_refresco_eliminados: rf, tokens_recuperacion_eliminados: rp } = rows[0];
    if (rf > 0 || rp > 0) {
      console.log(`[token-cleanup] eliminados: ${rf} refresh, ${rp} recuperación`);
    }
  } catch (err) {
    console.error('[token-cleanup] error:', err.message);
  }
}

function startTokenCleanup() {
  // Ejecución inmediata al arrancar, luego cada hora
  runCleanup();
  setInterval(runCleanup, CLEANUP_INTERVAL_MS).unref();
}

module.exports = { startTokenCleanup, runCleanup };
