-- ============================================================
-- Migration 008 — metricas_fisicas: UPSERT diario correcto
-- FitTracker v3.2.0
--
-- Problema: el UNIQUE(cuenta_id, medido_en) nunca disparaba porque
-- medido_en = NOW() genera un timestamp único en cada INSERT.
-- Resultado: se acumulaban filas duplicadas por usuario.
--
-- Solución: agregar fecha_calculo DATE NOT NULL DEFAULT CURRENT_DATE
-- y hacer el UNIQUE sobre (cuenta_id, fecha_calculo).
-- Así el cálculo diario de métricas es idempotente.
-- ============================================================

-- 1. Agregar columna de fecha de cálculo (solo la fecha, sin hora)
ALTER TABLE metricas_fisicas
  ADD COLUMN IF NOT EXISTS fecha_calculo DATE NOT NULL DEFAULT CURRENT_DATE;

-- 2. Eliminar el constraint viejo que nunca funcionaba
ALTER TABLE metricas_fisicas
  DROP CONSTRAINT IF EXISTS metricas_fisicas_cuenta_id_medido_en_key;

-- 3. Limpiar filas duplicadas existentes: conservar la más reciente por (cuenta_id, fecha)
--    La subquery identifica los IDs a ELIMINAR (todos menos el más reciente del día).
DELETE FROM metricas_fisicas
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY cuenta_id, fecha_calculo
             ORDER BY medido_en DESC
           ) AS rn
    FROM metricas_fisicas
  ) ranked
  WHERE rn > 1
);

-- 4. Añadir el nuevo constraint correcto
ALTER TABLE metricas_fisicas
  ADD CONSTRAINT uq_metricas_fisicas_cuenta_fecha
    UNIQUE (cuenta_id, fecha_calculo);

-- 5. Índice de búsqueda para el historial (GET /progress/metrics)
CREATE INDEX IF NOT EXISTS idx_metricas_fisicas_cuenta_fecha
  ON metricas_fisicas (cuenta_id, fecha_calculo DESC);

INSERT INTO _migraciones (archivo) VALUES ('008_metricas_fisicas_upsert.sql')
  ON CONFLICT (archivo) DO NOTHING;
