// SQLite removed — all data now lives in PostgreSQL.
// This module re-exports the pg pool for any legacy require() calls.
module.exports = require('./postgres');
