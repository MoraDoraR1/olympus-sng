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
`);

module.exports = { db, DB_PATH };
