// @vitest-environment node

import { readFileSync } from 'node:fs';
import { getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  accounts,
  auditLogs,
  authSessions,
  commands,
  deals,
  events,
  gameTables,
  roomMembers,
  rooms,
  sessionBoards,
  sessionPairs,
  sessions,
  substituteInvites,
  tableBoards,
} from './schema';

const sql = readFileSync(new URL('./migrations/0000_init.sql', import.meta.url), 'utf8');
const sql0001 = readFileSync(
  new URL('./migrations/0001_accounts_rooms.sql', import.meta.url),
  'utf8',
);
const sql0002 = readFileSync(
  new URL('./migrations/0002_room_members.sql', import.meta.url),
  'utf8',
);
const sql0003 = readFileSync(
  new URL('./migrations/0003_sessions_preparing.sql', import.meta.url),
  'utf8',
);

describe('数据库 Schema 契约', () => {
  it('Drizzle 表名与迁移 SQL 一致', () => {
    const names = [
      accounts,
      rooms,
      roomMembers,
      authSessions,
      sessions,
      sessionPairs,
      gameTables,
      deals,
      tableBoards,
      sessionBoards,
      events,
      commands,
      substituteInvites,
      auditLogs,
    ].map((table) => getTableName(table));

    expect(names).toEqual([
      'accounts',
      'rooms',
      'room_members',
      'auth_sessions',
      'sessions',
      'session_pairs',
      'game_tables',
      'deals',
      'table_boards',
      'session_boards',
      'events',
      'commands',
      'substitute_invites',
      'audit_logs',
    ]);
    const allSql = sql + sql0001 + sql0002;
    for (const name of names) {
      expect(allSql).toContain(`CREATE TABLE ${name} (`);
    }
  });

  it('SRS 5.3 要求的唯一约束全部存在', () => {
    expect(sql).toContain(
      'CREATE UNIQUE INDEX table_boards_session_deal_table_uq\n  ON table_boards (session_id, deal_id, table_id);',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX session_boards_session_deal_uq ON session_boards (session_id, deal_id);',
    );
    expect(sql).toContain('CREATE UNIQUE INDEX events_stream_seq_uq ON events (stream_id, seq);');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX session_pairs_session_pair_uq ON session_pairs (session_id, pair_id);',
    );
    expect(sql).toContain('WHERE status = \'PENDING\'');
  });

  it('事件主键即 eventId，且 seq 只能为正', () => {
    expect(sql).toContain('event_id uuid PRIMARY KEY');
    expect(sql).toContain('CONSTRAINT events_seq_chk CHECK (seq > 0)');
  });

  it('桌副 7 状态与无成绩空分约束写入 DDL', () => {
    for (const status of [
      'IN_PROGRESS',
      'PLAYED',
      'PASSED_OUT',
      'CANCELLED',
      'ADJUSTED',
      'INCOMPLETE',
      'REOPENED',
    ]) {
      expect(sql).toContain(`'${status}'`);
    }
    expect(sql).toContain(
      "status NOT IN ('CANCELLED', 'INCOMPLETE', 'REOPENED') OR raw_score IS NULL",
    );
  });

  it('Session 四维状态分别存储，不共用一个标志', () => {
    expect(sql).toContain('room_nature varchar(16) NOT NULL');
    expect(sql).toContain('session_status varchar(16) NOT NULL');
    expect(sql).toContain('scoring_eligibility varchar(16) NOT NULL');
    expect(sql).toContain('status varchar(16) NOT NULL');
    expect(sql).toContain(
      "CONSTRAINT sessions_status_chk CHECK (\n    session_status IN ('preparing', 'starting', 'playing', 'paused', 'completed', 'aborted')\n  )",
    );
    expect(sql).toContain(
      "scoring_eligibility IN ('pending', 'eligible', 'ineligible')",
    );
  });

  it('命令幂等表以 commandId 为主键并保存请求哈希', () => {
    expect(sql).toContain('command_id varchar(64) PRIMARY KEY');
    expect(sql).toContain('request_hash varchar(64) NOT NULL');
    expect(sql).toContain(
      "CONSTRAINT commands_status_chk CHECK (status IN ('processing', 'completed', 'failed'))",
    );
  });

  it('事件只追加：保留 corrects 与 supersededBy 字段', () => {
    expect(sql).toContain('corrects_event_id uuid');
    expect(sql).toContain('superseded_by_event_id uuid');
    expect(sql).not.toContain('DELETE FROM events');
  });
});

