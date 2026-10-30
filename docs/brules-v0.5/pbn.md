# PBN 互通规范（Profile S 子集）

- 状态：Phase 0 定稿
- 目标：把当前单机 `TableBoard` 与 PBN 2.1 的一个明确子集互转，并给出可检查的损失报告
- 非目标：完整 PBN 2.1、残局求解格式、转播/事件流、Profile P 的隐私投影
- 关联：`record.schema.json`、`reproducibility.md`

本文件只定义**子集映射**，不声称完整支持 PBN。任何不能保留的信息都必须进入损失报告；没有 round-trip 测试支撑，不得写“无损”。

## 1. 文件与编码

| 项 | 规范 |
| --- | --- |
| 首行 | `% PBN 2.1` |
| 默认编码 | ISO 8859-1；球员标签使用 ASCII 伪名 |
| 可选编码 | UTF-8；必须显式开启，并输出损失报告 |
| BOM | 不得写 UTF-8 BOM；导入时若发现 BOM，去掉并给 `BOM_STRIPPED` 警告 |
| 换行 | 导出 LF；导入接受 LF / CRLF |
| 标签 | `[Name "value"]`，一行一个；标签名大小写不敏感，导出用标准大小写 |
| 注释 | `%` 开头到行尾；`;` 开头也可作为注释导入 |

## 2. `[Deal]` 与 `[Dealer]`

### 2.1 Deal 串结构

```text
[Deal "N:AKQ2.JT9.543.876 JT98.AKQ.AKQJ.T9 76543.8765.T98.A -.432.762.KQJ5432"]
```

- 冒号前是**第一手牌的座位**，不是“发牌人”的同义词；
- 冒号后四手牌按 `N → E → S → W` 顺时针排列；
- 手牌之间用空白分隔；
- 花色顺序固定为 `♠ ♥ ♦ ♣`（PBN 标准）；
- 花色内点数从大到小；`T` 表示 10；
- 缺门写 `-`；
- 每手必须 13 张，四手合计 52 张且互不重复。

### 2.2 发牌人优先级

| `[Dealer]` | Deal 前缀 | 处理 |
| --- | --- | --- |
| 有 | 有，且相同 | 正常；Dealer 为发牌人，前缀为第一手 |
| 有 | 有，但不同 | `[Dealer]` 为准；保留前缀作为第一手；`DEALER_PREFIX_MISMATCH` 警告 |
| 有 | 无 | `[Dealer]` 为准；第一手默认 `N`；`DEAL_PREFIX_DEFAULTED_N` 警告 |
| 无 | 有 | 用前缀推断发牌人；`DEALER_INFERRED_FROM_DEAL_PREFIX` 警告 |
| 无 | 无 | `DEALER_UNKNOWN` 错误，不猜 |

导出时**始终**满足：`[Dealer]` 的值 = Deal 前缀 = 第一手牌座位。这样即使接收方忽略 `[Dealer]`，也能按前缀还原。

### 2.3 缺门与空段

- 规范导出：缺门写 `-`，例如 `-.432.762.KQJ5432`。
- 兼容导入：空段（如 `.432.762.KQJ5432`）可接受，规范化为 `-`，并给 `EMPTY_SUIT_SEGMENT` 警告。
- 只有空手的 DDS 残局才使用 `...`；它不是 PBN 对局记录，不得作为 `.pbn` 导出。
- `--`、`-A`、`A-` 等混合写法是错误。

### 2.4 校验

导入必须拒绝：

- 少于/多于四手；
- 任一手不是 13 张；
- 52 张中有重复；
- 非法花色段数（不是 4 段）；
- 非法点数（`1`、`0`、小写以外无法识别的字符）；
- 同一花色点数未从大到小排列或重复；
- 非法座位前缀。

## 3. `[Vulnerable]`

| PBN | JSON |
| --- | --- |
| `None` | `NONE` |
| `NS` | `NS` |
| `EW` | `EW` |
| `All` | `ALL` |

