# ADR-0008：记录 Schema 1.1（七状态、空分、调整历史与兼容）

- 状态：已接受
- 日期：2026-10-28
- 决策人：产品 / 开发
- 关联：`docs/桥牌软件需求规格说明书.txt`（V0.7）5.5、6.8、6.11、7.3、附录 C；`docs/adr/0003-srs-v05-alignment.md` D6；`docs/adr/0005-wbf-rules-scoring.md`；`docs/brules-v0.5/record.schema.json`；`src/exchange/`

## 背景

Schema 1.0 只定义 5 个桌副状态，且 `score.nsRaw` 必须是整数。这个模型无法表达 SRS V0.7 已确认的三类事实：

1. 缺桌/超时未完成（`INCOMPLETE`）与裁判重开（`REOPENED`）也是合法状态；
2. 取消副不应伪装成 0 分——0 分是流局（`PASSED_OUT`）的真实结果，取消副根本没有成绩；
3. 一次改分不足以审计多次裁判操作，取消、改判、重开需要完整历史。

同时，SRS V0.7 要求规则版本与 IMP 表可审计，记录必须显式携带 `wbf-laws-2017` 与 `wbf-2017` 版本标识。Schema 1.0 没有这些字段。

## 裁决

### D1 七状态与合法迁移

`TableBoard.status` 固定为 7 个值：

```text
IN_PROGRESS / PLAYED / PASSED_OUT / CANCELLED / ADJUSTED / INCOMPLETE / REOPENED
```

合法迁移以 SRS V0.7 §5.5 为准：

| 当前 | 允许迁移 | 触发 |
| --- | --- | --- |
| `IN_PROGRESS` | `PLAYED` / `PASSED_OUT` / `CANCELLED` / `INCOMPLETE` | 正常结算 / 流局 / 裁判取消 / 超时未完成 |
| `PLAYED` | `ADJUSTED` / `CANCELLED` | 裁判调整 / 取消 |
| `PASSED_OUT` | `ADJUSTED` / `CANCELLED` | 裁判调整 / 取消 |
| `CANCELLED` | `ADJUSTED` / `REOPENED` | 改判 / 重开 |
| `ADJUSTED` | `ADJUSTED`（保留历史）/ `CANCELLED` | 再次调整 / 取消 |
| `INCOMPLETE` | `PLAYED` / `CANCELLED` | 补打完成 / 取消 |
| `REOPENED` | `IN_PROGRESS` / `CANCELLED` | 重新开始 / 取消 |

Schema 只表达“某个状态下的字段组合”，迁移合法性由领域层/服务端状态机执行；不得仅凭 Schema 放行任意状态跳转。

### D2 原始分可空

`score.nsRaw` 是 NS 视角带符号原始分，类型为 `integer | null`：

| 状态 | `score.nsRaw` | `derived.imp.singleTable` |
| --- | --- | --- |
| `PLAYED` | 整数（可为负） | 按 `wbf-2017` 换算 |
| `ADJUSTED` | 整数（调整后） | 按调整后原始分换算 |
| `PASSED_OUT` | `0` | `0` |
| `CANCELLED` | `null` | `null` |
| `INCOMPLETE` | `null` | `null` |
| `REOPENED` | `null` | `null` |
| `IN_PROGRESS` | 进行中可为 `0` 或已有临时分 | 可省略或按当前分计算 |

约束：

1. **取消副不得写 0**。0 分只属于流局；取消副的赛制补偿必须放 `adjustment.artificialAverage`，并标 `artificial: true`。
2. 无原始分时 `derived.imp.singleTable` 必须为 `null`，不得留 0。
3. 任何 IMP/VP/MP 都不得直接改；只改原始分后重算。

### D3 调整、取消与重开审计

新增两个字段：

- `adjustment`：最新一条裁判操作；
- `adjustHistory`：完整历史，至少 1 条，最后一条必须与 `adjustment` 完全一致。

单条 `Adjustment` 的必需字段：

```text
kind, reason, actor, at, beforeStatus, afterStatus, beforeValue, afterValue
```

