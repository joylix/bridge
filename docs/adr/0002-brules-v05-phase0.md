# ADR-0002：BRULES v0.5 Phase 0 决策

- 状态：已接受
- 日期：2026-10-27
- 关联：`docs/桥牌规则与数据交换规范（提案 v2）.md`、`docs/BRULES v0.4 评审与采用建议.md`
- 范围：只冻结规范与 Schema，不改变现有运行时、规则 YAML 和引擎契约。

## 背景

提案 v2 的 D1–D10 已获批准。评审结论是：方向可以执行，但文本还缺可执行文法、IR 与运行时边界、完整条件词表、复现快照和若干 PBN 细节。Phase 0 的目标是把这些缺口补成可开工的规范，而不是立即改代码。

## 决策

### D-01 表面语法与语义权威

- v0.5 的规范表面语法是行式 DSL，文法见 `docs/brules-v0.5/grammar.ebnf`。
- YAML 是第二种表面语法，必须能 1:1 映射到同一 IR；不得引入 YAML 独有的语义。
- 语义权威是 IR（JSON），见 `docs/brules-v0.5/rules-ir.schema.json`。
- 现有无文件头的 YAML 继续由 `legacy-yaml` 解析器读取，不强制迁移。

### D-02 IR 与运行时 `BiddingRule`

- IR 是现有 `BiddingRule` 的超集，不是运行时对象的简单别名。
- IR 规则显式携带 `specificity`。该值表示**源条件项数量**，在 `ALL`、`BAL_NO_5M` 等展开前计算；编译器不得因展开增加具体度，否则会改变“优先级 → 具体度 → 声明顺序”的裁决结果。
- v0.5 只承诺编译到现有扁平 AND 引擎；`ANY` 展开为多条规则，嵌套布尔仍为 `UNSUPPORTED_FEATURE`。

### D-03 条件词表

- 当前 `ConditionSpec` 的 46 个键全部登记在 `docs/brules-v0.5/conditions.md`，每个键必须有输入、定义、边界、未知时取值和测试向量。
- 新增 IR 词 `shapeClass`，取值 `BAL_ANY`、`BAL_NO_5M`、`SEMIBAL`、`UNBAL`。
- `BAL_ANY` = 4333 / 4432 / 5332（含 5 张高花），等同现有 `balanced`。
- `BAL_NO_5M` = 4333 / 4432 / 5332（5 张为低花），等同 v0.4 `BAL`。
- `SEMIBAL` = 4432 / 5332（5 张为低花）/ 5422 / 6322，无单张、无缺门、非 4333。
- `UNBAL` = 不属于 `BAL_NO_5M` 且不属于 `SEMIBAL` 的牌型。
- 编译映射：`BAL_ANY -> balanced: true`；`BAL_NO_5M -> balanced: true + fiveCardMajor: false`；`SEMIBAL`/`UNBAL` 在 v0.5 运行时返回 `UNSUPPORTED_CONDITION`。

### D-04 标签与强制新花

- 保留 `natural`、`forcing` 两个语义标签。
- 迁移时，现有 `nat_` 前缀规则同时写入 `tags: ["natural", "forcing"]`，并产生 `LEGACY_ID_PREFIX_SEMANTICS` 警告。
- `partnerForcingNewSuit` / `myForcingNewSuit` 的定义改为：该座位最后一次自然花色叫牌的规则同时带有 `natural` 与 `forcing`。不再依赖规则 id 前缀。
- `ANY` 展开产生的 `#1`、`#2` 后缀不得参与任何语义判断。

### D-05 词法、Pass 与通配符

- 规范叫品令牌为 `PASS`、`X`、`XX`、`1C`…`7NT`；DSL 文本中 Pass 写 `-`，导入器接受 `PASS` / `Pass` / `pass` / `-`。
- 单字母 `P` 在叫品位置不是 Pass 别名；它在序列中只表示同伴（Partner）。
- `X` / `XX` 只在叫品位置有效；牌点位置出现 `X` / `x` 必须拒绝。
- v0.5 退役小写 `x` 和 `*` 通配符；v0.4 文件必须由 v0.4 解析器读取。
- v0.4 的 `x` 是集合内代表 2–9 的牌点，不是“任意一张或多张小牌”的模糊通配；其重数必须按原文解释。无法无损映射到 v0.5 条件词表的，返回 `UNSUPPORTED_FEATURE`，不得猜测。