- 导入大小写不敏感；
- 局况未知时**省略**该标签，不得写成某个真实局况；
- 现有内部值 `none` / `both` 由适配层转换：`both ↔ ALL`，`none ↔ NONE`。

## 4. `[Auction]`

### 4.1 格式

```text
[Auction "N"]
1NT P 2C P 2H P 3NT AP
```

- 标签值是发牌人座位；
- 叫品用空白分隔；
- PBN 令牌：`P`（Pass）、`X`、`XX`、`1C`…`7NT`；
- `AP` 只允许出现在末尾，表示“补足叫牌结束所需的剩余 Pass”；
- 叫牌结束后不得再追加 Pass。

### 4.2 导入

1. `AP` 展开为从当前序列末尾到叫牌结束所需的最少 Pass 数；
2. 没有 `AP` 且序列未结束 → `AUCTION_INCOMPLETE` 警告；只有明确允许进行中记录时才保留；
3. `P` / `PASS` / `Pass` / `-` 都接受为 Pass；IR 统一为 `PASS`；
4. 叫品不合法（如 `8C`、`1H` 在 `1S` 后）→ `INVALID_CALL` 错误；
5. 四家连续 Pass（流局）必须是四个 Pass，不能只写一个 `AP` 冒充。

### 4.3 导出

- 使用 `P` 表示 Pass，不使用 `-`；
- 写出到叫牌结束为止的完整序列，包括结束所需的最后三个 Pass；
- 不写 `AP`（`AP` 只作为导入简写）；
- 不在结束后追加任何 Pass；
- 流局写四个 `P`。

### 4.4 示例

| 输入 | 展开后的 calls |
| --- | --- |
| `1NT P 2C P 2H P 3NT AP` | `1NT P 2C P 2H P 3NT P P P` |
| `1NT P 2C P 2H P 3NT P P P` | 同上（已是完整序列） |
| `P P P P` | 流局 |
| `1NT P 2C P 2H P 3NT P P P P` | `AUCTION_EXTRA_PASS` 警告，去掉多余 Pass |

## 5. `[Contract]` / `[Declarer]` / `[Result]`

| PBN | JSON | 说明 |
| --- | --- | --- |
| `[Contract "4S"]` | `contract {level:4, denomination:"S", doubled:"NONE"}` | 成约或宕掉都写 |
| `[Contract "4SX"]` | `doubled:"X"` | 加倍 |
| `[Contract "4SXX"]` | `doubled:"XX"` | 再加倍 |
| `[Contract "Pass"]` | 无 `contract`；`status:"PASSED_OUT"` | 流局 |
| `[Declarer "S"]` | `declarer:"S"` | 座位 |
| `[Result "9"]` | `tricksTaken:9` | 庄家方所得墩数 0–13 |

- `Contract` 存在且不是 `Pass` 时，`Declarer` 与 `Result` 必须存在；
- `PASSED_OUT` 不得有 `contract`、`declarer`、`tricksTaken`、`play`；
- `CANCELLED / INCOMPLETE / REOPENED` 不写 `Contract`、`Declarer`、`Result`、`Play`、`Auction`，也不写 `[Score]`；JSON 中这些状态的 `score.nsRaw` 必须为 `null`，导出损失报告说明 `score` 被省略；
- `IN_PROGRESS` 可以没有 `Contract`；如果已有 `Contract`，不得当作已完成记录导出。

## 6. `[Score]`

### 6.1 格式

```text
[Score "NS 420"]
[Score "EW 620"]
[Score "NS 0"]
```

- 值是“方向 + 非负整数”，不是带符号整数；
- 方向只能是 `NS` 或 `EW`；
- 不允许 `[Score "420"]`、`[Score "NS -420"]`、`[Score "NS +420"]`；
- `NS 0` 只用于流局或双方真实 0 分；不得用 0 表示取消/未完成/重开；
- `CANCELLED / INCOMPLETE / REOPENED` 导出时省略 `[Score]`，不写 `[Score "NS 0"]`。

### 6.2 映射

```text
nsRaw = +value   if direction == NS
nsRaw = -value   if direction == EW
```

