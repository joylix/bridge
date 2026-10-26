# 《BRULES v0.4》评审与采用建议

> 评审对象：`docs/BRULES v0.4.txt`（372 行，2026-10-26 新增）
> 代码基线：`main @ b8db32f` + 工作区未提交改动
> 评审日期：2026-10-26
> 基线验证：37 个测试文件 / 447 个用例通过；`npm run typecheck` 通过
> 结论：**不建议全面改用 BRULES v0.4 作为唯一规则与数据格式。建议把它定位为“叫牌规则的可移植交换格式”，运行时继续使用现有引擎，对局数据继续以 PBN + JSON 事件流为主；在 BRULES 修正 P0 缺陷并补齐能力后，再评估是否扩大使用范围。**

---

## 0 执行摘要

### 0.1 三句话结论

1. **BRULES v0.4 的定位是“叫牌规则 + 手牌/叫牌序列”DSL，不是完整桥牌格式。** 它明确把 `PLAY`（出牌、防守信号）列为未实现，也没有定约、结果、计分、IMP、回放事件、审计等数据；无法单独支撑“叫牌、出牌、分析、数据交换”四类需求。
2. **以现有精确制规则衡量，全面替换会直接造成能力回退。** `precision.yml` 现有 1074 条规则、36 个在用条件键、54 个优先级、297 种序列模式；其中只有 10 个条件键能直接映射到 BRULES，4 个只能部分表达，22 个无法表达；BRULES 还没有规则优先级、具体度裁决、风格变量和历史推理。
3. **BRULES 仍有明显价值，但应作为“交换/编译目标”而不是“运行时唯一格式”。** 它的显式 EBNF、相对/绝对方位隔离、宏和 PBN 对齐方向是对的；建议先修 P0 问题，做一个“BRULES ↔ 内部规则 IR”的编译器 PoC，用现有 447 个测试和固定种子基准验证行为等价后，再决定是否扩大。

### 0.2 建议决策

- **不全面改用**：不删除现有 YAML 引擎，不把 BRULES 作为唯一运行时格式。
- **采用三层分工**：
  - **BRULES**：叫牌规则的可移植交换/外部编辑格式；
  - **PBN**：发牌、叫牌、出牌的国际交换格式；
  - **JSON 事件流**：本系统的运行时、回放、审计、队式赛数据格式。
- **先做 v0.5 修正 + 编译器 PoC**：不改运行时，先证明“现有规则可编译、决策等价、无法表达项可清单化”。
- **出牌层单独立项**：不要把 `PLAY` 硬塞进 BRULES v0.4；它需要的是另一套状态模型。

### 0.3 不建议的做法

- 直接把 `precision.yml` 改写成 BRULES 并切换运行时；
- 把 BRULES 的 `DEAL/HAND/BIDSEQ` 当作完整对局记录；
- 相信文档中“BRULES ↔ PBN 双向无损”的表述；
- 在 BRULES 还没有优先级/裁决机制时，用它驱动 AI 叫牌。

---

## 1 评审范围与基线

### 1.1 BRULES v0.4 是什么

BRULES v0.4 定义了三类顶层语句：

- `COND`：可复用的条件表达式；
- `RULE`：`COND:条件名 => BID:叫品` 的叫牌推理规则；
- `DEAL + HAND + BIDSEQ`：手牌与叫牌序列的牌例存档。

它覆盖的是“叫牌规则定义”和“手牌/叫牌记录”的一个子集，不覆盖：

- 出牌、防守信号、首攻策略（§7 明确 `PLAY` 未实现）；
- 定约、庄家、结果、计分、IMP/MP；
- 多桌、队式赛、跨桌比对；
- 回放事件、审计、账号、时间戳、序号；
- 规则优先级、冲突裁决、默认规则；
- 规则说明、提醒、体系元数据；
- JSON Schema（§7 明确后续产出）。

### 1.2 现有实现基线

