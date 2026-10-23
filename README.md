# 桥牌游戏 MVP（人机对战 · 可配置规则引擎）

按 `docs/` 下的《桥牌游戏 MVP 开发文档 V1.4》与《桥牌游戏 MVP 详细设计文档 V1.4》
落地的可运行实现。V3.0 文档已明确：**本阶段的编码规范以 MVP V1.4 为准**
（规则引擎契约、人类控制模型均已冻结）。

- 用户坐 **南家**，北/东/西为机器人。
- **核心法律硬编码**（叫牌合法性、加倍/再加倍、跟牌义务、赢墩判定、标准计分）。
- **叫牌策略外部化**：YAML 规则 + 相对座位序列匹配 + 扁平 AND 条件 + 优先级/具体度裁决 + ε 探索。
- **首攻**由 YAML 规则驱动；跟牌/垫牌由 `signals.yml` 的阈值与规则目录配合启发式执行（张数信号、不鼓励垫牌、有将无损失鼓励垫牌、避免堵塞）。
- **叫牌/打牌提示**：悬停中央叫牌表记录或叫牌卡上的合法叫品时，用右侧浅青薄纱浮层显示该叫品含义，并附带推荐叫品说明；人类回合绿色高亮推荐叫品，出牌时闪烁箭头指向推荐牌，悬停箭头显示推荐理由。所有提示可在设置中一键关闭。
- **双明手分析**：结算详情中可查看 DDS 双明手结果表、Par 定约与可成约定约（`bridge-dds` WASM，运行在 Web Worker，不阻塞牌桌）。
- **PBN 导入 / 导出**：牌桌顶部可复制、下载或以 PBN 字符串直接开新牌局。
- **固定种子基准**：`npm run benchmark` 可批量跑完整 AI 对 AI 牌局，支持 Par 对照与 DDS 打牌强度对抗；`npm run bidding-eval` 用 DDS 双明手结果单独评估纯叫牌。
- **DDS 深度打牌**：在只使用自己手牌、已摊开明手、已出牌和剩余张数的前提下抽样隐藏牌，再用 DDS 评估候选牌；可在设置中关闭并回退原启发式。
- 机器人可按座位配置 **叫牌风格 / 打牌风格（0 保守 / 1 正常 / 2 激进）** 与 **随机度 randomness**。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | TypeScript + Vue 3 + Vite + Pinia |
| UI | Element Plus（辅助布局，牌桌自定义组件） |
| 规则解析 | js-yaml（Vite `?raw` 构建期内联） |
| 双明手分析 | bridge-dds（DDS WASM，Web Worker 内运行） |
| 测试 | Vitest（happy-dom，DDS 用例使用 Node 环境） |

## 快速开始

```bash
npm install
npm run dev        # 开发服务器（默认 http://localhost:5173）
npm run build      # 类型检查 + 生产构建
npm test           # 运行全部单元 / 集成测试
npm run typecheck  # 仅类型检查
```

## 目录结构

