"use strict";
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const items = require("../lib/items");

const itemsBuy = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  const item = (request.data || {}).item;
  const result = await items.buyItem(uid, item);
  if (result.error) throw new HttpsError("failed-precondition", result.error);
  return result;
});

const itemsUseShield = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  const tier = Number((request.data || {}).tier);
  const result = await items.useShield(uid, tier);
  if (result.error) throw new HttpsError("failed-precondition", result.error);
  return result;
});

const itemsUseTeleport = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  const result = await items.useTeleport(uid);
  if (result.error) throw new HttpsError("failed-precondition", result.error);
  return result;
});

module.exports = { itemsBuy, itemsUseShield, itemsUseTeleport };
