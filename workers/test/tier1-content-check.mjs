// Tier 1 확장 컨텐츠(업적/퀘스트, 랭킹, 우편함) 검증.
//
// 상태 주입은 페이지를 띄우기 전에 순수 fetch()로 서버에 직접 반영한다(다른 테스트와
// 동일한 패턴 — flushSyncOnUnload와의 경합을 피하기 위함).
//
// dailyQuests.resetAt은 반드시 미래 시각으로 둬야 한다 — tick()의 maybeResetDailyQuests()가
// 과거 시각을 보면 부팅 직후 첫 tick에서 곧바로 진행도를 초기화해버려 주입해둔 "완료 직전"
// 상태가 사라진다.
import { chromium } from "playwright";

const API = "http://127.0.0.1:8790";
const SITE = "http://127.0.0.1:8791";

function fullTiles(castleLevel) {
  const empty = { type: null, built: false, level: 0, heroIds: [], training: null, upgrading: null };
  return {
    plot11: { ...empty }, defense: { type: "방어탑", built: false, level: 0, heroIds: [], training: null, upgrading: null },
    watch: { type: "감시탑", built: false, level: 0, heroIds: [], training: null, upgrading: null }, plot12: { ...empty },
    plot1: { ...empty }, academy: { type: "아카데미", built: false, level: 0, heroIds: [], training: null, upgrading: null },
    castle: { type: "성", built: true, level: castleLevel || 1, heroIds: [], training: null, upgrading: null },
    storage: { type: "자원보호소", built: false, level: 0, heroIds: [], training: null, upgrading: null },
    plot2: { ...empty }, plot13: { ...empty }, plot3: { ...empty },
    tavern: { type: "여관", built: false, level: 0, heroIds: [], training: null, upgrading: null },
    plot4: { ...empty }, plot14: { ...empty }, plot5: { ...empty }, plot6: { ...empty }, plot7: { ...empty },
    plot8: { ...empty }, plot9: { ...empty }, plot10: { ...empty },
    wall: { type: "성벽", built: false, level: 0, heroIds: [] },
  };
}
function baseState({ castleLevel, troops, dailyQuests, mailbox }) {
  return {
    res: { food: 80, wood: 80, stone: 60, gold: 150 }, tiles: fullTiles(castleLevel),
    troopsByType: Object.assign({ militia: 0, transport: 0, hoplite: 0, spartan: 0, myrmidon: 0, wagon: 0, ares_champion: 0 }, troops || {}),
    owned: {}, research: {}, tavern: { timer: 600, candidates: [null, null, null, null, null], resetCost: 30 },
    armies: [{ heroIds: [null, null, null], mission: null, lastComp: {} }, { heroIds: [null, null, null], mission: null, lastComp: {} }, { heroIds: [null, null, null], mission: null, lastComp: {} }],
    monsters: [], worldCastles: [], raids: {}, raidShards: 0, raidTickets: { t5: 0, t6: 0 },
    monsterKillsSinceGate: 0, lastActiveAt: Date.now(),
    dailyQuests: dailyQuests || { resetAt: Date.now() + 20 * 60 * 1000, progress: { login: 1, goldProduced: 0, monstersKilled: 0, troopsTrained: 0, buildingUpgrades: 0 }, claimed: {} },
    mailbox: mailbox || [],
  };
}

