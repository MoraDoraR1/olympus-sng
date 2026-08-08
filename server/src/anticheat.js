"use strict";
// PUT /api/state는 클라이언트가 계산한 게임 상태 스냅샷을 통째로 받아 저장한다.
// 이 파일은 그 스냅샷이 "물리적으로 가능한 범위"를 넘는 자원/병사 증가를 담고
// 있으면 거부한다 — game.js를 서버가 완전히 다시 계산하는 권위 있는 구조가
// 아니므로 완벽한 차단은 아니다(건물 레벨·영웅 강화·연구 등은 이 검사 대상이
// 아니고, 레이드 승리도 실제로 전투가 일어났는지는 검증하지 못한다). 다만
// "저장 한 번에 자원을 임의의 큰 수로 바꿔치기" 같은 명백한 조작은 막는다.
const RES_KEYS = ["food", "wood", "stone", "gold"];
const TROOP_TYPES = require("./troops").TROOP_TYPES;

// game.js TILE_LAYOUT의 plot 슬롯 수(선택 가능 부지) — 이론상 전부를 자원 생산
// 건물 하나의 종류로만 채웠을 때를 상한으로 잡는다(실제로는 병영/농장/벌목장/
// 채석장이 나뉘어야 하므로 이보다 항상 낮다 — 일부러 넉넉하게 잡은 상한).
const MAX_PLOTS = 14;
// 레벨·영웅 배치 보너스·연구 보너스를 다 곱해도 이 정도를 넘지 않을 것이라 보는
// 넉넉한 상한(레벨 80, 총 보너스 배율 4배 가정) — game.js의 정확한 공식을 그대로
// 옮기지 않고 일부러 여유 있게 잡았다.
const GENEROUS_LEVEL = 80;
const GENEROUS_MULT = 4;
const RES_BASE_PER_TILE = { food: 1.2, wood: 1.2, stone: 0.9, gold: 0 };
const RES_MAX_PER_SECOND = {
  food: RES_BASE_PER_TILE.food * MAX_PLOTS * GENEROUS_LEVEL * GENEROUS_MULT,
  wood: RES_BASE_PER_TILE.wood * MAX_PLOTS * GENEROUS_LEVEL * GENEROUS_MULT,
  stone: RES_BASE_PER_TILE.stone * MAX_PLOTS * GENEROUS_LEVEL * GENEROUS_MULT,
  // 금은 성(고정 1칸, base 0.35)과 여관(고정 1칸, base 0.6)만 생산한다.
  gold: (0.35 + 0.6) * GENEROUS_LEVEL * GENEROUS_MULT,
};
// 몬스터 처치 보상(최대 레벨 30 기준 약 12,400/종류) 등 "생산" 외의 작은 일회성
// 획득을 흡수하기 위한 저장 1회당 flat 여유분. 가장 작은 레이드 보상(medusa,
// 50000)보다는 확실히 작게 잡아야 한다 — 그래야 "레이드 상태 전이 없이 5만
// 자원만 슬쩍 늘리기"가 이 여유분만으로 통과되지 않는다. 레이드 보상처럼 큰
// 일회성 획득은 아래에서 raids 상태 변화를 직접 대조해 별도로 허용한다.
const MISC_RES_GRACE = 20000;
const TROOP_GRACE = 20;
// 오프라인 진행 상한(game.js OFFLINE_CAP_SECONDS와 동일) — 이보다 오래 저장이
// 없었어도 클라이언트가 실제로 시뮬레이션하는 시간은 이 이상 늘지 않는다.
const OFFLINE_CAP_SECONDS = 12 * 3600;
// 첫 저장(이전 기록 없음) 때 기준으로 삼는 game.js freshState()의 시작 자원.
const FRESH_RES = { food: 80, wood: 80, stone: 60, gold: 150 };

