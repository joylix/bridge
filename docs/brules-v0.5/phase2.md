# BRULES v0.5 Phase 2：legacy 叫牌规则全量迁移

- 状态：**Phase 2 完成**；运行时仍未切换。
- 输入：`src/rules/bidding/precision.yml`（1074 条）、`src/rules/bidding/natural.yml`（23 条）。
- 输出：v0.5 IR、逐规则迁移报告、条件覆盖率报告、可重复构建产物。
- 原则：不修改 `src/engine/*`、`src/core/*`、现有 YAML、`src/engine/types.ts` 冻结契约，也不改变 447 个基线用例的行为。

## 1. 目标与边界

Phase 2 只回答两个问题：

1. 现有 legacy 叫牌规则能否逐条映射到 v0.5 IR；
2. 每一条规则、每一个条件键的最终去向是什么。

Phase 2 **不**做：

- 运行时切换（Phase 3）；
- v0.4 行式 DSL 的完整解析（本阶段迁移对象是仓库内无文件头的 legacy YAML；v0.4 DSL 输入明确返回 `UNSUPPORTED_FEATURE`）；
- `SEMIBAL` / `UNBAL` 的运行时求值；
- 覆盖层合并、Profile S/P 持久化。

## 2. 交付物

| 交付物 | 说明 |
| --- | --- |
| `src/brules/migrate.ts` | legacy YAML → v0.5 IR 迁移器、报告、覆盖率、`completeAuction` |
| `src/brules/migrate.test.ts` | 26 个迁移测试，含 1074 条全量、20 条代表规则固定牌例 |
| `src/brules/diagnostics.ts` | 新增 Phase 2 迁移诊断码 |
| `src/brules/index.ts` | 导出迁移 API |
| `scripts/brulesMigrate.ts` | 迁移 CLI |
| `package.json` | 新增 `brules:migrate` |
| `docs/brules-v0.5/migrated/precision.rules.json` | precision 迁移后的完整 IR（1078 条） |
| `docs/brules-v0.5/migrated/precision.migration.json` | precision 迁移报告 |
| `docs/brules-v0.5/migrated/natural.rules.json` | natural 迁移后的完整 IR（23 条） |
| `docs/brules-v0.5/migrated/natural.migration.json` | natural 迁移报告 |
| 本文件 | 迁移决策、统计、覆盖率、代表规则比对与验收证据 |

## 3. 公共 API 与 CLI

### 3.1 API

```ts
import {
  detectInputVersion,
  migrateText,
  migrateLegacyYaml,
  completeAuction,
  filterMigrationEntries,
  filterMigrationRules,
} from '../src/brules';
```

| API | 用途 |
| --- | --- |
| `detectInputVersion(text)` | 识别 `legacy-yaml` / `BRULES/0.4` / `BRULES/0.5` / 不支持版本 |
| `migrateText(text, options)` | 统一入口；legacy YAML 迁移、v0.5 DSL 直通、v0.4 DSL 拒绝 |
| `migrateLegacyYaml(text, options)` | 仅处理 legacy YAML |
| `completeAuction(calls)` | 为扁平叫品序列补足结束所需 PASS |
| `filterMigrationEntries(entries, filter)` | 按 `code` / `severity` / `ruleId` 过滤报告项 |
| `filterMigrationRules(rules, filter)` | 按 `status` / `ruleId` 过滤逐规则结果 |

`MigrationOptions` 支持 `file`、`source`、`system`、`systemVersion`、`generatedAt`、`styleParams`。固定 `generatedAt` 后，报告可逐字节复现。

### 3.2 CLI

```bash
npm run brules:migrate -- src/rules/bidding/precision.yml \
  --generated-at 2026-10-27T00:00:00Z \
  --ir docs/brules-v0.5/migrated/precision.rules.json \
  --report docs/brules-v0.5/migrated/precision.migration.json
```

常用选项：

