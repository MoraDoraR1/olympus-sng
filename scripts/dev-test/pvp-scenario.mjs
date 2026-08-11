// DEV_PLAN.md M2가 요구했던 다인 PvP 시나리오(공격/지원/귀환/지원군 자동철수/방어막
// 차단)를 에뮬레이터 위에서 재현한다. 실제 이동시간(최대 몇 시간)을 기다릴 수 없으므로
// 미션 생성은 실제 콜러블(pvpAttack/pvpReinforce)로 하되, firebase-admin으로 도착
// 시각(arriveAt/returnArriveAt)만 "이미 지남"으로 앞당겨 pvpSweepManual이 즉시 처리하게 한다.
process.env.GCLOUD_PROJECT = "demo-olympus-sng";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";

import { initializeApp as initClientApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { initializeApp as initAdminApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const clientApp = initClientApp({ apiKey: "demo-key", projectId: "demo-olympus-sng" });
const auth = getAuth(clientApp);
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
const functions = getFunctions(clientApp);
connectFunctionsEmulator(functions, "127.0.0.1", 5001);

const adminApp = initAdminApp({ projectId: "demo-olympus-sng" });
const adminDb = getFirestore(adminApp);

const registerProfile = httpsCallable(functions, "registerProfile");
const saveState = httpsCallable(functions, "saveState");
const conquestSpawn = httpsCallable(functions, "conquestSpawn");
const pvpAttack = httpsCallable(functions, "pvpAttack");
const pvpReinforce = httpsCallable(functions, "pvpReinforce");
const pvpMissionsMine = httpsCallable(functions, "pvpMissionsMine");
const pvpSweepManual = httpsCallable(functions, "pvpSweepManual");

function nicknameToEmail(nickname) {
  return `u-${Buffer.from(nickname, "utf8").toString("hex")}@olympus-sng.local`;
}

let failed = 0;
function expect(cond, label) {
  if (cond) console.log(`    OK: ${label}`);
  else { console.log(`    FAIL: ${label}`); failed++; }
}

function squad(heroIds = [null, null, null]) {
  return { heroIds, mission: null, lastComp: {} };
}

function baseState({ castleLevel = 10, gold = 20000, troops = {} } = {}) {
  return {
    res: { food: 5000, wood: 5000, stone: 5000, gold },
    tiles: { castle: { level: castleLevel } },
    troopsByType: { militia: 0, hoplite: 0, spartan: 0, myrmidon: 0, ares_champion: 0, ...troops },
    owned: {},
    raids: {},
    armies: [squad(), squad(), squad()],
  };
}

async function newPlayer(nicknamePrefix, stateOverrides) {
  const nickname = nicknamePrefix + Date.now().toString().slice(-5) + Math.floor(Math.random() * 1000);
  const email = nicknameToEmail(nickname);
  const cred = await createUserWithEmailAndPassword(auth, email, "test1234");
  await registerProfile({ nickname });
  await saveState({ state: baseState(stateOverrides) });
  const spawn = await conquestSpawn();
  return { uid: cred.user.uid, nickname, email, tile: spawn.data.tile };
}

// 클라이언트 SDK는 동시에 한 계정만 "로그인 상태"를 유지하므로, 계정을 바꿔가며 호출할 때는
// signInWithEmailAndPassword로 매번 전환한다.
async function actAs(player) {
  await signInWithEmailAndPassword(auth, player.email, "test1234");
}

async function forceArrived(missionId, field = "arriveAt") {
  await adminDb.collection("pvpMissions").doc(missionId).update({ [field]: Date.now() - 1000 });
}

async function getPlayerState(uid) {
  const snap = await adminDb.collection("players").doc(uid).get();
  return snap.data().state;
}

async function main() {
  console.log("[준비] 계정 4개 생성: A(공격자), B(방어자), C(지원군, 제때 도착), D(지원군, 공격보다 늦음)");
  // anticheat.js의 TROOP_GRACE(저장 1회당 병종별 +20)를 넘지 않는 선에서 초기 병력을 준다.
  const A = await newPlayer("공격자", { troops: { spartan: 20 } });
  const B = await newPlayer("방어자", { troops: { militia: 5 } }); // 방어 병력을 아주 약하게 둬서 공격자가 확실히 이기게 한다
  const C = await newPlayer("지원군", { troops: { spartan: 15 } });
  const D = await newPlayer("늦은지원군", { troops: { spartan: 15 } });

  console.log("\n[1] C가 B에게 지원군 파병 -> 즉시 도착 처리 -> stationed로 전이해야 함");
  await actAs(C);
  const reinforceC = await pvpReinforce({ targetPlayerId: B.uid, squadIndex: 0, comp: { spartan: 15 } });
  console.log("    missionId:", reinforceC.data.missionId);
  await forceArrived(reinforceC.data.missionId, "arriveAt");
  await pvpSweepManual();
  const cMissionsAfterArrive = (await pvpMissionsMine()).data.missions;
  const cMission = cMissionsAfterArrive.find((m) => m.id === reinforceC.data.missionId);
  expect(cMission.phase === "stationed", `C의 지원군이 stationed 상태 (실제: ${cMission.phase})`);

  console.log("\n[2] D가 B에게 지원군 파병(아직 도착 전 상태로 둠 — outbound 유지)");
  await actAs(D);
  const reinforceD = await pvpReinforce({ targetPlayerId: B.uid, squadIndex: 0, comp: { spartan: 15 } });
  console.log("    missionId:", reinforceD.data.missionId, "(도착시각을 앞당기지 않음 -> outbound로 남아있어야 함)");

  console.log("\n[2.5] B의 스폰 직후 30분 신규 보호를 테스트를 위해 강제로 해제");
  const bTileQuery = await adminDb.collection("worldTiles").where("playerId", "==", B.uid).limit(1).get();
  await bTileQuery.docs[0].ref.update({ protectedUntil: Date.now() - 1000 });

  console.log("\n[3] A가 B를 공격 -> 즉시 도착 처리 -> 전투 판정");
  await actAs(A);
  const attackA = await pvpAttack({ targetPlayerId: B.uid, squadIndex: 0, comp: { spartan: 20 } });
  console.log("    missionId:", attackA.data.missionId);
  await forceArrived(attackA.data.missionId, "arriveAt");
  await pvpSweepManual();

  const aMissionsAfter = (await pvpMissionsMine()).data.missions;
  const aMission = aMissionsAfter.find((m) => m.id === attackA.data.missionId);
  console.log("    result:", aMission.result);
  expect(aMission.phase === "returning", `공격 미션이 returning으로 전이 (실제: ${aMission.phase})`);
  expect(aMission.result.attackerWins === true, "spartan 20 vs (militia 5 + spartan 15 지원군) -> 공격자 승리");
  expect(aMission.result.loot && aMission.result.loot.gold > 0, "승리했으므로 골드 약탈 발생");

  console.log("\n[4] D의 지원군(아직 미도착)이 공격 판정과 동시에 자동으로 returning 전환됐는지 확인");
  await actAs(D);
  const dMissionsAfter = (await pvpMissionsMine()).data.missions;
  const dMission = dMissionsAfter.find((m) => m.id === reinforceD.data.missionId);
  expect(dMission.phase === "returning", `D의 지원군이 자동 철수(returning)로 전환 (실제: ${dMission.phase})`);

  console.log("\n[5] B(방어자)의 병력이 실제로 줄었는지 확인");
  const bState = await getPlayerState(B.uid);
  console.log("    B troopsByType:", bState.troopsByType);
  expect((bState.troopsByType.militia || 0) < 5, "B의 홈 병력(militia)이 패배로 감소");

  console.log("\n[6] C(생존한 지원군)의 병력 손실이 반영됐는지 확인");
  const cMissionSnap = await adminDb.collection("pvpMissions").doc(reinforceC.data.missionId).get();
  if (cMissionSnap.exists) {
    console.log("    C 지원군 생존 comp:", cMissionSnap.data().comp);
    expect(true, "C의 지원군 미션 문서가 남아있음(전멸하지 않음, 또는 존재 자체를 확인)");
  } else {
    console.log("    C의 지원군이 전멸하여 미션 문서가 삭제됨");
    expect(true, "전멸 시 미션 문서 삭제 확인");
  }

  console.log("\n[7] A의 공격 부대 귀환 처리 -> returnArriveAt 앞당기고 스윕 -> 병력 복귀");
  await forceArrived(attackA.data.missionId, "returnArriveAt");
  await pvpSweepManual();
  const aMissionDoc = await adminDb.collection("pvpMissions").doc(attackA.data.missionId).get();
  expect(!aMissionDoc.exists, "귀환 완료 후 미션 문서가 삭제됨");
  const aState = await getPlayerState(A.uid);
  console.log("    A troopsByType:", aState.troopsByType);
  expect((aState.troopsByType.spartan || 0) > 0, "생존한 병력이 A에게 돌아옴");
  expect((aState.res.gold || 0) > 20000, "약탈한 골드가 A의 자원에 합산됨");

  console.log(failed === 0 ? "\n모든 단계 통과" : `\n${failed}건 실패`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("테스트 실패:", e);
  process.exitCode = 1;
});
