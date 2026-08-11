"use strict";
// server-legacy/src/pvp.js 포팅. 가장 큰 차이는 sweepOnce다 — 원본은 단일 Node 프로세스의
// setInterval(5초)과 동기식 SQLite 호출 덕분에 "묵시적으로" 이중 처리가 안전했지만,
// Cloud Functions(스케줄 함수, 여러 인스턴스가 겹쳐 돌 수 있음)에는 그 전제가 없다.
// 그래서 각 미션의 판정을 Firestore 트랜잭션 하나로 감싸고, 트랜잭션 안에서 미션을
// 다시 읽어 phase가 여전히 기대한 값인지 확인한 뒤에만 전이시킨다(이중 처리 방지를
// 명시적으로 구현). PvP 전투 계산(combat.js)과 이동(movement.js) 공식 자체는 바뀌지 않았다.
const { db } = require("./admin");
const conquest = require("./conquest");
const { chebyshevDistance, travelTimeSeconds, armySpeedMultiplier } = require("./movement");
const {
  armyCombatStats,
  sumStats,
  pvpVerdict,
  applyCasualties,
  PVP_BATTLE_DURATION_SECONDS,
  LOOT_PERCENT,
} = require("./combat");
const { TROOP_BY_KEY } = require("./troops");

const missions = () => db.collection("pvpMissions");
const players = () => db.collection("players");

// 출정 중이 아닌(mission===null) 부대에 배치된 영웅들 — "지금 집에 있는" 영웅으로
// 간주해 수성전 방어 측 전력에 자동으로 포함시킨다.
function idleSquadHeroIds(state) {
  const ids = [];
  ((state && state.armies) || []).forEach((a) => {
    if (!a.mission) (a.heroIds || []).forEach((id) => { if (id) ids.push(id); });
  });
  return ids;
}

async function joinNicknames(playerIds) {
  const uniqueIds = [...new Set(playerIds)];
  const nicknameById = {};
  if (uniqueIds.length) {
    const snaps = await db.getAll(...uniqueIds.map((id) => players().doc(id)));
    snaps.forEach((s, i) => { nicknameById[uniqueIds[i]] = s.exists ? s.data().nickname : "?"; });
  }
  return nicknameById;
}

function serializeMission(id, r, forPlayerId, nicknameById) {
  return {
    id,
    kind: r.kind,
    isMine: r.originPlayerId === forPlayerId,
    originPlayerId: r.originPlayerId,
    originNickname: nicknameById[r.originPlayerId],
    targetPlayerId: r.targetPlayerId,
    targetNickname: nicknameById[r.targetPlayerId],
    squadIndex: r.originSquadIndex,
    comp: r.comp,
    phase: r.phase,
    departAt: r.departAt,
    arriveAt: r.arriveAt,
    returnArriveAt: r.returnArriveAt || null,
    result: r.result || null,
  };
}

async function myMissions(playerId) {
  const [asOrigin, asTarget] = await Promise.all([
    missions().where("originPlayerId", "==", playerId).get(),
    missions().where("targetPlayerId", "==", playerId).get(),
  ]);
  const byId = new Map();
  [...asOrigin.docs, ...asTarget.docs].forEach((d) => byId.set(d.id, d.data()));
  const playerIds = [];
  byId.forEach((r) => { playerIds.push(r.originPlayerId, r.targetPlayerId); });
  const nicknameById = await joinNicknames(playerIds);
  return [...byId.entries()]
    .map(([id, r]) => serializeMission(id, r, playerId, nicknameById))
    .sort((a, b) => (b.departAt || 0) - (a.departAt || 0));
}

