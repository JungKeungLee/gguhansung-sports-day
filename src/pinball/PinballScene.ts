// 핀볼 레이스 공통 씬 (Phaser 3 내장 Matter.js 물리). 맵별 장애물은 maps.ts 에서 생성
// 구조: 넓은 출발 공간(동시 출발) → 분산 핀 → 맵(기존 좌표를 아래로 평행이동) → V자 깔때기·회전 막대 → 단일 결승 입구
import Phaser from 'phaser';
import { Rng } from '../game/rng';
import { type BallRecord, type BallSpec, ballLabel, orderSameStep } from './entries';
import { type SkillKind, type SkillState, SKILL_KINDS, PinballSkills, assignSkills } from './skills';
import { type EventKind, EVENT_KINDS, MAP_EVENTS, PinballEvents } from './events';
import { GateBurst } from './gateBurst';
import { MAP_EXT, type MapApi, type MapId, type MapTheme, buildPinballMap, mapInfo, mapPhysics } from './maps';

// Phaser 에 포함된 Matter.js (신규 라이브러리 아님)
const M = (Phaser.Physics.Matter as unknown as { Matter: { Body: typeof MatterJS.Body; Bodies: typeof MatterJS.Bodies; Sleeping: { set(b: MatterJS.BodyType, s: boolean): void } } }).Matter;
/** 휴면 중인 공을 깨움 (휴면 공은 직접 속도를 줘도 움직이지 않으므로, 공을 움직이기 전에 항상 호출) */
const wake = (b: MatterJS.BodyType) => { if (b.isSleeping) M.Sleeping.set(b, false); };

export const PB_VIEW_W = 800;
export const PB_VIEW_H = 1000;
const W = 800;                 // 맵 가로
const BALL_R = 13;             // 공 반지름 (지름 26px)
const PIN_R = 7;
const WALL = 40;

// ───── 단일 출발 입구 (공 지름 기준) ─────
const START_BOTTOM = 600;               // 출발 공간 아래 끝 (공 최대 20줄)
const MAP_DY = 500;                     // 기존 맵 좌표(출발 구역 ~300 이하)를 출발 공간·분산 핀 아래로 평행이동
const LOGICAL_FINISH = 2980 + MAP_EXT;            // 맵 좌표계의 결승 구역 기준 (맵 생성용)
// ───── 결승 단일 입구: 넓은 구역 → V자 깔때기 → 좁은 입구 → 세로 통로 안의 FINISH 판정선 ─────
const FIN_TOP = 2950 + MAP_EXT + MAP_DY;          // 결승 깔때기 시작 높이 (맵 장애물 아래)
const FIN_DEG = 45;                     // 가파른 깔때기: 아치(2개가 양쪽에 기대 막힘) 감소
const FIN_GAP = 46;                     // 결승 입구 폭 ≈ 지름 1.77배 (2개 나란히=52px 불가)
const FIN_GATE_Y = FIN_TOP + Math.tan((FIN_DEG * Math.PI) / 180) * (W / 2 - FIN_GAP / 2 - WALL);
export const FINISH_Y = FIN_GATE_Y + 34; // 판정선: 입구 아래 세로 통로 안
const H = FINISH_Y + 300;              // 맵 세로 (통로 아래 수거 공간)

// 끼임 복구 (기본 맵 테스트 후 조정한 값)
const STUCK_MOVE_PX = 4;       // 이 거리 이상 움직이면 정상 이동으로 간주
const STUCK_MS = 2000;         // 이 시간 동안 거의 안 움직이면 끼임으로 판단
const NUDGE_SPEED = 3.2;       // 끼인 공에 주는 작은 속도 (강제 완주 아님)
const GATE_IDLE_MS = 900;      // 결승 입구 위에 공이 있는데 이 시간 동안 아무도 못 지나가면 입구 위 공들을 살짝 흔듦
const STEP_MS = 1000 / 60;     // 물리 고정 시간 간격 — 배속은 스텝 '횟수'로만 조절 (간격·속도·중력 불변)
const MAX_STEPS_PER_FRAME = 12; // 느린 프레임에서 따라잡기 상한
const PORTAL_R = 22;           // 공 중심이 포털 중심에서 이 거리 안이면 진입
const PORTAL_COOLDOWN = 1500;  // 같은 공 재진입 대기(ms, 게임 시간) — 무한 반복 방지
const PORTAL_MAX = 5;          // 공 하나가 경기 중 쓸 수 있는 최대 포털 횟수
const FLOW_BAND = 320;         // 결승 입구 위 이 높이 안의 공은 휴면 금지 (흐름 유지)
const QUEUE_TOP = 2550 + MAP_EXT + MAP_DY; // 이 아래(맵 하단~결승 깔때기)는 결승 대기 줄이 생기는 구역: 휴면 허용, 개별 끼임 복구는 줄이 멈췄을 때만
const LABEL_POOL = 40;         // 이름표는 화면에 보이는 공에만, 최대 40개를 돌려 씀 (500개 대응)

// 결승 막대 배치: 왼쪽 45° 경사 테두리의 고정축 지지대에 연결.
// 회전 반경+막대 두께+공 반지름이 경사판에 닿지 않도록 중심을 안쪽으로 이격한다.
function finishRotorMount(): { railX: number; x: number; y: number; len: number } {
  const y = FIN_GATE_Y - 245;
  const railX = W / 2 - FIN_GAP / 2 - (FIN_GATE_Y - y) / Math.tan((FIN_DEG * Math.PI) / 180);
  return { railX, x: railX + 165, y, len: 140 };
}

