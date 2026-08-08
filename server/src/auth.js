"use strict";
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { db } = require("./db");

const JWT_SECRET = process.env.JWT_SECRET || "dev-insecure-secret-change-me";
if (!process.env.JWT_SECRET) {
  console.warn("[auth] JWT_SECRET 환경변수가 설정되지 않아 개발용 기본값을 사용합니다. 배포 시 반드시 설정하세요.");
}
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
