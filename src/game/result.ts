// 결과 순위(공동 순위 포함) 및 복사 텍스트 생성
import type { Race } from './sim/race';
import type { ResultRow } from './types';

export function buildResults(race: Race): ResultRow[] {
  const rows = race.runners
    .filter((r) => r.finished && r.finishTime !== null)
    .map((r) => ({
      rank: 0, index: r.index, id: r.def.id, name: r.def.name,
      timeMs: Math.round(r.finishTime! * 1000), stats: { ...r.stats },
    }))
    .sort((a, b) => a.timeMs - b.timeMs || a.index - b.index);
  return assignRanks(rows);
}

/** 0.001초 단위로 같은 기록은 공동 순위 (1,1,3 방식) */
export function assignRanks<T extends { timeMs: number; rank: number }>(sorted: T[]): T[] {
  sorted.forEach((row, i) => {
    row.rank = i > 0 && sorted[i - 1].timeMs === row.timeMs ? sorted[i - 1].rank : i + 1;
  });
  return sorted;
}

export const formatTime = (ms: number) => (ms / 1000).toFixed(3);

const MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

export function formatCopyText(rows: ResultRow[], finishLine: number): string {
  const line = '━━━━━━━━━━━━━━━━';
  const tieCount = (rank: number) => rows.filter((r) => r.rank === rank).length;
  const body = rows.map((r) => {
    const medal = MEDALS[r.rank] ? `${MEDALS[r.rank]} ` : '';
    const tie = tieCount(r.rank) > 1 ? ' (공동)' : '';
    return `${medal}${r.rank}등 ${r.name} - ${formatTime(r.timeMs)}초${tie}`;
  });
  const winners = rows.filter((r) => r.rank === 1).map((r) => r.name).join(', ');
  return [
    '🏆 꾸한성 대환장 운동회',
    '🏁 자동 달리기 경기 결과',
    line,
    '',
    ...body,
    '',
    line,
    `🏆 우승: ${winners}`,
    `📏 최종 결승선: ${Math.round(finishLine)}m`,
    `👥 참가 인원: ${rows.length}명`,
  ].join('\n');
}