// ───── 출발 분산 구역·결승 입구 배치 (게임 씬과 맵 미리보기가 같은 함수 사용 → 배치 일치) ─────
type LayoutRect = (x: number, y: number, w: number, h: number, deg: number, kind: 'plate' | 'wall') => void;
/** 출발 공간 아래 분산 구역: 엇갈린 핀 3줄 + 벽 반사판 */
function layoutStartSpread(rect: LayoutRect, pin: (x: number, y: number) => void): void {
  let row = 0;
  for (let y = START_BOTTOM + 50; y < MAP_DY + 380; y += 84, row++) {
    if (row % 2 === 0) {
      rect(WALL + 22, y - 42, 56, 8, 32, 'plate');
      rect(W - WALL - 22, y - 42, 56, 8, -32, 'plate');
    }
    for (let x = WALL + 46 + (row % 2 ? 32 : 0); x < W - WALL - 30; x += 64) pin(x, y);
  }
}
/** 결승: 45° V자 깔때기 + 세로 통로 + 회전 막대 */
function layoutFinishGate(rect: LayoutRect, rotor: (x: number, y: number, len: number, omega: number, arms: number, thick: number) => void): void {
  const half = W / 2 - FIN_GAP / 2 - WALL;
  const len = half / Math.cos((FIN_DEG * Math.PI) / 180);
  const cy = (FIN_TOP + FIN_GATE_Y) / 2;
  rect(WALL + half / 2 - 2, cy, len + 8, 18, FIN_DEG, 'plate');
  rect(W - WALL - half / 2 + 2, cy, len + 8, 18, -FIN_DEG, 'plate');
  // 세로 통로: 입구를 지난 공만 판정선에 닿음 (통로 바깥은 깔때기 아래라 공이 갈 수 없음)
  const chuteH = FINISH_Y + 70 - (FIN_GATE_Y - 6);
  rect(W / 2 - FIN_GAP / 2 - 7, FIN_GATE_Y - 6 + chuteH / 2, 14, chuteH, 0, 'wall');
  rect(W / 2 + FIN_GAP / 2 + 7, FIN_GATE_Y - 6 + chuteH / 2, 14, chuteH, 0, 'wall');
  // 140px 회전 막대(기존 60px): 왼쪽 경사 테두리에 지지대로 연결, 느리게 회전.
  const mount = finishRotorMount();
  rotor(mount.x, mount.y, mount.len, 0.85, 1, 14);
}

// ───── 맵 미리보기 (물리 없음, 설정 화면 SVG 용) ─────
export type PreviewShape =
  | { k: 'rect'; x: number; y: number; w: number; h: number; deg: number; color: number }
  | { k: 'pin'; x: number; y: number; r: number; color: number }
  | { k: 'bumper'; x: number; y: number; r: number }
  | { k: 'rotor'; x: number; y: number; len: number; arms: number; thick: number }
  | { k: 'portal'; ax: number; ay: number; bx: number; by: number; color: number };
export interface PinballPreview { W: number; H: number; startBottom: number; finTop: number; gateY: number; finishY: number; finGap: number; theme: MapTheme; shapes: PreviewShape[] }
/** 실제 경기와 같은 배치 함수(layoutStartSpread·layoutFinishGate·buildPinballMap)를 기록용 API로 실행. 랜덤 맵은 seed 에 따라 달라짐 */
export function pinballPreview(mapId: MapId, seed = 1): PinballPreview {
  const theme = mapInfo(mapId).theme;
  const shapes: PreviewShape[] = [];
  const rect = (x: number, y: number, w: number, h: number, deg: number, color: number) => { shapes.push({ k: 'rect', x, y, w, h, deg, color }); };
  const rotor = (x: number, y: number, len: number, _o: number, arms = 1, thick = 16) => { shapes.push({ k: 'rotor', x, y, len, arms, thick }); };
  rect(WALL / 2, H / 2, WALL, H, 0, theme.wall);
  rect(W - WALL / 2, H / 2, WALL, H, 0, theme.wall);
  rect(W / 2, H - WALL / 2, W, WALL, 0, theme.wall);
  layoutStartSpread((x, y, w, h, deg, kind) => rect(x, y, w, h, deg, theme[kind]), (x, y) => { shapes.push({ k: 'pin', x, y, r: PIN_R, color: theme.pin }); });
  layoutFinishGate((x, y, w, h, deg, kind) => rect(x, y, w, h, deg, theme[kind]), rotor);
  const dy = MAP_DY;
  buildPinballMap(mapId, {
    W, H: H - dy, WALL, FINISH_Y: LOGICAL_FINISH, rng: new Rng((seed ^ 0x9e3779b9) >>> 0),
    rect: (x, y, w, h, deg, color) => rect(x, y + dy, w, h, deg, color ?? theme.plate),
    pin: (x, y, r = PIN_R) => { shapes.push({ k: 'pin', x, y: y + dy, r, color: theme.pin }); },
    bumper: (x, y, r = 18) => { shapes.push({ k: 'bumper', x, y: y + dy, r }); },
    rotor: (x, y, len, o, arms, thick) => rotor(x, y + dy, len, o, arms, thick),
    portal: (ax, ay, bx, by, color) => { shapes.push({ k: 'portal', ax, ay: ay + dy, bx, by: by + dy, color }); },
  });
  return { W, H, startBottom: START_BOTTOM, finTop: FIN_TOP, gateY: FIN_GATE_Y, finishY: FINISH_Y, finGap: FIN_GAP, theme, shapes };
}

