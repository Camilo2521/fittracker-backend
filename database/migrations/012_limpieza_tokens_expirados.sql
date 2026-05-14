-- ============================================================
-- Migración 012 — Función de limpieza de tokens expirados
-- Razón: tokens_refresco y tokens_recuperacion nunca se depuran;
--        con el tiempo la tabla crece sin límite y consultas de
--        lookup se hacen más lentas.
-- La función es llamada por Node.js al arrancar y cada hora.
-- ============================================================

CREATE OR REPLACE FUNCTION cleanup_expired_tokens()
RETURNS TABLE(
  tokens_refresco_eliminados   BIGINT,
  tokens_recuperacion_eliminados BIGINT
) LANGUAGE plpgsql AS $$
DECLARE
  _rf BIGINT;
  _rp BIGINT;
BEGIN
  -- Refresh tokens: expirados O revocados hace más de 7 días
  DELETE FROM tokens_refresco
  WHERE expira_en < NOW()
     OR (revocado = TRUE AND actualizado_en < NOW() - INTERVAL '7 days');
  GET DIAGNOSTICS _rf = ROW_COUNT;

  -- Password-reset tokens: usados O expirados hace más de 24 horas
  DELETE FROM tokens_recuperacion
  WHERE usado = TRUE
     OR expira_en < NOW() - INTERVAL '24 hours';
  GET DIAGNOSTICS _rp = ROW_COUNT;

  RETURN QUERY SELECT _rf, _rp;
END $$;

-- Índices parciales para acelerar la limpieza en producción
CREATE INDEX IF NOT EXISTS idx_tokens_refresco_expira
  ON tokens_refresco (expira_en)
  WHERE expira_en < NOW() OR revocado = TRUE;

CREATE INDEX IF NOT EXISTS idx_tokens_recuperacion_expira
  ON tokens_recuperacion (expira_en)
  WHERE usado = TRUE OR expira_en < NOW();
