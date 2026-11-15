// 경기 이벤트 → 실시간 중계 메시지 (필살기 게이지/준비 상태는 언급하지 않음)
import type { CharDef, ObstacleType, RaceEvent } from '../game/types';

const OB_NAME: Record<ObstacleType, string> = {
  banana: '바나나', pit: '구덩이', rock: '돌', gust: '돌풍', zone: '끈적이 구역',
};
const HIT_LINE: Record<ObstacleType, string> = {
  banana: '바나나 밟고 미끄러집니다!', pit: '구덩이에 빠졌어요!', rock: '돌에 걸려 휘청!',
  gust: '돌풍에 밀려납니다!', zone: '끈적이 구역에 발이 묶였어요!',
};

export interface Comment { id: number; t: number; text: string; tone: 'normal' | 'ult' | 'event' | 'finish' | 'bad' }

export function commentFor(e: RaceEvent, defs: CharDef[]): Omit<Comment, 'id'> | null {
  const a = e.actor !== undefined ? defs[e.actor]?.name : '';
  const b = e.target !== undefined ? defs[e.target]?.name : '';
  switch (e.type) {
    case 'start': return { t: e.t, text: '🔫 출발! 꾸한성 대환장 운동회 100m 경주가 시작됩니다!', tone: 'event' };
    case 'skill': return { t: e.t, text: `✨ ${a}의 [${e.skillName}]${e.label ? ` → ${e.label}` : ''}!`, tone: 'normal' };
    case 'ult': return { t: e.t, text: `💥 ${a} 필살기 [${e.skillName}] 발동!!!`, tone: 'ult' };
    case 'obstacleHit': return { t: e.t, text: `🍌 ${a}, ${HIT_LINE[e.obstacle!]}`, tone: 'bad' };
    case 'obstacleDodge': return Math.random() < 0.5 ? { t: e.t, text: `🌀 ${a}, ${e.label === 'trap' ? '함정' : OB_NAME[e.obstacle!]}을(를) 가볍게 회피!`, tone: 'normal' } : null;
    case 'obstacleImmune': return null;
    case 'blocked': return { t: e.t, text: `🛡️ ${b}, ${a}의 방해를 막아냅니다!`, tone: 'normal' };
    case 'debuff': return e.skillId === 'yamu_trap' ? null : { t: e.t, text: `🎯 ${a} → ${b} 방해 성공!`, tone: 'normal' };
    case 'trapHit': return { t: e.t, text: `🪤 ${b}, ${a}의 함정에 걸렸습니다!`, tone: 'bad' };
    case 'teleport': return { t: e.t, text: `🌙 ${a} 순간이동! ${(e.to! - e.from!).toFixed(1)}m 도약!`, tone: 'normal' };
    case 'dash': return { t: e.t, text: `⚽ ${a} 폭풍 돌진!`, tone: 'normal' };
    case 'push': return { t: e.t, text: `🌊 ${b}, 파도에 휩쓸려 ${(e.from! - e.to!).toFixed(1)}m 후퇴!`, tone: 'bad' };
    case 'swap': return e.label === 'fallback'
      ? { t: e.t, text: `🧠 선두 ${a}, 교환 대신 전력 질주!`, tone: 'normal' }
      : { t: e.t, text: `🔄 ${a} ↔ ${b} 위치가 뒤바뀌었습니다!!`, tone: 'ult' };
    case 'trapSet': return null;
    case 'finishMove': return { t: e.t, text: `🏁 결승선이 도망갑니다! ${e.from}m → ${e.to}m!!`, tone: 'event' };
    case 'cheer': return { t: e.t, text: `👏 관중석 응원! 꼴찌 ${a}에게 힘이 납니다!`, tone: 'event' };
    case 'leadChange': return { t: e.t, text: `🔥 ${a}, 선두로 올라섭니다!`, tone: 'event' };
    case 'finish': return { t: e.t, text: `🏃 ${a} 결승선 통과! (${e.value!.toFixed(3)}초)`, tone: 'finish' };
    case 'end': return { t: e.t, text: '🎉 전원 완주! 경기 종료!', tone: 'event' };
    default: return null;
  }
}
