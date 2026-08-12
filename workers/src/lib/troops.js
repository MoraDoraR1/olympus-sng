// server-legacy/src/troops.js를 ESM으로만 이식. game.js의 TROOP_TYPES와 반드시 같은
// 값을 유지해야 한다 — 이동시간(movement.js)·전투력(combat.js)·수송력(combat.js
// armyCarryCapacity) 계산이 이 표만 본다.
// capacity: 병종 1명이 약탈 시 운반할 수 있는 자원량(수송량). 수송병/마차는 전투력은
// 약하지만 capacity가 훨씬 커서, 순수 전투 병종과 역할이 갈린다.
export const TROOP_TYPES = [
  { key: "militia", atk: 2, def: 1.5, hp: 6, speed: 1, trainSeconds: 3, capacity: 20 },
  { key: "transport", atk: 1, def: 1, hp: 8, speed: 1.05, trainSeconds: 5, capacity: 150 },
  { key: "hoplite", atk: 4.5, def: 4, hp: 12.5, speed: 1.1, trainSeconds: 6, capacity: 35 },
  { key: "spartan", atk: 8, def: 6.5, hp: 21, speed: 1.25, trainSeconds: 10, capacity: 55 },
  { key: "myrmidon", atk: 13, def: 10, hp: 31, speed: 1.4, trainSeconds: 16, capacity: 80 },
  { key: "wagon", atk: 3, def: 3, hp: 40, speed: 0.9, trainSeconds: 45, capacity: 600 },
  { key: "ares_champion", atk: 22, def: 16, hp: 50, speed: 1.6, trainSeconds: 24, capacity: 110 },
];
export const TROOP_BY_KEY = Object.fromEntries(TROOP_TYPES.map((t) => [t.key, t]));