// kind: 'attack' | 'reinforce'
async function dispatch(playerId, kind, { targetPlayerId, squadIndex, comp }) {
  if (kind !== "attack" && kind !== "reinforce") return { error: "잘못된 요청입니다." };
  const targetId = String(targetPlayerId || "");
  const squadIdx = Number(squadIndex);
  if (!targetId || targetId === playerId) return { error: "공격/지원 대상이 올바르지 않습니다." };
  if (![0, 1, 2].includes(squadIdx)) return { error: "부대 번호가 올바르지 않습니다." };

  const originTile = await conquest.myTile(playerId);
  const targetTile = await conquest.myTile(targetId);
  if (!originTile) return { error: "아직 정복 맵에 참가하지 않았습니다." };
  if (!targetTile) return { error: "상대가 정복 맵에 없습니다." };

  const now = Date.now();
  if (kind === "attack" && targetTile.protectedUntil > now) {
    return { error: "보호 중인 플레이어는 공격할 수 없습니다." };
  }

  const playerRef = players().doc(playerId);
  const busyQuery = missions()
    .where("originPlayerId", "==", playerId)
    .where("originSquadIndex", "==", squadIdx)
    .where("phase", "in", ["outbound", "stationed", "returning"])
    .limit(1);

  try {
    return await db.runTransaction(async (tx) => {
      const [playerSnap, busySnap] = await Promise.all([tx.get(playerRef), tx.get(busyQuery)]);
      if (!busySnap.empty) throw new Error("이미 그 부대는 정복 임무 중입니다.");
      if (!playerSnap.exists || !playerSnap.data().state) {
        throw new Error("게임 상태를 먼저 동기화해야 합니다.");
      }
      const state = playerSnap.data().state;
      const squad = (state.armies || [])[squadIdx];
      if (!squad) throw new Error("부대 정보를 찾을 수 없습니다.");
      if (squad.mission) throw new Error("이미 그 부대는 다른 임무 중입니다(몬스터/성/레이드).");
      const heroIds = (squad.heroIds || []).filter(Boolean);

      const cleanComp = {};
      let total = 0;
      Object.entries(comp || {}).forEach(([key, count]) => {
        const n = Math.max(0, Math.floor(Number(count) || 0));
        if (n > 0 && TROOP_BY_KEY[key]) { cleanComp[key] = n; total += n; }
      });
      if (total <= 0) throw new Error("파병할 병사를 1명 이상 입력하세요.");
      for (const [key, count] of Object.entries(cleanComp)) {
        if (count > (state.troopsByType[key] || 0)) throw new Error("보유 병사가 부족합니다.");
      }

      const nextTroops = { ...state.troopsByType };
      Object.entries(cleanComp).forEach(([key, count]) => { nextTroops[key] -= count; });
      const nextState = { ...state, troopsByType: nextTroops };

      const enhanceById = {};
      Object.keys(state.owned || {}).forEach((id) => { enhanceById[id] = (state.owned[id] || {}).enhance || 0; });
      const distance = chebyshevDistance(originTile, targetTile);
      const speed = armySpeedMultiplier(cleanComp, heroIds, enhanceById);
      const travelSeconds = travelTimeSeconds(distance, speed);
      const arriveAt = now + travelSeconds * 1000;

      const missionRef = missions().doc();
      tx.set(missionRef, {
        kind,
        originPlayerId: playerId,
        originSquadIndex: squadIdx,
        targetPlayerId: targetId,
        comp: cleanComp,
        heroIds,
        phase: "outbound",
        departAt: now,
        arriveAt,
        returnArriveAt: null,
        result: null,
        createdAt: now,
      });
      tx.set(playerRef, { state: nextState }, { merge: true });

      return { missionId: missionRef.id, arriveAt, travelSeconds, distance };
    });
  } catch (e) {
    return { error: e.message };
  }
}

// 주둔 중인 지원군을 보낸 사람이 자진 철수시킨다(전투 참여 전이라면 언제든 가능).
async function recall(playerId, missionId) {
  const ref = missions().doc(String(missionId));
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("그런 임무를 찾을 수 없습니다.");
      const row = snap.data();
      if (row.originPlayerId !== playerId) throw new Error("그런 임무를 찾을 수 없습니다.");
      if (row.kind !== "reinforce" || row.phase !== "stationed") throw new Error("지금은 철수시킬 수 없습니다.");
      const now = Date.now();
      const oneWay = row.arriveAt - row.departAt;
      tx.update(ref, { phase: "returning", returnArriveAt: now + oneWay });
      return { ok: true, returnArriveAt: now + oneWay };
    });
  } catch (e) {
    return { error: e.message };
  }
}

