// 결승 입구 역전 이벤트: 마지막(결승) 입구 위 깔때기에 공이 몰리거나 정체되면 충전 → 3종 중 1개 무작위 발동
//   💥 폭발 3회 우선 → 🌪️ 바람 → 🌀 블랙홀(대상 없으면 바람) → 이후 가중치 추첨.
// - 결승 입구는 항상 개방: 폭발·바람 뒤 에너지 막(물리 장벽) 없음. 공의 속도·위치만 변경하고 결과 계산은 유지.
// - 판정은 일정 주기(SCAN_STEPS 스텝)마다 입구 주변만 집계. 이벤트 중에도 주변 공 목록을 주기적으로 갱신해 그 공들만 처리
// - 입구(세로 통로)를 이미 지난 공·완주 공은 대상 아님
// - 표시 객체는 생성 시 1회만 만들고 매 프레임 위치·크기·투명도만 변경 (프레임마다 도형·글자를 다시 그리지 않음)
// 모든 시간은 게임 내 시간(ms, 고정 스텝 누적) → 배속과 무관. 속도 단위: px/스텝 (중력 ≈ 0.28px/스텝²)
import Phaser from 'phaser';
import type { Rng } from '../game/rng';
import { chooseGateEvent, type GateEventKind } from './gateRules';
export { GATE_EVENT_WEIGHTS } from './gateRules';
export type { GateEventKind } from './gateRules';


// ───── 정체 감지 (전체 공 수와 무관, 입구 주변 밀집·정체만 사용) ─────
const SCAN_STEPS = 6;          // 6스텝(=100ms)마다 집계
const ZONE_H = 220;            // 감지 구역: 입구 위 220px 높이의 45° 깔때기 (공 최대 약 110개 수용)
const JAM_N = 7;               // [밀집 경로] 감지 구역 안 공 7개 이상 (입구 폭 46px = 공 1.77개 → 7개면 약 2초 이상 대기 줄)
const SLOW_V = 1.3;            //            + 평균 속도 1.3px/스텝 미만 (자유 낙하 공은 보통 4 이상)
const HOLD_MS = 2000;          //            + 이 상태가 2초 지속 (잠깐 몰렸다 빠지는 경우 제외)
const STALL_N = 4;             // [정체 경로] 공 4개 이상이 기다리는데
const STALL_MS = 2000;         //            실제 완주가 2초 동안 없음 (기존 입구 흔들기로도 안 풀림, 공이 기다릴 때만 누적)
const FIRE_MIN_N = 4;          // 충전 끝 시점에 이보다 적으면 취소 (충전 중 정체가 풀린 경우)
const FULL_N = 60;             // 이 개수 이상 몰리면 이벤트 세기 최대 (세기 k = 0~1)
const CHARGE_MS = 1200;        // 충전(경고) 표시 → 그 뒤 발동
// ───── 연속 발동 방지 ─────
const COOLDOWN_MS = 6500;      // 장시간 아무 이벤트도 나오지 않는 구간 단축      // 이벤트 종료 후 최소 대기
const COOLDOWN_STEP_MS = 300;  // 후속 이벤트가 갈수록 심하게 늦어지는 현상 방지 // 발동할 때마다 대기 증가
const MAX_EVENTS = 12;        // 3회 종료 문제 해결; 무한 반복 방지용 상한 유지
// ───── 💥 초강력 폭발 (기존 입구 충격파를 통합·강화) ─────
const BLAST_R: [number, number] = [260, 400];  // 범위(px): 이전 170~300
const BLAST_P: [number, number] = [12, 16];    // 중심 최대 속도(px/스텝): 이전 7.5~12 (16 → 최대 약 460px 상승)
const BLAST_CAP = 16;                          // 개별 공 속도 상한: 이전 13. 맵 기존 속도 상한(15~16)과 같은 수준 → 판·벽 관통 없음
const BLAST_JITTER = 0.55;                     // 방향 흔들림(rad) → 위·양옆 여러 방향
const FRONT_R = 140;                           // 입구 앞 이 거리 안 = 곧 통과할 공 → 2단계 수직 발사 (더미 위로 올라가 뒤로 밀림)
const KICK_DELAY_MS = 130;
// ───── 🌀 블랙홀 ─────
const HOLE_MS = 2200;                          // 흡입 시간
const HOLE_UP = 36;                            // 중심: 입구 위 36px
const HOLE_R: [number, number] = [200, 300];   // 흡입 반경
const HOLE_CATCH = 30;                         // 중심에서 이 거리 안이면 흡수 → 맵 중간 높이로 이동
const HOLE_CAPTURE: [number, number] = [6, 30];// 이벤트당 최대 흡수 개수 (밀집도 비례)
const HOLE_PER_STEP = 1;                       // 스텝당 최대 이동 개수 (부하·표시 분산 → 30개 흡수에 0.5초 이상)
const HOLE_MIN_SHOW = 1500;                    // 흡수 한도에 일찍 도달해도 블랙홀은 최소 이 시간 표시
const HOLE_VMAX = 9;
const HOLE_COLOR = 0x9b5cff;
const HOLE_MIN_TARGETS = 3;                    // 아직 이동한 적 없는 공이 블랙홀 중심 120px 안에 이보다 적으면 블랙홀 대신 다른 이벤트 (재이동 제한으로 헛발동 방지)
const HOLE_TARGET_R = 120;
const POP_POOL = 8;                            // 이동 위치 표시 고리 (재사용, 동시에 최대 8개)
// ───── 🌪️ 상승 바람 (강제 이동 없이 위쪽 가속도만 추가 → 기존 물리 충돌 그대로) ─────
const WIND_MS: [number, number] = [2000, 2600];
const WIND_H = 340;                            // 영향 높이: 결승 깔때기 전체 (입구 위 340px)
const WIND_ACC = 0.55;                         // 위쪽 가속(px/스텝²): 위 0.55 ~ 아래 0.85 (+세기 0.2) → 중력(0.28)을 항상 이김
const WIND_VMAX: [number, number] = [10, 13];  // 상승 속도 상한
const WIND_TURB = 0.3;                         // 좌우 난류 (공끼리 부딪혀 다른 경로로)
const WIND_CAP = 14;
// ───── 속도 안전장치: 이벤트 중·폭발 후 1.5초 동안 입구 주변 공 속도를 16px/스텝 이하로 (공끼리 충돌로 더 빨라지는 경우 방지) ─────
const GUARD_MS = 1500, GUARD_CAP = 16;

