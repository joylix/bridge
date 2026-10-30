# 桥牌 V1 开发计划（草案）

- 状态：已确认，进入执行
- 日期：2026-10-28
- 依据：`docs/桥牌软件需求规格说明书.txt`（V0.7）、`docs/adr/0003-srs-v05-alignment.md`、`docs/brules-v0.5/`（Phase 0–4A）、`docs/桥牌规则与数据交换规范（提案 v2）.md`
- 当前基线：TypeScript + Vue 3 + Pinia 单机 MVP + Node.js 服务端；65 个测试文件 / 755 个用例通过；`check:phase0` 17 项通过；Sprint 1（Schema 1.1、WBF 计分、reducer、事件流）、M5（平台契约与工程骨架）与 M6 第一 / 第二 / 第三切片（账号 / 会话 / 牌室 / 等候区 / 座位 / Session 快照与前置校验）已完成

## 0. 已确认决策（2026-10-28）

1. 产品目标：按 **SRS V0.7 联网平台** 推进。
2. 取消副：采用 **SRS V0.7 的 `CANCELLED → rawScore=null`**，修订 ADR-0003 D6。
3. 技术栈：**Node.js + Fastify + PostgreSQL + Drizzle + `ws`**。
4. 首个可演示目标：**单桌联网可玩**；队式赛随后。
5. 排期：**单人开发**，按约 8–10 个月规划。

## 1. 结论

SRS V0.7 的目标是**联网桥牌平台**，而当前仓库是**单机人机对战 MVP**。两者之间不是“补几个页面”，而是缺少服务端、账号体系、持久化、事件流、多桌聚合与权限投影。

建议按“**先封口领域模型，再搭平台骨架，最后做实时对局**”的顺序推进：

1. 用 3–4 周完成 **Profile S+ 领域封口**：记录 Schema 1.1、`SessionBoard`、WBF IMP 表、事件流、裁判状态与调整分；
2. 用 2 周完成 **平台架构与契约冻结**：ADR-0004/0005/0006/0007、数据库、HTTP/WS 协议、测试计划；
3. 再进入 SRS 的三阶段交付：账号/大厅/牌室 → 实时单桌/队式赛 → 安全与上线验收。

不建议现在直接写账号和房间页面。当前 `store/game.ts` 同时承担规则、流程、AI 调度和 UI 状态，若不在服务端开发前抽出无界面领域层，后面会被迫重写。

## 2. SRS V0.7 回顾

### 2.1 产品目标

线上桥牌对局软件：注册登录 → 大厅 → 牌室 → 单桌或红蓝队式赛 → 叫牌/出牌/结算 → 成绩单、回放、导出；支持 AI 补位、超时托管、裁判干预、旁观与延迟转播、四层聊天和叫牌体系披露。

### 2.2 必须遵守的硬约束

- 数据模型：`Account → Lobby → Room → Session → Deal → TableBoard`，`SessionBoard` 为派生聚合。
- 四维分离：`roomNature / sessionStatus / scoringEligibility / boardStatus` 独立存储、独立授权、独立快照。
- 计分：合约分必算；队式赛 `teamImp = impTable(redTeamRaw)`，逐副换算、逐副累加；V1 不启用 MP/VP。
- 规则：固定 `wbf-laws-2017`；引擎只判合法/非法，撤回、罚分、调整、取消一律转裁判。
- 体系：`declaredSystem / effectiveSystem / explanationSource` 三层分离；AI 只执行内置已编译体系；回退默认必须披露。
- 权限：字段级授权矩阵；服务端投影，不靠前端隐藏；跨桌隔离；管理员查看暗手/导出双写审计。
- 状态机：Session、ScoringEligibility、TableBoard、SessionBoard 四套状态转换；异常结算按统一表。
- 留存：对局 365 天、审计 3 年、聊天 90 天、登录日志 180 天；注销按字段级匿名化。

### 2.3 交付门槛

SRS 第 12 章要求先完成 P0 裁决、数据模型/事务边界、接口契约、安全边界、核心验收用例和任务依赖评审，再进入第二批核心模块。M5 已补齐 ADR-0004/0006/0007、测试计划、DB Schema、WS/HTTP 协议与服务端骨架；ADR-0005 与 ADR-0008 在 M4B 已完成。证据索引见 `docs/m5-platform-contracts.md`。

## 3. 现状评估