| 项目 | 现状 |
|---|---|
| 叫牌规则 | `precision.yml` 1074 条；`natural.yml` 23 条演示规则 |
| 条件字段 | `ConditionSpec` 约 46 个字段；`precision.yml` 实际使用 36 个 |
| 优先级 | 54 个不同 `priority` 值；同优先级按条件具体度裁决 |
| 序列模式 | 297 种不同 `sequence`；支持 `^$`、`.*`、相对座位 `M/P/L/R` 后缀匹配 |
| 首攻 | `leads.yml` 4 条策略规则 |
| 跟牌/垫牌 | `signals.yml` 11 条细则 + 阈值 |
| 规则编辑 | YAML + `RuleEditor.vue`，支持本地覆盖、校验、恢复默认 |
| PBN | 目前只实现发牌字符串的导入/导出，不含 Auction/Play |
| 对局记录 | `DealRecord` 含叫牌、定约、墩、原始手牌、得分、阶段 |
| 测试 | 37 个测试文件 / 447 个用例 |

### 1.3 需求侧约束

SRS V0.5 要求：

- 注册制、账号与权限；
- 单桌与队式赛、多桌同牌、跨桌 IMP；
- 超时/托管/重连/旁观/回放；
- JSON 事件流、PBN、CSV 导出；
- 对局/成绩单/回放保存 1 年，审计 3 年；
- 防作弊的导出/回放时点与跨桌隔离。

这些要求决定了：**单一 BRULES 文件不可能承担平台数据交换职责**，必须有事件流与关系型/文档型持久化模型。

---

## 2 需求覆盖矩阵

| 需求 | BRULES v0.4 能力 | 现有实现 | 结论 |
|---|---|---|---|
| 叫牌规则定义 | 支持 `COND/RULE`，有布尔组合、相对方位、宏 | YAML + 36 条件键 + 优先级/具体度 | **部分覆盖，不能直接替换** |
| 叫牌进程推理 | 只有“某方位最近一次叫牌”紧邻前序语义；`EVER:` 仅预留 | 历史推断 `partnerOpened`、扣叫、自然套、Blackwood、联手点力等 | **能力不足** |
| 出牌/防守信号 | 无 `PLAY`；明确未实现 | `leads.yml` + `signals.yml` + 启发式 | **不覆盖** |
| 双明手/Par 分析 | `DEAL/HAND` + 发牌人/局况可支撑纯 DD/Par | DDS WASM + Par + 结果面板 | **部分可用** |
| 定约/结果/计分/IMP | 无 | 合约分、IMP、贴点、成绩单 | **不覆盖** |
| 对局回放/审计 | 无事件、时间戳、序号、操作人 | `DealRecord` + 历史面板 | **不覆盖** |
| PBN 导入/导出 | 声称映射，但只覆盖 Deal/Auction 子集 | 仅发牌字符串；无 Auction/Play | **需重做映射** |
| 多桌/队式赛 | 无 | SRS 已定义，代码未实现 | **不覆盖** |
| 规则解释/提醒 | 只有规则名；无 description/alert | `description` + 提醒浮层 | **能力不足** |
| 规则编辑/校验 | 有 EBNF，但无实现、无错误码/位置 | YAML 校验 + 编辑器 | **需新建工具链** |
| 数据交换/版本化 | 有 `VERSION`；无 JSON Schema/元数据 | PBN + 本地 JSON | **只能做子集交换** |

---

## 3 与现有规则引擎的量化差距

### 3.1 规则规模与裁决

现有 `precision.yml`：

- 1074 条规则；
- 54 个不同优先级；
- 297 种不同 `sequence`；
- 同一优先级下按 `conditionSpecificity`（条件项数量）裁决；
- 候选必须通过序列匹配、条件判断、动作合法性过滤，再按“优先级 ↓ → 具体度 ↓ → 声明顺序”稳定排序。

BRULES v0.4 的 `RULE` 只有：

```text
RULE: <rule_name> | COND:<cond_name> => BID:<叫品>
```

没有 `priority`、没有具体度、没有“首匹配/默认/兜底”语义。多条规则同时匹配时如何选择，规范没有定义。对 AI 叫牌来说这是**阻断级缺陷**：同一手牌可能得到不确定的叫品。

### 3.2 条件词表映射

`precision.yml` 实际使用的 36 个条件键中：

