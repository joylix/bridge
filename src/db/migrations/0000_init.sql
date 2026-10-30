-- M5 初始 Schema（PostgreSQL 16）
-- 与 src/db/schema.ts 一一对应；应用层不得绕过唯一约束做“先查后写”。

CREATE TABLE accounts (
  user_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(254) NOT NULL,
  username varchar(12) NOT NULL,
  nickname varchar(32) NOT NULL,
  password_hash text NOT NULL,
  role varchar(16) NOT NULL DEFAULT 'user',
  status varchar(16) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounts_role_chk CHECK (role IN ('user', 'admin')),
  CONSTRAINT accounts_status_chk CHECK (status IN ('active', 'suspended', 'deleted'))
);
CREATE UNIQUE INDEX accounts_email_uq ON accounts (email);
CREATE UNIQUE INDEX accounts_username_uq ON accounts (username);
CREATE UNIQUE INDEX accounts_nickname_uq ON accounts (nickname);

CREATE TABLE rooms (
  room_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(64) NOT NULL,
  room_nature varchar(16) NOT NULL,
  owner_id uuid NOT NULL REFERENCES accounts (user_id),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rooms_nature_chk CHECK (room_nature IN ('practice', 'casual', 'competitive'))
);

CREATE TABLE sessions (
  session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms (room_id),
  room_nature varchar(16) NOT NULL,
  session_status varchar(16) NOT NULL DEFAULT 'preparing',
  scoring_eligibility varchar(16) NOT NULL DEFAULT 'pending',
  scoring_eligibility_snapshot jsonb,
  team_table_mapping jsonb,
  last_seq integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sessions_nature_chk CHECK (room_nature IN ('practice', 'casual', 'competitive')),
  CONSTRAINT sessions_status_chk CHECK (
    session_status IN ('preparing', 'starting', 'playing', 'paused', 'completed', 'aborted')
  ),
  CONSTRAINT sessions_eligibility_chk CHECK (
    scoring_eligibility IN ('pending', 'eligible', 'ineligible')
  )
);
CREATE INDEX sessions_room_idx ON sessions (room_id, created_at);

CREATE TABLE session_pairs (
  session_id uuid NOT NULL REFERENCES sessions (session_id) ON DELETE CASCADE,
  pair_id uuid NOT NULL,
  player_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  system_declarations jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX session_pairs_session_pair_uq ON session_pairs (session_id, pair_id);

CREATE TABLE game_tables (
  table_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions (session_id) ON DELETE CASCADE,
  table_number integer NOT NULL,
  camp varchar(8) NOT NULL DEFAULT 'none',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT game_tables_camp_chk CHECK (camp IN ('red', 'blue', 'none')),
  CONSTRAINT game_tables_number_chk CHECK (table_number > 0)
);
CREATE UNIQUE INDEX game_tables_session_number_uq ON game_tables (session_id, table_number);

CREATE TABLE deals (
  deal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions (session_id) ON DELETE CASCADE,
  board_number integer NOT NULL,
  dealer varchar(1) NOT NULL,
  vulnerability varchar(4) NOT NULL,
  pbn text NOT NULL,
  superseded_by_deal_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deals_dealer_chk CHECK (dealer IN ('N', 'E', 'S', 'W')),
  CONSTRAINT deals_vulnerability_chk CHECK (vulnerability IN ('NONE', 'NS', 'EW', 'ALL')),
  CONSTRAINT deals_board_number_chk CHECK (board_number > 0)
);
CREATE UNIQUE INDEX deals_session_board_uq ON deals (session_id, board_number);

CREATE TABLE table_boards (
  table_board_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions (session_id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES deals (deal_id),
  table_id uuid NOT NULL REFERENCES game_tables (table_id),
  status varchar(16) NOT NULL,
  raw_score integer,
  original_raw_score integer,
  record jsonb NOT NULL,
  adjustment jsonb,
  adjust_history jsonb,
  version integer NOT NULL DEFAULT 0,
  last_seq integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT table_boards_status_chk CHECK (
    status IN (
      'IN_PROGRESS', 'PLAYED', 'PASSED_OUT', 'CANCELLED',
      'ADJUSTED', 'INCOMPLETE', 'REOPENED'
    )
  ),
  CONSTRAINT table_boards_no_score_chk CHECK (
    status NOT IN ('CANCELLED', 'INCOMPLETE', 'REOPENED') OR raw_score IS NULL
  ),
  CONSTRAINT table_boards_version_chk CHECK (version >= 0 AND last_seq >= 0)
);
CREATE UNIQUE INDEX table_boards_session_deal_table_uq
  ON table_boards (session_id, deal_id, table_id);
CREATE INDEX table_boards_session_status_idx ON table_boards (session_id, status);

CREATE TABLE session_boards (
  session_board_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions (session_id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES deals (deal_id),
  status varchar(16) NOT NULL,
  team_imp integer,
  payload jsonb NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT session_boards_status_chk CHECK (
    status IN ('PENDING', 'COMPLETE', 'INCOMPLETE', 'CANCELLED', 'ADJUSTED', 'REOPENED')
  ),
  CONSTRAINT session_boards_no_imp_chk CHECK (
    status NOT IN ('CANCELLED', 'INCOMPLETE', 'REOPENED') OR team_imp IS NULL
  )
);
CREATE UNIQUE INDEX session_boards_session_deal_uq ON session_boards (session_id, deal_id);

CREATE TABLE events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions (session_id) ON DELETE CASCADE,
  stream_id text NOT NULL,
  table_board_id uuid REFERENCES table_boards (table_board_id),
  seq integer NOT NULL,
  type varchar(32) NOT NULL,
  occurred_at timestamptz NOT NULL,
  actor jsonb NOT NULL,
  audience jsonb NOT NULL,
  payload jsonb NOT NULL,
  corrects_event_id uuid,
  superseded_by_event_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT events_seq_chk CHECK (seq > 0)
);
CREATE UNIQUE INDEX events_stream_seq_uq ON events (stream_id, seq);
CREATE INDEX events_session_time_idx ON events (session_id, occurred_at);
CREATE INDEX events_table_board_seq_idx ON events (table_board_id, seq);

CREATE TABLE commands (
  command_id varchar(64) PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES sessions (session_id) ON DELETE CASCADE,
  user_id uuid REFERENCES accounts (user_id),
  type varchar(32) NOT NULL,
  request_hash varchar(64) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'processing',
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT commands_status_chk CHECK (status IN ('processing', 'completed', 'failed'))
);

CREATE TABLE substitute_invites (
  invite_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions (session_id) ON DELETE CASCADE,
  table_id uuid NOT NULL REFERENCES game_tables (table_id),
  target_user_id uuid NOT NULL REFERENCES accounts (user_id),
  invited_by uuid NOT NULL REFERENCES accounts (user_id),
  status varchar(16) NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT substitute_invites_status_chk CHECK (
    status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED')
  )
);
CREATE UNIQUE INDEX substitute_invites_pending_target_uq
  ON substitute_invites (target_user_id)
  WHERE status = 'PENDING';

CREATE TABLE audit_logs (
  audit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES accounts (user_id),
  action varchar(64) NOT NULL,
  target_type varchar(32) NOT NULL,
  target_id text NOT NULL,
  reason text,
  before jsonb,
  after jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_target_idx ON audit_logs (target_type, target_id, at);
