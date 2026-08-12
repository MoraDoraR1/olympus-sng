// server-legacy/src/movement.js ESM 이식.
import { HERO_BY_ID } from "./heroes.js";
import { TROOP_BY_KEY } from "./troops.js";

// 정복 맵은 200x200이라 대각선 최장 거리가 199칸 — 최저속도(민병대, speed=1) 기준으로도
// 맨 끝에서 맨 끝까지 1시간을 넘지 않도록 18초/칸으로 맞췄다(199×18=3,582초=59.7분).
export const BASE_SECONDS_PER_TILE = 18;

function heroTraitPercent(hero, trait, enhance) {
  return trait.percent * (1 + 0.15 * (enhance || 0));
}

// comp: { troopKey: count, ... }, heroIds: 이 출정에 데려가는 영웅 id 배열,
// enhanceByHeroId: { heroId: enhanceLevel } — state.owned에서 가져온다.
export function armySpeedMultiplier(comp, heroIds, enhanceByHeroId) {
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

export function chebyshevDistance(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function travelTimeSeconds(distanceTiles, speedMultiplier) {
  return Math.max(1, Math.round((distanceTiles * BASE_SECONDS_PER_TILE) / Math.max(0.01, speedMultiplier)));
}
