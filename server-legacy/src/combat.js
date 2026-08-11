"use strict";
const { HERO_BY_ID } = require("./heroes");
const { TROOP_BY_KEY } = require("./troops");

// PvP 전투는 고정 길이 교전으로 취급한다(필드 몬스터/월드맵 성처럼 "레벨"이 없어
// game.js의 battleDurationFor(level)을 그대로 쓸 수 없다).
const PVP_BATTLE_DURATION_SECONDS = 10;
// 공격자가 승리 시 약탈해가는 방어자 보유 자원의 비율(요청서에 구체적 수치가 없어
// 임의로 정함 — 다른 SNG 게임들의 일반적인 PvP 약탈 관례를 참고).
const LOOT_PERCENT = 0.1;

// game.js의 armyStats()를 서버에서도 그대로 계산할 수 있도록 이식한 버전.
// 단, 연구(research) 보너스와 방어탑(expeditionBonusPercent)은 포함하지 않는다 —
// RESEARCH_DEFS 전체(30개 항목)를 서버로 옮기는 건 이번 범위를 벗어난다고 판단해
// PvP 전투력은 "영웅+병사" 기본 스탯만으로 계산한다(공평하게 양쪽 다 동일 기준).
function armyCombatStats(comp, heroIds, ownedById) {
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

function sumStats(list) {
  return list.reduce((s, a) => ({ atk: s.atk + a.atk, def: s.def + a.def, hp: s.hp + a.hp }), { atk: 0, def: 0, hp: 0 });
}

// game.js의 computeVerdict/resolveBattle 손실 공식을 양쪽에 대칭으로 적용한 버전 —
// 이긴 쪽은 최대 60%까지만, 진 쪽은 최대 100%까지 손실(같은 승/패 비대칭을 양쪽에 그대로 적용).
function pvpVerdict(attackerStats, defenderStats, duration) {
  const dmgToDefender = Math.max(1, attackerStats.atk - defenderStats.def * 0.5) * duration;
  const dmgToAttacker = Math.max(1, defenderStats.atk - attackerStats.def * 0.3) * duration;
  const attackerRatio = dmgToDefender / Math.max(1, defenderStats.hp);
  const defenderRatio = dmgToAttacker / Math.max(1, attackerStats.hp);
  const attackerWins = attackerRatio >= 1;
  const attackerLossRatio = attackerWins ? Math.min(0.6, defenderRatio) : Math.min(1, defenderRatio);
  const defenderLossRatio = attackerWins ? Math.min(1, attackerRatio) : Math.min(0.6, attackerRatio);
  return { attackerWins, attackerRatio, defenderRatio, attackerLossRatio, defenderLossRatio };
}

function applyCasualties(comp, lossRatio) {
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

module.exports = {
  PVP_BATTLE_DURATION_SECONDS,
  LOOT_PERCENT,
  armyCombatStats,
  sumStats,
  pvpVerdict,
  applyCasualties,
};
