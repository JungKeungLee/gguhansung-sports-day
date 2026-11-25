// 결승 이벤트: 반드시 실제 폭발이 발생한 후에만 바람 또는 블랙홀이 나온다.
export type GateEventKind = 'blast' | 'hole' | 'wind';
// 폭발 뒤 후속 효과는 바람 또는 블랙홀을 같은 확률로 선택한다.
export const GATE_EVENT_WEIGHTS: Record<GateEventKind, number> = { blast: 0, hole: 0.5, wind: 0.5 };

export function chooseGateEvent(fired: number, random: () => number, force: GateEventKind | null = null): GateEventKind {
  if (force) return force; // 개발용 QA 강제 이벤트 우선
  if (fired % 2 === 0) return 'blast'; // 1·3·5번째는 폭발. 이벤트 완료 후에만 다음 발동
  return random() < GATE_EVENT_WEIGHTS.hole ? 'hole' : 'wind';
}

/** 별도 맵 이벤트 역시 실제 결승 폭발 완료 전에는 바람·블랙홀을 발생시키지 않는다. */
export function canSpawnHazard(kind: string, blastComplete: boolean): boolean {
  return blastComplete || (kind !== 'gust' && kind !== 'blackhole');
}
