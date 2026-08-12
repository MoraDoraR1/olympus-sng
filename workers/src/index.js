// server-legacy/src/index.js(Express)를 Hono + D1 + Durable Object로 이식한 진입점.
// 클라이언트와 API가 같은 Worker/오리진에서 서빙되므로 CORS 헤더가 더 필요 없다
// (server-legacy는 GitHub Pages ↔ 별도 백엔드 구조라 CORS가 필수였다).
import { Hono } from "hono";
import { validateCredentials, hashPassword, verifyPassword, issueToken, verifyToken } from "./lib/auth.js";
import { checkStatePush } from "./lib/anticheat.js";
import { checkRateLimit } from "./lib/rateLimit.js";
import * as conquest from "./lib/conquest.js";
import * as items from "./lib/items.js";
import * as pvp from "./lib/pvp.js";
import { PvpCoordinator } from "./durable-objects/PvpCoordinator.js";

export { PvpCoordinator };

const app = new Hono();

function pvpCoordinatorStub(env) {
  const id = env.PVP_COORDINATOR.idFromName("global");
  return env.PVP_COORDINATOR.get(id);
}

async function requireAuth(c, next) {
  const header = c.req.header("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const player = token ? await verifyToken(token, c.env.JWT_SECRET) : null;
  if (!player) return c.json({ error: "로그인이 필요합니다." }, 401);
  c.set("player", player);
  await next();
}

// server-legacy의 authLimiter(15분/20회, IP당)와 동일한 정책. Workers에는 req.ip가
// 없으므로 Cloudflare가 채워주는 CF-Connecting-IP 헤더를 쓴다.
async function authRateLimit(c, next) {
  const ip = c.req.header("CF-Connecting-IP") || "unknown";
  const result = await checkRateLimit(c.env.DB, `auth:${ip}`, { windowMs: 15 * 60 * 1000, max: 20 });
  if (!result.ok) return c.json({ error: "로그인/회원가입 시도가 너무 많습니다. 15분 후 다시 시도하세요." }, 429);
  await next();
}

app.get("/api/health", (c) => c.json({ ok: true, time: Date.now() }));

app.post("/api/auth/register", authRateLimit, async (c) => {
  const { nickname, password } = (await c.req.json().catch(() => ({}))) || {};
  const check = validateCredentials(nickname, password);
  if (!check.ok) return c.json({ error: check.error }, 400);
  const existing = await c.env.DB.prepare("SELECT id FROM players WHERE nickname = ?").bind(nickname).first();
  if (existing) return c.json({ error: "이미 사용 중인 닉네임입니다." }, 400);
  const now = Date.now();
  const passwordHash = await hashPassword(password);
  const info = await c.env.DB.prepare(
    "INSERT INTO players (nickname, password_hash, created_at, last_login_at) VALUES (?, ?, ?, ?)"
  )
    .bind(nickname, passwordHash, now, now)
    .run();
  const player = { id: info.meta.last_row_id, nickname };
  const token = await issueToken(player, c.env.JWT_SECRET);
  return c.json({ player, token });
});

app.post("/api/auth/login", authRateLimit, async (c) => {
  const { nickname, password } = (await c.req.json().catch(() => ({}))) || {};
  const check = validateCredentials(nickname, password);
  if (!check.ok) return c.json({ error: check.error }, 400);
  const row = await c.env.DB.prepare("SELECT * FROM players WHERE nickname = ?").bind(nickname).first();
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    return c.json({ error: "닉네임 또는 비밀번호가 올바르지 않습니다." }, 401);
  }
  await c.env.DB.prepare("UPDATE players SET last_login_at = ? WHERE id = ?").bind(Date.now(), row.id).run();
  const player = { id: row.id, nickname: row.nickname };
  const token = await issueToken(player, c.env.JWT_SECRET);
  return c.json({ player, token });
});

app.get("/api/auth/me", requireAuth, (c) => c.json({ player: c.get("player") }));

app.get("/api/state", requireAuth, async (c) => {
  const player = c.get("player");
  const row = await c.env.DB.prepare("SELECT state_json, updated_at FROM game_states WHERE player_id = ?").bind(player.id).first();
  if (!row) return c.json({ state: null, updatedAt: null });
  return c.json({ state: JSON.parse(row.state_json), updatedAt: row.updated_at });
});

app.put("/api/state", requireAuth, async (c) => {
  const player = c.get("player");
  const { state } = (await c.req.json().catch(() => ({}))) || {};
  if (!state || typeof state !== "object") return c.json({ error: "state가 필요합니다." }, 400);
  const now = Date.now();
  const prevRow = await c.env.DB.prepare("SELECT state_json, updated_at FROM game_states WHERE player_id = ?").bind(player.id).first();
  let createdAt = null;
  if (!prevRow) {
    const playerRow = await c.env.DB.prepare("SELECT created_at FROM players WHERE id = ?").bind(player.id).first();
    createdAt = playerRow && playerRow.created_at;
  }
  const verdict = checkStatePush({ prevRow, createdAt, nextState: state, now });
  if (!verdict.ok) return c.json({ error: verdict.error }, 400);
  await c.env.DB.prepare(
    `INSERT INTO game_states (player_id, state_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(player_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`
  )
    .bind(player.id, JSON.stringify(state), now)
    .run();
  return c.json({ ok: true, updatedAt: now });
});