| SRS 能力 | 当前状态 | 主要缺口 |
| --- | --- | --- |
| 叫牌/出牌法律与计分 | 已实现 | 撤回/违规罚则仍转裁判；错误码待扩展 |
| 叫牌规则与 `rulesetId` | Phase 3 完成 | 无 |
| Profile S TableBoard | Phase 4A/4B 完成 | Schema 1.1 已冻结；服务端投影与持久化未实现 |
| 引擎快照与四条随机流 | 完成 | 未进入服务端事件流 |
| JSON/PBN/CSV 导出 | 完成 | CSV 列与换行不符合交换规范 v2；无导出时点/投影 |
| `SessionBoard` 与队式 IMP | 领域函数完成 | 红蓝映射与 `wbf-2017.json` 已实现；持久化、跨桌并发与 API 未实现 |
| 事件流与回放 | 基础完成 | 事件信封、`seq/eventId`、JSONL 已实现；`corrects`、快照恢复、服务端广播与归档未实现 |
| 账号/登录/命名/注销 | 未实现 | 服务端会话、密码哈希、审计、留存 |
| 大厅/牌室/等候区 | 未实现 | 房间性质、成员、配置、密码/邀请码 |
| 座位/结对/举手/原子开局 | 部分 | 固定人类南家；无准备、人数门槛、AI 成对补位 |
| 超时/托管/断线重连 | 未实现 | 服务端计时、降智 AI、事件记录 |
| 裁判干预 | 未实现 | 取消/调整/重发/暂停/踢人/撤销/复核 |
| 旁观/转播/跨桌隔离 | 未实现 | 延迟投影、受众分频道、字段过滤 |
| 四层聊天 | 未实现 | 分层、限频、禁言、快捷短语、留存 |
| 体系声明与披露 | 部分 | 有叫牌含义；缺三层字段与 Session 锁定 |
| 持久化/审计/权限矩阵 | 未实现 | 数据库、审计日志、字段级鉴权 |
| 性能/安全/故障恢复验收 | 未实现 | 时延基准、E2E、并发/渗透/负载测试 |

结论：**单桌领域和规则引擎已经可用；平台层、多人协同层和审计层基本为空。**

## 4. 实施策略

### 4.1 三条原则

1. **领域先行**：先把 `TableBoard / SessionBoard / 事件流 / 裁判操作` 做成无 UI、无 IO 的纯领域模块，再由本地 store 和未来服务端共同复用。
2. **契约先行**：Schema、OpenAPI、WS 事件、错误码、数据库约束先冻结，再写页面。
3. **垂直切片**：每个里程碑都以“可运行的一条完整链路”验收，不按技术层横向堆代码。

### 4.2 目标工程结构

```text
apps/
  web/                 # 现有 Vue 3 客户端
  server/              # 新增 Node.js 服务端
packages/
  domain/              # 纯领域：牌桌 reducer、SessionBoard、裁判操作
  rules/               # 现有 src/brules、engine、rules
  exchange/            # 现有 src/exchange，扩展事件流/投影
  shared/              # 协议类型、错误码、Schema
```

第一步不强制物理拆仓，可先在 `src/domain/` 落地，服务端出现后再抽 workspace。

## 5. 里程碑计划

> 估算按“1 名全栈 + 1 名前端/测试”计算；单人开发约需 8–10 个月。

| 里程碑 | 周期 | 目标 | 关键交付 | 退出条件 |
| --- | --- | --- | --- | --- |
| M4B Profile S+ | 3–4 周 | 领域模型封口 | Schema 1.1、`SessionBoard`、WBF IMP 表、事件流、裁判状态/调整分、CSV 规范 | 附录 C 全绿；事件重放与记录一致；52 文件 / 636 用例全绿 |
| M5 平台契约 | 2 周 | 服务端可开工 | ADR-0004/0005/0006/0007、DB Schema、OpenAPI/WS 协议、测试计划、工程骨架 | **已完成（2026-10-28）**：SRS 12.1 第 2–4、6 项证据齐备；58 文件 / 680 用例全绿 |
| M6 SRS 阶段一 | 4–5 周 | 账号/大厅/牌室 | 注册登录、命名、重置、封号/注销、大厅、房间、Session、四维状态、审计 | **第一、第二、第三切片完成（2026-10-28）**：注册登录、会话、命名、建牌室、公开列表、加入/等候区/座位/举手、Session 创建/快照/前置校验；其余待续。附录 A 第 1–12、15–17 条通过 |
| M7 SRS 阶段二（单桌） | 5–6 周 | 在线单桌对局 | 座位/举手/原子开局/AI 补位、服务端权威叫牌出牌、超时托管、重连、聊天、旁观 | 附录 D-1~D-8；4 客户端 E2E；AI P95 达标 |
| M8 SRS 阶段二（队式） | 5–6 周 | 队式赛与裁判 | 红蓝结对、同牌分发、`SessionBoard`/IMP、裁判取消/调整/重发、转播延迟、跨桌隔离、回放导出 | 附录 C 全绿；附录 D-9；权限矩阵测试通过 |
| M9 上线验收 | 3–4 周 | 安全与运维 | 字段级鉴权、渗透测试、留存/注销任务、负载/故障恢复、监控、交付证据 | SRS 第 12 章证据表全部通过 |

