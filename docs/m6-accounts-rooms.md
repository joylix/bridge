# M6 第一 / 第二 / 第三切片：账号、会话、牌室与开局准备

- 状态：第一切片（账号 / 会话 / 牌室 CRUD）、第二切片（加入 / 等候区 / 座位 / 举手）与第三切片（Session 创建 / 快照 / 开局前置校验）完成（2026-10-28）
- 目标：打通“注册 / 登录 / 会话 / 命名 / 建牌室 / 大厅列表 / 加入 / 落座 / 举手 / 创建 Session / 开局前置校验”闭环，为原子开局提供稳定底座
- 非目标：AI 补位、发牌、`starting → playing` 原子开局、实时对局、邮箱验证、改名、密码重置、封号 / 注销、限流与失败锁定
- 关联：SRS V0.7 2.1 / 3.1 / 3.2 / 3.3 / 3.5 / 4.1 / 4.3 / 5.1 / 5.2 / 5.5 / 6.10.1、`docs/openapi.yaml`、`docs/m5-platform-contracts.md`、`docs/adr/0004-room-nature-authorization.md`、`docs/adr/0006-transaction-boundaries.md`

## 1. 交付内容

| 类别 | 文件 | 说明 |
| --- | --- | --- |
| 命名规则 | `src/domain/account/naming.ts` | 用户名 / 昵称 / 邮箱 / 密码纯校验与归一化 |
| 密码哈希 | `src/auth/password.ts` | Node 内置 scrypt，格式 `scrypt$N$r$p$salt$key` |
| 会话令牌 | `src/auth/token.ts` | 32 字节随机令牌，数据库只存 SHA-256 摘要 |
| 账号仓储 | `src/auth/types.ts`、`src/auth/memory.ts`、`src/auth/pgRepository.ts` | 接口 + 内存实现 + PostgreSQL 实现 |
| 账号服务 | `src/auth/service.ts` | 注册、登录、登出、会话鉴权 |
| 账号投影 | `src/auth/view.ts` | 对外只返回本人可见字段 |
| 牌室 | `src/rooms/types.ts`、`src/rooms/service.ts`、`src/rooms/pgRepository.ts` | 创建、公开列表、详情、配置校验、成员 / 座位 / 举手 |
| Session | `src/sessions/types.ts`、`src/sessions/service.ts`、`src/sessions/pgRepository.ts` | 创建 / 复用、快照、开局前置校验、取消 |
| HTTP | `src/server/routes/auth.ts`、`src/server/routes/rooms.ts`、`src/server/routes/sessions.ts`、`src/server/routes/authGuard.ts` | 账号 4 端点 + 牌室 8 端点 + Session 5 端点 |
| Cookie | `src/server/cookies.ts` | 解析与序列化，不引入额外依赖 |
| 迁移 | `src/db/migrations/0001_accounts_rooms.sql` | 归一化字段、`auth_sessions`、牌室状态 / 私有 / 密码 |
| 迁移 | `src/db/migrations/0002_room_members.sql` | 成员、等候区、座位唯一索引与举手约束 |
| 迁移 | `src/db/migrations/0003_sessions_preparing.sql` | Session 玩法 / 配置快照、活动 Session 唯一索引 |
| Schema | `src/db/schema.ts` | 与迁移一一对应 |
| 接线 | `src/server/app.ts`、`src/server/index.ts`、`src/server/config.ts` | 注入服务、Zod 错误收敛、PG 仓储、`COOKIE_SECURE` |

## 2. HTTP 端点

