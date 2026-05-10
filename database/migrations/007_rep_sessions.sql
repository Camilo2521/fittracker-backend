-- 007_rep_sessions.sql
-- Tabla para historial de sesiones de conteo de repeticiones (reps.js)

CREATE TABLE IF NOT EXISTS rep_sessions (
  id              BIGSERIAL     PRIMARY KEY,
  cuenta_id       BIGINT        NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  exercise_type   TEXT          NOT NULL,
  mode            TEXT          NOT NULL DEFAULT 'mediapipe',
  started_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  ended_at        TIMESTAMPTZ,
  total_reps      INTEGER       NOT NULL DEFAULT 0,
  total_sets      INTEGER       NOT NULL DEFAULT 0,
  calories_burned NUMERIC(7,2),
  avg_form_score  NUMERIC(5,2)
);

CREATE INDEX IF NOT EXISTS idx_rep_sessions_cuenta
  ON rep_sessions(cuenta_id, started_at DESC);

INSERT INTO _migraciones (archivo) VALUES ('007_rep_sessions.sql')
  ON CONFLICT (archivo) DO NOTHING;