async function register(nickname) {
  const reg = await fetch(`${API}/api/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname, password: "pass1234" }),
  }).then((r) => r.json());
  return reg.token;
}
async function putState(token, state) {
  const res = await fetch(`${API}/api/state`, {
    method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ state }),
  });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(`PUT /api/state 실패: ${body.error || res.status}`);
  return body;
}

async function main() {
  const rand = Math.floor(Math.random() * 1e6);
  const nickA = `t1a${rand}`, nickB = `t1b${rand}`;

  // A: 몬스터 처치 퀘스트가 이미 완료된(3/3) 상태 + 랭킹 비교용으로 병력을 보유.
  // 병사 수는 신규 계정 anticheat의 TROOP_GRACE(병종별 20)를 넘지 않는 선으로 잡는다 —
  // 안 그러면 이 PUT 자체가 400으로 거부되어 서버에 상태가 저장되지 않는다.
  const tokenA = await register(nickA);
  await putState(tokenA, baseState({
    castleLevel: 8,
    troops: { spartan: 20, myrmidon: 15 },
    dailyQuests: { resetAt: Date.now() + 20 * 60 * 1000, progress: { login: 1, goldProduced: 0, monstersKilled: 3, troopsTrained: 0, buildingUpgrades: 0 }, claimed: {} },
  }));

  // B: A보다 훨씬 약한 병력 — 랭킹에서 A보다 아래여야 한다.
  const tokenB = await register(nickB);
  await putState(tokenB, baseState({ castleLevel: 1, troops: { militia: 2 } }));

  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (err) => console.error("pageerror:", err.message));
  page.on("console", (msg) => { if (msg.type() === "error") console.error("console.error:", msg.text()); });

  await page.goto(`${SITE}/index.html`, { waitUntil: "networkidle" });
  await page.evaluate((t) => localStorage.setItem("olympusSngAuthToken", t), tokenA);
  await page.reload({ waitUntil: "networkidle" }); // 부팅 전 — flush로 덮어쓸 메모리 state가 없다
  await page.waitForSelector("#screen-title:not([hidden])", { timeout: 10000 });
  await page.click("#btn-start-game");
  await page.waitForSelector("#city-viewport:not([hidden])", { timeout: 10000 });
  await page.waitForTimeout(1500);
  const debugDQ = await page.evaluate(() => JSON.parse(localStorage.getItem("olympusSngSave_v5")).dailyQuests);
  console.log("DEBUG dailyQuests:", JSON.stringify(debugDQ));

  // ---------- 1. 일일 업적/퀘스트 ----------
  await page.click("#btn-quests");
  await page.waitForSelector("#modal-quests:not([hidden])", { timeout: 5000 });
  const monsterRow = page.locator(".quest-row", { hasText: "필드 몬스터 3마리 처치" });
  const readyClass = await monsterRow.getAttribute("class");
  console.log("몬스터 처치 퀘스트 행 클래스(quest-ready 포함돼야 함):", readyClass);
  const claimBtn = monsterRow.locator(".quest-claim-btn");
  const claimDisabledBefore = await claimBtn.getAttribute("disabled");
  console.log("수령 버튼 disabled 속성(완료 상태라 없어야 함):", claimDisabledBefore);
  await claimBtn.click();
  await page.waitForTimeout(200);
  const toastText = await page.locator("#toast-layer .toast").last().innerText().catch(() => null);
  console.log("퀘스트 수령 토스트:", toastText);
  const shardsAfter = await page.evaluate(() => JSON.parse(localStorage.getItem("olympusSngSave_v5")).raidShards);
  console.log("퀘스트 보상으로 받은 만능 조각(10이어야 함):", shardsAfter);
  const claimedAfterClick = await monsterRow.getAttribute("class");
  console.log("수령 후 행 클래스(quest-claimed 포함돼야 함):", claimedAfterClick);
  await page.evaluate(() => document.getElementById("modal-quests").hidden = true);

  // ---------- 2. 우편함 ----------
  const mailBadgeText = await page.locator("#mail-badge").innerText().catch(() => null);
  const mailBadgeHidden = await page.locator("#mail-badge").isHidden();
  console.log("우편함 배지(숨김 아니어야 함, 숫자 1):", mailBadgeHidden, mailBadgeText);
  await page.click("#btn-mailbox");
  await page.waitForSelector("#modal-mailbox:not([hidden])", { timeout: 5000 });
  const mailRow = page.locator(".mail-row").first();
  const mailRowClassBefore = await mailRow.getAttribute("class");
  console.log("우편 항목 클래스(mail-unread 포함돼야 함):", mailRowClassBefore);
  await page.click("#btn-mailbox-read-all");
  await page.waitForTimeout(150);
  const mailBadgeHiddenAfter = await page.locator("#mail-badge").isHidden();
  const mailRowClassAfter = await page.locator(".mail-row").first().getAttribute("class");
  console.log("모두 읽음 처리 후 배지 숨김(true여야 함):", mailBadgeHiddenAfter, "행 클래스:", mailRowClassAfter);
  await page.evaluate(() => document.getElementById("modal-mailbox").hidden = true);

  // ---------- 3. 랭킹(순위표) ----------
  await page.click("#btn-leaderboard");
  await page.waitForSelector("#modal-leaderboard:not([hidden])", { timeout: 5000 });
  await page.waitForFunction(() => document.querySelectorAll("#leaderboard-list .lb-row").length >= 2, { timeout: 8000 });
  const rows = await page.locator("#leaderboard-list .lb-row .lb-nickname").allInnerTexts();
  console.log("랭킹 목록 순서:", rows.join(", "));
  const meText = await page.locator("#leaderboard-me").innerText();
  console.log("내 순위 표시:", meText);
  const myRowClass = await page.locator(".lb-row.lb-me").getAttribute("class");
  console.log("내 행 강조 클래스:", myRowClass);

  const rankA = rows.indexOf(nickA);
  const rankB = rows.indexOf(nickB);

  const pass =
    (readyClass || "").includes("quest-ready") &&
    claimDisabledBefore === null &&
    toastText && toastText.includes("업적 완료") &&
    shardsAfter === 10 &&
    (claimedAfterClick || "").includes("quest-claimed") &&
    !mailBadgeHidden && mailBadgeText === "1" &&
    (mailRowClassBefore || "").includes("mail-unread") &&
    mailBadgeHiddenAfter === true &&
    !(mailRowClassAfter || "").includes("mail-unread") &&
    rankA !== -1 && rankB !== -1 && rankA < rankB &&
    meText.includes("1위") &&
    !!myRowClass;

  console.log(pass ? "\n✅ PASS: Tier 1(업적/퀘스트, 우편함, 랭킹) 전부 정상 동작" : "\n❌ FAIL");
  await page.screenshot({ path: "/tmp/tier1-content.png" });
  await browser.close();
  if (!pass) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
