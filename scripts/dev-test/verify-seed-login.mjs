// create-seed-account.mjs로 만든 "테스트유저" 계정이 실제 게임 화면에서 정상적으로
// 로그인/렌더링되는지 확인한다(콘솔 에러 없이 도시 화면까지 뜨는지).
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const FB_VENDOR_DIR = "/tmp/claude-0/-home-user-olympus-sng/708fadc2-9ebb-5301-bbbb-021368b54fa9/scratchpad/fbvendor";

async function main() {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const page = await browser.newPage();
  const errors = [];
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  page.on("pageerror", (err) => errors.push("pageerror: " + err.message));
  await page.route("https://www.gstatic.com/firebasejs/**", (route) => {
    const filename = route.request().url().split("/").pop();
    route.fulfill({ contentType: "application/javascript", body: readFileSync(`${FB_VENDOR_DIR}/${filename}`) });
  });
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.route("https://fonts.gstatic.com/**", (route) => route.abort());

  await page.goto("http://127.0.0.1:8600/index.html");
  await page.waitForSelector("#screen-login", { state: "visible", timeout: 10000 });
  await page.fill("#login-nickname", "테스트유저");
  await page.fill("#login-password", "test1234");
  await page.click("#login-form button[type=submit], #login-form"); // 로그인 버튼이 form submit
  await page.locator("#login-form").evaluate((f) => f.requestSubmit ? f.requestSubmit() : f.submit());
  await page.waitForSelector("#screen-title", { state: "visible", timeout: 15000 });
  await page.evaluate(() => document.getElementById("btn-start-game").click());
  await page.waitForSelector("#city-viewport", { state: "visible", timeout: 10000 });
  await page.waitForTimeout(1000);

  const topbar = await page.locator("#topbar").innerText();
  console.log("topbar:", topbar.replace(/\s+/g, " ").slice(0, 200));
  const boardHTML = await page.locator("#board").innerText().catch(() => "");
  console.log("board(요약):", boardHTML.replace(/\s+/g, " ").slice(0, 300));

  await browser.close();
  console.log(errors.length ? `\n콘솔 에러: ${JSON.stringify(errors)}` : "\n콘솔 에러 없음 — 시드 계정 정상 로그인/렌더링 확인");
  process.exitCode = errors.length ? 1 : 0;
}

main().catch((e) => { console.error("실패:", e); process.exitCode = 1; });
