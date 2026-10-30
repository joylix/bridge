# BRULES v0.5 Phase 3：运行时切换到 IR/编译管线

- 状态：**Phase 3 完成**（2026-10-27）；ADR-0003 D15 `tags` 判定补齐（2026-10-28）
- 范围：叫牌运行时、规则加载器、裁决排序、规则切换快照、固定种子回归
- 原则：不修改 `src/core/*`、现有 YAML 规则文件、`src/engine/types.ts` 冻结契约；legacy YAML 仍可直接使用，但必须先经过 v0.5 迁移器与编译器。

## 1. 目标与边界

Phase 3 回答一个工程问题：**现有叫牌运行时能否从“直接消费 legacy YAML”切换到“统一消费 v0.5 IR 编译结果”，同时保持裁决顺序与可复现性。**

已完成的切换：

| 层 | Phase 2 之前 | Phase 3 之后 |
| --- | --- | --- |
| 规则加载 | `js-yaml` → `BiddingRule[]`，按 priority 排序 | legacy YAML → IR → `CompiledRule[]`；v0.5 DSL / IR 直通 |
| 具体度 | 从扁平 `when` 重新计数 | 读取编译器的源条件项数量 `specificity` |
| 声明顺序 | 依赖 `Array.sort` 稳定性 | 显式使用 IR 顺序 `sourceIndex` |
| 规则身份 | 无 | 每个规则集带 `rulesetId`、体系与诊断 |
| 局中修改 | 立即影响当前副 | 开局冻结快照，修改只影响后续牌局 |

Phase 3 **不**做：

- v0.4 行式 DSL 解析器（仍返回 `UNSUPPORTED_VERSION`）；
- `SEMIBAL` / `UNBAL` 的运行时求值（编译器继续给出 `UNSUPPORTED_CONDITION`，不进入可执行集）；
- IR 级覆盖层合并、PBN/TableBoard 的 `engine.ruleset` 持久化；
- 修正 53 条既有冲突规则，或改变 22 个 `legacy-direct` 条件键的求值路径。

## 2. 交付物

| 文件 | 变更 |
| --- | --- |
| `src/brules/runtime.ts` | 新增：识别 legacy YAML / v0.5 DSL / IR JSON / IR YAML，统一编译为 `BiddingRuleSet` |
| `src/brules/runtime.test.ts` | 新增 10 个运行时测试：格式识别、全量编译、元数据裁决、5M5332 评审 |
| `src/brules/index.ts` | 导出运行时适配 API |
| `src/engine/loader.ts` | `loadBiddingRuleSet()`；`loadBiddingRules()` 改为编译管线兼容视图；保存校验复用同一管道 |
| `src/engine/matcher.ts` | 读取 `specificity` / `sourceIndex`，显式三段排序；强自然新花按规则 `tags` 判定 |
| `src/store/game.ts` | 保存 `rulesetId` / 体系 / 诊断；开局冻结当前副规则快照 |
| `src/components/BiddingBox.vue` | 推荐与含义使用当前副快照 |
| `src/components/BidHistory.vue` | 叫牌含义使用当前副快照 |
| `src/store/game.test.ts` | 新增“局中切换只影响后续牌局”用例 |
| 本文件 | 切换说明、固定种子差异评审与验收结果 |

## 3. 运行时管道与 API

```text
legacy YAML ──migrateLegacyYaml──┐
v0.5 DSL ─────parseDsl───────────┼──IR──compileRules──> CompiledRule[]
v0.5 IR JSON/YAML ──parseIr──────┘
```

### 3.1 `compileBiddingRules`

```ts
import { compileBiddingRules } from '../src/brules';

const set = compileBiddingRules(text, { file: 'src/rules/bidding/precision.yml' });
set.format;      // legacy-yaml | v0.5-dsl | v0.5-ir-json | v0.5-ir-yaml | unsupported
set.system;      // precision
set.rules;       // 声明顺序；带 specificity / sourceIndex / sourceId
set.rulesetId;   // sha256:...
set.diagnostics; // 稳定排序
set.ir;          // 迁移/解析后的 IR
```

输入含 error 时返回空规则与 `rulesetId: null`，由调用方决定抛错或降级展示；loader 对内置规则文件选择抛错。

