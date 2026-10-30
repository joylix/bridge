/**
 * PostgreSQL Schema（M5 平台契约）。
 *
 * 设计依据：
 * - SRS V0.7 0.1 / 3.1 / 5.3 / 5.5 / 8.9 / 附录 B；
 * - `docs/adr/0004-room-nature-authorization.md`；
 * - `docs/adr/0006-transaction-boundaries.md`；
 * - `docs/adr/0007-projection.md`。
 *
 * 约定：
 * - 枚举用 text + CHECK，不用 PG enum，便于后续加值；
 * - 所有时间戳带时区；
 * - 事件只追加；`superseded_by_event_id` 标记而非删除；
 * - 唯一约束是并发裁决的唯一依据，应用层不得先查后写。
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const accounts = pgTable(
  'accounts',
  {
    userId: uuid('user_id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 254 }).notNull(),
    username: varchar('username', { length: 12 }).notNull(),
    usernameNormalized: varchar('username_normalized', { length: 12 }).notNull(),
    nickname: varchar('nickname', { length: 32 }).notNull(),
    nicknameNormalized: varchar('nickname_normalized', { length: 32 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    role: varchar('role', { length: 16 }).notNull().default('user'),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    nicknameChangeCount: integer('nickname_change_count').notNull().default(0),
    nicknameChangedAt: timestamp('nickname_changed_at', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('accounts_email_uq').on(table.email),
    uniqueIndex('accounts_email_lower_uq').on(sql`lower(${table.email})`),
    uniqueIndex('accounts_username_uq').on(table.username),
    uniqueIndex('accounts_username_normalized_uq').on(table.usernameNormalized),
    uniqueIndex('accounts_nickname_uq').on(table.nickname),
    uniqueIndex('accounts_nickname_normalized_uq').on(table.nicknameNormalized),
    check('accounts_role_chk', sql`${table.role} in ('user', 'admin')`),
    check('accounts_status_chk', sql`${table.status} in ('active', 'suspended', 'deleted')`),
    check(
      'accounts_nickname_change_count_chk',
      sql`${table.nicknameChangeCount} between 0 and 3`,
    ),
  ],
);

export const rooms = pgTable(
  'rooms',
  {
    roomId: uuid('room_id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 64 }).notNull(),
    roomNature: varchar('room_nature', { length: 16 }).notNull(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => accounts.userId),
    status: varchar('status', { length: 16 }).notNull().default('waiting'),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    isPrivate: boolean('is_private').notNull().default(false),
    passwordHash: text('password_hash'),
    createdAt,
    updatedAt,
  },
  (table) => [
    check(
      'rooms_nature_chk',
      sql`${table.roomNature} in ('practice', 'casual', 'competitive')`,
    ),
    check('rooms_status_chk', sql`${table.status} in ('waiting', 'playing', 'frozen')`),
    index('rooms_public_created_idx').on(table.isPrivate, table.createdAt),
  ],
);

export const roomMembers = pgTable(
  'room_members',
  {
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.roomId, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => accounts.userId, { onDelete: 'cascade' }),
    /** 加入时的昵称快照；改名功能落地后需同步刷新或改为实时解析。 */
    nicknameSnapshot: varchar('nickname_snapshot', { length: 32 }).notNull(),
    seat: varchar('seat', { length: 1 }),
    ready: boolean('ready').notNull().default(false),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.roomId, table.userId] }),
    uniqueIndex('room_members_seat_uq')
      .on(table.roomId, table.seat)
      .where(sql`${table.seat} is not null`),
    index('room_members_user_idx').on(table.userId),
    index('room_members_room_joined_idx').on(table.roomId, table.joinedAt),
    check('room_members_seat_chk', sql`${table.seat} in ('N', 'E', 'S', 'W')`),
    check('room_members_ready_chk', sql`not ${table.ready} or ${table.seat} is not null`),
  ],
);

