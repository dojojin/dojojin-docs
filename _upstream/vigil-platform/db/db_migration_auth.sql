-- ============================================================
-- Bosch CCTV Dashboard — User Authentication Migration
-- Run AFTER existing tables
-- ============================================================

-- ── Table: users ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  username        VARCHAR(50) UNIQUE NOT NULL,
  email           VARCHAR(100) UNIQUE,
  full_name       VARCHAR(150),
  password_hash   TEXT NOT NULL,
  role            VARCHAR(20) NOT NULL DEFAULT 'viewer',  -- 'admin' | 'viewer'
  enabled         BOOLEAN DEFAULT true,
  must_change_password BOOLEAN DEFAULT false,
  
  -- Login tracking
  last_login_at   TIMESTAMPTZ,
  last_login_ip   VARCHAR(45),
  failed_attempts INT DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  
  -- Audit
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  created_by      INT REFERENCES users(id) ON DELETE SET NULL,
  
  CHECK (role IN ('admin', 'viewer'))
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_enabled ON users(enabled);

-- ── Table: sessions ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id              VARCHAR(64) PRIMARY KEY,  -- random session ID (hex)
  user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip_address      VARCHAR(45),
  user_agent      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  last_used_at    TIMESTAMPTZ DEFAULT NOW(),
  revoked         BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ── Table: audit_log ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id              BIGSERIAL PRIMARY KEY,
  user_id         INT REFERENCES users(id) ON DELETE SET NULL,
  username        VARCHAR(50),  -- snapshot
  action          VARCHAR(50) NOT NULL,  -- 'login_success', 'login_failed', 'logout', 'password_change', 'user_create', 'user_delete', 'user_role_change', etc.
  target_user_id  INT,          -- ถ้า action เป็นการแก้ user คนอื่น
  target_username VARCHAR(50),
  ip_address      VARCHAR(45),
  user_agent      TEXT,
  details         JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);

-- ── Auto-update updated_at trigger ───────────────────────────
CREATE OR REPLACE FUNCTION update_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_users_updated_at();

-- ── Cleanup function (run by cron in app) ────────────────────
-- ลบ session ที่ expire แล้ว + audit log เก่ากว่า 90 วัน
-- เรียกจาก api-server.js เป็น setInterval
