// 이번 배치 검증: (1) 아직 도착하지 않은 공격 부대를 회군시킬 수 있는지(전투가 아예
// 벌어지지 않아야 함), (2) 압도적으로 밀린 수성전에서도 방어 측 병력이 전멸(100%)하지
// 않고 최소한의 잔존 병력이 남는지(90% 상한).
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
function baseState(res, troops) {
  return {
    res, tiles: fullTiles(),
    troopsByType: Object.assign({ militia: 0, transport: 0, hoplite: 0, spartan: 0, myrmidon: 0, wagon: 0, ares_champion: 0 }, troops || {}),
    owned: {}, research: {}, tavern: { timer: 600, candidates: [null, null, null, null, null], resetCost: 30 },
    armies: [{ heroIds: [null, null, null], mission: null, lastComp: {} }, { heroIds: [null, null, null], mission: null, lastComp: {} }, { heroIds: [null, null, null], mission: null, lastComp: {} }],
    monsters: [], worldCastles: [], raids: {}, raidShards: 0, raidTickets: { t5: 0, t6: 0 }, lastActiveAt: Date.now(),
  };
}
function d1(sql) {
  execSync(`npx wrangler d1 execute olympus-sng-db --local --config wrangler.dev-api-only.jsonc --command "${sql}"`, { cwd: WORKERS_DIR, stdio: "pipe" });
}
async function fetchJsonRetry(url, opts, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try { return await fetch(url, opts).then((r) => r.json()); }
    catch (e) { if (i === tries - 1) throw e; await new Promise((r) => setTimeout(r, 500 * (i + 1))); }
  }
}

async function testRecall() {
  const rand = Math.floor(Math.random() * 1e6);
  const a = await fetch(`${API}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nickname: `rca${rand}`, password: "pass1234" }) }).then((r) => r.json());
  const b = await fetch(`${API}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nickname: `rcb${rand}`, password: "pass1234" }) }).then((r) => r.json());
  await fetch(`${API}/api/state`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${a.token}` }, body: JSON.stringify({ state: baseState({ food: 80, wood: 80, stone: 60, gold: 150 }, { militia: 10 }) }) }).then((r) => r.json());
  await fetch(`${API}/api/state`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${b.token}` }, body: JSON.stringify({ state: baseState({ food: 80, wood: 80, stone: 60, gold: 150 }, { militia: 10 }) }) }).then((r) => r.json());
  await fetch(`${API}/api/conquest/spawn`, { method: "POST", headers: { Authorization: `Bearer ${a.token}` } }).then((r) => r.json());
  await fetch(`${API}/api/conquest/spawn`, { method: "POST", headers: { Authorization: `Bearer ${b.token}` } }).then((r) => r.json());

  // 거리를 멀리 둬서(50칸) 회군할 시간을 충분히 확보한다.
  const base = Math.floor(Math.random() * 100) + 10;
  d1(`UPDATE world_tiles SET x=${base}, y=${base}, protected_until=0 WHERE player_id=${a.player.id}`);
  d1(`UPDATE world_tiles SET x=${base + 50}, y=${base}, protected_until=0 WHERE player_id=${b.player.id}`);
  await new Promise((r) => setTimeout(r, 500));

  const dispatch = await fetchJsonRetry(`${API}/api/conquest/attack`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${a.token}` },
    body: JSON.stringify({ targetPlayerId: b.player.id, squadIndex: 0, comp: { militia: 10 } }),
  });
  console.log("A -> B 공격 디스패치(먼 거리):", dispatch.missionId, dispatch.travelSeconds + "s");

  const recall = await fetchJsonRetry(`${API}/api/conquest/recall`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${a.token}` },
    body: JSON.stringify({ missionId: dispatch.missionId }),
  });
  console.log("도착 전 회군 시도:", JSON.stringify(recall));

  const missionsAfter = await fetchJsonRetry(`${API}/api/conquest/missions`, { headers: { Authorization: `Bearer ${a.token}` } });
  const m = missionsAfter.missions.find((x) => x.id === dispatch.missionId);
  console.log("회군 후 미션 상태:", JSON.stringify(m));

  const bWaitedForBattle = await new Promise((resolve) => setTimeout(() => resolve(true), 3000));
  const bMissionsCheck = await fetchJsonRetry(`${API}/api/conquest/missions`, { headers: { Authorization: `Bearer ${b.token}` } });
  const bSeen = bMissionsCheck.missions.find((x) => x.id === dispatch.missionId);
  console.log("3초 후 B(피공격자) 시점 — 전투가 실제로 벌어지지 않았어야 함:", JSON.stringify(bSeen));

  const pass = !recall.error && m && m.phase === "returning" && !m.result && (!bSeen || !bSeen.result);
  console.log(pass ? "✅ PASS: 도착 전 공격 부대를 회군시키면 전투 없이 귀환함\n" : "❌ FAIL: 회군 기능\n");
  return pass;
}

