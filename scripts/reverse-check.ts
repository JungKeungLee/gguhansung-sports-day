// feature-branch only: seeded regression sample for regular and 0m return-leg balance
import { CHARACTERS } from '../src/game/characters';
import { CONFIG } from '../src/game/config';
import { Race } from '../src/game/sim/race';

const ids = CHARACTERS.map((c) => c.id);
const N = Number(process.argv[2] || 2000);
const cfg = { ...CONFIG, finishMove: { ...CONFIG.finishMove, outcomes: [{ to: -1, w: 1 }] } };
const wins: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
let reverse = 0, cancelled = 0, forced = 0, kkuro = 0, missingEnd = 0;
for (let i = 0; i < N; i++) {
  const race = new Race(ids, (Math.imul(i, 2654435761) + 0x4e5eab) >>> 0, cfg).runToEnd();
  if (race.reversed) reverse++; else if (race.finishPlan.cancelled) cancelled++;
  if (race.forcedEnd) forced++;
  kkuro += race.events.filter((e) => e.type === 'kkuro').length;
  if (!race.done || race.finishedCount !== ids.length) missingEnd++;
  wins[race.ranking()[0].def.id]++;
}
console.log('REVERSE_CHECK '+JSON.stringify({ N, reverse, cancelled, forced, kkuro, missingEnd, rates: Object.fromEntries(ids.map((id) => [id, Math.round(wins[id] * 10000 / N) / 100])) }));
if (forced || missingEnd || kkuro !== N || reverse === 0) process.exitCode = 1;
