"use strict";
const { db } = require("./db");
const conquest = require("./conquest");
const { chebyshevDistance, travelTimeSeconds, armySpeedMultiplier } = require("./movement");
const { armyCombatStats, sumStats, pvpVerdict, applyCasualties, PVP_BATTLE_DURATION_SECONDS, LOOT_PERCENT } = require("./combat");
const { TROOP_BY_KEY } = require("./troops");

const getStateRow = db.prepare("SELECT state_json FROM game_states WHERE player_id = ?");
const updateStateJson = db.prepare("UPDATE game_states SET state_json = ? WHERE player_id = ?");

function readState(playerId) {
  const row = getStateRow.get(playerId);
  if (!row) return null;
  try { return JSON.parse(row.state_json); } catch { return null; }
}
function writeState(playerId, state) {
  updateStateJson.run(JSON.stringify(state), playerId);
}
// 출정 중이 아닌(mission===null) 부대에 배치된 영웅들 — "지금 집에 있는" 영웅으로
// 간주해 수성전 방어 측 전력에 자동으로 포함시킨다.
function idleSquadHeroIds(state) {
  const ids = [];
  ((state && state.armies) || []).forEach((a) => {
    if (!a.mission) (a.heroIds || []).forEach((id) => { if (id) ids.push(id); });
  });
  return ids;
}

const insertMission = db.prepare(`
  INSERT INTO pvp_missions
    (kind, origin_player_id, origin_squad_index, target_player_id, comp_json, hero_ids_json, phase, depart_at, arrive_at, created_at)
  VALUES (?, ?, ?, ?, ?, ?, 'outbound', ?, ?, ?)
`);
const busySquadCheck = db.prepare(`
  SELECT 1 FROM pvp_missions WHERE origin_player_id = ? AND origin_squad_index = ? AND phase IN ('outbound','stationed','returning') LIMIT 1
`);
const getMissionsForPlayer = db.prepare(`
  SELECT pm.*, po.nickname AS origin_nickname, pt.nickname AS target_nickname
  FROM pvp_missions pm
  JOIN players po ON po.id = pm.origin_player_id
  JOIN players pt ON pt.id = pm.target_player_id
  WHERE pm.origin_player_id = ? OR pm.target_player_id = ?
  ORDER BY pm.created_at DESC
`);
const getMissionById = db.prepare("SELECT * FROM pvp_missions WHERE id = ?");
const updateMissionRow = db.prepare(
  "UPDATE pvp_missions SET phase = ?, comp_json = ?, return_arrive_at = ?, result_json = ? WHERE id = ?"
);
const deleteMission = db.prepare("DELETE FROM pvp_missions WHERE id = ?");
const stationedForTarget = db.prepare("SELECT * FROM pvp_missions WHERE target_player_id = ? AND kind = 'reinforce' AND phase = 'stationed'");
const outboundReinforcementsForTarget = db.prepare("SELECT * FROM pvp_missions WHERE target_player_id = ? AND kind = 'reinforce' AND phase = 'outbound'");
const outboundArrivedAttacks = db.prepare("SELECT * FROM pvp_missions WHERE kind = 'attack' AND phase = 'outbound' AND arrive_at <= ?");
const outboundArrivedReinforcements = db.prepare("SELECT * FROM pvp_missions WHERE kind = 'reinforce' AND phase = 'outbound' AND arrive_at <= ?");
const returningArrived = db.prepare("SELECT * FROM pvp_missions WHERE phase = 'returning' AND return_arrive_at <= ?");

function serializeMission(row, forPlayerId) {
  return {
    id: row.id,
    kind: row.kind,
    isMine: row.origin_player_id === forPlayerId,
    originPlayerId: row.origin_player_id,
    originNickname: row.origin_nickname,
    targetPlayerId: row.target_player_id,
    targetNickname: row.target_nickname,
    squadIndex: row.origin_squad_index,
    comp: JSON.parse(row.comp_json),
    phase: row.phase,
    departAt: row.depart_at,
    arriveAt: row.arrive_at,
    returnArriveAt: row.return_arrive_at,
    result: row.result_json ? JSON.parse(row.result_json) : null,
  };
}

function myMissions(playerId) {
  return getMissionsForPlayer.all(playerId, playerId).map((r) => serializeMission(r, playerId));
}

