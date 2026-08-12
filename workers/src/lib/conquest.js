// server-legacy/src/conquest.js를 D1로 이식. D1도 SQLite라 UNIQUE(x,y) 제약을 이용한
// "INSERT 실패하면 다른 좌표로 재시도" 원자적 선점 로직을 거의 그대로 옮길 수 있다
// (Firestore 이식 때 문서ID 트릭이 필요했던 것과 달리, 여기서는 원본과 동일한 방식).
import { chebyshevDistance, travelTimeSeconds } from "./movement.js";
import { HERO_BY_ID } from "./heroes.js";
import { TROOP_BY_KEY } from "./troops.js";

export const MAP_WIDTH = 200;
export const MAP_HEIGHT = 200;
export const UNLOCK_CASTLE_LEVEL = 5;
export const PROTECTION_MS = 30 * 60 * 1000;
const MAX_VIEWPORT_TILES = 60;

function isUniqueViolation(e) {
  return /UNIQUE constraint failed/i.test(String((e && e.message) || e));
}

async function castleLevelOf(db, playerId) {
  const row = await db.prepare("SELECT state_json FROM game_states WHERE player_id = ?").bind(playerId).first();
  if (!row) return 0;
  try {
    const parsed = JSON.parse(row.state_json);
    return (parsed.tiles && parsed.tiles.castle && parsed.tiles.castle.level) || 0;
  } catch {
    return 0;
  }
}

export async function isUnlocked(db, playerId) {
  return (await castleLevelOf(db, playerId)) >= UNLOCK_CASTLE_LEVEL;
}

export async function myTile(db, playerId) {
  const row = await db.prepare("SELECT * FROM world_tiles WHERE player_id = ?").bind(playerId).first();
  if (!row) return null;
  return { x: row.x, y: row.y, spawnedAt: row.spawned_at, protectedUntil: row.protected_until };
}

async function withRandomFreeTile(tryOnce) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const x = Math.floor(Math.random() * MAP_WIDTH);
    const y = Math.floor(Math.random() * MAP_HEIGHT);
    try {
      const result = await tryOnce(x, y);
      if (result) return result;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  return null;
}

export async function trySpawn(db, playerId) {
  const existing = await myTile(db, playerId);
  if (existing) return { tile: existing };
  if (!(await isUnlocked(db, playerId))) {
    return { error: `성 레벨 ${UNLOCK_CASTLE_LEVEL} 이상부터 정복 맵에 참가할 수 있습니다.` };
  }
  const now = Date.now();
  const result = await withRandomFreeTile(async (x, y) => {
    await db
      .prepare("INSERT INTO world_tiles (player_id, x, y, spawned_at, protected_until) VALUES (?, ?, ?, ?, ?)")
      .bind(playerId, x, y, now, now + PROTECTION_MS)
      .run();
    return { x, y, spawnedAt: now, protectedUntil: now + PROTECTION_MS };
  });
  if (!result) return { error: "빈 타일을 찾지 못했습니다. 잠시 후 다시 시도하세요." };
  return { tile: result };
}

// 성 이동 아이템: world_tiles는 player_id가 기본키라(원본과 동일) x,y만 갈아치우면 된다.
export async function relocateToRandomTile(db, playerId) {
  const existing = await myTile(db, playerId);
  if (!existing) return { error: "아직 정복 맵에 참가하지 않았습니다." };
  const result = await withRandomFreeTile(async (x, y) => {
    await db.prepare("UPDATE world_tiles SET x = ?, y = ? WHERE player_id = ?").bind(x, y, playerId).run();
    return { x, y };
  });
  if (!result) return { error: "빈 타일을 찾지 못했습니다. 잠시 후 다시 시도하세요." };
  return { tile: { ...existing, x: result.x, y: result.y } };
}

export async function travelTimePreview(db, playerId, targetX, targetY) {
  const origin = await myTile(db, playerId);
  if (!origin) return { error: "아직 정복 맵에 참가하지 않았습니다." };
  const distance = chebyshevDistance(origin, { x: targetX, y: targetY });
  const baseSeconds = travelTimeSeconds(distance, TROOP_BY_KEY.militia.speed);
  let bestHeroBonus = 0;
  const row = await db.prepare("SELECT state_json FROM game_states WHERE player_id = ?").bind(playerId).first();
  if (row) {
    try {
      const parsed = JSON.parse(row.state_json);
      Object.keys(parsed.owned || {}).forEach((idStr) => {
        const hero = HERO_BY_ID[Number(idStr)];
        if (!hero) return;
        const enhance = (parsed.owned[idStr] || {}).enhance || 0;
        const heroBonus = hero.traits
          .filter((t) => t.type === "movement")
          .reduce((sum, t) => sum + t.percent * (1 + 0.15 * enhance), 0);
        if (heroBonus > bestHeroBonus) bestHeroBonus = heroBonus;
      });
    } catch {}
  }
  const bestSeconds = travelTimeSeconds(distance, TROOP_BY_KEY.militia.speed * (1 + bestHeroBonus / 100));
  return { distance, baseSeconds, bestSeconds, bestHeroBonus };
}

// 미니맵용 — 뷰포트 범위 제한 없이 지도 전체에서 성이 있는 좌표만 가볍게 가져온다.
// 닉네임은 필요 없으므로(점 하나로만 표시) 조인하지 않는다 — 등록 플레이어 수가
// 많지 않은 게임 규모상 전체 스캔도 가볍다.
export async function allOccupiedTiles(db) {
  const { results } = await db.prepare("SELECT x, y, player_id FROM world_tiles").all();
  return results.map((r) => ({ x: r.x, y: r.y, playerId: r.player_id }));
}

export async function tilesInViewport(db, x0, y0, x1, y1) {
  let loX = Math.max(0, Math.min(x0, x1));
  let hiX = Math.min(MAP_WIDTH - 1, Math.max(x0, x1));
  let loY = Math.max(0, Math.min(y0, y1));
  let hiY = Math.min(MAP_HEIGHT - 1, Math.max(y0, y1));
  if (hiX - loX > MAX_VIEWPORT_TILES) hiX = loX + MAX_VIEWPORT_TILES;
  if (hiY - loY > MAX_VIEWPORT_TILES) hiY = loY + MAX_VIEWPORT_TILES;
  // D1은 진짜 SQL이라 JOIN으로 닉네임을 바로 붙일 수 있다(Firestore 이식 때는 보안 규칙
  // 때문에 스폰 시점에 닉네임을 타일 문서에 복사해 두는 우회가 필요했다 — 여기선 불필요).
  const { results } = await db
    .prepare(
      `SELECT wt.x, wt.y, wt.player_id, wt.protected_until, p.nickname
       FROM world_tiles wt JOIN players p ON p.id = wt.player_id
       WHERE wt.x BETWEEN ? AND ? AND wt.y BETWEEN ? AND ?`
    )
    .bind(loX, hiX, loY, hiY)
    .all();
  return results.map((r) => ({ x: r.x, y: r.y, playerId: r.player_id, nickname: r.nickname, protectedUntil: r.protected_until }));
}
