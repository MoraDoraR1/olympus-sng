// 일일 업적 교체 검증: "정복 맵 공격 1회 보내기"(성 레벨 5 미만이면 애초에 채울 수 없던
// 업적)를 누구나 처음부터 할 수 있는 "건물 레벨업 1회 완료하기"로 바꿨다. completeUpgrade()
// 시점에 state.dailyQuests.progress.buildingUpgrades가 오르는지, 퀘스트 목록에 새 문구가
// 뜨는지, 완료 후 수령이 되는지 확인한다.
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
function baseState() {
  const tiles = fullTiles();
  // 성이 업그레이드를 1초 뒤 완료하도록 이미 진행 중인 상태로 주입 — 첫 tick()에서
  // 곧바로 completeUpgrade()가 불리게 만든다.
  tiles.castle.upgrading = { targetLevel: 2, timeLeft: 1 };
  // 업그레이드는 이미 "진행 중"인 상태로 직접 주입하므로(비용은 이미 치른 것으로 간주)
  // 굳이 자원을 크게 줄 필요가 없다 — 신규 계정 anticheat 허용치(자원 종류당 grace
  // 20,000)를 넘기면 이 PUT 자체가 거부되므로 기본 신규 계정 자원 그대로 둔다.
  return {
    res: { food: 80, wood: 80, stone: 60, gold: 150 }, tiles,
    troopsByType: { militia: 0, transport: 0, hoplite: 0, spartan: 0, myrmidon: 0, wagon: 0, ares_champion: 0 },
    owned: {}, research: {}, tavern: { timer: 600, candidates: [null, null, null, null, null], resetCost: 30 },
    armies: [{ heroIds: [null, null, null], mission: null, lastComp: {} }, { heroIds: [null, null, null], mission: null, lastComp: {} }, { heroIds: [null, null, null], mission: null, lastComp: {} }],
    monsters: [], worldCastles: [], raids: {}, raidShards: 0, raidTickets: { t5: 0, t6: 0 },
    monsterKillsSinceGate: 0, lastActiveAt: Date.now(),
    dailyQuests: { resetAt: Date.now() + 20 * 60 * 1000, progress: { login: 1, goldProduced: 0, monstersKilled: 0, troopsTrained: 0, buildingUpgrades: 0 }, claimed: {} },
    mailbox: [],
  };
}

async function main() {
  const rand = Math.floor(Math.random() * 1e6);
  const reg = await fetch(`${API}/api/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname: `qsw${rand}`, password: "pass1234" }),
  }).then((r) => r.json());
  const token = reg.token;
  const put = await fetch(`${API}/api/state`, {
    method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ state: baseState() }),
  }).then((r) => r.json());
  if (put.error) throw new Error(`PUT /api/state 실패: ${put.error}`);

  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (err) => console.error("pageerror:", err.message));

  await page.goto(`${SITE}/index.html`, { waitUntil: "networkidle" });
  await page.evaluate((t) => localStorage.setItem("olympusSngAuthToken", t), token);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#screen-title:not([hidden])", { timeout: 10000 });
  await page.click("#btn-start-game");
  await page.waitForSelector("#city-viewport:not([hidden])", { timeout: 10000 });
  // 업그레이드 완료(1초 뒤 tick)를 기다린다.
  await page.waitForTimeout(1600);

  await page.click("#btn-quests");
  await page.waitForSelector("#modal-quests:not([hidden])", { timeout: 5000 });
  const upgradeRow = page.locator(".quest-row", { hasText: "건물 레벨업 1회 완료하기" });
  const rowCount = await upgradeRow.count();
  console.log("'건물 레벨업 1회 완료하기' 업적 행 존재(1이어야 함):", rowCount);
  const rowClass = await upgradeRow.getAttribute("class");
  console.log("행 클래스(quest-ready 포함돼야 함 — 성 업그레이드가 이미 완료됨):", rowClass);
  const noAttackQuest = await page.locator(".quest-row", { hasText: "정복 맵 공격" }).count();
  console.log("'정복 맵 공격' 업적이 더 이상 없어야 함(0):", noAttackQuest);

  const claimBtn = upgradeRow.locator(".quest-claim-btn");
  await claimBtn.click();
  await page.waitForTimeout(200);
  const toastText = await page.locator("#toast-layer .toast").last().innerText().catch(() => null);
  console.log("수령 토스트:", toastText);
  const goldAfter = await page.evaluate(() => JSON.parse(localStorage.getItem("olympusSngSave_v5")).res.gold);
  console.log("수령 후 골드(기존 150 + 보상 1000 이상이어야 함):", goldAfter);

  const pass =
    rowCount === 1 &&
    (rowClass || "").includes("quest-ready") &&
    noAttackQuest === 0 &&
    toastText && toastText.includes("건물 레벨업 1회 완료하기") &&
    goldAfter >= 150 + 1000;

  console.log(pass ? "\n✅ PASS: 일일 업적 교체(공격→건물 레벨업) 정상 동작" : "\n❌ FAIL");
  await page.screenshot({ path: "/tmp/daily-quest-swap.png" });
  await browser.close();
  if (!pass) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