### 3.2 格式识别

| 输入特征 | 识别结果 |
| --- | --- |
| 以 `{` / `[` 开头且为合法 IR JSON | `v0.5-ir-json` |
| `VERSION: BRULES/0.5` | `v0.5-dsl` |
| YAML 含 `format: bridge-rules-ir` 与 `formatVersion: 0.5` | `v0.5-ir-yaml` |
| 其余含 `rules` 数组的 YAML | `legacy-yaml` |
| `VERSION: BRULES/0.4` 或无法识别 | `unsupported` |

### 3.3 Loader 兼容层

```ts
loadBiddingRuleSet('precision'); // 完整 BiddingRuleSet（IR 声明顺序）
loadBiddingRules('precision');   // 兼容视图：按 priority 降序，仍带编译元数据
```

`loadBiddingRules()` 的返回元素是 `CompiledRule`，结构上满足原 `BiddingRule`，因此 benchmark、CLI、既有测试无需改写。`parseBiddingRules()` 仍只解析 legacy YAML，供规则浏览与源码编辑使用。

`validateBiddingRuleText()` 改用同一编译管道：能保存等价于能进入裁决。warning（例如 53 条 `AMBIGUOUS_RULES`）不阻止保存，error 阻止。

## 4. 裁决顺序与编译元数据

固定顺序：

1. 序列匹配；
2. 条件求值（含风格变量替换）；
3. 动作合法性过滤；
4. `priority` 降序；
5. `specificity` 降序；
6. 声明顺序升序（IR `sourceIndex`）；
7. 无候选兜底 `PASS`。

### 4.1 `specificity` 是源条件项数量

`BAL_NO_5M` 编译为 `balanced:true + fiveCardMajor:false`，`balanced:false` 拆成 `#1` / `#2`。这些是编译器派生条件，**不得**增加具体度。matcher 现在优先读取 `rule.specificity`：

```ts
specificity = compiled.specificity ?? conditionSpecificity(rule.when)
```

因此 215 条 `balanced:true` 规则在编译后仍按源条件数参与裁决，不会因为多出 `fiveCardMajor` 而“变具体”。

### 4.2 声明顺序显式化

```ts
sort(
  priority desc
  || specificity desc
  || sourceIndex asc
)
```

- 编译结果按 IR 声明顺序排列，`sourceIndex` 即该顺序；
- 手写规则或 legacy `BiddingRule` 没有元数据时，回退到输入数组下标与扁平条件计数；
- 把编译结果数组反转后再裁决，结果仍按 IR 声明顺序，测试已覆盖。

## 5. `balanced` 语义差异评审

### 5.1 差异来源

Phase 2 已记录：现有 `isBalanced` 等价于 `BAL_ANY`（含 5 张高花的 5332），而 v0.4 `BAL` / v0.5 `BAL_NO_5M` 排除 5M5332。Phase 3 切换后出现两处预期修正：

| 源条件 | 旧运行时 | v0.5 编译结果 |
| --- | --- | --- |
| `balanced: true` | 5M5332 匹配（`BAL_ANY`） | 5M5332 不匹配（`BAL_NO_5M`） |
| `balanced: false` | 5M5332 不匹配 | `#2 balanced:true + fiveCardMajor:true` 匹配 |

这两点都符合 Phase 0 D-03 与 `conditions.md` 中的 v0.4 `BAL` 定义，不是迁移器 bug。

### 5.2 固定种子方法

- `seed = 2026`，四家 `randomness = 0`，`styles.bid = 1`、`styles.play = 1`；
- 同一套 `leads.yml`；
- 旧规则：`parseBiddingRules(precision.yml)`；
- 新规则：`loadBiddingRules('precision')`（编译结果）；
- 逐副比较完整 `biddingHistory`、`contract`、`score`。

### 5.3 结果

| 副数 | 旧 IMP | 新 IMP | 叫牌不同 | 定约不同 | 得分不同 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 20 | -17 | -16 | 1 | 1 | 1 |
| 100 | -5 | +2 | 2 | 2 | 2 |
| 1000 | -106 | -29 | 41 | 40 | 39 |

100 副中的两处差异（结果为 0-based 索引；CLI 分别显示为第 15、93 副）：

