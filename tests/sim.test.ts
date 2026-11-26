import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/game/characters';
import { CONFIG } from '../src/game/config';
import { Race } from '../src/game/sim/race';
import { useSkill, aiTick } from '../src/game/sim/skills';
import { registerHit, applyOpponentSlow, addEffect } from '../src/game/sim/runner';
import { crossObstacles } from '../src/game/sim/obstacles';
import { buildResults, assignRanks, formatCopyText } from '../src/game/result';
import { canStart, toggleSelect } from '../src/ui/selection';
import type { CharId } from '../src/game/types';

const ALL = CHARACTERS.map((c) => c.id);
const r = (race: Race, id: CharId) => race.runners.find((x) => x.def.id === id)!;
const cfgNoEvents = { ...CONFIG, finishMove: { ...CONFIG.finishMove, outcomes: [{ to: 100, w: 1 }] }, cheer: { ...CONFIG.cheer, chancePerSecond: 0 } };

describe('참가 선택', () => {
  it('1명 시작 불가 / 2명·10명 시작 가능', () => {
    expect(canStart(['yappu'])).toBe(false);
    expect(canStart(['yappu', 'moya'])).toBe(true);
    expect(canStart(ALL)).toBe(true);
  });
  it('중복 선택 불가, 재클릭 시 해제', () => {
    let s = toggleSelect([], 'yappu');
    s = toggleSelect(s, 'moya');
    expect(s).toEqual(['yappu', 'moya']);
    s = toggleSelect(s, 'yappu');
    expect(s).toEqual(['moya']);
    expect(() => new Race(['yappu', 'yappu'], 1)).toThrow();
    expect(() => new Race(['yappu'], 1)).toThrow();
  });
});

describe('경기 시뮬레이션', () => {
  it('같은 시드 → 같은 결과 (재현성)', () => {
    const a = buildResults(new Race(ALL, 42).runToEnd());
    const b = buildResults(new Race(ALL, 42).runToEnd());
    expect(a.map((x) => [x.id, x.timeMs])).toEqual(b.map((x) => [x.id, x.timeMs]));
  });

  it('2~10명 모두 완주, 강제 종료 없음, 결과 정렬', () => {
    for (let n = 2; n <= 10; n++) {
      for (let s = 0; s < 20; s++) {
        const race = new Race(ALL.slice(0, n), s * 7919 + n).runToEnd();
        expect(race.forcedEnd).toBe(false);
        const rows = buildResults(race);
        expect(rows.length).toBe(n);
        for (let i = 1; i < rows.length; i++) expect(rows[i].timeMs).toBeGreaterThanOrEqual(rows[i - 1].timeMs);
      }
    }
  });

  it('장애물은 10m 이후에만 생성', () => {
    for (let s = 0; s < 50; s++) {
      const race = new Race(ALL, s);
      for (const lane of race.obstaclesByLane) for (const ob of lane) expect(ob.pos).toBeGreaterThan(10);
    }
  });

  it('결승선 통과 시각 보간 (같은 프레임 통과도 정밀 비교)', () => {
    const race = new Race(['yappu', 'moya'], 1, cfgNoEvents);
    race.obstaclesByLane.forEach((l) => (l.length = 0));
    const a = r(race, 'yappu'), b = r(race, 'moya');
    a.pos = 99.99; b.pos = 99.96; a.cds = [99, 99]; b.cds = [99, 99];
    a.wobble = b.wobble = a.wobbleTarget = b.wobbleTarget = 0;
    a.wobbleNext = b.wobbleNext = 999;
    race.step();
    expect(a.finished && b.finished).toBe(true);
    expect(a.finishTime!).toBeLessThan(b.finishTime!);
    expect(a.finishTime!).toBeGreaterThan(0);
    expect(a.finishTime!).toBeLessThan(CONFIG.dt);
  });

  it('공동 순위 처리 (1,1,3)', () => {
    const rows = assignRanks([{ timeMs: 100, rank: 0 }, { timeMs: 100, rank: 0 }, { timeMs: 120, rank: 0 }]);
    expect(rows.map((x) => x.rank)).toEqual([1, 1, 3]);
  });

  it('필살기 게이지는 공개 상태에 포함되지 않음', () => {
    const race = new Race(ALL, 3);
    for (let i = 0; i < 600; i++) race.step();
    const pub = race.getPublic()[0] as unknown as Record<string, unknown>;
    expect('gauge' in pub).toBe(false);
    expect(Object.keys(pub).some((k) => /gauge|ult/i.test(k))).toBe(false);
  });

  it('필살기 자동 발동 (경기당 최대 1회)', () => {
    const race = new Race(ALL, 5).runToEnd();
    const ults = race.events.filter((e) => e.type === 'ult');
    expect(ults.length).toBeGreaterThan(0);
    const per = new Map<number, number>();
    ults.forEach((e) => per.set(e.actor!, (per.get(e.actor!) ?? 0) + 1));
    for (const c of per.values()) expect(c).toBe(1);
  });
});

