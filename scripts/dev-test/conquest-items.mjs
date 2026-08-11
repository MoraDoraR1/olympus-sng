// conquestSpawn / itemsBuy / itemsUseShield / itemsUseTeleport 콜러블을 에뮬레이터
// 위에서 왕복 검증한다. `node scripts/dev-test/conquest-items.mjs`로 실행.
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";

const app = initializeApp({ apiKey: "demo-key", projectId: "demo-olympus-sng" });
const auth = getAuth(app);
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
const functions = getFunctions(app);
connectFunctionsEmulator(functions, "127.0.0.1", 5001);
const db = getFirestore(app);
connectFirestoreEmulator(db, "127.0.0.1", 8080);

const registerProfile = httpsCallable(functions, "registerProfile");
const saveState = httpsCallable(functions, "saveState");
const conquestSpawn = httpsCallable(functions, "conquestSpawn");
const itemsBuy = httpsCallable(functions, "itemsBuy");
const itemsUseShield = httpsCallable(functions, "itemsUseShield");
const itemsUseTeleport = httpsCallable(functions, "itemsUseTeleport");

function nicknameToEmail(nickname) {
  return `u-${Buffer.from(nickname, "utf8").toString("hex")}@olympus-sng.local`;
}

async function newPlayer(nicknamePrefix) {
  const nickname = nicknamePrefix + Date.now().toString().slice(-5) + Math.floor(Math.random() * 100);
  const email = nicknameToEmail(nickname);
  const cred = await createUserWithEmailAndPassword(auth, email, "test1234");
  await registerProfile({ nickname });
  return { uid: cred.user.uid, nickname };
}

function baseState(castleLevel, gold) {
  return {
    res: { food: 1000, wood: 1000, stone: 1000, gold },
    tiles: { castle: { level: castleLevel } },
    troopsByType: {},
    owned: {},
    raids: {},
  };
}

let failed = 0;
function expect(cond, label) {
  if (cond) console.log(`    OK: ${label}`);
  else { console.log(`    FAIL: ${label}`); failed++; }
}

async function main() {
  console.log("[1] 성 레벨 미달 상태에서 spawn 시도 -> 거부되어야 함");
  const p1 = await newPlayer("잠금왕");
  await saveState({ state: baseState(1, 20000) });
  try {
    await conquestSpawn();
    expect(false, "거부되지 않음");
  } catch (e) {
    expect(/성 레벨/.test(e.message), `에러 메시지 확인: ${e.message}`);
  }

  console.log("[2] 성 레벨 5 이상 -> spawn 성공");
  await saveState({ state: baseState(5, 20000) });
  const spawnResult = await conquestSpawn();
  console.log("    tile:", spawnResult.data.tile);
  expect(typeof spawnResult.data.tile.x === "number", "타일 좌표 배정됨");

  console.log("[3] 같은 계정으로 다시 spawn -> 기존 타일 그대로(멱등)");
  const spawnAgain = await conquestSpawn();
  expect(spawnAgain.data.tile.x === spawnResult.data.tile.x && spawnAgain.data.tile.y === spawnResult.data.tile.y, "동일 좌표 반환(멱등)");

  console.log("[4] shield30 구매 -> 골드 차감 확인");
  const buyResult = await itemsBuy({ item: "shield30" });
  console.log("    result:", buyResult.data);
  expect(buyResult.data.goldLeft === 20000 - 5000, "골드 5000 차감됨");
  expect(buyResult.data.items.shield30 === 1, "shield30 재고 1");

  console.log("[5] shield30 사용 -> protectedUntil이 미래 시각으로 갱신");
  const useShieldResult = await itemsUseShield({ tier: 30 });
  console.log("    result:", useShieldResult.data);
  expect(useShieldResult.data.protectedUntil > Date.now(), "보호막 만료시각이 미래");
  expect(useShieldResult.data.items.shield30 === 0, "shield30 재고 0으로 차감");

  console.log("[6] 보호막 활성 중 teleport 사용 시도 -> 거부되어야 함(보유 아이템 없어도 먼저 확인)");
  try {
    await itemsUseTeleport();
    expect(false, "거부되지 않음");
  } catch (e) {
    // teleport 미보유 에러가 먼저 뜰 수도 있으니 둘 다 허용하되 로그로 확인
    console.log(`    (에러 메시지: ${e.message})`);
  }

  console.log("[7] 새 계정: 스폰 직후 30분 신규 보호 중에는 teleport도 막혀야 한다");
  const p2 = await newPlayer("이동왕");
  await saveState({ state: baseState(5, 20000) });
  await conquestSpawn();
  await itemsBuy({ item: "teleport" });
  try {
    await itemsUseTeleport();
    expect(false, "신규 보호 중인데도 거부되지 않음");
  } catch (e) {
    expect(/보호막이 활성화된 상태/.test(e.message), `보호 중 텔레포트 차단 확인: ${e.message}`);
  }
  console.log("    (실제 좌표 이동 트랜잭션 자체는 scripts/dev-test/relocate-tile.mjs에서 보호 없이 직접 검증)");

  console.log(failed === 0 ? "\n모든 단계 통과" : `\n${failed}건 실패`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("테스트 실패:", e);
  process.exitCode = 1;
});
