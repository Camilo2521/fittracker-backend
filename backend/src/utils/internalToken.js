'use strict';

const crypto = require('crypto');

const _secret = process.env.INTERNAL_API_SECRET;
if (!_secret) {
  throw new Error(
    '[internalToken] INTERNAL_API_SECRET no está configurado. ' +
    'Añade INTERNAL_API_SECRET=<cadena aleatoria> a backend/.env'
  );
}

/**
 * Genera un token HMAC-SHA256 para autenticación interna Node → Python.
 * Formato: "{timestamp_unix}.{sha256_hex}"
 * El microservicio Python valida que el timestamp sea ≤ 30 seg de antigüedad.
 */
function generateInternalToken() {
  const ts  = Math.floor(Date.now() / 1000).toString();
  const sig = crypto.createHmac('sha256', _secret).update(ts).digest('hex');
  return `${ts}.${sig}`;
}

module.exports = { generateInternalToken };