describe('M6 账号、会话与牌室迁移', () => {
  it('账号保存归一化命名与登录时间', () => {
    expect(sql0001).toContain('ADD COLUMN username_normalized varchar(12)');
    expect(sql0001).toContain('ADD COLUMN nickname_normalized varchar(32)');
    expect(sql0001).toContain('ADD COLUMN last_login_at timestamptz');
    expect(sql0001).toContain(
      'CREATE UNIQUE INDEX accounts_username_normalized_uq ON accounts (username_normalized);',
    );
    expect(sql0001).toContain(
      'CREATE UNIQUE INDEX accounts_nickname_normalized_uq ON accounts (nickname_normalized);',
    );
    expect(sql0001).toContain('CREATE UNIQUE INDEX accounts_email_lower_uq ON accounts (lower(email));');
    expect(sql0001).toContain('nickname_change_count BETWEEN 0 AND 3');
  });

  it('会话表只存令牌摘要，并支持撤销与过期', () => {
    expect(getTableName(authSessions)).toBe('auth_sessions');
    expect(sql0001).toContain('CREATE TABLE auth_sessions (');
    expect(sql0001).toContain('token_hash varchar(64) PRIMARY KEY');
    expect(sql0001).toContain('revoked_at timestamptz');
    expect(sql0001).toContain('CONSTRAINT auth_sessions_expiry_chk CHECK (expires_at > created_at)');
    expect(sql0001).not.toContain('token text');
  });

  it('牌室状态与私有/密码字段进入 DDL', () => {
    expect(sql0001).toContain("ADD COLUMN status varchar(16) NOT NULL DEFAULT 'waiting'");
    expect(sql0001).toContain('ADD COLUMN password_hash text');
    expect(sql0001).toContain('ADD COLUMN is_private boolean NOT NULL DEFAULT false');
    expect(sql0001).toContain(
      "CONSTRAINT rooms_status_chk CHECK (status IN ('waiting', 'playing', 'frozen'))",
    );
    expect(sql0001).toContain('CREATE INDEX rooms_public_created_idx');
  });
});

describe('M6 牌室成员与座位迁移', () => {
  it('成员表以 (room_id, user_id) 为主键', () => {
    expect(getTableName(roomMembers)).toBe('room_members');
    expect(sql0002).toContain('CREATE TABLE room_members (');
    expect(sql0002).toContain('PRIMARY KEY (room_id, user_id)');
    expect(sql0002).toContain('nickname_snapshot varchar(32) NOT NULL');
    expect(sql0002).toContain('joined_at timestamptz NOT NULL DEFAULT now()');
  });

  it('座位唯一且只能取 N/E/S/W，举手必须先落座', () => {
    expect(sql0002).toContain(
      'CONSTRAINT room_members_seat_chk CHECK (seat IN (\'N\', \'E\', \'S\', \'W\'))',
    );
    expect(sql0002).toContain(
      'CONSTRAINT room_members_ready_chk CHECK (NOT ready OR seat IS NOT NULL)',
    );
    expect(sql0002).toContain('CREATE UNIQUE INDEX room_members_seat_uq');
    expect(sql0002).toContain('WHERE seat IS NOT NULL');
  });

  it('成员外键级联删除，并支持按用户/牌室查询', () => {
    expect(sql0002).toContain(
      'room_id uuid NOT NULL REFERENCES rooms (room_id) ON DELETE CASCADE',
    );
    expect(sql0002).toContain(
      'user_id uuid NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE',
    );
    expect(sql0002).toContain('CREATE INDEX room_members_user_idx ON room_members (user_id)');
    expect(sql0002).toContain('CREATE INDEX room_members_room_joined_idx');
  });
});

describe('M6 Session 创建与快照迁移', () => {
  it('Session 固化玩法与房间配置快照', () => {
    expect(sql0003).toContain(
      "ALTER TABLE sessions ADD COLUMN gameplay varchar(8) NOT NULL DEFAULT 'single'",
    );
    expect(sql0003).toContain(
      "ALTER TABLE sessions ADD COLUMN room_config jsonb NOT NULL DEFAULT '{}'::jsonb",
    );
    expect(sql0003).toContain(
      "CONSTRAINT sessions_gameplay_chk CHECK (gameplay IN ('single', 'teams'))",
    );
  });

  it('同一牌室同时最多一个活动 Session', () => {
    expect(sql0003).toContain('CREATE UNIQUE INDEX sessions_room_active_uq');
    expect(sql0003).toContain(
      "WHERE session_status IN ('preparing', 'starting', 'playing', 'paused')",
    );
  });
});
