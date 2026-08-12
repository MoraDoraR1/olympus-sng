// 타이틀 화면 신전 배경 + 튜토리얼 캐러셀 검증: 튜토리얼 버튼 클릭 → 모달이 열리고,
// 이전/다음으로 스텝을 넘나들 수 있으며, 마지막 스텝에서 "완료"를 누르면 닫힌다.
import { chromium } from "playwright";

const SITE = "http://127.0.0.1:8791";

async function main() {
  const rand = Math.floor(Math.random() * 1e6);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (err) => console.error("pageerror:", err.message));

  await page.goto(`${SITE}/index.html`, { waitUntil: "networkidle" });
  await page.fill("#login-nickname", `tut${rand}`);
  await page.fill("#login-password", "pass1234");
  await page.click("#btn-register-submit");
  await page.waitForSelector("#screen-title:not([hidden])", { timeout: 10000 });

  await page.screenshot({ path: "/tmp/title-screen-with-temple.png" });

  await page.click("#btn-tutorial");
  await page.waitForSelector("#modal-tutorial:not([hidden])", { timeout: 5000 });
  const progress1 = await page.locator("#tutorial-progress").innerText();
  const title1 = await page.locator("#tutorial-step-body h3").innerText();
  console.log("첫 스텝:", progress1, title1);
  await page.screenshot({ path: "/tmp/tutorial-step1.png" });

  const prevDisabled = await page.locator("#tutorial-prev").isDisabled();
  console.log("첫 스텝에서 '이전' 버튼 비활성화:", prevDisabled);

  // 끝까지 "다음"을 눌러서 마지막 스텝까지 이동
  let lastProgress = progress1;
  let steps = 1;
  while (true) {
    const nextText = await page.locator("#tutorial-next").innerText();
    await page.click("#tutorial-next");
    steps++;
    if (nextText.includes("완료")) break;
    if (steps > 20) throw new Error("무한 루프 방지: 스텝이 너무 많음");
    await page.waitForTimeout(100);
    lastProgress = await page.locator("#tutorial-progress").innerText();
  }
  console.log(`총 ${steps}번째 클릭에서 완료 처리됨, 마지막 진행표시: ${lastProgress}`);

  const modalHiddenAfterComplete = await page.locator("#modal-tutorial").isHidden();
  console.log("완료 클릭 후 모달이 닫혔는가:", modalHiddenAfterComplete);

  // 다시 열어서 이전/다음 왕복이 잘 되는지 확인
  await page.click("#btn-tutorial");
  await page.waitForSelector("#modal-tutorial:not([hidden])", { timeout: 5000 });
  await page.click("#tutorial-next");
  await page.click("#tutorial-next");
  const progressAfterTwoNext = await page.locator("#tutorial-progress").innerText();
  await page.click("#tutorial-prev");
  const progressAfterPrev = await page.locator("#tutorial-progress").innerText();
  console.log("다음 2번 후:", progressAfterTwoNext, "/ 이전 1번 후:", progressAfterPrev);
  await page.click(".modal-close");

  const pass = progress1.startsWith("1 /") && prevDisabled && modalHiddenAfterComplete &&
    progressAfterTwoNext === "3 / 9" && progressAfterPrev === "2 / 9";
  console.log(pass ? "\n✅ PASS: 타이틀 튜토리얼 캐러셀 정상 동작" : "\n❌ FAIL");
  if (!pass) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
