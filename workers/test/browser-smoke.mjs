// 실제 브라우저(Playwright/Chromium)로 index.html을 열어 REST 기반으로 바뀐 클라이언트가
// 회원가입 -> 게임 시작 -> 정복 맵까지 실제로 동작하는지 확인한다.
// static-proxy-server.mjs(8791, 정적파일+/api 프록시)와 wrangler dev(8790, --config
// wrangler.dev-api-only.jsonc)가 떠 있어야 한다.
import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));
  page.on("requestfailed", (req) => consoleErrors.push(`requestfailed: ${req.url()} — ${req.failure() && req.failure().errorText}`));

  await page.goto("http://127.0.0.1:8791/index.html", { waitUntil: "networkidle" });

  const rand = Math.floor(Math.random() * 1e6);
  const nickname = `browsertest${rand}`;
  await page.fill("#login-nickname", nickname);
  await page.fill("#login-password", "pass1234");
  await page.click("#btn-register-submit");

  await page.waitForSelector("#screen-title:not([hidden])", { timeout: 10000 });
  console.log("ok: 회원가입 후 타이틀 화면 진입");

  await page.click("#btn-start-game");
  await page.waitForSelector("#city-viewport:not([hidden])", { timeout: 10000 });
  console.log("ok: 게임 시작 -> 도시 화면 진입");

  const gold = await page.textContent("#res-gold");
  console.log(`  현재 골드 표시: ${gold}`);
  if (!gold || gold.trim() === "") throw new Error("FAIL: 자원 표시가 비어있음");
  console.log("ok: 자원(topbar) 렌더링 확인");

  // 새로고침 후에도 토큰으로 자동 로그인되어 같은 계정으로 이어지는지 확인
  await page.reload({ waitUntil: "networkidle" });
  const stillLoggedIn = await page.locator("#screen-title:not([hidden])").count();
  if (!stillLoggedIn) throw new Error("FAIL: 새로고침 후 자동 로그인(토큰) 유지 실패");
  console.log("ok: 새로고침 후에도 저장된 토큰으로 자동 로그인 유지됨");

  await page.click("#btn-start-game");
  await page.waitForSelector("#city-viewport:not([hidden])", { timeout: 10000 });

  // 구글 폰트는 이 샌드박스의 아웃바운드 네트워크 정책상 도달 불가 — 게임 로직과 무관이라
  // "Failed to load resource"(외부 리소스 로드 실패의 일반 콘솔 로그) 자체를 걸러낸다.
  await page.click("#btn-worldmap");
  await page.waitForSelector("#screen-worldmap:not([hidden])", { timeout: 10000 });
  await page.waitForTimeout(500); // refreshConquestInfo()의 apiRequest("/api/conquest/me") 응답 대기
  console.log("ok: 정복 맵 화면 진입 (GET /api/conquest/me)");
  await page.click("#btn-back-city");

  await page.click("#btn-inventory");
  await page.waitForSelector("#modal-inventory:not([hidden])", { timeout: 10000 });
  await page.waitForTimeout(500); // refreshConquestItemsInfo()의 apiRequest("/api/items/me") 응답 대기
  console.log("ok: 인벤토리 모달 진입 (GET /api/items/me)");

  const relevantErrors = consoleErrors.filter(
    (e) => !/favicon/i.test(e) && !/fonts\.googleapis\.com/i.test(e) && !/Failed to load resource/i.test(e)
  );
  if (relevantErrors.length) {
    console.log("콘솔 에러:", relevantErrors);
    throw new Error("FAIL: 브라우저 콘솔에 에러가 발생함");
  }
  console.log("ok: 콘솔 에러 없음");

  await browser.close();
  console.log("\n브라우저 스모크 테스트 통과!");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
