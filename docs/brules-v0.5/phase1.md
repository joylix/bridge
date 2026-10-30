# BRULES v0.5 Phase 1 — 独立解析器与编译器

- 状态：**完成**（2026-10-27）
- 范围：`src/brules/` 独立模块、CLI、测试与验收
- 非目标：切换现有运行时、迁移 1074 条规则、覆盖层合并、JSON 事件流

> Phase 1 只新增模块，不修改 `src/engine/*`、`src/core/*`、`src/rules/**/*.yml` 和既有测试。
> 现有叫牌运行时仍读取 v0.4 YAML；切换到 v0.5 必须等 Phase 2/3 的覆盖率与基准验收。
>
> **后续状态**：Phase 3 已完成运行时切换，matcher 已读取编译 `specificity` / `sourceIndex`；
> 本文 §4.1 与 §9 中“尚未读取/未切换”的描述仅代表 Phase 1 当时的交接状态。

## 1. 交付物

| 文件 | 职责 |
| --- | --- |
| `types.ts` | IR、编译结果、公共选项与 `CALL_TOKENS` |
| `diagnostics.ts` | 诊断码、严重度、稳定排序、格式化 |
| `conditions.ts` | 46 个运行时条件键 + `shapeClass`；取值、量词、花色集合规范化 |
| `parser.ts` | v0.5 行式 DSL → IR；任何 error 阻止产出 IR |
| `validate.ts` | IR JSON Schema 的结构/语义补充校验 |
| `compile.ts` | IR → 现有 `BiddingRule` 适配层 |
| `jcs.ts` | RFC 8785 JSON Canonicalization Scheme |
| `sha256.ts` | 纯 TypeScript 同步 SHA-256 |
| `ruleset.ts` | 语义投影与 `rulesetId` |
| `yaml.ts` | IR JSON / IR YAML 载入 |
| `index.ts` | 公共 API 与 `compileDsl` 管道 |
| `scripts/brules.ts` | DSL/JSON/YAML 检查 CLI |

测试：`src/brules/*.test.ts` 共 6 个文件、83 个用例。

## 2. 公共 API

```ts
// DSL → IR
parseDsl(text: string, options?: { file?: string }): ParseResult
// IR 校验
validateIr(value: unknown, options?: { file?: string }): ParseResult
// 第二表面语法
parseIrJson(text: string, options?): ParseResult
parseIrYaml(text: string, options?): ParseResult
// IR → 现有 BiddingRule
compileRules(ir: RulesIR, options?): CompileResult
compileDsl(text: string, options?): PipelineResult
// 语义身份
semanticProjection(ir: RulesIR): SemanticProjection
computeRulesetId(ir: RulesIR): string
// 去掉编译器附加字段
toBiddingRules(rules: CompiledRule[]): BiddingRule[]
```

`ParseResult.ir` 只在没有 error 时非空；warning/info 不阻止产出。
`CompiledRule` 在 `BiddingRule` 上附加 `specificity`、`sourceIndex`、`sourceId` 与可选的 `source`；
`toBiddingRules` 用于把结果交给现有 matcher。

## 3. DSL → IR 语义

### 3.1 文件与文件头

- 接受 UTF-8、无 BOM、LF 或 CRLF；第一条有效行必须是 `VERSION: BRULES/0.5`。
- 必需文件头：`FORMAT: bridge-rules`、`KIND: bidding`、`SYSTEM: <identifier>`。
- 可选：`SYSTEM_VERSION`、`LOCALE`、`AUTHOR`、`SOURCE`、`DEFAULT_PRIORITY`、`STYLE_PARAMS`。
- 数值版本号支持任意位数字；`SYSTEM_VERSION` 允许 `1`、`0.5`、`0.5.0`。
- `#` 到行尾为注释；双引号字符串内的 `#` 保留；支持 `\"` 与 `\\`。
- 关键字、叫品、座位、标签大小写不敏感；条件键与 id 保留原样，id 查重大小写不敏感。

### 3.2 规则与条件

- `RULE` 必须有 `SEQ` 与 `BID`；缺 `PRIO` 时取 `DEFAULT_PRIORITY`，二者皆无报错。
- `COND` 可被 `RULE` 或另一个 `COND` 用 `USE` 引用；支持嵌套，检测未知引用与循环引用。
- 同一 `RULE`/`COND` 内条件为扁平 AND；`when` 键按字典序写入 IR，保证序列化稳定。
- 同一条件键重复且值相同只保留一次；值不同报 `DUPLICATE_CONDITION`。
- `shapeClass` 原样保留在 IR；`SEMIBAL`/`UNBAL` 不在解析阶段丢弃。

### 3.3 叫品与序列

- DSL 的 Pass 只写 `-`，IR 写 `PASS`；`P` 与 `PASS` 在 DSL 中报 `PASS_ALIAS_REJECTED`。
- 小写 `x`/`xx` 不是加倍，报 `LEGACY_WILDCARD_MIGRATED`；加倍写 `X` / `XX`。
- 序列通配只接受 `^$` 与 `.*`；`^`、`*` 报 `INVALID_SEQUENCE`。
- 序列规范形式为 `Seat:CALL`，座位为 `M/P/L/R`，叫品大写，例如：

