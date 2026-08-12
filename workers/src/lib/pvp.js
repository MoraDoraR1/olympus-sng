// server-legacy/src/pvp.js를 D1로 이식. 가장 큰 차이는 "누가 sweepOnce를 부르냐"다 —
// 원본은 단일 Node 프로세스의 setInterval(5초)이 보장하던 이중 처리 방지를, 여기서는
// Durable Object(PvpCoordinator, 인스턴스당 항상 단일 스레드로 실행됨) + 각 판정 함수가
// 시작할 때 미션을 다시 읽어 phase를 재확인하는 방식으로 명시적으로 재구현했다.
import * as conquest from "./conquest.js";
import { chebyshevDistance, travelTimeSeconds, armySpeedMultiplier } from "./movement.js";
import {
  armyCombatStats,
  sumStats,
  pvpVerdict,
  applyCasualties,
  PVP_BATTLE_DURATION_SECONDS,
  LOOT_PERCENT,
  homeDefenseMultiplier,
  wallFlatDefense,
  shelterProtectedAmount,
} from "./combat.js";
import { TROOP_BY_KEY } from "./troops.js";

async function readState(db, playerId) {
  const row = await db.prepare("SELECT state_json FROM game_states WHERE player_id = ?").bind(playerId).first();
  if (!row) return null;
  try { return JSON.parse(row.state_json); } catch { return null; }
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

export async function myMissions(db, playerId) {
  const { results } = await db
    .prepare(
      `SELECT pm.*, po.nickname AS origin_nickname, pt.nickname AS target_nickname
       FROM pvp_missions pm
       JOIN players po ON po.id = pm.origin_player_id
       JOIN players pt ON pt.id = pm.target_player_id
       WHERE pm.origin_player_id = ? OR pm.target_player_id = ?
       ORDER BY pm.created_at DESC`
    )
    .bind(playerId, playerId)
    .all();
  return results.map((r) => serializeMission(r, playerId));
}

// kind: 'attack' | 'reinforce'
export async function dispatch(db, playerId, kind, { targetPlayerId, squadIndex, comp }) {
  if (kind !== "attack" && kind !== "reinforce") return { error: "잘못된 요청입니다." };
  const targetId = Number(targetPlayerId);
  const squadIdx = Number(squadIndex);
  if (!Number.isInteger(targetId) || targetId === playerId) return { error: "공격/지원 대상이 올바르지 않습니다." };
  if (![0, 1, 2].includes(squadIdx)) return { error: "부대 번호가 올바르지 않습니다." };

  const originTile = await conquest.myTile(db, playerId);
  const targetTile = await conquest.myTile(db, targetId);
  if (!originTile) return { error: "아직 정복 맵에 참가하지 않았습니다." };
  if (!targetTile) return { error: "상대가 정복 맵에 없습니다." };

  const now = Date.now();
  if (kind === "attack" && targetTile.protectedUntil > now) {
    return { error: "보호 중인 플레이어는 공격할 수 없습니다." };
  }

  const busy = await db
    .prepare(
      "SELECT 1 FROM pvp_missions WHERE origin_player_id = ? AND origin_squad_index = ? AND phase IN ('outbound','stationed','returning') LIMIT 1"
    )
    .bind(playerId, squadIdx)
    .first();
  if (busy) return { error: "이미 그 부대는 정복 임무 중입니다." };

  const originState = await readState(db, playerId);
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

  const enhanceById = {};
  Object.keys(originState.owned || {}).forEach((id) => { enhanceById[id] = (originState.owned[id] || {}).enhance || 0; });
  const distance = chebyshevDistance(originTile, targetTile);
  const speed = armySpeedMultiplier(cleanComp, heroIds, enhanceById);
  const travelSeconds = travelTimeSeconds(distance, speed);
  const arriveAt = now + travelSeconds * 1000;

  const [insertResult] = await db.batch([
    db
      .prepare(
        `INSERT INTO pvp_missions
          (kind, origin_player_id, origin_squad_index, target_player_id, comp_json, hero_ids_json, phase, depart_at, arrive_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'outbound', ?, ?, ?)`
      )
      .bind(kind, playerId, squadIdx, targetId, JSON.stringify(cleanComp), JSON.stringify(heroIds), now, arriveAt, now),
    db.prepare("UPDATE game_states SET state_json = ? WHERE player_id = ?").bind(JSON.stringify(originState), playerId),
  ]);

  return { missionId: insertResult.meta.last_row_id, arriveAt, travelSeconds, distance };
}

// 주둔 중인 지원군을 보낸 사람이 자진 철수시킨다(전투 참여 전이라면 언제든 가능).
export async function recall(db, playerId, missionId) {
  const row = await db.prepare("SELECT * FROM pvp_missions WHERE id = ?").bind(Number(missionId)).first();
  if (!row || row.origin_player_id !== playerId) return { error: "그런 임무를 찾을 수 없습니다." };
  if (row.kind !== "reinforce" || row.phase !== "stationed") return { error: "지금은 철수시킬 수 없습니다." };
  const now = Date.now();
  const oneWay = row.arrive_at - row.depart_at;
  await db
    .prepare("UPDATE pvp_missions SET phase = 'returning', return_arrive_at = ? WHERE id = ?")
    .bind(now + oneWay, row.id)
    .run();
  return { ok: true, returnArriveAt: now + oneWay };
}

// ---------- 스윕(도착 판정) — PvpCoordinator Durable Object가 알람마다 호출한다 ----------

async function resolveAttack(db, missionId) {
  // 이중 처리 방지: 넘어온 값을 믿지 않고 여기서 다시 읽어 phase가 여전히 outbound인지 확인.
  const mission = await db.prepare("SELECT * FROM pvp_missions WHERE id = ? AND kind = 'attack' AND phase = 'outbound'").bind(missionId).first();
  if (!mission) return; // 이미 처리됨(또는 존재하지 않음)

  const now = Date.now();
  const attackerComp = JSON.parse(mission.comp_json);
  const attackerHeroIds = JSON.parse(mission.hero_ids_json);
  const attackerState = (await readState(db, mission.origin_player_id)) || { res: {}, owned: {} };
  const attackerStats = armyCombatStats(attackerComp, attackerHeroIds, attackerState.owned || {});

  const defenderState = (await readState(db, mission.target_player_id)) || { res: {}, troopsByType: {}, armies: [], owned: {} };
  const defenderHomeComp = { ...(defenderState.troopsByType || {}) };
  const defenderHomeHeroIds = idleSquadHeroIds(defenderState);
  const defenderHomeStats = armyCombatStats(defenderHomeComp, defenderHomeHeroIds, defenderState.owned || {});

  const { results: stationedRows } = await db
    .prepare("SELECT * FROM pvp_missions WHERE target_player_id = ? AND kind = 'reinforce' AND phase = 'stationed'")
    .bind(mission.target_player_id)
    .all();
  const reinforcements = [];
  for (const r of stationedRows) {
    const rComp = JSON.parse(r.comp_json);
    const rHeroIds = JSON.parse(r.hero_ids_json);
    const rState = (await readState(db, r.origin_player_id)) || { owned: {} };
    reinforcements.push({ row: r, comp: rComp, stats: armyCombatStats(rComp, rHeroIds, rState.owned || {}) });
  }

  const baseDefenderStats = sumStats([defenderHomeStats, ...reinforcements.map((r) => r.stats)]);
  // 방어탑(배수)·성벽(가산)은 도시 전체를 지키는 시설이므로 수성 측 총합(집주인 + 주둔
  // 지원군)에 함께 적용한다 — 원정(공격) 부대에는 적용되지 않는다.
  const defenderStats = {
    ...baseDefenderStats,
    def: baseDefenderStats.def * homeDefenseMultiplier(defenderState) + wallFlatDefense(defenderState),
  };
  const verdict = pvpVerdict(attackerStats, defenderStats, PVP_BATTLE_DURATION_SECONDS);

  const attackerCasualty = applyCasualties(attackerComp, verdict.attackerLossRatio);
  const defenderHomeCasualty = applyCasualties(defenderHomeComp, verdict.defenderLossRatio);
  defenderState.troopsByType = defenderHomeCasualty.survivors;

  let reinforcementLostTotal = 0;
  const reinforcementUpdates = reinforcements.map((r) => {
    const c = applyCasualties(r.comp, verdict.defenderLossRatio);
    reinforcementLostTotal += c.totalLost;
    const wiped = Object.values(c.survivors).every((v) => v <= 0);
    return { id: r.row.id, wiped, survivors: c.survivors };
  });

  let loot = null;
  if (verdict.attackerWins) {
    loot = {};
    attackerState.res = attackerState.res || {};
    defenderState.res = defenderState.res || {};
    // 자원보호소는 레벨에 비례한 일정량을 약탈 대상에서 아예 제외한다(그 이하 자원은
    // 손대지 않음) — 10% 약탈은 "보호되지 않는 나머지"에만 적용된다.
    const protectedAmount = shelterProtectedAmount(defenderState);
    ["food", "wood", "stone", "gold"].forEach((res) => {
      const have = Math.max(0, Math.floor(defenderState.res[res] || 0));
      const exposed = Math.max(0, have - protectedAmount);
      const taken = Math.floor(exposed * LOOT_PERCENT);
      if (taken > 0) {
        loot[res] = taken;
        defenderState.res[res] = have - taken;
        attackerState.res[res] = (attackerState.res[res] || 0) + taken;
      }
    });
  }

  // 공격이 먼저 도착했으므로, 이 타깃을 향해 아직 도착 못한 지원군은 전부 철수(왕복 대칭)
  const { results: outboundReinforceRows } = await db
    .prepare("SELECT * FROM pvp_missions WHERE target_player_id = ? AND kind = 'reinforce' AND phase = 'outbound'")
    .bind(mission.target_player_id)
    .all();

  const returnDuration = mission.arrive_at - mission.depart_at;
  const result = {
    attackerWins: verdict.attackerWins,
    attackerLost: attackerCasualty.totalLost,
    defenderLost: defenderHomeCasualty.totalLost + reinforcementLostTotal,
    loot,
    resolvedAt: now,
  };

  const stmts = [
    db.prepare("UPDATE game_states SET state_json = ? WHERE player_id = ?").bind(JSON.stringify(defenderState), mission.target_player_id),
    db.prepare("UPDATE game_states SET state_json = ? WHERE player_id = ?").bind(JSON.stringify(attackerState), mission.origin_player_id),
    db
      .prepare("UPDATE pvp_missions SET phase = 'returning', comp_json = ?, return_arrive_at = ?, result_json = ? WHERE id = ? AND phase = 'outbound'")
      .bind(JSON.stringify(attackerCasualty.survivors), now + returnDuration, JSON.stringify(result), mission.id),
  ];
  reinforcementUpdates.forEach(({ id, wiped, survivors }) => {
    stmts.push(
      wiped
        ? db.prepare("DELETE FROM pvp_missions WHERE id = ?").bind(id)
        : db.prepare("UPDATE pvp_missions SET comp_json = ? WHERE id = ?").bind(JSON.stringify(survivors), id)
    );
  });
  outboundReinforceRows.forEach((r) => {
    const oneWay = r.arrive_at - r.depart_at;
    stmts.push(
      db.prepare("UPDATE pvp_missions SET phase = 'returning', return_arrive_at = ? WHERE id = ? AND phase = 'outbound'").bind(now + oneWay, r.id)
    );
  });

  await db.batch(stmts);
}

async function arriveReinforcement(db, missionId) {
  const mission = await db.prepare("SELECT id FROM pvp_missions WHERE id = ? AND kind = 'reinforce' AND phase = 'outbound'").bind(missionId).first();
  if (!mission) return; // 이미 처리됨
  await db.prepare("UPDATE pvp_missions SET phase = 'stationed' WHERE id = ? AND phase = 'outbound'").bind(missionId).run();
}

async function completeReturn(db, missionId) {
  const mission = await db.prepare("SELECT * FROM pvp_missions WHERE id = ? AND phase = 'returning'").bind(missionId).first();
  if (!mission) return; // 이미 처리됨
  const state = await readState(db, mission.origin_player_id);
  const stmts = [];
  if (state) {
    const comp = JSON.parse(mission.comp_json);
    const nextTroops = { ...(state.troopsByType || {}) };
    Object.entries(comp).forEach(([key, count]) => { nextTroops[key] = (nextTroops[key] || 0) + count; });
    state.troopsByType = nextTroops;
    stmts.push(db.prepare("UPDATE game_states SET state_json = ? WHERE player_id = ?").bind(JSON.stringify(state), mission.origin_player_id));
  }
  stmts.push(db.prepare("DELETE FROM pvp_missions WHERE id = ?").bind(mission.id));
  await db.batch(stmts);
}

// now 시각 기준으로 도착 판정이 필요한 미션들을 전부 처리한다. PvpCoordinator Durable
// Object의 alarm() 핸들러가 호출한다. 반환값: 다음으로 예약해야 할 알람 시각(ms epoch,
// 처리할 미션이 더 없으면 null) — 원본의 5초 폴링 대신, 다음 미션이 실제로 도착하는
// 정확한 시각에 알람을 맞춰 깨어난다(더 정밀함).
export async function sweepOnce(db, now = Date.now()) {
  const { results: dueAttacks } = await db
    .prepare("SELECT id FROM pvp_missions WHERE kind = 'attack' AND phase = 'outbound' AND arrive_at <= ?")
    .bind(now)
    .all();
  for (const row of dueAttacks) {
    try { await resolveAttack(db, row.id); } catch (e) { console.error("[pvp] resolveAttack 실패:", e); }
  }

  const { results: dueReinforce } = await db
    .prepare("SELECT id FROM pvp_missions WHERE kind = 'reinforce' AND phase = 'outbound' AND arrive_at <= ?")
    .bind(now)
    .all();
  for (const row of dueReinforce) {
    try { await arriveReinforcement(db, row.id); } catch (e) { console.error("[pvp] arriveReinforcement 실패:", e); }
  }

  const { results: dueReturns } = await db
    .prepare("SELECT id FROM pvp_missions WHERE phase = 'returning' AND return_arrive_at <= ?")
    .bind(now)
    .all();
  for (const row of dueReturns) {
    try { await completeReturn(db, row.id); } catch (e) { console.error("[pvp] completeReturn 실패:", e); }
  }

  const nextRow = await db
    .prepare(
      `SELECT MIN(t) AS next_at FROM (
         SELECT arrive_at AS t FROM pvp_missions WHERE phase = 'outbound'
         UNION ALL
         SELECT return_arrive_at AS t FROM pvp_missions WHERE phase = 'returning' AND return_arrive_at IS NOT NULL
       )`
    )
    .first();
  return nextRow && nextRow.next_at != null ? nextRow.next_at : null;
}
