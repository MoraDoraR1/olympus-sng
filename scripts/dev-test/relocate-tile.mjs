// items.js의 30분 신규 보호 규칙 때문에 스폰 직후에는 useTeleport를 콜러블 경로로
// 정상 테스트할 수 없다(의도된 동작). 그래서 conquest.relocateToRandomTile 자체의
// Firestore 트랜잭션(기존 좌표 문서 삭제 + 새 좌표 문서 생성)만 firebase-admin으로
// 직접 호출해 좌표 이동 메커니즘을 검증한다.
// 실행 전: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/dev-test/relocate-tile.mjs
process.env.GCLOUD_PROJECT = "demo-olympus-sng";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

initializeApp({ projectId: "demo-olympus-sng" });
const db = getFirestore();

const conquestModule = await import("../../functions/src/lib/conquest.js");
// conquest.js는 자체 admin.js를 require해서 별도의 initializeApp을 시도한다 —
// getApps().length 체크 덕분에 이미 초기화된 앱을 재사용하므로 충돌 없이 동작한다.
const { trySpawn, relocateToRandomTile, myTile } = conquestModule;

const playerId = "relocate-test-" + Date.now();

async function main() {
  await db.collection("players").doc(playerId).set({
    nickname: "이동테스트",
    createdAt: Date.now(),
    state: { tiles: { castle: { level: 10 } }, res: { gold: 0, food: 0, wood: 0, stone: 0 } },
  });

  const spawnResult = await trySpawn(playerId);
  console.log("spawn:", spawnResult);
  if (spawnResult.error) throw new Error("spawn 실패: " + spawnResult.error);

  const relocateResult = await relocateToRandomTile(playerId);
  console.log("relocate:", relocateResult);
  if (relocateResult.error) throw new Error("relocate 실패: " + relocateResult.error);

  const after = await myTile(playerId);
  console.log("myTile after:", after);

  const moved = after.x !== spawnResult.tile.x || after.y !== spawnResult.tile.y;
  if (!moved) throw new Error("좌표가 바뀌지 않음(200x200에서 극히 드문 우연 제외 실패로 간주)");

  // 이전 좌표 문서가 실제로 삭제됐는지 확인(둘 다 남아있으면 안 됨 — 유령 타일 방지).
  const oldDoc = await db.collection("worldTiles").doc(`${spawnResult.tile.x}_${spawnResult.tile.y}`).get();
  if (oldDoc.exists) throw new Error("이전 좌표 문서가 삭제되지 않고 남아있음");

  console.log("\n모든 단계 통과 — 좌표 이동 트랜잭션 정상 동작");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("테스트 실패:", e);
    process.exit(1);
  });