interface MatterBall extends Phaser.GameObjects.Arc {
  body: MatterJS.BodyType;
  setVelocity(x: number, y?: number): this;
}

interface BallState {
  spec: BallSpec;
  go: MatterBall;
  prevY: number;
  anchor: { x: number; y: number; t: number }; // 끼임 판단 기준점
  record: BallRecord;
  portalReadyAt: number;
  removed: boolean;            // 완주 후 물리 바디 제거됨
  skill: SkillState;           // 구슬 고유 스킬 (경기 중 고정)
}

interface Rotor { body: MatterJS.BodyType; omega: number; view: Phaser.GameObjects.Container }
interface Portal { ax: number; ay: number; bx: number; by: number; color: number }

export interface PinballHooks {
  onFinish(rec: BallRecord, all: BallRecord[]): void;
  onTick(s: { t: number; finished: number; unstuck: number; portals: number }): void;
  onAllFinished(all: BallRecord[]): void;
}

export class PinballScene extends Phaser.Scene {
  private specs: BallSpec[];
  private hooks: PinballHooks;
  private rng: Rng;
  private balls: BallState[] = [];
  private running = false;
  private elapsed = 0;           // 출발 후 경과(ms, 고정 스텝 누적)
  private finishedCount = 0;
  private unstuck = 0;
  private tickTimer = 0;
  private started = false;
  private speed = 1;             // 배속 1·2·3
  private acc = 0;               // 실시간 누적(ms) × 배속
  private mapId: MapId;
  private theme: MapTheme;
  private mapRng: Rng;
  private rotors: Rotor[] = [];
  private portals: Portal[] = [];
  private speedCap = 0;
  private portalUses = 0;
  private pinG!: Phaser.GameObjects.Graphics;
  private phys: ReturnType<typeof mapPhysics>;
  private labels: { text: Phaser.GameObjects.Text; owner: number }[] = [];
  private lastFinishPass = 0;
  private seed: number;
  private hazards!: PinballEvents;
  private skillSys!: PinballSkills; // 구슬 고유 스킬 5종 // 랜덤 방해 이벤트 (활성 최대 1개)
  private gate!: GateBurst;         // 결승 입구 역전 충격파 (결승 입구 전용)
  private keepOrder: boolean;     // 설정 화면 '공 섞기' 순서를 출발 배치에 그대로 사용 (다시 하기는 false → 새로 섞음)

  constructor(specs: BallSpec[], seed: number, hooks: PinballHooks, _followMode: 'first' | 'last', mapId: MapId = 'basic', keepOrder = false) {
    super('pinball');
    this.specs = specs;
    this.hooks = hooks;
    this.rng = new Rng(seed);
    this.seed = seed;
    this.mapRng = new Rng((seed ^ 0x9e3779b9) >>> 0); // 랜덤 맵 배치 전용 (공 출발 배치 난수와 분리)
    this.mapId = mapId;
    this.keepOrder = keepOrder;
    this.theme = mapInfo(mapId).theme;
    this.phys = mapPhysics(mapId);
  }

  create(): void {
    // 자동 물리 업데이트를 끄고 update()에서 고정 간격 스텝을 직접 실행 (배속 = 프레임당 스텝 수)
    this.matter.world.autoUpdate = false;
    this.cameras.main.setBounds(0, 0, W, H).setBackgroundColor(`#${this.theme.bgBottom.toString(16).padStart(6, '0')}`);
    this.matter.world.setGravity(0, 0); // 출발 전에는 중력 0 (공 정지 대기)
    this.drawBackdrop();
    this.buildMap();
    this.spawnBalls();
    this.initEvents();
    this.skillSys = new PinballSkills({ scene: this, balls: this.balls, seed: this.seed, H, R: BALL_R, noSkillY: FIN_TOP - 60, rewindMaxY: FIN_TOP - 700, viewH: PB_VIEW_H });
    // 결승 입구 역전 이벤트(폭발·블랙홀·상승 바람): 전용 난수(기존 경기·이벤트 난수 흐름과 분리)
    // 블랙홀 이동 위치: 맵 중간 높이 (랜덤 방해 이벤트 구역의 가운데 ±250px), 구조물 판정은 랜덤 이벤트와 같은 배치 데이터 사용
    const qa = import.meta.env.DEV ? new URLSearchParams(location.search).get('pbgate') : null; // QA(개발 전용): off=대조군, blast|hole|wind=종류 고정
    const midY = (START_BOTTOM + 330 + QUEUE_TOP - 120) / 2;
    this.gate = new GateBurst({
      scene: this, rng: new Rng((this.seed ^ 0x2545f491) >>> 0), balls: this.balls, W, WALL, R: BALL_R, gateY: FIN_GATE_Y, gap: FIN_GAP,
      viewW: PB_VIEW_W, viewH: PB_VIEW_H, midY: [midY - 250, midY + 250],
      wake: (b) => wake(b.go.body),
      isFree: (x, y, r) => this.hazards.isFree(x, y, r),
      teleport: (b, x, y, color) => this.teleport(b as unknown as BallState, { ax: b.go.x, ay: b.go.y, bx: x, by: y, color }, false, false), // 블랙홀이 자체(재사용) 효과 표시
      dry: qa === 'off', force: qa === 'blast' || qa === 'hole' || qa === 'wind' ? qa : null,
    });
    if (import.meta.env.DEV && new URLSearchParams(location.search).get('pbev')) (window as unknown as { __pbSkills?: unknown }).__pbSkills = this.skillSys;
    if (import.meta.env.DEV && new URLSearchParams(location.search).get('pbev')) (window as unknown as { __pbGate?: unknown }).__pbGate = this.gate;
  }

