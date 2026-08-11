"use strict";
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { db } = require("../lib/admin");
const { checkStatePush } = require("../lib/anticheat");

// server-legacy의 PUT /api/state 그대로 — anticheat 통과분만 저장한다. GET /api/state는
// 별도 함수로 만들지 않는다: players/{uid}는 본인만 읽을 수 있게 보안 규칙으로 막혀
// 있으므로 클라이언트가 Firestore에서 직접 읽어도 안전하다.
const saveState = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

  const nextState = (request.data || {}).state;
  if (!nextState || typeof nextState !== "object") {
    throw new HttpsError("invalid-argument", "state가 필요합니다.");
  }

  const playerRef = db.collection("players").doc(uid);
  const snap = await playerRef.get();
  if (!snap.exists) {
    throw new HttpsError("failed-precondition", "프로필이 없습니다. 먼저 registerProfile을 호출하세요.");
  }
  const player = snap.data();
  const now = Date.now();

  const prevRow = player.state
    ? { state_json: JSON.stringify(player.state), updated_at: player.updatedAt || player.createdAt || now }
    : null;

  const verdict = checkStatePush({ prevRow, createdAt: player.createdAt, nextState, now });
  if (!verdict.ok) {
    throw new HttpsError("failed-precondition", verdict.error);
  }

  await playerRef.set({ state: nextState, updatedAt: now }, { merge: true });
  return { ok: true, updatedAt: now };
});

module.exports = { saveState };
