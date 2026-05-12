-- ============================================================
-- Migration 009 — rep_sessions: columnas a español
-- FitTracker v3.2.1
--
-- Todas las tablas usan nomenclatura en español desde la migración 005.
-- rep_sessions fue creada en la 007 con nombres en inglés. Esta migración
-- corrige la inconsistencia sin romper la FK existente (cuenta_id ya es español).
-- ============================================================

ALTER TABLE rep_sessions RENAME COLUMN exercise_type   TO tipo_ejercicio;
ALTER TABLE rep_sessions RENAME COLUMN mode            TO modo;
ALTER TABLE rep_sessions RENAME COLUMN started_at      TO iniciado_en;
ALTER TABLE rep_sessions RENAME COLUMN ended_at        TO finalizado_en;
ALTER TABLE rep_sessions RENAME COLUMN total_reps      TO total_repeticiones;
ALTER TABLE rep_sessions RENAME COLUMN total_sets      TO total_series;
ALTER TABLE rep_sessions RENAME COLUMN calories_burned TO calorias_quemadas;
ALTER TABLE rep_sessions RENAME COLUMN avg_form_score  TO puntuacion_forma_promedio;

-- Renombrar índice para consistencia
ALTER INDEX IF EXISTS idx_rep_sessions_cuenta
  RENAME TO idx_sesiones_rep_cuenta;

INSERT INTO _migraciones (archivo) VALUES ('009_rep_sessions_espanol.sql')
  ON CONFLICT (archivo) DO NOTHING;
