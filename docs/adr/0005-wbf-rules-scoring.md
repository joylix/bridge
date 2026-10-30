# ADR-0005：WBF 2017 规则版本、计分口径与 IMP 表

- 状态：已接受
- 日期：2026-10-28
- 决策人：产品 / 开发
- 关联：`docs/桥牌软件需求规格说明书.txt`（V0.7）0.2、5.4、6.8、6.11、7.1–7.4、12.1；`docs/brules-v0.5/record.schema.json`；`src/core/wbf-2017.json`；`src/core/impTable.ts`；`src/domain/scoring/team.ts`

## 背景

SRS V0.7 要求规则引擎与计分口径可审计、可回归，并明确：

- 规则版本固定为 **WBF Laws of Duplicate Bridge 2017**（`wbf-laws-2017`）；
- 队式赛公式为 `teamImp = impTable(redTeamRaw)`，`redTeamRaw` 已是红队视角代数和，不得再减 `blueTeamRaw`；
- IMP 表随包 `wbf-2017.json`，用表驱动测试（附录 C-1~C-11），不得在测试里硬编码另一套 IMP 数；
- 逐副换算、逐副累加，不得用全盘累计分差一次换算。

此前 `src/core/imps.ts` 已有 0–24 档表，但缺少版本标识、随包数据与哈希校验；队式赛结算也尚未落地。本 ADR 冻结实现口径。

## 裁决

### D1 规则版本

1. 规则版本字符串固定为 `wbf-laws-2017`，写入 `TableBoard.engine.rulesVersion`；`SessionBoard.engine.rulesVersion` 在同一盘内必须与各桌一致。
2. 适用范围：叫牌合法性、加倍/再加倍、出牌跟花色、定约、赢墩判定、合约分（`standard-duplicate`）。
3. 规则版本改变必须新增新版本标识（例如 `wbf-2027`）并保留旧版本回放能力；不得原地修改 `wbf-laws-2017` 的语义。

### D2 本地化差异（当前实现边界）

| 事项 | 当前口径 | 说明 |
| --- | --- | --- |
| 叫牌合法性 | `src/core/bidding/validator.ts` | 叫品必须严格高于当前叫品；加倍/再加倍按最后叫品与方位判定 |
| 出牌合法性 | `src/core/playing.ts` | 有领出花色必须跟牌；缺门可任意出牌；**不强制将吃** |
| 藏牌（revoke） | 不自动判罚 | 记录警告/错误码 `PLAY_REVOKE_PENDING`，交裁判按 WBF 90/91 裁决 |
| 合约分 | `src/core/scoring.ts` | 标准复式计分；不含罚分、判罚扣分与人为调整 |
| 裁判调整 | `TableBoard.adjustment` | 只改原始分，再重算 IMP；不得直接改 IMP |
| 超时、托管、AI 补位 | 产品规则 | 不属于 WBF 条文；写事件与审计 |
| 发牌、局况 | 复现规范 | 由四条随机流决定，不属于 WBF 条文 |

> 任何未实现的 WBF 罚则都不得静默按“无罚则”计分；必须产生错误码/事件并交裁判。

### D3 合约分

1. 每副必须计算合约分，采用 `standard-duplicate`，输出 NS 视角带符号原始分 `rawScore.nsRaw = NS − EW`。
2. 流局 `PASSED_OUT` 的 `nsRaw=0`；取消/未完成/重开 `nsRaw=null`（见 ADR-0008）。
3. 调整分只改 `rawScore`，保留 `originalRawScore` 与 `adjustHistory`；`derived.imp` 与 `SessionBoard` 必须从新原始分重算。
4. V1 不启用 MP/VP；字段可保留但不参与计分。

### D4 队式赛 IMP

1. `redTeamRaw = Σ(红队各桌红队视角原始分)`，**已是代数和**。
2. `teamImp = impTable(redTeamRaw)`；`blueTeamRaw = −redTeamRaw` 仅展示，**不得参与换算**。
3. 逐副换算、逐副累加；不得先累计全盘分差再换算。
4. 异常结算按 SRS 6.11：
   - 任一桌 `CANCELLED` → 该副 `CANCELLED`，不产生 `teamImp`；`artificialAverage` 单独保存并标 `artificial=true`；
   - 任一桌 `INCOMPLETE` / `IN_PROGRESS` / `REOPENED` → 不计算；
   - `ADJUSTED` → 按调整后原始分重算；状态标 `ADJUSTED`；
   - 已 `CANCELLED` 再调整必须先有 `REOPENED` 审计，否则返回 `BOARD_CANCELLED_ADJUST_FORBIDDEN`。

### D5 IMP 表随包与校验

1. 表文件：`src/core/wbf-2017.json`，`version="wbf-2017"`，`rulesVersion="wbf-laws-2017"`。
2. 档位为 0–24 IMP，按分差上界排列；最后一档 `maxDifference=null` 覆盖无限分差，`maxImp=24`。
3. `bandsSha256` 锁定档位数组的 SHA-256；`validateImpTable()` 与测试共同校验版本、单调性、IMP 连续性、上限与哈希。
4. 运行时不从网络下载表；升级表必须随包发布并新增版本号，禁止原地替换。
5. `derived.imp.tableVersion` 与 `SessionBoard.impTableVersion` 写 `wbf-2017`。

### D6 测试口径

1. 附录 C-1~C-11 全部进入自动化测试，期望值由 `impTable()` 计算或由表边界显式核对。
2. C-1 +30→1；C-3 +680→12（不得写 1360→23）；C-9 +920→14；C-11 +5000→24。
3. 表边界至少覆盖 0/±10/±20/±40/±80/±120/±200/±500/±1000/±2000。
4. 每次修改 `wbf-2017.json` 必须同步更新 `bandsSha256` 与测试报告。

## 后果

- 新增 `src/core/wbf-2017.json`、`src/core/impTable.ts`、`src/domain/scoring/team.ts` 与对应测试。
- `src/core/imps.ts` 改为复用随包表；原有函数签名与单机贴点制行为保持不变。
- TableBoard 记录写 `engine.rulesVersion` 与 `derived.imp.tableVersion`（Schema 1.1）。
- 服务端结算必须调用同一 `settleTeamBoards()`，不得另写一套公式。

## 未决

- 藏牌、罚分、裁判裁决（WBF 90/91/86）的完整自动化仍待规则引擎二期；当前只保证“不静默放过”。
- `SessionBoard` 的持久化 Schema 与跨桌并发在 ADR-0006/服务端里程碑中细化。
- MP/VP 未来单独立项，不在 V1。