// game.js RAID_BOSSES의 보상 부분만 옮겨왔다 — "레이드를 막 깼다"는 상태 전이를
// 감지했을 때 그 보스의 실제 보상만큼만 특별히 허용해주기 위함(그 외의 큰 증가는
// 여전히 거부된다). 보스 목록이 바뀌면 이 표도 같이 맞춰야 한다.
const RAID_REWARDS = {
  medusa: { resourceAmount: 50000, goldBonus: 30000 },
  hydra: { resourceAmount: 120000, goldBonus: 72000 },
  cerberus: { resourceAmount: 250000, goldBonus: 150000 },
  echidna: { resourceAmount: 500000, goldBonus: 300000 },
  typhon: { resourceAmount: 800000, goldBonus: 480000 },
  cronus: { resourceAmount: 1200000, goldBonus: 720000 },
};

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// prevState/nextState의 raids가 defeated:false -> true로 바뀐 보스마다, 그
// 보상만큼을 이번 저장에서 추가로 허용되는 자원/골드 여유분에 더한다.
function raidRewardAllowance(prevState, nextState) {
  const allowance = { food: 0, wood: 0, stone: 0, gold: 0 };
  const prevRaids = (prevState && prevState.raids) || {};
  const nextRaids = (nextState && nextState.raids) || {};
  Object.keys(RAID_REWARDS).forEach((bossId) => {
    const wasDefeated = !!(prevRaids[bossId] && prevRaids[bossId].defeated);
    const nowDefeated = !!(nextRaids[bossId] && nextRaids[bossId].defeated);
    if (!wasDefeated && nowDefeated) {
      const r = RAID_REWARDS[bossId];
      // 보상 자원의 종류는 처치 시점에 무작위라 서버가 알 수 없으므로, 네 종류
      // 전부에 그 양만큼 여유를 준다(어차피 실제로는 그중 하나만 오르므로 안전).
      RES_KEYS.forEach((key) => { allowance[key] += r.resourceAmount; });
      allowance.gold += r.goldBonus;
    }
  });
  return allowance;
}

// 이전 저장이 아예 없을 때(첫 동기화) 비교 기준으로 쓸 가상의 "직전 상태".
function freshBaseline(createdAt) {
  return {
    prevState: { res: { ...FRESH_RES }, troopsByType: {}, raids: {} },
    prevUpdatedAt: createdAt,
  };
}

// { ok:true } 또는 { ok:false, error }를 반환한다. prevRow가 없으면(첫 저장)
// createdAt(플레이어 가입 시각)을 기준 시각으로 쓴다.
function checkStatePush({ prevRow, createdAt, nextState, now }) {
  let prevState, prevUpdatedAt;
  if (prevRow) {
    try { prevState = JSON.parse(prevRow.state_json); } catch { return { ok: true }; } // 기존 저장을 못 읽으면 검증을 건너뜀(차단이 목적이 아니라 조작 방지가 목적)
    prevUpdatedAt = prevRow.updated_at;
  } else {
    ({ prevState, prevUpdatedAt } = freshBaseline(createdAt || now));
  }

  const elapsedSeconds = Math.max(0, Math.min(OFFLINE_CAP_SECONDS, (now - prevUpdatedAt) / 1000));
  const raidAllowance = raidRewardAllowance(prevState, nextState);

  const prevRes = (prevState && prevState.res) || {};
  const nextRes = (nextState && nextState.res) || {};
  for (const key of RES_KEYS) {
    const delta = num(nextRes[key]) - num(prevRes[key]);
    if (delta <= 0) continue;
    const allowed = RES_MAX_PER_SECOND[key] * elapsedSeconds + MISC_RES_GRACE + raidAllowance[key];
    if (delta > allowed) {
      return { ok: false, error: `자원(${key}) 증가량이 비정상적으로 큽니다. 저장을 거부합니다.` };
    }
  }

  const prevTroops = (prevState && prevState.troopsByType) || {};
  const nextTroops = (nextState && nextState.troopsByType) || {};
  for (const t of TROOP_TYPES) {
    const delta = num(nextTroops[t.key]) - num(prevTroops[t.key]);
    if (delta <= 0) continue;
    const allowed = (MAX_PLOTS / t.trainSeconds) * elapsedSeconds + TROOP_GRACE;
    if (delta > allowed) {
      return { ok: false, error: `병사(${t.key}) 증가량이 비정상적으로 큽니다. 저장을 거부합니다.` };
    }
  }

  return { ok: true };
}

module.exports = { checkStatePush };
