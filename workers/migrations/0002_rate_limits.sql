-- server-legacy/src/rateLimit.js는 프로세스 메모리에 저장해서 "여러 인스턴스에서는 정확히
-- 동작하지 않는다"고 스스로 문서화했었다. Workers는 인스턴스가 여러 개 뜰 수 있으므로
-- D1에 저장해 그 한계를 없앤다(고정 윈도 방식은 동일).
CREATE TABLE IF NOT EXISTS rate_limits (
  rl_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
