-- ============================================================
-- Migración 014 — mediciones_progreso: traducir columnas al español
--                 + índice en tokens_refresco(cuenta_id)
-- Razón: la migración 005 renombró la tabla progress_measurements →
--        mediciones_progreso pero NO sus columnas (type, metrics,
--        progress, recommendations, timestamp). Esta migración
--        completa la traducción y añade el índice de FK faltante
--        en tokens_refresco para operaciones de gestión de sesiones.
-- ============================================================

-- ── 1. Traducir columnas de mediciones_progreso ───────────────────────────────

ALTER TABLE mediciones_progreso RENAME COLUMN type            TO tipo;
ALTER TABLE mediciones_progreso RENAME COLUMN metrics         TO metricas;
ALTER TABLE mediciones_progreso RENAME COLUMN progress        TO progreso;
ALTER TABLE mediciones_progreso RENAME COLUMN recommendations TO recomendaciones;
-- "timestamp" es palabra reservada en PostgreSQL → requiere comillas
ALTER TABLE mediciones_progreso RENAME COLUMN "timestamp"     TO marca_temporal;

-- ── 2. Índice en tokens_refresco(cuenta_id) ────────────────────────────────────
-- Cubre: "revocar todos los tokens de un usuario", auditorías de sesión,
--        y operaciones de cleanup que filtran por cuenta + estado.
CREATE INDEX IF NOT EXISTS idx_tokens_refresco_cuenta_id
  ON tokens_refresco (cuenta_id);
