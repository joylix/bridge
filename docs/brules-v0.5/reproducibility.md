# 复现快照、随机流与 `rulesetId`

- 状态：Phase 0 定稿
- 目标：让每副 `TableBoard` 的 AI 决策、发牌和计分在相同环境下可检查、可重放
- 非目标：承诺 DDS 深度搜索逐字节复现；事件流存储；Profile P 的服务端留存
- 关联：`record.schema.json`、`pbn.md`、`README.md`

## 1. 复现承诺的边界

在下列条件同时满足时，叫牌决策应可重算复现：

1. 相同的 `engine.ruleset.rulesetId`（以及可取得的同一规则集内容）；
2. 相同的 `engine.playRulesets`（首攻、信号、`settings`）；
3. 相同的 `engine.seats`（控制者、风格、随机度、DDS 开关、目标）；
4. 相同的 `engine.inference` 开关；
5. 相同的 `engine.deal`（PBN 或可重放的发牌种子）；
6. 相同的引擎/编译器版本，或至少是声明兼容的版本；
7. 相同的 `engine.rulesVersion`（当前固定 `wbf-laws-2017`）与 IMP 表版本（`derived.imp.tableVersion=wbf-2017`）。

以下**不**承诺复现：

- DDS Worker 超时、回退路径和采样顺序导致的出牌差异；
- 浏览器/运行时差异导致的浮点或排序差异；
- 规则集被覆盖层修改后，旧 `rulesetId` 已不可取得；
- 人类玩家的自由叫牌/出牌（记录中的实际动作才是权威）；
- “推荐 + 浮动层解释”的显示状态。

回放以记录中的实际出牌为准，不重新跑 DDS 来“纠正”牌局。

## 2. 开局快照

每副牌在 `beginAuction` 时冻结以下内容。冻结后，牌局进行中修改规则、风格或 DDS 配置**不得**影响当前副。

| 快照项 | 记录位置 | 说明 |
| --- | --- | --- |
| 四手牌 | `deal.pbn` | 开局 52 张；不是打牌后的残局 |
| 发牌人 | `deal.dealer` | 与 PBN `[Dealer]` 一致 |
| 局况 | `deal.vulnerability` | `NONE/NS/EW/ALL` |
| 牌号 | `deal.boardNumber` | 局号/副号 |
| WBF 规则版本 | `engine.rulesVersion` | 当前固定 `wbf-laws-2017`；升级必须新增版本号 |
| IMP 表版本 | `derived.imp.tableVersion` | 当前固定 `wbf-2017`；随包表与 `bandsSha256` 锁定 |
| 叫牌规则集 | `engine.ruleset` | `system`、`systemVersion`、`rulesetId`、`overlay` |
| 首攻规则集 | `engine.playRulesets.lead` | 名称、`rulesetId`、`overlay` |
| 信号规则集 | `engine.playRulesets.signal` | 名称、`rulesetId`、`overlay`、`settings` |
| 座位配置 | `engine.seats.N/E/S/W` | 控制者、叫牌/打牌风格、随机度、DDS 选项、目标 |
| 推断开关 | `engine.inference` | `auctionConstraints`、`leadInference` |
| 发牌来源 | `engine.dealSource` | `seeded` 或 `imported-pbn` |
| 随机流 | `engine.streams` | `deal/bidding/play/dds` 的实际种子 |
| DDS 全局配置 | `engine.dds` | Worker 超时、采样、回退；没有则省略 |
| 快照时间 | `engine.snapshotAt` | ISO 8601，带时区 |
| 引擎版本 | `engine.engineVersion` | 用于兼容性判断，不替代 `rulesetId` |

### 2.1 冻结规则

```text
startNewGame / importDealPbn
  → 读取当前生效规则（内置 + 覆盖层合并）
  → 计算 rulesetId / lead.rulesetId / signal.rulesetId
  → 深拷贝座位配置、推断开关、DDS 配置
  → 写入快照
  → beginAuction
```

规则编辑器修改 `biddingRules` 时：

