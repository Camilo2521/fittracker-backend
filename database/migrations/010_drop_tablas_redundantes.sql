-- ============================================================
-- Migration 010 — Eliminar tablas redundantes sin rutas API
-- FitTracker v3.2.2
--
-- pesos: duplica registros_progreso.peso (time-series de peso).
--   La ruta /auth/progress-log ya cubre este caso.
--
-- objetivos: duplica cuentas.objetivo / peso_meta / peso_inicio.
--   Además el trigger trg_objetivos_actualizado_en debe caer
--   antes de la tabla.
-- ============================================================

-- Eliminar trigger antes de la tabla
DROP TRIGGER IF EXISTS trg_objetivos_actualizado_en ON objetivos;

DROP TABLE IF EXISTS pesos    CASCADE;
DROP TABLE IF EXISTS objetivos CASCADE;

INSERT INTO _migraciones (archivo) VALUES ('010_drop_tablas_redundantes.sql')
  ON CONFLICT (archivo) DO NOTHING;
