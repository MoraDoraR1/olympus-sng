"use strict";
// ../../data/heroes.js는 브라우저 <script> 태그로 로드되는 순수 전역 스크립트라
// module.exports가 없다 — 클라이언트 파일을 건드리지 않고 그대로 재사용하기 위해
// 텍스트를 읽어 Function으로 감싸고 마지막에 HEROES를 return하게 만든다.
const fs = require("node:fs");
const path = require("node:path");

const src = fs.readFileSync(path.join(__dirname, "..", "..", "data", "heroes.js"), "utf8");
const HEROES = new Function(`${src}\nreturn HEROES;`)();
const HERO_BY_ID = Object.fromEntries(HEROES.map((h) => [h.id, h]));

module.exports = { HEROES, HERO_BY_ID };
