# BRULES v0.4 → v0.5 迁移规范

- 状态：Phase 0 定稿
- 输入：`VERSION: BRULES/0.4` 的 v0.4 文件；以及无文件头的现有 YAML
- 输出：v0.5 IR（`rules-ir.schema.json`），可选输出 v0.5 DSL
- 原则：**不得静默改变语义**。任何无法无损迁移的规则必须进入报告，按“标准化 / `ext.` 私有 / 不导出”处置。

## 1. 迁移流程

```text
读取文件
  → 识别版本（v0.4 / legacy-yaml / v0.5）
  → 语法解析（版本专用）
  → 语义校验（id、引用、区间、风格变量、量词）
  → 逐规则迁移（本文件第 2–9 节）
  → 生成 v0.5 IR + 迁移报告
  → 可选：IR → v0.5 DSL
```

迁移器必须保留原始行号、原始 id、原始声明顺序。`rulesetId` 使用迁移后的生效 IR 计算；迁移报告不属于语义投影。

## 2. 版本与文件头

| 输入 | 处理 |
| --- | --- |
| `VERSION: BRULES/0.4` | 走 v0.4 解析器；迁移到 v0.5 |
| `VERSION: BRULES/0.5` | 走 v0.5 解析器；不迁移 |
| 其他版本 | `UNSUPPORTED_VERSION`，拒绝 |
| 无 `VERSION` 的 YAML | `legacy-yaml`；不强制迁移，继续由现有加载器读取 |

v0.4 版本号允许多位数字（如 `0.10`），v0.5 继承该规则。迁移输出文件头：

```text
VERSION: BRULES/0.5
FORMAT: bridge-rules
KIND: bidding
SYSTEM: <原 system 或 precision>
SYSTEM_VERSION: <原版本或 0.5.0>
```

`SYSTEM` 无法从 v0.4 文件推断时，写 `legacy` 并产生 `SYSTEM_INFERRED` 警告；不得伪装成 `precision`。

## 3. 相对座位：LHO / RHO

### 3.1 定义差异

| 记号 | v0.4 定义 | 标准/v0.5 定义 |
| --- | --- | --- |
| `LHO` | 上家，先于 ME 叫牌 | 下家，紧接 ME 之后叫牌 |
| `RHO` | 下家，后于 ME 叫牌 | 上家，紧邻 ME 之前叫牌 |

v0.4 的顺时针顺序是 `ME → RHO → PAR → LHO → ME`；v0.5 是 `ME → LHO → PAR → RHO → ME`。

### 3.2 迁移规则

1. **禁止全局机械互换。** v0.4 文档自带的示例对 `LHO`/`RHO` 的使用并不一致；机械互换会把本来正确的规则改错。
2. 对每条含 `LHO`/`RHO` 的规则，按以下步骤逐条重建：
   - 从规则的 `BIDSEQ` 或示例叫牌序列确定当前决策人 `ME`；
   - 按 v0.4 定义找出该 token 实际指向的绝对座位；
   - 把绝对座位换算成 v0.5 的相对座位；
   - 与规则文本声明的 token 比较；
   - 一致 → 输出 v0.5 token；不一致 → `LEGACY_LHO_RHO_CONFLICT`，规则不自动导出。
3. 每条被改写的规则输出 `LHO_RHO_MANUAL_REVIEW`（`warning`），附 `before`、`after`、`evidence`（重建所用的叫牌序列）。
4. 无法确定 `ME` 或序列不完整时，输出 `LHO_RHO_UNRESOLVED`（`error`），规则保留在报告中，不进入可执行 IR。

### 3.3 示例

v0.4：

```text
COND: cond_stayman_clean | PAR:(1NT) + LHO:(-) + ME:(U:#>=4 + PTS>=8)
```

同伴 1NT 后，紧邻 ME 之前叫牌的是 ME 的**上家**。v0.4 写 `LHO`（其定义=上家），v0.5 应写 `RHO`。迁移报告必须说明这是按 v0.4 定义重建的结果，而不是“看到 LHO 就换成 RHO”。

## 4. `allpass` / `AP` / 叫牌结束

### 4.1 v0.4 的问题

v0.4 规定 `allpass` 在序列末尾“追加连续四个 `-`”。这会在已经写了 `W:-` 的序列后产生 5 个连续 Pass，违反叫牌结束规则。v0.5 改为：

- `AP` 表示“补足叫牌结束所需的剩余 Pass”，不是固定四个；
- 叫牌已经结束后，不得再追加任何 Pass；
- 纯四家 Pass（流局）必须显式写四个 Pass，或由导入器规范化为四个 Pass。