```
src/
├── core/                 # 桥牌核心法律（硬编码，不可配置）
│   ├── deck.ts           # 牌定义、洗牌（可播种）、发牌
│   ├── evaluate.ts       # 大牌点/控制点/花色长度/均型（修正 5-4-2-2、5-4-3-1）
│   ├── bidding/validator.ts  # 叫牌法律：层级、加倍/再加倍权限、动作合法性、parseAction
│   ├── playing.ts        # 出牌法律（跟牌义务、合法牌生成）
│   ├── pbn.ts            # PBN 发牌字符串 ⇄ 内部四手牌（支持残局不等长手牌）
│   ├── auction.ts        # 叫牌结束判定、庄家与定约构造（store/基准共用）
│   ├── trick.ts          # 赢墩判定（beatsCard / determineTrickWinner）
│   └── scoring.ts        # 标准复式计分（含局况、满贯/成局、加倍/再加倍）
├── benchmark/            # 无界面固定种子基准、DDS 对照与同步出牌决策器
├── ai/                   # 叫牌 / 打牌 AI
│   ├── bidAI.ts          # 候选 → 裁决/探索 → 兜底 Pass
│   ├── playAI.ts         # 首攻走 YAML；跟牌/垫牌启发式 + 信号约定；非法降级
│   └── dds/              # DDS Worker、隐藏牌抽样、打牌求解与结果映射
├── engine/               # 规则引擎（冻结接口）
│   ├── types.ts          # BiddingRule / LeadRule / SignalRule / ConditionSpec / StyleParams / STYLE_PARAMS
│   ├── matcher.ts        # 相对座位序列匹配 + 候选匹配（含动作合法性过滤）
│   ├── conditions.ts     # 条件词表 + 风格变量替换 + 具体度
│   ├── loader.ts         # YAML 解析 + 规则文件注册表 + 本地覆盖（浏览/修改）
│   └── arbiter.ts        # mulberry32 随机源 + 优先级/具体度裁决 + ε 探索
├── rules/                # 策略规则（YAML，外部可替换）
│   ├── bidding/precision.yml  # 标准精确叫牌法（裁剪版，默认）
│   ├── bidding/natural.yml    # 自然叫牌法（备选，用于演示“可替换”）
│   └── play/{leads.yml, signals.yml}
├── models/               # card / hand / gameState（含 controllableSeats）
├── permissions.ts        # 用户角色与规则编辑权限（当前所有用户可改）
├── store/game.ts         # Pinia 状态机 + AI 调度 + 人类控制权 + 规则管理
├── components/           # Table / Hand / BiddingBox / BidMeanings / ScoreBoard / GameHistory / RuleEditor / PbnDialog
├── testing/              # 测试辅助
├── App.vue
└── main.ts

scripts/
└── benchmark.ts          # 基准 CLI（vite-node）
```

## 规则引擎契约（冻结）

### 序列 token（相对当前叫牌人）

`M`=自己 / `P`=同伴 / `L`=LHO（下一家）/ `R`=RHO（上一家）；
**从历史末尾对齐匹配**。特殊值：`^$` = 尚无实质叫品；`.*` = 任意（兜底）。

```yaml
- id: resp_1c_1d_negative
  sequence: "P:1C R:Pass"   # 同伴刚叫 1C、RHO 刚 Pass（相对座位，可识别敌方干扰）
  when: { hcp: "0-7" }
  action: "1D"
  priority: 90
```

### 条件词表（扁平 AND，可含风格变量）

`hcp` / `controls`（A=2 K=1）/ `spades|hearts|diamonds|clubs`（长度）/
`balanced`（4-3-3-3 / 4-4-3-2 / 5-3-3-2）/ `losers`（简单 LTC）/
`voids|singletons|doubletons`（牌型张数）/ `fourCardMajor|fiveCardMajor`/
`aces|kings` / `stoppers`（如 `"SHD"`）/ `openingSeat` /
`partnerOpened`（区分“应叫同伴开叫”与“应叫同伴争叫/再叫”）/
`partnerHcp` / `combinedHcp`（同伴点力下限 / 联手点力下限）。
区间支持 `"16-40"`、`"5+"`、`"12"`，可引用 `${open1ntMin}`、`${overcallMinHcp}`
等风格阈值。

`partnerHcp` 与 `combinedHcp` 使用 `src/engine/partnerInference.ts` 的**保守下限推断**：
只在同伴是本副第一个实质叫牌人（开叫人）时生效，按开叫及少数明确再叫估算同伴 HCP
下限；无法确定时条件不成立。当前主要用在 `1C-1NT-2S` 后的满贯试探。

### 裁决与探索

候选先经 **序列匹配 + 条件 + 动作合法性** 过滤，再按
**优先级↓ → 条件具体度↓ → 声明顺序** 稳定排序。
`randomness=0` 严格取最优；`>0` 以低概率在“次优但有依据”的候选中偏离，
**绝不产生非法动作**，随机源由 `rngSeed`（mulberry32）播种，可复现。

## 人类控制模型

- `humanSeats = ['S']`；`controllableSeats(state)` 动态计算：
  - 人类所在方为定约方 → `[declarer, dummy]`（覆盖“南做庄/北明手”与“南明手/北做庄”）；
  - 人类为防守方 → `['S']`。
- 首攻落地后明手立即摊牌；仅轮到可控座位时手牌可点击；`isAiThinking` 期间禁用交互。
- 人类叫牌**仅受法律约束**，可自由诈叫。

## 计分约定

采用标准复式计分，得分归“赢分方”、另一方为 0；`doubled` 与 `redoubled` 互斥。

