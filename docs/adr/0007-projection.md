# ADR-0007：HTTP/WS/回放/导出的字段级投影与延迟释放

- 状态：已接受
- 日期：2026-10-28
- 决策人：产品 / 开发
- 关联：`docs/桥牌软件需求规格说明书.txt`（V0.7）6.6、6.7、6.8、7.3、8.9、附录 A 第 13–14、27 条；`docs/adr/0004-room-nature-authorization.md`、`docs/adr/0006-transaction-boundaries.md`

## 背景

联网桥牌的核心安全边界不是“登录”，而是**信息隔离**：

- 玩家不能看到其他座位的暗手；
- 参赛玩家不能看到其他桌的定约、结果与进度；
- 旁观者/转播不能提前看到未释放的牌；
- 管理员可以看，但必须留痕；
- 客户端即使直连 WS/HTTP、改参数或重放令牌，也不能拿到未授权字段。

SRS V0.7 8.9 要求 HTTP、WS、回放、导出、错误信息与缓存使用同一套鉴权。本 ADR 冻结投影矩阵、释放条件与执行点。

## 裁决

### D1 投影是唯一出口

1. 服务端不得把完整 `TableBoardRecord`、完整 `Deal.pbn` 或内部 `engine` 快照发给无权限客户端后再“前端隐藏”。
2. 所有对外数据必须经过 `src/domain/authorization/projection.ts` 的 `projectBoardForViewer` 或等价投影函数。
3. 事件流按 `audience` 投影；`deal.created` 含完整 PBN，默认只投 `DIRECTOR`。
4. 错误响应只返回稳定错误码与安全文案，不回显牌局内容、SQL、堆栈或原始输入。

### D2 角色 × 字段矩阵

| 字段 | 参赛玩家（本桌） | 参赛玩家（他桌） | 旁观/转播（释放后） | 室主 | 管理员/裁判 |
| --- | --- | --- | --- | --- | --- |
| 本人暗手 | R | — | — | — | R（留痕） |
| 其他暗手 | — | — | — | — | R（留痕） |
| 明手 | R（翻开后） | — | R | R（本桌） | R |
| 叫牌/出牌/定约/结果 | R（本桌） | — | R | R（本桌） | R |
| 原始分/IMP | R（本桌+本方汇总） | — | R | R（本桌） | R |
| 调整原因/操作人/历史 | — | — | — | — | R |
| 体系披露 | R（对手 pair） | — | R | R | R |
| `scoringEligibility` | R（结束后） | — | R（结束后） | R | R |
| 审计日志 | — | — | — | — | R |
| 含四手牌导出 | 仅本人参与、`POSTGAME` | — | — | 本人参与 | R + 原因审计 |

实现约定：

- 玩家只拿到 `viewer.seat` 的暗手 + 已翻开明手；
- 旁观者/室主只拿到明手，不拿任何暗手；
- 管理员拿到四家暗手，但调用方必须写审计；
- `hcp` 只对管理员与本桌玩家提供；旁观者不提供；
- `adjustment / adjustHistory` 只对管理员/裁判提供；参赛者只看调整后的分数。

### D3 延迟释放

旁观/转播同时满足以下条件才可读：

1. 该副在本桌已结束；
2. 距本桌结束 ≥ `minDelayMs`（默认 30 秒，可配）；
3. 该副完成后至少又结束一副（`delayedBoards >= 1`，不可关）；
4. 以服务端权威时间计算，不使用客户端时间。

未满足返回 `EXPORT_NOT_RELEASED`。整副导出还要求同一 `Deal` 的所有 `TableBoard` 完成；否则同样拒绝。

重赛、取消、跨桌进度不一致时，释放状态必须撤回或重算；不得沿用旧的 `releasedAt`。

### D4 WS 订阅

1. 连接必须通过 `authenticate`；未通过直接拒绝升级。
2. 订阅必须带 `sessionId`、可选 `tableId`、`audiences`、可选 `lastSeq`。
3. 服务端校验：
   - Session/Table 是否属于该连接；
   - `audiences` 是否允许（`canSubscribe`）；
   - 断线重连重新校验，撤权立即生效。
4. 推送时按 `sessionId + tableId + audience` 过滤；参赛玩家连接不接收其他 `tableId` 的事件。
5. `lastSeq` 用于断点续传；服务端只补发未 `supersededBy` 的事件。

### D5 回放与导出

1. 回放接口按请求者角色投影；未释放返回 `EXPORT_NOT_RELEASED`。
2. 导出只允许本人参与或管理员；管理员导出必须填原因并写审计。
3. 导出文件带：
   ```text
   schemaVersion / producerVersion / exportedAt / exportedBy / projection / postGame
   ```
4. `practice` 与 `scoringEligibility` 必须进入成绩单与导出标注。
5. 回放器兼容旧事件版本；损坏快照回退到最近一致快照 + 重放；重算不一致告警，不静默覆盖。

### D6 缓存与错误

1. 服务端缓存与 CDN 缓存按 `audience` 分键；禁止跨角色共享缓存；撤权时失效。
2. 错误信息不得泄露“他桌是否存在”“未释放副的结果”等侧信道；跨桌访问统一返回 `EXPORT_FORBIDDEN`。
3. 日志可以记录 `requestId / userId / eventId`，但不得记录完整暗手或密码。

### D7 执行点

| 层 | 职责 |
| --- | --- |
| 传输层 `src/server/ws.ts` | 鉴权、Session/Table 归属、订阅校验、受众过滤 |
| 领域层 `src/domain/authorization/projection.ts` | 角色 × 字段矩阵、明手/暗手、审计字段 |
| 导出层 | `assertExportReleased`、`postGame/exportedBy/projection` 标注 |
| HTTP 端点 | 每个端点返回投影后的字段子集，不返回完整记录 |
| 缓存 | 按 `audience` 分键，撤权失效 |

## 后果

- 新增 `src/domain/authorization/projection.ts` 与测试，覆盖暗手、明手、跨桌、未释放、管理员审计。
- `src/server/ws.ts` 只推送匹配订阅的事件；`deal.created` 默认 `DIRECTOR`。
- M7 的 E2E 必须包含“参赛玩家直连 WS 尝试订阅他桌/暗手”的负向用例。
- M9 渗透测试把本 ADR 的矩阵作为验收清单。

## 未决

- 转播“延迟一副”的具体计数口径（按 Deal 还是按桌）在 M8 队式赛实现时冻结。
- 旁观者切换观战桌时的订阅撤销与缓存失效策略在 M7 细化。
- 事件字段级投影（同一事件对不同受众裁剪 payload）在 M7 与 `audience` 一起实现；当前先保证整条事件按受众过滤。
