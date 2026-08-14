// Tier 2 검증: 영웅 강화 상한 확장(5강→10강) + 레이드 보스 7~9번째(기간테스/우라노스/카오스) 체인.
//
// 상태 주입은 페이지를 띄우기 전에 순수 fetch()로 서버에 직접 반영한다(다른 테스트와
// 동일한 패턴 — flushSyncOnUnload와의 경합을 피하기 위함).
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
  return {
    res: { food: 80, wood: 80, stone: 60, gold: 150 }, tiles: fullTiles(),
    troopsByType: { militia: 0, transport: 0, hoplite: 0, spartan: 0, myrmidon: 0, wagon: 0, ares_champion: 0 },
    // 영웅 1번(★1)을 이미 5강(예전 상한)까지 올려둔 상태로 주입 — 조각을 넉넉히 줘서
    // 10강까지 이어서 올릴 수 있는지 확인한다.
    owned: { 1: { enhance: 5, shards: 200, count: 1 } },
    research: {}, tavern: { timer: 600, candidates: [null, null, null, null, null], resetCost: 30 },
    armies: [{ heroIds: [null, null, null], mission: null, lastComp: {} }, { heroIds: [null, null, null], mission: null, lastComp: {} }, { heroIds: [null, null, null], mission: null, lastComp: {} }],
    monsters: [], worldCastles: [],
    // 크로노스(6번째)를 24시간 이전에 처치해둔 상태 — 쿨다운 없이 7번째(기간테스)가
    // 곧바로 해금되는지 확인한다. 8·9번째(우라노스/카오스)는 아직 잠겨 있어야 한다.
    raids: { cronus: { defeated: true, lastDefeatedAt: Date.now() - 25 * 60 * 60 * 1000 } },
    raidShards: 0, raidTickets: { t5: 0, t6: 0 }, monsterKillsSinceGate: 0, lastActiveAt: Date.now(),
    dailyQuests: { resetAt: Date.now() + 20 * 60 * 1000, progress: { login: 1, goldProduced: 0, monstersKilled: 0, troopsTrained: 0, heroesRecruited: 0 }, claimed: {} },
    mailbox: [],
  };
}

async function main() {
  const rand = Math.floor(Math.random() * 1e6);
  const reg = await fetch(`${API}/api/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname: `t2${rand}`, password: "pass1234" }),
  }).then((r) => r.json());
  const token = reg.token;
  const put = await fetch(`${API}/api/state`, {
    method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ state: baseState() }),
  }).then((r) => r.json());
  if (put.error) throw new Error(`PUT /api/state 실패: ${put.error}`);

  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.on("pageerror", (err) => console.error("pageerror:", err.message));

  await page.goto(`${SITE}/index.html`, { waitUntil: "networkidle" });
  await page.evaluate((t) => localStorage.setItem("olympusSngAuthToken", t), token);
  await page.reload({ waitUntil: "networkidle" }); // 부팅 전 — flush로 덮어쓸 메모리 state가 없다
  await page.waitForSelector("#screen-title:not([hidden])", { timeout: 10000 });
  await page.click("#btn-start-game");
  await page.waitForSelector("#city-viewport:not([hidden])", { timeout: 10000 });
  await page.waitForTimeout(300);

  // ---------- 1. 영웅 강화 상한 10강 확장 ----------
  await page.click("#btn-heroes");
  await page.waitForSelector("#modal-heroes:not([hidden])", { timeout: 5000 });
  await page.click("#heroes-grid .codex-cell");
  await page.waitForTimeout(150);
  const detailBefore = await page.locator("#heroes-detail").innerText();
  console.log("강화 전 상세(강화 필요 18이 보여야 함, 아직 최고강화 아님):", detailBefore.split("\n").find((l) => l.includes("조각")));

  for (let i = 0; i < 5; i++) {
    const btn = page.locator("#heroes-detail .do-enhance");
    if (await btn.count() === 0) break;
    await btn.click();
    await page.waitForTimeout(100);
  }
  const detailAfter = await page.locator("#heroes-detail").innerText();
  console.log("5번 더 강화 시도 후 상세:", detailAfter.split("\n").find((l) => l.includes("조각") || l.includes("강)")));
  const enhanceBtnCountAfter = await page.locator("#heroes-detail .do-enhance").count();
  const savedEnhance = await page.evaluate(() => JSON.parse(localStorage.getItem("olympusSngSave_v5")).owned["1"].enhance);
  console.log("최종 저장된 강화 수치(10이어야 함):", savedEnhance, "/ 강화 버튼 남아있음(0이어야 함):", enhanceBtnCountAfter);
  await page.evaluate(() => document.getElementById("modal-heroes").hidden = true);

  // ---------- 2. 레이드 보스 7~9번째 체인 ----------
  await page.click("#btn-raid");
  await page.waitForSelector("#modal-raid:not([hidden])", { timeout: 5000 });
  const rowCount = await page.locator(".raid-row").count();
  console.log("레이드 보스 행 개수(9여야 함):", rowCount);

  const names = await page.locator(".raid-row .raid-name").allInnerTexts();
  console.log("보스 이름 목록:", names.map((n) => n.replace(/\s+/g, " ").trim()).join(" | "));

  const gigantesRow = page.locator(".raid-row").filter({ has: page.locator(".raid-name", { hasText: "기간테스" }) });
  const gigantesLocked = await gigantesRow.getAttribute("class");
  const gigantesHasAttackBtn = await gigantesRow.locator(".do-raid-attack").count();
  console.log("기간테스 행 클래스(locked 없어야 함):", gigantesLocked, "/ 도전 버튼 존재(1이어야 함):", gigantesHasAttackBtn);
  const gigantesReward = await gigantesRow.locator(".raid-reward").innerText();
  console.log("기간테스 보상 텍스트:", gigantesReward);

  const uranusRow = page.locator(".raid-row").filter({ has: page.locator(".raid-name", { hasText: "우라노스" }) });
  const uranusStatus = await uranusRow.locator(".raid-status.locked").innerText().catch(() => null);
  console.log("우라노스 잠금 상태 텍스트(기간테스 처치 필요라고 나와야 함):", uranusStatus);

  const chaosRow = page.locator(".raid-row").filter({ has: page.locator(".raid-name", { hasText: "카오스" }) });
  const chaosStatus = await chaosRow.locator(".raid-status.locked").innerText().catch(() => null);
  console.log("카오스 잠금 상태 텍스트(우라노스 처치 필요라고 나와야 함):", chaosStatus);

  const pass =
    detailBefore.includes("강화 필요 18") &&
    savedEnhance === 10 &&
    enhanceBtnCountAfter === 0 &&
    detailAfter.includes("최고 강화 +10강") &&
    rowCount === 9 &&
    (gigantesLocked || "").includes("raid-row") && !(gigantesLocked || "").includes("locked") &&
    gigantesHasAttackBtn === 1 &&
    gigantesReward.includes("65") && gigantesReward.includes("1,700,000") && gigantesReward.includes("1,020,000") &&
    (uranusStatus || "").includes("기간테스") &&
    (chaosStatus || "").includes("우라노스");

  console.log(pass ? "\n✅ PASS: 영웅 강화 10강 확장 + 레이드 보스 7~9번째 체인 정상 동작" : "\n❌ FAIL");
  await page.screenshot({ path: "/tmp/tier2-hero-raid.png" });
  await browser.close();
  if (!pass) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