app.get("/api/conquest/me", requireAuth, async (c) => {
  const player = c.get("player");
  const [tile, unlocked] = await Promise.all([conquest.myTile(c.env.DB, player.id), conquest.isUnlocked(c.env.DB, player.id)]);
  return c.json({ tile, unlocked, mapWidth: conquest.MAP_WIDTH, mapHeight: conquest.MAP_HEIGHT });
});

app.post("/api/conquest/spawn", requireAuth, async (c) => {
  const player = c.get("player");
  const result = await conquest.trySpawn(c.env.DB, player.id);
  if (result.error) return c.json({ error: result.error }, 400);
  return c.json({ tile: result.tile });
});

app.get("/api/conquest/tiles", requireAuth, async (c) => {
  const x0 = parseInt(c.req.query("x0"), 10);
  const y0 = parseInt(c.req.query("y0"), 10);
  const x1 = parseInt(c.req.query("x1"), 10);
  const y1 = parseInt(c.req.query("y1"), 10);
  if ([x0, y0, x1, y1].some((n) => !Number.isFinite(n))) {
    return c.json({ error: "x0,y0,x1,y1 쿼리 파라미터가 필요합니다." }, 400);
  }
  const tiles = await conquest.tilesInViewport(c.env.DB, x0, y0, x1, y1);
  return c.json({ tiles });
});

app.get("/api/conquest/travel-time", requireAuth, async (c) => {
  const player = c.get("player");
  const x = parseInt(c.req.query("x"), 10);
  const y = parseInt(c.req.query("y"), 10);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return c.json({ error: "x,y 쿼리 파라미터가 필요합니다." }, 400);
  const result = await conquest.travelTimePreview(c.env.DB, player.id, x, y);
  if (result.error) return c.json({ error: result.error }, 400);
  return c.json(result);
});

app.get("/api/items/me", requireAuth, async (c) => {
  const player = c.get("player");
  const myItemsResult = await items.myItems(c.env.DB, player.id);
  return c.json({ items: myItemsResult, costs: items.ITEM_COSTS });
});

app.post("/api/items/buy", requireAuth, async (c) => {
  const player = c.get("player");
  const { item } = (await c.req.json().catch(() => ({}))) || {};
  const result = await items.buyItem(c.env.DB, player.id, item);
  if (result.error) return c.json({ error: result.error }, 400);
  return c.json(result);
});

app.post("/api/items/use-shield", requireAuth, async (c) => {
  const player = c.get("player");
  const body = (await c.req.json().catch(() => ({}))) || {};
  const tier = Number(body.tier);
  const result = await items.useShield(c.env.DB, player.id, tier);
  if (result.error) return c.json({ error: result.error }, 400);
  return c.json(result);
});

app.post("/api/items/use-teleport", requireAuth, async (c) => {
  const player = c.get("player");
  const result = await items.useTeleport(c.env.DB, player.id);
  if (result.error) return c.json({ error: result.error }, 400);
  return c.json(result);
});

app.get("/api/conquest/missions", requireAuth, async (c) => {
  const player = c.get("player");
  const missions = await pvp.myMissions(c.env.DB, player.id);
  return c.json({ missions });
});

app.post("/api/conquest/attack", requireAuth, async (c) => {
  const player = c.get("player");
  const { targetPlayerId, squadIndex, comp } = (await c.req.json().catch(() => ({}))) || {};
  const result = await pvp.dispatch(c.env.DB, player.id, "attack", { targetPlayerId, squadIndex, comp });
  if (result.error) return c.json({ error: result.error }, 400);
  await pvpCoordinatorStub(c.env).ensureAlarmAt(result.arriveAt);
  return c.json(result);
});

app.post("/api/conquest/reinforce", requireAuth, async (c) => {
  const player = c.get("player");
  const { targetPlayerId, squadIndex, comp } = (await c.req.json().catch(() => ({}))) || {};
  const result = await pvp.dispatch(c.env.DB, player.id, "reinforce", { targetPlayerId, squadIndex, comp });
  if (result.error) return c.json({ error: result.error }, 400);
  await pvpCoordinatorStub(c.env).ensureAlarmAt(result.arriveAt);
  return c.json(result);
});

app.post("/api/conquest/recall", requireAuth, async (c) => {
  const player = c.get("player");
  const { missionId } = (await c.req.json().catch(() => ({}))) || {};
  const result = await pvp.recall(c.env.DB, player.id, missionId);
  if (result.error) return c.json({ error: result.error }, 400);
  await pvpCoordinatorStub(c.env).ensureAlarmAt(result.returnArriveAt);
  return c.json(result);
});

export default app;
