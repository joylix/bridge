# BRULES v0.5 条件词表

- 状态：Phase 0 定稿
- 语义来源：`src/engine/types.ts` 的 `ConditionSpec`、`src/engine/conditions.ts`、`src/engine/matcher.ts`、`src/core/evaluate.ts`
- 适用范围：叫牌规则 IR；首攻/信号规则复用同一词表，但本文件只冻结叫牌语义
- 关联：`rules-ir.schema.json`、`grammar.ebnf`、`migration.md`

本文件登记 `ConditionSpec` 的全部 **46** 个键，并额外登记 IR 专有键 **`shapeClass`**。`shapeClass` 不是运行时 `ConditionSpec` 的成员，编译器必须先把它降解为运行时支持的键；不能降解时返回 `UNSUPPORTED_CONDITION`。

## 0. 记号与求值约定

### 0.1 手牌记号

测试向量使用单手 PBN 顺序：`♠.♥.♦.♣`，点数从大到小，`T` 表示 10，缺门写 `-`。例如：

```text
H_BAL   = AKQ2.JT9.543.876      # 4-3-3-3，10 HCP
H_5M    = AKQ32.JT98.54.87      # 5-4-2-2，5 张黑桃，10 HCP
H_5M2   = AKQ2.JT987.54.87      # 4-5-2-2，5 张红桃，10 HCP
H_NO4M  = AKQ.JT9.5432.876      # 3-3-4-3，无四张高花，10 HCP
H_FIT   = AKQJ2.2.5432.876      # 5-1-4-3，10 HCP
H_SOLID = 32.32.32.AKQJ432      # 3-3-3-7，坚固梅花，10 HCP
H_STOP  = AK2.QJ3.876.5432      # 3-3-3-4，S/H 有挡，10 HCP
H_CTRL  = 2.AKQJ.5432.9876      # 1-4-4-4，黑桃单张，10 HCP
H_AX    = A2.KQJ.5432.9876      # 2-3-4-4，黑桃 Ax，10 HCP
H_KX    = K2.AQJ.5432.9876      # 2-3-4-4，黑桃 Kx，10 HCP
H_AXX   = A32.KQJ.5432.987      # 3-3-4-3，黑桃 Axx，10 HCP
H_NOACE = KQJ2.JT9.QJ4.Q76      # 4-3-3-3，0 A，12 HCP
```

测试向量只声明“在这个手牌/上下文下是否成立”，不要求这些手牌能组成完整一副牌。

### 0.2 取值类型

| 类型 | 写法 | 说明 |
| --- | --- | --- |
| `NumRange` | `12`、`15-17`、`5+` | 整数；端点含；不接受 `15-17+`、`17-15`、小数 |
| `StyleVar` | `${open1ntMin}` | 只能出现在 `NumRange` 端点；必须在文件头 `STYLE_PARAMS` 声明 |
| `bool` | `true` / `false` | 小写机器令牌；DSL 导入器大小写不敏感，IR 中规范化为小写 |
| `Suit` | `C` / `D` / `H` / `S` | 单花色；`NT` 只用于 `lastBidSuit` |
| `SuitSet` | `CDHS` 的子集，如 `SH` | 顺序无关；不得为空；重复字母是错误 |
| `Cardinality` | `0`–`4` | 花色数或 A/K 张数；用 `NumRange` 表达 |

### 0.3 未知值总则

| 条件类型 | 上下文缺失时的行为 |
| --- | --- |
| 手牌特征 | 手牌总是已知，不存在“未知” |
| 宽松布尔键（`contextBool`） | 缺失按 `false` 处理。因此写 `true` 不成立；写 `false` **成立** |
| 严格上下文键 | 缺失时条件**不成立**，包括 `partnerOpened`、`opponentSuitFirstControl`、`opponentSuitStopper`，以及所有枚举/阶数键（即使写的是排除式，如 `cueBidSuitNot`） |
| 推断量（`partnerHcp`、`combinedHcp`、`combinedAces`） | 缺失时条件**不成立** |