| 类别 | 数量 | 条件键 |
|---|---:|---|
| 可直接映射 | 10 | `hcp`、`controls`、`spades`、`hearts`、`diamonds`、`clubs`、`balanced`*、`fourCardMajor`、`noLongSuit`、`noLongSuitExcept` |
| 只能部分表达 | 4 | `openingSeat`、`aces`、`lastBidSuit`、`lastBidLevel` |
| 无法表达 | 22 | `adjustedHcp`、`stoppers`、`solidSuit`、`opponentSuitFirstControl`、`opponentSuitStopper`、`opponentSuitNot`、`cueSuitStopper`、`partnerCueBid`、`myCueBid`、`cueBidSuit`、`cueBidSuitNot`、`cueBidLevel`、`partnerSuit`、`mySuit`、`partnerForcingNewSuit`、`myForcingNewSuit`、`partnerBlackwood`、`myBlackwood`、`agreedSuit`、`combinedAces`、`partnerOpened`、`combinedHcp` |

\* `balanced` 只是“能写出类似条件”，语义并不等价：现有 `isBalanced` 接受任意 5-3-3-2（包括 5 张高花）；BRULES 的 `BAL` 明确把“5 张为高花”的 5332 排除，归入 `UNBAL`。`precision.yml` 有 219 条规则使用 `balanced`，这个差异会改变大量开叫/应叫行为。

此外，`ConditionSpec` 还有 `losers`、`voids`、`singletons`、`doubletons`、`partnerHcp`、`myNaturalSuit`、`partnerNaturalSuit`、`cueBidActive` 等字段当前规则未使用，但 BRULES 同样不能表达；未来扩展仍会遇到同一堵墙。

#### 具体例子

1. **`open_1c`（16+ 任意牌型）**
   - 现有：`sequence: "^$"` + `hcp: "16-40"`。
   - BRULES：可以写 `ME:(PTS>=16)`，但没有 `^$`/“本副尚无实质叫品”的条件，规则会在竞争叫牌中误触发；也没有“我是第一个叫牌人”的约束。
2. **`open_1d`（第一/二家 4+ 方块）**
   - 现有：`openingSeat: "1-2"` + `diamonds: "4+"`。
   - BRULES：无法在 `COND` 中表达发牌人/座位序号；`DEALER` 只在 `DEAL` 头，不在条件里。
3. **强牌扣叫**
   - 现有：`partnerCueBid`、`opponentSuitFirstControl`、`cueBidSuit`、`cueBidLevel` 等。
   - BRULES：没有“扣叫”派生谓词，也没有“敌方花色”变量；只能枚举具体叫品，无法表达“同伴最近叫的是敌方花色”。
4. **联手点力/同伴点力**
   - 现有：`partnerHcp`、`combinedHcp`、`partnerOpened`（484 条规则使用）。
   - BRULES：没有点力推断，也没有跨座位算术；`PTS` 只表示“当前手牌”。
5. **Blackwood**
   - 现有：`myBlackwood`、`partnerBlackwood`、`agreedSuit`、`combinedAces`。
   - BRULES：没有 4NT 上下文、将牌约定、A 数合并；无法表达。

### 3.3 叫牌进程与历史

现有 `sequence` 是独立的序列模式，支持：

- `^$`：尚无实质叫品；
- `.*`：任意历史，兜底；
- `M/P/L/R` 相对座位 + 后缀匹配；
- `M:` 开头时要求该叫品是本副第一次实质叫牌；
- `partnerOpened` 规则对同伴首次叫牌做额外校验。

BRULES 只有“某方位最近一次叫牌恰为某叫品”的紧邻前序语义。它无法表达：

- “本副尚无实质叫品”；
- “我是第一个叫牌人”；
- “同伴是开叫人，不是争叫人”；
- “历史上曾叫过某叫品”（`EVER:` 仅预留）；
- “最后一次实质叫品”（不区分是谁叫的）；
- “同伴最近的自然套/扣叫套/强自然新花”；
- “我方是否已经建立将牌配合”。

这些不是边缘语义：`partnerOpened` 被 484 条规则使用，`lastBidSuit/lastBidLevel` 合计 53 条，`partnerCueBid` 22 条。BRULES 目前无法承载现有规则库的主体。

### 3.4 风格与元数据

现有规则支持：

- 风格参数 `${open1ntMin}`、`${overcallMinHcp}` 等；
- `style` 覆盖；
- `description` 用于叫牌含义浮层与规则编辑器；
- `priority`、`action`、`sequence`、`when` 的可视化编辑与校验。

