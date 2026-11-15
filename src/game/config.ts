// 밸런스 설정값 — 테스트 결과에 따라 이 파일만 조정
import type { ObstacleType } from './types';

export const CONFIG = {
  dt: 1 / 60,                 // 고정 시뮬레이션 간격(초)
  baseSpeed: 2.75,            // 기본 이동속도 (m/s) — 전 캐릭터 동일
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
    perSecond: 3,
    obstacleHit: 12,
    opponentHit: 10,
    skillUse: 8,
    bottomHold: 10,
    bottomHoldTime: 5,
    max: 100,
  },
  ultUseRate: 0.1,            // 준비 후 초당 발동 확률 계수 (상위권: 아껴 쓰는 경향)
  ultUseRateBottom: 0.35,     // 하위권일 때
  ultUseRateDecisive: 1.5,
  ultTrigger: [0.25, 0.97] as [number, number], // 숨겨진 발동 희망 지점 범위 (늦게 잡히면 못 쓰고 끝날 수 있음)
  ultCutoff: 6,               // 결승선까지 이 거리(m) 이내면 새로 발동하지 않음 → 못 쓰고 끝날 수 있음
  ultRelaxAfter: 8,           // 준비 후 이 시간이 지나면 발동 상황 조건 완화

  // 장애물
  obstacleStart: 10,
  obstacleProtect: [2, 3] as [number, number],
  obstacleBands: [
    { from: 10, to: 30, gap: [18, 26] as [number, number] },
    { from: 30, to: 100, gap: [15, 22] as [number, number] },
    { from: 100, to: 150, gap: [15, 22] as [number, number] },
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
      { to: 100, w: 40 },  // 기본 경기 (변경 없음)
      { to: 120, w: 18 },  // 연장 1
      { to: 130, w: 15 },  // 연장 2
      { to: 150, w: 12 },  // 대연장
      { to: 70, w: 15 },   // 단축
    ],
    extendWindow: [45, 85] as [number, number],  // 연장: 선두 위치 구간 내 무작위 지점에서 발동
    shortenWindow: [30, 55] as [number, number], // 단축: 70m보다 충분히 앞에서 발동
    shortenSafety: 8,  // 단축 시 모든 선수가 새 결승선보다 이 거리(m) 이상 뒤에 있어야 함, 아니면 취소
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
