// Temporary candidate comparison. No running-game files are changed in this branch.
import { CHARACTERS, CHAR_BY_ID } from '../src/game/characters';
import { Race } from '../src/game/sim/race';

const ids = CHARACTERS.map((c) => c.id);
const moya = CHAR_BY_ID.moya.ult.actions[1] as { value: number };
const nan = CHAR_BY_ID.nanwony.skills[1].actions[0] as { value: number };
const dam = CHAR_BY_ID.damyu.ult.actions[0] as { max: number };
const haru = CHAR_BY_ID.harunotsuki.ult.actions[0] as { dist: number };
const kkut = CHAR_BY_ID.kkutinho.ult.actions[0] as { dist: number };
const kim = CHAR_BY_ID.kimokdok.skills[0].actions[0] as { value: number };
const yappu = CHAR_BY_ID.yappu.skills[0].actions[0] as { value: number };
const yamuji = CHAR_BY_ID.yamuji.skills[1].actions[1] as { dur: number };
const variants: Array<[string, [number, number, number, number, number, number, number, number]]> = [
 ['fineB_holdout', [.625,.41,.68,11.4,9.0,.265,.43,2.22]],
];
const N = Number(process.argv[2] || 3000);
for (const [name, values] of variants) {
  [moya.value, nan.value, dam.max, haru.dist, kkut.dist, kim.value, yappu.value, yamuji.dur] = values;
  const wins: Record<string, number> = Object.fromEntries(ids.map(id=>[id,0]));
  const ults: Record<string, number> = Object.fromEntries(ids.map(id=>[id,0]));
  let forced = 0, kkuro = 0;
  const started = Date.now();
  for (let g=3000;g<3000+N;g++) {
    const r = new Race(ids,Math.imul(g,2654435761)>>>0).runToEnd();
    wins[r.ranking()[0].def.id]++;
    if (r.forcedEnd) forced++;
    kkuro += r.events.filter(e=>e.type==='kkuro').length;
    for (const x of r.runners) if (x.ultUsed) ults[x.def.id]++;
  }
  console.log('VARIANT '+JSON.stringify({name,N,values,rate:Object.fromEntries(ids.map(id=>[id,Math.round(wins[id]*10000/N)/100])),ults:Object.fromEntries(ids.map(id=>[id,Math.round(ults[id]*10000/N)/100])),forced,kkuro,elapsedS:Math.round((Date.now()-started)/1000)}));
}