// 공격 도착 판정 — 읽기/계산/쓰기를 전부 트랜잭션 안에서 해서, 여러 스윕 실행이 겹쳐도
// (Cloud Scheduler가 재시도하거나 두 인스턴스가 겹치는 경우) phase 재확인으로 한 번만 처리된다.
async function resolveAttack(missionRef) {
  await db.runTransaction(async (tx) => {
    const missionSnap = await tx.get(missionRef);
    if (!missionSnap.exists) return;
    const mission = missionSnap.data();
    if (mission.kind !== "attack" || mission.phase !== "outbound") return; // 이미 다른 스윕이 처리함

    const now = Date.now();
    const originRef = players().doc(mission.originPlayerId);
    const targetRef = players().doc(mission.targetPlayerId);
    const stationedQuery = missions()
      .where("targetPlayerId", "==", mission.targetPlayerId)
      .where("kind", "==", "reinforce")
      .where("phase", "==", "stationed");
    const outboundReinforceQuery = missions()
      .where("targetPlayerId", "==", mission.targetPlayerId)
      .where("kind", "==", "reinforce")
      .where("phase", "==", "outbound");

    const [attackerSnap, defenderSnap, stationedSnap, outboundReinforceSnap] = await Promise.all([
      tx.get(originRef),
      tx.get(targetRef),
      tx.get(stationedQuery),
      tx.get(outboundReinforceQuery),
    ]);

    const reinforcerIds = stationedSnap.docs.map((d) => d.data().originPlayerId);
    const reinforcerSnaps = reinforcerIds.length
      ? await Promise.all(reinforcerIds.map((id) => tx.get(players().doc(id))))
      : [];
    const reinforcerStateById = {};
    reinforcerSnaps.forEach((s, i) => {
      reinforcerStateById[reinforcerIds[i]] = (s.exists && s.data().state) || { owned: {} };
    });

    const attackerState = (attackerSnap.exists && attackerSnap.data().state) || { res: {}, owned: {} };
    const defenderState = (defenderSnap.exists && defenderSnap.data().state) || {
      res: {}, troopsByType: {}, armies: [], owned: {},
    };

    const attackerStats = armyCombatStats(mission.comp, mission.heroIds, attackerState.owned || {});
    const defenderHomeComp = { ...(defenderState.troopsByType || {}) };
    const defenderHomeHeroIds = idleSquadHeroIds(defenderState);
    const defenderHomeStats = armyCombatStats(defenderHomeComp, defenderHomeHeroIds, defenderState.owned || {});

    const reinforcements = stationedSnap.docs.map((d) => {
      const r = d.data();
      const ownerState = reinforcerStateById[r.originPlayerId] || { owned: {} };
      return { ref: d.ref, comp: r.comp, stats: armyCombatStats(r.comp, r.heroIds, ownerState.owned || {}) };
    });

    const defenderStats = sumStats([defenderHomeStats, ...reinforcements.map((r) => r.stats)]);
    const verdict = pvpVerdict(attackerStats, defenderStats, PVP_BATTLE_DURATION_SECONDS);

    const attackerCasualty = applyCasualties(mission.comp, verdict.attackerLossRatio);
    const defenderHomeCasualty = applyCasualties(defenderHomeComp, verdict.defenderLossRatio);

    let reinforcementLostTotal = 0;
    const reinforcementUpdates = reinforcements.map((r) => {
      const c = applyCasualties(r.comp, verdict.defenderLossRatio);
      reinforcementLostTotal += c.totalLost;
      const wiped = Object.values(c.survivors).every((v) => v <= 0);
      return { ref: r.ref, wiped, survivors: c.survivors };
    });

    const nextDefenderState = { ...defenderState, troopsByType: defenderHomeCasualty.survivors };
    const nextAttackerState = { ...attackerState };
    let loot = null;
    if (verdict.attackerWins) {
      loot = {};
      nextAttackerState.res = { ...(nextAttackerState.res || {}) };
      nextDefenderState.res = { ...(nextDefenderState.res || {}) };
      ["food", "wood", "stone", "gold"].forEach((res) => {
        const have = Math.max(0, Math.floor(nextDefenderState.res[res] || 0));
        const taken = Math.floor(have * LOOT_PERCENT);
        if (taken > 0) {
          loot[res] = taken;
          nextDefenderState.res[res] = have - taken;
          nextAttackerState.res[res] = (nextAttackerState.res[res] || 0) + taken;
        }
      });
    }

    const returnDuration = mission.arriveAt - mission.departAt;
    const result = {
      attackerWins: verdict.attackerWins,
      attackerLost: attackerCasualty.totalLost,
      defenderLost: defenderHomeCasualty.totalLost + reinforcementLostTotal,
      loot,
      resolvedAt: now,
    };

    // ---- 여기부터 쓰기만 (Firestore 트랜잭션 규칙: 읽기는 전부 위에서 끝나야 함) ----
    tx.set(targetRef, { state: nextDefenderState }, { merge: true });
    tx.set(originRef, { state: nextAttackerState }, { merge: true });
    reinforcementUpdates.forEach(({ ref, wiped, survivors }) => {
      if (wiped) tx.delete(ref);
      else tx.update(ref, { comp: survivors });
    });
    // 공격이 먼저 도착했으므로, 이 타깃을 향해 아직 도착 못한 지원군은 전부 철수(왕복 대칭)
    outboundReinforceSnap.docs.forEach((d) => {
      const r = d.data();
      const oneWay = r.arriveAt - r.departAt;
      tx.update(d.ref, { phase: "returning", returnArriveAt: now + oneWay });
    });
    tx.update(missionRef, {
      phase: "returning",
      comp: attackerCasualty.survivors,
      returnArriveAt: now + returnDuration,
      result,
    });
  });
}

