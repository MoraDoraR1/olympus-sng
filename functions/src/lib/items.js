"use strict";
// server-legacy/src/items.js 포팅. 한 가지는 의도적으로 원본과 다르다: 원본의
// incomingAttackCheck/outboundMissionCheck가 pvp.js의 실제 phase 값('outbound'/
// 'stationed'/'returning')이 아니라 쓰인 적 없는 값('march'/'battle'/'return')을
// 검사하고 있어서 사실상 항상 통과되는 죽은 코드였다(기존 버그). 여기서는 실제
// phase 값으로 바로잡아서 이식한다.
const { db } = require("./admin");
const conquest = require("./conquest");

const ITEM_COSTS = { shield30: 5000, shield60: 9000, shield120: 16000, teleport: 8000 };
const SHIELD_TIER_MS = { 30: 30 * 60 * 1000, 60: 60 * 60 * 1000, 120: 120 * 60 * 1000 };
const DEFAULT_ITEMS = { shield30: 0, shield60: 0, shield120: 0, teleport: 0 };

function itemsRef(playerId) {
  return db.collection("playerItems").doc(playerId);
}

async function myItems(playerId) {
  const snap = await itemsRef(playerId).get();
  if (!snap.exists) {
    await itemsRef(playerId).set(DEFAULT_ITEMS);
    return { ...DEFAULT_ITEMS };
  }
  return { ...DEFAULT_ITEMS, ...snap.data() };
}

async function hasIncomingAttack(playerId) {
  const q = await db
    .collection("pvpMissions")
    .where("targetPlayerId", "==", playerId)
    .where("kind", "==", "attack")
    .where("phase", "==", "outbound")
    .limit(1)
    .get();
  return !q.empty;
}

async function hasOutboundMission(playerId) {
  const q = await db
    .collection("pvpMissions")
    .where("originPlayerId", "==", playerId)
    .where("phase", "in", ["outbound", "returning"])
    .limit(1)
    .get();
  return !q.empty;
}

async function buyItem(playerId, item) {
  if (!ITEM_COSTS[item]) return { error: "존재하지 않는 아이템입니다." };
  const cost = ITEM_COSTS[item];
  const playerRef = db.collection("players").doc(playerId);
  try {
    return await db.runTransaction(async (tx) => {
      const playerSnap = await tx.get(playerRef);
      if (!playerSnap.exists || !playerSnap.data().state) {
        throw new Error("게임 상태를 먼저 동기화해야 합니다.");
      }
      const state = playerSnap.data().state;
      if (!state.res || state.res.gold < cost) throw new Error("골드가 부족합니다.");
      const nextState = { ...state, res: { ...state.res, gold: state.res.gold - cost } };
      const itemsSnap = await tx.get(itemsRef(playerId));
      const current = itemsSnap.exists ? { ...DEFAULT_ITEMS, ...itemsSnap.data() } : { ...DEFAULT_ITEMS };
      const nextItems = { ...current, [item]: (current[item] || 0) + 1 };
      tx.set(playerRef, { state: nextState }, { merge: true });
      tx.set(itemsRef(playerId), nextItems);
      return { items: nextItems, goldLeft: nextState.res.gold };
    });
  } catch (e) {
    return { error: e.message };
  }
}

// 이미 발동 중인 보호막에 새 보호막을 더하면 "남은 시간 + 새 지속시간"으로 누적된다.
async function useShield(playerId, tier) {
  if (![30, 60, 120].includes(tier)) return { error: "잘못된 보호막 등급입니다." };
  const key = "shield" + tier;
  if (await hasIncomingAttack(playerId)) {
    return { error: "누군가 나를 공격하러 오는 중에는 보호막을 사용할 수 없습니다." };
  }
  const tileQuery = await db.collection("worldTiles").where("playerId", "==", playerId).limit(1).get();
  if (tileQuery.empty) return { error: "아직 정복 맵에 참가하지 않았습니다." };
  const tileRef = tileQuery.docs[0].ref;
  try {
    return await db.runTransaction(async (tx) => {
      const itemsSnap = await tx.get(itemsRef(playerId));
      const current = itemsSnap.exists ? { ...DEFAULT_ITEMS, ...itemsSnap.data() } : { ...DEFAULT_ITEMS };
      if (!current[key]) throw new Error("보유한 보호막이 없습니다.");
      const tileSnap = await tx.get(tileRef);
      const now = Date.now();
      const base = Math.max(now, (tileSnap.data() || {}).protectedUntil || 0);
      const newUntil = base + SHIELD_TIER_MS[tier];
      const nextItems = { ...current, [key]: current[key] - 1 };
      tx.set(itemsRef(playerId), nextItems);
      tx.update(tileRef, { protectedUntil: newUntil });
      return { protectedUntil: newUntil, items: nextItems };
    });
  } catch (e) {
    return { error: e.message };
  }
}

async function useTeleport(playerId) {
  const tileQuery = await db.collection("worldTiles").where("playerId", "==", playerId).limit(1).get();
  if (tileQuery.empty) return { error: "아직 정복 맵에 참가하지 않았습니다." };
  const tileData = tileQuery.docs[0].data();
  if (tileData.protectedUntil > Date.now()) {
    return { error: "보호막이 활성화된 상태에서는 성 이동을 사용할 수 없습니다." };
  }
  if (await hasOutboundMission(playerId)) {
    return { error: "군대가 출정 중이거나 귀환 중일 때는 성 이동을 사용할 수 없습니다." };
  }
  // 아이템 차감을 트랜잭션으로 먼저 확정한다(buyItem/useShield와 동일 패턴) — 이렇게 하지
  // 않으면 이중 클릭 등으로 두 요청이 동시에 myItems()를 읽어 둘 다 "1개 있음"을 보고
  // relocateToRandomTile을 각각 실행한 뒤 같은 값(1-1=0)으로 저장해, 실제로는 두 번
  // 이동했는데 재고만 1개 차감되는(공짜 텔레포트가 생기는) 문제가 있었다.
  // relocateToRandomTile 자체는 좌표를 무작위로 재시도하는 별도 트랜잭션이라 이 트랜잭션과
  // 합치기 어렵다 — 지도가 거의 다 차서 빈 칸을 못 찾는 극히 드문 경우에만 아이템이
  // 소모되고 이동은 실패하는 예외가 남지만(원래도 있었던 한계), 이중 사용보다는 안전하다.
  let itemsAfterClaim;
  try {
    itemsAfterClaim = await db.runTransaction(async (tx) => {
      const snap = await tx.get(itemsRef(playerId));
      const current = snap.exists ? { ...DEFAULT_ITEMS, ...snap.data() } : { ...DEFAULT_ITEMS };
      if (!current.teleport) throw new Error("보유한 성 이동 아이템이 없습니다.");
      const next = { ...current, teleport: current.teleport - 1 };
      tx.set(itemsRef(playerId), next);
      return next;
    });
  } catch (e) {
    return { error: e.message };
  }
  const result = await conquest.relocateToRandomTile(playerId);
  if (result.error) return result;
  return { tile: result.tile, items: itemsAfterClaim };
}

module.exports = { ITEM_COSTS, myItems, buyItem, useShield, useTeleport };