- `--json`：输出完整报告 JSON；
- `--code` / `--severity` / `--rule`：过滤报告项；
- `--strict`：存在 `unsupported` 或 `manual-review` 时退出 1；
- `--verbose`：显示全部报告项。

## 4. 迁移决策

### 4.1 版本与体系

- 无 `VERSION` 头且含 `rules` 数组的 YAML 视为 `legacy-yaml`；
- `SYSTEM` 优先取显式参数，其次按文件名推断（`precision.yml` → `precision`，`natural.yml` → `natural`）；否则写 `legacy` 并产生 `SYSTEM_INFERRED`；
- 迁移输出统一为 `formatVersion: "0.5"`。

### 4.2 `balanced`

| 源条件 | 迁移结果 | 理由 |
| --- | --- | --- |
| `balanced: true` | `shapeClass: BAL_NO_5M` | v0.4 `BAL` 排除 5 张高花的 5332；与 v0.5 `BAL_NO_5M` 同义 |
| `balanced: false` | 拆成两条规则：`#1 balanced:false`、`#2 balanced:true + fiveCardMajor:true` | v0.4 `NOT BAL_NO_5M` 包含 5 张高花的 5332；单条 legacy `balanced:false` 无法在现有运行时表达这一并集 |

拆分后两条规则共享源 `specificity`，`sourceId` 仍为原 id，IR id 为 `<id>#1` / `<id>#2`。precision 中 4 条 `balanced:false` 规则（`strong_takeout_double_1c/1d/1h/1s`）共拆成 8 条 IR 规则。

**与当前运行时的差异**：现有 `isBalanced` 等价于 `BAL_ANY`（包含 5 张高花的 5332）。因此：

- `balanced:true` 迁移为 `BAL_NO_5M` 后，会排除 5M5332；
- `balanced:false` 拆分后，会包含 5M5332。

这两点都是按 v0.4 `BAL` 文档语义做出的**预期修正**，但会改变当前运行时行为。Phase 3 切换前必须把该差异列为显式评审项，并用固定牌例回归。Phase 2 未切换运行时，因此基线行为未改变。

### 4.3 相对座位 LHO / RHO

- legacy 文件中的座位 token 只接受 `M/P/L/R`；
- `PAR` / `PARTNER` 改写为 `P` 并报告 `LEGACY_SEAT_TOKEN`；
- 出现 `LHO` / `RHO` / `ME` 时不自动互换：规则进入 `manual-review`，产生 `LHO_RHO_UNRESOLVED`（error）与 `LHO_RHO_MANUAL_REVIEW`（warning），不导出 IR；
- 出现绝对座位 `N/E/S/W` 时返回 `UNSUPPORTED_FEATURE`，不自动转换。

实际扫描：`precision.yml` 与 `natural.yml` 中 **LHO/RHO 规则数为 0**，因此本阶段没有待人工确认的 LHO/RHO 规则；迁移器对 LHO/RHO 的“不导出 + 人工确认”行为已由合成用例覆盖。

### 4.4 Pass、叫品与座位

- `Pass` / `PASS` / `-` 统一为 IR `PASS`；
- 叫品位置的单个 `P` 不是 Pass，返回 `PASS_ALIAS_REJECTED`；
- 小写 `x` / `xx` 不是加倍，返回 `INVALID_CALL`；
- 序列 token 规范形式为 `Seat:CALL`，如 `M:1S P:PASS`。

### 4.5 `nat_` 前缀

`nat_` 不再作为 forcing new suit 的语义来源。满足条件的规则改写为：

```json
"tags": ["natural", "forcing"]
```

同时保留原 id 便于追溯。若 `nat_` 规则的动作为非花色叫品，或已有冲突标签，则产生 `LEGACY_ID_PREFIX_MISMATCH` / `TAG_CONFLICT`，进入 `manual-review`，不自动加标签。

### 4.6 allpass

`allpass` 只允许出现在序列末尾。迁移器调用 `completeAuction`：

