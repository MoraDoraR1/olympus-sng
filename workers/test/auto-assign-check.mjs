// Phase D 검증: 영웅 자동 배치(건물) + 군대 자동 편성(부대) 실제 UI 동작 확인.
import { chromium } from "playwright";

const API = "http://127.0.0.1:8790";
const SITE = "http://127.0.0.1:8791";

function fullTiles(overrides) {
  const empty = { type: null, built: false, level: 0, heroIds: [], training: null, upgrading: null };
  const base = {
    plot11: { ...empty }, defense: { type: "방어탑", built: false, level: 0, heroIds: [], training: null, upgrading: null },
    watch: { type: "감시탑", built: false, level: 0, heroIds: [], training: null, upgrading: null }, plot12: { ...empty },
    plot1: { type: "벌목장", built: true, level: 5, heroIds: [], training: null, upgrading: null },
    academy: { type: "아카데미", built: false, level: 0, heroIds: [], training: null, upgrading: null },
    castle: { type: "성", built: true, level: 5, heroIds: [], training: null, upgrading: null },
    storage: { type: "자원보호소", built: false, level: 0, heroIds: [], training: null, upgrading: null },
    plot2: { type: "농장", built: true, level: 5, heroIds: [], training: null, upgrading: null },
    plot13: { ...empty }, plot3: { ...empty },
    tavern: { type: "여관", built: false, level: 0, heroIds: [], training: null, upgrading: null },
    plot4: { ...empty }, plot14: { ...empty }, plot5: { ...empty }, plot6: { ...empty }, plot7: { ...empty },
    plot8: { ...empty }, plot9: { ...empty }, plot10: { ...empty },
    wall: { type: "성벽", built: false, level: 0, heroIds: [] },
  };
  return Object.assign(base, overrides);
}

async function main() {
  const rand = Math.floor(Math.random() * 1e6);
  const reg = await fetch(`${API}/api/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname: `autoassign${rand}`, password: "pass1234" }),
  }).then((r) => r.json());
  const token = reg.token;

  const state = {
    res: { food: 80, wood: 80, stone: 60, gold: 150 },
    tiles: fullTiles({}),
    troopsByType: { militia: 10, transport: 0, hoplite: 0, spartan: 0, myrmidon: 0, wagon: 0, ares_champion: 0 },
    owned: {
      2: { enhance: 0, shards: 0, count: 1 },  // 밀로스타 - 벌목장 특성
      5: { enhance: 0, shards: 0, count: 1 },  // 솔벤투스 - 농장 특성
      1: { enhance: 0, shards: 0, count: 1 },  // 브란텔로스 - 전투 특성만
      4: { enhance: 0, shards: 0, count: 1 },  // 가라니우스 - 전투 특성만
      7: { enhance: 0, shards: 0, count: 1 },  // 파브레니스 - 전투 특성만
    },
    research: {}, tavern: { timer: 600, candidates: [null, null, null, null, null], resetCost: 30 },
    armies: [{ heroIds: [null, null, null], mission: null, lastComp: {} }, { heroIds: [null, null, null], mission: null, lastComp: {} }, { heroIds: [null, null, null], mission: null, lastComp: {} }],
    monsters: [], worldCastles: [], raids: {}, raidShards: 0, raidTickets: { t5: 0, t6: 0 }, lastActiveAt: Date.now(),
  };
  await fetch(`${API}/api/state`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ state }) }).then((r) => r.json());

  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (err) => console.error("pageerror:", err.message));
  page.on("dialog", (d) => d.accept());

  await page.goto(`${SITE}/index.html`, { waitUntil: "networkidle" });
  await page.evaluate((tok) => localStorage.setItem("olympusSngAuthToken", tok), token);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#screen-title:not([hidden])", { timeout: 10000 });
  await page.click("#btn-start-game");
  await page.waitForSelector("#city-viewport:not([hidden])", { timeout: 10000 });

  // 1) 영웅 자동 배치
  await page.click("#btn-auto-assign");
  await page.waitForTimeout(300);
  const localState1 = await page.evaluate(() => JSON.parse(localStorage.getItem("olympusSngSave_v5")));
  console.log("벌목장(plot1) heroIds:", localState1.tiles.plot1.heroIds, "(기대: [2])");
  console.log("농장(plot2) heroIds:", localState1.tiles.plot2.heroIds, "(기대: [5])");
  const assignPass = localState1.tiles.plot1.heroIds.includes(2) && localState1.tiles.plot2.heroIds.includes(5);
  console.log(assignPass ? "✅ PASS: 영웅 자동 배치" : "❌ FAIL: 영웅 자동 배치");

  // 2) 군대 자동 편성 — 건물 배치 여부와 무관하게 전투력(base atk+def+hp+전투특성) 상위
  // 3명을 채운다(밀로스타=2는 배제, 나머지 4명 중 힘 합산 상위 3명: 브란텔로스59>가라니우스56>솔벤투스55>파브레니스51)
  await page.click("#btn-army");
  await page.waitForSelector("#modal-army:not([hidden])", { timeout: 5000 });
  await page.click("#do-auto-compose");
  await page.waitForTimeout(300);
  const localState2 = await page.evaluate(() => JSON.parse(localStorage.getItem("olympusSngSave_v5")));
  console.log("부대1 heroIds:", localState2.armies[0].heroIds, "(기대: 1,4,5 — 전투력 상위 3명, 건물 배치와 무관하게 선택됨)");
  const armyHeroes = localState2.armies[0].heroIds.filter(Boolean);
  const composePass = armyHeroes.includes(1) && armyHeroes.includes(4) && armyHeroes.includes(5) && armyHeroes.length === 3;
  console.log(composePass ? "✅ PASS: 군대 자동 편성" : "❌ FAIL: 군대 자동 편성");
  // 건물 배치 독립성도 함께 확인 — 솔벤투스(5)가 부대에 들어갔어도 농장(plot2) 배치는 유지돼야 함
  const dualOk = localState2.tiles.plot2.heroIds.includes(5);
  console.log(dualOk ? "✅ PASS: 부대 편성 후에도 건물 배치 유지됨(이중 배치 독립성)" : "❌ FAIL: 건물 배치가 풀림");

  await page.screenshot({ path: "/tmp/auto-assign-ui.png" });

  const pass = assignPass && composePass && dualOk;
  console.log(pass ? "\n🎉 전체 PASS" : "\n💥 일부 FAIL");
  await browser.close();
  if (!pass) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
