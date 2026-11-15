// 랜덤 이벤트: 결승선 이동, 관중 응원
import type { Race } from './race';
import { addEffect } from './runner';

export function tickRandomEvents(race: Race): void {
  const { cfg, rng } = race;
  const dt = cfg.dt;
  const active = race.runners.filter((r) => !r.finished);
  if (!active.length) return;
  const leaderPos = Math.max(...active.map((r) => r.pos));

  // 결승선 이동: 경기당 1회, 아무도 완주하기 전, 선두가 지정 구간에 있을 때만
  const fm = cfg.finishMove;
  if (
    !race.finishMoved && race.finishedCount === 0 &&
    leaderPos >= fm.leaderRange[0] && leaderPos <= fm.leaderRange[1] &&
    leaderPos < race.finishLine - 5 &&
    rng.chance(fm.chancePerSecond, dt)
  ) {
    const opt = rng.weighted(fm.options.filter((o) => o.to <= cfg.maxFinish), (o) => o.w);
    const from = race.finishLine;
    race.finishLine = Math.min(cfg.maxFinish, opt.to);
    race.finishMoved = true;
    race.emit({ type: 'finishMove', from, to: race.finishLine });
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
