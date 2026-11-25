// 경기 렌더링 (Phaser). 시뮬레이션(Race)은 고정 간격으로 진행하고 화면은 보간만 담당
import Phaser from 'phaser';
import type { Race } from '../game/sim/race';
import {
  EFFECT_IMAGES, type EffectName, GATE_IMAGES, OBSTACLE_IMAGES, finishKind, isFlipped, POSES, type Pose, STADIUM, type StadiumTheme, assetUrl, imageUrl,
} from '../game/images';
import type { CharId, FxKey, Obstacle, ObstacleType, PublicRunner, RaceEvent } from '../game/types';

export const VIEW_W = 1500;
export const VIEW_H = 740;
const PXM = 36;               // 1m 당 픽셀
const START_X = 150;
const STANDS_H = 172;         // 관중석(배경 이미지 상단부) 높이
const TRACK_Y = 184;
const TRACK_AREA = 500;
const MAX_FX = 28;            // 동시에 표시되는 이벤트 이펙트 상한 (화면 가림 방지)

/** 배경 이미지 트랙 색과 어울리는 레인 색 */
const TRACK_THEME: Record<StadiumTheme, { base: number; alt: number; edge: number; line: number; sky: string }> = {
  day: { base: 0xdd7466, alt: 0xd56b5c, edge: 0xc96151, line: 0xffffff, sky: '#8fd3ff' },
  night: { base: 0x8a161a, alt: 0x7d1115, edge: 0x5e0b0e, line: 0xf7c9c9, sky: '#1a080b' },
};
/** 스킬 연출 키 → 공통 이펙트 이미지 */
const FX_IMAGE: Record<FxKey, EffectName> = {
  cola: 'burst', moon: 'teleport', wave: 'wave', cat: 'heart', aim: 'impact', trap: 'impact', thunder: 'lightning',
  ball: 'wind', brain: 'shield', star: 'heart', shield: 'shield', dash: 'speedlines', generic: 'speed',
};

const FX_COLOR: Record<FxKey, number> = {
  cola: 0xe53935, moon: 0xb39ddb, wave: 0x4fc3f7, cat: 0xffb74d, aim: 0x00e5a0, trap: 0xab47bc,
  thunder: 0xffd600, ball: 0xffffff, brain: 0x90a4ae, star: 0xff80c0, shield: 0x80deea, dash: 0xffffff, generic: 0xffffff,
};
const HIT_TEXT: Record<ObstacleType, string> = { banana: '미끌!', pit: '쿵!', rock: '퍽!', gust: '휘잉~', zone: '끈적..' };

export interface SceneHooks {
  onCountdown(n: number): void;
  onEvents(events: RaceEvent[]): void;
  onSnapshot(pub: PublicRunner[], t: number, finishLine: number): void;
  onDone(): void;
  getSpeed(): number;
}

interface RunnerView {
  root: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Container;
  legs: Phaser.GameObjects.Graphics;
  fx: Phaser.GameObjects.Graphics;
  name: Phaser.GameObjects.Text;
  badge: Phaser.GameObjects.Text;
  color: number;
  phase: number;
  extra: number;              // 완주 후 관성 이동 (시각 전용)
  auraUntil: number;
  auraColor: number;
  img: Phaser.GameObjects.Image | null;   // 실제 이미지 (없으면 임시 캐릭터)
  pose: Pose;
  tempPose: Pose | null;
  tempUntil: number;
  lines: Phaser.GameObjects.Image | null;   // 속도선 (가속 중)
  shield: Phaser.GameObjects.Image | null;  // 보호막 (면역 중)
  dizzy: Phaser.GameObjects.Image | null;   // 혼란
}

const hex = (c: string) => Phaser.Display.Color.HexStringToColor(c).color;
const xOf = (m: number) => START_X + m * PXM;
const texKey = (id: CharId, pose: Pose) => `char_${id}_${pose}`;

export class RaceScene extends Phaser.Scene {
  private race: Race;
  private hooks: SceneHooks;
  private laneH = 0;
  private trackTop = 0;
  private views: RunnerView[] = [];
  private obViews = new Map<number, Phaser.GameObjects.Container>();
  private finishVis!: Phaser.GameObjects.Container;
  private finishVisM = 0;
  private startGateView: Phaser.GameObjects.Image | Phaser.GameObjects.Text | null = null;
  private trapG!: Phaser.GameObjects.Graphics;
  private edgeG!: Phaser.GameObjects.Graphics;
  private edgeTexts: Phaser.GameObjects.Text[] = [];
  private phaseState: 'countdown' | 'running' | 'ending' | 'done' = 'countdown';
  private cdMs = 3000;
  private lastCount = 4;
  private acc = 0;
  private evCursor = 0;
  private snapTimer = 0;
  private endTimer = 0;
  private bodyR = 20;
  private theme: StadiumTheme;
  private standsTile: Phaser.GameObjects.TileSprite | null = null;
  private grassTile: Phaser.GameObjects.TileSprite | null = null;
  private activeFx = 0;
  private winnerShown = false;

  constructor(race: Race, hooks: SceneHooks, theme: StadiumTheme = 'day') {
    super('race');
    this.race = race;
    this.hooks = hooks;
    this.theme = theme;
  }

  preload(): void {
    // 이미지가 없거나 로드 실패해도 임시 캐릭터로 계속 진행
    this.load.on('loaderror', () => undefined);
    for (const r of this.race.runners) {
      for (const pose of POSES) {
        const url = imageUrl(r.def.id, pose);
        if (url) this.load.image(texKey(r.def.id, pose), url);
      }
    }
    this.load.image('bg', assetUrl(STADIUM[this.theme]));
    this.load.image('gate_start', assetUrl(GATE_IMAGES.start));
    this.load.image('gate_finish', assetUrl(GATE_IMAGES.finish));
    for (const [k, path] of Object.entries(OBSTACLE_IMAGES)) this.load.image(`ob_${k}`, assetUrl(path));
    for (const [k, path] of Object.entries(EFFECT_IMAGES)) if (k !== 'cutin') this.load.image(`fx_${k}`, assetUrl(path));
  }

