"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { TROOP_BY_KEY } = require("../src/lib/troops");
const { HEROES, HERO_BY_ID } = require("../src/lib/heroes");
const { travelTimeSeconds, chebyshevDistance, armySpeedMultiplier } = require("../src/lib/movement");
const { armyCombatStats, pvpVerdict, applyCasualties, LOOT_PERCENT } = require("../src/lib/combat");
const { checkStatePush } = require("../src/lib/anticheat");

test("heroes.js 300명 그대로 로드된다", () => {
  assert.equal(HEROES.length, 300);
  assert.ok(HERO_BY_ID[300]); // 까미
  assert.equal(HERO_BY_ID[300].secret, true);
});

test("troops.js 5종 병종 수치가 SYSTEM_DESIGN.md와 일치", () => {
  assert.equal(TROOP_BY_KEY.militia.atk, 2);
  assert.equal(TROOP_BY_KEY.ares_champion.speed, 1.6);
  assert.equal(Object.keys(TROOP_BY_KEY).length, 5);
});

test("movement: 인접 타일 편도 60초 기준선", () => {
  const dist = chebyshevDistance({ x: 0, y: 0 }, { x: 1, y: 0 });
  assert.equal(dist, 1);
  assert.equal(travelTimeSeconds(dist, 1.0), 60);
});

test("movement: 헤르메스(+26%) + 아레스의 대전사(speed 1.6) 조합은 배율 2.016 -> 약 30초", () => {
  const hermes = HEROES.find((h) => h.name === "헤르메스");
  assert.ok(hermes, "헤르메스 영웅을 찾을 수 있어야 한다");
  const mult = armySpeedMultiplier({ ares_champion: 5 }, [hermes.id], {});
  assert.ok(Math.abs(mult - 2.016) < 0.001, `기대값 2.016, 실제 ${mult}`);
  const seconds = travelTimeSeconds(1, mult);
  assert.equal(seconds, 30);
});

test("combat: 압도적 전력차에서는 승자가 손실 상한(60%) 안에 머문다", () => {
  const attacker = armyCombatStats({ ares_champion: 50 }, [], {});
  const defender = armyCombatStats({ militia: 5 }, [], {});
  const verdict = pvpVerdict(attacker, defender, 10);
  assert.equal(verdict.attackerWins, true);
  assert.ok(verdict.attackerLossRatio <= 0.6);
  assert.ok(verdict.defenderLossRatio <= 1.0);
});

test("combat: applyCasualties는 count를 넘는 손실을 만들지 않는다", () => {
  const { survivors, losses, totalLost } = applyCasualties({ militia: 10 }, 1.5);
  assert.equal(losses.militia, 10);
  assert.equal(survivors.militia, 0);
  assert.equal(totalLost, 10);
});

test("combat: 약탈률은 10%", () => {
  assert.equal(LOOT_PERCENT, 0.1);
});

test("anticheat: 정상적인 소폭 증가는 통과한다", () => {
  const now = Date.now();
  const prevRow = {
    state_json: JSON.stringify({ res: { food: 100, wood: 100, stone: 100, gold: 100 }, troopsByType: {}, raids: {} }),
    updated_at: now - 10_000,
  };
  const nextState = { res: { food: 150, wood: 100, stone: 100, gold: 100 }, troopsByType: {}, raids: {} };
  const result = checkStatePush({ prevRow, createdAt: now - 10_000, nextState, now });
  assert.equal(result.ok, true);
});

test("anticheat: 물리적으로 불가능한 자원 급증은 거부한다", () => {
  const now = Date.now();
  const prevRow = {
    state_json: JSON.stringify({ res: { food: 100, wood: 100, stone: 100, gold: 100 }, troopsByType: {}, raids: {} }),
    updated_at: now - 10_000,
  };
  const nextState = { res: { food: 100_000_000, wood: 100, stone: 100, gold: 100 }, troopsByType: {}, raids: {} };
  const result = checkStatePush({ prevRow, createdAt: now - 10_000, nextState, now });
  assert.equal(result.ok, false);
});

test("anticheat: 레이드 처치 직후 보상만큼의 급증은 허용한다", () => {
  const now = Date.now();
  const prevRow = {
    state_json: JSON.stringify({
      res: { food: 100, wood: 100, stone: 100, gold: 100 },
      troopsByType: {},
      raids: { medusa: { defeated: false, lastDefeatedAt: null } },
    }),
    updated_at: now - 5_000,
  };
  const nextState = {
    res: { food: 50_100, wood: 100, stone: 100, gold: 30_100 },
    troopsByType: {},
    raids: { medusa: { defeated: true, lastDefeatedAt: now } },
  };
  const result = checkStatePush({ prevRow, createdAt: now - 5_000, nextState, now });
  assert.equal(result.ok, true);
});
