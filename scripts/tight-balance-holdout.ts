import { CHARACTERS } from '../src/game/characters';
import { CONFIG } from '../src/game/config';
import { Race } from '../src/game/sim/race';
const ids=CHARACTERS.map(c=>c.id),mode=process.argv[2],N=Number(process.argv[3]||25000),offset=Number(process.argv[4]||60000);
const cfg=mode==='reverse'?{...CONFIG,finishMove:{...CONFIG.finishMove,outcomes:[{to:-1,w:1}]}}:CONFIG;
const wins:Record<string,number>=Object.fromEntries(ids.map(id=>[id,0]));
let forced=0,reversed=0;
for(let i=0;i<N;i++){const r=new Race(ids,(Math.imul(i+offset,2654435761)+0x4e5eab)>>>0,cfg).runToEnd();wins[r.ranking()[0].def.id]++;if(r.forcedEnd)forced++;if(r.reversed)reversed++;}
const rates=Object.fromEntries(ids.map(id=>[id,Math.round(wins[id]*10000/N)/100]));
console.log('WINRATE_HOLDOUT '+JSON.stringify({mode,N,rates,within:ids.every(id=>rates[id]>=9.5&&rates[id]<=10.3),reversed,forced}));
if(forced) process.exitCode=1;