BRULES：

- 没有变量/风格参数；
- 没有 `description`、`alert`、`system`、`author` 等元数据；
- 规则名只有 `rule_xxx`，无法承载中文说明；
- 规范要求“仅纯 ASCII”，现有中文 `description` 无法直接保留（只能放旁路元数据或英文注释）。
- 没有 `priority`，规则编辑器也无法按现有方式排序。

### 3.5 迁移成本

如果“全面改用”，至少需要：

1. 实现 BRULES 词法/语法/语义分析器（当前仓库没有）；
2. 为 1074 条规则逐条改写或写编译器；
3. 为 22 个无法表达的条件新增 BRULES 谓词；
4. 新增规则优先级/裁决模型；
5. 新增历史推理/变量绑定；
6. 重做规则编辑器、校验、错误提示；
7. 重跑 447 个测试、固定种子基准、叫牌评估；
8. 接受行为漂移并逐条修复。

这不是“换文件格式”，而是一次规则引擎重写。以当前 1074 条规则的规模，风险远大于收益。

---

## 4 BRULES v0.4 的 P0 问题

以下问题会直接影响正确性，建议在 v0.5 修正前不要作为运行时格式。

### 4.1 相对方位顺序与标准 LHO/RHO 相反

BRULES §1.1 写：

- `LHO` = 上家（先于 ME 叫牌）；
- `RHO` = 下家（后于 ME 叫牌）；
- 顺时针顺序：`ME → RHO → PAR → LHO → ME`。

但标准桥牌术语中：

- **LHO = 左手敌方 = 下家 = 在我之后叫牌**；
- **RHO = 右手敌方 = 上家 = 在我之前叫牌**；
- 顺时针顺序应为 `ME → LHO → PAR → RHO → ME`。

现有引擎 `relSeat` 也是这个标准：`L` 取下一家，`R` 取上一家。

因此 BRULES 的 `LHO/RHO` 定义与标准术语相反；如果直接迁移，所有涉及左右敌方的规则会整体左右颠倒。示例本身也暴露了这个问题：

- `cond_stayman_clean` 写 `PAR:(1NT) + LHO:(-)`。同伴 1NT 后，先叫牌的是 ME 的右手敌（标准 `RHO`），不是 `LHO`。
- `cond_lebensohl_2s` 写 `PAR:(1NT) + LHO:(2S)`。同伴 1NT 后争叫 2S 的同样是 `RHO`。
- 同文件的 `cond_neg_double` 又写 `PAR:(1S) + RHO:(X)`，说明示例内部对 LHO/RHO 的使用并不一致。

这是最危险的 P0 问题：它不是“文档笔误”，而是会让整套规则在左右方向上系统性错位。

### 4.2 `allpass` 语义与示例错误

BRULES §1.6 规定：

- `allpass` 等价于连续四个 `-`；
- 前面必须已有至少一个有效叫品，且 `PosBid` 数量 ≥ 4；
- 纯四家全 Pass 不允许用 `allpass`，必须逐位写 `-, -, -, -`。

但桥牌规则是：**一个实质性叫品之后，连续三个 Pass 即结束叫牌**，不需要第四个 Pass。示例：

```text
BIDSEQ: N:1NT,E:-,S:2C,W:-,N:2H,E:-,S:3NT,W:-,allpass
```

在 `S:3NT` 之后已经写了 `W:-`，若 `allpass` 再展开四个 Pass，就会出现 5 个连续 Pass；若 `allpass` 表示“剩余全部 Pass”，则只需 `N:-`、`E:-` 两个。无论哪种解释，这个示例都不符合桥牌规则。

PBN 映射同样受影响：不应在已有 Pass 后再追加四个 `P`；PBN 常见写法是 `AP` 或补足到叫牌结束的连续 Pass。

### 4.3 `ALL(U)` 只有量词、没有谓词

BRULES §1.5(5) 说“如需全称（两门都满足）必须显式写 `ALL(U)` / `ALL(L)`”，但 EBNF 只有：

```text
AllQuant = "ALL" , "(" , SuitAgg , ")" ;
```

