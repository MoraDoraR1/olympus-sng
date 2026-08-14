// 랭킹(순위표)용 "전투력" 추정치 — 실제 전투 판정(combat.js)과는 무관한 단순 비교
// 지표다. 성 레벨을 크게 반영하고 보유 병력의 (공+방+체력) 합, 영웅 강화 수준을
// 더해 대략적인 성장 정도를 비교하는 용도이며 anticheat 검증에는 쓰이지 않는다.
import { TROOP_TYPES } from "./troops.js";

export function computePowerScore(state) {
  let score = 0;
  const castleLevel = (state && state.tiles && state.tiles.castle && state.tiles.castle.level) || 0;
  score += castleLevel * 500;
  const troops = (state && state.troopsByType) || {};
  TROOP_TYPES.forEach((t) => {
    const count = troops[t.key] || 0;
    if (count > 0) score += count * (t.atk + t.def + t.hp);
  });
  const owned = (state && state.owned) || {};
  Object.values(owned).forEach((h) => {
    const enhance = (h && h.enhance) || 0;
    score += (enhance + 1) * 40;
  });
  return { score: Math.round(score), castleLevel };
}

export async function topPlayers(db, limit) {
  const rows = await db
    .prepare(
      `SELECT players.nickname AS nickname, game_states.power_score AS powerScore, game_states.castle_level AS castleLevel
       FROM game_states JOIN players ON players.id = game_states.player_id
       ORDER BY game_states.power_score DESC, game_states.updated_at ASC
       LIMIT ?`
    )
    .bind(limit)
    .all();
  return rows.results.map((r, i) => ({ rank: i + 1, nickname: r.nickname, powerScore: r.powerScore, castleLevel: r.castleLevel }));
}

export async function myRank(db, playerId) {
  const mine = await db
    .prepare("SELECT power_score AS powerScore, castle_level AS castleLevel FROM game_states WHERE player_id = ?")
    .bind(playerId)
    .first();
  if (!mine) return null;
  const higher = await db
    .prepare("SELECT COUNT(*) AS cnt FROM game_states WHERE power_score > ?")
    .bind(mine.powerScore)
    .first();
  return { rank: (higher ? higher.cnt : 0) + 1, powerScore: mine.powerScore, castleLevel: mine.castleLevel };
}
