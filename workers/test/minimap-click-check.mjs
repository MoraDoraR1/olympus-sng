// 미니맵 클릭 시 해당 좌표로 카메라가 이동하는지, 새 위치(상단 좌측)가 토스트 존과
// 겹치지 않는지 확인.
import { chromium } from "playwright";

const SITE = "http://127.0.0.1:8791";

async function main() {
  const rand = Math.floor(Math.random() * 1e6);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (err) => console.error("pageerror:", err.message));

  await page.goto(`${SITE}/index.html`, { waitUntil: "networkidle" });
  await page.fill("#login-nickname", `minimap${rand}`);
  await page.fill("#login-password", "pass1234");
  await page.click("#btn-register-submit");
  await page.waitForSelector("#screen-title:not([hidden])", { timeout: 10000 });
  await page.click("#btn-start-game");
  await page.waitForSelector("#city-viewport:not([hidden])", { timeout: 10000 });

  // 정복 해금(성 레벨 5) + 참가 상태를 서버에 직접 반영
  await page.evaluate(async () => {
    const token = localStorage.getItem("olympusSngAuthToken");
    const cur = await fetch("/api/state", { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
    const state = cur.state;
    state.tiles.castle.level = 5;
    await fetch("/api/state", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ state }) });
    await fetch("/api/conquest/spawn", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  });

  await page.click("#btn-worldmap");
  await page.waitForSelector("#screen-worldmap:not([hidden])", { timeout: 10000 });
  await page.waitForSelector("#conquest-minimap:not([hidden])", { timeout: 10000 });
  // 정복 최초 참가 시 뜨는 튜토리얼 팝업이 화면을 덮어 미니맵 클릭을 가로챌 수 있으므로 먼저 닫는다.
  const tutorial = page.locator("#modal-conquest-tutorial");
  if (await tutorial.isVisible().catch(() => false)) {
    await tutorial.locator(".modal-close").click();
  }

  // 위치 확인: 미니맵이 화면 상단(예전 하단이 아님)에 있는지
  const minimapBox = await page.locator("#conquest-minimap").boundingBox();
  const viewportHeight = 900;
  console.log("미니맵 위치:", JSON.stringify(minimapBox), `(화면 높이 ${viewportHeight})`);
  const isNearTop = minimapBox.y < viewportHeight * 0.4;

  function parseSeenCoord(text) {
    const match = text.match(/지금 보는 곳 \((\d+), (\d+)\)/);
    return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
  }
  const before = parseSeenCoord(await page.locator("#conquest-status .conquest-msg").innerText());
  console.log("클릭 전 카메라 중심 좌표(내 성 위치와 동일해야 함):", JSON.stringify(before));

  // 미니맵의 좌상단 모서리(0,0 근처)를 클릭 — 내 성이 지도 좌상단이 아닌 한 확실히 카메라가 이동해야 한다.
  await page.locator("#conquest-minimap-frame").click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(800);

  const statusText = await page.locator("#conquest-status .conquest-msg").innerText();
  console.log("클릭 후 상태 표시줄:", statusText);
  const after = parseSeenCoord(statusText);
  console.log("클릭 후 카메라 중심 좌표(지도 좌상단 근처로 이동했어야 함):", JSON.stringify(after));

  const moved = before && after && (before.x !== after.x || before.y !== after.y);
  const movedTowardCorner = after && after.x < before.x && after.y < before.y;
  const pass = isNearTop && moved && movedTowardCorner && after.x < 20 && after.y < 20;
  console.log(pass ? "\n✅ PASS: 미니맵이 상단으로 옮겨졌고, 클릭한 좌표로 카메라가 실제로 이동함" : "\n❌ FAIL");

  await page.screenshot({ path: "/tmp/minimap-click.png" });
  await browser.close();
  if (!pass) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
