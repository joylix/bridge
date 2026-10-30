-- M6 第三切片：Session 创建与开局前置快照
-- 与 src/db/schema.ts 保持一致。
--
-- 说明：
-- - Session 创建时固化 `roomNature` 与 `room_config`，后续开局按快照执行；
-- - `scoringEligibility` 初始值：practice / casual = ineligible，competitive = pending；
-- - 同一牌室同时最多一个活动 Session；completed / aborted 后可再开下一盘。

ALTER TABLE sessions ADD COLUMN gameplay varchar(8) NOT NULL DEFAULT 'single';
ALTER TABLE sessions ADD COLUMN room_config jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE sessions
  ADD CONSTRAINT sessions_gameplay_chk CHECK (gameplay IN ('single', 'teams'));

CREATE UNIQUE INDEX sessions_room_active_uq
  ON sessions (room_id)
  WHERE session_status IN ('preparing', 'starting', 'playing', 'paused');
