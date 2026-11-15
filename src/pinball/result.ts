// 핀볼 결과: 복사 텍스트 생성 (순위 계산은 entries.ts rankBalls 재사용)
import { type BallRecord, type Ranking, type WinMode } from './entries';

/** 공 이름 (번호 포함): "다뮤 1번" */
export const ballNo = (r: Pick<BallRecord, 'name' | 'ordinal'>) => `${r.name} ${r.ordinal}번`;
export const fmtOrder = (n: number) => `${n}번째 도착`;
const COPY_MODE: Record<WinMode, string> = { first: '먼저 도착 우승', last: '마지막 도착 우승' };
const MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

export function formatPinballCopy(ranking: Ranking, mode: WinMode, total: number): string {
  return [
    '꾸한성 핀볼 레이스',
    `우승 방식: ${COPY_MODE[mode]}`,
    `참가 공: ${total}개`,
    '',
    ...ranking.rows.map((r) => `${MEDAL[r.rank] ? `${MEDAL[r.rank]} ` : ''}${r.rank}등: ${ballNo(r)} (${fmtOrder(r.finishOrder!)})`),
  ].join('\n');
}

/** 클립보드 복사 (실패 시 textarea 방식 재시도) */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