- 已有实质叫品时，补足到 3 个连续 PASS；
- 尚无实质叫品时，补足到 4 个 PASS；
- 展开后仍不能结束则返回 `ALLPASS_INVALID`。

实际输入文件中没有 `allpass`；三种结束情形与非法位置均由合成用例验证。

### 4.7 `specificity` 与声明顺序

- `specificity` 等于**源条件项数量**，在 `BAL_NO_5M` 降解、`balanced:false` 拆分之前计算；
- 拆分出的两条规则共享同一 `specificity`；
- IR 规则顺序严格保持源声明顺序；
- 报告保留原始行号与原始 id。

### 4.8 22 个 v0.4 DSL 无法表达的条件键

`conditions.md` 中标记为 `U` 的 22 个键，只表示 **v0.4 行式 DSL 无法表达**，不表示 legacy YAML 或现有运行时不能求值。legacy YAML 的条件键本身就是 IR 键，因此这些规则不排除，统一按 `legacy-direct` 保留：

- 迁移报告逐项给出使用次数与去向；
- IR 中保留原始条件键；
- Phase 3 再决定是否标准化为 v0.5 DSL 条件、转为 `ext.` 私有扩展，或不导出。

这使 1074 条规则全部有明确去向，同时不静默改变现有语义。

### 4.9 诊断码

| 诊断码 | 级别 | 含义 |
| --- | --- | --- |
| `MIGRATED_RULE` | info | 每条源规则的逐条迁移记录 |
| `LEGACY_BAL_MIGRATED` | info | `balanced` 改写或拆分 |
| `LEGACY_SEAT_TOKEN` | info | `PAR` → `P` 等座位改写 |
| `LEGACY_CALL_TOKEN` | info | 叫品 token 规范化 |
| `LEGACY_CONDITION_NORMALIZED` | info | 花色集合等取值规范化 |
| `LEGACY_ID_PREFIX_SEMANTICS` | warning | `nat_` → `tags` |
| `LEGACY_ID_PREFIX_MISMATCH` | warning | `nat_` 与非自然动作冲突，需人工确认 |
| `TAG_CONFLICT` | warning | 已有冲突标签，未自动改写 |
| `AMBIGUOUS_RULES` | warning | 既有同优先级/同具体度/同序列动作冲突 |
| `LHO_RHO_UNRESOLVED` | error | 座位无法自动重建，不导出 |
| `LHO_RHO_MANUAL_REVIEW` | warning | LHO/RHO 需逐条人工确认 |
| `ALLPASS_INVALID` | error | allpass 位置或展开结果非法 |
| `ALLPASS_NORMALIZED` | info | allpass 已展开为 PASS |
| `SYSTEM_INFERRED` | warning | 无法推断体系，写为 `legacy` |

## 5. 1074 条全量统计

### 5.1 precision.yml

| 指标 | 数值 |
| --- | --- |
| 源规则 | 1074 |
| 自动迁移 | 1074 |
| 人工确认 | 0 |
| 不支持 | 0 |
| 可执行源规则 | 1074（100.0%） |
| 编译后可执行 IR 规则 | 1078 |
| 报告项 | 1402（error 0 / warning 88 / info 1314） |
| 条件键在用 | 36 / 46 |
| `shapeClass` 使用 | 215 |
| `rulesetId` | `sha256:4aae938c5141298c8fea714d03092cbed504f7a97cb7351a709f4d814365a55a` |

报告项构成：

| 诊断码 | 数量 |
| --- | ---: |
| `MIGRATED_RULE` | 1074 |
| `LEGACY_BAL_MIGRATED` | 219（215 条 true + 4 条 false） |
| `AMBIGUOUS_RULES` | 53 |
| `LEGACY_ID_PREFIX_SEMANTICS` | 35 |
| `LEGACY_CONDITION_NORMALIZED` | 21 |