“缺失按 false”只适用于宽松布尔键（`partnerCueBid`、`myCueBid`、`cueBidActive`、`partnerNaturalSuit`、`myNaturalSuit`、`partnerForcingNewSuit`、`myForcingNewSuit`、`partnerBlackwood`、`myBlackwood`）。严格上下文键缺失时条件不成立，即使写 `false` 也不成立。

### 0.4 求值与具体度

1. `when` 是扁平 AND：所有出现的键都必须成立。
2. 求值顺序不影响结果；实现可以按 `conditions.ts` 的固定顺序短路。
3. `specificity` = `when` 中出现的顶层键数量（值不为 `undefined`）。`shapeClass` 计 1 项，即使它降解为 `balanced` + `fiveCardMajor` 两项。
4. `ANY` / `ALL` 在进入 IR 前展开；一个量化条件仍按 **1** 个源条件计算具体度。展开出的多条规则共享同一个源 `specificity`，不得因展开而变大。
5. 条件求值通过后还要做动作合法性过滤；条件词表不负责叫牌合法性。

### 0.5 v0.4 映射图例

| 标记 | 含义 |
| --- | --- |
| `D` | v0.4 可直接表达；迁移时只做语法改写 |
| `P` | v0.4 只能部分表达；迁移后语义可能变窄或变宽，必须出报告 |
| `U` | v0.4 无法表达；规则只能保留为 `ext.` 私有扩展或不导出 |
| `—` | 当前 `precision.yml` 未使用；仍须定义，迁移不涉及 |

统计：`D=10`、`P=4`、`U=22`、`—=10`。另有 `shapeClass` 对应 v0.4 的 `BAL / SEMIBAL / UNBAL`，不计入 46 个运行时键。

---

## 1. 手牌特征（20 项）

<!-- keys:start -->

