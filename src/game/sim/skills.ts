// 스킬 대상 선택, 발동 조건, 실행, 자동 사용 AI
import type { Action, Condition, SkillDef, TargetSel } from '../types';
import type { Race } from './race';
import {
  type Runner, addEffect, addGauge, applyOpponentSlow, cleanseSlows, isDebuffImmune, registerHit,
} from './runner';

const TELEPORT_MIN = 2;
const DASH_MIN = 3;
const FINISH_GUARD = 0.5;   // 순간이동/돌진은 결승선 0.5m 앞까지만

function others(race: Race, r: Runner): Runner[] {
  return race.runners.filter((o) => o !== r && !o.finished);
}

/** 캐릭터 데이터 거리·돌진 속도 환산 배율 (기본속도 / 기준속도 2.75) */
const ds = (race: Race) => race.cfg.baseSpeed / race.cfg.speedRef;

export function nearestAhead(race: Race, r: Runner, maxRange = Infinity): Runner | null {
  let best: Runner | null = null;
  for (const o of others(race, r)) {
    const d = o.pos - r.pos;
    if (d > 0 && d <= maxRange && (!best || o.pos < best.pos)) best = o;
  }
  return best;
}

export function nearestBehind(race: Race, r: Runner, maxRange = Infinity): Runner | null {
  let best: Runner | null = null;
  for (const o of others(race, r)) {
    const d = r.pos - o.pos;
    if (d > 0 && d <= maxRange && (!best || o.pos > best.pos)) best = o;
  }
  return best;
}

export function findTargets(race: Race, r: Runner, sel: TargetSel, a: { radius?: number; maxRange?: number }): Runner[] {
  const range = a.maxRange ?? Infinity;
  switch (sel) {
    case 'nearestAhead': { const x = nearestAhead(race, r, range); return x ? [x] : []; }
    case 'nearestBehind': { const x = nearestBehind(race, r, range); return x ? [x] : []; }
    case 'leader': {
      const os = others(race, r);
      if (!os.length) return [];
      const lead = os.reduce((a2, b) => (b.pos > a2.pos ? b : a2));
      return lead.pos > r.pos ? [lead] : [];
    }
    case 'nearby': { // 범위 내 앞쪽 우선, 없으면 뒤쪽 가장 가까운 1명
      const ahead = nearestAhead(race, r, range);
      if (ahead) return [ahead];
      let best: Runner | null = null;
      for (const o of others(race, r)) {
        const d = Math.abs(o.pos - r.pos);
        if (d <= range && (!best || d < Math.abs(best.pos - r.pos))) best = o;
      }
      return best ? [best] : [];
    }
    case 'around':
      return others(race, r).filter((o) => Math.abs(o.pos - r.pos) <= (a.radius ?? 6));
    case 'aheadUpTo2':
      return others(race, r).filter((o) => o.pos > r.pos).sort((x, y) => x.pos - y.pos).slice(0, 2);
  }
}

export function isBottomHalf(race: Race, r: Runner): boolean {
  return r.rank > Math.ceil(race.runners.length / 2);
}

export function checkCondition(race: Race, r: Runner, c: Condition | undefined): boolean {
  switch (c ?? 'none') {
    case 'none': return true;
    case 'hasAhead':
    case 'notLeader': return !!nearestAhead(race, r);
    case 'aimRange': { const a = nearestAhead(race, r, 25); return !!a && a.pos - r.pos >= 1.5; }
    case 'hasBehind': return !!nearestBehind(race, r, 25);
    case 'bottomHalf': return isBottomHalf(race, r);
    case 'gapAhead10': { // 앞선 캐릭터(선두)와 10m 이상 차이
      const lead = others(race, r).reduce<Runner | null>((m, o) => (!m || o.pos > m.pos ? o : m), null);
      return !!lead && lead.pos - r.pos >= 10;
    }
    case 'raceStart': return race.t < 0.5;
  }
}

function teleportDest(race: Race, r: Runner, dist: number): number {
  // 앞선 캐릭터(선두)가 있으면 그 바로 뒤까지만 — 순간이동으로 선두를 앞지를 수 없음
  let dest = r.pos + dist;
  const os = others(race, r);
  const lead = os.length ? os.reduce((m, o) => (o.pos > m.pos ? o : m)) : null;
  if (lead && lead.pos > r.pos) dest = Math.min(dest, lead.pos - 0.3);
  return Math.min(dest, race.finishLine - FINISH_GUARD);
}