// kind: 'attack' | 'reinforce'
function dispatch(playerId, kind, { targetPlayerId, squadIndex, comp }) {
  if (kind !== "attack" && kind !== "reinforce") return { error: "잘못된 요청입니다." };
  const targetId = Number(targetPlayerId);
  const squadIdx = Number(squadIndex);
  if (!Number.isInteger(targetId) || targetId === playerId) return { error: "공격/지원 대상이 올바르지 않습니다." };
  if (![0, 1, 2].includes(squadIdx)) return { error: "부대 번호가 올바르지 않습니다." };

  const originTile = conquest.myTile(playerId);
  const targetTile = conquest.myTile(targetId);
  if (!originTile) return { error: "아직 정복 맵에 참가하지 않았습니다." };
  if (!targetTile) return { error: "상대가 정복 맵에 없습니다." };

  const now = Date.now();
  if (kind === "attack" && targetTile.protectedUntil > now) return { error: "보호 중인 플레이어는 공격할 수 없습니다." };
  if (busySquadCheck.get(playerId, squadIdx)) return { error: "이미 그 부대는 정복 임무 중입니다." };

  const originState = readState(playerId);
  if (!originState) return { error: "게임 상태를 먼저 동기화해야 합니다." };
  const squad = (originState.armies || [])[squadIdx];
  if (!squad) return { error: "부대 정보를 찾을 수 없습니다." };
  if (squad.mission) return { error: "이미 그 부대는 다른 임무 중입니다(몬스터/성/레이드)." };
  const heroIds = (squad.heroIds || []).filter(Boolean);

  const cleanComp = {};
  let total = 0;
  Object.entries(comp || {}).forEach(([key, count]) => {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    if (n > 0 && TROOP_BY_KEY[key]) { cleanComp[key] = n; total += n; }
  });
  if (total <= 0) return { error: "파병할 병사를 1명 이상 입력하세요." };
  for (const [key, count] of Object.entries(cleanComp)) {
    if (count > (originState.troopsByType[key] || 0)) return { error: "보유 병사가 부족합니다." };
  }

  Object.entries(cleanComp).forEach(([key, count]) => { originState.troopsByType[key] -= count; });
  writeState(playerId, originState);

  const enhanceById = {};
  Object.keys(originState.owned || {}).forEach((id) => { enhanceById[id] = (originState.owned[id] || {}).enhance || 0; });
  const distance = chebyshevDistance(originTile, targetTile);
  const speed = armySpeedMultiplier(cleanComp, heroIds, enhanceById);
  const travelSeconds = travelTimeSeconds(distance, speed);
  const arriveAt = now + travelSeconds * 1000;

  const info = insertMission.run(kind, playerId, squadIdx, targetId, JSON.stringify(cleanComp), JSON.stringify(heroIds), now, arriveAt, now);
  return { missionId: Number(info.lastInsertRowid), arriveAt, travelSeconds, distance };
}

// 주둔 중인 지원군을 보낸 사람이 자진 철수시킨다(전투 참여 전이라면 언제든 가능).
function recall(playerId, missionId) {
  const row = getMissionById.get(Number(missionId));
  if (!row || row.origin_player_id !== playerId) return { error: "그런 임무를 찾을 수 없습니다." };
  if (row.kind !== "reinforce" || row.phase !== "stationed") return { error: "지금은 철수시킬 수 없습니다." };
  const now = Date.now();
  const oneWay = row.arrive_at - row.depart_at;
  updateMissionRow.run("returning", row.comp_json, now + oneWay, null, row.id);
  return { ok: true, returnArriveAt: now + oneWay };
}

