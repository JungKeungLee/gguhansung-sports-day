// 핀볼 구슬 고유 스킬 5종: 공마다 1개 무작위 고정, 게임 시간 기준 10초마다 자동 발동 (사용자 조작 없음)
// - 전용 난수(배정·발동) → 기존 물리·랜덤 이벤트 난수 흐름과 분리
// - 별도 타이머 없음: 씬의 고정 스텝 공 반복문에서 공마다 step() 호출
// - 결승 깔때기·회전 막대·입구·판정 통로(noSkillY 아래)에서는 발동 안 함, 휴면 공은 그 회차 건너뜀(깨우지 않음)
import Phaser from 'phaser';
import { Rng } from '../game/rng';

export type SkillKind = 'boost' | 'shield' | 'dash' | 'rewind' | 'push'; // 방향 전환(swerve)은 제거 → 결승 입구 역전 이벤트로 대체
export const SKILL_KINDS: SkillKind[] = ['boost', 'shield', 'dash', 'rewind', 'push'];
export const SKILL_INFO: Record<SkillKind, { label: string; color: number }> = {
  boost: { label: '급가속', color: 0xffd23f },
  shield: { label: '충격 보호', color: 0x4fc3f7 },
  dash: { label: '중력 돌진', color: 0xff4d4d },
  rewind: { label: '역주행', color: 0xb36bff },
  push: { label: '밀쳐내기', color: 0xff9f1c },
};
export const SKILL_COOLDOWN = 10000;   // 재사용 대기 (게임 시간 ms)
const DUR: Record<SkillKind, number> = { boost: 2000, shield: 2000, dash: 500, rewind: 0, push: 0 };
// 밀쳐내기 충격파: 반지름 85→95, 힘 (1 + 2.5·근접도) → (1.4 + 3.5·근접도) (+40%), 속도 상한 8→11
// 상한 11px/스텝 < 공 지름+가장 얇은 판(26+8) → 벽·판 관통 없음 (기존 폭탄 이벤트 상한 13과 같은 범위)
const PUSH_R = 95, PUSH_BASE = 1.4, PUSH_GAIN = 3.5, PUSH_CAP = 11, PUSH_JITTER = 0.3; // 방향 흔들림(rad): 한 방향으로만 밀리지 않고 퍼지게
const FX_MAX = 24;                     // 동시에 그리는 효과 상한 (판정은 누락 없음)
const TEXT_POOL = 8;                   // 스킬 이름 표시 상한

export interface SkillState { kind: SkillKind; next: number; until: number }

/** 스킬 배정: 참가 순서(spec 순) 기준 → 공 섞기·출발 배치와 무관하게 고정. forced: QA용 전부 같은 스킬 */
export function assignSkills(n: number, seed: number, forced: SkillKind | null = null): SkillState[] {
  const rng = new Rng((seed ^ 0x27d4eb2f) >>> 0);
  return Array.from({ length: n }, () => {
    const kind = SKILL_KINDS[rng.int(SKILL_KINDS.length)];
    return { kind: forced ?? kind, next: rng.range(0, SKILL_COOLDOWN), until: 0 }; // 첫 발동 0~10초 분산
  });
}

export interface SkBall {
  go: { x: number; y: number; body: MatterJS.BodyType; setVelocity(x: number, y?: number): unknown };
  removed: boolean;
  record: { finishTime: number | null; label: string };
  skill: SkillState;
}
export interface SkHost { scene: Phaser.Scene; balls: SkBall[]; seed: number; H: number; R: number; noSkillY: number; rewindMaxY: number; viewH: number }
interface Fx { b: SkBall; kind: SkillKind; t0: number; dur: number }

export class PinballSkills {
  private rng: Rng;
  private g: Phaser.GameObjects.Graphics;
  private texts: { t: Phaser.GameObjects.Text; until: number; b: SkBall | null }[] = [];
  private fx: Fx[] = [];
  private buckets: SkBall[][] = [];     // 지난 스텝의 y 100px 단위 공 위치 (밀쳐내기 주변 탐색용)
  private building: SkBall[][] = [];
  private tip: Phaser.GameObjects.Text;
  /** QA·확인용 통계 */
  readonly stats = { fired: {} as Partial<Record<SkillKind, number>>, skipSleep: 0, skipZone: 0, pushed: 0, firstFires: [] as number[], blocked: 0 };

