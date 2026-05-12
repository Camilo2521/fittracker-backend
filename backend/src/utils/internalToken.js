'use strict';

const crypto  = require('crypto');
const isProd  = (process.env.NODE_ENV || 'development') === 'production';
const _secret = process.env.INTERNAL_API_SECRET || null;

if (!_secret) {
  const msg =
    '[internalToken] INTERNAL_API_SECRET no está configurado. ' +
    'Genera uno con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"' +
    ' y añádelo a backend/.env';

  if (isProd) throw new Error(msg);

  console.warn('\n⚠️  ' + msg);
  console.warn('⚠️  En producción esto lanzaría un error fatal. Solo aceptable en desarrollo.\n');
}

/**
 * Genera un token HMAC-SHA256 para autenticación interna Node → Python.
 * Formato: "{timestamp_unix}.{sha256_hex}"
 * El microservicio Python valida que el timestamp sea ≤ 30 s de antigüedad.
 *
 * En desarrollo sin secret configurado devuelve un token marcado como inseguro
 * para que el servicio Python pueda identificarlo y aceptarlo solo en modo dev.
 */
function generateInternalToken() {
  const ts = Math.floor(Date.now() / 1000).toString();

  if (!_secret) {
    // Token de desarrollo: sin firma real, solo para entorno local sin Python activo.
    return `${ts}.dev_unsigned`;
  }

  const sig = crypto.createHmac('sha256', _secret).update(ts).digest('hex');
  return `${ts}.${sig}`;
}

module.exports = { generateInternalToken };
