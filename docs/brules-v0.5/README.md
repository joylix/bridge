# BRULES v0.5 / 桥牌数据交换 Phase 0–4B

本目录是《桥牌规则与数据交换规范（提案 v2）》的 Phase 0 规范输出、Phase 1 参考实现、Phase 2 迁移结果、Phase 3 运行时切换记录、Phase 4A 数据交换实现与 Phase 4B 记录/计分/事件基础。Phase 0 把提案中“可以执行的原则”落成可开工的文法、Schema、条件词表、迁移规则和验收边界；Phase 1 在 `src/brules/` 实现独立的 DSL 解析器、IR 校验器、编译器与 `rulesetId`；Phase 2 把现有 legacy 叫牌规则全量迁移到 v0.5 IR 并逐项报告去向；Phase 3 把叫牌运行时切换到 IR/编译管线，并完成 5M5332 差异评审；Phase 4A 在 `src/exchange/` 落地 Profile S 的 `TableBoard` 记录、引擎快照与 JSON/PBN/CSV 交换；Phase 4B 冻结 Schema 1.1、WBF 2017 计分、无界面牌桌 reducer 与事件日志。

> **状态**：Phase 0 文档完成；Phase 1 解析器/编译器完成；Phase 2 全量迁移完成；Phase 3 运行时切换完成（precision 1074 源规则 → 1078 可执行规则），并按 ADR-0003 D15 将强自然新花判定切换到 `tags`；Phase 4A 记录与导出/导入完成（JSON / PBN / CSV 导出，JSON / PBN 导入）；Phase 4B 记录 Schema 1.1、WBF 2017 计分、队式结算、牌桌 reducer 与事件流完成。
> **权限**：D1–D10 已批准；Phase 3 只切换叫牌运行时，不改变 `src/core/*`、现有 YAML 与 `src/engine/types.ts` 冻结契约；Phase 4A 只新增 `src/exchange/` 与 store/UI 适配；Phase 4B 新增 `src/domain/` 与随包 IMP 表，记录升为 1.1。
> **冲突处理**：原提案与本目录冲突时，以本目录为准；原提案保留作背景材料。

## 1. 范围

Phase 0 覆盖：

- BRULES v0.5 行式 DSL 文法；
- 规则 IR 的 JSON Schema；
- Profile S 的 `TableBoard` 记录 JSON Schema；
- 现有 46 个条件键的完整定义与测试向量；
- v0.4 → v0.5 迁移规则（LHO/RHO、allpass、ALL、BAL、`x`/`*`、`P`、`nat_`）；
- PBN 导出/导入的 Dealer、缺门、Score、编码规则；
- 复现快照、随机流和 `rulesetId` 口径；
- 向 SRS 提出并已并入 SRS V0.7 的 `Deal / TableBoard / SessionBoard` 实体模型。

Phase 0 **不**覆盖：

- 解析器、AST、编译器、诊断器的代码实现；
- JSON 事件流实现；
- 账号、服务端、持久化、Profile P；
- 运行时切换、1074 条规则的全量编译；
- MP/VP、体系默认值、转播延迟等业务裁决。

Phase 1 覆盖：

- `src/brules/` 的 v0.5 DSL 解析器、IR 校验器、IR → `BiddingRule` 编译器；
- ANY/ALL 展开、`specificity`、`shapeClass` 降解；
- JCS + SHA-256 的 `rulesetId`；
- IR JSON / IR YAML 载入；
- `scripts/brules.ts` 检查 CLI；
- 83 个新测试与最小示例端到端验收。

Phase 1 **不**覆盖：

- 运行时切换与 1074 条规则迁移；
- 覆盖层合并、JSON 事件流、Profile S/P 持久化；
- v0.4 无文件头 YAML 的自动迁移（Phase 2）。

Phase 2 覆盖：

- legacy YAML（`precision.yml` 1074 条、`natural.yml` 23 条）→ v0.5 IR；
- `balanced` 语义映射、`balanced:false` 无损拆分；
- `nat_` → `tags: ["natural", "forcing"]`；
- `Pass` / `PASS` / `-`、座位 token、`allpass`、花色集合规范化；
- 逐规则迁移报告、条件覆盖率、`rulesetId` 与可重复产物；
- 20 条代表规则的固定牌例比对。

Phase 2 **不**覆盖：

- 运行时切换；
- v0.4 行式 DSL 解析器；
- 22 个 `legacy-direct` 条件键的最终标准化；
- 覆盖层合并、JSON 事件流、Profile S/P 持久化。

Phase 3 覆盖：