  /** 랜덤 방해 이벤트 준비: 맵 배치 데이터(미리보기와 동일)로 안전 위치 판정, 전용 난수(기존 경기 난수 흐름과 분리) */
  private initEvents(): void {
    // QA용(개발 환경 전용): ?pbev=종류 → 해당 이벤트만 3초부터 발생, ?pbev=auto → 정상 발생 + 확인용 노출
    const q = import.meta.env.DEV ? new URLSearchParams(location.search).get('pbev') : null; // 개발 서버에서만 (운영 빌드에서는 제거)
    const forced = EVENT_KINDS.includes(q as EventKind) ? (q as EventKind) : null;
    this.hazards = new PinballEvents({
      scene: this, M, rng: new Rng((this.seed ^ 0x5bd1e995) >>> 0), balls: this.balls,
      obstacles: pinballPreview(this.mapId, this.seed).shapes.slice(3), // 바깥 벽 3개 제외
      W, WALL, R: BALL_R, yMin: START_BOTTOM + 330, yMax: QUEUE_TOP - 120, viewW: PB_VIEW_W, // 출발 분산 구역 아래 ~ 결승 대기 구역 위
      wake: (b) => wake(b.go.body),
      shielded: (b, now) => this.skillSys.shielded(b as unknown as BallState, now),
      teleport: (b, ax, ay, bx, by, color) => this.teleport(b as unknown as BallState, { ax, ay, bx, by, color }, false),
    }, MAP_EVENTS[this.mapId], forced);
    if (q) (window as unknown as { __pbEvents?: unknown; __pbScene?: unknown }).__pbEvents = this.hazards;
    if (q) (window as unknown as { __pbScene?: unknown }).__pbScene = this;
  }

  // ───────────── 맵 ─────────────
  private drawBackdrop(): void {
    const g = this.add.graphics().setDepth(-5);
    const t = this.theme;
    g.fillGradientStyle(t.bgTop, t.bgTop, t.bgBottom, t.bgBottom, 1).fillRect(0, 0, W, H);
    g.lineStyle(1, t.grid, 0.35);
    for (let y = 0; y < H; y += 100) g.lineBetween(WALL, y, W - WALL, y);
    // 출발 대기 공간 표시
    g.fillStyle(0xd4a017, 0.1).fillRect(WALL, 40, W - WALL * 2, START_BOTTOM - 40);
    this.add.text(W / 2, 14, 'START', { fontFamily: 'Arial Black, sans-serif', fontSize: '22px', color: '#ffd166' }).setOrigin(0.5, 0);
    // 결승 판정선 (통로 폭만큼만 체크무늬)
    const sq = 8;
    for (let x = W / 2 - FIN_GAP / 2; x < W / 2 + FIN_GAP / 2; x += sq) {
      for (let k = 0; k < 2; k++) g.fillStyle((((x - (W / 2 - FIN_GAP / 2)) / sq) + k) % 2 ? 0x111111 : 0xffffff).fillRect(x, FINISH_Y - sq + k * sq, sq, sq);
    }
    this.add.text(W / 2, FINISH_Y + 70, 'FINISH', { fontFamily: 'Arial Black, sans-serif', fontSize: '26px', color: '#ffd166' }).setOrigin(0.5, 0);
    g.fillStyle(0xc62828, 0.18).fillRect(WALL, FIN_GATE_Y, W - WALL * 2, H - FIN_GATE_Y);
  }

  private staticRect(x: number, y: number, w: number, h: number, angleDeg: number, color: number, restitution = this.phys.plate, noStatic = this.phys.staticFriction0): void {
    const r = this.add.rectangle(x, y, w, h, color).setStrokeStyle(2, this.theme.stroke);
    const go = this.matter.add.gameObject(r, { isStatic: true, restitution, friction: 0.01, ...(noStatic ? { frictionStatic: 0 } : {}) }) as unknown as Phaser.GameObjects.Rectangle;
    go.setRotation(Phaser.Math.DegToRad(angleDeg));
  }

  /** 출발 공간 아래 분산 구역 → 동시에 떨어진 공이 맵 전체 폭으로 퍼짐 */
  private buildStartSpread(): void {
    layoutStartSpread((x, y, w, h, deg, kind) => this.staticRect(x, y, w, h, deg, this.theme[kind]), (x, y) => this.addPin(x, y, PIN_R, this.phys.pin));
  }

  /** 결승 단일 입구: 깔때기·통로 반발 0.05, 왼쪽 테두리 지지대에 회전 막대 부착 */
  private buildFinishGate(): void {
    layoutFinishGate((x, y, w, h, deg, kind) => this.staticRect(x, y, w, h, deg, this.theme[kind], 0.05, true),
      (x, y, len, omega, arms, thick) => this.addRotor(x, y, len, omega, arms, thick, 0.1));
    const m = finishRotorMount();
    // 지지대는 시각 연출 전용: 물리 벽으로 만들면 공이 끼거나 다시 튕길 수 있어 충돌 없음.
    const mountG = this.add.graphics().setDepth(1);
    mountG.lineStyle(10, this.theme.wall, 1).lineBetween(m.railX, m.y, m.x, m.y);
    mountG.lineStyle(3, this.theme.stroke, 1).lineBetween(m.railX, m.y, m.x, m.y);
    mountG.fillStyle(this.theme.stroke, 1).fillCircle(m.railX, m.y, 8);
    this.add.text(W / 2, FIN_TOP - 30, '▼ FINISH GATE', { fontFamily: 'Arial Black, sans-serif', fontSize: '14px', color: '#ffd166' }).setOrigin(0.5).setDepth(1);
  }

