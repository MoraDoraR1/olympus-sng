// 수송량 시스템 UI 확인: 병영 훈련 팝업의 병사 스탯/총 비용·시간 표시,
// 군대 편성 화면의 수송력 표시.
import { chromium } from "playwright";

const API = "http://127.0.0.1:8790";
const SITE = "http://127.0.0.1:8791";

function fullTiles(overrides) {
  const empty = { type: null, built: false, level: 0, heroIds: [], training: null, upgrading: null };
  const base = {
    plot11: { ...empty },
    defense: { type: "방어탑", built: false, level: 0, heroIds: [], training: null, upgrading: null },
    watch: { type: "감시탑", built: false, level: 0, heroIds: [], training: null, upgrading: null },
    plot12: { ...empty }, plot1: { ...empty },
    academy: { type: "아카데미", built: false, level: 0, heroIds: [], training: null, upgrading: null },
    castle: { type: "성", built: true, level: 20, heroIds: [], training: null, upgrading: null },
    storage: { type: "자원보호소", built: false, level: 0, heroIds: [], training: null, upgrading: null },
    plot2: { ...empty }, plot13: { ...empty }, plot3: { ...empty },
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
    body: JSON.stringify({ nickname: `capui${rand}`, password: "pass1234" }),
  }).then((r) => r.json());
  const token = reg.token;

  const state = {
    res: { food: 5000, wood: 5000, stone: 5000, gold: 5000 },
    tiles: fullTiles({ plot1: { type: "병영", built: true, level: 20, heroIds: [], training: null, upgrading: null } }),
    troopsByType: { militia: 10, transport: 5, hoplite: 0, spartan: 0, myrmidon: 0, wagon: 0, ares_champion: 0 },
    owned: {}, research: {}, tavern: { timer: 600, candidates: [null, null, null, null, null], resetCost: 30 },
    armies: [{ heroIds: [null, null, null], mission: null, lastComp: { militia: 5, transport: 3 } }, { heroIds: [null, null, null], mission: null, lastComp: {} }, { heroIds: [null, null, null], mission: null, lastComp: {} }],
    monsters: [], worldCastles: [], raids: {}, raidShards: 0, raidTickets: { t5: 0, t6: 0 }, lastActiveAt: Date.now(),
  };
  await fetch(`${API}/api/state`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ state }) }).then((r) => r.json());

  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (err) => console.error("pageerror:", err.message));

  await page.goto(`${SITE}/index.html`, { waitUntil: "networkidle" });
  await page.evaluate((tok) => localStorage.setItem("olympusSngAuthToken", tok), token);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#screen-title:not([hidden])", { timeout: 10000 });
  await page.click("#btn-start-game");
  await page.waitForSelector("#city-viewport:not([hidden])", { timeout: 10000 });

  // 병영 팝업 - 병사 스탯/총 비용 확인
  await page.locator(".plot:has-text('병영')").first().click();
  await page.waitForSelector("#modal-building:not([hidden])", { timeout: 5000 });
  const statLines = await page.locator("#modal-building .tt-stats").allInnerTexts();
  console.log("병종 스탯 라인:", statLines);
  const totalLines = await page.locator("#modal-building .tt-total").allInnerTexts();
  console.log("병종 총 비용/시간:", totalLines);
  await page.screenshot({ path: "/tmp/barracks-ui.png" });

  await page.click("#modal-building .modal-close");
  await page.waitForTimeout(200);

  // 군대 편성 화면 - 수송력 확인
  await page.click("#btn-army");
  await page.waitForSelector("#modal-army:not([hidden])", { timeout: 5000 });
  const capacityText = await page.locator("#modal-army .capacity-num").innerText();
  console.log("부대1 수송력 표시:", capacityText, "(기대: 민병대5x20 + 수송병3x150 = 550)");
  await page.screenshot({ path: "/tmp/army-capacity-ui.png" });

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
