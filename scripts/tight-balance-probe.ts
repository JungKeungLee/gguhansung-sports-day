import { CHARACTERS } from '../src/game/characters';
import { CONFIG } from '../src/game/config';
import { Race } from '../src/game/sim/race';
import type { CharId } from '../src/game/types';

const ids = CHARACTERS.map(c => c.id);
const N = Number(process.argv[2] || 6500), OFFSET = Number(process.argv[3] || 20000);
const mode = process.argv[4] || 'mixed';
if (!['mixed','reverse'].includes(mode)) throw Error('mode must be mixed or reverse');
type Factors = Record<CharId, number>;
const tune = (delta: number[], baseline: Factors): Factors => Object.fromEntries(ids.map((id,i)=>[id,Math.round((baseline[id] + delta[i]) * 10000)/10000])) as Factors;
const baseForward=CONFIG.normalSpeedFactor,baseReverse=CONFIG.reverseWorld.speedFactor;
const variants: Array<[string,number[],number[]]> = [
 ['targetA',[.001,-.001,0,0,-.002,.003,0,0,-.003,0],[0,0,.001,.002,.002,0,0,0,-.003,-.003]],
 ['targetB',[.002,-.001,0,0,-.003,.004,0,0,-.004,0],[0,0,.002,.003,.003,0,0,0,-.004,-.004]],
 ['targetC',[.002,-.002,.001,0,-.002,.004,.001,-.001,-.005,-.001],[-.001,0,.003,.004,.003,0,.001,0,-.006,-.005]],
];
for(const [name,df,dr] of variants) {
 const normalSpeedFactor=tune(df,baseForward),speedFactor=tune(dr,baseReverse);
 const cfg={...CONFIG,normalSpeedFactor,reverseWorld:{...CONFIG.reverseWorld,speedFactor},
  finishMove: mode==='reverse'? {...CONFIG.finishMove,outcomes:[{to:-1,w:1}]}:CONFIG.finishMove};
 const wins: Record<string,number>=Object.fromEntries(ids.map(id=>[id,0]));
 let reversed=0,cancelled=0,forced=0;
 const started=Date.now();
 for(let i=0;i<N;i++) {
   const r=new Race(ids,(Math.imul(i+OFFSET,2654435761)+0x4e5eab)>>>0,cfg).runToEnd();
   wins[r.ranking()[0].def.id]++;
   if(r.reversed)reversed++;else if(r.finishPlan.cancelled)cancelled++;
   if(r.forcedEnd)forced++;
 }
 const rates=Object.fromEntries(ids.map(id=>[id,Math.round(wins[id]*10000/N)/100]));
 const score=ids.reduce((s,id)=>s+Math.max(0,rates[id]-10.3,9.5-rates[id])**2,0);
 console.log('BALANCE_PROBE '+JSON.stringify({mode,name,N,OFFSET,normalSpeedFactor,speedFactor,rates,score,reversed,cancelled,forced,seconds:Math.round((Date.now()-started)/1000)}));
 if(forced)process.exitCode=1;
}
