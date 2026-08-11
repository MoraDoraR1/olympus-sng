"use strict";
// 아주 작은 .env 로더 — dotenv 패키지를 추가하는 대신, 이 프로젝트가 지금까지
// 지켜온 "네이티브 의존성 없이 최소 구성으로 어디서든 돌아가게" 원칙을 그대로 따른다.
// server/.env가 있으면 KEY=VALUE 줄을 읽어 process.env에 반영하되, 이미 실제
// 환경변수로 설정된 값(호스팅 플랫폼의 환경변수 설정 등)은 절대 덮어쓰지 않는다.
const fs = require("node:fs");
const path = require("node:path");

const ENV_PATH = path.join(__dirname, "..", ".env");

function loadEnvFile() {
  if (!fs.existsSync(ENV_PATH)) return;
  const text = fs.readFileSync(ENV_PATH, "utf8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile();

module.exports = {};
