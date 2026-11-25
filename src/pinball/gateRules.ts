// 결승 역전 이벤트: 최초 폭발 → 바람 → 블랙홀(가능할 때), 그 후 가중치 추첨 (Phaser 없이 독립 테스트 가능)
export type GateEventKind = 'blast' | 'hole' | 'wind';
export const GATE_EVENT_WEIGHTS: Record<GateEventKind, number> = { blast: 0.2, hole: 0.4, wind: 0.4 };
const KINDS: GateEventKind[] = ['blast', 'hole', 'wind'];

export function chooseGateEvent(fired: number, random: () => number, force: GateEventKind | null = null): GateEventKind {
  if (force) return force; // 개발 QA에서는 강제 종류 우선
  if (fired === 0) return 'blast'; // 첫 번째 유효 발동은 폭발
  if (fired === 1) return 'wind'; // 두 번째는 바람: 이벤트 종류가 한 가지에 치우치지 않도록
  if (fired === 2) return 'hole'; // 세 번째는 블랙홀 (대상 부족 시 호출부에서 바람으로 대체)
  let roll = random();
  for (const kind of KINDS) {
    roll -= GATE_EVENT_WEIGHTS[kind];
    if (roll < 0) return kind;
  }
  return 'blast'; // 난수 경계 안전장치
}
