-- M6 第二切片：牌室成员、等候区与座位
-- 与 src/db/schema.ts 保持一致。
--
-- 约束：
-- - 同一用户在同一牌室只能有一条成员记录；
-- - 同一牌室同一座位最多一名成员（部分唯一索引）；
-- - 举手仅对已落座成员有效。

CREATE TABLE room_members (
  room_id uuid NOT NULL REFERENCES rooms (room_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  nickname_snapshot varchar(32) NOT NULL,
  seat varchar(1),
  ready boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id),
  CONSTRAINT room_members_seat_chk CHECK (seat IN ('N', 'E', 'S', 'W')),
  CONSTRAINT room_members_ready_chk CHECK (NOT ready OR seat IS NOT NULL)
);

CREATE UNIQUE INDEX room_members_seat_uq
  ON room_members (room_id, seat)
  WHERE seat IS NOT NULL;

CREATE INDEX room_members_user_idx ON room_members (user_id);
CREATE INDEX room_members_room_joined_idx ON room_members (room_id, joined_at);
