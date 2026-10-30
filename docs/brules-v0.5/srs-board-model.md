# `Deal / TableBoard / SessionBoard` 实体模型（已并入 SRS V0.7）

- 状态：**已接受并并入 SRS V0.7**（2026-10-27 初版；2026-10-28 按 ADR-0008 修订状态机与空分语义）
- 性质：**设计依据与字段说明**；SRS V0.7 第 0 章采用本模型，`Board` 仅作 UI 文案
- 依据：`docs/桥牌软件需求规格说明书.txt`（V0.7）5.5、6.8、6.11、7.3、附录 C；`docs/adr/0003-srs-v05-alignment.md`；`docs/adr/0005-wbf-rules-scoring.md`；`docs/adr/0008-record-schema-1.1.md`
- 关联：`record.schema.json`（Schema 1.1）、`pbn.md`、`reproducibility.md`

## 1. 问题

SRS V0.5 原文的数据模型是：

```text
Account → Lobby → Room → Session → Board → Table → Seat
```

其中 `Board` 被定义为“一副牌（发牌→叫牌→出牌→结算）”，`Table` 是“实际打牌的 4 席位单元”。这个层级无法表达队式赛的核心事实：

> **同一副牌型，分发到多张桌，各桌独立叫牌、独立出牌、独立产生结果。**

如果 `Board` 在 `Table` 之上，那么一副牌只能挂一张桌；如果让 `Board` 挂多张 `Table`，又叫牌/出牌/结果都塞进 `Board`，就会把“牌型”和“某桌对牌型的执行”混成一个实体。

## 2. 建议模型

```text
Account → Lobby → Room → Session
                              ├── Deal
                              │     ├── TableBoard (table 1)
                              │     └── TableBoard (table 2)
                              └── SessionBoard (derived from TableBoards)
```

| 实体 | 含义 | 关键点 |
| --- | --- | --- |
| `Deal` | 同一副牌的定义：牌号、四手牌、发牌人、局况 | 一盘内唯一；可分发到多桌；不包含任何一桌的叫牌/出牌 |
| `TableBoard` | 某一桌对某个 `Deal` 的完整执行：座位、叫牌、出牌、定约、结果、原始分 | 每桌一份；是**原始事实**的边界 |
| `SessionBoard` | 对同一 `Deal` 的各 `TableBoard` 做跨桌聚合：队分、IMP、调整分（MP/VP 预留） | **派生数据**，必须可重算；不是原始事实 |

单桌玩法就是“一个 `Deal` 只有一个 `TableBoard`”。当前单机 `DealRecord` 约等于 `Deal` + 一个 `TableBoard`。

## 3. 实体字段

### 3.1 `Deal`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `dealId` | string | 全局唯一；不是牌号 |
| `boardNumber` | integer | 副号；同一 Session 内可重复用于不同轮次 |
| `dealer` | `N/E/S/W` | 发牌人 |
| `vulnerability` | `NONE/NS/EW/ALL` | 局况 |
| `pbn` | string | 开局四手 13 张的 PBN `[Deal]` 值 |
| `createdAt` | timestamp | 创建时间 |

`Deal` 不得包含：`contract`、`declarer`、`tricksTaken`、`score`、`play`、`auction`。这些属于 `TableBoard`。

### 3.2 `TableBoard`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `tableBoardId` | string | 全局唯一 |
| `dealId` | string | 引用 `Deal` |
| `tableId` | string | 桌标识；单桌可为固定值 |
| `seats` | map | `N/E/S/W` 的参赛者/控制者/风格快照 |
| `status` | enum | `IN_PROGRESS / PLAYED / PASSED_OUT / CANCELLED / ADJUSTED / INCOMPLETE / REOPENED` |
| `auction` | object | `calls`、`completed` |
| `contract` | object? | 定约已确立时出现，不论成败；`PASSED_OUT / CANCELLED / INCOMPLETE / REOPENED` 不得出现 |
| `declarer` | seat? | 庄家 |
| `tricksTaken` | integer? | 庄家方墩数 0–13 |
| `play` | object? | 每墩首攻、四张牌、赢家；只写完整墩 |
| `score.nsRaw` | integer? | NS 视角原始分；流局 0；取消/未完成/重开为 `null` |
| `score.source` | `computed/director` | 计算分或裁判分 |
| `hcp` | `{ns,ew}` | 联手大牌点，和必须为 40 |
| `engine` | object | 复现快照；含 `rulesVersion=wbf-laws-2017`；见 `reproducibility.md` |
| `derived.imp.singleTable` | integer? | 单桌参考 IMP；无原始分时为 `null`；`tableVersion=wbf-2017` |
| `adjustment` | object? | 最新一条改分/取消/重开审计 |
| `adjustHistory` | array? | 完整调整历史；最后一条必须等于 `adjustment` |
| `createdAt` / `updatedAt` | timestamp | 审计 |