**索引 14 / CLI #15**（`seed = 842700515`，dealer S，局况 EW）

- W：5S-3H-3D-2C，13 HCP。
- 旧：`S pass, W 1S, N pass, E 2C, S pass, W 2NT` → W 2NT，EW +210。
- 新：同一进程下 W 不再以 `balanced:true` 的 2NT 再叫，最终 E 打 2C，EW +130。
- 差异规则：W 的均型 2NT 再叫从 `BAL_ANY` 改为 `BAL_NO_5M`，5 张黑桃的 5332 被排除。

**索引 92 / CLI #93**（`seed = 883123462`，dealer N，局况 none）

- S：5H-3S-3D-2C，13 HCP。
- 旧：`N 1C, E pass, S 1H, W pass, N 2C, E pass, S 2NT, W pass, N 3C, E pass, S 3NT` → S 3NT，NS +50。
- 新：同一进程下 S 不再以 `balanced:true` 的 2NT 应叫，最终 N 打 2C，NS +130。
- 差异规则：S 的均型 2NT 应叫从 `BAL_ANY` 改为 `BAL_NO_5M`，5 张红桃的 5332 被排除。

### 5.4 41 处差异是否全部来自 `balanced`

是。做了两步可逆验证：

1. **只还原 `BAL_NO_5M`**：把所有编译产物中的 `balanced:true + fiveCardMajor:false` 改为 `balanced:true`，保留 `balanced:false` 拆分的 `#2`。1000 副中仍有 2 处不同，IMP 为 -104。
2. **再还原 `balanced:false` 拆分**：删除 4 条源规则的 `#2`（共 4 条 IR 规则），得到 1074 条规则，与旧规则数一致。1000 副叫牌、定约、得分**全部一致**，IMP 均为 -106。

结论：

- 41 处差异中，39 处来自 `BAL_NO_5M` 对 5M5332 的排除，2 处来自 `balanced:false` 拆分对 5M5332 的纳入；
- 除这两处已评审的 `balanced` 语义外，编译管线没有引入任何额外行为漂移；
- 100 副的 2 处差异全部属于第一类，因此 Phase 2 交接中的 5M5332 风险已被完整覆盖。

100 副的 IMP 从 -5 变为 +2，是 2 副定约变化后的结果，不作为强度提升结论。若要求“逐副完全不变”，只能否定 Phase 0 D-03 的 `BAL_NO_5M` 映射，这与 v0.4 `BAL` 文档语义冲突，本阶段不采用。

## 6. 53 条既有冲突规则

迁移报告中的 53 条 `AMBIGUOUS_RULES` 保持原样：

- 不修改 `precision.yml`；
- 不改变声明顺序；
- 编译结果带 `sourceIndex`，裁决顺序与旧运行时一致；
- 诊断仍以 warning 暴露，不阻止加载；
- 是否修正规则本身属于规则内容治理，不在 Phase 3 范围。

## 7. 22 个 `legacy-direct` 条件键

这些条件键没有在编译器中做语义转换：

- IR 保留原键；
- 编译器只做 `shapeClass` 降解、PASS 词形与序列词形转换；
- 运行时仍由同一个 `checkConditions` 求值；
- 因此 `partnerOpened`、`stoppers`、`cueBid*`、`combinedHcp` 等路径与 legacy 完全一致。

`nat_` 前缀已由 Phase 2 转为 `tags`。按 ADR-0003 D15，matcher 的 `partnerForcingNewSuit` / `myForcingNewSuit` 现在读取**当前副规则集**中的 `tags`：只有同时含 `natural` 与 `forcing` 才成立，不再依赖 id 前缀。对于没有 `tags` 字段的 legacy 手写规则，保留 `nat_` 前缀回退，避免破坏旧规则；`ANY`/`ALL` 展开产生的 `#n` 后缀只用于规则 id，不参与标签判断。

编译结果把 IR `tags` 放在 `CompiledRule` 元数据中，`toBiddingRules()` 仍会剥离该字段，因此 `BiddingRule` 冻结契约不变。迁移后的 35 条 `nat_` 规则同时带有 `natural` 与 `forcing` 标签，运行时行为与 Phase 2 迁移结果一致。

## 8. 复现快照

