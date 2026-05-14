-- ============================================================
-- Migración 015 — Corregir función cleanup_expired_tokens
-- Razón: la migración 012 usó la columna «actualizado_en» en
--        tokens_refresco, pero esa columna nunca existió en esa
--        tabla (solo existe «creado_en»). Esta migración recrea
--        la función con el nombre de columna correcto.
-- ============================================================

CREATE OR REPLACE FUNCTION cleanup_expired_tokens()
RETURNS TABLE(
  tokens_refresco_eliminados     BIGINT,
  tokens_recuperacion_eliminados BIGINT
) LANGUAGE plpgsql AS $$
DECLARE
  _rf BIGINT;
  _rp BIGINT;
BEGIN
  -- Refresh tokens: expirados O revocados hace más de 7 días
  DELETE FROM tokens_refresco
  WHERE expira_en < NOW()
     OR (revocado = TRUE AND creado_en < NOW() - INTERVAL '7 days');
  GET DIAGNOSTICS _rf = ROW_COUNT;

  -- Password-reset tokens: utilizados O expirados hace más de 24 horas
  DELETE FROM tokens_recuperacion
  WHERE utilizado = TRUE
     OR expira_en < NOW() - INTERVAL '24 hours';
  GET DIAGNOSTICS _rp = ROW_COUNT;

  RETURN QUERY SELECT _rf, _rp;
END $$;
