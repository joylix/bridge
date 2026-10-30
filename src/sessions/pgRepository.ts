/**
 * Session 的 PostgreSQL 仓储。
 *
 * 并发裁决：
 * - 同一牌室最多一个活动 Session 由部分唯一索引
 *   `sessions_room_active_uq` 保证；
 * - 状态迁移使用 `WHERE session_status = $from` 条件更新，避免并发覆盖。
 */

import type { Pool } from 'pg';
import type { RoomConfig, RoomNature } from '../rooms/types';
import {
  ActiveSessionExistsError,
  type NewSession,
  type ScoringEligibility,
  type ScoringEligibilitySnapshot,
  type SessionGameplay,
  type SessionRecord,
  type SessionRepository,
  type SessionStatus,
} from './types';

interface SessionRow {
  session_id: string;
  room_id: string;
  room_nature: string;
  gameplay: string;
  room_config: RoomConfig | null;
  session_status: string;
  scoring_eligibility: string;
  scoring_eligibility_snapshot: ScoringEligibilitySnapshot | null;
  team_table_mapping: Record<string, unknown> | null;
  last_seq: number;
  started_at: Date | null;
  ended_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const SESSION_COLUMNS = `
  session_id, room_id, room_nature, gameplay, room_config,
  session_status, scoring_eligibility, scoring_eligibility_snapshot,
  team_table_mapping, last_seq, started_at, ended_at, created_at, updated_at
`;

function toSnapshot(row: SessionRow): ScoringEligibilitySnapshot {
  if (row.scoring_eligibility_snapshot) return row.scoring_eligibility_snapshot;
  // M5 遗留行可能没有快照；按创建时初始值补齐，避免投影出现 undefined。
  return {
    roomNature: row.room_nature as RoomNature,
    initial: row.scoring_eligibility as ScoringEligibility,
    decision: null,
    decidedAt: null,
    reason: 'session_created',
  };
}

function toSession(row: SessionRow): SessionRecord {
  return {
    sessionId: row.session_id,
    roomId: row.room_id,
    roomNature: row.room_nature as RoomNature,
    gameplay: row.gameplay as SessionGameplay,
    config: (row.room_config ?? {}) as RoomConfig,
    sessionStatus: row.session_status as SessionStatus,
    scoringEligibility: row.scoring_eligibility as ScoringEligibility,
    scoringEligibilitySnapshot: toSnapshot(row),
    teamTableMapping: row.team_table_mapping,
    lastSeq: row.last_seq,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === '23505'
  );
}

export class PgSessionRepository implements SessionRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: NewSession): Promise<SessionRecord> {
    try {
      const result = await this.pool.query<SessionRow>(
        `INSERT INTO sessions (
           room_id, room_nature, gameplay, room_config,
           session_status, scoring_eligibility, scoring_eligibility_snapshot
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING ${SESSION_COLUMNS}`,
        [
          input.roomId,
          input.roomNature,
          input.gameplay,
          input.config,
          input.sessionStatus,
          input.scoringEligibility,
          input.scoringEligibilitySnapshot,
        ],
      );
      return toSession(result.rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ActiveSessionExistsError();
      throw error;
    }
  }

  async findById(sessionId: string): Promise<SessionRecord | null> {
    const result = await this.pool.query<SessionRow>(
      `SELECT ${SESSION_COLUMNS} FROM sessions WHERE session_id = $1`,
      [sessionId],
    );
    return result.rows[0] ? toSession(result.rows[0]) : null;
  }

  async findActiveByRoom(roomId: string): Promise<SessionRecord | null> {
    const result = await this.pool.query<SessionRow>(
      `SELECT ${SESSION_COLUMNS} FROM sessions
       WHERE room_id = $1
         AND session_status IN ('preparing', 'starting', 'playing', 'paused')
       ORDER BY created_at DESC
       LIMIT 1`,
      [roomId],
    );
    return result.rows[0] ? toSession(result.rows[0]) : null;
  }

  async listByRoom(roomId: string): Promise<SessionRecord[]> {
    const result = await this.pool.query<SessionRow>(
      `SELECT ${SESSION_COLUMNS} FROM sessions
       WHERE room_id = $1
       ORDER BY created_at DESC`,
      [roomId],
    );
    return result.rows.map(toSession);
  }

  async transition(
    sessionId: string,
    from: SessionStatus,
    to: SessionStatus,
    at: Date,
  ): Promise<SessionRecord | null> {
    const result = await this.pool.query<SessionRow>(
      `UPDATE sessions
       SET session_status = $3,
           started_at = CASE WHEN $3 = 'starting' THEN $4 ELSE started_at END,
           ended_at = CASE WHEN $3 IN ('completed', 'aborted') THEN $4 ELSE ended_at END,
           updated_at = $4
       WHERE session_id = $1 AND session_status = $2
       RETURNING ${SESSION_COLUMNS}`,
      [sessionId, from, to, at],
    );
    return result.rows[0] ? toSession(result.rows[0]) : null;
  }
}
