// 공통 모듈: 러너 상태, 이동속도 계산, 가속/감속, 상태이상, 면역, 쿨타임, 필살기 게이지
import type { CharDef, Effect, EffectKind, EffectTag, RunnerStats } from '../types';
import type { GameConfig } from '../config';
import type { Race } from './race';

export interface Runner {
  index: number;
  def: CharDef;
  lane: number;
  pos: number;
  prevPos: number;
  speed: number;
  finished: boolean;
  finishTime: number | null;
  rank: number;
  effects: Effect[];
  cds: [number, number];
  onceUsed: [boolean, boolean];
  /** 필살기 게이지 — 내부 전용, 화면 노출 금지 */
  gauge: number;
  ultUsed: boolean;
  ultReadyAt: number | null;
  /** 숨겨진 필살기 발동 희망 지점 (결승선 대비 진행률) — 화면 노출 금지 */
  ultTrigger: number;
  bottomTimer: number;
  dodgeCharges: number;
  dodgeUntil: number;
  protectUntil: number;
  lastCdBonusAt: number;
  wobble: number;
  wobbleTarget: number;
  wobbleNext: number;
  dash: { remaining: number; speed: number } | null;
  stats: RunnerStats;
}

export function createRunner(index: number, def: CharDef, lane: number, initCds: [number, number]): Runner {
  return {
    index, def, lane,
    pos: 0, prevPos: 0, speed: 0,
    finished: false, finishTime: null, rank: index + 1,
    effects: [],
    cds: initCds,
    onceUsed: [false, false],
    gauge: 0, ultUsed: false, ultReadyAt: null, ultTrigger: 0, bottomTimer: 0,
    dodgeCharges: 0, dodgeUntil: 0, protectUntil: 0, lastCdBonusAt: -999,
    wobble: 0, wobbleTarget: 0, wobbleNext: 0,
    dash: null,
    stats: { skillUses: 0, ultUsed: false, ultTime: null, obstacleHits: 0, dodges: 0, debuffed: 0, blocked: 0 },
  };
}

export function addEffect(
  r: Runner, t: number, kind: EffectKind, value: number, dur: number, tag: EffectTag,
  extra?: Partial<Effect>,
): void {
  r.effects.push({ kind, value, start: t, until: t + dur, tag, ...extra });
}

export function pruneEffects(r: Runner, t: number): void {
  if (r.effects.length) r.effects = r.effects.filter((e) => e.until > t);
}

export function hasEffect(r: Runner, kind: EffectKind, t: number): boolean {
  return r.effects.some((e) => e.kind === kind && e.until > t);
}

export function hasTag(r: Runner, tag: EffectTag, t: number): boolean {
  return r.effects.some((e) => e.tag === tag && e.until > t);
}

export const isDebuffImmune = (r: Runner, t: number) => hasEffect(r, 'immuneDebuff', t);

/** 감속 효과 제거 (야무지 필살기) */
export function cleanseSlows(r: Runner): void {
  r.effects = r.effects.filter((e) => !(e.kind === 'speed' && e.value < 0));
}

function effectValue(e: Effect, t: number): number {
  if (e.ramp) return Math.min(e.ramp.max, e.ramp.step * (1 + Math.floor(t - e.start)));
  return e.value;
}

/** 큰 효과 1개 + 나머지 일부만 반영해 과도한 중첩 방지 */
function stack(values: number[], rest: number, cap: number): number {
  if (!values.length) return 0;
  values.sort((a, b) => b - a);
  let total = values[0];
  for (let i = 1; i < values.length; i++) total += values[i] * rest;
  return Math.min(cap, total);
}

export function speedParts(r: Runner, t: number, extraSlows: number[], cfg: GameConfig) {
  const boosts: number[] = [];
  const slows: number[] = [...extraSlows];
  for (const e of r.effects) {
    if (e.kind !== 'speed' || e.until <= t) continue;
    const v = effectValue(e, t);
    if (v > 0) boosts.push(v);
    else if (v < 0) slows.push(-v);
  }
  const safety = t > cfg.maxRaceTime;
  return {
    boost: stack(boosts, cfg.stackRest, cfg.maxBoost),
    slow: safety ? 0 : stack(slows, cfg.stackRest, cfg.maxSlow),
  };
}

export function computeSpeed(r: Runner, t: number, extraSlows: number[], catchUp: number, cfg: GameConfig): number {
  const { boost, slow } = speedParts(r, t, extraSlows, cfg);
  return cfg.baseSpeed * (1 + boost) * (1 - slow) * (1 + catchUp) * (1 + r.wobble);
}

export function tickCooldowns(r: Runner, dt: number): void {
  r.cds[0] = Math.max(0, r.cds[0] - dt);
  r.cds[1] = Math.max(0, r.cds[1] - dt);
}

export function addGauge(r: Runner, amount: number, cfg: GameConfig): void {
  if (r.ultUsed || r.finished) return;
  r.gauge = Math.min(cfg.gauge.max, r.gauge + amount);
}

/**
 * 실제 피격 처리 (장애물/상대 방해). 면역으로 무시된 경우 호출하지 않는다.
 * - 고유 스킬 2개 쿨타임 추가 감소 (최대 2초에 한 번)
 * - 필살기 게이지 증가
 */
export function registerHit(r: Runner, t: number, kind: 'obstacle' | 'opponent', cfg: GameConfig): void {
  if (t - r.lastCdBonusAt >= cfg.hitCooldownInterval) {
    r.cds[0] = Math.max(0, r.cds[0] - cfg.hitCooldownBonus);
    r.cds[1] = Math.max(0, r.cds[1] - cfg.hitCooldownBonus);
    r.lastCdBonusAt = t;
  }
  addGauge(r, kind === 'obstacle' ? cfg.gauge.obstacleHit : cfg.gauge.opponentHit, cfg);
}

/** 상대 방해 감속 적용 (면역/완주 체크 포함). 적용되면 true */
export function applyOpponentSlow(
  race: Race, src: Runner, target: Runner, value: number, dur: number,
  opts: { confuse?: boolean; skillId?: string } = {},
): boolean {
  if (target.finished || target === src) return false;
  const t = race.t;
  if (isDebuffImmune(target, t)) {
    target.stats.blocked++;
    race.emit({ type: 'blocked', actor: src.index, target: target.index, skillId: opts.skillId });
    return false;
  }
  addEffect(target, t, 'speed', -value, dur, opts.confuse ? 'confused' : 'debuff', { fromOpponent: true });
  target.stats.debuffed++;
  registerHit(target, t, 'opponent', race.cfg);
  race.emit({ type: 'debuff', actor: src.index, target: target.index, skillId: opts.skillId, value });
  return true;
}
