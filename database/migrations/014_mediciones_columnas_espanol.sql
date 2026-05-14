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
-- Nota: la migración 005 ya renombró estas columnas (type→tipo, metrics→metricas_json,
-- etc.). Este bloque es un guard idempotente: solo renombra si la columna inglesa
-- todavía existe (p.ej. en una base de datos que saltó la 005).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'mediciones_progreso' AND column_name = 'type') THEN
    ALTER TABLE mediciones_progreso RENAME COLUMN type TO tipo;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'mediciones_progreso' AND column_name = 'metrics') THEN
    ALTER TABLE mediciones_progreso RENAME COLUMN metrics TO metricas_json;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'mediciones_progreso' AND column_name = 'progress') THEN
    ALTER TABLE mediciones_progreso RENAME COLUMN progress TO progreso_json;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'mediciones_progreso' AND column_name = 'recommendations') THEN
    ALTER TABLE mediciones_progreso RENAME COLUMN recommendations TO recomendaciones_json;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'mediciones_progreso' AND column_name = 'timestamp') THEN
    ALTER TABLE mediciones_progreso RENAME COLUMN "timestamp" TO marca_tiempo;
  END IF;
END $$;

-- ── 2. Índice en tokens_refresco(cuenta_id) ────────────────────────────────────
-- Cubre: "revocar todos los tokens de un usuario", auditorías de sesión,
--        y operaciones de cleanup que filtran por cuenta + estado.
CREATE INDEX IF NOT EXISTS idx_tokens_refresco_cuenta_id
  ON tokens_refresco (cuenta_id);