> 与设计文档 3.6 的一处差异：设计文档示例将“加倍/再加倍礼貌奖分”统一记为 +50；
> 本实现按标准规则取 **加倍 +50 / 再加倍 +100**，以保证计分正确（其余算法一致）。

### 计点胜负（分类德贴点制，默认开启）

“计点”汇总在标准 IMP 基础上按**经典贴点制**折算，本副最终点数：

```
本副点数 = IMP −（胜方联手大牌点 − 20）
```

- “胜方”＝本副得分方（成约则定约方，宕墩则防守方）；全副 40 点，故 `胜方点 − 20`
  等于双方大牌点差的一半；
- 结果**可为负**：拿高牌方若只赢到少量 IMP 会被倒扣，鼓励低点进局/进贯；
- **流局（四家 Pass，无得分方）**：改由大牌点多的一方贴点给少的一方，
  `本副点数 = 20 − 南北大牌点`（即点少方得正、点多方得负）；
- 逐副折算后按 `roundSize`（8 或 16 副）累加为循环内的 `NS / EW 累计点数` 与
  `总点数差（计点胜负）`。

贴点依据的双方大牌点会随对局一并归档（`DealRecord.hcp`），因此在
ScoreBoard 关闭“贴点制”开关后，历史与累计点数可即时回退为纯 IMP。

结果窗口与详细结果中，**“NS/EW 原始分”**是复式赛原始得分（未贴点），
**“NS/EW 点数”**和**“本局点数（已贴点）”**才是贴点后的最终点数。

> 完整的贴点公式、示例与流局规则见 **`docs/帮助文档.md`**。

## 双明手分析（DDS）

结算详情弹窗（`DealResultDialog`）依次展示结果信息、牌型分布 / 叫牌过程、打牌过程（内部滚动），
双明手分析放在最下方并默认折叠，点击“双明手分析”后才开始计算；
结果窗口（`ResultTable` 右上角“双明手”）也可查看本副分析：

- 使用 `bridge-dds`（Apache-2.0）的 WASM 版 DDS，在独立 Web Worker 中求解；
- 展示 5×4 双明手结果表（♠♥♦♣NT × NESW）、Par 定约与分数、可成约摘要；
- 当前实际定约在表中以描边高亮；绿色表示 ≥ 7 墩；
- 牌局数据不完整、Worker 不可用或求解超时时自动回退为提示，不影响正常计分与复盘。

PBN 转换位于 `src/core/pbn.ts`，负责四手牌 ⇄ PBN 发牌字符串；`toPbnHands()` 支持
残局的不等长手牌，供 DDS 逐张求解使用。`src/ai/dds/dds.test.ts` 使用固定牌例校验
WASM 结果表、Par 输出与带当前墩的残局求解。

## DDS 深度打牌（隐藏牌抽样）

设置中 **“DDS 深度打牌”** 默认开启。每次 AI 出牌时：

1. 只用 **AI 自己的手牌、已摊开的明手、已完成/当前墩的已出牌、各座位剩余张数** 生成未知牌池；
2. 按剩余张数随机分配给未知三家，并用叫牌历史做宽松 HCP 下界过滤；
3. 每个样本构造 DDS `SolveBoardPBN` 请求（`solutions=3` 返回全部合法牌）；
4. 按每个样本的最高分候选投票，平票时保留启发式的信号张偏好；
5. Worker 不可用、超时、样本非法或求解失败时，静默回退到原 `playAI`。

关键约束：**实战路径不会读取 `dealHands` / 其他三家的真实手牌**。DDS 只看到抽样后的
合法分布，因此不会出现“双明手作弊”。可在设置中关闭该功能，立即恢复纯启发式。

## PBN 导入 / 导出

牌桌顶部 **“PBN 导入/导出”**：

- **读取当前牌局**：从发牌快照导出，即使已经打了一半也仍是完整 52 张；
- **复制 / 下载 .pbn**：标准 `N:... ... ... ...` 格式；
- **导入并开始**：校验 52 张牌无重复后，按 PBN 前缀的发牌人开始新一局；
- 导入时可保留当前局况，或由调用方指定局况。

## 固定种子基准