| 键 | 类型 | 定义与边界 | 未知时 | 测试向量 | v0.4 |
| --- | --- | --- | --- | --- | --- |
| `hcp` | `NumRange` | 原始大牌点：A=4、K=3、Q=2、J=1，全副 0–40。计分与贴点使用此值，不使用 `adjustedHcp`。 | 不适用 | `H_BAL`：`10` 真、`11` 假 | D |
| `adjustedHcp` | `NumRange` | 调整点 AP：`HCP + 长套点 + 短套点 + 坚固套奖励 − 敌方花色废点`，调整量限制 `[-2,+7]`。长套点取最长进攻花色的第 5/6/7 张各 +1（最多 +3）；短套点仅在 `partnerSupported=true` 且 `trumpSuit` 明确时计入，旁门缺门 +3、单张 +2、双张 +1；最长花色 7+ 且 A/K/Q 齐全 +1；敌方花色单张 K/Q/J 扣 1。 | 不适用 | `H_FIT`：无配合 AP=11，`13+` 假；`{trumpSuit:S, partnerSupported:true}` 时 AP=13，`13+` 真 | U |
| `controls` | `NumRange` | 控制数：A=2、K=1，全副 0–12。 | 不适用 | `H_BAL`：`3` 真、`4+` 假 | D |
| `spades` | `NumRange` | 黑桃长度 0–13。 | 不适用 | `H_BAL`：`4` 真、`5+` 假 | D |
| `hearts` | `NumRange` | 红桃长度 0–13。 | 不适用 | `H_BAL`：`3` 真、`4+` 假 | D |
| `diamonds` | `NumRange` | 方块长度 0–13。 | 不适用 | `H_BAL`：`3` 真、`4+` 假 | D |
| `clubs` | `NumRange` | 梅花长度 0–13。 | 不适用 | `H_BAL`：`3` 真、`4+` 假 | D |
| `balanced` | `bool` | 均型：形状排序后为 `4333` / `4432` / `5332`，**包含 5 张高花的 5332**。这是 v0.5 的 `BAL_ANY`，不是 v0.4 的 `BAL`。 | 不适用 | `H_BAL`：`true` 真；`H_5M`（5422）：`true` 假 | D |
| `losers` | `NumRange` | 简单 LTC，0–12：每门 `max(0, min(3, 长度) − min(顶张数, 3))`，顶张为 A/K/Q；缺门不计失张。 | 不适用 | `H_BAL`：`9` 真、`0-8` 假 | — |
| `voids` | `NumRange` | 缺门花色数，0–4。 | 不适用 | `H_BAL`：`0` 真；`H_CTRL`：`1` 真 | — |
| `singletons` | `NumRange` | 单张花色数，0–4。 | 不适用 | `H_BAL`：`0` 真；`H_FIT`：`1` 真 | — |
| `doubletons` | `NumRange` | 双张花色数，0–4。 | 不适用 | `H_BAL`：`0` 真；`H_5M`：`2` 真 | — |
| `fourCardMajor` | `bool` | 至少一门高花 4+ 张。 | 不适用 | `H_BAL`：`true` 真；`H_NO4M`：`true` 假 | D |
| `fiveCardMajor` | `bool` | 至少一门高花 5+ 张。 | 不适用 | `H_BAL`：`false` 真；`H_5M`：`true` 真 | — |
| `aces` | `NumRange` | A 的张数 0–4。 | 不适用 | `H_BAL`：`1` 真、`2+` 假 | P |
| `kings` | `NumRange` | K 的张数 0–4。 | 不适用 | `H_BAL`：`1` 真、`2+` 假 | — |
| `stoppers` | `SuitSet` | 列出的**每一门**都有挡张。挡张 = 有 Q/K/A；或 J 带至少一张护张；或 T 带至少两张护张。空集、重复字母、非法字母为错误。 | 不适用 | `H_STOP`：`SH` 真、`SHD` 假（方块无挡） | U |
| `solidSuit` | `SuitSet` | 列出的花色中**至少一门**是坚固套：7+ 张且同时有 A/K/Q。空集为错误。 | 不适用 | `H_SOLID`：`CD` 真；同形但缺 Q 的 `AKJ5432`：`CD` 假 | U |
| `noLongSuit` | `bool` | `true` = 没有任何 5+ 张花色；`false` = 至少一门 5+ 张。 | 不适用 | `H_BAL`：`true` 真；`H_5M`：`true` 假、`false` 真 | D |
| `noLongSuitExcept` | `SuitSet` | 除列出的花色外，其余花色都 ≤4 张；列出的花色可以任意长。 | 不适用 | `H_5M`：`S` 真；`H_5M2`：`S` 假、`SH` 真 | D |

## 2. 叫牌进程（19 项）

这些值由 `buildAuctionContext()` / `findBidCandidates()` 从叫牌历史推断，不是手牌特征。序列的座位关系另由 `sequence` 的相对座位 token 表达。

