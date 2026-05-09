-- ============================================================
-- Migration 004 — Password reset tokens
-- FitTracker v3.0.0
-- Token hasheado con SHA-256, válido 1 hora, de un solo uso.
-- ============================================================

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         BIGSERIAL    PRIMARY KEY,
  account_id BIGINT       NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash TEXT         UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ  NOT NULL,
  used       BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prt_account_id ON password_reset_tokens (account_id);
CREATE INDEX IF NOT EXISTS idx_prt_expires_at ON password_reset_tokens (expires_at);
