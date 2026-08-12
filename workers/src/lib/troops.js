// server-legacy/src/troops.js를 ESM으로만 이식(수치 변경 없음). game.js의 TROOP_TYPES와
// 반드시 같은 값을 유지해야 한다 — 이동시간(movement.js)과 전투력(combat.js) 계산이 이 표만 본다.
export const TROOP_TYPES = [
  { key: "militia", atk: 2, def: 1.5, hp: 6, speed: 1, trainSeconds: 3 },
  { key: "hoplite", atk: 4.5, def: 4, hp: 12.5, speed: 1.1, trainSeconds: 6 },
  { key: "spartan", atk: 8, def: 6.5, hp: 21, speed: 1.25, trainSeconds: 10 },
  { key: "myrmidon", atk: 13, def: 10, hp: 31, speed: 1.4, trainSeconds: 16 },
  { key: "ares_champion", atk: 22, def: 16, hp: 50, speed: 1.6, trainSeconds: 24 },
];
export const TROOP_BY_KEY = Object.fromEntries(TROOP_TYPES.map((t) => [t.key, t]));