describe('쿨타임·피격', () => {
  it('피격 시 두 스킬 쿨타임 2초 추가 감소, 2초에 한 번만', () => {
    const race = new Race(['yappu', 'moya'], 1);
    const a = r(race, 'yappu');
    a.cds = [8, 8];
    race.t = 10;
    registerHit(a, race.t, 'obstacle', CONFIG);
    expect(a.cds).toEqual([6, 6]);
    race.t = 11;
    registerHit(a, race.t, 'opponent', CONFIG);
    expect(a.cds).toEqual([6, 6]);
    race.t = 12.1;
    registerHit(a, race.t, 'opponent', CONFIG);
    expect(a.cds).toEqual([4, 4]);
  });

  it('면역으로 막으면 쿨타임 감소/게이지 증가 없음', () => {
    const race = new Race(['yappu', 'moya'], 1);
    const a = r(race, 'yappu'), b = r(race, 'moya');
    b.cds = [8, 8]; b.gauge = 0;
    addEffect(b, race.t, 'immuneDebuff', 0, 2, 'skill');
    expect(applyOpponentSlow(race, a, b, 0.3, 1)).toBe(false);
    expect(b.cds).toEqual([8, 8]);
    expect(b.gauge).toBe(0);
    expect(race.events.some((e) => e.type === 'blocked')).toBe(true);
  });

  it('장애물 회피 시 쿨타임 추가 감소 없음, 피격 후 보호 시간', () => {
    const race = new Race(['moya', 'yappu'], 1, cfgNoEvents);
    const m = r(race, 'moya');
    const lane = race.obstaclesByLane[m.lane];
    lane.length = 0;
    lane.push({ id: 1, lane: m.lane, pos: 20, len: 0, type: 'banana', state: 'idle' });
    lane.push({ id: 2, lane: m.lane, pos: 21, len: 0, type: 'rock', state: 'idle' });
    m.cds = [8, 8];
    addEffect(m, race.t, 'autoDodge', 0, 1, 'skill');
    crossObstacles(race, m, 19.9, 20.1);
    expect(lane[0].state).toBe('dodged');
    expect(m.cds).toEqual([8, 8]);
    m.effects = [];
    lane[0].state = 'idle';
    crossObstacles(race, m, 19.9, 20.1);
    expect(lane[0].state).toBe('hit');
    expect(m.cds).toEqual([6, 6]);
    crossObstacles(race, m, 20.9, 21.1);
    expect(lane[1].state).toBe('protected');
  });
});