function resolveAttack(mission, now) {
  const attackerComp = JSON.parse(mission.comp_json);
  const attackerHeroIds = JSON.parse(mission.hero_ids_json);
  const attackerState = readState(mission.origin_player_id) || { res: {}, owned: {} };
  const attackerStats = armyCombatStats(attackerComp, attackerHeroIds, attackerState.owned || {});

  const defenderState = readState(mission.target_player_id) || { res: {}, troopsByType: {}, armies: [], owned: {} };
  const defenderHomeComp = { ...(defenderState.troopsByType || {}) };
  const defenderHomeHeroIds = idleSquadHeroIds(defenderState);
  const defenderHomeStats = armyCombatStats(defenderHomeComp, defenderHomeHeroIds, defenderState.owned || {});

  const stationedRows = stationedForTarget.all(mission.target_player_id);
  const reinforcements = stationedRows.map((r) => {
    const rComp = JSON.parse(r.comp_json);
    const rHeroIds = JSON.parse(r.hero_ids_json);
    const rState = readState(r.origin_player_id) || { owned: {} };
    return { row: r, comp: rComp, stats: armyCombatStats(rComp, rHeroIds, rState.owned || {}) };
  });

  const defenderStats = sumStats([defenderHomeStats, ...reinforcements.map((r) => r.stats)]);
  const verdict = pvpVerdict(attackerStats, defenderStats, PVP_BATTLE_DURATION_SECONDS);

  const attackerCasualty = applyCasualties(attackerComp, verdict.attackerLossRatio);
  const defenderHomeCasualty = applyCasualties(defenderHomeComp, verdict.defenderLossRatio);
  defenderState.troopsByType = defenderHomeCasualty.survivors;

  let reinforcementLostTotal = 0;
  reinforcements.forEach((r) => {
    const c = applyCasualties(r.comp, verdict.defenderLossRatio);
    reinforcementLostTotal += c.totalLost;
    if (Object.values(c.survivors).every((v) => v <= 0)) {
      deleteMission.run(r.row.id);
    } else {
      updateMissionRow.run("stationed", JSON.stringify(c.survivors), r.row.return_arrive_at, r.row.result_json, r.row.id);
    }
  });

  let loot = null;
  if (verdict.attackerWins) {
    loot = {};
    attackerState.res = attackerState.res || {};
    defenderState.res = defenderState.res || {};
    ["food", "wood", "stone", "gold"].forEach((res) => {
      const have = Math.max(0, Math.floor(defenderState.res[res] || 0));
      const taken = Math.floor(have * LOOT_PERCENT);
      if (taken > 0) {
        loot[res] = taken;
        defenderState.res[res] = have - taken;
        attackerState.res[res] = (attackerState.res[res] || 0) + taken;
      }
    });
  }
  writeState(mission.target_player_id, defenderState);
  writeState(mission.origin_player_id, attackerState);

  // 공격이 먼저 도착했으므로, 이 타깃을 향해 아직 도착 못한 지원군은 전부 철수(왕복 대칭)
  outboundReinforcementsForTarget.all(mission.target_player_id).forEach((r) => {
    const oneWay = r.arrive_at - r.depart_at;
    updateMissionRow.run("returning", r.comp_json, now + oneWay, null, r.id);
  });

  const returnDuration = mission.arrive_at - mission.depart_at;
  const result = {
    attackerWins: verdict.attackerWins,
    attackerLost: attackerCasualty.totalLost,
    defenderLost: defenderHomeCasualty.totalLost + reinforcementLostTotal,
    loot,
    resolvedAt: now,
  };
  updateMissionRow.run("returning", JSON.stringify(attackerCasualty.survivors), now + returnDuration, JSON.stringify(result), mission.id);
}

function arriveReinforcement(mission) {
  updateMissionRow.run("stationed", mission.comp_json, mission.return_arrive_at, mission.result_json, mission.id);
}

function completeReturn(mission) {
  const originState = readState(mission.origin_player_id);
  if (originState) {
    const comp = JSON.parse(mission.comp_json);
    originState.troopsByType = originState.troopsByType || {};
    Object.entries(comp).forEach(([key, count]) => { originState.troopsByType[key] = (originState.troopsByType[key] || 0) + count; });
    writeState(mission.origin_player_id, originState);
  }
  deleteMission.run(mission.id);
}

// 5초마다 index.js에서 호출 — 도착 시각이 지난 미션들을 상태에 반영한다.
function sweepOnce() {
  const now = Date.now();
  outboundArrivedAttacks.all(now).forEach((row) => { try { resolveAttack(row, now); } catch (e) { console.error("[pvp] resolveAttack 실패:", e); } });
  outboundArrivedReinforcements.all(now).forEach((row) => { try { arriveReinforcement(row); } catch (e) { console.error("[pvp] arriveReinforcement 실패:", e); } });
  returningArrived.all(now).forEach((row) => { try { completeReturn(row); } catch (e) { console.error("[pvp] completeReturn 실패:", e); } });
}

module.exports = { dispatch, recall, myMissions, sweepOnce };
