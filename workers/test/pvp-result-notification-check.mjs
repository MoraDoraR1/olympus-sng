// 정복 맵 전투 결과 알림 검증: 공격자/피공격자 둘 다 GET /api/conquest/missions에서
// result와 seen(각자 독립적)을 받아야 하고, POST /api/conquest/missions/ack로 각자
// 확인 처리를 해도 상대방의 seen에는 영향이 없어야 한다.
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
async function fetchJsonRetry(url, opts, tries = 5) {
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
  const atk = await fetch(`${API}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nickname: `pna${rand}`, password: "pass1234" }) }).then((r) => r.json());
  const def = await fetch(`${API}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nickname: `pnd${rand}`, password: "pass1234" }) }).then((r) => r.json());

  // 공격자는 압도적인 병력, 방어자는 병력 없음 — 결과가 확실히 attackerWins=true가 되도록.
  await fetch(`${API}/api/state`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${atk.token}` }, body: JSON.stringify({ state: baseState({ food: 80, wood: 80, stone: 60, gold: 150 }, { militia: 20 }) }) }).then((r) => r.json());
  await fetch(`${API}/api/state`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${def.token}` }, body: JSON.stringify({ state: baseState({ food: 500, wood: 500, stone: 500, gold: 500 }, {}) }) }).then((r) => r.json());

  await fetch(`${API}/api/conquest/spawn`, { method: "POST", headers: { Authorization: `Bearer ${atk.token}` } }).then((r) => r.json());
  await fetch(`${API}/api/conquest/spawn`, { method: "POST", headers: { Authorization: `Bearer ${def.token}` } }).then((r) => r.json());

  const base = Math.floor(Math.random() * 140) + 10;
  d1(`UPDATE world_tiles SET x=${base}, y=${base}, protected_until=0 WHERE player_id=${atk.player.id}`);
  d1(`UPDATE world_tiles SET x=${base + 1}, y=${base}, protected_until=0 WHERE player_id=${def.player.id}`); // 1칸 거리 — 최단 이동시간(민병대 기준 18초)
  await new Promise((r) => setTimeout(r, 500));

  const dispatch = await fetchJsonRetry(`${API}/api/conquest/attack`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${atk.token}` },
    body: JSON.stringify({ targetPlayerId: def.player.id, squadIndex: 0, comp: { militia: 20 } }),
  });
  if (dispatch.error) throw new Error("공격 디스패치 실패: " + dispatch.error);
  console.log(`공격 디스패치: missionId ${dispatch.missionId}, 도착까지 ${dispatch.travelSeconds}s`);

  // 도착 + Durable Object 알람 처리 여유를 두고 대기
  await new Promise((r) => setTimeout(r, (dispatch.travelSeconds + 5) * 1000));

  const atkMissions = await fetchJsonRetry(`${API}/api/conquest/missions`, { headers: { Authorization: `Bearer ${atk.token}` } });
  const defMissions = await fetchJsonRetry(`${API}/api/conquest/missions`, { headers: { Authorization: `Bearer ${def.token}` } });
  const atkView = atkMissions.missions.find((m) => m.id === dispatch.missionId);
  const defView = defMissions.missions.find((m) => m.id === dispatch.missionId);
  console.log("공격자 시점:", JSON.stringify(atkView));
  console.log("피공격자 시점:", JSON.stringify(defView));

  const bothSeeResult = !!(atkView && atkView.result && defView && defView.result);
  const bothUnseenInitially = !!(atkView && atkView.seen === false && defView && defView.seen === false);
  const attackerWon = !!(atkView && atkView.result.attackerWins === true);

  // 공격자만 확인 처리 — 피공격자의 seen에는 영향 없어야 한다(독립적 추적).
  await fetchJsonRetry(`${API}/api/conquest/missions/ack`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${atk.token}` },
    body: JSON.stringify({ missionId: dispatch.missionId }),
  });
  const atkMissions2 = await fetchJsonRetry(`${API}/api/conquest/missions`, { headers: { Authorization: `Bearer ${atk.token}` } });
  const defMissions2 = await fetchJsonRetry(`${API}/api/conquest/missions`, { headers: { Authorization: `Bearer ${def.token}` } });
  const atkView2 = atkMissions2.missions.find((m) => m.id === dispatch.missionId);
  const defView2 = defMissions2.missions.find((m) => m.id === dispatch.missionId);
  const ackIndependent = !!(atkView2 && atkView2.seen === true && defView2 && defView2.seen === false);
  console.log("공격자 ack 후 — 공격자 seen:", atkView2 && atkView2.seen, "/ 피공격자 seen:", defView2 && defView2.seen);

  const pass = bothSeeResult && bothUnseenInitially && attackerWon && ackIndependent;
  console.log(pass
    ? "\n✅ PASS: 공격자/피공격자 둘 다 전투 결과를 받고, 확인 처리는 각자 독립적으로 동작함"
    : "\n❌ FAIL");
  if (!pass) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
