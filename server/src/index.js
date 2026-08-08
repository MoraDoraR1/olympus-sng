"use strict";
require("./env"); // 다른 모듈이 process.env를 읽기 전에 가장 먼저 .env를 반영
const http = require("node:http");
const express = require("express");
const { register, login } = require("./auth");
const { requireAuth } = require("./middleware");
const { db } = require("./db");
const ws = require("./ws");
const conquest = require("./conquest");
const items = require("./items");
const pvp = require("./pvp");
const anticheat = require("./anticheat");
const { rateLimiter } = require("./rateLimit");

const PORT = process.env.PORT || 8787;
// 클라이언트가 백엔드와 다른 origin(예: GitHub Pages)에서 서빙되는 걸 전제로 CORS 허용.
// 운영 시 특정 origin으로 좁히고 싶으면 CORS_ORIGIN 환경변수를 설정한다.
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

const app = express();
// Render/Railway/Fly 등 대부분의 호스팅은 리버스 프록시 뒤에서 앱을 띄우므로,
// 접속자의 실제 IP(레이트 리미터가 쓰는 req.ip)를 얻으려면 이 설정이 필요하다.
// 로컬 실행처럼 프록시가 없을 때는 아무 영향이 없다.
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/api/health", (req, res) => res.json({ ok: true, time: Date.now() }));

// 닉네임 무차별 대입(비밀번호를 계속 바꿔가며 자동 시도)을 늦추기 위한 최소한의
// 방어. IP당 15분에 20회로 회원가입/로그인을 합쳐 제한한다 — 정상적인 사용에는
// 절대 걸리지 않을 만큼 넉넉하다.
const authLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: "로그인/회원가입 시도가 너무 많습니다. 15분 후 다시 시도하세요.",
});

app.post("/api/auth/register", authLimiter, (req, res) => {
  const { nickname, password } = req.body || {};
  const result = register(nickname, password);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ player: result.player, token: result.token });
});

app.post("/api/auth/login", authLimiter, (req, res) => {
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
const getPlayerCreatedAt = db.prepare("SELECT created_at FROM players WHERE id = ?");

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
  const prevRow = getStateStmt.get(req.player.id);
  const createdAt = prevRow ? null : (getPlayerCreatedAt.get(req.player.id) || {}).created_at;
  const verdict = anticheat.checkStatePush({ prevRow, createdAt, nextState: state, now });
  if (!verdict.ok) return res.status(400).json({ error: verdict.error });
  upsertStateStmt.run(req.player.id, JSON.stringify(state), now);
  res.json({ ok: true, updatedAt: now });
});

app.get("/api/conquest/me", requireAuth, (req, res) => {
  res.json({
    tile: conquest.myTile(req.player.id),
    unlocked: conquest.isUnlocked(req.player.id),
    mapWidth: conquest.MAP_WIDTH,
    mapHeight: conquest.MAP_HEIGHT,
  });
});

app.post("/api/conquest/spawn", requireAuth, (req, res) => {
  const result = conquest.trySpawn(req.player.id);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ tile: result.tile });
});

app.get("/api/conquest/tiles", requireAuth, (req, res) => {
  const x0 = parseInt(req.query.x0, 10);
  const y0 = parseInt(req.query.y0, 10);
  const x1 = parseInt(req.query.x1, 10);
  const y1 = parseInt(req.query.y1, 10);
  if ([x0, y0, x1, y1].some((n) => !Number.isFinite(n))) {
    return res.status(400).json({ error: "x0,y0,x1,y1 쿼리 파라미터가 필요합니다." });
  }
  res.json({ tiles: conquest.tilesInViewport(x0, y0, x1, y1) });
});

app.get("/api/conquest/travel-time", requireAuth, (req, res) => {
  const x = parseInt(req.query.x, 10);
  const y = parseInt(req.query.y, 10);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return res.status(400).json({ error: "x,y 쿼리 파라미터가 필요합니다." });
  }
  const result = conquest.travelTimePreview(req.player.id, x, y);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

app.get("/api/items/me", requireAuth, (req, res) => {
  res.json({ items: items.myItems(req.player.id), costs: items.ITEM_COSTS });
});

app.post("/api/items/buy", requireAuth, (req, res) => {
  const { item } = req.body || {};
  const result = items.buyItem(req.player.id, item);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

app.post("/api/items/use-shield", requireAuth, (req, res) => {
  const tier = Number((req.body || {}).tier);
  const result = items.useShield(req.player.id, tier);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

app.post("/api/items/use-teleport", requireAuth, (req, res) => {
  const result = items.useTeleport(req.player.id);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

app.get("/api/conquest/missions", requireAuth, (req, res) => {
  res.json({ missions: pvp.myMissions(req.player.id) });
});

app.post("/api/conquest/attack", requireAuth, (req, res) => {
  const { targetPlayerId, squadIndex, comp } = req.body || {};
  const result = pvp.dispatch(req.player.id, "attack", { targetPlayerId, squadIndex, comp });
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

app.post("/api/conquest/reinforce", requireAuth, (req, res) => {
  const { targetPlayerId, squadIndex, comp } = req.body || {};
  const result = pvp.dispatch(req.player.id, "reinforce", { targetPlayerId, squadIndex, comp });
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

app.post("/api/conquest/recall", requireAuth, (req, res) => {
  const { missionId } = req.body || {};
  const result = pvp.recall(req.player.id, missionId);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

const server = http.createServer(app);
ws.attach(server);

// 도착/귀환 시각이 지난 정복 미션(공격 판정, 지원군 도착, 귀환 완료)을 주기적으로 처리.
// 클라이언트가 붙어있지 않아도(상대가 오프라인이어도) 정확한 시각에 처리되어야 하므로
// 요청-응답이 아니라 서버 자체 타이머로 돌린다.
setInterval(() => pvp.sweepOnce(), 5000);

server.listen(PORT, () => {
  console.log(`올림포스 도시 서버 실행 중 — http://localhost:${PORT} (WebSocket: /ws)`);
});
