// 핀볼 레이스: 참가자 입력 해석 + 공별 기록 + 우승 방식별 순위 (100m 달리기와 독립)

export const MAX_BALLS = 500;     // 경기당 최대 공 개수 (변경 시 이 값만 수정)
export const MIN_BALLS = 2;
export const MAX_NAME_LEN = 12;

export type WinMode = 'first' | 'last'; // first: 먼저 도착한 공 우승 / last: 가장 늦게 도착한 공 우승
export const WIN_MODE_LABEL: Record<WinMode, string> = { first: '먼저 도착하면 우승', last: '마지막에 도착하면 우승' };

export interface BallSpec {
  id: string;        // 공 고유 ID (같은 닉네임이어도 공마다 다름)
  name: string;      // 닉네임
  ordinal: number;   // 같은 닉네임 안에서 몇 번째 공인지 (1부터)
  sameNameCount: number;
  color: number;     // 공 색상 (공마다 구분)
}

export interface EntryLine { name: string; count: number }

export interface ParseResult {
  balls: BallSpec[];
  lines: { name: string; count: number }[];
  errors: string[];
  total: number;
}

/** 공 표시 이름: 같은 닉네임 공이 여러 개면 번호 부여 (난워니1, 난워니2 …) */
export const ballLabel = (b: BallSpec) => (b.sameNameCount > 1 ? `${b.name}${b.ordinal}` : b.name);

function ballColor(i: number): number {
  const h = (i * 137.508) % 360; // 황금각으로 색 분산
  const s = 0.72, l = i % 2 ? 0.58 : 0.66;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

/** 한 줄에 닉네임 하나, `닉네임*개수` 지원 (개수 생략 시 1개) */
export function parseEntries(text: string): ParseResult {
  return buildEntries([], text);
}

/** 텍스트 해석: 줄바꿈·쉼표로 구분 (빈 항목 무시, `이름*개수`, 개수 생략 시 1) */
export function parseLines(text: string): { lines: EntryLine[]; errors: string[] } {
  const lines: EntryLine[] = [];
  const errors: string[] = [];
  // 줄바꿈과 쉼표 모두 구분자 (앞뒤 공백 제거). 일반 띄어쓰기는 닉네임 일부로 허용 ("맛있는 피자*3")
  text.split(/\r?\n/).forEach((rawLine, idx) => rawLine.split(',').forEach((raw) => {
    const line = raw.trim();
    if (!line) return;
    const m = line.match(/^(.*?)\s*\*\s*(\S*)\s*$/);
    const name = (m ? m[1] : line).trim();
    const countText = m ? m[2] : '1';
    const n = idx + 1;
    if (!name) { errors.push(`${n}번째 줄: 닉네임이 비어 있어요`); return; }
    if (name.length > MAX_NAME_LEN) { errors.push(`${n}번째 줄: 닉네임은 ${MAX_NAME_LEN}자 이하로 입력해주세요`); return; }
    if (!/^\d+$/.test(countText) || Number(countText) < 1) { errors.push(`${n}번째 줄: 개수는 1 이상의 숫자로 입력해주세요 (예: ${name}*2)`); return; }
    lines.push({ name, count: Number(countText) });
  }));
  return { lines, errors };
}

/**
 * 참가자 통합: 멤버 선택 줄(preset) + 자유 입력 텍스트 → 하나의 목록으로 공 생성.
 * 같은 이름은 출처와 관계없이 이어서 번호를 매기고, 최대 개수 등 검증도 합산 기준.
 */
export function buildEntries(preset: EntryLine[], text: string, presetErrors: string[] = []): ParseResult {
  const parsed = parseLines(text);
  const lines = [...preset, ...parsed.lines];
  const errors = [...presetErrors, ...parsed.errors];
  const total = lines.reduce((s, l) => s + l.count, 0);
  if (total > MAX_BALLS) errors.push(`공은 최대 ${MAX_BALLS}개까지 가능해요 (현재 ${total}개)`);
  else if (total > 0 && total < MIN_BALLS) errors.push(`공은 최소 ${MIN_BALLS}개가 필요해요`);

  const nameTotals = new Map<string, number>();
  for (const l of lines) nameTotals.set(l.name, (nameTotals.get(l.name) ?? 0) + l.count);
  const seen = new Map<string, number>();
  const balls: BallSpec[] = [];
  if (total <= MAX_BALLS) {
    for (const l of lines) {
      for (let k = 0; k < l.count; k++) {
        const ordinal = (seen.get(l.name) ?? 0) + 1;
        seen.set(l.name, ordinal);
        const i = balls.length;
        balls.push({ id: `ball-${i + 1}`, name: l.name, ordinal, sameNameCount: nameTotals.get(l.name)!, color: ballColor(i) });
      }
    }
  }
  return { balls, lines, errors, total };
}

/** 같은 물리 스텝에 결승선을 통과한 공들의 도착 순서 기준: 공 고유 ID 번호 오름차순 (일관·중복 없음) */
export function orderSameStep<T extends { id: string }>(xs: T[]): T[] {
  const n = (id: string) => Number(id.replace(/\D/g, '')) || 0;
  return [...xs].sort((a, b) => n(a.id) - n(b.id));
}

// ───────────── 경기 기록 (다음 단계 결과 화면에서 사용) ─────────────
export interface BallRecord {
  id: string;
  name: string;
  ordinal: number;             // 같은 닉네임 안의 공 번호
  label: string;
  color: number;
  finishTime: number | null;   // 결승선 통과 시각(초, 내부 기록용 — 순위·화면에 사용 안 함). 미완주는 null
  finishOrder: number | null;  // 실제 도착 순서 (1 = 가장 먼저)
  unstuckCount: number;        // 끼임 복구 횟수 (참고용)
  portals?: number;            // 포털 사용 횟수 (순간이동 맵)
}

export interface Ranking {
  rows: (BallRecord & { rank: number })[];
  winner: BallRecord | null;
  complete: boolean;           // 모든 공 완주 여부
}

/**
 * 우승 방식별 순위 — 결승선 통과 순서(finishOrder) 기준, 완주 시간은 사용하지 않음. 미완주 공은 제외.
 * - first: 도착 순서 오름차순 (첫 도착 즉시 우승 확정)
 * - last: 전원 완주 후에만 도착 순서 내림차순으로 확정 (그 전엔 우승자 없음)
 */
export function rankBalls(records: BallRecord[], mode: WinMode): Ranking {
  const done = records.filter((r) => r.finishTime !== null);
  const complete = done.length === records.length && records.length > 0;
  if (mode === 'last' && !complete) return { rows: [], winner: null, complete };
  // 도착 순서는 공마다 고유(중복 없음) → 공동 순위 없음
  const sorted = [...done].sort((a, b) => (mode === 'first' ? a.finishOrder! - b.finishOrder! : b.finishOrder! - a.finishOrder!));
  const rows = sorted.map((r, i) => ({ ...r, rank: i + 1 }));
  return { rows, winner: rows[0] ?? null, complete };
}
