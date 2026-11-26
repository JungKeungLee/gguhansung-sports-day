import { CHARACTERS } from '../src/game/characters';
import { CONFIG } from '../src/game/config';
import { Race } from '../src/game/sim/race';
import type { CharId } from '../src/game/types';
const ids=CHARACTERS.map(c=>c.id);
const mode=process.argv[2]??'normal';
const N=Number(process.argv[3]??3000), offset=Number(process.argv[4]??11500);
const nBase=CONFIG.normalSpeedFactor, rBase=CONFIG.reverseWorld.speedFactor;
type Fac=Partial<Record<CharId,number>>;
const normal: Array<[string,Fac]>=[
['base',{}],
['n1',{yappu:.997,harunotsuki:.999,manjo:1.001,moya:1.001,yuntami:.997,yamuji:1.007,nanwony:1.007,kkutinho:1.003,kimokdok:.995,damyu:1.008}],
['n2',{yappu:.995,harunotsuki:.997,manjo:1.002,moya:1.002,yuntami:.996,yamuji:1.010,nanwony:1.011,kkutinho:1.004,kimokdok:.992,damyu:1.012}]
];
const reverse: Array<[string,Fac]>=[
['base',{}],
['r1',{yappu:.985,harunotsuki:.994,manjo:1.010,moya:1.007,yuntami:1.005,yamuji:1.042,nanwony:1.013,kkutinho:1.018,kimokdok:.970,damyu:.986}],
['r2',{yappu:.985,harunotsuki:.998,manjo:1.010,moya:1.009,yuntami:1.005,yamuji:1.042,nanwony:1.013,kkutinho:1.018,kimokdok:.968,damyu:.987}]
];
for(const [name,change] of (mode==='normal'?normal:reverse)){
 const config={...CONFIG,
  normalSpeedFactor:{...nBase,...(mode==='normal'?change:{})},
  reverseWorld:{...CONFIG.reverseWorld,speedFactor:{...rBase,...(mode==='reverse'?change:{})}},
  finishMove:mode==='reverse'?{...CONFIG.finishMove,outcomes:[{to:-1,w:1}]}:CONFIG.finishMove,
 };
 let cancelled=0,forced=0,reversed=0;
 const wins=Object.fromEntries(ids.map(id=>[id,0])) as Record<CharId,number>;
 for(let i=0;i<N;i++){
  const game=new Race(ids,(Math.imul(offset+i,2654435761)+0x6ebd)>>>0,config).runToEnd();
  if(game.reversed)reversed++;else if(mode==='reverse')cancelled++;
  if(game.forcedEnd)forced++;
  wins[game.ranking()[0].def.id]++;
 }
 const rates=Object.fromEntries(ids.map(id=>[id,Math.round(wins[id]*10000/N)/100]));
 console.log('BALANCE_RESULT '+JSON.stringify({mode,name,N,offset,reversed,cancelled,forced,rates,factors:mode==='normal'?config.normalSpeedFactor:config.reverseWorld.speedFactor}));
 if(forced)process.exitCode=1;
}