`kind` 固定为：

| `kind` | 含义 | `afterValue` | 额外要求 |
| --- | --- | --- | --- |
| `ADJUST` | 裁判改分 | 整数，且必须等于 `score.nsRaw` | `status=ADJUSTED` 时 `adjustHistory` 必需 |
| `CANCEL` | 取消该副 | `null` | `status=CANCELLED` 时 `adjustment.kind` 必须为 `CANCEL` |
| `REOPEN` | 重开审计 | `null` | `status=REOPENED` 时 `adjustment.kind` 必须为 `REOPEN` |

其他规则：

1. `originalRawScore` 记录首次调整前的原始分；取消/重开为 `null`。
2. `beforeValue` 是本次操作前的原始分；无成绩时为 `null`。
3. 已 `CANCELLED` 再改分必须先写入 `REOPEN` 审计，否则领域层返回 `BOARD_CANCELLED_ADJUST_FORBIDDEN`。
4. 调整历史只追加，不删除、不覆盖；再次调整时 `ADJUSTED → ADJUSTED`，旧条目保留。
5. `derived.adjusted` 仅保留为 Schema 1.0 兼容字段；1.1 新记录以 `adjustment / adjustHistory` 为准。

### D4 状态字段约束

| 状态 | 定约/庄家/墩数/出牌 | 说明 |
| --- | --- | --- |
| `IN_PROGRESS` | 叫牌结束后允许带 `contract/declarer/tricksTaken`；`play` 只写完整墩 | 进行中记录可用于断线恢复 |
| `PLAYED` | `contract/declarer/tricksTaken/play` 全部必需 | `play` 至少 1 墩、最多 13 墩 |
| `PASSED_OUT` | 四者都不得出现 | 且 `auction.completed=true` |
| `CANCELLED` | 四者都不得出现 | 必须有 `CANCEL` 审计 |
| `REOPENED` | 四者都不得出现 | 必须有 `REOPEN` 审计 |
| `INCOMPLETE` | 四者都不得出现 | 不计算成绩 |
| `ADJUSTED` | 保留原执行事实；至少不因调整而丢弃已完成的 `play` | 调整只改原始分与审计 |

`PASSED_OUT / CANCELLED / REOPENED` 不得带定约与出牌，是为了避免“取消副看起来像打过”以及回放层误读。`INCOMPLETE` 目前按 SRS 的异常结算处理，不承诺保留半副出牌；若未来需要恢复半副，必须新增字段并升版本。

### D5 版本标记

1. 新导出统一写 `schemaVersion = "1.1"`。
2. `engine.rulesVersion` 固定为 `wbf-laws-2017`（见 ADR-0005）。
3. `derived.imp.tableVersion` 固定为 `wbf-2017`。
4. `$id` 更新为 `https://bridge.local/schema/bridge-record-table-board-1.1.json`。
5. 1.1 不是“破坏性替换”：导入器同时接受 1.0 与 1.1，导出只写 1.1。

### D6 Schema 1.0 兼容

| 场景 | 处理 |
| --- | --- |
| 1.0 的 `IN_PROGRESS / PLAYED / PASSED_OUT / CANCELLED / ADJUSTED` | 可导入 |
| 1.0 出现 `INCOMPLETE / REOPENED` | 拒绝，`STATUS_INVALID`，提示升级到 1.1 |
| 1.0 取消副写 `nsRaw=0` | 可导入，给 `LEGACY_CANCELLED_ZERO_SCORE` 警告；不静默视为流局 |
| 1.0 `ADJUSTED` 只有 `derived.adjusted` | 可导入；不强制补 `adjustment` |
| 1.0 缺少 `engine.rulesVersion` / `derived.imp.tableVersion` | 可导入；导入后按当前版本补默认值，不追溯改写历史语义 |
| 1.0 记录被重新导出 | 导入后统一按 1.1 校验；取消副的 0 分不得静默写回 1.1。单机 store 导入时会保留能通过 1.1 校验的 `status / adjustment / adjustHistory / updatedAt`；1.0 缺审计的取消/调整记录退回牌局推导，避免导出不合法的 1.1 记录 |