合计约 **22–27 周**（2 人估算）；按单人开发约 **8–10 个月**。M4B 与 M5 可在部分工作上并行。

## 6. M4B：Profile S+ 领域封口

### 6.1 先解决规范冲突

当前文档存在三处必须先裁决的冲突：

1. **取消副的原始分**
   - SRS V0.7 6.8.1/6.11：`CANCELLED` 时 `rawScore=null`、`imp=null`，不得写 0；
   - ADR-0003 D6 与 `srs-board-model.md` 5.1：取消记 0/0；
   - `record.schema.json` 1.0：`score` 必填。
   - **建议**：以 SRS V0.7 为准，修订 ADR-0003 D6 与 `srs-board-model.md`，Schema 1.1 允许 `CANCELLED` 省略 `score`，用 `derived.artificialAverage` 单独表达。
2. **桌副状态枚举**
   - SRS V0.7：`IN_PROGRESS / PLAYED / PASSED_OUT / CANCELLED / ADJUSTED / INCOMPLETE / REOPENED`；
   - `record.schema.json` 1.0 只有前 5 个。
   - **建议**：Schema 1.1 补齐 7 个状态及转换约束。
3. **进行中的定约字段**
   - 交换规范 v2 6.3 要求 `IN_PROGRESS` 省略 `contract`；
   - 进行中的牌局已经确定定约，服务端恢复/重连需要它。
   - **建议**：Schema 1.1 允许叫牌结束后的 `IN_PROGRESS` 携带 `contract/declarer`，仅 `PASSED_OUT/CANCELLED` 禁止。

### 6.2 任务分解

| # | 任务 | 产出 | 估算 |
| --- | --- | --- | --- |
| 1 | 记录 Schema 1.1 与 ADR | 状态机、取消/调整语义、字段约束 | 2–3 天 |
| 2 | 抽取无界面牌桌 reducer | `src/domain/table/`：command → events → state | 5–7 天 |
| 3 | 事件流 | 信封、`seq/eventId`、`corrects`、JSONL、重放 | 5–7 天 |
| 4 | `SessionBoard` 与 IMP 表 | `wbf-2017.json`、`redTeamRaw`、逐副累计 | 4–5 天 |
| 5 | 裁判领域操作 | 取消、调整、重开、未完成、审计历史 | 4–5 天 |
| 6 | 导出投影 | boards.csv/summary.csv、manifest、导出时点 | 3–4 天 |
| 7 | 本地 UI | 牌局列表、状态、裁判操作、回放 | 4–5 天 |
| 8 | 文档与回归 | phase4b.md、验收记录 | 2 天 |

### 6.3 验收

- Schema 1.1 的 7 个状态与异常结算表全部有正/反用例；
- 附录 C-1~C-11 表驱动测试全绿；
- 事件流重复 `seq`、缺口、`corrects` 引用、追加写入均有测试；
- 用事件重放得到的 `TableBoard` 与直接导出的记录逐字段一致；
- 基线用例保持全绿（当前 65 个测试文件 / 755 个用例）、`typecheck`、`check:phase0` 全绿；
- 不修改 `BiddingRule` 冻结契约与 `src/core/*` 的桥牌法律语义。

## 7. M5：平台契约

### 7.1 推荐技术栈

| 层 | 推荐 | 理由 |
| --- | --- | --- |
| 运行时 | Node.js 22 + TypeScript | 与现有前端/领域代码同语言，可直接复用 |
| HTTP | Fastify | schema-first、轻量、性能好 |
| 实时 | `ws` + 自建信封 | 协议可控，便于按 `audience` 投影 |
| 数据库 | PostgreSQL 16 | 唯一约束、事务、行锁、JSONB、审计 |
| ORM/迁移 | Drizzle ORM | SQL 可控，迁移透明，适合复杂唯一约束 |
| 缓存/广播 | Redis | 在线状态、限频、跨进程 pub/sub；单机可后置 |
| 校验 | Zod + JSON Schema | HTTP/WS/事件共用 |
| 测试 | Vitest + Playwright + k6 | 单元/多端 E2E/负载 |
| 部署 | 单机 Docker Compose 起步 | 先跑通，再谈水平扩展 |

