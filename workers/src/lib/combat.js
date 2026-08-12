// server-legacy/src/combat.js ESM 이식.
import { HERO_BY_ID } from "./heroes.js";
import { TROOP_BY_KEY } from "./troops.js";

// PvP 전투는 고정 길이 교전으로 취급한다(필드 몬스터/월드맵 성처럼 "레벨"이 없어
// game.js의 battleDurationFor(level)을 그대로 쓸 수 없다).
export const PVP_BATTLE_DURATION_SECONDS = 10;
// 공격자가 승리 시 약탈해가는 방어자 보유 자원의 비율.
export const LOOT_PERCENT = 0.1;

// game.js의 armyStats()를 서버에서도 그대로 계산할 수 있도록 이식한 버전.
// 연구(troopPercent)와 방어탑/성벽 보너스는 포함하지 않는다 — 이 함수는 공격/지원
// 부대(양쪽 모두 원정 중)의 기본 전투력만 계산하고, 방어탑/성벽은 수성 측에만
// resolveAttack()에서 별도로 적용한다(homeDefenseMultiplier/wallFlatDefense 참고).
export function armyCombatStats(comp, heroIds, ownedById) {
  let troopAtk = 0, troopDef = 0, troopHp = 0;
  Object.entries(comp || {}).forEach(([key, count]) => {
    const t = TROOP_BY_KEY[key];
    if (!t || !count) return;
    troopAtk += t.atk * count;
    troopDef += t.def * count;
    troopHp += t.hp * count;
  });
  let heroAtk = 0, heroDef = 0, heroHp = 0;
  const bonus = { atk: 0, def: 0, hp: 0 };
  (heroIds || []).filter(Boolean).forEach((id) => {
    const hero = HERO_BY_ID[id];
    if (!hero) return;
    const enhance = ((ownedById || {})[id] || {}).enhance || 0;
    const scale = 1 + 0.15 * enhance;
    heroAtk += hero.atk * scale;
    heroDef += hero.def * scale;
    heroHp += hero.hp * scale;
    hero.traits.filter((t) => t.type === "combat").forEach((t) => { bonus[t.statKey] += t.percent * scale; });
  });
  troopAtk *= 1 + bonus.atk / 100;
  troopDef *= 1 + bonus.def / 100;
  troopHp *= 1 + bonus.hp / 100;
  return { atk: heroAtk + troopAtk, def: heroDef + troopDef, hp: heroHp + troopHp };
}

export function sumStats(list) {
  return list.reduce((s, a) => ({ atk: s.atk + a.atk, def: s.def + a.def, hp: s.hp + a.hp }), { atk: 0, def: 0, hp: 0 });
}

// 부대의 총 수송력 — game.js의 armyCarryCapacity()와 동일한 공식(병종별 capacity×인원
// 합산 x (1 + 영웅 cargo 특성 합산%/100)). PvP 약탈량의 상한으로 쓰인다.
export function armyCarryCapacity(comp, heroIds, ownedById) {
  let base = 0;
  Object.entries(comp || {}).forEach(([key, count]) => {
    const t = TROOP_BY_KEY[key];
    if (!t || !count) return;
    base += t.capacity * count;
  });
  let bonus = 0;
  (heroIds || []).filter(Boolean).forEach((id) => {
    const hero = HERO_BY_ID[id];
    if (!hero) return;
    const enhance = ((ownedById || {})[id] || {}).enhance || 0;
    hero.traits.filter((t) => t.type === "cargo").forEach((t) => { bonus += t.percent * (1 + 0.15 * enhance); });
  });
  return Math.round(base * (1 + bonus / 100));
}

// 이긴 쪽은 최대 60%까지만, 진 쪽은 최대 100%까지 손실.
export function pvpVerdict(attackerStats, defenderStats, duration) {
  const dmgToDefender = Math.max(1, attackerStats.atk - defenderStats.def * 0.5) * duration;
  const dmgToAttacker = Math.max(1, defenderStats.atk - attackerStats.def * 0.3) * duration;
  const attackerRatio = dmgToDefender / Math.max(1, defenderStats.hp);
  const defenderRatio = dmgToAttacker / Math.max(1, attackerStats.hp);
  const attackerWins = attackerRatio >= 1;
  const attackerLossRatio = attackerWins ? Math.min(0.6, defenderRatio) : Math.min(1, defenderRatio);
  const defenderLossRatio = attackerWins ? Math.min(1, attackerRatio) : Math.min(0.6, attackerRatio);
  return { attackerWins, attackerRatio, defenderRatio, attackerLossRatio, defenderLossRatio };
}