也就是 `ALL(U)` 只量化了“高花集合”，却没有说明两门高花要满足什么条件。`ALL(U)` 单独出现没有可判定的语义；`ALL(U) + U:#>=5` 仍然是存在量词，不能表达“两门高花都 ≥5 张”。

应改为 `ALL(U, <expr>)` 或 `ALL(U: <expr>)` 之类，并明确绑定变量。

### 4.4 缺少规则裁决机制

BRULES 的 `RULE` 没有：

- `priority`；
- 具体度；
- 文件内顺序是否决定优先级；
- 默认/兜底规则；
- 多规则命中时的冲突解决。

现有引擎有 54 个优先级和具体度裁决。BRULES 若不补这一层，无法替代现有叫牌 AI。

### 4.5 历史/上下文表达能力不足

BRULES 只有“最近一次叫牌”的紧邻前序语义，且 `EVER:` 仅预留。缺少：

- `FIRST` / `LAST` / `OPENED` / `PASSED_HAND`；
- 自然叫品 vs 扣叫；
- 同伴/自己的最后自然套；
- 敌方花色变量；
- 将牌配合/扣叫上下文；
- 规则 id 上下文（现有 `partnerForcingNewSuit` 依赖 `nat_` 前缀）。

这些是竞争叫牌、扣叫、满贯试探的核心语义，不是可选项。

### 4.6 缺少关键桥牌谓词

BRULES 目前只有 `PTS`、`CTL`、花色张数、`BAL/SEMIBAL/UNBAL`、花色牌张集合。缺少：

- 局况/发牌人条件（`VUL/DEALER` 只在 `DEAL` 头，不在 `COND`）；
- 失张数（LTC）；
- 缺门/单张/双张的**数量**（不是某一门长度）；
- A/K 总数；
- 挡张（stoppers）；
- 坚固套（solid suit）；
- 调整点（Adjusted Points）；
- 同伴点力下限/联手点力；
- 敌方花色第一轮控制/挡张；
- 风格阈值变量。

### 4.7 PBN 映射不是“双向无损”

§4 标题是“BRULES ↔ PBN 双向无损映射表”，但实际只覆盖：

- `DEALER`、`VUL`；
- 四家手牌；
- 叫牌序列。

没有映射：

- `[Board]`、`[Event]`、`[Site]`、`[Date]`、`[Session]`；
- `[West]`/`[North]`/`[East]`/`[South]` 球员；
- `[Scoring]`、`[Contract]`、`[Declarer]`、`[Result]`；
- `[Play]` 出牌过程；
- `[Tag]` 自定义标签、注释、来源。

具体文本也有错误：

- §4 说“花色间用空格分隔，如 `N:AKQ.JT9.876.5432`”，文字说空格，示例用点号；PBN 标准是点号。
- `VUL=NONE` → `[Vulnerable "None"]` 不是“直接字符串复制”，需要大小写/词表转换。
- `BIDSEQ` 带方位，PBN `Auction` 不带方位；反向转换需要发牌人和顺序。
- `allpass` 映射见 4.2，不能简单追加四个 `P`。

因此只能称“子集映射”，不能称“双向无损”。

### 4.8 文法/词法边界不清

- `Comment = "#" , { Character }` 没有换行/EOF 终结符；EBNF 又说换行可忽略，注释在哪里结束不明确。
- `Character` 不包含 `#`、`/`、`"`、`=`、`*`、`>`、`<` 等，导致注释不能写常见符号；示例里的英文注释刚好避开了这些字符。
- 规范要求“仅纯 ASCII”，现有中文规则说明无法进入 `description`。
- 示例注释本身违反 `Character` 字符集：第 194 行含 `{}`、`;`、`=`，第 198 行含 `/`，第 195 行含 `*`，这些都不在 `Symbol` 中；按 EBNF，示例文件无法通过自己的注释规则。
- `S` 同时是方位（南）和花色（黑桃），`X` 是加倍、`x` 是小牌，`ALL` 同时是局况值和全称量词；规范说“靠语法位置”，但词法层必须显式规定大小写敏感与上下文相关词法，否则解析器会产生歧义。
- 没有规定 `COND`/`RULE` 重名、重复定义、前向引用、错误恢复、源码位置。
- `VersionLine` 没有换行终结；`File = VersionLine, {Line}` 在“空白可忽略”的前提下边界不清。