export interface GbBall {
  go: { x: number; y: number; body: MatterJS.BodyType; setVelocity(x: number, y?: number): unknown };
  removed: boolean;
  record: { finishTime: number | null };
}
export interface GbHost {
  scene: Phaser.Scene; rng: Rng; balls: GbBall[];
  W: number; WALL: number; R: number; gateY: number; gap: number; viewW: number; viewH: number;
  midY: [number, number];                    // 블랙홀 이동 높이 범위 (맵 중간)
  wake(b: GbBall): void;
  isFree(x: number, y: number, r: number): boolean;                        // 맵 구조물·포털과 겹치지 않는지
  teleport(b: GbBall, x: number, y: number, color: number): boolean;       // 씬 기존 순간이동 (다른 공과 겹치면 false)
  /** QA 전용(개발 환경): true면 판정·기록만 하고 이벤트는 적용하지 않음 (효과 비교용 대조군) */
  dry?: boolean;
  /** QA 전용(개발 환경): 이벤트 종류 고정 */
  force?: GateEventKind | null;
}
interface Sample { n: number; avgV: number; done: number }
/** 역전 이벤트 상태: 대기 → 충전·경고 → 실행 → 종료 처리(2단계 발사·속도 안전장치) → 쿨타임. 물리 장벽 없음. */
export type GatePhase = 'idle' | 'charge' | 'active' | 'ending' | 'cooldown';
interface Active { kind: GateEventKind; t0: number; end: number; k: number; range: number; captured: number; limit: number; vmax: number }

