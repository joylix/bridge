# Phase 4B：记录 Schema 1.1、WBF 计分、牌桌 reducer 与事件流

- 状态：Phase 4B 完成（Sprint 1）
- 目标：在 Phase 4A 的数据交换之上，冻结记录 1.1、WBF 2017 计分口径、无界面牌桌 reducer 与事件日志，为联网服务端提供可复用领域层
- 非目标：服务端、数据库、账号、字段级投影、SessionBoard 持久化、MP/VP
- 关联：`record.schema.json`、`pbn.md`、`reproducibility.md`、`docs/adr/0005-wbf-rules-scoring.md`、`docs/adr/0008-record-schema-1.1.md`

Phase 4A 解决“单桌记录能否交换”；Phase 4B 解决“记录能否表达异常结算、计分能否审计、对局能否脱离 UI 重放”。JSON 仍是权威记录，PBN/CSV 仍是带损失报告的互通/报表格式。

## 1. 范围

本阶段实现：

- 记录 Schema 1.1：7 个桌副状态、`score.nsRaw` 可空、`adjustment/adjustHistory`、`engine.rulesVersion`、`derived.imp.tableVersion`；
- 导入器兼容 1.0，新导出统一写 1.1；
- 随包 WBF 2017 IMP 表与纯函数、表结构校验；
- 队式赛 `teamImp = impTable(redTeamRaw)` 与调整分前置检查；
- 无界面牌桌 reducer（叫牌/出牌/结算）与事件草稿；
- 事件信封、JSONL 序列化、重复/乱序 `seq` 拒绝；
- 单机 store 接入事件流，提供 `exportEventJsonl()`。

本阶段不实现：

- Fastify/PostgreSQL/`ws` 服务端与持久化；
- 账号、权限、字段级投影与 30 秒转播延迟；
- `SessionBoard` 持久化与跨桌并发；
- 归档副的事件流保存；
- MP/VP 赛制。

## 2. 模块与公共 API

| 文件 | 职责 |
| --- | --- |
| `src/core/wbf-2017.json` | 随包 IMP 表、版本、`bandsSha256` |
| `src/core/impTable.ts` | `impFromDiff` / `signedImpFromDiff` / `teamImpFromRaw` / `validateImpTable` |
| `src/core/imps.ts` | 保留单机贴点制封装，内部复用随包表 |
| `src/domain/scoring/team.ts` | `settleTeamBoards` / `canAdjustBoard` / `SessionBoard` 结算类型 |
| `src/domain/table/reducer.ts` | `createTableState` / `reduceTable` / `settleBoard` |
| `src/domain/events/types.ts` | 事件信封、事件类型、payload、默认受众 |
| `src/domain/events/log.ts` | `EventLog` / `parseEventJsonl` / `eventsToJsonl` |
| `src/exchange/schema11.test.ts` | Schema 1.1 正/反用例与 1.0 兼容 |
| `src/store/eventLog.test.ts` | store 事件流端到端导出 |

主要入口：

```ts
// 计分
impFromDiff(diff, table?): number
signedImpFromDiff(diff, table?): number
teamImpFromRaw(redTeamRaw, table?): number
validateImpTable(table?): string[]
settleTeamBoards(boards, table?): TeamSettlement
canAdjustBoard({ status, hasReopenAudit? }): AdjustGuard

// 牌桌
createTableState({ dealer, vulnerability, hands }): TableState
reduceTable(state, action): { state, events, error? }
settleBoard(contract, tricks, vulnerability): BoardSettlement

// 事件
new EventLog({ sessionId, tableId, tableBoardId, startSeq? })
log.append(type, payload, { actor?, audience?, at?, eventId? })
log.appendEvent(event)
log.toJsonl()
EventLog.fromJsonl(text)
parseEventJsonl(text)
```

store 侧新增：

```ts
exportEventJsonl(): string   // 当前副事件 JSONL
```

