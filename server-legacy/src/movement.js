"use strict";
const { HERO_BY_ID } = require("./heroes");
const { TROOP_BY_KEY } = require("./troops");

const BASE_SECONDS_PER_TILE = 60;

function heroTraitPercent(hero, trait, enhance) {
  return trait.percent * (1 + 0.15 * (enhance || 0));
}

// comp: { troopKey: count, ... }, heroIds: 이 출정에 데려가는 영웅 id 배열,
// enhanceByHeroId: { heroId: enhanceLevel } — game_states.owned에서 가져온다.
function armySpeedMultiplier(comp, heroIds, enhanceByHeroId) {
  const activeSpeeds = Object.entries(comp || {})
    .filter(([, count]) => count > 0)
    .map(([key]) => (TROOP_BY_KEY[key] || TROOP_BY_KEY.militia).speed);
  const baseSpeed = activeSpeeds.length ? Math.min(...activeSpeeds) : TROOP_BY_KEY.militia.speed;
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

module.exports = { BASE_SECONDS_PER_TILE, armySpeedMultiplier, chebyshevDistance, travelTimeSeconds };
