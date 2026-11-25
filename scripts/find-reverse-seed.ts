import { CHARACTERS } from '../src/game/characters';
import { Race } from '../src/game/sim/race';
const ids = CHARACTERS.map((c) => c.id);
let seed = -1;
for (let s = 1; s <= 500; s++) {
  const race = new Race(ids, s).runToEnd();
  if (race.reversed) { seed = s; break; }
}
if (seed < 0) { console.error('No reverse seed within 500 samples'); process.exitCode = 1; }
else console.log(seed);
