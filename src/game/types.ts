// 게임 전역 타입 정의 (시뮬레이션·렌더링 공용)

export type CharId =
  | 'yappu' | 'harunotsuki' | 'manjo' | 'moya' | 'yuntami'
  | 'yamuji' | 'nanwony' | 'kkutinho' | 'kimokdok' | 'damyu';

/** 방해/스킬 대상 선택 방식 */
export type TargetSel =
  | 'nearestAhead'   // 바로 앞 1명
  | 'nearestBehind'  // 바로 뒤 1명 (추격자)
  | 'leader'         // 현재 선두 (자신 제외)
  | 'nearby'         // 앞뒤 가장 가까운 1명
  | 'around'         // 반경 내 전원
  | 'aheadUpTo2';    // 앞쪽 가까운 최대 2명

export type FxKey =
  | 'cola' | 'moon' | 'wave' | 'cat' | 'aim' | 'trap' | 'thunder'
  | 'ball' | 'brain' | 'star' | 'shield' | 'dash' | 'generic';

export type Action =
  | { type: 'boost'; value: number; dur: number }
  | { type: 'ramp'; step: number; max: number; dur: number }
  | { type: 'slow'; target: TargetSel; value: number; dur: number; radius?: number; maxRange?: number; confuse?: boolean }
  | { type: 'dodge'; count: number; window: number }  // window초 안에 만나는 장애물 count개 회피
  | { type: 'immune'; kind: 'debuff' | 'obstacle'; dur: number }
  | { type: 'autoDodge'; dur: number }
  | { type: 'cleanse' }
  | { type: 'teleport'; dist: number }
  | { type: 'dash'; dist: number; speed: number }
  | { type: 'pushAhead'; dist: number }
  | { type: 'swap'; fallback: { value: number; dur: number } }
  | { type: 'trap'; value: number; dur: number; maxRange: number; life: number }
  | { type: 'random'; options: { label: string; actions: Action[] }[] };

export type Condition =
  | 'none' | 'hasAhead' | 'aimRange' | 'hasBehind' | 'bottomHalf' | 'gapAhead10' | 'notLeader' | 'raceStart';

export interface SkillDef {
  id: string;
  name: string;
  desc: string;
  cooldown: number;     // 초
  once?: boolean;       // 경기당 1회
  condition?: Condition;
  actions: Action[];
  fx: FxKey;
}

export interface CharDef {
  id: CharId;
  name: string;
  type: string;         // 캐릭터 유형 (예: 탄산 폭주형)
  color: string;        // 플레이스홀더 색상
  accent: string;
  skills: [SkillDef, SkillDef];
  /**
   * trigger: 경기마다 이 범위(결승선 대비 자기 진행률)에서 숨겨진 발동 희망 지점을 무작위로 정함 (기본 CONFIG.ultTrigger)
   * decisive: 희망 지점 도달 후 망설임 없이 발동 (전략형)
   */
  ult: SkillDef & { cutin: string; trigger?: [number, number]; decisive?: boolean };
}

export type ObstacleType = 'banana' | 'pit' | 'rock' | 'gust' | 'zone';
export type ObstacleState = 'idle' | 'hit' | 'dodged' | 'protected' | 'destroyed';

export interface Obstacle {
  id: number;
  lane: number;
  pos: number;
  len: number;          // zone 길이 (그 외 0)
  type: ObstacleType;
  state: ObstacleState;
}

export interface Trap {
  id: number;
  owner: number;        // runner index
  lane: number;
  pos: number;
  until: number;
  value: number;
  dur: number;
  done: boolean;
}

export type EffectKind = 'speed' | 'immuneDebuff' | 'immuneObstacle' | 'autoDodge';
export type EffectTag =
  | 'skill' | 'ult' | 'slip' | 'fall' | 'bump' | 'zone' | 'debuff' | 'confused' | 'cheer' | 'ramp' | 'kkuro';

export interface Effect {
  kind: EffectKind;
  value: number;        // speed: +가속 / -감속
  start: number;
  until: number;
  tag: EffectTag;
  fromOpponent?: boolean;
  ramp?: { step: number; max: number };
}

export type RaceEventType =
  | 'start' | 'skill' | 'ult' | 'obstacleHit' | 'obstacleDodge' | 'obstacleImmune' | 'obstacleProtected'
  | 'debuff' | 'blocked' | 'teleport' | 'dash' | 'push' | 'swap' | 'trapSet' | 'trapHit'
  | 'finishMove' | 'reverseWorld' | 'cheer' | 'kkuroHit' | 'kkuro' | 'leadChange' | 'finish' | 'end';

export interface RaceEvent {
  t: number;
  type: RaceEventType;
  actor?: number;       // runner index
  target?: number;
  skillId?: string;
  skillName?: string;
  fx?: FxKey;
  obstacle?: ObstacleType;
  from?: number;
  to?: number;
  value?: number;
  label?: string;        // kkuroHit: 'slow' | 'push' | 'blocked', kkuro: '감속수/밀치기수/막음수'
}

export interface RunnerStats {
  skillUses: number;
  ultUsed: boolean;
  ultTime: number | null;
  obstacleHits: number;
  dodges: number;
  debuffed: number;
  blocked: number;
}

/** 화면에 공개 가능한 러너 상태 (필살기 게이지 미포함) */
export interface PublicRunner {
  index: number;
  id: CharId;
  name: string;
  lane: number;
  pos: number;
  prevPos: number;
  speed: number;
  finished: boolean;
  finishTime: number | null;
  rank: number;
  boosted: boolean;
  slowed: boolean;
  confused: boolean;
  immune: boolean;
  dashing: boolean;
  fallen: boolean;
  cheered: boolean;   // 관중 응원 버프 중 (화면 표시용)
}

export interface ResultRow {
  rank: number;
  index: number;
  id: CharId;
  name: string;
  timeMs: number;
  stats: RunnerStats;
}
