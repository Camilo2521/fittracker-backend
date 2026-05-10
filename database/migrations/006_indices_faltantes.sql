-- ============================================================
-- Migration 006 — Índices faltantes en tablas de relación
-- FitTracker v3.1.1
-- ============================================================

-- dias_dieta: JOIN frecuente desde planes_dieta
CREATE INDEX IF NOT EXISTS idx_dias_dieta_plan    ON dias_dieta(plan_id);

-- comidas_plan: subquery por dia_id en diets.js y n8n weekly queries
CREATE INDEX IF NOT EXISTS idx_comidas_plan_dia   ON comidas_plan(dia_id);

-- dias_rutina: JOIN frecuente desde rutinas
CREATE INDEX IF NOT EXISTS idx_dias_rutina_rutina ON dias_rutina(rutina_id);

-- objetivos: queries por cuenta_id
CREATE INDEX IF NOT EXISTS idx_objetivos_cuenta   ON objetivos(cuenta_id);

-- registros_nutricion: queries por cuenta y fecha
CREATE INDEX IF NOT EXISTS idx_registros_nutricion_cuenta ON registros_nutricion(cuenta_id, fecha DESC);

-- entrenamientos (tabla ML): queries por cuenta y fecha
CREATE INDEX IF NOT EXISTS idx_entrenamientos_cuenta ON entrenamientos(cuenta_id, fecha DESC);

INSERT INTO _migraciones (archivo) VALUES ('006_indices_faltantes.sql')
  ON CONFLICT (archivo) DO NOTHING;
