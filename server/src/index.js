"use strict";
const http = require("node:http");
const express = require("express");
const { register, login } = require("./auth");
const { requireAuth } = require("./middleware");
const { db } = require("./db");
const ws = require("./ws");

const PORT = process.env.PORT || 8787;
// 클라이언트가 백엔드와 다른 origin(예: GitHub Pages)에서 서빙되는 걸 전제로 CORS 허용.
// 운영 시 특정 origin으로 좁히고 싶으면 CORS_ORIGIN 환경변수를 설정한다.
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/api/health", (req, res) => res.json({ ok: true, time: Date.now() }));

app.post("/api/auth/register", (req, res) => {
  const { nickname, password } = req.body || {};
  const result = register(nickname, password);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ player: result.player, token: result.token });
});

app.post("/api/auth/login", (req, res) => {
  const { nickname, password } = req.body || {};
  const result = login(nickname, password);
  if (result.error) return res.status(401).json({ error: result.error });
  res.json({ player: result.player, token: result.token });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ player: req.player });
});

const getStateStmt = db.prepare("SELECT state_json, updated_at FROM game_states WHERE player_id = ?");
const upsertStateStmt = db.prepare(`
  INSERT INTO game_states (player_id, state_json, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(player_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at
`);

app.get("/api/state", requireAuth, (req, res) => {
  const row = getStateStmt.get(req.player.id);
  if (!row) return res.json({ state: null, updatedAt: null });
  res.json({ state: JSON.parse(row.state_json), updatedAt: row.updated_at });
});

app.put("/api/state", requireAuth, (req, res) => {
  const { state } = req.body || {};
  if (!state || typeof state !== "object") {
    return res.status(400).json({ error: "state가 필요합니다." });
  }
  const now = Date.now();
  upsertStateStmt.run(req.player.id, JSON.stringify(state), now);
  res.json({ ok: true, updatedAt: now });
});

const server = http.createServer(app);
ws.attach(server);

server.listen(PORT, () => {
  console.log(`올림포스 도시 서버 실행 중 — http://localhost:${PORT} (WebSocket: /ws)`);
});
