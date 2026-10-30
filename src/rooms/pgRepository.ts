/**
 * 牌室与成员 / 座位的 PostgreSQL 仓储。
 *
 * 并发裁决：
 * - 座位唯一性依赖 `room_members (room_id, seat) WHERE seat IS NOT NULL` 部分唯一索引；
 * - 等候区上限在 `SELECT ... FOR UPDATE` 锁住牌室行后计数，避免并发加入超限；
 * - 创建牌室与室主入成员表在同一事务内完成。
 */

import type { Pool, PoolClient } from 'pg';
import {
  RoomFullError,
  SeatTakenError,
  type NewRoom,
  type NewRoomMember,
  type RoomConfig,
  type RoomCounts,
  type RoomListFilter,
  type RoomMemberRecord,
  type RoomNature,
  type RoomRecord,
  type RoomRepository,
  type RoomStatus,
  type RoomWithCounts,
  type SeatPosition,
} from './types';

interface RoomRow {
  room_id: string;
  name: string;
  room_nature: string;
  owner_id: string;
  status: string;
  config: RoomConfig;
  is_private: boolean;
  password_hash: string | null;
  created_at: Date;
  updated_at: Date;
  member_count?: number | string;
  seated_count?: number | string;
}

interface MemberRow {
  room_id: string;
  user_id: string;
  nickname_snapshot: string;
  seat: string | null;
  ready: boolean;
  joined_at: Date;
}

const ROOM_COLUMNS = `
  room_id, name, room_nature, owner_id, status, config,
  is_private, password_hash, created_at, updated_at
`;

const ROOM_COLUMNS_ALIASED = `
  r.room_id, r.name, r.room_nature, r.owner_id, r.status, r.config,
  r.is_private, r.password_hash, r.created_at, r.updated_at
`;

const MEMBER_COLUMNS = `
  room_id, user_id, nickname_snapshot, seat, ready, joined_at
`;

