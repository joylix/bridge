# Phase 4A：Profile S 可复现数据交换

- 状态：Phase 4A 完成
- 目标：让单桌 `TableBoard` 在 JSON / PBN / CSV 之间交换，并在记录中冻结可复现所需的引擎快照
- 非目标：Profile P、SessionBoard 聚合、MP/VP、服务端持久化、事件流
- 关联：`record.schema.json`、`pbn.md`、`reproducibility.md`

Phase 4A 是 Phase 0 规范的第一个完整数据交换实现。JSON 是权威记录；PBN 与 CSV 是互通格式，不能保留的信息一律进入损失报告，不写“无损”。

> Phase 4B 已将记录升为 Schema 1.1：桌副状态增至 7 个，取消/未完成/重开的原始分为 `null`。本文的 5 状态枚举与取消语义为 Phase 4A 历史记录，现行口径以 `phase4b.md` 与 `record.schema.json` 1.1 为准。

## 1. 范围

本阶段实现：

- `src/exchange/` 独立交换模块（类型、随机流、牌张、记录构建、JSON、PBN、CSV）；
- 开局 `beginAuction` 冻结 `engine` 快照，局中修改规则/风格/DDS 配置不影响当前副；
- 四条独立随机流 `deal / bidding / play / dds`；
- 当前副的 TableBoard JSON、完整 PBN、历史 + 当前副 CSV 导出；
- TableBoard JSON 与完整 PBN 导入，恢复叫牌、定约、出牌与结算状态；
- 导入/导出 UI（`PbnDialog.vue`）与警告/损失报告展示；
- 旧 `exportDealPbn()` / `importDealPbn()` 纯发牌字符串路径保持兼容。

本阶段不实现：

- Profile P 的账号、受众、隐私投影与服务端留存；
- `SessionBoard` 聚合与多桌 IMP/MP/VP；
- JSON 事件流与逐事件回放；
- DDS 搜索逐字节复现；
- CSV 导入。

## 2. 模块与公共 API

| 文件 | 职责 |
| --- | --- |
| `src/exchange/types.ts` | 与 `record.schema.json` 对齐的记录、快照、诊断、损失报告类型 |
| `src/exchange/rng.ts` | 随机流派生 `streamSeed` / `deriveStreamSeeds` / `deriveImportedSeeds`，以及 `createStreamRngs` |
| `src/exchange/cards.ts` | 牌号（0–51）与规范牌张（`AS` / `TD` / `2C`）互转 |
| `src/exchange/record.ts` | 内部状态 → `TableBoardRecord`；叫品、定约、局况转换 |
| `src/exchange/json.ts` | JSON 解析、显式验证、稳定序列化 |
| `src/exchange/pbn.ts` | PBN 2.1 子集解析与导出、损失报告 |
| `src/exchange/csv.ts` | 计分汇总 CSV |
| `src/exchange/index.ts` | 统一出口 |

主要入口：

```ts
// 记录构建
buildTableBoardRecord(input): TableBoardRecord

// JSON
parseTableBoardRecord(text): TableBoardRecord                  // error 抛出
parseTableBoardRecordDetailed(text): { record, issues }        // warning/info 原样返回
validateTableBoardRecord(value): ExchangeIssue[]
toTableBoardJson(record): string

// PBN
parsePbnDocument(text, options?): PbnDocument
tableBoardFromPbn(text, options): { record, issues, losses }
tableBoardToPbn(record): { text, losses }

// CSV
toTableBoardCsv(records): string
```

store 侧动作：

```ts
currentTableBoardRecord(): TableBoardRecord
exportTableBoardJson(): string
exportTableBoardPbn(): { text: string; losses: LossReport[] }
exportTableBoardCsv(): string
importTableBoardRecord(record, opts?): void
importTableBoardJson(text, opts?): ExchangeIssue[]
importTableBoardPbn(text, opts?): ExchangeIssue[]
```

## 3. 记录映射

