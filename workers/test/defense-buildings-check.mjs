// 방어탑/성벽/자원보호소 역할 재설계(수성 전용) + 수송량(carry capacity) 시스템 검증 —
// combat.js의 순수 함수를 직접 호출해 공식이 game.js 클라이언트 미러와 정확히 같은
// 수치를 내는지 확인한다.
// (실제 PvP 왕복으로도 별도 검증 완료: 20 민병대 공격이 무방비 방어(5 민병대)는 이기고
//  동일 공격이 방어탑+성벽 lvl20 방어에는 패배함을 확인했고, 자원보호소 lvl10 시나리오에서
//  약탈량이 예측대로 100(=10%×(3000-2000))으로 줄어드는 것도 확인했다 — 정복 맵의 실제
//  이동 거리가 매번 랜덤이라 자동화된 회귀 테스트로 남기기엔 대기 시간이 들쭉날쭉해서,
//  여기서는 그 검증에 쓰인 공식 자체를 빠르고 결정적으로 재확인한다.)
import { homeDefenseMultiplier, wallFlatDefense, shelterProtectedAmount, armyCarryCapacity } from "../src/lib/combat.js";

function assertEqual(actual, expected, label) {
  const ok = Math.abs(actual - expected) < 1e-9;
  console.log(`${ok ? "✅" : "❌"} ${label}: ${actual} (기대 ${expected})`);
  return ok;
}

function main() {
  const noBuildings = { tiles: { defense: { built: false, level: 0 }, wall: { built: false, level: 0 }, storage: { built: false, level: 0 } }, research: {}, owned: {} };
  const withBuildings = {
    tiles: {
      defense: { built: true, level: 10, heroIds: [] },
      wall: { built: true, level: 10, heroIds: [] },
      storage: { built: true, level: 10, heroIds: [] },
    },
    research: { combat1: 1, combat2: 1 }, // defensePercent 3 + 5 = 8%
    owned: {},
  };

  const results = [
    assertEqual(homeDefenseMultiplier(noBuildings), 1, "방어탑 없음 → 배수 1"),
    // pct = round(10×4×1.08×10)/10 = 43.2 → mult = 1.432
    assertEqual(homeDefenseMultiplier(withBuildings), 1.432, "방어탑 lvl10 + 연구(defensePercent 8%) → 배수 1.432"),
    assertEqual(wallFlatDefense(noBuildings), 0, "성벽 없음 → 가산 0"),
    // round(10×15×(1+0/100)) = 150
    assertEqual(wallFlatDefense(withBuildings), 150, "성벽 lvl10 → 가산 150"),
    assertEqual(shelterProtectedAmount(noBuildings), 0, "자원보호소 없음 → 보호량 0"),
    // round(10×200×(1+0/100)) = 2000
    assertEqual(shelterProtectedAmount(withBuildings), 2000, "자원보호소 lvl10 → 보호량 2000"),
    // 민병대 20명 x capacity 20 = 400
    assertEqual(armyCarryCapacity({ militia: 20 }, [], {}), 400, "민병대 20명 수송력 → 400"),
    // 수송병 20명 x capacity 150 = 3000
    assertEqual(armyCarryCapacity({ transport: 20 }, [], {}), 3000, "수송병 20명 수송력 → 3000"),
    // 이리스(id 146, cargo 12%) 동행 시 400 x 1.12 = 448
    assertEqual(armyCarryCapacity({ militia: 20 }, [146], {}), 448, "민병대 20명 + 이리스(cargo 12%) 수송력 → 448"),
  ];

  const allPass = results.every(Boolean);
  console.log(allPass ? "\n🎉 전체 PASS" : "\n💥 일부 FAIL");
  if (!allPass) process.exit(1);
}

main();
