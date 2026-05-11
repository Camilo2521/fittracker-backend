'use strict';

require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const pg   = require('./postgres');

const MIGRATIONS_DIR = path.join(__dirname, '../../../database/migrations');

async function _migracionesExiste(client) {
  const { rows } = await client.query(
    `SELECT to_regclass('public._migraciones') AS t`
  );
  return !!rows[0]?.t;
}

async function getApplied(client) {
  if (await _migracionesExiste(client)) {
    // Post-migración 005: tabla y columnas en español
    const { rows } = await client.query('SELECT archivo FROM _migraciones ORDER BY archivo');
    return rows.map(r => r.archivo);
  }

  // Pre-migración 005: tabla en inglés
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         BIGSERIAL   PRIMARY KEY,
      filename   TEXT        UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  const { rows } = await client.query('SELECT filename FROM _migrations ORDER BY filename');
  return rows.map(r => r.filename);
}

async function applyMigration(client, filename, sql) {
  await client.query('BEGIN');
  try {
    await client.query(sql);
    // Tras ejecutar el SQL, la tabla de tracking puede haberse renombrado (migración 005)
    if (await _migracionesExiste(client)) {
      await client.query(
        'INSERT INTO _migraciones (archivo) VALUES ($1) ON CONFLICT DO NOTHING',
        [filename]
      );
    } else {
      await client.query(
        'INSERT INTO _migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
        [filename]
      );
    }
    await client.query('COMMIT');
    console.log(`[migrate] ${filename}: aplicada`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function runMigrations() {
  if (!process.env.DATABASE_URL && !process.env.PG_CONNECTION_STRING) {
    console.log('[migrate] Sin DATABASE_URL — omitiendo migraciones.');
    return;
  }

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.warn('[migrate] Directorio de migraciones no encontrado:', MIGRATIONS_DIR);
    return;
  }

  const client = await pg.pool.connect();
  try {
    const applied = await getApplied(client);
    const files   = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    let count = 0;
    for (const file of files) {
      if (applied.includes(file)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      try {
        await applyMigration(client, file, sql);
        count++;
      } catch (err) {
        console.error(`[migrate] Error aplicando ${file}:`, err.message);
        throw err;
      }
    }

    if (count > 0) console.log(`[migrate] ${count} migración(es) aplicada(s).`);
    else console.log('[migrate] Base de datos al día.');
  } finally {
    client.release();
  }
}

module.exports = { runMigrations };

if (require.main === module) {
  runMigrations()
    .then(() => { console.log('Migraciones completadas.'); process.exit(0); })
    .catch(err => { console.error('Error en migración:', err); process.exit(1); });
}
