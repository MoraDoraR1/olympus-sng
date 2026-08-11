"use strict";
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const pvp = require("../lib/pvp");

const pvpMissionsMine = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  const missions = await pvp.myMissions(uid);
  return { missions };
});

const pvpAttack = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  const { targetPlayerId, squadIndex, comp } = request.data || {};
  const result = await pvp.dispatch(uid, "attack", { targetPlayerId, squadIndex, comp });
  if (result.error) throw new HttpsError("failed-precondition", result.error);
  return result;
});

const pvpReinforce = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  const { targetPlayerId, squadIndex, comp } = request.data || {};
  const result = await pvp.dispatch(uid, "reinforce", { targetPlayerId, squadIndex, comp });
  if (result.error) throw new HttpsError("failed-precondition", result.error);
  return result;
});

const pvpRecall = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  const { missionId } = request.data || {};
  const result = await pvp.recall(uid, missionId);
  if (result.error) throw new HttpsError("failed-precondition", result.error);
  return result;
});

module.exports = { pvpMissionsMine, pvpAttack, pvpReinforce, pvpRecall };
