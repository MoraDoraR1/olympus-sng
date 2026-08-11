"use strict";
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { db } = require("../lib/admin");
const { isValidNickname } = require("../lib/validation");

// 클라이언트가 Firebase Auth(createUserWithEmailAndPassword)로 계정 생성을 마친 뒤
// 딱 한 번 호출해 닉네임을 등록한다. 실제 계정 생성/로그인 자체는 Firebase Auth의
// 몫이라 여기서는 하지 않는다 — server-legacy/src/auth.js의 register/login/JWT
// 발급 로직 전체가 Firebase Auth로 대체되고, 이 함수는 그중 "닉네임을 우리 쪽
// players 문서에 남긴다"는 부분만 담당한다.
const registerProfile = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

  const nickname = String((request.data || {}).nickname || "").trim();
  if (!isValidNickname(nickname)) {
    throw new HttpsError("invalid-argument", "닉네임은 2~16자의 한글/영문/숫자/밑줄만 가능합니다.");
  }

  const playerRef = db.collection("players").doc(uid);
  const snap = await playerRef.get();
  if (snap.exists) {
    // 이미 프로필이 있으면 아무것도 바꾸지 않는다(멱등) — 재로그인 시 재호출돼도 안전.
    return { nickname: snap.data().nickname };
  }

  // anticheat.js의 시간 계산(경과초 = (now - updatedAt)/1000)과 맞추기 위해 Firestore
  // Timestamp 대신 평범한 ms epoch 정수로 저장한다 — server-legacy의 SQLite
  // players.created_at(정수 컬럼)과 동일한 취급.
  await playerRef.set({ nickname, createdAt: Date.now() });
  return { nickname };
});

module.exports = { registerProfile };
