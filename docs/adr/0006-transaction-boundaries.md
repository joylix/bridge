# ADR-0006：开局、事件与裁判操作的事务边界

- 状态：已接受
- 日期：2026-10-28
- 决策人：产品 / 开发
- 关联：`docs/桥牌软件需求规格说明书.txt`（V0.7）5.2、5.3、5.5、6.7、6.8、6.11、附录 A 第 21、23、24 条；`docs/adr/0004-room-nature-authorization.md`、`docs/adr/0007-projection.md`

## 背景

SRS V0.7 要求开局、发牌、重发、结算与裁判操作在并发下保持一致。单机 store 可以用内存状态保证顺序；联网后必须用数据库事务、唯一约束与版本号裁决，否则会出现：

- 两个室主同时点【开始】，生成两套牌；
- 同一 `TableBoard` 被两个裁判同时改分，历史丢失；
- 事件已广播但快照未写，重连后状态倒退；
- 重复提交 `start` 或重复 `play.card`，同一动作执行两次。

本 ADR 冻结事务边界、幂等键、并发控制与事件写入顺序；具体 SQL 见 `src/db/migrations/0000_init.sql`。

## 裁决

### D1 命令信封与幂等

所有写命令必须携带：

```text
commandId（客户端生成，8–64 字符）
expectedVersion（可选，乐观并发）
sessionId / tableId（作用域）
payload
```

1. `commands` 表以 `command_id` 为主键，保存 `request_hash`（规范化请求的 sha256）、`status`、`result`。
2. 同一 `commandId` + 相同 `requestHash` 重复提交：直接返回已保存结果，不重复执行。
3. 同一 `commandId` + 不同 `requestHash`：拒绝，返回 `VALIDATION_FAILED`，不得覆盖原结果。
4. 事务提交前 `commands.status=processing`；成功后写 `completed` 与结果；失败写 `failed` 并允许客户端用新 `commandId` 重试。
5. 命令处理器必须把“幂等检查 + 状态变更 + 事件写入 + 快照更新”放在同一事务内。

### D2 开局事务

点击【开始】后，单事务完成：

1. 锁定 Session 行（`SELECT ... FOR UPDATE`）；
2. 移出未举手真人；
3. 按规则补 AI；
4. 校验最低真人数；
5. 锁定 `systemDeclarations`；
6. 锁定座位；
7. 创建 `Deal`（队式赛同一副分发到各桌）；
8. 写 `Session.sessionStatus=starting`、`scoringEligibility` 初始值、`roomNature` 快照；
9. 写 `session.start` 事件与 `lastSeq`；
10. 提交后广播开局。

任一步失败整体回滚；失败后 Session 保持 `preparing`，不产生半套牌。重复 `start` 由 D1 幂等返回同一结果。

### D3 发牌与全桌重发

1. 单桌：`Deal` + 一个 `TableBoard` 同事务创建。
2. 队式赛：同一 `Deal` 的所有 `TableBoard` 同事务创建；不允许只创建一部分。
3. 重发必须全桌一起：
   - 事务内锁定该 `Deal` 的所有 `TableBoard`；
   - 旧 `Deal.supersededByDealId` 指向新 `Deal`，旧事件标 `supersededByEventId`，不删除；
   - 新 `Deal` 重新发牌，重置各桌 `lastSeq`；
   - 提交后广播 `deal.created`（仅 DIRECTOR）。
4. 若重发无法整体完成：回滚到重发前；无法回滚时 Session 标 `REDEAL_PENDING`，禁止结算，等待管理员裁决，写审计。

### D4 叫牌/出牌命令

1. 命令进入时锁定 `TableBoard` 行（或比较 `version`）。
2. 校验 `expectedVersion`：不匹配返回 `DIRECTOR_OP_CONFLICT`（裁判操作）或 `VALIDATION_FAILED`（普通动作），不得静默覆盖。
3. 领域层校验叫牌/出牌合法性；非法返回 `BID_ILLEGAL / DOUBLE_ILLEGAL / REDOUBLE_ILLEGAL / PLAY_ILLEGAL / PLAY_REVOKE_PENDING / DIRECTOR_REQUIRED`。
4. 同一事务内：
   - 追加事件（`stream_id=tableBoardId`，`seq=lastSeq+1`）；
   - 更新 `TableBoard.record / version / last_seq`；
   - 更新 `Session.last_seq`（如为盘级事件）；
   - 写 `commands.result`。