### 4.2 迁移算法

```text
若序列以 allpass 结尾：
  去掉 allpass
  计算从当前序列末尾到叫牌结束还缺几个 Pass
  追加恰好这么多个 PASS
  若序列中没有任何实质叫品：
      结果必须是四个 PASS
  若追加后仍不能结束：
      报 ALLPASS_INVALID，不导出
```

同时输出 `ALLPASS_NORMALIZED`（`info`），记录追加的 Pass 数。

### 4.3 示例

| v0.4 | v0.5 IR `auction` |
| --- | --- |
| `N:1NT,E:-,S:2C,W:-,N:2H,E:-,S:3NT,W:-,allpass` | `1NT PASS 2C PASS 2H PASS 3NT PASS PASS PASS`（`W:-` 已是第一个 Pass，后面还需两个） |
| `N:-,E:-,S:-,W:-,allpass` | `PASS PASS PASS PASS` |
| `N:1NT,E:-,S:2C,W:-,N:2H,E:-,S:3NT,allpass` | `1NT PASS 2C PASS 2H PASS 3NT PASS PASS PASS` |

导出 PBN 时，叫牌完成后停止；`AP` 只作为导入可接受的简写，不作为规范导出形式。

## 5. `ALL` / `ANY` 与量词

### 5.1 v0.4 语义

- `U:#>=5`、`L:#>=4` 默认是**存在量词**：至少一门满足；
- `ALL(U)` 只有集合，没有谓词，单独出现没有可判定语义；
- `ALL(U) + U:#>=5` 仍然是存在量词，不能表达“两门高花都 ≥5”。

### 5.2 v0.5 文法

```text
ANY(U, LEN>=5)      # 至少一门高花 5+ 张
ALL(U, LEN>=5)      # 两门高花都 5+ 张
ANY(L, HCP>=5)      # 至少一门低花有 5+ HCP
ALL(C, LEN<=3)      # 梅花最多 3 张（单元素集合，等价于 clubs<=3）
```

谓词只允许 `LEN`、`HCP`、`CTL`，比较符只允许 `>=`、`<=`、`=`、`>`、`<`。嵌套 `ALL/ANY` 为 `UNSUPPORTED_FEATURE`。

### 5.3 迁移映射

| v0.4 | v0.5 |
| --- | --- |
| `U:#>=n` | `ANY(U, LEN>=n)` |
| `U:#<=n` | `ALL(U, LEN<=n)` |
| `L:#>=n` | `ANY(L, LEN>=n)` |
| `L:#<=n` | `ALL(L, LEN<=n)` |
| `S:#=n` | `spades: "n"`（单元素可降解为扁平条件） |
| `ALL(U)` | `INVALID_QUANTIFIER`，不导出 |
| `ALL(U) + U:#>=n` | `ALL(U, LEN>=n)`，并输出 `QUANTIFIER_REPAIRED` |
| `U:[AKxx]` / `L:[QJxx]` | 无法用扁平条件无损表达；`UNSUPPORTED_FEATURE` 或 `ext.` 私有扩展 |

`ANY` 在 IR 之前展开为多条规则；展开出的规则共享源 `specificity`，并保留源 `id` 加 `#1`、`#2` 后缀。后缀只用于区分展开产物，不得参与任何语义判断。

## 6. 形状：`BAL` / `SEMIBAL` / `UNBAL`

| v0.4 | v0.5 IR | 说明 |
| --- | --- | --- |
| `BAL` | `shapeClass: BAL_NO_5M` | v0.4 `BAL` 排除 5 张高花的 5332；不能写成 `balanced: true` |
| `SEMIBAL` | `shapeClass: SEMIBAL` | v0.5 运行时暂返回 `UNSUPPORTED_CONDITION` |
| `UNBAL` | `shapeClass: UNBAL` | 同上 |
| 无 | `shapeClass: BAL_ANY` | v0.4 没有等价宏；不要用 `BAL` 冒充 |

精确定义见 `conditions.md` 第 5 节。特别注意：

- `BAL_NO_5M` 与 `SEMIBAL` 在 `4432`、`5332(低花)` 上重叠；
- `UNBAL` 是二者的补集；
- `5332` 且 5 张为高花：`BAL_ANY=true`、`BAL_NO_5M=false`、`SEMIBAL=false`、`UNBAL=true`；
- 迁移器不得把 `BAL`、`SEMIBAL`、`UNBAL` 合并成一个 `balanced` 布尔。

运行时降解：

