// PvP 미션 도착 판정을 정확한 시각에 처리하는 전역 싱글턴 Durable Object.
// server-legacy는 setInterval(sweepOnce, 5000)으로 5초마다 폴링했고, Firebase 이식판은
// Cloud Scheduler 최소 간격(1분) 때문에 정밀도가 떨어졌다 — Durable Object의 Alarm API는
// 밀리초 단위로 예약할 수 있어서, "다음 미션이 도착하는 정확한 그 순간"에만 깨어나면 된다
// (촘촘한 폴링도, 1분 지연도 없음).
import { DurableObject } from "cloudflare:workers";
import { sweepOnce } from "../lib/pvp.js";

export class PvpCoordinator extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
  }

  // 새 미션이 생기거나(디스패치) 기존 미션 시각이 당겨질 때(예: 지원군 자진 철수) 호출한다.
  // 이미 그보다 이르거나 같은 알람이 잡혀 있으면 그대로 둔다 — 항상 "가장 빠른 도착 시각"에
  // 맞춰 깨어나기만 하면 되므로 늦춰지는 방향으로는 덮어쓰지 않는다.
  async ensureAlarmAt(timestamp) {
    if (!timestamp) return;
    const current = await this.ctx.storage.getAlarm();
    if (current == null || timestamp < current) {
      await this.ctx.storage.setAlarm(timestamp);
    }
  }

  // 로컬 테스트/수동 트리거용 — 실제 알람과 동일한 로직을 즉시 실행한다.
  async sweepNow() {
    const nextAt = await sweepOnce(this.env.DB, Date.now());
    if (nextAt != null) await this.ensureAlarmAt(nextAt);
    return nextAt;
  }

  async alarm() {
    const nextAt = await sweepOnce(this.env.DB, Date.now());
    if (nextAt != null) {
      await this.ctx.storage.setAlarm(nextAt);
    }
  }
}
