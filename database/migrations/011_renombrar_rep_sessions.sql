-- ============================================================
-- Migración 011 — Renombrar rep_sessions → sesiones_rep
-- Razón: unificar convención de nombres en español (migración 005
--        renombró todas las tablas menos ésta, creada después).
-- ============================================================

-- Renombrar la tabla
ALTER TABLE IF EXISTS rep_sessions RENAME TO sesiones_rep;

-- Renombrar el índice de usuario (creado en migración 009)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'sesiones_rep' AND indexname = 'idx_rep_sessions_usuario_id'
  ) THEN
    ALTER INDEX idx_rep_sessions_usuario_id RENAME TO idx_sesiones_rep_cuenta_id;
  END IF;
END $$;

-- Renombrar índice de tipo si existe
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'sesiones_rep' AND indexname = 'idx_rep_sessions_tipo_ejercicio'
  ) THEN
    ALTER INDEX idx_rep_sessions_tipo_ejercicio RENAME TO idx_sesiones_rep_tipo_ejercicio;
  END IF;
END $$;

-- Renombrar secuencia del serial (si no fue renombrada automáticamente)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename = 'rep_sessions_id_seq') THEN
    ALTER SEQUENCE rep_sessions_id_seq RENAME TO sesiones_rep_id_seq;
  END IF;
END $$;