| 键 | 类型 | 定义与边界 | 未知时 | 测试向量 | v0.4 |
| --- | --- | --- | --- | --- | --- |
| `openingSeat` | `NumRange` | 当前叫牌人在本副的绝对开叫座位：1=发牌人，2/3/4 依次其后。只在尚无实质叫品时有效；出现实质叫品后上下文为 `undefined`。 | 条件不成立 | `H_BAL` + `{openingSeat:1}`：`1-2` 真；`{openingSeat:3}`：`1-2` 假；无上下文：假 | P |
| `partnerOpened` | `bool` | 同伴是本副第一个实质叫牌人。 | 条件不成立（严格） | 上下文 `true/false/undefined`：`true` 分别真/假/假；`false` 在 `undefined` 时假 | U |
| `lastBidSuit` | `Suit` 或 `NT` | 全场最后一次实质叫牌的花色；`NT` 表示无将。Pass/X/XX 不改变此值。 | 条件不成立 | 上下文 `{lastBidSuit:'NT',lastBidLevel:3}`：`NT` 真、`S` 假；无上下文：假 | P |
| `lastBidLevel` | `NumRange` | 全场最后一次实质叫牌的阶数 1–7。 | 条件不成立 | 上下文 `{lastBidLevel:3}`：`3` 真、`2` 假；无上下文：假 | P |
| `partnerCueBid` | `bool` | 同伴最后一次叫牌是扣叫：叫了敌方此前已经叫过的花色。 | 缺失按 `false` | 上下文 `true`：`true` 真；`false`：`true` 假；`undefined`：`true` 假、`false` 真 | U |
| `myCueBid` | `bool` | 自己最后一次叫牌是扣叫。 | 缺失按 `false` | 同 `partnerCueBid`，把上下文换成 `myCueBid` | U |
| `cueBidActive` | `bool` | 本副我方（自己或同伴）已经出现过扣叫；一旦出现即保持 `true`。 | 缺失按 `false` | 上下文 `true`：`true` 真；`undefined`：`false` 真 | — |
| `cueBidSuit` | `Suit` | 我方最后一次扣叫的花色；单值。 | 条件不成立 | 上下文 `S`：`S` 真、`H` 假；无上下文：假 | U |
| `cueBidSuitNot` | `Suit` | 我方有扣叫上下文，且扣叫花色**不是**该字母。 | 条件不成立 | 上下文 `S`：`H` 真；上下文 `H`：`H` 假；无上下文：假 | U |
| `cueBidLevel` | `NumRange` | 我方最后一次扣叫的阶数 1–7。 | 条件不成立 | 上下文 `3`：`3` 真、`2` 假；无上下文：假 | U |
| `partnerSuit` | `Suit` | 同伴最后一次**自然**花色叫牌的花色；单值。扣叫与 NT 不算自然花色。 | 条件不成立 | 上下文 `H`：`H` 真、`S` 假；无上下文：假 | U |
| `mySuit` | `Suit` | 自己最后一次自然花色叫牌的花色；单值。 | 条件不成立 | 上下文 `H`：`H` 真、`S` 假；无上下文：假 | U |
| `partnerNaturalSuit` | `bool` | 同伴最后一次叫牌是自然花色（非 NT、非扣叫）。 | 缺失按 `false` | 上下文 `true`：`true` 真；`undefined`：`true` 假、`false` 真 | — |
| `myNaturalSuit` | `bool` | 自己最后一次叫牌是自然花色（非 NT、非扣叫）。 | 缺失按 `false` | 同 `partnerNaturalSuit`，把上下文换成 `myNaturalSuit` | — |
| `partnerForcingNewSuit` | `bool` | v0.5 定义：同伴最后一次自然花色叫牌所命中的规则**同时**带有 `natural` 与 `forcing` 标签。不得再用规则 id 的 `nat_` 前缀判断。 | 缺失按 `false` | 上下文 `true`：`true` 真；`undefined`：`true` 假、`false` 真 | U |
| `myForcingNewSuit` | `bool` | 自己最后一次自然花色叫牌所命中的规则同时带有 `natural` 与 `forcing` 标签。 | 缺失按 `false` | 同 `partnerForcingNewSuit`，把上下文换成 `myForcingNewSuit` | U |
| `partnerBlackwood` | `bool` | 同伴最后一次叫牌是 4NT，且本副我方已有扣叫（`cueBidActive=true`）。单独的 4NT 不算。 | 缺失按 `false` | 上下文 `{partnerBlackwood:true}`：`true` 真；`{}`：`true` 假 | U |
| `myBlackwood` | `bool` | 自己最后一次叫牌是 4NT，且本副我方已有扣叫。 | 缺失按 `false` | 上下文 `{myBlackwood:true}`：`true` 真；`{}`：`true` 假 | U |
| `agreedSuit` | `Suit` | Blackwood 约定将牌：自己叫 4NT 时取同伴此前最后自然花色；同伴叫 4NT 时取自己此前最后自然花色。 | 条件不成立 | 上下文 `H`：`H` 真、`S` 假；无上下文：假 | U |

## 3. 敌方花色相关（4 项）