```text
BAL_ANY    → balanced: true
BAL_NO_5M  → balanced: true + fiveCardMajor: false
SEMIBAL    → UNSUPPORTED_CONDITION
UNBAL      → UNSUPPORTED_CONDITION
```

## 7. 通配符 `x` / `*`

### 7.1 v0.4 定义

- `x` 只在 `[]` 集合内使用，代表 **2–9 的任意小牌**；`AKxx` 表示 A、K 加两张 2–9 小牌；
- `*` 代表任意牌张，包括 A/K/Q/J/T；
- 二者都带**重数**：写几个 `x` 就表示几张。

### 7.2 v0.5 处理

v0.5 **退役** `x` 与 `*`：

- 叫品位置的小写 `x` 不是加倍；`X`/`XX` 只在叫品位置有效；
- 牌点位置不得出现 `x`/`X`/`*`；
- 手牌块只允许真实牌张 `A K Q J T 2 3 4 5 6 7 8 9`。

### 7.3 迁移策略

1. 每个 `x`/`*` 出现都输出 `LEGACY_WILDCARD_MIGRATED`（`info`），附规则 id、行号、原文。
2. 能精确降解的，按集合语义改写：
   - `S:[AKxx]` 且上下文能确定为“恰好 4 张、含 A/K、另两张 2–9”时，可尝试 `spades: "4"` + `aces: "1+"` + `kings: "1+"` + `noLongSuitExcept` 等组合；**只有能证明等价时才自动改写**。
   - 无法证明等价时，`UNSUPPORTED_FEATURE`，不导出。
3. `*` 一律不自动改写；它跨越 A/K/Q/J/T，无法用有限扁平条件无损表达。
4. 任何情况下都不得把 `x` 解释成 v0.5 的“任意小牌”并静默保留；v0.5 没有这个令牌。

## 8. `P` / `Pass` / `-`

| 位置 | v0.4 | v0.5 |
| --- | --- | --- |
| 叫品 | `-` = Pass | DSL `-`；IR `PASS`；导入接受 `PASS` / `Pass` / `pass` / `-` |
| 相对座位 | `PAR` = 同伴 | `P` = 同伴；`PAR` 仍可接受为别名 |
| 叫品 | 单字母 `P` 不是 Pass | 单字母 `P` **不是** Pass；出现在叫品位置是 `INVALID_CALL` |
| 牌点 | `PTS` = 大牌点 | 不得把 `P` 当作 `PTS` 或 Pass |

迁移：

- 叫品 `-` → IR `PASS`；
- 序列中的 `PAR:` **必须**改为 `P:`；v0.5 DSL 只接受 `P`，v0.4 导入器可以读 `PAR:`，但它不是 v0.5 表面语法；
- 叫品位置出现 `P` → `PASS_ALIAS_REJECTED`，不自动改成 Pass；
- 牌点 `PTS` → `hcp`，`CTL` → `controls`。

## 9. 标签与 `nat_` 前缀

### 9.1 迁移规则

1. 现有 id 以 `nat_` 开头的规则，迁移时写入：

   ```json
   "tags": ["natural", "forcing"]
   ```

   并保留原 id（便于追溯）；输出 `LEGACY_ID_PREFIX_SEMANTICS`（`warning`）。
2. `partnerForcingNewSuit` / `myForcingNewSuit` 的语义改为：该座位最后一次自然花色叫牌所命中的规则同时带有 `natural` 与 `forcing`。**不再读取 id 前缀。**
3. 新 v0.5 规则不得用 id 前缀表达语义；`tags` 是唯一语义标签来源。
4. `ANY` 展开产生的 `#1`、`#2` 后缀不参与标签判断，也不参与 `rulesetId` 的规则 id 语义（展开产物沿用源 id）。

### 9.2 需要人工确认的情况

- `nat_` 规则的实际叫品不是自然花色（例如约定叫误用了前缀）→ `LEGACY_ID_PREFIX_MISMATCH`；
- 同一规则既有 `nat_` 前缀又有显式 `tags` 且冲突 → `TAG_CONFLICT`；
- 规则被其他规则按 id 引用 → 保留 id，不自动改名。

## 10. 条件键映射

逐键映射、边界和测试向量见 `conditions.md` 第 6 节。迁移器必须：

1. 把 v0.4 的 `PTS` / `CTL` / `花色:#` 转成 `NumRange`；
2. 把 `BAL` 转成 `shapeClass: BAL_NO_5M`；
3. 把 `U` / `L` 的存在量词转成 `ANY`；
4. 对 22 个无法表达的键输出 `UNSUPPORTED_CONDITION`，不得丢弃；
5. 对 `openingSeat`、`aces`、`lastBidSuit`、`lastBidLevel` 输出“部分映射”报告。

