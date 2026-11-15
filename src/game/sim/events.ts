// 랜덤 이벤트: 결승선 이동, 관중 응원
import type { Race } from './race';
import { addEffect } from './runner';

export function tickRandomEvents(race: Race): void {
  const { cfg, rng } = race;
  const dt = cfg.dt;
  const active = race.runners.filter((r) => !r.finished);
  if (!active.length) return;
  const leaderPos = Math.max(...active.map((r) => r.pos));

  // 결승선 이벤트: 경기당 최대 1회, 아무도 완주하기 전, 선두가 사전 결정된 발동 지점을 지날 때
  const plan = race.finishPlan;
  if (!race.finishMoved && !plan.cancelled && plan.to !== race.finishLine && race.finishedCount === 0 && leaderPos >= plan.at) {
    const shorten = plan.to < race.finishLine;
    // 단축 안전 처리: 선두가 새 결승선에 너무 가까우면(또는 넘었으면) 실행하지 않음 → 기본 거리로 진행
    if (shorten && leaderPos > plan.to - cfg.finishMove.shortenSafety) plan.cancelled = true;
    else if (!shorten && leaderPos >= race.finishLine - 5) plan.cancelled = true;
    else {
      const from = race.finishLine;
      race.finishLine = Math.min(cfg.maxFinish, plan.to);
      race.finishMoved = true;
      race.emit({ type: 'finishMove', from, to: race.finishLine });
    }
  }

  // 관중 응원: 최하위 1명 가속
  const ch = cfg.cheer;
  if (
    race.cheerCount < ch.maxPerRace && active.length >= 2 && leaderPos >= ch.minLeaderPos &&
    rng.chance(ch.chancePerSecond, dt)
  ) {
    const last = active.reduce((a, b) => (b.pos < a.pos ? b : a));
    race.cheerCount++;
    addEffect(last, race.t, 'speed', ch.boost, ch.dur, 'cheer');
    race.emit({ type: 'cheer', actor: last.index });
  }
}
