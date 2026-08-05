// 올림포스 도시 — 싱글플레이 SNG 프로토타입
(function () {
  "use strict";

  // ---------- 건물 종류 정의 ----------
  const BUILDING_TYPES = {
    "성": { icon: "🏰", base: { gold: 0.35 }, buildCostGold: null, upgradeCost: { wood: 60, stone: 60 }, fixedOnly: true, desc: "도시의 중심. 전체 건물 슬롯을 해금하고 금화를 생산한다." },
    "병영": { icon: "⚔️", base: {}, buildCostGold: 60, upgradeCost: { wood: 80, food: 40 }, selectable: true, desc: "병사를 훈련한다. 레벨이 오르면 더 강한 병종이 해금된다." },
    "농장": { icon: "🌾", base: { food: 1.2 }, buildCostGold: 40, upgradeCost: { wood: 50 }, selectable: true, desc: "식량을 생산한다." },
    "벌목장": { icon: "🪵", base: { wood: 1.2 }, buildCostGold: 40, upgradeCost: { food: 50 }, selectable: true, desc: "목재를 생산한다." },
    "채석장": { icon: "⛏️", base: { stone: 0.9 }, buildCostGold: 70, upgradeCost: { wood: 60, food: 40 }, selectable: true, desc: "석재를 생산한다." },
    "자원보호소": { icon: "📦", base: { capBonus: 0.05 }, buildCostGold: 70, upgradeCost: { wood: 60, stone: 40 }, fixedOnly: true, noHeroBonus: true, desc: "자원 저장 상한을 늘린다. 영웅 배치 대상이 아니다." },
    "아카데미": { icon: "📜", base: {}, buildCostGold: 90, upgradeCost: { wood: 80, stone: 80 }, unlocksAscend: true, fixedOnly: true, desc: "연구를 통해 생산·전투·영웅 획득에 영구적인 배율 효과를 얻는다." },
    "방어탑": { icon: "🛡️", base: { defense: 4 }, buildCostGold: 90, upgradeCost: { stone: 100 }, fixedOnly: true, noHeroBonus: true, desc: "영웅 배치 대상이 아니다. 대신 레벨마다 %만큼 내가 출정 보내는 모든 부대의 방어력을 강화한다." },
    "감시탑": { icon: "🔭", base: {}, buildCostGold: 70, upgradeCost: { stone: 60, wood: 40 }, fixedOnly: true, noHeroBonus: true, desc: "야생 지역 몬스터의 정보(레벨→상세 스탯)를 공개한다. 영웅 배치 대상이 아니다." },
    "여관": { icon: "🍺", base: { gold: 0.6 }, buildCostGold: 100, upgradeCost: { wood: 50, food: 50 }, isTavern: true, fixedOnly: true, desc: "일정 시간마다 영웅 후보가 등장한다. 금화로 즉시 초기화할 수 있다." },
    "성벽": { icon: "🧱", base: { defense: 15 }, buildCostGold: 120, upgradeCost: { wood: 100, stone: 100 }, fixedOnly: true, desc: "도시의 상징적인 수비력을 나타낸다." },
  };
  const SELECTABLE_TYPES = Object.keys(BUILDING_TYPES).filter((t) => BUILDING_TYPES[t].selectable);

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

  // ---------- 왕도풍 타일 배치 (10열 그리드, 20타일 + 성벽) ----------
  const TILE_LAYOUT = [
    { id: "defense", type: "방어탑", col: 4, row: 1 },
    { id: "watch", type: "감시탑", col: 7, row: 1 },
    { id: "plot1", type: null, col: 3, row: 2 },
    { id: "academy", type: "아카데미", col: 4, row: 2 },
    { id: "castle", type: "성", col: 5, row: 2, span: 2 },
    { id: "storage", type: "자원보호소", col: 7, row: 2 },
    { id: "plot2", type: null, col: 8, row: 2 },
    { id: "plot3", type: null, col: 4, row: 3 },
    { id: "tavern", type: "여관", col: 5, row: 3, span: 2 },
    { id: "plot4", type: null, col: 7, row: 3 },
    { id: "plot5", type: null, col: 1, row: 4 },
    { id: "plot6", type: null, col: 2, row: 4 },
    { id: "plot7", type: null, col: 3, row: 4 },
    { id: "plot8", type: null, col: 4, row: 4 },
    { id: "plot9", type: null, col: 5, row: 4 },
    { id: "plot10", type: null, col: 6, row: 4 },
    { id: "plot11", type: null, col: 7, row: 4 },
    { id: "plot12", type: null, col: 8, row: 4 },
    { id: "plot13", type: null, col: 9, row: 4 },
    { id: "plot14", type: null, col: 10, row: 4 },
  ];

  // ---------- 병영 병사 종류 (그리스 신화 테마, 훈련 대기열) ----------
  const TROOP_TYPES = [
    { key: "militia", name: "민병대", unlockLevel: 1, cost: { food: 5 }, trainSeconds: 3, atk: 2, def: 1.5, hp: 6 },
    { key: "hoplite", name: "호플리테스", unlockLevel: 5, cost: { food: 8, wood: 4 }, trainSeconds: 6, atk: 4, def: 3.5, hp: 11 },
    { key: "spartan", name: "스파르타 전사", unlockLevel: 10, cost: { food: 12, stone: 6 }, trainSeconds: 10, atk: 7, def: 6, hp: 19 },
    { key: "myrmidon", name: "미르미돈 전사", unlockLevel: 15, cost: { food: 18, gold: 10 }, trainSeconds: 16, atk: 12, def: 9, hp: 29 },
    { key: "ares_champion", name: "아레스의 대전사", unlockLevel: 20, cost: { food: 25, gold: 20, stone: 10 }, trainSeconds: 24, atk: 20, def: 15, hp: 46 },
  ];
  const TROOP_TYPES_BY_KEY = Object.fromEntries(TROOP_TYPES.map((t) => [t.key, t]));

  // ---------- 여관 레벨별 슬롯 수 ----------
  function tavernSlotsForLevel(level) {
    if (level >= 16) return 8;
    if (level >= 11) return 7;
    if (level >= 6) return 6;
    return 5;
  }

  // ---------- 아카데미 연구 트리 ----------
  const RESEARCH_DEFS = [
    { id: "combat1", cat: "combat", name: "청동 무기", reqAcademy: 2, reqBuilding: { type: "병영", level: 3 }, cost: { wood: 150, food: 150, gold: 100 }, effect: { defensePercent: 10, troopPercent: 10 } },
    { id: "combat2", cat: "combat", name: "철제 갑주", reqAcademy: 6, reqBuilding: { type: "방어탑", level: 5 }, cost: { wood: 400, stone: 400, gold: 300 }, effect: { defensePercent: 20 } },
    { id: "combat3", cat: "combat", name: "영웅의 전술", reqAcademy: 12, reqBuilding: { type: "병영", level: 10 }, cost: { wood: 900, stone: 900, food: 900, gold: 800 }, effect: { troopPercent: 25 } },
    { id: "econ1", cat: "econ", name: "관개 기술", reqAcademy: 2, reqBuilding: { type: "농장", level: 3 }, cost: { wood: 150, food: 150, gold: 100 }, effect: { productionPercent: 10 } },
    { id: "econ2", cat: "econ", name: "무역로 확장", reqAcademy: 6, reqBuilding: { type: "자원보호소", level: 5 }, cost: { wood: 400, stone: 400, gold: 300 }, effect: { goldPercent: 15 } },
    { id: "econ3", cat: "econ", name: "황금시대", reqAcademy: 12, reqBuilding: { type: "성", level: 10 }, cost: { wood: 900, stone: 900, food: 900, gold: 800 }, effect: { productionPercent: 20, goldPercent: 20 } },
    { id: "hero1", cat: "hero", name: "신탁의 속삭임", reqAcademy: 2, reqBuilding: { type: "여관", level: 3 }, cost: { wood: 150, food: 150, gold: 100 }, effect: { recruitCostPercent: -10 } },
    { id: "hero2", cat: "hero", name: "축복받은 만남", reqAcademy: 6, reqBuilding: { type: "여관", level: 6 }, cost: { wood: 400, stone: 400, gold: 300 }, effect: { rarityBoost: 1 } },
    { id: "hero3", cat: "hero", name: "올림포스의 부름", reqAcademy: 12, reqBuilding: { type: "여관", level: 10 }, cost: { wood: 900, stone: 900, food: 900, gold: 800 }, effect: { rarityBoost: 2, resetCostPercent: -10 } },
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
  const ELITE_TYPES = [
    { key: "medusa", name: "메두사", icon: "🗿" },
    { key: "hydra", name: "히드라", icon: "🐉" },
    { key: "cerberus", name: "케르베로스", icon: "🐺" },
  ];
  const MONSTER_SLOT_COUNT = 6;
  const ELITE_CHANCE = 0.08;

  function rollMonsterLevel() {
    return 1 + Math.floor(Math.pow(Math.random(), 1.5) * 30);
  }
  function monsterStats(level, elite) {
    const m = elite ? 3 : 1;
    return {
      hp: Math.round(55 * Math.pow(1.22, level - 1) * m),
      atk: Math.round(8 * Math.pow(1.2, level - 1) * m),
      def: Math.round(5 * Math.pow(1.18, level - 1) * m),
    };
  }
  function monsterReward(level, elite) {
    const base = 20 * Math.pow(1.25, level - 1);
    const amount = Math.round(base * (elite ? 3.5 : 1));
    const types = ["food", "wood", "stone", "gold"];
    const type = types[Math.floor(Math.random() * types.length)];
    const reward = {};
    reward[type] = amount;
    if (elite) reward.gold = (reward.gold || 0) + Math.round(amount * 0.6);
    return reward;
  }
  function spawnMonster(slot) {
    const elite = Math.random() < ELITE_CHANCE;
    const pool = elite ? ELITE_TYPES : MONSTER_TYPES;
    const type = pool[Math.floor(Math.random() * pool.length)];
    const level = rollMonsterLevel();
    const stats = monsterStats(level, elite);
    slot.monster = { key: type.key, name: type.name, icon: type.icon, elite, level, ...stats };
    slot.respawnTimer = 0;
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
  function castleStats(level) {
    return {
      hp: Math.round(300 * Math.pow(1.35, level - 1)),
      atk: Math.round(25 * Math.pow(1.32, level - 1)),
      def: Math.round(18 * Math.pow(1.3, level - 1)),
    };
  }
  function castleBankRate(level) { return 2 * Math.pow(1.25, level - 1); }
  function castleBankCap(level) { return Math.round(300 * Math.pow(1.3, level - 1)); }
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

  // 방어탑/자원보호소는 영웅 배치 대상이 아니므로, 해당 건물을 노리던 영웅은 전투 특성으로 전환한다.
  HEROES.forEach((h) => {
    if (h.traitType === "building" && (h.traitEffect.building === "방어탑" || h.traitEffect.building === "자원보호소")) {
      h.traitType = "combat";
      h.traitEffect = { statKey: h.id % 2 === 0 ? "atk" : "def", percent: h.traitEffect.percent };
    }
  });

  const RES_LABEL = { food: "🌾", wood: "🪵", stone: "🪨", gold: "🪙" };
  const RARITY_EMOJI = { 1: "🧑", 2: "🧝", 3: "🗡️", 4: "🧙", 5: "👑", 6: "⚡", 7: "🦉", 8: "🌟" };
  const KAMI = HEROES.find((h) => h.secret) || null;
  const HERO_BY_ID = Object.fromEntries(HEROES.map((h) => [h.id, h]));
  const BASE_CAP = 10000000; // 1000만
  const TAVERN_CYCLE = 300; // 5분
  const MAX_LEVEL = 20; // 건물 레벨 상한
  const LEVEL_COST_GROWTH = 1.3;
  const MAX_ENHANCE = 5; // 영웅 강화 상한(0~5강)
  const SQUAD_COUNT = 3;
  const MIN_DEPLOY = 5;
  const SAVE_KEY = "olympusSngSave_v5";

  const ROLL_TABLE = [
    { rarity: "kami", p: 0.05 },
    { rarity: 1, p: 28 },
    { rarity: 2, p: 24 },
    { rarity: 3, p: 18 },
    { rarity: 4, p: 12 },
    { rarity: 5, p: 9 },
    { rarity: 6, p: 5 },
    { rarity: 7, p: 2.7 },
    { rarity: 8, p: 1.25 },
  ];

  function freshState() {
    const tiles = {};
    TILE_LAYOUT.forEach((t) => {
      tiles[t.id] = { type: t.type, built: t.id === "castle", level: t.id === "castle" ? 1 : 0, heroId: null, training: null };
    });
    tiles.wall = { type: "성벽", built: false, level: 0, heroId: null };
    return {
      res: { food: 80, wood: 80, stone: 60, gold: 150 },
      tiles,
      troopsByType: Object.fromEntries(TROOP_TYPES.map((t) => [t.key, 0])),
      owned: {}, // heroId -> {enhance, shards, count}
      research: {},
      tavern: { timer: TAVERN_CYCLE, candidates: new Array(tavernSlotsForLevel(1)).fill(null) },
      armies: Array.from({ length: SQUAD_COUNT }, () => ({ heroIds: [null, null, null], mission: null, lastComp: {} })),
      monsters: freshMonsterSlots(),
      worldCastles: freshWorldCastles(),
    };
  }

  let state = load() || freshState();
  if (!state.tavern.candidates.some((c) => c !== null)) rerollTavern();

  // ---------- 저장 ----------
  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) {}
  }
  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed.tiles || !parsed.tavern) return null;
      if (!parsed.research) parsed.research = {};
      if (!parsed.tiles.wall) parsed.tiles.wall = { type: "성벽", built: false, level: 0, heroId: null };
      if (!parsed.troopsByType) parsed.troopsByType = Object.fromEntries(TROOP_TYPES.map((t) => [t.key, 0]));
      if (!parsed.armies) parsed.armies = Array.from({ length: SQUAD_COUNT }, () => ({ heroIds: [null, null, null], mission: null, lastComp: {} }));
      parsed.armies.forEach((a) => { if (!a.lastComp) a.lastComp = {}; });
      if (!parsed.monsters) parsed.monsters = freshMonsterSlots();
      if (!parsed.worldCastles) parsed.worldCastles = freshWorldCastles();
      Object.values(parsed.owned || {}).forEach((o) => {
        if (typeof o.enhance !== "number") { o.enhance = 0; delete o.star; }
      });
      return parsed;
    } catch (e) { return null; }
  }

  // ---------- 유틸 ----------
  function toast(msg) {
    const layer = document.getElementById("toast-layer");
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    layer.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }
  function pulseRes(res) {
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
  function heroTraitPercent(hero) {
    const enh = heroEnhance(hero.id);
    return hero.traitEffect.percent * (1 + 0.15 * enh);
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
    if (tile.heroId) {
      const hero = HERO_BY_ID[tile.heroId];
      if (hero && hero.traitType === "building" && hero.traitEffect.building === tile.type) {
        total += heroTraitPercent(hero);
      }
    }
    return total;
  }
  function maxLevelOfType(type) {
    return Object.values(state.tiles).reduce((m, t) => (t.type === type && t.built ? Math.max(m, t.level) : m), 0);
  }
  function researchPercent(kind) {
    return RESEARCH_DEFS.filter((d) => state.research[d.id]).reduce((sum, d) => sum + (d.effect[kind] || 0), 0);
  }
  function capFor(res) {
    const storage = state.tiles.storage;
    let cap = BASE_CAP;
    if (storage.built) {
      cap += BASE_CAP * BUILDING_TYPES["자원보호소"].base.capBonus * storage.level * (1 + bonusPercentFor("storage") / 100);
    }
    return Math.round(cap);
  }
  // 방어탑: 내가 출정 보내는 부대의 방어력을 강화하는 %(영웅 보너스 없음, 레벨+연구만 반영)
  function expeditionBonusPercent() {
    const tower = state.tiles.defense;
    if (!tower.built) return 0;
    const researchMult = 1 + researchPercent("defensePercent") / 100;
    return Math.round(tower.level * BUILDING_TYPES["방어탑"].base.defense * researchMult * 10) / 10;
  }
  // 성벽: 도시의 상징적인 수비력 표시(전투에 직접 관여하지 않음)
  function wallScore() {
    const wall = state.tiles.wall;
    if (!wall.built) return 0;
    return Math.round(wall.level * BUILDING_TYPES["성벽"].base.defense * (1 + bonusPercentFor("wall") / 100));
  }
  function upgradeCostFor(type, level) {
    const bdef = BUILDING_TYPES[type];
    if (!bdef.upgradeCost) return null;
    const factor = Math.pow(LEVEL_COST_GROWTH, level - 1);
    const cost = {};
    Object.entries(bdef.upgradeCost).forEach(([r, v]) => { cost[r] = Math.round(v * factor); });
    return cost;
  }
  // 레벨업 선행조건: 성이 항상 상한선 + 건물별 기본 연관 건물 레벨
  function levelUpMissing(tileId) {
    const tile = state.tiles[tileId];
    const target = tile.level + 1;
    const missing = [];
    if (tile.type !== "성" && state.tiles.castle.level < target) missing.push(`성 Lv.${target}`);
    (LEVEL_REQUIREMENTS[tile.type] || []).forEach((r) => {
      const need = target + r.offset;
      if (need > 1 && maxLevelOfType(r.type) < need) missing.push(`${r.type} Lv.${need}`);
    });
    return missing;
  }
  // 레벨업 조건을 체크리스트 형태(충족/미충족)로 반환 — 항상 표시되는 시각화용
  function levelUpRequirementRows(tileId) {
    const tile = state.tiles[tileId];
    const target = tile.level + 1;
    const rows = [];
    if (tile.type !== "성") {
      const cur = state.tiles.castle.level;
      rows.push({ label: "성", cur, need: target, ok: cur >= target });
    }
    (LEVEL_REQUIREMENTS[tile.type] || []).forEach((r) => {
      const need = target + r.offset;
      if (need > 1) {
        const cur = maxLevelOfType(r.type);
        rows.push({ label: r.type, cur, need, ok: cur >= need });
      }
    });
    return rows;
  }
  function renderReqChecklistHTML(tileId) {
    const tile = state.tiles[tileId];
    if (tile.level >= MAX_LEVEL) return "";
    const rows = levelUpRequirementRows(tileId);
    return `
      <div class="req-list">
        <div class="req-title">🔒 다음 레벨(Lv.${tile.level + 1}) 조건</div>
        ${rows.length
          ? rows.map((r) => `<div class="req-row ${r.ok ? "ok" : "blocked"}">${r.ok ? "✅" : "❌"} ${r.label} Lv.${r.cur}/${r.need}</div>`).join("")
          : `<div class="req-row ok">✅ 조건 없음</div>`}
      </div>
    `;
  }

  // ---------- 자원/훈련/전투 틱 ----------
  function tick() {
    state.tavern.timer -= 1;
    let tavernRerolled = false;
    if (state.tavern.timer <= 0) {
      rerollTavern();
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
          tile.training = null;
        }
      }
    });
    state.monsters.forEach((slot) => {
      if (!slot.monster) {
        slot.respawnTimer -= 1;
        if (slot.respawnTimer <= 0) spawnMonster(slot);
      }
    });
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
    renderTopbar();
    renderBoard();
    renderMonsterArea();
    renderWorldMap();
    renderWallFrame();
    if (!document.getElementById("modal-tavern").hidden) {
      renderTavernModal();
      if (tavernRerolled) renderTavernCards();
    }
    save();
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
    const take = Math.min(t1.p - 5, boost * 4);
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
  function tavernSlotCount() {
    return tavernSlotsForLevel(state.tiles.tavern.level || 1);
  }
  function rerollTavern() {
    const n = tavernSlotCount();
    state.tavern.candidates = new Array(n).fill(null).map(() => rollHeroId());
    state.tavern.timer = TAVERN_CYCLE;
  }
  function tavernResetCost() {
    const elapsed = TAVERN_CYCLE - state.tavern.timer;
    const elapsedMin = Math.floor(elapsed / 60);
    let cost = 50 * Math.max(1, 5 - elapsedMin);
    cost *= 1 + researchPercent("resetCostPercent") / 100;
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
  function recruit(slotIndex) {
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
    closeModal("modal-building");
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
    closeModal("modal-building");
    renderBoard();
    renderTopbar();
    save();
  }
  function upgrade(tileId) {
    const tile = state.tiles[tileId];
    if (tile.level >= MAX_LEVEL) { toast(`이미 최대 레벨(${MAX_LEVEL})입니다`); return; }
    const missing = levelUpMissing(tileId);
    if (missing.length) { toast(`레벨업 조건 부족: ${missing.join(", ")}`); return; }
    const cost = upgradeCostFor(tile.type, tile.level);
    if (!cost) return;
    if (!canAfford(cost)) { toast("자원이 부족합니다"); return; }
    pay(cost);
    tile.level += 1;
    if (tile.type === "여관") {
      const need = tavernSlotsForLevel(tile.level) - state.tavern.candidates.length;
      for (let i = 0; i < need; i++) state.tavern.candidates.push(rollHeroId());
    }
    toast(`⬆️ ${tile.type} 레벨 ${tile.level}!`);
    if (tile.type === "여관") { renderTavernModal(); renderTavernCards(); }
    else openBuildingModal(tileId);
    renderBoard();
    renderTopbar();
    renderWallFrame();
    save();
  }
  function assignHero(tileId, heroId) {
    state.armies.forEach((a) => { a.heroIds = a.heroIds.map((h) => (h === heroId ? null : h)); });
    Object.values(state.tiles).forEach((t) => { if (t.heroId === heroId) t.heroId = null; });
    state.tiles[tileId].heroId = heroId;
    toast(`${HERO_BY_ID[heroId].name} 배치 완료`);
    openBuildingModal(tileId);
    renderBoard();
    save();
  }
  function unassignHero(tileId) {
    state.tiles[tileId].heroId = null;
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
    tile.training = { type: typeKey, count, timeLeft: type.trainSeconds * count, total: type.trainSeconds * count };
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
      if (hero.traitType === "combat") bonus[hero.traitEffect.statKey] += heroTraitPercent(hero);
    });
    const researchTroop = 1 + researchPercent("troopPercent") / 100;
    troopAtk *= (1 + bonus.atk / 100) * researchTroop;
    troopDef *= (1 + bonus.def / 100) * researchTroop;
    troopHp *= (1 + bonus.hp / 100) * researchTroop;
    const expedition = 1 + expeditionBonusPercent() / 100;
    return { atk: heroAtk + troopAtk, def: (heroDef + troopDef) * expedition, hp: heroHp + troopHp };
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
    const marchTime = kind === "castle" ? 8 + enemy.level : 5 + Math.round(enemy.level / 3) + (enemy.elite ? 5 : 0);
    army.mission = { kind, targetId, comp, phase: "march", timeLeft: marchTime, marchTime };
    toast(`🪖 부대 ${squadIdx + 1} 출정! → ${enemy.name}(Lv.${enemy.level})`);
    closeModal("modal-monster");
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
    if (verdict.win) {
      let reward;
      if (mission.kind === "castle") {
        reward = {};
        Object.entries(enemy.bank).forEach(([r, v]) => { if (Math.round(v) > 0) reward[r] = Math.round(v); });
        enemy.bank = { food: 0, wood: 0, stone: 0, gold: 0 };
      } else {
        reward = monsterReward(enemy.level, enemy.elite);
      }
      Object.entries(reward).forEach(([r, v]) => addRes(r, v));
      toast(`⚔️ 부대 ${squadIdx + 1}: ${enemy.name}(Lv.${enemy.level}) 처치!${totalLost > 0 ? ` 병사 ${totalLost}명 손실.` : ""} 보상: ${costText(reward)}`);
      if (mission.kind === "monster") {
        const slot = state.monsters.find((s) => s.id === mission.targetId);
        if (slot) { slot.monster = null; slot.respawnTimer = 8 + Math.floor(Math.random() * 8); }
      }
    } else {
      toast(`💀 부대 ${squadIdx + 1}: ${enemy.name}(Lv.${enemy.level})에게 패배했습니다. 병사 ${totalLost}명 손실, 전과 없음.`);
    }
    army.mission = null;
    renderMonsterArea();
    renderWorldMap();
    save();
  }

  // ---------- 연구(아카데미) ----------
  function canResearch(def) {
    if (state.research[def.id]) return false;
    if (state.tiles.academy.level < def.reqAcademy) return false;
    if (def.reqBuilding && maxLevelOfType(def.reqBuilding.type) < def.reqBuilding.level) return false;
    return true;
  }
  function doResearch(defId) {
    const def = RESEARCH_DEFS.find((d) => d.id === defId);
    if (!def) return;
    if (state.research[def.id]) { toast("이미 연구했습니다"); return; }
    if (!canResearch(def)) { toast("해금 조건을 만족하지 않습니다"); return; }
    if (!canAfford(def.cost)) { toast("자원이 부족합니다"); return; }
    pay(def.cost);
    state.research[def.id] = true;
    toast(`📜 연구 완료: ${def.name}`);
    openBuildingModal("academy");
    renderBoard();
    save();
  }
  function describeEffect(effect) {
    const parts = [];
    if (effect.productionPercent) parts.push(`자원 생산 +${effect.productionPercent}%`);
    if (effect.goldPercent) parts.push(`금화 생산 +${effect.goldPercent}%`);
    if (effect.troopPercent) parts.push(`병사 전투력 +${effect.troopPercent}%`);
    if (effect.defensePercent) parts.push(`수비력 +${effect.defensePercent}%`);
    if (effect.recruitCostPercent) parts.push(`영입 비용 ${effect.recruitCostPercent}%`);
    if (effect.resetCostPercent) parts.push(`초기화 비용 ${effect.resetCostPercent}%`);
    if (effect.rarityBoost) parts.push(`고등급 영웅 등장률 상승`);
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
            const done = !!state.research[d.id];
            const unlockable = canResearch(d);
            return `
            <div class="research-item ${done ? "done" : ""}">
              <div class="ri-name">${d.name} ${done ? "✅" : ""}</div>
              <div class="ri-req">조건: 아카데미 Lv.${d.reqAcademy}${d.reqBuilding ? ` · ${d.reqBuilding.type} Lv.${d.reqBuilding.level}` : ""}</div>
              <div class="ri-effect">${describeEffect(d.effect)}</div>
              ${!done ? `<div class="ri-cost">필요: ${costText(d.cost)}</div><button class="do-research" data-id="${d.id}" ${unlockable ? "" : "disabled"}>연구하기</button>` : ""}
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
    document.getElementById("defense-score").textContent = "+" + expeditionBonusPercent() + "%";
    const totalTroops = Object.values(state.troopsByType).reduce((s, v) => s + v, 0);
    document.getElementById("troop-count").textContent = totalTroops;
    ["food", "wood", "stone", "gold"].forEach((r) => {
      const el = document.getElementById(`rate-${r}`);
      if (el) el.textContent = "+" + productionRatePerSecond(r).toFixed(1) + "/s";
    });
  }
  // 자원 종류별 초당 총 생산량(건물 레벨·영웅 보너스·연구 배율 반영) — renderTopbar와 renderBoard에서 공용으로 사용
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
    return total;
  }

  function renderWallFrame() {
    const frame = document.getElementById("wall-frame");
    const badge = document.getElementById("wall-badge");
    if (!frame || !badge) return;
    const wall = state.tiles.wall;
    frame.className = "wall-frame" + (wall.built ? "" : " unbuilt");
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
        plot.innerHTML = `<div class="icon">➕</div><div class="name">부지</div><div class="level">건설 가능</div>`;
        plot.addEventListener("click", () => openPlotChooserModal(def.id));
        board.appendChild(plot);
        return;
      }

      const hero = tile.heroId ? HERO_BY_ID[tile.heroId] : null;
      let rateLine = "";
      let isTraining = false;
      if (tile.built) {
        const parts = [productionLineForLevel(def.id, tile.level)];
        if (tile.type === "병영") {
          if (tile.training) {
            const t = TROOP_TYPES_BY_KEY[tile.training.type];
            parts.push(`훈련: ${t.name} ${tile.training.count}명 (${tile.training.timeLeft}s)`);
            isTraining = true;
          } else {
            parts.push("훈련 대기 중");
          }
        }
        if (tile.type === "감시탑") {
          parts.push(tile.level >= 5 ? "몬스터 정보 전체 공개" : "몬스터 레벨만 공개");
        }
        rateLine = parts.filter(Boolean).join(" ");
      }

      plot.className = "plot" + (tile.built ? "" : " unbuilt") + (def.id === "castle" ? " tile-castle" : "") + (isTraining ? " training" : "") + (tile.built && !isTraining && Object.keys(bdef.base).length ? " working" : "");
      plot.innerHTML = `
        <div class="icon">${bdef.icon}</div>
        <div class="name">${tile.type}</div>
        <div class="level">${tile.built ? "Lv." + tile.level + "/" + MAX_LEVEL : "미건설"}</div>
        ${rateLine ? `<div class="rate">${rateLine}</div>` : ""}
        ${!tile.built ? `<div class="build-cost">🪙${bdef.buildCostGold}</div>` : ""}
        ${hero && tile.type !== "감시탑" ? `<div class="hero-chip star-badge r${hero.rarity}">★${hero.rarity}</div>` : ""}
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
    const body = document.getElementById("building-modal-body");
    body.innerHTML = `
      <h2>➕ 어떤 건물을 지을까요?</h2>
      <div class="type-choice-list">
        ${SELECTABLE_TYPES.map(
          (type) => `
          <div class="type-choice" data-type="${type}">
            <span class="icon">${BUILDING_TYPES[type].icon}</span>
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
    const tile = state.tiles[tileId];
    const bdef = BUILDING_TYPES[tile.type];
    const body = document.getElementById("building-modal-body");
    body.innerHTML = `
      <h2>${bdef.icon} ${tile.type} 건설</h2>
      <p>필요 자원: 🪙 ${bdef.buildCostGold}</p>
      <button id="do-build">건설하기</button>
    `;
    body.querySelector("#do-build").addEventListener("click", () => build(tileId));
    openModal("modal-building");
  }

  function renderTroopTrainingHTML(tileId) {
    const tile = state.tiles[tileId];
    if (tile.training) {
      const t = TROOP_TYPES_BY_KEY[tile.training.type];
      const pct = Math.round(100 * (1 - tile.training.timeLeft / tile.training.total));
      return `<div class="training-status">🪖 ${t.name} ${tile.training.count}명 훈련 중 — ${tile.training.timeLeft}s 남음 (${pct}%)</div>`;
    }
    return `
      <div class="troop-types">
        ${TROOP_TYPES.map((t) => {
          const locked = t.unlockLevel > tile.level;
          return `
          <div class="troop-type-row ${locked ? "locked" : ""}">
            <span class="tt-name">${t.name}${locked ? ` (Lv.${t.unlockLevel} 필요)` : ""}</span>
            <span class="tt-cost">${costText(t.cost)}/명 · ${t.trainSeconds}s/명</span>
            ${!locked ? `<input type="number" min="1" value="5" class="tt-count" data-key="${t.key}" />
            <button class="do-train" data-key="${t.key}">훈련</button>` : ""}
          </div>`;
        }).join("")}
      </div>
    `;
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
      parts.push(`🛡️ 원정 강화 +${Math.round(level * bdef.base.defense * researchMult * 10) / 10}%`);
    }
    if (tile.type === "성벽") parts.push(`🛡️ 수비력 ${Math.round(level * bdef.base.defense * mult)}`);
    if (bdef.isTavern) parts.push(`슬롯 ${tavernSlotsForLevel(level)}`);
    return parts.join(" · ");
  }
  function openBuildingModal(tileId) {
    const tile = state.tiles[tileId];
    const bdef = BUILDING_TYPES[tile.type];
    const hero = tile.heroId ? HERO_BY_ID[tile.heroId] : null;
    const body = document.getElementById("building-modal-body");
    const ownedList = Object.keys(state.owned)
      .map((id) => HERO_BY_ID[id])
      .filter(Boolean)
      .sort((a, c) => c.rarity - a.rarity || heroEnhance(c.id) - heroEnhance(a.id));
    const upCost = upgradeCostFor(tile.type, tile.level);
    const missing = levelUpMissing(tileId);
    const allowsHero = !bdef.noHeroBonus;

    const infoCol = `
      <div class="modal-section">
        <h2>${bdef.icon} ${tile.type} <small>Lv.${tile.level}/${MAX_LEVEL}</small></h2>
        <p class="building-desc">${bdef.desc || ""}</p>
        ${tile.level < MAX_LEVEL ? `
          <div class="compare-line">
            <div class="compare-cur"><span class="compare-label">현재</span> ${productionLineForLevel(tileId, tile.level) || "특별한 생산 효과 없음"}</div>
            <div class="compare-arrow">⬇️</div>
            <div class="compare-next"><span class="compare-label">Lv.${tile.level + 1}</span> ${productionLineForLevel(tileId, tile.level + 1) || "특별한 생산 효과 없음"}</div>
          </div>` : `<div class="compare-line"><div class="compare-cur">${productionLineForLevel(tileId, tile.level) || "특별한 생산 효과 없음"}</div></div>`}
        ${upCost
          ? tile.level < MAX_LEVEL
            ? `${renderReqChecklistHTML(tileId)}<button id="do-upgrade" ${missing.length ? "disabled" : ""}>레벨업 (${costText(upCost)})</button>`
            : `<p><small>최대 레벨입니다</small></p>`
          : ""}
      </div>
    `;
    const eligibleList = ownedList.filter((h) => h.traitType === "building" && h.traitEffect.building === tile.type);
    const heroCol = allowsHero ? `
      <div class="modal-section">
        <h3>영웅 배치</h3>
        <p>현재 배치: ${hero ? `${hero.name} (★${hero.rarity}${heroEnhance(hero.id) > 0 ? ` +${heroEnhance(hero.id)}강` : ""})` : "없음"}</p>
        ${hero ? `<button id="do-unassign">배치 해제</button>` : ""}
        <div class="hero-slot-list">
          ${eligibleList.length ? "" : `<p><small>${ownedList.length ? `${tile.type}에 특화된 영웅이 아직 없습니다.` : "아직 보유한 영웅이 없습니다."} 여관에서 뽑아보세요.</small></p>`}
          ${eligibleList
            .map((h) => `
            <div class="hero-row" data-hero="${h.id}">
              ${heroBadgeHTML(h.id)}
              <span>${h.name}</span>
              <span class="hr-note">+${heroTraitPercent(h).toFixed(1)}%</span>
            </div>`)
            .join("")}
        </div>
      </div>` : "";
    const extraCol = tile.type === "감시탑"
      ? `<div class="modal-section"><h3>감시 정보</h3><p>감시탑 레벨 L → 몬스터 레벨 (2×L+1) 이하까지 야생 지역에서 상세 정보(레벨·스탯)를 볼 수 있습니다. 그보다 높은 레벨의 몬스터는 Lv.?로 표시됩니다.</p></div>`
      : tile.type === "병영" ? `<div class="modal-section"><h3>병사 훈련</h3>${renderTroopTrainingHTML(tileId)}</div>`
      : tile.type === "아카데미" ? `<div class="modal-section">${renderResearchHTML()}</div>`
      : "";
    body.innerHTML = `<div class="modal-cols modal-cols-3">${infoCol}${heroCol}${extraCol}</div>`;
    if (hero) { const b = body.querySelector("#do-unassign"); if (b) b.addEventListener("click", () => unassignHero(tileId)); }
    const upBtn = body.querySelector("#do-upgrade");
    if (upBtn && !upBtn.disabled) upBtn.addEventListener("click", () => upgrade(tileId));
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

    const meta = document.getElementById("tavern-meta-extra");
    const upCost = upgradeCostFor("여관", tile.level);
    const missing = levelUpMissing("tavern");
    if (meta) {
      meta.innerHTML = `
        <span>여관 Lv.${tile.level}/${MAX_LEVEL} · 슬롯 ${tavernSlotsForLevel(tile.level)}명</span>
        ${tile.level < MAX_LEVEL
          ? `${renderReqChecklistHTML("tavern")}<button id="btn-tavern-upgrade" ${missing.length ? "disabled" : ""}>⬆️ 레벨업 (${costText(upCost)})</button>`
          : "<span> (최대 레벨)</span>"}
      `;
      const upBtn = meta.querySelector("#btn-tavern-upgrade");
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
        const traitLine = hero.traitType === "combat"
          ? `⚔️ ${hero.traitEffect.statKey === "atk" ? "공격력" : hero.traitEffect.statKey === "def" ? "방어력" : "체력"} +${hero.traitEffect.percent}%`
          : `🏛️ ${hero.traitEffect.building} +${hero.traitEffect.percent}%`;
        cell.className = `hero-card card-fresh hc-r${hero.rarity}` + (isKami ? " kami" : "");
        cell.innerHTML = `
          <span class="star-badge r${hero.rarity}">★${hero.rarity}</span>
          <div class="portrait">${isKami ? "🐱" : RARITY_EMOJI[hero.rarity] || "🧑"}</div>
          <div class="hname">${hero.name}</div>
          <div class="hdomain">${hero.domain}</div>
          <div class="hstats">⚔️${hero.atk} 🛡️${hero.def} ❤️${hero.hp}</div>
          <div class="htrait">${isKami ? "🐱 모든 것을 압도하는 조커 카드" : traitLine}</div>
          ${already ? `<div class="owned-tag">보유중 ✓ (중복 영입 시 조각)</div>` : ""}
          <div class="recruit-cost">🪙 ${recruitCost(hero)}</div>
          <button class="do-recruit">영입</button>
        `;
        cell.querySelector(".do-recruit").addEventListener("click", () => recruit(idx));
      }
      grid.appendChild(cell);
    });
  }
  function openTavernModal() {
    renderTavernModal();
    renderTavernCards();
    openModal("modal-tavern");
  }
  document.getElementById("btn-tavern-reset").addEventListener("click", () => {
    const cost = tavernResetCost();
    if (state.res.gold < cost) { toast("🪙 금화가 부족합니다"); return; }
    state.res.gold -= cost;
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
  function renderMonsterArea() {
    const grid = document.getElementById("monster-grid");
    if (!grid) return;
    grid.innerHTML = "";
    state.monsters.forEach((slot) => {
      const card = document.createElement("div");
      const attackingIdx = squadAttackingSlot(slot.id);
      card.className = "monster-card" + (slot.monster && slot.monster.elite ? " elite" : "");
      if (attackingIdx >= 0) {
        const mission = state.armies[attackingIdx].mission;
        const phaseLabel = mission.phase === "march" ? "진군 중" : "전투 중";
        card.innerHTML = `
          <div class="icon">${slot.monster.icon}</div>
          <div class="mname">${slot.monster.name}${slot.monster.elite ? " 👑" : ""}</div>
          <div class="mlevel">Lv.${slot.monster.level}</div>
          <div class="mstatus ${mission.phase}">부대${attackingIdx + 1} ${phaseLabel}… ${mission.timeLeft}s</div>
        `;
      } else if (slot.monster) {
        const m = slot.monster;
        const revealed = monsterInfoRevealed(m.level);
        card.innerHTML = `
          <div class="icon">${m.icon}</div>
          <div class="mname">${m.name}${m.elite ? " 👑" : ""}</div>
          <div class="mlevel">${revealed ? `Lv.${m.level}` : "Lv.?"}</div>
          <div class="mstats">${revealed ? `⚔️${m.atk} 🛡️${m.def} ❤️${m.hp}` : `감시탑 Lv.${requiredWatchLevelFor(m.level)}+ 필요`}</div>
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
      grid.appendChild(card);
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
    const revealed = kind === "castle" ? true : monsterInfoRevealed(enemy.level);
    const duration = battleDurationFor(enemy.level, !!enemy.elite);
    body.innerHTML = `
      <div class="modal-cols">
        <div class="col narrow">
          <h2>${enemy.icon} ${enemy.name} ${enemy.elite ? "👑 엘리트" : ""}</h2>
          <p>레벨 ${revealed ? enemy.level : "?"}</p>
          <p>${revealed ? `⚔️ 공격력 ${enemy.atk} · 🛡️ 방어력 ${enemy.def} · ❤️ 체력 ${enemy.hp}` : `감시탑 Lv.${requiredWatchLevelFor(enemy.level)}+ 필요 (야생 몬스터만 해당)`}</p>
          ${kind === "castle" ? `<p>승리 시 이 성이 그동안 모은 자원을 전부 획득합니다: ${costText(enemy.bank && Object.fromEntries(Object.entries(enemy.bank).filter(([, v]) => v >= 1).map(([k, v]) => [k, Math.round(v)])))}</p>` : ""}
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
    wrap.innerHTML = TROOP_TYPES.map((t) => {
      const avail = state.troopsByType[t.key] || 0;
      const startVal = Math.min(avail, lastComp[t.key] || 0);
      return `
      <div class="engage-comp-row">
        <span class="ec-name">${t.name}</span>
        <span class="ec-avail">보유 ${avail}</span>
        <input type="range" class="ec-input" data-key="${t.key}" min="0" max="${avail}" value="${startVal}" ${avail === 0 ? "disabled" : ""} />
        <span class="ec-value" data-key-val="${t.key}">${startVal}</span>
      </div>`;
    }).join("");
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

  // ---------- 군대 편성(다중 부대) ----------
  function openArmyModal() {
    let activeSquad = 0;
    const body = document.getElementById("army-modal-body");
    function render() {
      const ownedList = Object.keys(state.owned).map((id) => HERO_BY_ID[id]).filter(Boolean).sort((a, c) => c.rarity - a.rarity || heroEnhance(c.id) - heroEnhance(a.id));
      const army = state.armies[activeSquad];
      let selectedSlot = army.heroIds.findIndex((h) => !h);
      const totalTroops = Object.entries(state.troopsByType).map(([k, v]) => `${TROOP_TYPES_BY_KEY[k].name} ${v}`).join(" · ");
      body.innerHTML = `
        <h2>⚔️ 군대 편성 (부대 ${SQUAD_COUNT}개, 각 영웅 최대 3명)</h2>
        <p>보유 병사: ${totalTroops}</p>
        <div class="squad-tabs">
          ${state.armies.map((a, i) => `<button class="squad-tab ${i === activeSquad ? "active" : ""} ${a.mission ? "busy" : ""}" data-idx="${i}">부대 ${i + 1}${a.mission ? " 🪖" : ""}</button>`).join("")}
        </div>
        <div class="modal-cols">
          <div class="col narrow">
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
                const inAnySquad = state.armies.some((a) => a.heroIds.includes(h.id));
                return `<div class="hero-row" data-hero="${h.id}">
                  ${heroBadgeHTML(h.id)}
                  <span>${h.name}</span>
                  <span class="hr-note">${h.traitType === "combat" ? `⚔️ +${heroTraitPercent(h).toFixed(1)}% ${h.traitEffect.statKey}` : `🏛️ ${h.traitEffect.building} 특화`}</span>
                  ${inAnySquad ? '<span class="hr-note">편성됨</span>' : ""}
                </div>`;
              }).join("")}
            </div>
          </div>
        </div>
      `;
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
          army.heroIds[idx] = heroId;
          save();
          render();
        });
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
      cell.className = "codex-cell" + (owned ? "" : " locked");
      cell.innerHTML = `
        <div class="portrait">${owned ? (hero.secret ? "🐱" : RARITY_EMOJI[hero.rarity] || "🧑") : "❔"}</div>
        <div>${owned ? hero.name : "???"}</div>
        <span class="star-badge r${hero.rarity}" style="font-size:.6rem;">★${hero.rarity}</span>
      `;
      cell.addEventListener("click", () => renderCodexDetail(hero.id));
      grid.appendChild(cell);
    });
    const ownedCount = Object.keys(state.owned).length;
    document.getElementById("codex-progress").textContent = `(${ownedCount} / ${HEROES.length} 수집)`;
  }
  // 영웅 상세 패널 HTML(도감/보유 영웅 모달 공용)
  function heroDetailHTML(heroId) {
    const hero = HERO_BY_ID[heroId];
    const owned = state.owned[heroId];
    if (!owned) return `<p>아직 만나지 못한 영웅입니다. 여관에서 뽑아보세요.</p>`;
    const needed = owned.enhance < MAX_ENHANCE ? 3 * (owned.enhance + 1) : null;
    const traitDesc = hero.traitType === "combat"
      ? `⚔️ 영웅 특성 — 부대 ${hero.traitEffect.statKey === "atk" ? "공격력" : hero.traitEffect.statKey === "def" ? "방어력" : "체력"} +${heroTraitPercent(hero).toFixed(1)}%`
      : `🏛️ 영웅 특성 — ${hero.traitEffect.building} 생산/효과 +${heroTraitPercent(hero).toFixed(1)}%`;
    return `
      <h3>${hero.secret ? "🐱" : RARITY_EMOJI[hero.rarity]} ${hero.name} ${heroBadgeHTML(hero.id)}</h3>
      <p>${hero.domain} · ${hero.culture}</p>
      <p><em>${hero.flavor}</em></p>
      <p>${traitDesc}</p>
      <p>공격 ${hero.atk} · 방어 ${hero.def} · 체력 ${hero.hp}</p>
      <p>누적 영입 ${owned.count}회 · 조각: ${owned.shards}${needed !== null ? ` / 강화 필요 ${needed}` : " (최고 강화 +" + MAX_ENHANCE + "강)"}</p>
      ${needed !== null ? `<button class="do-enhance" data-hero="${heroId}">강화하기 (+1강)</button>` : ""}
    `;
  }
  function renderCodexDetail(heroId) {
    const panel = document.getElementById("codex-detail");
    panel.innerHTML = heroDetailHTML(heroId);
    const btn = panel.querySelector(".do-enhance");
    if (btn) btn.addEventListener("click", () => { enhance(heroId); renderCodexDetail(heroId); renderCodexGrid(); });
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
      cell.className = "codex-cell";
      cell.innerHTML = `
        <div class="portrait">${hero.secret ? "🐱" : RARITY_EMOJI[hero.rarity] || "🧑"}</div>
        <div>${hero.name}</div>
        <span class="star-badge r${hero.rarity}" style="font-size:.6rem;">★${hero.rarity}</span>
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
            <span class="icon">${def.icon}</span>
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
  document.getElementById("wall-frame").addEventListener("click", (e) => {
    if (e.target.closest("#board")) return;
    const wall = state.tiles.wall;
    if (!wall.built) openBuildModal("wall");
    else openBuildingModal("wall");
  });

  // ---------- 월드맵: 레벨1~20 성을 경로 형태로 배치 ----------
  function castlePosition(level) {
    const idx = level - 1;
    const row = Math.floor(idx / 5);
    let col = idx % 5;
    if (row % 2 === 1) col = 4 - col;
    return { left: 8 + col * 21, top: 20 + row * 20 };
  }
  function renderWorldMap() {
    const field = document.getElementById("worldmap-field");
    if (!field) return;
    field.innerHTML = "";
    const my = document.createElement("div");
    my.className = "wm-castle wm-mine";
    my.style.left = "6%";
    my.style.top = "6%";
    my.innerHTML = `<div class="icon">🏰</div><div class="wm-name">내 도시</div>`;
    field.appendChild(my);
    state.worldCastles.forEach((c) => {
      const pos = castlePosition(c.level);
      const attackingIdx = state.armies.findIndex((a) => a.mission && a.mission.kind === "castle" && a.mission.targetId === c.id);
      const node = document.createElement("div");
      node.className = "wm-castle";
      node.style.left = pos.left + "%";
      node.style.top = pos.top + "%";
      const bankTotal = Math.round(Object.values(c.bank).reduce((s, v) => s + v, 0));
      node.innerHTML = `
        <div class="icon">${c.icon}</div>
        <div class="wm-name">Lv.${c.level} ${c.name}</div>
        <div class="wm-bank">💰 ${bankTotal}</div>
        ${attackingIdx >= 0
          ? `<div class="wm-status">부대${attackingIdx + 1} ${state.armies[attackingIdx].mission.phase === "march" ? "진군 중" : "전투 중"}</div>`
          : `<button class="do-attack-castle">공격</button>`}
      `;
      if (attackingIdx < 0) node.querySelector(".do-attack-castle").addEventListener("click", () => openEngageModal("castle", c.id));
      field.appendChild(node);
    });
    state.armies.forEach((army) => {
      if (!army.mission || army.mission.kind !== "castle" || army.mission.phase !== "march") return;
      const target = state.worldCastles.find((c) => c.id === army.mission.targetId);
      if (!target) return;
      const pos = castlePosition(target.level);
      const progress = 1 - army.mission.timeLeft / army.mission.marchTime;
      const marcher = document.createElement("div");
      marcher.className = "wm-marcher";
      marcher.style.left = (6 + (pos.left - 6) * progress) + "%";
      marcher.style.top = (6 + (pos.top - 6) * progress) + "%";
      marcher.textContent = "🪖";
      field.appendChild(marcher);
    });
  }
  function showScreen(name) {
    document.getElementById("kingdom-stage").hidden = name !== "city";
    document.getElementById("kingdom-label").hidden = name !== "city";
    document.getElementById("screen-worldmap").hidden = name !== "worldmap";
    if (name === "worldmap") renderWorldMap();
  }
  document.getElementById("btn-worldmap").addEventListener("click", () => showScreen("worldmap"));
  document.getElementById("btn-back-city").addEventListener("click", () => showScreen("city"));

  // ---------- 게임 시작/종료(타이틀 화면) ----------
  let tickHandle = null;
  function startGame() {
    document.getElementById("screen-title").hidden = true;
    showScreen("city");
    renderTopbar();
    renderBoard();
    renderMonsterArea();
    renderWorldMap();
    renderWallFrame();
    if (!tickHandle) tickHandle = setInterval(tick, 1000);
  }
  document.getElementById("btn-start-game").addEventListener("click", startGame);
  document.getElementById("btn-end-game").addEventListener("click", () => {
    save();
    if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
    document.getElementById("screen-outro").hidden = false;
    try { window.close(); } catch (e) {}
  });
})();