`store.biddingRules` 现在包含：

```ts
{
  rules,         // 当前文件编译结果（IR 顺序）
  rulesetId,     // precision: sha256:4aae938c...
  system,        // precision / natural
  systemVersion,
  diagnostics,
  format,
  source,
}
```

开局时 `beginAuction()` 冻结当前副快照：

- `activeBiddingRules`：AI 裁决、人类推荐、叫牌含义使用；
- `activeRulesetId`：当前副的规则集身份；
- 局中 `setBiddingRuleFile`、保存/恢复覆盖只更新“后续牌局”的规则集；
- 下一副 `beginAuction()` 才重新冻结。

因此同一副内不会出现“前半段用旧规则、后半段用新规则”的不可复现状态。PBN/TableBoard 的 `engine.ruleset` 持久化仍未实现，属于后续阶段。

## 9. 验收结果

| 验收项 | 结果 |
| --- | --- |
| precision 全量编译 | 1074 源规则 → 1078 可执行 IR 规则 |
| natural 全量编译 | 23 源规则 → 23 可执行规则 |
| `rulesetId` | precision `sha256:4aae938c5141298c8fea714d03092cbed504f7a97cb7351a709f4d814365a55a`；natural `sha256:5cb5c98d...` |
| 固定种子 100 副（seed 2026） | 2 处差异，均为已评审的 `BAL_NO_5M` |
| 固定种子 1000 副（seed 2026） | 41 处差异；还原两处 `balanced` 修正后 0 处 |
| `randomness = 0` 可复现 | 通过；快照与 `sourceIndex` 保证同副稳定 |
| 具体度 | 读取源 `specificity`，不因 `BAL_NO_5M` 增加 |
| 声明顺序 | `sourceIndex` 显式裁决；反转输入数组测试通过 |
| `npm run typecheck` | 通过 |
| `npm run check:phase0` | 通过：17 项 |
| `npx vitest run src/brules` | 通过：8 个文件 / 120 个用例 |
| 全量测试 | 通过：45 个文件 / 573 个用例 |
| `npm run benchmark -- --deals 100 --seed 2026` | NS 12130 : 12030 EW，IMP +2，100 个定约，0 流局 |
| `npm run bidding-eval -- --deals 100 --seed 2026` | 平均 +1.40 IMP/副；绝对偏差 2.60 IMP/副；漏局 10、漏贯 3、超叫 3、流局 0 |

新增测试覆盖：

- 运行时格式识别（legacy / DSL / IR JSON / IR YAML / v0.4 拒绝）；
- precision 1078 条与 natural 23 条全量编译；
- `specificity` 不受 `BAL_NO_5M` 派生条件影响；
- 同优先级同具体度按 `sourceIndex` 裁决，且与输入数组顺序无关；
- 强自然新花 `tags` 优先、无 tags 的 legacy 规则回退 `nat_` 前缀、候选裁决读取当前规则集；
- 5M5332 在 `balanced:true` / `balanced:false` 下的新旧行为对照；
- 开局冻结规则快照，局中切换只影响后续牌局。

## 10. 限制与后续

1. **v0.4 行式 DSL 仍不支持**：运行时只识别 `BRULES/0.5` DSL、v0.5 IR 与 legacy YAML。
2. **`SEMIBAL` / `UNBAL` 仍不进入可执行集**：当前 precision/natural 未使用；若后续启用，需要先扩展扁平 AND 运行时。
3. **覆盖层仍是文本覆盖**：保存的是整个规则文件文本，重新迁移/编译后计算 `rulesetId`；尚未实现 IR 级 overlay 合并。
4. **规则编辑器仍展示 legacy 源码**：`RuleEditor.vue` 继续用 `parseBiddingRules` 浏览 1074 条源规则，不展示 1078 条编译产物。
5. **快照未进入导出**：`activeRulesetId` 已在 store 内可用，但 PBN/TableBoard 尚未写入 `engine.ruleset`。
6. **41/1000 行为变化已接受**：来源仅为 `balanced` 两处语义修正；若未来要减少变化，应调整规则内容或重新裁决 `BAL_NO_5M` 映射，而不是在运行时偷偷回退。
7. **未提交**：Phase 3 变更仍在工作区，等待确认后提交。
