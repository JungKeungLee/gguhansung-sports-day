import { CHARACTERS } from '../src/game/characters';
import { CONFIG } from '../src/game/config';
import { Race } from '../src/game/sim/race';
import type { CharId } from '../src/game/types';

type Factors=Record<CharId,number>;
type Mode='mixed'|'reverse';
const ids=CHARACTERS.map(c=>c.id);
const N=Number(process.argv[2]||4500),ROUNDS=Number(process.argv[3]||7),OFFSET=Number(process.argv[4]||30000);
const forward: Factors={...CONFIG.normalSpeedFactor},backward: Factors={...CONFIG.reverseWorld.speedFactor};
const asRates=(wins:Record<string,number>)=>Object.fromEntries(ids.map(id=>[id,Math.round(wins[id]*10000/N)/100]));
const scoreRates=(rates:Record<string,number>)=>ids.reduce((s,id)=> {
 const rate=rates[id];
 return s+Math.pow(Math.max(0,rate-10.3,9.5-rate),2)+.08*Math.pow(rate-10,2);
},0);
function evalMode(mode:Mode,front:Factors,reverse:Factors){
 const cfg={...CONFIG,normalSpeedFactor:front,reverseWorld:{...CONFIG.reverseWorld,speedFactor:reverse},
 finishMove:mode==='reverse'?{...CONFIG.finishMove,outcomes:[{to:-1,w:1}]}:CONFIG.finishMove};
 const wins:Record<string,number>=Object.fromEntries(ids.map(id=>[id,0]));
 let forced=0,reverseCount=0;
 for(let i=0;i<N;i++){
  const race=new Race(ids,(Math.imul(i+OFFSET,2654435761)+0x4e5eab)>>>0,cfg).runToEnd();
  wins[race.ranking()[0].def.id]++;if(race.forcedEnd)forced++;if(race.reversed)reverseCount++;
 }
 return {rates:asRates(wins),score:scoreRates(asRates(wins)),forced,reverseCount};
}
function optimize(mode:Mode,front:Factors,reverse:Factors){
 let current={...(mode==='mixed'?front:reverse)};
 let best={...current},bestScore=Infinity,bestRates:Record<string,number>={};
 for(let round=0;round<ROUNDS;round++){
  const actual=evalMode(mode,mode==='mixed'?current:front,mode==='reverse'?current:reverse);
  if(actual.forced)throw Error('forced end '+mode);
  if(actual.score<bestScore){bestScore=actual.score;best={...current};bestRates=actual.rates;}
  console.log('OPT_ROUND '+JSON.stringify({mode,round,rates:actual.rates,score:actual.score,bestScore,reverseCount:actual.reverseCount}));
  if(round===ROUNDS-1)break;
  const step=.00135*Math.pow(.90,round);
  const delta:Record<string,number>={};
  for(const id of ids){const rate=actual.rates[id];delta[id]=Math.max(-.003,Math.min(.003,(10-rate)*step));}
  const mean=ids.reduce((s,id)=>s+delta[id],0)/ids.length;
  current=Object.fromEntries(ids.map(id=>[id,Math.round((current[id]+delta[id]-mean)*100000)/100000])) as Factors;
 }
 console.log('OPT_BEST '+JSON.stringify({mode,score:bestScore,rates:bestRates,factors:best}));
 return best;
}
const optimizedForward=optimize('mixed',forward,backward);
const optimizedReverse=optimize('reverse',optimizedForward,backward);
console.log('OPT_RESULT '+JSON.stringify({normalSpeedFactor:optimizedForward,reverseSpeedFactor:optimizedReverse,seedOffset:OFFSET,trainN:N,rounds:ROUNDS}));
