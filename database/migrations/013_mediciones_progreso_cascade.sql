-- ============================================================
-- Migración 013 — mediciones_progreso: ON DELETE SET NULL → CASCADE
-- Razón: la tabla progress_measurements fue creada con ON DELETE SET NULL
--        (migración 001, línea 290). Cuando una cuenta se elimina, los
--        registros quedan huérfanos (cuenta_id = NULL) y nunca se limpian.
--        Todas las demás tablas del schema usan ON DELETE CASCADE.
-- ============================================================

ALTER TABLE mediciones_progreso
  DROP CONSTRAINT IF EXISTS progress_measurements_account_id_fkey;

-- Nombre real de la FK tras el RENAME de migración 005
ALTER TABLE mediciones_progreso
  DROP CONSTRAINT IF EXISTS mediciones_progreso_account_id_fkey;

ALTER TABLE mediciones_progreso
  ADD CONSTRAINT mediciones_progreso_cuenta_id_fkey
    FOREIGN KEY (cuenta_id) REFERENCES cuentas(id) ON DELETE CASCADE;

-- Limpiar filas huérfanas existentes (cuenta_id = NULL de borrados previos)
DELETE FROM mediciones_progreso WHERE cuenta_id IS NULL;
