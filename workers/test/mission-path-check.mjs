// Phase E 검증: 정복 맵 이동 경로가 뷰포트를 지나는 제3자에게도 보이는지 확인.
// 좌표는 로컬 D1을 직접 건드려 결정론적으로 배치한다(UNIQUE(x,y) 충돌을 피하려고
// 매 실행마다 무작위 베이스 좌표를 쓴다).
import { execSync } from "node:child_process";

const API = "http://127.0.0.1:8790";
const WORKERS_DIR = new URL("..", import.meta.url).pathname;

function fullTiles() {
  const empty = { type: null, built: false, level: 0, heroIds: [], training: null, upgrading: null };
  return {
    plot11: { ...empty }, defense: { type: "방어탑", built: false, level: 0, heroIds: [], training: null, upgrading: null },
    watch: { type: "감시탑", built: false, level: 0, heroIds: [], training: null, upgrading: null }, plot12: { ...empty },
    plot1: { ...empty }, academy: { type: "아카데미", built: false, level: 0, heroIds: [], training: null, upgrading: null },
    castle: { type: "성", built: true, level: 5, heroIds: [], training: null, upgrading: null },
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
function d1(sql) {
  execSync(`npx wrangler d1 execute olympus-sng-db --local --config wrangler.dev-api-only.jsonc --command "${sql}"`, { cwd: WORKERS_DIR, stdio: "pipe" });
}
// wrangler d1 execute --local이 같은 SQLite 파일을 잠깐 잠그면서, 동시에 떠 있는
// wrangler dev의 로컬 서버가 순간적으로 연결을 끊는 경우가 있다 — 재시도로 흡수한다.
async function fetchJsonRetry(url, opts, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      return await fetch(url, opts).then((r) => r.json());
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
}

async function main() {
  const rand = Math.floor(Math.random() * 1e6);
  const a = await fetch(`${API}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nickname: `mpa${rand}`, password: "pass1234" }) }).then((r) => r.json());
  const b = await fetch(`${API}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nickname: `mpb${rand}`, password: "pass1234" }) }).then((r) => r.json());
  const c = await fetch(`${API}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nickname: `mpc${rand}`, password: "pass1234" }) }).then((r) => r.json());

  await fetch(`${API}/api/state`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${a.token}` }, body: JSON.stringify({ state: baseState({ militia: 20 }) }) }).then((r) => r.json());
  await fetch(`${API}/api/state`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${b.token}` }, body: JSON.stringify({ state: baseState({ militia: 5 }) }) }).then((r) => r.json());
  await fetch(`${API}/api/state`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.token}` }, body: JSON.stringify({ state: baseState({}) }) }).then((r) => r.json());
  await fetch(`${API}/api/conquest/spawn`, { method: "POST", headers: { Authorization: `Bearer ${a.token}` } }).then((r) => r.json());
  await fetch(`${API}/api/conquest/spawn`, { method: "POST", headers: { Authorization: `Bearer ${b.token}` } }).then((r) => r.json());
  await fetch(`${API}/api/conquest/spawn`, { method: "POST", headers: { Authorization: `Bearer ${c.token}` } }).then((r) => r.json());

  const base = Math.floor(Math.random() * 140) + 10;
  d1(`UPDATE world_tiles SET x=${base}, y=${base}, protected_until=0 WHERE player_id=${a.player.id}`);
  d1(`UPDATE world_tiles SET x=${base + 10}, y=${base}, protected_until=0 WHERE player_id=${b.player.id}`);
  d1(`UPDATE world_tiles SET x=${base + 5}, y=${base}, protected_until=99999999999999 WHERE player_id=${c.player.id}`); // C는 관찰만 — 자기 보호는 무관하니 유지
  await new Promise((r) => setTimeout(r, 500)); // wrangler d1 execute --local 직후 dev 서버가 잠깐 끊길 수 있어 여유를 둔다

  // 로컬 D1은 이 세션에서 계속 재사용돼 다른 테스트가 남긴 미션이 우연히 같은 뷰포트에
  // 걸릴 수 있으므로, "뷰포트가 비어있었는지"가 아니라 "이번에 새로 만든 미션이 정확한
  // 좌표로 나타나는지"만 확인한다.
  const dispatch = await fetchJsonRetry(`${API}/api/conquest/attack`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${a.token}` },
    body: JSON.stringify({ targetPlayerId: b.player.id, squadIndex: 0, comp: { militia: 10 } }),
  });
  console.log("dispatch:", dispatch.error || `missionId ${dispatch.missionId}, 거리 ${dispatch.distance}칸, ${dispatch.travelSeconds}s`);

  const after = await fetchJsonRetry(`${API}/api/conquest/mission-paths?x0=${base - 5}&y0=${base - 5}&x1=${base + 20}&y1=${base + 5}`, { headers: { Authorization: `Bearer ${c.token}` } });
  const path = after.paths.find((p) => p.id === dispatch.missionId);
  console.log("공격 후 C가 본 경로 중 이번 미션:", JSON.stringify(path));

  const pass = !dispatch.error && !!path &&
    path.kind === "attack" && path.originX === base && path.originY === base && path.targetX === base + 10 && path.targetY === base;
  console.log(pass ? "\n✅ PASS: 제3자(당사자 아님)도 뷰포트를 지나는 이동 경로를 볼 수 있음" : "\n❌ FAIL");
  if (!pass) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