- legacy YAML / v0.5 DSL / IR JSON / IR YAML 的统一运行时适配；
- 编译 `specificity` 与 `sourceIndex` 进入裁决排序；
- 叫牌规则加载器、matcher、store、推荐/含义 UI 切换到编译结果；
- 开局规则快照与 `rulesetId` / 体系 / 诊断元数据；
- 5M5332 `balanced` 差异的固定种子评审（20 / 100 / 1000 副）。

Phase 3 **不**覆盖：

- v0.4 行式 DSL 解析器；
- `SEMIBAL` / `UNBAL` 的运行时求值；
- IR 级覆盖层合并；
- PBN / TableBoard 的 `engine.ruleset` 持久化；
- 修正 53 条既有冲突规则或标准化 22 个 `legacy-direct` 条件键。

Phase 4A 覆盖：

- Profile S `TableBoard` 记录构建与 JSON 稳定序列化；
- `beginAuction` 冻结 `engine` 快照（规则集、座位、推断开关、DDS 配置）；
- 四条独立随机流 `deal / bidding / play / dds` 与固定种子派生；
- 完整 PBN 2.1 子集导出/导入（Deal、Auction、Contract、Result、Play、Score）；
- UTF-8 BOM 的计分 CSV 导出；
- 导入时的验证、警告与损失报告；
- `PbnDialog` 的格式选择、导入分发与诊断展示。

Phase 4A **不**覆盖：

- Profile P、`SessionBoard` 聚合、账号与服务端留存；
- JSON 事件流与逐事件回放；
- DDS 搜索逐字节复现；
- CSV 导入；
- MP/VP 赛制。

Phase 4B 覆盖：

- 记录 Schema 1.1：7 个桌副状态、可空原始分、`adjustment/adjustHistory`、WBF 版本标记；
- 1.0 兼容导入与新记录统一 1.1 导出；
- 随包 `wbf-2017.json`、IMP 纯函数与表结构校验；
- 队式赛跨桌结算与取消/重开前置检查；
- 无界面牌桌 reducer（叫牌/出牌/结算）；
- 事件信封、JSONL、`seq` 连续性校验与 store 事件流导出。

Phase 4B **不**覆盖：

- 服务端、数据库、账号、权限与字段级投影；
- `SessionBoard` 持久化、跨桌并发与转播延迟；
- 归档副事件流；
- MP/VP 赛制；
- DDS 搜索逐字节复现。

## 2. 文件索引

| 文件 | 内容 |
| --- | --- |
| `grammar.ebnf` | v0.5 行式 DSL 的规范 EBNF |
| `rules-ir.schema.json` | 规则 IR 的 JSON Schema（Draft 2020-12） |
| `record.schema.json` | Profile S `TableBoard` 记录 Schema |
| `conditions.md` | 46 个条件键 + `shapeClass` 的完整词表、边界、未知值和测试向量 |
| `migration.md` | v0.4 → v0.5 迁移规则与诊断码 |
| `pbn.md` | PBN 规范导出、容错导入、Dealer/Score/缺门 |
| `reproducibility.md` | 开局快照、随机流、`rulesetId`、回放边界 |
| `srs-board-model.md` | `Deal / TableBoard / SessionBoard` 实体模型设计依据；已并入 SRS V0.7 |
| `phase1.md` | Phase 1 解析器/编译器实现说明、公共 API、已知限制 |
| `phase2.md` | Phase 2 全量迁移决策、1074 条统计、覆盖率、代表规则比对与验收 |
| `phase3.md` | Phase 3 运行时切换、`specificity` / `sourceIndex` 裁决、5M5332 差异评审与验收 |
| `phase4.md` | Phase 4A Profile S 记录、引擎快照、随机流与 JSON/PBN/CSV 交换 |
| `phase4b.md` | Phase 4B Schema 1.1、WBF 2017 计分、队式结算、牌桌 reducer 与事件流 |
| `migrated/precision.rules.json` | precision 迁移后的完整 IR（1078 条） |
| `migrated/precision.migration.json` | precision 迁移报告（1402 项） |
| `migrated/natural.rules.json` | natural 迁移后的完整 IR（23 条） |
| `migrated/natural.migration.json` | natural 迁移报告（25 项） |
| `examples/minimal.brules` | 最小 v0.5 DSL 示例 |
| `examples/minimal.rules.json` | 最小 IR 示例 |
| `examples/passed-out.record.json` | Profile S 流局记录示例（Schema 1.1） |
| `../adr/0002-brules-v05-phase0.md` | Phase 0 决策记录（ADR） |
| `../adr/0005-wbf-rules-scoring.md` | WBF 规则版本、计分口径与 IMP 表（ADR） |
| `../adr/0008-record-schema-1.1.md` | 记录 Schema 1.1 与取消/调整语义（ADR） |

