// 결승 입구 역전 충격파: 마지막(결승) 입구 위 깔때기에 공이 몰려 정체되면 충전 → 충격파로 대기 줄을 흩뜨려 도착 순서를 다시 섞음
// - 결승 입구에서만 동작 (다른 구간 없음). 점수·결과 계산은 건드리지 않음: 공의 속도만 바꿈
// - 판정은 일정 주기(SCAN_STEPS 스텝)마다 입구 주변 공만 집계, 충격파는 발동 순간 1회만 계산
// - 입구(세로 통로)를 이미 지난 공·완주 공은 대상 아님
// 모든 시간은 게임 내 시간(ms, 고정 스텝 누적) → 배속과 무관. 속도 단위: px/스텝
import Phaser from 'phaser';
import type { Rng } from '../game/rng';

// ───── 정체 감지 ─────
const SCAN_STEPS = 6;          // 6스텝(=100ms)마다 집계
const ZONE_H = 220;            // 입구 위 감지 높이: 45° 깔때기 안 (회전 막대 최저점 아래쪽 ~ 입구)
const FILL_MIN = 0.3;          // 감지 구역 면적 대비 공 면적 비율 (공 500개 실측 최대 ≈1.0, 가장자리 공 포함) → 공 지름 26px 기준 약 33개 이상
const SLOW_V = 1.3;            // 구역 안 공 평균 속도(px/스텝)가 이보다 느리면 정체 (자유 낙하 공은 보통 4 이상)
const FLOW_STALL_MS = 1200;    // 또는 이 시간 동안 아무도 결승선을 못 지나감
const HOLD_MS = 2500;          // 밀집+정체가 이만큼 계속되어야 충전 시작 (잠깐 몰렸다 빠지는 경우 제외)
const CHARGE_MS = 1300;        // 충전(경고) 표시 시간 → 그 뒤 발동
// ───── 충격파 ─────
const RANGE_MIN = 170, RANGE_MAX = 300;   // 범위(px): 밀집도에 비례, 상한 300
const POWER_MIN = 7.5, POWER_MAX = 12;    // 중심 최대 속도(px/스텝): 밀집도에 비례, 상한 12 (상승 높이 ≈ v²/0.56 → 최대 약 260px)
const SPEED_CAP = 13;                     // 개별 공 속도 상한 (기존 폭탄 이벤트와 동일) → 판·벽 관통 방지
const JITTER = 0.5;                       // 방향 흔들림(rad) → 여러 방향으로 흩어짐
const FRONT_R = 90;                       // 입구 앞 이 거리 안의 공 = 곧 통과할 공 (2단계 수직 발사 대상)
const KICK_DELAY_MS = 130;                // 2단계: 1단계로 더미가 벌어진 뒤 앞줄 공을 거의 수직으로 발사 → 더미 위로 올라가 뒤로 밀림
// (깔때기에서는 아래에 있는 공부터 빠져나가므로, 맨 아래 공을 위로 보내야 실제로 순서가 뒤집힘)
// ───── 입구 에너지 막: 충격파 직후 잠깐 입구를 닫아 흩어진 공들이 다시 섞인 뒤에 통과 (도착 순서 재추첨) ─────
const LID_DELAY_MS = 200;      // 2단계 발사 뒤 설치 (입구 앞 공이 먼저 튀어 오른 뒤)
const LID_MS = 1500;           // 닫혀 있는 시간 (게임 시간) — 짧게 유지해 진행 정체 없음
const LID_RETRY_MS = 400;      // 막 자리에 공이 걸쳐 있으면 이 시간까지 재시도, 그래도 막혀 있으면 이번 회차 생략 (공 겹침·끼임 방지)
const LID_W_PAD = 30, LID_H = 10, LID_UP = 8; // 폭 = 입구 폭+30 (양쪽 깔때기 판에 걸침), 두께 10, 입구 위 8px
// ───── 연속 발동 방지 ─────
const COOLDOWN_MS = 9000;      // 발동 후 최소 대기
const COOLDOWN_STEP_MS = 2500; // 발동할 때마다 대기 시간 증가 (줄이 계속 길어도 점점 드물게)
const MAX_BURSTS = 6;          // 경기당 최대 발동 횟수 → 모든 공이 결국 통과