describe('특수 스킬 결승선 보호', () => {
  const setup = (ids: CharId[]) => {
    const race = new Race(ids, 9, cfgNoEvents);
    race.obstaclesByLane.forEach((l) => (l.length = 0));
    return race;
  };

  it('월광 도약: 결승선 통과 불가 + 앞 캐릭터 바로 뒤까지만', () => {
    const race = setup(['harunotsuki', 'moya']);
    const h = r(race, 'harunotsuki'), m = r(race, 'moya');
    h.pos = 95; m.pos = 50;
    useSkill(race, h, h.def.ult, 'ult');
    expect(h.pos).toBeLessThan(race.finishLine);
    expect(h.finished).toBe(false);
    h.pos = 40; m.pos = 45;
    h.ultUsed = false;
    useSkill(race, h, h.def.ult, 'ult');
    expect(h.pos).toBeLessThan(45);
    expect(h.pos).toBeGreaterThan(44);
  });

  it('결승골 슛: 돌진으로 결승선 통과 불가, 경로 장애물 파괴', () => {
    const race = setup(['kkutinho', 'moya']);
    const k = r(race, 'kkutinho');
    race.obstaclesByLane[k.lane].push({ id: 1, lane: k.lane, pos: 96, len: 0, type: 'rock', state: 'idle' });
    k.pos = 93;
    useSkill(race, k, k.def.ult, 'ult');
    expect(race.obstaclesByLane[k.lane][0].state).toBe('destroyed');
    for (let i = 0; i < 20 && k.dash; i++) { race.step(); expect(k.finished).toBe(false); }
    expect(k.pos).toBeLessThan(race.finishLine);
  });

  it('전세 역전: 위치 교환으로 완주 처리 없음, 완주자와 교환 불가', () => {
    const race = setup(['kimokdok', 'moya', 'yappu']);
    const o = r(race, 'kimokdok'), m = r(race, 'moya'), y = r(race, 'yappu');
    y.finished = true; y.finishTime = 30; y.pos = 100;
    m.pos = 99.9; o.pos = 60;
    useSkill(race, o, o.def.ult, 'ult');
    expect(o.pos).toBeCloseTo(99.9);
    expect(m.pos).toBeCloseTo(60);
    expect(o.finished).toBe(false);
    expect(y.pos).toBe(100);
  });

  it('이미 완주한 캐릭터는 방해 대상 제외', () => {
    const race = setup(['yappu', 'moya']);
    const y = r(race, 'yappu'), m = r(race, 'moya');
    m.finished = true; m.finishTime = 1; m.pos = 100; y.pos = 90;
    useSkill(race, y, y.def.ult, 'ult');
    expect(m.effects.length).toBe(0);
    expect(race.events.some((e) => e.type === 'debuff' && e.target === m.index)).toBe(false);
  });

  it('여러 필살기 동시 발동해도 오류 없음', () => {
    const race = new Race(ALL, 11);
    for (let i = 0; i < 900; i++) race.step();
    for (const x of race.runners) x.gauge = 100, x.ultReadyAt = 0;
    for (const x of race.runners) if (!x.ultUsed) useSkill(race, x, x.def.ult, 'ult');
    race.runToEnd();
    expect(buildResults(race).length).toBe(10);
  });
});

describe('결승선 이동', () => {
  const forced = (to: number) => ({ ...CONFIG, finishMove: { ...CONFIG.finishMove, outcomes: [{ to, w: 1 }] } });

  // 이벤트별 강제 실행: 100(변경 없음)·120·130·150·70
  for (const to of [100, 120, 130, 150, 70]) {
    it(`${to}m: 최대 1회, 첫 완주 전 발동, 실제 판정에 사용, 기록 정렬`, () => {
      for (let s = 0; s < 25; s++) {
        const ids = ALL.slice(0, 2 + (s % 9));
        const race = new Race(ids, s * 97 + to, forced(to)).runToEnd();
        const moves = race.events.filter((e) => e.type === 'finishMove');
        expect(race.forcedEnd).toBe(false);
        expect(race.finishLine).toBe(to);
        expect(moves.length).toBe(to === 100 ? 0 : 1);
        if (moves.length) {
          expect(moves[0].from).toBe(100);
          expect(moves[0].to).toBe(to);
          expect(moves[0].t).toBeLessThanOrEqual(race.events.find((e) => e.type === 'finish')!.t);
        }
        for (const x of race.runners) expect(x.pos).toBe(to);
        const rows = buildResults(race);
        expect(rows.length).toBe(ids.length);
        for (let i = 1; i < rows.length; i++) expect(rows[i].timeMs).toBeGreaterThanOrEqual(rows[i - 1].timeMs);
      }
    });
  }

  it('70m 단축: 발동 순간 모든 선수가 70m보다 8m 이상 뒤, 위험하면 취소', () => {
    for (let s = 0; s < 40; s++) {
      const race = new Race(ALL, s, forced(70));
      let checked = false;
      while (!race.done) {
        const before = race.events.length;
        race.step();
        const e = race.events.slice(before).find((x) => x.type === 'finishMove');
        if (e) {
          checked = true;
          for (const x of race.runners) expect(x.pos).toBeLessThan(70);
          expect(Math.max(...race.runners.map((x) => x.prevPos))).toBeLessThanOrEqual(70 - CONFIG.finishMove.shortenSafety);
        }
      }
      expect(checked).toBe(true);
    }
    // 안전 조건 위반 상황 강제: 선두가 이미 66m → 단축 취소, 100m 유지
    const race = new Race(['yappu', 'moya'], 1, forced(70));
    race.runners[0].pos = 66; race.finishPlan.at = 0;
    race.step();
    expect(race.finishPlan.cancelled).toBe(true);
    expect(race.finishLine).toBe(100);
    race.runToEnd();
    expect(race.events.some((e) => e.type === 'finishMove')).toBe(false);
  });

  it('결과 분포: 5종 모두 발생, 특정 거리 편중 없음 (2,000경기)', () => {
    const cnt: Record<number, number> = {};
    for (let s = 0; s < 2000; s++) {
      const r = new Race(ALL, (s * 2654435761) >>> 0);
      cnt[r.finishPlan.to] = (cnt[r.finishPlan.to] ?? 0) + 1;
    }
    for (const o of CONFIG.finishMove.outcomes) {
      const total = CONFIG.finishMove.outcomes.reduce((a, b) => a + b.w, 0);
      expect(cnt[o.to] / 2000).toBeGreaterThan(o.w / total - 0.04);
      expect(cnt[o.to] / 2000).toBeLessThan(o.w / total + 0.04);
    }
  });
});

