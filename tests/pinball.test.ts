import { describe, expect, it } from 'vitest';
import { MAX_BALLS, type BallRecord, parseEntries, rankBalls } from '../src/pinball/entries';
import { chooseGateEvent } from '../src/pinball/gateRules';
import { mapPhysics } from '../src/pinball/maps';

describe('핀볼 참가자 입력', () => {
  it('닉네임*개수 문법: 예시 → 총 8개, 공마다 고유 ID', () => {
    const r = parseEntries('난워니*3\n김옥독*2\n야뿌\n다뮤*2');
    expect(r.errors).toEqual([]);
    expect(r.total).toBe(8);
    expect(r.balls.filter((b) => b.name === '난워니').map((b) => b.ordinal)).toEqual([1, 2, 3]);
    expect(new Set(r.balls.map((b) => b.id)).size).toBe(8);
  });
  it('중복 닉네임 허용(줄이 달라도 번호 이어짐), 빈 줄 무시', () => {
    const r = parseEntries('야뿌\n\n야뿌*2');
    expect(r.total).toBe(3);
    expect(r.balls.map((b) => b.ordinal)).toEqual([1, 2, 3]);
  });
  it('입력 검증: 빈 닉네임·잘못된 개수·최대 개수 초과', () => {
    expect(parseEntries('*3').errors.length).toBe(1);
    expect(parseEntries('야뿌*0').errors.length).toBe(1);
    expect(parseEntries('야뿌*abc').errors.length).toBe(1);
    expect(parseEntries(`야뿌*${MAX_BALLS + 1}`).errors[0]).toContain(`${MAX_BALLS}`);
    expect(parseEntries(`야뿌*${MAX_BALLS}`).errors).toEqual([]);
  });
});

describe('핀볼 우승 방식', () => {
  const rec = (id: string, t: number | null, order: number | null): BallRecord =>
    ({ id, name: id, ordinal: 1, label: id, color: 0, finishTime: t, finishOrder: order, unstuckCount: 0 });
  it('A(먼저 도착): 도착 순서 오름차순, 미완주 제외, 시간 무관', () => {
    // 시간과 도착 순서가 어긋나도 순위는 도착 순서만 따름
    const r = rankBalls([rec('a', 9.0, 2), rec('b', 10.1, 1), rec('c', null, null)], 'first');
    expect(r.winner?.id).toBe('b');
    expect(r.rows.map((x) => [x.id, x.rank])).toEqual([['b', 1], ['a', 2]]);
    expect(r.complete).toBe(false);
  });
  it('같은 시간이어도 도착 순서가 달라 공동 순위 없음', () => {
    const r = rankBalls([rec('a', 5, 1), rec('b', 5, 2), rec('c', 5, 3)], 'first');
    expect(r.rows.map((x) => x.rank)).toEqual([1, 2, 3]);
  });
  it('B(마지막 도착): 전원 완주 전에는 우승자 없음, 완주 후 가장 늦은 공 1등', () => {
    expect(rankBalls([rec('a', 12.5, 2), rec('c', null, null)], 'last').winner).toBeNull();
    const r = rankBalls([rec('a', 12.5, 2), rec('b', 10.1, 1), rec('c', 15.0, 3)], 'last');
    expect(r.rows.map((x) => [x.id, x.rank])).toEqual([['c', 1], ['a', 2], ['b', 3]]);
  });
});

describe('핀볼 결과 복사', () => {
  it('도착 순서 표기, 완주 시간 제외', async () => {
    const { formatPinballCopy } = await import('../src/pinball/result');
    const r = (id: string, name: string, ordinal: number, order: number): BallRecord =>
      ({ id, name, ordinal, label: name, color: 0, finishTime: 1, finishOrder: order, unstuckCount: 0 });
    const recs = [r('a', '난워니', 2, 4), r('b', '돈까스', 8, 3), r('c', '김옥독', 1, 2), r('d', '야뿌', 1, 1)];
    const text = formatPinballCopy(rankBalls(recs, 'last'), 'last', 4);
    expect(text.split('\n')).toEqual([
      '꾸한성 핀볼 레이스', '우승 방식: 마지막 도착 우승', '참가 공: 4개', '',
      '🥇 1등: 난워니 2번 (4번째 도착)', '🥈 2등: 돈까스 8번 (3번째 도착)', '🥉 3등: 김옥독 1번 (2번째 도착)', '4등: 야뿌 1번 (1번째 도착)',
    ]);
    expect(text).not.toMatch(/초/);
  });
});

describe('핀볼 참가자 통합 (멤버 선택 + 자유 입력)', () => {
  it('멤버 줄 + 자유 입력 합산, 같은 이름 번호 이어짐, 50개 제한', async () => {
    const { buildEntries } = await import('../src/pinball/entries');
    const r = buildEntries([{ name: '김옥독', count: 2 }, { name: '야뿌', count: 1 }], '돈까스*10\n치킨*5\n김옥독');
    expect(r.errors).toEqual([]);
    expect(r.total).toBe(19);
    expect(r.balls.filter((b) => b.name === '돈까스').length).toBe(10);
    expect(r.balls.filter((b) => b.name === '김옥독').map((b) => b.ordinal)).toEqual([1, 2, 3]);
    expect(new Set(r.balls.map((b) => b.id)).size).toBe(19);
    expect(buildEntries([{ name: '야뿌', count: 495 }], '돈까스*10').errors[0]).toContain('최대 500개');
    expect(buildEntries([], '돈까스*500').errors).toEqual([]);
    expect(buildEntries([], '돈까스*500').balls.length).toBe(500);
    expect(buildEntries([], '', ['야뿌: 공 개수는 1 이상의 숫자로 입력해주세요']).errors.length).toBe(1);
  });
});