export interface GbBall {
  go: { x: number; y: number; body: MatterJS.BodyType; setVelocity(x: number, y?: number): unknown };
  removed: boolean;
  record: { finishTime: number | null };
}
export interface GbHost {
  scene: Phaser.Scene; rng: Rng; balls: GbBall[];
  W: number; R: number; gateY: number; gap: number; viewW: number;
  wake(b: GbBall): void;
  /** QA 전용(개발 환경): true면 판정·기록만 하고 실제 충격파·막은 적용하지 않음 (효과 비교용 대조군) */
  dry?: boolean;
}
interface Sample { n: number; fill: number; avgV: number }

export class GateBurst {
  private steps = 0;
  private congested = 0;       // 밀집+정체 누적 시간(ms)
  private readyAt = 0;
  private chargeAt = -1;       // 충전 시작 시각 (-1: 충전 아님)
  private stopped = false;
  private lid: MatterJS.BodyType | null = null;
  private lidAt = -1;          // 막 설치 예정 시각 (-1: 없음)
  private lidUntil = 0;
  private kick: GbBall[] = [];  // 2단계 발사 대상 (앞줄 공)
  private kickAt = -1;
  private kickPower = 0;
  private readonly area: number;
  private g: Phaser.GameObjects.Graphics;
  private banner: Phaser.GameObjects.Text;
  /** QA·확인용 통계 */
  readonly stats = { bursts: [] as { t: number; n: number; fill: number; avgV: number; range: number; power: number; hit: number }[], peakFill: 0, peakN: 0, scans: 0, lids: 0, lidSkipped: 0, snaps: [] as { base: number; front: GbBall[] }[] };