## 3. 规范用语

- **必须**：实现或数据不满足即为错误。
- **不得**：明确禁止。
- **应**：推荐；偏离必须在实现说明中记录理由。
- **可**：可选。

机器令牌一律英文 ASCII；`description`、昵称、`DESC` 等自由文本允许 UTF-8。

## 4. 核心口径

### 4.1 表面语法与 IR

- 规范表面语法：v0.5 行式 DSL（`grammar.ebnf`）。
- 第二表面语法：YAML。YAML 只允许表达 IR 已有的字段，不得增加新语义。
- 语义权威：IR。YAML、DSL、编译器输出都必须能映射到 `rules-ir.schema.json`。
- 现有无文件头 YAML 由 `legacy-yaml` 读取；迁移不是 Phase 0 的强制项。

### 4.2 裁决与具体度

裁决顺序固定为：

1. 序列匹配；
2. 条件求值（含风格变量替换）；
3. 动作合法性过滤；
4. `priority` 降序；
5. `specificity` 降序；
6. 声明顺序（稳定排序）；
7. 无候选兜底 `PASS`。

`specificity` 是**源条件项数量**，在 `ALL`、`BAL_NO_5M` 等编译展开前计算。编译器不得因为展开成更多扁平条件而增加具体度。

### 4.3 规则集身份

```
rulesetId = "sha256:" + SHA-256(JCS(semanticProjection(IR)))
```

- `JCS`：RFC 8785 JSON Canonicalization Scheme。
- 语义投影包含：`format`、`formatVersion`、`kind`、`system`、`systemVersion`、`defaults`、`styleParams`、规则的 `id/sequence/when/action/priority/tags/enabled` 及规则顺序。
- 语义投影不包含：`description`、`examples`、`source`、`author`、`locale`、`ext` 的非语义元数据。
- `overlay` 只作信息字段；`rulesetId` 必须是内置文件与覆盖层合并后的生效规则集。
- 详细复现规则见 `reproducibility.md`。

### 4.4 Profile S 范围

Profile S 只要求：

- `Deal` + 一个 `TableBoard`；
- 叫牌、出牌、结算；
- PBN / TableBoard JSON / CSV 导出；
- `engine` 复现块；
- `engine.rulesVersion=wbf-laws-2017` 与 `derived.imp.tableVersion=wbf-2017`；
- 本机 `overlay` 标识。

Profile P 的账号、受众、时点鉴权、裁判事件、服务端留存一律不在当前范围。

## 5. Phase 0 验收清单

