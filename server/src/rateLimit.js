"use strict";
// 아주 작은 고정 윈도우(fixed window) 레이트 리미터 — 로그인/회원가입 무차별
// 대입을 늦추기 위한 용도. 별도 패키지(express-rate-limit 등) 없이 메모리
// Map 하나로 충분해서, 이 프로젝트가 지켜온 최소 의존성 원칙을 그대로 따른다.
// 여러 서버 인스턴스로 수평 확장하면(이 프로젝트 규모에선 해당 없음) 인스턴스별로
// 따로 세므로 완벽하진 않지만, 단일 프로세스로 배포하는 한 충분하다.
const buckets = new Map(); // key -> { count, resetAt }

function rateLimiter({ windowMs, max, message }) {
  return (req, res, next) => {
    const key = req.ip || "unknown";
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      return res.status(429).json({ error: message || "요청이 너무 많습니다. 잠시 후 다시 시도하세요." });
    }
    next();
  };
}

// 오래된 항목이 계속 쌓이지 않도록 주기적으로 청소.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}, 10 * 60 * 1000).unref();

module.exports = { rateLimiter };