如果团队更熟悉 NestJS/Prisma，可替换，但**不要**在没有事务与唯一约束的存储上做队式赛和裁判并发。

### 7.2 必须先写的 ADR

- **ADR-0004**：`roomNature` 与授权、成绩资格判定（**已完成**，2026-10-28）；
- **ADR-0005**：WBF 规则版本、计分口径、IMP 表版本与校验（**已完成**，2026-10-28）；
- **ADR-0006**：开局/发牌/结算事务边界、幂等键、并发裁判操作（**已完成**，2026-10-28）；
- **ADR-0007**：HTTP/WS/回放/导出的字段级投影与延迟释放（**已完成**，2026-10-28）；
- **ADR-0008**：记录 Schema 1.1、取消/调整语义与 1.0 兼容（**已完成**，2026-10-28）；
- **测试计划**：性能、并发、DDS 降级、安全渗透的采样方法与阈值（**已完成**，`docs/test-plan.md`）。

### 7.3 契约冻结清单

- 数据库表与唯一约束：`UNIQUE(sessionId, dealId, tableId)`、`UNIQUE(sessionId, dealId)`、`UNIQUE(streamId, seq)`、`UNIQUE(eventId)`、`UNIQUE(sessionId, pairId)`、`UNIQUE(targetUserId) WHERE PENDING`；
- 命令信封：`commandId`、`expectedVersion`、`sessionId/tableId`、`payload`；
- 事件信封：`schemaVersion/streamId/seq/eventId/type/occurredAt/actor/audience/payload/corrects`；
- 错误码：SRS 附录 B 全量；
- 导出投影：`postGame/exportedBy/exportedAt/projection`。

### 7.4 执行结果（2026-10-28）

M5 全部交付完成，证据索引见 `docs/m5-platform-contracts.md`：

| 类别 | 文件 |
| --- | --- |
| ADR | `docs/adr/0004-room-nature-authorization.md`、`0006-transaction-boundaries.md`、`0007-projection.md` |
| 测试计划 | `docs/test-plan.md` |
| HTTP 契约 | `docs/openapi.yaml`（仅覆盖已实现端点） |
| 错误码/协议 | `src/shared/errors.ts`、`src/shared/protocol.ts` |
| 数据库 | `src/db/schema.ts`、`src/db/migrations/0000_init.sql`、`src/db/migrate.ts` |
| 服务端 | `src/server/{config,app,ws,index}.ts` |
| 字段投影 | `src/domain/authorization/projection.ts` |

验证结果：`npm run typecheck` 通过；`npm test` **58 文件 / 680 用例**通过；`npm run check:phase0` 17 项通过。M5 新增 6 个测试文件 / 44 个用例，覆盖错误码、协议、HTTP 骨架、WS 订阅过滤、数据库约束与字段级投影。

已知限制：账号鉴权与业务命令处理器仍由调用方注入；OpenAPI 只含健康检查/就绪检查/版本元数据；事件 payload 的字段级裁剪留到 M7；单机先用进程内订阅。

## 8. Sprint 1（已完成）：领域封口

| 天 | 任务 | 完成标志 |
| --- | --- | --- |
| D1 | 评审本计划，确认取消语义/技术栈/优先级 | 三个决策有结论 |
| D2–D3 | 起草 ADR-0005、Schema 1.1；修订 ADR-0003 D6 | ADR 草案可评审 |
| D4–D5 | 更新 `src/exchange/types.ts`、`record.schema.json`、验证器与状态转换测试 | 7 状态正/反用例通过 |
| D6–D7 | `wbf-2017.json` + `impTable` 纯函数 + 附录 C 测试 | C-1~C-11 全绿 |
| D8–D9 | 牌桌 reducer 第一版：叫牌/出牌/结算三段纯函数 | store 行为不变，新 reducer 测试通过 |
| D10 | 事件信封与 `deal.created/auction.call/play.card/board.completed` 首发 | JSONL 可导出，重复 `seq` 被拒绝 |