export class GateBurst {
  private steps = 0;
  private congested = 0;       // 밀집+정체 누적 시간(ms)
  private noPass = 0;          // 공이 기다리는 동안 실제 완주가 없었던 시간(ms)
  private lastDone = 0;
  private phase: GatePhase = 'idle';
  private readyAt = 0;         // 쿨타임 종료 시각
  private chargeAt = -1;       // 충전 시작 시각 (-1: 충전 아님)
  private why: 'density' | 'stall' = 'density';
  private ev: Active | null = null;
  private near: GbBall[] = []; // 이벤트 대상 후보 (주기적 갱신)
  private warped = new WeakSet<GbBall>(); // 블랙홀 이동은 공마다 경기당 1회
  private stopped = false;
  private guardUntil = 0;      // 속도 안전장치 종료 시각
  private band: GbBall[] | null = null; // 블랙홀 이동 구역(맵 중간)의 공 목록 (스텝마다 1회만 생성)
  private readonly spots: { x: number; y: number }[] = []; // 블랙홀 이동 후보 자리: 구조물·포털과 안 겹치는 격자점 (맵 중간 높이, 30px 간격, 생성 시 1회 계산)
  private kick: GbBall[] = [];
  private kickAt = -1;
  private kickPower = 0;
  private readonly cx: number;
  // 표시 객체 (1회 생성)
  private warn: Phaser.GameObjects.Arc;
  private core: Phaser.GameObjects.Arc;
  private rays: Phaser.GameObjects.Graphics;
  private flash: Phaser.GameObjects.Arc;
  private rings: Phaser.GameObjects.Arc[] = [];
  private screen: Phaser.GameObjects.Rectangle;
  private hole: Phaser.GameObjects.Container;
  private holePull: Phaser.GameObjects.Arc;
  private pops: Phaser.GameObjects.Arc[] = [];
  private popNext = 0;
  private wind: Phaser.GameObjects.Container;
  private windStreaks: Phaser.GameObjects.Graphics;
  private banners: Record<'charge' | GateEventKind, Phaser.GameObjects.Text>;
  /** QA·확인용 통계 */
  readonly stats = {
    events: [] as { kind: GateEventKind; why: string; t: number; n: number; k: number; hit: number }[],
    snaps: [] as { base: number; front: GbBall[] }[], peakN: 0, peakJamN: 0, peakNoPassMs: 0, cancelled: 0, captured: 0, captureFail: 0, scans: 0,
  };

