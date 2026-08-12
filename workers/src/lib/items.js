// server-legacy/src/items.js D1 이식. 원본의 incomingAttackCheck/outboundMissionCheck가
// pvp.js가 실제로 쓰는 phase 값('outbound'/'stationed'/'returning')이 아니라 쓰인 적 없는
// 값('march'/'battle'/'return')을 검사해 사실상 항상 통과되던 버그를 여기서 바로잡는다.
import * as conquest from "./conquest.js";

export const ITEM_COSTS = { shield30: 5000, shield60: 9000, shield120: 16000, teleport: 8000 };
const SHIELD_TIER_MS = { 30: 30 * 60 * 1000, 60: 60 * 60 * 1000, 120: 120 * 60 * 1000 };

async function ensureItemsRow(db, playerId) {
  await db.prepare("INSERT OR IGNORE INTO player_items (player_id) VALUES (?)").bind(playerId).run();
}

export async function myItems(db, playerId) {
  await ensureItemsRow(db, playerId);
  const row = await db.prepare("SELECT * FROM player_items WHERE player_id = ?").bind(playerId).first();
  return { shield30: row.shield30, shield60: row.shield60, shield120: row.shield120, teleport: row.teleport };
}

export async function buyItem(db, playerId, item) {
  if (!ITEM_COSTS[item]) return { error: "존재하지 않는 아이템입니다." };
  const stateRow = await db.prepare("SELECT state_json FROM game_states WHERE player_id = ?").bind(playerId).first();
  if (!stateRow) return { error: "게임 상태를 먼저 동기화해야 합니다." };
  let state;
  try { state = JSON.parse(stateRow.state_json); } catch { return { error: "게임 상태를 읽지 못했습니다." }; }
  const cost = ITEM_COSTS[item];
  if (!state.res || state.res.gold < cost) return { error: "골드가 부족합니다." };
  state.res.gold -= cost;
  await ensureItemsRow(db, playerId);
  await db.batch([
    db.prepare("UPDATE game_states SET state_json = ? WHERE player_id = ?").bind(JSON.stringify(state), playerId),
    db.prepare(`UPDATE player_items SET ${item} = ${item} + 1 WHERE player_id = ?`).bind(playerId),
  ]);
  return { items: await myItems(db, playerId), goldLeft: state.res.gold };
}

async function hasIncomingAttack(db, playerId) {
  const row = await db
    .prepare("SELECT 1 FROM pvp_missions WHERE target_player_id = ? AND kind = 'attack' AND phase = 'outbound' LIMIT 1")
    .bind(playerId)
    .first();
  return !!row;
}

async function hasOutboundMission(db, playerId) {
  const row = await db
    .prepare("SELECT 1 FROM pvp_missions WHERE origin_player_id = ? AND phase IN ('outbound','returning') LIMIT 1")
    .bind(playerId)
    .first();
  return !!row;
}

// 이미 발동 중인 보호막에 새 보호막을 더하면 "남은 시간 + 새 지속시간"으로 누적된다.
export async function useShield(db, playerId, tier) {
  if (![30, 60, 120].includes(tier)) return { error: "잘못된 보호막 등급입니다." };
  const items = await myItems(db, playerId);
  const key = "shield" + tier;
  if (!items[key]) return { error: "보유한 보호막이 없습니다." };
  if (await hasIncomingAttack(db, playerId)) {
    return { error: "누군가 나를 공격하러 오는 중에는 보호막을 사용할 수 없습니다." };
  }
  const tileRow = await db.prepare("SELECT * FROM world_tiles WHERE player_id = ?").bind(playerId).first();
  if (!tileRow) return { error: "아직 정복 맵에 참가하지 않았습니다." };
  const now = Date.now();
  const base = Math.max(now, tileRow.protected_until || 0);
  const newUntil = base + SHIELD_TIER_MS[tier];
  await db.batch([
    db.prepare(`UPDATE player_items SET ${key} = ${key} - 1 WHERE player_id = ? AND ${key} > 0`).bind(playerId),
    db.prepare("UPDATE world_tiles SET protected_until = ? WHERE player_id = ?").bind(newUntil, playerId),
  ]);
  return { protectedUntil: newUntil, items: await myItems(db, playerId) };
}

export async function useTeleport(db, playerId) {
  const items = await myItems(db, playerId);
  if (!items.teleport) return { error: "보유한 성 이동 아이템이 없습니다." };
  const tileRow = await db.prepare("SELECT * FROM world_tiles WHERE player_id = ?").bind(playerId).first();
  if (!tileRow) return { error: "아직 정복 맵에 참가하지 않았습니다." };
  if (tileRow.protected_until > Date.now()) {
    return { error: "보호막이 활성화된 상태에서는 성 이동을 사용할 수 없습니다." };
  }
  if (await hasOutboundMission(db, playerId)) {
    return { error: "군대가 출정 중이거나 귀환 중일 때는 성 이동을 사용할 수 없습니다." };
  }
  const result = await conquest.relocateToRandomTile(db, playerId);
  if (result.error) return result;
  await db.prepare("UPDATE player_items SET teleport = teleport - 1 WHERE player_id = ? AND teleport > 0").bind(playerId).run();
  return { tile: result.tile, items: await myItems(db, playerId) };
}