async function arriveReinforcement(missionRef) {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(missionRef);
    if (!snap.exists) return;
    const mission = snap.data();
    if (mission.kind !== "reinforce" || mission.phase !== "outbound") return; // 이미 처리됨
    tx.update(missionRef, { phase: "stationed" });
  });
}

async function completeReturn(missionRef) {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(missionRef);
    if (!snap.exists) return;
    const mission = snap.data();
    if (mission.phase !== "returning") return; // 이미 처리됨
    const originRef = players().doc(mission.originPlayerId);
    const originSnap = await tx.get(originRef);
    if (originSnap.exists && originSnap.data().state) {
      const state = originSnap.data().state;
      const nextTroops = { ...(state.troopsByType || {}) };
      Object.entries(mission.comp || {}).forEach(([key, count]) => {
        nextTroops[key] = (nextTroops[key] || 0) + count;
      });
      tx.set(originRef, { state: { ...state, troopsByType: nextTroops } }, { merge: true });
    }
    tx.delete(missionRef);
  });
}

// Cloud Scheduler(1분 주기, scheduled/sweep.js)에서 호출한다. 원본은 5초 주기였으나
// Cloud Scheduler 최소 간격이 1분이라 도착 판정 정밀도가 낮아지는 트레이드오프가 있다
// (DEV_PLAN.md에 후속 개선 과제로 남김 — 필요해지면 미션별 정확한 도착 시각에 맞춰
// Cloud Tasks를 예약하는 방식으로 승격할 수 있다).
async function sweepOnce() {
  const now = Date.now();
  const [attacksSnap, reinforceArrivedSnap, returningSnap] = await Promise.all([
    missions().where("kind", "==", "attack").where("phase", "==", "outbound").where("arriveAt", "<=", now).get(),
    missions().where("kind", "==", "reinforce").where("phase", "==", "outbound").where("arriveAt", "<=", now).get(),
    missions().where("phase", "==", "returning").where("returnArriveAt", "<=", now).get(),
  ]);

  for (const doc of attacksSnap.docs) {
    try { await resolveAttack(doc.ref); } catch (e) { console.error("[pvp] resolveAttack 실패:", e); }
  }
  for (const doc of reinforceArrivedSnap.docs) {
    try { await arriveReinforcement(doc.ref); } catch (e) { console.error("[pvp] arriveReinforcement 실패:", e); }
  }
  for (const doc of returningSnap.docs) {
    try { await completeReturn(doc.ref); } catch (e) { console.error("[pvp] completeReturn 실패:", e); }
  }
}

module.exports = { dispatch, recall, myMissions, sweepOnce };
