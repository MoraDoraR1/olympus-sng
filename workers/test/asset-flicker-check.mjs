// 건물판/몬스터 영역 "깜박임" 버그 검증: renderBoard()/renderMonsterArea()는 매 tick(1초)마다
// innerHTML을 통째로 다시 그리는데, 예전 코드는 그때마다 존재하지 않는 PNG를 다시 요청했다
// 실패한 뒤(onerror) SVG로 대체하는 과정을 반복해 매초 깜박이는 것처럼 보였다. 실패한 경로를
// 캐시해 두 번째 tick부터는 곧장 SVG를 그리도록 고쳤다 — 같은 PNG 경로에 대한 네트워크 요청이
// 여러 번 tick이 지나도 "처음 1회"로 수렴하는지 확인한다.
import { chromium } from "playwright";

const API = "http://127.0.0.1:8790";
const SITE = "http://127.0.0.1:8791";

function fullTiles() {
  const empty = { type: null, built: false, level: 0, heroIds: [], training: null, upgrading: null };
  return {
    plot11: { ...empty }, defense: { type: "방어탑", built: true, level: 5, heroIds: [], training: null, upgrading: null },
    watch: { type: "감시탑", built: true, level: 3, heroIds: [], training: null, upgrading: null }, plot12: { ...empty },
    plot1: { type: "농장", built: true, level: 2, heroIds: [], training: null, upgrading: null },
    academy: { type: "아카데미", built: false, level: 0, heroIds: [], training: null, upgrading: null },
    castle: { type: "성", built: true, level: 3, heroIds: [], training: null, upgrading: null },
    storage: { type: "자원보호소", built: false, level: 0, heroIds: [], training: null, upgrading: null },
    plot2: { ...empty }, plot13: { ...empty }, plot3: { ...empty },
    tavern: { type: "여관", built: false, level: 0, heroIds: [], training: null, upgrading: null },
    plot4: { ...empty }, plot14: { ...empty }, plot5: { ...empty }, plot6: { ...empty }, plot7: { ...empty },
    plot8: { ...empty }, plot9: { ...empty }, plot10: { ...empty },
    wall: { type: "성벽", built: false, level: 0, heroIds: [] },
  };
}
function baseState() {
  return {
    res: { food: 80, wood: 80, stone: 60, gold: 150 }, tiles: fullTiles(),
    troopsByType: { militia: 0, transport: 0, hoplite: 0, spartan: 0, myrmidon: 0, wagon: 0, ares_champion: 0 },
    owned: {}, research: {}, tavern: { timer: 600, candidates: [null, null, null, null, null], resetCost: 30 },
    armies: [{ heroIds: [null, null, null], mission: null, lastComp: {} }, { heroIds: [null, null, null], mission: null, lastComp: {} }, { heroIds: [null, null, null], mission: null, lastComp: {} }],
    monsters: [], worldCastles: [], raids: {}, raidShards: 0, raidTickets: { t5: 0, t6: 0 },
    monsterKillsSinceGate: 0, lastActiveAt: Date.now(),
    dailyQuests: { resetAt: Date.now() + 20 * 60 * 1000, progress: { login: 1, goldProduced: 0, monstersKilled: 0, troopsTrained: 0, heroesRecruited: 0 }, claimed: {} },
    mailbox: [],
  };
}

async function main() {
  const rand = Math.floor(Math.random() * 1e6);
  const reg = await fetch(`${API}/api/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname: `flicker${rand}`, password: "pass1234" }),
  }).then((r) => r.json());
  const token = reg.token;
  await fetch(`${API}/api/state`, {
    method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ state: baseState() }),
  }).then((r) => r.json());

  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (err) => console.error("pageerror:", err.message));

  const pngRequestCounts = {};
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/assets/buildings/") && url.endsWith(".png")) {
      pngRequestCounts[url] = (pngRequestCounts[url] || 0) + 1;
    }
  });

  await page.goto(`${SITE}/index.html`, { waitUntil: "networkidle" });
  await page.evaluate((t) => localStorage.setItem("olympusSngAuthToken", t), token);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#screen-title:not([hidden])", { timeout: 10000 });
  await page.click("#btn-start-game");
  await page.waitForSelector("#city-viewport:not([hidden])", { timeout: 10000 });

  // tick()이 4번 이상 돌 때까지(4초+) 기다린다 — 건물판이 그 사이 여러 번 다시 그려진다.
  await page.waitForTimeout(4500);

  console.log("건물 PNG 요청 카운트(경로별 1회로 수렴해야 함):", JSON.stringify(pngRequestCounts, null, 2));
  const maxCount = Math.max(0, ...Object.values(pngRequestCounts));
  const uniquePaths = Object.keys(pngRequestCounts).length;
  console.log(`고유 경로 수: ${uniquePaths}, 경로당 최대 요청 횟수: ${maxCount}`);

  // 화면에 실제로 건물 아이콘 <img>가 정상적으로 떠 있는지(깨진 이미지 아이콘이 아닌지)도 확인.
  const brokenCount = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll("#board img"));
    return imgs.filter((img) => img.complete && img.naturalWidth === 0).length;
  });
  console.log("깨진(로드 실패) <img> 개수(0이어야 함):", brokenCount);

  const pass = maxCount <= 1 && brokenCount === 0;
  console.log(pass ? "\n✅ PASS: 같은 PNG 경로가 tick마다 반복 요청되지 않음(깜박임 원인 제거)" : "\n❌ FAIL");
  await page.screenshot({ path: "/tmp/asset-flicker-check.png" });
  await browser.close();
  if (!pass) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