`TableBoard` 是调整分的唯一落点。任何 IMP/VP/MP 都不得在 `TableBoard` 上直接改；只能在原始分上改，再重算 `SessionBoard`。

取消副的赛制补偿不得写进 `score.nsRaw`，必须放在 `adjustment.artificialAverage = { nsRaw, artificial: true }`。

### 3.3 `SessionBoard`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `sessionBoardId` | string | 全局唯一 |
| `sessionId` | string | 引用 Session |
| `dealId` | string | 引用 Deal |
| `status` | enum | `PENDING / COMPLETE / INCOMPLETE / CANCELLED / ADJUSTED / REOPENED` |
| `tableBoardIds` | string[] | 参与聚合的 TableBoard |
| `teamScores` | map | 队名/队 id → 原始分合计；`CANCELLED / INCOMPLETE / REOPENED` 时不计算 |
| `teamImp` | number? | 队式 IMP；不计算时为 `null` |
| `impTableVersion` | string | 固定 `wbf-2017` |
| `mp` | number? | MP；V1 不启用，仅保留字段 |
| `vp` | number? | VP；V1 不启用，仅保留字段 |
| `computedAt` | timestamp | 重算时间 |
| `sourceTableBoardVersions` | map | 输入版本/更新时间，防止用旧值重算 |

`SessionBoard` 必须是**派生视图**：

- 可以删除并从 `TableBoard` 重算；
- 不得作为 IMP/队分的唯一副本；
- 重算必须记录输入版本；
- 调整分后必须重算，不得在旧 IMP 上加减。

## 4. 不变量

1. 一个 `Deal` 可以有 1..N 个 `TableBoard`；单桌 N=1，队式赛 N=2（或更多）。
2. 一个 `TableBoard` 只引用一个 `Deal`；不得跨 Deal 复用。
3. `Deal` 的四手牌在创建后不可变；重发必须创建新 `Deal`，并让该副所有桌一起重发。
4. `TableBoard.status=PLAYED` 必须有 `contract`、`declarer`、`tricksTaken`、`play`。
5. `TableBoard.status=PASSED_OUT` 不得有 `contract`、`declarer`、`tricksTaken`、`play`；`score.nsRaw=0`、`derived.imp.singleTable=0`。
6. `TableBoard.status=CANCELLED` 不得有定约/出牌；`score.nsRaw=null`、`derived.imp.singleTable=null`；必须含 `adjustment.kind=CANCEL`，补偿分单独存 `artificialAverage`，不得伪装成 `PASSED_OUT` 的 0 分。
7. `TableBoard.status=INCOMPLETE` 不得有定约/出牌；`score.nsRaw=null`、`derived.imp.singleTable=null`；只有补打完成才迁回 `PLAYED`。
8. `TableBoard.status=REOPENED` 不得有定约/出牌；`score.nsRaw=null`、`derived.imp.singleTable=null`；必须含 `adjustment.kind=REOPEN`。
9. `TableBoard.status=IN_PROGRESS` 在叫牌结束后可以携带 `contract/declarer/tricksTaken`；`play` 只写完整墩。这样断线恢复不必伪造 `PLAYED`。
10. `TableBoard.status=ADJUSTED` 必须含 `adjustment.kind=ADJUST` 与 `adjustHistory`；`score.nsRaw` 必须是整数且等于 `adjustment.afterValue`。
11. `adjustment` 必须等于 `adjustHistory` 的最后一条；历史只追加，不删除、不覆盖。
12. 已 `CANCELLED` 再改分必须先写 `REOPEN` 审计，否则返回 `BOARD_CANCELLED_ADJUST_FORBIDDEN`。
13. `hcp.ns + hcp.ew = 40`。
14. `score.nsRaw` 是原始事实；`derived.imp`、贴点、`SessionBoard.teamImp` 都是派生值，必须从原始分重算。
15. 同一 `Deal` 的所有 `TableBoard` 完成后，才开放该副回放/导出；对局中禁止导出未完成牌。
16. `TableBoard.engine.ruleset.rulesetId` 与 `engine.rulesVersion` 在开局时冻结；牌局中修改规则不影响当前副。

## 5. 状态机

### 5.1 `TableBoard`