### 4.9 出牌层完全缺失

§7 明确：

- `PLAY` 语句（出牌、防守信号）未实现；
- 精确体系完整 BRULES 库另行编写；
- 极简 JSON Schema 后续产出。

因此 BRULES v0.4 **不能**用于出牌规则、首攻、信号、防守推理。现有 `leads.yml`/`signals.yml` 也不是同一层：它们是策略标识 + 阈值，不是完整的出牌状态机。

### 4.10 数据交换元数据缺失

BRULES 没有：

- 局号/盘号/桌号/队名；
- 球员/账号；
- 时间戳、事件序号、操作人；
- 定约/庄家/结果/宕墩；
- 计分/IMP/MP；
- 回放/审计事件；
- 多桌/队式赛关系；
- JSON Schema。

这些正是 SRS V0.5 的“1 年留存、可导出、可回放、防作弊”所必需的。

---

## 5 P1/P2 问题

| # | 问题 | 影响 | 建议 |
|---|---|---|---|
| 1 | `VersionLine = Digit "." Digit` 只支持一位版本号 | 未来 `0.10` 无法表示 | 改为多位数或语义化版本文法 |
| 2 | 注释字符集过窄 | 无法写 URL、比较符、中文说明 | 注释允许除换行外任意字符 |
| 3 | 无 `description`/`alert`/`system` 元数据 | 规则编辑器、叫牌解释缺失 | 增加 `META`/`RULE` 元数据 |
| 4 | 无 namespace/include | 大规则库无法拆分 | 增加 `INCLUDE` 或模块机制 |
| 5 | 无重名/重复定义校验 | 规则覆盖、难以排错 | 语义分析强制唯一 |
| 6 | 无错误码/源码位置 | 外部工具难集成 | 定义诊断格式 |
| 7 | 无 formatter/linter | 规则库不可维护 | 随 parser 提供 |
| 8 | `SetExpr` 允许重复牌张但约束说去重 | 语义不一致 | 明确“出现即集合”，或强制去重 |
| 9 | `HAND` 的 13 张/52 张只是文字约束 | 解析器易放过坏数据 | 语义校验内置 |
| 10 | `DEAL` 多副牌无 ID/分隔 | 难定位/引用 | 增加 `BOARD`/`DEAL_ID` |
| 11 | 无“规则适用体系/版本” | 精确制/自然制混用 | 增加 `SYSTEM` 元数据 |
| 12 | 无 JSON Schema | 入库/AI 训练不可用 | 先出 JSON Schema，再谈交换 |

---

## 6 三种采用方案对比

| 方案 | 做法 | 成本 | 风险 | 结论 |
|---|---|---|---|---|
| A. 全面替换 | 删除 YAML，运行时直接解析 BRULES，重写 1074 条规则 | 高（规则重写 + 引擎重写 + 工具链） | 极高（能力回退、行为漂移、出牌缺失） | **不推荐** |
| B. 双格式/编译器 | 保留 YAML/现有引擎；实现 BRULES ↔ 内部 IR 编译器；BRULES 用于交换/导入导出 | 中（parser + 编译器 + 测试） | 中（映射不全，但可清单化） | **推荐近期采用** |
| C. 长期演进 | 内部统一 JSON IR；YAML/BRULES 都作为表面语法；PBN/JSON 负责数据 | 中高（IR 设计 + 迁移） | 中（可分阶段） | **推荐作为目标架构** |

### 6.1 为什么推荐 B + C，而不是 A

- 现有引擎的 1074 条规则是最大资产，不应为了格式统一而重写；
- BRULES 的强项是“可移植、可外部编辑、有 EBNF”，适合做交换层；
- 运行时需要优先级、历史推理、风格变量、解释文本，这些是现有引擎的强项；
- 数据交换需要 PBN/JSON，BRULES 不应越界；
- 通过编译器可以逐步验证 BRULES 的表达能力，而不影响线上行为。

---

## 7 推荐架构：三层分工

