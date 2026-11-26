// 밸런스 설정값 — 테스트 결과에 따라 이 파일만 조정
import type { CharId, ObstacleType } from './types';

export const CONFIG = {
  dt: 1 / 60,                 // 고정 시뮬레이션 간격(초)
  baseSpeed: 5.5,             // 기본 이동속도 (m/s) — 전 캐릭터 동일 (2.75 → 5.5, 2배)
  // 캐릭터 데이터의 이동 거리(순간이동·밀어내기·돌진)와 돌진 속도는 기본속도 2.75 기준 값 → 실제 = 값 × baseSpeed / speedRef
  // (기본속도 대비 배율·효과 시간 유지: 속도 2배에서 가속 효과가 2배 거리를 가는 것과 같은 비율로 거리 효과도 적용)
  speedRef: 2.75,
  baseFinish: 100,
  maxFinish: 150,
  maxRaceTime: 240,           // 안전장치: 이 시간 이후 감속 무시

  // 속도 합산 (과도한 중첩 방지)
  stackRest: 0.35,            // 가장 큰 효과 외 나머지는 35%만 반영
  maxBoost: 1.0,
  maxSlow: 0.6,               // 감속 최대치 (속도 하한 40%)

  // 자연스러운 속도 흔들림 & 역전 보정
  wobble: 0.11,
  wobbleInterval: [1.0, 2.2] as [number, number],
  catchUpPerMeter: 0.007,    // 선두와 1m 차이당 가속
  catchUpMax: 0.14,

  // 일반 스킬 vs 필살기 상대 영향력 (캐릭터 데이터 수치에 곱함)
  skillScale: 1.0,
  ultScale: 0.6,

  // 스킬 쿨타임
  initialCooldown: [1.5, 6] as [number, number],
  hitCooldownBonus: 2,        // 피격 시 추가 감소
  hitCooldownInterval: 2,     // 추가 감소 최소 간격
  skillUseRate: 2.2,          // 사용 가능 시 초당 사용 확률 계수 (평균 지연 ≈ 0.45s)

  // 필살기 게이지 (화면 비노출)
  gauge: {
    perSecond: 6,             // 기본속도 2배로 경기 시간이 절반 → 초당 충전 2배 (3 → 6)
    obstacleHit: 12,
    opponentHit: 10,
    skillUse: 8,
    bottomHold: 10,
    bottomHoldTime: 5,
    max: 100,
  },
  // 필살기 발동 타이밍: 경기 시간 절반 → 초당 계수 2배, 완화 대기 절반 (0.1/0.35, 8s 에서 조정)
  ultUseRate: 0.2,            // 준비 후 초당 발동 확률 계수 (상위권: 아껴 쓰는 경향)
  ultUseRateBottom: 0.7,      // 하위권일 때
  ultUseRateDecisive: 1.5,
  ultTrigger: [0.25, 0.97] as [number, number], // 숨겨진 발동 희망 지점 범위 (늦게 잡히면 못 쓰고 끝날 수 있음)
  ultCutoff: 6,               // 결승선까지 이 거리(m) 이내면 새로 발동하지 않음 → 못 쓰고 끝날 수 있음
  ultRelaxAfter: 4,           // 준비 후 이 시간이 지나면 발동 상황 조건 완화

  // 장애물
  obstacleStart: 10,
  obstacleProtect: [2, 3] as [number, number],
  // 장애물 간격: 기존 대비 약 1/0.7배 → 등장 수 약 70% (기존 [18,26]·[15,22]). 종류 비율(weights)은 그대로
  obstacleBands: [
    { from: 10, to: 30, gap: [26, 37] as [number, number] },
    { from: 30, to: 100, gap: [21, 31] as [number, number] },
    { from: 100, to: 150, gap: [21, 31] as [number, number] },
  ],
  obstacleWeights: { banana: 26, pit: 18, rock: 24, gust: 12, zone: 20 } as Record<ObstacleType, number>,
  obstacle: {
    banana: { slow: 0.4, dur: 1.4 },
    pit: { slow: 0.55, dur: 1.8 },
    rock: { slow: 0.45, dur: 0.7 },
    gust: { push: 2.5 },
    zone: { slow: 0.3, len: 4 },
  },

  // 결승선 이동 이벤트
  // 결승선 이벤트: 경기 시작 시 결과를 무작위 결정(비공개) → 선두가 발동 지점을 지날 때 실제 변경 (경기당 최대 1회)
  finishMove: {
    outcomes: [
      { to: 100, w: 35 },  // 기본 경기 (변경 없음)
      { to: 120, w: 18 },  // 연장 1
      { to: 130, w: 15 },  // 연장 2
      { to: 150, w: 12 },  // 대연장
      { to: 70, w: 15 },   // 단축
      { to: -1, w: 23.75 }, // 🌍 반전 세계: 전체 추첨의 20% (나머지 가중치 합 95 유지)
    ],
    extendWindow: [45, 85] as [number, number],  // 연장: 선두 위치 구간 내 무작위 지점에서 발동
    shortenWindow: [30, 55] as [number, number], // 단축: 70m보다 충분히 앞에서 발동
    shortenSafety: 8,  // 단축 시 모든 선수가 새 결승선보다 이 거리(m) 이상 뒤에 있어야 함, 아니면 취소
  },
  // 일반 경기도 10인 우승 확률을 좁히기 위한 작은 이동속도 배율. 스킬/필살기 수치는 보존.
  normalSpeedFactor: {
    yappu: 0.9978, harunotsuki: 1, manjo: 0.999, moya: 0.9991, yuntami: 0.9985,
    yamuji: 1.0028, nanwony: 1.0005, kkutinho: 1.0005, kimokdok: 0.9852, damyu: 1.001,
  } as Record<CharId, number>,

  // 반전 세계는 결승선 이동과 상호 배타적. 모든 선수가 20m 이상 달렸을 때만 발동.
  reverseWorld: {
    window: [50, 70] as [number, number],
    minRunnerPos: 20,
    maxLeaderPos: 70, // 조건을 만족 못하면 이번에는 취소 (후반에 갑자기 반전 금지)
    // 반전 경기만 적용. 기존 스킬/쿨타임은 그대로 두고 돌아오는 구간 주행속도를 미세 보정.
    // 승자 미리 지정/순위 조작 없음. 밸런스 테스트로 10명 각각 비슷한 우승 확률에 접근.
    speedFactor: {
      yappu: 0.9857, harunotsuki: 0.9965, manjo: 1.0057, moya: 1.0038, yuntami: 1.0045,
      yamuji: 1.04126, nanwony: 1.0123, kkutinho: 1.0182, kimokdok: 0.9538, damyu: 0.9885,
    } as Record<CharId, number>,
  },

  // 꾸로의 괴롭힘: 경기당 정확히 1회. 경기 시작 시 선두 진행거리 at∈window 결정 → 선두 도달 시 발동
  // 대상 수: 경기 시작 인원 기준 범위 내 균등 (완주자 제외·남은 인원으로 제한), 대상마다 감속/밀치기 50:50
  kkuro: {
    window: [45, 60] as [number, number],
    targets: { 2: [1, 1], 3: [1, 2], 4: [2, 3], 5: [3, 3], 6: [3, 4], 7: [4, 5], 8: [4, 5], 9: [5, 7], 10: [7, 8] } as Record<number, [number, number]>,
    slowChance: 0.5,
    slow: 0.35,      // 감속 35%
    slowDur: 1.8,    // 1.8초
    push: 3,         // 3m 후퇴 (최소 0m)
  },

  // 관중 응원 이벤트 (최하위권 가속)
  cheer: {
    chancePerSecond: 0.025,
    minLeaderPos: 25,
    boost: 0.3,
    dur: 2.5,
    maxPerRace: 2,
  },
};

export type GameConfig = typeof CONFIG;