## 3. Schema 1.1

| 字段 | 1.0 | 1.1 |
| --- | --- | --- |
| `status` | 5 状态 | 7 状态（增加 `INCOMPLETE / REOPENED`） |
| `score.nsRaw` | 整数 | `integer \| null` |
| `adjustment` | 无 | 最新一条裁判操作 |
| `adjustHistory` | 无 | 完整历史 |
| `engine.rulesVersion` | 无 | `wbf-laws-2017` |
| `derived.imp.tableVersion` | 无 | `wbf-2017` |
| `IN_PROGRESS` + 定约 | 未明确定义 | 叫牌结束后允许携带 |

状态与分数字段：

| 状态 | `nsRaw` | `singleTable` | 定约/出牌 |
| --- | --- | --- | --- |
| `IN_PROGRESS` | 0 或当前临时分 | 可省略 | 叫牌结束后可带 |
| `PLAYED` | 整数 | 按表换算 | 必需 |
| `PASSED_OUT` | `0` | `0` | 禁止 |
| `CANCELLED` | `null` | `null` | 禁止 |
| `INCOMPLETE` | `null` | `null` | 禁止 |
| `REOPENED` | `null` | `null` | 禁止 |
| `ADJUSTED` | 整数 | 按调整后分数换算 | 保留原执行事实 |

审计约束：

- `ADJUSTED` 必须有 `adjustment.kind=ADJUST` 与 `adjustHistory`，且 `afterValue === score.nsRaw`；
- `CANCELLED` 必须有 `adjustment.kind=CANCEL`；
- `REOPENED` 必须有 `adjustment.kind=REOPEN`；
- `adjustment` 必须等于 `adjustHistory` 最后一条；
- 取消副补偿分放 `adjustment.artificialAverage`，不得写进 `score.nsRaw`。

1.0 兼容：

| 场景 | 结果 |
| --- | --- |
| 1.0 五状态 | 可导入 |
| 1.0 出现 `INCOMPLETE / REOPENED` | `STATUS_INVALID` |
| 1.0 取消副写 0 | 可导入，`LEGACY_CANCELLED_ZERO_SCORE` 警告 |
| 1.0 `ADJUSTED` 只有 `derived.adjusted` | 可导入 |
| 1.0 缺版本字段 | 可导入，按当前版本补默认值 |

## 4. WBF 2017 与队式赛

IMP 表：

- 版本 `wbf-2017`，规则版本 `wbf-laws-2017`；
- 25 档，0–24 IMP，最后一档 `maxDifference=null`；
- `bandsSha256 = sha256:db8e506577758eea4a01fa92c18615f0fda2b320eab5bd4c903f613311e42bac`；
- `validateImpTable()` 校验版本、单调递增、IMP 连续、无限末档与 `maxImp`。

队式结算：

```text
redTeamRaw = Σ(红队各桌红队视角原始分)   // 已是代数和
teamImp    = impTable(redTeamRaw)         // 不得再减 blueTeamRaw
blueTeamRaw = −redTeamRaw                 // 仅展示
```

- 逐副换算、逐副累加；
- 任一桌 `CANCELLED` → `SessionBoard.status=CANCELLED`，`teamImp=null`；
- 任一桌 `INCOMPLETE / IN_PROGRESS / REOPENED` → 不计算；
- 有 `ADJUSTED` → 状态 `ADJUSTED`，按调整后原始分重算；
- `CANCELLED` 再改分必须先有 `REOPEN` 审计。

## 5. 牌桌 reducer

`src/domain/table/reducer.ts` 是无 I/O 的纯函数层，供单机适配、服务端与回放器共用。

状态阶段：

```text
bidding → play_waiting_lead → play → completed
bidding → passed_out
```

动作：

| 动作 | 行为 |
| --- | --- |
| `call` | 校验轮次、叫品合法性；结束时自动确立定约或流局 |
| `play` | 校验轮次、手牌、跟花色；第四张后判定赢墩 |
| `settle` | 13 墩完成或流局时结算；已结算幂等 |