| 方法 | 路径 | 鉴权 | 成功 | 说明 |
| --- | --- | --- | --- | --- |
| POST | `/api/v1/auth/register` | 否 | `201 { account, expiresAt }` + Cookie | 注册成功即建立 7 天会话 |
| POST | `/api/v1/auth/login` | 否 | `200 { account, expiresAt }` + Cookie | `rememberMe` 时为 30 天 |
| POST | `/api/v1/auth/logout` | 可选 | `204` + 清除 Cookie | 撤销当前令牌，幂等 |
| GET | `/api/v1/auth/me` | 是 | `200 { account }` | 只返回本人资料 |
| POST | `/api/v1/rooms` | 是 | `201 { room }` | 创建牌室，室主自动进入等候区 |
| GET | `/api/v1/rooms` | 是 | `200 { rooms }` | 只列公开牌室，可按性质过滤 |
| GET | `/api/v1/rooms/:roomId` | 是 | `200 { room }` | 详情含成员与座位；私有牌室非成员返回 404 |
| POST | `/api/v1/rooms/:roomId/join` | 是 | `200 { room }` | 加入等候区；私有房校验密码 |
| POST | `/api/v1/rooms/:roomId/leave` | 是 | `204` | 离开并释放座位 |
| POST | `/api/v1/rooms/:roomId/seat` | 是 | `200 { room }` | 落座 / 换座；室主可拖拽他人 |
| POST | `/api/v1/rooms/:roomId/stand` | 是 | `200 { room }` | 离座并清除举手 |
| POST | `/api/v1/rooms/:roomId/ready` | 是 | `200 { room }` | 举手 / 取消举手 |
| POST | `/api/v1/rooms/:roomId/sessions` | 是 | `201 { session }` | 创建 / 复用准备中的 Session；室主 / 管理员 |
| GET | `/api/v1/rooms/:roomId/sessions` | 是 | `200 { sessions }` | 牌室 Session 历史；室主 / 管理员 |
| GET | `/api/v1/sessions/:sessionId` | 是 | `200 { session }` | Session 详情；私有牌室非成员 404 |
| GET | `/api/v1/sessions/:sessionId/precheck` | 是 | `200 { report }` | 开局前置校验（座位 / 最低真人数） |
| POST | `/api/v1/sessions/:sessionId/abort` | 是 | `200 { session }` | 取消准备中的 Session；重复取消幂等 |

完整请求 / 响应 Schema、错误响应与安全方案见 `docs/openapi.yaml`。

### 2.1 错误码

| 场景 | HTTP | `code` |
| --- | --- | --- |
| 未登录 / 会话失效 | 401 | `AUTH_REQUIRED` |
| 登录失败（含用户不存在） | 401 | `INVALID_CREDENTIALS` |
| 账号被封禁 | 403 | `ACCOUNT_SUSPENDED` |
| 请求体 / 路径 / 查询参数非法 | 400 | `VALIDATION_FAILED` |
| 邮箱格式非法 | 400 | `EMAIL_INVALID` |
| 密码不合规 | 400 | `PASSWORD_INVALID` |
| 用户名格式 / 保留名 | 400 | `USERNAME_INVALID` / `USERNAME_RESERVED` |
| 昵称格式 / 保留名 | 400 | `NICKNAME_INVALID` / `NICKNAME_RESERVED` |
| 用户名 / 昵称 / 邮箱重复 | 409 | `USERNAME_TAKEN` / `NICKNAME_TAKEN` / `EMAIL_TAKEN` |
| 牌室不存在或不可见 | 404 | `NOT_FOUND` |
| 等候区已满 | 409 | `ROOM_FULL` |
| 牌室不在 `waiting` 状态 | 409 | `ROOM_NOT_WAITING` |
| 房间密码错误 | 403 | `ROOM_PASSWORD_INVALID` |
| 座位已被占用 | 409 | `SEAT_TAKEN` |
| 未落座却举手 | 409 | `NOT_SEATED` |
| 不在该牌室却执行座位操作 | 403 | `NOT_IN_ROOM` |
| 非室主 / 管理员拖拽他人或管理 Session | 403 | `FORBIDDEN` |
| Session 不在准备阶段 | 409 | `SESSION_NOT_PREPARING` |

## 3. 数据模型

### 3.1 `accounts`

在 M5 基础上新增：

- `username_normalized varchar(12)`、`nickname_normalized varchar(32)`：NFKC + 小写 + 空白折叠后的查重键；
- `nickname_change_count integer`：`CHECK BETWEEN 0 AND 3`；
- `nickname_changed_at`、`last_login_at`、`email_verified_at`；
- 唯一索引：`username_normalized`、`nickname_normalized`、`lower(email)`。

