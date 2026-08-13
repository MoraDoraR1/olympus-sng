// 올림포스 도시 — 싱글플레이 SNG 프로토타입
(function () {
  "use strict";

  // ---------- 건물 종류 정의 ----------
  // 자원 생산 기준치는 업그레이드 비용 곡선(levelCostRateForLevel)이 훨씬 빠르게
  // 따라잡히던 문제(자원이 무한정 쌓이고 레벨업에 막힘이 없음)를 완화하기 위해 전반적으로
  // 25% 낮췄다(병사 유지비 도입과 함께 — tick()의 troopUpkeepFoodPerSecond 참고).
  const BUILDING_TYPES = {
    "성": { icon: "🏰", base: { gold: 0.26 }, buildCostGold: null, upgradeCost: { wood: 60, stone: 60 }, fixedOnly: true, desc: "도시의 중심. 전체 건물 슬롯을 해금하고 금화를 생산한다." },
    "병영": { icon: "⚔️", base: {}, buildCostGold: 60, upgradeCost: { wood: 80, food: 40 }, selectable: true, desc: "병사를 훈련한다. 레벨이 오르면 더 강한 병종이 해금된다. 배치된 영웅 특성만큼 훈련 시간이 줄어든다." },
    "농장": { icon: "🌾", base: { food: 0.9 }, buildCostGold: 40, upgradeCost: { wood: 50 }, selectable: true, desc: "식량을 생산한다." },
    "벌목장": { icon: "🪵", base: { wood: 0.9 }, buildCostGold: 40, upgradeCost: { food: 50 }, selectable: true, desc: "목재를 생산한다." },
    "채석장": { icon: "⛏️", base: { stone: 0.68 }, buildCostGold: 70, upgradeCost: { wood: 60, food: 40 }, selectable: true, desc: "석재를 생산한다." },
    "자원보호소": { icon: "📦", base: { capBonus: 0.05 }, buildCostGold: 70, upgradeCost: { wood: 60, stone: 40 }, fixedOnly: true, noHeroBonus: true, desc: "자원 저장 상한을 늘린다. 정복 맵에서 공격받아도 레벨에 비례한 일정량의 자원은 약탈당하지 않는다. 영웅 배치 대상이 아니다." },
    "아카데미": { icon: "📜", base: {}, buildCostGold: 90, upgradeCost: { wood: 80, stone: 80 }, unlocksAscend: true, fixedOnly: true, desc: "연구를 통해 생산·전투·영웅 획득에 영구적인 배율 효과를 얻는다." },
    "방어탑": { icon: "🛡️", base: { defense: 4 }, buildCostGold: 90, upgradeCost: { stone: 100 }, fixedOnly: true, noHeroBonus: true, desc: "영웅 배치 대상이 아니다. 대신 레벨마다 %만큼 정복 맵에서 내가 공격받을 때(수성) 방어력을 강화한다." },
    "감시탑": { icon: "🔭", base: {}, buildCostGold: 70, upgradeCost: { stone: 60, wood: 40 }, fixedOnly: true, noHeroBonus: true, desc: "야생 지역 몬스터의 정보(레벨→상세 스탯)를 공개한다. 영웅 배치 대상이 아니다." },
    "여관": { icon: "🍺", base: { gold: 0.45 }, buildCostGold: 100, upgradeCost: { wood: 50, food: 50 }, isTavern: true, fixedOnly: true, desc: "일정 시간마다 영웅 후보가 등장한다. 금화로 즉시 초기화할 수 있다." },
    "성벽": { icon: "🧱", base: { defense: 15 }, buildCostGold: 120, upgradeCost: { wood: 100, stone: 100 }, fixedOnly: true, desc: "정복 맵에서 내가 공격받을 때(수성) 방어 스탯에 고정 수치로 더해진다." },
  };
  const SELECTABLE_TYPES = Object.keys(BUILDING_TYPES).filter((t) => BUILDING_TYPES[t].selectable);

  // ---------- 건물 스프라이트(절차적 SVG, assets/buildings/) ----------
  const BUILDING_SLUG = {
    "성": "castle", "여관": "tavern", "병영": "barracks", "농장": "farm", "벌목장": "lumber",
    "채석장": "quarry", "자원보호소": "storage", "아카데미": "academy", "방어탑": "defense",
    "감시탑": "watch", "성벽": "wall",
  };
  function spriteTier(level) {
    if (level >= 14) return 3;
    if (level >= 7) return 2;
    return 1;
  }
  function buildingSpriteSrc(type, level) {
    return `assets/buildings/${BUILDING_SLUG[type]}_${spriteTier(level || 1)}.svg`;
  }
  function buildingIconHTML(type, level, cssClass) {
    return `<img class="${cssClass || ""}" src="${buildingSpriteSrc(type, level)}" alt="${type}" />`;
  }

  // 다른 건물 레벨이 조건이 되는 기본적인 선행 관계 (성이 항상 최종 상한선)
  const LEVEL_REQUIREMENTS = {
    "병영": [{ type: "농장", offset: -2 }],
    "채석장": [{ type: "벌목장", offset: -2 }],
    "자원보호소": [{ type: "채석장", offset: -2 }],
    "방어탑": [{ type: "병영", offset: -2 }],
    "감시탑": [{ type: "아카데미", offset: -2 }],
    "여관": [{ type: "아카데미", offset: -3 }],
    "성벽": [{ type: "방어탑", offset: -2 }],
  };

  // 성(castle)만의 특정 레벨 구간 특별 해금 조건 — LEVEL_REQUIREMENTS(다른 건물의
  // "목표 레벨 기준 상대 오프셋")와 달리, 여기는 특정 절대 레벨 도달 시에만 걸리는
  // 이질적인 조건들(건물 절대 레벨, 몬스터 누적 처치 수, 레이드 보스 처치 등)이라
  // 별도 표로 둔다. key: 도달하려는 성 레벨. kind:"buildingLevel"은 해당 타입 건물
  // 중 하나라도 need 이상이면 충족(maxLevelOfType 기준). kind:"monsterKills"는
  // state.monsterKillsSinceGate(직전 몬스터 조건을 소모한 뒤부터 누적) 기준.
  // kind:"raidBossDefeated"는 state.raids[bossId].defeated(영구 플래그) 기준.
  const CASTLE_UNLOCK_GATES = {
    6: [{ kind: "monsterKills", need: 5 }],
    11: [
      { kind: "buildingLevel", type: "아카데미", need: 8 },
      { kind: "buildingLevel", type: "감시탑", need: 5 },
      { kind: "buildingLevel", type: "방어탑", need: 5 },
    ],
    16: [
      { kind: "buildingLevel", type: "농장", need: 13 },
      { kind: "buildingLevel", type: "벌목장", need: 13 },
      { kind: "buildingLevel", type: "채석장", need: 13 },
      { kind: "monsterKills", need: 10 },
    ],
    // 최종 레벨(20) — 지금까지 조건에 쓰이지 않은 병영·여관과, 별도 컨텐츠 축인
    // 레이드 보스를 조합해 앞 단계 조건들과 겹치지 않게 했다.
    20: [
      { kind: "buildingLevel", type: "병영", need: 15 },
      { kind: "buildingLevel", type: "여관", need: 15 },
      { kind: "raidBossDefeated", bossId: "medusa" },
    ],
  };

  // ---------- 왕도풍 타일 배치 (10열 그리드, 20타일 + 성벽) ----------
  // 실사용 폭은 3~8열(6칸)로 좁혀 좌우 1~2열을 잔디 여백으로 남기고, 4개 행에
  // 골고루 나눠 배치한다(이전 버전은 1·3행이 텅 비고 4행에만 몰려 배경과 어긋나 보였다).
  const TILE_LAYOUT = [
    { id: "plot11", type: null, col: 3, row: 1 },
    { id: "defense", type: "방어탑", col: 4, row: 1 },
    { id: "watch", type: "감시탑", col: 7, row: 1 },
    { id: "plot12", type: null, col: 8, row: 1 },
    { id: "plot1", type: null, col: 3, row: 2 },
    { id: "academy", type: "아카데미", col: 4, row: 2 },
    { id: "castle", type: "성", col: 5, row: 2, span: 2 },
    { id: "storage", type: "자원보호소", col: 7, row: 2 },
    { id: "plot2", type: null, col: 8, row: 2 },
    { id: "plot13", type: null, col: 3, row: 3 },
    { id: "plot3", type: null, col: 4, row: 3 },
    { id: "tavern", type: "여관", col: 5, row: 3, span: 2 },
    { id: "plot4", type: null, col: 7, row: 3 },
    { id: "plot14", type: null, col: 8, row: 3 },
    { id: "plot5", type: null, col: 3, row: 4 },
    { id: "plot6", type: null, col: 4, row: 4 },
    { id: "plot7", type: null, col: 5, row: 4 },
    { id: "plot8", type: null, col: 6, row: 4 },
    { id: "plot9", type: null, col: 7, row: 4 },
    { id: "plot10", type: null, col: 8, row: 4 },
  ];

  // ---------- 병영 병사 종류 (그리스 신화 테마, 훈련 대기열) ----------
  // 병종별 자원 대비 전투력 효율(공격+방어+체력 합 ÷ 총 자원비용)이 등급이
  // 오를수록 매끄럽게 좋아지도록 설계했다 — 예전엔 민병대가 오히려 가장
  // 효율적이라 "효율 때문에 하급 병사만 훈련"하는 유인이 있었다. 이제는
  // 민병대(1.06) < 호플리테스(1.31) < 스파르타(1.61) < 미르미돈(2.08) <
  // 아레스의 대전사(2.59)로 상위 등급일수록 확실히 이득이면서, 절대 비용도
  // 함께 올라 경제 규모가 못 따라가면 못 뽑는다(특히 상위 두 등급은 금 비중 확대).
  // speed: 이동속도 배율 — 정복 맵 출정/귀환 시간 계산의 기준(낮을수록 느림).
  // 최하급 병종(민병대)·이동속도 특성 없는 영웅 기준 인접 타일 편도 18초가 되도록
  // BASE_SECONDS_PER_TILE(아래)과 함께 맞춰뒀다(200x200 맵 대각선 199칸 이동해도 1시간 이내).
  // capacity: 병종 1명당 수송량(약탈 시 운반 가능한 자원량) — 수송병/마차는 전투력은
  // 약하지만 capacity가 훨씬 커서, "전투 특화" 병종과 "약탈 특화" 병종으로 역할이 갈린다.
  // 마차는 speed가 가장 낮아(0.9) 부대에 섞으면 전체 이동속도가 느려지는 대가가 있다
  // (armySpeedMultiplier가 편성된 병종 중 최저 속도를 쓰기 때문).
  // trainSeconds는 훈련 시간이 너무 길다는 피드백으로 전 병종 일괄 80% 단축(×0.2)했다
  // — 서버 사본(workers/src/lib/troops.js)도 반드시 같은 값으로 맞춰야 한다.
  const TROOP_TYPES = [
    { key: "militia", name: "민병대", unlockLevel: 1, cost: { food: 9 }, trainSeconds: 0.6, atk: 2, def: 1.5, hp: 6, speed: 1, capacity: 20 },
    { key: "transport", name: "수송병", unlockLevel: 3, cost: { food: 12, wood: 4 }, trainSeconds: 1, atk: 1, def: 1, hp: 8, speed: 1.05, capacity: 150 },
    { key: "hoplite", name: "호플리테스", unlockLevel: 5, cost: { food: 11, wood: 5 }, trainSeconds: 1.2, atk: 4.5, def: 4, hp: 12.5, speed: 1.1, capacity: 35 },
    { key: "spartan", name: "스파르타 전사", unlockLevel: 10, cost: { food: 15, stone: 7 }, trainSeconds: 2, atk: 8, def: 6.5, hp: 21, speed: 1.25, capacity: 55 },
    { key: "myrmidon", name: "미르미돈 전사", unlockLevel: 15, cost: { food: 16, gold: 10 }, trainSeconds: 3.2, atk: 13, def: 10, hp: 31, speed: 1.4, capacity: 80 },
    { key: "wagon", name: "마차", unlockLevel: 18, cost: { food: 40, gold: 35, stone: 20 }, trainSeconds: 9, atk: 3, def: 3, hp: 40, speed: 0.9, capacity: 600 },
    { key: "ares_champion", name: "아레스의 대전사", unlockLevel: 20, cost: { food: 15, gold: 12, stone: 7 }, trainSeconds: 4.8, atk: 22, def: 16, hp: 50, speed: 1.6, capacity: 110 },
  ];
  const TROOP_TYPES_BY_KEY = Object.fromEntries(TROOP_TYPES.map((t) => [t.key, t]));
  // 병사 유지비 — 자원이 무한정 쌓이고 군대를 무제한 훈련할 수 있던 문제를 완화하려고
  // 도입했다. 전투 스탯(공+방+체)에 비례해서 매초 식량을 소모하므로, 강한 병종을 대군으로
  // 유지할수록 부담이 커진다(tick()에서 매초 차감, 0 아래로는 내려가지 않는다).
  // 최초 도입값(0.01)이 실제 플레이에서 너무 부담스럽다는 피드백을 받아 20분의 1로 낮췄다.
  const TROOP_UPKEEP_RATE = 0.0005;
  function troopUpkeepFoodPerSecond(t) {
    return (t.atk + t.def + t.hp) * TROOP_UPKEEP_RATE;
  }

  // ---------- 여관 레벨별 슬롯 수 ----------
  function tavernSlotsForLevel(level) {
    if (level >= 16) return 8;
    if (level >= 11) return 7;
    if (level >= 6) return 6;
    return 5;
  }

  // ---------- 아카데미 연구 트리 ----------
  // 세부 연구마다 Lv.1~5까지 반복 연구 가능(레벨당 효과가 쌓이고, 비용은 레벨마다
  // researchLevelGrowthForTier배씩 증가하며 티어가 높을수록 그 배율도 커진다).
  // 같은 카테고리 안에서는 배열 순서가 곧 선행 체인 —
  // 이전 연구를 Lv.3 이상 올려야 다음 연구가 해금된다(canResearch에서 검사).
  const RESEARCH_MAX_LEVEL = 5;
  // 연구 id 끝의 숫자(combat7 -> 7)를 카테고리 내 티어(1~10)로 사용한다.
  function researchTier(id) { return parseInt(id.match(/\d+$/)[0], 10); }
  // 레벨업(Lv->Lv+1) 비용 배율 — 티어가 높을수록 레벨 하나 올리는 데도 더 가팔라진다.
  function researchLevelGrowthForTier(tier) {
    if (tier <= 3) return 2.0;
    if (tier <= 6) return 2.6;
    if (tier <= 8) return 3.0;
    return 3.3;
  }
  // 연구 비용은 카테고리 내 순번(티어 1~10)이 커질수록 기본 비용 자체가 훨씬
  // 가파르게 뛰도록 재설계했다 — 티어1을 Lv5까지 다 올리는 누적 비용(약 3,100)보다
  // 티어10의 Lv1 한 칸(약 32,363)이 이미 10배 이상 비싸서, "초반 연구는 5레벨도
  // 무리 없지만 후반 연구는 1레벨도 힘들다"는 체감을 분명하게 만든다.
  // 레벨업 배율(researchLevelGrowthForTier)도 티어가 높을수록 함께 가팔라진다.
  const RESEARCH_DEFS = [
    // ---- ⚔️ 전투연구 (10) ----
    { id: "combat1", cat: "combat", name: "청동 무기", reqAcademy: 2, reqBuilding: { type: "병영", level: 3 }, cost: { wood: 38, food: 38, gold: 24 }, effect: { defensePercent: 3, troopPercent: 3 } },
    { id: "combat2", cat: "combat", name: "철제 갑주", reqAcademy: 6, reqBuilding: { type: "방어탑", level: 5 }, cost: { wood: 56, stone: 56, gold: 43 }, effect: { defensePercent: 5 } },
    { id: "combat3", cat: "combat", name: "영웅의 전술", reqAcademy: 11, reqBuilding: { type: "병영", level: 10 }, cost: { wood: 62, stone: 62, food: 62, gold: 54 }, effect: { troopPercent: 6 } },
    { id: "combat4", cat: "combat", name: "최정예 군단", reqAcademy: 16, reqBuilding: { type: "방어탑", level: 14 }, cost: { wood: 115, stone: 115, food: 115, gold: 99 }, effect: { troopPercent: 5, defensePercent: 5 } },
    { id: "combat5", cat: "combat", name: "강철 방벽", reqAcademy: 17, reqBuilding: { type: "성벽", level: 12 }, cost: { wood: 288, stone: 288, gold: 246 }, effect: { defensePercent: 6 } },
    { id: "combat6", cat: "combat", name: "아레스의 가호", reqAcademy: 17, reqBuilding: { type: "병영", level: 16 }, cost: { wood: 538, food: 538, gold: 445 }, effect: { troopPercent: 7 } },
    { id: "combat7", cat: "combat", name: "스파르타의 군율", reqAcademy: 18, reqBuilding: { type: "방어탑", level: 17 }, cost: { stone: 1192, food: 917, gold: 1009 }, effect: { defensePercent: 7, troopPercent: 3 } },
    { id: "combat8", cat: "combat", name: "아킬레우스의 갑주", reqAcademy: 19, reqBuilding: { type: "성벽", level: 16 }, cost: { wood: 2234, stone: 2234, gold: 1925 }, effect: { troopPercent: 8 } },
    { id: "combat9", cat: "combat", name: "아테나의 병법", reqAcademy: 19, reqBuilding: { type: "병영", level: 19 }, cost: { wood: 3708, stone: 3708, food: 3708, gold: 3260 }, effect: { defensePercent: 8, troopPercent: 4 } },
    { id: "combat10", cat: "combat", name: "올림포스 전쟁 신의 가호", reqAcademy: 20, reqBuilding: { type: "성벽", level: 20 }, cost: { wood: 8288, stone: 8288, food: 8288, gold: 7499 }, effect: { troopPercent: 10, defensePercent: 10 } },
    // ---- 💰 경영연구 (10) ----
    { id: "econ1", cat: "econ", name: "관개 기술", reqAcademy: 2, reqBuilding: { type: "농장", level: 3 }, cost: { wood: 38, food: 38, gold: 24 }, effect: { productionPercent: 3 } },
    { id: "econ2", cat: "econ", name: "무역로 확장", reqAcademy: 6, reqBuilding: { type: "자원보호소", level: 5 }, cost: { wood: 56, stone: 56, gold: 43 }, effect: { goldPercent: 4 } },
    { id: "econ3", cat: "econ", name: "황금시대", reqAcademy: 12, reqBuilding: { type: "성", level: 10 }, cost: { wood: 62, stone: 62, food: 62, gold: 54 }, effect: { productionPercent: 5, goldPercent: 5 } },
    { id: "econ4", cat: "econ", name: "계단식 농법", reqAcademy: 13, reqBuilding: { type: "농장", level: 12 }, cost: { wood: 156, food: 156, gold: 132 }, effect: { productionPercent: 6 } },
    { id: "econ5", cat: "econ", name: "청동 화폐 주조", reqAcademy: 14, reqBuilding: { type: "채석장", level: 12 }, cost: { stone: 305, wood: 265, gold: 252 }, effect: { goldPercent: 6 } },
    { id: "econ6", cat: "econ", name: "지중해 교역망", reqAcademy: 15, reqBuilding: { type: "자원보호소", level: 14 }, cost: { wood: 534, stone: 534, gold: 453 }, effect: { goldPercent: 7 } },
    { id: "econ7", cat: "econ", name: "데메테르의 축복", reqAcademy: 16, reqBuilding: { type: "벌목장", level: 16 }, cost: { wood: 1089, food: 1089, gold: 940 }, effect: { productionPercent: 7 } },
    { id: "econ8", cat: "econ", name: "헤파이스토스의 공방", reqAcademy: 17, reqBuilding: { type: "성", level: 15 }, cost: { stone: 2224, wood: 2224, gold: 1945 }, effect: { productionPercent: 5, goldPercent: 5 } },
    { id: "econ9", cat: "econ", name: "플루토스의 축복", reqAcademy: 18, reqBuilding: { type: "농장", level: 18 }, cost: { wood: 3699, food: 3699, stone: 3699, gold: 3287 }, effect: { goldPercent: 9 } },
    { id: "econ10", cat: "econ", name: "풍요의 황금기", reqAcademy: 20, reqBuilding: { type: "성", level: 20 }, cost: { wood: 8322, stone: 8322, food: 8322, gold: 7397 }, effect: { productionPercent: 10, goldPercent: 10 } },
    // ---- 🍀 영웅 획득 연구 (10) ----
    { id: "hero1", cat: "hero", name: "신탁의 속삭임", reqAcademy: 2, reqBuilding: { type: "여관", level: 3 }, cost: { wood: 38, food: 38, gold: 24 }, effect: { recruitCostPercent: -3 } },
    { id: "hero2", cat: "hero", name: "축복받은 만남", reqAcademy: 6, reqBuilding: { type: "여관", level: 6 }, cost: { wood: 56, stone: 56, gold: 43 }, effect: { rarityBoost: 0.4 } },
    { id: "hero3", cat: "hero", name: "올림포스의 부름", reqAcademy: 12, reqBuilding: { type: "여관", level: 10 }, cost: { wood: 62, stone: 62, food: 62, gold: 54 }, effect: { rarityBoost: 0.4, resetCostPercent: -3 } },
    { id: "hero4", cat: "hero", name: "델포이의 인도", reqAcademy: 13, reqBuilding: { type: "여관", level: 12 }, cost: { wood: 156, food: 156, gold: 132 }, effect: { recruitCostPercent: -4 } },
    { id: "hero5", cat: "hero", name: "뮤즈의 노래", reqAcademy: 14, reqBuilding: { type: "여관", level: 13 }, cost: { stone: 305, wood: 265, gold: 252 }, effect: { resetCostPercent: -4 } },
    { id: "hero6", cat: "hero", name: "티케 여신의 미소", reqAcademy: 15, reqBuilding: { type: "여관", level: 14 }, cost: { wood: 534, food: 534, gold: 453 }, effect: { rarityBoost: 0.5 } },
    { id: "hero7", cat: "hero", name: "영웅들의 전당", reqAcademy: 16, reqBuilding: { type: "여관", level: 15 }, cost: { wood: 1089, stone: 1089, gold: 940 }, effect: { recruitCostPercent: -4, resetCostPercent: -3 } },
    { id: "hero8", cat: "hero", name: "아프로디테의 인연", reqAcademy: 17, reqBuilding: { type: "여관", level: 16 }, cost: { wood: 2200, food: 2200, gold: 1993 }, effect: { rarityBoost: 0.5 } },
    { id: "hero9", cat: "hero", name: "제우스의 초대", reqAcademy: 19, reqBuilding: { type: "여관", level: 18 }, cost: { wood: 3696, stone: 3696, food: 3696, gold: 3296 }, effect: { rarityBoost: 0.6, recruitCostPercent: -3 } },
    { id: "hero10", cat: "hero", name: "신들의 축제", reqAcademy: 20, reqBuilding: { type: "여관", level: 20 }, cost: { wood: 8322, stone: 8322, food: 8322, gold: 7397 }, effect: { rarityBoost: 0.7, resetCostPercent: -5 } },
  ];
  const RESEARCH_CAT_LABEL = { combat: "⚔️ 전투연구", econ: "💰 경영연구", hero: "🍀 영웅 획득 연구" };
  let academyTab = "combat";

  // ---------- 야생 지역: 몬스터 ----------
  const MONSTER_TYPES = [
    { key: "centaur", name: "켄타우로스", icon: "🐴" },
    { key: "satyr", name: "사티로스", icon: "🐐" },
    { key: "harpy", name: "하피", icon: "🦅" },
    { key: "cyclops", name: "키클롭스", icon: "👁️" },
    { key: "gorgon", name: "고르곤", icon: "🐍" },
    { key: "minotaur", name: "미노타우로스", icon: "🐂" },
    { key: "griffin", name: "그리핀", icon: "🦁" },
    { key: "karkinos", name: "카르키노스", icon: "🦀" },
    { key: "lamia", name: "라미아", icon: "🦂" },
    { key: "empusa", name: "엠푸사", icon: "👹" },
  ];
  // 예전엔 필드 8칸에 8% 확률로 섞여 나오던 엘리트 3종을, 상시 목록으로 볼 수 있는
  // 별도 "보스 레이드" 컨텐츠로 옮겼다. 필드 몬스터와 달리 레벨이 고정이고, 무작위
  // 리스폰도 없다 — 한 번 처치하면 그 보스는 세이브 안에서 영구적으로 다시 도전할
  // 수 없다(1인 기준 "1회성 정복" 컨텐츠). requires로 순서를 강제해 앞 보스를 먼저
  // 처치해야 다음 보스에 도전할 수 있는 6단계 체인을 이룬다.
  // powerMult: 필드 몬스터 최고 레벨(30)·월드맵 성 최고 레벨(20) 중 더 강한 쪽을
  // 기준선으로 삼아 몇 배인지(raidBossBaselineStats/raidBossStats 참고). 최초 설계값
  // (4~17배, "항상 필드/월드맵보다 강해야 한다")이 실제로 붙어보니 권장 전투력이
  // 유저가 도달 불가능할 정도로 높아 전체를 80% 하향(×0.2)했다 — 그 결과 메두사(첫
  // 보스)는 기준선보다 오히려 낮고, 뒤로 갈수록 다시 기준선을 넘어서는 완만한
  // 곡선이 됐다.
  // level은 이제 스탯과 무관 — 진군/전투 소요시간과 표시용으로만 쓰인다.
  // reward.shards는 처치 시 "만능 조각"(state.raidShards)으로 지급되어 보유 영웅
  // 아무에게나 나중에 배분할 수 있고, reward.ticketRarity/ticketCount는 여관에서
  // 해당 등급 이상을 확정 소환할 수 있는 티켓(state.raidTickets)으로 지급된다.
  const RAID_BOSSES = [
    { id: "medusa", key: "medusa", name: "메두사", icon: "🗿", level: 12, powerMult: 0.8, requires: null,
      reward: { resourceAmount: 50000, goldBonus: 30000, shards: 5, ticketRarity: 5, ticketCount: 5 } },
    { id: "hydra", key: "hydra", name: "히드라", icon: "🐉", level: 20, powerMult: 1.1, requires: "medusa",
      reward: { resourceAmount: 120000, goldBonus: 72000, shards: 10, ticketRarity: 5, ticketCount: 10 } },
    { id: "cerberus", key: "cerberus", name: "케르베로스", icon: "🐺", level: 28, powerMult: 1.4, requires: "hydra",
      reward: { resourceAmount: 250000, goldBonus: 150000, shards: 20, ticketRarity: 5, ticketCount: 15 } },
    { id: "echidna", key: "echidna", name: "에키드나", icon: "🐍", level: 30, powerMult: 2.0, requires: "cerberus",
      reward: { resourceAmount: 500000, goldBonus: 300000, shards: 30, ticketRarity: 6, ticketCount: 3 } },
    { id: "typhon", key: "typhon", name: "티폰", icon: "🌪️", level: 35, powerMult: 2.6, requires: "echidna",
      reward: { resourceAmount: 800000, goldBonus: 480000, shards: 40, ticketRarity: 6, ticketCount: 5 } },
    { id: "cronus", key: "cronus", name: "크로노스", icon: "⏳", level: 40, powerMult: 3.4, requires: "typhon",
      reward: { resourceAmount: 1200000, goldBonus: 720000, shards: 50, ticketRarity: 6, ticketCount: 7 } },
  ];
  const RAID_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 보스별 재도전 대기시간(하루 1회)
  const MONSTER_SLOT_COUNT = 8;
  // 필드 몬스터 로테이션 주기 — 이 시간마다(교전 중이 아닌 칸만) 새 종류/레벨로 갈아치운다.
  const MONSTER_ROTATION_SECONDS = 5 * 60;
  function monsterIconHTML(key) {
    return `<img src="assets/monsters/${key}.svg" alt="${key}" />`;
  }

  function rollMonsterLevel() {
    return 1 + Math.floor(Math.pow(Math.random(), 1.5) * 30);
  }
  // 몬스터 스탯 성장률 — 예전엔 전 레벨 균일 배율이라 병사 스탯만 놓고 보면 맞아
  // 보였지만, 실제로는 배치된 영웅의 고정 공/방/체 기여가 병사 몇 명 규모를
  // 가볍게 뛰어넘어서 좋은 영웅 소수 + 최소 인원 병사만으로도 중후반 레벨(예: 17)까지
  // 손쉽게 뚫리는 문제가 있었다. 1~10구간은 기존 배율 그대로 둬 초반 체감은 유지하고,
  // 11구간부터 성장률 자체를 가파르게 올려 "영웅이 강할수록 더 높은 레벨까지 도전
  // 가능"은 유지하되, 왕관급 영웅 소수만으로 전체 레벨을 무력화하지 못하게 했다.
  // 21~30구간(마지막 티어)은 필드 몬스터 최고 레벨이 항상 레이드 보스(raidBossStats가
  // 이 곡선의 최고치를 기준선으로 삼는다)보다 약해야 한다는 요구에 맞춰 조정한다 —
  // Lv.30조차 월드맵 성 Lv.20보다 세 스탯 모두 낮게 잡아, 필드 < 월드맵 성 < 레이드
  // 순서의 전투력 위계가 항상 성립하도록 했다. 그래도 매 레벨 배율은 1보다 커서 1~30
  // 전 구간이 끊김 없이 우상향한다(뒤로 갈수록 더 가파르게). Lv.30 전투력 합계(atk+def+hp)가
  // 정확히 150,000이 되도록 21~30구간 배율을 역산해 맞췄다(hp:atk:def 비율은 직전
  // 조정값과 거의 동일하게 유지).
  function monsterStatRate(level, kind) {
    const RATES = { hp: [1.22, 1.33, 1.376], atk: [1.20, 1.29, 1.311], def: [1.18, 1.26, 1.31] };
    const tier = level <= 10 ? 0 : level <= 20 ? 1 : 2;
    return RATES[kind][tier];
  }
  function monsterStatFactor(level, kind) {
    let f = 1;
    for (let l = 2; l <= level; l++) f *= monsterStatRate(l, kind);
    return f;
  }
  function monsterStats(level, elite) {
    const m = elite ? 3 : 1;
    return {
      hp: Math.round(55 * monsterStatFactor(level, "hp") * m),
      atk: Math.round(8 * monsterStatFactor(level, "atk") * m),
      def: Math.round(5 * monsterStatFactor(level, "def") * m),
    };
  }
  // 승리 시 실제로 얻는 자원량(레벨/엘리트로 결정, 결정론적) — 종류만 처치 시점에 무작위로 고른다.
  // 경제 밸런스 조정(생산 -25%, 병사 유지비 도입)으로 팍팍해진 자원 수급을 필드 사냥이
  // 보완하도록, 기준값과 성장률을 함께 올려 우상향 곡선을 더 가파르게 했다
  // (기존 20×1.25^(lv-1) → 25×1.28^(lv-1): 저레벨은 +25% 정도지만 고레벨(Lv30)은 약 2.5배).
  function monsterRewardAmount(level, elite) {
    const base = 25 * Math.pow(1.28, level - 1);
    return Math.round(base * (elite ? 3.5 : 1));
  }
  function monsterReward(level, elite) {
    const amount = monsterRewardAmount(level, elite);
    const types = ["food", "wood", "stone", "gold"];
    const type = types[Math.floor(Math.random() * types.length)];
    const reward = {};
    reward[type] = amount;
    if (elite) reward.gold = (reward.gold || 0) + Math.round(amount * 0.6);
    return reward;
  }
  function spawnMonster(slot) {
    const type = MONSTER_TYPES[Math.floor(Math.random() * MONSTER_TYPES.length)];
    const level = rollMonsterLevel();
    const stats = monsterStats(level, false);
    slot.monster = { key: type.key, name: type.name, icon: type.icon, elite: false, level, ...stats };
    slot.respawnTimer = 0;
  }
  function freshRaidsState() {
    // defeated: 선행 조건(다음 보스 해금) 판정용 — 한 번이라도 처치하면 영구히 true.
    // lastDefeatedAt: 재도전 쿨타임(하루) 판정용 — 처치할 때마다 갱신된다.
    return Object.fromEntries(RAID_BOSSES.map((b) => [b.id, { defeated: false, lastDefeatedAt: null }]));
  }
  function raidOnCooldown(bossId) {
    const last = state.raids[bossId] && state.raids[bossId].lastDefeatedAt;
    return !!last && Date.now() - last < RAID_COOLDOWN_MS;
  }
  function freshMonsterSlots() {
    const slots = [];
    for (let i = 0; i < MONSTER_SLOT_COUNT; i++) {
      const slot = { id: "m" + i, monster: null, respawnTimer: 0 };
      spawnMonster(slot);
      slots.push(slot);
    }
    return slots;
  }
  // MONSTER_ROTATION_SECONDS(5분)마다 tick()에서 호출 — 죽인 뒤 respawnTimer가 다 되길
  // 기다리지 않아도, 필드 전체가 주기적으로 새 몬스터 구성으로 갈아치워진다. 단, 지금
  // 부대가 교전 중인(march/battle) 칸은 건드리지 않는다 — startBattle/resolveBattle이
  // findEnemy()로 그 칸의 몬스터를 그때그때 다시 읽으므로, 전투 도중 몰래 바뀌면 원정을
  // 보낼 때와 다른 상대와 싸우게 되는 문제가 생긴다.
  function rotateFieldMonsters() {
    const busyTargetIds = new Set(
      state.armies.filter((a) => a.mission && a.mission.kind === "monster").map((a) => a.mission.targetId)
    );
    let rotated = 0;
    state.monsters.forEach((slot) => {
      if (busyTargetIds.has(slot.id)) return;
      spawnMonster(slot);
      rotated += 1;
    });
    if (rotated > 0) {
      toast("🐾 필드에 새로운 몬스터들이 나타났습니다!");
      logEvent("🐾 필드 몬스터가 새로 나타났습니다", "build");
    }
  }

  // ---------- 월드맵: 레벨 1~20 NPC 성 ----------
  const WORLD_CASTLE_COUNT = 20;
  const WORLD_CASTLE_FLAVOR = [
    "변방의 이름 없는 소도시", "산기슭의 작은 요새", "강어귀의 무역 도시", "올리브 언덕의 마을 성채",
    "협곡을 지키는 관문 도시", "양치기들의 고원 성채", "포도밭에 둘러싸인 성", "해안 절벽의 감시 도시",
    "숲 가장자리의 목책 마을", "고대 신전을 품은 도시", "채석장 옆 광부 마을", "말발굽 소리 요란한 기병 도시",
    "청동 갑주의 수비대 도시", "황금빛 곡창지대의 성", "안개 낀 호숫가 요새", "붉은 성벽의 전사 도시",
    "폭풍우를 견딘 항구 성채", "티탄의 흔적이 남은 폐허 도시", "불사조 문양의 왕성", "올림포스를 가장 가까이서 섬기는 대도시",
  ];
  const WORLD_CASTLE_ICONS = ["🏘️", "🏯", "🏛️", "🏰"];
  function worldCastleSpriteSrc(level) {
    const tier = Math.min(4, Math.floor((level - 1) / 6) + 1);
    return `assets/worldmap/castle_t${tier}.svg`;
  }
  function worldCastleIconHTML(level) {
    return `<img src="${worldCastleSpriteSrc(level)}" alt="성채" />`;
  }
  function enemyIconHTML(kind, enemy) {
    return kind === "castle" ? worldCastleIconHTML(enemy.level) : monsterIconHTML(enemy.key);
  }
  // 몬스터와 동일한 이유로 성 스탯도 구간형 가속 곡선으로 재설계 — 1~7구간은
  // 기존 배율 그대로 두고(초반 원정 체감 유지), 8구간부터 더 가팔라진다.
  function castleStatRate(level, kind) {
    const RATES = { hp: [1.35, 1.41, 1.47], atk: [1.32, 1.38, 1.44], def: [1.3, 1.36, 1.42] };
    const tier = level <= 7 ? 0 : level <= 14 ? 1 : 2;
    return RATES[kind][tier];
  }
  function castleStatFactor(level, kind) {
    let f = 1;
    for (let l = 2; l <= level; l++) f *= castleStatRate(l, kind);
    return f;
  }
  function castleStats(level) {
    return {
      hp: Math.round(300 * castleStatFactor(level, "hp")),
      atk: Math.round(25 * castleStatFactor(level, "atk")),
      def: Math.round(18 * castleStatFactor(level, "def")),
    };
  }
  function castleBankRate(level) { return 2 * Math.pow(1.25, level - 1); }
  function castleBankCap(level) { return Math.round(300 * Math.pow(1.3, level - 1)); }
  // 레이드 보스 기준선 — "필드 몬스터·월드맵 성보다 훨씬 강해야 한다"는 요청에 따라
  // 두 시스템의 최고 레벨 스탯 중 더 강한 쪽을 기준선으로 잡는다. 몬스터/성 곡선이
  // 나중에 또 조정돼도 라이드가 항상 그보다 확실히 강한 상태를 유지하도록 이 함수를
  // 경유해서 계산한다(하드코딩된 숫자를 직접 곱하지 않음).
  function raidBossBaselineStats() {
    const fieldCeiling = monsterStats(30, false);
    const castleCeiling = castleStats(WORLD_CASTLE_COUNT);
    return {
      hp: Math.max(fieldCeiling.hp, castleCeiling.hp),
      atk: Math.max(fieldCeiling.atk, castleCeiling.atk),
      def: Math.max(fieldCeiling.def, castleCeiling.def),
    };
  }
  function raidBossStats(boss) {
    const base = raidBossBaselineStats();
    return {
      hp: Math.round(base.hp * boss.powerMult),
      atk: Math.round(base.atk * boss.powerMult),
      def: Math.round(base.def * boss.powerMult),
    };
  }
  // 유저에게 보여줄 "권장 전투력" — armyPowerScore(atk+def+hp 합산)와 동일한 산식을
  // 보스 스탯에 그대로 적용해, 군대 편성 화면에 상시 표시되는 내 부대 전투력 수치와
  // 같은 단위로 직접 비교(목표 삼기)할 수 있게 한다.
  function raidBossRecommendedPower(boss) {
    const s = raidBossStats(boss);
    return Math.round(s.atk + s.def + s.hp);
  }
  // 선행 보스를 처치해야 다음 보스에 도전할 수 있다(requires:null이면 항상 도전 가능)
  function raidBossUnlocked(boss) {
    return !boss.requires || !!state.raids[boss.requires]?.defeated;
  }
  function freshWorldCastles() {
    const castles = [];
    for (let level = 1; level <= WORLD_CASTLE_COUNT; level++) {
      const stats = castleStats(level);
      castles.push({
        id: "c" + level,
        level,
        name: WORLD_CASTLE_FLAVOR[level - 1] || `${level}단계 성채`,
        icon: WORLD_CASTLE_ICONS[Math.min(WORLD_CASTLE_ICONS.length - 1, Math.floor((level - 1) / 6))],
        ...stats,
        bank: { food: 0, wood: 0, stone: 0, gold: 0 },
      });
    }
    return castles;
  }

  // 방어탑/자원보호소는 영웅 배치 대상이 아니므로, 해당 건물을 노리던 특성은 전투 특성으로 전환한다.
  HEROES.forEach((h) => {
    h.traits.forEach((t) => {
      if (t.type === "building" && (t.building === "방어탑" || t.building === "자원보호소")) {
        t.type = "combat";
        t.statKey = h.id % 2 === 0 ? "atk" : "def";
        delete t.building;
      }
    });
  });

  const RES_LABEL = { food: "🌾", wood: "🪵", stone: "🪨", gold: "🪙" };
  // 코덱스로 새로 뽑은 일러스트는 .png로 들어온다 — 아직 그리지 않은 영웅은 예전
  // 절차적 SVG 초상으로 자동 대체된다(onerror 폴백이라 전원분을 한꺼번에 교체할
  // 필요 없이 그린 만큼씩 순차 반영 가능).
  function heroPortraitHTML(hero) {
    return `<img src="assets/heroes/${hero.id}.png" loading="lazy" alt="${hero.name}" onerror="this.onerror=null;this.src='assets/heroes/${hero.id}.svg';" />`;
  }
  // 가챠 카드 상단 별줄 — 등급(1~8)만큼 별을 채운다.
  function heroStarRowHTML(rarity) {
    return `<span class="hc-star-filled">${"★".repeat(rarity)}</span>`;
  }
  const KAMI = HEROES.find((h) => h.secret) || null;
  const HERO_BY_ID = Object.fromEntries(HEROES.map((h) => [h.id, h]));
  const BASE_CAP = 10000000; // 1000만
  const TAVERN_CYCLE = 600; // 10분
  const TAVERN_RESET_BASE_COST = 250; // 여관 수동 초기화 기본 비용(금화)
  const TAVERN_RESET_GROWTH = 1.25; // 수동 초기화 1회당 비용 증가율 — 자연 초기화 시 기본값으로 복귀
  const MAX_LEVEL = 20; // 건물 레벨 상한
  // 건물 레벨업 비용 증가율 — 예전엔 전 구간 균일하게 1.42배라 후반 체감이
  // 약했다. 구간이 오를수록 배율 자체가 가팔라지게 바꿔 "초반은 완만하게,
  // 후반은 기하급수적으로 벽에 부딪히는" 곡선 모양을 명확히 했다
  // (Lv20 도달 비용이 옛 방식 대비 약 3.1배, 1→20 누적 총량은 약 1.35배).
  function levelCostRateForLevel(targetLevel) {
    if (targetLevel <= 5) return 1.18;
    if (targetLevel <= 10) return 1.32;
    if (targetLevel <= 15) return 1.58;
    return 2.4; // 생산량 하향(-25%) + 병사 유지비 도입과 함께, 후반 정체감을 더 강하게 준다
  }
  function levelCostFactor(level) {
    let f = 1;
    for (let l = 2; l <= level; l++) f *= levelCostRateForLevel(l);
    return f;
  }
  const MAX_ENHANCE = 5; // 영웅 강화 상한(0~5강)
  const MAX_HEROES_PER_BUILDING = 3; // 건물 하나에 배치 가능한 영웅 수 상한
  const SQUAD_COUNT = 3;
  const MIN_DEPLOY = 5;
  const SAVE_KEY = "olympusSngSave_v5";
  // 오프라인/백그라운드 진행은 최대 이만큼만 한 번에 재생한다(방치 계정이 무한정
  // 쌓이는 걸 막는 안전장치). 하루 한 번 정도만 확인해도 놓치는 시간이 없도록
  // 12시간 -> 24시간으로 늘렸다(경제 밸런스 조정으로 생산량 자체는 이미 낮췄으므로,
  // 상한을 늘려도 무제한 방치 축적 문제로 이어지지 않는다).
  const OFFLINE_CAP_SECONDS = 24 * 3600;

  // ---------- 계정/서버 동기화 ----------
  // 클라이언트와 API가 같은 Cloudflare Worker(같은 오리진)에서 서빙되므로 API_BASE는
  // 기본적으로 빈 문자열(상대 경로)이면 충분하다 — index.html의
  // <meta name="olympus-api-base">로 다른 백엔드 주소를 가리키게 오버라이드할 수도 있다.
  const AUTH_TOKEN_KEY = "olympusSngAuthToken";
  const API_BASE = (document.querySelector('meta[name="olympus-api-base"]') || {}).content || "";
  const SERVER_SYNC_INTERVAL_MS = 15000; // 매 초 로컬 저장과 별개로, 서버 체크포인트는 이 주기로만 전송(스팸 방지)
  let authToken = localStorage.getItem(AUTH_TOKEN_KEY) || null;
  let currentPlayer = null; // { id, nickname } — 로그인 성공 후 채워짐
  let lastServerSyncAt = 0;

  async function apiRequest(path, options) {
    const res = await fetch(API_BASE + path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: "Bearer " + authToken } : {}),
        ...((options && options.headers) || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "서버 요청에 실패했습니다.");
    return data;
  }

  // 6성 이상(6/7/8/까미)이 연구로 부스트됐을 때 지나치게 자주 등장하던 문제 —
  // 기본 확률 자체를 낮추고(6+7+8 합계 1.95%→0.5%), 그만큼 1성 쪽으로 되돌려
  // 전체 합은 100%를 유지한다. 연구 부스트 공식(currentRollTable)도 함께
  // 하향 조정해서, 연구를 전부 최대로 올려도 옛 기본 확률(2.0%)을 살짝 밑도는
  // 수준(약 1.8%)에서 막히도록 설계했다.
  const ROLL_TABLE = [
    { rarity: "kami", p: 0.05 },
    { rarity: 1, p: 33.95 },
    { rarity: 2, p: 28 },
    { rarity: 3, p: 21 },
    { rarity: 4, p: 14 },
    { rarity: 5, p: 2.5 },
    { rarity: 6, p: 0.3 },
    { rarity: 7, p: 0.15 },
    { rarity: 8, p: 0.05 },
  ];

  function freshState() {
    const tiles = {};
    TILE_LAYOUT.forEach((t) => {
      tiles[t.id] = { type: t.type, built: t.id === "castle", level: t.id === "castle" ? 1 : 0, heroIds: [], training: null, upgrading: null };
    });
    tiles.wall = { type: "성벽", built: false, level: 0, heroIds: [] };
    return {
      res: { food: 80, wood: 80, stone: 60, gold: 150 },
      tiles,
      troopsByType: Object.fromEntries(TROOP_TYPES.map((t) => [t.key, 0])),
      owned: {}, // heroId -> {enhance, shards, count}
      research: {},
      tavern: { timer: TAVERN_CYCLE, candidates: new Array(tavernSlotsForLevel(1)).fill(null), resetCost: TAVERN_RESET_BASE_COST },
      armies: Array.from({ length: SQUAD_COUNT }, () => ({ heroIds: [null, null, null], mission: null, lastComp: {} })),
      monsters: freshMonsterSlots(),
      monsterRotationTimer: MONSTER_ROTATION_SECONDS,
      worldCastles: freshWorldCastles(),
      raids: freshRaidsState(),
      raidShards: 0, // 레이드 보상으로 받는 "만능 조각" — 보유 영웅 아무에게나 배분 가능
      raidTickets: { t5: 0, t6: 0 }, // 확정 등급 이상 소환권 개수
      monsterKillsSinceGate: 0, // 성 레벨업의 "몬스터 처치" 조건용 — 조건을 소모할 때마다 0으로 리셋
      lastActiveAt: Date.now(),
    };
  }

  let state = load() || freshState();
  if (!state.tavern.candidates.some((c) => c !== null)) rerollTavern();

  // ---------- 저장 ----------
  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) {}
    syncStateToServer(false);
  }

  // 로컬 저장(save())은 매 tick 그대로 유지하되, 네트워크 요청은 스팸이 되지 않도록
  // SERVER_SYNC_INTERVAL_MS 간격으로만 보낸다. force=true는 로그인 직후처럼 즉시 반영이
  // 필요한 순간에만 사용. 실제 저장은 PUT /api/state(anticheat 검증 포함)가 담당한다.
  function syncStateToServer(force) {
    if (!authToken) return;
    const now = Date.now();
    if (!force && now - lastServerSyncAt < SERVER_SYNC_INTERVAL_MS) return;
    lastServerSyncAt = now;
    apiRequest("/api/state", { method: "PUT", body: JSON.stringify({ state }) }).catch(() => {});
  }

  function renderAccountBadge() {
    const badge = document.getElementById("account-badge");
    if (!currentPlayer) { badge.hidden = true; return; }
    badge.hidden = false;
    document.getElementById("player-nickname-label").textContent = currentPlayer.nickname;
  }

  async function afterLogin(data) {
    authToken = data.token;
    currentPlayer = data.player;
    localStorage.setItem(AUTH_TOKEN_KEY, authToken);
    try {
      const remote = await apiRequest("/api/state");
      if (remote.state) {
        const migrated = migrateState(remote.state);
        if (migrated) state = migrated;
      } else {
        // 이 계정은 서버에 저장된 진행 상황이 아직 없다 — 이 브라우저에 남아있던
        // (로그인 전 load()로 이미 읽어들인) 진행 상황을 그대로 이 계정 것으로 채택한다.
        syncStateToServer(true);
      }
    } catch (e) {}
    renderAccountBadge();
  }

  function logout() {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    location.reload();
  }
  // 건물 배치와 군대 편성은 서로 독립이라(동시 배치 허용) 두 종류를 한 세트로
  // 합쳐서 정리하지 않는다 — 대신 "같은 종류 안에서만" 중복을 정리한다: 부대는
  // 부대끼리(진행 중인 원정이 있는 부대를 최우선으로 지킨다), 건물은 건물끼리.
  // 매 로드마다 실행해도 이미 깨끗한 데이터에는 아무 영향이 없다(멱등).
  function dedupeHeroPlacements(parsed) {
    const seenArmy = new Set();
    const claimArmy = (heroId) => {
      if (heroId == null || seenArmy.has(heroId)) return false;
      seenArmy.add(heroId);
      return true;
    };
    parsed.armies.forEach((a) => {
      if (!a.mission) return;
      a.heroIds = a.heroIds.map((h) => (claimArmy(h) ? h : null));
    });
    parsed.armies.forEach((a) => {
      if (a.mission) return;
      a.heroIds = a.heroIds.map((h) => (claimArmy(h) ? h : null));
    });
    const seenBuilding = new Set();
    const claimBuilding = (heroId) => {
      if (heroId == null || seenBuilding.has(heroId)) return false;
      seenBuilding.add(heroId);
      return true;
    };
    Object.values(parsed.tiles).forEach((t) => {
      if (!Array.isArray(t.heroIds)) return;
      t.heroIds = t.heroIds.filter((h) => claimBuilding(h));
    });
  }
  // 영웅은 한 부대에만 배치되도록 이미 보장돼 있었지만, 병사 편성(lastComp)은 부대별로
  // 독립된 슬라이더 값이라 같은 병사 수가 여러 부대에 동시에 "편성 가능"하게 보이는
  // 문제가 있었다(부대1에 100명을 편성해도 부대2·3에서 여전히 100명이 가용한 것처럼
  // 표시됨). 부대1부터 순서대로 우선권을 줘서, 합계가 보유량을 넘지 않게 정리한다.
  // 매 로드마다 실행해도 이미 깨끗한 데이터에는 아무 영향이 없다(멱등).
  function dedupeTroopComps(parsed) {
    const used = {};
    TROOP_TYPES.forEach((t) => { used[t.key] = 0; });
    parsed.armies.forEach((a) => {
      TROOP_TYPES.forEach((t) => {
        const owned = parsed.troopsByType[t.key] || 0;
        const want = a.lastComp[t.key] || 0;
        const remain = Math.max(0, owned - used[t.key]);
        const clamped = Math.min(want, remain);
        if (clamped > 0) { a.lastComp[t.key] = clamped; used[t.key] += clamped; }
        else delete a.lastComp[t.key];
      });
    });
  }
  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      return migrateState(JSON.parse(raw));
    } catch (e) { return null; }
  }

  // localStorage든 서버(GET /api/state)든, 저장된 상태를 로드할 때 항상 같은
  // 마이그레이션 경로를 거치게 하기 위해 load()에서 분리했다.
  function migrateState(parsed) {
    try {
      if (!parsed.tiles || !parsed.tavern) return null;
      if (!parsed.research) parsed.research = {};
      // 예전 세이브의 연구는 완료 여부(boolean)만 저장했다 — 레벨 시스템으로 바뀌며 Lv.1로 이관
      Object.keys(parsed.research).forEach((id) => {
        if (parsed.research[id] === true) parsed.research[id] = 1;
      });
      if (typeof parsed.tavern.resetCost !== "number") parsed.tavern.resetCost = TAVERN_RESET_BASE_COST;
      if (!parsed.tiles.wall) parsed.tiles.wall = { type: "성벽", built: false, level: 0, heroIds: [] };
      Object.values(parsed.tiles).forEach((t) => {
        if (!Array.isArray(t.heroIds)) t.heroIds = typeof t.heroId === "number" ? [t.heroId] : [];
        delete t.heroId;
      });
      if (!parsed.troopsByType) parsed.troopsByType = Object.fromEntries(TROOP_TYPES.map((t) => [t.key, 0]));
      // 수송병/마차 추가 이전 세이브에는 이 두 키가 아예 없을 수 있다 — 0으로 채워둔다.
      TROOP_TYPES.forEach((t) => { if (!(t.key in parsed.troopsByType)) parsed.troopsByType[t.key] = 0; });
      if (!parsed.armies) parsed.armies = Array.from({ length: SQUAD_COUNT }, () => ({ heroIds: [null, null, null], mission: null, lastComp: {} }));
      parsed.armies.forEach((a) => { if (!a.lastComp) a.lastComp = {}; });
      dedupeHeroPlacements(parsed);
      dedupeTroopComps(parsed);
      if (!parsed.monsters) parsed.monsters = freshMonsterSlots();
      while (parsed.monsters.length < MONSTER_SLOT_COUNT) {
        const slot = { id: "m" + parsed.monsters.length, monster: null, respawnTimer: 0 };
        spawnMonster(slot);
        parsed.monsters.push(slot);
      }
      // 엘리트가 필드에서 사라지고 보스 레이드로 이관되면서, 기존 세이브에 이미
      // 나와있던 필드 엘리트는 일반 몬스터로 즉시 교체한다(멱등 — 이후엔 대상 없음)
      parsed.monsters.forEach((slot) => { if (slot.monster && slot.monster.elite) spawnMonster(slot); });
      if (typeof parsed.monsterRotationTimer !== "number") parsed.monsterRotationTimer = MONSTER_ROTATION_SECONDS;
      if (!parsed.worldCastles) parsed.worldCastles = freshWorldCastles();
      if (!parsed.raids) parsed.raids = freshRaidsState();
      // raids는 {defeated, lastDefeatedAt} 형태 — defeated는 선행 조건용(영구),
      // lastDefeatedAt은 하루 쿨타임용. 처치 기록이 없는 예전 세이브는 안전하게
      // "미처치"로, {defeated:true}만 있고 lastDefeatedAt이 없던 세이브(1회성
      // 처치 시절 기록)는 "쿨타임 없음"으로 간주해 바로 재도전 가능하게 이관한다.
      RAID_BOSSES.forEach((b) => {
        if (!parsed.raids[b.id] || typeof parsed.raids[b.id].defeated !== "boolean") {
          parsed.raids[b.id] = { defeated: false, lastDefeatedAt: null };
        } else if (typeof parsed.raids[b.id].lastDefeatedAt !== "number" && parsed.raids[b.id].lastDefeatedAt !== null) {
          parsed.raids[b.id].lastDefeatedAt = null;
        }
      });
      if (typeof parsed.monsterKillsSinceGate !== "number") parsed.monsterKillsSinceGate = 0;
      if (typeof parsed.raidShards !== "number") parsed.raidShards = 0;
      if (!parsed.raidTickets) parsed.raidTickets = { t5: 0, t6: 0 };
      if (typeof parsed.raidTickets.t5 !== "number") parsed.raidTickets.t5 = 0;
      if (typeof parsed.raidTickets.t6 !== "number") parsed.raidTickets.t6 = 0;
      Object.values(parsed.owned || {}).forEach((o) => {
        if (typeof o.enhance !== "number") { o.enhance = 0; delete o.star; }
      });
      // 이 필드가 없던 기존 세이브는 "방금 저장됨"으로 간주해 오프라인 진행을 건너뛴다
      if (!parsed.lastActiveAt) parsed.lastActiveAt = Date.now();
      return parsed;
    } catch (e) { return null; }
  }

  // ---------- 유틸 ----------
  // 오프라인 진행분을 tick()을 여러 번 빠르게 재생해서 따라잡는 동안 true —
  // 그 사이에는 토스트/로그가 수천 번 쌓이지 않도록 조용히 무시한다
  let simulating = false;
  function toast(msg) {
    if (simulating) return;
    const layer = document.getElementById("toast-layer");
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    layer.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }
  // 좌측 하단 활동 로그 — 레벨업/전투/건설/훈련 같은 "결과"만 남기는 기록용.
  // 채팅창처럼 평소엔 접혀 있다가 토글 버튼으로 열고 닫으므로, 토스트보다
  // 넉넉하게 쌓아두고 개수 상한을 넘으면 가장 오래된 항목부터 잘라낸다.
  const MAX_LOG_ENTRIES = 20;
  let logPanelOpen = false;
  let logUnread = 0;
  // 한글 단어 뒤에 붙는 주격 조사(이/가)를 받침 유무로 골라준다 ("여관이" vs "아카데미가")
  function withSubjectParticle(word) {
    const last = word.charCodeAt(word.length - 1);
    if (last >= 0xac00 && last <= 0xd7a3) {
      return word + ((last - 0xac00) % 28 !== 0 ? "이" : "가");
    }
    return word + "가";
  }
  function updateLogBadge() {
    const badge = document.getElementById("log-badge");
    if (!badge) return;
    badge.hidden = logUnread <= 0;
    badge.textContent = logUnread > 99 ? "99+" : String(logUnread);
  }
  function toggleLogPanel(open) {
    const panel = document.getElementById("log-panel");
    const toggleBtn = document.getElementById("btn-log-toggle");
    if (!panel || !toggleBtn) return;
    logPanelOpen = open != null ? open : panel.hidden;
    panel.hidden = !logPanelOpen;
    toggleBtn.setAttribute("aria-label", logPanelOpen ? "활동 로그 닫기" : "활동 로그 열기");
    if (logPanelOpen) { logUnread = 0; updateLogBadge(); }
  }
  function logEvent(msg, kind) {
    if (simulating) return;
    const layer = document.getElementById("activity-log");
    if (!layer) return;
    const el = document.createElement("div");
    el.className = "log-entry" + (kind ? ` log-${kind}` : "");
    el.textContent = msg;
    layer.prepend(el);
    while (layer.children.length > MAX_LOG_ENTRIES) layer.removeChild(layer.lastElementChild);
    if (!logPanelOpen) { logUnread += 1; updateLogBadge(); }
  }
  function pulseRes(res) {
    if (simulating) return;
    const el = document.querySelector(`.res[data-res="${res}"]`);
    if (!el) return;
    el.classList.add("pulse");
    setTimeout(() => el.classList.remove("pulse"), 200);
  }
  function canAfford(cost) {
    if (!cost) return true;
    return Object.entries(cost).every(([r, v]) => state.res[r] >= v);
  }
  function pay(cost) {
    if (!cost) return;
    Object.entries(cost).forEach(([r, v]) => { state.res[r] -= v; });
  }
  function costText(cost) {
    if (!cost) return "무료";
    return Object.entries(cost).map(([r, v]) => `${RES_LABEL[r]}${v.toLocaleString()}`).join(" ");
  }
  function heroEnhance(heroId) {
    const o = state.owned[heroId];
    return o ? o.enhance : 0;
  }
  // 영웅 하나가 특성을 여러 개(★5+ 2개, ★7+ 3개) 가질 수 있어 특성 하나를 지정해서 계산한다
  function heroTraitPercent(hero, trait) {
    const enh = heroEnhance(hero.id);
    return trait.percent * (1 + 0.15 * enh);
  }
  function heroCombatTraits(hero) {
    return hero.traits.filter((t) => t.type === "combat");
  }
  function heroMovementTraits(hero) {
    return hero.traits.filter((t) => t.type === "movement");
  }
  function heroCargoTraits(hero) {
    return hero.traits.filter((t) => t.type === "cargo");
  }
  function heroBuildingTraitsFor(hero, buildingType) {
    return hero.traits.filter((t) => t.type === "building" && t.building === buildingType);
  }
  // 이 영웅이 특정 건물 타입에 배치됐을 때 실제로 적용되는 합산 % (강화 반영, 특성이 여러 개면 합산)
  function heroBuildingBonusFor(hero, buildingType) {
    return heroBuildingTraitsFor(hero, buildingType).reduce((sum, t) => sum + heroTraitPercent(hero, t), 0);
  }
  // 건물 배치 목록에서 보여줄 부호 있는 문구 — 병영은 훈련 시간 "감소"라 다른 건물의
  // "+X%"(생산/수비 증가)와 반대 부호로 보여줘야 헷갈리지 않는다.
  function heroBuildingBonusLabel(hero, buildingType) {
    const pct = heroBuildingBonusFor(hero, buildingType).toFixed(1);
    return buildingType === "병영" ? `-${pct}%` : `+${pct}%`;
  }
  // 특성 한 줄(⚔️/🏛️ + 이름 + 수치)을 그려주는 공용 HTML — 카드/목록/상세 어디서나 재사용
  function traitLineHTML(hero, trait) {
    const pct = heroTraitPercent(hero, trait).toFixed(1);
    if (trait.type === "combat") {
      const label = trait.statKey === "atk" ? "공격력" : trait.statKey === "def" ? "방어력" : "체력";
      return `⚔️ ${trait.name}${trait.signature ? " ✨" : ""}: 부대 ${label} +${pct}%`;
    }
    if (trait.type === "movement") {
      return `🐎 ${trait.name}${trait.signature ? " ✨" : ""}: 이동 속도 +${pct}%`;
    }
    if (trait.type === "cargo") {
      return `🚚 ${trait.name}${trait.signature ? " ✨" : ""}: 수송량 +${pct}%`;
    }
    if (trait.building === "병영") {
      return `🕒 ${trait.name}${trait.signature ? " ✨" : ""}: 훈련 시간 -${pct}%`;
    }
    return `🏛️ ${trait.name}${trait.signature ? " ✨" : ""}: ${trait.building} +${pct}%`;
  }
  // 별 배지("★N") + 강화 배지("+N강", 있을 때만)를 함께 그려주는 공용 헬퍼
  function heroBadgeHTML(heroId) {
    const hero = HERO_BY_ID[heroId];
    const enh = heroEnhance(heroId);
    return `<span class="star-badge r${hero.rarity}">★${hero.rarity}</span>${enh > 0 ? `<span class="enhance-badge">+${enh}강</span>` : ""}`;
  }
  function bonusPercentFor(tileId) {
    const tile = state.tiles[tileId];
    let total = 0;
    tile.heroIds.forEach((heroId) => {
      const hero = HERO_BY_ID[heroId];
      if (hero) total += heroBuildingBonusFor(hero, tile.type);
    });
    return total;
  }
  function maxLevelOfType(type) {
    return Object.values(state.tiles).reduce((m, t) => (t.type === type && t.built ? Math.max(m, t.level) : m), 0);
  }
  function researchPercent(kind) {
    return RESEARCH_DEFS.reduce((sum, d) => sum + (d.effect[kind] || 0) * (state.research[d.id] || 0), 0);
  }
  function capFor(res) {
    const storage = state.tiles.storage;
    let cap = BASE_CAP;
    if (storage.built) {
      cap += BASE_CAP * BUILDING_TYPES["자원보호소"].base.capBonus * storage.level * (1 + bonusPercentFor("storage") / 100);
    }
    return Math.round(cap);
  }
  // 방어탑: 정복 맵에서 내가 공격받을 때(수성) 방어력을 강화하는 %(영웅 보너스 없음,
  // 레벨+연구만 반영). 실제 PvP 판정 적용은 서버 workers/src/lib/combat.js의
  // homeDefenseMultiplier()가 동일한 공식으로 담당한다 — 여기서는 HUD 표시용으로만 쓰인다.
  function homeDefenseBonusPercent() {
    const tower = state.tiles.defense;
    if (!tower.built) return 0;
    const researchMult = 1 + researchPercent("defensePercent") / 100;
    return Math.round(tower.level * BUILDING_TYPES["방어탑"].base.defense * researchMult * 10) / 10;
  }
  // 성벽: 정복 맵 수성 시 방어 스탯에 고정으로 더해지는 수치(방어탑처럼 배수가 아니라
  // 가산 — "성벽=고정 수비대 보강"). 서버 workers/src/lib/combat.js의 wallFlatDefense()가
  // 동일한 공식으로 PvP 판정에 반영한다.
  function wallScore() {
    const wall = state.tiles.wall;
    if (!wall.built) return 0;
    return Math.round(wall.level * BUILDING_TYPES["성벽"].base.defense * (1 + bonusPercentFor("wall") / 100));
  }
  function upgradeCostFor(type, level) {
    const bdef = BUILDING_TYPES[type];
    if (!bdef.upgradeCost) return null;
    const factor = levelCostFactor(level);
    const cost = {};
    Object.entries(bdef.upgradeCost).forEach(([r, v]) => { cost[r] = Math.round(v * factor); });
    return cost;
  }
  // 레벨업 소요 시간(초) — 레벨이 높을수록 오래 걸리되 여관 주기를 넘지 않게 상한
  function upgradeSecondsFor(level) {
    return Math.min(TAVERN_CYCLE, 15 + level * 10);
  }
  // 레벨업 조건을 체크리스트 형태(충족/미충족)로 반환 — 항상 표시되는 시각화용.
  // missingLabel까지 여기서 만들어서 levelUpMissing과 절대 서로 어긋나지 않게 한다.
  function levelUpRequirementRows(tileId) {
    const tile = state.tiles[tileId];
    const target = tile.level + 1;
    const rows = [];
    if (tile.type !== "성") {
      const cur = state.tiles.castle.level;
      rows.push({ label: "성", cur, need: target, ok: cur >= target, missingLabel: `성 Lv.${target}`, progressLabel: `Lv.${cur}/${target}` });
    }
    (LEVEL_REQUIREMENTS[tile.type] || []).forEach((r) => {
      const need = target + r.offset;
      if (need > 1) {
        const cur = maxLevelOfType(r.type);
        rows.push({ label: r.type, cur, need, ok: cur >= need, missingLabel: `${r.type} Lv.${need}`, progressLabel: `Lv.${cur}/${need}` });
      }
    });
    if (tileId === "castle") {
      (CASTLE_UNLOCK_GATES[target] || []).forEach((g) => {
        if (g.kind === "buildingLevel") {
          const cur = maxLevelOfType(g.type);
          rows.push({ label: g.type, cur, need: g.need, ok: cur >= g.need, missingLabel: `${g.type} Lv.${g.need}`, progressLabel: `Lv.${cur}/${g.need}` });
        } else if (g.kind === "monsterKills") {
          const cur = Math.min(state.monsterKillsSinceGate, g.need);
          const ok = state.monsterKillsSinceGate >= g.need;
          rows.push({ label: "몬스터 처치", cur, need: g.need, ok, missingLabel: `몬스터 처치 ${g.need}마리`, progressLabel: `${cur}/${g.need}마리` });
        } else if (g.kind === "raidBossDefeated") {
          const boss = RAID_BOSSES.find((b) => b.id === g.bossId);
          const ok = !!(state.raids[g.bossId] && state.raids[g.bossId].defeated);
          rows.push({ label: `${boss.name} 처치`, cur: ok ? 1 : 0, need: 1, ok, missingLabel: `레이드 보스 ${boss.name} 처치`, progressLabel: ok ? "처치 완료" : "미처치" });
        }
      });
    }
    return rows;
  }
  // 레벨업 선행조건: 성이 항상 상한선 + 건물별 기본 연관 건물 레벨 + 성 전용 특별 조건
  function levelUpMissing(tileId) {
    return levelUpRequirementRows(tileId).filter((r) => !r.ok).map((r) => r.missingLabel);
  }
  function renderReqChecklistHTML(tileId) {
    const tile = state.tiles[tileId];
    if (tile.level >= MAX_LEVEL) return "";
    const rows = levelUpRequirementRows(tileId);
    return `
      <div class="req-list">
        <div class="req-title">🔒 다음 레벨(Lv.${tile.level + 1}) 조건</div>
        ${rows.length
          ? rows.map((r) => `<div class="req-row ${r.ok ? "ok" : "blocked"}">${r.ok ? "✅" : "❌"} ${r.label} ${r.progressLabel}</div>`).join("")
          : `<div class="req-row ok">✅ 조건 없음</div>`}
      </div>
    `;
  }

  // ---------- 자원/훈련/전투 틱 ----------
  function tick() {
    state.lastActiveAt = Date.now();
    state.tavern.timer -= 1;
    let tavernRerolled = false;
    if (state.tavern.timer <= 0) {
      rerollTavern();
      state.tavern.resetCost = TAVERN_RESET_BASE_COST;
      tavernRerolled = true;
      toast("🍺 여관이 초기화됐습니다 — 새 영웅들!");
    }
    const prodBonus = 1 + researchPercent("productionPercent") / 100;
    const goldBonus = 1 + researchPercent("goldPercent") / 100;
    TILE_LAYOUT.forEach((def) => {
      const tile = state.tiles[def.id];
      if (!tile.built || !tile.type) return;
      const bdef = BUILDING_TYPES[tile.type];
      const mult = 1 + bonusPercentFor(def.id) / 100;
      if (bdef.base.food) addRes("food", bdef.base.food * tile.level * mult * prodBonus);
      if (bdef.base.wood) addRes("wood", bdef.base.wood * tile.level * mult * prodBonus);
      if (bdef.base.stone) addRes("stone", bdef.base.stone * tile.level * mult * prodBonus);
      if (bdef.base.gold) addRes("gold", bdef.base.gold * tile.level * mult * goldBonus);
      if (tile.type === "병영" && tile.training) {
        tile.training.timeLeft -= 1;
        if (tile.training.timeLeft <= 0) {
          const t = TROOP_TYPES_BY_KEY[tile.training.type];
          state.troopsByType[tile.training.type] = (state.troopsByType[tile.training.type] || 0) + tile.training.count;
          toast(`✅ ${t.name} ${tile.training.count}명 훈련 완료!`);
          logEvent(`🪖 ${t.name} ${tile.training.count}명 훈련 완료!`, "train");
          tile.training = null;
        }
      }
    });
    // 병사 유지비 — 보유한 모든 병사가 매초 식량을 소모한다(0 아래로는 내려가지 않음,
    // 강제 이탈 없음 — 자원이 부족하면 그냥 식량 생산이 유지비에 잠식될 뿐).
    let totalUpkeep = 0;
    Object.entries(state.troopsByType).forEach(([key, count]) => {
      const t = TROOP_TYPES_BY_KEY[key];
      if (t && count) totalUpkeep += troopUpkeepFoodPerSecond(t) * count;
    });
    if (totalUpkeep > 0) state.res.food = Math.max(0, state.res.food - totalUpkeep);
    Object.keys(state.tiles).forEach((tileId) => {
      const tile = state.tiles[tileId];
      if (!tile.upgrading) return;
      tile.upgrading.timeLeft -= 1;
      if (tile.upgrading.timeLeft <= 0) completeUpgrade(tileId);
    });
    state.monsters.forEach((slot) => {
      if (!slot.monster) {
        slot.respawnTimer -= 1;
        if (slot.respawnTimer <= 0) spawnMonster(slot);
      }
    });
    state.monsterRotationTimer -= 1;
    if (state.monsterRotationTimer <= 0) {
      rotateFieldMonsters();
      state.monsterRotationTimer = MONSTER_ROTATION_SECONDS;
    }
    state.worldCastles.forEach((c) => {
      const cap = castleBankCap(c.level);
      const rate = castleBankRate(c.level);
      ["food", "wood", "stone", "gold"].forEach((r) => { c.bank[r] = Math.min(cap, c.bank[r] + rate); });
    });
    state.armies.forEach((army, idx) => {
      if (!army.mission) return;
      army.mission.timeLeft -= 1;
      if (army.mission.timeLeft <= 0) {
        if (army.mission.phase === "march") startBattle(idx);
        else resolveBattle(idx);
      }
    });
    if (simulating) return;
    renderTopbar();
    renderBoard();
    renderMonsterArea();
    renderWorldMap();
    renderWallFrame();
    // 월드맵 화면이 열려 있을 땐 renderWorldMap()이 이미 4초마다 미션을 가져오며 결과를
    // 확인하므로 중복 요청하지 않는다 — 다른 화면을 보고 있을 때만 이 뜸한 폴링이 필요하다.
    const worldMapEl = document.getElementById("screen-worldmap");
    if (currentPlayer && worldMapEl && worldMapEl.hidden) {
      const nowTs = Date.now();
      if (nowTs - lastPvpNotifyFetchAt > PVP_NOTIFY_INTERVAL_MS) {
        lastPvpNotifyFetchAt = nowTs;
        pollPvpNotificationsAmbient();
      }
    }
    if (!document.getElementById("modal-tavern").hidden) {
      renderTavernModal();
      if (tavernRerolled) renderTavernCards();
    }
    if (!document.getElementById("modal-building").hidden && openBuildingTileId) {
      openBuildingModal(openBuildingTileId);
    }
    if (!document.getElementById("modal-raid").hidden) renderRaidModal();
    if (!document.getElementById("modal-raid-battle").hidden) renderRaidBattleModal();
    if (!document.getElementById("modal-inventory").hidden) renderInventoryModal();
    save();
  }
  // 탭이 백그라운드에 있거나 브라우저가 완전히 꺼져있던 동안에도 자원/훈련/
  // 레벨업/전투가 계속 진행된 것처럼 만들어준다. tick()을 그대로 여러 번 빠르게
  // 재생해 실제 초 단위 로직과 항상 같은 결과가 나오도록 하고(로직 중복 없음),
  // 그 사이 toast/logEvent/렌더는 simulating 플래그로 조용히 건너뛴다.
  function applyOfflineProgress() {
    const now = Date.now();
    const elapsedSeconds = Math.floor((now - (state.lastActiveAt || now)) / 1000);
    if (elapsedSeconds < 2) { state.lastActiveAt = now; return; }
    const seconds = Math.min(OFFLINE_CAP_SECONDS, elapsedSeconds);
    simulating = true;
    for (let i = 0; i < seconds; i++) tick();
    simulating = false;
    state.lastActiveAt = now;
    renderTopbar();
    renderBoard();
    renderMonsterArea();
    renderWorldMap();
    renderWallFrame();
    save();
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const away = h > 0 ? `${h}시간 ${m}분` : `${m}분`;
    toast(`🕐 자리를 비운 ${away} 동안 도시가 계속 운영되었습니다`);
    logEvent(`🕐 ${away} 동안의 오프라인 진행을 반영했습니다`, "build");
  }
  function addRes(res, amount) {
    const cap = capFor(res);
    const before = state.res[res];
    state.res[res] = Math.min(cap, state.res[res] + amount);
    if (state.res[res] !== before) pulseRes(res);
  }

  // ---------- 여관/가챠 ----------
  function currentRollTable() {
    const boost = researchPercent("rarityBoost");
    if (!boost) return ROLL_TABLE;
    const table = ROLL_TABLE.map((r) => ({ ...r }));
    const t1 = table.find((r) => r.rarity === 1);
    const t6 = table.find((r) => r.rarity === 6);
    const t7 = table.find((r) => r.rarity === 7);
    const t8 = table.find((r) => r.rarity === 8);
    const take = Math.min(t1.p - 5, boost * 0.08);
    if (take > 0) {
      t1.p -= take;
      t6.p += take * 0.4;
      t7.p += take * 0.35;
      t8.p += take * 0.25;
    }
    return table;
  }
  function rollRarity() {
    const table = currentRollTable();
    const r = Math.random() * 100;
    let acc = 0;
    for (const row of table) {
      acc += row.p;
      if (r < acc) return row.rarity;
    }
    return 1;
  }
  function rollHeroId() {
    const rarity = rollRarity();
    if (rarity === "kami") return KAMI ? KAMI.id : null;
    const pool = HEROES.filter((h) => h.rarity === rarity && !h.secret);
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)].id;
  }
  // 레이드 확정 소환권용 — 평소 확률표(currentRollTable, 연구 보너스 포함)에서
  // floorRarity 미만인 등급만 잘라내고 남은 등급끼리 비율을 재조정해서 뽑는다.
  // 그래서 "5성 이상 확정"이어도 5성이 압도적으로 많고 까미/8성은 여전히 희귀하다.
  function rollHeroIdAtLeast(floorRarity) {
    const table = currentRollTable().filter((r) => r.rarity === "kami" || r.rarity >= floorRarity);
    const total = table.reduce((s, r) => s + r.p, 0);
    let roll = Math.random() * total;
    let rarity = floorRarity;
    for (const row of table) {
      roll -= row.p;
      if (roll <= 0) { rarity = row.rarity; break; }
    }
    if (rarity === "kami") return KAMI ? KAMI.id : null;
    const pool = HEROES.filter((h) => h.rarity === rarity && !h.secret);
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)].id;
  }
  function tavernSlotCount() {
    return tavernSlotsForLevel(state.tiles.tavern.level || 1);
  }
  function rerollTavern() {
    const n = tavernSlotCount();
    state.tavern.candidates = new Array(n).fill(null).map(() => rollHeroId());
    state.tavern.timer = TAVERN_CYCLE;
  }
  function tavernResetCost() {
    const cost = state.tavern.resetCost * (1 + researchPercent("resetCostPercent") / 100);
    return Math.max(0, Math.round(cost));
  }
  function recruitCost(hero) {
    const base = hero.secret ? 100 : Math.round(5 * hero.rarity * hero.rarity);
    return Math.max(1, Math.round(base * (1 + researchPercent("recruitCostPercent") / 100)));
  }
  function addOwned(heroId) {
    const hero = HERO_BY_ID[heroId];
    if (!state.owned[heroId]) {
      state.owned[heroId] = { enhance: 0, shards: 0, count: 1 };
      toast(`✨ 새 영웅 도감 등록: ${hero.name} (★${hero.rarity})`);
    } else {
      state.owned[heroId].shards += 1;
      state.owned[heroId].count += 1;
      toast(`중복 영입: ${hero.name} 조각 +1 (보유 ${state.owned[heroId].count}번째, 조각 ${state.owned[heroId].shards})`);
    }
  }
  // ---------- 영입 연출(등급별 임팩트) ----------
  // 확률표(★1~3 83% · ★4~5 16.5% · ★6~7 0.45% · ★8/까미 0.1%)가 극단적으로 갈리므로,
  // 자주 나오는 낮은 등급은 가볍게, 희귀할수록 화면을 장악하는 연출로 체감 차이를 크게 준다.
  function heroRevealTier(hero) {
    if (hero.rarity >= 8) return "ultra";
    if (hero.rarity >= 6) return "high";
    if (hero.rarity >= 4) return "mid";
    return "low";
  }
  // CSS --r1~--r7 변수를 그대로 읽어와 색을 이중 관리하지 않는다(--r8은 별 배지용
  // conic-gradient라 단색이 필요한 자리엔 못 쓰므로 금색으로 대신한다).
  function rarityFxColor(rarity) {
    if (rarity >= 8) return "#ffd93d";
    return getComputedStyle(document.documentElement).getPropertyValue(`--r${rarity}`).trim() || "#fff";
  }
  function spawnRecruitFX(originRect, hero, tier) {
    if (simulating || tier === "ultra") return;
    const layer = document.getElementById("fx-layer");
    const color = rarityFxColor(hero.rarity);
    const x = originRect ? originRect.left + originRect.width / 2 : window.innerWidth / 2;
    const y = originRect ? originRect.top + originRect.height / 2 : window.innerHeight / 2;
    const wrap = document.createElement("div");
    wrap.className = "fx-burst";
    wrap.style.setProperty("--fx-x", `${x}px`);
    wrap.style.setProperty("--fx-y", `${y}px`);
    wrap.style.setProperty("--fx-color", color);
    const sparkCount = tier === "high" ? 16 : tier === "mid" ? 9 : 5;
    const maxDist = tier === "high" ? 90 : tier === "mid" ? 62 : 40;
    let html = `<div class="fx-ring"></div>`;
    for (let i = 0; i < sparkCount; i++) {
      const ang = Math.round((360 / sparkCount) * i + (Math.random() * 16 - 8));
      const dist = Math.round(maxDist * 0.55 + Math.random() * maxDist * 0.45);
      html += `<div class="fx-spark" style="--ang:${ang}deg;--dist:${dist}px"></div>`;
    }
    wrap.innerHTML = html;
    layer.appendChild(wrap);
    setTimeout(() => wrap.remove(), 900);
    if (tier === "high") {
      const flash = document.createElement("div");
      flash.className = "fx-flash";
      flash.style.setProperty("--fx-color", color);
      layer.appendChild(flash);
      setTimeout(() => flash.remove(), 550);
      const banner = document.createElement("div");
      banner.className = "fx-banner";
      banner.style.setProperty("--fx-color", color);
      banner.innerHTML = `★${hero.rarity} 영웅 등장!<br>${hero.name}`;
      layer.appendChild(banner);
      setTimeout(() => banner.remove(), 1400);
      const stage = document.querySelector(".modal-overlay:not([hidden]) .modal");
      if (stage) {
        stage.classList.add("fx-shake-once");
        setTimeout(() => stage.classList.remove("fx-shake-once"), 420);
      }
    }
  }
  // ★8/까미 전용 — 확률 합계 0.1%인 최상위 등급이므로 화면을 통째로 차지하는 전용
  // 모달로 확실히 다른 등급과 체감 차이를 준다(다른 등급은 spawnRecruitFX로 충분).
  function openHeroRevealModal(hero) {
    if (simulating) return;
    const isKami = !!hero.secret;
    const color = isKami ? "#ffd93d" : rarityFxColor(hero.rarity);
    const panel = document.querySelector("#modal-hero-reveal .hero-reveal-modal");
    panel.classList.toggle("kami", isKami);
    let confetti = "";
    for (let i = 0; i < 18; i++) {
      const ang = Math.round(Math.random() * 360);
      const dist = Math.round(90 + Math.random() * 130);
      const delay = (Math.random() * 0.25).toFixed(2);
      confetti += `<span style="--ang:${ang}deg;--dist:${dist}px;--fx-delay:${delay}s"></span>`;
    }
    document.getElementById("hero-reveal-body").innerHTML = `
      <div class="hr-stage" style="--hr-color:${color}">
        <div class="hr-rays"></div>
        <div class="hr-confetti">${confetti}</div>
        <div class="hr-portrait-wrap">${heroPortraitHTML(hero)}</div>
        <div class="hr-title">${isKami ? "✨ 궁극의 존재 ✨" : "★8 최고 등급 영웅"}</div>
        <div class="hr-name">${hero.name}</div>
        <div class="hr-stars">${heroStarRowHTML(hero.rarity)}</div>
      </div>
    `;
    openModal("modal-hero-reveal");
  }
  function playRecruitReveal(hero, originRect) {
    const tier = heroRevealTier(hero);
    if (tier === "ultra") openHeroRevealModal(hero);
    else spawnRecruitFX(originRect, hero, tier);
  }
  // 레이드 확정 소환권 1장을 소모해 즉시 영웅 1명을 영입한다(여관 자원 비용 없음)
  function redeemRaidTicket(rarity) {
    const key = rarity >= 6 ? "t6" : "t5";
    if ((state.raidTickets[key] || 0) <= 0) { toast("보유한 소환권이 없습니다"); return; }
    const heroId = rollHeroIdAtLeast(rarity);
    if (heroId == null) { toast("영입할 수 있는 영웅이 없습니다"); return; }
    state.raidTickets[key] -= 1;
    addOwned(heroId);
    playRecruitReveal(HERO_BY_ID[heroId], null);
    renderInventoryModal();
    renderTopbar();
    save();
  }
  function recruit(slotIndex, originRect) {
    const heroId = state.tavern.candidates[slotIndex];
    if (heroId === null || heroId === undefined) return;
    const hero = HERO_BY_ID[heroId];
    const cost = recruitCost(hero);
    if (state.res.gold < cost) { toast("🪙 금화가 부족합니다"); return; }
    state.res.gold -= cost;
    addOwned(heroId);
    state.tavern.candidates[slotIndex] = null;
    renderTavernCards();
    renderTopbar();
    playRecruitReveal(hero, originRect);
    save();
  }
  // 별 등급은 뽑힌 즉시 고정. 대신 중복 조각으로 같은 영웅을 "강화"(0~5강)해 스탯/효과를 올린다.
  function enhance(heroId) {
    const hero = HERO_BY_ID[heroId];
    const o = state.owned[heroId];
    if (!o) return;
    if (o.enhance >= MAX_ENHANCE) { toast(`이미 최고 강화(+${MAX_ENHANCE}강)입니다`); return; }
    const needed = 3 * (o.enhance + 1);
    if (o.shards < needed) { toast(`조각이 부족합니다 (${o.shards}/${needed})`); return; }
    o.shards -= needed;
    o.enhance += 1;
    toast(`🌟 ${hero.name} 강화! → +${o.enhance}강`);
    renderBoard();
    save();
  }

  // ---------- 건설/배치 ----------
  // 건설 완료 순간에만 재생하는 1회성 팝 이펙트용 — renderBoard()가 이 타일이면
  // .just-built을 붙였다가 애니메이션 길이만큼 지나면 스스로 지운다(무한 반복 아님)
  let justBuiltTileId = null;
  function flashJustBuilt(tileId) {
    justBuiltTileId = tileId;
    setTimeout(() => { if (justBuiltTileId === tileId) justBuiltTileId = null; }, 800);
  }
  // 레벨업 완료 순간에만 재생하는 이펙트 — 건설(.just-built)과 같은 방식이지만
  // 신축과 구분되도록 별도 클래스(.just-upgraded)로 다른 애니메이션을 재생한다
  let justUpgradedTileId = null;
  function flashJustUpgraded(tileId) {
    justUpgradedTileId = tileId;
    setTimeout(() => { if (justUpgradedTileId === tileId) justUpgradedTileId = null; }, 900);
  }
  function build(tileId) {
    const tile = state.tiles[tileId];
    const bdef = BUILDING_TYPES[tile.type];
    if (tile.built) return;
    const cost = { gold: bdef.buildCostGold };
    if (!canAfford(cost)) { toast("🪙 금화가 부족합니다"); return; }
    pay(cost);
    tile.built = true;
    tile.level = 1;
    toast(`🏗️ ${tile.type} 건설 완료!`);
    logEvent(`🏗️ ${tile.type} 건설 완료!`, "build");
    closeModal("modal-building");
    flashJustBuilt(tileId);
    renderBoard();
    renderTopbar();
    renderWallFrame();
    save();
  }
  function chooseType(tileId, type) {
    const tile = state.tiles[tileId];
    const bdef = BUILDING_TYPES[type];
    const cost = { gold: bdef.buildCostGold };
    if (!canAfford(cost)) { toast("🪙 금화가 부족합니다"); return; }
    pay(cost);
    tile.type = type;
    tile.built = true;
    tile.level = 1;
    toast(`🏗️ ${type} 건설 완료!`);
    logEvent(`🏗️ ${type} 건설 완료!`, "build");
    closeModal("modal-building");
    flashJustBuilt(tileId);
    renderBoard();
    renderTopbar();
    save();
  }
  // 성/아카데미/여관/방어탑/감시탑/자원보호소/성벽 등 고정 건물(selectable=false)은 철거 대상에서 제외
  function demolish(tileId) {
    const tile = state.tiles[tileId];
    const bdef = BUILDING_TYPES[tile.type];
    if (!bdef || !bdef.selectable) return;
    if (tile.upgrading) { toast("⚠️ 레벨업 진행 중에는 철거할 수 없습니다"); return; }
    if (tile.training) { toast("⚠️ 훈련 진행 중에는 철거할 수 없습니다"); return; }
    if (!confirm(`${tile.type}을 철거 하시겠습니까?`)) return;
    const name = tile.type;
    tile.type = null;
    tile.built = false;
    tile.level = 0;
    tile.heroIds = [];
    tile.training = null;
    tile.upgrading = null;
    toast(`🧨 ${name} 철거 완료`);
    closeModal("modal-building");
    renderBoard();
    renderTopbar();
    save();
  }
  function upgrade(tileId) {
    const tile = state.tiles[tileId];
    if (tile.level >= MAX_LEVEL) { toast(`이미 최대 레벨(${MAX_LEVEL})입니다`); return; }
    if (tile.upgrading) { toast("이미 레벨업이 진행 중입니다"); return; }
    const missing = levelUpMissing(tileId);
    if (missing.length) { toast(`레벨업 조건 부족: ${missing.join(", ")}`); return; }
    const cost = upgradeCostFor(tile.type, tile.level);
    if (!cost) return;
    if (!canAfford(cost)) { toast("자원이 부족합니다"); return; }
    pay(cost);
    // 몬스터 처치 조건을 소모하는 성 레벨업이 확정되는 순간, 다음 조건을 위해 카운트를 비운다.
    if (tileId === "castle" && (CASTLE_UNLOCK_GATES[tile.level + 1] || []).some((g) => g.kind === "monsterKills")) {
      state.monsterKillsSinceGate = 0;
    }
    const seconds = upgradeSecondsFor(tile.level);
    tile.upgrading = { targetLevel: tile.level + 1, timeLeft: seconds, total: seconds };
    toast(`🏗️ ${tile.type} 레벨업 시작! (${seconds}s 후 Lv.${tile.upgrading.targetLevel})`);
    if (tile.type === "여관") renderTavernModal();
    else openBuildingModal(tileId);
    renderBoard();
    renderTopbar();
    save();
  }
  function completeUpgrade(tileId) {
    const tile = state.tiles[tileId];
    tile.level = tile.upgrading.targetLevel;
    tile.upgrading = null;
    if (tile.type === "여관") {
      const need = tavernSlotsForLevel(tile.level) - state.tavern.candidates.length;
      for (let i = 0; i < need; i++) state.tavern.candidates.push(rollHeroId());
      renderTavernCards();
    }
    toast(`⬆️ ${tile.type} 레벨 ${tile.level}!`);
    logEvent(`⬆️ ${withSubjectParticle(tile.type)} ${tile.level}레벨 달성!`, "levelup");
    flashJustUpgraded(tileId);
    renderWallFrame();
  }
  // 영웅이 현재 배치된 곳(부대 또는 건물)을 사람이 읽을 수 있는 이름으로 돌려준다(없으면 null).
  // 건물/부대 어느 한쪽에 배치하면 다른 모든 곳에서 자동으로 해제되는 상호배타 규칙이라,
  // 배치 후보 목록에 뜬 영웅을 유저가 "지금 비어있는 줄" 착각하고 눌러 다른 곳의 배치를
  // 조용히 풀어버리는 일이 없도록, 목록에서 미리 위치를 보여주는 데 쓴다.
  // 정보 표시용 — 건물/부대 어느 쪽이든 지금 배치돼 있는 곳을 보여준다(둘 다에
  // 동시에 배치될 수 있으므로 부대가 우선 표시된다는 뜻은 아니고, 목록 뱃지에는
  // 하나만 보여주면 충분해 부대 쪽을 먼저 확인한다).
  function heroPlacementLocation(heroId) {
    const armyIdx = state.armies.findIndex((a) => a.heroIds.includes(heroId));
    if (armyIdx !== -1) return `부대 ${armyIdx + 1}`;
    const tile = Object.values(state.tiles).find((t) => Array.isArray(t.heroIds) && t.heroIds.includes(heroId));
    return tile ? tile.type : null;
  }
  function heroBuildingLocation(heroId) {
    const tile = Object.values(state.tiles).find((t) => Array.isArray(t.heroIds) && t.heroIds.includes(heroId));
    return tile ? tile.type : null;
  }
  function heroArmyLocation(heroId) {
    const armyIdx = state.armies.findIndex((a) => a.heroIds.includes(heroId));
    return armyIdx !== -1 ? `부대 ${armyIdx + 1}` : null;
  }
  // 건물 배치와 군대 편성은 서로 독립이다 — 같은 영웅을 건물에도, 부대에도
  // 동시에 배치할 수 있다. 단, 같은 종류 안에서는 한 곳에만 있을 수 있으므로
  // (건물↔건물, 부대↔부대) 재배치 직전에 "같은 종류"에서만 정리한다.
  function clearHeroFromBuildings(heroId) {
    Object.values(state.tiles).forEach((t) => {
      if (Array.isArray(t.heroIds)) t.heroIds = t.heroIds.filter((h) => h !== heroId);
    });
  }
  function clearHeroFromArmies(heroId) {
    state.armies.forEach((a) => { a.heroIds = a.heroIds.map((h) => (h === heroId ? null : h)); });
  }
  function assignHero(tileId, heroId) {
    if (state.armies.some((a) => a.mission && a.heroIds.includes(heroId))) {
      toast("출정 중인 영웅은 배치를 바꿀 수 없습니다");
      return;
    }
    const tile = state.tiles[tileId];
    if (tile.heroIds.includes(heroId)) return;
    if (tile.heroIds.length >= MAX_HEROES_PER_BUILDING) {
      toast(`한 건물에는 최대 ${MAX_HEROES_PER_BUILDING}명까지 배치할 수 있습니다`);
      return;
    }
    const prevLocation = heroBuildingLocation(heroId);
    clearHeroFromBuildings(heroId);
    tile.heroIds.push(heroId);
    toast(prevLocation
      ? `${HERO_BY_ID[heroId].name}의 ${prevLocation} 배치가 해제되고 ${tile.type}에 배치되었습니다`
      : `${HERO_BY_ID[heroId].name} 배치 완료`);
    openBuildingModal(tileId);
    renderBoard();
    save();
  }
  function unassignHero(tileId, heroId) {
    const tile = state.tiles[tileId];
    tile.heroIds = tile.heroIds.filter((h) => h !== heroId);
    openBuildingModal(tileId);
    renderBoard();
    save();
  }

  // ---------- 병영: 병사 훈련 ----------
  function startTraining(tileId, typeKey, count) {
    const tile = state.tiles[tileId];
    const type = TROOP_TYPES_BY_KEY[typeKey];
    if (!type || type.unlockLevel > tile.level) { toast("아직 해금되지 않은 병사입니다"); return; }
    if (tile.training) { toast("이미 훈련 중입니다"); return; }
    count = Math.max(1, Math.floor(count) || 0);
    const cost = {};
    Object.entries(type.cost).forEach(([r, v]) => { cost[r] = v * count; });
    if (!canAfford(cost)) { toast("자원이 부족합니다"); return; }
    pay(cost);
    // 병영에 배치된 영웅의 "병영" 특성만큼 훈련 시간을 단축한다(예전엔 base가 비어있어
    // 죽어있던 효과 — 이제 쿨감소로 실제 작동한다).
    const baseSeconds = type.trainSeconds * count;
    const seconds = Math.max(1, Math.round(baseSeconds / (1 + bonusPercentFor(tileId) / 100)));
    tile.training = { type: typeKey, count, timeLeft: seconds, total: seconds };
    toast(`🪖 ${type.name} ${count}명 훈련 시작`);
    openBuildingModal(tileId);
    renderBoard();
    renderTopbar();
    save();
  }

  // ---------- 군대(부대) / 전투 ----------
  function armyStats(heroIds, comp) {
    let troopAtk = 0, troopDef = 0, troopHp = 0;
    Object.entries(comp || {}).forEach(([key, count]) => {
      const t = TROOP_TYPES_BY_KEY[key];
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
      const scale = 1 + 0.15 * heroEnhance(id);
      heroAtk += hero.atk * scale;
      heroDef += hero.def * scale;
      heroHp += hero.hp * scale;
      heroCombatTraits(hero).forEach((t) => { bonus[t.statKey] += heroTraitPercent(hero, t); });
    });
    const researchTroop = 1 + researchPercent("troopPercent") / 100;
    troopAtk *= (1 + bonus.atk / 100) * researchTroop;
    troopDef *= (1 + bonus.def / 100) * researchTroop;
    troopHp *= (1 + bonus.hp / 100) * researchTroop;
    // 방어탑은 더 이상 원정(PvE 몬스터/월드 성 공략) 부대를 강화하지 않는다 — 수성(정복 맵
    // PvP 방어) 전용으로 역할이 바뀌었고, 실제 적용은 서버 workers/src/lib/combat.js의
    // homeDefenseMultiplier()가 담당한다.
    return { atk: heroAtk + troopAtk, def: heroDef + troopDef, hp: heroHp + troopHp };
  }
  // 정복 맵 출정/귀환 시간의 기준. 이동속도 특성이 없는 최하급 병종(민병대, speed=1)
  // 기준으로 인접 타일(거리 1) 편도가 정확히 18초가 되도록 잡았다 — 200x200 맵의
  // 대각선 최장 거리(199칸)를 이동해도 199×18=3,582초(59.7분)로 1시간을 넘지 않는다.
  const BASE_SECONDS_PER_TILE = 18;
  // 부대의 이동속도 배율 = (편성된 병종 중 가장 느린 speed) x (1 + 영웅 이동속도 특성 합산%/100)
  // 실제 병력이 하나도 없는 경우(사전 미리보기 등)에는 최하급 병종 speed를 기본값으로 쓴다.
  function armySpeedMultiplier(heroIds, comp) {
    const activeSpeeds = Object.entries(comp || {})
      .filter(([, count]) => count > 0)
      .map(([key]) => (TROOP_TYPES_BY_KEY[key] || TROOP_TYPES[0]).speed);
    const baseSpeed = activeSpeeds.length ? Math.min(...activeSpeeds) : TROOP_TYPES[0].speed;
    let bonus = 0;
    (heroIds || []).filter(Boolean).forEach((id) => {
      const hero = HERO_BY_ID[id];
      if (!hero) return;
      heroMovementTraits(hero).forEach((t) => { bonus += heroTraitPercent(hero, t); });
    });
    return baseSpeed * (1 + bonus / 100);
  }
  // 부대의 총 수송력 = 병종별 capacity×인원 합산 x (1 + 영웅 cargo 특성 합산%/100).
  // 정복 맵 공격 시 이 값이 실제 약탈 가능한 자원 총량의 상한이 된다(서버
  // workers/src/lib/combat.js의 armyCarryCapacity와 동일한 공식).
  function armyCarryCapacity(heroIds, comp) {
    let base = 0;
    Object.entries(comp || {}).forEach(([key, count]) => {
      const t = TROOP_TYPES_BY_KEY[key];
      if (!t || !count) return;
      base += t.capacity * count;
    });
    let bonus = 0;
    (heroIds || []).filter(Boolean).forEach((id) => {
      const hero = HERO_BY_ID[id];
      if (!hero) return;
      heroCargoTraits(hero).forEach((t) => { bonus += heroTraitPercent(hero, t); });
    });
    return Math.round(base * (1 + bonus / 100));
  }
  function travelTimeSeconds(distanceTiles, speedMultiplier) {
    return Math.max(1, Math.round((distanceTiles * BASE_SECONDS_PER_TILE) / Math.max(0.01, speedMultiplier)));
  }
  // 부대 편성 화면에서 한눈에 비교할 수 있는 종합 전투력 수치(공격+방어+체력 합산)
  function armyPowerScore(heroIds, comp) {
    const s = armyStats(heroIds, comp);
    return Math.round(s.atk + s.def + s.hp);
  }
  function totalDeployedTroops(comp) {
    return Object.values(comp || {}).reduce((s, v) => s + (v || 0), 0);
  }
  function battleDurationFor(level, elite) {
    return 8 + Math.min(10, Math.floor(level / 4)) + (elite ? 4 : 0);
  }
  function computeVerdict(heroIds, comp, enemy, duration) {
    const army = armyStats(heroIds, comp);
    const dmgToEnemy = Math.max(1, army.atk - enemy.def * 0.5) * duration;
    const ratio = dmgToEnemy / Math.max(1, enemy.hp);
    let label = "어려움", cls = "hard";
    if (ratio >= 1.6) { label = "쉬움"; cls = "easy"; }
    else if (ratio >= 1.0) { label = "적절"; cls = "moderate"; }
    return { win: ratio >= 1, ratio, label, cls, army };
  }
  function squadIsFree(idx) { return !state.armies[idx].mission; }
  // 몬스터/월드맵 성 공용 타깃 조회: mission.kind에 따라 실제 적 스탯 객체를 찾아준다.
  function findEnemy(kind, targetId) {
    if (kind === "castle") return state.worldCastles.find((c) => c.id === targetId) || null;
    if (kind === "raid") {
      const boss = RAID_BOSSES.find((b) => b.id === targetId);
      if (!boss) return null;
      return { key: boss.key, name: boss.name, icon: boss.icon, elite: true, level: boss.level, ...raidBossStats(boss) };
    }
    const slot = state.monsters.find((s) => s.id === targetId);
    return slot && slot.monster ? slot.monster : null;
  }
  function totalOwnedTroops() {
    return Object.values(state.troopsByType).reduce((s, v) => s + v, 0);
  }
  function dispatchSquad(squadIdx, kind, targetId, comp) {
    const army = state.armies[squadIdx];
    if (!army || army.mission) { toast("해당 부대는 이미 출정 중입니다"); return; }
    const enemy = findEnemy(kind, targetId);
    if (!enemy) { toast("공격할 수 없습니다"); return; }
    if (kind === "raid") {
      const boss = RAID_BOSSES.find((b) => b.id === targetId);
      if (!boss) { toast("공격할 수 없습니다"); return; }
      if (!raidBossUnlocked(boss)) { toast(`먼저 ${RAID_BOSSES.find((b2) => b2.id === boss.requires).name}을(를) 처치해야 합니다`); return; }
      if (raidOnCooldown(targetId)) { toast(`아직 재도전 대기시간이 남았습니다 (${formatCountdownShort(RAID_COOLDOWN_MS - (Date.now() - state.raids[targetId].lastDefeatedAt))})`); return; }
    }
    if (state.armies.some((a) => a.mission && a.mission.kind === kind && a.mission.targetId === targetId)) { toast("이미 다른 부대가 그 대상을 공격 중입니다"); return; }
    const total = totalDeployedTroops(comp);
    const owned = totalOwnedTroops();
    if (total > 0 && total < Math.min(MIN_DEPLOY, owned)) { toast(`최소 ${MIN_DEPLOY}명 이상 파병해야 합니다`); return; }
    const heroCount = army.heroIds.filter(Boolean).length;
    if (total <= 0 && heroCount === 0) { toast("영웅 또는 병사를 배치해야 합니다"); return; }
    for (const [key, count] of Object.entries(comp)) {
      if (count > (state.troopsByType[key] || 0)) { toast("보유 병사가 부족합니다"); return; }
    }
    Object.entries(comp).forEach(([key, count]) => { state.troopsByType[key] -= count; });
    army.lastComp = { ...comp };
    closeModal("modal-monster");
    if (kind === "raid") {
      // 레이드는 진군 없이 곧장 전투로 들어간다 — 전용 팝업이 그 자리에서 전투 연출과
      // 결과를 바로 보여주므로, 다른 원정처럼 도착을 기다릴 이유가 없다.
      const battleDuration = battleDurationFor(enemy.level, true);
      army.mission = { kind, targetId, comp, phase: "battle", timeLeft: battleDuration, battleDuration };
      toast(`⚔️ 부대 ${squadIdx + 1} 전투 시작! → ${enemy.name}(Lv.${enemy.level})`);
      openRaidBattleModal(squadIdx);
    } else {
      const marchTime = kind === "castle" ? 8 + enemy.level : 5 + Math.round(enemy.level / 3) + (enemy.elite ? 5 : 0);
      army.mission = { kind, targetId, comp, phase: "march", timeLeft: marchTime, marchTime };
      toast(`🪖 부대 ${squadIdx + 1} 출정! → ${enemy.name}(Lv.${enemy.level})`);
    }
    renderMonsterArea();
    renderWorldMap();
    save();
  }
  function startBattle(squadIdx) {
    const army = state.armies[squadIdx];
    const mission = army.mission;
    const enemy = findEnemy(mission.kind, mission.targetId);
    if (!enemy) { army.mission = null; return; }
    mission.phase = "battle";
    mission.battleDuration = battleDurationFor(enemy.level, !!enemy.elite);
    mission.timeLeft = mission.battleDuration;
  }
  function resolveBattle(squadIdx) {
    const army = state.armies[squadIdx];
    const mission = army.mission;
    const enemy = findEnemy(mission.kind, mission.targetId);
    if (!enemy) { army.mission = null; return; }
    const verdict = computeVerdict(army.heroIds, mission.comp, enemy, mission.battleDuration);
    const dmgToArmy = Math.max(1, enemy.atk - verdict.army.def * 0.3) * mission.battleDuration;
    const lossRatio = verdict.win ? Math.min(0.6, dmgToArmy / Math.max(1, verdict.army.hp)) : Math.min(1, dmgToArmy / Math.max(1, verdict.army.hp));
    let totalLost = 0;
    Object.entries(mission.comp).forEach(([key, count]) => {
      const lost = Math.round(count * lossRatio);
      totalLost += lost;
      state.troopsByType[key] = (state.troopsByType[key] || 0) + (count - lost);
    });
    let reward = {};
    let bonusMsg = "";
    if (verdict.win) {
      if (mission.kind === "castle") {
        Object.entries(enemy.bank).forEach(([r, v]) => { if (Math.round(v) > 0) reward[r] = Math.round(v); });
        enemy.bank = { food: 0, wood: 0, stone: 0, gold: 0 };
      } else if (mission.kind === "raid") {
        const boss = RAID_BOSSES.find((b) => b.id === mission.targetId);
        const types = ["food", "wood", "stone", "gold"];
        const type = types[Math.floor(Math.random() * types.length)];
        reward[type] = (reward[type] || 0) + boss.reward.resourceAmount;
        reward.gold = (reward.gold || 0) + boss.reward.goldBonus;
        state.raids[boss.id].defeated = true;
        state.raids[boss.id].lastDefeatedAt = Date.now();
        state.raidShards += boss.reward.shards;
        const ticketKey = boss.reward.ticketRarity >= 6 ? "t6" : "t5";
        state.raidTickets[ticketKey] += boss.reward.ticketCount;
        bonusMsg = ` 만능 조각 +${boss.reward.shards}, ★${boss.reward.ticketRarity}+ 확정 소환권 +${boss.reward.ticketCount}장!`;
      } else {
        reward = monsterReward(enemy.level, enemy.elite);
        state.monsterKillsSinceGate += 1;
      }
      Object.entries(reward).forEach(([r, v]) => addRes(r, v));
      toast(`⚔️ 부대 ${squadIdx + 1}: ${enemy.name}(Lv.${enemy.level}) 처치!${totalLost > 0 ? ` 병사 ${totalLost}명 손실.` : ""} 보상: ${costText(reward)}${bonusMsg}`);
      logEvent(`⚔️ 부대 ${squadIdx + 1} 승리! ${enemy.name}(Lv.${enemy.level}) 처치, 보상 ${costText(reward)}${bonusMsg}`, "battle-win");
      if (mission.kind === "monster") {
        const slot = state.monsters.find((s) => s.id === mission.targetId);
        if (slot) { slot.monster = null; slot.respawnTimer = 8 + Math.floor(Math.random() * 8); }
      }
    } else {
      toast(`💀 부대 ${squadIdx + 1}: ${enemy.name}(Lv.${enemy.level})에게 패배했습니다. 병사 ${totalLost}명 손실, 전과 없음.`);
      logEvent(`💀 부대 ${squadIdx + 1} 패배… ${enemy.name}(Lv.${enemy.level})에게 패배`, "battle-lose");
    }
    // 레이드 전투 팝업이 이 부대를 추적 중이면 결과를 그 팝업에도 바로 반영해, 팝업을
    // 보고 있는 자리에서 승패·보상을 즉시 확인할 수 있게 한다(팝업을 닫아둔 경우에도
    // 위 toast/logEvent로는 항상 알림이 간다).
    if (mission.kind === "raid" && raidBattleSquadIdx === squadIdx) {
      raidBattleResult = { win: verdict.win, enemy, reward, bonusMsg, totalLost };
    }
    army.mission = null;
    renderMonsterArea();
    renderWorldMap();
    if (!document.getElementById("modal-raid-battle").hidden) renderRaidBattleModal();
    save();
  }

  // ---------- 연구(아카데미) ----------
  // 아카데미에 배치된 영웅의 특성(building:"아카데미")이 실제로 아무 효과가 없던 문제를
  // 수정 — bonusPercentFor는 원래 자원 생산 건물의 base 생산량에만 곱해지는데, 아카데미는
  // base가 비어있어(생산 건물이 아님) 곱해질 대상이 없어 무의미했다. 대신 아카데미 고유
  // 보너스인 "연구 비용 할인"에 연결한다.
  // 같은 카테고리 배열에서 def 바로 앞에 있는 연구(체인 선행 조건용) — 첫 항목이면 null
  function prevResearchInChain(def) {
    const chain = RESEARCH_DEFS.filter((d) => d.cat === def.cat);
    const idx = chain.findIndex((d) => d.id === def.id);
    return idx > 0 ? chain[idx - 1] : null;
  }
  function researchLevel(defId) {
    return state.research[defId] || 0;
  }
  // 다음 레벨(현재 레벨+1)을 사는 비용 — 레벨이 오를수록, 그리고 티어가 높을수록 비싸진다
  function researchCostFor(def) {
    const discount = Math.min(60, bonusPercentFor("academy"));
    const growth = researchLevelGrowthForTier(researchTier(def.id));
    const mult = (1 - discount / 100) * Math.pow(growth, researchLevel(def.id));
    const cost = {};
    Object.entries(def.cost).forEach(([res, amt]) => { cost[res] = Math.max(1, Math.round(amt * mult)); });
    return cost;
  }
  function canResearch(def) {
    if (researchLevel(def.id) >= RESEARCH_MAX_LEVEL) return false;
    if (state.tiles.academy.level < def.reqAcademy) return false;
    if (def.reqBuilding && maxLevelOfType(def.reqBuilding.type) < def.reqBuilding.level) return false;
    const prev = prevResearchInChain(def);
    if (prev && researchLevel(prev.id) < 3) return false;
    return true;
  }
  function doResearch(defId) {
    const def = RESEARCH_DEFS.find((d) => d.id === defId);
    if (!def) return;
    if (!canResearch(def)) { toast("해금 조건을 만족하지 않습니다"); return; }
    const cost = researchCostFor(def);
    if (!canAfford(cost)) { toast("자원이 부족합니다"); return; }
    pay(cost);
    state.research[def.id] = researchLevel(def.id) + 1;
    toast(`📜 ${def.name} Lv.${state.research[def.id]} 연구 완료!`);
    logEvent(`📜 ${withSubjectParticle(def.name)} 연구 Lv.${state.research[def.id]} 달성!`, "levelup");
    openBuildingModal("academy");
    renderBoard();
    save();
  }
  function describeEffectAtLevel(effect, level) {
    const parts = [];
    const v = (n) => Math.round(n * level * 10) / 10;
    if (effect.productionPercent) parts.push(`자원 생산 +${v(effect.productionPercent)}%`);
    if (effect.goldPercent) parts.push(`금화 생산 +${v(effect.goldPercent)}%`);
    if (effect.troopPercent) parts.push(`병사 전투력 +${v(effect.troopPercent)}%`);
    if (effect.defensePercent) parts.push(`수비력 +${v(effect.defensePercent)}%`);
    if (effect.recruitCostPercent) parts.push(`영입 비용 ${v(effect.recruitCostPercent)}%`);
    if (effect.resetCostPercent) parts.push(`초기화 비용 ${v(effect.resetCostPercent)}%`);
    if (effect.rarityBoost) parts.push(`고등급 영웅 등장률 상승 (${v(effect.rarityBoost)})`);
    return parts.join(" · ");
  }
  function renderResearchHTML() {
    const cats = ["combat", "econ", "hero"];
    return `
      <h3>📚 연구</h3>
      <div class="research-tabs">
        ${cats.map((c) => `<button class="research-tab-btn ${c === academyTab ? "active" : ""}" data-cat="${c}">${RESEARCH_CAT_LABEL[c]}</button>`).join("")}
      </div>
      <div class="research-list">
        ${RESEARCH_DEFS.filter((d) => d.cat === academyTab)
          .map((d) => {
            const level = researchLevel(d.id);
            const maxed = level >= RESEARCH_MAX_LEVEL;
            const unlockable = canResearch(d);
            const discount = bonusPercentFor("academy");
            const cost = researchCostFor(d);
            const prev = prevResearchInChain(d);
            const chainBlocked = prev && researchLevel(prev.id) < 3;
            return `
            <div class="research-item ${maxed ? "done" : ""}">
              <div class="ri-name">${d.name} <span class="ri-level">Lv.${level}/${RESEARCH_MAX_LEVEL}</span> ${maxed ? "✅" : ""}</div>
              <div class="ri-req">조건: 아카데미 Lv.${d.reqAcademy}${d.reqBuilding ? ` · ${d.reqBuilding.type} Lv.${d.reqBuilding.level}` : ""}${prev ? ` · ${prev.name} Lv.3+` : ""}</div>
              <div class="ri-effect">레벨당 ${describeEffectAtLevel(d.effect, 1)}${level > 0 ? `<br><span class="hr-note">현재 총합: ${describeEffectAtLevel(d.effect, level)}</span>` : ""}</div>
              ${!maxed ? `
                ${chainBlocked ? `<div class="ri-blocked">🔒 ${prev.name}을(를) 먼저 Lv.3 이상으로 올려야 합니다</div>` : ""}
                <div class="ri-cost">필요: ${costText(cost)}${discount > 0 ? ` <span class="enhance-badge">배치 영웅 효과 -${discount.toFixed(1)}%</span>` : ""}</div>
                <button class="do-research" data-id="${d.id}" ${unlockable ? "" : "disabled"}>${level > 0 ? "레벨업" : "연구 시작"}</button>
              ` : ""}
            </div>`;
          })
          .join("")}
      </div>
    `;
  }

  // ---------- 렌더링: 상단바/보드/성벽 ----------
  function formatNum(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1) + "M";
    if (n >= 1000) return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + "K";
    return String(Math.floor(n));
  }
  function renderTopbar() {
    ["food", "wood", "stone"].forEach((r) => {
      document.getElementById(`res-${r}`).textContent = formatNum(state.res[r]);
      document.getElementById(`cap-${r}`).textContent = formatNum(capFor(r));
    });
    document.getElementById("res-gold").textContent = formatNum(state.res.gold);
    document.getElementById("defense-score").textContent = "+" + homeDefenseBonusPercent() + "%";
    const totalTroops = Object.values(state.troopsByType).reduce((s, v) => s + v, 0);
    document.getElementById("troop-count").textContent = totalTroops;
    ["food", "wood", "stone", "gold"].forEach((r) => {
      const el = document.getElementById(`rate-${r}`);
      if (el) {
        const rate = productionRatePerSecond(r);
        el.textContent = (rate >= 0 ? "+" : "") + rate.toFixed(1) + "/s";
        el.classList.toggle("rate-negative", rate < 0);
      }
    });
  }
  // 자원 종류별 초당 순생산량(건물 레벨·영웅 보너스·연구 배율 반영) — 상단바 표시용.
  // food는 병사 유지비(troopUpkeepFoodPerSecond)를 뺀 실질 순증감을 보여준다.
  function productionRatePerSecond(res) {
    const prodBonus = 1 + researchPercent("productionPercent") / 100;
    const goldBonus = 1 + researchPercent("goldPercent") / 100;
    let total = 0;
    TILE_LAYOUT.forEach((def) => {
      const tile = state.tiles[def.id];
      if (!tile.built || !tile.type) return;
      const bdef = BUILDING_TYPES[tile.type];
      const base = bdef.base[res];
      if (!base) return;
      const mult = 1 + bonusPercentFor(def.id) / 100;
      const bonus = res === "gold" ? goldBonus : prodBonus;
      total += base * tile.level * mult * bonus;
    });
    if (res === "food") {
      Object.entries(state.troopsByType).forEach(([key, count]) => {
        const t = TROOP_TYPES_BY_KEY[key];
        if (t && count) total -= troopUpkeepFoodPerSecond(t) * count;
      });
    }
    return total;
  }

  function renderWallFrame() {
    const frame = document.getElementById("wall-frame");
    const badge = document.getElementById("wall-badge");
    if (!frame || !badge) return;
    const wall = state.tiles.wall;
    frame.className = "wall-frame" + (wall.built ? "" : " unbuilt") + (justUpgradedTileId === "wall" ? " just-upgraded" : "");
    if (wall.built) {
      badge.textContent = `🧱 성벽 Lv.${wall.level}/${MAX_LEVEL} · 수비력 ${wallScore()}`;
    } else {
      badge.textContent = `🧱 성벽 건설 (🪙${BUILDING_TYPES["성벽"].buildCostGold})`;
    }
  }

  function renderBoard() {
    const board = document.getElementById("board");
    board.innerHTML = "";
    TILE_LAYOUT.forEach((def) => {
      const tile = state.tiles[def.id];
      const bdef = tile.type ? BUILDING_TYPES[tile.type] : null;
      const plot = document.createElement("div");
      plot.style.gridColumn = def.span ? `${def.col} / span ${def.span}` : String(def.col);
      plot.style.gridRow = String(def.row);

      if (!tile.type) {
        plot.className = "plot tile-empty";
        plot.innerHTML = `<div class="icon"><img src="assets/buildings/empty.svg" alt="빈 부지" /></div><div class="name">부지</div><div class="level">건설 가능</div>`;
        plot.addEventListener("click", () => openPlotChooserModal(def.id));
        board.appendChild(plot);
        return;
      }

      let rateLine = "";
      let statusLine = "";
      let isTraining = false;
      if (tile.built) {
        rateLine = productionLineForLevel(def.id, tile.level);
        const statusParts = [];
        if (tile.type === "병영") {
          if (tile.training) {
            const t = TROOP_TYPES_BY_KEY[tile.training.type];
            statusParts.push(`훈련: ${t.name} ${tile.training.count}명 (${tile.training.timeLeft}s)`);
            isTraining = true;
          } else {
            statusParts.push("훈련 대기 중");
          }
        }
        if (tile.type === "감시탑") {
          statusParts.push(tile.level >= 5 ? "몬스터 정보 전체 공개" : "몬스터 레벨만 공개");
        }
        if (tile.upgrading) {
          statusParts.push(`🏗️ Lv.${tile.upgrading.targetLevel} 레벨업 중 (${tile.upgrading.timeLeft}s)`);
        }
        statusLine = statusParts.filter(Boolean).join(" · ");
      }

      plot.className = "plot" + (tile.built ? "" : " unbuilt") + (def.id === "castle" ? " tile-castle" : "") + (isTraining ? " training" : "") + (tile.upgrading ? " upgrading" : "") + (tile.built && !isTraining && Object.keys(bdef.base).length ? " working" : "") + (justBuiltTileId === def.id ? " just-built" : "") + (justUpgradedTileId === def.id ? " just-upgraded" : "");
      plot.innerHTML = `
        <div class="icon">${buildingIconHTML(tile.type, tile.level)}</div>
        <div class="name">${tile.type}</div>
        <div class="level">${tile.built ? "Lv." + tile.level + "/" + MAX_LEVEL : "미건설"}</div>
        ${rateLine ? `<div class="rate">${rateLine}</div>` : ""}
        ${statusLine ? `<div class="status-line">${statusLine}</div>` : ""}
        ${!tile.built ? `<div class="build-cost">🪙${bdef.buildCostGold}</div>` : ""}
      `;
      plot.addEventListener("click", () => {
        if (!tile.built) { openBuildModal(def.id); return; }
        if (bdef.isTavern) { openTavernModal(); return; }
        openBuildingModal(def.id);
      });
      board.appendChild(plot);
    });
  }

  function openPlotChooserModal(tileId) {
    // 이 화면은 openBuildingModal()이 아닌 별도 정적 화면이므로, 매 틱마다 마지막으로
    // 본 건물 팝업을 다시 그리는 live-refresh 로직(tick() 참고)이 이 내용을 즉시
    // 덮어쓰지 않도록 openBuildingTileId를 반드시 비워둔다
    openBuildingTileId = null;
    const body = document.getElementById("building-modal-body");
    body.innerHTML = `
      <h2>➕ 어떤 건물을 지을까요?</h2>
      <div class="type-choice-list">
        ${SELECTABLE_TYPES.map(
          (type) => `
          <div class="type-choice" data-type="${type}">
            <span class="icon">${buildingIconHTML(type, 1)}</span>
            <span class="tc-name">${type}</span>
            <span class="tc-cost">🪙 ${BUILDING_TYPES[type].buildCostGold}</span>
          </div>`
        ).join("")}
      </div>
    `;
    body.querySelectorAll(".type-choice").forEach((el) => {
      el.addEventListener("click", () => chooseType(tileId, el.dataset.type));
    });
    openModal("modal-building");
  }

  function openBuildModal(tileId) {
    // openPlotChooserModal과 동일한 이유로 openBuildingTileId를 비운다
    openBuildingTileId = null;
    const tile = state.tiles[tileId];
    const bdef = BUILDING_TYPES[tile.type];
    const body = document.getElementById("building-modal-body");
    body.innerHTML = `
      <h2><span class="modal-icon">${buildingIconHTML(tile.type, 1)}</span>${tile.type} 건설</h2>
      <p>필요 자원: 🪙 ${bdef.buildCostGold}</p>
      <button id="do-build">건설하기</button>
    `;
    body.querySelector("#do-build").addEventListener("click", () => build(tileId));
    openModal("modal-building");
  }

  // 자원 보유량 기준으로 실제 훈련 가능한 최대 인원(재료가 여러 개면 그중 가장 적게 만들 수 있는 수)
  function maxAffordableTrainCount(type) {
    let max = 999;
    Object.entries(type.cost).forEach(([r, v]) => { max = Math.min(max, Math.floor((state.res[r] || 0) / v)); });
    return Math.max(0, max);
  }
  // 병종 1명 비용×count, 시간(초)×count(배치된 영웅의 쿨감소 반영)를 합산한
  // "지금 슬라이더 값 기준 총량" 문구
  function trainTotalText(type, count, cooldownPercent) {
    const totalCost = {};
    Object.entries(type.cost).forEach(([r, v]) => { totalCost[r] = v * count; });
    const seconds = Math.max(1, Math.round((type.trainSeconds * count) / (1 + (cooldownPercent || 0) / 100)));
    return `${costText(totalCost)} · ${seconds}s`;
  }
  function renderTroopTrainingHTML(tileId) {
    const tile = state.tiles[tileId];
    if (tile.training) {
      const t = TROOP_TYPES_BY_KEY[tile.training.type];
      const pct = Math.round(100 * (1 - tile.training.timeLeft / tile.training.total));
      return `<div class="training-status">🪖 ${t.name} ${tile.training.count}명 훈련 중 — ${tile.training.timeLeft}s 남음 (${pct}%)</div>`;
    }
    const cooldownPercent = bonusPercentFor(tileId);
    return `
      <div class="troop-types">
        ${cooldownPercent > 0 ? `<div class="tt-cooldown-note">🕒 배치된 영웅 효과로 훈련 시간 -${cooldownPercent.toFixed(1)}%</div>` : ""}
        ${TROOP_TYPES.map((t) => {
          const locked = t.unlockLevel > tile.level;
          const maxAfford = locked ? 0 : maxAffordableTrainCount(t);
          const startVal = Math.min(5, Math.max(1, maxAfford));
          return `
          <div class="troop-type-row ${locked ? "locked" : ""}">
            <div class="tt-head">
              <span class="tt-name">${t.name}${locked ? ` (Lv.${t.unlockLevel} 필요)` : ""}</span>
              <span class="tt-cost">${costText(t.cost)}/명 · ${t.trainSeconds}s/명</span>
            </div>
            ${!locked ? `
            <div class="tt-stats">⚔️${t.atk} 🛡️${t.def} ❤️${t.hp} 🚚${t.capacity} 🐎${t.speed}x</div>
            <div class="tt-controls">
              <input type="range" min="1" max="${Math.max(1, maxAfford)}" value="${startVal}" class="tt-count" data-key="${t.key}" ${maxAfford < 1 ? "disabled" : ""} />
              <span class="tt-count-val" data-key-val="${t.key}">${startVal}</span>
              <button class="do-train" data-key="${t.key}" ${maxAfford < 1 ? "disabled" : ""}>훈련</button>
            </div>
            <div class="tt-total" data-key-total="${t.key}">총 ${trainTotalText(t, startVal, cooldownPercent)}</div>
            ${maxAfford < 1 ? `<small class="tt-warn">자원이 부족해 지금은 훈련할 수 없습니다</small>` : ""}
            ` : ""}
          </div>`;
        }).join("")}
      </div>
    `;
  }

  function renderUpgradeStatusHTML(tileId) {
    const tile = state.tiles[tileId];
    const pct = Math.round(100 * (1 - tile.upgrading.timeLeft / tile.upgrading.total));
    return `<div class="training-status">🏗️ Lv.${tile.upgrading.targetLevel}(으)로 레벨업 중 — ${tile.upgrading.timeLeft}s 남음 (${pct}%)</div>`;
  }

  // 건물의 생산/기능 수치를 특정 레벨 기준으로 계산(레벨업 전/후 비교에 재사용)
  function productionLineForLevel(tileId, level) {
    const tile = state.tiles[tileId];
    const bdef = BUILDING_TYPES[tile.type];
    const mult = 1 + bonusPercentFor(tileId) / 100;
    const prodBonus = 1 + researchPercent("productionPercent") / 100;
    const goldBonus = 1 + researchPercent("goldPercent") / 100;
    const parts = [];
    if (bdef.base.food) parts.push(`🌾+${(bdef.base.food * level * mult * prodBonus).toFixed(1)}/s`);
    if (bdef.base.wood) parts.push(`🪵+${(bdef.base.wood * level * mult * prodBonus).toFixed(1)}/s`);
    if (bdef.base.stone) parts.push(`🪨+${(bdef.base.stone * level * mult * prodBonus).toFixed(1)}/s`);
    if (bdef.base.gold) parts.push(`🪙+${(bdef.base.gold * level * mult * goldBonus).toFixed(1)}/s`);
    if (bdef.base.capBonus) parts.push(`창고 +${Math.round(BASE_CAP * bdef.base.capBonus * level * mult).toLocaleString()}`);
    if (tile.type === "방어탑") {
      const researchMult = 1 + researchPercent("defensePercent") / 100;
      parts.push(`🛡️ 수성 방어력 +${Math.round(level * bdef.base.defense * researchMult * 10) / 10}%`);
    }
    if (tile.type === "성벽") parts.push(`🛡️ 수성 방어력 +${Math.round(level * bdef.base.defense * mult)}`);
    if (tile.type === "병영" && bonusPercentFor(tileId) > 0) parts.push(`🕒 훈련 시간 -${bonusPercentFor(tileId).toFixed(1)}%`);
    if (bdef.isTavern) parts.push(`슬롯 ${tavernSlotsForLevel(level)}`);
    return parts.join(" · ");
  }
  let openBuildingTileId = null;
  // 매 틱마다 진행상황(타이머·자원 등)을 반영하려 body.innerHTML을 통째로 다시 그리는데,
  // 그 안의 스크롤 가능한 목록(연구/영웅 배치)은 그대로 두면 스크롤 위치가 매초 0으로
  // 리셋돼 버린다 — 다시 그리기 전후로 스크롤 위치를 붙잡아서 복원한다.
  const SCROLLABLE_SELECTORS_IN_BUILDING_MODAL = [".research-list", ".hero-slot-list"];
  function openBuildingModal(tileId) {
    openBuildingTileId = tileId;
    const tile = state.tiles[tileId];
    const bdef = BUILDING_TYPES[tile.type];
    const body = document.getElementById("building-modal-body");
    const savedScroll = SCROLLABLE_SELECTORS_IN_BUILDING_MODAL.map((sel) => body.querySelector(sel)?.scrollTop || 0);
    // 병사 훈련 인원 슬라이더(.tt-count)도 같은 이유로 매초 원래 기본값으로
    // 되돌아가 버리므로, 병종(data-key)별 현재 값을 붙잡아뒀다가 되돌린다
    const savedTrainCounts = {};
    body.querySelectorAll(".tt-count").forEach((input) => { savedTrainCounts[input.dataset.key] = input.value; });
    const ownedList = Object.keys(state.owned)
      .map((id) => HERO_BY_ID[id])
      .filter(Boolean)
      .sort((a, c) => c.rarity - a.rarity || heroEnhance(c.id) - heroEnhance(a.id));
    const upCost = upgradeCostFor(tile.type, tile.level);
    const missing = levelUpMissing(tileId);
    const allowsHero = !bdef.noHeroBonus;

    const infoCol = `
      <div class="modal-section">
        <h2><span class="modal-icon">${buildingIconHTML(tile.type, tile.level)}</span>${tile.type} <small>Lv.${tile.level}/${MAX_LEVEL}</small></h2>
        <p class="building-desc">${bdef.desc || ""}</p>
        ${tile.level < MAX_LEVEL ? `
          <div class="compare-line">
            <div class="compare-cur"><span class="compare-label">현재</span> ${productionLineForLevel(tileId, tile.level) || "특별한 생산 효과 없음"}</div>
            <div class="compare-arrow">⬇️</div>
            <div class="compare-next"><span class="compare-label">Lv.${tile.level + 1}</span> ${productionLineForLevel(tileId, tile.level + 1) || "특별한 생산 효과 없음"}</div>
          </div>` : `<div class="compare-line"><div class="compare-cur">${productionLineForLevel(tileId, tile.level) || "특별한 생산 효과 없음"}</div></div>`}
        ${upCost
          ? tile.level < MAX_LEVEL
            ? tile.upgrading
              ? renderUpgradeStatusHTML(tileId)
              : `${renderReqChecklistHTML(tileId)}<button id="do-upgrade" ${missing.length ? "disabled" : ""}>레벨업 (${costText(upCost)})</button>`
            : `<p><small>최대 레벨입니다</small></p>`
          : ""}
        ${bdef.selectable ? `<button id="do-demolish" class="btn-danger">🧨 철거</button>` : ""}
      </div>
    `;
    const eligibleList = ownedList.filter((h) => heroBuildingTraitsFor(h, tile.type).length > 0 && !tile.heroIds.includes(h.id));
    const assignedFull = tile.heroIds.length >= MAX_HEROES_PER_BUILDING;
    const heroCol = allowsHero ? `
      <div class="modal-section">
        <h3>영웅 배치 (${tile.heroIds.length}/${MAX_HEROES_PER_BUILDING})</h3>
        ${tile.heroIds.length ? `
          <div class="assigned-hero-list">
            ${tile.heroIds.map((heroId) => {
              const h = HERO_BY_ID[heroId];
              return `<div class="assigned-hero-row">
                <span>${h.name} (★${h.rarity}${heroEnhance(h.id) > 0 ? ` +${heroEnhance(h.id)}강` : ""}) <span class="hr-note">${heroBuildingBonusLabel(h, tile.type)}</span></span>
                <button class="do-unassign" data-hero="${heroId}">해제</button>
              </div>`;
            }).join("")}
          </div>` : `<p>현재 배치: 없음</p>`}
        <div class="hero-slot-list">
          ${assignedFull
            ? `<p><small>이미 최대 인원(${MAX_HEROES_PER_BUILDING}명)이 배치되었습니다.</small></p>`
            : eligibleList.length
              ? eligibleList.map((h) => {
                const loc = heroPlacementLocation(h.id);
                return `
                <div class="hero-row" data-hero="${h.id}">
                  ${heroBadgeHTML(h.id)}
                  <span>${h.name}</span>
                  <span class="hr-note">${heroBuildingBonusLabel(h, tile.type)}</span>
                  ${loc ? `<span class="hero-elsewhere-badge">📍 ${loc}에 배치됨</span>` : ""}
                </div>`;
              }).join("")
              : `<p><small>${ownedList.length ? `${tile.type}에 특화된 영웅이 아직 없습니다.` : "아직 보유한 영웅이 없습니다."} 여관에서 뽑아보세요.</small></p>`}
        </div>
      </div>` : "";
    const extraCol = tile.type === "감시탑"
      ? `<div class="modal-section"><h3>감시 정보</h3><p>감시탑 레벨 L → 몬스터 레벨 (2×L+1) 이하까지 야생 지역에서 상세 정보(레벨·스탯)를 볼 수 있습니다. 그보다 높은 레벨의 몬스터는 Lv.?로 표시됩니다.</p></div>`
      : tile.type === "병영" ? `<div class="modal-section"><h3>병사 훈련</h3>${renderTroopTrainingHTML(tileId)}</div>`
      : tile.type === "아카데미" ? `<div class="modal-section">${renderResearchHTML()}</div>`
      : "";
    body.innerHTML = `<div class="modal-cols modal-cols-3">${infoCol}${heroCol}${extraCol}</div>`;
    SCROLLABLE_SELECTORS_IN_BUILDING_MODAL.forEach((sel, i) => {
      const el = body.querySelector(sel);
      if (el) el.scrollTop = savedScroll[i];
    });
    body.querySelectorAll(".tt-count").forEach((input) => {
      const saved = savedTrainCounts[input.dataset.key];
      if (saved == null) return;
      input.value = saved; // 범위를 벗어나면 브라우저가 자동으로 min/max에 맞춰 클램프한다
      const label = body.querySelector(`.tt-count-val[data-key-val="${input.dataset.key}"]`);
      if (label) label.textContent = input.value;
      const totalEl = body.querySelector(`.tt-total[data-key-total="${input.dataset.key}"]`);
      if (totalEl) totalEl.textContent = "총 " + trainTotalText(TROOP_TYPES_BY_KEY[input.dataset.key], Number(input.value), bonusPercentFor(tileId));
    });
    body.querySelectorAll(".do-unassign").forEach((b) => {
      b.addEventListener("click", () => unassignHero(tileId, Number(b.dataset.hero)));
    });
    const upBtn = body.querySelector("#do-upgrade");
    if (upBtn && !upBtn.disabled) upBtn.addEventListener("click", () => upgrade(tileId));
    const demolishBtn = body.querySelector("#do-demolish");
    if (demolishBtn) demolishBtn.addEventListener("click", () => demolish(tileId));
    body.querySelectorAll(".hero-row").forEach((row) => {
      row.addEventListener("click", () => assignHero(tileId, Number(row.dataset.hero)));
    });
    body.querySelectorAll(".do-train").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.key;
        const input = body.querySelector(`.tt-count[data-key="${key}"]`);
        startTraining(tileId, key, Number(input.value) || 1);
      });
    });
    body.querySelectorAll(".tt-count").forEach((input) => {
      input.addEventListener("input", () => {
        body.querySelector(`.tt-count-val[data-key-val="${input.dataset.key}"]`).textContent = input.value;
        const totalEl = body.querySelector(`.tt-total[data-key-total="${input.dataset.key}"]`);
        if (totalEl) totalEl.textContent = "총 " + trainTotalText(TROOP_TYPES_BY_KEY[input.dataset.key], Number(input.value), bonusPercentFor(tileId));
      });
    });
    if (tile.type === "아카데미") {
      body.querySelectorAll(".research-tab-btn").forEach((btn) => {
        btn.addEventListener("click", () => { academyTab = btn.dataset.cat; openBuildingModal(tileId); });
      });
      body.querySelectorAll(".do-research").forEach((btn) => {
        btn.addEventListener("click", () => doResearch(btn.dataset.id));
      });
    }
    openModal("modal-building");
  }

  // ---------- 여관 렌더링 (틱마다 카드 재생성하지 않도록 분리) ----------
  function renderTavernModal() {
    const tile = state.tiles.tavern;
    const timer = state.tavern.timer;
    const min = Math.floor(timer / 60);
    const sec = String(timer % 60).padStart(2, "0");
    document.getElementById("tavern-timer-text").textContent = `${min}:${sec}`;
    const ring = document.getElementById("tavern-ring");
    const circumference = 119;
    ring.style.strokeDashoffset = String(circumference * (1 - timer / TAVERN_CYCLE));
    ring.classList.toggle("urgent", timer <= 60);
    document.getElementById("tavern-reset-cost").textContent = tavernResetCost();

    const status = document.getElementById("tavern-status-section");
    const upCost = upgradeCostFor("여관", tile.level);
    const missing = levelUpMissing("tavern");
    if (status) {
      status.innerHTML = `
        <div class="tavern-status-head">
          <span class="tavern-status-title">🍺 여관 Lv.${tile.level}/${MAX_LEVEL}</span>
          <span class="tavern-status-sub">슬롯 ${tavernSlotsForLevel(tile.level)}명</span>
        </div>
        ${tile.level < MAX_LEVEL
          ? tile.upgrading
            ? renderUpgradeStatusHTML("tavern")
            : `${renderReqChecklistHTML("tavern")}<button id="btn-tavern-upgrade" ${missing.length ? "disabled" : ""}>⬆️ 레벨업 (${costText(upCost)})</button>`
          : `<div class="tavern-status-sub">🏆 최대 레벨입니다</div>`}
      `;
      const upBtn = status.querySelector("#btn-tavern-upgrade");
      if (upBtn && !upBtn.disabled) upBtn.addEventListener("click", () => upgrade("tavern"));
    }
  }
  function renderTavernCards() {
    const grid = document.getElementById("tavern-grid");
    grid.innerHTML = "";
    state.tavern.candidates.forEach((heroId, idx) => {
      const cell = document.createElement("div");
      if (heroId === null || heroId === undefined) {
        cell.className = "hero-card";
        cell.innerHTML = `<div class="empty-slot">모집됨<br>(다음 초기화까지 대기)</div>`;
      } else {
        const hero = HERO_BY_ID[heroId];
        const isKami = hero.secret;
        const already = !!state.owned[heroId];
        const traitLine = hero.traits.map((t) => traitLineHTML(hero, t)).join("<br>");
        cell.className = `hero-card card-fresh hc-r${hero.rarity}` + (isKami ? " kami" : "");
        cell.innerHTML = `
          <div class="hc-portrait">
            ${heroPortraitHTML(hero)}
            <div class="hc-scrim"></div>
            <div class="hc-stars">${heroStarRowHTML(hero.rarity)}</div>
            <div class="hc-plate">
              <div class="hc-domain">${hero.domain}</div>
              <div class="hc-name">${hero.name}</div>
            </div>
          </div>
          <div class="hc-info">
            <div class="hstats">⚔️${hero.atk} 🛡️${hero.def} ❤️${hero.hp}</div>
            <div class="htrait">${isKami ? "🐱 모든 것을 압도하는 조커 카드" : traitLine}</div>
            ${already ? `<div class="owned-tag">보유중 ✓ (중복 영입 시 조각)</div>` : ""}
            <div class="recruit-cost">🪙 ${recruitCost(hero)}</div>
            <button class="do-recruit">영입</button>
          </div>
        `;
        cell.querySelector(".do-recruit").addEventListener("click", () => {
          recruit(idx, cell.querySelector(".hc-portrait").getBoundingClientRect());
        });
      }
      grid.appendChild(cell);
    });
  }
  function openTavernModal() {
    renderTavernModal();
    renderTavernCards();
    openModal("modal-tavern");
  }
  const ODDS_ORDER = ["kami", 8, 7, 6, 5, 4, 3, 2, 1];
  function renderTavernOddsModal() {
    const table = currentRollTable();
    const boost = researchPercent("rarityBoost");
    const rows = ODDS_ORDER.map((r) => table.find((row) => row.rarity === r)).filter(Boolean);
    const body = document.getElementById("tavern-odds-body");
    body.innerHTML = `
      <h2>📊 여관 등장 확률</h2>
      <p class="odds-note">${boost ? "🍀 영웅 획득 연구 효과가 적용된 현재 확률입니다." : "높은 등급일수록 등장 확률이 낮습니다."}</p>
      <div class="odds-table">
        ${rows.map((row) => `
          <div class="odds-row ${row.rarity === "kami" ? "kami" : ""}">
            <span class="odds-label">
              <span class="star-badge ${row.rarity === "kami" ? "r8" : `r${row.rarity}`}">${row.rarity === "kami" ? "🐱 까미" : `★${row.rarity}`}</span>
            </span>
            <span class="odds-percent">${Math.round(row.p * 1000) / 1000}%</span>
          </div>
        `).join("")}
      </div>
    `;
  }
  document.getElementById("btn-tavern-odds").addEventListener("click", () => {
    renderTavernOddsModal();
    openModal("modal-tavern-odds");
  });
  document.getElementById("btn-tavern-reset").addEventListener("click", () => {
    const cost = tavernResetCost();
    if (state.res.gold < cost) { toast("🪙 금화가 부족합니다"); return; }
    state.res.gold -= cost;
    state.tavern.resetCost *= TAVERN_RESET_GROWTH;
    rerollTavern();
    renderTavernModal();
    renderTavernCards();
    renderTopbar();
    toast("🔄 여관을 새로 초기화했습니다");
    save();
  });

  // ---------- 야생 지역(몬스터) ----------
  // 감시탑 레벨 L → 몬스터 레벨 (2L+1) 이하까지 정보 공개 (Lv.1→3까지, Lv.2→5까지 ...)
  function watchInfoThreshold() {
    const w = state.tiles.watch;
    if (!w.built) return 0;
    return 2 * w.level + 1;
  }
  function monsterInfoRevealed(monsterLevel) {
    return monsterLevel <= watchInfoThreshold();
  }
  function requiredWatchLevelFor(monsterLevel) {
    return Math.max(1, Math.ceil((monsterLevel - 1) / 2));
  }
  function squadAttackingSlot(slotId) {
    const idx = state.armies.findIndex((a) => a.mission && a.mission.targetId === slotId);
    return idx;
  }
  // 진군 중인 부대를 이모지 한 글자가 아니라 CSS로 그린 병사 3인 대형으로 표시한다
  // (각 병사가 엇박자로 제자리 걸음 애니메이션을 타면서 대형 전체가 left/top로 이동)
  function marchingSquadHTML() {
    return `<span class="squad-unit"></span><span class="squad-unit"></span><span class="squad-unit"></span>`;
  }
  function renderMonsterArea() {
    const gridLeft = document.getElementById("monster-col-left");
    const gridRight = document.getElementById("monster-col-right");
    if (!gridLeft || !gridRight) return;
    gridLeft.innerHTML = "";
    gridRight.innerHTML = "";
    state.monsters.forEach((slot, idx) => {
      const card = document.createElement("div");
      const attackingIdx = squadAttackingSlot(slot.id);
      const isLeftCol = idx < MONSTER_SLOT_COUNT / 2;
      card.className = "monster-card" + (slot.monster && slot.monster.elite ? " elite" : "");
      if (attackingIdx >= 0) {
        const mission = state.armies[attackingIdx].mission;
        const phaseLabel = mission.phase === "march" ? "진군 중" : "전투 중";
        if (mission.phase === "battle") card.classList.add("in-battle");
        const marchProgress = mission.phase === "march" ? 1 - mission.timeLeft / mission.marchTime : 1;
        const startLeft = isLeftCol ? 132 : -32;
        const marcherLeft = startLeft + (50 - startLeft) * marchProgress;
        card.innerHTML = `
          <div class="icon">${monsterIconHTML(slot.monster.key)}</div>
          ${mission.phase === "march" ? `<div class="unit-marcher" style="left:${marcherLeft}%">${marchingSquadHTML()}</div>` : `<div class="battle-clash">⚔️</div>`}
          <div class="mname">${slot.monster.name}${slot.monster.elite ? " 👑" : ""}</div>
          <div class="mlevel">Lv.${slot.monster.level}</div>
          <div class="mstatus ${mission.phase}">부대${attackingIdx + 1} ${phaseLabel}… ${mission.timeLeft}s</div>
        `;
      } else if (slot.monster) {
        const m = slot.monster;
        const revealed = monsterInfoRevealed(m.level);
        card.innerHTML = `
          <div class="icon">${monsterIconHTML(m.key)}</div>
          <div class="mname">${m.name}${m.elite ? " 👑" : ""}</div>
          <div class="mlevel">${revealed ? `Lv.${m.level}` : "Lv.?"}</div>
          <div class="mstats">${revealed ? `⚔️${m.atk} 🛡️${m.def} ❤️${m.hp}` : `감시탑 Lv.${requiredWatchLevelFor(m.level)}+ 필요`}</div>
          ${revealed ? `<div class="mrecommend">🎯 권장 전투력 ${(m.atk + m.def + m.hp).toLocaleString()}</div>` : ""}
          <button class="do-attack">공격</button>
        `;
        card.querySelector(".do-attack").addEventListener("click", () => openEngageModal("monster", slot.id));
      } else {
        card.innerHTML = `
          <div class="icon">🌫️</div>
          <div class="mname">출현 대기</div>
          <div class="mstatus">${slot.respawnTimer}s</div>
        `;
      }
      (idx < MONSTER_SLOT_COUNT / 2 ? gridLeft : gridRight).appendChild(card);
    });
  }

  // ---------- 교전 팝업(몬스터/월드맵 성 공용, 부대 선택 + 판정) ----------
  let engageSquadIdx = 0;
  function openEngageModal(kind, targetId) {
    const enemy = findEnemy(kind, targetId);
    if (!enemy) return;
    engageSquadIdx = state.armies.findIndex((a, i) => squadIsFree(i));
    if (engageSquadIdx === -1) engageSquadIdx = 0;
    renderEngageModal(kind, targetId);
    openModal("modal-monster");
  }
  function renderEngageModal(kind, targetId) {
    const enemy = findEnemy(kind, targetId);
    if (!enemy) return;
    const body = document.getElementById("monster-modal-body");
    const revealed = kind === "castle" || kind === "raid" ? true : monsterInfoRevealed(enemy.level);
    const duration = battleDurationFor(enemy.level, !!enemy.elite);
    body.innerHTML = `
      <div class="modal-cols">
        <div class="col narrow">
          <h2><span class="modal-icon">${enemyIconHTML(kind, enemy)}</span>${enemy.name} ${kind === "raid" ? "👑 레이드 보스" : enemy.elite ? "👑 엘리트" : ""}</h2>
          <p>레벨 ${revealed ? enemy.level : "?"}</p>
          <p>${revealed ? `⚔️ 공격력 ${enemy.atk} · 🛡️ 방어력 ${enemy.def} · ❤️ 체력 ${enemy.hp}` : `감시탑 Lv.${requiredWatchLevelFor(enemy.level)}+ 필요 (야생 몬스터만 해당)`}</p>
          ${kind === "castle" ? `<p>승리 시 이 성이 그동안 모은 자원을 전부 획득합니다: ${costText(enemy.bank && Object.fromEntries(Object.entries(enemy.bank).filter(([, v]) => v >= 1).map(([k, v]) => [k, Math.round(v)])))}</p>` : ""}
          ${kind === "monster"
            ? revealed
              ? `<p>승리 시 보상: 🌾🪵🪨🪙 중 1종 <b>${monsterRewardAmount(enemy.level, enemy.elite).toLocaleString()}개</b>(무작위)</p>`
              : `<p>승리 시 보상: 감시탑으로 정보를 공개해야 예상 보상을 볼 수 있습니다</p>`
            : ""}
          ${kind === "raid" ? (() => {
            const boss = RAID_BOSSES.find((b) => b.id === targetId);
            const r = boss.reward;
            return `<p>승리 시 보상: 자원 무작위 1종 <b>${r.resourceAmount.toLocaleString()}개</b> + 🪙${r.goldBonus.toLocaleString()} · 만능 조각 ${r.shards}개 · ★${r.ticketRarity}+ 확정 소환권 ${r.ticketCount}장</p>
            <p><small>⚠️ 처치 후 24시간 동안은 이 보스를 다시 공격할 수 없습니다.</small></p>`;
          })() : ""}
          <p><span id="verdict-badge" class="verdict-badge">-</span></p>
        </div>
        <div class="col">
          <h3>부대 선택</h3>
          <div class="squad-picker" id="squad-picker">
            ${state.armies.map((a, i) => `<button class="sq-btn ${i === engageSquadIdx ? "active" : ""} ${a.mission ? "disabled" : ""}" data-idx="${i}">부대 ${i + 1}${a.mission ? " (출정중)" : ""}</button>`).join("")}
          </div>
          <h3>파병할 병사 (최소 ${MIN_DEPLOY}, 슬라이더로 보유량까지 자유롭게)</h3>
          <div id="engage-comp"></div>
          <div style="display:flex; gap:8px; margin-top:10px;">
            <button id="do-engage-confirm">🪖 출격</button>
            <button id="do-engage-cancel" data-close>취소</button>
          </div>
        </div>
      </div>
    `;
    body.querySelectorAll(".sq-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.classList.contains("disabled")) return;
        engageSquadIdx = Number(btn.dataset.idx);
        renderEngageModal(kind, targetId);
      });
    });
    renderEngageComp(kind, targetId, duration);
    body.querySelector("#do-engage-confirm").addEventListener("click", () => {
      const comp = readEngageComp(body);
      dispatchSquad(engageSquadIdx, kind, targetId, comp);
    });
  }
  function readEngageComp(body) {
    const comp = {};
    body.querySelectorAll(".ec-input").forEach((input) => {
      const key = input.dataset.key;
      const v = Math.max(0, Math.min(Number(input.value) || 0, state.troopsByType[key] || 0));
      if (v > 0) comp[key] = v;
    });
    return comp;
  }
  function renderEngageComp(kind, targetId, duration) {
    const enemy = findEnemy(kind, targetId);
    const body = document.getElementById("monster-modal-body");
    const wrap = body.querySelector("#engage-comp");
    const lastComp = state.armies[engageSquadIdx].lastComp || {};
    const hasSavedComp = Object.values(lastComp).some((v) => v > 0);
    wrap.innerHTML = `
      ${hasSavedComp ? `<div class="saved-comp-banner">💾 부대 ${engageSquadIdx + 1}의 저장된 편성이 자동으로 적용되었습니다 (군대 편성 화면에서 미리 설정 가능)</div>` : ""}
      ${TROOP_TYPES.map((t) => {
        const avail = state.troopsByType[t.key] || 0;
        const startVal = Math.min(avail, lastComp[t.key] || 0);
        return `
        <div class="engage-comp-row">
          <span class="ec-name">${t.name}</span>
          <span class="ec-avail">보유 ${avail}</span>
          <input type="range" class="ec-input" data-key="${t.key}" min="0" max="${avail}" value="${startVal}" ${avail === 0 ? "disabled" : ""} />
          <span class="ec-value" data-key-val="${t.key}">${startVal}</span>
        </div>`;
      }).join("")}
    `;
    const updateVerdict = () => {
      const comp = readEngageComp(body);
      wrap.querySelectorAll(".ec-input").forEach((inp) => {
        wrap.querySelector(`.ec-value[data-key-val="${inp.dataset.key}"]`).textContent = inp.value;
      });
      const heroIds = state.armies[engageSquadIdx].heroIds;
      const v = computeVerdict(heroIds, comp, enemy, duration);
      const badge = document.getElementById("verdict-badge");
      badge.textContent = `판정: ${v.label}`;
      badge.className = "verdict-badge " + v.cls;
    };
    wrap.querySelectorAll(".ec-input").forEach((inp) => inp.addEventListener("input", updateVerdict));
    updateVerdict();
  }

  // ---------- 보스 레이드(필드에서 분리된 엘리트 전용 컨텐츠) ----------
  function raidActionHTML(boss) {
    const attackingIdx = state.armies.findIndex((a) => a.mission && a.mission.kind === "raid" && a.mission.targetId === boss.id);
    if (attackingIdx >= 0) {
      const mission = state.armies[attackingIdx].mission;
      // 레이드는 진군 없이 곧장 전투로 들어가므로 phase는 사실상 항상 "battle"이다 —
      // 업데이트 전에 이미 진군 중이던 저장 데이터만 예외적으로 "진군 중"으로 보일 수 있다.
      const phaseLabel = mission.phase === "march" ? "진군 중" : "전투 중";
      return `<button class="raid-status inprogress" data-reopen-battle="${attackingIdx}">⚔️ 부대${attackingIdx + 1} ${phaseLabel}… ${mission.timeLeft}s</button>`;
    }
    if (!raidBossUnlocked(boss)) {
      const prevName = RAID_BOSSES.find((b) => b.id === boss.requires)?.name || "";
      return `<span class="raid-status locked">🔒 ${prevName} 처치 필요</span>`;
    }
    if (raidOnCooldown(boss.id)) {
      const remain = RAID_COOLDOWN_MS - (Date.now() - state.raids[boss.id].lastDefeatedAt);
      return `<span class="raid-status defeated">✅ 처치 완료 · ⏳ ${formatCountdownShort(remain)} 후 재도전</span>`;
    }
    return `<button class="do-raid-attack" data-id="${boss.id}">⚔️ 도전</button>`;
  }
  function renderRaidModal() {
    const body = document.getElementById("raid-modal-body");
    body.innerHTML = `
      <h2>👑 보스 레이드</h2>
      <p class="raid-intro">필드·월드맵보다 압도적으로 강한 6단계 보스 체인입니다. 앞 보스를 한 번 처치해야 다음 보스가 해금되고, 각 보스는 처치 후 24시간이 지나면 다시 도전할 수 있습니다.</p>
      <p class="raid-inventory">🧩 만능 조각 보유: <b>${state.raidShards}</b>개 · 🎫 ★5+ 확정권 <b>${state.raidTickets.t5}</b>장 · 🎫 ★6+ 확정권 <b>${state.raidTickets.t6}</b>장</p>
      <div class="raid-list">
        ${RAID_BOSSES.map((boss) => {
          const s = raidBossStats(boss);
          const r = boss.reward;
          const locked = !raidBossUnlocked(boss);
          return `
          <div class="raid-row ${raidOnCooldown(boss.id) ? "cleared" : ""} ${locked ? "locked" : ""}">
            <div class="icon">${monsterIconHTML(boss.key)}</div>
            <div class="raid-info">
              <div class="raid-name">${boss.name} 👑 <span class="raid-level">Lv.${boss.level}</span></div>
              <div class="raid-stats">⚔️${s.atk.toLocaleString()} 🛡️${s.def.toLocaleString()} ❤️${s.hp.toLocaleString()}</div>
              <div class="raid-recommend">🎯 권장 전투력 <b>${raidBossRecommendedPower(boss).toLocaleString()}</b></div>
              <div class="raid-reward">보상: 자원 1종 ${r.resourceAmount.toLocaleString()} + 🪙${r.goldBonus.toLocaleString()} · 조각 ${r.shards} · ★${r.ticketRarity}+ 소환권 ${r.ticketCount}장</div>
            </div>
            <div class="raid-action">${raidActionHTML(boss)}</div>
          </div>`;
        }).join("")}
      </div>
    `;
    body.querySelectorAll(".do-raid-attack").forEach((btn) => {
      btn.addEventListener("click", () => {
        closeModal("modal-raid");
        openEngageModal("raid", btn.dataset.id);
      });
    });
    body.querySelectorAll("[data-reopen-battle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        closeModal("modal-raid");
        openRaidBattleModal(Number(btn.dataset.reopenBattle));
      });
    });
  }
  document.getElementById("btn-raid").addEventListener("click", () => {
    renderRaidModal();
    openModal("modal-raid");
  });

  // ---------- 레이드 전투 팝업 ----------
  // 레이드는 진군이 없어 dispatchSquad 직후 곧장 이 팝업을 띄운다. 팝업이 열려 있는 동안은
  // tick()이 매초 renderRaidBattleModal()을 다시 불러 카운트다운을 갱신하고, resolveBattle()이
  // 이 부대를 처치하면 같은 팝업 안에서 곧바로 승패/보상 결과 화면으로 전환된다.
  let raidBattleSquadIdx = null;
  let raidBattleResult = null;
  function openRaidBattleModal(squadIdx) {
    raidBattleSquadIdx = squadIdx;
    raidBattleResult = null;
    // renderRaidBattleModal()은 "숨겨진 동안은 그린다"는 헛수고를 막으려고 hidden 여부부터
    // 확인한다 — 그래서 openModal보다 먼저 부르면 그 첫 렌더가 그냥 조용히 건너뛰어져
    // 팝업이 뜬 직후 최대 1초(다음 tick)간 비어 보인다. 반드시 openModal 다음에 그린다.
    openModal("modal-raid-battle");
    renderRaidBattleModal();
  }
  function renderRaidBattleModal() {
    const overlay = document.getElementById("modal-raid-battle");
    if (overlay.hidden || raidBattleSquadIdx === null) return;
    const body = document.getElementById("raid-battle-modal-body");
    if (raidBattleResult) {
      const r = raidBattleResult;
      body.innerHTML = `
        <div class="rb-result ${r.win ? "win" : "lose"}">
          <div class="rb-result-icon">${r.win ? "🏆" : "💀"}</div>
          <div class="rb-result-title">${r.win ? "승리!" : "패배…"}</div>
          <div class="rb-result-enemy">${r.enemy.name} (Lv.${r.enemy.level})</div>
          <div class="rb-result-rewards">${r.win ? `보상: ${costText(r.reward)}${r.bonusMsg}` : "전과 없음"}</div>
          <div class="rb-result-loss ${r.totalLost > 0 ? "" : "ok"}">${r.totalLost > 0 ? `병사 ${r.totalLost}명 손실` : "병력 손실 없음"}</div>
          <button id="rb-close">확인</button>
        </div>
      `;
      body.querySelector("#rb-close").addEventListener("click", () => closeModal("modal-raid-battle"));
      return;
    }
    const army = state.armies[raidBattleSquadIdx];
    if (!army || !army.mission || army.mission.kind !== "raid") {
      // 팝업이 열린 채로 다른 경로(오프라인 진행 등)로 이미 정리된 경우를 위한 안전망
      closeModal("modal-raid-battle");
      return;
    }
    const mission = army.mission;
    const boss = RAID_BOSSES.find((b) => b.id === mission.targetId);
    const total = mission.battleDuration || 1;
    const progress = Math.min(1, Math.max(0, 1 - mission.timeLeft / total));
    body.innerHTML = `
      <div class="rb-arena">
        <div class="rb-side mine">
          <div class="rb-squad">${marchingSquadHTML()}</div>
          <div class="rb-label">부대 ${raidBattleSquadIdx + 1}</div>
        </div>
        <div class="rb-vs">
          <div class="rb-clash">⚔️</div>
          <div class="rb-timer">${mission.timeLeft}s</div>
          <div class="rb-progress"><div class="rb-progress-fill" style="width:${Math.round(progress * 100)}%"></div></div>
        </div>
        <div class="rb-side enemy">
          <div class="rb-boss-icon">${monsterIconHTML(boss.key)}</div>
          <div class="rb-label">${boss.name} 👑</div>
        </div>
      </div>
      <div class="rb-caption">전투 중…</div>
    `;
  }

  // ---------- 침략(월드맵 성 NPC 20개, PvE) ----------
  // "정복"(btn-worldmap/#screen-worldmap)이 실제 플레이어끼리 겨루는 PvP 맵으로 개편되며
  // 그 화면/버튼을 그대로 물려받는 바람에, 원래 있던 이 NPC 성 침공 기능이 진입 경로 없이
  // 붕 떠버렸었다(state.worldCastles는 tick()에서 계속 자원을 쌓고 있었지만 어디서도
  // 열람/공격할 방법이 없었음). openEngageModal("castle", id)/findEnemy/resolveBattle 쪽
  // 로직은 이미 다 있어서, 레이드 모달과 같은 패턴으로 목록 모달만 새로 추가해 되살렸다.
  function worldCastleActionHTML(c) {
    const attackingIdx = state.armies.findIndex((a) => a.mission && a.mission.kind === "castle" && a.mission.targetId === c.id);
    if (attackingIdx >= 0) {
      const mission = state.armies[attackingIdx].mission;
      return `<span class="raid-status inprogress">부대${attackingIdx + 1} ${mission.phase === "march" ? "진군 중" : "전투 중"}… ${mission.timeLeft}s</span>`;
    }
    return `<button class="do-castle-attack" data-id="${c.id}">⚔️ 공격</button>`;
  }
  function renderWorldCastlesModal() {
    const body = document.getElementById("worldcastles-modal-body");
    body.innerHTML = `
      <h2>🏯 침략</h2>
      <p class="raid-intro">Lv.1~20 NPC 성 20개입니다. 승리하면 그 성이 그동안 모아둔 자원을 전액 약탈합니다 — 점령 개념은 없어 자원이 0으로 초기화된 뒤 다시 쌓이고, 언제든 재도전할 수 있습니다.</p>
      <div class="raid-list">
        ${state.worldCastles.map((c) => {
          const bank = Object.fromEntries(Object.entries(c.bank).filter(([, v]) => Math.round(v) >= 1).map(([k, v]) => [k, Math.round(v)]));
          const hasBank = Object.keys(bank).length > 0;
          return `
          <div class="raid-row">
            <div class="icon">${worldCastleIconHTML(c.level)}</div>
            <div class="raid-info">
              <div class="raid-name">${c.name} <span class="raid-level">Lv.${c.level}</span></div>
              <div class="raid-stats">⚔️${c.atk.toLocaleString()} 🛡️${c.def.toLocaleString()} ❤️${c.hp.toLocaleString()}</div>
              <div class="raid-recommend">🎯 권장 전투력 <b>${(c.atk + c.def + c.hp).toLocaleString()}</b></div>
              <div class="raid-reward">💰 약탈 가능: ${hasBank ? costText(bank) : "아직 모은 자원 없음"}</div>
            </div>
            <div class="raid-action">${worldCastleActionHTML(c)}</div>
          </div>`;
        }).join("")}
      </div>
    `;
    body.querySelectorAll(".do-castle-attack").forEach((btn) => {
      btn.addEventListener("click", () => {
        closeModal("modal-worldcastles");
        openEngageModal("castle", btn.dataset.id);
      });
    });
  }
  document.getElementById("btn-worldcastles").addEventListener("click", () => {
    renderWorldCastlesModal();
    openModal("modal-worldcastles");
  });

  // ---------- 인벤토리(레이드 보상으로 받은 조각/소환권 보관·사용) ----------
  // ---------- 정복 아이템(보호막/성 이동) — 서버 인벤토리 ----------
  const SHIELD_TIER_LABEL = { shield30: "30분", shield60: "1시간", shield120: "2시간" };
  let conquestItemsInfo = null; // { items:{shield30,shield60,shield120,teleport}, costs:{...} }
  let lastItemsFetchAt = 0;
  const ITEMS_FETCH_INTERVAL_MS = 5000;

  async function refreshConquestItemsInfo() {
    if (!currentPlayer) return;
    try {
      conquestItemsInfo = await apiRequest("/api/items/me");
    } catch (e) {}
    renderInventoryModal();
  }
  function buyConquestItem(item) {
    apiRequest("/api/items/buy", { method: "POST", body: JSON.stringify({ item }) })
      .then((res) => {
        conquestItemsInfo = { items: res.items, costs: (conquestItemsInfo || {}).costs || {} };
        // 서버가 골드를 즉시 차감하지만 그 사실을 클라이언트는 모르므로, 다음 자동저장이
        // (구매 이전의) 로컬 골드값으로 서버 값을 덮어쓰지 않도록 여기서 바로 반영한다.
        if (typeof res.goldLeft === "number") state.res.gold = res.goldLeft;
        toast("🛒 아이템을 구매했습니다.");
        renderInventoryModal();
        renderTopbar();
      })
      .catch((e) => toast(e.message || "구매에 실패했습니다."));
  }
  function useConquestShield(tier) {
    apiRequest("/api/items/use-shield", { method: "POST", body: JSON.stringify({ tier }) })
      .then((res) => {
        conquestItemsInfo = { items: res.items, costs: (conquestItemsInfo || {}).costs || {} };
        toast("🛡️ 보호막을 사용했습니다.");
        lastConquestFetchAt = 0;
        renderInventoryModal();
      })
      .catch((e) => toast(e.message || "사용에 실패했습니다."));
  }
  function useConquestTeleport() {
    apiRequest("/api/items/use-teleport", { method: "POST" })
      .then((res) => {
        conquestItemsInfo = { items: res.items, costs: (conquestItemsInfo || {}).costs || {} };
        toast("🌀 정복 맵의 새로운 위치로 이동했습니다.");
        lastConquestFetchAt = 0;
        renderInventoryModal();
      })
      .catch((e) => toast(e.message || "사용에 실패했습니다."));
  }
  function conquestItemsSectionHTML() {
    if (!conquestItemsInfo) return `<p class="inv-hint">정복 아이템을 불러오는 중...</p>`;
    const { items, costs } = conquestItemsInfo;
    const shieldRows = ["shield30", "shield60", "shield120"].map((key) => `
      <div class="inv-item">
        <span class="inv-item-icon">🛡️</span>
        <span class="inv-item-name">보호막 (${SHIELD_TIER_LABEL[key]})</span>
        <span class="inv-item-count">${items[key] || 0}개</span>
        <button class="btn-buy-item" data-item="${key}">구매 🪙${(costs[key] || 0).toLocaleString()}</button>
        <button class="btn-use-shield" data-tier="${key.replace("shield", "")}" ${items[key] > 0 ? "" : "disabled"}>사용</button>
      </div>
    `).join("");
    return `
      <div class="inv-section-title">⚔️ 정복 아이템</div>
      ${shieldRows}
      <div class="inv-item">
        <span class="inv-item-icon">🌀</span>
        <span class="inv-item-name">성 이동</span>
        <span class="inv-item-count">${items.teleport || 0}개</span>
        <button class="btn-buy-item" data-item="teleport">구매 🪙${(costs.teleport || 0).toLocaleString()}</button>
        <button class="btn-use-teleport" ${items.teleport > 0 ? "" : "disabled"}>사용</button>
      </div>
      <p class="inv-hint">보호막은 중첩됩니다(예: 27분 남은 상태에서 1시간짜리 사용 시 1시간 27분). 누군가 공격하러 오는 중에는 보호막을 사용할 수 없습니다. 성 이동은 보호막이 활성화되어 있거나 부대가 출정·귀환 중일 때는 사용할 수 없습니다.</p>
    `;
  }

  function renderInventoryModal() {
    const body = document.getElementById("inventory-modal-body");
    if (!body) return;
    const t5 = state.raidTickets.t5, t6 = state.raidTickets.t6;
    body.innerHTML = `
      <h2>🎒 인벤토리</h2>
      <div class="inv-item">
        <span class="inv-item-icon">🧩</span>
        <span class="inv-item-name">만능 조각</span>
        <span class="inv-item-count">${state.raidShards}개</span>
      </div>
      <p class="inv-hint">만능 조각은 "보유 영웅" 상세 화면에서 원하는 영웅에게 적용할 수 있습니다.</p>
      <div class="inv-item">
        <span class="inv-item-icon">🎫</span>
        <span class="inv-item-name">★5 이상 확정 소환권</span>
        <span class="inv-item-count">${t5}장</span>
        <button class="btn-use-ticket" data-rarity="5" ${t5 > 0 ? "" : "disabled"}>사용</button>
      </div>
      <div class="inv-item">
        <span class="inv-item-icon">🎫</span>
        <span class="inv-item-name">★6 이상 확정 소환권</span>
        <span class="inv-item-count">${t6}장</span>
        <button class="btn-use-ticket" data-rarity="6" ${t6 > 0 ? "" : "disabled"}>사용</button>
      </div>
      <p class="inv-hint">소환권을 사용하면 여관 비용 없이 즉시 해당 등급 이상의 영웅 1명을 영입합니다.</p>
      ${conquestItemsSectionHTML()}
    `;
    body.querySelectorAll(".btn-use-ticket").forEach((btn) => {
      if (btn.disabled) return;
      btn.addEventListener("click", () => redeemRaidTicket(Number(btn.dataset.rarity)));
    });
    body.querySelectorAll(".btn-buy-item").forEach((btn) => {
      btn.addEventListener("click", () => buyConquestItem(btn.dataset.item));
    });
    body.querySelectorAll(".btn-use-shield").forEach((btn) => {
      if (btn.disabled) return;
      btn.addEventListener("click", () => useConquestShield(Number(btn.dataset.tier)));
    });
    const teleportBtn = body.querySelector(".btn-use-teleport");
    if (teleportBtn && !teleportBtn.disabled) teleportBtn.addEventListener("click", useConquestTeleport);
    const now = Date.now();
    if (!currentPlayer) return;
    if (now - lastItemsFetchAt > ITEMS_FETCH_INTERVAL_MS) {
      lastItemsFetchAt = now;
      refreshConquestItemsInfo();
    }
  }
  document.getElementById("btn-inventory").addEventListener("click", () => {
    renderInventoryModal();
    openModal("modal-inventory");
  });

  // ---------- 군대 편성(다중 부대) ----------
  function openArmyModal() {
    let activeSquad = 0;
    const body = document.getElementById("army-modal-body");
    function render() {
      const ownedList = Object.keys(state.owned).map((id) => HERO_BY_ID[id]).filter(Boolean).sort((a, c) => c.rarity - a.rarity || heroEnhance(c.id) - heroEnhance(a.id));
      const army = state.armies[activeSquad];
      if (!army.lastComp) army.lastComp = {};
      let selectedSlot = army.heroIds.findIndex((h) => !h);
      const totalTroops = Object.entries(state.troopsByType).map(([k, v]) => `${TROOP_TYPES_BY_KEY[k].name} ${v}`).join(" · ");
      const power = armyPowerScore(army.heroIds, army.lastComp);
      const capacity = armyCarryCapacity(army.heroIds, army.lastComp);
      body.innerHTML = `
        <h2>⚔️ 군대 편성 (부대 ${SQUAD_COUNT}개, 각 영웅 최대 3명) <button id="do-auto-compose" class="btn-small">🤖 자동 편성</button></h2>
        <p>보유 병사: ${totalTroops}</p>
        <div class="squad-tabs">
          ${state.armies.map((a, i) => `<button class="squad-tab ${i === activeSquad ? "active" : ""} ${a.mission ? "busy" : ""}" data-idx="${i}">부대 ${i + 1}${a.mission ? " 🪖" : ""} <span class="squad-power">⚔️${armyPowerScore(a.heroIds, a.lastComp || {}).toLocaleString()}</span></button>`).join("")}
        </div>
        <div class="army-power-bar">🏆 이 부대의 전투력 <span class="power-num">${power.toLocaleString()}</span> · 🚚 수송력 <span class="capacity-num">${capacity.toLocaleString()}</span>${army.mission ? `<span class="hr-note">현재 출정 중 — 배치를 바꿔도 진행 중인 원정에는 영향이 없습니다</span>` : ""}</div>
        <div class="modal-cols">
          <div class="col narrow">
            <h3>영웅 배치</h3>
            <div class="army-slots">
              ${[0, 1, 2].map((i) => {
                const heroId = army.heroIds[i];
                const hero = heroId ? HERO_BY_ID[heroId] : null;
                return `<div class="army-slot ${i === selectedSlot ? "selected" : ""}" data-idx="${i}">
                  ${hero ? `${heroBadgeHTML(hero.id)}<span>${hero.name}</span><button class="do-unassign-army" data-idx="${i}">해제</button>`
                         : `<span class="empty">영웅 배치 ${i + 1}</span>`}
                </div>`;
              }).join("")}
            </div>
          </div>
          <div class="col">
            <h3>영웅 선택</h3>
            <div class="hero-slot-list">
              ${ownedList.length ? "" : "<p><small>보유한 영웅이 없습니다.</small></p>"}
              ${ownedList.map((h) => {
                const loc = heroPlacementLocation(h.id);
                const combatTraits = heroCombatTraits(h);
                const traitSummary = combatTraits.length
                  ? combatTraits.map((t) => `⚔️${t.statKey} +${heroTraitPercent(h, t).toFixed(1)}%`).join(" · ")
                  : "🏛️ 건물 특화";
                return `<div class="hero-row" data-hero="${h.id}">
                  ${heroBadgeHTML(h.id)}
                  <span>${h.name}</span>
                  <span class="hr-note">${traitSummary}</span>
                  ${loc ? `<span class="hero-elsewhere-badge">📍 ${loc}에 배치됨</span>` : ""}
                </div>`;
              }).join("")}
            </div>
          </div>
        </div>
        <h3>병사 배치</h3>
        <p><small>부대에 함께 보낼 병사 수를 미리 정해두면, 다음 출격 시 이 값이 자동 적용됩니다. 한 병사는 한 부대에만 편성할 수 있습니다.</small></p>
        <div class="troop-comp-grid" id="army-comp-list">
          ${TROOP_TYPES.map((t) => {
            const owned = state.troopsByType[t.key] || 0;
            // 다른 부대가 이미 편성해 둔 만큼은 이 부대에서 쓸 수 없다 — 영웅이 한 부대에만
            // 있을 수 있는 것과 같은 원칙. 초과분이 있으면(예: 다른 탭에서 방금 늘림) 방어적으로
            // 즉시 깎는다.
            const reservedByOthers = state.armies.reduce((sum, a, idx) => idx === activeSquad ? sum : sum + (a.lastComp[t.key] || 0), 0);
            const avail = Math.max(0, owned - reservedByOthers);
            const val = Math.min(avail, army.lastComp[t.key] || 0);
            if (val > 0) army.lastComp[t.key] = val; else delete army.lastComp[t.key];
            return `
            <div class="troop-comp-card">
              <div class="tc-name">${t.name}</div>
              <div class="tc-avail">보유 ${avail}${reservedByOthers > 0 ? ` <span class="hr-note">(다른 부대 편성 ${reservedByOthers}명 제외)</span>` : ""}</div>
              <input type="range" class="ac-input" data-key="${t.key}" min="0" max="${avail}" value="${val}" ${avail === 0 ? "disabled" : ""} />
              <div class="tc-value"><span class="tc-num" data-key-val="${t.key}">${val}</span><span class="tc-unit">명</span></div>
            </div>`;
          }).join("")}
        </div>
      `;
      body.querySelector("#do-auto-compose").addEventListener("click", () => {
        // 현재 부대의 빈 슬롯만 채운다(이미 배치된 영웅은 건드리지 않는다) — 어떤 부대에도
        // 없는 보유 영웅 중 전투력(armyPowerScore) 상위 순으로 채우고, 병사 구성은 미리보기
        // 겸 기본값으로 현재 보유한 병사 전량을 채운다(실제 파병 수량은 출정 폼에서 별도
        // 입력하므로 여기서 병력을 소모하지 않는다).
        const inAnyArmy = new Set(state.armies.flatMap((a) => a.heroIds.filter(Boolean)));
        const candidates = Object.keys(state.owned).map(Number)
          .filter((id) => HERO_BY_ID[id] && !inAnyArmy.has(id))
          .sort((a, b) => armyPowerScore([b], {}) - armyPowerScore([a], {}));
        let filled = 0;
        for (let i = 0; i < 3 && candidates.length; i++) {
          if (army.heroIds[i]) continue;
          army.heroIds[i] = candidates.shift();
          filled += 1;
        }
        // 병사도 영웅처럼 다른 부대가 이미 편성해 둔 만큼은 제외한 "진짜 남은 수량"만 채운다.
        TROOP_TYPES.forEach((t) => {
          const owned = state.troopsByType[t.key] || 0;
          const reservedByOthers = state.armies.reduce((sum, a, idx) => idx === activeSquad ? sum : sum + (a.lastComp[t.key] || 0), 0);
          const avail = Math.max(0, owned - reservedByOthers);
          if (avail > 0) army.lastComp[t.key] = avail; else delete army.lastComp[t.key];
        });
        save();
        renderBoard();
        render();
        toast(filled > 0 ? `🤖 영웅 ${filled}명을 부대에 자동 편성했습니다` : "자동 편성할 여유 영웅이 없습니다(모두 다른 부대에 배치됨)");
      });
      body.querySelectorAll(".squad-tab").forEach((btn) => btn.addEventListener("click", () => { activeSquad = Number(btn.dataset.idx); render(); }));
      body.querySelectorAll(".do-unassign-army").forEach((btn) => {
        btn.addEventListener("click", (e) => { e.stopPropagation(); army.heroIds[Number(btn.dataset.idx)] = null; save(); render(); });
      });
      body.querySelectorAll(".army-slot").forEach((slotEl) => {
        slotEl.addEventListener("click", () => { selectedSlot = Number(slotEl.dataset.idx); render(); });
      });
      body.querySelectorAll(".hero-row").forEach((row) => {
        row.addEventListener("click", () => {
          const heroId = Number(row.dataset.hero);
          if (state.armies.some((a) => a.heroIds.includes(heroId))) { toast("이미 다른 부대에 편성된 영웅입니다"); return; }
          let idx = selectedSlot;
          if (idx === -1 || army.heroIds[idx]) idx = army.heroIds.findIndex((h) => !h);
          if (idx === -1) { toast("부대 슬롯이 가득 찼습니다 (최대 3명)"); return; }
          const prevLocation = heroArmyLocation(heroId);
          clearHeroFromArmies(heroId);
          army.heroIds[idx] = heroId;
          save();
          renderBoard();
          render();
          if (prevLocation) toast(`${HERO_BY_ID[heroId].name}의 ${prevLocation} 배치가 해제되고 부대에 편성되었습니다`);
        });
      });
      // 드래그 도중 body.innerHTML을 통째로 다시 그리면 슬라이더 조작이 끊기므로,
      // input 중에는 표시 텍스트만 갱신하고 실제 저장(save)은 change(드래그 종료) 시점에 한다
      body.querySelectorAll(".ac-input").forEach((input) => {
        const updateDisplays = () => {
          const val = Number(input.value);
          body.querySelector(`#army-comp-list .tc-num[data-key-val="${input.dataset.key}"]`).textContent = val;
          const p = armyPowerScore(army.heroIds, army.lastComp);
          body.querySelector(".power-num").textContent = p.toLocaleString();
          body.querySelector(".capacity-num").textContent = armyCarryCapacity(army.heroIds, army.lastComp).toLocaleString();
          const tabPower = body.querySelector(`.squad-tab[data-idx="${activeSquad}"] .squad-power`);
          if (tabPower) tabPower.textContent = `⚔️${p.toLocaleString()}`;
        };
        input.addEventListener("input", () => {
          const val = Number(input.value);
          if (val > 0) army.lastComp[input.dataset.key] = val;
          else delete army.lastComp[input.dataset.key];
          updateDisplays();
        });
        input.addEventListener("change", () => save());
      });
    }
    render();
    openModal("modal-army");
  }

  // ---------- 도감 ----------
  let codexFilter = "all";
  function renderCodexFilters() {
    const wrap = document.getElementById("codex-filters");
    const opts = [["all", "전체"], [1, "★1"], [2, "★2"], [3, "★3"], [4, "★4"], [5, "★5"], [6, "★6"], [7, "★7"], [8, "★8"]];
    wrap.innerHTML = "";
    opts.forEach(([val, label]) => {
      const btn = document.createElement("button");
      btn.textContent = label;
      if (String(val) === String(codexFilter)) btn.classList.add("active");
      btn.addEventListener("click", () => { codexFilter = val; renderCodexFilters(); renderCodexGrid(); });
      wrap.appendChild(btn);
    });
  }
  function renderCodexGrid() {
    const grid = document.getElementById("codex-grid");
    grid.innerHTML = "";
    const list = HEROES.filter((h) => codexFilter === "all" || h.rarity === Number(codexFilter) || (h.secret && codexFilter === 8));
    list.forEach((hero) => {
      const owned = !!state.owned[hero.id];
      const cell = document.createElement("div");
      cell.className = `codex-cell hc-r${hero.rarity}` + (owned ? "" : " locked");
      cell.innerHTML = `
        <div class="cc-portrait">${owned ? heroPortraitHTML(hero) : "❔"}</div>
        <div class="cc-name">${owned ? hero.name : "???"}</div>
        <span class="star-badge r${hero.rarity}">★${hero.rarity}</span>
      `;
      cell.addEventListener("click", () => renderCodexDetail(hero.id));
      grid.appendChild(cell);
    });
    const ownedCount = Object.keys(state.owned).length;
    document.getElementById("codex-progress").textContent = `(${ownedCount} / ${HEROES.length} 수집)`;
  }
  // 영웅 상세 패널 HTML(도감/보유 영웅 모달 공용)
  // 레이드에서 받은 "만능 조각"(어떤 영웅에게든 쓸 수 있음) n개를 이 영웅의 조각으로 전환한다
  function applyRaidShards(heroId, amount) {
    const owned = state.owned[heroId];
    if (!owned) return;
    const n = Math.max(0, Math.min(Math.floor(amount) || 0, state.raidShards));
    if (n <= 0) { toast("적용할 조각 수를 입력하세요"); return; }
    state.raidShards -= n;
    owned.shards += n;
    toast(`🧩 만능 조각 ${n}개를 ${HERO_BY_ID[heroId].name}에게 적용했습니다`);
    save();
  }
  function heroDetailHTML(heroId) {
    const hero = HERO_BY_ID[heroId];
    const owned = state.owned[heroId];
    if (!owned) return `<p>아직 만나지 못한 영웅입니다. 여관에서 뽑아보세요.</p>`;
    const needed = owned.enhance < MAX_ENHANCE ? 3 * (owned.enhance + 1) : null;
    const traitDesc = hero.traits.map((t) => `<p>${traitLineHTML(hero, t)}</p>`).join("");
    return `
      <h3><span class="modal-icon">${heroPortraitHTML(hero)}</span>${hero.name} ${heroBadgeHTML(hero.id)}</h3>
      <p>${hero.domain} · ${hero.culture}</p>
      <p><em>${hero.flavor}</em></p>
      ${traitDesc}
      <p>공격 ${hero.atk} · 방어 ${hero.def} · 체력 ${hero.hp}</p>
      <p>누적 영입 ${owned.count}회 · 조각: ${owned.shards}${needed !== null ? ` / 강화 필요 ${needed}` : " (최고 강화 +" + MAX_ENHANCE + "강)"}</p>
      ${needed !== null ? `<button class="do-enhance" data-hero="${heroId}">강화하기 (+1강)</button>` : ""}
      ${needed !== null && state.raidShards > 0 ? `
        <div class="shard-apply-row">
          <input type="number" class="raid-shard-input" min="1" max="${state.raidShards}" value="${Math.min(state.raidShards, Math.max(1, needed - owned.shards))}" />
          <button class="do-apply-shards" data-hero="${heroId}">🧩 만능 조각 적용 (보유 ${state.raidShards})</button>
        </div>
      ` : ""}
    `;
  }
  function renderCodexDetail(heroId) {
    const panel = document.getElementById("codex-detail");
    panel.innerHTML = heroDetailHTML(heroId);
    const btn = panel.querySelector(".do-enhance");
    if (btn) btn.addEventListener("click", () => { enhance(heroId); renderCodexDetail(heroId); renderCodexGrid(); });
    const shardBtn = panel.querySelector(".do-apply-shards");
    if (shardBtn) shardBtn.addEventListener("click", () => {
      const input = panel.querySelector(".raid-shard-input");
      applyRaidShards(heroId, Number(input.value));
      renderCodexDetail(heroId);
      renderCodexGrid();
    });
  }
  document.getElementById("btn-codex").addEventListener("click", () => {
    renderCodexFilters();
    renderCodexGrid();
    document.getElementById("codex-detail").innerHTML = "<p>영웅을 선택해 세부 정보를 확인하세요.</p>";
    openModal("modal-codex");
  });

  // ---------- 보유 영웅 모달(도감과 달리 뽑은 영웅만 모아서 봄) ----------
  function renderOwnedHeroesGrid() {
    const grid = document.getElementById("heroes-grid");
    grid.innerHTML = "";
    const ownedList = Object.keys(state.owned).map((id) => HERO_BY_ID[id]).filter(Boolean)
      .sort((a, c) => c.rarity - a.rarity || heroEnhance(c.id) - heroEnhance(a.id));
    if (!ownedList.length) {
      grid.innerHTML = "<p><small>아직 보유한 영웅이 없습니다. 여관에서 뽑아보세요.</small></p>";
    }
    ownedList.forEach((hero) => {
      const cell = document.createElement("div");
      cell.className = `codex-cell hc-r${hero.rarity}`;
      cell.innerHTML = `
        <div class="cc-portrait">${heroPortraitHTML(hero)}</div>
        <div class="cc-name">${hero.name}</div>
        <span class="star-badge r${hero.rarity}">★${hero.rarity}</span>
      `;
      cell.addEventListener("click", () => renderOwnedHeroDetail(hero.id));
      grid.appendChild(cell);
    });
  }
  function renderOwnedHeroDetail(heroId) {
    const panel = document.getElementById("heroes-detail");
    panel.innerHTML = heroDetailHTML(heroId);
    const btn = panel.querySelector(".do-enhance");
    if (btn) btn.addEventListener("click", () => { enhance(heroId); renderOwnedHeroDetail(heroId); });
    const shardBtn = panel.querySelector(".do-apply-shards");
    if (shardBtn) shardBtn.addEventListener("click", () => {
      const input = panel.querySelector(".raid-shard-input");
      applyRaidShards(heroId, Number(input.value));
      renderOwnedHeroDetail(heroId);
    });
  }
  document.getElementById("btn-heroes").addEventListener("click", () => {
    renderOwnedHeroesGrid();
    document.getElementById("heroes-detail").innerHTML = "<p>영웅을 선택해 세부 정보를 확인하세요.</p>";
    openModal("modal-heroes");
  });

  // ---------- 설명서 모달 ----------
  document.getElementById("btn-help").addEventListener("click", () => {
    const body = document.getElementById("help-modal-body");
    body.innerHTML = `
      <h2>📖 설명서</h2>
      <div class="help-list">
        ${Object.entries(BUILDING_TYPES).map(([name, def]) => `
          <div class="help-row">
            <span class="icon">${buildingIconHTML(name, 1)}</span>
            <span class="help-name">${name}</span>
            <span class="help-desc">${def.desc || ""}</span>
          </div>
        `).join("")}
      </div>
    `;
    openModal("modal-help");
  });

  // ---------- 모달 공통 ----------
  function openModal(id) { document.getElementById(id).hidden = false; }
  function closeModal(id) { document.getElementById(id).hidden = true; }
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-close]");
    if (!btn) return;
    const overlay = btn.closest(".modal-overlay");
    if (overlay) closeModal(overlay.id);
  });
  document.querySelectorAll(".modal-overlay").forEach((ov) => {
    ov.addEventListener("click", (e) => { if (e.target === ov) closeModal(ov.id); });
  });

  document.getElementById("btn-log-toggle").addEventListener("click", () => toggleLogPanel());
  document.getElementById("btn-log-close").addEventListener("click", () => toggleLogPanel(false));

  document.getElementById("btn-reset-game").addEventListener("click", () => {
    if (!confirm("정말로 게임 진행을 초기화할까요?")) return;
    localStorage.removeItem(SAVE_KEY);
    state = freshState();
    rerollTavern();
    renderTopbar();
    renderBoard();
    renderMonsterArea();
    renderWorldMap();
    renderWallFrame();
    toast("게임을 초기화했습니다");
  });

  document.getElementById("btn-army").addEventListener("click", openArmyModal);

  // 영웅 자동 배치 — 아직 어떤 건물에도 배치되지 않은 보유 영웅만 대상으로 한다(수동으로
  // 이미 배치해둔 곳은 건드리지 않는다). (영웅, 건물) 조합 중 보너스가 있는 것만 골라
  // 보너스 % 내림차순으로 그리디하게 채운다 — 전역 최적은 아니지만 직관적이고 되돌리기
  // 쉬운 결과를 준다.
  function autoAssignHeroes() {
    const unplaced = Object.keys(state.owned).map(Number).filter((id) => HERO_BY_ID[id] && !heroBuildingLocation(id));
    const candidateTiles = Object.entries(state.tiles).filter(([, t]) => {
      const bdef = BUILDING_TYPES[t.type];
      return t.built && bdef && !bdef.noHeroBonus && t.heroIds.length < MAX_HEROES_PER_BUILDING;
    });
    const pairs = [];
    unplaced.forEach((heroId) => {
      const hero = HERO_BY_ID[heroId];
      candidateTiles.forEach(([tileId, tile]) => {
        const bonus = heroBuildingBonusFor(hero, tile.type);
        if (bonus > 0) pairs.push({ heroId, tileId, bonus });
      });
    });
    pairs.sort((a, b) => b.bonus - a.bonus);
    const slotsLeft = {};
    candidateTiles.forEach(([tileId, tile]) => { slotsLeft[tileId] = MAX_HEROES_PER_BUILDING - tile.heroIds.length; });
    const placedHero = new Set();
    let count = 0;
    pairs.forEach(({ heroId, tileId }) => {
      if (placedHero.has(heroId) || slotsLeft[tileId] <= 0) return;
      state.tiles[tileId].heroIds.push(heroId);
      slotsLeft[tileId] -= 1;
      placedHero.add(heroId);
      count += 1;
    });
    if (count > 0) {
      save();
      renderBoard();
      toast(`🤖 영웅 ${count}명을 특성에 맞는 건물에 자동 배치했습니다`);
    } else {
      toast("자동 배치할 수 있는 영웅이 없습니다(이미 배치되었거나 맞는 건물이 없음)");
    }
  }
  document.getElementById("btn-auto-assign").addEventListener("click", autoAssignHeroes);
  document.getElementById("wall-frame").addEventListener("click", (e) => {
    if (e.target.closest("#board")) return;
    const wall = state.tiles.wall;
    if (!wall.built) openBuildModal("wall");
    else openBuildingModal("wall");
  });

  // ---------- 월드맵: 레벨1~20 성을 경로 형태로 배치 ----------
  // ---------- 정복(PvP 월드맵): 거대 타일 그리드 + 서버 동기화 ----------
  // 아래 세 상수는 style.css의 .worldmap-field/.conquest-cell 기본값과 맞춰져 있다.
  const CONQUEST_TILE_PX = 72;
  const CONQUEST_VIEW_W = 15;
  const CONQUEST_VIEW_H = 9;
  const CONQUEST_FETCH_INTERVAL_MS = 4000;
  // 배경을 카메라 좌표에 맞춰 흐르게 하는 비율(패럴랙스) — style.css .worldmap-field의
  // background-size(480x300 = 칸 크기 72px x 6.67/4.17배)와 맞춰, 카메라가 1칸 움직일 때
  // 배경도 딱 그만큼(칸 크기 절반 속도로) 흐르는 것처럼 보이게 조정한 값이다.
  const CONQUEST_BG_PARALLAX = CONQUEST_TILE_PX * 0.5;
  const CONQUEST_ALL_TILES_INTERVAL_MS = 15000; // 미니맵은 전체 지도를 훑으므로 뷰포트 타일보다 뜸하게 갱신
  let conquestInfo = null; // GET /api/conquest/me 캐시: { tile, unlocked, mapWidth, mapHeight }
  let conquestCamera = null; // 뷰포트 좌상단 타일 좌표
  const conquestTiles = new Map(); // "x,y" -> { x, y, nickname, protectedUntil }
  let conquestAllTiles = []; // 미니맵용 — 전체 지도의 성 좌표(닉네임 없이 가볍게)
  let lastConquestAllTilesFetchAt = 0;
  let conquestMissionPaths = []; // 뷰포트와 겹치는 진행 중인 부대 이동 경로(내 것/남의 것 모두)
  let conquestLoading = false;
  let lastConquestFetchAt = 0;
  let conquestMissions = []; // GET /api/conquest/missions 캐시
  let lastMissionSnapshot = "";
  // 정복 맵 화면을 보고 있지 않아도(성/영웅 화면 등) 전투 결과 알림은 받아야 하므로,
  // 월드맵 갱신(4초 주기)과 별개로 훨씬 뜸한 주기로 미션 목록만 확인하는 백그라운드 폴링.
  const PVP_NOTIFY_INTERVAL_MS = 15000;
  let lastPvpNotifyFetchAt = 0;

  function clampConquestCamera(x, y) {
    const mapW = (conquestInfo && conquestInfo.mapWidth) || CONQUEST_VIEW_W;
    const mapH = (conquestInfo && conquestInfo.mapHeight) || CONQUEST_VIEW_H;
    const maxX = Math.max(0, mapW - CONQUEST_VIEW_W);
    const maxY = Math.max(0, mapH - CONQUEST_VIEW_H);
    return { x: Math.max(0, Math.min(maxX, Math.round(x))), y: Math.max(0, Math.min(maxY, Math.round(y))) };
  }

  async function loadConquestViewportTiles() {
    if (!conquestCamera) return;
    const pad = 3; // 드래그 중에도 화면이 덜 비어 보이도록 보이는 범위보다 살짝 넓게 미리 받아둔다
    const x0 = Math.max(0, conquestCamera.x - pad);
    const y0 = Math.max(0, conquestCamera.y - pad);
    const x1 = conquestCamera.x + CONQUEST_VIEW_W - 1 + pad;
    const y1 = conquestCamera.y + CONQUEST_VIEW_H - 1 + pad;
    try {
      const res = await apiRequest(`/api/conquest/tiles?x0=${x0}&y0=${y0}&x1=${x1}&y1=${y1}`);
      res.tiles.forEach((t) => conquestTiles.set(t.x + "," + t.y, t));
      renderConquestBody();
    } catch (e) {}
    try {
      const pathRes = await apiRequest(`/api/conquest/mission-paths?x0=${x0}&y0=${y0}&x1=${x1}&y1=${y1}`);
      conquestMissionPaths = pathRes.paths;
      renderConquestGrid();
    } catch (e) {}
  }

  // 미니맵용 — 뷰포트 밖에 있는 성까지 포함해 지도 전체를 훑어온다(닉네임 없이 좌표만).
  async function loadConquestAllTiles() {
    try {
      const res = await apiRequest("/api/conquest/all-tiles");
      conquestAllTiles = res.tiles;
      renderMinimap();
    } catch (e) {}
  }

  async function refreshConquestInfo() {
    conquestLoading = true;
    try {
      conquestInfo = await apiRequest("/api/conquest/me");
      if (conquestInfo.unlocked) maybeShowConquestTutorial();
      if (conquestInfo.tile && !conquestCamera) {
        conquestCamera = clampConquestCamera(conquestInfo.tile.x - Math.floor(CONQUEST_VIEW_W / 2), conquestInfo.tile.y - Math.floor(CONQUEST_VIEW_H / 2));
      }
      if (conquestInfo.tile) await loadConquestViewportTiles();
      const now = Date.now();
      if (conquestInfo.tile && now - lastConquestAllTilesFetchAt > CONQUEST_ALL_TILES_INTERVAL_MS) {
        lastConquestAllTilesFetchAt = now;
        loadConquestAllTiles();
      }
    } catch (e) {}
    if (conquestInfo && conquestInfo.tile) await refreshConquestMissions();
    conquestLoading = false;
    renderConquestBody();
  }

  // 서버가 PvP 전투/귀환 판정으로 바꾼 병사 수·자원은 클라이언트가 몰랐던 변화라,
  // 다음 주기적 저장(syncStateToServer)이 그걸 덮어써버리지 않도록 미리 받아와 반영해야
  // 한다. state 전체를 덮지 않고 이 두 필드만 병합하는 이유: 그 사이 로컬에서 건물/연구
  // 등을 조작했다면 그 진행은 그대로 지키기 위함.
  function adoptServerDeltaFields(serverState) {
    if (!serverState) return;
    if (serverState.troopsByType) state.troopsByType = serverState.troopsByType;
    if (serverState.res) Object.assign(state.res, serverState.res);
    renderTopbar();
  }
  function missionsSnapshot(list) {
    return list.map((m) => `${m.id}:${m.phase}`).sort().join(",");
  }
  async function refreshConquestMissions() {
    try {
      const res = await apiRequest("/api/conquest/missions");
      const snap = missionsSnapshot(res.missions);
      if (lastMissionSnapshot && snap !== lastMissionSnapshot) {
        try {
          const fresh = await apiRequest("/api/state");
          if (fresh.state) adoptServerDeltaFields(fresh.state);
        } catch (e) {}
      }
      lastMissionSnapshot = snap;
      conquestMissions = res.missions;
      renderConquestMissions();
      processPvpResultNotifications(res.missions);
    } catch (e) {}
  }
  // 월드맵 화면을 보고 있지 않을 때도 전투 결과를 알 수 있도록, 화면 렌더는 건드리지
  // 않고 미션 목록만 가져와 새 결과가 있는지 확인한다(tick()에서 호출).
  async function pollPvpNotificationsAmbient() {
    try {
      const res = await apiRequest("/api/conquest/missions");
      processPvpResultNotifications(res.missions);
    } catch (e) {}
  }
  // 공격/피공격 양측 모두 승패를 알아야 한다 — attack 미션 중 결과가 나왔는데(result)
  // 아직 이 계정이 확인하지 않은(seen=false) 것을 찾아 토스트+로그+결과창으로 알린다.
  function processPvpResultNotifications(missions) {
    (missions || []).forEach((m) => {
      if (m.kind !== "attack" || !m.result || m.seen) return;
      showBattleReport(m);
      ackMissionResult(m.id);
    });
  }
  async function ackMissionResult(missionId) {
    try { await apiRequest("/api/conquest/missions/ack", { method: "POST", body: JSON.stringify({ missionId }) }); } catch (e) {}
  }
  function formatLootText(loot) {
    if (!loot) return "";
    const parts = [];
    if (loot.food) parts.push(`🌾${loot.food}`);
    if (loot.wood) parts.push(`🪵${loot.wood}`);
    if (loot.stone) parts.push(`🪨${loot.stone}`);
    if (loot.gold) parts.push(`🪙${loot.gold}`);
    return parts.join(" ");
  }
  function showBattleReport(m) {
    const isAttacker = m.isMine;
    const attackerWins = m.result.attackerWins;
    const myOutcomeWin = isAttacker ? attackerWins : !attackerWins;
    const otherName = isAttacker ? m.targetNickname : m.originNickname;
    const lootText = formatLootText(m.result.loot);
    let headline, detail;
    if (isAttacker) {
      headline = myOutcomeWin ? `⚔️ 승리! ${otherName}의 성을 약탈했습니다` : `⚔️ 패배… ${otherName}의 방어를 뚫지 못했습니다`;
      detail = `아군 병력 ${m.result.attackerLost}명 손실` + (lootText ? ` · 약탈 ${lootText}` : "");
    } else {
      headline = myOutcomeWin ? `🛡️ 승리! ${otherName}의 공격을 막아냈습니다` : `🛡️ 패배… ${otherName}에게 성이 약탈당했습니다`;
      detail = `아군 병력 ${m.result.defenderLost}명 손실` + (!myOutcomeWin && lootText ? ` · 약탈당함 ${lootText}` : "");
    }
    toast(`${headline}`);
    logEvent(`${headline} — ${detail}`, myOutcomeWin ? "battle-win" : "battle-lose");
    // 다른 모달이 이미 떠 있으면(예: 다른 작업 중) 굳이 덮어 열지 않는다 — 토스트+로그로도
    // 결과는 이미 전달됐고, 모달끼리 겹쳐 뜨는 걸 피하기 위함.
    if (document.querySelector(".modal-overlay:not([hidden])")) return;
    const titleEl = document.getElementById("battle-report-title");
    titleEl.textContent = headline;
    titleEl.className = myOutcomeWin ? "battle-report-win" : "battle-report-lose";
    document.getElementById("battle-report-body").innerHTML = `<p>${detail}</p>`;
    openModal("modal-battle-report");
  }
  async function recallConquestMission(missionId) {
    try {
      await apiRequest("/api/conquest/recall", { method: "POST", body: JSON.stringify({ missionId }) });
      toast("🔙 부대를 회군시켰습니다.");
      lastMissionSnapshot = "";
      refreshConquestMissions();
    } catch (e) {
      toast(e.message || "회군에 실패했습니다.");
    }
  }
  function renderConquestMissions() {
    const wrap = document.getElementById("conquest-missions");
    if (!wrap) return;
    const now = Date.now();
    const rows = conquestMissions.map((m) => {
      const other = m.isMine ? m.targetNickname : m.originNickname;
      const kindLabel = m.kind === "attack" ? "⚔️ 공격" : "🛡️ 지원";
      const resultTag = m.kind === "attack" && m.result
        ? ` <span class="mission-result-tag ${(m.isMine ? m.result.attackerWins : !m.result.attackerWins) ? "win" : "lose"}">${(m.isMine ? m.result.attackerWins : !m.result.attackerWins) ? "승리" : "패배"}</span>`
        : "";
      if (m.isMine) {
        if (m.phase === "outbound") return `<div class="conquest-mission-row">${kindLabel} → ${other} · 도착까지 ${formatCountdownShort(m.arriveAt - now)} <button class="btn-recall-mission" data-id="${m.id}">회군</button></div>`;
        if (m.phase === "stationed") return `<div class="conquest-mission-row">${kindLabel} → ${other} · 주둔 중 <button class="btn-recall-mission" data-id="${m.id}">철수</button></div>`;
        if (m.phase === "returning") return `<div class="conquest-mission-row">${kindLabel} → ${other} · 귀환 중 ${formatCountdownShort(m.returnArriveAt - now)}${resultTag}</div>`;
      } else if (m.kind === "attack" && m.phase === "outbound") {
        return `<div class="conquest-mission-row incoming">⚠️ ${other}의 공격이 오는 중! 도착까지 ${formatCountdownShort(m.arriveAt - now)}</div>`;
      } else if (m.kind === "attack" && m.result) {
        return `<div class="conquest-mission-row">${other}의 공격 결과${resultTag}</div>`;
      }
      return "";
    }).filter(Boolean);
    wrap.innerHTML = rows.join("");
    wrap.querySelectorAll(".btn-recall-mission").forEach((btn) => btn.addEventListener("click", () => recallConquestMission(Number(btn.dataset.id))));
  }

  // 정복이 해금된 계정마다 딱 한 번만 보여주는 이미지(이모지) 시각화 튜토리얼.
  // 서버가 아니라 localStorage에 닉네임별로 기록 — 다른 기기에서 한 번 더 보일 수는
  // 있지만(공유 계정 시스템에 이 정도 사소한 중복은 감수), 별도 서버 컬럼 없이 단순하다.
  function maybeShowConquestTutorial() {
    if (!currentPlayer) return;
    const key = "olympusSngSeenConquestTutorial_" + currentPlayer.nickname;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
    document.getElementById("conquest-tutorial-body").innerHTML = `
      <div class="tutorial-step">
        <div class="tutorial-visual">🗺️ → 🏰</div>
        <p>정복이 해금되었습니다! 거대한 정복 지도의 무작위 위치에 내 성이 배정됩니다.
        같은 칸에 두 플레이어가 겹치는 일은 없습니다.</p>
      </div>
      <div class="tutorial-step">
        <div class="tutorial-visual">🛡️ 30:00</div>
        <p>배정 직후 30분간은 다른 플레이어가 나를 공격할 수 없습니다.
        이 시간 동안 병력을 준비하고 지도를 둘러보세요.</p>
      </div>
      <div class="tutorial-step">
        <div class="tutorial-visual">🏰⚔️🏰 · 🏰🛡️🤝</div>
        <p>보호가 끝나면 다른 플레이어를 공격하거나 공격받을 수 있습니다.
        동료의 성에 지원군을 보내 함께 방어할 수도 있습니다.</p>
      </div>
    `;
    openModal("modal-conquest-tutorial");
  }

  async function doConquestSpawn() {
    try {
      const res = await apiRequest("/api/conquest/spawn", { method: "POST" });
      conquestInfo.tile = res.tile;
      conquestCamera = clampConquestCamera(res.tile.x - Math.floor(CONQUEST_VIEW_W / 2), res.tile.y - Math.floor(CONQUEST_VIEW_H / 2));
      lastConquestFetchAt = 0;
      await loadConquestViewportTiles();
      renderConquestBody();
      toast("⚔️ 정복 맵에 참가했습니다! 30분간 보호받습니다.");
      logEvent("⚔️ 정복 맵에 참가했습니다", "build");
    } catch (e) {
      toast(e.message || "참가에 실패했습니다.");
    }
  }

  function formatCountdownShort(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}시간 ${m}분`;
    if (m > 0) return `${m}분 ${s}초`;
    return `${s}초`;
  }

  // 좌표를 5가지 색조 변형 중 하나로 결정론적으로 배정 — 같은 칸은 항상 같은 색이라
  // "여긴 아까 그 자리다/아니다"를 색으로 구분할 수 있게 한다.
  function conquestTerrainClass(x, y) {
    return "terrain-" + (((x * 31 + y * 17) % 5) + 5) % 5;
  }
  function renderConquestGrid() {
    const field = document.getElementById("worldmap-field");
    field.style.gridTemplateColumns = `repeat(${CONQUEST_VIEW_W}, ${CONQUEST_TILE_PX}px)`;
    field.style.gridTemplateRows = `repeat(${CONQUEST_VIEW_H}, ${CONQUEST_TILE_PX}px)`;
    // 배경(두 번째 레이어)을 카메라 좌표에 비례해 흘려서, 드래그/재조회로 화면이 바뀔 때
    // 배경도 같이 움직이는 것처럼 보이게 한다(카메라가 고정된 채 타일만 바뀌면 "이동했다"는
    // 느낌이 전혀 없었던 문제).
    const bgX = -(conquestCamera.x * CONQUEST_BG_PARALLAX) % 480;
    const bgY = -(conquestCamera.y * CONQUEST_BG_PARALLAX) % 300;
    field.style.backgroundPosition = `center, ${bgX}px ${bgY}px`;
    field.innerHTML = "";
    const now = Date.now();
    for (let dy = 0; dy < CONQUEST_VIEW_H; dy++) {
      for (let dx = 0; dx < CONQUEST_VIEW_W; dx++) {
        const x = conquestCamera.x + dx;
        const y = conquestCamera.y + dy;
        const cell = document.createElement("div");
        cell.className = "conquest-cell " + conquestTerrainClass(x, y);
        cell.title = `(${x}, ${y})`;
        cell.dataset.x = x;
        cell.dataset.y = y;
        const isCorner = (dx === 0 || dx === CONQUEST_VIEW_W - 1) && (dy === 0 || dy === CONQUEST_VIEW_H - 1);
        const occ = conquestTiles.get(x + "," + y);
        const isMe = conquestInfo.tile && conquestInfo.tile.x === x && conquestInfo.tile.y === y;
        if (isMe) cell.classList.add("me");
        if (occ) {
          cell.classList.add("occupied");
          if (occ.protectedUntil > now) cell.classList.add("protected");
          cell.innerHTML = `<span class="conquest-cell-icon">🏰</span><span class="conquest-cell-name"></span>`;
          cell.querySelector(".conquest-cell-name").textContent = occ.nickname;
        }
        // 네 모서리 칸에만 좌표를 표시해 화면 안에서도 대략 어디쯤인지 감을 잡게 한다
        // (칸마다 다 표시하면 너무 어지러워진다).
        if (isCorner) cell.insertAdjacentHTML("beforeend", `<span class="conquest-cell-coord">${x},${y}</span>`);
        field.appendChild(cell);
      }
    }
    renderConquestMissionPaths(field);
  }

  // 카메라 기준 타일 좌표 -> .worldmap-field 안에서의 픽셀 중심점(border 3px + padding
  // 10px + 칸 크기 72px + gap 3px, style.css .worldmap-field와 맞춰뒀다).
  function conquestTileCenterPx(worldX, worldY) {
    const cellStep = CONQUEST_TILE_PX + 3;
    const originOffset = 13;
    return {
      x: originOffset + (worldX - conquestCamera.x) * cellStep + CONQUEST_TILE_PX / 2,
      y: originOffset + (worldY - conquestCamera.y) * cellStep + CONQUEST_TILE_PX / 2,
    };
  }
  // 진행 중인 부대 이동 경로를 그리드 위에 선으로 겹쳐 그린다 — 내 부대뿐 아니라 뷰포트를
  // 지나는 다른 플레이어의 부대도 포함된다(conquestMissionPaths, 서버가 world_tiles를
  // 조인해 알려줌). 화면 밖으로 나가는 좌표는 부모 .worldmap-viewport의 overflow:hidden에
  // 의해 자연스럽게 잘린다.
  function renderConquestMissionPaths(field) {
    if (!conquestMissionPaths.length) return;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "mission-path-overlay");
    conquestMissionPaths.forEach((p) => {
      const a = conquestTileCenterPx(p.originX, p.originY);
      const b = conquestTileCenterPx(p.targetX, p.targetY);
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", a.x);
      line.setAttribute("y1", a.y);
      line.setAttribute("x2", b.x);
      line.setAttribute("y2", b.y);
      line.setAttribute("class", "mission-path-line " + (p.kind === "attack" ? "attack" : "reinforce"));
      svg.appendChild(line);
    });
    field.appendChild(svg);
  }

  // 미니맵: 지도 전체(0~mapWidth, 0~mapHeight)를 축소해 내 위치·다른 플레이어 성·
  // 현재 뷰포트 범위를 점/사각형으로 표시한다.
  function renderMinimap() {
    const wrap = document.getElementById("conquest-minimap");
    const frame = document.getElementById("conquest-minimap-frame");
    if (!conquestInfo || !conquestInfo.tile) { wrap.hidden = true; return; }
    wrap.hidden = false;
    const mapW = conquestInfo.mapWidth || CONQUEST_VIEW_W;
    const mapH = conquestInfo.mapHeight || CONQUEST_VIEW_H;
    const pct = (v, total) => `${Math.min(100, Math.max(0, (v / total) * 100))}%`;
    const dots = conquestAllTiles
      .filter((t) => !(conquestInfo.tile && t.x === conquestInfo.tile.x && t.y === conquestInfo.tile.y))
      .map((t) => `<div class="minimap-dot" style="left:${pct(t.x, mapW)};top:${pct(t.y, mapH)}"></div>`)
      .join("");
    const meDot = `<div class="minimap-me" style="left:${pct(conquestInfo.tile.x, mapW)};top:${pct(conquestInfo.tile.y, mapH)}"></div>`;
    const viewportRect = conquestCamera
      ? `<div class="minimap-viewport" style="left:${pct(conquestCamera.x, mapW)};top:${pct(conquestCamera.y, mapH)};width:${pct(CONQUEST_VIEW_W, mapW)};height:${pct(CONQUEST_VIEW_H, mapH)}"></div>`
      : "";
    frame.innerHTML = dots + meDot + viewportRect;
  }

  function renderConquestBody() {
    const statusEl = document.getElementById("conquest-status");
    const field = document.getElementById("worldmap-field");
    if (!conquestInfo) {
      statusEl.innerHTML = `<p class="conquest-msg">불러오는 중...</p>`;
      field.innerHTML = "";
      document.getElementById("conquest-tile-info").hidden = true;
      document.getElementById("conquest-minimap").hidden = true;
      document.getElementById("conquest-missions").innerHTML = "";
      return;
    }
    if (!conquestInfo.unlocked) {
      statusEl.innerHTML = `<p class="conquest-msg">🔒 정복은 성 레벨 5부터 참가할 수 있습니다 (현재 성 레벨 ${state.tiles.castle.level} / 5)</p>`;
      field.innerHTML = "";
      document.getElementById("conquest-tile-info").hidden = true;
      document.getElementById("conquest-minimap").hidden = true;
      document.getElementById("conquest-missions").innerHTML = "";
      return;
    }
    if (!conquestInfo.tile) {
      statusEl.innerHTML = `
        <p class="conquest-msg">정복 맵에 참가하면 거대한 지도의 무작위 위치에 성이 배정되고, 30분간 다른 플레이어의 공격으로부터 보호받습니다.</p>
        <button id="btn-conquest-spawn">⚔️ 정복 참가하기</button>
      `;
      document.getElementById("btn-conquest-spawn").addEventListener("click", doConquestSpawn);
      field.innerHTML = "";
      document.getElementById("conquest-tile-info").hidden = true;
      document.getElementById("conquest-minimap").hidden = true;
      document.getElementById("conquest-missions").innerHTML = "";
      return;
    }
    const protectedLeft = conquestInfo.tile.protectedUntil - Date.now();
    const cx = conquestCamera ? conquestCamera.x + Math.floor(CONQUEST_VIEW_W / 2) : conquestInfo.tile.x;
    const cy = conquestCamera ? conquestCamera.y + Math.floor(CONQUEST_VIEW_H / 2) : conquestInfo.tile.y;
    statusEl.innerHTML = `<p class="conquest-msg">내 성 (${conquestInfo.tile.x}, ${conquestInfo.tile.y})${protectedLeft > 0 ? ` · 🛡️ 보호 중 (${formatCountdownShort(protectedLeft)} 남음)` : ""} · 📍 지금 보는 곳 (${cx}, ${cy}) — 드래그해서 지도를 둘러보세요</p>`;
    renderConquestGrid();
    renderMinimap();
  }

  function renderWorldMap() {
    const screenEl = document.getElementById("screen-worldmap");
    if (!screenEl || screenEl.hidden || !currentPlayer) return;
    const now = Date.now();
    if (!conquestLoading && now - lastConquestFetchAt > CONQUEST_FETCH_INTERVAL_MS) {
      lastConquestFetchAt = now;
      refreshConquestInfo();
    } else {
      renderConquestBody();
    }
  }

  // window에 move/up 리스너를 다는 방식 — 뷰포트 요소 경계를 벗어나 빠르게 드래그해도
  // (또는 setPointerCapture의 pointerleave 처리가 브라우저마다 미묘하게 달라도) 안정적으로 따라온다.
  (function setupConquestDrag() {
    const viewport = document.getElementById("worldmap-viewport");
    const field = document.getElementById("worldmap-field");
    let startPX = 0, startPY = 0, startCam = null;
    function onMove(e) {
      const scale = Math.min(viewport.clientWidth / field.offsetWidth, viewport.clientHeight / field.offsetHeight) || 1;
      const dxTiles = -Math.round((e.clientX - startPX) / scale / CONQUEST_TILE_PX);
      const dyTiles = -Math.round((e.clientY - startPY) / scale / CONQUEST_TILE_PX);
      const next = clampConquestCamera(startCam.x + dxTiles, startCam.y + dyTiles);
      if (next.x !== conquestCamera.x || next.y !== conquestCamera.y) {
        conquestCamera = next;
        lastConquestFetchAt = 0;
        renderConquestBody();
      }
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    viewport.addEventListener("pointerdown", (e) => {
      if (!conquestCamera) return;
      startPX = e.clientX; startPY = e.clientY; startCam = { x: conquestCamera.x, y: conquestCamera.y };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  })();

  // 타일을 클릭하면 내 위치에서 그 타일까지 예상 이동 시간(거리 기반, 이동속도 시스템)을
  // 보여준다 — 아직 공격 시스템은 없지만 이동속도 계산 자체는 이렇게 미리 확인 가능하다.
  function freeSquadOptionsHTML() {
    const pvpBusy = new Set(conquestMissions.filter((m) => m.isMine && m.phase !== "resolved").map((m) => m.squadIndex));
    return state.armies.map((a, idx) => {
      const busy = !!a.mission || pvpBusy.has(idx);
      return `<option value="${idx}" ${busy ? "disabled" : ""}>부대 ${idx + 1}${busy ? " (출정 중)" : ""}</option>`;
    }).join("");
  }
  function troopCompInputsHTML() {
    return TROOP_TYPES.map((t) => `
      <label class="ctf-troop-row">
        <span>${t.name} (보유 ${(state.troopsByType[t.key] || 0).toLocaleString()})</span>
        <input type="number" min="0" max="${state.troopsByType[t.key] || 0}" value="0" data-troop="${t.key}" />
      </label>
    `).join("");
  }
  function readCompFromForm(infoEl) {
    const comp = {};
    infoEl.querySelectorAll("[data-troop]").forEach((input) => {
      const n = Math.max(0, Math.floor(Number(input.value) || 0));
      if (n > 0) comp[input.dataset.troop] = n;
    });
    return comp;
  }
  async function submitConquestDispatch(kind, targetPlayerId, infoEl) {
    // 공격은 되돌릴 수 없고 내 보호막도 함께 사라지므로, 지금 보호 중일 때만 2단계로
    // 확인을 받는다(보호막이 없으면 다른 출정과 동일하게 바로 진행). 실제 해제는
    // 서버(pvp.js dispatch())가 최종 권위로 처리하지만, 사용자가 그 결과를 미리 알고
    // 동의하게 하는 게 목적이다.
    if (kind === "attack" && conquestInfo.tile && conquestInfo.tile.protectedUntil > Date.now()) {
      if (!confirm("⚠️ 공격을 보내면 나를 지켜주던 보호막이 즉시 사라집니다. 계속하시겠습니까?")) return;
      if (!confirm("정말로 공격을 보내시겠습니까? 이 작업은 되돌릴 수 없습니다.")) return;
    }
    const squadIndex = Number(infoEl.querySelector(".ctf-squad-select").value);
    const comp = readCompFromForm(infoEl);
    try {
      const res = await apiRequest(`/api/conquest/${kind}`, {
        method: "POST",
        body: JSON.stringify({ targetPlayerId, squadIndex, comp }),
      });
      toast(`${kind === "attack" ? "⚔️" : "🛡️"} 부대 ${squadIndex + 1} 출발! 도착까지 ${formatCountdownShort(res.travelSeconds * 1000)}${res.shieldCleared ? " · 🛡️ 내 보호막이 해제되었습니다" : ""}`);
      if (res.shieldCleared && conquestInfo.tile) conquestInfo.tile.protectedUntil = 0;
      lastMissionSnapshot = ""; // 다음 폴링에서 무조건 최신 상태를 반영하도록
      infoEl.hidden = true;
      renderConquestBody();
    } catch (e) {
      toast(e.message || "출정에 실패했습니다.");
    }
  }
  function dispatchFormHTML(kind, targetPlayerId) {
    const label = kind === "attack" ? "⚔️ 공격 부대 편성" : "🛡️ 지원군 편성";
    return `
      <div class="ctf-dispatch">
        <div class="ctf-line">${label} <button type="button" class="ctf-automax btn-small" title="보유 병력을 전부 채웁니다">🤖 최대</button></div>
        <select class="ctf-squad-select">${freeSquadOptionsHTML()}</select>
        ${troopCompInputsHTML()}
        ${kind === "attack" ? `<div class="ctf-line">🚚 예상 수송력(약탈 자원 상한): <span class="ctf-capacity-num">0</span></div>` : ""}
        <button class="ctf-submit" data-kind="${kind}" data-target="${targetPlayerId}">${kind === "attack" ? "공격 출정" : "지원 출정"}</button>
      </div>
    `;
  }
  // 정복 출정 폼의 병사 입력은 매번 0에서 시작한다(군대 편성의 lastComp와 달리 PvP는
  // 예약 개념이 없어 미리 채워둘 값이 없음) — "🤖 최대" 버튼으로 보유 병력 전량을
  // 한 번에 채울 수 있게 해, 병종마다 일일이 숫자를 입력하지 않아도 되게 한다.
  function attachDispatchAutoMax(infoEl) {
    const btn = infoEl.querySelector(".ctf-automax");
    if (!btn) return;
    btn.addEventListener("click", () => {
      infoEl.querySelectorAll("[data-troop]").forEach((input) => {
        input.value = input.max;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });
  }
  // 공격 부대 편성 폼에서 병사 수/부대를 바꿀 때마다 예상 수송력을 즉시 갱신한다.
  function attachDispatchCapacityPreview(infoEl) {
    const capacityEl = infoEl.querySelector(".ctf-capacity-num");
    if (!capacityEl) return;
    const update = () => {
      const squadIdx = Number(infoEl.querySelector(".ctf-squad-select").value);
      const army = state.armies[squadIdx];
      const comp = readCompFromForm(infoEl);
      capacityEl.textContent = armyCarryCapacity(army ? army.heroIds : [], comp).toLocaleString();
    };
    infoEl.querySelector(".ctf-squad-select").addEventListener("change", update);
    infoEl.querySelectorAll("[data-troop]").forEach((input) => input.addEventListener("input", update));
    update();
  }
  async function showConquestTileInfo(x, y, occ) {
    const infoEl = document.getElementById("conquest-tile-info");
    infoEl.hidden = false;
    const isMe = conquestInfo.tile && conquestInfo.tile.x === x && conquestInfo.tile.y === y;
    const header = `<div class="ctf-title">📍 (${x}, ${y})${occ ? ` · ${occ.nickname}` : ""}</div>`;
    infoEl.innerHTML = `${header}<div class="ctf-line">이동 시간 계산 중...</div>`;
    let travelHTML = "";
    try {
      const res = await apiRequest(`/api/conquest/travel-time?x=${x}&y=${y}`);
      travelHTML = `
        <div class="ctf-line">거리 ${res.distance}칸</div>
        <div class="ctf-line">최저 속도 기준(편도): ${formatCountdownShort(res.baseSeconds * 1000)}</div>
        <div class="ctf-line">내 영웅 이동 보너스 적용 시: ${formatCountdownShort(res.bestSeconds * 1000)}${res.bestHeroBonus ? ` (+${res.bestHeroBonus.toFixed(1)}%)` : ""}</div>
      `;
    } catch (e) {
      travelHTML = `<div class="ctf-line">${e.message || "이동 시간을 불러오지 못했습니다."}</div>`;
    }
    let actionsHTML = "";
    if (occ && !isMe) {
      const protectedNow = occ.protectedUntil > Date.now();
      if (protectedNow) {
        actionsHTML = `<div class="ctf-line">🛡️ 보호 중인 플레이어입니다 (공격 불가, 지원은 가능)</div>
          <div class="ctf-actions"><button class="ctf-open-reinforce">🛡️ 지원 보내기</button></div>`;
      } else {
        actionsHTML = `<div class="ctf-actions">
          <button class="ctf-open-attack">⚔️ 공격</button>
          <button class="ctf-open-reinforce">🛡️ 지원 보내기</button>
        </div>`;
      }
    }
    infoEl.innerHTML = `${header}${travelHTML}${actionsHTML}`;
    const openAttack = infoEl.querySelector(".ctf-open-attack");
    const openReinforce = infoEl.querySelector(".ctf-open-reinforce");
    if (openAttack) openAttack.addEventListener("click", () => {
      infoEl.innerHTML = `${header}${travelHTML}${actionsHTML}${dispatchFormHTML("attack", occ.playerId)}`;
      infoEl.querySelector(".ctf-submit").addEventListener("click", () => submitConquestDispatch("attack", occ.playerId, infoEl));
      attachDispatchAutoMax(infoEl);
      attachDispatchCapacityPreview(infoEl);
    });
    if (openReinforce) openReinforce.addEventListener("click", () => {
      infoEl.innerHTML = `${header}${travelHTML}${actionsHTML}${dispatchFormHTML("reinforce", occ.playerId)}`;
      infoEl.querySelector(".ctf-submit").addEventListener("click", () => submitConquestDispatch("reinforce", occ.playerId, infoEl));
      attachDispatchAutoMax(infoEl);
    });
  }
  document.getElementById("worldmap-field").addEventListener("click", (e) => {
    const cell = e.target.closest(".conquest-cell");
    if (!cell || !conquestInfo || !conquestInfo.tile) return;
    const x = Number(cell.dataset.x), y = Number(cell.dataset.y);
    const occ = cell.classList.contains("occupied") ? conquestTiles.get(x + "," + y) : null;
    showConquestTileInfo(x, y, occ);
  });
  // 미니맵 클릭 → 그 좌표가 뷰포트 중앙에 오도록 카메라를 즉시 이동한다(먼 곳으로 이동할
  // 때 드래그로 여러 번 끌 필요 없이 한 번에 갈 수 있게). frame은 렌더마다 innerHTML만
  // 바뀌고 엘리먼트 자체는 그대로라 리스너를 한 번만 붙이면 된다.
  document.getElementById("conquest-minimap-frame").addEventListener("click", (e) => {
    if (!conquestInfo || !conquestInfo.tile) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fracX = (e.clientX - rect.left) / rect.width;
    const fracY = (e.clientY - rect.top) / rect.height;
    const mapW = conquestInfo.mapWidth || CONQUEST_VIEW_W;
    const mapH = conquestInfo.mapHeight || CONQUEST_VIEW_H;
    conquestCamera = clampConquestCamera(
      fracX * mapW - Math.floor(CONQUEST_VIEW_W / 2),
      fracY * mapH - Math.floor(CONQUEST_VIEW_H / 2)
    );
    lastConquestFetchAt = 0;
    loadConquestViewportTiles().then(renderConquestBody);
  });
  // ---------- 화면 꽉 채우기(스케일-투-핏) ----------
  // 도시맵/월드맵은 내부 요소를 고정 px로 설계하고(뷰포트 단위 사용 안 함), 여기서
  // transform:scale()로 통째로 늘리거나 줄여 뷰포트 안에 스크롤 없이 꽉 차게 맞춘다.
  // 컨테이너만 커지는 게 아니라 아이콘/배경/텍스트가 전부 같은 비율로 커지는 이유.
  function fitStageToViewport(stageEl, viewportEl) {
    if (!stageEl || !viewportEl || stageEl.hidden || viewportEl.hidden) return;
    stageEl.style.transform = "none";
    const naturalW = stageEl.offsetWidth;
    const naturalH = stageEl.offsetHeight;
    if (!naturalW || !naturalH) return;
    const availW = viewportEl.clientWidth;
    const availH = viewportEl.clientHeight;
    if (!availW || !availH) return;
    const scale = Math.min(availW / naturalW, availH / naturalH);
    stageEl.style.transform = `scale(${scale})`;
  }
  function fitActiveScreen() {
    fitStageToViewport(document.getElementById("kingdom-stage"), document.getElementById("city-viewport"));
    fitStageToViewport(document.getElementById("worldmap-field"), document.getElementById("worldmap-viewport"));
  }
  let fitRaf = null;
  function scheduleFitActiveScreen() {
    if (fitRaf) cancelAnimationFrame(fitRaf);
    fitRaf = requestAnimationFrame(fitActiveScreen);
  }
  window.addEventListener("resize", scheduleFitActiveScreen);
  // 모바일 브라우저의 주소창 표시/숨김 애니메이션 중에는 window의 resize 이벤트보다
  // visualViewport의 resize가 더 안정적으로 발생하는 경우가 있어 방어적으로 함께 건다
  // (100dvh CSS 수정이 주된 해결책이고, 이건 남는 엣지 케이스를 위한 보조 장치).
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", scheduleFitActiveScreen);
  }

  function showScreen(name) {
    document.getElementById("city-viewport").hidden = name !== "city";
    document.getElementById("kingdom-label").hidden = name !== "city";
    document.getElementById("screen-worldmap").hidden = name !== "worldmap";
    if (name === "worldmap") renderWorldMap();
    fitActiveScreen();
  }
  document.getElementById("btn-worldmap").addEventListener("click", () => showScreen("worldmap"));
  document.getElementById("btn-back-city").addEventListener("click", () => showScreen("city"));

  // ---------- 게임 시작/종료(타이틀 화면) ----------
  let tickHandle = null;
  function startGame() {
    document.getElementById("screen-title").hidden = true;
    applyOfflineProgress();
    renderTopbar();
    renderBoard();
    renderMonsterArea();
    renderWorldMap();
    renderWallFrame();
    showScreen("city");
    if (!tickHandle) tickHandle = setInterval(tick, 1000);
  }
  document.getElementById("btn-start-game").addEventListener("click", startGame);

  // ---------- 메인 튜토리얼(타이틀 화면) — 주요 콘텐츠를 한 번씩 훑어보는 캐러셀 ----------
  // 정복 해금 시 뜨는 modal-conquest-tutorial과 달리, 게임을 시작하기 전에 원할 때
  // 언제든 다시 볼 수 있는 개요용이라 localStorage로 "한 번만" 제한하지 않는다.
  const MAIN_TUTORIAL_STEPS = [
    { visual: "🌱 → 🏠 → 🏛️", title: "도시 건설", desc: "빈 부지를 눌러 건물을 짓고 레벨업하세요. 성(🏛️)이 도시의 중심이며, 레벨이 오를수록 더 많은 것을 할 수 있게 됩니다." },
    { visual: "🌾 🪵 🪨 🪙", title: "자원 생산과 유지비", desc: "농장·벌목장·채석장·성이 자원을 생산합니다. 병사를 보유하면 매초 식량을 소모하니(유지비), 감당할 수 있는 만큼만 훈련하세요." },
    { visual: "⚔️ 병영 → 🪖🪖🪖", title: "병영과 부대", desc: "병영에서 병사를 훈련하고, 상단의 '군대' 메뉴에서 부대를 편성하세요. 부대는 필드 몬스터 사냥·보스 레이드·정복 원정에 모두 쓰입니다." },
    { visual: "🍺 여관 → 🦸 영웅", title: "영웅", desc: "여관에 일정 시간마다 영웅 후보가 등장합니다. 영웅을 건물이나 부대에 배치하면 생산·전투·이동에 보너스를 받습니다." },
    { visual: "🗺️ 왕국 주변 → 🐍", title: "필드 몬스터 사냥", desc: "왕국을 둘러싼 야생 지역에 몬스터가 등장합니다. 부대를 보내 처치하면 자원을 얻을 수 있습니다." },
    { visual: "👑 강력한 보스", title: "보스 레이드", desc: "조건을 만족하면 강력한 보스에게 도전할 수 있습니다. 큰 보상과 영웅 강화에 쓰이는 파편을 얻습니다." },
    { visual: "🏰 성 Lv.5 → 🗺️", title: "정복 맵", desc: "성 레벨 5부터 정복 맵에 참가할 수 있습니다. 거대한 지도의 무작위 위치에 성이 배정되고, 처음 30분은 보호받습니다." },
    { visual: "⚔️ 공격 → 🛡️ 해제", title: "공격과 수성", desc: "다른 플레이어를 공격하면 내 보호막이 즉시 사라집니다. 신중히 결정하세요. 방어탑·성벽을 미리 준비해두면 공격받을 때 유리합니다." },
    { visual: "🎒 🛡️ · 🌀", title: "인벤토리와 아이템", desc: "인벤토리에서 보호막이나 성 이동 아이템을 얻고 사용할 수 있습니다. 정복 맵에서 전략적으로 활용하세요." },
  ];
  let tutorialStepIndex = 0;
  function renderTutorialStep() {
    const step = MAIN_TUTORIAL_STEPS[tutorialStepIndex];
    document.getElementById("tutorial-step-body").innerHTML = `
      <div class="tutorial-step tutorial-step-solo">
        <div class="tutorial-visual">${step.visual}</div>
        <h3>${step.title}</h3>
        <p>${step.desc}</p>
      </div>
    `;
    document.getElementById("tutorial-progress").textContent = `${tutorialStepIndex + 1} / ${MAIN_TUTORIAL_STEPS.length}`;
    document.getElementById("tutorial-prev").disabled = tutorialStepIndex === 0;
    document.getElementById("tutorial-next").textContent = tutorialStepIndex === MAIN_TUTORIAL_STEPS.length - 1 ? "완료 ✓" : "다음 ▶";
  }
  document.getElementById("btn-tutorial").addEventListener("click", () => {
    tutorialStepIndex = 0;
    renderTutorialStep();
    openModal("modal-tutorial");
  });
  document.getElementById("tutorial-prev").addEventListener("click", () => {
    if (tutorialStepIndex > 0) { tutorialStepIndex--; renderTutorialStep(); }
  });
  document.getElementById("tutorial-next").addEventListener("click", () => {
    if (tutorialStepIndex < MAIN_TUTORIAL_STEPS.length - 1) { tutorialStepIndex++; renderTutorialStep(); }
    else closeModal("modal-tutorial");
  });
  // 탭이 백그라운드에 있는 동안 브라우저가 타이머를 강하게 절전(throttle)시킬 수 있어
  // 다시 활성화될 때 경과 시간만큼 한 번 더 따라잡는다(게임이 이미 시작된 뒤에만)
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && tickHandle) applyOfflineProgress();
  });
  document.getElementById("btn-end-game").addEventListener("click", () => {
    save();
    if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
    document.getElementById("screen-outro").hidden = false;
    try { window.close(); } catch (e) {}
  });

  // ---------- 로그인 화면 ----------
  function showLoginError(message) {
    const el = document.getElementById("login-error");
    el.textContent = message || "";
    el.hidden = !message;
  }
  async function handleAuthSubmit(kind) {
    const nickname = document.getElementById("login-nickname").value.trim();
    const password = document.getElementById("login-password").value;
    showLoginError(null);
    document.getElementById("login-hint").textContent = "처리 중...";
    try {
      const data = await apiRequest(kind === "register" ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ nickname, password }),
      });
      await afterLogin(data);
      document.getElementById("login-hint").textContent = "";
      document.getElementById("screen-login").hidden = true;
      document.getElementById("screen-title").hidden = false;
    } catch (e) {
      document.getElementById("login-hint").textContent = "";
      showLoginError(e instanceof TypeError ? "서버에 연결할 수 없습니다. 백엔드가 실행 중인지 확인하세요." : (e.message || "요청에 실패했습니다."));
    }
  }
  document.getElementById("login-form").addEventListener("submit", (e) => { e.preventDefault(); handleAuthSubmit("login"); });
  document.getElementById("btn-register-submit").addEventListener("click", () => handleAuthSubmit("register"));
  document.getElementById("btn-logout").addEventListener("click", logout);

  // 이미 로그인 토큰이 있으면 조용히 검증 + 서버 진행 상황을 불러오고 바로 타이틀
  // 화면으로 넘어간다(매번 재로그인할 필요 없게). 실패하면(토큰 만료 등) 로그인 화면을 보여준다.
  (async function bootAuth() {
    if (authToken) {
      try {
        const me = await apiRequest("/api/auth/me");
        currentPlayer = me.player;
        const remote = await apiRequest("/api/state");
        if (remote.state) {
          const migrated = migrateState(remote.state);
          if (migrated) state = migrated;
        }
        renderAccountBadge();
        document.getElementById("screen-login").hidden = true;
        document.getElementById("screen-title").hidden = false;
        return;
      } catch (e) {
        authToken = null;
        localStorage.removeItem(AUTH_TOKEN_KEY);
      }
    }
    document.getElementById("screen-login").hidden = false;
    document.getElementById("screen-title").hidden = true;
  })();
})();
