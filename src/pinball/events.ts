// 핀볼 랜덤 방해 이벤트 8종 (임시로 나타나는 추가 요소 — 기존 맵·물리값은 그대로)
// 모든 시간은 게임 내 시간(ms, 고정 스텝 누적) → 1x/2x/3x 배속과 무관. 활성 이벤트는 항상 최대 1개.
// 속도 단위: px/스텝 (Matter 속도). 모든 힘은 상한을 두어 벽·장애물 관통이나 맵 밖 이탈 방지.
import Phaser from 'phaser';
import type { Rng } from '../game/rng';
import type { MapId } from './maps';
import type { PreviewShape } from './PinballScene';
import { canSpawnHazard } from './gateRules';

export type EventKind = 'bomb' | 'blackhole' | 'jump' | 'boost' | 'magnet' | 'hammer' | 'warp' | 'gust';
export const EVENT_KINDS: EventKind[] = ['bomb', 'blackhole', 'jump', 'boost', 'magnet', 'hammer', 'warp', 'gust'];
export const EVENT_INFO: Record<EventKind, { label: string; color: number }> = {
  bomb: { label: '💥 랜덤 폭발!', color: 0xff5a36 },
  blackhole: { label: '🌀 블랙홀 발생!', color: 0x9b5cff },
  jump: { label: '🚀 슈퍼 점프!', color: 0x3ddc84 },
  boost: { label: '⚡ 급가속 구역!', color: 0xffd23f },
  magnet: { label: '🧲 자석 폭주!', color: 0x4fc3f7 },
  hammer: { label: '🔨 거대 망치 등장!', color: 0xff9f1c },
  warp: { label: '🔮 랜덤 워프!', color: 0xff4fd8 },
  gust: { label: '🌪️ 돌풍 발생!', color: 0xbfe9ff },
};
/** 맵별 등장 이벤트 (이 중 무작위) */
export const MAP_EVENTS: Record<MapId, EventKind[]> = {
  basic: ['bomb', 'jump', 'gust'],
  maze: ['magnet', 'warp'],
  rotor: ['hammer', 'bomb'],
  portal: ['blackhole', 'warp'],
  chaos: EVENT_KINDS,
};
export const EVENT_GAP_MS: [number, number] = [12000, 20000]; // 시작 후·이전 이벤트 종료 후 다음 발생까지
const DUR: Record<EventKind, number> = { bomb: 1400, blackhole: 4500, jump: 6000, boost: 5000, magnet: 4500, hammer: 7000, warp: 6000, gust: 4500 };
// 영향 범위 (반지름 또는 반폭·반높이)
const BOMB_R = 150, BOMB_WARN = 700, HOLE_R = 170, MAG_R = 190, WARP_R = 24;
const HAM_A = 105, HAM_W = 30, HAM_H = 90, HAM_OMEGA = 3.6; // 망치: 진폭·크기·각속도(rad/s) → 최대 약 6px/스텝
const ALL_FREE: Partial<Record<EventKind, [number, number]>> = { hammer: [HAM_A + HAM_W / 2 + 32, HAM_H / 2 + 32], jump: [70, 26], warp: [40, 40], blackhole: [40, 40] };

export interface EvBall {
  go: { x: number; y: number; body: MatterJS.BodyType; setVelocity(x: number, y?: number): unknown };
  removed: boolean;
  record: { finishTime: number | null };
  spec: { id: string };
}
type MatterLib = { Body: typeof MatterJS.Body; Bodies: typeof MatterJS.Bodies };
export interface EvHost {
  scene: Phaser.Scene; M: MatterLib; rng: Rng; balls: EvBall[]; obstacles: PreviewShape[];
  W: number; WALL: number; R: number; yMin: number; yMax: number; viewW: number;
  wake(b: EvBall): void;
  /** 구슬 스킬 '충격 보호' 중이면 true → 이벤트 힘 30%로 감소, 순간이동·점프 무효 (기본 충돌은 그대로) */
  shielded(b: EvBall, now: number): boolean;
  /** 기존 포털 순간이동 함수 재사용 (출구 근처 다른 공과 겹치면 false → 취소) */
  teleport(b: EvBall, fromX: number, fromY: number, x: number, y: number, color: number): boolean;
  /** 결승의 실제 폭발 연출과 2차 밀어내기까지 끝났는지 검사한다. */
  hasCompletedGateBlast(): boolean;
}
interface Active {
  kind: EventKind; x: number; y: number; t0: number; end: number;
  hw: number; hh: number; reach: number; dir: number;
  fired?: boolean; blastNow?: boolean; body?: MatterJS.BodyType; head?: Phaser.GameObjects.Rectangle; hx?: number; lastSide?: number;
}