- [x] v0.5 EBNF 已写，版本号支持多位数字。
- [x] 规则 IR JSON Schema 已写，包含 46 个条件键 + `shapeClass`。
- [x] Profile S `TableBoard` JSON Schema 已写。
- [x] 46 个条件键均有输入、定义、边界、未知时取值和测试向量。
- [x] `BAL_ANY` / `BAL_NO_5M` / `SEMIBAL` / `UNBAL` 已定稿。
- [x] `nat_` → `tags` 迁移与 `partnerForcingNewSuit` 语义已定稿。
- [x] `P`/`Pass`/`-`、`x`/`*`、`X`/`XX` 词法规则已定稿。
- [x] PBN Dealer/前缀、缺门、Score、编码规则已定稿。
- [x] 开局快照、随机流、`rulesetId` 口径已定稿。
- [x] SRS V0.7 已采用 `Deal / TableBoard / SessionBoard` 实体模型与 7 状态桌副状态机。
- [x] 最小 DSL / IR / 流局记录示例已写。
- [x] 完整性检查脚本已写：`npm run check:phase0`。
- [x] Phase 1 独立解析器/编译器已实现：`src/brules/`。
- [x] Phase 1 最小示例端到端通过，`rulesetId` 与冻结值一致。
- [x] Phase 2 precision 1074 条规则 100% 可执行，0 unsupported / 0 manual-review。
- [x] Phase 2 natural 23 条规则 100% 可执行。
- [x] Phase 2 条件覆盖率报告逐项关闭 46 个运行时键；22 个 `legacy-direct` 键均有明确去向。
- [x] Phase 2 LHO/RHO 输入为 0 条；迁移器对 LHO/RHO 的人工确认行为已由合成用例覆盖。
- [x] Phase 2 `allpass` 三种结束情形与非法位置均已验证。
- [x] Phase 2 20 条代表规则 × 18 手牌 × 2 上下文 = 720 次条件比对一致。
- [x] Phase 2 固定 `generatedAt` 后产物逐字节可复现。
- [x] Phase 3 legacy YAML / v0.5 DSL / IR JSON / IR YAML 统一走编译管线。
- [x] Phase 3 matcher 读取编译 `specificity`，不再从扁平 `when` 重算。
- [x] Phase 3 同优先级同具体度按 IR `sourceIndex` 裁决，与输入数组顺序无关。
- [x] Phase 3 `partnerForcingNewSuit` / `myForcingNewSuit` 读取 `tags`，无 tags 的 legacy 规则回退 `nat_` 前缀。
- [x] Phase 3 开局冻结规则快照，局中切换只影响后续牌局。
- [x] Phase 3 100 副固定种子仅 2 处差异，均为已评审的 `BAL_NO_5M`。
- [x] Phase 3 1000 副差异可被两处 `balanced` 修正完全解释（还原后 0 处）。
- [x] Phase 3 全量测试 45 个文件 / 573 个用例通过。
- [x] Phase 4A 开局冻结 `engine` 快照，局中改规则不影响当前副。
- [x] Phase 4A 四个随机流与 `reproducibility.md` §3.2 示例种子一致。
- [x] Phase 4A 完整一副可 JSON 往返并恢复结算状态；非法记录被拒绝。
- [x] Phase 4A 完整 PBN 往返，`AP` 按当前叫牌状态补足 Pass，缺门写 `-`。
- [x] Phase 4A CSV 带 UTF-8 BOM，覆盖历史与当前副。
- [x] Phase 4A 全量测试 46 个文件 / 589 个用例通过。
- [x] Phase 4B `record.schema.json` 升为 1.1，覆盖 7 状态与可空原始分。
- [x] Phase 4B 取消/未完成/重开强制 `nsRaw=null`、`singleTable=null`；流局仍为 0。
- [x] Phase 4B `ADJUSTED` 校验 `adjustment/adjustHistory` 与 `afterValue === nsRaw`。
- [x] Phase 4B 1.0 记录可导入，新导出统一 1.1；取消副 0 分只给兼容警告。
- [x] Phase 4B 随包 `wbf-2017.json` 与 `bandsSha256` 自洽，附录 C-1~C-11 表驱动通过。
- [x] Phase 4B 队式赛 `teamImp = impTable(redTeamRaw)`，取消/缺桌/重开不计算。
- [x] Phase 4B 牌桌 reducer 纯函数化，叫牌/出牌/结算与非法动作测试通过。
- [x] Phase 4B 事件 JSONL 可往返，重复/乱序 `seq` 被拒绝。
- [x] Phase 4B store 当前副事件流覆盖发牌→叫牌→出牌→结算。
- [x] Phase 4B 全量测试 52 个文件 / 636 个用例通过，`check:phase0` 17 项通过。

## 6. 未决事项（不阻塞 Phase 1）

| # | 事项 | 当前处理 |
| --- | --- | --- |
| 1 | MP / VP 是否保留 | **已裁决：V1 不启用**，只保留合约分 + 队式 IMP；格式字段保留但不填充；未来双人赛/VP 赛制单独立项（SRS V0.7） |
| 2 | 体系默认值：精确制 vs 自然制 | **已裁决：体系可配置，默认精确制**；自然制为可选模板（SRS V0.7、ADR-0002 D-10） |
| 3 | 转播延迟值 | Profile P 事项，规范不冻结具体秒数 |
| 4 | UTF-8 PBN 选项 | 可选；必须带损失报告 |
| 5 | `SEMIBAL` / `UNBAL` 运行时支持 | 已定义语义；v0.5 运行时返回 `UNSUPPORTED_CONDITION` |
| 6 | 事件流存储与快照频率 | Phase 4B 已定义事件信封与 JSONL，并接入单机当前副；持久化、归档与快照频率留到服务端阶段 |
| 7 | 22 个无法表达的条件键的最终处置 | Phase 2 已逐项给出 `legacy-direct` 去向；Phase 3 确认运行时仍走同一 `checkConditions`，未做标准化或 `ext.` 私有化 |
| 8 | `BAL_NO_5M` 与当前 `isBalanced`（`BAL_ANY`）的差异 | Phase 3 已完成评审：100 副 2 处、1000 副 41 处差异均可由两处 `balanced` 修正解释；详见 `phase3.md` §5 |

## 7. 验证

