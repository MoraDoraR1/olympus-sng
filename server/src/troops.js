"use strict";
// game.js의 TROOP_TYPES를 그대로 옮겨왔다 — 이동시간(movement.js)과 전투력(combat.js)
// 계산 둘 다 여기 하나만 참조한다. game.js에서 병종 스탯/speed를 바꾸면 이 표도
// 같이 맞춰야 한다(불변 상수라 자주 바뀌지 않아 별도 자동 동기화 없이 손으로 맞춘다).
const TROOP_TYPES = [
  { key: "militia", atk: 2, def: 1.5, hp: 6, speed: 1 },
  { key: "hoplite", atk: 4.5, def: 4, hp: 12.5, speed: 1.1 },
  { key: "spartan", atk: 8, def: 6.5, hp: 21, speed: 1.25 },
  { key: "myrmidon", atk: 13, def: 10, hp: 31, speed: 1.4 },
  { key: "ares_champion", atk: 22, def: 16, hp: 50, speed: 1.6 },
];
const TROOP_BY_KEY = Object.fromEntries(TROOP_TYPES.map((t) => [t.key, t]));

module.exports = { TROOP_TYPES, TROOP_BY_KEY };