唯一约束是并发注册的唯一裁决依据；应用层不先查后写。PG 仓储捕获 `23505` 并按约束名映射为字段错误。

### 3.2 `auth_sessions`

| 字段 | 说明 |
| --- | --- |
| `token_hash varchar(64) PRIMARY KEY` | 令牌 SHA-256 摘要，不存明文 |
| `user_id` | 外键 → `accounts`，级联删除 |
| `created_at` / `expires_at` | `CHECK (expires_at > created_at)` |
| `revoked_at` | 非空即失效 |
| `last_seen_at` | 预留活跃时间 |
| `ip` / `user_agent` | 预留审计字段，当前不写入 |

### 3.3 `rooms`

在 M5 基础上新增：

- `status varchar(16)`：`waiting / playing / frozen`，默认 `waiting`；
- `is_private boolean`：私有牌室不进入大厅列表；
- `password_hash text`：房间密码使用同一 scrypt hasher，对外只暴露 `hasPassword`；
- 索引 `rooms_public_created_idx (is_private, created_at DESC)`。

`roomNature` 仍在创建时固化，本切片不提供修改入口。

### 3.4 `room_members`

| 字段 | 说明 |
| --- | --- |
| `room_id` + `user_id` | 复合主键；同一用户在同一牌室只有一条记录 |
| `nickname_snapshot` | 加入时的昵称快照（改名功能落地后需刷新） |
| `seat varchar(1)` | `N / E / S / W` 或 `NULL`（等候区） |
| `ready boolean` | 举手；`CHECK (NOT ready OR seat IS NOT NULL)` |
| `joined_at` | 加入时间，用于等候区排序 |

关键约束：

- `UNIQUE (room_id, seat) WHERE seat IS NOT NULL`：同一牌室同一座位最多一人，并发落座由该索引裁决；
- 外键 `ON DELETE CASCADE`：删除牌室或账号时清理成员；
- 等候区上限只统计 `seat IS NULL` 的成员，PG 实现在锁住牌室行后计数；
- 换座或离座都会把 `ready` 重置为 `false`，避免换搭档后保留旧举手状态。

### 3.5 `sessions`

在 M5 基础上新增 / 使用：

| 字段 | 说明 |
| --- | --- |
| `room_nature` | 创建时固化；整盘内改分、导出、排名、IMP 计入、聊天限制按此快照执行 |
| `gameplay varchar(8)` | `single / teams` 快照 |
| `room_config jsonb` | 玩法、总副数、最低真人数、AI 难度、断线策略等配置快照 |
| `session_status` | `preparing / starting / playing / paused / completed / aborted` |
| `scoring_eligibility` | 初始值：practice / casual = `ineligible`，competitive = `pending` |
| `scoring_eligibility_snapshot jsonb` | 初始值、判定值、判定时点、原因；完成时补最终判定 |
| `team_table_mapping jsonb` | 队式赛固定对位表；单桌为 null |
| `last_seq` | 已提交事件最大序号，重连 / 快照恢复预留 |

关键约束：

- `sessions_room_active_uq`：`UNIQUE (room_id) WHERE session_status IN ('preparing','starting','playing','paused')`，同一牌室同时最多一个活动 Session；`completed` / `aborted` 后可再开下一盘；
- 创建 Session 幂等：同一牌室已有活动 Session 时返回现有记录，不重复创建；
- `precheck` 只读，不改变 Session / 牌室状态；真正开局必须在后续原子事务内重新校验，避免检查与提交之间的竞态；
- 当前切片只实现 `preparing → aborted`；`starting → playing`、AI 补位、发牌与座位锁定留到后续切片。

## 4. 安全决策

