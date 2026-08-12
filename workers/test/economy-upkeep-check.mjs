// Phase 5 경제 밸런스: 병사 유지비가 실제로 매초 식량을 깎는지, 상단바 순생산 표시가
// 음수일 때 부호/색을 올바르게 보여주는지 실제 브라우저에서 확인.
import { chromium } from "playwright";

const API = "http://127.0.0.1:8790";
const SITE = "http://127.0.0.1:8791";

function fullTiles(overrides) {
  const empty = { type: null, built: false, level: 0, heroIds: [], training: null, upgrading: null };
  const base = {
    plot11: { ...empty }, defense: { type: "방어탑", built: false, level: 0, heroIds: [], training: null, upgrading: null },
    watch: { type: "감시탑", built: false, level: 0, heroIds: [], training: null, upgrading: null }, plot12: { ...empty },
    plot1: { ...empty }, academy: { type: "아카데미", built: false, level: 0, heroIds: [], training: null, upgrading: null },
    castle: { type: "성", built: true, level: 1, heroIds: [], training: null, upgrading: null },
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
    body: JSON.stringify({ nickname: `upkeep${rand}`, password: "pass1234" }),
  }).then((r) => r.json());
  const token = reg.token;

  // 생산 건물 없음(성만 built) + 아레스의 대전사 20명(유지비 0.044/s/명 = 0.88/s) → 식량이
  // 확실히 순감소해야 함. (신규 계정 anticheat 유예 한도 내에서 검증하기 위해 소규모로 구성)
  // food는 500으로 둔다 — 1000 이상은 화면에 "K" 단위(0.1K=100 단위 반올림)로 표시돼
  // 5초간의 -4.4 정도 변화가 표시상 묻혀버린다(1000 미만은 정수 그대로 표시).
  const state = {
    res: { food: 500, wood: 80, stone: 60, gold: 150 },
    tiles: fullTiles({}),
    troopsByType: { militia: 0, transport: 0, hoplite: 0, spartan: 0, myrmidon: 0, wagon: 0, ares_champion: 20 },
    owned: {}, research: {}, tavern: { timer: 600, candidates: [null, null, null, null, null], resetCost: 30 },
    armies: [{ heroIds: [null, null, null], mission: null, lastComp: {} }, { heroIds: [null, null, null], mission: null, lastComp: {} }, { heroIds: [null, null, null], mission: null, lastComp: {} }],
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

  const rateText = await page.locator("#rate-food").innerText();
  const rateClass = await page.locator("#rate-food").getAttribute("class");
  console.log("식량 순생산 표시:", rateText, "class:", rateClass, "(기대: 음수, rate-negative 클래스)");

  const foodBefore = Number((await page.locator("#res-food").innerText()).replace(/[^\d.]/g, ""));
  await page.waitForTimeout(5000);
  const foodAfter = Number((await page.locator("#res-food").innerText()).replace(/[^\d.]/g, ""));
  console.log(`5초 대기 — 식량 ${foodBefore} → ${foodAfter} (감소해야 함, 예상 -0.88/s×5 ≈ -4.4)`);

  const pass = rateText.startsWith("-") && rateClass.includes("rate-negative") && foodAfter < foodBefore;
  console.log(pass ? "\n✅ PASS: 병사 유지비가 실제로 식량을 깎고 있음" : "\n❌ FAIL");
  await page.screenshot({ path: "/tmp/upkeep-check.png" });

  await browser.close();
  if (!pass) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
