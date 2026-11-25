// 랜덤 이벤트: 결승선 이동, 꾸로의 괴롭힘, 관중 응원
import type { Race } from './race';
import { addEffect, isDebuffImmune, registerHit } from './runner';

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

  // 꾸로의 괴롭힘: 경기당 정확히 1회, 선두가 사전 결정된 지점 도달 시 (결승선 이벤트와 독립)
  if (!race.kkuroPlan.done && leaderPos >= race.kkuroPlan.at) {
    race.kkuroPlan.done = true;
    kkuroHarass(race, active);
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

/**
 * 꾸로의 괴롭힘: 대상 수를 범위 내 균등 결정 → 미완주 참가자 중 중복 없이 균등 선정 → 대상마다 감속/밀치기 독립 50:50
 * - 감속·밀치기 모두 기존 상대 방해와 같은 규칙: 방해 면역이면 막음, 적용 시 피격 처리(쿨타임 감소·게이지)
 * - 밀치기: 위치·이전 위치를 함께 갱신 → 순간 이동으로 처리 (뒤로 지나간 장애물·함정 재판정 없음)
 * 개별 결과(kkuroHit)를 먼저, 요약(kkuro)을 마지막에 기록 → 화면은 같은 묶음에서 대상 목록을 만든다
 */
function kkuroHarass(race: Race, active: Race['runners']): void {
  const { cfg, rng, t } = race;
  const k = cfg.kkuro;
  const [lo, hi] = k.targets[race.runners.length] ?? [1, 1];
  const pool = [...active];
  const count = Math.min(pool.length, lo + rng.int(hi - lo + 1));
  for (let i = 0; i < count; i++) {
    const j = i + rng.int(pool.length - i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  let slows = 0, pushes = 0, blocked = 0;
  for (const r of pool.slice(0, count)) {
    const slow = rng.next() < k.slowChance;
    if (isDebuffImmune(r, t)) {
      r.stats.blocked++;
      blocked++;
      race.emit({ type: 'kkuroHit', target: r.index, label: 'blocked' });
      continue;
    }
    if (slow) {
      addEffect(r, t, 'speed', -k.slow, k.slowDur, 'kkuro', { fromOpponent: true });
      slows++;
      race.emit({ type: 'kkuroHit', target: r.index, label: 'slow', value: k.slow });
    } else {
      const from = r.pos;
      r.pos = r.prevPos = Math.max(0, r.pos - k.push);
      pushes++;
      race.emit({ type: 'kkuroHit', target: r.index, label: 'push', from, to: r.pos });
    }
    r.stats.debuffed++;
    registerHit(r, t, 'opponent', cfg);
  }
  race.emit({ type: 'kkuro', value: count, label: `${slows}/${pushes}/${blocked}` });
}
