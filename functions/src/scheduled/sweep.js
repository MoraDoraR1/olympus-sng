"use strict";
// server-legacy/src/index.js의 setInterval(pvp.sweepOnce, 5000) 대체.
// Cloud Scheduler 최소 간격이 1분이라 여기서는 1분마다 돈다(정밀도 트레이드오프는
// functions/src/lib/pvp.js 상단 주석 및 DEV_PLAN.md 참고).
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const pvp = require("../lib/pvp");

const pvpSweep = onSchedule("every 1 minutes", async () => {
  await pvp.sweepOnce();
});

// 에뮬레이터에서 1분을 기다리지 않고 스윕을 즉시 실행해보기 위한 개발용 콜러블.
// FUNCTIONS_EMULATOR 환경변수는 Firebase가 에뮬레이터 실행 시 자동으로 "true"를 설정하므로,
// 실제 배포된 프로젝트에서는 항상 거부된다 — 운영 환경에 노출되는 관리자 기능이 아니다.
const pvpSweepManual = onCall(async () => {
  if (process.env.FUNCTIONS_EMULATOR !== "true") {
    throw new HttpsError("permission-denied", "에뮬레이터에서만 사용할 수 있습니다.");
  }
  await pvp.sweepOnce();
  return { ok: true };
});

module.exports = { pvpSweep, pvpSweepManual };
