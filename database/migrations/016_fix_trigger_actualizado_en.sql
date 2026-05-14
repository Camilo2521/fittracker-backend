-- ============================================================
-- Migración 016 — Corregir función del trigger actualizado_en
-- Razón: fn_establecer_actualizado_en (antes fn_set_updated_at)
--        fue renombrada en la migración 005 pero su cuerpo aún
--        referencia NEW.updated_at. Desde la 005, la columna
--        se llama actualizado_en → el trigger falla con 500 al
--        hacer PUT /auth/profile o cualquier UPDATE en cuentas.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_establecer_actualizado_en()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.actualizado_en = NOW();
  RETURN NEW;
END $$;
