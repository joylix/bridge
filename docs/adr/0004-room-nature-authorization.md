# ADR-0004：房间性质、成绩资格与授权边界

- 状态：已接受
- 日期：2026-10-28
- 决策人：产品 / 开发
- 关联：`docs/桥牌软件需求规格说明书.txt`（V0.7）3.1、3.5、5.2、5.4、7.2、8、8.9、附录 A 第 15–16 条、附录 B；`docs/adr/0006-transaction-boundaries.md`、`docs/adr/0007-projection.md`

## 背景

SRS V0.7 把过去混在一起的“房间性质、盘状态、成绩资格、桌副状态”拆成四个独立维度。拆分的目的不是增加字段，而是让授权和成绩判定各有唯一依据：

- `roomNature` 决定改分权限、导出标注、牌桌聊天限制；
- `sessionStatus` 决定生命周期与可执行命令；
- `scoringEligibility` 决定本盘是否进入正式成绩；
- `boardStatus` 决定单副是否有成绩。

如果把四者合并成一个 `status`，会出现“练习房成绩被计入排名”“取消副被当成流局”“进行中的盘被导出”等问题。本 ADR 冻结授权与资格判定，事务机制见 ADR-0006，字段投影见 ADR-0007。

## 裁决

### D1 `roomNature` 在 Session 内不可变

1. `roomNature` 只能是 `practice / casual / competitive`，创建房间时必填。
2. 开局事务把 `roomNature` 写入 `Session` 快照；此后该盘内不可修改，尝试修改返回 `ROOM_NATURE_IMMUTABLE`。
3. 改分、导出标注、牌桌聊天限制一律读取 Session 快照，不读取房间当前值；房间后续改名/改配置不影响已开始的盘。
4. 数据库同时保存 `rooms.room_nature` 与 `sessions.room_nature`，两者在开局时必须一致；不一致视为数据损坏，拒绝开局。

### D2 `scoringEligibility` 独立判定

| `roomNature` | 初始值 | 最终判定 |
| --- | --- | --- |
| `practice` | `ineligible` | 保持 `ineligible` |
| `casual` | `ineligible` | 保持 `ineligible`（可进个人记录，不进正式排名） |
| `competitive` | `pending` | `Session` 完成时判定为 `eligible / ineligible` |

`competitive` 的判定规则：

1. 整盘内至少一名真人完成过至少一次有效动作（合法叫牌或合法出牌，且发生在真人控制座位、非 AI 托管、非超时自动 Pass）→ `eligible`；
2. 否则 → `ineligible`；
3. 中途退出或转 AI 不立即改变资格，最终按整盘累计；
4. `pending → eligible/ineligible` 只发生一次；已完成的副不追溯单副状态，但成绩单与排名按最终值整体计入或排除；
5. 判定依据事件、判定时点写入 `Session.scoringEligibilitySnapshot` 与审计日志；
6. 全 AI 对局默认 `ineligible`。

### D3 改分授权

| 操作者 | `practice` | `casual` | `competitive` |
| --- | --- | --- | --- |
| 室主 | 允许（留日志） | 拒绝 `SCORE_EDIT_FORBIDDEN` | 拒绝 `SCORE_EDIT_FORBIDDEN` |
| 管理员/裁判 | 允许 | 允许 | 允许 |

1. 授权以持久化 `roomNature` 为准，不依赖前端隐藏按钮。
2. 室主改分必须填原因，记录操作人、时间、前后值；管理员改分同样留痕，敏感操作二次确认。
3. 改分落 `TableBoard.rawScore`，保留 `originalRawScore` 与 `adjustHistory`，再重算 `SessionBoard`；不得直接改 IMP/VP/MP。
4. `practice` 的队式 IMP 仅作参考，导出必须标 `practice=true`。

### D4 导出与回放授权

1. 玩家只能导出自己参与的对局；管理员导出必须填原因并写审计。
2. 未释放的副返回 `EXPORT_NOT_RELEASED`：同一 `Deal` 所有 `TableBoard` 完成、且满足 ADR-0007 的延迟条件。
3. 导出文件带 `postGame: true`、`exportedBy`、`projection`；`practice` / `scoringEligibility` 必须进入成绩单与导出标注。
4. 导出内容按 ADR-0007 投影，含四手牌的导出只对本人参与或管理员开放。

### D5 体系声明与授权解耦

`declaredSystem / effectiveSystem / explanationSource` 是披露字段，不是授权字段：

- 未声明时使用系统默认精确制；
- 声明上传但不可执行时 `effectiveSystem=precision`、`fallbackToDefault=true`，并在披露面板明示；
- 体系声明在 Session 内锁定，修改返回 `SYSTEM_DECLARATION_LOCKED`；
- 体系差异不影响改分权限或成绩资格。

### D6 执行点

授权必须在服务端执行，至少三层：

1. **数据库约束**：`roomNature`、`sessionStatus`、`scoringEligibility`、`boardStatus` 的 CHECK；唯一约束裁决并发。
2. **领域守卫**：`canAdjustBoard`、`scoringEligibility` 判定函数、状态机迁移表；返回 SRS 错误码。
3. **传输层**：HTTP/WS 在进入命令处理器前校验身份、Session/Table 归属；事件按 `audience` 投影（ADR-0007）。

前端只负责展示；即使客户端直连 WS/HTTP、改参数或重放令牌，也不能绕过上述三层。

## 后果

- `src/db/schema.ts` 与 `0000_init.sql` 分别存储四维字段，并写入 CHECK。
- `src/shared/errors.ts` 固化 `SCORE_EDIT_FORBIDDEN / ROOM_NATURE_IMMUTABLE / EXPORT_FORBIDDEN / EXPORT_NOT_RELEASED`。
- M6 账号/房间实现直接复用本 ADR；M7 开局事务必须写 `scoringEligibility` 初始值与快照。
- 新增测试：`practice` 室主可改、`casual/competitive` 拒绝、`competitive` 完成时判定、导出未释放拒绝。

## 未决

- `artificialAverage` 的具体赛制公式仍按 ADR-0008 未决项处理，本 ADR 只冻结“单独保存、标 `artificial=true`、不写进 `rawScore`”。
- 房间解散后的成绩归属与保留期按 SRS 9.6 在 M6 细化。
- 多管理员并发改分的冲突提示文案与二次确认 UI 在 M8 细化。
