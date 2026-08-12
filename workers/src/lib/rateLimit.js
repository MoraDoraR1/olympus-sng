// server-legacy/src/rateLimit.js는 "여러 인스턴스에서는 정확하지 않다"고 스스로 문서화한
// 프로세스 메모리 기반 고정 윈도 리미터였다. Workers는 여러 인스턴스가 동시에 뜰 수 있어
// D1에 저장해 그 한계를 없앤다 — 판정 방식(고정 윈도, 초과 시 거부)은 원본과 동일.
export async function checkRateLimit(db, key, { windowMs, max }) {
  const now = Date.now();
  const row = await db.prepare("SELECT * FROM rate_limits WHERE rl_key = ?").bind(key).first();
  if (!row || now >= row.reset_at) {
    await db
      .prepare(
        `INSERT INTO rate_limits (rl_key, count, reset_at) VALUES (?, 1, ?)
         ON CONFLICT(rl_key) DO UPDATE SET count = 1, reset_at = excluded.reset_at`
      )
      .bind(key, now + windowMs)
      .run();
    return { ok: true };
  }
  if (row.count >= max) return { ok: false };
  await db.prepare("UPDATE rate_limits SET count = count + 1 WHERE rl_key = ?").bind(key).run();
  return { ok: true };
}