describe('일반·반전 세계 별도 속도 보정', () => {
  it('모든 캐릭터의 일반 보정 계수는 양수', () => {
    for (const factor of Object.values(CONFIG.normalSpeedFactor)) expect(factor).toBeGreaterThan(0);
  });

  it('반전 중에는 실제 이동속도만 조금 달라지고 출발점 결승은 유지', () => {
    const normal = new Race(['yappu', 'moya'], 712, cfgNoEvents);
    const boostedCfg = { ...cfgNoEvents, reverseWorld: {
      ...cfgNoEvents.reverseWorld,
      speedFactor: { ...cfgNoEvents.reverseWorld.speedFactor, yappu: 1.1 },
    } };
    const boosted = new Race(['yappu', 'moya'], 712, boostedCfg);
    for (const race of [normal, boosted]) {
      for (const [i, runner] of race.runners.entries()) {
        runner.pos = runner.prevPos = 50 + i;
        runner.cds = [999, 999];
        runner.onceUsed = [true, true];
      }
      race.obstaclesByLane.forEach((lane) => lane.length = 0);
      race.reverseWorld();
      race.step();
      expect(race.physicalPos(race.finishLine)).toBe(0);
    }
    expect(boosted.runners[0].pos).toBeGreaterThan(normal.runners[0].pos);
  });

  it('정상 경기에서는 보정값과 무관하게 동일 시드·동일 결과', () => {
    const ids = ALL;
    const a = new Race(ids, 1987, CONFIG).runToEnd();
    const modified = { ...CONFIG, reverseWorld: {
      ...CONFIG.reverseWorld,
      speedFactor: { ...CONFIG.reverseWorld.speedFactor, yappu: 1.2, yamuji: 0.8 },
    } };
    const b = new Race(ids, 1987, modified).runToEnd();
    expect(b.reversed).toBe(a.reversed);
    expect(b.ranking().map((r) => r.def.id)).toEqual(a.ranking().map((r) => r.def.id));
    expect(b.runners.map((r) => r.finishTime)).toEqual(a.runners.map((r) => r.finishTime));
  });
});

