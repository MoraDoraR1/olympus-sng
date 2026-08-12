// PvpCoordinator(Durable Object) 알람이 실제로 출정 도착/귀환을 판정하는지 확인하는
// 시나리오. wrangler dev(--config wrangler.dev-api-only.jsonc --port 8790)가 떠 있어야 한다.
// 거리 1타일 = militia 기준 60초 이동이므로, 실제로 60~70초씩 기다린다.
const BASE = "http://127.0.0.1:8790";

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("  ok:", msg);
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function api(method, path, { token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function register(nickname, password) {
  const r = await api("POST", "/api/auth/register", { body: { nickname, password } });
  assert(r.status === 200, `${nickname} 가입 성공`);
  return r.json;
}

async function main() {
  const rand = Math.floor(Math.random() * 1e6);
  const alice = await register(`sweepA${rand}`, "pass1234");
  const bob = await register(`sweepB${rand}`, "pass1234");

  const state = (extra) => ({
    res: { food: 5000, wood: 5000, stone: 5000, gold: 5000 },
    tiles: { castle: { level: 5 } },
    troopsByType: { militia: 15 },
    owned: {},
    armies: [{ heroIds: [], mission: null }, { heroIds: [], mission: null }, { heroIds: [], mission: null }],
    raids: {},
    ...extra,
  });
  await api("PUT", "/api/state", { token: alice.token, body: { state: state() } });
  await api("PUT", "/api/state", { token: bob.token, body: { state: state() } });

  const spawnA = await api("POST", "/api/conquest/spawn", { token: alice.token });
  const spawnB = await api("POST", "/api/conquest/spawn", { token: bob.token });
  assert(spawnA.status === 200 && spawnB.status === 200, "alice/bob 스폰 성공");
  console.log(`  (참고) alice=(${spawnA.json.tile.x},${spawnA.json.tile.y}) bob=(${spawnB.json.tile.x},${spawnB.json.tile.y})`);

  const meA = (await api("GET", "/api/auth/me", { token: alice.token })).json.player;

  // 거리를 1타일로 강제 조정해 이동 시간을 60초로 고정한다(무작위 스폰 좌표가 멀면 테스트가
  // 너무 오래 걸리므로 직접 D1을 건드려 테스트 환경만 조정 — 앱 로직 자체는 그대로 둔다).
  const { execSync } = await import("node:child_process");
  execSync(
    `npx wrangler d1 execute olympus-sng-db --local --command "UPDATE world_tiles SET x=10, y=10 WHERE player_id=${meA.id}"`,
    { cwd: new URL("..", import.meta.url).pathname, stdio: "pipe" }
  );
  const meB = (await api("GET", "/api/auth/me", { token: bob.token })).json.player;
  execSync(
    `npx wrangler d1 execute olympus-sng-db --local --command "UPDATE world_tiles SET x=11, y=10 WHERE player_id=${meB.id}"`,
    { cwd: new URL("..", import.meta.url).pathname, stdio: "pipe" }
  );

  console.log("== bob -> alice 지원군 파병 (거리 1타일, ~60초 이동) ==");
  const reinforce = await api("POST", "/api/conquest/reinforce", {
    token: bob.token,
    body: { targetPlayerId: meA.id, squadIndex: 0, comp: { militia: 10 } },
  });
  assert(reinforce.status === 200, "지원군 파병 dispatch 성공");
  console.log(`  travelSeconds=${reinforce.json.travelSeconds}, arriveAt=${new Date(reinforce.json.arriveAt).toISOString()}`);

  const waitMs = Math.max(0, reinforce.json.arriveAt - Date.now()) + 8000;
  console.log(`  ${Math.round(waitMs / 1000)}초 대기(Durable Object 알람이 도착 판정을 처리할 시간)...`);
  await sleep(waitMs);

  const missionsAfterArrive = await api("GET", "/api/conquest/missions", { token: bob.token });
  const mission = missionsAfterArrive.json.missions.find((m) => m.id === reinforce.json.missionId);
  assert(mission && mission.phase === "stationed", `PvpCoordinator 알람이 outbound->stationed 전이를 처리함 (실제 phase=${mission && mission.phase})`);

  console.log("== 이제 recall 가능해야 함 ==");
  const recall = await api("POST", "/api/conquest/recall", { token: bob.token, body: { missionId: reinforce.json.missionId } });
  assert(recall.status === 200, "stationed 상태에서 recall 성공");
  console.log(`  returnArriveAt=${new Date(recall.json.returnArriveAt).toISOString()}`);

  const waitReturnMs = Math.max(0, recall.json.returnArriveAt - Date.now()) + 8000;
  console.log(`  ${Math.round(waitReturnMs / 1000)}초 대기(귀환 완료 판정)...`);
  await sleep(waitReturnMs);

  const missionsAfterReturn = await api("GET", "/api/conquest/missions", { token: bob.token });
  const stillThere = missionsAfterReturn.json.missions.find((m) => m.id === reinforce.json.missionId);
  assert(!stillThere, "귀환 완료 후 미션이 목록에서 사라짐(completeReturn 처리됨)");

  const bobState = await api("GET", "/api/state", { token: bob.token });
  assert(bobState.json.state.troopsByType.militia === 15, "귀환한 병사(10명)가 bob의 troopsByType에 원상 복귀됨");

  console.log("\nPvpCoordinator Durable Object 알람 기반 스윕 시나리오 통과!");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