| PBN | `score.nsRaw` | `source` |
| --- | --- | --- |
| `NS 420` | `420` | `director` |
| `EW 620` | `-620` | `director` |
| `NS 0` | `0` | `director` |
| 缺失，且可由 Contract/Result/Vulnerable 计算 | 计算值 | `computed` |
| 缺失，且无法计算 | `SCORE_UNKNOWN` 错误 | — |

导入时若 `[Score]` 与按 Contract/Result 计算的结果不一致：

- 保留 `[Score]` 作为原始事实，`source:"director"`；
- 输出 `SCORE_MISMATCH` 警告，附两个值；
- 不得用计算结果覆盖导演分。

## 7. `[Play]`

### 7.1 子集格式

```text
[Play "W"]
S2 H3 D4 C5
...
```

- 标签值是首攻座位；
- 每行一墩，四张牌按从首攻开始的顺时针顺序；
- 牌面令牌为 `[2-9TJQKA][CDHS]`，如 `AS`、`TD`、`2C`；
- 行数 1–13；最后一墩可以少于四张（残局），但 `.pbn` 对局导出只写完整墩。

### 7.2 映射

```json
{
  "tricks": [
    {
      "leader": "W",
      "cards": [
        { "seat": "W", "card": "S2" },
        { "seat": "N", "card": "H3" },
        { "seat": "E", "card": "D4" },
        { "seat": "S", "card": "C5" }
      ],
      "winner": "W"
    }
  ]
}
```

- `winner` 由引擎按将牌/首攻花色判定，不由 PBN 显式给出；
- 导入时校验每张牌属于开局四手牌、未重复出现、跟牌合法；无法校验时给 `PLAY_UNVERIFIED` 警告；
- `[Play]` 缺失但 Contract/Result 存在 → `status:"IN_PROGRESS"`、`PLAY_MISSING` 警告，不伪造出牌；
- `[Play]` 存在但 Contract/Result 缺失 → `CONTRACT_MISSING` 错误。

### 7.3 残局限制

- `.pbn` 对局导出始终使用**开局四手 13 张**的 `[Deal]`，打牌过程放入 `[Play]`；
- `toPbnHands()` 产生的不等长手牌只用于内部/DDS，不得作为 `.pbn` 对外导出；
- 如确需导出残局，必须标 `NON_STANDARD_ENDGAME`，并写损失报告。

## 8. 球员、赛事与昵称

| PBN | JSON | 说明 |
| --- | --- | --- |
| `[Board "3"]` | `deal.boardNumber` | 整数 |
| `[Event "..."]` / `[Site "..."]` | `session.event` / `session.site` | 可省略 |
| `[Date "2026.10.27"]` | `session.date` | `yyyy.mm.dd` |
| `[West "..."]` 等 | `seats[*].nicknameSnapshot` | 见编码 |
| `[Scoring "IMP"]` | `session.scoringMode` | 如 `IMP`、`MP` |

### 8.1 编码

- 默认 PBN 2.1 使用 ISO 8859-1 可表示的伪名：`Player-1`、`Player-2`、`Player-3`、`Player-4`，按导出范围内 `N/E/S/W` 顺序分配；
- 完整昵称只放在 JSON 的 `nicknameSnapshot`，不放进默认 PBN；
- 开启 UTF-8 PBN 时，可以直接写 UTF-8 昵称，但必须在损失报告中声明“部分第三方工具可能无法读取”；
- 任何情况下都不得把中文昵称写入默认 ISO 8859-1 PBN 后静默替换成 `?`。

### 8.2 伪名稳定性

同一导出范围内，同一座位必须得到同一伪名；不同范围可以重用 `Player-1`。伪名不是账号标识，不得反向映射到真实账号。

## 9. 导入状态机

