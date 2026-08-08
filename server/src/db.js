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

  -- 플레이어 간 공격/지원(수성전) 미션. phase: 'outbound'(출정 중) -> 공격이면 도착 시
  -- 전투 판정 후 'returning'(귀환 중)으로, 지원이면 도착 시 'stationed'(주둔, 이후 그
  -- 타일이 공격받을 때 방어 측에 합산)로 전환. 'returning'은 return_arrive_at에 도달하면
  -- 병력이 origin에게 귀환하고 행이 삭제된다. origin_squad_index는 같은 부대가 두 개의
  -- 정복 임무를 동시에 나가지 못하게 막는 용도(기존 싱글플레이 부대 3개 슬롯 재사용).
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
`);

module.exports = { db, DB_PATH };
