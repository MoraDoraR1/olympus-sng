// 실제 브라우저(Chromium)로 index.html을 열어 회원가입 -> 게임 시작 -> 정복 맵 진입까지
// 진짜 UI 클릭으로 확인한다. 사전 조건: 정적 서버(예: python3 -m http.server 8600)와
// Firebase 에뮬레이터(auth,firestore,functions)가 떠 있어야 한다.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
process.env.GCLOUD_PROJECT = "demo-olympus-sng";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
import { initializeApp as initAdminApp } from "firebase-admin/app";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:8600/index.html";
// 이 샌드박스의 Chromium은 프록시를 거쳐도 gstatic.com/fonts.googleapis.com에 닿지
// 못한다(별도 확인 완료 — curl은 되고 Chromium은 안 됨, 순수 샌드박스 네트워킹 문제).
// 실제 배포(GitHub Pages) 환경의 방문자 브라우저는 이 제약이 없으므로 프로덕션과는
// 무관하다 — 여기서는 미리 curl로 받아둔 동일 버전 파일을 라우트 가로채기로 대신
// 제공해서, 정작 검증하고 싶은 game.js의 Firebase 연동 로직 자체를 테스트한다.
const FB_VENDOR_DIR = "/tmp/claude-0/-home-user-olympus-sng/708fadc2-9ebb-5301-bbbb-021368b54fa9/scratchpad/fbvendor";

