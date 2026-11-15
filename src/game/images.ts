// 캐릭터 이미지 매니페스트 (WebP). 게임 로직과 무관 — 화면에서만 사용
import type { CharId } from './types';

export type Pose = 'run' | 'skill' | 'ultimate' | 'victory';
export const POSES: Pose[] = ['run', 'skill', 'ultimate', 'victory'];

/** public/ 기준 이미지 폴더 */
export const IMAGE_DIR = 'characters/';

/** 표준 파일명 세트: <id>_run.webp, <id>_skill.webp, <id>_ultimate.webp, <id>_victory.webp */
export const standardSet = (id: string): Record<Pose, string> => ({
  run: `${id}_run.webp`, skill: `${id}_skill.webp`, ultimate: `${id}_ultimate.webp`, victory: `${id}_victory.webp`,
});

/**
 * 캐릭터별 이미지 파일명 (public/characters/). 파일이 없거나 깨지면 run → 임시 캐릭터 순으로 대체.
 * 파일명이 다르면 개별 지정: moya: { run: 'moya_run.webp', victory: 'moya_victory.webp' }
 * 사용처: run=선택·달리기·실시간 순위, skill=일반 스킬, ultimate=필살기 컷인·발동, victory=1~3위 시상·결과
 */
export const CHARACTER_IMAGES: Record<CharId, Partial<Record<Pose, string>>> = {
  yappu: standardSet('yappu'),
  harunotsuki: standardSet('harunotsuki'),
  manjo: standardSet('manjo'),
  moya: standardSet('moya'),
  yuntami: standardSet('yuntami'),
  yamuji: standardSet('yamuji'),
  // 난워니: 실제 파일 접두어가 'nanwony'. 파일명을 wony_*.webp 로 바꾸면 standardSet('wony') 로 변경
  nanwony: standardSet('nanwony'),
  kkutinho: standardSet('kkutinho'),
  kimokdok: standardSet('kimokdok'),
  damyu: standardSet('damyu'),
};

function baseUrl(): string {
  try {
    return import.meta.env?.BASE_URL ?? '/';
  } catch {
    return '/';
  }
}

/** 해당 포즈의 이미지 URL (없으면 null) */
export function imageUrl(id: CharId, pose: Pose): string | null {
  const file = CHARACTER_IMAGES[id]?.[pose];
  return file ? baseUrl() + IMAGE_DIR + file : null;
}

/** 표시 시도 순서: 요청 포즈 → run (중복 제거). 비면 임시 캐릭터 */
export function imageCandidates(id: CharId, pose: Pose): string[] {
  const list = [imageUrl(id, pose), imageUrl(id, 'run')].filter((x): x is string => !!x);
  return [...new Set(list)];
}

// ───────────── 경기장·장애물·이펙트 에셋 ─────────────
export type StadiumTheme = 'day' | 'night';
export const STADIUM: Record<StadiumTheme, string> = { day: 'backgrounds/stadium_day.webp', night: 'backgrounds/stadium_night.webp' };
export const VICTORY_STAGE = 'backgrounds/victory_stage.webp';

export const OBSTACLE_IMAGES = {
  banana: 'obstacles/obstacle_banana.webp',
  rock: 'obstacles/obstacle_rock.webp',
  pit: 'obstacles/obstacle_pit.webp',
  gust: 'obstacles/obstacle_tornado.webp',
  zone: 'obstacles/obstacle_slow_zone.webp',
} as const;

export const EFFECT_IMAGES = {
  speed: 'effects/effect_speed.webp',           // 가속
  lightning: 'effects/effect_lightning.webp',   // 번개
  wind: 'effects/effect_wind.webp',             // 바람
  impact: 'effects/effect_impact.webp',         // 충격파
  teleport: 'effects/effect_teleport.webp',     // 순간이동
  wave: 'effects/effect_wave.webp',             // 파도
  confusion: 'effects/effect_confusion.webp',   // 혼란
  shield: 'effects/effect_shield.webp',         // 보호막
  heart: 'effects/effect_heart.webp',           // 하트
  burst: 'effects/effect_burst.webp',           // 에너지 폭발
  cutin: 'effects/effect_cutin.webp',           // 필살기 컷인 프레임
  victory: 'effects/effect_victory.webp',       // 승리 효과
  speedlines: 'effects/effect_speedlines.webp', // 속도선
} as const;
export type EffectName = keyof typeof EFFECT_IMAGES;

/** public 기준 상대 경로 → 배포 경로 */
export const assetUrl = (path: string) => baseUrl() + path;

// ───────────── 게이트·관전 UI 에셋 ─────────────
export const GATE_IMAGES = { start: 'gates/race_start.webp', finish: 'gates/race_finish.webp' } as const;

/** public/ui/ — 고정 문구가 있는 이미지는 숫자/문장을 React 텍스트로 덮어 동적 표시 */
export const UI_IMAGES = {
  announcer: 'ui/announcer_banner.webp',          // 중계 최신 문장 프레임 (빈 프레임)
  ticker: 'ui/commentary_ticker.webp',            // 중계 제목줄 ("경기 중계 중...")
  commentary: 'ui/commentary_panel.webp',        // 최신 중계 카드 (예시 문장 제거본, 원본은 assets-backup/ui)
  countdown: 'ui/countdown_panel.webp',           // 카운트다운 프레임 (빈 프레임)
  distance: 'ui/distance_to_finish_badge.webp',   // 남은 거리 ("120m" 고정 → 덮어쓰기)
  finishChange: 'ui/finish_change_banner.webp',   // 결승선 변경 ("100m → 120m" 고정 → 덮어쓰기)
  firstPlace: 'ui/first_place_badge.webp',        // 1위 골인
  leaderboard: 'ui/live_leaderboard_panel.webp',  // 실시간 순위 패널 (빈 패널)
  overtake: 'ui/overtake_banner.webp',            // 선두 추월 알림
  heart: 'ui/powerup_heart_icon.webp',            // 응원 버프
  lightning: 'ui/powerup_lightning_icon.webp',    // 가속
  shield: 'ui/powerup_shield_icon.webp',          // 면역
  result: 'ui/race_result_panel.webp',            // 결과 패널 (빈 패널)
  skill: 'ui/skill_activation_banner.webp',       // 스킬 발동 알림
  speed: 'ui/speed_controls_panel.webp',          // 배속 버튼 (1배속/2배속/설정)
  question: 'ui/status_question_icon.webp',       // 혼란
  warning: 'ui/status_warning_icon.webp',         // 감속·넘어짐
  ultimate: 'ui/ultimate_activation_banner.webp', // 필살기 발동 (컷인)
} as const;
export type UiImage = keyof typeof UI_IMAGES;
export const uiUrl = (name: UiImage) => assetUrl(UI_IMAGES[name]);