  constructor(private h: GbHost) {
    const sc = h.scene, cx = (this.cx = h.W / 2), gy = h.gateY;
    // 충전 경고
    this.warn = sc.add.circle(cx, gy - 10, 235, 0xff5a36, 0.14).setStrokeStyle(5, 0xffd166).setDepth(8).setVisible(false);
    this.core = sc.add.circle(cx, gy - 10, 26, 0xfff1b8).setDepth(8).setVisible(false);
    this.rays = sc.add.graphics({ x: cx, y: gy - 10 }).setDepth(8).setVisible(false);
    for (let i = 0; i < 8; i++) { const t = (i * Math.PI) / 4; this.rays.lineStyle(3, 0xffd166, 0.9).lineBetween(Math.cos(t) * 265, Math.sin(t) * 265, Math.cos(t) * 239, Math.sin(t) * 239); }
    // 폭발
    this.flash = sc.add.circle(cx, gy, BLAST_R[1] * 0.45, 0xfff1b8, 0.9).setDepth(8).setVisible(false);
    for (const [c, w] of [[0xffffff, 10], [0xff5a36, 8], [0xffd166, 6]]) this.rings.push(sc.add.circle(cx, gy, BLAST_R[1]).setStrokeStyle(w, c).setDepth(8).setVisible(false));
    this.screen = sc.add.rectangle(h.viewW / 2, h.viewH / 2, h.viewW, h.viewH, 0xfff1b8).setScrollFactor(0).setDepth(29).setAlpha(0);
    // 블랙홀: 보라 빛 + 검은 핵 + 회전하는 소용돌이 호 3개 + 수축하는 흡입 고리
    const hy = gy - HOLE_UP;
    this.hole = sc.add.container(cx, hy).setDepth(8).setVisible(false);
    this.hole.add(sc.add.circle(0, 0, 90, HOLE_COLOR, 0.22));
    for (let i = 0; i < 3; i++) this.hole.add(sc.add.arc(0, 0, 44 + i * 26, i * 120, i * 120 + 230, false).setStrokeStyle(6 - i * 1.5, i ? HOLE_COLOR : 0xffffff, 0.9 - i * 0.2).setClosePath(false));
    this.hole.add(sc.add.circle(0, 0, 30, 0x12001f, 1).setStrokeStyle(3, 0xd7b8ff));
    this.holePull = sc.add.circle(cx, hy, HOLE_R[1]).setStrokeStyle(4, HOLE_COLOR, 0.8).setDepth(8).setVisible(false);
    for (let i = 0; i < POP_POOL; i++) this.pops.push(sc.add.circle(0, 0, 46).setStrokeStyle(4, HOLE_COLOR).setDepth(7).setVisible(false));
    // 상승 바람: 깔때기 모양 기둥 + 위로 흐르는 화살표 줄 (1회 그림, y만 이동)
    this.wind = sc.add.container(cx, gy).setDepth(8).setVisible(false);
    const col = sc.add.graphics();
    col.fillStyle(0xbfe9ff, 0.16).fillPoints([{ x: -h.gap / 2, y: 0 }, { x: h.gap / 2, y: 0 }, { x: h.gap / 2 + WIND_H, y: -WIND_H }, { x: -h.gap / 2 - WIND_H, y: -WIND_H }], true);
    this.windStreaks = sc.add.graphics();
    for (let y = 0; y > -WIND_H * 2; y -= 60) for (const x of [-120, -40, 40, 120]) {
      const ox = x + ((y / 60) % 2 ? 20 : 0);
      this.windStreaks.lineStyle(4, 0xffffff, 0.75).lineBetween(ox - 16, y + 12, ox, y).lineBetween(ox, y, ox + 16, y + 12);
    }
    this.wind.add([col, this.windStreaks]);
    // 문구별 배너 (발동 중 글자 다시 그리기 없음)
    const banner = (text: string, color: string) => sc.add.text(h.viewW / 2, 128, text, {
      fontFamily: 'Malgun Gothic, sans-serif', fontSize: '28px', fontStyle: 'bold', color, stroke: '#000000', strokeThickness: 6,
      backgroundColor: 'rgba(20,4,8,0.72)', padding: { x: 16, y: 6 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(30).setAlpha(0);
    for (let y = h.midY[0]; y <= h.midY[1]; y += 30) for (let x = h.WALL + h.R + 30; x <= h.W - h.WALL - h.R - 30; x += 30) if (h.isFree(x, y, h.R + 14)) this.spots.push({ x, y });
    this.banners = { charge: banner('⚡ 결승 입구 에너지 폭주!', '#ffd166'), blast: banner('💥 초강력 폭발!', '#ff5a36'), hole: banner('🌀 블랙홀 출현!', '#c9a7ff'), wind: banner('🌪️ 상승 바람!', '#bfe9ff') };
  }

  /** 이벤트 연출 중에는 입구 흔들기만 생략 (물리 입구는 항상 열려 있음) */
  get suppressUnjam(): boolean { return this.phase === 'active'; }
  /** 현재 상태 (QA·확인용) */
  get state(): GatePhase { return this.phase; }

  /** 감지 구역: 입구 위 ZONE_H 높이의 45° 깔때기 사다리꼴 */
  private inZone(x: number, y: number): boolean {
    const up = this.h.gateY - y;
    return up >= 0 && up <= ZONE_H && Math.abs(x - this.cx) <= this.h.gap / 2 + up;
  }
  /** 입구(세로 통로)를 이미 지난 공 */
  private passed(b: GbBall): boolean { return b.go.y >= this.h.gateY - 2 && Math.abs(b.go.x - this.cx) <= this.h.gap / 2 + 2; }
  private active(b: GbBall): boolean { return !b.removed && b.record.finishTime === null && !this.passed(b); }

  private sample(): Sample {
    let n = 0, sv = 0, done = 0;
    for (const b of this.h.balls) {
      if (b.record.finishTime !== null) { done++; continue; }
      if (b.removed || !this.inZone(b.go.x, b.go.y)) continue;
      const v = b.go.body.velocity;
      n++; sv += Math.hypot(v.x, v.y);
    }
    return { n, avgV: n ? sv / n : 0, done };
  }

  /** 고정 스텝마다 1회 (씬의 공 반복이 끝난 뒤) */
  step(now: number): void {
    if (this.stopped) return;
    if (this.kickAt >= 0 && now >= this.kickAt) this.kickFront();
    if (now < this.guardUntil) this.guard();
    switch (this.phase) {
      case 'charge': if (now - this.chargeAt >= CHARGE_MS) this.fire(now); return;
      case 'active':
        if (this.ev) this.run(now);
        else if (this.kickAt < 0) this.phase = 'ending'; // 폭발: 2단계 발사까지 끝나면 종료 처리로
        return;
      case 'ending': // 발사·속도 안전장치 종료 후 쿨타임; 입구 장벽 없음
        if (this.kickAt < 0 && now >= this.guardUntil) this.startCooldown(now, COOLDOWN_MS + COOLDOWN_STEP_MS * (this.stats.events.length - 1));
        return;
      case 'cooldown': if (now >= this.readyAt) this.phase = 'idle'; break;
    }
    // 밀집·정체 집계는 대기·쿨타임 중에만 (기존과 같은 조건). 발동은 대기 상태에서만
    if (++this.steps < SCAN_STEPS) return;
    this.steps = 0;
    const s = this.sample(), dt = SCAN_STEPS * (1000 / 60);
    this.stats.scans++;
    if (s.n > this.stats.peakN) this.stats.peakN = s.n;
    this.noPass = s.done > this.lastDone || s.n < STALL_N ? 0 : this.noPass + dt;
    this.lastDone = s.done;
    if (this.noPass > this.stats.peakNoPassMs) this.stats.peakNoPassMs = Math.round(this.noPass);
    const slow = s.avgV < SLOW_V || this.noPass >= 1200;
    if (slow && s.n > this.stats.peakJamN) this.stats.peakJamN = s.n;
    this.congested = s.n >= JAM_N && slow ? this.congested + dt : Math.max(0, this.congested - dt * 2); // 풀리면 빠르게 감소
    if (this.phase !== 'idle' || this.stats.events.length >= MAX_EVENTS) return;
    if (this.congested >= HOLD_MS || this.noPass >= STALL_MS) {
      this.why = this.congested >= HOLD_MS ? 'density' : 'stall';
      this.phase = 'charge';
      this.chargeAt = now;
      this.showCharge(true);
      this.say('charge');
    }
  }

  private pick(): GateEventKind {
    // 폭발 3회 후 바람·블랙홀이 이어지도록 배치, 이후 무작위 (QA 강제 종류 우선).
    return chooseGateEvent(this.stats.events.length, () => this.h.rng.next(), this.h.force);
  }

  private fire(now: number): void {
    this.chargeAt = -1;
    this.showCharge(false);
    const s = this.sample();
    if (s.n < FIRE_MIN_N) { // 충전 중에 정체가 풀림 → 취소
      this.stats.cancelled++;
      this.congested = 0; this.noPass = 0;
      this.startCooldown(now, 2000);
      this.fade(this.banners.charge);
      return;
    }
    let kind = this.pick();
    const k = Phaser.Math.Clamp((s.n - JAM_N) / (FULL_N - JAM_N), 0, 1);
    if (kind === 'hole' && !this.h.force) { // 블랙홀 대상이 적으면 바람으로 대체 (폭발만 반복하지 않도록)
      let targets = 0;
      for (const b of this.h.balls) if (targets < HOLE_MIN_TARGETS && this.active(b) && !this.warped.has(b) && Math.hypot(b.go.x - this.cx, b.go.y - (this.h.gateY - HOLE_UP)) < HOLE_TARGET_R) targets++;
      if (targets < HOLE_MIN_TARGETS) kind = 'wind';
    }
    // 기록: 입구에 가까운 10개 (= 원래 곧 도착할 공)
    const near: { b: GbBall; d: number }[] = [];
    for (const b of this.h.balls) if (this.active(b) && this.h.gateY - b.go.y < 400) near.push({ b, d: Math.hypot(b.go.x - this.cx, b.go.y - this.h.gateY) });
    this.stats.snaps.push({ base: s.done, front: near.sort((p, q) => p.d - q.d).slice(0, 10).map((c) => c.b) });
    this.stats.events.push({ kind, why: this.why, t: Math.round(now), n: s.n, k: +k.toFixed(2), hit: 0 });
    this.congested = 0; this.noPass = 0;
    if (this.h.dry) { this.startCooldown(now, COOLDOWN_MS); return; }
    this.phase = 'active';
    this.say(kind);
    const lerp = (r: [number, number]) => r[0] + (r[1] - r[0]) * k;
    if (kind === 'blast') { this.blast(now, lerp(BLAST_R), lerp(BLAST_P)); return; }
    const dur = kind === 'hole' ? HOLE_MS : lerp(WIND_MS);
    this.ev = { kind, t0: now, end: now + dur, k, range: kind === 'hole' ? lerp(HOLE_R) : WIND_H, captured: 0, limit: Math.round(lerp(HOLE_CAPTURE)), vmax: lerp(WIND_VMAX) };
    this.refreshNear();
    // 바람·블랙홀 모두 공의 이동만 변화시키며 결승 입구는 막지 않는다.
    this.guardUntil = now + dur + GUARD_MS;
    if (kind === 'hole') { this.hole.setVisible(true).setScale(0.2); this.holePull.setVisible(true); this.h.scene.tweens.add({ targets: this.hole, scale: 1, duration: 300 }); }
    else this.wind.setVisible(true).setAlpha(0);
  }

  /** 속도 안전장치: 후보 목록의 공만 검사 */
  private guard(): void {
    for (const b of this.near) {
      if (b.removed) continue;
      const v = b.go.body.velocity, sp = Math.hypot(v.x, v.y);
      if (sp > GUARD_CAP) b.go.setVelocity((v.x / sp) * GUARD_CAP, (v.y / sp) * GUARD_CAP);
    }
  }

  /** 쿨타임 시작 (이벤트가 완전히 끝난 뒤 또는 충전 취소 시) */
  private startCooldown(now: number, ms: number): void {
    this.phase = 'cooldown';
    this.readyAt = now + ms;
  }

  /** 이벤트 대상 후보: 입구 위 영향 범위 안의 진행 중 공 (주기적 갱신 → 매 스텝 전체 순회 없음) */
  private refreshNear(): void {
    const e = this.ev!, top = this.h.gateY - e.range - 80;
    this.near = this.h.balls.filter((b) => this.active(b) && b.go.y > top);
  }

  /** 진행 중 이벤트 1스텝 */
  private run(now: number): void {
    const e = this.ev!;
    if (now >= e.end) { this.finishEv(now); return; }
    if (++this.steps >= SCAN_STEPS) { this.steps = 0; this.refreshNear(); }
    const { rng, gateY } = this.h;
    if (e.kind === 'hole') {
      const hx = this.cx, hy = gateY - HOLE_UP, R = e.range;
      let moved = 0;
      this.band = null;
      for (const b of this.near) {
        if (!this.active(b) || this.warped.has(b)) continue;
        const dx = hx - b.go.x, dy = hy - b.go.y, d = Math.hypot(dx, dy);
        if (d > R) continue;
        if (d < HOLE_CATCH && e.captured < e.limit) {
          if (moved < HOLE_PER_STEP && this.capture(b)) { moved++; e.captured++; }
          continue;
        }
        if (e.captured >= e.limit) continue; // 흡수 한도 도달 → 더 끌어당기지 않음
        const a = 0.35 + 0.55 * (1 - d / R), v = b.go.body.velocity;
        this.setV(b, v.x * 0.96 + (dx / (d || 1)) * a, v.y * 0.96 + (dy / (d || 1)) * a, HOLE_VMAX);
      }
      if (e.captured >= e.limit && e.end - now > 400) e.end = Math.max(now + 400, e.t0 + HOLE_MIN_SHOW); // 한도 도달 → 최소 표시 시간 후 종료
    } else {
      const k = e.k;
      for (const b of this.near) {
        if (!this.active(b)) continue;
        const up = gateY - b.go.y;
        if (up < 0 || up > WIND_H || Math.abs(b.go.x - this.cx) > this.h.gap / 2 + up + this.h.R) continue;
        const v = b.go.body.velocity, acc = WIND_ACC + 0.3 * (1 - up / WIND_H) + 0.2 * k; // 입구에 가까울수록 강하게 → 앞줄 공이 가장 높이
        const vy = Math.max(-e.vmax, v.y - acc);
        this.setV(b, v.x * 0.98 + rng.range(-WIND_TURB, WIND_TURB), vy, WIND_CAP);
      }
    }
  }

  /** 블랙홀 흡수: 맵 중간 높이의 안전한 빈 자리로 이동 (구조물·포털·다른 공과 겹치지 않는 위치만) */
  private capture(b: GbBall): boolean {
    const { rng, R, midY } = this.h;
    if (!this.spots.length) { this.stats.captureFail++; return false; }
    // 겹침 검사 대상: 이동 구역 근처 공만 (스텝당 1회 생성, 이동한 공은 추가)
    const band = (this.band ??= this.h.balls.filter((o) => !o.removed && o.go.y > midY[0] - R * 3 && o.go.y < midY[1] + R * 3));
    for (let k = 0; k < 14; k++) {
      const sp = this.spots[rng.int(this.spots.length)], x = sp.x + rng.range(-6, 6), y = sp.y + rng.range(-6, 6); // 같은 격자점에 몰리지 않게 살짝 흩뜨림
      if (band.some((o) => o !== b && !o.removed && Math.abs(o.go.y - y) < R * 3 && (o.go.x - x) ** 2 + (o.go.y - y) ** 2 < (R * 2 + 10) ** 2)) continue;
      if (!this.h.isFree(x, y, R + 8)) continue; // 최종 확인 (활성 망치 등 움직이는 구조물 포함)
      if (this.h.teleport(b, x, y, HOLE_COLOR)) {
        this.warped.add(b);
        band.push(b);
        this.pop(b.go.x, b.go.y);
        this.stats.captured++;
        this.stats.events[this.stats.events.length - 1].hit++;
        return true;
      }
    }
    this.stats.captureFail++;
    return false;
  }

  private finishEv(now: number): void {
    const e = this.ev!;
    if (e.kind === 'hole') {
      this.h.scene.tweens.add({ targets: this.hole, scale: 0.1, duration: 250, onComplete: () => this.hole.setVisible(false) });
      this.holePull.setVisible(false);
    } else this.wind.setVisible(false);
    if (e.kind === 'wind') this.stats.events[this.stats.events.length - 1].hit = this.near.length;
    this.ev = null; // near 는 속도 안전장치가 끝날 때까지 유지
    this.phase = 'ending';
  }

  private setV(b: GbBall, vx: number, vy: number, cap: number): void {
    const sp = Math.hypot(vx, vy);
    if (sp > cap) { vx = (vx / sp) * cap; vy = (vy / sp) * cap; }
    this.h.wake(b);
    b.go.setVelocity(vx, vy);
  }

  /** 💥 초강력 폭발: 더미 팽창 → 앞줄 공 발사 (입구 물리 장벽 없음) */
  private blast(now: number, range: number, power: number): void {
    const { rng, gateY } = this.h, cy = gateY + 8;
    let hit = 0;
    this.kick = [];
    for (const b of this.h.balls) {
      if (!this.active(b)) continue;
      const dx = b.go.x - this.cx, dy = b.go.y - cy;
      if (dy < -range || dy > 0) continue;
      const d = Math.hypot(dx, dy);
      if (d > range || d < 1) continue;
      let a: number, sp: number;
      if (d < FRONT_R) { a = -Math.PI / 2 + rng.range(-0.3, 0.3); sp = power * 0.3; this.kick.push(b); }
      else { a = Math.atan2(dy, dx) + rng.range(-BLAST_JITTER, BLAST_JITTER); sp = power * (0.55 + 0.45 * (d / range)) * rng.range(0.65, 1.15); }
      a = Math.min(-0.25, Math.max(-Math.PI + 0.25, a)); // 항상 위쪽 성분 (판 아래로 파고들지 않게)
      this.setV(b, Math.cos(a) * sp, Math.sin(a) * sp, BLAST_CAP);
      hit++;
    }
    this.stats.events[this.stats.events.length - 1].hit = hit;
    this.near = this.h.balls.filter((b) => this.active(b) && this.h.gateY - b.go.y < range + 80); // 속도 안전장치 대상
    this.kickPower = power;
    this.kickAt = now + KICK_DELAY_MS;
    this.guardUntil = now + GUARD_MS;
    this.blastFx(range);
  }

  private kickFront(): void {
    const { rng } = this.h;
    for (const b of this.kick) {
      if (!this.active(b)) continue;
      const a = -Math.PI / 2 + rng.range(-0.35, 0.35);
      this.setV(b, Math.cos(a) * this.kickPower * rng.range(0.95, 1.1), Math.sin(a) * this.kickPower * rng.range(0.95, 1.1), BLAST_CAP);
    }
    this.kick = []; this.kickAt = -1;
  }

  /** 매 프레임: 표시 객체의 크기·투명도·회전만 변경 */
  draw(now: number): void {
    const e = this.ev;
    if (e?.kind === 'hole') {
      this.hole.setRotation(-now / 160);
      const p = ((now - e.t0) % 700) / 700;
      this.holePull.setScale(1 - 0.85 * p).setAlpha(0.2 + 0.7 * p);
    } else if (e?.kind === 'wind') {
      this.wind.setAlpha(Math.min(1, (now - e.t0) / 200, (e.end - now) / 200));
      this.windStreaks.setY(((now - e.t0) * -0.9) % 120);
    }
    if (this.chargeAt < 0) return;
    const p = Phaser.Math.Clamp((now - this.chargeAt) / CHARGE_MS, 0, 1), pulse = 0.5 + 0.5 * Math.sin((now / 1000) * (10 + 20 * p));
    this.warn.setScale(1 - 0.7 * p).setAlpha(0.5 + 0.5 * pulse);
    this.core.setScale((8 + 18 * p) / 26).setAlpha(0.6 + 0.4 * pulse);
    this.rays.setScale(1 - 0.85 * p).setRotation(now / 400);
  }

  /** 경기 종료: 표시·물리 정리, 이후 발동 없음 */
  stop(): void {
    this.stopped = true; this.phase = 'idle'; this.chargeAt = -1; this.kickAt = -1; this.kick = []; this.ev = null; this.near = [];
    this.showCharge(false); this.hole.setVisible(false); this.holePull.setVisible(false); this.wind.setVisible(false);
  }

  /** 블랙홀 이동 위치 표시: 고리 풀을 돌려 씀 (새 객체 생성 없음) */
  private pop(x: number, y: number): void {
    const c = this.pops[this.popNext++ % POP_POOL], sc = this.h.scene;
    sc.tweens.killTweensOf(c);
    c.setPosition(x, y).setScale(0.2).setAlpha(1).setVisible(true);
    sc.tweens.add({ targets: c, scale: 1, alpha: 0, duration: 450, onComplete: () => c.setVisible(false) });
  }

  private showCharge(on: boolean): void { this.warn.setVisible(on); this.core.setVisible(on); this.rays.setVisible(on); }

  /** 폭발 효과: 미리 만든 섬광·고리 3개·화면 섬광 재사용 (scale 트윈 → 도형 재계산 없음) + 화면 흔들림 */
  private blastFx(range: number): void {
    const sc = this.h.scene, M = BLAST_R[1];
    sc.tweens.killTweensOf([this.flash, this.screen, ...this.rings]);
    this.flash.setScale(range / M).setAlpha(0.9).setVisible(true);
    sc.tweens.add({ targets: this.flash, alpha: 0, scale: (range / M) * 1.8, duration: 360, onComplete: () => this.flash.setVisible(false) });
    [[0, 450], [90, 600], [180, 760]].forEach(([delay, dur], i) => {
      const ring = this.rings[i].setScale(16 / M).setAlpha(1).setVisible(true);
      sc.tweens.add({ targets: ring, scale: range / M, alpha: 0, delay, duration: dur, onComplete: () => ring.setVisible(false) });
    });
    this.screen.setAlpha(0.45);
    sc.tweens.add({ targets: this.screen, alpha: 0, duration: 280 });
    sc.cameras.main.shake(380, 0.014);
  }

  private say(kind: 'charge' | GateEventKind): void {
    const sc = this.h.scene, all = Object.values(this.banners), b = this.banners[kind];
    sc.tweens.killTweensOf(all);
    for (const x of all) x.setAlpha(0);
    b.setAlpha(1);
    sc.tweens.add({ targets: b, alpha: 0, delay: 1100, duration: 300 });
  }

  private fade(t: Phaser.GameObjects.Text): void {
    this.h.scene.tweens.killTweensOf(t);
    this.h.scene.tweens.add({ targets: t, alpha: 0, duration: 200 });
  }
}