```text
IN_PROGRESS ──正常结算──→ PLAYED
IN_PROGRESS ──四家 Pass──→ PASSED_OUT
IN_PROGRESS ──裁判取消──→ CANCELLED
IN_PROGRESS ──超时/缺桌──→ INCOMPLETE

PLAYED      ──裁判改分──→ ADJUSTED
PLAYED      ──裁判取消──→ CANCELLED
PASSED_OUT  ──裁判改分──→ ADJUSTED
PASSED_OUT  ──裁判取消──→ CANCELLED

CANCELLED   ──改判──→ ADJUSTED
CANCELLED   ──重开──→ REOPENED
ADJUSTED    ──再次改分──→ ADJUSTED（保留历史）
ADJUSTED    ──取消──→ CANCELLED

INCOMPLETE  ──补打完成──→ PLAYED
INCOMPLETE  ──取消──→ CANCELLED
REOPENED    ──重新开始──→ IN_PROGRESS
REOPENED    ──取消──→ CANCELLED
```

- `PASSED_OUT` 不能直接变成 `PLAYED`；要重打必须走 `REOPENED` 或新建 `TableBoard`/`Deal`。
- `CANCELLED` 的 `score.nsRaw=null`，但 0 分是 `PASSED_OUT` 的真实结果；两者不得互换。
- `ADJUSTED` 通过 `adjustment/adjustHistory` 表达原状态与改前/改后值，不再新增 `originalStatus` 字段。
- `REOPENED` 只是审计态；重新开始后写新的 `IN_PROGRESS`，历史仍保留。
- 任何“取消后再改分”都必须先有 `REOPEN` 审计。

### 5.2 `Deal`

```text
CREATED → DISTRIBUTED → ALL_TABLE_BOARDS_DONE → ARCHIVED
```

- `DISTRIBUTED` 后四手牌不可变；
- `ALL_TABLE_BOARDS_DONE` 是回放/导出开放条件；
- 重发创建新 `Deal`，旧 `Deal` 标 `SUPERSEDED`，不得原地改牌。

### 5.3 `SessionBoard`

```text
PENDING ──各桌完成──→ COMPLETE
PENDING ──缺桌/超时──→ INCOMPLETE
PENDING ──取消──→ CANCELLED
COMPLETE ──裁判改分──→ ADJUSTED
COMPLETE ──取消──→ CANCELLED
INCOMPLETE ──补桌完成──→ COMPLETE
INCOMPLETE ──取消──→ CANCELLED
ADJUSTED ──再次调整──→ ADJUSTED
ADJUSTED ──取消──→ CANCELLED
CANCELLED ──改判──→ ADJUSTED
CANCELLED ──重开──→ REOPENED
```

- `SessionBoard.status` 固定为 `PENDING / COMPLETE / INCOMPLETE / CANCELLED / ADJUSTED / REOPENED`；
- 任一 `TableBoard` 调整，`SessionBoard` 必须从原始分重算，不得在旧 IMP 上加减；
- `CANCELLED / INCOMPLETE / REOPENED` 时 `teamImp=null`，不得写 0；
- 重算必须记录输入 `TableBoard` 版本；
- 取消副的补偿分来自 `TableBoard.adjustment.artificialAverage`，`SessionBoard` 只按赛制规则汇总，不把补偿写进 `redTeamRaw`。

## 6. 与 SRS 的映射

| SRS V0.5 原文 | SRS V0.7 现行 | 处理 |
| --- | --- | --- |
| `Board`（一副牌，含发牌→叫牌→出牌→结算） | `Deal` + `TableBoard` | 已拆分；`Board` 仅作 UI 文案 |
| `Table`（4 席位单元） | `TableBoard` + `Seat` | `Table` 保留为房间/桌位概念；`TableBoard` 是“某桌对某 Deal 的执行” |
| 无 | `SessionBoard` | 已新增跨桌聚合 |
| `Session` 成绩累计 | `SessionBoard` + Session 汇总 | 累计点数、总点数差属于 Session 派生视图 |
| 单机 `DealRecord` | `Deal` + 一个 `TableBoard` | 适配层映射；不要求改现有 store |
| 桌副 5 状态 | 桌副 7 状态 | 增加 `INCOMPLETE / REOPENED`，见 `record.schema.json` 1.1 |
| 取消副记 0 分 | 取消副 `nsRaw=null`、`imp=null` | 0 分只属于 `PASSED_OUT`；补偿单独存 `artificialAverage` |
| 单一 `adjusted` 字段 | `adjustment` + `adjustHistory` | 支持再次调整、取消、重开与完整审计 |

### 6.1 命名建议

- `Deal`：牌型定义，避免与 UI 的“一副牌”混淆；
- `TableBoard`：某桌对某 Deal 的执行；比 `BoardResult` 更能表达“叫牌+出牌+结果”；
- `SessionBoard`：跨桌聚合；避免与 `Session` 总分混淆。

