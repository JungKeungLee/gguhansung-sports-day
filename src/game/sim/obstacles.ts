// 장애물 생성 및 충돌 판정
import type { Obstacle, ObstacleType } from '../types';
import type { GameConfig } from '../config';
import type { Rng } from '../rng';
import type { Race } from './race';
import { type Runner, addEffect, applyOpponentSlow, hasEffect, registerHit } from './runner';

const TYPES: ObstacleType[] = ['banana', 'pit', 'rock', 'gust', 'zone'];

export function generateObstacles(rng: Rng, lanes: number, cfg: GameConfig, idStart = 1): Obstacle[][] {
  let id = idStart;
  const result: Obstacle[][] = [];
  for (let lane = 0; lane < lanes; lane++) {
    const list: Obstacle[] = [];
    const first = cfg.obstacleBands[0];
    let p = cfg.obstacleStart + rng.range(1, first.gap[1]);
    let lastType: ObstacleType | null = null;
    while (p < cfg.maxFinish - 2) {
      const band = cfg.obstacleBands.find((b) => p >= b.from && p < b.to) ?? cfg.obstacleBands[cfg.obstacleBands.length - 1];
      // 같은 종류가 연속되지 않도록 가중치 조정
      const type = rng.weighted(TYPES, (x) => cfg.obstacleWeights[x] * (x === lastType ? 0.35 : 1));
      const len = type === 'zone' ? cfg.obstacle.zone.len : 0;
      list.push({ id: id++, lane, pos: p, len, type, state: 'idle' });
      lastType = type;
      p += len + rng.range(band.gap[0], band.gap[1]);
    }
    result.push(list);
  }
  return result;
}

/** 감속 구역 내부에 있는지 (피격 상태인 구역만 감속) */
export function zoneSlows(race: Race, r: Runner): number[] {
  const out: number[] = [];
  for (const ob of race.obstaclesByLane[r.lane]) {
    if (ob.type === 'zone' && ob.state === 'hit' && r.pos >= ob.pos && r.pos <= ob.pos + ob.len) {
      if (!hasEffect(r, 'immuneObstacle', race.t)) out.push(race.cfg.obstacle.zone.slow);
    }
  }
  return out;
}

/**
 * from→to 이동 중 지나친 장애물 처리. 돌풍으로 밀려나면 새 위치를 반환(이후 이동 중단).
 * 반환값: 최종 위치
 */
export function crossObstacles(race: Race, r: Runner, from: number, to: number): number {
  const { cfg, t } = race;
  for (const ob of race.obstaclesByLane[r.lane]) {
    if (ob.state !== 'idle' || ob.pos <= from || ob.pos > to || ob.pos >= race.finishLine) continue;
    if (r.protectUntil > t) {
      ob.state = 'protected';
      race.emit({ type: 'obstacleProtected', actor: r.index, obstacle: ob.type });
      continue;
    }
    if (hasEffect(r, 'immuneObstacle', t)) {
      ob.state = 'dodged';
      r.stats.dodges++;
      race.emit({ type: 'obstacleImmune', actor: r.index, obstacle: ob.type });
      continue;
    }
    const charge = r.dodgeCharges > 0 && t < r.dodgeUntil;
    if (hasEffect(r, 'autoDodge', t) || charge) {
      if (!hasEffect(r, 'autoDodge', t)) r.dodgeCharges--;
      ob.state = 'dodged';
      r.stats.dodges++;
      race.emit({ type: 'obstacleDodge', actor: r.index, obstacle: ob.type });
      continue;
    }
    // 실제 피격
    ob.state = 'hit';
    r.stats.obstacleHits++;
    r.protectUntil = t + race.rng.range(cfg.obstacleProtect[0], cfg.obstacleProtect[1]);
    registerHit(r, t, 'obstacle', cfg);
    race.emit({ type: 'obstacleHit', actor: r.index, obstacle: ob.type });
    const o = cfg.obstacle;
    switch (ob.type) {
      case 'banana': addEffect(r, t, 'speed', -o.banana.slow, o.banana.dur, 'slip'); break;
      case 'pit': addEffect(r, t, 'speed', -o.pit.slow, o.pit.dur, 'fall'); break;
      case 'rock': addEffect(r, t, 'speed', -o.rock.slow, o.rock.dur, 'bump'); break;
      case 'zone': break; // 구역 내부에서 zoneSlows로 감속
      case 'gust': {
        const back = Math.max(0, ob.pos - o.gust.push);
        r.prevPos = back;
        return back;
      }
    }
  }
  return to;
}

/** 야무지 함정 통과 판정 */
export function crossTraps(race: Race, r: Runner, from: number, to: number): void {
  for (const tr of race.traps) {
    if (tr.done || tr.lane !== r.lane || tr.owner === r.index) continue;
    if (race.t > tr.until) { tr.done = true; continue; }
    if (tr.pos <= from || tr.pos > to) continue;
    tr.done = true;
    const owner = race.runners[tr.owner];
    if (hasEffect(r, 'autoDodge', race.t) || hasEffect(r, 'immuneObstacle', race.t)) {
      race.emit({ type: 'obstacleDodge', actor: r.index, label: 'trap' });
      continue;
    }
    if (applyOpponentSlow(race, owner, r, tr.value, tr.dur, { skillId: 'yamu_trap' })) {
      race.emit({ type: 'trapHit', actor: owner.index, target: r.index });
    }
  }
}
