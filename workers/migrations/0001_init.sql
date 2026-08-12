-- server-legacy/src/db.js의 SQLite 스키마를 D1(마찬가지로 SQLite)로 그대로 이식.
-- player_id를 players.id(정수 autoincrement) 대신 players.id 그대로 재사용한다 —
-- D1도 SQLite라 타입/제약조건이 거의 1:1로 옮겨진다.

CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS game_states (
  player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS world_tiles (
  player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  spawned_at INTEGER NOT NULL,
  protected_until INTEGER NOT NULL,
  UNIQUE(x, y)
);

CREATE TABLE IF NOT EXISTS player_items (
  player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  shield30 INTEGER NOT NULL DEFAULT 0,
  shield60 INTEGER NOT NULL DEFAULT 0,
  shield120 INTEGER NOT NULL DEFAULT 0,
  teleport INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pvp_missions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  origin_player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  origin_squad_index INTEGER NOT NULL,
  target_player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  comp_json TEXT NOT NULL,
  hero_ids_json TEXT NOT NULL,
  phase TEXT NOT NULL,
  depart_at INTEGER NOT NULL,
  arrive_at INTEGER NOT NULL,
  return_arrive_at INTEGER,
  result_json TEXT,
  created_at INTEGER NOT NULL
);

-- server-legacy는 인덱스가 없었다(SQLite 파일 하나, 소규모 가정) — D1도 같은 소규모를
-- 가정하지만, PvP 스윕이 자주 도는 쿼리(phase/arrive_at)는 인덱스를 걸어 여유를 둔다.
CREATE INDEX IF NOT EXISTS idx_pvp_missions_kind_phase_arrive
  ON pvp_missions(kind, phase, arrive_at);
CREATE INDEX IF NOT EXISTS idx_pvp_missions_phase_return
  ON pvp_missions(phase, return_arrive_at);
CREATE INDEX IF NOT EXISTS idx_pvp_missions_target
  ON pvp_missions(target_player_id, kind, phase);
CREATE INDEX IF NOT EXISTS idx_pvp_missions_origin
  ON pvp_missions(origin_player_id, origin_squad_index, phase);