53 条 `AMBIGUOUS_RULES` 是**既有规则冲突**：同优先级、同具体度、同序列但动作不同。迁移器保留源声明顺序，不改变现有裁决行为；它们不是迁移新引入的问题。

### 5.2 natural.yml

| 指标 | 数值 |
| --- | --- |
| 源规则 | 23 |
| 自动迁移 | 23 |
| 人工确认 | 0 |
| 不支持 | 0 |
| 可执行源规则 | 23（100.0%） |
| 编译后 IR 规则 | 23 |
| 报告项 | 25（error 0 / warning 0 / info 25） |
| `shapeClass` 使用 | 2 |
| `styleParams` | `open1ntMin`, `open1ntMax`, `overcallMinHcp` |
| `rulesetId` | `sha256:5cb5c98da9dcc86120f5b4861346002571fce5344b372bc63d1b29e7c6570314` |

## 6. precision.yml 条件覆盖率

覆盖率按**源条件键**统计；`balanced:false` 拆分生成的 `fiveCardMajor:true` 是迁移器派生字段，不计入源条件覆盖。

### 6.1 `D`：直接映射（10 键）

| 键 | 次数 | Phase 2 去向 |
| --- | ---: | --- |
| `hcp` | 713 | `direct` |
| `spades` | 234 | `direct` |
| `hearts` | 250 | `direct` |
| `diamonds` | 119 | `direct` |
| `clubs` | 107 | `direct` |
| `controls` | 2 | `direct` |
| `fourCardMajor` | 7 | `direct` |
| `noLongSuit` | 5 | `direct` |
| `noLongSuitExcept` | 10 | `direct` |
| `balanced` | 219 | `shapeClass`：true → `BAL_NO_5M`，false → 2 条规则 |

### 6.2 `P`：v0.4 部分表达（4 键）

| 键 | 次数 | Phase 2 去向 |
| --- | ---: | --- |
| `openingSeat` | 3 | `legacy-direct` |
| `aces` | 52 | `legacy-direct` |
| `lastBidSuit` | 29 | `legacy-direct` |
| `lastBidLevel` | 24 | `legacy-direct` |

### 6.3 `U`：v0.4 DSL 无法表达（22 键）

| 键 | 次数 | Phase 2 去向 |
| --- | ---: | --- |
| `adjustedHcp` | 1 | `legacy-direct` |
| `stoppers` | 110 | `legacy-direct` |
| `solidSuit` | 1 | `legacy-direct` |
| `partnerOpened` | 484 | `legacy-direct` |
| `partnerCueBid` | 22 | `legacy-direct` |
| `myCueBid` | 10 | `legacy-direct` |
| `cueBidSuit` | 11 | `legacy-direct` |
| `cueBidSuitNot` | 8 | `legacy-direct` |
| `cueBidLevel` | 17 | `legacy-direct` |
| `partnerSuit` | 12 | `legacy-direct` |
| `mySuit` | 2 | `legacy-direct` |
| `partnerForcingNewSuit` | 17 | `legacy-direct` |
| `myForcingNewSuit` | 14 | `legacy-direct` |
| `partnerBlackwood` | 5 | `legacy-direct` |
| `myBlackwood` | 7 | `legacy-direct` |
| `agreedSuit` | 7 | `legacy-direct` |
| `opponentSuitFirstControl` | 15 | `legacy-direct` |
| `opponentSuitStopper` | 5 | `legacy-direct` |
| `opponentSuitNot` | 10 | `legacy-direct` |
| `cueSuitStopper` | 3 | `legacy-direct` |
| `combinedHcp` | 1 | `legacy-direct` |
| `combinedAces` | 2 | `legacy-direct` |

逐项关闭结论：22 个键全部有明确去向，均为 `legacy-direct`；没有规则因这些键被排除。

### 6.4 未使用（10 键）

`cueBidActive`、`doubletons`、`fiveCardMajor`、`kings`、`losers`、`myNaturalSuit`、`partnerHcp`、`partnerNaturalSuit`、`singletons`、`voids`。

