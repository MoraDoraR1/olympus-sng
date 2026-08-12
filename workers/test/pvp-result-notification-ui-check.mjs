// 전투 결과 알림이 실제 화면(성 화면 등, 정복 맵을 보고 있지 않을 때도)에 뜨는지
// Playwright로 확인한다 — 공격자/피공격자 둘 다 성 화면에 머무는 동안 백그라운드
// 폴링(PVP_NOTIFY_INTERVAL_MS)이 결과를 발견해 토스트+결과창을 띄워야 한다.
import { chromium } from "playwright";
import { execSync } from "node:child_process";

const SITE = "http://127.0.0.1:8791";
const API = "http://127.0.0.1:8790";
const WORKERS_DIR = new URL("..", import.meta.url).pathname;

function fullTiles() {
  const empty = { type: null, built: false, level: 0, heroIds: [], training: null, upgrading: null };
  return {
    plot11: { ...empty }, defense: { type: "방어탑", built: false, level: 0, heroIds: [], training: null, upgrading: null },
    watch: { type: "감시탑", built: false, level: 0, heroIds: [], training: null, upgrading: null }, plot12: { ...empty },
    plot1: { ...empty }, academy: { type: "아카데미", built: false, level: 0, heroIds: [], training: null, upgrading: null },
    castle: { type: "성", built: true, level: 5, heroIds: [], training: null, upgrading: null },
    storage: { type: "자원보호소", built: false, level: 0, heroIds: [], training: null, upgrading: null },
    plot2: { ...empty }, plot13: { ...empty }, plot3: { ...empty },
    tavern: { type: "여관", built: false, level: 0, heroIds: [], training: null, upgrading: null },
    plot4: { ...empty }, plot14: { ...empty }, plot5: { ...empty }, plot6: { ...empty }, plot7: { ...empty },
    plot8: { ...empty }, plot9: { ...empty }, plot10: { ...empty },
    wall: { type: "성벽", built: false, level: 0, heroIds: [] },
  };
}
function baseState(res, troops) {
  return {
    res, tiles: fullTiles(),
    troopsByType: Object.assign({ militia: 0, transport: 0, hoplite: 0, spartan: 0, myrmidon: 0, wagon: 0, ares_champion: 0 }, troops || {}),
    owned: {}, research: {}, tavern: { timer: 600, candidates: [null, null, null, null, null], resetCost: 30 },
    armies: [{ heroIds: [null, null, null], mission: null, lastComp: {} }, { heroIds: [null, null, null], mission: null, lastComp: {} }, { heroIds: [null, null, null], mission: null, lastComp: {} }],
    monsters: [], worldCastles: [], raids: {}, raidShards: 0, raidTickets: { t5: 0, t6: 0 }, lastActiveAt: Date.now(),
  };
}
function d1(sql) {
  execSync(`npx wrangler d1 execute olympus-sng-db --local --config wrangler.dev-api-only.jsonc --command "${sql}"`, { cwd: WORKERS_DIR, stdio: "pipe" });
}

async function loginViaToken(page, token) {
  await page.goto(`${SITE}/index.html`, { waitUntil: "networkidle" });
  await page.evaluate((t) => localStorage.setItem("olympusSngAuthToken", t), token);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#screen-title:not([hidden])", { timeout: 10000 });
  await page.click("#btn-start-game");
  await page.waitForSelector("#city-viewport:not([hidden])", { timeout: 10000 });
}

