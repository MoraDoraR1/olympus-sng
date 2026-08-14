-- 랭킹(순위표) 기능용: 상태 저장(PUT /api/state) 시점에 서버가 계산한 전투력/성 레벨을
-- game_states에 같이 저장해, 매 조회마다 전 플레이어의 state_json을 파싱하지 않고도
-- 정렬/집계 쿼리로 순위표를 낼 수 있게 한다. 0003과 동일하게 ALTER TABLE로 컬럼만 추가.
ALTER TABLE game_states ADD COLUMN power_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE game_states ADD COLUMN castle_level INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_game_states_power_score ON game_states(power_score DESC);
