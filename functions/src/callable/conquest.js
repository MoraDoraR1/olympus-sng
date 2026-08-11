"use strict";
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const conquest = require("../lib/conquest");

// GET /api/conquest/me, GET /api/conquest/tiles는 콜러블로 만들지 않는다 — worldTiles는
// 로그인한 사용자에게 전체 공개 읽기(firestore.rules)이므로 클라이언트가 Firestore에서
// 직접 쿼리해도 안전하다. spawn(쓰기, 트랜잭션 필요)과 travelTimePreview(본인 owned
// 영웅을 읽어야 함)만 콜러블로 둔다.

const conquestSpawn = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  const result = await conquest.trySpawn(uid);
  if (result.error) throw new HttpsError("failed-precondition", result.error);
  return { tile: result.tile };
});

const conquestTravelTime = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  const { x, y } = request.data || {};
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new HttpsError("invalid-argument", "x, y 좌표가 필요합니다.");
  }
  const result = await conquest.travelTimePreview(uid, x, y);
  if (result.error) throw new HttpsError("failed-precondition", result.error);
  return result;
});

module.exports = { conquestSpawn, conquestTravelTime };