async function main() {
  const rand = Math.floor(Math.random() * 1e6);
  const atk = await fetch(`${API}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nickname: `pnu_a${rand}`, password: "pass1234" }) }).then((r) => r.json());
  const def = await fetch(`${API}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nickname: `pnu_d${rand}`, password: "pass1234" }) }).then((r) => r.json());
  await fetch(`${API}/api/state`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${atk.token}` }, body: JSON.stringify({ state: baseState({ food: 80, wood: 80, stone: 60, gold: 150 }, { militia: 20 }) }) }).then((r) => r.json());
  await fetch(`${API}/api/state`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${def.token}` }, body: JSON.stringify({ state: baseState({ food: 500, wood: 500, stone: 500, gold: 500 }, {}) }) }).then((r) => r.json());
  await fetch(`${API}/api/conquest/spawn`, { method: "POST", headers: { Authorization: `Bearer ${atk.token}` } }).then((r) => r.json());
  await fetch(`${API}/api/conquest/spawn`, { method: "POST", headers: { Authorization: `Bearer ${def.token}` } }).then((r) => r.json());

  const base = Math.floor(Math.random() * 140) + 10;
  d1(`UPDATE world_tiles SET x=${base}, y=${base}, protected_until=0 WHERE player_id=${atk.player.id}`);
  d1(`UPDATE world_tiles SET x=${base + 1}, y=${base}, protected_until=0 WHERE player_id=${def.player.id}`);
  await new Promise((r) => setTimeout(r, 500));

  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  const atkCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const defCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const atkPage = await atkCtx.newPage();
  const defPage = await defCtx.newPage();
  atkPage.on("pageerror", (e) => console.error("[attacker pageerror]", e.message));
  defPage.on("pageerror", (e) => console.error("[defender pageerror]", e.message));

  await Promise.all([loginViaToken(atkPage, atk.token), loginViaToken(defPage, def.token)]);
  console.log("두 계정 모두 성(City) 화면에 진입 — 정복 맵 화면은 열지 않음.");

  // 공격은 UI가 아니라 API로 직접 디스패치한다 — 공격자 화면도 정복 맵을 연 적이 없어야
  // "화면을 안 보고 있어도 알림이 온다"는 요구사항을 제대로 검증할 수 있다.
  const dispatch = await fetch(`${API}/api/conquest/attack`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${atk.token}` },
    body: JSON.stringify({ targetPlayerId: def.player.id, squadIndex: 0, comp: { militia: 20 } }),
  }).then((r) => r.json());
  if (dispatch.error) throw new Error("공격 디스패치 실패: " + dispatch.error);
  console.log(`공격 디스패치(API 직접 호출): missionId ${dispatch.missionId}, 도착까지 ${dispatch.travelSeconds}s`);

  // 도착(전투 판정) + 백그라운드 폴링 주기(15s) + 여유
  const waitMs = (dispatch.travelSeconds + 20) * 1000;
  console.log(`전투 판정 + 백그라운드 알림 폴링을 위해 ${Math.round(waitMs / 1000)}초 대기...`);
  await Promise.all([atkPage.waitForTimeout(waitMs), defPage.waitForTimeout(waitMs)]);

  const atkModal = await atkPage.evaluate(() => {
    const overlay = document.getElementById("modal-battle-report");
    return { hidden: overlay.hidden, title: document.getElementById("battle-report-title").textContent, body: document.getElementById("battle-report-body").textContent };
  });
  const defModal = await defPage.evaluate(() => {
    const overlay = document.getElementById("modal-battle-report");
    return { hidden: overlay.hidden, title: document.getElementById("battle-report-title").textContent, body: document.getElementById("battle-report-body").textContent };
  });
  console.log("공격자 화면 결과창:", JSON.stringify(atkModal));
  console.log("피공격자 화면 결과창:", JSON.stringify(defModal));

  const atkLog = await atkPage.evaluate(() => document.getElementById("activity-log").textContent);
  const defLog = await defPage.evaluate(() => document.getElementById("activity-log").textContent);
  console.log("공격자 활동 로그에 승리 기록 포함:", atkLog.includes("승리"));
  console.log("피공격자 활동 로그에 패배 기록 포함:", defLog.includes("패배"));

  const pass = !atkModal.hidden && atkModal.title.includes("승리") &&
    !defModal.hidden && defModal.title.includes("패배") &&
    atkLog.includes("승리") && defLog.includes("패배");
  console.log(pass
    ? "\n✅ PASS: 정복 맵 화면을 보고 있지 않아도 공격자/피공격자 모두 전투 결과 알림(결과창+로그)을 받음"
    : "\n❌ FAIL");

  await atkPage.screenshot({ path: "/tmp/pvp-result-attacker.png" });
  await defPage.screenshot({ path: "/tmp/pvp-result-defender.png" });
  await browser.close();
  if (!pass) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