function toRoom(row: RoomRow): RoomRecord {
  return {
    roomId: row.room_id,
    name: row.name,
    roomNature: row.room_nature as RoomNature,
    ownerId: row.owner_id,
    status: row.status as RoomStatus,
    config: row.config,
    isPrivate: row.is_private,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRoomWithCounts(row: RoomRow): RoomWithCounts {
  return {
    ...toRoom(row),
    memberCount: Number(row.member_count ?? 0),
    seatedCount: Number(row.seated_count ?? 0),
  };
}

function toMember(row: MemberRow): RoomMemberRecord {
  return {
    roomId: row.room_id,
    userId: row.user_id,
    nickname: row.nickname_snapshot,
    seat: (row.seat as SeatPosition | null) ?? null,
    ready: row.ready,
    joinedAt: row.joined_at,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === '23505'
  );
}

async function withTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export class PgRoomRepository implements RoomRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: NewRoom): Promise<RoomRecord> {
    return withTransaction(this.pool, async (client) => {
      const result = await client.query<RoomRow>(
        `INSERT INTO rooms (name, room_nature, owner_id, status, config, is_private, password_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING ${ROOM_COLUMNS}`,
        [
          input.name,
          input.roomNature,
          input.ownerId,
          input.status,
          input.config,
          input.isPrivate,
          input.passwordHash,
        ],
      );
      const room = toRoom(result.rows[0]);
      await client.query(
        `INSERT INTO room_members (room_id, user_id, nickname_snapshot)
         VALUES ($1, $2, $3)`,
        [room.roomId, input.ownerId, input.ownerNickname],
      );
      return room;
    });
  }

  async findById(roomId: string): Promise<RoomRecord | null> {
    const result = await this.pool.query<RoomRow>(
      `SELECT ${ROOM_COLUMNS} FROM rooms WHERE room_id = $1`,
      [roomId],
    );
    return result.rows[0] ? toRoom(result.rows[0]) : null;
  }

  async listPublic(filter: RoomListFilter): Promise<RoomWithCounts[]> {
    const limit = filter.limit ?? 50;
    const result = filter.roomNature
      ? await this.pool.query<RoomRow>(
          `SELECT ${ROOM_COLUMNS_ALIASED},
                  count(m.user_id)::int AS member_count,
                  count(m.seat)::int AS seated_count
           FROM rooms r
           LEFT JOIN room_members m ON m.room_id = r.room_id
           WHERE r.is_private = false AND r.room_nature = $1
           GROUP BY r.room_id
           ORDER BY r.created_at DESC LIMIT $2`,
          [filter.roomNature, limit],
        )
      : await this.pool.query<RoomRow>(
          `SELECT ${ROOM_COLUMNS_ALIASED},
                  count(m.user_id)::int AS member_count,
                  count(m.seat)::int AS seated_count
           FROM rooms r
           LEFT JOIN room_members m ON m.room_id = r.room_id
           WHERE r.is_private = false
           GROUP BY r.room_id
           ORDER BY r.created_at DESC LIMIT $1`,
          [limit],
        );
    return result.rows.map(toRoomWithCounts);
  }

  async countMembers(roomId: string): Promise<RoomCounts> {
    const result = await this.pool.query<{ member_count: string; seated_count: string }>(
      `SELECT count(*) AS member_count, count(seat) AS seated_count
       FROM room_members WHERE room_id = $1`,
      [roomId],
    );
    const row = result.rows[0];
    return {
      memberCount: Number(row?.member_count ?? 0),
      seatedCount: Number(row?.seated_count ?? 0),
    };
  }

  async findMember(roomId: string, userId: string): Promise<RoomMemberRecord | null> {
    const result = await this.pool.query<MemberRow>(
      `SELECT ${MEMBER_COLUMNS} FROM room_members WHERE room_id = $1 AND user_id = $2`,
      [roomId, userId],
    );
    return result.rows[0] ? toMember(result.rows[0]) : null;
  }

  async listMembers(roomId: string): Promise<RoomMemberRecord[]> {
    const result = await this.pool.query<MemberRow>(
      `SELECT ${MEMBER_COLUMNS} FROM room_members
       WHERE room_id = $1 ORDER BY joined_at ASC`,
      [roomId],
    );
    return result.rows.map(toMember);
  }

  async addMember(input: NewRoomMember): Promise<RoomMemberRecord> {
    return withTransaction(this.pool, async (client) => {
      const roomResult = await client.query<{ config: RoomConfig }>(
        'SELECT config FROM rooms WHERE room_id = $1 FOR UPDATE',
        [input.roomId],
      );
      if (!roomResult.rows[0]) throw new Error('牌室不存在');

      const existing = await client.query<MemberRow>(
        `SELECT ${MEMBER_COLUMNS} FROM room_members WHERE room_id = $1 AND user_id = $2`,
        [input.roomId, input.userId],
      );
      if (existing.rows[0]) return toMember(existing.rows[0]);

      const waitingLimit = input.waitingLimit ?? roomResult.rows[0].config?.waitingLimit ?? 20;
      const waiting = await client.query<{ count: string }>(
        `SELECT count(*) FROM room_members WHERE room_id = $1 AND seat IS NULL`,
        [input.roomId],
      );
      if (Number(waiting.rows[0]?.count ?? 0) >= waitingLimit) {
        throw new RoomFullError();
      }

      try {
        const inserted = await client.query<MemberRow>(
          `INSERT INTO room_members (room_id, user_id, nickname_snapshot, joined_at)
           VALUES ($1, $2, $3, $4)
           RETURNING ${MEMBER_COLUMNS}`,
          [input.roomId, input.userId, input.nickname, input.joinedAt],
        );
        return toMember(inserted.rows[0]);
      } catch (error) {
        // 同一用户并发加入：唯一约束裁决，返回先写入的记录。
        if (isUniqueViolation(error)) {
          const concurrent = await client.query<MemberRow>(
            `SELECT ${MEMBER_COLUMNS} FROM room_members WHERE room_id = $1 AND user_id = $2`,
            [input.roomId, input.userId],
          );
          if (concurrent.rows[0]) return toMember(concurrent.rows[0]);
        }
        throw error;
      }
    });
  }

  async removeMember(roomId: string, userId: string): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async setSeat(
    roomId: string,
    userId: string,
    seat: SeatPosition | null,
  ): Promise<RoomMemberRecord | null> {
    try {
      const result = await this.pool.query<MemberRow>(
        `UPDATE room_members
         SET seat = $3, ready = false
         WHERE room_id = $1 AND user_id = $2
         RETURNING ${MEMBER_COLUMNS}`,
        [roomId, userId, seat],
      );
      return result.rows[0] ? toMember(result.rows[0]) : null;
    } catch (error) {
      if (isUniqueViolation(error)) throw new SeatTakenError();
      throw error;
    }
  }

  async setReady(
    roomId: string,
    userId: string,
    ready: boolean,
  ): Promise<RoomMemberRecord | null> {
    const result = await this.pool.query<MemberRow>(
      `UPDATE room_members
       SET ready = $3 AND seat IS NOT NULL
       WHERE room_id = $1 AND user_id = $2
       RETURNING ${MEMBER_COLUMNS}`,
      [roomId, userId, ready],
    );
    return result.rows[0] ? toMember(result.rows[0]) : null;
  }
}
