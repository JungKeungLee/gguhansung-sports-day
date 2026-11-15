// 자동 달리기 시뮬레이션 (화면과 분리, 고정 시간 간격, 시드 재현)
import { CONFIG, type GameConfig } from '../config';
import { CHAR_BY_ID } from '../characters';
import { Rng } from '../rng';
import type { CharId, Obstacle, PublicRunner, RaceEvent, Trap } from '../types';
import { type Runner, computeSpeed, createRunner, hasTag, pruneEffects, speedParts, tickCooldowns, addGauge, hasEffect } from './runner';
import { aiTick, isBottomHalf } from './skills';
import { crossObstacles, crossTraps, generateObstacles, zoneSlows } from './obstacles';
import { tickRandomEvents } from './events';

const HARD_LIMIT_EXTRA = 120;

export class Race {
  readonly cfg: GameConfig;
  readonly rng: Rng;
  readonly seed: number;
  readonly runners: Runner[];
  readonly obstaclesByLane: Obstacle[][];
  traps: Trap[] = [];
  events: RaceEvent[] = [];
  t = 0;
  stepCount = 0;
  finishLine: number;
  finishMoved = false;
  finishedCount = 0;
  cheerCount = 0;
  nextId = 10000;
  done = false;
  forcedEnd = false;
  // 통계
  overtakes = 0;
  leadChanges = 0;
  midRanks: number[] | null = null;
  private leader = -1;
  private lastLeadEventT = -99;

