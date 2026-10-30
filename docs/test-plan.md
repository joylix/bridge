# 测试计划（M5 基线）

- 状态：已接受（随 M5 平台契约冻结）
- 日期：2026-10-28
- 依据：`docs/桥牌软件需求规格说明书.txt`（V0.7）9、12、附录 A/C/D；`docs/adr/0004-room-nature-authorization.md`、`docs/adr/0006-transaction-boundaries.md`、`docs/adr/0007-projection.md`
- 适用：M6 账号/大厅/牌室、M7 单桌联网、M8 队式赛与裁判、M9 上线验收

## 1. 目标与门槛

测试只证明四件事：

1. **规则正确**：WBF 叫牌/出牌/计分与附录 C 表驱动一致；
2. **并发安全**：重复命令、并发裁判、重启恢复不产生双写或状态倒退；
3. **信息隔离**：未授权客户端拿不到暗手与他桌未释放结果；
4. **性能可用**：操作广播与 AI 单步达到 SRS 9.1 的 P95 目标。

阻断发布的条件：

- 任一 P0 安全用例失败；
- 附录 C 表驱动不全绿；
- 并发故障注入出现重复结算或事件 `seq` 断裂；
- 字段级投影负向用例失败。

## 2. 测试分层

| 层 | 工具 | 范围 | 运行时机 |
| --- | --- | --- | --- |
| 单元/契约 | Vitest | 领域纯函数、Schema、协议、投影矩阵 | 每次提交 |
| 服务集成 | Vitest + Fastify `inject` | HTTP 错误信封、健康检查、鉴权中间件 | 每次提交 |
| 数据库集成 | Vitest + PostgreSQL 16 | 唯一约束、事务回滚、行锁、迁移 | CI |
| WS 集成 | Vitest + `ws` | 命令信封、订阅过滤、心跳、断线重连 | CI |
| 多端 E2E | Playwright | 4 客户端单桌、2 桌队式、旁观延迟 | 每日/发布前 |
| 负载/故障 | k6 + 故障注入 | 并发开局、并发裁判、DDS 超时、进程重启 | 发布前 |
| 安全 | 手工 + 自动化脚本 | 字段级鉴权、令牌重放、越权订阅、限流 | M9 上线前 |

## 3. 性能采样

### 3.1 环境

- 单机 Docker Compose：Node.js 22、PostgreSQL 16、Redis（M7 起）；
- 4 vCPU / 8 GB 内存 / SSD；
- 客户端与服务端同机房，网络 RTT < 5ms；
- 固定随机种子，关闭调试日志。

### 3.2 指标与阈值

| 指标 | 采样 | 阈值 | 说明 |
| --- | --- | --- | --- |
| 操作广播 P95 | 每命令 1000 次 | ≤ 200ms | 从服务端接收命令到订阅客户端收到事件 |
| HTTP 读取 P95 | 1000 次 | ≤ 150ms | 成绩单/最近对局 |
| AI 叫牌 P95（普通） | 固定种子 1000 副 | ≤ 2s | 不含 DDS 深搜 |
| AI 出牌 P95（普通） | 固定种子 1000 副 | ≤ 3s | DDS 可用时 |
| DDS 回退率 | 1000 副 | ≤ 5% | 超时/失败回退启发式 |
| 事件写入 P95 | 1000 次 | ≤ 50ms | 单条事件 + 快照同事务 |
| 重连恢复 P95 | 100 次 | ≤ 1s | `lastSeq` + 快照 |

超过阈值必须记录硬件、数据量、种子与火焰图；不得只报平均值。

## 4. 并发与故障注入

| 用例 | 注入 | 期望 |
| --- | --- | --- |
| 重复 `start` | 同一 `commandId` 并发 10 次 | 只生成一套牌；其余返回同一结果 |
| 重复 `play.card` | 同一 `commandId` 并发 10 次 | 只落一张牌、一条事件 |
| 并发改分 | 两个裁判同时调整同一副 | 一个成功，另一个 `DIRECTOR_OP_CONFLICT`；历史不丢 |
| 并发取消/调整 | 取消与调整同时提交 | 串行化；已取消未 REOPEN 返回 `BOARD_CANCELLED_ADJUST_FORBIDDEN` |
| 全桌重发失败 | 第二桌写入失败 | 整体回滚；或 `REDEAL_PENDING` 且禁止结算 |
| 事件 seq 冲突 | 两进程写同一 `streamId` | 唯一约束拒绝，事务回滚 |
| 进程重启 | 提交后立即 kill | `lastSeq + 快照` 恢复，无重复事件 |
| 快照损坏 | 篡改快照 | 回退最近一致快照 + 重放，告警不静默 |

## 5. 安全与信息隔离

必须证明以下负向用例全部失败（即攻击不成功）：

1. 参赛玩家直连 WS，订阅他桌 `tableId` → `FORBIDDEN`；
2. 参赛玩家请求他桌记录 → `EXPORT_FORBIDDEN`，响应不含“是否存在”；
3. 旁观者在释放前请求回放 → `EXPORT_NOT_RELEASED`；
4. 旁观者收到的事件不含任何暗手；
5. 玩家收到的事件只含本人座位暗手与已翻开明手；
6. 重放旧令牌/旧 `lastSeq` 不能拿到撤权后的新事件；
7. 修改 `userId`/`sessionId` 参数不能越权；
8. 错误响应不含 SQL、堆栈、完整牌型或他桌结果；
9. 缓存键未按 `audience` 隔离时，测试必须能发现；
10. `deal.created` 不会推送给非 DIRECTOR。

