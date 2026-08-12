// 영웅 가챠 카드/도감 그리드 비주얼 폴리싱을 실제 브라우저에서 스크린샷으로 확인.
// static-proxy-server.mjs(8791) + wrangler dev(8790, --config wrangler.dev-api-only.jsonc)가
// 떠 있어야 한다.
import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (err) => console.error("pageerror:", err.message));

  await page.goto("http://127.0.0.1:8791/index.html", { waitUntil: "networkidle" });

  const rand = Math.floor(Math.random() * 1e6);
  await page.fill("#login-nickname", `visualcheck${rand}`);
  await page.fill("#login-password", "pass1234");
  await page.click("#btn-register-submit");
  await page.waitForSelector("#screen-title:not([hidden])", { timeout: 10000 });
  await page.click("#btn-start-game");
  await page.waitForSelector("#city-viewport:not([hidden])", { timeout: 10000 });

  // 여관 타일 클릭 -> 건설 모달 -> 건설하기
  await page.locator(".plot:has-text('여관')").first().click();
  await page.waitForSelector("#do-build", { timeout: 5000 });
  await page.click("#do-build");
  await page.waitForTimeout(300);

  // 다시 여관 타일 클릭 -> 이번엔 이미 건설됐으니 바로 탭 모달이 열림
  await page.locator(".plot:has-text('여관')").first().click();
  await page.waitForSelector("#modal-tavern:not([hidden])", { timeout: 5000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: "/tmp/visual-tavern.png" });
  console.log("saved /tmp/visual-tavern.png");

  // 영웅 도감 모달도 확인
  await page.click("#modal-tavern .modal-close");
  await page.waitForTimeout(200);
  await page.click("#btn-codex");
  await page.waitForSelector("#modal-codex:not([hidden])", { timeout: 5000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: "/tmp/visual-codex.png" });
  console.log("saved /tmp/visual-codex.png");

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
