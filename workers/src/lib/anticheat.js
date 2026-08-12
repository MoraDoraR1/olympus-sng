// server-legacy/src/anticheat.js ESM 이식 (로직/수치 변경 없음). PUT /api/state에 해당하는
// saveState 라우트가 저장 직전에 호출한다 — "물리적으로 가능한 범위"만 넉넉히 검증하는
// 부분적 완화이고, 건물 레벨·영웅 강화·연구·레이드 실제 여부는 검증하지 않는다(원본과 동일).
import { TROOP_TYPES } from "./troops.js";

const RES_KEYS = ["food", "wood", "stone", "gold"];
const MAX_PLOTS = 14;
const GENEROUS_LEVEL = 80;
const GENEROUS_MULT = 4;
const RES_BASE_PER_TILE = { food: 1.2, wood: 1.2, stone: 0.9, gold: 0 };
const RES_MAX_PER_SECOND = {
  food: RES_BASE_PER_TILE.food * MAX_PLOTS * GENEROUS_LEVEL * GENEROUS_MULT,
  wood: RES_BASE_PER_TILE.wood * MAX_PLOTS * GENEROUS_LEVEL * GENEROUS_MULT,
  stone: RES_BASE_PER_TILE.stone * MAX_PLOTS * GENEROUS_LEVEL * GENEROUS_MULT,
  gold: (0.35 + 0.6) * GENEROUS_LEVEL * GENEROUS_MULT,
};
const MISC_RES_GRACE = 20000;
const TROOP_GRACE = 20;
const OFFLINE_CAP_SECONDS = 12 * 3600;
const FRESH_RES = { food: 80, wood: 80, stone: 60, gold: 150 };

const RAID_REWARDS = {
  medusa: { resourceAmount: 50000, goldBonus: 30000 },
  hydra: { resourceAmount: 120000, goldBonus: 72000 },
  cerberus: { resourceAmount: 250000, goldBonus: 150000 },
  echidna: { resourceAmount: 500000, goldBonus: 300000 },
  typhon: { resourceAmount: 800000, goldBonus: 480000 },
  cronus: { resourceAmount: 1200000, goldBonus: 720000 },
};

const RAID_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const RAID_COOLDOWN_SLACK_MS = 30 * 60 * 1000;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function raidRewardAllowance(prevState, nextState, now) {
  const allowance = { food: 0, wood: 0, stone: 0, gold: 0 };
  const prevRaids = (prevState && prevState.raids) || {};
  const nextRaids = (nextState && nextState.raids) || {};
  Object.keys(RAID_REWARDS).forEach((bossId) => {
    const prevAt = num((prevRaids[bossId] || {}).lastDefeatedAt);
    const nextAt = num((nextRaids[bossId] || {}).lastDefeatedAt);
    if (!(nextAt > prevAt)) return;
    if (nextAt > now + 60000) return;
    if (prevAt > 0 && nextAt - prevAt < RAID_COOLDOWN_MS - RAID_COOLDOWN_SLACK_MS) return;
    const r = RAID_REWARDS[bossId];
    RES_KEYS.forEach((key) => { allowance[key] += r.resourceAmount; });
    allowance.gold += r.goldBonus;
  });
  return allowance;
}

function freshBaseline(createdAt) {
  return {
    prevState: { res: { ...FRESH_RES }, troopsByType: {}, raids: {} },
    prevUpdatedAt: createdAt,
  };
}

// { ok:true } 또는 { ok:false, error }를 반환한다. prevRow가 없으면(첫 저장)
// createdAt(플레이어 가입 시각)을 기준 시각으로 쓴다.
export function checkStatePush({ prevRow, createdAt, nextState, now }) {
  let prevState, prevUpdatedAt;
  if (prevRow) {
    try { prevState = JSON.parse(prevRow.state_json); } catch { return { ok: true }; }
    prevUpdatedAt = prevRow.updated_at;
  } else {
    ({ prevState, prevUpdatedAt } = freshBaseline(createdAt || now));
  }

  const elapsedSeconds = Math.max(0, Math.min(OFFLINE_CAP_SECONDS, (now - prevUpdatedAt) / 1000));
  const raidAllowance = raidRewardAllowance(prevState, nextState, now);

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
