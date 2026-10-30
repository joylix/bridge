-- M6：账号命名归一化、登录会话与牌室状态
-- 与 src/db/schema.ts 保持一致；唯一约束是并发注册的最终裁决。

ALTER TABLE accounts
  ADD COLUMN username_normalized varchar(12),
  ADD COLUMN nickname_normalized varchar(32),
  ADD COLUMN nickname_change_count integer NOT NULL DEFAULT 0,
  ADD COLUMN nickname_changed_at timestamptz,
  ADD COLUMN last_login_at timestamptz,
  ADD COLUMN email_verified_at timestamptz;

-- 旧数据回填（新库为空）；应用层写入时始终提供归一化值。
UPDATE accounts
SET username_normalized = lower(trim(username)),
    nickname_normalized = lower(trim(nickname))
WHERE username_normalized IS NULL OR nickname_normalized IS NULL;

ALTER TABLE accounts
  ALTER COLUMN username_normalized SET NOT NULL,
  ALTER COLUMN nickname_normalized SET NOT NULL;

CREATE UNIQUE INDEX accounts_username_normalized_uq ON accounts (username_normalized);
CREATE UNIQUE INDEX accounts_nickname_normalized_uq ON accounts (nickname_normalized);
CREATE UNIQUE INDEX accounts_email_lower_uq ON accounts (lower(email));

ALTER TABLE accounts
  ADD CONSTRAINT accounts_nickname_change_count_chk
  CHECK (nickname_change_count BETWEEN 0 AND 3);

ALTER TABLE rooms
  ADD COLUMN status varchar(16) NOT NULL DEFAULT 'waiting',
  ADD COLUMN password_hash text,
  ADD COLUMN is_private boolean NOT NULL DEFAULT false;

ALTER TABLE rooms
  ADD CONSTRAINT rooms_status_chk CHECK (status IN ('waiting', 'playing', 'frozen'));

CREATE INDEX rooms_public_created_idx ON rooms (is_private, created_at DESC);

CREATE TABLE auth_sessions (
  token_hash varchar(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  ip varchar(64),
  user_agent varchar(256),
  CONSTRAINT auth_sessions_expiry_chk CHECK (expires_at > created_at)
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions (user_id, expires_at);
CREATE INDEX auth_sessions_expires_idx ON auth_sessions (expires_at);