```bash
npm run benchmark -- --deals 20 --seed 2026
npm run benchmark -- --deals 20 --seed 2026 --par          # 追加 DDS Par 对照
npm run benchmark -- --deals 20 --seed 2026 --dds --samples 4
npm run benchmark -- --deals 20 --seed 2026 --samples 4 --vs-heuristic
npm run benchmark -- --deals 20 --seed 2026 --samples 4 --vs-heuristic --no-auction-constraints  # 关闭叫牌反推
npm run benchmark -- --deals 20 --seed 2026 --samples 4 --vs-heuristic --no-lead-inference        # 关闭首攻推断
```

- 基准与正式对局共用叫牌裁决、首攻规则、出牌 AI、墩判定与计分，但不经过 UI/延时；
- 每副使用 `deriveSeed(baseSeed, index)` 派生种子，固定 `--seed` 可完全复现；
- `--par` 输出每副实际得分与 DDS Par 的差值，以及汇总“vs par IMP”；
- `--dds` 用与浏览器相同的抽样/汇总逻辑替换启发式出牌；
- `--vs-heuristic` 做左右手对抗：DDS 一方 vs 启发式一方，交换阵营后汇总强度差；
- `--objective tricks|contract` 切换出牌目标；默认 `contract` 优先成约/击宕；
- `--no-auction-constraints` / `--no-lead-inference` 仅用于消融对比，默认均开启。

固定种子 `2026` 的参考结果（本机、当前规则）：

| 对照 | 副数 | 结果 |
|------|------|------|
| DDS（叫牌反推 + 首攻推断）vs 原启发式 | 100 | DDS 侧 **+6.08 IMP/副**（每步 4 样本） |
| 同上但关闭两种推断 | 100 | DDS 侧 **+5.49 IMP/副** |
| DDS 抽样 vs 原启发式（早期基线） | 40 | DDS 侧 +3.00 IMP/副 |

> 基准是“同一引擎左右互搏/对抗”的相对指标，不等同于对 WBridge5 等外部引擎的绝对强度。

### 纯叫牌评估（DDS / Par）

完整牌局基准会把打牌失误混入结果。`bidding-eval` 只跑叫牌，然后用 DDS 双明手结果替 AI 打牌，
把定约得分与 Par 比较，适合观察规则改动的漏局、漏贯、超叫与定约错位：

```bash
npm run bidding-eval -- --deals 100 --seed 2026 --limit 20
```

- `平均 IMP/副（NS 视角）`：南北得分相对 Par 的 IMP 差；东西叫牌变好时该值可能下降，不能单独当作“叫牌质量”。
- `绝对偏差 IMP/副`：每副 `|IMP|` 的平均值，衡量与 Par 的整体距离，越小越好。
- `漏局 / 漏贯 / 超叫 / 流局`：分别统计 Par 可成局但未叫到、Par 可满贯但未叫到、成局/满贯宕且 Par 无局、以及四家全 Pass。

固定种子 `2026`、100 副、当前精确制规则的参考结果：

| 指标 | 结果 |
|------|------|
| 平均 IMP/副（NS 视角） | +1.49 |
| 绝对偏差 IMP/副 | 2.53 |
| 漏局 / 漏贯 / 超叫 / 流局 | 9 / 3 / 2 / 0 |

100 副只适合快速回归；扩大到 1000 副（seed=2026）时为 +0.42 IMP/副、绝对偏差 **5.17 IMP/副**，
漏局 287、漏贯 97、超叫 46、流局 3，说明小样本结果偏乐观，系统性缺口应优先看大样本的绝对偏差与漏局/漏贯。

## 规则浏览与修改

页面顶部 **“规则管理”** 打开规则窗口，可浏览并修改三类细则：

- **叫牌规则**（`rules/bidding/*.yml`）：`id / description / sequence / when / action / priority`；
- **打牌规则（首攻）**（`rules/play/leads*.yml`）：`id / description / contract_type / role / when / lead / priority`；
- **打牌细则（跟牌/垫牌）**（`rules/play/signals*.yml`）：`id / description / phase / when / action / priority`，
  以及 `settings` 中由 AI 直接读取的张数信号上限、鼓励垫牌最小牌面。

> 跟牌张数信号、无将/有将垫牌、避免堵塞等细则见 `rules/play/signals.yml`；其中 `settings`
> 阈值会实际改变 `ai/playAI.ts` 的行为，规则列表用于查阅和后续扩展。