```text
M:1S P:PASS R:X L:PASS
```

- 运行时适配时仅把 `PASS` 改成 `Pass`，其余 token 不变。

### 3.4 ANY / ALL

`ANY` / `ALL` 在进入 IR 前展开：

| DSL | IR 结果 |
| --- | --- |
| `ANY(U, LEN>=5)` | 两条规则，`spades` 与 `hearts` 各一条 |
| `ALL(U, LEN>=5)` | 一条规则，同时含 `spades` 与 `hearts` |
| `ANY(L, LEN>4)` | 两条规则，`clubs` 与 `diamonds` 各 `5+` |
| `ALL(C, LEN<=3)` | 一条规则，`clubs: "0-3"` |

- `specificity` 在展开前计算。`ANY` 展开出的多条规则共享源 `specificity`，id 追加 `#1`、`#2`。
- 展开产生多条规则时输出 `EXPANDED_DISJUNCTION`（info）。
- `ALL` 的花色集合是单元素时也走同一路径。
- `ANY` / `ALL` 的 `HCP`、`CTL` 谓词语法合法，但扁平 IR 没有“按花色 HCP/CTL”条件，Phase 1 报 `UNSUPPORTED_FEATURE`，不静默丢弃。这是 Phase 2 的待决项。

### 3.5 条件取值

- 数值区间：`N`、`N-M`、`N+`，端点可为整数或 `${styleVar}`。
- 布尔：`true` / `false`。
- 单花色：`C/D/H/S`；`lastBidSuit` 额外接受 `NT`。
- 花色集合：按 `C→D→H→S` 规范化，重复字母报错。
- `shapeClass`：`BAL_ANY` / `BAL_NO_5M` / `SEMIBAL` / `UNBAL`。
- `${styleVar}` 必须在 `STYLE_PARAMS` 声明，否则 `UNRESOLVED_STYLE_VAR`。
- 区间越界只警告（`CONDITION_RANGE_OUT_OF_BOUNDS`），不阻止 IR。

## 4. IR → 现有 `BiddingRule`

| IR | 运行时 |
| --- | --- |
| `action: "PASS"` | `action: "Pass"` |
| 序列 `M:PASS` | `M:Pass` |
| `shapeClass: BAL_ANY` | `balanced: true` |
| `shapeClass: BAL_NO_5M` | `balanced: true` + `fiveCardMajor: false` |
| `shapeClass: SEMIBAL` / `UNBAL` | `UNSUPPORTED_CONDITION`（warning），不进入可执行集 |
| `enabled: false` | `RULE_DISABLED`（info），不进入可执行集 |

- `specificity` 取 IR 的显式值；缺省时取 `when` 顶层键数。`shapeClass` 降解为两个键时不增加 `specificity`。
- `shapeClass` 与显式 `balanced` / `fiveCardMajor` 矛盾时输出 `CONTRADICTORY_CONDITION`（warning），规则仍保留；这与 `conditions.md` 第 5.2 节一致。
- 同 `priority`、同 `specificity`、同序列但动作冲突时输出 `AMBIGUOUS_RULES`（warning），不自动改优先级。
- 输出顺序 = IR 声明顺序；`sourceIndex` 记录原始下标，`sourceId` 去掉 ANY/ALL 展开的 `#n` 后缀。
- `tags`、`examples`、`source`、`ext` 不进入 `BiddingRule`；`rulesetId` 仍覆盖 `tags`/`enabled`。

### 4.1 运行时切换前的已知差异

现有 `findBidCandidates` 会从扁平 `when` 重新计算 `conditionSpecificity`，因此：

- 当前编译结果的 `specificity` 字段**尚未被运行时读取**；
- Phase 3 切换运行时前，必须改为读取编译结果或在 matcher 中保留源 `specificity`；
- 在此之前，`ANY` 展开与 `BAL_NO_5M` 的排序语义不能声称与 v0.5 完全一致。

现有 `parseBiddingRules` 会按 `priority` 排序并丢失声明顺序；Phase 3 必须使用 IR 顺序和 `sourceIndex`。

## 5. `rulesetId`

```text
rulesetId = "sha256:" + SHA-256(JCS(semanticProjection(IR)))
```

语义投影严格按 `reproducibility.md` §4.2：

- 包含：`format`、`formatVersion`、`kind`、`system`、`systemVersion`、`defaults`、`styleParams`、规则的 `id/sequence/when/action/priority/tags/enabled` 及顺序；
- 不包含：`description`、`examples`、`source`、`author`、`locale`、`ext` 的非语义元数据、`specificity`；
- `tags` 缺省为 `[]`，`enabled` 缺省为 `true`。

`examples/minimal.rules.json` 与 `examples/minimal.brules` 的语义投影相同，冻结值：