约束：

- 相同输入 + 相同动作必得相同状态与事件；
- 不读取 store、不访问 UI、不修改输入状态；
- `settleBoard()` 与 store 现有合约分一致，`singleTableImp` 直接使用 WBF 表；
- 事件草稿由 reducer 产出，`EventLog` 负责补 `eventId / seq / at`。

## 6. 事件流

事件类型：

```text
deal.created / auction.call / contract.set / play.card
trick.completed / board.completed / score.computed
```

信封：

```text
eventId, schemaVersion=1.0, sessionId, tableId, tableBoardId,
seq, type, at, actor, audience, payload
```

规则：

- `seq` 在同一 `tableBoardId` 内从 1 严格递增；
- 重复/跳跃 `seq`、重复 `eventId`、未知类型、错误时间均拒绝；
- JSONL 一行一事件，末尾换行，可往返恢复；
- `deal.created` 默认只投 `DIRECTOR`，因为 payload 含完整 PBN；牌桌投影必须按座位裁剪；
- 其余事件默认投 `TABLE + DIRECTOR`；
- 事件 schema 与记录 schema 分开版本化，当前事件为 1.0。

## 7. store 接入

`beginAuction` 创建当前副的 `EventLog`，并写入 `deal.created`。后续动作写入：

- 叫牌 → `auction.call`；
- 定约确立 → `contract.set`；
- 每张牌 → `play.card`；
- 每墩完成 → `trick.completed`；
- 结算/流局 → `board.completed` + `score.computed`。

`exportEventJsonl()` 导出当前副事件流。当前限制：

- 只导出当前副；归档副尚未保存事件流；
- 事件 id 为运行时 UUID，测试可注入稳定 id；
- 尚无服务端字段级投影与延迟释放。

## 8. 验证

```bash
npm run typecheck
npm test
npm run check:phase0
```

本阶段结果：

- `vue-tsc --noEmit` 通过；
- 52 个测试文件 / 636 个用例通过；
- `check:phase0` 17 项通过，0 警告，0 错误。

新增/更新测试：

| 文件 | 覆盖 |
| --- | --- |
| `src/core/impTable.test.ts` | 版本、档位、哈希、边界、超上限、篡改拒绝 |
| `src/domain/scoring/team.test.ts` | 附录 C-1~C-11、取消/缺桌/调整、前置检查 |
| `src/domain/table/reducer.test.ts` | 叫牌结束、流局、非法轮次/叫品、跟花色、13 墩结算、不可变 |
| `src/domain/events/log.test.ts` | seq 连续性、JSONL 往返、重复/乱序拒绝、reducer 事件落盘 |
| `src/exchange/schema11.test.ts` | 7 状态、空分、调整历史、1.0 兼容、PBN/CSV 降级 |
| `src/store/eventLog.test.ts` | store 全流程事件数量、seq 连续、流局 0 分 |

## 9. 已知限制

- reducer 尚未全面接管 store；store 仍保留原有叫牌/出牌实现，当前只共享底层 `src/core/*` 与事件流；
- `deal.created` 含完整 PBN，不能直接广播给牌桌；服务端投影前不得把该事件发给玩家；
- 归档副没有事件流，回放只能依赖 `TableBoard` JSON；
- 导入 JSON/PBN 时只恢复记录快照并新建当前副事件日志，不重建导入前的事件历史；
- 单机 store 导入时会保留可校验的 `status / adjustment / adjustHistory / updatedAt`，正常动作后清除；1.0 缺审计的取消/调整记录退回牌局推导，不保证原样往返；
- `INCOMPLETE` 不保留半副执行细节；
- `artificialAverage` 的赛制公式未冻结；
- PBN/CSV 不承载调整历史、事件流与引擎快照，需要完整信息时使用 JSON + JSONL。