```bash
npm run check:phase0   # 文档、Schema、示例、条件键完整性
npm run typecheck      # TypeScript / Vue 类型检查
npx vitest run src/brules  # Phase 1/2/3 解析器、编译器、迁移、运行时测试（8 文件 / 120 用例）
npm run brules:check -- docs/brules-v0.5/examples/minimal.brules
npm test               # 52 个测试文件 / 636 个用例
npx vitest run src/exchange  # Phase 4A/4B 记录、快照、随机流与 JSON/PBN/CSV
npx vitest run src/domain    # Phase 4B 牌桌 reducer、事件流与队式结算
npm run benchmark -- --deals 100 --seed 2026
npm run bidding-eval -- --deals 100 --seed 2026
```

Phase 2 迁移与产物复现：

```bash
npm run brules:migrate -- src/rules/bidding/precision.yml \
  --generated-at 2026-10-27T00:00:00Z \
  --ir docs/brules-v0.5/migrated/precision.rules.json \
  --report docs/brules-v0.5/migrated/precision.migration.json

npm run brules:migrate -- src/rules/bidding/natural.yml \
  --generated-at 2026-10-27T00:00:00Z \
  --ir docs/brules-v0.5/migrated/natural.rules.json \
  --report docs/brules-v0.5/migrated/natural.migration.json
```

`check:phase0` 不引入第三方依赖，只做结构完整性检查；语义验证由 Phase 1 的解析器和编译器承担，迁移覆盖由 Phase 2 的迁移器与报告承担，运行时行为由 Phase 3 的 runtime 测试、全量测试与固定种子基准承担；数据交换由 Phase 4A 的 `src/exchange` 测试承担；记录 1.1、计分、reducer 与事件流由 Phase 4B 的 `src/exchange` / `src/domain` / `src/store` 测试承担。Phase 1 新增 83 个用例，Phase 2 新增 26 个，Phase 3 新增 17 个（runtime 11 + store 1 + matcher 5），Phase 4A 新增 16 个，Phase 4B 新增 47 个（Schema 14 + IMP 6 + 队式 10 + reducer 8 + 事件 5 + store 事件 4），基线用例保持全绿。

## 8. 与现有代码的关系

Phase 0 不修改：

- `src/engine/types.ts` 的 `BiddingRule` / `ConditionSpec`；
- `src/engine/matcher.ts`、`conditions.ts`、`arbiter.ts`；
- `src/core/pbn.ts`、`src/core/auction.ts`、`src/core/scoring.ts`；
- `src/rules/**/*.yml`；
- 现有测试。

Phase 1 应新增独立模块（例如 `src/brules/`），以适配层把 IR 编译为现有 `BiddingRule`；在 1074 条规则覆盖率、447 个测试、固定种子基准全部通过前，不得切换运行时。

Phase 1 已按此实现：`src/brules/` 不修改现有运行时，`toBiddingRules()` 只做只读适配；运行时切换留到 Phase 3。

Phase 2 继续遵守该边界：只新增 `src/brules/migrate.ts`、迁移 CLI、测试与 `docs/brules-v0.5/migrated/` 产物，不修改 `src/engine/*`、`src/core/*`、现有 YAML 或 447 个基线用例。

Phase 3 已切换叫牌运行时：`src/engine/loader.ts` 统一经 `src/brules/runtime.ts` 把 legacy YAML / v0.5 DSL / IR 编译为 `CompiledRule[]`，`src/engine/matcher.ts` 直接消费编译 `specificity` 与 `sourceIndex`。`src/core/*`、`src/rules/**/*.yml` 与 `src/engine/types.ts` 的冻结契约未改动；`parseBiddingRules()` 仅保留给规则编辑器浏览源码。详见 `phase3.md`。

Phase 4A 新增 `src/exchange/`，并在 `src/store/game.ts` 的开局、归档、导入导出路径接入。`src/core/pbn.ts` 只增加缺门 `-` 的解析/导出能力，DDS 残局格式保持原样；`exportDealPbn()` / `importDealPbn()` 的纯发牌字符串行为保持兼容。详见 `phase4.md`。

Phase 4B 新增 `src/domain/`（牌桌 reducer、事件流、队式结算）与 `src/core/wbf-2017.json` / `impTable.ts`；`src/core/imps.ts` 改为复用随包表，但保留原有函数签名与单机贴点制行为；`src/exchange/*` 与 `src/store/game.ts` 接入 Schema 1.1 与事件流。`src/core/*` 的桥牌法律语义、`src/engine/types.ts` 的 `BiddingRule` 冻结契约与现有 YAML 未改动。详见 `phase4b.md`。

M5 平台契约（Fastify/PostgreSQL/WS/字段级投影）不属于 BRULES 范围，索引见 `docs/m5-platform-contracts.md`；本目录边界仍为 Phase 0–4B，不把服务端与账号体系混入交换规范。
