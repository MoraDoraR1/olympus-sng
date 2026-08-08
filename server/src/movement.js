"use strict";
const { HERO_BY_ID } = require("./heroes");

// game.js의 TROOP_TYPES 중 speed 필드만 그대로 옮겨왔다 — 이동시간 계산은 서버가
// 정답을 가지고 있어야 하므로(공격 대상이 오프라인이어도 정확해야 함) 여기서도 필요하다.
// game.js에서 speed 값을 바꾸면 이 표도 같이 맞춰야 한다.
const TROOP_SPEED = {
  militia: 1,
  hoplite: 1.1,
  spartan: 1.25,
  myrmidon: 1.4,
  ares_champion: 1.6,
};
const BASE_SECONDS_PER_TILE = 60;

function heroTraitPercent(hero, trait, enhance) {
  return trait.percent * (1 + 0.15 * (enhance || 0));
}

// comp: { troopKey: count, ... }, ownedHeroIds: 이 출정에 데려가는 영웅 id 배열,
// enhanceByHeroId: { heroId: enhanceLevel } — game_states.owned에서 가져온다.
function armySpeedMultiplier(comp, heroIds, enhanceByHeroId) {
  const activeSpeeds = Object.entries(comp || {})
    .filter(([, count]) => count > 0)
    .map(([key]) => TROOP_SPEED[key] ?? TROOP_SPEED.militia);
  const baseSpeed = activeSpeeds.length ? Math.min(...activeSpeeds) : TROOP_SPEED.militia;
  let bonus = 0;
  (heroIds || []).filter(Boolean).forEach((id) => {
    const hero = HERO_BY_ID[id];
    if (!hero) return;
    const enhance = (enhanceByHeroId || {})[id] || 0;
    hero.traits.filter((t) => t.type === "movement").forEach((t) => { bonus += heroTraitPercent(hero, t, enhance); });
  });
  return baseSpeed * (1 + bonus / 100);
}

function chebyshevDistance(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function travelTimeSeconds(distanceTiles, speedMultiplier) {
  return Math.max(1, Math.round((distanceTiles * BASE_SECONDS_PER_TILE) / Math.max(0.01, speedMultiplier)));
}

module.exports = { TROOP_SPEED, BASE_SECONDS_PER_TILE, armySpeedMultiplier, chebyshevDistance, travelTimeSeconds };
