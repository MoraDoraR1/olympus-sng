// resolveAttack(전투 판정)이 실제로 승패/피해/약탈까지 계산해 저장하는지 확인.
// wrangler dev(--config wrangler.dev-api-only.jsonc --port 8790)가 떠 있어야 한다.
const BASE = "http://127.0.0.1:8790";

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("  ok:", msg);
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// 테스트 중 별도 프로세스로 `wrangler d1 execute --local`을 돌리면(테스트 좌표 세팅용) 같은
// 로컬 sqlite 파일을 건드리면서 떠 있는 wrangler dev의 워커 인스턴스가 가끔 한 번 재시작되며
// 그 순간의 요청이 소켓 종료로 실패한다 — 앱 로직 문제가 아니라 로컬 dev 도구끼리의 경합이므로
// 1회 재시도로 흡수한다.
async function api(method, path, { token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
      const json = await res.json().catch(() => null);
      return { status: res.status, json };
    } catch (e) {
      if (attempt === 1) throw e;
      await sleep(1500);
    }
  }
}

async function register(nickname, password) {
  const r = await api("POST", "/api/auth/register", { body: { nickname, password } });
  assert(r.status === 200, `${nickname} 가입 성공`);
  return r.json;
}

async function main() {
  const rand = Math.floor(Math.random() * 1e6);
  const attacker = await register(`atk${rand}`, "pass1234");
  const defender = await register(`def${rand}`, "pass1234");

  const baseState = (troops) => ({
    res: { food: 5000, wood: 5000, stone: 5000, gold: 5000 },
    tiles: { castle: { level: 5 } },
    troopsByType: troops,
    owned: {},
    armies: [{ heroIds: [], mission: null }, { heroIds: [], mission: null }, { heroIds: [], mission: null }],
    raids: {},
  });
  // 압도적인 병력 차이(30 vs 5)로 승패를 확실하게 만든다 — TROOP_GRACE(20) 여유 안.
  await api("PUT", "/api/state", { token: attacker.token, body: { state: baseState({ militia: 20 }) } });
  await api("PUT", "/api/state", { token: defender.token, body: { state: baseState({ militia: 5 }) } });

  await api("POST", "/api/conquest/spawn", { token: attacker.token });
  await api("POST", "/api/conquest/spawn", { token: defender.token });

  const meAtk = (await api("GET", "/api/auth/me", { token: attacker.token })).json.player;
  const meDef = (await api("GET", "/api/auth/me", { token: defender.token })).json.player;

  const { execSync } = await import("node:child_process");
  const cwd = new URL("..", import.meta.url).pathname;
  const tx = rand % 190, ty = rand % 190;
  execSync(`npx wrangler d1 execute olympus-sng-db --local --command "UPDATE world_tiles SET x=${tx}, y=${ty} WHERE player_id=${meAtk.id}"`, { cwd, stdio: "pipe" });
  // 방금 스폰한 상태라 30분 보호막이 걸려 있다 — 공격 테스트를 위해 풀어준다.
  execSync(`npx wrangler d1 execute olympus-sng-db --local --command "UPDATE world_tiles SET x=${tx + 1}, y=${ty}, protected_until=0 WHERE player_id=${meDef.id}"`, { cwd, stdio: "pipe" });

  console.log("== 공격 dispatch (militia 20 vs 5, 거리 1타일) ==");
  const attack = await api("POST", "/api/conquest/attack", {
    token: attacker.token,
    body: { targetPlayerId: meDef.id, squadIndex: 0, comp: { militia: 20 } },
  });
  assert(attack.status === 200, "공격 dispatch 성공");
  console.log(`  arriveAt=${new Date(attack.json.arriveAt).toISOString()}`);

  const waitMs = Math.max(0, attack.json.arriveAt - Date.now()) + 8000;
  console.log(`  ${Math.round(waitMs / 1000)}초 대기(전투 판정)...`);
  await sleep(waitMs);

  const missions = await api("GET", "/api/conquest/missions", { token: attacker.token });
  const mission = missions.json.missions.find((m) => m.id === attack.json.missionId);
  assert(mission && mission.result, `전투가 판정되어 result가 채워짐 (phase=${mission && mission.phase})`);
  console.log("  result:", JSON.stringify(mission.result));
  assert(mission.result.attackerWins === true, "20 vs 5 압도적 병력이므로 공격자 승리");
  assert(mission.result.loot && mission.result.loot.gold > 0, "승리했으므로 골드 약탈 발생");
  assert(mission.phase === "returning", "전투 후 공격 부대는 returning으로 전환됨");

  const defState = await api("GET", "/api/state", { token: defender.token });
  assert(defState.json.state.res.gold < 5000, "방어자 골드가 약탈로 줄어듦");
  assert(defState.json.state.troopsByType.militia < 5, "방어자 병력이 패배로 줄어듦");

  console.log("\n전투 판정(resolveAttack) 시나리오 통과!");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