“浏览细则”以表格按优先级展示规则；“编辑源码”可直接修改 YAML，保存前做语法与必备字段校验，
校验通过后写入浏览器本地覆盖层（`localStorage`，并以内存为权威副本），立即应用到 AI，
刷新后仍生效；“恢复默认”可清除本地覆盖。覆盖逻辑位于 `engine/loader.ts`，与内置 YAML 解耦。

**权限**：当前阶段所有用户均可编辑；`src/permissions.ts` 的 `RULES_ADMIN_ONLY` 置为 `true`
即可切换为“仅系统管理员可修改，普通用户只读”。详见 `docs/帮助文档.md`。

## 叫牌含义与推荐

- **叫牌含义浮层**：叫牌阶段只有一个浅青薄纱文字浮层（约 40% 透明），位于中央叫牌记录右侧并轻微压住记录区右边；
  悬停中央叫牌表的已完成叫品时显示该叫品含义，移开即隐去。浮层无边框、无题头。
- **推荐叫品**：轮到人类叫牌时，规则引擎最高优先级候选会自动选中，推荐格子用绿色高亮；
  鼠标悬停任意合法叫品时，浮层显示该叫品含义，并附带推荐叫品及其含义；叫牌卡内不再保留独立推荐说明区，
  也不再需要“恢复推荐”按钮，直接点击绿色推荐格即可回到推荐叫品。
- **推荐出牌**：轮到人类出牌且有多张合法牌时，原来的闪烁回合箭头会移动到推荐牌上，悬停箭头显示推荐理由。
  推荐牌本身不自动弹起，用户仍可自由选牌；左键选中/取消，右键直接出牌。
  非人类回合、关闭提示或没有推荐时，箭头回到手牌固定位置，只指示该座位出牌；
  人类坐庄操作明手时，箭头也会指向明手的推荐牌。
- **出牌展示**：每轮四家出牌完成后，中央桌面保留该墩 4 张牌约 1 秒，再切换到下一墩。
- **设置开关**：顶部“风格 / 规则设置”中可关闭“显示提示与推荐”，关闭后不再自动选中推荐叫品、
  不显示含义浮层与推荐出牌；设置保存在本机浏览器。

## 验收用例对照

| # | 用例 | 覆盖位置 |
|---|------|----------|
| 1 | 发牌与排序 | `core/deck`、`models/hand`、`store/game.test` |
| 2 | 叫牌面板禁用 | `BiddingBox.vue`（`isCallLegal`） |
| 3 | 人类诈叫 | `store.humanBid`、`store/game.test` |
| 4 | AI 合规叫牌 | `engine/matcher`（动作合法性过滤）、`ai/bidAI.test` |
| 5 | 四家 Pass 流局 | `store.checkBiddingEnd`、`store/game.test` |
| 6 | 叫牌正常结束 | `store.checkBiddingEnd`/`setContractAndStartPlay` |
| 7 | 加倍/再加倍法律 | `core/bidding/validator(.test)` |
| 8 | 序列干扰识别 | `engine/matcher(.test)`（相对座位 token） |
| 9 | 兜底与开叫匹配 | `rules/bidding/precision.yml`、`ai/bidAI.test` |
| 10 | 风格生效 | `engine/types.STYLE_PARAMS`、`conditions` 变量替换 |
| 11 | 随机性可复现 | `engine/arbiter`、`ai/bidAI.test` |
| 12 | 首攻规则 + AI 叫牌延迟 | `ai/playAI`、`store.AI_DELAY_MS` |
| 13 | 明手摊牌时机 | `store.applyPlay`、`store/game.test` |
| 14/15 | 南做庄 / 南明手 | `models/gameState.controllableSeats`、`store/game.test` |
| 16 | 跟牌合法性 | `core/playing(.test)` |
| 17 | 赢墩判定 | `core/trick(.test)` |
| 18 | 计分正确 | `core/scoring(.test)` |
| 19 | 规则文件可替换 | `engine/loader`、`store.setBiddingRuleFile` |
| 20 | 新一局重置 | `store.startNewGame`、`store/game.test` |

## 后续扩展预留（不在 MVP 范围）

嵌套布尔条件（all/any/none）、候选打分模型、规则冲突检测与版本管理、知识库/自进化、
声称/摊牌、网络对战与视角隔离、移动端（Flutter）。
`engine/types.ts` 与 `SignalRule` 等接口已为这些方向预留扩展位。
