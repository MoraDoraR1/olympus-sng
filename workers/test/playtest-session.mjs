// Phase F: 직접 플레이하며 밸런스 확인 — 신규 계정으로 실제 초반 플레이 흐름을
// 자동화해 관찰한다(건설 → 병영 훈련 → 필드 몬스터 사냥 → 자동 배치/편성 →
// 약 90초 방치 후 경제 상태 확인). 수치를 assert하는 회귀 테스트가 아니라
// "이 정도면 자연스러운가"를 판단하기 위한 관찰용 스크립트라 로그를 그대로 남긴다.
import { chromium } from "playwright";

const SITE = "http://127.0.0.1:8791";

async function main() {
  const rand = Math.floor(Math.random() * 1e6);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (err) => console.error("pageerror:", err.message));
  page.on("dialog", (d) => d.accept());

  await page.goto(`${SITE}/index.html`, { waitUntil: "networkidle" });
  await page.fill("#login-nickname", `playtest${rand}`);
  await page.fill("#login-password", "pass1234");
  await page.click("#btn-register-submit");
  await page.waitForSelector("#screen-title:not([hidden])", { timeout: 10000 });
  await page.click("#btn-start-game");
  await page.waitForSelector("#city-viewport:not([hidden])", { timeout: 10000 });
  await page.waitForTimeout(1200);

  async function dumpState(label) {
    const s = await page.evaluate(() => JSON.parse(localStorage.getItem("olympusSngSave_v5")));
    console.log(`\n--- ${label} ---`);
    console.log("res:", s.res);
    console.log("troopsByType:", s.troopsByType);
    const built = Object.entries(s.tiles).filter(([, t]) => t.built).map(([id, t]) => `${id}:${t.type}Lv${t.level}`);
    console.log("built tiles:", built.join(", "));
    return s;
  }

  await dumpState("게임 시작 직후");

  // 1) 농장 건설(빈 부지 하나 선택) — chooseType()이 선택 즉시 건설하고 모달도 스스로 닫는다
  const emptyPlot = page.locator(".plot.tile-empty").first();
  await emptyPlot.click();
  await page.waitForSelector("#modal-building:not([hidden])", { timeout: 5000 });
  await page.click(".type-choice[data-type='농장']");
  await page.waitForTimeout(300);
  await dumpState("농장 건설 후");

  // 2) 병영 건설
  const emptyPlot2 = page.locator(".plot.tile-empty").first();
  await emptyPlot2.click();
  await page.waitForSelector("#modal-building:not([hidden])", { timeout: 5000 });
  await page.click(".type-choice[data-type='병영']");
  await page.waitForTimeout(300);
  // chooseType()이 모달을 스스로 닫으므로, 훈련 UI를 보려면 방금 지은 병영을 다시 클릭해서 연다
  await page.locator(".plot:has-text('병영')").first().click();
  await page.waitForSelector("#modal-building:not([hidden])", { timeout: 5000 });

  // 3) 민병대 5명 훈련
  const maxAfford = await page.locator(".troop-type-row").first().locator(".tt-count").getAttribute("max");
  console.log("\n민병대 최대 훈련 가능 인원(현재 자원 기준):", maxAfford);
  await page.click("#modal-building .do-train[data-key='militia']");
  await page.waitForTimeout(300);
  const trainingStatus = await page.locator(".training-status").innerText();
  console.log("훈련 상태:", trainingStatus);
  await page.click("#modal-building .modal-close");

  // 4) 훈련 완료 대기 + 필드 몬스터 사냥 가능 여부 확인(전투력 대비 몬스터 레벨)
  await page.waitForTimeout(5000);
  const monsterInfo = await page.evaluate(() => {
    const slots = document.querySelectorAll("#monster-col-left .monster-card, #monster-col-right .monster-card, .monster-card");
    return Array.from(slots).slice(0, 4).map((el) => el.innerText.replace(/\s+/g, " ").trim());
  });
  console.log("\n필드 몬스터 목록(일부):", monsterInfo);

  await dumpState("훈련 완료 후");

  // 5) 자동 배치 / 자동 편성 사용
  await page.click("#btn-auto-assign");
  await page.waitForTimeout(300);
  await page.click("#btn-army");
  await page.waitForSelector("#modal-army:not([hidden])", { timeout: 5000 });
  await page.click("#do-auto-compose");
  await page.waitForTimeout(300);
  const armyPower = await page.locator(".power-num").innerText();
  const armyCapacity = await page.locator(".capacity-num").innerText();
  console.log("\n자동 편성 후 부대1 전투력/수송력:", armyPower, armyCapacity);
  await page.click("#modal-army .modal-close");

  // 6) 약 90초(실제 tick 90회) 동안의 경제 흐름 관찰
  const before = await dumpState("90초 대기 시작 시점");
  await page.waitForTimeout(90000);
  const after = await dumpState("90초 대기 후");

  console.log("\n=== 90초간 순변화 ===");
  ["food", "wood", "stone", "gold"].forEach((r) => {
    console.log(`${r}: ${before.res[r].toFixed(1)} -> ${after.res[r].toFixed(1)} (${(after.res[r] - before.res[r]).toFixed(1)})`);
  });

  await page.screenshot({ path: "/tmp/playtest-final.png" });
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
