# M5 平台契约与工程骨架

- 状态：契约与骨架完成（2026-10-28）；OpenAPI 仅覆盖当前已实现端点，业务端点随 M6/M7 增补
- 目标：让服务端可开工，冻结 ADR、数据库、协议、投影与测试计划
- 非目标：账号/登录、房间页面、实时对局业务、队式赛调度
- 关联：`docs/adr/0004-room-nature-authorization.md`、`docs/adr/0006-transaction-boundaries.md`、`docs/adr/0007-projection.md`、`docs/adr/0005-wbf-rules-scoring.md`、`docs/adr/0008-record-schema-1.1.md`、`docs/test-plan.md`、`docs/openapi.yaml`

## 1. 交付内容

| 类别 | 文件 | 说明 |
| --- | --- | --- |
| ADR | `docs/adr/0004-room-nature-authorization.md` | 四维状态、改分授权、成绩资格 |
| ADR | `docs/adr/0006-transaction-boundaries.md` | 开局/发牌/结算事务、幂等、裁判并发 |
| ADR | `docs/adr/0007-projection.md` | 字段级投影、转播延迟、WS 订阅 |
| 测试计划 | `docs/test-plan.md` | 性能、并发、DDS 降级、安全渗透 |
| OpenAPI | `docs/openapi.yaml` | 健康检查、就绪检查、版本元数据、错误信封 |
| 错误码 | `src/shared/errors.ts` | SRS 附录 B 全量 + 协议层错误码 |
| 协议 | `src/shared/protocol.ts` | 命令信封、payload、订阅、事件线上信封 |
| 数据库 | `src/db/schema.ts` | Drizzle Schema，与 DDL 一一对应 |
| 迁移 | `src/db/migrations/0000_init.sql` | PostgreSQL 16 初始 Schema |
| 迁移器 | `src/db/migrate.ts`、`scripts/dbMigrate.ts` | 按文件名顺序执行，事务 + `schema_migrations` |
| 服务端 | `src/server/app.ts` | Fastify 骨架、健康检查、统一错误信封 |
| 服务端 | `src/server/ws.ts` | 连接鉴权、命令转发、订阅过滤、心跳 |
| 服务端 | `src/server/config.ts` | 环境变量与默认值 |
| 服务端 | `src/server/index.ts` | 启动与优雅关闭 |
| 投影 | `src/domain/authorization/projection.ts` | 角色 × 字段矩阵、释放门禁 |

## 2. 契约要点

### 2.1 四维状态

`roomNature / sessionStatus / scoringEligibility / boardStatus` 分别存储、分别快照：

- `roomNature` 在 Session 内不可改；改分权限读快照；
- `competitive` 初始 `pending`，Session 完成时按“整盘有无真人有效动作”判定；
- `boardStatus` 使用 Schema 1.1 的 7 状态；
- `CANCELLED / INCOMPLETE / REOPENED` 的 `rawScore/teamImp` 必须为 `null`。

### 2.2 命令信封

```ts
{
  kind: 'command',
  protocolVersion: '1.0',
  commandId: string,          // 8–64 字符，幂等键
  type: CommandType,
  sessionId: string,
  tableId?: string,
  expectedVersion?: number,   // 乐观并发
  payload: unknown            // 按 type 校验
}
```

已冻结命令：`session.start / auction.call / play.card / board.settle / director.cancel / director.adjust / director.reopen / director.redeal / chat.send / substitute.invite / client.ping`。

`parseClientMessage` 校验外壳；`parseCommandPayload` 按类型校验 payload。服务端在进入业务处理器前必须同时通过两者。

### 2.3 WS 消息

客户端 → 服务端：

- `command`；
- `subscribe`（`sessionId / tableId? / audiences / lastSeq?`）；
- `ping`。

服务端 → 客户端：

- `hello`、`ack`、`error`、`event`、`subscribed`、`snapshot`、`pong`。