| 键 | 类型 | 定义与边界 | 未知时 | 测试向量 | v0.4 |
| --- | --- | --- | --- | --- | --- |
| `opponentSuitFirstControl` | `bool` | 敌方最后叫过的花色中，我方有第一轮控制：缺门、单张，或 `Ax`（双张且含 A）。`Axx`、`Kx` 不算。 | 条件不成立 | 敌方 S：`H_CTRL` 真、`H_AX` 真、`H_KX` 假、`H_AXX` 假；无上下文：假 | U |
| `opponentSuitStopper` | `bool` | 敌方最后叫过的花色中，我方有挡张（挡张定义同 `stoppers`）。 | 条件不成立 | 敌方 S：`H_AX` 真、`H_CTRL` 假（单张 2）；无上下文：假 | U |
| `opponentSuitNot` | `Suit` | 敌方有最后叫过的花色，且该花色**不是**此字母。 | 条件不成立 | 敌方 S：`H` 真；敌方 H：`H` 假；无上下文：假 | U |
| `cueSuitStopper` | `bool` | 我方扣叫花色中，我方有挡张。 | 条件不成立 | 扣叫 S：`H_STOP` 真；`H_CTRL` 假；无扣叫：假 | U |

## 4. 推断量（3 项）

| 键 | 类型 | 定义与边界 | 未知时 | 测试向量 | v0.4 |
| --- | --- | --- | --- | --- | --- |
| `partnerHcp` | `NumRange` | 同伴 HCP 的保守**下限**，只在同伴是本副第一个实质叫牌人时推断；不是精确区间，也不是上限。 | 条件不成立 | `H_BAL` + `{partnerHcpMin:19}`：`19+` 真、`20+` 假；无上下文：假 | — |
| `combinedHcp` | `NumRange` | 联手 HCP 保守下限 = 自己 `hcp` + `partnerHcpMin`。仅在 `partnerHcpMin` 存在时成立。 | 条件不成立 | `H_BAL`（10）+ `{partnerHcpMin:19}`：`29+` 真、`30+` 假；无上下文：假 | U |
| `combinedAces` | `NumRange` | 联手 A 数 = 自己 A 数 + 同伴 Blackwood 应答显示的 A 数。5C 为 0/4 模糊应答：自己 0 A 时按同伴 4 A 计，否则按 0 A 计。 | 条件不成立 | `H_BAL`（1 A）+ `{partnerAcesShown:2}`：`3+` 真、`4+` 假；`H_NOACE`（0 A）+ `{partnerAcesShown:0,partnerAcesAmbiguous:true}`：`4+` 真；无上下文：假 | U |

<!-- keys:end -->

## 5. `shapeClass`（IR 专有）

`shapeClass` 不是 `ConditionSpec` 成员，但它是 v0.5 IR 的正式条件键。它的值是形状集合，不是数值区间。

<!-- shape:start -->

| 值 | 精确定义 | 运行时降解 | 测试向量 |
| --- | --- | --- | --- |
| `BAL_ANY` | `{4333, 4432, 5332}`，5332 的 5 张可以是高花或低花 | `balanced: true` | `H_BAL` 真；`H_5M`（5422）假 |
| `BAL_NO_5M` | `{4333, 4432, 5332(5 张为低花)}`；等价于 v0.4 `BAL` | `balanced: true` + `fiveCardMajor: false` | `H_BAL` 真；5332 且 5 张黑桃假；`H_5M` 假 |
| `SEMIBAL` | `{4432, 5332(5 张为低花), 5422, 6322}`；无单张、无缺门、非 4333 | v0.5 运行时返回 `UNSUPPORTED_CONDITION` | `H_5M`（5422）真；`H_BAL`（4333）假；`H_FIT`（5143）假 |
| `UNBAL` | 所有不属于 `BAL_NO_5M` 且不属于 `SEMIBAL` 的 13 张形状 | v0.5 运行时返回 `UNSUPPORTED_CONDITION` | `H_FIT`（5143）真；`H_5M`（5422）假；5332 且 5 张高花真 |

<!-- shape:end -->

### 5.1 集合关系（必须按此实现）