Sprint 1 不碰服务端、不写账号页面；目标是把“记录 + 计分 + 事件”三块地基压实。

**执行结果（2026-10-28）**：D1–D10 全部完成。Schema 1.1、ADR-0005、ADR-0008、ADR-0003 D6 修订、`wbf-2017.json`、队式结算、牌桌 reducer、事件流与 store 导出均已落地；`npm run typecheck`、`npm test`（52 文件 / 636 用例）、`npm run check:phase0`（17 项）全部通过。详见 `docs/brules-v0.5/phase4b.md`。

## 9. M6：账号 / 大厅 / 牌室

### 9.1 第一切片（已完成，2026-10-28）

范围：注册、登录、登出、会话鉴权、命名规则、牌室创建、公开列表、牌室详情。

| 类别 | 文件 | 说明 |
| --- | --- | --- |
| 命名 | `src/domain/account/naming.ts` | 用户名 / 昵称 / 邮箱 / 密码校验与归一化 |
| 认证 | `src/auth/{password,token,service,view}.ts` | scrypt、会话令牌、注册登录、账号投影 |
| 仓储 | `src/auth/{types,memory,pgRepository}.ts` | 接口 + 内存 + PostgreSQL |
| 牌室 | `src/rooms/{types,service,pgRepository}.ts` | 创建、列表、详情、配置校验 |
| HTTP | `src/server/routes/{auth,rooms,authGuard}.ts`、`src/server/cookies.ts` | 账号 4 端点 + 牌室 3 端点 |
| 数据 | `src/db/migrations/0001_accounts_rooms.sql`、`src/db/schema.ts` | 归一化字段、`auth_sessions`、牌室状态 |
| 接线 | `src/server/{app,index,config}.ts` | 服务注入、PG 仓储、`COOKIE_SECURE` |

关键决策：

- 密码使用 Node 内置 scrypt（N=16384、r=8、p=1），参数随哈希保存；
- 会话为不透明令牌，数据库只存 SHA-256 摘要；Cookie `HttpOnly + SameSite=Lax`，默认 7 天、记住我 30 天，同时支持 Bearer；
- 登录失败统一 `INVALID_CREDENTIALS`，未知用户也执行一次哈希；
- 用户名 / 昵称 NFKC + 小写归一化查重，保留显示大小写；昵称按显示宽度 2–12；
- `roomNature` 创建时固化；私有牌室不进大厅列表，非室主 / 非管理员统一 `NOT_FOUND`；
- 房间密码使用同一 scrypt hasher，对外只暴露 `hasPassword`。

验证结果：`npm run typecheck` 通过；`npm test` **65 文件 / 755 用例**通过；`npm run check:phase0` 17 项通过。第一切片新增 37 个用例，第二切片新增 18 个用例，第三切片新增 20 个用例。

详细契约、端点与限制见 `docs/m6-accounts-rooms.md`，HTTP Schema 见 `docs/openapi.yaml`。

### 9.2 第二切片（已完成，2026-10-28）

范围：加入 / 离开牌室、等候区上限、私有房密码、座位 / 换座 / 离座、举手 / 取消举手。

| 类别 | 文件 | 说明 |
| --- | --- | --- |
| 类型 | `src/rooms/types.ts` | `RoomMemberRecord`、座位枚举、`RoomDetailView`、仓储成员方法 |
| 服务 | `src/rooms/service.ts` | `join / leave / takeSeat / stand / setReady`、权限与状态门禁 |
| 仓储 | `src/rooms/pgRepository.ts` | 成员事务、行锁计数、座位唯一索引映射 |
| HTTP | `src/server/routes/rooms.ts` | 5 个成员 / 座位端点 |
| 迁移 | `src/db/migrations/0002_room_members.sql` | `room_members`、座位部分唯一索引、举手约束 |
| 文档 | `docs/openapi.yaml`、`docs/m6-accounts-rooms.md` | 端点、Schema、错误码与限制 |

关键决策：

- 同一牌室同一座位最多一人，由 `UNIQUE (room_id, seat) WHERE seat IS NOT NULL` 裁决，服务层不先查后写；
- 等候区上限只统计未落座成员，PG 在锁住牌室行后计数；
- 室主创建牌室时自动进入等候区；私有房加入需密码，室主 / 管理员可绕过；
- 座位操作默认作用于本人；室主 / 管理员可传 `targetUserId` 拖拽或拽起他人；
- 换座或离座都会清除举手；未落座举手返回 `NOT_SEATED`；
- 加入 / 离开 / 座位 / 举手均要求 `status=waiting`。

