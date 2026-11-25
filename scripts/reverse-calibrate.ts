// Temporary experiment: find fair reverse-only speed multipliers using actual Race physics.
// No player is picked to win; the existing skill simulation decides the winner.
import { CHARACTERS } from '../src/game/characters';
import { CONFIG } from '../src/game/config';
import { Race } from '../src/game/sim/race';
import type { CharId } from '../src/game/types';

const ids=CHARACTERS.map(c=>c.id),N=Number(process.argv[2]??3500),OFFSET=Number(process.argv[3]??2000);
type Factors=Record<CharId,number>;
const base=CONFIG.reverseWorld.speedFactor;
const candidates: Array<[string,Partial<Factors>]>=[
['base',{}],
['tinyA',{yappu:0.992,harunotsuki:0.999,manjo:1.005,moya:1.005,yuntami:1,yamuji:1.027,nanwony:1.007,kkutinho:1.019,kimokdok:0.993,damyu:0.990}],
['tinyB',{yappu:0.988,harunotsuki:0.995,manjo:1.006,moya:1.005,yuntami:0.997,yamuji:1.030,nanwony:1.005,kkutinho:1.021,kimokdok:0.991,damyu:0.987}],
];
for(const [name,factors] of candidates){
 const speedFactor={...base,...factors};
 const cfg={...CONFIG,finishMove:{...CONFIG.finishMove,outcomes:[{to:-1,w:1}]},reverseWorld:{...CONFIG.reverseWorld,speedFactor}};
 const wins=Object.fromEntries(ids.map(id=>[id,0])) as Record<CharId,number>;
 let reverse=0,cancelled=0,forced=0;
 const start=Date.now();
 for(let i=0;i<N;i++){
   const race=new Race(ids,(Math.imul(i+OFFSET,2654435761)+0x4e5eab)>>>0,cfg).runToEnd();
   if(race.reversed)reverse++;else cancelled++;
   if(race.forcedEnd)forced++;
   wins[race.ranking()[0].def.id]++;
 }
 const rates=Object.fromEntries(ids.map(id=>[id,Math.round(wins[id]*10000/N)/100]));
 console.log('CANDIDATE '+JSON.stringify({name,N,OFFSET,factors:speedFactor,reverse,cancelled,forced,rates,elapsedMs:Date.now()-start}));
 if(forced)process.exitCode=1;
}
