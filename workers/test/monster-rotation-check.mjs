// 필드 몬스터 로테이션 검증: MONSTER_ROTATION_SECONDS(5분)가 지나면 필드 몬스터
// 구성이 통째로 바뀌어야 한다. 오프라인 캐치업(lastActiveAt을 5분+1초 과거로 돌린
// 상태로 처음 부팅 — applyOfflineProgress()가 그만큼의 tick()을 그대로 재생한다)을
// 이용해 결정론적으로 재현한다.
//
// 상태 주입은 페이지를 띄우기 전에 순수 fetch()로 서버에 직접 반영한다 — 이미 부팅된
// 페이지에서 reload로 주입하면, 최근 추가된 flushSyncOnUnload(pagehide 시 메모리상의
// 옛 state를 keepalive fetch로 즉시 flush)가 경합해 방금 넣은 값을 덮어써버린다.
// "before" 몬스터 구성도 직접 지정해서(전 칸 동일 종류/레벨) 굳이 페이지를 한 번 더
// 열어 확인할 필요 없이 로테이션 여부를 바로 판별할 수 있게 한다.
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
// 8칸 모두 같은 종류/레벨(플레이스홀더)로 고정 — 로테이션 후 하나라도 다르면 바뀐 것으로 판별.
const KNOWN_BEFORE = { key: "centaur", name: "켄타우로스", icon: "🐴", elite: false, level: 1, hp: 1, atk: 1, def: 1 };
function baseState(lastActiveAt, monsterRotationTimer) {
  return {
    res: { food: 80, wood: 80, stone: 60, gold: 150 }, tiles: fullTiles(),
    troopsByType: { militia: 0, transport: 0, hoplite: 0, spartan: 0, myrmidon: 0, wagon: 0, ares_champion: 0 },
    owned: {}, research: {}, tavern: { timer: 600, candidates: [null, null, null, null, null], resetCost: 30 },
    armies: [{ heroIds: [null, null, null], mission: null, lastComp: {} }, { heroIds: [null, null, null], mission: null, lastComp: {} }, { heroIds: [null, null, null], mission: null, lastComp: {} }],
    monsters: Array.from({ length: 8 }, (_, i) => ({ id: "m" + i, monster: { ...KNOWN_BEFORE }, respawnTimer: 0 })),
    monsterRotationTimer,
    worldCastles: [], raids: {}, raidShards: 0, raidTickets: { t5: 0, t6: 0 }, lastActiveAt,
  };
}

async function main() {
  const rand = Math.floor(Math.random() * 1e6);
  const reg = await fetch(`${API}/api/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname: `rot${rand}`, password: "pass1234" }),
  }).then((r) => r.json());
  const token = reg.token;

  // lastActiveAt을 5분(300초)+1초 과거로 둬서, 첫 부팅 시 오프라인 캐치업이 정확히
  // 로테이션 주기를 한 번 넘기도록 만든다.
  await fetch(`${API}/api/state`, {
    method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ state: baseState(Date.now() - 301 * 1000, 300) }),
  }).then((r) => r.json());

  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (err) => console.error("pageerror:", err.message));

  await page.goto(`${SITE}/index.html`, { waitUntil: "networkidle" });
  await page.evaluate((t) => localStorage.setItem("olympusSngAuthToken", t), token);
  await page.reload({ waitUntil: "networkidle" }); // 아직 부팅 전 — flush로 덮어쓸 메모리 state가 없다
  await page.waitForSelector("#screen-title:not([hidden])", { timeout: 10000 });
  await page.click("#btn-start-game");
  await page.waitForSelector("#city-viewport:not([hidden])", { timeout: 10000 });
  await page.waitForTimeout(300);

  const catchupToast = await page.locator("#toast-layer .toast").last().innerText().catch(() => null);
  console.log("오프라인 캐치업 토스트:", catchupToast);

  const after = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("olympusSngSave_v5"));
    return s.monsters.map((m) => (m.monster ? `${m.monster.key}L${m.monster.level}` : null));
  });
  console.log("로테이션 후(5분+1초 경과 재생) 필드 몬스터:", after.join(", "));
  const changedCount = after.filter((k) => k !== "centaurL1").length;
  // 무작위로 새 종류/레벨을 뽑다 보면 극히 드물게(한 칸당 약 1/300 확률) "before"
  // 플레이스홀더와 우연히 같은 조합이 나올 수 있다 — 로테이션 자체가 안 됐다는 뜻은
  // 아니므로, 8칸 중 최소 7칸(우연의 일치 1칸까지 허용)만 바뀌어도 통과로 본다.
  console.log(`8칸 중 ${changedCount}칸이 "before" 플레이스홀더(centaurL1)에서 바뀜(최소 7칸 이상 바뀌어야 함 — 나머지는 극히 드문 우연의 일치 허용)`);

  const timerAfter = await page.evaluate(() => JSON.parse(localStorage.getItem("olympusSngSave_v5")).monsterRotationTimer);
  // 정확히 300초 시점에 리셋되지만, 페이지 로드에 걸린 실제 시간만큼 더 재생되므로
  // 300보다 살짝 낮은 값이 정상이다 — 음수/300 초과만 아니면 정상 동작.
  console.log("로테이션 후 타이머(0~300 사이, 정확히 300 초과는 안 됨):", timerAfter);

  const pass = changedCount >= 7 && catchupToast && catchupToast.includes("계속 운영") && timerAfter >= 0 && timerAfter <= 300;
  console.log(pass ? "\n✅ PASS: 5분마다 필드 몬스터 전체가 새로 로테이션됨" : "\n❌ FAIL");

  await page.screenshot({ path: "/tmp/monster-rotation.png" });
  await browser.close();
  if (!pass) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