这些键在 precision 源条件中未出现，`disposition: unused`；不代表从 IR 词表删除。

### 6.5 取值规范化

21 条 `LEGACY_CONDITION_NORMALIZED` 全部来自花色集合顺序规范化，例如：

- `SHD` → `DHS`
- `SDC` → `CDS`
- `HSDC` → `CDHS`
- `DC` → `CD`

规范化只改字母顺序，不改变集合语义。

## 7. 20 条代表规则固定牌例比对

比对口径：

- 原规则：legacy YAML 的 `when` 直接交给现有 `checkConditions`；
- 迁移后：IR 编译为 `BiddingRule` 后的 `when`；
- 每条规则使用 18 手固定牌、每个牌例分别在有/无 `ConditionContext` 下求值；
- 共 `20 × 18 × 2 = 720` 次条件比对，全部一致。

| 规则 | 行 | 序列 | 动作 | 优先级 | 迁移后条件 |
| --- | ---: | --- | --- | ---: | --- |
| `open_1c` | 17 | `^$` | `1C` | 100 | `hcp:16-40` |
| `open_1h` | 38 | `^$` | `1H` | 92 | `hcp:11-15, hearts:5+` |
| `open_1s` | 45 | `^$` | `1S` | 91 | `hcp:11-15, spades:5+` |
| `open_1d` | 52 | `^$` | `1D` | 88 | `diamonds:4+, hcp:11-15, openingSeat:1-2` |
| `open_2c_precision` | 80 | `^$` | `2C` | 90 | `clubs:6+, hcp:11-15` |
| `open_2d_precision` | 115 | `^$` | `2D` | 89 | `clubs:4, diamonds:1, hcp:11-15, hearts:4, spades:4` |
| `open_weak2_s` | 108 | `^$` | `2S` | 59 | `hcp:6-10, spades:6+` |
| `resp_1nt_2c_stayman` | 662 | `P:1NT R:PASS` | `2C` | 80 | `fourCardMajor:true, hcp:8+, partnerOpened:true` |
| `resp_1nt_2d_transfer_h` | 669 | `P:1NT R:PASS` | `2D` | 82 | `hcp:8+, hearts:5+, partnerOpened:true` |
| `resp_1h_raise_limit` | 879 | `P:1H R:PASS` | `3H` | 78 | `hcp:10-13, hearts:3+, partnerOpened:true` |
| `comp_raise_1h_over_1s_invite` | 5543 | `P:1H R:1S` | `3H` | 77 | `hcp:10-12, hearts:3+, partnerOpened:true` |
| `overcall_1s_after_1c` | 2723 | `R:1C` | `1S` | 70 | `hcp:${overcallMinHcp}-18, spades:5+` |
| `takeout_double_1h` | 2817 | `R:1H` | `X` | 67 | `clubs:3+, diamonds:3+, hcp:12-16, spades:4+` |
| `cue_1h_over_1s` | 6625 | `P:1H R:1S` | `2S` | 92 | `hcp:16+, noLongSuitExcept:H, opponentSuitFirstControl:true, partnerOpened:true` |
| `cue_1c_over_1d` | 6844 | `P:1C R:1D` | `2D` | 92 | `hcp:16+, noLongSuit:true, opponentSuitFirstControl:true, partnerOpened:true` |
| `cue_reply_h5_3h` | 7124 | `.*` | `3H` | 98 | `cueBidLevel:2, cueBidSuitNot:H, hearts:5+, partnerCueBid:true` |
| `blackwood_1h_3h` | 4041 | `M:1H L:PASS P:3H R:PASS` | `4NT` | 88 | `hcp:15, hearts:6+` |
| `blackwood_1h_3h_0_4` | 4055 | `P:1H R:PASS M:3H L:PASS P:4NT R:PASS` | `5C` | 96 | `aces:0, partnerOpened:true` |
| `blackwood_5d_1` | 7362 | `.*` | `5D` | 99 | `aces:1, partnerBlackwood:true` |
| `opener_stayman_2s` | 741 | `M:1NT L:PASS P:2C R:PASS` | `2S` | 96 | `spades:4+` |