如果 SRS 希望保留 `Board` 一词，可写成 `Deal (BoardDefinition)`，但**不得**再把叫牌/出牌挂到 `Deal` 上。

## 7. 对接口/权限的影响

1. `GET /deals/{dealId}` 只返回牌型；未完成时按座位投影，不得泄露其他座位暗手。
2. `GET /table-boards/{id}` 返回某桌执行；权限按参赛者/裁判/观战投影。
3. `GET /session-boards/{id}` 返回聚合；只有该副所有桌完成后才可读。
4. 导出/回放接口必须检查 `Deal` 的 `ALL_TABLE_BOARDS_DONE`，不能只看单桌 `status`。
5. 裁判改分写 `TableBoard.adjustment` 与 `adjustHistory`，再触发 `SessionBoard` 重算；审计记录不可删除。
6. 单机 Profile S 可以只实现 `Deal` + 一个 `TableBoard`；`SessionBoard` 可省略或本地派生。

## 8. 迁移步骤

1. **已完成**：SRS V0.7 第 0 章已把 `Board → Table` 改为 `Deal / TableBoard / SessionBoard`，并明确 `Board` 仅作 UI 文案；5.5 已给出四层状态转换表。
2. **已完成**：`record.schema.json` 升为 1.1，支持 7 状态、空分、`adjustment/adjustHistory` 与版本标记。
3. 在数据字典中新增三张表及外键：`TableBoard.dealId`、`SessionBoard.dealId`、`SessionBoard.tableBoardIds`。
4. 把现有 `Board` 的牌型字段迁到 `Deal`；叫牌/出牌/结果字段迁到 `TableBoard`。
5. 把现有成绩累计迁到 `SessionBoard` 派生视图；保留原始分。
6. 在 API 层增加“全桌完成”门禁；单机模式恒为真。
7. 在导出层同时支持 `TableBoard` JSON 与 PBN；`SessionBoard` 不直接导出为 PBN。
8. 用队式赛算例回归：1 号桌红 NS +650、2 号桌红 EW −620，红队 +30 → 1 IMP；2 号桌改判为蓝方宕一后红队 +750 → 13 IMP。

## 9. 验收

1. 同一 `Deal` 可挂两张 `TableBoard`，各自叫牌/出牌互不影响。
2. 单桌玩法只创建一个 `TableBoard`，现有行为不变。
3. 删除 `SessionBoard` 后可由 `TableBoard` 完整重算。
4. 只改一桌原始分，`SessionBoard` 的队分/IMP 必须重算，不得在旧值上加减。
5. `PASSED_OUT`、`CANCELLED`、`INCOMPLETE`、`REOPENED`、`ADJUSTED` 的状态与字段约束通过 Schema 校验；取消/未完成/重开的空分与 `imp=null` 不得写 0。
6. 未完成 `Deal` 的导出/回放被拒绝；所有桌完成后才开放。
7. 裁判改分保留改前/改后/原因/操作人/时间；再次调整保留完整历史。
8. 1.0 记录可导入；1.1 新导出统一写 1.1；现有单机 store 通过适配层映射，不强制重写。
9. 当前全量测试与 `check:phase0` 保持全绿；Schema 1.1 正/反用例覆盖 7 状态。

## 10. 未决事项

| # | 事项 | 当前建议 |
| --- | --- | --- |
| 1 | `Board` 是否保留为 UI/别名 | 保留为文案，数据模型用 `Deal` |
| 2 | `TableBoard` 是否允许多次重打 | 不建议；重打新建 `TableBoard` 或 `Deal` |
| 3 | `SessionBoard` 的 VP/MP 公式 | V1 不启用 MP/VP；仅保留字段，未来双人赛/VP 赛制单独立项 |
| 4 | 调整分是否产生新 `TableBoard` 版本 | 已裁决：用 `adjustment/adjustHistory` 追加历史，不复制整条记录 |
| 5 | 转播延迟与跨桌可见性 | Profile P；本阶段不冻结秒数 |
| 6 | 事件流与 `TableBoard` 的关系 | 事件流是审计/回放来源之一；`TableBoard` 是投影结果 |
| 7 | `INCOMPLETE` 是否保留半副叫牌/出牌 | 当前按“无成绩”处理；断线恢复需求明确后单独立项 |
| 8 | 取消副补偿分的赛制公式 | V1 只要求 `artificialAverage` 单独保存并标 `artificial=true` |

SRS V0.7 已采用本模型；当前仓库实现 Profile S 的记录、计分、reducer 与事件流，不实现 Profile P 的账号、服务端与跨桌聚合。