  constructor(private h: GbHost) {
    this.area = h.gap * ZONE_H + ZONE_H * ZONE_H; // 45° 깔때기 사다리꼴: 아래 폭 gap, 높이 z에서 폭 gap+2z
    this.g = h.scene.add.graphics().setDepth(8);
    this.banner = h.scene.add.text(h.viewW / 2, 128, '', {
      fontFamily: 'Malgun Gothic, sans-serif', fontSize: '28px', fontStyle: 'bold', color: '#ffd166', stroke: '#000000', strokeThickness: 6,
      backgroundColor: 'rgba(20,4,8,0.72)', padding: { x: 16, y: 6 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(30).setAlpha(0);
  }

  /** 감지 구역 안인지: 입구 위 ZONE_H 높이의 45° 깔때기 사다리꼴 */
  private inZone(x: number, y: number): boolean {
    const up = this.h.gateY - y;
    return up >= 0 && up <= ZONE_H && Math.abs(x - this.h.W / 2) <= this.h.gap / 2 + up;
  }

  /** 입구(세로 통로)를 이미 지난 공: 충격파 대상 아님 */
  private passed(b: GbBall): boolean { return b.go.y >= this.h.gateY - 2 && Math.abs(b.go.x - this.h.W / 2) <= this.h.gap / 2 + 2; }

  private sample(): Sample {
    let n = 0, sv = 0;
    for (const b of this.h.balls) {
      if (b.removed || b.record.finishTime !== null || !this.inZone(b.go.x, b.go.y)) continue;
      const v = b.go.body.velocity;
      n++; sv += Math.hypot(v.x, v.y);
    }
    return { n, fill: (n * Math.PI * this.h.R * this.h.R) / this.area, avgV: n ? sv / n : 0 };
  }

  /** 2단계: 앞줄 공을 거의 수직으로 발사 (이미 통과·완주한 공 제외) */
  private kickFront(): void {
    const { rng } = this.h;
    for (const b of this.kick) {
      if (b.removed || b.record.finishTime !== null || this.passed(b)) continue;
      const a = -Math.PI / 2 + rng.range(-0.35, 0.35), sp = Math.min(SPEED_CAP, this.kickPower * rng.range(0.95, 1.1));
      this.h.wake(b);
      b.go.setVelocity(Math.cos(a) * sp, Math.sin(a) * sp);
    }
    this.kick = []; this.kickAt = -1;
  }

  /** 입구 에너지 막 설치·해제 */
  private lidStep(now: number): void {
    const { scene, W, gateY, gap, R } = this.h;
    if (this.lid && now >= this.lidUntil) { scene.matter.world.remove(this.lid); this.lid = null; }
    if (this.lidAt < 0 || now < this.lidAt) return;
    const ly = gateY - LID_UP, hw = (gap + LID_W_PAD) / 2;
    const blocked = this.h.balls.some((b) => !b.removed && b.record.finishTime === null && Math.abs(b.go.y - ly) < LID_H / 2 + R && Math.abs(b.go.x - W / 2) < hw + R);
    if (blocked) { if (now - this.lidAt > LID_RETRY_MS) { this.lidAt = -1; this.stats.lidSkipped++; } return; }
    this.lid = scene.matter.add.rectangle(W / 2, ly, hw * 2, LID_H, { isStatic: true, restitution: 0.1, friction: 0.01 }) as unknown as MatterJS.BodyType;
    this.lidUntil = now + LID_MS;
    this.lidAt = -1;
    this.stats.lids++;
  }

  /** 고정 스텝마다 1회 (씬의 공 반복이 끝난 뒤). lastPass: 마지막 완주 시각 */
  step(now: number, lastPass: number): void {
    if (this.stopped) return;
    this.lidStep(now);
    if (this.kickAt >= 0 && now >= this.kickAt) this.kickFront();
    if (this.chargeAt >= 0) { if (now - this.chargeAt >= CHARGE_MS) this.fire(now); return; }
    if (++this.steps < SCAN_STEPS) return;
    this.steps = 0;
    const s = this.sample();
    this.stats.scans++;
    if (s.fill > this.stats.peakFill) { this.stats.peakFill = s.fill; this.stats.peakN = s.n; }
    const jam = s.fill >= FILL_MIN && (s.avgV < SLOW_V || now - lastPass > FLOW_STALL_MS);
    const dt = SCAN_STEPS * (1000 / 60);
    this.congested = jam ? this.congested + dt : Math.max(0, this.congested - dt * 2); // 풀리면 빠르게 감소
    if (now < this.readyAt || this.stats.bursts.length >= MAX_BURSTS) return;
    if (this.congested >= HOLD_MS) {
      this.chargeAt = now;
      this.say('⚡ 역전 충격파 충전 중!', '#ffd166');
    }
  }

  private fire(now: number): void {
    this.chargeAt = -1;
    const s = this.sample(); // 발동 순간 밀집도로 범위·힘 결정
    const k = Phaser.Math.Clamp((s.fill - FILL_MIN) / (0.8 - FILL_MIN), 0, 1);
    const range = RANGE_MIN + (RANGE_MAX - RANGE_MIN) * k;
    const power = POWER_MIN + (POWER_MAX - POWER_MIN) * k;
    const { W, gateY, rng } = this.h, cx = W / 2, cy = gateY + 8; // 중심: 입구 바로 아래 → 공은 위·바깥(깔때기 위쪽)으로 흩어짐
    let hit = 0, done = 0;
    const cand: { b: GbBall; d: number }[] = []; // 기록용: 입구에 가까운 순 (= 원래 곧 도착할 공)
    this.kick = [];
    for (const b of this.h.balls) {
      if (b.record.finishTime !== null) { done++; continue; }
      if (b.removed || this.passed(b)) continue;
      const dx = b.go.x - cx, dy = b.go.y - cy;
      if (dy < -range || dy > 0) continue;
      const d = Math.hypot(dx, dy);
      if (d > range || d < 1) continue;
      cand.push({ b, d });
      if (this.h.dry) continue;
      let a: number, sp: number;
      if (d < FRONT_R) {
        // 1단계: 앞줄 공은 위로 살짝만 (2단계에서 수직 발사)
        a = -Math.PI / 2 + rng.range(-0.3, 0.3);
        sp = power * 0.3;
        this.kick.push(b);
      } else {
        // 나머지: 바깥(먼) 공일수록 빠르게 → 더미가 압축되지 않고 팽창하며 위·옆으로 흩어짐
        a = Math.atan2(dy, dx) + rng.range(-JITTER, JITTER);
        sp = power * (0.55 + 0.45 * (d / range)) * rng.range(0.65, 1.15);
      }
      a = Math.min(-0.25, Math.max(-Math.PI + 0.25, a)); // 항상 위쪽 성분 (판 아래로 파고들지 않게)
      sp = Math.min(SPEED_CAP, sp);
      this.h.wake(b);
      b.go.setVelocity(Math.cos(a) * sp, Math.sin(a) * sp);
      hit++;
    }
    this.stats.snaps.push({ base: done, front: cand.sort((p, q) => p.d - q.d).slice(0, 10).map((c) => c.b) });
    this.stats.bursts.push({ t: Math.round(now), n: s.n, fill: +s.fill.toFixed(3), avgV: +s.avgV.toFixed(2), range: Math.round(range), power: +power.toFixed(2), hit });
    this.congested = 0;
    this.readyAt = now + COOLDOWN_MS + COOLDOWN_STEP_MS * (this.stats.bursts.length - 1);
    if (this.h.dry) return;
    this.kickPower = power;
    this.kickAt = now + KICK_DELAY_MS;
    this.lidAt = now + LID_DELAY_MS;
    this.burstFx(cx, gateY, range);
    this.say('💥 역전 충격파!', '#ff5a36');
  }

  /** 매 프레임: 충전 표시 (그래픽 1개만 사용) */
  draw(now: number): void {
    const g = this.g; g.clear();
    if (this.lid) { // 입구 에너지 막 (깜박임 → 열리기 직전 빠르게)
      const left = (this.lidUntil - now) / LID_MS, blink = 0.5 + 0.5 * Math.sin((now / 1000) * (left < 0.3 ? 40 : 12));
      const hw = (this.h.gap + LID_W_PAD) / 2, ly = this.h.gateY - LID_UP;
      g.fillStyle(0x7ff3ff, 0.45 + 0.45 * blink).fillRect(this.h.W / 2 - hw, ly - LID_H / 2, hw * 2, LID_H)
        .lineStyle(2, 0xffffff, 0.9).strokeRect(this.h.W / 2 - hw, ly - LID_H / 2, hw * 2, LID_H);
    }
    if (this.chargeAt < 0) return;
    const p = Phaser.Math.Clamp((now - this.chargeAt) / CHARGE_MS, 0, 1);
    const { W, gateY } = this.h, cx = W / 2, cy = gateY - 10;
    const pulse = 0.5 + 0.5 * Math.sin((now / 1000) * (10 + 20 * p));
    const r0 = RANGE_MIN + (RANGE_MAX - RANGE_MIN) * 0.5;
    g.fillStyle(0xff5a36, 0.08 + 0.12 * p * pulse).fillCircle(cx, cy, r0 * (1 - 0.7 * p))         // 수축하는 경고 원
      .lineStyle(4, 0xffd166, 0.5 + 0.5 * pulse).strokeCircle(cx, cy, r0 * (1 - 0.7 * p))
      .fillStyle(0xfff1b8, 0.6 + 0.4 * pulse).fillCircle(cx, cy, 8 + 18 * p);                     // 커지는 에너지 핵
    for (let i = 0; i < 8; i++) { // 중심으로 모이는 에너지 줄기
      const t = (i * Math.PI) / 4 + now / 400, r1 = r0 * (1 - p) + 30, r2 = r1 - 26;
      g.lineStyle(3, 0xffd166, 0.9).lineBetween(cx + Math.cos(t) * r1, cy + Math.sin(t) * r1, cx + Math.cos(t) * r2, cy + Math.sin(t) * r2);
    }
  }

  /** 경기 종료: 표시 정리, 이후 발동 없음 */
  stop(): void {
    this.stopped = true; this.chargeAt = -1; this.lidAt = -1; this.kickAt = -1; this.kick = []; this.g.clear();
    if (this.lid) { this.h.scene.matter.world.remove(this.lid); this.lid = null; }
  }

  private burstFx(x: number, y: number, range: number): void {
    const sc = this.h.scene;
    const flash = sc.add.circle(x, y, range * 0.45, 0xfff1b8, 0.85).setDepth(8);
    sc.tweens.add({ targets: flash, alpha: 0, scale: 1.8, duration: 320, onComplete: () => flash.destroy() });
    [[0xffffff, 8, 0, 420], [0xff5a36, 6, 90, 560], [0xffd166, 4, 180, 700]].forEach(([c, w, delay, dur]) => {
      const ring = sc.add.circle(x, y, 16).setStrokeStyle(w, c).setDepth(8);
      sc.tweens.add({ targets: ring, radius: range, alpha: 0, delay, duration: dur, onComplete: () => ring.destroy() });
    });
    sc.cameras.main.shake(260, 0.006);
  }

  private say(text: string, color: string): void {
    const sc = this.h.scene;
    sc.tweens.killTweensOf(this.banner);
    this.banner.setText(text).setColor(color).setAlpha(1);
    sc.tweens.add({ targets: this.banner, alpha: 0, delay: 1100, duration: 300 });
  }
}