`publish(event)` 只向订阅命中 `sessionId + tableId + audience` 的连接推送；`deal.created` 默认只投 `DIRECTOR`。同一连接的消息按到达顺序串行处理，订阅去重且单连接上限 32 条；发送失败立即终止并移除该连接。

### 2.4 数据库

12 张表：`accounts / rooms / sessions / session_pairs / game_tables / deals / table_boards / session_boards / events / commands / substitute_invites / audit_logs`。

关键约束：

- `UNIQUE(session_id, deal_id, table_id)`；
- `UNIQUE(session_id, deal_id)`；
- `UNIQUE(stream_id, seq)`、`event_id` 主键；
- `UNIQUE(session_id, pair_id)`；
- `UNIQUE(target_user_id) WHERE status='PENDING'`；
- 7 状态 CHECK、无成绩空分 CHECK、四维状态 CHECK。

### 2.5 投影

`projectBoardForViewer` 是唯一出口：

- 本桌玩家：本人暗手 + 已翻开明手；
- 旁观/转播：释放后仅明手；
- 室主：本桌按旁观投影；
- 管理员：四家暗手 + 审计；
- 他桌玩家：`EXPORT_FORBIDDEN`；
- 未释放：`EXPORT_NOT_RELEASED`。

`assertExportReleased` 同时检查“所有桌完成”和“延迟一副 + ≥30s”。

## 3. 运行

```bash
# 依赖
npm install

# 本机开发
npm run server:dev

# 类型/测试/契约
npm run typecheck
npm test
npm run check:phase0

# 数据库（需 PostgreSQL 16 与 DATABASE_URL）
DATABASE_URL=postgres://bridge:bridge@localhost:5432/bridge npm run db:migrate
```

环境变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 监听地址 |
| `PORT` | `3000` | 端口 |
| `DATABASE_URL` | 本机 bridge 库 | PostgreSQL 连接串 |
| `LOG_LEVEL` | `info` | `fatal…trace/silent` |
| `SPECTATOR_DELAY_MS` | `30000` | 转播最短等待 |
| `WS_ALLOWED_ORIGINS` | 空（开发放行） | 逗号分隔的 Origin 白名单 |

## 4. 验证

```text
npm run typecheck      通过
npm test               58 个测试文件 / 680 个用例通过
npm run check:phase0   17 项通过，0 警告，0 错误
```

M5 新增 6 个测试文件 / 44 个用例：

| 文件 | 覆盖 |
| --- | --- |
| `src/shared/errors.test.ts` | 错误码映射、错误信封不泄漏 |
| `src/shared/protocol.test.ts` | 命令外壳、payload、订阅、事件映射 |
| `src/server/app.test.ts` | 健康/就绪/元数据、404/500、requestId |
| `src/server/ws.test.ts` | hello/ack、非法 payload、越权 Session、订阅过滤/幂等/上限、命令串行化、Origin |
| `src/db/schema.test.ts` | 表名、唯一约束、7 状态、空分、事件只追加 |
| `src/domain/authorization/projection.test.ts` | 暗手/明手/跨桌/未释放/管理员审计 |

## 5. 已知限制与下一步

- 尚无账号与登录，`authenticate` 由测试注入；M6 接入会话与权限。
- 尚无业务命令处理器；`handleCommand` 目前由调用方注入，M7 实现开局/叫牌/出牌/结算。
- OpenAPI 只覆盖已实现端点；M6 增加账号/房间端点时同步补全。
- 单机演示先用进程内订阅；Redis pub/sub 在多进程部署时引入。
- 事件字段级裁剪（同一事件对不同受众裁剪 payload）在 M7 实现；当前先按整条事件受众过滤。

> M6 第一 / 第二 / 第三切片已补全账号 / 牌室 / Session 端点、`auth_sessions`、`accounts` 归一化字段、`room_members` 与 Session 快照字段，见 `docs/m6-accounts-rooms.md`；本文件的“尚无账号与登录”“12 张表”仅描述 M5 当时状态。
