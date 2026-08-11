"use strict";
// Cloud Functions 엔트리포인트. server-legacy/src/index.js(Express 라우트 테이블)를
// 대체하는 콜러블/스케줄 함수들을 여기서 전부 export한다.
const { registerProfile } = require("./src/callable/auth");
const { saveState } = require("./src/callable/state");
const { conquestSpawn, conquestTravelTime } = require("./src/callable/conquest");
const { itemsBuy, itemsUseShield, itemsUseTeleport } = require("./src/callable/items");
const { pvpMissionsMine, pvpAttack, pvpReinforce, pvpRecall } = require("./src/callable/pvp");
const { pvpSweep, pvpSweepManual } = require("./src/scheduled/sweep");

module.exports = {
  registerProfile,
  saveState,
  conquestSpawn,
  conquestTravelTime,
  itemsBuy,
  itemsUseShield,
  itemsUseTeleport,
  pvpMissionsMine,
  pvpAttack,
  pvpReinforce,
  pvpRecall,
  pvpSweep,
  pvpSweepManual,
};
