// firestore.rules가 실제로 의도한 대로 막고 열어주는지 확인한다(작성만 하고 검증한 적이
// 없었던 부분). 클라이언트 SDK로 "직접" 규칙 위반 시도를 해보고 정말 거부되는지 확인한다.
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, collection, query, where, getDocs } from "firebase/firestore";

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

function nicknameToEmail(nickname) {
  return `u-${Buffer.from(nickname, "utf8").toString("hex")}@olympus-sng.local`;
}

let failed = 0;
function expect(cond, label) {
  if (cond) console.log(`    OK: ${label}`);
  else { console.log(`    FAIL: ${label}`); failed++; }
}
async function expectDenied(promise, label) {
  try {
    await promise;
    console.log(`    FAIL: ${label} (거부되지 않고 성공함)`);
    failed++;
  } catch (e) {
    const denied = e.code === "permission-denied";
    if (denied) console.log(`    OK: ${label} (permission-denied로 거부됨)`);
    else { console.log(`    FAIL: ${label} (거부는 됐지만 예상과 다른 에러: ${e.code} ${e.message})`); failed++; }
  }
}

async function newPlayer(prefix) {
  const nickname = prefix + Date.now().toString().slice(-5) + Math.floor(Math.random() * 1000);
  const email = nicknameToEmail(nickname);
  const cred = await createUserWithEmailAndPassword(auth, email, "test1234");
  await registerProfile({ nickname });
  await saveState({ state: { res: { food: 100, wood: 100, stone: 100, gold: 20000 }, tiles: { castle: { level: 5 } }, troopsByType: {}, owned: {}, raids: {} } });
  await conquestSpawn();
  return { uid: cred.user.uid, nickname, email };
}

async function main() {
  console.log("[준비] 계정 2개 생성");
  const A = await newPlayer("보안A");
  const B = await newPlayer("보안B");
  // createUserWithEmailAndPassword는 매번 그 계정으로 자동 로그인시키므로, B를 만든 직후
  // 현재 세션은 B다 — "A가 B의 문서를 읽는다"를 실제로 테스트하려면 다시 A로 전환해야 한다.
  await signInWithEmailAndPassword(auth, A.email, "test1234");

  console.log("\n[1] A가 로그인한 상태에서 B의 players 문서를 직접 읽으려 하면 거부돼야 함");
  await expectDenied(getDoc(doc(db, "players", B.uid)), "A -> players/B 읽기");

  console.log("\n[2] A가 로그인한 상태에서 본인 players 문서를 직접 쓰려 하면 거부돼야 함(Functions만 가능)");
  await expectDenied(setDoc(doc(db, "players", A.uid), { state: { res: { gold: 999999999 } } }, { merge: true }), "A -> players/A 직접 쓰기(치트 시도)");

  console.log("\n[3] A가 본인 playerItems 문서를 직접 쓰려 하면 거부돼야 함");
  await expectDenied(setDoc(doc(db, "playerItems", A.uid), { teleport: 999 }), "A -> playerItems/A 직접 쓰기(아이템 치트 시도)");

  console.log("\n[4] A가 로그인한 상태에서 worldTiles는 공개 조회가 허용돼야 함(지도 표시용)");
  try {
    const snap = await getDocs(query(collection(db, "worldTiles"), where("x", ">=", 0), where("x", "<=", 199), where("y", ">=", 0), where("y", "<=", 199)));
    expect(snap.size >= 2, `worldTiles 전체 공개 조회 허용됨 (조회된 타일 수: ${snap.size})`);
  } catch (e) {
    expect(false, `worldTiles 조회가 실패함: ${e.code} ${e.message}`);
  }

  console.log("\n[5] worldTiles에 직접 쓰기는 거부돼야 함(스폰/이동은 반드시 Functions 경유)");
  await expectDenied(setDoc(doc(db, "worldTiles", "0_0"), { playerId: A.uid, x: 0, y: 0 }), "A -> worldTiles 직접 쓰기(타일 강탈 시도)");

  console.log("\n[6] 로그아웃 상태(비로그인)에서는 본인이었던 문서도 읽으면 거부돼야 함");
  await signOut(auth);
  await expectDenied(getDoc(doc(db, "players", A.uid)), "비로그인 -> players/A 읽기");

  console.log(failed === 0 ? "\n모든 보안 규칙 검증 통과" : `\n${failed}건 실패 — firestore.rules 재검토 필요`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("테스트 실패:", e);
  process.exitCode = 1;
});