// ───── 장애물 겹침 판정 (맵 미리보기와 같은 배치 데이터 사용) ─────
const circBox = (x: number, y: number, r: number, cx: number, cy: number, hw: number, hh: number) => {
  const qx = Math.max(Math.abs(x - cx) - hw, 0), qy = Math.max(Math.abs(y - cy) - hh, 0);
  return qx * qx + qy * qy < r * r;
};
function rectBox(s: { x: number; y: number; w: number; h: number; deg: number }, cx: number, cy: number, hw: number, hh: number): boolean {
  const a = (s.deg * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
  const dx = s.x - cx, dy = s.y - cy;
  for (const [ux, uy] of [[1, 0], [0, 1], [c, sn], [-sn, c]]) { // 분리축 판정
    const rO = (s.w / 2) * Math.abs(ux * c + uy * sn) + (s.h / 2) * Math.abs(-ux * sn + uy * c);
    if (Math.abs(dx * ux + dy * uy) > rO + hw * Math.abs(ux) + hh * Math.abs(uy)) return false;
  }
  return true;
}

export class PinballEvents {
  private ev: Active | null = null;
  private nextAt: number;
  private ready = new Map<string, number>(); // 공별 재발동 대기 (게임 시간)
  private g: Phaser.GameObjects.Graphics;
  private banner: Phaser.GameObjects.Text;
  /** QA·확인용 통계 */
  readonly stats = { log: [] as { kind: EventKind; t0: number; end: number }[], hits: {} as Partial<Record<EventKind, number>>, warps: 0, warpCancel: 0 };

  constructor(private h: EvHost, private kinds: EventKind[], private forced: EventKind | null) {
    this.nextAt = forced ? 3000 : h.rng.range(EVENT_GAP_MS[0], EVENT_GAP_MS[1]);
    this.g = h.scene.add.graphics().setDepth(4);
    this.banner = h.scene.add.text(h.viewW / 2, 64, '', {
      fontFamily: 'Malgun Gothic, sans-serif', fontSize: '30px', fontStyle: 'bold', color: '#ffffff', stroke: '#000000', strokeThickness: 6,
      backgroundColor: 'rgba(20,4,8,0.72)', padding: { x: 18, y: 8 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(30).setAlpha(0);
  }

  get active(): EventKind | null { return this.ev?.kind ?? null; }

  /** 고정 스텝마다 1회 (now: 게임 시간 ms) */
  tick(now: number): void {
    const e = this.ev;
    if (!e) { if (now >= this.nextAt) this.spawn(now); return; }
    if (now >= e.end) { this.finish(now); return; }
    e.blastNow = false;
    if (e.kind === 'bomb' && !e.fired && now - e.t0 >= BOMB_WARN) { e.fired = e.blastNow = true; this.blastFx(e); }
    if (e.kind === 'hammer' && e.body) {
      const ph = ((now - e.t0) / 1000) * HAM_OMEGA;
      const x = e.x + HAM_A * Math.sin(ph);
      this.h.M.Body.setPosition(e.body, { x, y: e.y }, true); // 속도 반영 → 실제 충돌로 공을 밀어냄
      e.hx = x;
      const side = Math.sign(Math.cos(ph));
      if (e.lastSide !== undefined && side !== e.lastSide) this.ring(x - side * HAM_W, e.y, 0xffd166, 40); // 방향 전환 충격 표시
      e.lastSide = side;
    }
  }

  /** 공 하나에 이벤트 효과 적용 (메인 루프 안에서 호출, 범위 밖이면 즉시 반환) */
  affect(b: EvBall, now: number): void {
    const e = this.ev;
    if (!e || b.removed || b.record.finishTime !== null) return;
    const dx = b.go.x - e.x, dy = b.go.y - e.y;
    if (dy > e.reach || dy < -e.reach) return;
    const d2 = dx * dx + dy * dy;
    const v = b.go.body.velocity;
    const sh = this.h.shielded(b, now);
    const set = (vx: number, vy: number, cap: number) => {
      if (sh) { vx = v.x + (vx - v.x) * 0.3; vy = v.y + (vy - v.y) * 0.3; }
      const sp = Math.hypot(vx, vy);
      if (sp > cap) { vx = (vx / sp) * cap; vy = (vy / sp) * cap; }
      this.h.wake(b); b.go.setVelocity(vx, vy);
      this.stats.hits[e.kind] = (this.stats.hits[e.kind] ?? 0) + 1;
    };
    const ready = (this.ready.get(b.spec.id) ?? 0) <= now;
    switch (e.kind) {
      case 'bomb': {
        if (!e.blastNow || d2 > BOMB_R * BOMB_R) return;
        const d = Math.sqrt(d2) || 1, k = 3 + 9 * (1 - d / BOMB_R); // 가까울수록 강하게
        set(v.x + (dx / d) * k, v.y + (dy / d) * k, 13);
        return;
      }
      case 'blackhole':
      case 'magnet': {
        const R = e.kind === 'blackhole' ? HOLE_R : MAG_R;
        if (d2 > R * R) return;
        const d = Math.sqrt(d2) || 1;
        if (e.kind === 'blackhole' && d < 22) { if (ready && !sh) this.warp(b, now, e); return; }
        const a = (e.kind === 'blackhole' ? 0.2 : 0.14) + 0.4 * (1 - d / R);
        set(v.x * 0.97 - (dx / d) * a, v.y * 0.97 - (dy / d) * a, e.kind === 'blackhole' ? 7 : 6);
        return;
      }
      case 'jump':
        if (sh || !ready || Math.abs(dx) > e.hw || dy < -(this.h.R + 12) || dy > this.h.R || v.y < -1) return;
        set(this.h.rng.range(-1.5, 1.5), -15, 15); // 위로 약 400px 상승 (이전 장애물 구간으로)
        this.ready.set(b.spec.id, now + 2000);
        this.ring(b.go.x, e.y, EVENT_INFO.jump.color, 34);
        return;
      case 'boost':
        if (Math.abs(dx) > e.hw || Math.abs(dy) > e.hh || v.y >= 10) return;
        set(v.x, Math.min(10, v.y + 0.55), 10);
        return;
      case 'gust':
        if (Math.abs(dy) > e.hh || v.x * e.dir >= 6.5) return;
        set(v.x + e.dir * 0.32, v.y, 9);
        return;
      case 'warp':
        if (ready && !sh && d2 < WARP_R * WARP_R) this.warp(b, now, e);
        return;
      case 'hammer':
        if (Math.abs(b.go.x - (e.hx ?? e.x)) < 60 && Math.abs(dy) < 70 && v.x * v.x + v.y * v.y > 144) set(v.x, v.y, 12); // 충돌 강도 상한
        return;
    }
  }

  /** 매 프레임 시각 효과 (게임 시간 기준 애니메이션) */
  draw(now: number): void {
    const g = this.g; g.clear();
    const e = this.ev; if (!e) return;
    const c = EVENT_INFO[e.kind].color;
    const a = Math.max(0, Math.min(1, (now - e.t0) / 300, (e.end - now) / 300));
    const t = now / 1000;
    g.setAlpha(a);
    switch (e.kind) {
      case 'bomb':
        if (!e.fired) {
          const p = 0.5 + 0.5 * Math.sin(t * 25);
          g.fillStyle(c, 0.12 + 0.15 * p).fillCircle(e.x, e.y, BOMB_R).lineStyle(4, c, 0.6 + 0.4 * p).strokeCircle(e.x, e.y, BOMB_R)
            .fillStyle(0xffffff, 0.9).fillCircle(e.x, e.y, 10 + 6 * p);
        }
        break;
      case 'blackhole':
        g.fillStyle(c, 0.12).fillCircle(e.x, e.y, HOLE_R).fillStyle(0x12001f, 0.95).fillCircle(e.x, e.y, 26);
        for (let i = 0; i < 3; i++) {
          const r = 45 + i * 35, s = -t * (3 - i * 0.6) + i;
          g.lineStyle(5 - i, c, 0.9 - i * 0.2).beginPath().arc(e.x, e.y, r, s, s + 4).strokePath();
        }
        break;
      case 'jump': {
        g.fillStyle(c, 1).fillRect(e.x - e.hw, e.y - 5, e.hw * 2, 10).lineStyle(2, 0xffffff, 0.9).strokeRect(e.x - e.hw, e.y - 5, e.hw * 2, 10);
        const off = (t * 60) % 30;
        for (let i = 0; i < 3; i++) { const y = e.y - 20 - i * 30 - off; g.fillStyle(c, 0.8 - i * 0.25).fillTriangle(e.x - 16, y + 12, e.x + 16, y + 12, e.x, y - 6); }
        break;
      }
      case 'boost': {
        g.fillStyle(c, 0.13).fillRect(e.x - e.hw, e.y - e.hh, e.hw * 2, e.hh * 2).lineStyle(2, c, 0.7).strokeRect(e.x - e.hw, e.y - e.hh, e.hw * 2, e.hh * 2);
        const off = (t * 220) % 60;
        for (let y = e.y - e.hh + off; y < e.y + e.hh - 10; y += 60) g.lineStyle(4, c, 0.8).lineBetween(e.x - 22, y, e.x, y + 14).lineBetween(e.x, y + 14, e.x + 22, y);
        for (const sx of [-60, 60]) g.lineStyle(2, 0xffffff, 0.35).lineBetween(e.x + sx, e.y - e.hh + ((off * 2) % e.hh), e.x + sx, e.y - e.hh + ((off * 2) % e.hh) + 60);
        break;
      }
      case 'magnet': {
        const p = (t * 1.6) % 1;
        g.lineStyle(3, c, 0.7).strokeCircle(e.x, e.y, MAG_R).lineStyle(2, c, 1 - p).strokeCircle(e.x, e.y, MAG_R * (1 - p));
        g.fillStyle(c, 0.9).fillCircle(e.x, e.y, 14);
        for (let k = 0; k < 4; k++) { // 전기 파동 (지그재그 4줄)
          const ang = k * 1.57 + t * 2; let px = e.x, py = e.y;
          g.lineStyle(2, 0xffffff, 0.8).beginPath().moveTo(px, py);
          for (let s = 1; s <= 5; s++) { px = e.x + Math.cos(ang) * s * 30 + (Math.random() - 0.5) * 14; py = e.y + Math.sin(ang) * s * 30 + (Math.random() - 0.5) * 14; g.lineTo(px, py); }
          g.strokePath();
        }
        break;
      }
      case 'hammer': {
        const x = e.hx ?? e.x;
        g.lineStyle(10, 0x8a5a2b, 1).lineBetween(e.x, e.y - 150, x, e.y - HAM_H / 2); // 손잡이 (시각만)
        g.fillStyle(0xffd166, 1).fillCircle(e.x, e.y - 150, 8);
        e.head?.setPosition(x, e.y).setRotation(Math.cos(((now - e.t0) / 1000) * HAM_OMEGA) * 0.12).setAlpha(a);
        break;
      }
      case 'warp': {
        const p = 0.5 + 0.5 * Math.sin(t * 6);
        g.fillStyle(c, 0.2 + 0.2 * p).fillCircle(e.x, e.y, WARP_R + 14).lineStyle(5, c, 1).strokeCircle(e.x, e.y, WARP_R + 4)
          .lineStyle(2, 0xffffff, 0.5 + 0.5 * p).strokeCircle(e.x, e.y, WARP_R + 12 + p * 6).fillStyle(0x16001a, 0.9).fillCircle(e.x, e.y, WARP_R - 6);
        g.lineStyle(3, 0xffffff, 0.8).beginPath().arc(e.x, e.y, WARP_R + 4, t * 4, t * 4 + 2).strokePath();
        break;
      }
      case 'gust': {
        g.fillStyle(c, 0.07).fillRect(this.h.WALL, e.y - e.hh, this.h.W - this.h.WALL * 2, e.hh * 2);
        const span = this.h.W - this.h.WALL * 2;
        for (let i = 0; i < 9; i++) {
          const y = e.y - e.hh + 18 + i * ((e.hh * 2 - 36) / 8);
          const x0 = this.h.WALL + ((((t * 420 + i * 97) % span) + span) % span);
          const x = e.dir > 0 ? x0 : this.h.W - x0;
          g.lineStyle(2, c, 0.6).lineBetween(x, y, x - e.dir * 60, y);
        }
        const ax = this.h.W / 2;
        g.fillStyle(c, 0.85).fillTriangle(ax + e.dir * 40, e.y, ax - e.dir * 10, e.y - 26, ax - e.dir * 10, e.y + 26).fillRect(ax - 50 - (e.dir > 0 ? 0 : -50), e.y - 8, 50, 16);
        break;
      }
    }
  }

  /** 경기 종료: 진행 중 이벤트 정리 + 이후 발생 중지 */
  stop(): void { if (this.ev) this.finish(Infinity); this.nextAt = Infinity; }

  // ───── 내부 ─────
  private spawn(now: number): void {
    // 기존 맵 자체 랜덤 이벤트가 결승 폭발보다 먼저 바람·블랙홀을 띄우던 문제 방지.
    // 개발용 ?pbev 강제 테스트는 기존처럼 우선한다.
    const pool = this.forced ? [this.forced] : this.kinds.filter((kind) => canSpawnHazard(kind, this.h.hasCompletedGateBlast()));
    for (let i = pool.length - 1; i > 0; i--) { const j = this.h.rng.int(i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    for (const kind of pool) {
      const spot = this.place(kind);
      if (spot) { this.begin(kind, spot.x, spot.y, now); return; }
    }
    this.nextAt = now + 1000; // 안전한 위치가 없으면 1초 뒤 재시도
  }

  /** 실제 공이 이동 중인 구역(출발 대기·결승 깔때기 제외)에서 장애물과 겹치지 않는 위치 선택 */
  private place(kind: EventKind): { x: number; y: number } | null {
    const { balls, rng, W, WALL, yMin, yMax } = this.h;
    let anchor: EvBall | null = null;
    for (let k = 0; k < 16 && !anchor; k++) {
      const b = balls[rng.int(balls.length)];
      if (!b.removed && b.record.finishTime === null && b.go.y > yMin - 200 && b.go.y < yMax) anchor = b;
    }
    if (!anchor) return null;
    const [hw, hh] = ALL_FREE[kind] ?? [24, 24];
    for (let k = 0; k < 40; k++) {
      const y = Math.max(yMin, Math.min(yMax, anchor.go.y + rng.range(80, kind === 'hammer' ? 700 : 300))); // 공이 곧 지나갈 아래쪽
      const x = kind === 'gust' ? W / 2
        : kind === 'hammer' ? rng.range(WALL + hw, W - WALL - hw)
          : Math.max(WALL + hw + 10, Math.min(W - WALL - hw - 10, anchor.go.x + rng.range(-140, 140)));
      if (kind === 'gust' || this.free(x, y, hw, hh, kind === 'hammer')) return { x, y };
    }
    return null;
  }

  /** 외부(결승 입구 블랙홀 등)용: 반지름 r 원이 맵 구조물·포털·활성 망치와 겹치지 않는지 */
  isFree(x: number, y: number, r: number): boolean {
    const e = this.ev;
    if (e?.kind === 'hammer' && Math.abs(y - e.y) < HAM_H / 2 + r + 20 && Math.abs(x - (e.hx ?? e.x)) < HAM_A + HAM_W / 2 + r + 20) return false;
    return this.free(x, y, r, r);
  }

  /** pinsOk: 망치 전용 — 작은 원형 핀은 공이 옆으로 미끄러져 빠지므로 허용 (판·벽·회전체·범퍼·포털만 금지) */
  private free(x: number, y: number, hw: number, hh: number, pinsOk = false): boolean {
    const { W, WALL } = this.h;
    if (x - hw < WALL || x + hw > W - WALL) return false;
    for (const s of this.h.obstacles) {
      if (pinsOk && s.k === 'pin' && s.r <= 8) continue;
      const hit = s.k === 'rect' ? rectBox(s, x, y, hw, hh)
        : s.k === 'rotor' ? circBox(s.x, s.y, s.len / 2 + 8, x, y, hw, hh)
          : s.k === 'portal' ? circBox(s.ax, s.ay, 34, x, y, hw, hh) || circBox(s.bx, s.by, 30, x, y, hw, hh)
            : circBox(s.x, s.y, s.r, x, y, hw, hh);
      if (hit) return false;
    }
    return true;
  }

  private begin(kind: EventKind, x: number, y: number, now: number): void {
    const { rng, scene, M } = this.h;
    const e: Active = { kind, x, y, t0: now, end: now + DUR[kind], hw: 0, hh: 0, reach: 0, dir: rng.next() < 0.5 ? -1 : 1 };
    switch (kind) {
      case 'bomb': e.reach = BOMB_R; break;
      case 'blackhole': e.reach = HOLE_R; break;
      case 'magnet': e.reach = MAG_R; break;
      case 'jump': e.hw = 60; e.reach = 40; break;
      case 'boost': e.hw = 90; e.hh = 130; e.reach = 130; break;
      case 'gust': e.hh = 150; e.reach = 150; break;
      case 'warp': e.reach = WARP_R; break;
      case 'hammer': {
        e.reach = 80;
        e.body = M.Bodies.rectangle(x, y, HAM_W, HAM_H, { isStatic: true, restitution: 0.3, friction: 0.01 }) as unknown as MatterJS.BodyType;
        scene.matter.world.add(e.body);
        e.head = scene.add.rectangle(x, y, HAM_W, HAM_H, 0x9a9a9a).setStrokeStyle(4, 0xffd166).setDepth(4);
        break;
      }
    }
    this.ev = e;
    this.stats.log.push({ kind, t0: now, end: e.end });
    const info = EVENT_INFO[kind];
    scene.tweens.killTweensOf(this.banner);
    this.banner.setText(info.label).setColor(`#${info.color.toString(16).padStart(6, '0')}`).setAlpha(1);
    scene.tweens.add({ targets: this.banner, alpha: 0, delay: 1800, duration: 400 });
  }

  private finish(now: number): void {
    const e = this.ev; if (!e) return;
    if (e.kind === 'magnet') { // 자력 해제: 범위 안 공을 바깥으로 살짝 흩뜨림 (끼임 방지)
      for (const b of this.h.balls) {
        if (b.removed || b.record.finishTime !== null) continue;
        const dx = b.go.x - e.x, dy = b.go.y - e.y, d2 = dx * dx + dy * dy;
        if (dy > MAG_R || dy < -MAG_R || d2 > MAG_R * MAG_R) continue;
        const d = Math.sqrt(d2) || 1;
        this.h.wake(b); b.go.setVelocity((dx / d) * 2.5 + this.h.rng.range(-0.5, 0.5), (dy / d) * 2.5);
      }
      this.ring(e.x, e.y, EVENT_INFO.magnet.color, MAG_R);
    }
    if (e.body) this.h.scene.matter.world.remove(e.body);
    e.head?.destroy();
    this.g.clear();
    this.ev = null;
    this.ready.clear();
    this.nextAt = now + this.h.rng.range(EVENT_GAP_MS[0], EVENT_GAP_MS[1]);
  }

  /** 블랙홀·워프 순간이동: 위 또는 아래의 안전한 위치(장애물·다른 공과 겹치지 않음)로. 없으면 취소 */
  private warp(b: EvBall, now: number, e: Active): void {
    const { rng, W, WALL, R, yMin, yMax, balls } = this.h;
    const fromX = b.go.x, fromY = b.go.y;
    let dir = rng.next() < 0.5 ? -1 : 1;
    for (let k = 0; k < 16; k++) {
      let y = fromY + dir * rng.range(250, 550);
      if (y < yMin || y > yMax) { dir = -dir; y = Math.max(yMin, Math.min(yMax, fromY + dir * rng.range(250, 550))); }
      if (Math.abs(y - fromY) < 150) continue;
      const x = rng.range(WALL + 40, W - WALL - 40);
      if (!this.free(x, y, R + 16, R + 16)) continue;
      if (balls.some((o) => o !== b && !o.removed && Math.abs(o.go.y - y) < 60 && (o.go.x - x) ** 2 + (o.go.y - y) ** 2 < (R * 2 + 16) ** 2)) continue;
      if (this.h.teleport(b, fromX, fromY, x, y, EVENT_INFO[e.kind].color)) {
        this.ready.set(b.spec.id, now + 1500); // 재진입 방지
        this.stats.warps++;
        this.stats.hits[e.kind] = (this.stats.hits[e.kind] ?? 0) + 1;
        return;
      }
    }
    this.ready.set(b.spec.id, now + 500); // 안전한 위치 없음 → 이동 취소 (잠시 뒤 재시도)
    this.stats.warpCancel++;
  }

  private blastFx(e: Active): void {
    this.ring(e.x, e.y, EVENT_INFO.bomb.color, BOMB_R);
    const f = this.h.scene.add.circle(e.x, e.y, BOMB_R * 0.6, 0xfff1b8, 0.85).setDepth(7);
    this.h.scene.tweens.add({ targets: f, alpha: 0, scale: 1.4, duration: 260, onComplete: () => f.destroy() });
  }

  private ring(x: number, y: number, color: number, r: number): void {
    const c = this.h.scene.add.circle(x, y, 10).setStrokeStyle(5, color).setDepth(7);
    this.h.scene.tweens.add({ targets: c, radius: r, alpha: 0, duration: 450, onComplete: () => c.destroy() });
  }
}