5. `UNIQUE(stream_id, seq)` 是最终防线；重复 `seq` 必须失败并回滚。

### D5 结算与 SessionBoard

1. 副结算在单事务内：写 `board.completed / score.computed` 事件、更新 `TableBoard`、重算受影响的 `SessionBoard`。
2. `SessionBoard` 是派生视图：删除后可由 `TableBoard` 重算；不得作为 IMP/队分唯一副本。
3. 重算快照必须含 `rulesetId / scoringProfile / impTableVersion / tableBoards[].rawScoreVersion / systemDeclarations / effectiveSystems`。
4. `CANCELLED / INCOMPLETE / REOPENED` 时 `teamImp=null`，不得写 0；`PASSED_OUT` 按 0 分差计算。
5. 同一 `Deal` 的所有 `TableBoard` 完成后才开放回放/导出；结算事务不改变该门禁。

### D6 裁判操作串行化

1. 同一 `TableBoard` 的取消/调整/重开/重发必须串行化：`SELECT ... FOR UPDATE` 或 `version` 乐观锁。
2. 并发冲突返回 `DIRECTOR_OP_CONFLICT`；客户端必须重新读取最新状态后重试。
3. 调整分：
   - 追加 `adjustHistory`，最后一条等于 `adjustment`；
   - `score.nsRaw` 必须等于 `adjustment.afterValue`；
   - 重算 `SessionBoard`；
   - 不得直接改 IMP。
4. 已 `CANCELLED` 再调整：先写 `REOPEN` 审计，否则返回 `BOARD_CANCELLED_ADJUST_FORBIDDEN`。
5. 重赛必须全桌 `REOPENED`，不得单桌重赛。
6. 敏感操作二次确认、原因、前后值、操作人、时间写 `audit_logs`；审计只追加。

### D7 事件写入顺序与恢复

1. 状态变更与事件写入在同一事务；禁止“先广播、后落库”。
2. 事件 `seq` 在 `streamId` 内严格递增；`Session.lastSeq` 与已提交事件最大值一致。
3. 重发/更正用 `correctsEventId` 与 `supersededByEventId` 表达；旧事件保留，可重放事件限定为未被 `supersededBy` 的事件。
4. 服务重启后按 `lastSeq + 快照 + 未 superseded 事件` 恢复；损坏快照回退到最近一致快照并重放。
5. 重放结果与历史快照不一致时，以历史快照为准，新算结果标记差异并告警，不静默覆盖。

### D8 隔离级别与重试

1. 默认 `READ COMMITTED`；一致性依赖行锁、唯一约束与版本号，不依赖 `SERIALIZABLE`。
2. 死锁/序列化失败可自动重试，但必须复用同一 `commandId`，避免重复执行。
3. 任何重试都不得跳过 `expectedVersion` 校验。

## 后果

- `commands`、`events`、`table_boards`、`session_boards` 的唯一约束与 `version/last_seq` 字段进入 Schema。
- `src/server/ws.ts` 只做协议校验与转发；幂等、锁与事务在命令处理器内实现。
- M7 必须为 `session.start / auction.call / play.card / board.settle` 写集成测试：重复命令、并发命令、重启恢复。
- 新增错误码使用：`DIRECTOR_OP_CONFLICT`、`BOARD_CANCELLED_ADJUST_FORBIDDEN`、`REDEAL_PENDING`。

## 未决

- 事件快照频率（每副/每 N 事件）在 M7 压测后确定。
- 跨进程广播（Redis pub/sub）在单机演示后再引入；单机先用进程内订阅。
- `commands.requestHash` 的规范化规则（字段排序、可选字段省略）在命令处理器实现时冻结。