  private addPin(x: number, y: number, r: number, restitution: number): void {
    this.matter.add.circle(x, y, r, { isStatic: true, restitution, friction: 0.01, ...(this.phys.staticFriction0 ? { frictionStatic: 0 } : {}) });
    this.pinG.fillStyle(this.theme.pin).fillCircle(x, y, r).lineStyle(2, this.theme.pinStroke, 0.8).strokeCircle(x, y, r);
  }

  private buildMap(): void {
    // 좌우 벽 + 바닥 (모든 맵 공통)
    this.staticRect(WALL / 2, H / 2, WALL, H, 0, this.theme.wall);
    this.staticRect(W - WALL / 2, H / 2, WALL, H, 0, this.theme.wall);
    this.staticRect(W / 2, H - WALL / 2, W, WALL, 0, this.theme.wall);
    this.pinG = this.add.graphics().setDepth(1);
    this.buildStartSpread();
    this.buildFinishGate();
    const t = this.theme;
    const dy = MAP_DY; // 맵 좌표 → 실제 좌표
    const api: MapApi = {
      W, H: H - dy, WALL, FINISH_Y: LOGICAL_FINISH, rng: this.mapRng,
      rect: (x, y, w, h, deg, color) => this.staticRect(x, y + dy, w, h, deg, color ?? t.plate),
      pin: (x, y, r = PIN_R) => this.addPin(x, y + dy, r, this.phys.pin),
      bumper: (x, y, r = 18) => {
        // 탄성 범퍼: 반발 1.1 → 0.75로 낮춰 과도한 튕김 완화
        this.matter.add.circle(x, y + dy, r, { isStatic: true, restitution: 0.75, friction: 0 });
        this.pinG.fillStyle(0xff4d6d).fillCircle(x, y + dy, r).lineStyle(4, 0xffd166, 1).strokeCircle(x, y + dy, r)
          .fillStyle(0xffffff, 0.5).fillCircle(x - r * 0.3, y + dy - r * 0.3, r * 0.3);
      },
      rotor: (x, y, len, omega, arms = 1, thick = 16) => this.addRotor(x, y + dy, len, omega, arms, thick),
      portal: (ax, ay, bx, by, color) => this.addPortal({ ax, ay: ay + dy, bx, by: by + dy, color }),
    };
    this.speedCap = buildPinballMap(this.mapId, api).speedCap ?? 0;
  }

  /** 회전 장애물: 실제 물리 바디(정적 + 매 스텝 각도·각속도 갱신 → 공을 실제로 밀어냄) */
  private addRotor(x: number, y: number, len: number, omega: number, arms: number, thick: number, restitution = this.phys.rotor): void {
    const parts = Array.from({ length: arms }, (_, i) => M.Bodies.rectangle(x, y, len, thick, { angle: (Math.PI * i) / arms }));
    const body = M.Body.create({ parts, isStatic: true, restitution, friction: 0.01, ...(this.phys.staticFriction0 ? { frictionStatic: 0 } : {}) });
    this.matter.world.add(body);
    const view = this.add.container(x, y).setDepth(2);
    for (let i = 0; i < arms; i++) {
      view.add(this.add.rectangle(0, 0, len, thick, this.theme.plate).setStrokeStyle(3, this.theme.stroke).setRotation((Math.PI * i) / arms));
    }
    view.add(this.add.circle(0, 0, thick * 0.8, this.theme.stroke));
    this.rotors.push({ body: body as unknown as MatterJS.BodyType, omega, view });
  }

  /** 포털 한 쌍: 입구(소용돌이) → 출구(고리). 입구 진입 판정은 simStep 에서 */
  private addPortal(p: Portal): void {
    this.portals.push(p);
    const g = this.add.graphics().setDepth(1);
    g.fillStyle(p.color, 0.25).fillCircle(p.ax, p.ay, PORTAL_R + 12).lineStyle(4, p.color, 1).strokeCircle(p.ax, p.ay, PORTAL_R + 8)
      .fillStyle(0x000000, 0.85).fillCircle(p.ax, p.ay, PORTAL_R - 2);
    g.lineStyle(3, p.color, 0.9).strokeCircle(p.bx, p.by, PORTAL_R).lineStyle(1, p.color, 0.5).strokeCircle(p.bx, p.by, PORTAL_R + 8);
    const swirl = this.add.arc(p.ax, p.ay, PORTAL_R + 2, 0, 270, false).setStrokeStyle(3, 0xffffff, 0.8).setDepth(1);
    this.tweens.add({ targets: swirl, angle: 360, duration: 1400, repeat: -1 });
    this.add.text(p.ax, p.ay - PORTAL_R - 14, 'IN', { fontFamily: 'Arial Black, sans-serif', fontSize: '12px', color: '#ffffff' }).setOrigin(0.5).setDepth(1);
    this.add.text(p.bx, p.by - PORTAL_R - 12, 'OUT', { fontFamily: 'Arial Black, sans-serif', fontSize: '12px', color: '#ffffff' }).setOrigin(0.5).setDepth(1);
  }