describe('🌍 반전 세계: 출발점으로 역주행', () => {
  const reverseCfg = { ...CONFIG, finishMove: { ...CONFIG.finishMove, outcomes: [{ to: -1, w: 1 }] } };

  it('10명 선두가 50~70m일 때 전원 20m 이상이면 0m로 역주행, 순위 재계산', () => {
    const race = new Race(ALL, 33, reverseCfg);
    race.kkuroPlan.done = true;
    // 첫 번째가 가장 앞서 있었지만 뒤돌아가기 시작하면 맨 뒤 사람이 유리하다.
    race.runners.forEach((runner, i) => {
      runner.pos = runner.prevPos = 50 + i;
      runner.cds = [99, 99]; runner.gauge = 0;
    });
    race.finishPlan.at = 50;
    const original = race.obstaclesByLane.flat().map((o) => ({ id: o.id, pos: o.pos }));
    race.step();
    expect(race.reversed).toBe(true);
    expect(race.finishMoved).toBe(true);
    expect(race.finishLine).toBe(100); // 내부 진행도는 0→100 증가, 물리 결승선은 0m
    expect(race.physicalPos(race.finishLine)).toBe(0);
    expect(race.events.filter((e) => e.type === 'reverseWorld')).toHaveLength(1);
    expect(race.events.filter((e) => e.type === 'finishMove')).toHaveLength(0);
    expect(race.runners[0].rank).toBe(1);
    expect(race.runners[9].rank).toBe(10);
    for (const old of original) {
      const ob = race.obstaclesByLane.flat().find((o) => o.id === old.id)!;
      expect(race.physicalPos(ob.pos + ob.len)).toBeCloseTo(old.pos);
    }
    race.runToEnd();
    expect(race.forcedEnd).toBe(false);
    for (const runner of race.runners) {
      expect(runner.finished).toBe(true);
      expect(race.physicalPos(runner.pos)).toBe(0);
    }
    expect(formatCopyText(buildResults(race), 0, true)).toContain('반전 세계');
  });

  it('2명·5명·10명에서 반전 이벤트는 1회, 모두 완주하고 꾸로 규칙도 유지', () => {
    for (const n of [2, 5, 10]) {
      for (let seed = 0; seed < 6; seed++) {
        const race = new Race(ALL.slice(0, n), seed * 7919 + n, reverseCfg);
        race.runners.forEach((runner, i) => { runner.pos = runner.prevPos = 30 + i * 0.02; });
        race.finishPlan.at = 50;
        race.runToEnd();
        expect(race.reversed).toBe(true);
        expect(race.forcedEnd).toBe(false);
        expect(race.events.filter((e) => e.type === 'reverseWorld')).toHaveLength(1);
        expect(race.events.filter((e) => e.type === 'kkuro')).toHaveLength(1);
        expect(buildResults(race)).toHaveLength(n);
        expect(new Set(race.runners.map((r) => r.index)).size).toBe(n);
      }
    }
  });

  it('출발점에 너무 가까운 참가자가 있으면 늦은 반전을 취소한다', () => {
    const race = new Race(['yappu', 'moya'], 101, reverseCfg);
    race.runners[0].pos = 71;
    race.runners[1].pos = 12;
    race.finishPlan.at = 50;
    race.step();
    expect(race.finishPlan.cancelled).toBe(true);
    expect(race.reversed).toBe(false);
    race.runToEnd();
    expect(race.events.some((e) => e.type === 'reverseWorld')).toBe(false);
  });
});

describe('순위 복사', () => {
  it('참가자 전원 + 결승선 거리 + 공동 순위 표기', () => {
    const race = new Race(['nanwony', 'kimokdok', 'yappu'], 77).runToEnd();
    const rows = buildResults(race);
    const text = formatCopyText(rows, race.finishLine);
    expect(text).toContain('🏆 꾸한성 대환장 운동회');
    expect(text).toContain(`📏 최종 결승선: ${race.finishLine}m`);
    expect(text).toContain('👥 참가 인원: 3명');
    expect(text).toContain('🥇 1등');
    expect(text).not.toContain('모야');
    const tie = formatCopyText(
      [{ ...rows[0], rank: 1, timeMs: 30000 }, { ...rows[1], rank: 1, timeMs: 30000 }, { ...rows[2], rank: 3, timeMs: 31000 }], 100,
    );
    expect(tie).toContain('🥇 1등 ' + rows[1].name + ' - 30.000초 (공동)');
    expect(tie).toContain('🥉 3등');
  });
});

describe('AI 보류 규칙', () => {
  it('대상이 없으면 방해 스킬 보류 (치과 가는 길)', () => {
    const race = new Race(['yappu', 'moya'], 2, cfgNoEvents);
    const y = r(race, 'yappu'), m = r(race, 'moya');
    y.pos = 50; m.pos = 10; y.cds = [99, 0];
    for (let i = 0; i < 120; i++) aiTick(race, y);
    expect(y.stats.skillUses).toBe(0);
  });
});