- `BAL_NO_5M` 与 `SEMIBAL` 在 `4432`、`5332(低花)` 上**重叠**；`SEMIBAL` 不是 `BAL_NO_5M` 的补集。
- `BAL_ANY` 与 `SEMIBAL` 在 `4432`、`5332` 上重叠。
- `UNBAL` 是 `BAL_NO_5M ∪ SEMIBAL` 的补集。
- 因此 `5332` 且 5 张为高花时：`BAL_ANY=true`、`BAL_NO_5M=false`、`SEMIBAL=false`、`UNBAL=true`。这是冻结定义的直接结果，不得在实现中“顺手修正”。
- 任何形状都必须恰好有 13 张；非 13 张不参与形状判定，属于非法手牌。

### 5.2 编译规则

1. `shapeClass: BAL_ANY` → `balanced: true`，`specificity` 仍为 1。
2. `shapeClass: BAL_NO_5M` → `balanced: true` + `fiveCardMajor: false`，`specificity` 仍为 1。
3. `shapeClass: SEMIBAL` / `UNBAL` → 诊断 `UNSUPPORTED_CONDITION`；规则保留在 IR，但不进入可执行规则集。
4. 同一 `when` 中同时出现 `shapeClass` 与 `balanced` / `fiveCardMajor` 时，按 AND 合并；矛盾组合产生 `CONTRADICTORY_CONDITION` 警告，不自动删除规则。

## 6. 与 v0.4 的映射汇总

### 6.1 可直接映射（10）

`hcp`、`controls`、`spades`、`hearts`、`diamonds`、`clubs`、`balanced`、`fourCardMajor`、`noLongSuit`、`noLongSuitExcept`。

`balanced` 必须特别处理：v0.4 `BAL` 排除 5 张高花的 5332，v0.5 `balanced` 包含它。迁移 v0.4 `BAL` 时应写 `shapeClass: BAL_NO_5M`，而不是 `balanced: true`。

### 6.2 只能部分表达（4）

`openingSeat`、`aces`、`lastBidSuit`、`lastBidLevel`。迁移报告必须写明“原表达式覆盖的范围”与“迁移后覆盖的范围”，不能只写 `transformed`。

### 6.3 无法表达（22）

`adjustedHcp`、`stoppers`、`solidSuit`、`partnerOpened`、`partnerCueBid`、`myCueBid`、`cueBidSuit`、`cueBidSuitNot`、`cueBidLevel`、`partnerSuit`、`mySuit`、`partnerForcingNewSuit`、`myForcingNewSuit`、`partnerBlackwood`、`myBlackwood`、`agreedSuit`、`opponentSuitFirstControl`、`opponentSuitStopper`、`opponentSuitNot`、`cueSuitStopper`、`combinedHcp`、`combinedAces`。

处置三选一：标准化为 v0.5 键（已在 IR 中）、放入 `ext.` 私有扩展并声明、或不导出。Phase 2 覆盖率报告逐项关闭。

### 6.4 当前规则未使用（10）

`fiveCardMajor`、`kings`、`losers`、`voids`、`singletons`、`doubletons`、`partnerHcp`、`partnerNaturalSuit`、`myNaturalSuit`、`cueBidActive`。

它们仍有正式语义，供新规则和测试使用；不得因为当前 YAML 未使用就从 Schema 或词表中删除。

## 7. 条件键一致性检查

`npm run check:phase0` 必须验证：

1. `src/engine/types.ts` 的 `ConditionSpec` 恰好有 46 个键；
2. 本文件 `keys:start` / `keys:end` 区间内的键集合与 `types.ts` 完全相等；
3. `rules-ir.schema.json` 的 `ConditionKey.enum` 等于 46 个键 + `shapeClass`；
4. 本文件的 `shapeClass` 枚举与 Schema 的 `ShapeClass.enum` 完全一致；
5. 每个键在表格中都有非空的“定义与边界”“未知时”“测试向量”单元格。

一致性检查是结构检查，不替代 Phase 1 的条件求值测试。