| 记录字段 | 来源 | 说明 |
| --- | --- | --- |
| `deal.pbn` | 开局快照 `dealHands` | 永远导出开局 52 张，不是打牌后的残局 |
| `deal.dealer` | `state.dealer` | 与 PBN `[Dealer]` 一致 |
| `deal.vulnerability` | `state.vulnerability` | `none/NS/EW/both` → `NONE/NS/EW/ALL` |
| `deal.boardNumber` | `gamesPlayed` / 导入记录 | 正整数 |
| `status` | 定约、墩数与叫牌结果 | `IN_PROGRESS / PLAYED / PASSED_OUT / CANCELLED / ADJUSTED` |
| `auction.calls` | `state.biddingHistory` | `PASS / X / XX / 1C…7NT` |
| `contract` / `declarer` | `state.contract` | 流局与取消记录不写 |
| `tricksTaken` | 庄家方赢墩数 | 0–13 |
| `play.tricks` | 已完成墩 | 只写满四张的完整墩；进行中的墩不入记录 |
| `score.nsRaw` | `score.NS - score.EW` | NS 视角带符号原始分 |
| `hcp.ns/ew` | 开局四手牌 | 两者合计必须为 40 |
| `derived.imp.singleTable` | `nsRaw` | 单桌参考 IMP，不是比赛结果 |
| `engine` | `beginAuction` 冻结快照 | 见下节 |

记录构建规则：

- 有定约且完成 13 墩 → `PLAYED`；有定约但未完成 → `IN_PROGRESS`；
- 四个连续 PASS → `PASSED_OUT`，且不得包含 `contract / declarer / tricksTaken / play`；
- 有 `play` 必须有 `contract` 与 `declarer`；
- 从旧归档记录导出时，若缺少 `engine`，按导入发牌快照补一个临时快照，但该记录不作为“可复现证明”。

## 4. 开局快照与随机流

`beginAuction` 冻结以下内容：

- 四手牌、发牌人、局况、牌号；
- 叫牌规则集：`system`、`systemVersion`、`rulesetId`、`overlay`；
- 首攻/信号规则集：名称、`rulesetId`、`overlay`、信号 `settings`；
- 四个座位的控制者、叫牌/打牌风格、随机度、DDS 开关、样本数与目标；
- 推断开关 `auctionConstraints` / `leadInference`；
- 发牌来源与四条随机流种子。

随机流公式与 `reproducibility.md` §3 一致：

```text
streamSeed(baseSeed, index, stream) =
  uint32be(SHA-256(ASCII("BRIDGE-RNG/1|" + baseSeed + "|" + index + "|" + stream))[0..4])
```

`baseSeed = 2026, index = 0` 的冻结值：

| 流 | 种子 |
| --- | --- |
| `deal` | 2931564761 |
| `bidding` | 3056024501 |
| `play` | 4016366938 |
| `dds` | 3100401203 |

实现约定：

- 发牌只消费 `deal` 流；AI 叫牌消费 `bidding`；跟牌/垫牌与推荐消费 `play`；DDS 采样兜底消费 `dds`；
- 导入 PBN 时没有发牌流，只派生 `bidding / play / dds`，`dealSource.kind = "imported-pbn"`；
- `engine.rngSeed` 保留为兼容字段：seeded 记录等于 `streams.deal`，导入记录等于 bidding 种子；
- 旧记录若只有 `rngSeed`，导入时四条流都由它初始化，并标记 `rngMode = "legacy-shared"` 供验证器给出警告。

## 5. JSON 导入 / 导出

- 导出为 2 空格缩进、LF、末尾换行的稳定 JSON；
- 导入按 `record.schema.json` 的必需字段、状态约束与随机流公式显式检查，不引入运行时 JSON Schema 依赖；
- 以下情况直接拒绝：缺少 `engine`、`hcp` 合计不为 40、非法叫品、非法牌张、重复牌、`PASSED_OUT` 带定约/出牌、`PLAYED` 缺 `play`、随机流种子与公式不符；
- 以下情况给警告但可导入：`[Dealer]` 与 Deal 前缀不一致、旧记录共享 `rngSeed`、墩 `winner` 与牌张计算结果不一致（以牌张重算结果为准）；
- 导入后恢复叫牌历史、当前叫品、定约、已完成墩、剩余手牌、分数与阶段；`PLAYED` / `ADJUSTED` 进入结算视图。