```text
读取标签
  → 解析 Deal（四手、52 张、发牌人）
  → 解析 Vulnerable
  → 解析 Auction
      → 流局？ → PASSED_OUT
      → 完成？ → 继续
      → 未完成？ → IN_PROGRESS
  → 解析 Contract / Declarer / Result
      → Contract == Pass → PASSED_OUT
      → 有 Contract 但无 Result → CONTRACT_INCOMPLETE
  → 解析 Play
      → 无 Play → IN_PROGRESS + PLAY_MISSING
      → 有 Play → 校验并计算 winner
  → 解析 Score
      → 有 → director
      → 无 → computed / SCORE_UNKNOWN
  → 计算 hcp
  → 输出 TableBoard
```

## 10. 损失报告

任何转换无法保留信息时，输出：

```json
{
  "field": "players.west.nickname",
  "action": "transformed",
  "reason": "ISO 8859-1 PBN 不能表示中文昵称，使用伪名 Player-3；完整昵称保留在 JSON"
}
```

`action` 只能是：

- `omitted`：字段未写入；
- `transformed`：值被转换（如昵称→伪名、`both`→`All`）；
- `approximated`：值被近似（如无法精确还原的导演分）。

报告必须随导出文件一起提供；没有报告时，接收方应视为“未声明损失”。

## 11. 测试向量

### 11.1 Deal 与缺门

```text
[Deal "N:AKQ2.JT9.543.876 JT98.AKQ.AKQJ.T9 76543.8765.T98.A -.432.762.KQJ5432"]
[Dealer "N"]
```

期望：四手各 13 张；W 家黑桃缺门；52 张无重复；导出时 W 仍写 `-`。

### 11.2 Dealer 与前缀不一致

```text
[Deal "N:AKQ2.JT9.543.876 JT98.AKQ.AKQJ.T9 76543.8765.T98.A -.432.762.KQJ5432"]
[Dealer "E"]
```

期望：`dealer=E`；第一手仍是 N；`DEALER_PREFIX_MISMATCH` 警告；不重新排列四手牌。

### 11.3 Dealer 缺失

```text
[Deal "W:..."]
```

期望：`dealer=W`；`DEALER_INFERRED_FROM_DEAL_PREFIX` 警告。

### 11.4 Auction AP

```text
[Dealer "N"]
[Auction "N"]
1NT P 2C P 2H P 3NT AP
```

期望 calls：`1NT P 2C P 2H P 3NT P P P`；不得出现第四个额外 Pass。

### 11.5 Score 方向

```text
[Score "EW 620"]
```

期望 `nsRaw=-620`；`source="director"`。

### 11.6 拒绝

| 输入 | 期望 |
| --- | --- |
| 同一张 `AS` 出现在 N 和 E | `DUPLICATE_CARD` |
| N 家只有 12 张 | `HAND_SIZE` |
| `[Deal "..."]` 只有三手 | `DEAL_HAND_COUNT` |
| `[Auction]` 出现 `8C` | `INVALID_CALL` |
| `[Score "NS -420"]` | `INVALID_SCORE` |
| `[Contract "4S"]` 无 `[Result]` | `CONTRACT_INCOMPLETE` |

### 11.7 编码

```text
[West "张三"]
```

默认 ISO 8859-1 导出：`[West "Player-3"]`（按导出顺序），JSON 保留 `"张三"`，损失报告 `action:"transformed"`。UTF-8 导出：可写 `"张三"`，损失报告说明第三方兼容性风险。

## 12. 验收

1. 四手 13 张、52 张唯一性校验通过。
2. 缺门导出 `-`，空段导入只作为兼容并规范化。
3. `[Dealer]` 与前缀冲突时以 `[Dealer]` 为准并出警告。
4. `AP` 展开为“补足结束所需 Pass”，不是固定四个。
5. `[Score]` 按方向换算 `nsRaw`，不把 `NS 420` 解析成 `+420` 以外的值。
6. 流局映射为 `PASSED_OUT` 且无 `contract`。
7. 默认 PBN 只写 ASCII 伪名；UTF-8 选项必须带损失报告。
8. 残局快照不进入 `.pbn` 对外导出。
9. 与 `record.schema.json` 的 `PLAYED` / `PASSED_OUT` 约束一致。
10. PBN 导出 → 导入 → 再导出，稳定字段逐字节一致（时间、伪名映射等显式声明除外）。
