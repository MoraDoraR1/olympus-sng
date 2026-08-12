// 군대 편성 버그 수정 검증: 부대1에 편성(lastComp)한 병사는 부대2/3의 "보유" 슬라이더
// 최댓값에서 제외되어야 한다(영웅과 같은 원칙 — 한 병사는 한 부대에만).
import { chromium } from "playwright";

const SITE = "http://127.0.0.1:8791";

async function main() {
  const rand = Math.floor(Math.random() * 1e6);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (err) => console.error("pageerror:", err.message));

  await page.goto(`${SITE}/index.html`, { waitUntil: "networkidle" });
  await page.fill("#login-nickname", `army${rand}`);
  await page.fill("#login-password", "pass1234");
  await page.click("#btn-register-submit");
  await page.waitForSelector("#screen-title:not([hidden])", { timeout: 10000 });
  await page.click("#btn-start-game");
  await page.waitForSelector("#city-viewport:not([hidden])", { timeout: 10000 });
  await page.waitForTimeout(1200); // 최소 한 번의 tick()이 localStorage에 저장되도록 대기

  // 민병대 15명을 직접 state에 주입(자원/훈련 절차 생략, 순수 편성 로직만 검증).
  // 로그인 계정은 새로고침 시 bootAuth()가 서버 state를 우선 적용하므로, localStorage뿐
  // 아니라 서버(PUT /api/state)에도 같은 값을 반영해야 한다.
  await page.evaluate(async () => {
    const save = JSON.parse(localStorage.getItem("olympusSngSave_v5"));
    save.troopsByType.militia = 15;
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

  await page.click("#btn-army");
  await page.waitForSelector("#modal-army:not([hidden])", { timeout: 5000 });

  // 부대1(기본 활성)에서 민병대 슬라이더를 15로 설정
  const slider = page.locator('.ac-input[data-key="militia"]');
  const maxBefore = await slider.getAttribute("max");
  console.log("부대1 진입 시 민병대 슬라이더 최댓값(전량 보유):", maxBefore);
  await slider.evaluate((el) => { el.value = "15"; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
  await page.waitForTimeout(200);

  // 부대2 탭으로 전환
  await page.click('.squad-tab[data-idx="1"]');
  await page.waitForTimeout(200);
  const slider2 = page.locator('.ac-input[data-key="militia"]');
  const max2 = await slider2.getAttribute("max");
  const val2 = await slider2.inputValue();
  const availText2 = await page.locator(".troop-comp-card").first().locator(".tc-avail").innerText();
  console.log("부대2 전환 후 민병대 슬라이더 최댓값(0이어야 함, 전부 부대1에 편성됨):", max2, "현재값:", val2);
  console.log("부대2의 보유 표시 텍스트:", availText2);

  // 부대3 탭도 확인
  await page.click('.squad-tab[data-idx="2"]');
  await page.waitForTimeout(200);
  const max3 = await page.locator('.ac-input[data-key="militia"]').getAttribute("max");
  console.log("부대3 민병대 슬라이더 최댓값:", max3);

  // 부대1로 돌아가면 여전히 15명이 편성되어 있어야 한다(자기 자신의 편성은 유지)
  await page.click('.squad-tab[data-idx="0"]');
  await page.waitForTimeout(200);
  const val1Again = await page.locator('.ac-input[data-key="militia"]').inputValue();
  console.log("부대1로 복귀 후 편성값(15 유지돼야 함):", val1Again);

  const pass = maxBefore === "15" && max2 === "0" && val2 === "0" && max3 === "0" && val1Again === "15";
  console.log(pass
    ? "\n✅ PASS: 부대1에 편성된 병사는 부대2/3에서 사용할 수 없음(최댓값 0으로 제외됨)"
    : "\n❌ FAIL");

  await page.screenshot({ path: "/tmp/army-exclusivity.png" });
  await browser.close();
  if (!pass) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