## 6. 数据与迁移

- 迁移在空库与已有库各执行一次，结果一致；
- 唯一约束在并发插入下生效；
- 备份/恢复后 `events.seq` 连续、`lastSeq` 一致；
- 注销/匿名化后原始分与 IMP 保留匿名化，`email/username/passwordHash` 删除；
- 留存任务按 SRS 9.6 到期清理，审计 ≥3 年不可删。

## 7. 回归基线

每次合并必须保持：

```bash
npm run typecheck
npm test
npm run check:phase0
```

M5 新增契约测试：

- `src/shared/errors.test.ts`：错误码/HTTP 状态/错误信封不泄漏；
- `src/shared/protocol.test.ts`：命令信封、payload、订阅、事件映射；
- `src/server/app.test.ts`：健康检查、元数据、404/500 信封、requestId；
- `src/server/ws.test.ts`：hello/ack、非法 payload、越权 Session、订阅过滤/幂等/上限、命令串行化、Origin；
- `src/db/schema.test.ts`：表名、唯一约束、7 状态、空分约束、事件只追加；
- `src/domain/authorization/projection.test.ts`：暗手/明手/跨桌/未释放/管理员审计。

M6 第一切片新增账号 / 牌室测试：

- `src/domain/account/naming.test.ts`：用户名格式与保留名、昵称显示宽度与归一化、邮箱、密码；
- `src/auth/password.test.ts`：scrypt 格式、随机盐、正确/错误/损坏哈希；
- `src/auth/service.test.ts`：注册唯一冲突、登录统一错误码、封禁/删除、会话过期与登出；
- `src/rooms/service.test.ts`：默认配置、私有房、字段校验、列表过滤、404 语义；
- `src/server/routes/accounts-rooms.test.ts`：Cookie/Bearer 鉴权、`/me`、登录失败、登出、牌室创建/列表/详情与越权；
- `src/db/schema.test.ts`：归一化字段、会话表只存摘要、牌室状态/私有/密码 DDL。

M6 第二切片新增等候区 / 座位测试：

- `src/rooms/service.test.ts`：加入与幂等、等候区上限、私有房密码、离开释放座位、座位冲突/换座、室主拖拽、举手与离座、状态门禁；
- `src/server/routes/accounts-rooms.test.ts`：加入/落座/举手/离座/离开流程、密码错误、座位冲突与越权、未加入/未落座、未登录；
- `src/db/schema.test.ts`：成员复合主键、座位部分唯一索引、举手约束、外键级联与索引。

M6 第三切片新增 Session / 开局准备测试：

- `src/sessions/service.test.ts`：创建快照、初始成绩资格、重复创建幂等、取消与再开一盘、权限、私有房可见性、四席齐全 / 最低真人数、队式赛未实现、非 preparing 拒绝；
- `src/server/routes/sessions.test.ts`：创建 / 读取 / precheck / abort 流程、重复创建幂等、非室主与成员越权、私有房 404、未登录与非法 UUID；
- `src/db/schema.test.ts`：Session 玩法 / 配置快照、活动 Session 部分唯一索引。

安全回归门槛（M6）：

- 未登录访问受保护端点返回 `401 AUTH_REQUIRED`；
- 登录失败不区分用户不存在与密码错误，均返回 `401 INVALID_CREDENTIALS`；
- 响应与日志不得出现 `passwordHash`、房间密码或其哈希；
- 私有牌室不出现在公开列表，非室主/非管理员/非成员读取返回 `404 NOT_FOUND`；
- 会话 Cookie 必须为 `HttpOnly + SameSite=Lax`，生产环境必须带 `Secure`；
- 同一牌室同一座位只能一人：并发落座只能一个成功，其余 `409 SEAT_TAKEN`；
- 普通成员不能通过 `userId` 操作他人座位，返回 `403 FORBIDDEN`；
- 非 `waiting` 状态的牌室拒绝加入/离开/落座/举手，返回 `409 ROOM_NOT_WAITING`；
- 同一牌室同时只能有一个活动 Session：并发创建只能产生一条记录，重复创建返回同一 `sessionId`；
- Session 快照不可变：`roomNature`、`gameplay`、`room_config` 在创建时固化，响应不得回显可变牌室配置替代快照；
- 非室主 / 非管理员不能创建、取消或列出 Session，返回 `403 FORBIDDEN`；
- 非 `preparing` 的 Session 拒绝 `precheck` / `abort`，返回 `409 SESSION_NOT_PREPARING`。

## 8. 报告

测试报告至少包含：

- 输入、期望、实际、种子、硬件；
- 失败用例的 `requestId` 与事件 `eventId`；
- 性能分位数与采样量；
- 未通过项的阻断范围（对应 SRS 第 12 章证据表）；
- 与上一基线相比的回归项。

报告不得只写“全部通过”；附录 C 必须逐项列出输入/期望/实际。