  private laneY(lane: number): number {
    return this.trackTop + this.laneH * (lane + 0.5);
  }

  /**
   * 큰 원본 이미지를 화면 표시 크기에 맞게 줄여 GPU 텍스처 메모리 절약 (원본 파일은 그대로).
   * 캐릭터 40장(최대 1536px)을 그대로 올리면 약 200MB → 반복 경기 시 WebGL 메모리 부족으로 탭이 충돌할 수 있음
   */
  private shrinkTextures(): void {
    for (const key of this.textures.getTextureKeys()) {
      const max = key.startsWith('char_') ? 320 : key.startsWith('fx_') || key.startsWith('ob_') ? 256 : 0;
      if (!max) continue;
      const src = this.textures.get(key).getSourceImage() as HTMLImageElement;
      const big = Math.max(src.width, src.height);
      if (!big || big <= max) continue;
      const k = max / big;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(src.width * k);
      canvas.height = Math.round(src.height * k);
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
      this.textures.remove(key);
      this.textures.addCanvas(key, canvas);
    }
  }

  create(): void {
    this.shrinkTextures();
    const n = this.race.runners.length;
    this.laneH = Math.min(96, TRACK_AREA / n);
    this.trackTop = TRACK_Y;
    this.bodyR = Math.min(26, this.laneH * 0.34);
    const worldW = xOf(this.race.cfg.maxFinish) + 500;
    this.cameras.main.setBounds(0, 0, worldW, VIEW_H);
    this.cameras.main.setBackgroundColor(TRACK_THEME[this.theme].sky);

    const hasBg = this.textures.exists('bg');
    if (hasBg) this.createStadiumBg(); else this.drawStadium(worldW);
    this.drawTrack(worldW, hasBg);
    this.createObstacles();
    this.trapG = this.add.graphics().setDepth(5);
    this.finishVisM = this.race.finishLine;
    this.finishVis = this.createFinishLine();
    this.race.runners.forEach((r) => this.views.push(this.createRunnerView(r.index)));

    this.edgeG = this.add.graphics().setScrollFactor(0).setDepth(50);
    for (let i = 0; i < n; i++) {
      this.edgeTexts.push(this.add.text(0, 0, '', {
        fontFamily: 'Malgun Gothic, sans-serif', fontSize: '13px', color: '#ffffff', fontStyle: 'bold',
      }).setScrollFactor(0).setDepth(51).setOrigin(0, 0.5).setVisible(false));
    }
    this.hooks.onSnapshot(this.race.getPublic(), 0, this.race.finishLine);
  }

  // ───────────── 배경 ─────────────
  /** 경기장 이미지의 관중석(상단)·잔디(하단)만 잘라 가로 반복. 이미지 속 10레인은 쓰지 않고 레인은 인원수에 맞춰 직접 그림 */
  private createStadiumBg(): void {
    const tex = this.textures.get('bg');
    const src = tex.getSourceImage() as HTMLImageElement;
    const W = src.width, H = src.height;
    const standsH = Math.round(H * 0.44);
    const grassY = Math.round(H * 0.905);
    tex.add('stands', 0, 0, 0, W, standsH);
    tex.add('grass', 0, 0, grassY, W, H - grassY);
    const s = STANDS_H / standsH;
    this.standsTile = this.add.tileSprite(0, 0, VIEW_W, STANDS_H, 'bg', 'stands')
      .setOrigin(0).setScrollFactor(0).setDepth(-3).setTileScale(s);
    const gTop = this.trackTop + this.laneH * this.race.runners.length + 6;
    this.grassTile = this.add.tileSprite(0, gTop, VIEW_W, VIEW_H - gTop, 'bg', 'grass')
      .setOrigin(0).setScrollFactor(0).setDepth(-3).setTileScale(0.8);
  }

  /** 배경 타일 스크롤 (관중석은 시차 0.5, 잔디는 트랙과 같은 속도) */
  private scrollBg(): void {
    const sx = this.cameras.main.scrollX;
    if (this.standsTile) this.standsTile.tilePositionX = (sx * 0.5) / this.standsTile.tileScaleX;
    if (this.grassTile) this.grassTile.tilePositionX = sx / this.grassTile.tileScaleX;
  }

  private drawStadium(worldW: number): void {
    const g = this.add.graphics();
    g.fillStyle(0x34495e).fillRect(0, 0, worldW, 104);
    g.fillStyle(0x2c3e50);
    for (let y = 14; y < 104; y += 22) g.fillRect(0, y, worldW, 3);
    const colors = [0xff6b6b, 0xffd93d, 0x6bcB77, 0x4d96ff, 0xff8fab, 0xffffff, 0xc77dff];
    for (let x = 6; x < worldW; x += 13) {
      for (let row = 0; row < 4; row++) {
        if (Math.random() < 0.18) continue;
        g.fillStyle(colors[(x * 7 + row * 13) % colors.length], 0.9);
        g.fillCircle(x + (row % 2) * 6, 22 + row * 22, 4.5);
      }
    }
    g.fillStyle(0xffffff, 0.9).fillRect(0, 104, worldW, 6);
    for (let x = 300; x < worldW; x += 900) {
      const banner = this.add.text(x, 52, '꾸한성 대환장 운동회', {
        fontFamily: 'Malgun Gothic, sans-serif', fontSize: '22px', color: '#ffffff', fontStyle: 'bold',
        backgroundColor: '#e84393', padding: { x: 14, y: 6 },
      }).setOrigin(0.5).setAlpha(0.85);
      banner.setRotation(-0.03);
    }
    this.bake(g, worldW);
  }

