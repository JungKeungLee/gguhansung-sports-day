// 결승 역전 이벤트: 먼저 폭발 3회 → 바람 → 블랙홀(대상 부족 시 바람) → 가중치 추첨
export type GateEventKind = 'blast' | 'hole' | 'wind';
export const GATE_EVENT_WEIGHTS: Record<GateEventKind, number> = { blast: 0.2, hole: 0.4, wind: 0.4 };
const KINDS: GateEventKind[] = ['blast', 'hole', 'wind'];

export function chooseGateEvent(fired: number, random: () => number, force: GateEventKind | null = null): GateEventKind {
  if (force) return force; // 개발 QA에서는 강제 종류 우선
  if (fired < 3) return 'blast'; // 첫 3회의 유효 이벤트는 폭발, 바람·블랙홀은 선행하지 않음
  if (fired === 3) return 'wind';
  if (fired === 4) return 'hole'; // 이동 가능한 공 부족 시 호출부에서 바람으로 대체
  let roll = random();
  for (const kind of KINDS) {
    roll -= GATE_EVENT_WEIGHTS[kind];
    if (roll < 0) return kind;
  }
  return 'blast'; // 난수 경계 안전장치
}
