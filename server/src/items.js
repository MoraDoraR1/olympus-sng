"use strict";
const { db } = require("./db");
const conquest = require("./conquest");

const ITEM_COSTS = { shield30: 5000, shield60: 9000, shield120: 16000, teleport: 8000 };
const SHIELD_TIER_MS = { 30: 30 * 60 * 1000, 60: 60 * 60 * 1000, 120: 120 * 60 * 1000 };

const ensureRow = db.prepare("INSERT OR IGNORE INTO player_items (player_id) VALUES (?)");
const getRow = db.prepare("SELECT * FROM player_items WHERE player_id = ?");
const incColumn = {
  shield30: db.prepare("UPDATE player_items SET shield30 = shield30 + 1 WHERE player_id = ?"),
  shield60: db.prepare("UPDATE player_items SET shield60 = shield60 + 1 WHERE player_id = ?"),
  shield120: db.prepare("UPDATE player_items SET shield120 = shield120 + 1 WHERE player_id = ?"),
  teleport: db.prepare("UPDATE player_items SET teleport = teleport + 1 WHERE player_id = ?"),
};
const decShield = {
  30: db.prepare("UPDATE player_items SET shield30 = shield30 - 1 WHERE player_id = ? AND shield30 > 0"),
  60: db.prepare("UPDATE player_items SET shield60 = shield60 - 1 WHERE player_id = ? AND shield60 > 0"),
  120: db.prepare("UPDATE player_items SET shield120 = shield120 - 1 WHERE player_id = ? AND shield120 > 0"),
};
const decTeleport = db.prepare("UPDATE player_items SET teleport = teleport - 1 WHERE player_id = ? AND teleport > 0");

const getStateRow = db.prepare("SELECT state_json FROM game_states WHERE player_id = ?");
const updateStateJson = db.prepare("UPDATE game_states SET state_json = ? WHERE player_id = ?");
const getTileRow = db.prepare("SELECT * FROM world_tiles WHERE player_id = ?");
const updateProtectedUntil = db.prepare("UPDATE world_tiles SET protected_until = ? WHERE player_id = ?");

// pvp_missions는 아직 아무도 행을 넣지 않는 표(공격 시스템 미구현)라 이 두 쿼리는
// 지금은 항상 "해당 없음"을 반환한다 — 나중에 공격 시스템이 이 표에 실제로 행을
// 넣기 시작하면 여기 손대지 않아도 즉시 올바르게 막기 시작한다.
const incomingAttackCheck = db.prepare("SELECT 1 FROM pvp_missions WHERE target_player_id = ? AND phase = 'march' LIMIT 1");
const outboundMissionCheck = db.prepare("SELECT 1 FROM pvp_missions WHERE origin_player_id = ? AND phase IN ('march','battle','return') LIMIT 1");

function myItems(playerId) {
  ensureRow.run(playerId);
  const row = getRow.get(playerId);
  return { shield30: row.shield30, shield60: row.shield60, shield120: row.shield120, teleport: row.teleport };
}

function buyItem(playerId, item) {
  if (!ITEM_COSTS[item]) return { error: "존재하지 않는 아이템입니다." };
  const stateRow = getStateRow.get(playerId);
  if (!stateRow) return { error: "게임 상태를 먼저 동기화해야 합니다." };
  let state;
  try { state = JSON.parse(stateRow.state_json); } catch { return { error: "게임 상태를 읽지 못했습니다." }; }
  const cost = ITEM_COSTS[item];
  if (!state.res || state.res.gold < cost) return { error: "골드가 부족합니다." };
  state.res.gold -= cost;
  updateStateJson.run(JSON.stringify(state), playerId);
  ensureRow.run(playerId);
  incColumn[item].run(playerId);
  return { items: myItems(playerId), goldLeft: state.res.gold };
}

// 이미 발동 중인 보호막에 새 보호막을 더하면 "남은 시간 + 새 지속시간"으로 누적된다
// (예: 27분 남은 상태에서 1시간짜리 사용 → 1시간 27분). 해금 직후 30분 보호와도 같은
// world_tiles.protected_until 필드를 쓰므로 자연스럽게 같은 방식으로 합산된다.
function useShield(playerId, tier) {
  if (![30, 60, 120].includes(tier)) return { error: "잘못된 보호막 등급입니다." };
  const items = myItems(playerId);
  const key = "shield" + tier;
  if (!items[key]) return { error: "보유한 보호막이 없습니다." };
  if (incomingAttackCheck.get(playerId)) return { error: "누군가 나를 공격하러 오는 중에는 보호막을 사용할 수 없습니다." };
  const tileRow = getTileRow.get(playerId);
  if (!tileRow) return { error: "아직 정복 맵에 참가하지 않았습니다." };
  const now = Date.now();
  const base = Math.max(now, tileRow.protected_until || 0);
  const newUntil = base + SHIELD_TIER_MS[tier];
  decShield[tier].run(playerId);
  updateProtectedUntil.run(newUntil, playerId);
  return { protectedUntil: newUntil, items: myItems(playerId) };
}

function useTeleport(playerId) {
  const items = myItems(playerId);
  if (!items.teleport) return { error: "보유한 성 이동 아이템이 없습니다." };
  const tileRow = getTileRow.get(playerId);
  if (!tileRow) return { error: "아직 정복 맵에 참가하지 않았습니다." };
  if (tileRow.protected_until > Date.now()) return { error: "보호막이 활성화된 상태에서는 성 이동을 사용할 수 없습니다." };
  if (outboundMissionCheck.get(playerId)) return { error: "군대가 출정 중이거나 귀환 중일 때는 성 이동을 사용할 수 없습니다." };
  const result = conquest.relocateToRandomTile(playerId);
  if (result.error) return result;
  decTeleport.run(playerId);
  return { tile: result.tile, items: myItems(playerId) };
}

module.exports = { ITEM_COSTS, myItems, buyItem, useShield, useTeleport };
