"use strict";
require("./env"); // server/.env가 있으면 process.env에 반영(실제 환경변수가 항상 우선)
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { db } = require("./db");

// JWT_SECRET을 코드에 고정값으로 두지 않는다 — server/ 소스가 어떤 경로로든
// 공개되더라도(예: 정적 호스팅 저장소에 함께 커밋된 경우) 그 자체만으로 로그인
// 토큰을 위조할 수 없어야 하기 때문이다. 우선순위: ① 실제 환경변수(운영 배포에서
// 직접 설정) ② server/.env(로컬에서 직접 설정) ③ 둘 다 없으면 이 서버 인스턴스
// 전용 비밀값을 새로 생성해 server/data/.jwt-secret에 저장하고 재사용한다 —
// server/data/는 .gitignore로 제외되어 있어 커밋될 일이 없고, 인스턴스마다 값이
// 달라 여러 배포가 같은 비밀값을 공유하는 일도 없다.
function resolveJwtSecret() {
  if (process.env.JWT_SECRET) {
    if (process.env.JWT_SECRET.length < 16) {
      console.warn("[auth] JWT_SECRET이 너무 짧습니다(16자 미만). 추측당하지 않도록 더 긴 무작위 값을 쓰세요.");
    }
    return process.env.JWT_SECRET;
  }
  const dataDir = path.join(__dirname, "..", "data");
  const secretPath = path.join(dataDir, ".jwt-secret");
  if (fs.existsSync(secretPath)) {
    return fs.readFileSync(secretPath, "utf8").trim();
  }
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const generated = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(secretPath, generated, { mode: 0o600 });
  console.warn(
    "[auth] JWT_SECRET 환경변수가 없어 이 서버 인스턴스 전용 비밀값을 새로 생성해 " +
      "server/data/.jwt-secret에 저장했습니다(커밋되지 않음, 로컬 테스트용). " +
      "실제 배포 시에는 JWT_SECRET 환경변수를 직접 설정하는 걸 강력히 권장합니다."
  );
  return generated;
}

const JWT_SECRET = resolveJwtSecret();
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30일 — 기기 이동 후에도 오래 로그인 유지

const NICKNAME_RE = /^[a-zA-Z0-9가-힣_]{2,16}$/;

function validateCredentials(nickname, password) {
  if (typeof nickname !== "string" || !NICKNAME_RE.test(nickname)) {
    return "닉네임은 한글/영문/숫자/밑줄 2~16자여야 합니다.";
  }
  if (typeof password !== "string" || password.length < 4 || password.length > 72) {
    return "비밀번호는 4~72자여야 합니다.";
  }
  return null;
}

const findByNickname = db.prepare("SELECT * FROM players WHERE nickname = ?");
const insertPlayer = db.prepare(
  "INSERT INTO players (nickname, password_hash, created_at) VALUES (?, ?, ?)"
);
const touchLogin = db.prepare("UPDATE players SET last_login_at = ? WHERE id = ?");

function issueToken(player) {
  return jwt.sign({ sub: player.id, nickname: player.nickname }, JWT_SECRET, {
    expiresIn: TOKEN_TTL_SECONDS,
  });
}

function register(nickname, password) {
  const err = validateCredentials(nickname, password);
  if (err) return { error: err };
  if (findByNickname.get(nickname)) return { error: "이미 사용 중인 닉네임입니다." };
  const hash = bcrypt.hashSync(password, 10);
  const now = Date.now();
  const info = insertPlayer.run(nickname, hash, now);
  const player = { id: Number(info.lastInsertRowid), nickname };
  touchLogin.run(now, player.id);
  return { player, token: issueToken(player) };
}

function login(nickname, password) {
  const err = validateCredentials(nickname, password);
  if (err) return { error: err };
  const row = findByNickname.get(nickname);
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return { error: "닉네임 또는 비밀번호가 올바르지 않습니다." };
  }
  touchLogin.run(Date.now(), row.id);
  const player = { id: row.id, nickname: row.nickname };
  return { player, token: issueToken(player) };
}

function verifyToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return { id: payload.sub, nickname: payload.nickname };
  } catch {
    return null;
  }
}

module.exports = { register, login, verifyToken };
