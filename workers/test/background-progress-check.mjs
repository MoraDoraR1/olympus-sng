// 백그라운드/오프라인 진행 검증: 탭을 닫았다 열거나(또는 브라우저가 백그라운드에서
// 타이머를 완전히 멈췄다가) 나중에 돌아왔을 때, 실제 경과 시간만큼 생산이 정확히
// 캐치업되는지 확인한다(game.js의 applyOfflineProgress(), visibilitychange 핸들러가
// 게임 세션 도중에도 동일한 함수를 호출한다).
import { chromium } from "playwright";

const SITE = "http://127.0.0.1:8791";

async function main() {
  const rand = Math.floor(Math.random() * 1e6);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (err) => console.error("pageerror:", err.message));

  await page.goto(`${SITE}/index.html`, { waitUntil: "networkidle" });
  await page.fill("#login-nickname", `bgtest${rand}`);
  await page.fill("#login-password", "pass1234");
  await page.click("#btn-register-submit");
  await page.waitForSelector("#screen-title:not([hidden])", { timeout: 10000 });
  await page.click("#btn-start-game");
  await page.waitForSelector("#city-viewport:not([hidden])", { timeout: 10000 });
  await page.waitForTimeout(1200); // 최소 한 번의 tick()이 localStorage에 저장되도록 대기

  const goldBefore = await page.evaluate(() => JSON.parse(localStorage.getItem("olympusSngSave_v5")).res.gold);
  console.log("종료 전 골드:", goldBefore);

  // 실제로 탭을 닫고 30분 뒤에 돌아온 것과 동일한 조건을 만든다 — lastActiveAt을
  // 과거로 되돌린 뒤 페이지를 새로고침(재로드)한다. 로그인된 계정은 재로드 시
  // bootAuth()가 서버에 저장된 state를 우선해서 덮어쓰므로, localStorage뿐 아니라
  // 서버(PUT /api/state)에도 같은 값을 반영해야 한다.
  await page.evaluate(async () => {
    const save = JSON.parse(localStorage.getItem("olympusSngSave_v5"));
    save.lastActiveAt = Date.now() - 30 * 60 * 1000;
    localStorage.setItem("olympusSngSave_v5", JSON.stringify(save));
    const token = localStorage.getItem("olympusSngAuthToken");
    await fetch("/api/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ state: save }),
    });
  });
  await page.reload({ waitUntil: "networkidle" });
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
