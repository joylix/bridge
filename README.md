# 桥牌游戏 MVP（人机对战 · 可配置规则引擎）

按 `docs/` 下的《桥牌游戏 MVP 开发文档 V1.4》与《桥牌游戏 MVP 详细设计文档 V1.4》
落地的可运行实现。V3.0 文档已明确：**本阶段的编码规范以 MVP V1.4 为准**
（规则引擎契约、人类控制模型均已冻结）。

- 用户坐 **南家**，北/东/西为机器人。
- **核心法律硬编码**（叫牌合法性、加倍/再加倍、跟牌义务、赢墩判定、标准计分）。
- **叫牌策略外部化**：YAML 规则 + 相对座位序列匹配 + 扁平 AND 条件 + 优先级/具体度裁决 + ε 探索。
- **首攻**由 YAML 规则驱动；跟牌/垫牌用硬编码启发式并实现防守信号约定（张数信号、不鼓励垫牌、有将无损失鼓励垫牌），约定文档见 `signals.yml`。
- 机器人可按座位配置 **叫牌风格 / 打牌风格（0 保守 / 1 正常 / 2 激进）** 与 **随机度 randomness**。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | TypeScript + Vue 3 + Vite + Pinia |
| UI | Element Plus（辅助布局，牌桌自定义组件） |
| 规则解析 | js-yaml（Vite `?raw` 构建期内联） |
| 测试 | Vitest（happy-dom） |

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
│   ├── trick.ts          # 赢墩判定（beatsCard / determineTrickWinner）
│   └── scoring.ts        # 标准复式计分（含局况、满贯/成局、加倍/再加倍）
├── engine/               # 规则引擎（冻结接口）
│   ├── types.ts          # BiddingRule / LeadRule / ConditionSpec / StyleParams / STYLE_PARAMS
│   ├── matcher.ts        # 相对座位序列匹配 + 候选匹配（含动作合法性过滤）
│   ├── conditions.ts     # 条件词表 + 风格变量替换 + 具体度
│   ├── loader.ts         # YAML 解析 + 规则文件注册表 + 本地覆盖（浏览/修改）
│   └── arbiter.ts        # mulberry32 随机源 + 优先级/具体度裁决 + ε 探索
├── rules/                # 策略规则（YAML，外部可替换）
│   ├── bidding/precision.yml  # 标准精确叫牌法（裁剪版，默认）
│   ├── bidding/natural.yml    # 自然叫牌法（备选，用于演示“可替换”）
│   └── play/{leads.yml, signals.yml}
├── ai/
│   ├── bidAI.ts          # 候选 → 裁决/探索 → 兜底 Pass
│   └── playAI.ts         # 首攻走 YAML；跟牌/垫牌启发式 + 信号约定；非法降级
├── models/               # card / hand / gameState（含 controllableSeats）
├── permissions.ts        # 用户角色与规则编辑权限（当前所有用户可改）
├── store/game.ts         # Pinia 状态机 + AI 调度 + 人类控制权 + 规则管理
├── components/           # Table / Hand / BiddingBox / ScoreBoard / GameHistory / RuleEditor
├── testing/              # 测试辅助
├── App.vue
└── main.ts
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
`balanced`（4-3-3-3 / 4-4-3-2 / 5-3-3-2）；区间支持 `"16-40"`、`"5+"`、`"12"`，
可引用 `${open1ntMin}`、`${overcallMinHcp}` 等风格阈值。

### 裁决与探索

候选先经 **序列匹配 + 条件 + 动作合法性** 过滤，再按
**优先级↓ → 条件具体度↓ → 声明顺序** 稳定排序。
`randomness=0` 严格取最优；`>0` 以地概率在“次优但有依据”的候选中偏离，
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

> 完整的贴点公式、示例与流局规则见 **`docs/帮助文档.md`**。

## 规则浏览与修改

页面顶部 **“规则管理”** 打开规则窗口，可浏览并修改两类细则：

- **叫牌规则**（`rules/bidding/*.yml`）：`id / description / sequence / when / action / priority`；
- **打牌规则（首攻）**（`rules/play/leads*.yml`）：`id / description / contract_type / role / when / lead / priority`。

> 首攻规则可通过 YAML 浏览/修改；跟牌张数信号（偶数先大后小）、无将/有将垫牌约定为
> `ai/playAI.ts` 中的启发式，约定说明见 `rules/play/signals.yml` 与 `docs/帮助文档.md`。

“浏览细则”以表格按优先级展示规则；“编辑源码”可直接修改 YAML，保存前做语法与必备字段校验，
校验通过后写入浏览器本地覆盖层（`localStorage`，并以内存为权威副本），立即应用到 AI，
刷新后仍生效；“恢复默认”可清除本地覆盖。覆盖逻辑位于 `engine/loader.ts`，与内置 YAML 解耦。

**权限**：当前阶段所有用户均可编辑；`src/permissions.ts` 的 `RULES_ADMIN_ONLY` 置为 `true`
即可切换为“仅系统管理员可修改，普通用户只读”。详见 `docs/帮助文档.md`。

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
| 12 | 首攻规则 + 延迟 | `ai/playAI`、`store.AI_DELAY_MS` |
| 13 | 明手摊牌时机 | `store.applyPlay`、`store/game.test` |
| 14/15 | 南做庄 / 南明手 | `models/gameState.controllableSeats`、`store/game.test` |
| 16 | 跟牌合法性 | `core/playing(.test)` |
| 17 | 赢墩判定 | `core/trick(.test)` |
| 18 | 计分正确 | `core/scoring(.test)` |
| 19 | 规则文件可替换 | `engine/loader`、`store.setBiddingRuleFile` |
| 20 | 新一局重置 | `store.startNewGame`、`store/game.test` |

## 后续扩展预留（不在 MVP 范围）

嵌套布尔条件（all/any/none）、候选打分模型、规则冲突检测与版本管理、知识库/自进化、
双明手求解器（DDS）、声称/摊牌、网络对战与视角隔离、移动端（Flutter）。
`engine/types.ts` 与 `SignalRule` 等接口已为这些方向预留扩展位。
