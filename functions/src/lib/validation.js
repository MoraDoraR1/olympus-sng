"use strict";
// server-legacy/src/auth.js의 validateCredentials와 동일한 닉네임 규칙.
// 실제 검증은 Firebase Auth(client SDK)가 담당하므로 여기서는 닉네임 형식만 본다.
const NICKNAME_RE = /^[a-zA-Z0-9가-힣_]{2,16}$/;

function isValidNickname(nickname) {
  return typeof nickname === "string" && NICKNAME_RE.test(nickname);
}

module.exports = { NICKNAME_RE, isValidNickname };