  constructor(private h: SkHost) {
    this.rng = new Rng((h.seed ^ 0x165667b1) >>> 0);
    const nb = Math.ceil(h.H / 100) + 1;
    for (let i = 0; i < nb; i++) { this.buckets.push([]); this.building.push([]); }
    this.g = h.scene.add.graphics().setDepth(5);
    for (let i = 0; i < TEXT_POOL; i++) {
      this.texts.push({ t: h.scene.add.text(0, 0, '', { fontFamily: 'Malgun Gothic, sans-serif', fontSize: '11px', fontStyle: 'bold', color: '#ffffff', stroke: '#000000', strokeThickness: 3 }).setOrigin(0.5, 0).setDepth(6).setVisible(false), until: 0, b: null });
    }
    // 마우스를 올리면 그 구슬의 고정 스킬 표시 (0.1초 간격)
    this.tip = h.scene.add.text(0, 0, '', { fontFamily: 'Malgun Gothic, sans-serif', fontSize: '13px', fontStyle: 'bold', color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.75)', padding: { x: 6, y: 3 } }).setOrigin(0.5, 1).setDepth(25).setVisible(false);
    let last = 0;
    h.scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const now = performance.now(); if (now - last < 100) return; last = now;
      const hit = this.ballAt(p.worldX, p.worldY);
      if (!hit) { this.tip.setVisible(false); return; }
      const info = SKILL_INFO[hit.skill.kind];
      this.tip.setText(`${hit.record.label} · ${info.label}`).setColor(`#${info.color.toString(16).padStart(6, '0')}`).setPosition(hit.go.x, hit.go.y - h.R - 20).setVisible(true);
    });
    h.scene.input.on('gameout', () => this.tip.setVisible(false));
  }

  private ballAt(x: number, y: number): SkBall | null {
    const r2 = (this.h.R + 4) ** 2;
    for (const b of this.h.balls) if (!b.removed && (b.go.x - x) ** 2 + (b.go.y - y) ** 2 < r2) return b;
    return null;
  }

  /** 충격 보호 중인지 (랜덤 이벤트에서 사용) */
  shielded(b: SkBall, now: number): boolean { return b.skill.kind === 'shield' && b.skill.until > now; }

  /** 스텝 시작: 주변 탐색 버킷 교체 */
  beginStep(): void {
    const t = this.buckets; this.buckets = this.building; this.building = t;
    for (const a of this.building) a.length = 0;
  }

  /** 공 1개 처리 (씬의 기존 공 반복문 안에서 호출) */
  step(b: SkBall, now: number): void {
    if (b.removed || b.record.finishTime !== null) return;
    const s = b.skill, { x, y } = b.go;
    this.building[Math.max(0, Math.floor(y / 100))]?.push(b);
    const inZone = y >= this.h.noSkillY;
    if (inZone && s.until > now) s.until = 0; // 결승 구역 진입 시 지속 효과 즉시 종료
    // 지속 효과
    if (s.until > now) {
      const v = b.go.body.velocity;
      if (s.kind === 'boost' && v.y < 9) this.set(b, v.x, Math.min(9, v.y + 0.25), 9);
      else if (s.kind === 'dash' && v.y < 12) this.set(b, v.x, Math.min(12, v.y + 0.8), 12);
    }
    if (now < s.next) return;
    // 발동 시점: 휴면·결승 구역이면 이번 회차 건너뜀(쿨타임 위상 유지)
    const skip = b.go.body.isSleeping ? 'skipSleep' : inZone || (s.kind === 'rewind' && y > this.h.rewindMaxY) ? 'skipZone' : null;
    const first = s.next < SKILL_COOLDOWN;
    s.next += SKILL_COOLDOWN;
    if (s.next <= now) s.next = now + SKILL_COOLDOWN;
    if (skip) { this.stats[skip]++; return; }
    if (first) this.stats.firstFires.push(Math.round(now));
    this.fire(b, now, x, y);
  }

  private fire(b: SkBall, now: number, x: number, y: number): void {
    const s = b.skill, v = b.go.body.velocity;
    s.until = now + DUR[s.kind];
    this.stats.fired[s.kind] = (this.stats.fired[s.kind] ?? 0) + 1;
    if (s.kind === 'rewind') this.set(b, v.x * 0.5, -this.rng.range(10.5, 13.9), 14); // 상승 약 200~350px (중력 0.28px/스텝²)
    if (s.kind === 'push') {
      const R2 = PUSH_R * PUSH_R;
      for (let k = Math.floor((y - PUSH_R) / 100); k <= Math.floor((y + PUSH_R) / 100); k++) {
        for (const o of this.buckets[k] ?? []) {
          if (o === b || o.removed || o.record.finishTime !== null || o.go.body.isSleeping) continue; // 자기 자신·완주·휴면 제외
          const dx = o.go.x - x, dy = o.go.y - y, d2 = dx * dx + dy * dy;
          if (d2 >= R2 || d2 < 1) continue;
          // 중심에서 바깥으로 + 공마다 방향(±0.3rad)·세기(±15%) 흔들림 → 자연스럽게 방사형으로 퍼짐
          const d = Math.sqrt(d2), f = (PUSH_BASE + PUSH_GAIN * (1 - d / PUSH_R)) * this.rng.range(0.85, 1.15), ov = o.go.body.velocity;
          const a = Math.atan2(dy, dx) + this.rng.range(-PUSH_JITTER, PUSH_JITTER);
          this.set(o, ov.x + Math.cos(a) * f, ov.y + Math.sin(a) * f, PUSH_CAP);
          this.stats.pushed++;
        }
      }
    }
    // 시각 효과: 화면 안 공만, 상한 초과 시 표시만 생략
    const cam = this.h.scene.cameras.main;
    if (y < cam.scrollY - 40 || y > cam.scrollY + this.h.viewH + 40) return;
    if (this.fx.length < FX_MAX) this.fx.push({ b, kind: s.kind, t0: now, dur: Math.max(600, DUR[s.kind]) });
    const slot = this.texts.find((t) => t.until <= now);
    if (slot) { slot.until = now + 800; slot.b = b; slot.t.setText(SKILL_INFO[s.kind].label).setColor(`#${SKILL_INFO[s.kind].color.toString(16).padStart(6, '0')}`).setVisible(true); }
  }

  private set(b: SkBall, vx: number, vy: number, cap: number): void {
    const sp = Math.hypot(vx, vy);
    if (sp > cap) { vx = (vx / sp) * cap; vy = (vy / sp) * cap; }
    b.go.setVelocity(vx, vy);
  }

  /** 매 프레임: 효과·스킬 이름 (게임 시간 기준) */
  draw(now: number): void {
    const g = this.g; g.clear();
    const R = this.h.R;
    this.fx = this.fx.filter((f) => now - f.t0 < f.dur && !f.b.removed);
    for (const f of this.fx) {
      const { x, y } = f.b.go, p = (now - f.t0) / f.dur, a = 1 - p, c = SKILL_INFO[f.kind].color;
      switch (f.kind) {
        case 'boost': for (const dx of [-7, 0, 7]) g.lineStyle(2, c, a).lineBetween(x + dx, y - R - 4, x + dx, y - R - 16); break;
        case 'shield': g.lineStyle(3, c, 0.4 + 0.5 * a).strokeCircle(x, y, R + 5).fillStyle(c, 0.12).fillCircle(x, y, R + 5); break;
        case 'dash': g.fillStyle(c, a).fillTriangle(x - 8, y + R + 3, x + 8, y + R + 3, x, y + R + 15); break;
        case 'rewind': g.lineStyle(3, c, a).lineBetween(x - 8, y + R + 6 + p * 10, x, y + R - 2 + p * 10).lineBetween(x, y + R - 2 + p * 10, x + 8, y + R + 6 + p * 10); break;
        case 'push': { // 충격파: 채운 원 + 두꺼운 고리 + 뒤따르는 고리 + 방사선 8줄
          const e = 1 - (1 - p) * (1 - p), rr = R + (PUSH_R - R) * e; // 빠르게 퍼졌다가 감속
          g.fillStyle(c, 0.22 * a).fillCircle(x, y, rr).lineStyle(5, c, a).strokeCircle(x, y, rr).lineStyle(2, 0xffffff, 0.8 * a).strokeCircle(x, y, rr * 0.7);
          for (let k = 0; k < 8; k++) { const t = (k * Math.PI) / 4; g.lineStyle(2, 0xfff1b8, a).lineBetween(x + Math.cos(t) * rr * 0.75, y + Math.sin(t) * rr * 0.75, x + Math.cos(t) * (rr + 10), y + Math.sin(t) * (rr + 10)); }
          break;
        }
      }
    }
    for (const t of this.texts) {
      if (!t.b || t.until <= now || t.b.removed) { if (t.t.visible) t.t.setVisible(false); t.b = null; continue; }
      t.t.setPosition(t.b.go.x, t.b.go.y + R + 2); // 닉네임(공 위)과 겹치지 않게 공 아래
    }
  }
}
