"use strict";
const { db } = require("./db");
const { chebyshevDistance, travelTimeSeconds } = require("./movement");
const { HERO_BY_ID } = require("./heroes");
const { TROOP_BY_KEY } = require("./troops");

const MAP_WIDTH = 200;
const MAP_HEIGHT = 200;
const UNLOCK_CASTLE_LEVEL = 5;
const PROTECTION_MS = 30 * 60 * 1000;
const MAX_VIEWPORT_TILES = 60; // 한 번 요청으로 가져올 수 있는 타일 범위 상한(가로/세로 각각)

const getTileByPlayer = db.prepare("SELECT * FROM world_tiles WHERE player_id = ?");
const insertTile = db.prepare(
  "INSERT INTO world_tiles (player_id, x, y, spawned_at, protected_until) VALUES (?, ?, ?, ?, ?)"
);
const updateTileXY = db.prepare("UPDATE world_tiles SET x = ?, y = ? WHERE player_id = ?");
const getStateJson = db.prepare("SELECT state_json FROM game_states WHERE player_id = ?");
const tilesInBox = db.prepare(`
  SELECT wt.x, wt.y, wt.player_id, wt.protected_until, p.nickname
  FROM world_tiles wt JOIN players p ON p.id = wt.player_id
  WHERE wt.x BETWEEN ? AND ? AND wt.y BETWEEN ? AND ?
`);

function castleLevelOf(playerId) {
  const row = getStateJson.get(playerId);
  if (!row) return 0;
  try {
    const parsed = JSON.parse(row.state_json);
    return (parsed.tiles && parsed.tiles.castle && parsed.tiles.castle.level) || 0;
  } catch {
    return 0;
  }
}

function isUnlocked(playerId) {
  return castleLevelOf(playerId) >= UNLOCK_CASTLE_LEVEL;
}

function myTile(playerId) {
  const row = getTileByPlayer.get(playerId);
  if (!row) return null;
  return { x: row.x, y: row.y, spawnedAt: row.spawned_at, protectedUntil: row.protected_until };
}

// UNIQUE(x,y) 제약을 이용해 INSERT/UPDATE 자체로 원자적 선점을 하고, 충돌(이미 다른
// 플레이어가 그 칸을 막 차지함)이면 다른 좌표로 재시도한다. 스폰과 성 이동(텔레포트)
// 둘 다 "빈 칸을 무작위로 찾는다"는 같은 문제라 이 루프를 공유한다.
function withRandomFreeTile(tryOnce) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const x = Math.floor(Math.random() * MAP_WIDTH);
    const y = Math.floor(Math.random() * MAP_HEIGHT);
    try {
      return tryOnce(x, y);
    } catch (e) {
      if (!String(e.message).includes("UNIQUE constraint failed")) throw e;
    }
  }
  return null;
}

// 이미 배정된 타일이 있으면 그대로 반환(멱등) — 없고 해금 조건을 만족하면 비어있는
// 칸을 무작위로 찾아 배정한다.
function trySpawn(playerId) {
  const existing = myTile(playerId);
  if (existing) return { tile: existing };
  if (!isUnlocked(playerId)) {
    return { error: `성 레벨 ${UNLOCK_CASTLE_LEVEL} 이상부터 정복 맵에 참가할 수 있습니다.` };
  }
  const now = Date.now();
  const result = withRandomFreeTile((x, y) => {
    insertTile.run(playerId, x, y, now, now + PROTECTION_MS);
    return { x, y, spawnedAt: now, protectedUntil: now + PROTECTION_MS };
  });
  if (!result) return { error: "빈 타일을 찾지 못했습니다. 잠시 후 다시 시도하세요." };
  return { tile: result };
}

// 성 이동 아이템: 이미 스폰된 플레이어를 새 무작위 빈 칸으로 옮긴다(보호/스폰 시각은 유지).
function relocateToRandomTile(playerId) {
  const existing = myTile(playerId);
  if (!existing) return { error: "아직 정복 맵에 참가하지 않았습니다." };
  const result = withRandomFreeTile((x, y) => {
    updateTileXY.run(x, y, playerId);
    return { x, y };
  });
  if (!result) return { error: "빈 타일을 찾지 못했습니다. 잠시 후 다시 시도하세요." };
  return { tile: { ...existing, x: result.x, y: result.y } };
}

// 이동속도 미리보기: 내 타일 → 목표 좌표까지, 최하급 병종 기준과(모두가 가진) 그 계정이
// 보유한 영웅 중 이동속도 특성 보너스가 가장 큰 값을 적용했을 때 각각 몇 초가 걸리는지.
function travelTimePreview(playerId, targetX, targetY) {
  const origin = myTile(playerId);
  if (!origin) return { error: "아직 정복 맵에 참가하지 않았습니다." };
  const distance = chebyshevDistance(origin, { x: targetX, y: targetY });
  const baseSeconds = travelTimeSeconds(distance, TROOP_BY_KEY.militia.speed);
  let bestHeroBonus = 0;
  const row = getStateJson.get(playerId);
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

function tilesInViewport(x0, y0, x1, y1) {
  let lo_x = Math.max(0, Math.min(x0, x1));
  let hi_x = Math.min(MAP_WIDTH - 1, Math.max(x0, x1));
  let lo_y = Math.max(0, Math.min(y0, y1));
  let hi_y = Math.min(MAP_HEIGHT - 1, Math.max(y0, y1));
  if (hi_x - lo_x > MAX_VIEWPORT_TILES) hi_x = lo_x + MAX_VIEWPORT_TILES;
  if (hi_y - lo_y > MAX_VIEWPORT_TILES) hi_y = lo_y + MAX_VIEWPORT_TILES;
  return tilesInBox.all(lo_x, hi_x, lo_y, hi_y).map((r) => ({
    x: r.x,
    y: r.y,
    playerId: r.player_id,
    nickname: r.nickname,
    protectedUntil: r.protected_until,
  }));
}

module.exports = {
  MAP_WIDTH,
  MAP_HEIGHT,
  UNLOCK_CASTLE_LEVEL,
  isUnlocked,
  myTile,
  trySpawn,
  tilesInViewport,
  relocateToRandomTile,
  travelTimePreview,
};