```text
sha256:39e571721cec89a8d3c8c1e7d469953f369961d5aaf4ed6c557a0e76aa8b7cd7
```

JCS 与 SHA-256 均为本地纯 TypeScript 实现，不依赖 `node:crypto`，浏览器与 Node 结果一致。

## 6. 诊断码

Phase 1 新增/使用的诊断码按类别：

| 类别 | 诊断码 |
| --- | --- |
| 版本/文件头 | `UNSUPPORTED_VERSION`、`MISSING_VERSION`、`MISSING_HEADER`、`DUPLICATE_HEADER`、`INVALID_HEADER_VALUE`、`INVALID_SYSTEM_VERSION` |
| id/标签 | `INVALID_ID`、`DUPLICATE_ID`、`INVALID_TAG`、`INVALID_STYLE_PARAM`、`DUPLICATE_STYLE_PARAM` |
| 叫品/序列 | `INVALID_CALL`、`INVALID_SEQUENCE`、`PASS_ALIAS_REJECTED`、`LEGACY_WILDCARD_MIGRATED` |
| 条件 | `INVALID_CONDITION_KEY`、`INVALID_CONDITION_VALUE`、`INVALID_BOOLEAN`、`INVALID_RANGE`、`DUPLICATE_CONDITION`、`CONDITION_RANGE_OUT_OF_BOUNDS`、`CYCLIC_CONDITION`、`UNRESOLVED_REFERENCE`、`UNRESOLVED_STYLE_VAR`、`MISSING_CONDITION` |
| 量词 | `INVALID_QUANTIFIER`、`UNSUPPORTED_FEATURE`、`EXPANDED_DISJUNCTION` |
| 结构 | `MISSING_END`、`MISSING_RULE_FIELD`、`MISSING_PRIORITY`、`INVALID_PRIORITY`、`INVALID_DEFAULT_PRIORITY`、`INVALID_RULESET`、`INVALID_SOURCE`、`UNKNOWN_FIELD`、`INVALID_RULE_EXAMPLE` |
| 编译 | `UNSUPPORTED_CONDITION`、`CONTRADICTORY_CONDITION`、`AMBIGUOUS_RULES`、`RULE_DISABLED` |
| 载入 | `JSON_PARSE_ERROR`、`YAML_PARSE_ERROR` |

error 阻止产出 IR/可执行集；warning/info 保留规则并进入诊断列表。诊断按严重度、文件、行、列、码稳定排序。

## 7. CLI

```bash
npm run brules:check -- docs/brules-v0.5/examples/minimal.brules
npm run brules:check -- rules.json rules.yaml
npm run brules:check -- file.brules --json
```

输出每条规则的可执行形态、`rulesetId` 与诊断。退出码：0 = 无 error；1 = 有 error 或文件读取失败。

## 8. 验收结果

```text
npx vitest run src/brules
  Test Files  6 passed (6)
  Tests       83 passed (83)

npm run check:phase0
  17 passed, 0 warnings, 0 errors

npm run typecheck
  vue-tsc --noEmit 通过

npm test -- --run
  43 passed (43) / 530 passed (530)
```

`minimal.brules` → `minimal.rules.json` 的语义投影一致，`rulesetId` 等于冻结值；
最小示例编译后的 `open_1nt` 条件为 `{hcp, balanced: true, fiveCardMajor: false}`，
`open_1c` 为 `{hcp, balanced: true}`。

## 9. 已知限制与交接

1. **未切换运行时**：`src/store/game.ts`、`src/engine/loader.ts` 仍走 v0.4 YAML。
2. **ANY(HCP/CTL)**：语法接受，但无扁平 IR 表达；当前报 `UNSUPPORTED_FEATURE`。
3. **SEMIBAL/UNBAL**：保留在 IR，不进入可执行集；运行时支持是后续阶段事项。
4. **specificity 排序**：matcher 仍自行计数；Phase 3 必须读取编译结果。
5. **YAML 范围**：只接受 IR 形状的 YAML；v0.4 无文件头 YAML 的迁移属于 Phase 2。
6. **覆盖层**：`merge(builtin, overlay)` 尚未实现；`rulesetId` 目前只针对单个 IR。
7. **声明顺序**：编译器保留顺序，但现有 loader 仍按 priority 排序；Phase 3 切换。
8. **IR 显式 `specificity`**：校验非负且不大于 `when` 键数；由于 `ALL`/`ANY` 展开，不强制等于键数。
9. **CLI 诊断**：文件读取失败复用 `INVALID_RULESET`，未新增独立诊断码。
10. **未做全量 1074 条规则编译**：迁移与覆盖率在 Phase 2 完成。

## 10. 下一步

- Phase 2：v0.4 YAML → IR 迁移器、LHO/RHO、allpass、`nat_` 标签、1074 条覆盖率报告。
- Phase 3：切换运行时，改用编译结果 `specificity`，保留声明顺序，跑固定种子基准与 447 个基线用例。
- Phase 4：覆盖层、事件流、Profile S/P 数据交换。