导入器在 `src/exchange/json.ts` 中显式实现上述规则，不引入运行时 JSON Schema 依赖。主要错误码：

- `RECORD_INVALID` / `STATUS_INVALID` / `SCORE_INVALID`
- `SCORE_STATE_INVALID` / `IMP_STATE_INVALID` / `IMP_MISMATCH`
- `CONTRACT_STATE_INVALID`
- `ADJUSTMENT_INVALID` / `ADJUSTMENT_HISTORY_MISMATCH`
- `ADJUSTED_INVALID` / `CANCELLED_REASON_MISSING` / `REOPENED_REASON_MISSING`
- `RULES_VERSION_INVALID` / `IMP_TABLE_INVALID`
- `LEGACY_CANCELLED_ZERO_SCORE`（warning）

### D7 PBN / CSV 降级

JSON 是权威记录；PBN 与 CSV 只做互通/报表，不声称无损。

1. `CANCELLED / INCOMPLETE / REOPENED` 导出 PBN 时不写 `[Score]`，也不写 `[Contract] / [Declarer] / [Result]`；损失报告给出 `field: "score"`、`action: "omitted"` 与原因。
2. 上述状态导出 CSV 时 `nsRaw` 与 `singleTableImp` 留空，不写 0。
3. `PASSED_OUT` 仍写 `[Score "NS 0"]` 与 CSV `0`，因为 0 是真实结果。
4. 提醒、规则 id、`engine`、调整历史、`artificialAverage` 不进入 PBN/CSV，必须从损失报告与 JSON 获取。
5. 调整分导入优先使用 `[Score]`；与按 `Contract/Result/局况` 计算不一致时给 `SCORE_MISMATCH` 警告并保留导演分。

### D8 单机适配

1. 单机 store 仍是 Profile S 的唯一权威写入点；`exportTableBoardJson()` 只导出当前副，历史副保存在 `DealRecord`。
2. 导入无成绩状态时，UI 只把 `nsRaw ?? 0` 当作显示值并进入结算视图；不得把该 0 写回记录。
3. 事件流与记录分离：事件是审计/回放来源，`TableBoard` 是投影结果；事件 schema 另行版本化（当前 1.0），不随记录 Schema 1.1 一起改。
4. 未完成副的导出/回放门禁仍按 `srs-board-model.md` 执行；1.1 只放宽“记录可表达未完成”，不放宽“可公开导出”。
5. 单机 store 导入记录时保留可校验的异常状态与调整历史，并在任何正常对局动作后清除导入态；1.0 缺审计的取消/调整记录不强行保留，退回牌局推导。导入不重建导入前的事件历史。

## 后果

- `docs/brules-v0.5/record.schema.json` 升为 1.1；示例 `examples/passed-out.record.json` 同步。
- `src/exchange/types.ts`、`record.ts`、`json.ts`、`pbn.ts`、`csv.ts` 与 store 导入路径同步。
- 新增 `src/exchange/schema11.test.ts`：覆盖 7 状态正/反用例、空分、调整历史、1.0 兼容、PBN/CSV 降级。
- `wbf-2017.json` / `impTable.ts` 成为 IMP 唯一来源；记录与队式结算共用。
- `check:phase0` 增加 7 状态、`nsRaw` 可空、`adjustment/adjustHistory` 与 1.1 示例检查。

## 未决

- `INCOMPLETE` 是否保留半副叫牌/出牌，待断线恢复需求明确后单独立项；当前按“无成绩”处理。
- `artificialAverage` 的具体赛制公式（平均分、板上分、仲裁分）不在本 ADR 冻结；V1 只要求单独保存并标 `artificial=true`。
- `SessionBoard` 的持久化 Schema 与跨桌状态机在 ADR-0006/服务端里程碑细化。
- 1.0 取消副的自动迁移策略（保留 0 还是人工确认后置空）待真实历史数据评估。
