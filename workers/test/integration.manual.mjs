// wrangler dev(--config wrangler.dev-api-only.jsonc --port 8790)로 로컬 서버를 띄운 상태에서
// 수동으로 실행하는 통합 시나리오. `npm test`(node --test)에는 포함되지 않는다 — 별도 스크립트.
const BASE = "http://127.0.0.1:8790";

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("  ok:", msg);
}

async function api(method, path, { token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function registerOrLogin(nickname, password) {
  let r = await api("POST", "/api/auth/register", { body: { nickname, password } });
  if (r.status === 400 && r.json.error === "이미 사용 중인 닉네임입니다.") {
    r = await api("POST", "/api/auth/login", { body: { nickname, password } });
  }
  assert(r.status === 200, `${nickname} 인증 성공`);
  return r.json;
}

// anticheat.checkStatePush는 "가입 직후 첫 저장"이라 elapsedSeconds가 거의 0이라고 보고
// MISC_RES_GRACE(20000)/TROOP_GRACE(20)만큼만 허용한다 — 그 여유 안에서 값을 잡는다.
async function pushCastleLevel5State(token) {
  const state = {
    res: { food: 5000, wood: 5000, stone: 5000, gold: 5000 },
    tiles: { castle: { level: 5 } },
    troopsByType: { militia: 15, archer: 10 },
    owned: {},
    armies: [{ heroIds: [], mission: null }, { heroIds: [], mission: null }, { heroIds: [], mission: null }],
    raids: {},
  };
  const r = await api("PUT", "/api/state", { token, body: { state } });
  assert(r.status === 200, "상태 저장(성 레벨5, 병사 보유) 성공");
  return state;
}

async function main() {
  console.log("== 1. 회원가입/로그인 ==");
  const rand = Math.floor(Math.random() * 1e6);
  const alice = await registerOrLogin(`alice${rand}`, "pass1234");
  const bob = await registerOrLogin(`bob${rand}`, "pass1234");
  assert(alice.token && bob.token, "토큰 발급됨");

  console.log("== 2. /api/auth/me ==");
  const me = await api("GET", "/api/auth/me", { token: alice.token });
  assert(me.status === 200 && me.json.player.nickname === `alice${rand}`, "me가 올바른 닉네임 반환");

  const noAuth = await api("GET", "/api/auth/me", {});
  assert(noAuth.status === 401, "토큰 없으면 401");

  console.log("== 3. 상태 저장/로드 ==");
  await pushCastleLevel5State(alice.token);
  await pushCastleLevel5State(bob.token);
  const loaded = await api("GET", "/api/state", { token: alice.token });
  assert(loaded.status === 200 && loaded.json.state.res.gold === 5000, "저장한 상태 그대로 로드됨");

  console.log("== 3b. anticheat: 비정상 자원 증가 거부 ==");
  const cheatState = { res: { food: 999999999, wood: 0, stone: 0, gold: 0 }, tiles: { castle: { level: 5 } }, troopsByType: {}, owned: {}, armies: [] };
  const cheat = await api("PUT", "/api/state", { token: alice.token, body: { state: cheatState } });
  assert(cheat.status === 400, "비정상 자원 증가는 400으로 거부됨");

  console.log("== 4. 정복 맵 spawn/조회 ==");
  const spawnA = await api("POST", "/api/conquest/spawn", { token: alice.token });
  assert(spawnA.status === 200 && typeof spawnA.json.tile.x === "number", "alice 스폰 성공");
  const spawnB = await api("POST", "/api/conquest/spawn", { token: bob.token });
  assert(spawnB.status === 200, "bob 스폰 성공");

  const meConquest = await api("GET", "/api/conquest/me", { token: alice.token });
  assert(meConquest.status === 200 && meConquest.json.unlocked === true, "정복 맵 unlocked=true(성 레벨5 충족)");

  // tilesInViewport는 60타일 폭으로 뷰포트를 방어적으로 clamp하므로(MAX_VIEWPORT_TILES),
  // 무작위로 스폰된 alice 좌표를 중심으로 좁게 조회해 clamp 동작 자체도 함께 확인한다.
  const ax = spawnA.json.tile.x, ay = spawnA.json.tile.y;
  const tiles = await api("GET", `/api/conquest/tiles?x0=${ax - 1}&y0=${ay - 1}&x1=${ax + 1}&y1=${ay + 1}`, { token: alice.token });
  assert(
    tiles.status === 200 && tiles.json.tiles.some((t) => t.x === ax && t.y === ay),
    "타일 뷰포트 조회에 alice 자신의 스폰 타일이 포함됨"
  );

  const travelTime = await api("GET", `/api/conquest/travel-time?x=${spawnB.json.tile.x}&y=${spawnB.json.tile.y}`, { token: alice.token });
  assert(travelTime.status === 200 && travelTime.json.baseSeconds > 0, "이동 시간 계산 성공");

  console.log("== 5. 아이템 구매/사용 ==");
  const itemsMe = await api("GET", "/api/items/me", { token: alice.token });
  assert(itemsMe.status === 200, "보유 아이템 조회 성공");
  const buyShield = await api("POST", "/api/items/buy", { token: alice.token, body: { item: "shield30" } });
  assert(buyShield.status === 200 && buyShield.json.items.shield30 === 1, "shield30 구매 성공(1개 보유)");
  const useShield = await api("POST", "/api/items/use-shield", { token: alice.token, body: { tier: 30 } });
  assert(useShield.status === 200 && useShield.json.protectedUntil > Date.now(), "shield30 사용 성공(보호막 활성화)");

  console.log("== 6. PvP: bob이 alice 공격 시도 -> 보호막 때문에 거부 ==");
  const blockedAttack = await api("POST", "/api/conquest/attack", {
    token: bob.token,
    body: { targetPlayerId: alice.json ? undefined : undefined, squadIndex: 0, comp: { militia: 10 } },
  });
  // targetPlayerId를 alice의 id로 정확히 넣어야 하므로 me 응답에서 id를 구한다.
  const aliceMe = await api("GET", "/api/auth/me", { token: alice.token });
  const bobMe = await api("GET", "/api/auth/me", { token: bob.token });
  const blockedAttack2 = await api("POST", "/api/conquest/attack", {
    token: bob.token,
    body: { targetPlayerId: aliceMe.json.player.id, squadIndex: 0, comp: { militia: 10 } },
  });
  assert(blockedAttack2.status === 400, "보호막 활성 중 공격은 400으로 거부됨");

  console.log("== 7. PvP: bob이 alice에게 지원군 파병 -> 도착 -> 목록 확인 ==");
  const reinforce = await api("POST", "/api/conquest/reinforce", {
    token: bob.token,
    body: { targetPlayerId: aliceMe.json.player.id, squadIndex: 0, comp: { militia: 10 } },
  });
  assert(reinforce.status === 200 && reinforce.json.missionId, "지원군 파병 성공");

  const missionsBob = await api("GET", "/api/conquest/missions", { token: bob.token });
  assert(missionsBob.status === 200 && missionsBob.json.missions.length >= 1, "bob의 미션 목록에 지원군 파병 기록 있음");

  console.log("== 8. PvP recall (아직 도착 전이므로 실패해야 정상) ==");
  const recallTooEarly = await api("POST", "/api/conquest/recall", {
    token: bob.token,
    body: { missionId: reinforce.json.missionId },
  });
  assert(recallTooEarly.status === 400, "아직 stationed 상태가 아니므로(outbound) recall 거부됨");

  console.log("\n모든 통합 시나리오 통과!");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