- 当前副继续使用快照中的规则对象；
- 修改只影响下一副；
- 修改后 `ruleRevision` 自增，但不改变当前副的 `rulesetId`；
- 不得通过共享引用让当前副“看到”修改后的数组。

现有实现使用响应式共享数组，且 `parseBiddingRules` 会按 `priority` 排序并丢失声明顺序；Phase 3 必须在适配层做深拷贝并保留源序号。

## 3. 随机流

### 3.1 四条流

| 流 | 用途 | 消费者 |
| --- | --- | --- |
| `deal` | 洗牌；发牌；局况抽取 | 开局 |
| `bidding` | AI 叫牌的 ε 探索/随机选择 | `selectBidCandidate` |
| `play` | AI 出牌的随机选择 | `playAI` |
| `dds` | DDS 采样/随机化 | DDS 适配层 |

四条流必须彼此独立。不得再用一个共享 `rng` 同时服务发牌、局况、叫牌、出牌和 DDS。

### 3.2 种子派生

```text
streamSeed(baseSeed, index, stream) =
  uint32be( SHA-256( ASCII("BRIDGE-RNG/1|" + baseSeed + "|" + index + "|" + stream) )[0..4] )
```

- `baseSeed`：32 位无符号整数；
- `index`：副序号，从 0 开始；
- `stream`：`deal` / `bidding` / `play` / `dds`；
- `uint32be`：取 SHA-256 前 4 字节按大端解释；
- PRNG 算法沿用现有 `makeRng`（mulberry32 变体），不得在 v0.5 中更换。

示例：`baseSeed=2026, index=0`

| 流 | 种子（十进制） | SHA-256 前 8 位 |
| --- | --- | --- |
| `deal` | `2931564761` | `aebc20d9` |
| `bidding` | `3056024501` | `b6273bb5` |
| `play` | `4016366938` | `ef64e55a` |
| `dds` | `3100401203` | `b8cc5e33` |

记录必须写 `baseSeed`、`index` 和四条流的实际种子。校验时：

```text
streams.deal    == streamSeed(baseSeed, index, "deal")
streams.bidding == streamSeed(baseSeed, index, "bidding")
streams.play    == streamSeed(baseSeed, index, "play")
streams.dds     == streamSeed(baseSeed, index, "dds")
```

不一致 → `STREAM_SEED_MISMATCH` 错误。

### 3.3 发牌与局况

`deal` 流的消费顺序固定为：

1. 洗牌（`shuffle(createDeck(), rng)`）；
2. 局况抽取（`VULNERABILITIES[floor(rng() * 4)]`）；
3. 后续若新增发牌相关随机，只能追加在末尾，不得插入中间。

记录 `deal.vulnerability` 是权威值；重放时先按种子生成，再与记录比较。不一致 → `DEAL_REPLAY_MISMATCH`。

### 3.4 叫牌与出牌

- 每次 AI 决策消耗随机数的次数必须由实现版本固定；
- 相同 `bidding` 种子、相同记录叫牌序列、相同规则集，必须得到相同 AI 叫牌；
- 人类叫牌不消耗 `bidding` 流，但会改变后续 AI 的输入；
- 回放时人类叫牌使用记录值，AI 叫牌重算；不一致 → `AUCTION_REPLAY_MISMATCH`；
- 出牌回放默认使用记录值，不重算 AI；若显式开启 `replayPlay=true`，不一致只记 `PLAY_REPLAY_MISMATCH`，不改变记录。

### 3.5 `rngSeed` 兼容

`engine.rngSeed` 是旧字段，表示“开局前的初始种子”。新记录以 `streams` 为准：

- `seeded` 记录可写 `rngSeed = streams.deal`，但回放不得只读它；
- `imported-pbn` 记录没有发牌种子，可省略 `rngSeed`，但仍必须写 `bidding/play/dds` 三条流；
- 只有 `rngSeed`、没有 `streams` 的旧记录进入 `legacy-shared` 模式：四条流都从 `rngSeed` 初始化，消费顺序按产生该记录的旧引擎版本；
- `legacy-shared` 只能由声明兼容旧模式的回放器读取；
- 不得把 `legacy-shared` 记录当作新流水线可复现的证明。