1. **密码哈希**：Node 内置 `scrypt`（N=16384、r=8、p=1、64 字节密钥、16 字节盐），参数随哈希保存，便于后续升级；校验使用 `timingSafeEqual`。密码不做 NFKC 归一化。
2. **会话令牌**：32 字节随机、base64url 编码；数据库只存 SHA-256 摘要。登出撤销当前摘要，`revokeAllForUser` 为后续改密 / 封号预留。
3. **Cookie**：`HttpOnly + SameSite=Lax + Path=/`，默认 7 天、记住我 30 天；`COOKIE_SECURE=true` 或 `NODE_ENV=production` 时加 `Secure`。同时接受 `Authorization: Bearer`。
4. **登录侧信道**：用户不存在时也执行一次哈希；用户不存在与密码错误统一 `INVALID_CREDENTIALS`。
5. **私有牌室**：不出现在列表；非室主 / 非管理员 / 非成员读取统一 `NOT_FOUND`，避免存在性侧信道。加入时校验密码；无密码的私有房当前无法加入（邀请码待实现）。
6. **客户端不自报身份**：`userId` / `role` 全部来自服务端会话与数据库，HTTP 守卫只信任 `AuthService.authenticate`；座位操作的 `userId` 仅作为“目标成员”，且仅室主 / 管理员可指定他人。
7. **响应裁剪**：账号投影不含 `passwordHash`；牌室投影不含 `passwordHash`，只含 `hasPassword`。
8. **座位并发**：服务层不先查后写；唯一索引冲突映射为 `SEAT_TAKEN`。
9. **状态门禁**：加入、离开、落座、举手都要求牌室处于 `waiting`，避免对局中通过 HTTP 绕过副间锁定。
10. **Session 快照不可变**：`roomNature`、`gameplay`、`room_config` 在创建时写入，后续改分 / 导出 / 排名 / IMP 计入 / 聊天限制只认快照，不随牌室后续变化。
11. **活动 Session 唯一**：数据库部分唯一索引裁决同一牌室并发创建；服务层重复创建返回现有记录，避免双击产生两盘。
12. **前置校验只读**：`precheck` 不写库；开局事务必须重新校验座位与最低真人数，不能信任前置检查结果。

## 5. 运行

```bash
# 安装依赖
npm install

# 启动服务端（需 PostgreSQL；否则 /readyz 返回 503）
DATABASE_URL=postgres://bridge:bridge@localhost:5432/bridge npm run server:dev

# 执行迁移（0000 + 0001 + 0002 + 0003）
DATABASE_URL=postgres://bridge:bridge@localhost:5432/bridge npm run db:migrate
```

新增环境变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `COOKIE_SECURE` | `NODE_ENV === 'production'` | 是否给会话 Cookie 加 `Secure` |

### 5.1 快速验证

```bash
# 注册（保存返回的 Set-Cookie）
curl -i -X POST http://127.0.0.1:3000/api/v1/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"alice@example.com","username":"Alice_01","nickname":"小明","password":"password-1"}'

# 读取本人资料
curl http://127.0.0.1:3000/api/v1/auth/me -H 'cookie: bridge_session=<token>'

# 创建牌室
curl -X POST http://127.0.0.1:3000/api/v1/rooms \
  -H 'content-type: application/json' \
  -H 'cookie: bridge_session=<token>' \
  -d '{"name":"周五练习房","roomNature":"practice","gameplay":"single"}'

# 加入、落座、举手（使用另一个账号的 Cookie）
curl -X POST http://127.0.0.1:3000/api/v1/rooms/<roomId>/join \
  -H 'cookie: bridge_session=<other-token>'
curl -X POST http://127.0.0.1:3000/api/v1/rooms/<roomId>/seat \
  -H 'content-type: application/json' \
  -H 'cookie: bridge_session=<other-token>' \
  -d '{"position":"N"}'
curl -X POST http://127.0.0.1:3000/api/v1/rooms/<roomId>/ready \
  -H 'content-type: application/json' \
  -H 'cookie: bridge_session=<other-token>' \
  -d '{"ready":true}'

# 创建 Session、读取开局前置报告、取消
curl -X POST http://127.0.0.1:3000/api/v1/rooms/<roomId>/sessions \
  -H 'cookie: bridge_session=<token>'
curl http://127.0.0.1:3000/api/v1/sessions/<sessionId>/precheck \
  -H 'cookie: bridge_session=<token>'
curl -X POST http://127.0.0.1:3000/api/v1/sessions/<sessionId>/abort \
  -H 'cookie: bridge_session=<token>'
```

