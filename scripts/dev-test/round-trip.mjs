// 에뮬레이터가 떠 있는 상태에서 `node scripts/dev-test/round-trip.mjs`로 실행.
// 회원가입(Firebase Auth) -> registerProfile -> saveState -> Firestore 직접 read까지
// 왕복이 실제로 되는지 확인하는 개발용 스크립트(브라우저 없이 게임 클라이언트를 흉내).
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { getFirestore, connectFirestoreEmulator, doc, getDoc } from "firebase/firestore";

const app = initializeApp({ apiKey: "demo-key", projectId: "demo-olympus-sng" });
const auth = getAuth(app);
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
const functions = getFunctions(app);
connectFunctionsEmulator(functions, "127.0.0.1", 5001);
const db = getFirestore(app);
connectFirestoreEmulator(db, "127.0.0.1", 8080);

function nicknameToEmail(nickname) {
  const hex = Buffer.from(nickname, "utf8").toString("hex");
  return `u-${hex}@olympus-sng.local`;
}

async function main() {
  const nickname = "테스트왕" + Date.now().toString().slice(-4);
  const password = "test1234";
  const email = nicknameToEmail(nickname);

  console.log(`[1] 회원가입: ${nickname} (${email})`);
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  console.log(`    uid=${cred.user.uid}`);

  console.log("[2] registerProfile 호출");
  const registerProfile = httpsCallable(functions, "registerProfile");
  const regResult = await registerProfile({ nickname });
  console.log("    result:", regResult.data);

  console.log("[3] saveState 호출");
  const saveState = httpsCallable(functions, "saveState");
  const fakeState = { res: { food: 100, wood: 100, stone: 60, gold: 150 }, troopsByType: {}, raids: {} };
  const saveResult = await saveState({ state: fakeState });
  console.log("    result:", saveResult.data);

  console.log("[4] Firestore에서 본인 문서 직접 읽기");
  const snap = await getDoc(doc(db, "players", cred.user.uid));
  console.log("    doc:", JSON.stringify(snap.data()));

  console.log("[5] 재로그인 후 다시 saveState (정상적인 소폭 증가는 통과해야 함)");
  await signInWithEmailAndPassword(auth, email, password);
  const updatedState = { ...fakeState, res: { ...fakeState.res, food: 120 } };
  const saveResult2 = await saveState({ state: updatedState });
  console.log("    result:", saveResult2.data);

  console.log("[6] 비정상적으로 큰 증가는 거부되어야 함");
  try {
    await saveState({ state: { ...fakeState, res: { ...fakeState.res, food: 999999999 } } });
    console.log("    FAIL: 거부되지 않았음");
    process.exitCode = 1;
  } catch (e) {
    console.log(`    OK: 거부됨 (${e.message})`);
  }

  console.log("\n모든 단계 통과");
}

main().catch((e) => {
  console.error("테스트 실패:", e);
  process.exitCode = 1;
});
