// 자동 밸런스 시뮬레이션: npm run balance -- [경기수=10000] [인원=10]
import { CHARACTERS } from '../src/game/characters';
import { Race } from '../src/game/sim/race';
import { buildResults } from '../src/game/result';
import type { CharId } from '../src/game/types';

const args = process.argv.slice(2).filter((a) => /^\d+$/.test(a));
const N = Number(args[0] ?? 10000);
const PLAYERS = Number(args[1] ?? 10);
const ids = CHARACTERS.map((c) => c.id);

type Acc = { ultWins: number; ultRaces: number; ultTimeSum: number; wins: number; races: number; time: number; skills: number; ults: number; hits: number; dodges: number; podium: number; rankSum: number };
const acc: Record<string, Acc> = Object.fromEntries(
  ids.map((id) => [id, { ultWins: 0, ultRaces: 0, ultTimeSum: 0, wins: 0, races: 0, time: 0, skills: 0, ults: 0, hits: 0, dodges: 0, podium: 0, rankSum: 0 }]),
);
let totalTime = 0, maxTime = 0, minTime = Infinity, finishMoves = 0, overtakes = 0, leadChanges = 0;
let uN = 0, uW = 0, nN = 0, nW = 0, nTop3 = 0;
let forced = 0, timeErrors = 0, ties = 0, comebacks = 0, midRanked = 0, cheers = 0;
const finishDist: Record<number, number> = {};
const started = Date.now();

for (let g = 0; g < N; g++) {
  let lineup: CharId[] = ids;
  if (PLAYERS < 10) {
    const pool = [...ids];
    lineup = [];
    for (let k = 0; k < PLAYERS; k++) lineup.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  const race = new Race(lineup, (g * 2654435761) >>> 0).runToEnd();
  if (race.forcedEnd) forced++;
  const rows = buildResults(race);
  // 완주 시간 검증: 정렬 일관성 + 완주자 수
  if (rows.length !== lineup.length) timeErrors++;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].timeMs < rows[i - 1].timeMs) timeErrors++;
    if (rows[i].timeMs === rows[i - 1].timeMs) ties++;
  }
  const last = rows[rows.length - 1].timeMs / 1000;
  totalTime += last; maxTime = Math.max(maxTime, last); minTime = Math.min(minTime, last);
  if (race.finishMoved) finishMoves++;
  finishDist[race.finishLine] = (finishDist[race.finishLine] ?? 0) + 1;
  overtakes += race.overtakes; leadChanges += race.leadChanges; cheers += race.cheerCount;
  const winner = rows[0];
  if (race.midRanks) {
    midRanked++;
    if (race.midRanks[winner.index] > Math.ceil(lineup.length / 2)) comebacks++;
  }
  for (const row of rows) {
    const a = acc[row.id];
    a.races++; a.time += row.timeMs / 1000; a.skills += row.stats.skillUses;
    a.ults += row.stats.ultUsed ? 1 : 0; a.hits += row.stats.obstacleHits; a.dodges += row.stats.dodges;
    a.rankSum += row.rank;
    if (row.rank === 1) a.wins++;
    if (row.stats.ultUsed) { uN++; if (row.rank === 1) uW++; } else { nN++; if (row.rank === 1) nW++; if (row.rank <= 3) nTop3++; }
    if (row.stats.ultUsed) { a.ultRaces++; a.ultTimeSum += row.stats.ultTime!; if (row.rank === 1) a.ultWins++; }
    if (row.rank <= 3) a.podium++;
  }
}

const pct = (x: number, d: number) => ((100 * x) / d).toFixed(1) + '%';
console.log(`\n=== ${N}경기 시뮬레이션 (${PLAYERS}명 참가) — ${((Date.now() - started) / 1000).toFixed(1)}s ===`);
console.log('캐릭터      우승률  시상대  평균순위 평균완주  스킬/경기 필살기  장애물피격 회피  | 필살기O승률 필살기X승률 평균발동시점');
for (const c of CHARACTERS) {
  const a = acc[c.id];
  if (!a.races) continue;
  console.log(
    `${c.name.padEnd(6, '　')} ${pct(a.wins, a.races).padStart(6)} ${pct(a.podium, a.races).padStart(6)}  ` +
    `${(a.rankSum / a.races).toFixed(2).padStart(5)}  ${(a.time / a.races).toFixed(2).padStart(6)}s ` +
    `${(a.skills / a.races).toFixed(2).padStart(7)} ${pct(a.ults, a.races).padStart(7)} ` +
    `${(a.hits / a.races).toFixed(2).padStart(8)} ${(a.dodges / a.races).toFixed(2).padStart(6)}  | ` +
    `${pct(a.ultWins, a.ultRaces || 1).padStart(9)} ${pct(a.wins - a.ultWins, (a.races - a.ultRaces) || 1).padStart(10)} ${(a.ultTimeSum / (a.ultRaces || 1)).toFixed(1).padStart(9)}s`,
  );
}
console.log(`\n경기 시간(꼴찌 완주): 평균 ${(totalTime / N).toFixed(1)}s, 최소 ${minTime.toFixed(1)}s, 최대 ${maxTime.toFixed(1)}s`);
console.log(`결승선 이동: ${pct(finishMoves, N)}  분포: ${JSON.stringify(finishDist)}`);
console.log(`경기당 추월 ${(overtakes / N).toFixed(1)}회, 선두 교체 ${(leadChanges / N).toFixed(1)}회, 응원 이벤트 ${(cheers / N).toFixed(2)}회`);
console.log(`필살기 사용 ${uN}건 우승률 ${pct(uW, uN)} / 미사용 ${nN}건 우승률 ${pct(nW, nN)}, 시상대 ${pct(nTop3, nN)}`);
console.log(`50m 지점 하위권 → 우승(역전승): ${pct(comebacks, midRanked)}`);
console.log(`무한 진행/강제 종료: ${forced}건, 순위·시간 오류: ${timeErrors}건, 동일 기록(공동순위): ${ties}건`);
if (forced || timeErrors) process.exitCode = 1;