上述规则均不涉及 `balanced`，因此可直接比较条件求值。`balanced:true` 与 `balanced:false` 的语义变化由 `migrate.test.ts` 的专门用例单独覆盖：

- 5M5332 在 `balanced:true` 下不匹配 `BAL_NO_5M`；
- 5M5332 在 `balanced:false` 拆分后由 `#2` 匹配；
- 4333 匹配 `BAL_NO_5M`，不匹配 `balanced:false`。

## 8. 确定性与产物校验

固定 `generatedAt: 2026-10-27T00:00:00Z` 生成产物，并重复生成到临时目录比对：

| 产物 | SHA-256 |
| --- | --- |
| `precision.rules.json` | `685c463d014be450ae57904825746d7e6f16e4d1c5c02a28c786471e9a2e6767` |
| `precision.migration.json` | `186dee8cf59197c66f936e7251fff2dc828240c92ecb15291ef57ca346a29ad5` |
| `natural.rules.json` | `c2a35cc60fc5a145d44320080a0da3c44c55fa7e03ab8b476e7e8ba9372e7450` |
| `natural.migration.json` | `5ecea8f1e4d723653e70f99bb91842505c0b145edcde70b93e1f2e799ed3b1f1` |

重复生成的四份文件与上表逐字节一致。即使不固定时间，除 `generatedAt` 外报告也逐字节一致；`rulesetId` 不受 `generatedAt` 影响。

## 9. 验收结果

| Phase 2 验收项 | 结果 |
| --- | --- |
| 1074 条规则 100% 有明确去向 | 通过：1074 条可执行，0 unsupported，0 manual-review |
| 可执行率 ≥ 90% | 通过：100.0% |
| LHO/RHO 规则 100% 人工确认 | 通过：输入中 0 条；迁移器行为由合成用例覆盖 |
| allpass 展开可结束 | 通过：3 种结束情形 + 非法位置用例 |
| 重复迁移除 `generatedAt` 外逐字节一致 | 通过：固定时间产物逐字节一致 |
| 20 条代表规则固定牌例比对 | 通过：720 次条件比对全部一致 |
| 现有基线不变 | 通过：44 个测试文件 / 556 个用例全绿（其中 Phase 2 新增 26 个） |
| 不修改运行时 / 现有 YAML / 基线用例 | 通过 |
| `npm run check:phase0` | 通过：17 项 |
| `npm run typecheck` | 通过 |
| `npx vitest run src/brules` | 通过：7 个文件 / 109 个用例 |

## 10. 限制与 Phase 3 交接

1. **`BAL_NO_5M` 与当前 `isBalanced` 不等价**：切换运行时后，215 条 `balanced:true` 规则会排除 5M5332；4 条 `balanced:false` 拆分规则会包含 5M5332。Phase 3 必须先评审该差异并建立固定牌例回归。
2. **53 条既有冲突规则**：迁移保留声明顺序，不改变裁决；Phase 3 应决定是否修正规则本身，而不是让迁移器擅自重排。
3. **22 个 `legacy-direct` 条件键**：Phase 2 只保证有明确去向；Phase 3 切换前需确认编译器/运行时对这些键的求值路径与 legacy 完全一致。
4. **v0.4 行式 DSL 未实现**：本阶段只迁移 legacy YAML；若后续需要直接读取 `VERSION: BRULES/0.4` 文件，需要补 v0.4 解析器。
5. **报告不是语义投影**：`generatedAt`、`source`、`description` 等不进入 `rulesetId`；产物中的 IR 才是语义权威。
6. **未提交**：本阶段所有变更仍保留在工作区，等待确认后提交。
