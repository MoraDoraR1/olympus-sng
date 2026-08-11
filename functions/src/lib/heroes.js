"use strict";
// 원본은 ../../../data/heroes.js(클라이언트 <script> 전역 겸용, module.exports도 지원).
// 하지만 `firebase deploy`는 functions/ 디렉터리만 패키징하므로 그 바깥 파일을 직접
// require할 수 없다 — repo 루트 package.json의 "sync-heroes" 스크립트(및 firebase.json의
// functions predeploy 훅)가 배포/에뮬레이터 실행 전에 이 파일을 functions/data/heroes.js로
// 복사해 둔다. functions/data/는 생성물이라 git에는 커밋하지 않는다.
const { HEROES } = require("../../data/heroes.js");
const HERO_BY_ID = Object.fromEntries(HEROES.map((h) => [h.id, h]));

module.exports = { HEROES, HERO_BY_ID };
