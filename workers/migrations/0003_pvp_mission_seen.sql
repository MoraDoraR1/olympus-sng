-- 공격/피공격 양측에게 전투 결과 알림을 띄우기 위한 "확인함" 플래그.
-- pvp_missions 행은 귀환 완료(completeReturn) 시 삭제되므로, 그 전까지만 유효한
-- 일회성 알림 표시로 충분하다(전투 기록을 영구 보관하는 별도 로그 테이블은 아님).
ALTER TABLE pvp_missions ADD COLUMN attacker_seen INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pvp_missions ADD COLUMN defender_seen INTEGER NOT NULL DEFAULT 0;
