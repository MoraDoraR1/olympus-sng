import { test } from "node:test";
import assert from "node:assert/strict";

import { TROOP_BY_KEY } from "../src/lib/troops.js";
import { HEROES, HERO_BY_ID } from "../src/lib/heroes.js";
import { chebyshevDistance, travelTimeSeconds, armySpeedMultiplier } from "../src/lib/movement.js";
import { armyCombatStats, pvpVerdict, applyCasualties, LOOT_PERCENT } from "../src/lib/combat.js";
import { checkStatePush } from "../src/lib/anticheat.js";

test("heroes.js 300명 그대로 로드된다", () => {
  assert.equal(HEROES.length, 300);
  assert.ok(HERO_BY_ID[300]);
  assert.equal(HERO_BY_ID[300].secret, true);
});

test("troops.js 5종 병종 수치가 SYSTEM_DESIGN.md와 일치", () => {
  assert.equal(TROOP_BY_KEY.militia.atk, 2);
  assert.equal(TROOP_BY_KEY.ares_champion.speed, 1.6);
  assert.equal(Object.keys(TROOP_BY_KEY).length, 5);
});

test("movement: 인접 타일 편도 60초 기준선 + 헤르메스 조합 30초", () => {
  const dist = chebyshevDistance({ x: 0, y: 0 }, { x: 1, y: 0 });
  assert.equal(dist, 1);
  assert.equal(travelTimeSeconds(dist, 1.0), 60);

  const hermes = HEROES.find((h) => h.name === "헤르메스");
  assert.ok(hermes);
  const mult = armySpeedMultiplier({ ares_champion: 5 }, [hermes.id], {});
  assert.ok(Math.abs(mult - 2.016) < 0.001);
  assert.equal(travelTimeSeconds(1, mult), 30);
});

test("combat: 압도적 전력차에서는 승자가 손실 상한(60%) 안에 머문다", () => {
  const attacker = armyCombatStats({ ares_champion: 50 }, [], {});
  const defender = armyCombatStats({ militia: 5 }, [], {});
  const verdict = pvpVerdict(attacker, defender, 10);
  assert.equal(verdict.attackerWins, true);
  assert.ok(verdict.attackerLossRatio <= 0.6);
  assert.ok(verdict.defenderLossRatio <= 1.0);
});

test("combat: applyCasualties/약탈률", () => {
  const { survivors, losses, totalLost } = applyCasualties({ militia: 10 }, 1.5);
  assert.equal(losses.militia, 10);
  assert.equal(survivors.militia, 0);
  assert.equal(totalLost, 10);
  assert.equal(LOOT_PERCENT, 0.1);
});

test("anticheat: 정상 증가 통과, 비정상 증가 거부, 레이드 보상은 허용", () => {
  const now = Date.now();

  const okRow = { state_json: JSON.stringify({ res: { food: 100, wood: 100, stone: 100, gold: 100 }, troopsByType: {}, raids: {} }), updated_at: now - 10000 };
  const okNext = { res: { food: 150, wood: 100, stone: 100, gold: 100 }, troopsByType: {}, raids: {} };
  assert.equal(checkStatePush({ prevRow: okRow, createdAt: now - 10000, nextState: okNext, now }).ok, true);

  const badNext = { res: { food: 100000000, wood: 100, stone: 100, gold: 100 }, troopsByType: {}, raids: {} };
  assert.equal(checkStatePush({ prevRow: okRow, createdAt: now - 10000, nextState: badNext, now }).ok, false);

  const raidRow = { state_json: JSON.stringify({ res: { food: 100, wood: 100, stone: 100, gold: 100 }, troopsByType: {}, raids: { medusa: { defeated: false, lastDefeatedAt: null } } }), updated_at: now - 5000 };
  const raidNext = { res: { food: 50100, wood: 100, stone: 100, gold: 30100 }, troopsByType: {}, raids: { medusa: { defeated: true, lastDefeatedAt: now } } };
  assert.equal(checkStatePush({ prevRow: raidRow, createdAt: now - 5000, nextState: raidNext, now }).ok, true);
});