```text
                 规则作者 / 外部工具 / 其他桥牌软件
                    │            │            │
                 YAML         BRULES        JSON IR
              （现有编辑）   （交换/编译）   （未来统一）
                    │            │            │
                    └──────► 编译器 / 校验器 ◄──────┘
                                 │
                        内部 BiddingRule IR
                  （sequence + when + priority + metadata）
                                 │
                     ┌───────────┴───────────┐
                     │                       │
                 叫牌 AI / 解释           规则编辑器 / 分析
                     │
                 对局数据层
        ┌────────────┼────────────┬─────────────┐
      PBN         JSON 事件流     CSV 成绩单    DDS/Par
   （发牌/叫牌/出牌）（回放/审计）  （导出）     （分析）
```

### 7.1 各层职责

- **内部 IR**：唯一运行时事实来源，保留 `sequence`、`when`、`priority`、`description`、`style`、`metadata`。
- **YAML**：现有作者/编辑器格式，可继续使用；不需要为了 BRULES 立即迁移。
- **BRULES**：外部交换格式；编译器把 BRULES 子集转成内部 IR，无法表达的条件返回明确诊断。
- **PBN**：发牌、叫牌、出牌的国际交换；扩展现有 `pbn.ts` 支持 `[Auction]`、`[Play]`、`[Contract]`、`[Result]`。
- **JSON 事件流**：本系统的回放、审计、队局、超时/托管/裁判操作；与 SRS 的 1 年留存/导出对接。
- **CSV**：成绩单导出，不作为规则/对局主格式。

### 7.2 BRULES 编译器的最小闭环

1. 解析 BRULES v0.4/v0.5；
2. 构建 AST；
3. 语义校验（方位、重复定义、引用、牌张、叫牌序列）；
4. 把 `COND/RULE` 编译为内部 `BiddingRule`；
5. 对无法表达的条件返回 `UNSUPPORTED_CONDITION` 诊断；
6. 反向导出内部规则为 BRULES 子集；
7. 用固定种子/固定牌例比较“编译前 vs 编译后”的叫牌决策。

---

## 8 如果继续推进：BRULES v0.5 修订清单

| # | 修订 | 验收 |
|---|---|---|
| 1 | 修正 LHO/RHO 定义与顺时针顺序 | `ME → LHO → PAR → RHO`；与现有 `relSeat`/PBN 一致 |
| 2 | 修正 `allpass`：三 Pass 结束；纯 Pass 局单独定义 | 示例 `S:3NT,allpass` 可解析且与 PBN 互转 |
| 3 | 把 `ALL` 改为 `ALL(<suit>, <expr>)` | 可表达“两门高花都 ≥5 张” |
| 4 | 增加规则优先级/具体度/默认规则 | 多规则命中结果确定、可复现 |
| 5 | 增加历史算子 `FIRST/LAST/OPENED/PASSED/NATURAL/CUE/EVER` | 可表达现有 `partnerOpened`、扣叫、最后自然套 |
| 6 | 增加桥牌谓词与变量 | 覆盖 `stoppers`、`losers`、`solidSuit`、`partnerHcp`、`combinedHcp`、`adjustedHcp`、`VUL/DEALER` |
| 7 | 增加风格变量/参数 | 精确制/自然制可共享规则 |
| 8 | 修正 PBN 映射并改为“子集映射” | Deal 用点号；Auction/Play/Contract/Result 明确定义；不宣称无损 |
| 9 | 明确词法/注释/大小写/错误位置 | parser 可处理中文注释或旁路元数据；无歧义 |
| 10 | 增加 `META`/`BOARD`/`DEAL_ID`/JSON Schema | 可入库、可训练、可交换 |

> 出牌层建议单独设计，不在这 10 项内硬塞；如果必须统一，另立 `BRULES-PLAY` 子规范。

---

## 9 分阶段落地与验收

### 阶段 0：文档修正（1–2 天）

- 修正 P0 语义/文法问题；
- 明确“叫牌子集”与“出牌/对局数据”边界；
- 决定是否保留 `DEAL/HAND/BIDSEQ` 作为牌例交换。

### 阶段 1：编译器 PoC（3–5 天）

- 实现 BRULES parser + AST + 校验；
- 选 20 条代表性规则（开叫、应叫、竞争叫牌、扣叫、Blackwood）做双向编译；
- 输出“可编译/部分/不支持”清单；
- 用固定牌例比较决策。