### D-06 相对座位、allpass 与版本

- 相对座位采用标准术语：`ME → LHO → PAR → RHO → ME`；`LHO` 是 ME 之后行动的对手，`RHO` 是紧邻 ME 之前行动的对手。
- v0.4 的 `LHO` / `RHO` 定义与标准相反，迁移工具不得全局互换；涉及这两个 token 的规则必须逐条按叫牌顺序重新推断，并输出需人工确认的报告。
- `AP` 表示“补足叫牌结束所需的剩余 Pass”，不是追加四个 Pass；叫牌结束后不得再导出 Pass。
- v0.4 `ALL(U)` 退役；v0.5 只接受带谓词的 `ALL(set, predicate)` 和 `ANY(set, predicate)`。
- 版本号文法允许多位数字；0.4 与 0.5 不兼容，必须使用版本专用解析器。

### D-07 PBN

- 导出以 `[Dealer]` 为准，`[Deal]` 的第一手必须是发牌人；导入时若 `[Dealer]` 缺失才用 Deal 前缀推断，并给 `DEALER_INFERRED_FROM_DEAL_PREFIX` 警告。
- `[Deal]` 的缺门规范写法是 `-`；解析器为兼容旧数据可接受空段，但导出器只写 `-`。
- `[Score "NS 420"]` 是“方向 + 数值”，不是带符号整数；映射到 `nsRaw` 时按方向换算。
- 初始发牌必须是四手、每手 13 张、52 张互不重复；DDS 残局快照不得作为 `.pbn` 对外导出。
- PBN 2.1 默认使用 ISO 8859-1 可表示的球员伪名（如 `Player-1`）；完整昵称只放在 JSON。UTF-8 PBN 是可选扩展，必须输出损失报告。

### D-08 复现快照

- 每副牌在 `beginAuction` 时冻结生效规则集、首攻/信号规则、座位配置、推断开关和 DDS 配置；牌局进行中修改规则不得影响当前副。
- 随机源拆为 `deal`、`bidding`、`play`、`dds` 四条流；记录 `baseSeed`、`index`、各流种子或可重放的初始种子。
- `rulesetId = "sha256:" + SHA-256(JCS(语义投影 IR))`。语义投影包含 `system`、`systemVersion`、`defaults`、`styleParams`、规则的 `id/sequence/when/action/priority/tags/enabled` 和规则顺序；不包含 `description`、`examples`、`source`、`author`、`locale`。
- `overlay` 只表示是否含本地/服务端覆盖；`rulesetId` 必须是覆盖合并后的生效规则集标识。
- 回放以记录的实际出牌为准；DDS 重算不作为一致性承诺。

### D-09 SRS 实体模型

- 向 SRS 提出 `Deal → TableBoard → SessionBoard` 三层拆分，详见 `docs/brules-v0.5/srs-board-model.md`。
- 在 SRS 正式修订前，提案中的三层模型是**建议**，不是既成事实；当前 SRS 正文仍有 `Board → Table`。
- Profile P 不进入当前仓库开发排期；当前仓库只实现 Profile S 所需部分。

### D-10 范围控制

- 本阶段不实现解析器、编译器、事件流、账号/服务端、Profile P。
- 不修改 `src/engine/*`、`src/core/*`、现有 YAML 或测试基线。
- 事件流导出与 PBN/JSON Schema 解耦；事件流作为 Profile S 的后续子阶段，不阻塞牌局导出。

## 影响

- Phase 1 可以直接以本目录的文法和 Schema 开工。
- 现有 37 个测试文件 / 447 个用例不受影响。
- 原有提案中的 `contract`“已成约”歧义、附录 A 计数错误、SRS 对齐表述等问题，以本目录为准；原提案保留作背景材料。
- 未决事项（MP/VP、体系默认值、转播延迟、UTF-8 PBN、`SEMIBAL`/`UNBAL` 运行时支持、事件流存储）继续记录在 `docs/brules-v0.5/README.md`，不阻塞 Phase 1。