async function main() {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const page = await browser.newPage();
  await page.route("https://www.gstatic.com/firebasejs/**", (route) => {
    const filename = route.request().url().split("/").pop();
    route.fulfill({ contentType: "application/javascript", body: readFileSync(`${FB_VENDOR_DIR}/${filename}`) });
  });
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.route("https://fonts.gstatic.com/**", (route) => route.abort());
  const consoleErrors = [];
  page.on("console", (msg) => {
    console.log(`    [console.${msg.type()}] ${msg.text()}`);
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));
  page.on("requestfailed", (req) => console.log(`    [requestfailed] ${req.url()} -> ${req.failure()?.errorText}`));

  console.log("[1] 페이지 로드");
  await page.goto(BASE_URL);
  await page.waitForSelector("#screen-login", { state: "visible", timeout: 10000 });
  console.log("    OK: 로그인 화면 표시됨");
  const fbCheck = await page.evaluate(() => ({
    hasFirebase: typeof window.firebase !== "undefined",
    hasAuth: typeof window.firebase !== "undefined" && typeof window.firebase.auth === "function",
  }));
  console.log("    firebase 전역 로드 확인:", fbCheck);

  const nickname = "브라우저테스트" + Date.now().toString().slice(-5);
  console.log(`[2] 회원가입: ${nickname}`);
  await page.fill("#login-nickname", nickname);
  await page.fill("#login-password", "test1234");
  await page.click("#btn-register-submit");

  try {
    await page.waitForSelector("#screen-title", { state: "visible", timeout: 15000 });
    console.log("    OK: 회원가입 성공, 타이틀 화면으로 전환됨");
  } catch (e) {
    const hint = await page.locator("#login-hint").innerText().catch(() => "?");
    const err = await page.locator("#login-error").innerText().catch(() => "?");
    console.log(`    DEBUG login-hint="${hint}" login-error="${err}"`);
    throw e;
  }

  console.log("[3] 게임 시작");
  await page.click("#btn-start-game");
  await page.waitForSelector("#city-viewport", { state: "visible", timeout: 10000 });
  await page.waitForTimeout(1500); // tick() 몇 번 돌 시간

  const topbarText = await page.locator("#topbar").innerText().catch(() => "");
  console.log("    topbar:", topbarText.replace(/\s+/g, " ").slice(0, 200));

  console.log("[4] 새로고침 후 자동 로그인(onAuthStateChanged) 확인");
  await page.reload();
  await page.waitForSelector("#screen-title", { state: "visible", timeout: 15000 });
  console.log("    OK: 새로고침 후에도 로그인 세션 유지되어 타이틀 화면 표시됨");

  console.log("[5] 성 레벨을 5로 강제 설정(정복 맵 해금 조건) 후 정복 맵 진입");
  // afterLogin()은 로그인 시 Firestore의 저장된 state를 로컬보다 우선 적용하므로,
  // localStorage만 고쳐서는 다음 재로그인 때 되돌아간다 — Firestore 문서 자체를 고친다.
  const uid = await page.evaluate(() => firebase.auth().currentUser.uid);
  const adminApp = initAdminApp({ projectId: "demo-olympus-sng" }, "browser-smoke-admin");
  const adminDb = getAdminFirestore(adminApp);
  const playerRef = adminDb.collection("players").doc(uid);
  const playerSnap = await playerRef.get();
  const remoteState = playerSnap.data().state;
  remoteState.tiles.castle.level = 5;
  await playerRef.set({ state: remoteState }, { merge: true });
  await page.reload();
  await page.click("#btn-start-game");
  await page.waitForSelector("#city-viewport", { state: "visible", timeout: 10000 });
  await page.click("#btn-worldmap");
  await page.waitForSelector("#screen-worldmap", { state: "visible", timeout: 5000 });
  await page.waitForTimeout(1000);
  // renderWorldMap()이 폴링(CONQUEST_FETCH_INTERVAL_MS)마다 innerHTML을 통째로 다시
  // 그려서 Playwright의 "요소가 안정될 때까지 대기" 클릭 판정이 계속 재시도만 하다
  // 타임아웃날 수 있어, DOM 이벤트를 직접 발생시킨다(실제 클릭 핸들러 로직은 동일하게 탄다).
  const hasSpawnBtn = await page.evaluate(() => !!document.getElementById("btn-conquest-spawn"));
  if (hasSpawnBtn) {
    await page.evaluate(() => document.getElementById("btn-conquest-spawn").click());
    await page.waitForTimeout(1000);
    console.log("    OK: 정복 맵 참가(spawn) 버튼 클릭 완료");
  } else {
    console.log("    (spawn 버튼이 이미 없음 — 이미 참가된 상태일 수 있음, 계속 진행)");
  }
  const conquestStatus = await page.locator("#conquest-status").innerText().catch(() => "");
  console.log("    conquest-status:", conquestStatus.replace(/\s+/g, " "));
  if (!/내 위치/.test(conquestStatus)) throw new Error("spawn 후에도 내 위치가 표시되지 않음");

  // 정복 최초 해금 시 뜨는 튜토리얼 모달이 인벤토리 버튼을 가리므로 먼저 닫는다.
  const tutorialCloseBtn = page.locator("#modal-conquest-tutorial .modal-close");
  if (await tutorialCloseBtn.count()) {
    await page.evaluate(() => document.querySelector("#modal-conquest-tutorial .modal-close").click());
    await page.waitForTimeout(200);
  }

  console.log("[6] 인벤토리 모달 열기 -> 정복 아이템 섹션 로드 확인");
  await page.evaluate(() => document.getElementById("btn-inventory").click());
  await page.waitForSelector("#modal-inventory", { state: "visible", timeout: 5000 });
  await page.waitForTimeout(600); // refreshConquestItemsInfo (Firestore read) 대기
  const invText = await page.locator("#inventory-modal-body").innerText().catch(() => "");
  console.log("    inventory:", invText.replace(/\s+/g, " ").slice(0, 200));
  if (!/정복 아이템/.test(invText) || !/보호막/.test(invText)) throw new Error("인벤토리에 정복 아이템 섹션이 없음");

  // 구글 폰트는 이 테스트에서 의도적으로 차단했고(ERR_FAILED), 새로고침 도중 취소된
  // 요청(Firestore listen 채널/saveState)은 페이지 이동 자체가 원인인 정상적인 취소라
  // 실제 버그로 보지 않는다.
  const realErrors = consoleErrors.filter((e) => !/ERR_FAILED/.test(e));
  console.log("\n콘솔 에러 목록(필터링 후):", realErrors.length ? realErrors : "(없음)");
  await browser.close();

  if (realErrors.length) {
    console.log("\n일부 콘솔 에러 발생 — 위 목록 확인 필요");
    process.exitCode = 1;
  } else {
    console.log("\n모든 단계 통과, 콘솔 에러 없음");
  }
}

main().catch((e) => {
  console.error("테스트 실패:", e);
  process.exitCode = 1;
});
