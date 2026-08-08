"use strict";
// Node 내장 node:sqlite 사용 — 네이티브 컴파일(better-sqlite3 등) 없이
// 어떤 Node 22.5+ 환경에도 npm install만으로 그대로 동작하게 하기 위함.
const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const fs = require("node:fs");

const DATA_DIR = path.join(__dirname, "..", "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "olympus.db");

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
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

  -- 공격/수성전(지원군 포함) 본체는 아직 구현 전이라 아무것도 이 표에 쓰지 않는다.
  -- 미리 만들어 두는 이유: 보호막/성 이동 아이템의 "공격 중이면 사용 불가" 같은 조건이
  -- 지금부터 이 표를 정확한 쿼리로 검사하게 해서, 나중에 공격 시스템이 이 표에 실제로
  -- 행을 넣기 시작하는 순간 아이템 쪽 코드는 손댈 필요 없이 그대로 맞물리게 하기 위함.
  CREATE TABLE IF NOT EXISTS pvp_missions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    origin_player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    target_player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    comp_json TEXT NOT NULL,
    phase TEXT NOT NULL,
    depart_at INTEGER NOT NULL,
    phase_ends_at INTEGER NOT NULL,
    result_json TEXT,
    created_at INTEGER NOT NULL
  );
`);

module.exports = { db, DB_PATH };
