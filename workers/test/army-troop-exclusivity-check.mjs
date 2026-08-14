// 군대 편성 버그 수정 검증: 부대1에 편성(lastComp)한 병사는 부대2/3의 "보유" 슬라이더
// 최댓값에서 제외되어야 한다(영웅과 같은 원칙 — 한 병사는 한 부대에만).
//
// 상태 주입은 페이지를 띄우기 전에 순수 fetch()로 서버에 직접 반영한다(다른 PvP 테스트와
// 동일한 패턴). 페이지를 먼저 띄운 뒤 reload로 주입하면, 최근 추가된 flushSyncOnUnload
// (pagehide 시 현재 메모리상의 state를 keepalive fetch로 즉시 flush하는 안전장치)가
// reload 도중 발동해 "아직 내 주입을 모르는 옛 메모리 state(militia:0)"로 방금 넣은 값을
// 덮어써버리는 경합이 생긴다 — 이건 그 안전장치가 의도대로 동작하는 것이라 테스트 쪽에서
// 페이지 로드 전에 상태를 확정짓는 방식으로 피해야 한다.
import { chromium } from "playwright";

const API = "http://127.0.0.1:8790";
const SITE = "http://127.0.0.1:8791";

function fullTiles() {
  const empty = { type: null, built: false, level: 0, heroIds: [], training: null, upgrading: null };
  return {
    plot11: { ...empty }, defense: { type: "방어탑", built: false, level: 0, heroIds: [], training: null, upgrading: null },
    watch: { type: "감시탑", built: false, level: 0, heroIds: [], training: null, upgrading: null }, plot12: { ...empty },
    plot1: { ...empty }, academy: { type: "아카데미", built: false, level: 0, heroIds: [], training: null, upgrading: null },
    castle: { type: "성", built: true, level: 1, heroIds: [], training: null, upgrading: null },
    storage: { type: "자원보호소", built: false, level: 0, heroIds: [], training: null, upgrading: null },
    plot2: { ...empty }, plot13: { ...empty }, plot3: { ...empty },
    tavern: { type: "여관", built: false, level: 0, heroIds: [], training: null, upgrading: null },
    plot4: { ...empty }, plot14: { ...empty }, plot5: { ...empty }, plot6: { ...empty }, plot7: { ...empty },
    plot8: { ...empty }, plot9: { ...empty }, plot10: { ...empty },
    wall: { type: "성벽", built: false, level: 0, heroIds: [] },
  };
}
function baseState(troops) {
  return {
    res: { food: 80, wood: 80, stone: 60, gold: 150 }, tiles: fullTiles(),
    troopsByType: Object.assign({ militia: 0, transport: 0, hoplite: 0, spartan: 0, myrmidon: 0, wagon: 0, ares_champion: 0 }, troops || {}),
    owned: {}, research: {}, tavern: { timer: 600, candidates: [null, null, null, null, null], resetCost: 30 },
    armies: [{ heroIds: [null, null, null], mission: null, lastComp: {} }, { heroIds: [null, null, null], mission: null, lastComp: {} }, { heroIds: [null, null, null], mission: null, lastComp: {} }],
    monsters: [], worldCastles: [], raids: {}, raidShards: 0, raidTickets: { t5: 0, t6: 0 }, lastActiveAt: Date.now(),
  };
}

async function main() {
  const rand = Math.floor(Math.random() * 1e6);
  const reg = await fetch(`${API}/api/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname: `army${rand}`, password: "pass1234" }),
  }).then((r) => r.json());
  const token = reg.token;
  await fetch(`${API}/api/state`, {
    method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ state: baseState({ militia: 15 }) }),
  }).then((r) => r.json());

  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (err) => console.error("pageerror:", err.message));

  await page.goto(`${SITE}/index.html`, { waitUntil: "networkidle" });
  await page.evaluate((t) => localStorage.setItem("olympusSngAuthToken", t), token);
  await page.reload({ waitUntil: "networkidle" }); // 이 시점엔 아직 앱이 부팅 전이라 flush로 덮어쓸 메모리 state가 없다
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