describe('필살기 발동 구조 (2차)', () => {
  it('야뿌 콜라 대폭발: 10인전 대부분에서 사용하고 중복 발동하지 않음', () => {
    const ult = CHARACTERS.find((c) => c.id === 'yappu')!.ult;
    expect(ult.trigger).toEqual([0.25, 0.65]);
    expect(ult.desc).toContain('36%');
    expect(ult.desc).toContain('18%');

    let used = 0;
    for (let s = 0; s < 100; s++) {
      const race = new Race(ALL, (s * 2654435761) >>> 0).runToEnd();
      const yappu = r(race, 'yappu');
      if (yappu.ultUsed) used++;
      expect(race.events.filter((e) => e.type === 'ult' && e.actor === yappu.index).length).toBeLessThanOrEqual(1);
    }
    expect(used).toBeGreaterThanOrEqual(85);
  });

  it('필살기를 못 쓰고 끝나는 경우가 존재하고, 경기당 최대 1회', () => {
    let used = 0, total = 0;
    for (let s = 0; s < 150; s++) {
      const race = new Race(ALL, s * 31 + 7).runToEnd();
      for (const x of race.runners) {
        total++;
        if (x.ultUsed) used++;
        expect(race.events.filter((e) => e.type === 'ult' && e.actor === x.index).length).toBeLessThanOrEqual(1);
      }
    }
    const rate = used / total;
    expect(rate).toBeGreaterThan(0.6);
    expect(rate).toBeLessThan(0.97);
  });

  it('결승선 6m 이내에서는 새로 발동하지 않음', () => {
    const race = new Race(['yappu', 'moya'], 4, cfgNoEvents);
    const y = r(race, 'yappu');
    y.pos = race.finishLine - 5; y.gauge = 100; y.ultTrigger = 0; y.cds = [99, 99];
    for (let i = 0; i < 600; i++) aiTick(race, y);
    expect(y.ultUsed).toBe(false);
  });

  it('숨겨진 발동 지점은 공개 상태에 없음', () => {
    const pub = new Race(ALL, 1).getPublic()[0] as unknown as Record<string, unknown>;
    expect(Object.keys(pub).some((k) => /trigger|gauge|ult/i.test(k))).toBe(false);
  });
});

describe('이미지 매니페스트', () => {
  it('10명 × 4종 WebP 표준 파일명 (_run/_skill/_ultimate/_victory)', async () => {
    const m = await import('../src/game/images');
    for (const id of ALL) {
      const want = { run: `${id}_run.webp`, skill: `${id}_skill.webp`, ultimate: `${id}_ultimate.webp`, victory: `${id}_victory.webp` };
      expect(m.CHARACTER_IMAGES[id]).toEqual(want);
    }
    expect(m.imageCandidates('kkutinho', 'victory')).toEqual(['/characters/kkutinho_victory.webp', '/characters/kkutinho_run.webp']);
    expect(m.assetUrl(m.STADIUM.night)).toBe('/backgrounds/stadium_night.webp');
    expect(Object.keys(m.OBSTACLE_IMAGES).sort()).toEqual(['banana', 'gust', 'pit', 'rock', 'zone']);
    expect(Object.keys(m.EFFECT_IMAGES).length).toBe(13);
    expect(Object.keys(m.UI_IMAGES).length).toBe(18); // commentary_panel은 예시 문장 제거본 사용
    expect(m.GATE_IMAGES).toEqual({ start: 'gates/race_start.webp', finish: 'gates/race_finish.webp' });
    expect(m.imageCandidates('yappu', 'ultimate')).toEqual(['/characters/yappu_ultimate.webp', '/characters/yappu_run.webp']);
  });
  it('포즈 누락 시 run, 전부 없으면 후보 없음(임시 캐릭터)', async () => {
    const m = await import('../src/game/images');
    const backup = m.CHARACTER_IMAGES.moya;
    m.CHARACTER_IMAGES.moya = { run: 'moya_run.webp' };
    expect(m.imageCandidates('moya', 'skill')).toEqual(['/characters/moya_run.webp']);
    m.CHARACTER_IMAGES.moya = {};
    expect(m.imageCandidates('moya', 'victory')).toEqual([]);
    m.CHARACTER_IMAGES.moya = backup;
  });
});