function actionValid(race: Race, r: Runner, a: Action): boolean {
  switch (a.type) {
    case 'slow': return findTargets(race, r, a.target, a).length > 0;
    case 'teleport': return teleportDest(race, r, a.dist * ds(race)) - r.pos >= TELEPORT_MIN;
    case 'dash': return Math.min(r.pos + a.dist * ds(race), race.finishLine - FINISH_GUARD) - r.pos >= DASH_MIN;
    case 'pushAhead': return others(race, r).some((o) => o.pos > r.pos);
    case 'trap': { const b = nearestBehind(race, r, a.maxRange); return !!b && r.pos - b.pos >= 1.5; }
    case 'random': return a.options.some((o) => o.actions.every((x) => actionValid(race, r, x)));
    default: return true;
  }
}

/** 스킬 사용 가능 여부: 조건 충족 + 대상 존재. 자기 가속이 있는 스킬은 방해 대상이 없어도 사용 가능 */
export function canUse(race: Race, r: Runner, s: SkillDef): boolean {
  if (!checkCondition(race, r, s.condition)) return false;
  const selfBoost = s.actions.some((a) => a.type === 'boost' || a.type === 'ramp');
  return s.actions.every((a) => actionValid(race, r, a) || (selfBoost && (a.type === 'slow' || a.type === 'trap')));
}

function exec(race: Race, r: Runner, a: Action, s: SkillDef, tag: 'skill' | 'ult'): void {
  const t = race.t;
  const cfg = race.cfg;
  // 일반 스킬/필살기 상대 영향력 배율 (수치·거리에 적용, 지속시간은 그대로)
  const k = tag === 'ult' ? cfg.ultScale : cfg.skillScale;
  switch (a.type) {
    case 'boost': addEffect(r, t, 'speed', a.value * k, a.dur, tag); break;
    case 'ramp': addEffect(r, t, 'speed', a.step * k, a.dur, 'ramp', { ramp: { step: a.step * k, max: a.max * k } }); break;
    case 'slow':
      for (const o of findTargets(race, r, a.target, a)) {
        applyOpponentSlow(race, r, o, a.value * k, a.dur, { confuse: a.confuse, skillId: s.id });
      }
      break;
    case 'dodge': r.dodgeCharges = a.count; r.dodgeUntil = t + a.window; break;
    case 'immune': addEffect(r, t, a.kind === 'debuff' ? 'immuneDebuff' : 'immuneObstacle', 0, a.dur, tag); break;
    case 'autoDodge': addEffect(r, t, 'autoDodge', 0, a.dur, tag); break;
    case 'cleanse': cleanseSlows(r); break;
    case 'teleport': {
      const from = r.pos;
      const to = teleportDest(race, r, a.dist * k * ds(race));
      r.pos = r.prevPos = to;
      race.emit({ type: 'teleport', actor: r.index, from, to });
      break;
    }
    case 'dash': {
      const to = Math.min(r.pos + a.dist * k * ds(race), race.finishLine - FINISH_GUARD);
      r.dash = { remaining: to - r.pos, speed: a.speed * ds(race) }; // 기본속도 대비 배율 유지
      for (const ob of race.obstaclesByLane[r.lane]) {
        if (ob.state === 'idle' && ob.pos > r.pos && ob.pos <= to + 0.5) ob.state = 'destroyed';
      }
      race.emit({ type: 'dash', actor: r.index, from: r.pos, to });
      break;
    }
    case 'pushAhead':
      for (const o of others(race, r).filter((x) => x.pos > r.pos)) {
        if (isDebuffImmune(o, t)) {
          o.stats.blocked++;
          race.emit({ type: 'blocked', actor: r.index, target: o.index, skillId: s.id });
          continue;
        }
        const d = Math.min(a.dist * k * ds(race), o.pos);
        if (d <= 0) continue;
        const from = o.pos;
        o.pos = o.prevPos = o.pos - d;
        o.stats.debuffed++;
        registerHit(o, t, 'opponent', cfg);
        race.emit({ type: 'push', actor: r.index, target: o.index, from, to: o.pos });
      }
      break;
    case 'swap': {
      const cands = others(race, r).filter((o) => o.pos > r.pos && !isDebuffImmune(o, t));
      if (!cands.length) {
        addEffect(r, t, 'speed', a.fallback.value * k, a.fallback.dur, tag);
        race.emit({ type: 'swap', actor: r.index, label: 'fallback' });
        break;
      }
      const o = race.rng.weighted(cands, (x) => (x.pos - r.pos) ** 2);
      const mine = r.pos;
      r.pos = r.prevPos = o.pos;
      o.pos = o.prevPos = mine;
      o.stats.debuffed++;
      registerHit(o, t, 'opponent', cfg);
      race.emit({ type: 'swap', actor: r.index, target: o.index, from: mine, to: r.pos });
      break;
    }
    case 'trap': {
      if (!actionValid(race, r, a)) break; // 뒤에 상대가 없으면 함정 효과 없음
      // 자신 바로 뒤쪽 트랙에 함정 설치: 뒤에서 오는 상대 레인마다 1개 (뒤에 상대가 없는 레인은 효과 없음)
      const b = nearestBehind(race, r, a.maxRange)!;
      for (const o of others(race, r)) {
        const gap = r.pos - o.pos;
        if (gap <= 0 || gap > a.maxRange) continue;
        const pos = Math.max(o.pos + 0.3, r.pos - 1);
        race.traps.push({
          id: race.nextId++, owner: r.index, lane: o.lane, pos, until: t + a.life, value: a.value * k, dur: a.dur, done: false,
        });
      }
      race.emit({ type: 'trapSet', actor: r.index, target: b.index, to: r.pos - 1 });
      break;
    }
    case 'random': {
      const valid = a.options.filter((o) => o.actions.every((x) => actionValid(race, r, x)));
      const choice = race.rng.pick(valid);
      race.emit({ type: 'skill', actor: r.index, skillId: s.id, skillName: s.name, label: choice.label, fx: s.fx });
      for (const x of choice.actions) exec(race, r, x, s, tag);
      break;
    }
  }
}

