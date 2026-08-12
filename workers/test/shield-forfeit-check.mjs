// Phase C 검증: 공격 시 자신의 보호막이 서버 권위로 해제되는지 확인.
// 신규 계정은 항상 30분 보호가 걸리므로, 방어자의 보호만 로컬 D1을 직접 건드려
// 풀어준다(운영 백엔드엔 손대지 않는 순수 로컬 테스트 전용 우회 — 커밋되는 서버
// 코드에는 어떤 백도어도 추가하지 않는다).
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const API = "http://127.0.0.1:8790";
const WORKERS_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function fullTiles(overrides) {
  const empty = { type: null, built: false, level: 0, heroIds: [], training: null, upgrading: null };
  const base = {
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
  return Object.assign(base, overrides);
}
function baseState(res, troops) {
  return {
    res, tiles: fullTiles({}),
    troopsByType: Object.assign({ militia: 0, transport: 0, hoplite: 0, spartan: 0, myrmidon: 0, wagon: 0, ares_champion: 0 }, troops || {}),
    owned: {}, research: {}, tavern: { timer: 600, candidates: [null, null, null, null, null], resetCost: 30 },
    armies: [{ heroIds: [null, null, null], mission: null, lastComp: {} }, { heroIds: [null, null, null], mission: null, lastComp: {} }, { heroIds: [null, null, null], mission: null, lastComp: {} }],
    monsters: [], worldCastles: [], raids: {}, raidShards: 0, raidTickets: { t5: 0, t6: 0 }, lastActiveAt: Date.now(),
  };
}

async function main() {
  const rand = Math.floor(Math.random() * 1e6);
  const atk = await fetch(`${API}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nickname: `sfa${rand}`, password: "pass1234" }) }).then((r) => r.json());
  const def = await fetch(`${API}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nickname: `sfd${rand}`, password: "pass1234" }) }).then((r) => r.json());

  await fetch(`${API}/api/state`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${atk.token}` }, body: JSON.stringify({ state: baseState({ food: 80, wood: 80, stone: 60, gold: 150 }, { militia: 20 }) }) }).then((r) => r.json());
  await fetch(`${API}/api/state`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${def.token}` }, body: JSON.stringify({ state: baseState({ food: 80, wood: 80, stone: 60, gold: 150 }, { militia: 5 }) }) }).then((r) => r.json());

  await fetch(`${API}/api/conquest/spawn`, { method: "POST", headers: { Authorization: `Bearer ${atk.token}` } }).then((r) => r.json());
  await fetch(`${API}/api/conquest/spawn`, { method: "POST", headers: { Authorization: `Bearer ${def.token}` } }).then((r) => r.json());

  // 방어자 보호만 로컬 D1에서 직접 해제(공격 자체가 통과하려면 필요) — 공격자 보호는 그대로 둔다.
  execSync(
    `npx wrangler d1 execute olympus-sng-db --local --config wrangler.dev-api-only.jsonc --command "UPDATE world_tiles SET protected_until = 0 WHERE player_id = ${def.player.id}"`,
    { cwd: WORKERS_DIR, stdio: "pipe" }
  );

  const meBefore = await fetch(`${API}/api/conquest/me`, { headers: { Authorization: `Bearer ${atk.token}` } }).then((r) => r.json());
  const wasProtected = meBefore.tile.protectedUntil > Date.now();
  console.log("공격자 보호 상태(공격 전):", wasProtected ? "보호 중" : "보호 없음", "(신규 스폰 — 보호 중이어야 함)");

  const dispatch = await fetch(`${API}/api/conquest/attack`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${atk.token}` },
    body: JSON.stringify({ targetPlayerId: def.player.id, squadIndex: 0, comp: { militia: 20 } }),
  }).then((r) => r.json());
  console.log("dispatch 응답:", dispatch);

  const meAfter = await fetch(`${API}/api/conquest/me`, { headers: { Authorization: `Bearer ${atk.token}` } }).then((r) => r.json());
  const stillProtected = meAfter.tile.protectedUntil > Date.now();
  console.log("공격자 보호 상태(공격 후):", stillProtected ? "여전히 보호 중" : "보호 해제됨");

  const pass = wasProtected && !dispatch.error && dispatch.shieldCleared === true && !stillProtected;
  console.log(pass ? "\n✅ PASS: 공격 시 자신의 보호막이 서버 권위로 해제됨" : "\n❌ FAIL");
  if (!pass) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
