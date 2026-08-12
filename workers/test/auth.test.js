import { test } from "node:test";
import assert from "node:assert/strict";

import { validateCredentials, hashPassword, verifyPassword, issueToken, verifyToken } from "../src/lib/auth.js";

test("validateCredentials: 정상/비정상 케이스", () => {
  assert.equal(validateCredentials("테스트왕1", "password123").ok, true);
  assert.equal(validateCredentials("a", "password123").ok, false); // 너무 짧음
  assert.equal(validateCredentials("정상닉네임", "123").ok, false); // 비밀번호 너무 짧음
  assert.equal(validateCredentials("공백 안됨", "password123").ok, false); // 공백 불가
});

test("hashPassword/verifyPassword 왕복", async () => {
  const hash = await hashPassword("올바른비밀번호");
  assert.match(hash, /^pbkdf2\$100000\$/);
  assert.equal(await verifyPassword("올바른비밀번호", hash), true);
  assert.equal(await verifyPassword("틀린비밀번호", hash), false);
});

test("issueToken/verifyToken 왕복 + 위조 서명 거부", async () => {
  const secret = "test-secret-for-unit-test";
  const token = await issueToken({ id: 42, nickname: "테스트왕" }, secret);
  const verified = await verifyToken(token, secret);
  assert.deepEqual(verified, { id: 42, nickname: "테스트왕" });

  // 다른 시크릿으로는 검증 실패해야 함
  assert.equal(await verifyToken(token, "wrong-secret"), null);

  // payload를 변조하면(서명은 그대로 두고) 실패해야 함
  const tampered = token.slice(0, -5) + "AAAAA";
  assert.equal(await verifyToken(tampered, secret), null);
});

test("verifyToken: 만료된 토큰은 거부", async () => {
  const secret = "test-secret-for-unit-test";
  // exp가 과거인 토큰을 issueToken 내부 로직을 흉내내 직접 구성
  const header = { alg: "HS256", typ: "JWT" };
  const payload = { sub: 1, nickname: "만료됨", iat: 0, exp: 1 };
  const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const signingInput = `${enc(header)}.${enc(payload)}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));
  const token = `${signingInput}.${Buffer.from(sig).toString("base64url")}`;
  assert.equal(await verifyToken(token, secret), null);
});