  /** 순간이동: 출구 근처 빈자리(다른 공과 겹치지 않는 위치)에 놓고 안전한 속도로 시작 */
  private teleport(b: BallState, p: Portal, count = true, fx = true): boolean { // count=false: 랜덤 이벤트 이동 (포털 사용 횟수에 넣지 않음), fx=false: 효과는 호출 쪽에서 표시
    for (let k = 0; k < 6; k++) {
      const x = p.bx + this.rng.range(-14, 14), y = p.by + this.rng.range(-4, 6);
      if (this.balls.some((o) => o !== b && !o.removed && Math.abs(o.go.y - y) < 30 && Math.hypot(o.go.x - x, o.go.y - y) < BALL_R * 2 + 2)) continue;
      wake(b.go.body);
      M.Body.setPosition(b.go.body, { x, y });
      b.go.setVelocity(this.rng.range(-1, 1), 2);
      b.prevY = y;
      b.anchor = { x, y, t: this.elapsed };
      b.portalReadyAt = this.elapsed + PORTAL_COOLDOWN;
      if (count) { b.record.portals = (b.record.portals ?? 0) + 1; this.portalUses++; }
      if (fx) { this.portalFx(p.ax, p.ay, p.color); this.portalFx(x, y, p.color); }
      return true;
    }
    return false; // 출구가 막혀 있으면 이번 스텝은 보류
  }

  private portalFx(x: number, y: number, color: number): void {
    const c = this.add.circle(x, y, 10).setStrokeStyle(4, color).setDepth(7);
    this.tweens.add({ targets: c, radius: 46, alpha: 0, duration: 450, onComplete: () => c.destroy() });
  }

