// server-legacy/src/auth.js를 Cloudflare Workers 런타임(Web Crypto만 사용 가능, Node의
// bcrypt/jsonwebtoken 없음)에 맞게 재작성. 규칙(닉네임 형식, 비밀번호 길이, 토큰 TTL)은
// 원본과 동일하게 유지하고, 알고리즘만 Workers에서 표준으로 쓰는 것으로 바꾼다:
//   - 비밀번호 해시: bcrypt → PBKDF2-SHA256 (crypto.subtle, Web Crypto 표준 API)
//   - 토큰: jsonwebtoken → 직접 만든 최소 HMAC-SHA256 JWT (외부 의존성 없음)
const NICKNAME_RE = /^[a-zA-Z0-9가-힣_]{2,16}$/;
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30일 — 원본과 동일
const PBKDF2_ITERATIONS = 100000;

export function validateCredentials(nickname, password) {
  if (typeof nickname !== "string" || !NICKNAME_RE.test(nickname)) {
    return { ok: false, error: "닉네임은 2~16자의 한글/영문/숫자/밑줄만 가능합니다." };
  }
  if (typeof password !== "string" || password.length < 4 || password.length > 72) {
    return { ok: false, error: "비밀번호는 4~72자여야 합니다." };
  }
  return { ok: true };
}

function toBase64Url(bytes) {
  let base64 = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(str) {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// 저장 형식: "pbkdf2$<iterations>$<salt(base64url)>$<hash(base64url)>" — 자기서술적이라
// 나중에 반복 횟수를 올려도 예전 해시를 그대로 검증할 수 있다.
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

export async function verifyPassword(password, stored) {
  const parts = (stored || "").split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  const salt = fromBase64Url(parts[2]);
  const expected = fromBase64Url(parts[3]);
  const actual = await pbkdf2(password, salt, iterations);
  return timingSafeEqual(new Uint8Array(actual), new Uint8Array(expected));
}

async function pbkdf2(password, salt, iterations) {
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    256
  );
}

// ---------- 최소 JWT (HMAC-SHA256) ----------
async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function issueToken(player, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = { sub: player.id, nickname: player.nickname, iat: now, exp: now + TOKEN_TTL_SECONDS };
  const encHeader = toBase64Url(new TextEncoder().encode(JSON.stringify(header)));
  const encPayload = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${encHeader}.${encPayload}`;
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${toBase64Url(signature)}`;
}

export async function verifyToken(token, secret) {
  try {
    const [encHeader, encPayload, encSignature] = (token || "").split(".");
    if (!encHeader || !encPayload || !encSignature) return null;
    const key = await hmacKey(secret);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64Url(encSignature),
      new TextEncoder().encode(`${encHeader}.${encPayload}`)
    );
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encPayload)));
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === "number" && now >= payload.exp) return null;
    return { id: payload.sub, nickname: payload.nickname };
  } catch (e) {
    return null;
  }
}

export { NICKNAME_RE, TOKEN_TTL_SECONDS };