export const authSessions = pgTable(
  'auth_sessions',
  {
    tokenHash: varchar('token_hash', { length: 64 }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => accounts.userId, { onDelete: 'cascade' }),
    createdAt,
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    ip: varchar('ip', { length: 64 }),
    userAgent: varchar('user_agent', { length: 256 }),
  },
  (table) => [
    index('auth_sessions_user_idx').on(table.userId, table.expiresAt),
    index('auth_sessions_expires_idx').on(table.expiresAt),
    check('auth_sessions_expiry_chk', sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    sessionId: uuid('session_id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.roomId),
    /** Session 快照；创建后不可改。 */
    roomNature: varchar('room_nature', { length: 16 }).notNull(),
    /** 玩法与房间配置快照；开局按此执行，不受牌室后续配置影响。 */
    gameplay: varchar('gameplay', { length: 8 }).notNull().default('single'),
    roomConfig: jsonb('room_config').$type<Record<string, unknown>>().notNull().default({}),
    sessionStatus: varchar('session_status', { length: 16 }).notNull().default('preparing'),
    scoringEligibility: varchar('scoring_eligibility', { length: 16 }).notNull().default('pending'),
    scoringEligibilitySnapshot: jsonb('scoring_eligibility_snapshot').$type<Record<string, unknown>>(),
    teamTableMapping: jsonb('team_table_mapping').$type<Record<string, unknown>>(),
    /** 已提交事件的最大 seq；重连与快照恢复使用。 */
    lastSeq: integer('last_seq').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    check(
      'sessions_nature_chk',
      sql`${table.roomNature} in ('practice', 'casual', 'competitive')`,
    ),
    check('sessions_gameplay_chk', sql`${table.gameplay} in ('single', 'teams')`),
    check(
      'sessions_status_chk',
      sql`${table.sessionStatus} in ('preparing', 'starting', 'playing', 'paused', 'completed', 'aborted')`,
    ),
    check(
      'sessions_eligibility_chk',
      sql`${table.scoringEligibility} in ('pending', 'eligible', 'ineligible')`,
    ),
    index('sessions_room_idx').on(table.roomId, table.createdAt),
    // 同一牌室同时最多一个活动 Session；completed / aborted 后可再开下一盘。
    uniqueIndex('sessions_room_active_uq')
      .on(table.roomId)
      .where(sql`${table.sessionStatus} in ('preparing', 'starting', 'playing', 'paused')`),
  ],
);

export const sessionPairs = pgTable(
  'session_pairs',
  {
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    pairId: uuid('pair_id').notNull(),
    playerIds: jsonb('player_ids').$type<string[]>().notNull().default([]),
    /** declaredSystem / effectiveSystem / explanationSource / fallbackToDefault。 */
    systemDeclarations: jsonb('system_declarations').$type<Record<string, unknown>>(),
    createdAt,
  },
  (table) => [
    uniqueIndex('session_pairs_session_pair_uq').on(table.sessionId, table.pairId),
  ],
);

export const gameTables = pgTable(
  'game_tables',
  {
    tableId: uuid('table_id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    tableNumber: integer('table_number').notNull(),
    camp: varchar('camp', { length: 8 }).notNull().default('none'),
    createdAt,
  },
  (table) => [
    uniqueIndex('game_tables_session_number_uq').on(table.sessionId, table.tableNumber),
    check('game_tables_camp_chk', sql`${table.camp} in ('red', 'blue', 'none')`),
    check('game_tables_number_chk', sql`${table.tableNumber} > 0`),
  ],
);

export const deals = pgTable(
  'deals',
  {
    dealId: uuid('deal_id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    boardNumber: integer('board_number').notNull(),
    dealer: varchar('dealer', { length: 1 }).notNull(),
    vulnerability: varchar('vulnerability', { length: 4 }).notNull(),
    /** 开局四手牌 PBN [Deal] 值；只对授权角色投影。 */
    pbn: text('pbn').notNull(),
    /** 全桌重发时旧 Deal 标记为被替代，不原地改牌。 */
    supersededByDealId: uuid('superseded_by_deal_id'),
    createdAt,
  },
  (table) => [
    uniqueIndex('deals_session_board_uq').on(table.sessionId, table.boardNumber),
    check('deals_dealer_chk', sql`${table.dealer} in ('N', 'E', 'S', 'W')`),
    check(
      'deals_vulnerability_chk',
      sql`${table.vulnerability} in ('NONE', 'NS', 'EW', 'ALL')`,
    ),
    check('deals_board_number_chk', sql`${table.boardNumber} > 0`),
  ],
);

export const tableBoards = pgTable(
  'table_boards',
  {
    tableBoardId: uuid('table_board_id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.dealId),
    tableId: uuid('table_id')
      .notNull()
      .references(() => gameTables.tableId),
    status: varchar('status', { length: 16 }).notNull(),
    rawScore: integer('raw_score'),
    originalRawScore: integer('original_raw_score'),
    /** 完整 TableBoard 记录（Schema 1.1），作为事件流的投影结果。 */
    record: jsonb('record').$type<Record<string, unknown>>().notNull(),
    adjustment: jsonb('adjustment').$type<Record<string, unknown>>(),
    adjustHistory: jsonb('adjust_history').$type<Record<string, unknown>[]>(),
    /** 乐观并发版本；裁判操作与出牌命令用它拒绝过期写入。 */
    version: integer('version').notNull().default(0),
    lastSeq: integer('last_seq').notNull().default(0),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('table_boards_session_deal_table_uq').on(
      table.sessionId,
      table.dealId,
      table.tableId,
    ),
    check(
      'table_boards_status_chk',
      sql`${table.status} in ('IN_PROGRESS', 'PLAYED', 'PASSED_OUT', 'CANCELLED', 'ADJUSTED', 'INCOMPLETE', 'REOPENED')`,
    ),
    check(
      'table_boards_no_score_chk',
      sql`${table.status} not in ('CANCELLED', 'INCOMPLETE', 'REOPENED') or ${table.rawScore} is null`,
    ),
    check('table_boards_version_chk', sql`${table.version} >= 0 and ${table.lastSeq} >= 0`),
    index('table_boards_session_status_idx').on(table.sessionId, table.status),
  ],
);

export const sessionBoards = pgTable(
  'session_boards',
  {
    sessionBoardId: uuid('session_board_id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.dealId),
    status: varchar('status', { length: 16 }).notNull(),
    teamImp: integer('team_imp'),
    /** 重算快照：rawScoreVersion / impTableVersion / rulesetId / systemDeclarations。 */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt,
  },
  (table) => [
    uniqueIndex('session_boards_session_deal_uq').on(table.sessionId, table.dealId),
    check(
      'session_boards_status_chk',
      sql`${table.status} in ('PENDING', 'COMPLETE', 'INCOMPLETE', 'CANCELLED', 'ADJUSTED', 'REOPENED')`,
    ),
    check(
      'session_boards_no_imp_chk',
      sql`${table.status} not in ('CANCELLED', 'INCOMPLETE', 'REOPENED') or ${table.teamImp} is null`,
    ),
  ],
);

export const events = pgTable(
  'events',
  {
    eventId: uuid('event_id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    /** 桌副事件流 = tableBoardId；盘级事件 = `session:<sessionId>`。 */
    streamId: text('stream_id').notNull(),
    tableBoardId: uuid('table_board_id').references(() => tableBoards.tableBoardId),
    seq: integer('seq').notNull(),
    type: varchar('type', { length: 32 }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    actor: jsonb('actor').$type<Record<string, unknown>>().notNull(),
    audience: jsonb('audience').$type<string[]>().notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    /** 更正事件指向被更正事件；被更正事件保留并标记 supersededBy。 */
    correctsEventId: uuid('corrects_event_id'),
    supersededByEventId: uuid('superseded_by_event_id'),
    createdAt,
  },
  (table) => [
    uniqueIndex('events_stream_seq_uq').on(table.streamId, table.seq),
    index('events_session_time_idx').on(table.sessionId, table.occurredAt),
    index('events_table_board_seq_idx').on(table.tableBoardId, table.seq),
    check('events_seq_chk', sql`${table.seq} > 0`),
  ],
);

export const commands = pgTable(
  'commands',
  {
    commandId: varchar('command_id', { length: 64 }).primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => accounts.userId),
    type: varchar('type', { length: 32 }).notNull(),
    /** 请求体规范化后的 sha256；同一 commandId 不同请求必须拒绝。 */
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('processing'),
    result: jsonb('result').$type<Record<string, unknown>>(),
    createdAt,
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'commands_status_chk',
      sql`${table.status} in ('processing', 'completed', 'failed')`,
    ),
  ],
);

export const substituteInvites = pgTable(
  'substitute_invites',
  {
    inviteId: uuid('invite_id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    tableId: uuid('table_id')
      .notNull()
      .references(() => gameTables.tableId),
    targetUserId: uuid('target_user_id')
      .notNull()
      .references(() => accounts.userId),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => accounts.userId),
    status: varchar('status', { length: 16 }).notNull().default('PENDING'),
    createdAt,
    updatedAt,
  },
  (table) => [
    // SRS 5.3.1：同一目标同时只能有一个 PENDING 邀请。
    uniqueIndex('substitute_invites_pending_target_uq')
      .on(table.targetUserId)
      .where(sql`${table.status} = 'PENDING'`),
    check(
      'substitute_invites_status_chk',
      sql`${table.status} in ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED')`,
    ),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    auditId: uuid('audit_id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => accounts.userId),
    action: varchar('action', { length: 64 }).notNull(),
    targetType: varchar('target_type', { length: 32 }).notNull(),
    targetId: text('target_id').notNull(),
    reason: text('reason'),
    before: jsonb('before').$type<Record<string, unknown>>(),
    after: jsonb('after').$type<Record<string, unknown>>(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('audit_logs_target_idx').on(table.targetType, table.targetId, table.at)],
);

export type AccountRow = typeof accounts.$inferSelect;
export type AuthSessionRow = typeof authSessions.$inferSelect;
export type RoomRow = typeof rooms.$inferSelect;
export type RoomMemberRow = typeof roomMembers.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type TableBoardRow = typeof tableBoards.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type AuditLogRow = typeof auditLogs.$inferSelect;