describe('핀볼 같은 스텝 동시 도착', () => {
  it('공 고유 ID 번호순으로 도착 순서 부여 (ball-10이 ball-9 뒤)', async () => {
    const { orderSameStep } = await import('../src/pinball/entries');
    expect(orderSameStep([{ id: 'ball-10' }, { id: 'ball-2' }, { id: 'ball-9' }]).map((x) => x.id)).toEqual(['ball-2', 'ball-9', 'ball-10']);
  });
});

describe('쉼표 구분 입력', () => {
  it('쉼표·줄바꿈 혼합, 공백 닉네임 허용', () => {
    expect(parseEntries('돈까스*3,피자*3,햄버거*3').total).toBe(9);
    const r = parseEntries('돈까스*3, 피자*3\n햄버거*3, 짜장면*10');
    expect(r.errors).toEqual([]);
    expect(r.total).toBe(19);
    expect(parseEntries('맛있는 피자*3 , 치킨').lines).toEqual([{ name: '맛있는 피자', count: 3 }, { name: '치킨', count: 1 }]);
    expect(parseEntries('야뿌,,*2').errors.some((e) => e.includes('닉네임이 비어'))).toBe(true);
  });
});

describe('핀볼 결승 이벤트·튕김 감소', () => {
  it('실제 폭발 다음에만 바람 또는 블랙홀이 나오고, 다시 폭발한다', () => {
    let rolls = 0;
    const random = () => { rolls++; return 0.9; };
    expect(chooseGateEvent(0, random)).toBe('blast');
    expect(rolls).toBe(0); // 첫 폭발을 고르는 데 난수 소모 없음
    expect(chooseGateEvent(1, () => 0.1)).toBe('hole');
    expect(chooseGateEvent(1, random)).toBe('wind');
    expect(chooseGateEvent(2, random)).toBe('blast');
    expect(chooseGateEvent(3, () => 0.3)).toBe('hole');
    expect(chooseGateEvent(4, random)).toBe('blast');
    expect(chooseGateEvent(0, random, 'wind')).toBe('wind'); // 개발 QA
  });

  it('다른 맵의 돌풍·블랙홀도 결승 폭발 완료 전에는 발동 불가', async () => {
    const { canSpawnHazard } = await import('../src/pinball/gateRules');
    expect(canSpawnHazard('gust', false)).toBe(false);
    expect(canSpawnHazard('blackhole', false)).toBe(false);
    expect(canSpawnHazard('bomb', false)).toBe(true);
    expect(canSpawnHazard('warp', false)).toBe(true);
    expect(canSpawnHazard('gust', true)).toBe(true);
    expect(canSpawnHazard('blackhole', true)).toBe(true);
  });

  it('기본 맵은 유지하고 나머지 맵의 공·핀·판·회전체 반발이 낮아짐', () => {
    expect(mapPhysics('basic').ball).toBe(0.25);
    for (const id of ['maze', 'rotor', 'portal', 'chaos'] as const) {
      const p = mapPhysics(id);
      expect(p.ball).toBe(0.38);
      expect(p.pin).toBe(0.4);
      expect(p.plate).toBe(0.24);
      expect(p.rotor).toBe(0.28);
    }
  });
});

describe('핀볼 결승 한쪽 끝 고정형 회전 날개와 공통 스타일', () => {
  it('5개 맵이 같은 검정 배경·회색 경계선, 고유 포인트 색만 사용', async () => {
    const { PINBALL_MAPS } = await import('../src/pinball/maps');
    for (const map of PINBALL_MAPS) {
      expect(map.theme.bgTop).toBe(0x04070a);
      expect(map.theme.bgBottom).toBe(0x04070a);
      expect(map.theme.stroke).toBe(0xb8c6cf);
      expect(map.theme.accent).toBeGreaterThan(0);
    }
  });
  it('결승 날개는 왼쪽 경사선에 축이 붙고 길이 234px이며 입구와 충돌하지 않음', async () => {
    const { finishFlipperMount } = await import('../src/pinball/maps');
    const width = 800, gap = 46, gateY = 5000;
    const flipper = finishFlipperMount(width, gap, gateY, 45);
    expect(flipper.len).toBe(234);
    expect(flipper.x).toBeLessThan(width / 2);
    expect(flipper.x - flipper.railX).toBeCloseTo(14);
    for (const angle of [0.22, 0.41, 0.60]) {
      const tipX = flipper.x + Math.cos(angle) * flipper.len;
      const tipY = flipper.y + Math.sin(angle) * flipper.len;
      const edgeX = width / 2 - gap / 2 - (gateY - tipY);
      expect(tipX - edgeX).toBeGreaterThan(35); // 공·경사판 사이 여유
      expect(tipY).toBeLessThan(gateY - 25); // 좁은 입구를 직접 막지 않음
    }
  });
});