  constructor(ids: CharId[], seed: number, cfg: GameConfig = CONFIG) {
    if (ids.length < 2 || ids.length > 10) throw new Error('참가 인원은 2~10명');
    if (new Set(ids).size !== ids.length) throw new Error('중복 참가 불가');
    this.cfg = cfg;
    this.seed = seed;
    this.rng = new Rng(seed);
    this.finishLine = cfg.baseFinish;
    // 레인 배치는 무작위
    const lanes = ids.map((_, i) => i);
    for (let i = lanes.length - 1; i > 0; i--) {
      const j = this.rng.int(i + 1);
      [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
    }
    this.runners = ids.map((id, i) => {
      const ic = cfg.initialCooldown;
      const r = createRunner(i, CHAR_BY_ID[id], lanes[i], [this.rng.range(ic[0], ic[1]), this.rng.range(ic[0], ic[1])]);
      r.wobbleNext = this.rng.range(0, cfg.wobbleInterval[1]);
      const tr = r.def.ult.trigger ?? cfg.ultTrigger;
      r.ultTrigger = this.rng.range(tr[0], tr[1]);
      return r;
    });
    this.obstaclesByLane = generateObstacles(this.rng, ids.length, cfg);
    this.emit({ type: 'start' });
  }

  emit(e: Omit<RaceEvent, 't'>): void {
    this.events.push({ t: this.t, ...e });
  }

  /** 1 고정 스텝 진행 */
  step(): void {
    if (this.done) return;
    const { cfg, rng } = this;
    const dt = cfg.dt;
    const t0 = this.t;
    const n = this.runners.length;

    tickRandomEvents(this);

    // 처리 순서 회전 (특정 캐릭터의 선처리 이점 방지)
    const order: Runner[] = [];
    for (let k = 0; k < n; k++) order.push(this.runners[(k + this.stepCount) % n]);

    // 1) 상태 갱신 + 스킬 AI
    for (const r of order) {
      if (r.finished) continue;
      pruneEffects(r, t0);
      tickCooldowns(r, dt);
      addGauge(r, cfg.gauge.perSecond * dt, cfg);
      if (isBottomHalf(this, r)) {
        r.bottomTimer += dt;
        if (r.bottomTimer >= cfg.gauge.bottomHoldTime) {
          r.bottomTimer -= cfg.gauge.bottomHoldTime;
          addGauge(r, cfg.gauge.bottomHold, cfg);
        }
      } else r.bottomTimer = 0;
      if (t0 >= r.wobbleNext) {
        r.wobbleTarget = rng.range(-cfg.wobble, cfg.wobble);
        r.wobbleNext = t0 + rng.range(cfg.wobbleInterval[0], cfg.wobbleInterval[1]);
      }
      r.wobble += (r.wobbleTarget - r.wobble) * Math.min(1, dt * 2);
      aiTick(this, r);
    }

    // 2) 이동 + 장애물 + 결승선 판정
    let leaderPos = 0;
    for (const r of this.runners) if (!r.finished) leaderPos = Math.max(leaderPos, r.pos);
    for (const r of order) {
      if (r.finished) continue;
      r.prevPos = r.pos;
      let next: number;
      if (r.dash) {
        const cap = this.finishLine - 0.5;
        const move = Math.min(r.dash.speed * dt, r.dash.remaining);
        next = Math.min(r.pos + move, Math.max(r.pos, cap));
        r.dash.remaining -= move;
        if (r.dash.remaining <= 1e-6 || next >= cap) r.dash = null;
        r.speed = (next - r.pos) / dt;
        next = crossObstacles(this, r, r.pos, next);
      } else {
        const catchUp = Math.min(cfg.catchUpMax, Math.max(0, leaderPos - r.pos) * cfg.catchUpPerMeter);
        r.speed = computeSpeed(r, t0, zoneSlows(this, r), catchUp, cfg);
        next = r.pos + r.speed * dt;
        next = crossObstacles(this, r, r.pos, next);
      }
      crossTraps(this, r, r.prevPos, next);
      r.pos = next;
      if (r.prevPos < this.finishLine && r.pos >= this.finishLine) {
        // 이전/현재 위치 보간으로 정확한 통과 시각 계산
        const frac = (this.finishLine - r.prevPos) / (r.pos - r.prevPos);
        r.finishTime = t0 + frac * dt;
        r.finished = true;
        r.pos = this.finishLine;
        r.dash = null;
        r.effects = [];
        this.finishedCount++;
        this.emit({ type: 'finish', actor: r.index, value: r.finishTime });
      }
    }

    this.t = t0 + dt;
    this.stepCount++;
    this.traps = this.traps.filter((tr) => !tr.done && tr.until >= this.t);
    this.updateRanks();

    if (this.finishedCount === n) {
      this.done = true;
      this.emit({ type: 'end' });
    } else if (this.t > cfg.maxRaceTime + HARD_LIMIT_EXTRA) {
      this.forceEnd();
    }
  }

  /** 안전장치: 정상적으로는 발생하지 않음 */
  private forceEnd(): void {
    this.forcedEnd = true;
    const rest = this.runners.filter((r) => !r.finished).sort((a, b) => b.pos - a.pos);
    rest.forEach((r, i) => {
      r.finished = true;
      r.finishTime = this.t + i * 0.001;
      r.pos = this.finishLine;
      this.emit({ type: 'finish', actor: r.index, value: r.finishTime });
    });
    this.finishedCount = this.runners.length;
    this.done = true;
    this.emit({ type: 'end' });
  }

  /** 순위: 완주자(완주시간 순) → 미완주자(위치 순) */
  ranking(): Runner[] {
    return [...this.runners].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime! - b.finishTime! || a.index - b.index;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.pos - a.pos || a.index - b.index;
    });
  }

  private updateRanks(): void {
    const order = this.ranking();
    order.forEach((r, i) => {
      const newRank = i + 1;
      if (!r.finished && newRank < r.rank && this.stepCount > 1) this.overtakes += r.rank - newRank;
      r.rank = newRank;
    });
    const lead = order[0];
    if (this.finishedCount === 0 && lead.index !== this.leader) {
      if (this.leader !== -1) {
        this.leadChanges++;
        if (this.t - this.lastLeadEventT > 1.5) {
          this.emit({ type: 'leadChange', actor: lead.index });
          this.lastLeadEventT = this.t;
        }
      }
      this.leader = lead.index;
    }
    if (!this.midRanks && lead.pos >= this.cfg.baseFinish / 2) {
      this.midRanks = this.runners.map((r) => r.rank);
    }
  }

  runToEnd(): this {
    while (!this.done) this.step();
    return this;
  }

  /** 화면용 공개 상태 — 필살기 게이지/준비 여부는 포함하지 않음 */
  getPublic(): PublicRunner[] {
    const t = this.t;
    return this.runners.map((r) => {
      const { boost, slow } = speedParts(r, t, [], this.cfg);
      return {
        index: r.index, id: r.def.id, name: r.def.name, lane: r.lane,
        pos: r.pos, prevPos: r.prevPos, speed: r.speed,
        finished: r.finished, finishTime: r.finishTime, rank: r.rank,
        boosted: boost > 0, slowed: slow > 0 || zoneSlows(this, r).length > 0,
        confused: hasTag(r, 'confused', t),
        immune: hasEffect(r, 'immuneDebuff', t) || hasEffect(r, 'immuneObstacle', t),
        dashing: !!r.dash,
        fallen: hasTag(r, 'fall', t),
        cheered: hasTag(r, 'cheer', t),
      };
    });
  }
}