  /** 정적 Graphics를 텍스처로 구워 매 프레임 재계산 방지 (성능) */
  private bake(g: Phaser.GameObjects.Graphics, worldW: number): void {
    const CHUNK = 2048;
    for (let x0 = 0; x0 < worldW; x0 += CHUNK) {
      const rt = this.add.renderTexture(x0, 0, Math.min(CHUNK, worldW - x0), VIEW_H).setOrigin(0, 0).setDepth(-1);
      rt.draw(g, -x0, 0);
    }
    g.destroy();
  }

  private drawTrack(worldW: number, hasBg: boolean): void {
    const g = this.add.graphics();
    const top = this.trackTop, h = this.laneH * this.race.runners.length;
    const th = TRACK_THEME[this.theme];
    if (!hasBg) {
      g.fillStyle(0x5cb85c).fillRect(0, STANDS_H, worldW, VIEW_H - STANDS_H);
      g.fillStyle(0x4cae4c);
      for (let x = 0; x < worldW; x += 80) g.fillRect(x, STANDS_H, 40, VIEW_H - STANDS_H);
    }
    g.fillStyle(th.edge).fillRect(0, STANDS_H, worldW, top - STANDS_H);
    g.fillStyle(th.base).fillRect(0, top - 6, worldW, h + 12);
    for (let i = 0; i < this.race.runners.length; i++) {
      if (i % 2) g.fillStyle(th.alt).fillRect(0, top + i * this.laneH, worldW, this.laneH);
    }
    g.lineStyle(2, th.line, 0.85);
    for (let i = 0; i <= this.race.runners.length; i++) g.lineBetween(0, top + i * this.laneH, worldW, top + i * this.laneH);
    // 거리 표시
    for (let m = 10; m <= this.race.cfg.maxFinish; m += 10) {
      g.lineStyle(1, 0xffffff, 0.25).lineBetween(xOf(m), top, xOf(m), top + h);
      this.add.text(xOf(m), top + h + 10, `${m}m`, {
        fontFamily: 'Malgun Gothic, sans-serif', fontSize: '16px', color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0.5, 0).setAlpha(0.9);
    }
    // 출발선
    g.lineStyle(5, 0xffffff, 1).lineBetween(xOf(0), top, xOf(0), top + h);
    const startGate = this.addGate('gate_start', xOf(0));
    this.startGateView = startGate;
    if (!startGate) {
      this.startGateView = this.add.text(xOf(0) - 8, top - 10, 'START', {
        fontFamily: 'Arial Black, sans-serif', fontSize: '15px', color: '#ffffff',
      }).setOrigin(1, 1);
    }
    // 레인 번호
    for (let i = 0; i < this.race.runners.length; i++) {
      this.add.text(18, this.laneY(i), `${i + 1}`, {
        fontFamily: 'Arial Black, sans-serif', fontSize: `${Math.min(26, this.laneH * 0.45)}px`, color: '#ffffff',
      }).setOrigin(0, 0.5).setAlpha(0.6);
    }
    this.bake(g, worldW);
  }

  private createFinishLine(): Phaser.GameObjects.Container {
    const h = this.laneH * this.race.runners.length;
    const c = this.add.container(xOf(this.finishVisM), this.trackTop).setDepth(4);
    const g = this.add.graphics();
    const sq = 8;
    for (let y = 0; y < h; y += sq) {
      for (let k = 0; k < 2; k++) {
        g.fillStyle(((y / sq) + k) % 2 ? 0x111111 : 0xffffff).fillRect(-sq + k * sq, y, sq, sq);
      }
    }
    // 게이트는 체크무늬 판정선(x=0) 바로 위, 트랙 위쪽에 세워 레인 위 캐릭터를 가리지 않음
    const gate = this.addGate('gate_finish', 0, c);
    if (!gate) {
      g.fillStyle(0x7f8c8d).fillRect(-3, -40, 6, 40).fillRect(-3, h, 6, 30);
      g.fillStyle(0xff1744).fillTriangle(3, -40, 38, -30, 3, -20);
    }
    const label = gate
      ? this.add.text(0, -gate.displayHeight * 0.42, `${Math.round(this.finishVisM)}m`, {
        fontFamily: 'Arial Black, Malgun Gothic, sans-serif', fontSize: '22px', color: '#ffd54f',
        stroke: '#3a0a0a', strokeThickness: 6,
      }).setOrigin(0.5)
      : this.add.text(0, -46, `FINISH ${Math.round(this.finishVisM)}m`, {
        fontFamily: 'Arial Black, Malgun Gothic, sans-serif', fontSize: '16px', color: '#ffffff',
        backgroundColor: '#d63031', padding: { x: 8, y: 3 },
      }).setOrigin(0.5, 1);
    c.add([g, label]);
    c.setData('label', label);
    c.setData('gate', !!gate);
    return c;
  }

  /** START/FINISH 게이트: 발판이 트랙 위쪽 경계에 닿도록 관중석 영역에 배치 */
  private addGate(key: string, x: number, parent?: Phaser.GameObjects.Container): Phaser.GameObjects.Image | null {
    if (!this.textures.exists(key)) return null;
    const hgt = this.trackTop - 8;
    const img = this.add.image(parent ? 0 : x, parent ? -2 : this.trackTop - 2, key).setOrigin(0.5, 1);
    img.setScale(hgt / img.height).setDepth(4);
    parent?.add(img);
    return img;
  }

  // ───────────── 장애물 ─────────────
  private createObstacles(): void {
    const s = this.laneH / 80;
    for (const lane of this.race.obstaclesByLane) {
      for (const ob of lane) {
        const c = this.add.container(xOf(ob.pos), this.laneY(ob.lane)).setDepth(3);
        const key = `ob_${ob.type}`;
        if (this.textures.exists(key)) {
          const img = this.add.image(0, 0, key);
          if (ob.type === 'zone') img.setOrigin(0, 0.5).setDisplaySize(ob.len * PXM, this.laneH * 0.8);
          else img.setDisplaySize(this.laneH * 0.85, this.laneH * 0.85);
          c.add(img);
        } else c.add(this.drawObstacle(ob, s));
        this.obViews.set(ob.id, c);
      }
    }
  }

  private drawObstacle(ob: Obstacle, s: number): Phaser.GameObjects.GameObject[] {
    const g = this.add.graphics();
    switch (ob.type) {
      case 'banana':
        g.lineStyle(7 * s, 0xffe135).beginPath().arc(0, -6 * s, 14 * s, 0.3, Math.PI - 0.3).strokePath();
        g.fillStyle(0x6d4c41).fillCircle(-12 * s, 0, 2.5 * s);
        break;
      case 'pit':
        g.fillStyle(0x3e2723).fillEllipse(0, 4 * s, 46 * s, 22 * s);
        g.fillStyle(0x1b0f0a).fillEllipse(0, 6 * s, 34 * s, 14 * s);
        break;
      case 'rock':
        g.fillStyle(0x8d8d8d).fillPoints([
          new Phaser.Math.Vector2(-16 * s, 10 * s), new Phaser.Math.Vector2(-12 * s, -8 * s), new Phaser.Math.Vector2(0, -16 * s),
          new Phaser.Math.Vector2(14 * s, -6 * s), new Phaser.Math.Vector2(16 * s, 10 * s),
        ], true);
        g.fillStyle(0xbdbdbd).fillCircle(-3 * s, -6 * s, 4 * s);
        break;
      case 'gust':
        g.lineStyle(3 * s, 0xe0f7fa, 0.95);
        for (let i = 0; i < 3; i++) {
          g.beginPath().arc(0, (i - 1) * 12 * s, 12 * s, Math.PI * 0.2, Math.PI * 1.6).strokePath();
        }
        break;
      case 'zone': {
        const w = ob.len * PXM;
        g.fillStyle(0x7e57c2, 0.45).fillRoundedRect(0, -this.laneH * 0.4, w, this.laneH * 0.8, 8 * s);
        g.lineStyle(2, 0xd1c4e9, 0.8);
        for (let x = 10; x < w; x += 24) g.lineBetween(x, -8 * s, x + 10, 8 * s);
        break;
      }
    }
    return [g];
  }

  // ───────────── 러너 ─────────────
  private createRunnerView(i: number): RunnerView {
    const r = this.race.runners[i];
    const color = hex(r.def.color);
    const R = this.bodyR;
    const root = this.add.container(xOf(0), this.laneY(r.lane)).setDepth(10 + r.lane);
    const shadow = this.add.ellipse(0, R * 0.95, R * 1.8, R * 0.5, 0x000000, 0.25);
    const legs = this.add.graphics();
    const body = this.add.container(0, 0);
    let img: Phaser.GameObjects.Image | null = null;
    if (this.textures.exists(texKey(r.def.id, 'run'))) {
      img = this.add.image(0, -R * 0.2, texKey(r.def.id, 'run')).setFlipX(isFlipped(r.def.id, 'run') !== this.race.reversed);
      this.fitImage(img);
      body.add(img);
    } else {
      const head = this.add.circle(0, -R * 0.3, R, color).setStrokeStyle(3, 0xffffff);
      const eyeL = this.add.circle(R * 0.25, -R * 0.45, R * 0.13, 0x111111);
      const eyeR = this.add.circle(R * 0.6, -R * 0.45, R * 0.13, 0x111111);
      const initial = this.add.text(-R * 0.25, -R * 0.1, r.def.name[0], {
        fontFamily: 'Malgun Gothic, sans-serif', fontSize: `${Math.round(R * 0.85)}px`, color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0.5);
      body.add([head, eyeL, eyeR, initial]);
    }
    const fx = this.add.graphics();
    const sprite = (name: EffectName, x: number, y: number, w: number, h: number, alpha: number) =>
      this.textures.exists(`fx_${name}`)
        ? this.add.image(x, y, `fx_${name}`).setDisplaySize(w, h).setAlpha(alpha).setVisible(false) : null;
    const lines = sprite('speedlines', -R * 1.7, -R * 0.2, R * 3.4, R * 2.2, 0.85);
    const shield = sprite('shield', 0, -R * 0.2, R * 3.4, R * 3.4, 0.6);
    const dizzy = sprite('confusion', 0, -R * 1.9, R * 2, R * 2, 0.95);
    const name = this.add.text(0, img ? -R * 1.75 : -R * 1.45, r.def.name, {
      fontFamily: 'Malgun Gothic, sans-serif', fontSize: `${Math.max(13, Math.round(R * 0.62))}px`, color: '#ffffff',
      fontStyle: 'bold', stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5, 1);
    const badge = this.add.text(R * 1.3, -R * 0.4, '', {
      fontFamily: 'Arial Black, sans-serif', fontSize: `${Math.round(R * 0.8)}px`, color: '#ffd600',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0, 0.5);
    root.add([shadow, ...(lines ? [lines] : []), fx, legs, body, ...(shield ? [shield] : []), ...(dizzy ? [dizzy] : []), name, badge]);
    return { root, body, legs, fx, name, badge, color, phase: Math.random() * 6, extra: 0, auraUntil: 0, auraColor: color, img, pose: 'run', tempPose: null, tempUntil: 0, lines, shield, dizzy };
  }

  private fitImage(img: Phaser.GameObjects.Image): void {
    img.setScale((this.bodyR * 3.2) / Math.max(img.frame.width, img.frame.height));
  }

  /** 포즈 이미지 전환 (해당 포즈가 없으면 run 유지) */
  private applyPose(v: RunnerView, id: CharId, pose: Pose): void {
    if (!v.img || v.pose === pose) return;
    const key = this.textures.exists(texKey(id, pose)) ? texKey(id, pose) : texKey(id, 'run');
    v.pose = pose;
    v.img.setTexture(key);
    v.img.setFlipX(isFlipped(id, key === texKey(id, pose) ? pose : 'run') !== this.race.reversed); // 역주행에서는 캐릭터도 왼쪽을 향함
    this.fitImage(v.img);
  }

  private tempPose(i: number, pose: Pose, ms: number): void {
    const v = this.views[i];
    if (!v.img) return;
    v.tempPose = pose;
    v.tempUntil = this.time.now + ms;
  }

  // ───────────── 루프 ─────────────
  update(_time: number, delta: number): void {
    const race = this.race;
    if (this.phaseState === 'countdown') {
      this.cdMs -= delta;
      const n = Math.max(0, Math.ceil(this.cdMs / 1000));
      if (n !== this.lastCount) {
        this.lastCount = n;
        this.hooks.onCountdown(n);
      }
      if (this.cdMs <= 0) {
        this.phaseState = 'running';
        this.flushEvents();
      }
    } else if (this.phaseState === 'running') {
      this.acc += (Math.min(delta, 250) / 1000) * this.hooks.getSpeed();
      let guard = 0;
      while (this.acc >= race.cfg.dt && !race.done && guard++ < 120) {
        race.step();
        this.acc -= race.cfg.dt;
      }
      this.flushEvents();
      if (race.done) {
        this.phaseState = 'ending';
        this.endTimer = 2200;
      }
    } else if (this.phaseState === 'ending') {
      this.endTimer -= delta;
      if (this.endTimer <= 0) {
        this.phaseState = 'done';
        this.hooks.onDone();
      }
    }

    const pub = race.getPublic();
    const alpha = this.phaseState === 'running' ? Math.min(1, this.acc / race.cfg.dt) : 1;
    this.renderRunners(pub, alpha, delta);
    this.renderTraps();
    this.renderObstacles();
    this.updateCamera(pub, delta);
    this.renderEdges(pub);
    this.scrollBg();

    this.snapTimer -= delta;
    if (this.snapTimer <= 0) {
      this.snapTimer = 100;
      this.hooks.onSnapshot(pub, race.t, race.finishLine);
    }
  }

  private visPos(p: PublicRunner, alpha: number): number {
    return p.prevPos + (p.pos - p.prevPos) * alpha;
  }

  private renderRunners(pub: PublicRunner[], alpha: number, delta: number): void {
    const R = this.bodyR;
    const now = this.time.now;
    for (const p of pub) {
      const v = this.views[p.index];
      if (p.finished) v.extra = Math.min(2.5, v.extra + (delta / 1000) * 2.2 * Math.max(0, 1 - v.extra / 2.5) + 0.002);
      const x = xOf(this.race.physicalPos(this.visPos(p, alpha) + v.extra));
      v.root.setPosition(x, this.laneY(p.lane));
      const running = this.phaseState !== 'countdown' && (!p.finished || v.extra < 2.4);
      const spd = p.finished ? 1.5 : Math.max(0.6, p.speed);
      if (running) v.phase += (delta / 1000) * spd * 4.2;
      const bob = running ? -Math.abs(Math.sin(v.phase)) * R * 0.18 : 0;
      v.body.y = bob;
      v.body.setRotation(p.fallen ? 1.3 : p.confused ? Math.sin(now / 80) * 0.25 : running ? 0.08 : 0);

      // 다리
      v.legs.clear().lineStyle(Math.max(3, R * 0.2), 0x333333);
      const hipY = R * 0.55 + bob;
      const swing = running ? Math.sin(v.phase) * R * 0.55 : 0;
      if (v.img) {
        const pose: Pose = p.finished && p.rank <= 3 ? 'victory' : v.tempPose && v.tempUntil > now ? v.tempPose : 'run';
        this.applyPose(v, p.id, pose);
        v.legs.clear();
      } else if (!p.fallen) {
        v.legs.lineBetween(0, hipY, swing, R * 0.95);
        v.legs.lineBetween(0, hipY, -swing, R * 0.95);
      }

      // 상태 효과
      const g = v.fx.clear();
      if (v.auraUntil > now) {
        const pulse = 0.5 + 0.5 * Math.sin(now / 70);
        g.fillStyle(v.auraColor, 0.25 + pulse * 0.2).fillCircle(0, -R * 0.3 + bob, R * (1.55 + pulse * 0.2));
      }
      v.lines?.setVisible(p.boosted || p.dashing).setX(-R * 1.7 - ((now / 6) % 8));
      v.shield?.setVisible(p.immune).setRotation(now / 900);
      v.dizzy?.setVisible(p.confused).setRotation(now / 160);
      if ((p.boosted || p.dashing) && !v.lines) {
        g.lineStyle(3, 0xffffff, 0.8);
        for (let k = 0; k < 3; k++) {
          const ox = -R * 1.3 - ((now / 3 + k * 37) % 40);
          g.lineBetween(ox, -R * 0.7 + k * R * 0.5, ox - R * (p.dashing ? 2.2 : 1), -R * 0.7 + k * R * 0.5);
        }
      }
      if (p.dashing) {
        for (let k = 1; k <= 4; k++) g.fillStyle(v.color, 0.35 - k * 0.07).fillCircle(-k * R * 0.9, -R * 0.3, R * 0.9);
      }
      if (p.immune && !v.shield) g.lineStyle(3, 0x80deea, 0.9).strokeCircle(0, -R * 0.3 + bob, R * 1.35);
      if (p.slowed && !p.finished) {
        g.fillStyle(0x4fc3f7, 0.9);
        for (let k = 0; k < 2; k++) g.fillCircle(-R * 0.8 + k * R * 1.4, -R * 1.25 + ((now / 12 + k * 20) % 14), R * 0.13);
      }
      if (p.confused && !v.dizzy) {
        g.fillStyle(0xffeb3b, 1);
        for (let k = 0; k < 3; k++) {
          const a = now / 200 + (k * Math.PI * 2) / 3;
          g.fillCircle(Math.cos(a) * R * 0.9, -R * 1.4 + Math.sin(a) * R * 0.3, R * 0.14);
        }
      }
      v.badge.setText(p.finished ? `${p.rank}위` : '');
      v.root.setDepth(10 + p.lane);
    }
  }

  private renderObstacles(): void {
    for (const lane of this.race.obstaclesByLane) {
      for (const ob of lane) {
        const c = this.obViews.get(ob.id)!;
        // 반전 시 장애물은 내부 진행 좌표만 거울 변환. 화면에는 원래 물리 위치에 그대로 보인다.
        const visualPos = this.race.reversed
          ? this.race.physicalPos(ob.pos + (ob.type === 'zone' ? ob.len : 0))
          : ob.pos;
        c.setX(xOf(visualPos));
        const beyond = this.race.reversed
          ? ob.pos >= this.race.finishLine - 0.5 || ob.pos < 0
          : ob.pos >= this.finishVisM - 0.5;
        if (ob.state === 'destroyed' || beyond) { c.setVisible(false); continue; }
        c.setVisible(true);
        if (ob.state === 'hit' && ob.type !== 'zone') c.setAlpha(0.35).setScale(1, 0.6);
        else c.setAlpha(1).setScale(1, 1);
      }
    }
  }

  private renderTraps(): void {
    const g = this.trapG.clear();
    const s = this.laneH / 80;
    for (const tr of this.race.traps) {
      if (tr.done) continue;
      const x = xOf(this.race.physicalPos(tr.pos)), y = this.laneY(tr.lane);
      g.fillStyle(0x6a1b9a, 0.9).fillRect(x - 12 * s, y + 4 * s, 24 * s, 6 * s);
      g.fillStyle(0xe1bee7);
      for (let k = -1; k <= 1; k++) g.fillTriangle(x + k * 8 * s - 4 * s, y + 4 * s, x + k * 8 * s + 4 * s, y + 4 * s, x + k * 8 * s, y - 8 * s);
    }
  }

  private updateCamera(pub: PublicRunner[], delta: number): void {
    const active = pub.filter((p) => !p.finished);
    let focusM: number;
    if (active.length) {
      const sorted = active.map((p) => p.pos).sort((a, b) => b - a);
      const lead = sorted[0];
      const pack = sorted[Math.min(sorted.length - 1, 2)];
      focusM = Math.max(lead - 30, (lead * 2 + pack) / 3); // 선두 그룹 중심
    } else focusM = this.race.finishLine;
    const cam = this.cameras.main;
    const target = xOf(this.race.physicalPos(focusM)) - VIEW_W * 0.6;
    const k = 1 - Math.exp(-delta * 0.004);
    cam.scrollX += (Phaser.Math.Clamp(target, 0, xOf(this.race.cfg.maxFinish) + 500 - VIEW_W) - cam.scrollX) * k;
  }

  /** 화면 밖 캐릭터 위치 표시 */
  private renderEdges(pub: PublicRunner[]): void {
    const g = this.edgeG.clear();
    const cam = this.cameras.main;
    const leadPos = Math.max(...pub.map((p) => p.pos));
    pub.forEach((p, i) => {
      const t = this.edgeTexts[i];
      const sx = xOf(this.race.physicalPos(p.pos)) - cam.scrollX;
      const off = sx < 12 ? 'left' : sx > VIEW_W - 12 ? 'right' : null;
      if (!off) { t.setVisible(false); return; }
      const y = this.laneY(p.lane);
      const label = off === 'left' ? `◀ ${p.name}  -${(leadPos - p.pos).toFixed(1)}m` : `${p.name} ▶`;
      t.setText(label).setVisible(true);
      const w = t.width + 16;
      const x = off === 'left' ? 4 : VIEW_W - 4 - w;
      g.fillStyle(this.views[i].color, 0.92).fillRoundedRect(x, y - 12, w, 24, 8);
      g.lineStyle(2, 0xffffff, 0.9).strokeRoundedRect(x, y - 12, w, 24, 8);
      t.setPosition(x + 8, y);
    });
  }

  // ───────────── 이벤트 연출 ─────────────
  private flushEvents(): void {
    const evs = this.race.events;
    if (this.evCursor >= evs.length) return;
    const batch = evs.slice(this.evCursor);
    this.evCursor = evs.length;
    for (const e of batch) this.fxFor(e);
    this.hooks.onEvents(batch);
  }

  private posOf(i: number): { x: number; y: number } {
    const r = this.race.runners[i];
    return { x: xOf(this.race.physicalPos(r.pos + this.views[i].extra)), y: this.laneY(r.lane) - this.bodyR * 0.3 };
  }

  private fxFor(e: RaceEvent): void {
    const R = this.bodyR;
    switch (e.type) {
      case 'skill': {
        const { x, y } = this.posOf(e.actor!);
        const col = FX_COLOR[e.fx ?? 'generic'];
        this.tempPose(e.actor!, 'skill', 900);
        if (!this.fxImg(FX_IMAGE[e.fx ?? 'generic'], x, y, { size: R * 3.4, dur: 700 })) this.burst(x, y, col, 10, R * 2);
        this.popText(x, y - R * 1.6, `${e.skillName}${e.label ? ` (${e.label})` : ''}`, '#ffffff', 15, col);
        break;
      }
      case 'ult': {
        const { x, y } = this.posOf(e.actor!);
        const col = FX_COLOR[e.fx ?? 'generic'];
        const v = this.views[e.actor!];
        this.tempPose(e.actor!, 'ultimate', 2000);
        v.auraUntil = this.time.now + 4500;
        v.auraColor = col;
        const a = this.fxImg('burst', x, y, { size: R * 6, to: 1.25, dur: 950, force: true });
        const b = this.fxImg(FX_IMAGE[e.fx ?? 'generic'], x, y, { size: R * 4.6, spin: 120, dur: 1200, force: true });
        if (!a && !b) { this.ring(x, y, col, R * 6); this.burst(x, y, col, 26, R * 4); }
        this.popText(x, y - R * 2, `💥 ${e.skillName}!!`, '#fff59d', 22, col);
        this.cameras.main.shake(220, 0.004);
        break;
      }
      case 'obstacleHit': {
        const { x, y } = this.posOf(e.actor!);
        this.popText(x, y - R * 1.4, HIT_TEXT[e.obstacle!], '#ff5252', 16);
        const name: EffectName = e.obstacle === 'gust' ? 'wind' : 'impact';
        if (!this.fxImg(name, x, y + R * 0.3, { size: R * 2.8, dur: 600, dx: e.obstacle === 'gust' ? -R * 2 : 0 })) {
          this.burst(x, y + R * 0.8, 0xd7ccc8, 8, R * 1.5);
        }
        break;
      }
      case 'obstacleDodge':
      case 'obstacleImmune': {
        const { x, y } = this.posOf(e.actor!);
        this.popText(x, y - R * 1.4, e.type === 'obstacleImmune' ? '무시!' : '회피!', '#69f0ae', 14);
        break;
      }
      case 'debuff': {
        const a = this.posOf(e.actor!), b = this.posOf(e.target!);
        this.projectile(a.x, a.y, b.x, b.y, 0xff5252);
        this.time.delayedCall(260, () => {
          this.popText(b.x, b.y - R * 1.4, '감속!', '#4fc3f7', 14);
          this.fxImg('impact', b.x, b.y, { size: R * 2.4, dur: 500 });
        });
        break;
      }
      case 'blocked': {
        const b = this.posOf(e.target!);
        if (!this.fxImg('shield', b.x, b.y, { size: R * 3.2, dur: 650 })) this.ring(b.x, b.y, 0x80deea, R * 2.2);
        this.popText(b.x, b.y - R * 1.4, '막음!', '#80deea', 14);
        break;
      }
      case 'teleport': {
        const r = this.race.runners[e.actor!];
        const y = this.laneY(r.lane) - R * 0.3;
        const ok = this.fxImg('teleport', xOf(this.race.physicalPos(e.from!)), y, { size: R * 3.6, dur: 700, force: true });
        this.fxImg('teleport', xOf(this.race.physicalPos(e.to!)), y, { size: R * 4.2, to: 1.2, spin: -90, dur: 900, force: true });
        if (!ok) { this.ring(xOf(this.race.physicalPos(e.from!)), y, 0xb39ddb, R * 2.5); this.burst(xOf(this.race.physicalPos(e.to!)), y, 0xd1c4e9, 16, R * 2.5); }
        break;
      }
      case 'dash': {
        const { x, y } = this.posOf(e.actor!);
        if (!this.fxImg('speedlines', x, y, { size: R * 5, h: R * 3.3, dx: R * 4, dur: 800, force: true })) this.burst(x, y, 0xffffff, 14, R * 2);
        break;
      }
      case 'push': {
        const b = this.posOf(e.target!);
        if (!this.fxImg('wave', b.x + R, b.y, { size: R * 3.6, dx: -R * 4, dur: 750 })) this.wave(b.x, this.laneY(this.race.runners[e.target!].lane));
        break;
      }
      case 'swap': {
        if (e.label === 'fallback') break;
        const a = this.posOf(e.actor!), b = this.posOf(e.target!);
        if (!this.fxImg('teleport', a.x, a.y, { size: R * 3.6, dur: 800, force: true })) this.ring(a.x, a.y, 0xffd54f, R * 3);
        if (!this.fxImg('teleport', b.x, b.y, { size: R * 3.6, dur: 800, force: true })) this.ring(b.x, b.y, 0xffd54f, R * 3);
        this.popText(a.x, a.y - R * 1.6, '⇄ 위치 교환!', '#ffd54f', 18);
        break;
      }
      case 'trapHit': {
        const b = this.posOf(e.target!);
        this.popText(b.x, b.y - R * 1.4, '함정!', '#ce93d8', 15);
        this.fxImg('impact', b.x, b.y, { size: R * 2.6, dur: 550 });
        break;
      }
      case 'kkuroHit': { // 꾸로의 괴롭힘: 대상마다 효과 구분 (감속=충격, 밀치기=파도, 막음=보호막)
        const b = this.posOf(e.target!);
        if (e.label === 'blocked') {
          if (!this.fxImg('shield', b.x, b.y, { size: R * 3.2, dur: 650 })) this.ring(b.x, b.y, 0x80deea, R * 2.2);
          this.popText(b.x, b.y - R * 1.4, '🛡️ 막음!', '#80deea', 15);
        } else if (e.label === 'push') {
          if (!this.fxImg('wave', b.x + R, b.y, { size: R * 3.6, dx: -R * 3, dur: 750 })) this.wave(b.x, this.laneY(this.race.runners[e.target!].lane));
          this.popText(b.x, b.y - R * 1.4, '💥 밀려남!', '#ff8a80', 16);
        } else {
          this.fxImg('impact', b.x, b.y, { size: R * 2.6, dur: 600 });
          this.popText(b.x, b.y - R * 1.4, '😈 발 묶임!', '#ce93d8', 16);
        }
        break;
      }
      case 'kkuro':
        this.cameras.main.flash(220, 150, 80, 220, false);
        this.cameras.main.shake(300, 0.005);
        break;
      case 'cheer': {
        const { x, y } = this.posOf(e.actor!);
        this.popText(x, y - R * 1.6, '👏 응원 버프!', '#ffeb3b', 16);
        if (!this.fxImg('heart', x, y - R, { size: R * 3, dur: 900 })) this.burst(x, y, 0xffeb3b, 12, R * 2);
        break;
      }
      case 'reverseWorld': {
        // 실제 경기장의 0m가 결승이 되며 기존 START 간판은 숨긴다.
        this.startGateView?.setVisible(false);
        this.finishVisM = 0;
        this.finishVis.x = xOf(0);
        const label = this.finishVis.getData('label') as Phaser.GameObjects.Text;
        label.setText(this.finishVis.getData('gate') ? '0m FINISH' : 'FINISH 0m');
        // 화면에 보이는 모든 캐릭터의 얼굴 방향을 즉시 반전한다.
        for (const v of this.views) if (v.img) v.img.setFlipX(!v.img.flipX);
        this.cameras.main.flash(650, 130, 80, 230, false);
        this.cameras.main.shake(520, 0.01);
        break;
      }
      case 'finishMove': {
        const label = this.finishVis.getData('label') as Phaser.GameObjects.Text;
        this.tweens.addCounter({
          from: e.from!, to: e.to!, duration: 1800, ease: 'Back.easeOut',
          onUpdate: (tw) => {
            this.finishVisM = tw.getValue() ?? e.to!;
            this.finishVis.x = xOf(this.finishVisM);
            label.setText(this.finishVis.getData('gate') ? `${Math.round(this.finishVisM)}m` : `FINISH ${Math.round(this.finishVisM)}m`);
          },
        });
        // 단축(청록)과 연장(주황, 150m는 금색)을 색·문구로 구분
        const kind = finishKind(e.from!, e.to!);
        const col = kind === 'shorten' ? [60, 220, 255] : kind === 'mega' ? [255, 200, 40] : [255, 110, 40];
        this.cameras.main.flash(260, col[0], col[1], col[2], false);
        this.cameras.main.shake(kind === 'mega' ? 600 : 400, kind === 'mega' ? 0.009 : 0.006);
        this.time.delayedCall(900, () => this.popText(
          xOf(e.to!), this.trackTop - 8,
          kind === 'shorten' ? `⚡ ${e.to}m 단축!` : kind === 'mega' ? `💥 ${e.to}m 대연장!` : `🔥 ${e.to}m 연장!`,
          kind === 'shorten' ? '#7ff3ff' : '#ffd54f', 26,
        ));
        break;
      }
      case 'finish': {
        const r = this.race.runners[e.actor!];
        this.burst(xOf(this.race.physicalPos(this.race.finishLine)), this.laneY(r.lane), 0xffd600, 18, R * 3);
        if (!this.winnerShown) { // 1등 결승 통과: 승리 효과
          this.winnerShown = true;
          this.fxImg('victory', xOf(this.race.physicalPos(this.race.finishLine)) + R * 2, this.laneY(r.lane) - R, { size: R * 7, to: 1.3, dur: 1600, force: true, depth: 36 });
        }
        break;
      }
    }
  }

  /**
   * 공통 이펙트 이미지 1회 재생 (확대·회전·이동·페이드 후 자동 정리). 이미지가 없으면 false.
   * 동시 표시 상한(MAX_FX)을 넘으면 force가 아닌 연출은 생략해 화면 가림을 막는다.
   */
  private fxImg(
    name: EffectName, x: number, y: number,
    o: { size: number; h?: number; to?: number; dur?: number; spin?: number; dx?: number; force?: boolean; depth?: number },
  ): boolean {
    const key = `fx_${name}`;
    if (!this.textures.exists(key)) return false;
    if (this.activeFx >= MAX_FX && !o.force) return true;
    this.activeFx++;
    const img = this.add.image(x, y, key).setDepth(o.depth ?? 33).setAlpha(0.95);
    img.setDisplaySize(o.size, o.h ?? o.size);
    const sx = img.scaleX, sy = img.scaleY;
    img.setScale(sx * 0.45, sy * 0.45);
    this.tweens.add({
      targets: img,
      scaleX: sx * (o.to ?? 1), scaleY: sy * (o.to ?? 1),
      x: x + (o.dx ?? 0), angle: o.spin ?? 0,
      alpha: { value: 0, ease: 'Quad.easeIn' },
      duration: o.dur ?? 700, ease: 'Cubic.easeOut',
      onComplete: () => { img.destroy(); this.activeFx--; },
    });
    return true;
  }

  private popText(x: number, y: number, text: string, color: string, size: number, bg?: number): void {
    const t = this.add.text(x, y, text, {
      fontFamily: 'Malgun Gothic, sans-serif', fontSize: `${size}px`, color, fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 4,
      backgroundColor: bg !== undefined ? Phaser.Display.Color.IntegerToColor(bg).rgba.replace(/[\d.]+\)$/, '0.55)') : undefined,
      padding: bg !== undefined ? { x: 6, y: 2 } : undefined,
    }).setOrigin(0.5, 1).setDepth(40);
    this.tweens.add({ targets: t, y: y - 36, alpha: 0, duration: 1300, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  private burst(x: number, y: number, color: number, count: number, radius: number): void {
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const c = this.add.circle(x, y, 3 + Math.random() * 3, color).setDepth(35);
      this.tweens.add({
        targets: c, x: x + Math.cos(a) * radius, y: y + Math.sin(a) * radius, alpha: 0, scale: 0.3,
        duration: 500 + Math.random() * 300, ease: 'Cubic.easeOut', onComplete: () => c.destroy(),
      });
    }
  }

  private ring(x: number, y: number, color: number, r: number): void {
    const c = this.add.circle(x, y, 8).setStrokeStyle(4, color).setDepth(34);
    this.tweens.add({ targets: c, radius: r, alpha: 0, duration: 600, ease: 'Cubic.easeOut', onComplete: () => c.destroy() });
  }

  private projectile(x1: number, y1: number, x2: number, y2: number, color: number): void {
    const c = this.add.circle(x1, y1, 6, color).setDepth(36);
    this.tweens.add({ targets: c, x: x2, y: y2, duration: 260, ease: 'Quad.easeIn', onComplete: () => c.destroy() });
  }

  private wave(x: number, y: number): void {
    const w = this.add.ellipse(x + 60, y, 50, this.laneH * 0.9, 0x29b6f6, 0.6).setDepth(33);
    this.tweens.add({ targets: w, x: x - 140, alpha: 0, scaleX: 2, duration: 700, onComplete: () => w.destroy() });
  }
}