验证结果：`npm test` **65 文件 / 755 用例**通过，第二切片新增 18 个用例（房间服务 +10、HTTP +5、Schema +3）。

### 9.3 第三切片（已完成，2026-10-28）

范围：Session 创建 / 复用、`roomNature` / `gameplay` / `room_config` / `scoringEligibility` 快照、开局前置校验（四席齐全、最低真人数）、取消准备中的 Session。

| 类别 | 文件 | 说明 |
| --- | --- | --- |
| 类型 | `src/sessions/types.ts` | Session 状态、成绩资格快照、前置报告、仓储接口 |
| 服务 | `src/sessions/service.ts` | 创建 / 幂等、可见性、`precheck`、`abort` |
| 仓储 | `src/sessions/pgRepository.ts` | 活动 Session 唯一索引映射、条件状态迁移 |
| HTTP | `src/server/routes/sessions.ts` | 创建 / 列表 / 读取 / precheck / abort |
| 迁移 | `src/db/migrations/0003_sessions_preparing.sql` | `gameplay`、`room_config`、活动 Session 部分唯一索引 |

关键决策：

- 同一牌室同时最多一个活动 Session；重复创建幂等返回现有记录；
- 创建时固化 `roomNature`、`gameplay`、`room_config`，后续改分 / 导出 / 排名只认快照；
- `scoringEligibility` 初始值：practice / casual = `ineligible`，competitive = `pending`；
- `precheck` 只读，硬门槛为牌室 `waiting`、四席齐全、已落座真人数 ≥ `minHumans`；
- 队式赛 Session 可创建，但 `precheck` 返回 `GAMEPLAY_UNSUPPORTED`；
- 当前只实现 `preparing → aborted`；`starting → playing`、AI 补位、发牌与座位锁定留到后续。

验证结果：`npm test` **65 文件 / 755 用例**通过，第三切片新增 20 个用例（Session 服务 13、HTTP 5、Schema 2）。

### 9.4 后续切片

1. AI 补位、发牌、`sessionStatus` 状态机与原子开局事务（`starting → playing`）；
2. 注册 / 登录限流与失败锁定、昵称改名与 `NameRegistry`；
3. 邮箱验证、密码重置、封号 / 注销与审计；
4. 队式赛多桌对位、同牌分发与跨桌 IMP；
5. 大厅筛选、呼叫管理员与聊天分层。

## 10. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 直接开写服务端，领域层仍耦合 UI | 后续重写对局逻辑 | 先做 M4B 无界面 reducer；服务端只做适配 |
| 规范冲突未裁决 | Schema/API 反复改 | M4B 先出 ADR，Schema 1.1 一次冻结 |
| 事件流后补 | 回放/重连/审计全部返工 | 与 reducer 同步设计，事件先于页面 |
| 权限靠前端隐藏 | 暗手/跨桌结果泄漏 | 服务端字段级投影 + 渗透测试门槛 |
| 单管理员/单机部署 | 裁判并发与恢复风险 | ADR-0006 明确串行化与补偿事务；先单机再扩展 |
| 队式赛公式实现错 | 成绩不可信 | 随包 `wbf-2017.json` + 表驱动测试，不硬编码 IMP |
| AI 时延不达标 | 对局阻塞 | 现有 DDS 回退保留；M7 增加 P95 基准与告警 |

## 11. 不在本轮范围

- MP/VP 赛制、双人赛多轮编排；
- 上传体系驱动 AI 执行；
- 邮件验证与自助找回；
- 移动端/APP；
- 瑞士移位、梯级挑战；
- 知识库/自进化决策。

这些按 SRS 第 10、11 章保留字段或单独立项，不阻塞 V1。

## 12. 决策记录（已确认）

以下 5 项已于 2026-10-28 确认，结论见第 0 节；保留问题原文作为决策背景。

1. **产品目标**：是否确认按 SRS V0.7 的联网平台推进，而不是继续扩展单机 MVP？
2. **取消副语义**：是否采用 SRS V0.7 的 `CANCELLED → rawScore=null`，并修订 ADR-0003 D6？
3. **技术栈**：是否接受 Node.js + Fastify + PostgreSQL + Drizzle + `ws` 的推荐组合？
4. **首个可演示目标**：优先“单桌联网可玩”，还是“队式赛完整闭环”？
5. **团队规模**：按 2 人还是单人排期？这会直接改变里程碑周期。
