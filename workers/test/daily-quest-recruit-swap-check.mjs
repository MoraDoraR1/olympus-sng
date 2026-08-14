// 일일 업적 교체 검증(2차): 처음엔 "정복 맵 공격 1회 보내기"(성 레벨 5 미만이면 애초에
// 채울 수 없음)를 "건물 레벨업 1회 완료하기"로 바꿨었는데, 이번엔 그것도 전 건물이
// 만렙(20)에 도달하면 더는 채울 수 없다는 지적을 받아 "여관에서 영웅 1회 영입하기"로
// 다시 교체했다 — 여관 영입은 레벨 상한도 하한도 없어(항상 후보가 있고, 중복은 조각으로
// 전환) 어느 진행 단계에서도 채울 수 있다. addOwned() 호출 시 진행도가 오르는지 확인한다.
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
    // 여관을 이미 건설된 상태로 두고, 후보 1자리에 ★1 영웅(id 1, 영입가 5골드)을
    // 채워둬 곧바로 영입 버튼을 클릭할 수 있게 한다.
    tavern: { type: "여관", built: true, level: 1, heroIds: [], training: null, upgrading: null },
    plot4: { ...empty }, plot14: { ...empty }, plot5: { ...empty }, plot6: { ...empty }, plot7: { ...empty },
    plot8: { ...empty }, plot9: { ...empty }, plot10: { ...empty },
    wall: { type: "성벽", built: false, level: 0, heroIds: [] },
  };
}
function baseState() {
  return {
    res: { food: 80, wood: 80, stone: 60, gold: 150 }, tiles: fullTiles(),
    troopsByType: { militia: 0, transport: 0, hoplite: 0, spartan: 0, myrmidon: 0, wagon: 0, ares_champion: 0 },
    owned: {}, research: {},
    tavern: { timer: 600, candidates: [1, null, null, null, null], resetCost: 30 },
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
    body: JSON.stringify({ nickname: `qsw2${rand}`, password: "pass1234" }),
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
  await page.waitForTimeout(300);

  // 업적 목록에서 새 문구를 먼저 확인하고("정복 맵 공격"/"건물 레벨업" 둘 다 없어야 함),
  // 아직 미완료(진행중) 상태인지 확인한다.
  await page.click("#btn-quests");
  await page.waitForSelector("#modal-quests:not([hidden])", { timeout: 5000 });
  const recruitRow = page.locator(".quest-row", { hasText: "여관에서 영웅 1회 영입하기" });
  console.log("'여관에서 영웅 1회 영입하기' 업적 행 존재(1이어야 함):", await recruitRow.count());
  console.log("영입 전 클래스(quest-ready 없어야 함):", await recruitRow.getAttribute("class"));
  console.log("'정복 맵 공격' 업적 잔존 여부(0이어야 함):", await page.locator(".quest-row", { hasText: "정복 맵 공격" }).count());
  console.log("'건물 레벨업' 업적 잔존 여부(0이어야 함):", await page.locator(".quest-row", { hasText: "건물 레벨업" }).count());
  await page.evaluate(() => document.getElementById("modal-quests").hidden = true);

  // 여관 타일을 클릭해 실제로 영웅을 영입한다.
  await page.locator(".plot").filter({ has: page.locator(".name", { hasText: "여관" }) }).click();
  await page.waitForSelector("#modal-tavern:not([hidden])", { timeout: 5000 });
  await page.click(".do-recruit");
  await page.waitForTimeout(200);
  await page.evaluate(() => document.getElementById("modal-tavern").hidden = true);

  await page.click("#btn-quests");
  await page.waitForSelector("#modal-quests:not([hidden])", { timeout: 5000 });
  const rowClassAfter = await recruitRow.getAttribute("class");
  console.log("영입 후 클래스(quest-ready 포함돼야 함):", rowClassAfter);
  const claimBtn = recruitRow.locator(".quest-claim-btn");
  await claimBtn.click();
  await page.waitForTimeout(200);
  const toastText = await page.locator("#toast-layer .toast").last().innerText().catch(() => null);
  console.log("수령 토스트:", toastText);
  const goldAfter = await page.evaluate(() => JSON.parse(localStorage.getItem("olympusSngSave_v5")).res.gold);
  console.log("수령 후 골드(영입비 5 지출 + 보상 1000 반영돼 145 이상이어야 함):", goldAfter);

  const pass =
    (await recruitRow.count()) === 1 &&
    (await page.locator(".quest-row", { hasText: "정복 맵 공격" }).count()) === 0 &&
    (await page.locator(".quest-row", { hasText: "건물 레벨업" }).count()) === 0 &&
    (rowClassAfter || "").includes("quest-ready") &&
    toastText && toastText.includes("여관에서 영웅 1회 영입하기") &&
    goldAfter >= 145 + 1000;

  console.log(pass ? "\n✅ PASS: 일일 업적 교체(건물 레벨업→여관 영입) 정상 동작" : "\n❌ FAIL");
  await page.screenshot({ path: "/tmp/daily-quest-recruit-swap.png" });
  await browser.close();
  if (!pass) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