## 6. PBN 导出 / 导入

导出顺序：

```text
% PBN 2.1
[Board] [West] [North] [East] [South] [Date]
[Dealer] [Vulnerable] [Deal] [Scoring]
[Contract] [Declarer] [Result]
[Auction]
<叫牌 token>
[Play]
<每墩四张>
[Score]
```

规则：

- `[Deal]` 从 `[Dealer]` 开始顺时针排列，缺门写 `-`；
- 叫牌 token 使用 `P / X / XX / 1C…7NT`，导出不写 `AP`，也不追加结束后的 Pass；
- 进行中且尚无完整出牌时不写 `Contract / Declarer / Result`，并在损失报告中说明；
- `[Score]` 写 `NS n` / `EW n`；导入时按方向换算为带符号 `nsRaw`；
- 导入 `[Score]` 与按 `Contract/Result/局况` 计算的分数不一致时，保留导演分并给 `SCORE_MISMATCH` 警告；
- 导入 `AP` 时按当前叫牌状态补足到结束所需的 Pass（可能是 1–4 个），不是固定四个；
- 导入 `[Play]` 时校验牌张属于开局手牌、不能重复、墩赢家按牌张重算；部分墩丢弃并给警告。

损失报告固定包含：`engine` 快照、提醒/规则 id、赛事元数据、球员昵称、导演调整分等。没有 round-trip 测试支撑的字段不声称无损。

## 7. CSV

CSV 是计分/复盘汇总，不是权威记录：

```text
board, dealId, recordId, dealer, vulnerability, status, contract, declarer,
tricksTaken, nsRaw, nsHcp, ewHcp, singleTableImp, rulesetId, createdAt
```

- UTF-8 BOM，逗号分隔，一行一副；
- 包含历史归档记录与当前副；
- 只支持导出；导入请使用 JSON 或 PBN。

## 8. 兼容性

- `exportDealPbn()` / `importDealPbn()` 仍只处理发牌字符串；`exportDealPbn()` 的 PBN 与旧测试保持兼容；
- `toPbnDeal()` 现在输出规范缺门 `-`；`handToPbn()` 默认仍输出 DDS 残局格式的空花色段，只有 `.pbn` 导出使用 `-`；
- `state.rngSeed` 仍保留，但新逻辑以 `engine.streams` 为准；
- `BiddingRule` 冻结契约与 `src/core/*` 桥牌法律语义未改动；`CompiledRule` 的元数据未被交换层依赖。

## 9. 验收

```bash
npm run typecheck
npm test
npm run check:phase0
```

本阶段结果：

- `vue-tsc --noEmit` 通过；
- 46 个测试文件 / 589 个用例通过（新增 `src/exchange/exchange.test.ts` 16 个用例）；
- `check:phase0` 17 项通过，0 警告，0 错误。

新增测试覆盖：

- 四个随机流与文档示例一致、彼此独立、同种子可复现；
- `beginAuction` 冻结快照，局中切换叫牌体系不影响当前副；
- 完整一副的 JSON 往返、状态恢复与非法记录拒绝；
- 完整 PBN 往返、`AP` 展开、Score 方向、非法输入、缺门兼容；
- CSV BOM、表头、历史 + 当前副行数。

## 10. 已知限制

- DDS Worker 的超时、回退与采样顺序仍不承诺逐字节复现；
- PBN 球员标签使用 ASCII 伪名，昵称不进入 JSON；
- PBN 不承载 `engine`、提醒、规则 id 与导演调整分，需要完整信息时使用 JSON；
- JSON 导入恢复的是记录快照，不重新推导人类玩家的自由选择；
- 导入进行中的记录后，AI 循环可能继续推进牌局；需要停在当前状态时应使用 `autoStart: false`；
- CSV 不支持导入，也不包含逐墩明细与引擎快照。