## 4. `rulesetId`

### 4.1 定义

```text
rulesetId = "sha256:" + lowercase_hex( SHA-256( JCS( semanticProjection(IR) ) ) )
```

- `JCS`：RFC 8785 JSON Canonicalization Scheme；
- 输入是覆盖层合并后的**生效 IR**；
- 规则顺序是声明顺序，不是按 `priority` 排序后的顺序；
- 输出固定 `sha256:` + 64 位小写十六进制。

### 4.2 语义投影

包含：

- `format`、`formatVersion`、`kind`；
- `system`、`systemVersion`；
- `defaults`（含默认优先级）；
- `styleParams`（变量名列表，保持未展开形式）；
- `rules`：按声明顺序，每条包含 `id`、`sequence`、`when`、`action`、`priority`、`tags`、`enabled`；
- 规则顺序本身。

不包含：

- `description`、`examples`；
- `source`、`author`、`locale`；
- `source.file`、`source.line`、`source.column`；
- `ext` 中的非语义元数据；
- `specificity`（它是 `when` 的派生值；若 IR 显式给出且与派生值不一致，编译失败，不进入投影）；
- 迁移报告、诊断、UI 提示、试用状态。

`ext` 中任何改变裁决的私有扩展都不得只靠 `ext` 表达；必须提升为正式条件键，否则 `rulesetId` 不能声称标识行为。

### 4.3 覆盖层

```text
effectiveIR = merge(builtinIR, overlayIR)
rulesetId   = hash(semanticProjection(effectiveIR))
```

- `overlay` 字段只表示“是否含覆盖层”，不参与哈希内容本身；
- 同一内置文件 + 不同覆盖层 → 不同 `rulesetId`；
- 覆盖层删除规则、修改 `when`、修改 `priority`、修改 `tags`、修改 `enabled` 都会改变 `rulesetId`；
- 只修改 `description` → `rulesetId` 不变；
- 覆盖层合并必须先完成，再计算 `rulesetId`；不得先算内置文件再追加覆盖层。

### 4.4 示例

`examples/minimal.rules.json` 的语义投影（JCS 后）：

```json
{"defaults":{"priority":50},"format":"bridge-rules-ir","formatVersion":"0.5","kind":"bidding","rules":[{"action":"1NT","enabled":true,"id":"open_1nt","priority":80,"sequence":"^$","tags":["natural"],"when":{"hcp":"${open1ntMin}-${open1ntMax}","shapeClass":"BAL_NO_5M"}},{"action":"1C","enabled":true,"id":"open_1c","priority":70,"sequence":"^$","tags":["natural","forcing"],"when":{"hcp":"16+","shapeClass":"BAL_ANY"}}],"styleParams":["open1ntMin","open1ntMax"],"system":"precision","systemVersion":"0.5.0"}
```

对应：

```text
rulesetId = sha256:39e571721cec89a8d3c8c1e7d469953f369961d5aaf4ed6c557a0e76aa8b7cd7
```

该值只用于示例；修改任何规则字段都会改变它。

## 5. 回放算法

```text
1. 读取 TableBoard，校验 schemaVersion / status / 必需字段
2. 校验 hcp.ns + hcp.ew == 40
3. 重建 Deal
   - imported-pbn：解析 deal.pbn；校验 dealer/vulnerability
   - seeded：用 deal 流洗牌、发牌、抽局况；与记录比较
4. 取得规则集
   - 按 rulesetId 查找生效规则集
   - 重新计算 rulesetId，必须相等
   - 找不到 → RULESET_UNAVAILABLE
5. 装载 playRulesets 与 settings
6. 装载 seats / inference / dds 配置
7. 回放叫牌
   - 人类/记录动作：直接应用
   - AI 动作：用 bidding 流重算
   - 任何不一致：AUCTION_REPLAY_MISMATCH
8. 回放出牌
   - 默认直接应用记录牌张
   - 校验合法性、赢墩、墩数
9. 重算计分
   - 由 contract / tricksTaken / vulnerability 计算
   - 与 score.nsRaw 比较；director 分不一致只警告
10. 重算 derived
   - IMP、贴点、MP/VP 可重算；缓存值不是正本
11. 输出一致性报告
```

