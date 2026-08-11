// 사용자가 로컬 PC에서 에뮬레이터를 띄웠을 때 바로 로그인해서 둘러볼 수 있는 임시 테스트
// 계정을 만든다. 신규 계정 기본값(성 Lv.1, 자원 80/80/60/150)으로는 정복 맵(성 Lv.5+)도
// 못 보므로, anticheat 첫 저장 허용치(자원 종류당 +20000, 병종당 +20) 안에서 최대한
// 바로 둘러볼 수 있는 상태로 맞춰준다. 실행 후 `firebase emulators:export`로 이 상태를
// 내보내 그대로 배포한다.
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

const NICKNAME = "테스트유저";
const PASSWORD = "test1234";

// game.js의 TILE_LAYOUT과 정확히 동일해야 한다 — migrateState()는 tiles.wall 존재만
// 보정해줄 뿐, TILE_LAYOUT의 나머지 부지가 비어 있으면 renderBoard()가
// state.tiles[def.id]를 undefined로 읽어 그대로 죽는다(멱버전 필드 채움 대상이 아님).
const TILE_LAYOUT_IDS = [
  "plot11", "defense", "watch", "plot12",
  "plot1", "academy", "castle", "storage", "plot2",
  "plot13", "plot3", "tavern", "plot4", "plot14",
  "plot5", "plot6", "plot7", "plot8", "plot9", "plot10",
];
const FIXED_TYPE_BY_ID = {
  defense: "방어탑", watch: "감시탑", academy: "아카데미", castle: "성",
  storage: "자원보호소", tavern: "여관",
};

function tileLayoutState() {
  const tiles = {};
  TILE_LAYOUT_IDS.forEach((id) => {
    tiles[id] = {
      type: FIXED_TYPE_BY_ID[id] || null,
      built: id === "castle",
      level: id === "castle" ? 10 : 0,
      heroIds: [],
      training: null,
      upgrading: null,
    };
  });
  tiles.wall = { type: "성벽", built: false, level: 0, heroIds: [] };
  return tiles;
}

function tavernState() {
  return { timer: 600, candidates: new Array(5).fill(null), resetCost: 250 };
}

async function main() {
  const email = `u-${Buffer.from(NICKNAME, "utf8").toString("hex")}@olympus-sng.local`;
  console.log(`계정 생성: ${NICKNAME} / ${PASSWORD} (${email})`);
  const cred = await createUserWithEmailAndPassword(auth, email, PASSWORD);
  await registerProfile({ nickname: NICKNAME });

  const state = {
    res: { food: 15000, wood: 15000, stone: 15000, gold: 15000 },
    tiles: tileLayoutState(),
    tavern: tavernState(),
    troopsByType: { militia: 10, hoplite: 0, spartan: 15, myrmidon: 0, ares_champion: 0 },
    owned: {},
    research: {},
    raids: {},
  };
  await saveState({ state });
  console.log("상태 저장 완료 (성 Lv.10, 자원 각 15000, 민병대10/스파르타15)");

  const spawnResult = await conquestSpawn();
  console.log("정복 맵 스폰:", spawnResult.data.tile);

  await itemsBuy({ item: "shield30" });
  await itemsBuy({ item: "teleport" });
  console.log("아이템 구매: 보호막(30분) 1개, 성 이동 1개");

  console.log(`\nuid: ${cred.user.uid}`);
  console.log("완료 — 이제 emulators:export로 이 상태를 내보내세요.");
}

main().catch((e) => {
  console.error("실패:", e);
  process.exitCode = 1;
});
