'use strict';

const { Pool } = require('pg');

let _pool = null;

function getPool() {
  if (!_pool) {
    // Support both DATABASE_URL (standard) and legacy PG_CONNECTION_STRING
    const connStr = process.env.DATABASE_URL || process.env.PG_CONNECTION_STRING;
    if (!connStr) {
      console.warn('[postgres] DATABASE_URL no configurada — PostgreSQL no disponible');
      return null;
    }
    _pool = new Pool({
      connectionString: connStr,
      max:                    parseInt(process.env.PG_POOL_MAX || '20', 10),
      idleTimeoutMillis:      30_000,
      connectionTimeoutMillis: 3_000,
      ssl: connStr.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
    });
    _pool.on('error', (err) => {
      console.error('[postgres] Error en pool:', err.message);
    });
    console.log('[postgres] Pool inicializado con DATABASE_URL');
  }
  return _pool;
}

/**
 * Ejecuta una query en PostgreSQL.
 * Lanza un error descriptivo si el pool no está configurado, en lugar de
 * retornar null silenciosamente (lo que causaría TypeErrors genéricos
 * al desestructurar el resultado en las rutas).
 */
async function query(sql, params = []) {
  const pool = getPool();
  if (!pool) {
    throw new Error(
      'PostgreSQL no está configurado. ' +
      'Define DATABASE_URL en backend/.env y reinicia el servidor.'
    );
  }
  return pool.query(sql, params);
}

async function healthCheck() {
  try {
    const pool = getPool();
    if (!pool) return 'no_config';
    await pool.query('SELECT 1');
    return 'ok';
  } catch (e) {
    return `error: ${e.message}`;
  }
}

// pool getter — allows callers to do `pg.pool.connect()` for transactions
Object.defineProperty(module.exports, 'pool', { get: getPool, enumerable: true });

module.exports.query       = query;
module.exports.healthCheck = healthCheck;
module.exports.getPool     = getPool;