### 5.1 回放模式

| 模式 | 叫牌 | 出牌 | DDS |
| --- | --- | --- | --- |
| `audit`（默认） | 记录值 | 记录值 | 不重算 |
| `ai-replay` | AI 重算 | 记录值 | 不重算 |
| `full-replay` | AI 重算 | AI 重算 | 可重算，仅信息 |

`full-replay` 不承诺与记录逐张一致；DDS 差异不构成记录错误。

### 5.2 一致性报告

| 码 | 严重度 | 含义 |
| --- | --- | --- |
| `RULESET_MISMATCH` | error | 重新计算的 `rulesetId` 与记录不同 |
| `RULESET_UNAVAILABLE` | error | 找不到对应规则集 |
| `DEAL_REPLAY_MISMATCH` | error | 种子重放的牌与 `deal.pbn` 不同 |
| `STREAM_SEED_MISMATCH` | error | `streams` 与派生公式不符 |
| `AUCTION_REPLAY_MISMATCH` | error | AI 重算叫牌与记录不同 |
| `PLAY_REPLAY_MISMATCH` | warning | 重算出牌与记录不同（仅 full-replay） |
| `SCORE_MISMATCH` | warning | 重算计分与记录不同 |
| `HCP_SUM_INVALID` | error | `hcp.ns + hcp.ew != 40` |
| `CONTRACT_STATE_INVALID` | error | `PASSED_OUT` 带 `contract`，或 `PLAYED` 缺 `play` |
| `DDS_REPLAY_DIVERGED` | info | DDS 重算结果不同，不影响记录 |

## 6. 与现有实现的差距

| 现状 | 风险 | Phase 3 处理 |
| --- | --- | --- |
| 单一 `rng` 服务发牌、局况、叫牌、出牌、DDS | 无法独立重放 | 拆四条流，按第 3 节派生 |
| `DealRecord` 无 `rulesetId`、无种子、无座位快照 | 规则/风格变了无法解释 | 增加 `engine` 块 |
| `parseBiddingRules` 按 `priority` 排序，丢失声明顺序 | 同优先级平局不可复现 | 保留源序号，排序稳定 |
| 规则编辑器共享响应式数组 | 当前副可能看到修改 | 开局深拷贝冻结 |
| `exportDealPbn` 使用发牌快照 | 方向正确 | 保持 |
| DDS Worker 超时/回退 | 出牌不确定 | 记录实际出牌，不承诺重算 |
| 无事件流 | 无法逐事件审计 | 后续子阶段，不阻塞导出 |

## 7. 验收

1. 相同 `baseSeed`、`index`、流名得到相同种子（第 3.2 节示例可复算）。
2. 相同生效 IR 得到相同 `rulesetId`；只改 `description` 不改变它。
3. 覆盖层改变任一语义字段，`rulesetId` 必须改变。
4. 开局后修改规则，当前副的 `rulesetId` 与快照不变。
5. 用 `seeded` 记录重放，发牌、局况、叫牌、出牌、计分逐项一致。
6. 用 `imported-pbn` 记录重放，不依赖发牌种子。
7. `PASSED_OUT` 记录重放得到 `nsRaw=0`，`20 − NS 大牌点` 只作为派生值。
8. 规则集缺失时明确报 `RULESET_UNAVAILABLE`，不得用当前规则集“近似”重放。
9. DDS 重算差异只记 `DDS_REPLAY_DIVERGED`，不篡改记录。
10. 现有 447 个用例不因快照设计而改变；Phase 3 前不切换运行时。