export function useSkill(race: Race, r: Runner, s: SkillDef, slot: 0 | 1 | 'ult'): void {
  const isUlt = slot === 'ult';
  const hasRandom = s.actions.some((a) => a.type === 'random');
  // 컷인/알림이 효과보다 먼저 보이도록 발동 이벤트를 먼저 기록
  if (isUlt) race.emit({ type: 'ult', actor: r.index, skillId: s.id, skillName: s.name, fx: s.fx });
  else if (!hasRandom) race.emit({ type: 'skill', actor: r.index, skillId: s.id, skillName: s.name, fx: s.fx });

  for (const a of s.actions) exec(race, r, a, s, isUlt ? 'ult' : 'skill');

  if (isUlt) {
    r.ultUsed = true;
    r.stats.ultUsed = true;
    r.stats.ultTime = race.t;
  } else {
    r.cds[slot] = s.cooldown;
    if (s.once) r.onceUsed[slot] = true;
    r.stats.skillUses++;
    addGauge(r, race.cfg.gauge.skillUse, race.cfg);
  }
}

/** 필살기 발동 상황 판단 (게이지 100 이후에도 적절한 상황까지 보류) */
function ultSituationOk(race: Race, r: Runner): boolean {
  if (r.pos < race.finishLine * r.ultTrigger) return false; // 숨겨진 발동 희망 지점 전에는 보류
  if (r.ultReadyAt !== null && race.t - r.ultReadyAt >= race.cfg.ultRelaxAfter) return true;
  const a = r.def.ult.actions[0];
  if (a.type === 'swap') {
    const ahead = nearestAhead(race, r);
    if (!ahead) return true; // 선두 → 가속으로 대체
    return others(race, r).some((o) => o.pos - r.pos >= 3);
  }
  if (a.type === 'teleport') return teleportDest(race, r, a.dist * ds(race)) - r.pos >= 3;
  return true;
}

/** 자동 스킬/필살기 사용 AI */
export function aiTick(race: Race, r: Runner): void {
  const { cfg, rng } = race;
  const dt = cfg.dt;
  r.def.skills.forEach((s, i) => {
    const slot = i as 0 | 1;
    if (s.once) {
      if (!r.onceUsed[slot] && canUse(race, r, s)) useSkill(race, r, s, slot);
      return;
    }
    if (r.cds[slot] > 0 || !canUse(race, r, s)) return; // 조건 미충족 시 보류
    if (rng.chance(cfg.skillUseRate, dt)) useSkill(race, r, s, slot);
  });

  if (!r.ultUsed && r.gauge >= cfg.gauge.max && !r.finished) {
    if (r.ultReadyAt === null) r.ultReadyAt = race.t;
    if (race.finishLine - r.pos < cfg.ultCutoff) return;
    if (!canUse(race, r, r.def.ult) || !ultSituationOk(race, r)) return;
    const rate = r.def.ult.decisive ? cfg.ultUseRateDecisive : isBottomHalf(race, r) ? cfg.ultUseRateBottom : cfg.ultUseRate;
    if (rng.chance(rate, dt)) useSkill(race, r, r.def.ult, 'ult');
  }
}
