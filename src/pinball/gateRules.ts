// 결승 역전 이벤트 순서 규칙 (Phaser 없이 독립 테스트 가능)
export type GateEventKind = 'blast' | 'hole' | 'wind';
export const GATE_EVENT_WEIGHTS: Record<GateEventKind, number> = { blast: 0.4, hole: 0.3, wind: 0.3 };
const KINDS: GateEventKind[] = ['blast', 'hole', 'wind'];

export function chooseGateEvent(fired: number, random: () => number, force: GateEventKind | null = null): GateEventKind {
  if (force) return force; // 개발 QA에서는 강제 종류 우선
  if (fired === 0) return 'blast'; // 충전 취소 시 fired는 0으로 유지돼 다음 유효 발동도 폭발
  let roll = random();
  for (const kind of KINDS) {
    roll -= GATE_EVENT_WEIGHTS[kind];
    if (roll < 0) return kind;
  }
  return 'blast'; // 난수 경계 안전장치
}
