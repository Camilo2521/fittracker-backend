-- ============================================================
-- Migration 001 — Full PostgreSQL Schema
-- FitTracker v3.0.0
-- Engine: PostgreSQL 14+
-- ============================================================

-- Case-insensitive text for email uniqueness
CREATE EXTENSION IF NOT EXISTS citext;

-- ── Core user/auth table ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
  id                   BIGSERIAL PRIMARY KEY,
  email                CITEXT        UNIQUE NOT NULL,
  password_hash        TEXT          NOT NULL,
  name                 TEXT          NOT NULL DEFAULT '',
  goal                 TEXT          NOT NULL DEFAULT 'maintain'
                         CHECK (goal IN ('lose','gain','maintain')),
  weight               NUMERIC(6,2),
  height_cm            NUMERIC(5,2),
  age                  SMALLINT      CHECK (age > 0 AND age < 150),
  gender               TEXT          CHECK (gender IN ('male','female','other')),
  activity_level       TEXT          NOT NULL DEFAULT 'moderate'
                         CHECK (activity_level IN ('sedentary','light','moderate','active','very_active')),
  restrictions         TEXT          NOT NULL DEFAULT '',
  -- Extended fitness profile
  target_weight        NUMERIC(6,2),
  start_weight         NUMERIC(6,2),
  completed_onboarding BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── Chat history ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_history (
  id         BIGSERIAL   PRIMARY KEY,
  account_id BIGINT      NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role       TEXT        NOT NULL CHECK (role IN ('user','assistant')),
  content    TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_history_account ON chat_history(account_id, created_at DESC);

-- ── Workout logs ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workout_logs (
  id           BIGSERIAL   PRIMARY KEY,
  account_id   BIGINT      NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date         DATE        NOT NULL DEFAULT CURRENT_DATE,
  routine_name TEXT,
  exercises    JSONB       NOT NULL DEFAULT '[]',
  duration_min SMALLINT    CHECK (duration_min > 0),
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_workout_logs_account ON workout_logs(account_id, date DESC);

-- ── Diet logs ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS diet_logs (
  id         BIGSERIAL    PRIMARY KEY,
  account_id BIGINT       NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date       DATE         NOT NULL DEFAULT CURRENT_DATE,
  plan_name  TEXT,
  meals      JSONB        NOT NULL DEFAULT '[]',
  total_kcal NUMERIC(7,2),
  notes      TEXT,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_diet_logs_account ON diet_logs(account_id, date DESC);

-- ── Progress logs ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS progress_logs (
  id         BIGSERIAL   PRIMARY KEY,
  account_id BIGINT      NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date       DATE        NOT NULL DEFAULT CURRENT_DATE,
  weight     NUMERIC(6,2),
  body_fat   NUMERIC(5,2),
  chest_cm   NUMERIC(5,1),
  waist_cm   NUMERIC(5,1),
  hip_cm     NUMERIC(5,1),
  arm_cm     NUMERIC(5,1),
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_progress_logs_account ON progress_logs(account_id, date DESC);

-- ── AI suggestions ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_suggestions (
  id              BIGSERIAL   PRIMARY KEY,
  account_id      BIGINT      NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  suggestion_type TEXT        NOT NULL,
  content         TEXT        NOT NULL,
  user_feedback   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_account ON ai_suggestions(account_id, created_at DESC);

-- ── AI memory (personalization) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_memories (
  id         BIGSERIAL   PRIMARY KEY,
  account_id BIGINT      NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  key        TEXT        NOT NULL,
  value      TEXT        NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, key)
);
CREATE INDEX IF NOT EXISTS idx_user_memories_account ON user_memories(account_id);

-- ── Nutrition documents (RAG) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nutrition_documents (
  id         BIGSERIAL   PRIMARY KEY,
  title      TEXT        NOT NULL,
  content    TEXT        NOT NULL,
  type       TEXT        NOT NULL DEFAULT 'nutrition',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Diet plans (RAG-generated) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS diet_plans (
  id         BIGSERIAL PRIMARY KEY,
  account_id BIGINT    NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  week_start DATE      NOT NULL,
  goal       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, week_start)
);
CREATE INDEX IF NOT EXISTS idx_diet_plans_account ON diet_plans(account_id, week_start DESC);

CREATE TABLE IF NOT EXISTS diet_days (
  id             BIGSERIAL PRIMARY KEY,
  plan_id        BIGINT    NOT NULL REFERENCES diet_plans(id) ON DELETE CASCADE,
  day_of_week    SMALLINT  NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  total_calories NUMERIC(7,2)
);

CREATE TABLE IF NOT EXISTS diet_meals (
  id              BIGSERIAL    PRIMARY KEY,
  day_id          BIGINT       NOT NULL REFERENCES diet_days(id) ON DELETE CASCADE,
  name            TEXT         NOT NULL,
  calories        NUMERIC(7,2),
  protein_g       NUMERIC(6,2),
  carbs_g         NUMERIC(6,2),
  fat_g           NUMERIC(6,2),
  manual_override BOOLEAN      NOT NULL DEFAULT FALSE
);

-- ── Routines (RAG-generated) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS routines (
  id         BIGSERIAL   PRIMARY KEY,
  account_id BIGINT      NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_routines_account ON routines(account_id, is_active);

CREATE TABLE IF NOT EXISTS routine_days (
  id         BIGSERIAL PRIMARY KEY,
  routine_id BIGINT    NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  day_index  SMALLINT  NOT NULL CHECK (day_index BETWEEN 0 AND 6),
  focus      TEXT
);

CREATE TABLE IF NOT EXISTS routine_exercises (
  id          BIGSERIAL PRIMARY KEY,
  day_id      BIGINT    NOT NULL REFERENCES routine_days(id) ON DELETE CASCADE,
  name        TEXT      NOT NULL,
  sets        SMALLINT,
  reps        TEXT,
  order_index SMALLINT  NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_routine_exercises_day ON routine_exercises(day_id, order_index);

-- ── Physical metrics (TMB/TDEE/IMC tracking) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS physical_metrics (
  id             BIGSERIAL   PRIMARY KEY,
  account_id     BIGINT      NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  bmi            NUMERIC(5,2),
  bmr            NUMERIC(7,2),
  tdee           NUMERIC(7,2),
  calorie_target NUMERIC(7,2),
  measured_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, measured_at)
);
CREATE INDEX IF NOT EXISTS idx_physical_metrics_account ON physical_metrics(account_id, measured_at DESC);

-- ── Weight log ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS weights (
  id         BIGSERIAL   PRIMARY KEY,
  account_id BIGINT      NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date       DATE        NOT NULL,
  value      NUMERIC(6,2) NOT NULL,
  unit       TEXT        NOT NULL DEFAULT 'kg',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_weights_account ON weights(account_id, date DESC);

-- ── Fitness goals ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS goals (
  id             BIGSERIAL   PRIMARY KEY,
  account_id     BIGINT      NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  goal           TEXT        NOT NULL CHECK (goal IN ('lose','gain','maintain')),
  target_weight  NUMERIC(6,2) NOT NULL,
  start_weight   NUMERIC(6,2),
  current_weight NUMERIC(6,2),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Daily habit checks ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_checks (
  id         BIGSERIAL   PRIMARY KEY,
  account_id BIGINT      NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date       DATE        NOT NULL,
  checks     JSONB       NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, date)
);

-- ── Water intake ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS water_intake (
  id         BIGSERIAL   PRIMARY KEY,
  account_id BIGINT      NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date       DATE        NOT NULL,
  glasses    SMALLINT    NOT NULL DEFAULT 0,
  ml         INTEGER     NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, date)
);

-- ── Workout sessions (ML-structured) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workouts (
  id         BIGSERIAL   PRIMARY KEY,
  account_id BIGINT      NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date       DATE        NOT NULL,
  type       TEXT        NOT NULL CHECK (type IN ('strength','cardio','flexibility')),
  duration   INTEGER     NOT NULL,
  intensity  TEXT        NOT NULL CHECK (intensity IN ('low','medium','high')),
  calories   INTEGER,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_workouts_account ON workouts(account_id, date DESC);

-- ── Nutrition entries (manual) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nutrition (
  id         BIGSERIAL    PRIMARY KEY,
  account_id BIGINT       NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date       DATE         NOT NULL,
  meal_type  TEXT,
  calories   INTEGER      NOT NULL DEFAULT 0,
  protein    NUMERIC(6,2) NOT NULL DEFAULT 0,
  carbs      NUMERIC(6,2) NOT NULL DEFAULT 0,
  fat        NUMERIC(6,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Meals (ML-detected) ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meals (
  id          BIGSERIAL    PRIMARY KEY,
  account_id  BIGINT       NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date        DATE         NOT NULL,
  name        TEXT         NOT NULL,
  calories    INTEGER      NOT NULL DEFAULT 0,
  protein     NUMERIC(6,2) NOT NULL DEFAULT 0,
  carbs       NUMERIC(6,2) NOT NULL DEFAULT 0,
  fat         NUMERIC(6,2) NOT NULL DEFAULT 0,
  detected_by TEXT         NOT NULL DEFAULT 'manual',
  confidence  NUMERIC(4,3),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_meals_account ON meals(account_id, date DESC);

-- ── ML exercise sessions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS exercises (
  id            BIGSERIAL    PRIMARY KEY,
  account_id    BIGINT       NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date          DATE         NOT NULL,
  type          TEXT         NOT NULL,
  duration      INTEGER,
  reps          INTEGER,
  sets          INTEGER,
  posture_score NUMERIC(5,2),
  feedback      JSONB        NOT NULL DEFAULT '[]',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_exercises_account ON exercises(account_id, date DESC);

-- ── ML body progress measurements ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS progress_measurements (
  id              BIGSERIAL   PRIMARY KEY,
  account_id      BIGINT      REFERENCES accounts(id) ON DELETE SET NULL,
  type            TEXT        NOT NULL DEFAULT 'progress_measurement',
  metrics         JSONB,
  progress        JSONB,
  recommendations JSONB,
  timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_progress_measurements_account ON progress_measurements(account_id);

-- ── App settings ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  id         BIGSERIAL PRIMARY KEY,
  account_id BIGINT    NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  key        TEXT      NOT NULL,
  value      TEXT,
  UNIQUE(account_id, key)
);

-- ── Migration tracker ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS _migrations (
  id         BIGSERIAL   PRIMARY KEY,
  filename   TEXT        UNIQUE NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Triggers: auto-update updated_at ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_accounts_updated_at ON accounts;
CREATE TRIGGER trg_accounts_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

DROP TRIGGER IF EXISTS trg_goals_updated_at ON goals;
CREATE TRIGGER trg_goals_updated_at
  BEFORE UPDATE ON goals
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