### 阶段 2：全量覆盖率报告（1–2 周）

- 对 1074 条规则做静态映射；
- 统计可直接编译、需扩展、无法表达的比例；
- 若可编译率低于阈值（建议 90%），不切换运行时；
- 通过 447 个测试 + `npm run benchmark` + `npm run bidding-eval` 验证行为。

### 阶段 3：PBN/JSON 数据层（1–2 周）

- 扩展 `pbn.ts` 支持 Auction/Play/Contract/Result；
- 定义 JSON 事件 Schema（与 SRS 6.7/7.4 对齐）；
- 做 BRULES→PBN→BRULES 的子集回归，明确损失字段。

### 退出条件

- 现有 1074 条规则 **100%** 有明确去向（编译成功或列入不支持清单）；
- 固定种子/固定牌例的叫牌决策与现有引擎一致；
- 447 个测试全绿；
- PBN/JSON 导出可被第三方工具读取；
- 任何“无损”声明都有 round-trip 测试支撑。

---

## 10 结论

**不建议全面改用 BRULES v0.4。**

更合适的定位是：

- **BRULES = 叫牌规则的可移植交换格式**；
- **现有 YAML/内部 IR = 运行时规则引擎**；
- **PBN = 发牌/叫牌/出牌的国际数据交换**；
- **JSON 事件流 = 本系统回放、审计、队式赛、留存的数据格式**；
- **出牌规则 = 独立设计，不依赖 BRULES v0.4**。

如果目标是“未来叫牌、出牌、分析、数据交换都用一套规则”，那么需要的是 **BRULES v1.0（或另一套完整桥牌数据规范）**，而不是当前 v0.4。当前 v0.4 可以作为这个目标的起点，但必须先修 P0，再通过编译器 PoC 证明不会造成能力回退。

---

## 附录 A：36 个在用条件键的映射明细

### A.1 可直接映射（10）

`hcp`、`controls`、`spades`、`hearts`、`diamonds`、`clubs`、`balanced`*、`fourCardMajor`、`noLongSuit`、`noLongSuitExcept`。

\* `balanced` 语义需对齐：现有引擎接受任意 5332；BRULES `BAL` 排除 5 张高花的 5332。

### A.2 只能部分表达（4）

| 条件键 | 现有语义 | BRULES 限制 |
|---|---|---|
| `openingSeat` | 开叫座位 1–4 | `DEALER/VUL` 只在 `DEAL` 头，不能进 `COND` |
| `aces` | A 的张数 | 只能用 `SetExpr` 判断某花色有 A，不能跨花色计数 |
| `lastBidSuit` | 最后一次实质叫品花色 | 只能按方位取“最近一次”，不能取全局最后实质叫品 |
| `lastBidLevel` | 最后一次实质叫品阶数 | 同上 |

> `kings` 在 `ConditionSpec` 中存在但 `precision.yml` 未使用；其表达能力与 `aces` 相同，同样不能跨花色计数。

### A.3 无法表达（22）

`adjustedHcp`、`stoppers`、`solidSuit`、`opponentSuitFirstControl`、`opponentSuitStopper`、`opponentSuitNot`、`cueSuitStopper`、`partnerCueBid`、`myCueBid`、`cueBidSuit`、`cueBidSuitNot`、`cueBidLevel`、`partnerSuit`、`mySuit`、`partnerForcingNewSuit`、`myForcingNewSuit`、`partnerBlackwood`、`myBlackwood`、`agreedSuit`、`combinedAces`、`partnerOpened`、`combinedHcp`。

---

## 附录 B：现有规则统计口径

- 规则数：对 `precision.yml` 的 `rules` 数组计数，1074 条。
- 条件键：对每条规则 `when` 的键取并集，36 个。
- 优先级：对 `priority` 去重，54 个。
- 序列模式：对 `sequence` 去重，297 个。
- 条件使用频次（部分）：`hcp` 713、`partnerOpened` 484、`balanced` 219、`stoppers` 110、`lastBidSuit` 29、`lastBidLevel` 24、`partnerCueBid` 22、`opponentSuitFirstControl` 15。
- 测试基线：37 个测试文件 / 447 个用例；`npm run typecheck` 通过。