async function testLossCap() {
  const rand = Math.floor(Math.random() * 1e6);
  const a = await fetch(`${API}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nickname: `lca${rand}`, password: "pass1234" }) }).then((r) => r.json());
  const b = await fetch(`${API}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nickname: `lcb${rand}`, password: "pass1234" }) }).then((r) => r.json());
  // 공격자 압도적 물량(아레스의 대전사 20명) vs 방어자 소수 민병대 20명 — 확실히 전멸급 패배가 나오게 구성.
  await fetch(`${API}/api/state`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${a.token}` }, body: JSON.stringify({ state: baseState({ food: 80, wood: 80, stone: 60, gold: 150 }, { ares_champion: 20 }) }) }).then((r) => r.json());
  await fetch(`${API}/api/state`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${b.token}` }, body: JSON.stringify({ state: baseState({ food: 80, wood: 80, stone: 60, gold: 150 }, { militia: 20 }) }) }).then((r) => r.json());
  await fetch(`${API}/api/conquest/spawn`, { method: "POST", headers: { Authorization: `Bearer ${a.token}` } }).then((r) => r.json());
  await fetch(`${API}/api/conquest/spawn`, { method: "POST", headers: { Authorization: `Bearer ${b.token}` } }).then((r) => r.json());

  const base = Math.floor(Math.random() * 100) + 120;
  d1(`UPDATE world_tiles SET x=${base}, y=${base}, protected_until=0 WHERE player_id=${a.player.id}`);
  d1(`UPDATE world_tiles SET x=${base + 1}, y=${base}, protected_until=0 WHERE player_id=${b.player.id}`);
  await new Promise((r) => setTimeout(r, 500));

  const dispatch = await fetchJsonRetry(`${API}/api/conquest/attack`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${a.token}` },
    body: JSON.stringify({ targetPlayerId: b.player.id, squadIndex: 0, comp: { ares_champion: 20 } }),
  });
  console.log("A(대전사 20) -> B(민병대 20) 압도적 공격:", dispatch.missionId, dispatch.travelSeconds + "s");
  await new Promise((r) => setTimeout(r, (dispatch.travelSeconds + 5) * 1000));

  const bMissions = await fetchJsonRetry(`${API}/api/conquest/missions`, { headers: { Authorization: `Bearer ${b.token}` } });
  const m = bMissions.missions.find((x) => x.id === dispatch.missionId);
  console.log("전투 결과:", JSON.stringify(m && m.result));

  const bState = await fetchJsonRetry(`${API}/api/state`, { headers: { Authorization: `Bearer ${b.token}` } });
  const survivingMilitia = (bState.state.troopsByType || {}).militia || 0;
  console.log("B의 방어 후 남은 민병대 수:", survivingMilitia, "(기대: 20명 전멸이 아니라 최소 일부 생존, ~10% 이상)");

  const pass = m && m.result && m.result.attackerWins === true && m.result.defenderLost < 20 && survivingMilitia > 0;
  console.log(pass ? "✅ PASS: 압도적으로 밀린 수성전에서도 병력이 전멸하지 않고 일부 생존함\n" : "❌ FAIL: 손실 상한\n");
  return pass;
}

async function main() {
  const r1 = await testRecall();
  const r2 = await testLossCap();
  if (!r1 || !r2) process.exit(1);
  console.log("🎉 전체 PASS");
}
main().catch((e) => { console.error(e); process.exit(1); });