export function applyCasualties(comp, lossRatio) {
  const survivors = {};
  const losses = {};
  let totalLost = 0;
  Object.entries(comp || {}).forEach(([key, count]) => {
    const lost = Math.min(count, Math.round(count * lossRatio));
    losses[key] = lost;
    totalLost += lost;
    survivors[key] = Math.max(0, count - lost);
  });
  return { survivors, losses, totalLost };
}

// ---------- 수성 전용 건물 보너스(방어탑/성벽/자원보호소) ----------
// game.js의 BUILDING_TYPES 기준값과 동일(수치 변경 없음) — 방어탑/성벽은 noHeroBonus가
// 아니라 영웅 배치가 가능하므로(자원보호소는 noHeroBonus라 항상 0), 배치된 영웅의
// building 특성(대상 건물이 일치할 때)도 함께 합산한다.
const TOWER_BASE_DEFENSE = 4;
const WALL_BASE_DEFENSE = 15;
const SHELTER_PROTECT_PER_LEVEL = 200; // 레벨당 자원 종류별 약탈 방지량(1차 조정값)
// 방어탑 연구(defensePercent 효과, game.js RESEARCH_DEFS와 동일한 id/수치) — 연구 트리
// 전체를 서버에 이식하기엔 과하므로, 이 계산에 필요한 부분만 발췌해 미러링한다.
const DEFENSE_PERCENT_RESEARCH = { combat1: 3, combat2: 5, combat4: 5, combat5: 6, combat7: 7, combat9: 8, combat10: 10 };

function researchDefensePercent(state) {
  const research = (state && state.research) || {};
  return Object.entries(DEFENSE_PERCENT_RESEARCH).reduce((sum, [id, pct]) => sum + pct * (research[id] || 0), 0);
}

// tileId에 배치된 영웅들의 building 특성 중 buildingType과 일치하는 것만 합산한 %.
// game.js의 bonusPercentFor()/heroBuildingBonusFor()와 동일한 계산.
function heroBuildingBonusPercent(state, tileId, buildingType) {
  const tile = ((state && state.tiles) || {})[tileId];
  if (!tile || !Array.isArray(tile.heroIds)) return 0;
  let total = 0;
  tile.heroIds.forEach((heroId) => {
    const hero = HERO_BY_ID[heroId];
    if (!hero) return;
    const enhance = ((state.owned || {})[heroId] || {}).enhance || 0;
    hero.traits
      .filter((t) => t.type === "building" && t.building === buildingType)
      .forEach((t) => { total += t.percent * (1 + 0.15 * enhance); });
  });
  return total;
}

// 방어탑: 정복 맵에서 공격받을 때(수성) 방어 스탯에 곱해지는 배수. game.js의
// homeDefenseBonusPercent()와 동일한 공식 — 레벨×연구만 반영(영웅 보너스 없음,
// 방어탑은 noHeroBonus 건물).
export function homeDefenseMultiplier(state) {
  const tower = ((state && state.tiles) || {}).defense;
  if (!tower || !tower.built) return 1;
  const researchMult = 1 + researchDefensePercent(state) / 100;
  const pct = Math.round(tower.level * TOWER_BASE_DEFENSE * researchMult * 10) / 10;
  return 1 + pct / 100;
}

// 성벽: 정복 맵에서 공격받을 때(수성) 방어 스탯에 고정으로 더해지는 값(배수가 아니라
// 가산 — 방어탑과 역할을 구분). game.js의 wallScore()와 동일한 공식.
export function wallFlatDefense(state) {
  const wall = ((state && state.tiles) || {}).wall;
  if (!wall || !wall.built) return 0;
  const heroBonus = heroBuildingBonusPercent(state, "wall", "성벽");
  return Math.round(wall.level * WALL_BASE_DEFENSE * (1 + heroBonus / 100));
}

// 자원보호소: 공격받아 약탈당할 때 자원 종류별로 이 값까지는 약탈 대상에서 제외된다.
export function shelterProtectedAmount(state) {
  const storage = ((state && state.tiles) || {}).storage;
  if (!storage || !storage.built) return 0;
  const heroBonus = heroBuildingBonusPercent(state, "storage", "자원보호소");
  return Math.round(storage.level * SHELTER_PROTECT_PER_LEVEL * (1 + heroBonus / 100));
}
