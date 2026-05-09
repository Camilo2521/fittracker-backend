-- ============================================================
-- Migration 003 — Refresh tokens
-- FitTracker v3.0.0
-- Almacena tokens de refresco hasheados (SHA-256).
-- Cada sesión de usuario tiene su propio refresh token.
-- ============================================================

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          BIGSERIAL    PRIMARY KEY,
  account_id  BIGINT       NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash  TEXT         UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ  NOT NULL,
  revoked     BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  user_agent  TEXT,
  ip          TEXT
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_account_id ON refresh_tokens (account_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens (expires_at);
