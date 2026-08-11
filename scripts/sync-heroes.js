#!/usr/bin/env node
"use strict";
// data/heroes.js(클라이언트 <script> 전역 겸 module.exports 겸용 소스)를
// functions/data/heroes.js로 복사한다. `firebase deploy`는 functions/ 디렉터리만
// 패키징하고, `firebase emulators:start`도 그 바깥 파일을 자동으로 보지 못하므로
// 배포/에뮬레이터 실행 전에 항상 이 스크립트를 먼저 돌려야 한다(package.json 스크립트와
// firebase.json의 functions predeploy 훅 양쪽에 연결해 둠). functions/data/는 생성물이라
// git에는 커밋하지 않는다 — data/heroes.js만 진짜 소스다.
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const src = path.join(root, "data", "heroes.js");
const destDir = path.join(root, "functions", "data");
const dest = path.join(destDir, "heroes.js");

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log(`[sync-heroes] ${path.relative(root, src)} -> ${path.relative(root, dest)}`);
