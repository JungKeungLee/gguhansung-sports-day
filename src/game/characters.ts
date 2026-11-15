// 캐릭터·스킬 데이터 (데이터 기반 정의 — 이름/수치/연출 키만 바꾸면 반영됨)
// 이미지: src/game/images.ts 의 CHARACTER_IMAGES 에서 관리 (WebP, 포즈 4종)
import type { CharDef, CharId } from './types';

export const CHARACTERS: CharDef[] = [
  {
    id: 'yappu', name: '야뿌', type: '탄산 폭주형', color: '#e8453c', accent: '#ffd0cc',
    skills: [
      { id: 'yappu_cola', name: '뿌카콜라', desc: '2.5초 동안 속도 35% 증가', cooldown: 10, fx: 'cola',
        actions: [{ type: 'boost', value: 0.35, dur: 2.5 }] },
      { id: 'yappu_dentist', name: '치과 가는 길', desc: '바로 앞 1명 1.5초간 25% 감속', cooldown: 10, fx: 'cola',
        actions: [{ type: 'slow', target: 'nearestAhead', value: 0.25, dur: 1.5, maxRange: 20 }] },
    ],
    ult: { id: 'yappu_ult', name: '콜라 대폭발', cutin: '탄산 한계 돌파!!', desc: '4초간 속도 60% 증가 + 주변 2초간 30% 감속', cooldown: 0, fx: 'cola',
      actions: [{ type: 'boost', value: 0.6, dur: 4 }, { type: 'slow', target: 'around', radius: 6, value: 0.3, dur: 2 }] },
  },
  {
    id: 'harunotsuki', name: '하루노츠키', type: '달빛 마법형', color: '#6a5acd', accent: '#e0dcff',
    skills: [
      { id: 'haru_run', name: '달빛 질주', desc: '3초 동안 속도 30% 증가', cooldown: 15, fx: 'moon',
        actions: [{ type: 'boost', value: 0.3, dur: 3 }] },
      { id: 'haru_shadow', name: '달 그림자', desc: '다음 장애물 1개 무시 + 1초 방해 면역', cooldown: 14, fx: 'shield',
        actions: [{ type: 'dodge', count: 1, window: 3 }, { type: 'immune', kind: 'debuff', dur: 1 }] },
    ],
    ult: { id: 'haru_ult', name: '월광 도약', cutin: '달빛이 길을 연다…', trigger: [0.2, 0.7], desc: '전방 최대 12m 순간이동 (앞 캐릭터 바로 뒤까지)', cooldown: 0, fx: 'moon',
      actions: [{ type: 'teleport', dist: 12 }] },
  },
  {
    id: 'manjo', name: '만조', type: '파도 소환형', color: '#1e88e5', accent: '#cfe8ff',
    skills: [
      { id: 'manjo_tide', name: '밀물', desc: '3초 동안 속도 25% 증가', cooldown: 9, fx: 'wave',
        actions: [{ type: 'boost', value: 0.25, dur: 3 }] },
      { id: 'manjo_cats', name: '고양이 출동', desc: '고양이 두 마리가 바로 앞 1명을 1초 감속', cooldown: 10, fx: 'cat',
        actions: [{ type: 'slow', target: 'nearestAhead', value: 0.45, dur: 1, maxRange: 20 }] },
    ],
    ult: { id: 'manjo_ult', name: '대만조', cutin: '바다가 몰려온다!!', trigger: [0.45, 0.95], desc: '앞선 캐릭터 최대 5m 밀어냄 + 3초 장애물 면역·파도 타기 25% 가속', cooldown: 0, fx: 'wave',
      actions: [{ type: 'pushAhead', dist: 5 }, { type: 'immune', kind: 'obstacle', dur: 3 }, { type: 'boost', value: 0.25, dur: 3 }] },
  },
  {
    id: 'moya', name: '모야', type: '장난꾸러기형', color: '#ff9f1c', accent: '#ffe7c2',
    skills: [
      { id: 'moya_step', name: '먀우 스텝', desc: '2초 동안 속도 30% 증가 + 장애물 회피', cooldown: 8, fx: 'cat',
        actions: [{ type: 'boost', value: 0.3, dur: 2 }, { type: 'autoDodge', dur: 2 }] },
      { id: 'moya_boo', name: '깜짝 놀랐먀', desc: '근처 1명(앞 우선) 1.5초간 30% 감속', cooldown: 9, fx: 'cat',
        actions: [{ type: 'slow', target: 'nearby', value: 0.3, dur: 1.5, maxRange: 10 }] },
    ],
    ult: { id: 'moya_ult', name: '고양이 대소동', cutin: '먀아아앙~!!', trigger: [0.4, 0.97], decisive: true, desc: '앞선 최대 2명 2초 혼란 + 4초간 속도 40% 증가', cooldown: 0, fx: 'cat',
      actions: [{ type: 'slow', target: 'aheadUpTo2', value: 0.5, dur: 2, confuse: true }, { type: 'boost', value: 0.4, dur: 4 }] },
  },
  {
    id: 'yuntami', name: '윤타미', type: '프로게이머형', color: '#00b894', accent: '#c8f7ea',
    skills: [
      { id: 'yun_aim', name: '에임 고정', desc: '1.5~25m 앞 캐릭터 조준 후 3초간 속도 35% 증가', cooldown: 12, condition: 'aimRange', fx: 'aim',
        actions: [{ type: 'boost', value: 0.35, dur: 3 }] },
      { id: 'yun_move', name: '완벽한 무빙', desc: '장애물 1개 회피 + 1.5초간 20% 가속', cooldown: 14, fx: 'aim',
        actions: [{ type: 'dodge', count: 1, window: 2.5 }, { type: 'boost', value: 0.2, dur: 1.5 }] },
    ],
    ult: { id: 'yun_ult', name: '랭커의 집중력', cutin: 'CLUTCH!!', desc: '5초간 45% 가속 + 장애물 무시 + 감속 면역', cooldown: 0, fx: 'aim',
      actions: [{ type: 'boost', value: 0.45, dur: 5 }, { type: 'immune', kind: 'obstacle', dur: 5 }, { type: 'immune', kind: 'debuff', dur: 5 }] },
  },
  {
    id: 'yamuji', name: '야무지', type: '전략형', color: '#8e44ad', accent: '#ecd3f7',
    skills: [
      { id: 'yamu_start', name: '야무진 출발', desc: '경기 시작 후 5초 동안 20% 가속 (1회)', cooldown: 0, once: true, condition: 'raceStart', fx: 'brain',
        actions: [{ type: 'boost', value: 0.2, dur: 5 }] },
      { id: 'yamu_trap', name: '완벽한 함정', desc: '뒤쪽 트랙에 함정 설치 (걸린 상대 1.5초간 35% 감속) 후 2초간 35% 가속', cooldown: 8, fx: 'trap',
        actions: [{ type: 'trap', value: 0.35, dur: 1.5, maxRange: 25, life: 10 }, { type: 'boost', value: 0.35, dur: 2 }] },
    ],
    ult: { id: 'yamu_ult', name: '계획대로야', cutin: '전부 계획대로야.', trigger: [0.6, 0.95], decisive: true, desc: '감속 해제 + 4초간 50% 가속 + 앞 1명 2초간 20% 감속', cooldown: 0, fx: 'brain',
      actions: [{ type: 'cleanse' }, { type: 'boost', value: 0.5, dur: 4 }, { type: 'slow', target: 'nearestAhead', value: 0.2, dur: 2 }] },
  },
  {
    id: 'nanwony', name: '난워니', type: '역전 특화형', color: '#f4c20d', accent: '#fff4c2',
    skills: [
      { id: 'wony_run', name: '워냥이 질주', desc: '2.5초 동안 속도 35% 증가', cooldown: 14, fx: 'thunder',
        actions: [{ type: 'boost', value: 0.35, dur: 2.5 }] },
      { id: 'wony_notover', name: '아직 안 끝났어', desc: '하위 절반일 때 3초간 30% 가속', cooldown: 14, condition: 'bottomHalf', fx: 'thunder',
        actions: [{ type: 'boost', value: 0.3, dur: 3 }] },
    ],
    ult: { id: 'wony_ult', name: '워니 타임', cutin: '지금부터 워니 타임!!', desc: '5초간 55% 가속 + 주변 1초간 20% 감속', cooldown: 0, fx: 'thunder',
      actions: [{ type: 'boost', value: 0.55, dur: 5 }, { type: 'slow', target: 'around', radius: 6, value: 0.2, dur: 1 }] },
  },
  {
    id: 'kkutinho', name: '꾸티뉴', type: '기동형', color: '#2ecc71', accent: '#d2f8e0',
    skills: [
      { id: 'kkut_dribble', name: '폭풍 드리블', desc: '3초간 25% 가속 + 장애물 자동 회피', cooldown: 15, fx: 'ball',
        actions: [{ type: 'boost', value: 0.25, dur: 3 }, { type: 'autoDodge', dur: 3 }] },
      { id: 'kkut_feint', name: '페인트 모션', desc: '추격자 1명 2초간 25% 감속', cooldown: 13, fx: 'ball',
        actions: [{ type: 'slow', target: 'nearestBehind', value: 0.25, dur: 2, maxRange: 15 }] },
    ],
    ult: { id: 'kkut_ult', name: '결승골 슛', cutin: '골—————!!', desc: '전방 최대 10m 돌진 + 경로 장애물 파괴', cooldown: 0, fx: 'ball',
      actions: [{ type: 'dash', dist: 10, speed: 8 }] },
  },
  {
    id: 'kimokdok', name: '김옥독', type: '지휘관형', color: '#34495e', accent: '#d5dde5',
    skills: [
      { id: 'okdok_calc', name: '옥독의 계산', desc: '선두와 10m 이상 차이 시 3초간 35% 가속', cooldown: 8, condition: 'gapAhead10', fx: 'brain',
        actions: [{ type: 'boost', value: 0.35, dur: 3 }] },
      { id: 'okdok_jam', name: '전술 방해', desc: '선두 2초간 25% 감속 (자신이 선두면 미사용)', cooldown: 10, condition: 'notLeader', fx: 'brain',
        actions: [{ type: 'slow', target: 'leader', value: 0.25, dur: 2 }] },
    ],
    ult: { id: 'okdok_ult', name: '전세 역전', cutin: '판을 뒤집는다.', trigger: [0.7, 0.97], decisive: true, desc: '앞선 1명과 위치 교환 (선두면 4초간 45% 가속)', cooldown: 0, fx: 'brain',
      actions: [{ type: 'swap', fallback: { value: 0.45, dur: 4 } }] },
  },
  {
    id: 'damyu', name: '다뮤_', type: '랜덤 소환형', color: '#ff6fb5', accent: '#ffd9ec',
    skills: [
      { id: 'damyu_squad', name: '뮤람단 출동', desc: '랜덤: 3초간 30% 가속 / 2초 방해 면역', cooldown: 9, fx: 'star',
        actions: [{ type: 'random', options: [
          { label: '가속', actions: [{ type: 'boost', value: 0.3, dur: 3 }] },
          { label: '방어', actions: [{ type: 'immune', kind: 'debuff', dur: 2 }] },
        ] }] },
      { id: 'damyu_fortune', name: '오늘의 운세', desc: '랜덤: 자신 가속 / 자신 방어 / 상대 감속', cooldown: 10, fx: 'star',
        actions: [{ type: 'random', options: [
          { label: '대길(가속)', actions: [{ type: 'boost', value: 0.3, dur: 2.5 }] },
          { label: '중길(방어)', actions: [{ type: 'immune', kind: 'debuff', dur: 2 }, { type: 'dodge', count: 1, window: 3 }] },
          { label: '흉(상대 감속)', actions: [{ type: 'slow', target: 'nearestAhead', value: 0.25, dur: 1.5, maxRange: 20 }] },
        ] }] },
    ],
    ult: { id: 'damyu_ult', name: '뮤람단 총출동', cutin: '뮤람단, 총출동—!', desc: '5초간 매초 가속 증가 (최대 60%)', cooldown: 0, fx: 'star',
      actions: [{ type: 'ramp', step: 0.15, max: 0.6, dur: 5 }] },
  },
];

export const CHAR_BY_ID: Record<CharId, CharDef> = Object.fromEntries(
  CHARACTERS.map((c) => [c.id, c]),
) as Record<CharId, CharDef>;
