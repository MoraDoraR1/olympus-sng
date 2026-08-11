"use strict";
// server-legacy/src/conquest.js 포팅. SQLite의 world_tiles(player_id 기본키, UNIQUE(x,y))
// 대신 Firestore worldTiles/{x}_{y} 문서를 좌표 자체를 ID로 써서, "존재하면 실패"만으로
// 원자적 타일 선점을 트랜잭션으로 구현한다(기존의 UNIQUE 제약 + 예외 캐치 재시도와 동등한 효과).
const { db } = require("./admin");
const { chebyshevDistance, travelTimeSeconds } = require("./movement");
const { HERO_BY_ID } = require("./heroes");
const { TROOP_BY_KEY } = require("./troops");

const MAP_WIDTH = 200;
const MAP_HEIGHT = 200;
const UNLOCK_CASTLE_LEVEL = 5;
const PROTECTION_MS = 30 * 60 * 1000;
const MAX_VIEWPORT_TILES = 60;

function tileDocId(x, y) {
  return `${x}_${y}`;
}

async function getPlayer(playerId) {
  const snap = await db.collection("players").doc(playerId).get();
  return snap.exists ? snap.data() : null;
}

async function castleLevelOf(playerId) {
  const player = await getPlayer(playerId);
  if (!player || !player.state) return 0;
  return (player.state.tiles && player.state.tiles.castle && player.state.tiles.castle.level) || 0;
}

async function isUnlocked(playerId) {
  return (await castleLevelOf(playerId)) >= UNLOCK_CASTLE_LEVEL;
}

async function myTile(playerId) {
  const q = await db.collection("worldTiles").where("playerId", "==", playerId).limit(1).get();
  if (q.empty) return null;
  const d = q.docs[0].data();
  return { x: d.x, y: d.y, spawnedAt: d.spawnedAt, protectedUntil: d.protectedUntil };
}

// x,y를 무작위로 뽑아 tryOnce(x,y)에 넘긴다 — tryOnce가 null을 반환하면(충돌) 최대 200회
// 재시도한다. 스폰과 성 이동(텔레포트) 둘 다 이 루프를 공유한다.
async function withRandomFreeTile(tryOnce) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const x = Math.floor(Math.random() * MAP_WIDTH);
    const y = Math.floor(Math.random() * MAP_HEIGHT);
    const result = await tryOnce(x, y);
    if (result !== null) return result;
  }
  return null;
}

async function trySpawn(playerId) {
  const existing = await myTile(playerId);
  if (existing) return { tile: existing };
  if (!(await isUnlocked(playerId))) {
    return { error: `성 레벨 ${UNLOCK_CASTLE_LEVEL} 이상부터 정복 맵에 참가할 수 있습니다.` };
  }
  // players/{uid}는 본인만 읽을 수 있게 막혀 있어(firestore.rules) 클라이언트가 지도를
  // 조회할 때 다른 사람의 닉네임을 알 방법이 없다 — 그래서 스폰 시점에 nickname을
  // worldTiles 문서에 그대로 복사해 둔다(이 게임엔 닉네임 변경 기능이 없어 갱신 걱정 없음).
  const player = await getPlayer(playerId);
  const nickname = (player && player.nickname) || "?";
  const now = Date.now();
  const result = await withRandomFreeTile((x, y) =>
    db.runTransaction(async (tx) => {
      const ref = db.collection("worldTiles").doc(tileDocId(x, y));
      const snap = await tx.get(ref);
      if (snap.exists) return null; // 이미 다른 플레이어가 선점 — 다른 좌표로 재시도
      const data = { x, y, playerId, nickname, spawnedAt: now, protectedUntil: now + PROTECTION_MS };
      tx.set(ref, data);
      return { x, y, spawnedAt: now, protectedUntil: now + PROTECTION_MS };
    })
  );
  if (!result) return { error: "빈 타일을 찾지 못했습니다. 잠시 후 다시 시도하세요." };
  return { tile: result };
}

// 성 이동 아이템: 기존 좌표 문서를 지우고 새 무작위 빈 칸 문서를 만든다(스폰/보호 시각은 유지).
async function relocateToRandomTile(playerId) {
  const existing = await myTile(playerId);
  if (!existing) return { error: "아직 정복 맵에 참가하지 않았습니다." };
  const oldRef = db.collection("worldTiles").doc(tileDocId(existing.x, existing.y));
  const result = await withRandomFreeTile((x, y) => {
    if (x === existing.x && y === existing.y) return null;
    const newRef = db.collection("worldTiles").doc(tileDocId(x, y));
    return db.runTransaction(async (tx) => {
      const [oldSnap, newSnap] = await Promise.all([tx.get(oldRef), tx.get(newRef)]);
      if (newSnap.exists || !oldSnap.exists) return null;
      const oldData = oldSnap.data();
      tx.delete(oldRef);
      tx.set(newRef, { ...oldData, x, y });
      return { x, y };
    });
  });
  if (!result) return { error: "빈 타일을 찾지 못했습니다. 잠시 후 다시 시도하세요." };
  return { tile: { ...existing, x: result.x, y: result.y } };
}

async function travelTimePreview(playerId, targetX, targetY) {
  const origin = await myTile(playerId);
  if (!origin) return { error: "아직 정복 맵에 참가하지 않았습니다." };
  const distance = chebyshevDistance(origin, { x: targetX, y: targetY });
  const baseSeconds = travelTimeSeconds(distance, TROOP_BY_KEY.militia.speed);
  let bestHeroBonus = 0;
  const player = await getPlayer(playerId);
  const owned = (player && player.state && player.state.owned) || {};
  Object.keys(owned).forEach((idStr) => {
    const hero = HERO_BY_ID[Number(idStr)];
    if (!hero) return;
    const enhance = (owned[idStr] || {}).enhance || 0;
    const heroBonus = hero.traits
      .filter((t) => t.type === "movement")
      .reduce((sum, t) => sum + t.percent * (1 + 0.15 * enhance), 0);
    if (heroBonus > bestHeroBonus) bestHeroBonus = heroBonus;
  });
  const bestSeconds = travelTimeSeconds(distance, TROOP_BY_KEY.militia.speed * (1 + bestHeroBonus / 100));
  return { distance, baseSeconds, bestSeconds, bestHeroBonus };
}

async function tilesInViewport(x0, y0, x1, y1) {
  let loX = Math.max(0, Math.min(x0, x1));
  let hiX = Math.min(MAP_WIDTH - 1, Math.max(x0, x1));
  let loY = Math.max(0, Math.min(y0, y1));
  let hiY = Math.min(MAP_HEIGHT - 1, Math.max(y0, y1));
  if (hiX - loX > MAX_VIEWPORT_TILES) hiX = loX + MAX_VIEWPORT_TILES;
  if (hiY - loY > MAX_VIEWPORT_TILES) hiY = loY + MAX_VIEWPORT_TILES;
  const snap = await db
    .collection("worldTiles")
    .where("x", ">=", loX)
    .where("x", "<=", hiX)
    .where("y", ">=", loY)
    .where("y", "<=", hiY)
    .get();
  // nickname은 스폰 시점에 타일 문서 자체에 복사해 뒀으므로(players 컬렉션은 본인만
  // 읽을 수 있어 별도 조회가 불가능) 추가 조회 없이 바로 쓸 수 있다.
  return snap.docs.map((d) => {
    const t = d.data();
    return { x: t.x, y: t.y, playerId: t.playerId, nickname: t.nickname || "?", protectedUntil: t.protectedUntil };
  });
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
