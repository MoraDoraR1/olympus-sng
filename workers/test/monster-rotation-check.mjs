// 필드 몬스터 로테이션 검증: MONSTER_ROTATION_SECONDS(5분)가 지나면 필드 몬스터
// 구성이 통째로 바뀌어야 한다. 오프라인 캐치업(lastActiveAt을 5분+1초 과거로 돌린 뒤
// 새로고침 — applyOfflineProgress()가 그만큼의 tick()을 그대로 재생한다)을 이용해
// 결정론적으로 재현한다.
import { chromium } from "playwright";

const SITE = "http://127.0.0.1:8791";

async function main() {
  const rand = Math.floor(Math.random() * 1e6);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (err) => console.error("pageerror:", err.message));

  await page.goto(`${SITE}/index.html`, { waitUntil: "networkidle" });
  await page.fill("#login-nickname", `rot${rand}`);
  await page.fill("#login-password", "pass1234");
  await page.click("#btn-register-submit");
  await page.waitForSelector("#screen-title:not([hidden])", { timeout: 10000 });
  await page.click("#btn-start-game");
  await page.waitForSelector("#city-viewport:not([hidden])", { timeout: 10000 });
  await page.waitForTimeout(1200);

  function monsterKeys() {
    return page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("olympusSngSave_v5"));
      return s.monsters.map((m) => (m.monster ? `${m.monster.key}L${m.monster.level}` : null));
    });
  }
  const before = await monsterKeys();
  console.log("로테이션 전 필드 몬스터:", before.join(", "));

  // lastActiveAt을 5분(300초) + 1초 과거로 돌려서, 다음 새로고침 시 오프라인 캐치업이
  // 정확히 로테이션 주기를 한 번 넘기도록 만든다(300초 tick 재생 후 카운터가 소진돼
  // rotateFieldMonsters()가 한 번 호출되고 300으로 리셋된 뒤 1초 더 진행 → 최종 299).
  await page.evaluate(async () => {
    const save = JSON.parse(localStorage.getItem("olympusSngSave_v5"));
    save.monsterRotationTimer = 300;
    save.lastActiveAt = Date.now() - 301 * 1000;
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
  await page.waitForTimeout(500);

  const catchupToast = await page.locator("#toast-layer .toast").last().innerText().catch(() => null);
  console.log("오프라인 캐치업 토스트:", catchupToast);

  const after = await monsterKeys();
  console.log("로테이션 후(5분+1초 경과 재생) 필드 몬스터:", after.join(", "));
  const changedCount = after.filter((k, i) => k !== before[i]).length;
  console.log(`8칸 중 ${changedCount}칸이 바뀜(교전 중인 칸이 없으므로 8칸 모두 바뀌어야 함)`);

  const timerAfter = await page.evaluate(() => JSON.parse(localStorage.getItem("olympusSngSave_v5")).monsterRotationTimer);
  // 정확히 300초 시점에 리셋되지만, 새로고침 왕복에 걸린 실제 시간(네트워크 등)만큼
  // 더 재생되므로 300보다 살짝 낮은 값이 정상이다 — 음수/300 초과만 아니면 정상 동작.
  console.log("로테이션 후 타이머(0~300 사이, 정확히 300 초과는 안 됨):", timerAfter);

  const pass = changedCount === 8 && catchupToast && catchupToast.includes("계속 운영") && timerAfter >= 0 && timerAfter <= 300;
  console.log(pass ? "\n✅ PASS: 5분마다 필드 몬스터 전체가 새로 로테이션됨" : "\n❌ FAIL");

  await page.screenshot({ path: "/tmp/monster-rotation.png" });
  await browser.close();
  if (!pass) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