## 6. 验证

```text
npm run typecheck      通过
npm test               65 个测试文件 / 755 个用例通过
npm run check:phase0   17 项通过，0 警告，0 错误
```

M6 第一切片新增 37 个用例（5 个新测试文件 + `src/db/schema.test.ts` 新增 3 项）：

| 文件 | 用例 | 覆盖 |
| --- | --- | --- |
| `src/domain/account/naming.test.ts` | 7 | 用户名 / 昵称显示宽度、归一化、保留名、邮箱、密码 |
| `src/auth/password.test.ts` | 3 | scrypt 格式、随机盐、正确 / 错误 / 损坏哈希 |
| `src/auth/service.test.ts` | 8 | 注册、唯一冲突、登录、封禁 / 删除、会话过期与登出 |
| `src/rooms/service.test.ts` | 6 | 默认配置、私有房、字段校验、列表过滤、404 语义 |
| `src/server/routes/accounts-rooms.test.ts` | 10 | Cookie / Bearer、`/me`、登录失败、登出、房间 CRUD 与越权 |
| `src/db/schema.test.ts` | +3 | 归一化字段、会话表、牌室状态 / 私有 / 密码 DDL |

M6 第二切片新增 18 个用例：

| 文件 | 新增 | 覆盖 |
| --- | --- | --- |
| `src/rooms/service.test.ts` | +10 | 加入 / 幂等、等候区上限、私有房密码、离开释放座位、座位冲突 / 换座、室主拖拽、举手与离座、状态门禁 |
| `src/server/routes/accounts-rooms.test.ts` | +5 | 加入 / 落座 / 举手 / 离座 / 离开流程、密码错误、座位冲突与越权、未加入 / 未落座、未登录 |
| `src/db/schema.test.ts` | +3 | 成员复合主键、座位唯一与举手约束、外键级联与索引 |

M6 第三切片新增 20 个用例：

| 文件 | 新增 | 覆盖 |
| --- | --- | --- |
| `src/sessions/service.test.ts` | 13 | 创建快照、初始成绩资格、幂等与取消、权限、私有房可见性、四席 / 最低真人数、队式赛未实现、非 preparing 拒绝 |
| `src/server/routes/sessions.test.ts` | 5 | 创建 / 读取 / precheck / abort 流程、重复创建幂等、非室主与成员越权、私有房 404、未登录与非法 UUID |
| `src/db/schema.test.ts` | +2 | Session 玩法 / 配置快照、活动 Session 部分唯一索引 |

## 7. 已知限制与下一步

- 未实现注册 / 登录限流、失败锁定、邮箱验证、昵称改名与 `NameRegistry`、密码重置、封号 / 注销。
- PG 仓储尚未在真实 PostgreSQL 上跑集成测试；当前路由测试使用内存仓储。
- `buildApp` 只有传入 `auth` 才注册账号端点；传入 `rooms` / `sessions` 时必须同时传入 `auth`。
- Session 只到 `preparing`；尚未实现 AI 补位、发牌、`starting → playing` 原子开局、座位锁定与 `sessionStatus` 完整状态机。
- `precheck` 的座位 / 真人数为当前内存视图；AI 补位后需在开局事务中重新校验。
- 队式赛 Session 可创建，但 `precheck` 返回 `GAMEPLAY_UNSUPPORTED`；多桌对位表、同牌分发与跨桌 IMP 待后续。
- 座位成员只支持真人；AI 占座与“AI 即准备”留到开局切片。
- 举手没有 60s 超时离座；等候区变更尚未通过 WS 广播，客户端需轮询详情。
- 昵称使用加入时快照；改名功能落地后需刷新成员快照或改为实时解析。
- 下一切片：AI 补位、发牌、`sessionStatus` 状态机与原子开局事务（`starting → playing`）。
