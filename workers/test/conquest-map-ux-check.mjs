// 정복 맵 UX 개선(배경 패럴랙스, 지형 다양화, 실시간 좌표, 미니맵) 스크린샷 확인.
import { chromium } from "playwright";
import fs from "node:fs";

const TOKEN = fs.readFileSync("/tmp/map_token.env", "utf8").trim().split("=")[1];

async function main() {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (err) => console.error("pageerror:", err.message));

  await page.goto("http://127.0.0.1:8791/index.html", { waitUntil: "networkidle" });
  await page.evaluate((tok) => localStorage.setItem("olympusSngAuthToken", tok), TOKEN);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#screen-title:not([hidden])", { timeout: 10000 });
  await page.click("#btn-start-game");
  await page.waitForSelector("#city-viewport:not([hidden])", { timeout: 10000 });

  await page.click("#btn-worldmap");
  await page.waitForSelector("#screen-worldmap:not([hidden])", { timeout: 5000 });
  await page.waitForTimeout(1000);
  // 첫 정복 진입 시 뜨는 튜토리얼 모달이 드래그를 가로채므로 먼저 닫는다
  const tutorial = page.locator("#modal-conquest-tutorial:not([hidden])");
  if (await tutorial.count()) {
    await page.click("#modal-conquest-tutorial .modal-close");
    await page.waitForTimeout(200);
  }

  const terrainClasses = await page.locator(".conquest-cell").evaluateAll((els) =>
    [...new Set(els.map((e) => [...e.classList].find((c) => c.startsWith("terrain-"))))]
  );
  console.log("지형 클래스 종류:", terrainClasses);

  const statusText = await page.locator("#conquest-status").innerText();
  console.log("상태줄:", statusText.replace(/\s+/g, " ").trim());

  const minimapHidden = await page.locator("#conquest-minimap").getAttribute("hidden");
  console.log("미니맵 hidden 속성:", minimapHidden);
  const minimapDots = await page.locator("#conquest-minimap-frame .minimap-dot").count();
  const minimapMe = await page.locator("#conquest-minimap-frame .minimap-me").count();
  const minimapViewport = await page.locator("#conquest-minimap-frame .minimap-viewport").count();
  console.log("미니맵 dot 수:", minimapDots, "/ me:", minimapMe, "/ viewport rect:", minimapViewport);

  const bgPos1 = await page.evaluate(() => getComputedStyle(document.getElementById("worldmap-field")).backgroundPosition);
  console.log("드래그 전 배경 위치:", bgPos1);

  // 드래그로 카메라 이동
  const viewport = page.locator("#worldmap-viewport");
  const box = await viewport.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 300, box.y + box.height / 2 - 200, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const bgPos2 = await page.evaluate(() => getComputedStyle(document.getElementById("worldmap-field")).backgroundPosition);
  console.log("드래그 후 배경 위치:", bgPos2);
  console.log("배경이 실제로 움직였는가:", bgPos1 !== bgPos2 ? "YES" : "NO (버그)");

  const statusText2 = await page.locator("#conquest-status").innerText();
  console.log("드래그 후 상태줄:", statusText2.replace(/\s+/g, " ").trim());

  await page.screenshot({ path: "/tmp/conquest-map-ux.png" });
  console.log("saved /tmp/conquest-map-ux.png");

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
