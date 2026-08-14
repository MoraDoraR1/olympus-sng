// 백그라운드/오프라인 진행 검증: 탭을 닫았다 열거나(또는 브라우저가 백그라운드에서
// 타이머를 완전히 멈췄다가) 나중에 돌아왔을 때, 실제 경과 시간만큼 생산이 정확히
// 캐치업되는지 확인한다(game.js의 applyOfflineProgress(), visibilitychange 핸들러가
// 게임 세션 도중에도 동일한 함수를 호출한다).
//
// 상태 주입은 페이지를 띄우기 전에 순수 fetch()로 서버에 직접 반영한다 — 이미 부팅된
// 페이지에서 reload로 lastActiveAt을 주입하면, 최근 추가된 flushSyncOnUnload(pagehide
// 시 메모리상의 옛 state를 keepalive fetch로 즉시 flush)가 경합해 방금 넣은 값을
// 덮어써버린다. 페이지가 "처음 부팅되는 그 순간"에 이미 정확한 lastActiveAt이 서버에
// 있으면 이 경합 자체가 생기지 않는다.
import { chromium } from "playwright";

const API = "http://127.0.0.1:8790";
const SITE = "http://127.0.0.1:8791";

function fullTiles() {
  const empty = { type: null, built: false, level: 0, heroIds: [], training: null, upgrading: null };
  return {
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
}
function baseState(lastActiveAt) {
  return {
    res: { food: 80, wood: 80, stone: 60, gold: 150 }, tiles: fullTiles(),
    troopsByType: { militia: 0, transport: 0, hoplite: 0, spartan: 0, myrmidon: 0, wagon: 0, ares_champion: 0 },
    owned: {}, research: {}, tavern: { timer: 600, candidates: [null, null, null, null, null], resetCost: 30 },
    armies: [{ heroIds: [null, null, null], mission: null, lastComp: {} }, { heroIds: [null, null, null], mission: null, lastComp: {} }, { heroIds: [null, null, null], mission: null, lastComp: {} }],
    monsters: [], worldCastles: [], raids: {}, raidShards: 0, raidTickets: { t5: 0, t6: 0 }, lastActiveAt,
  };
}

async function main() {
  const rand = Math.floor(Math.random() * 1e6);
  const reg = await fetch(`${API}/api/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname: `bgtest${rand}`, password: "pass1234" }),
  }).then((r) => r.json());
  const token = reg.token;

  const goldBefore = 150;
  // 실제로 30분 전에 마지막으로 접속했던 것과 같은 상태를 처음부터 서버에 반영해둔다.
  await fetch(`${API}/api/state`, {
    method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ state: baseState(Date.now() - 30 * 60 * 1000) }),
  }).then((r) => r.json());

  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (err) => console.error("pageerror:", err.message));

  await page.goto(`${SITE}/index.html`, { waitUntil: "networkidle" });
  await page.evaluate((t) => localStorage.setItem("olympusSngAuthToken", t), token);
  await page.reload({ waitUntil: "networkidle" }); // 아직 부팅 전 — flush로 덮어쓸 메모리 state가 없다
  await page.waitForSelector("#screen-title:not([hidden])", { timeout: 10000 });
  await page.click("#btn-start-game");
  await page.waitForSelector("#city-viewport:not([hidden])", { timeout: 10000 });
  await page.waitForTimeout(300);

  const toastText = await page.locator("#toast-layer .toast").last().innerText().catch(() => null);
  console.log("캐치업 토스트:", toastText);

  const goldAfter = await page.evaluate(() => JSON.parse(localStorage.getItem("olympusSngSave_v5")).res.gold);
  const expectedGain = 0.26 * 1800; // 성 lvl1 기준 gold 생산률 × 1800초
  console.log(`복귀 후 골드: ${goldAfter} (기대: ${goldBefore} + 약 ${expectedGain.toFixed(0)})`);

  const pass = toastText && toastText.includes("계속 운영") && goldAfter > goldBefore + expectedGain * 0.8;
  console.log(pass ? "\n✅ PASS: 자리를 비운 동안(백그라운드/탭 종료)의 진행이 복귀 시 정확히 캐치업됨" : "\n❌ FAIL");

  await page.screenshot({ path: "/tmp/background-progress.png" });
  await browser.close();
  if (!pass) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