describe('속도·장애물·꾸로의 괴롭힘 (2026-11)', () => {
  it('기본속도 5.5m/s, 장애물 기존 대비 약 70% (100m 기준 레인당 평균 4.34 → 약 3.05, 종류 비율 유지)', async () => {
    const { generateObstacles } = await import('../src/game/sim/obstacles');
    const { Rng } = await import('../src/game/rng');
    expect(CONFIG.baseSpeed).toBe(5.5);
    let n = 0;
    for (let s = 0; s < 800; s++) n += generateObstacles(new Rng(s * 7919 + 1), 1, CONFIG)[0].filter((o) => o.pos < 100).length;
    expect(n / 800).toBeGreaterThan(2.85);
    expect(n / 800).toBeLessThan(3.25); // 기존 4.34 × 0.7 ≈ 3.04
  });
  it('10인전 밸런스 조정 수치 유지', () => {
    const by = (id: string) => CHARACTERS.find((c) => c.id === id)!;
    expect(by('yappu').skills[0].actions[0]).toMatchObject({ type: 'boost', value: 0.42, dur: 2.5 });
    expect(by('harunotsuki').ult.actions[0]).toMatchObject({ type: 'teleport', dist: 11.4 });
    expect(by('moya').ult.actions[1]).toMatchObject({ type: 'boost', value: 0.625, dur: 4 });
    expect(by('yamuji').skills[1].actions[1]).toMatchObject({ type: 'boost', value: 0.35, dur: 2.22 });
    expect(by('nanwony').skills[1].condition).toBe('bottomHalf');
    expect(by('nanwony').skills[1].cooldown).toBe(12);
    expect(by('nanwony').skills[1].actions[0]).toMatchObject({ type: 'boost', value: 0.41, dur: 3 });
    expect(by('kkutinho').ult.actions[0]).toMatchObject({ type: 'dash', dist: 9, speed: 8 });
    expect(by('kimokdok').skills[0].actions[0]).toMatchObject({ type: 'boost', value: 0.265, dur: 3 });
    expect(by('damyu').ult.actions[0]).toMatchObject({ type: 'ramp', step: 0.28, max: 0.68, dur: 5 });
  });
  it('꾸로: 경기당 정확히 1회, 인원별 대상 수 범위, 중복 없음, 감속/밀치기 적용', () => {
    const want: Record<number, [number, number]> = { 2: [1, 1], 3: [1, 2], 4: [2, 3], 5: [3, 3], 6: [3, 4], 7: [4, 5], 8: [4, 5], 9: [5, 7], 10: [7, 8] };
    for (let n = 2; n <= 10; n++) {
      const seen = new Set<number>();
      for (let s = 0; s < 60; s++) {
        const race = new Race(ALL.slice(0, n), s * 31 + n).runToEnd();
        const heads = race.events.filter((e) => e.type === 'kkuro');
        expect(heads.length).toBe(1);
        expect(race.kkuroPlan.at).toBeGreaterThanOrEqual(45);
        expect(race.kkuroPlan.at).toBeLessThanOrEqual(60);
        const hits = race.events.filter((e) => e.type === 'kkuroHit');
        expect(hits.every((e) => e.t === heads[0].t)).toBe(true);
        const targets = hits.map((e) => e.target!);
        expect(new Set(targets).size).toBe(targets.length);
        expect(targets.length).toBeGreaterThanOrEqual(want[n][0]);
        expect(targets.length).toBeLessThanOrEqual(want[n][1]);
        seen.add(targets.length);
      }
      expect(seen.size).toBe(want[n][1] - want[n][0] + 1); // 범위 내 모든 정수가 실제로 나옴
    }
  });
  it('꾸로 효과: 감속 35%·1.8초 / 3m 후퇴(위치·이전 위치 함께, 최소 0m), 완주자 제외', () => {
    const race = new Race(ALL, 77, cfgNoEvents);
    for (const x of race.runners) { x.pos = x.prevPos = 50; }
    race.runners[0].pos = race.runners[0].prevPos = 1; // 0m 하한 확인용
    race.runners[1].finished = true; race.runners[1].finishTime = 1; race.finishedCount = 1;
    race.kkuroPlan.at = 0;
    race.step();
    const hits = race.events.filter((e) => e.type === 'kkuroHit');
    expect(hits.length).toBeGreaterThanOrEqual(7);
    expect(hits.some((e) => e.target === 1)).toBe(false);
    for (const e of hits) {
      const x = race.runners[e.target!];
      if (e.label === 'slow') expect(x.effects.some((f) => f.tag === 'kkuro' && f.value === -0.35 && Math.abs(f.until - f.start - 1.8) < 1e-9)).toBe(true);
      if (e.label === 'push') expect(e.to).toBe(Math.max(0, e.from! - 3));
    }
    race.runToEnd();
    expect(race.events.filter((e) => e.type === 'kkuro').length).toBe(1);
  });
});