## 11. 诊断码

| 码 | 严重度 | 触发条件 | 迁移动作 |
| --- | --- | --- | --- |
| `UNSUPPORTED_VERSION` | error | 未知版本 | 拒绝 |
| `UNSUPPORTED_FEATURE` | error | 嵌套量词、`*`、无法降解的集合 | 不导出该规则 |
| `UNSUPPORTED_CONDITION` | warning | `SEMIBAL`/`UNBAL` 或 v0.4 无法表达的条件 | 保留 IR，标记不可执行 |
| `DUPLICATE_ID` | error | 同文件 id 重复（大小写不敏感） | 拒绝 |
| `UNRESOLVED_REFERENCE` | error | `USE` 引用不存在的 `COND` | 拒绝 |
| `INVALID_RANGE` | error | `15-17+`、`17-15`、非整数 | 拒绝 |
| `UNRESOLVED_STYLE_VAR` | error | 变量未在 `STYLE_PARAMS` 声明 | 拒绝 |
| `AMBIGUOUS_RULES` | warning | 同优先级、同具体度、同序列的规则动作冲突 | 保留，报告 |
| `EXPANDED_DISJUNCTION` | info | `ANY` 展开为多条规则 | 保留源 `specificity` |
| `LEGACY_WILDCARD_MIGRATED` | info | 遇到 `x` / `*` | 按第 7 节处理 |
| `LEGACY_ID_PREFIX_SEMANTICS` | warning | id 以 `nat_` 开头 | 写入 `tags` |
| `LEGACY_ID_PREFIX_MISMATCH` | warning | `nat_` 规则不是自然花色 | 人工确认 |
| `LHO_RHO_MANUAL_REVIEW` | warning | 规则含 `LHO`/`RHO` | 逐条确认 |
| `LHO_RHO_CONFLICT` | error | 文本与 BIDSEQ 重建结果冲突 | 不导出 |
| `LHO_RHO_UNRESOLVED` | error | 无法确定 ME 或序列不完整 | 不导出 |
| `ALLPASS_NORMALIZED` | info | 展开 `allpass` | 记录追加 Pass 数 |
| `ALLPASS_INVALID` | error | 展开后仍不能结束 | 不导出 |
| `PASS_ALIAS_REJECTED` | error | 叫品位置出现 `P` | 不自动改写 |
| `INVALID_QUANTIFIER` | error | `ALL(U)` 无谓词、嵌套量词 | 不导出 |
| `QUANTIFIER_REPAIRED` | info | `ALL(U)+U:#>=n` 修复为 `ALL(U,LEN>=n)` | 保留 |
| `CONTRADICTORY_CONDITION` | warning | `shapeClass` 与 `balanced`/`fiveCardMajor` 矛盾 | 保留，报告 |
| `SYSTEM_INFERRED` | warning | 无法从 v0.4 推断体系 | 写 `legacy` |

## 12. 迁移报告格式

```json
{
  "source": "rules/bidding/legacy.yml",
  "sourceVersion": "0.4",
  "targetVersion": "0.5",
  "generatedAt": "2026-10-27T00:00:00Z",
  "summary": {
    "rules": 1074,
    "autoMigrated": 812,
    "manualReview": 198,
    "unsupported": 64
  },
  "entries": [
    {
      "ruleId": "nat_1c_16",
      "line": 42,
      "code": "LEGACY_ID_PREFIX_SEMANTICS",
      "severity": "warning",
      "action": "add-tags",
      "before": "id: nat_1c_16",
      "after": "tags: [natural, forcing]",
      "reason": "v0.5 不再按 id 前缀判断 forcing new suit"
    }
  ]
}
```

报告必须能按 `code`、`ruleId`、`severity` 过滤；`summary` 的数字必须与 `entries` 可重算一致。

## 13. 验收

1. 相同输入重复迁移，输出逐字节一致（除 `generatedAt`）。
2. 每条被改写的规则都有报告项；没有报告项的规则必须逐字段等价。
3. `LHO`/`RHO` 规则 100% 进入人工确认清单，不得静默改写。
4. `allpass` 展开后，所有叫牌序列都能通过“叫牌结束”校验。
5. 1074 条 `precision.yml` 规则完成迁移报告；不可执行规则单独列出，不阻塞其余规则。
6. 用 20 条代表规则（开叫、应叫、竞争叫牌、扣叫、Blackwood）做迁移前后固定牌例比对。
7. 现有 447 个用例不因迁移工具本身改变；迁移工具不得修改 `src/engine/*`、`src/core/*` 或现有 YAML。
