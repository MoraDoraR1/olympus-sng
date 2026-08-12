// 건물 배치 <-> 군대 편성 상호배타 제거 검증.
// static-proxy-server.mjs(8791) + wrangler dev(8790, --config wrangler.dev-api-only.jsonc)가
// 떠 있어야 한다.
import { chromium } from "playwright";

const API = "http://127.0.0.1:8790";
const SITE = "http://127.0.0.1:8791";

async function main() {
  const rand = Math.floor(Math.random() * 1e6);
  const nickname = `placecheck${rand}`;
  const password = "pass1234";

  // 1) 계정 생성 (직접 API 호출)
  const reg = await fetch(`${API}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname, password }),
  }).then((r) => r.json());
  if (!reg.token) throw new Error("register failed: " + JSON.stringify(reg));
  const token = reg.token;

  // 2) 커스텀 상태 주입: plot1을 이미 건설된 "벌목장"으로, 영웅 2번(밀로스타, 벌목장 특성 보유)을 보유 상태로.
  const FRESH_TILES = {
    plot11: { type: null, built: false, level: 0, heroIds: [], training: null, upgrading: null },
    defense: { type: "방어탑", built: false, level: 0, heroIds: [], training: null, upgrading: null },
    watch: { type: "감시탑", built: false, level: 0, heroIds: [], training: null, upgrading: null },
    plot12: { type: null, built: false, level: 0, heroIds: [], training: null, upgrading: null },
    plot1: { type: "벌목장", built: true, level: 1, heroIds: [], training: null, upgrading: null },
    academy: { type: "아카데미", built: false, level: 0, heroIds: [], training: null, upgrading: null },
    castle: { type: "성", built: true, level: 1, heroIds: [], training: null, upgrading: null },
    storage: { type: "자원보호소", built: false, level: 0, heroIds: [], training: null, upgrading: null },
    plot2: { type: "벌목장", built: true, level: 1, heroIds: [], training: null, upgrading: null },
    plot13: { type: null, built: false, level: 0, heroIds: [], training: null, upgrading: null },
    plot3: { type: null, built: false, level: 0, heroIds: [], training: null, upgrading: null },
    tavern: { type: "여관", built: false, level: 0, heroIds: [], training: null, upgrading: null },
    plot4: { type: null, built: false, level: 0, heroIds: [], training: null, upgrading: null },
    plot14: { type: null, built: false, level: 0, heroIds: [], training: null, upgrading: null },
    plot5: { type: null, built: false, level: 0, heroIds: [], training: null, upgrading: null },
    plot6: { type: null, built: false, level: 0, heroIds: [], training: null, upgrading: null },
    plot7: { type: null, built: false, level: 0, heroIds: [], training: null, upgrading: null },
    plot8: { type: null, built: false, level: 0, heroIds: [], training: null, upgrading: null },
    plot9: { type: null, built: false, level: 0, heroIds: [], training: null, upgrading: null },
    plot10: { type: null, built: false, level: 0, heroIds: [], training: null, upgrading: null },
    wall: { type: "성벽", built: false, level: 0, heroIds: [] },
  };
  const customState = {
    res: { food: 80, wood: 80, stone: 60, gold: 150 },
    tiles: FRESH_TILES,
    troopsByType: { militia: 0, hoplite: 0, spartan: 0, myrmidon: 0, ares_champion: 0 },
    owned: { 2: { enhance: 0, shards: 0, count: 1 } },
    research: {},
    tavern: { timer: 600, candidates: [null, null, null, null, null], resetCost: 30 },
    armies: [
      { heroIds: [null, null, null], mission: null, lastComp: {} },
      { heroIds: [null, null, null], mission: null, lastComp: {} },
      { heroIds: [null, null, null], mission: null, lastComp: {} },
    ],
    monsters: [],
    worldCastles: [],
    raids: {},
    raidShards: 0,
    raidTickets: { t5: 0, t6: 0 },
    lastActiveAt: Date.now(),
  };
  const put = await fetch(`${API}/api/state`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ state: customState }),
  }).then((r) => r.json());
  console.log("state PUT result:", JSON.stringify(put).slice(0, 200));

  // 3) 브라우저에서 이 토큰으로 로그인 상태를 흉내내고 페이지를 새로고침해 서버 상태를 불러온다.
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (err) => console.error("pageerror:", err.message));

  await page.goto(`${SITE}/index.html`, { waitUntil: "networkidle" });
  await page.evaluate((tok) => localStorage.setItem("olympusSngAuthToken", tok), token);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#screen-title:not([hidden])", { timeout: 10000 });
  await page.click("#btn-start-game");
  await page.waitForSelector("#city-viewport:not([hidden])", { timeout: 10000 });

  // 4) 벌목장(plot1) 클릭 -> 건물 모달 -> 밀로스타(id=2)를 건물에 배치
  await page.locator(".plot:has-text('벌목장')").first().click();
  await page.waitForSelector("#modal-building:not([hidden])", { timeout: 5000 });
  await page.click("#modal-building .hero-row[data-hero='2']");
  await page.waitForTimeout(300);
  const buildingAssignedAfterStep4 = await page.locator("#modal-building .assigned-hero-row").count();
  console.log("건물에 배치된 영웅 수 (건물 배치 직후):", buildingAssignedAfterStep4);

  await page.click("#modal-building .modal-close");
  await page.waitForTimeout(200);

  // 5) 군대 편성 모달을 열고 같은 영웅(id=2)을 부대 1에 배치
  await page.click("#btn-army");
  await page.waitForSelector("#modal-army:not([hidden])", { timeout: 5000 });
  const eldsewhereBadgeBeforeArmy = await page.locator("#army-modal-body .hero-row[data-hero='2'] .hero-elsewhere-badge").textContent().catch(() => null);
  console.log("부대 편성 화면에서 본 영웅2의 위치 뱃지(배치 전):", eldsewhereBadgeBeforeArmy);
  await page.click("#army-modal-body .hero-row[data-hero='2']");
  await page.waitForTimeout(300);
  const armySlotFilled = await page.locator("#army-modal-body .army-slot span:has-text('밀로스타')").count();
  console.log("부대 슬롯에 밀로스타 배치됨:", armySlotFilled > 0);

  await page.click("#modal-army .modal-close");
  await page.waitForTimeout(200);

  // 6) 건물 모달을 다시 열어서 여전히 배치돼 있는지 확인 (핵심 검증 포인트)
  await page.locator(".plot:has-text('벌목장')").first().click();
  await page.waitForSelector("#modal-building:not([hidden])", { timeout: 5000 });
  const buildingAssignedAfterArmy = await page.locator("#modal-building .assigned-hero-row:has-text('밀로스타')").count();
  console.log("부대 배치 후에도 건물에 여전히 배치돼 있는가:", buildingAssignedAfterArmy > 0 ? "YES (기대한 결과)" : "NO (버그!)");

  await page.screenshot({ path: "/tmp/placement-independence.png" });

  // 7) localStorage에 저장된 최종 state를 확인해 두 곳 모두에 남아있는지 재확인
  // (서버 동기화는 SERVER_SYNC_INTERVAL_MS=15s로 스로틀되지만, localStorage 저장은 매번 즉시 이루어진다)
  const localState = await page.evaluate(() => JSON.parse(localStorage.getItem("olympusSngSave_v5")));
  const tileHeroIds = localState.tiles.plot1.heroIds;
  const armyHeroIds = localState.armies[0].heroIds;
  console.log("최종 저장된 상태(localStorage) — 건물(plot1) heroIds:", JSON.stringify(tileHeroIds), " / 부대1 heroIds:", JSON.stringify(armyHeroIds));

  const pass1 = tileHeroIds.includes(2) && armyHeroIds.includes(2);
  console.log(pass1 ? "\n✅ PASS: 영웅이 건물과 부대에 동시에 배치되어 저장됨" : "\n❌ FAIL: 한쪽 배치가 해제되었음");

  // 8) 같은 종류 안에서는 여전히 상호배타적인지 확인: 두 번째 벌목장(plot2)에 같은 영웅을
  // 배치하면 첫 번째 벌목장(plot1)에서는 해제되어야 한다 (건물↔건물).
  await page.click("#modal-building .modal-close");
  await page.waitForTimeout(200);
  await page.locator(".plot:has-text('벌목장')").nth(1).click();
  await page.waitForSelector("#modal-building:not([hidden])", { timeout: 5000 });
  await page.click("#modal-building .hero-row[data-hero='2']");
  await page.waitForTimeout(300);
  await page.click("#modal-building .modal-close");
  await page.waitForTimeout(200);
  const localState2 = await page.evaluate(() => JSON.parse(localStorage.getItem("olympusSngSave_v5")));
  console.log("두번째 건물 배치 후 — plot1 heroIds:", JSON.stringify(localState2.tiles.plot1.heroIds), " / plot2 heroIds:", JSON.stringify(localState2.tiles.plot2.heroIds), " / 부대1 heroIds:", JSON.stringify(localState2.armies[0].heroIds));
  const pass2 = !localState2.tiles.plot1.heroIds.includes(2) && localState2.tiles.plot2.heroIds.includes(2) && localState2.armies[0].heroIds.includes(2);
  console.log(pass2 ? "✅ PASS: 건물↔건물 상호배타는 유지되고, 부대 배치는 그대로 유지됨" : "❌ FAIL: 건물 간 상호배타 또는 부대 배치 보존에 문제");

  // 9) 부대는 이미 배치된 영웅을 다른 부대의 목록 클릭만으로 옮길 수 없게 막는 기존 가드가
  // 있다("이미 다른 부대에 편성된 영웅입니다") — 이 동작은 이번 수정 대상이 아니므로 그대로
  // 두고, 먼저 부대 1에서 해제한 뒤 부대 2로 재배치해 부대↔부대 상호배타 + 건물 배치 보존을 확인한다.
  await page.click("#btn-army");
  await page.waitForSelector("#modal-army:not([hidden])", { timeout: 5000 });
  await page.click("#army-modal-body .do-unassign-army[data-idx='0']");
  await page.waitForTimeout(200);
  await page.click(".squad-tab[data-idx='1']");
  await page.waitForTimeout(200);
  await page.click("#army-modal-body .hero-row[data-hero='2']");
  await page.waitForTimeout(300);
  await page.click("#modal-army .modal-close");
  await page.waitForTimeout(200);
  const localState3 = await page.evaluate(() => JSON.parse(localStorage.getItem("olympusSngSave_v5")));
  console.log("두번째 부대 배치 후 — 부대1 heroIds:", JSON.stringify(localState3.armies[0].heroIds), " / 부대2 heroIds:", JSON.stringify(localState3.armies[1].heroIds), " / plot2 heroIds:", JSON.stringify(localState3.tiles.plot2.heroIds));
  const pass3 = !localState3.armies[0].heroIds.includes(2) && localState3.armies[1].heroIds.includes(2) && localState3.tiles.plot2.heroIds.includes(2);
  console.log(pass3 ? "✅ PASS: 부대↔부대 상호배타는 유지되고, 건물 배치는 그대로 유지됨" : "❌ FAIL: 부대 간 상호배타 또는 건물 배치 보존에 문제");

  await page.screenshot({ path: "/tmp/placement-independence.png" });

  const pass = pass1 && pass2 && pass3;
  console.log(pass ? "\n🎉 전체 PASS" : "\n💥 전체 중 일부 FAIL");

  await browser.close();
  if (!pass) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