  private spawnBalls(): void {
    const n = this.specs.length;
    // 넓은 대기 공간에 촘촘히 배치 (최대 26열 × 20행 = 520칸) — 모두 동시에 출발
    const SP = 27;
    const cols = Math.min(n, 26);
    const x0 = W / 2 - ((cols - 1) * SP) / 2;
    const fontPx = n > 30 ? 11 : n > 15 ? 12 : 14;
    const order = this.specs.map((_, i) => i);
    // 스킬: 참가 순서 기준 배정(전용 난수) → 공 섞기와 무관. QA용(개발 전용) ?pbskill=종류 → 전부 같은 스킬
    const qs = import.meta.env.DEV ? new URLSearchParams(location.search).get('pbskill') : null;
    const skills = assignSkills(n, this.seed, SKILL_KINDS.includes(qs as SkillKind) ? (qs as SkillKind) : null);
    if (!this.keepOrder) for (let i = order.length - 1; i > 0; i--) { const j = this.rng.int(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    order.forEach((specIdx, slot) => {
      const spec = this.specs[specIdx];
      const c = slot % cols, r = Math.floor(slot / cols);
      const x = x0 + c * SP + this.rng.range(-0.5, 0.5);
      const y = 60 + r * SP + this.rng.range(-0.5, 0.5);
      const arc = this.add.circle(x, y, BALL_R, spec.color).setStrokeStyle(2, 0xffffff).setDepth(5);
      const go = this.matter.add.gameObject(arc, {
        restitution: this.phys.ball, friction: 0.005, frictionStatic: 0, frictionAir: 0.004, density: 0.0015,
        shape: { type: 'circle', radius: BALL_R },
      }) as unknown as MatterBall;
      this.balls.push({
        spec, go, prevY: y, anchor: { x, y, t: 0 }, portalReadyAt: 0, removed: false, skill: skills[specIdx],
        record: { id: spec.id, name: spec.name, ordinal: spec.ordinal, label: ballLabel(spec), color: spec.color, finishTime: null, finishOrder: null, unstuckCount: 0, portals: 0 },
      });
    });
    // 이름표 풀 (공이 적으면 공마다 1개)
    for (let i = 0; i < Math.min(n, LABEL_POOL); i++) {
      this.labels.push({
        text: this.add.text(0, 0, '', {
          fontFamily: 'Malgun Gothic, sans-serif', fontSize: `${fontPx}px`, color: '#ffffff', fontStyle: 'bold', stroke: '#000000', strokeThickness: 3,
        }).setOrigin(0.5, 1).setDepth(6).setVisible(false),
        owner: -1,
      });
    }
    this.cameras.main.scrollY = 0;
  }

  /** 출발: 모든 공을 동시에 물리 시뮬레이션에 투입 (시간차 없음) */
  startRace(): void {
    if (this.running) return;
    this.running = true;
    this.started = true;
    this.matter.world.setGravity(0, 1);
    for (const b of this.balls) {
      b.go.setVelocity(this.rng.range(-0.6, 0.6), 0);
      b.anchor.t = 0;
    }
  }

  /** 배속 변경 (경기 중 언제든). 물리 간격은 그대로, 스텝 횟수만 변함 */
  setSpeed(v: number): void { this.speed = Math.max(1, Math.min(3, Math.round(v))); }

  getRecords(): BallRecord[] { return this.balls.map((b) => ({ ...b.record })); }

  update(_time: number, delta: number): void {
    if (this.started) {
      // 실시간 × 배속만큼 고정 간격 물리 스텝 실행 → 게임 내 경과 시간 = 스텝 수 × 16.67ms
      this.acc += Math.min(delta, 100) * this.speed;
      let n = 0;
      while (this.acc >= STEP_MS && n++ < MAX_STEPS_PER_FRAME) {
        this.simStep();
        this.acc -= STEP_MS;
      }
      if (n >= MAX_STEPS_PER_FRAME) this.acc = 0; // 탭 전환 등 큰 지연은 버림 (순간 이동 방지)
    }
    for (const r of this.rotors) r.view.setRotation(r.body.angle);
    this.hazards?.draw(this.elapsed);
    this.skillSys?.draw(this.elapsed);
    this.gate?.draw(this.elapsed);
    this.updateCamera(delta * this.speed);
    this.updateLabels();
    this.tickTimer -= delta;
    if (this.tickTimer <= 0) {
      this.tickTimer = 120;
      this.hooks.onTick({ t: this.elapsed / 1000, finished: this.finishedCount, unstuck: this.unstuck, portals: this.portalUses });
    }
  }

  /** 이름표: 카메라에 보이는 미완주 공에만 풀에서 배정 (텍스트는 주인이 바뀔 때만 갱신) */
  private updateLabels(): void {
    const cam = this.cameras.main;
    const top = cam.scrollY - 20, bottom = cam.scrollY + PB_VIEW_H + 20;
    let k = 0;
    for (let i = 0; i < this.balls.length && k < this.labels.length; i++) {
      const b = this.balls[i];
      if (b.removed || b.go.y < top || b.go.y > bottom) continue;
      const L = this.labels[k++];
      if (L.owner !== i) { L.owner = i; L.text.setText(b.record.label); }
      L.text.setPosition(b.go.x, b.go.y - BALL_R - 2).setVisible(true);
    }
    for (; k < this.labels.length; k++) { this.labels[k].text.setVisible(false); this.labels[k].owner = -1; }
  }

  /** 물리 1스텝 + 완주·끼임 판정 (모두 게임 내 경과 시간 기준) */
  private simStep(): void {
    // 회전체: 스텝마다 각도 갱신 + 각속도 반영(true) → 충돌 시 실제로 공을 밀어냄. 고정 스텝이라 배속과 무관하게 동일
    for (const r of this.rotors) M.Body.setAngle(r.body, r.body.angle + (r.omega * STEP_MS) / 1000, true);
    this.matter.world.step(STEP_MS);
    if (this.speedCap) { // 신규 맵 전용 속도 상한: 회전체·범퍼에 맞아 벽을 뚫거나 튕겨 나가지 않게
      for (const b of this.balls) {
        if (b.removed) continue;
        const v = b.go.body.velocity, sp = Math.hypot(v.x, v.y);
        if (sp > this.speedCap) b.go.setVelocity((v.x / sp) * this.speedCap, (v.y / sp) * this.speedCap);
      }
    }
    if (!this.running) return;
    const prevT = this.elapsed;
    this.elapsed += STEP_MS;
    this.hazards.tick(this.elapsed); // 랜덤 이벤트: 게임 시간 기준 발생·진행·종료
    this.skillSys.beginStep();
    const crossed: BallState[] = [];
    const queueStalled = this.elapsed - this.lastFinishPass > 3000; // 결승 줄이 3초 이상 멈춤
    for (const b of this.balls) {
      if (b.removed) continue;
      const { x, y } = b.go;
      // 휴면: 결승 대기 구역의 정지 더미만 (입구 바로 위 흐름 구간과 그 밖의 맵에서는 항상 깨어 있음)
      if (b.go.body.isSleeping && (y < QUEUE_TOP || y > FIN_GATE_Y - FLOW_BAND)) wake(b.go.body);
      // 결승선 통과: 이전·현재 위치 보간으로 통과 시각 계산
      if (b.record.finishTime === null && y >= FINISH_Y && Math.abs(x - W / 2) <= FIN_GAP / 2) { // 통로 안을 지난 공만 완주
        const k = b.prevY < FINISH_Y && y > b.prevY ? (FINISH_Y - b.prevY) / (y - b.prevY) : 1;
        b.record.finishTime = (prevT + (this.elapsed - prevT) * k) / 1000; // 내부 기록용
        crossed.push(b);
      }
      b.prevY = y;
      this.hazards.affect(b, this.elapsed); // 이벤트 범위 안의 미완주 공만 (범위 밖은 즉시 반환)
      this.skillSys.step(b, this.elapsed);  // 구슬 스킬 (쿨타임·결승 구역·휴면 판정 포함)
      // 포털 진입 (완주 전, 쿨타임·최대 횟수 제한)
      if (b.record.finishTime === null && this.portals.length && this.elapsed >= b.portalReadyAt && (b.record.portals ?? 0) < PORTAL_MAX) {
        const p = this.portals.find((q) => Math.abs(y - q.ay) < PORTAL_R && Math.hypot(x - q.ax, y - q.ay) < PORTAL_R);
        if (p && this.teleport(b, p)) continue;
      }
      // 끼임 감지·복구: 결승 깔때기 위쪽만. 결승 대기 구역에서는 줄이 멈췄을 때만 (줄 서서 기다리는 공은 건드리지 않음)
      if (b.record.finishTime === null && y < FIN_TOP - 40 && (y < QUEUE_TOP || queueStalled)) {
        if (Math.hypot(x - b.anchor.x, y - b.anchor.y) > STUCK_MOVE_PX) b.anchor = { x, y, t: this.elapsed };
        else if (this.elapsed - b.anchor.t > STUCK_MS) {
          wake(b.go.body);
          b.go.setVelocity(this.rng.range(-NUDGE_SPEED, NUDGE_SPEED), -NUDGE_SPEED * 0.6);
          b.record.unstuckCount++;
          this.unstuck++;
          b.anchor = { x, y, t: this.elapsed };
        }
      }
    }
    // 결승 입구 정체 해소: 입구 바로 위에 공이 있는데 0.9초 이상 아무도 못 지나가면 주변 공을 살짝 흔듦
    // 역전 이벤트 진행·입구 막이 닫힌 동안은 의도된 정지 → 입구 흔들기·대기 구역 전체 깨우기 생략 (불필요한 물리 연산 방지)
    if (this.gate.closed) this.stalledSince.delete(FIN_GATE_Y);
    else if (this.unjam(FIN_GATE_Y, () => true, this.lastFinishPass)) {
      for (const b of this.balls) if (!b.removed && b.go.y >= QUEUE_TOP) wake(b.go.body); // 휴면 안전장치: 대기 구역 전체 깨움
      this.lastFinishPass = this.elapsed;
    }
    this.gate.step(this.elapsed); // 결승 입구 밀집·정체 감지(주기적) → 충전 → 역전 이벤트
    // 같은 스텝에 통과한 공들: 공 고유 ID 번호 오름차순으로 도착 순서 부여 (일관·중복 없음)
    if (!crossed.length) return;
    for (const b of orderSameStep(crossed.map((c) => ({ id: c.spec.id, b: c }))).map((x) => x.b)) {
      b.record.finishOrder = ++this.finishedCount;
      this.lastFinishPass = this.elapsed;
      // 완주한 공은 물리 바디 제거 (500개 대응: 결승 구역에 쌓이지 않게)
      this.matter.world.remove(b.go.body);
      b.removed = true;
      this.tweens.add({ targets: b.go, alpha: 0, scale: 0.4, duration: 350 });
      this.hooks.onFinish({ ...b.record }, []);
    }
    if (this.finishedCount === this.balls.length) { this.running = false; this.hazards.stop(); this.gate.stop(); this.hooks.onAllFinished(this.getRecords()); }
  }

  /** 입구 정체 판정·해소. pick: 해당 입구를 기다리는 공. 입구 위에 공이 없으면 판정 초기화 */
  private stalledSince = new Map<number, number>();
  private unjam(gateY: number, pick: (b: BallState) => boolean, lastPass: number): boolean {
    const near = (b: BallState) => { const dy = gateY - b.go.y; return Math.abs(b.go.x - W / 2) < 90 && dy > -6 && dy < 90; };
    // 입구 바로 위에 기다리는 공이 있는데 일정 시간 아무도 못 지나가면 정체 (떨리며 끼어 있는 공도 포함)
    const stalled = this.balls.some((b) => !b.removed && pick(b) && near(b));
    if (!stalled) { this.stalledSince.delete(gateY); return false; }
    const since = Math.max(this.stalledSince.get(gateY) ?? this.elapsed, lastPass);
    this.stalledSince.set(gateY, since);
    if (this.elapsed - since < GATE_IDLE_MS) return false;
    for (const b of this.balls) {
      if (b.removed || !pick(b)) continue;
      const dy = gateY - b.go.y;
      if (Math.abs(b.go.x - W / 2) < 130 && dy > -6 && dy < 130) { wake(b.go.body); b.go.setVelocity(this.rng.range(-2.5, 2.5), -3); }
    }
    this.unstuck++;
    this.stalledSince.delete(gateY);
    return true;
  }

  /**
   * 카메라(세로만): 출발 구역 → 선두 공(미완주 중 가장 아래) 추적 → 첫 완주 후 결승선 부근 고정. 우승 방식과 무관하게 동일.
   * 추적 대상 교체는 0.4초 안정화(새 선두가 120px 이상 앞서면 즉시), 이동은 지수 감쇠 + 속도 상한 → 순간이동·역주행에도 화면이 튀지 않음
   */
  private camTarget: BallState | null = null;
  private camCand: BallState | null = null;
  private camCandSince = 0;
  private updateCamera(delta: number): void {
    if (!this.running && this.elapsed === 0) return;
    const cam = this.cameras.main;
    const maxScroll = H - PB_VIEW_H;
    let target: number;
    if (this.finishedCount > 0) {
      target = Phaser.Math.Clamp(FINISH_Y - PB_VIEW_H * 0.72, 0, maxScroll); // 깔때기·회전 막대·입구·판정선이 보이게 고정
    } else {
      let lead: BallState | null = null;
      for (const b of this.balls) if (!b.removed && (!lead || b.go.y > lead.go.y)) lead = b;
      if (!lead) return;
      const cur = this.camTarget;
      if (!cur || cur.removed) { this.camTarget = lead; this.camCand = null; }
      else if (lead !== cur) {
        if (lead !== this.camCand) { this.camCand = lead; this.camCandSince = this.elapsed; }
        if (lead.go.y - cur.go.y > 120 || this.elapsed - this.camCandSince > 400) { this.camTarget = lead; this.camCand = null; }
      } else this.camCand = null;
      target = Phaser.Math.Clamp(this.camTarget!.go.y - PB_VIEW_H * 0.58, 0, maxScroll); // 선두가 화면 중앙보다 약간 아래 (출발 직후엔 0 → 출발 구역)
    }
    const step = (target - cam.scrollY) * (1 - Math.exp(-delta * 0.004));
    const cap = 1.6 * delta; // 최대 1.6px/ms(게임 시간) — 공 최고 낙하 속도(≈0.9px/ms)보다 빠르고 순간이동 거리는 부드럽게
    cam.scrollY += Phaser.Math.Clamp(step, -cap, cap);
  }
}
