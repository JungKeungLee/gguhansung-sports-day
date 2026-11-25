// 핀볼 맵 5종: 맵 정보 + 맵별 장애물 생성 로직 (물리·완주·끼임·배속은 PinballScene 공통)
import type { Rng } from '../game/rng';

export type MapId = 'basic' | 'maze' | 'rotor' | 'portal' | 'chaos';

export interface MapTheme {
  bgTop: number; bgBottom: number; grid: number; wall: number;
  plate: number; stroke: number; pin: number; pinStroke: number;
}

export interface MapInfo { id: MapId; name: string; icon: string; desc: string; theme: MapTheme }

const CRIMSON: MapTheme = { bgTop: 0x2a0a12, bgBottom: 0x120406, grid: 0x5a1a22, wall: 0x3a0d16, plate: 0x7a1a1a, stroke: 0xd4a017, pin: 0xd4a017, pinStroke: 0xfff1b8 };

export const PINBALL_MAPS: MapInfo[] = [
  { id: 'basic', name: '기본 핀볼', icon: '🎱', desc: '지그재그 경사로와 느린 풍차, 부드럽게 굴러가는 마블 레이스', theme: CRIMSON },
  { id: 'maze', name: '미로 핀볼', icon: '🌀', desc: '갈림길·지그재그 통로, 길마다 도착 시간이 달라요', theme: { ...CRIMSON, bgTop: 0x1f0d26, bgBottom: 0x0d0612, grid: 0x45204f, wall: 0x2b1033, plate: 0x5b2470, stroke: 0xe0b03c } },
  { id: 'rotor', name: '회전 장애물 핀볼', icon: '🌪️', desc: '돌아가는 막대·풍차에 공이 이리저리 튕겨요', theme: { ...CRIMSON, bgTop: 0x0c1a2e, bgBottom: 0x060b14, grid: 0x1f3a5a, wall: 0x10223a, plate: 0x1d4f7a, stroke: 0xffd166, pin: 0x9fd3ff, pinStroke: 0xffffff } },
  { id: 'portal', name: '순간이동 핀볼', icon: '🌌', desc: '포털에 빠진 공은 다른 곳으로 순간이동!', theme: { ...CRIMSON, bgTop: 0x170a2a, bgBottom: 0x080412, grid: 0x34205a, wall: 0x1e0f38, plate: 0x4a2a8a, stroke: 0x7ff3ff, pin: 0xc9a7ff, pinStroke: 0xffffff } },
  { id: 'chaos', name: '대환장 랜덤 핀볼', icon: '🎲', desc: '미로·회전체·범퍼·포털이 매 판 새로 섞여요', theme: { ...CRIMSON, bgTop: 0x2a0a12, bgBottom: 0x0c0a14, grid: 0x6a3a12, plate: 0x8a3a12, stroke: 0xffd166 } },
];
export const mapInfo = (id: MapId) => PINBALL_MAPS.find((m) => m.id === id)!;

/** 반발계수: 기본 맵은 유지하고 나머지 맵의 과도한 튕김만 완화 */
/** staticFriction0: 판·핀 정지마찰 0 (Matter 는 두 물체 중 큰 정지마찰 사용 → 완만한 경사에서 공이 멈추는 것 방지) */
export function mapPhysics(id: MapId): { ball: number; pin: number; plate: number; rotor: number; staticFriction0: boolean } {
  return id === 'basic'
    ? { ball: 0.25, pin: 0.25, plate: 0.1, rotor: 0.1, staticFriction0: true }   // 마블 레이스: 굴러가듯 부드럽게
    : { ball: 0.38, pin: 0.4, plate: 0.24, rotor: 0.28, staticFriction0: false };
}

/** 맵 생성용 API (씬이 구현) */
export interface MapApi {
  W: number; H: number; WALL: number; FINISH_Y: number;
  rng: Rng;                                   // 맵 전용 난수 (공 출발 배치 난수와 분리)
  rect(x: number, y: number, w: number, h: number, angleDeg: number, color?: number): void;
  pin(x: number, y: number, r?: number): void;
  bumper(x: number, y: number, r?: number): void;
  rotor(x: number, y: number, len: number, omega: number, arms?: number, thick?: number): void; // omega: rad/s (게임 시간)
  portal(ax: number, ay: number, bx: number, by: number, color: number): void;
}

export interface MapBuildResult { speedCap?: number } // 스텝당 최대 이동(px). 신규 맵만 사용 (튕겨 나감·벽 통과 방지)

/** 맵 확장 길이: 기존 맵(논리 y ~2950까지) 아래에 맵별 확장 구간(2920~4390)을 추가하고 결승을 이만큼 아래로 이동 */
export const MAP_EXT = 1500;

type Zone = { x: number; y: number; r: number };
type Rect = [number, number, number, number]; // x0, x1, y0, y1
const inZones = (zones: Zone[], x: number, y: number) => zones.some((z) => Math.hypot(x - z.x, y - z.y) < z.r);
const inRects = (rects: Rect[], x: number, y: number) => rects.some(([x0, x1, y0, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);

/** 엇갈린 핀 격자 (기본 맵과 같은 간격). deflect: 벽 반사판으로 벽 타고 내려가는 지름길 차단 */
function pinField(api: MapApi, y0: number, y1: number, opts: { step?: number; zones?: Zone[]; rects?: Rect[]; deflect?: boolean } = {}): void {
  const { W, WALL } = api;
  const step = opts.step ?? 84;
  let row = 0;
  for (let y = y0; y <= y1; y += step, row++) {
    const off = row % 2 ? 32 : 0;
    if (opts.deflect && row % 2 === 0) {
      if (!inZones(opts.zones ?? [], WALL + 22, y - 42)) api.rect(WALL + 22, y - 42, 56, 8, 32);
      if (!inZones(opts.zones ?? [], W - WALL - 22, y - 42)) api.rect(W - WALL - 22, y - 42, 56, 8, -32);
    }
    for (let x = WALL + 46 + off; x < W - WALL - 30; x += 64) if (!inZones(opts.zones ?? [], x, y) && !inRects(opts.rects ?? [], x, y)) api.pin(x, y);
  }
}

/** 지그재그 선반: 한쪽 벽(또는 칸막이)에서 시작해 반대쪽에 통로를 남김 */
function shelf(api: MapApi, fromX: number, toX: number, yTop: number, deg: number): Rect {
  const dx = Math.abs(toX - fromX);
  const dy = Math.tan((Math.abs(deg) * Math.PI) / 180) * dx;
  api.rect((fromX + toX) / 2, yTop + dy / 2, dx / Math.cos((deg * Math.PI) / 180), 14, deg);
  // 핀 배치 제외 영역 (경사로 위아래로 공이 지나갈 여유)
  return [Math.min(fromX, toX) - 30, Math.max(fromX, toX) + 30, yTop - 50, yTop + dy + 45];
}

// ───────────── 1. 기본 핀볼 (기존 맵 그대로 — 물리 밸런스 불변) ─────────────
function buildBasic(api: MapApi): MapBuildResult {
  const { W, WALL } = api;
  // 좌우 번갈아 짧은 경사로 5개: 공이 지그재그로 흐르며 반대편으로 건너감 (긴 직선 낙하 감소)
  const rects: Rect[] = [];
  [[760, true], [1160, false], [1560, true], [1960, false], [2360, true]].forEach(([y, fromLeft]) => {
    rects.push(fromLeft ? shelf(api, WALL - 4, 470, y as number, 16) : shelf(api, W - WALL + 4, 330, y as number, -16));
  });
  // 결승 직전: 양쪽에서 가운데로 모았다가 다시 퍼지는 구간
  rects.push(shelf(api, WALL - 4, 300, 2640, 15), shelf(api, W - WALL + 4, 500, 2640, -15));
  api.pin(400, 2770, 10);
  // 느린 작은 풍차 3개: 경사로 끝에서 떨어지는 공 흐름 위에 두어 부드럽게 방향만 바꿈 (회전 맵보다 작고 느림, 양옆 우회 가능)
  const rotors = [{ x: 480, y: 1010 }, { x: 320, y: 1420 }, { x: 480, y: 1810 }];
  rotors.forEach((r, i) => api.rotor(r.x, r.y, 110, i % 2 ? -0.7 : 0.7, 2, 12));
  pinField(api, 400, 2860, { rects, zones: rotors.map((r) => ({ x: r.x, y: r.y, r: 95 })), deflect: true });
  // ── 확장 구간: 지그재그 경사로 3개 + 느린 풍차 2개 + Λ 갈림길 → 다시 모임 ──
  const xr: Rect[] = [shelf(api, WALL - 4, 470, 3000, 16), shelf(api, W - WALL + 4, 330, 3400, -16), shelf(api, WALL - 4, 470, 3800, 16)];
  api.pin(400, 4090, 10);
  xr.push(shelf(api, 395, 190, 4120, -16), shelf(api, 405, 610, 4120, 16));   // 갈림길: 좌·우로 갈라짐
  xr.push(shelf(api, WALL - 4, 300, 4260, 15), shelf(api, W - WALL + 4, 500, 4260, -15)); // 가운데로 다시 모음
  const xrot = [{ x: 480, y: 3220 }, { x: 320, y: 3620 }];
  xrot.forEach((r, i) => api.rotor(r.x, r.y, 110, i % 2 ? -0.7 : 0.7, 2, 12));
  // 합류 경사판 위쪽 끝 바로 위의 벽 반사판(4222, 좌우 1개씩)은 제외: 반사판 끝과 경사판 사이 틈에 공이 끼어 휴면하던 문제
  const noDeflect = [{ x: WALL + 22, y: 4222, r: 4 }, { x: W - WALL - 22, y: 4222, r: 4 }];
  pinField(api, 2920, 4360, { rects: xr, zones: [...xrot.map((r) => ({ x: r.x, y: r.y, r: 95 })), ...noDeflect], deflect: true });
  return {};
}

// ───────────── 2. 미로 핀볼 ─────────────
function buildMaze(api: MapApi): MapBuildResult {
  pinField(api, 400, 480, { deflect: true });
  // 1구역: 가운데 칸막이로 좌(긴 지그재그)·우(핀+범퍼, 빠름) 갈림길
  api.pin(400, 585, 12);
  api.rect(400, 1125, 16, 1060, 0);
  [[680, 'wall'], [840, 'div'], [1000, 'wall'], [1160, 'div'], [1320, 'wall'], [1480, 'div']].forEach(([y, from]) => {
    if (from === 'wall') shelf(api, 40, 322, y as number, 18); else shelf(api, 392, 110, y as number, -18);
  });
  const bumpers = [{ x: 584, y: 1020, r: 18 }, { x: 520, y: 1380, r: 18 }];
  bumpers.forEach((b) => api.bumper(b.x, b.y, b.r));
  // 오른쪽(빠른 길)도 짧은 지그재그 2단 → 좌우 이동 추가 (왼쪽 6단보다 짧은 경로 유지)
  const rz = [shelf(api, 760, 520, 820, -15), shelf(api, 408, 640, 1180, 15)];
  let row = 0;
  for (let y = 660; y <= 1620; y += 80, row++) {
    const xs = row % 2 ? [488, 552, 616, 680] : [456, 520, 584, 648, 712];
    for (const x of xs) if (!inZones(bumpers.map((b) => ({ ...b, r: 44 })), x, y) && !inRects(rz, x, y)) api.pin(x, y);
  }
  // 합류: 양쪽 벽에서 가운데로 모으는 판 (가운데 통로 200px)
  shelf(api, 40, 300, 1760, 16);
  shelf(api, 760, 500, 1760, -16);
  // 2구역: 3갈래 (좌 지그재그 / 가운데 핀 / 우 범퍼)
  api.pin(290, 1955, 12); api.pin(510, 1955, 12);
  api.rect(290, 2282, 14, 635, 0); api.rect(510, 2282, 14, 635, 0);
  shelf(api, 40, 213, 2050, 18); shelf(api, 283, 110, 2180, -18); shelf(api, 40, 213, 2330, 18); shelf(api, 283, 110, 2460, -18);
  row = 0;
  for (let y = 2040; y <= 2560; y += 80, row++) for (const x of row % 2 ? [372, 428] : [345, 400, 455]) api.pin(x, y);
  [[600, 2100], [690, 2250], [600, 2400], [690, 2540]].forEach(([x, y]) => api.bumper(x, y, 18));
  // 마지막: 세 갈래가 지그재그로 엇갈려 합류
  const fz = [shelf(api, 40, 330, 2660, 14), shelf(api, 760, 470, 2760, -14)];
  pinField(api, 2720, 2860, { rects: fz, deflect: true });
  // ── 확장 구간: 두 번째 좌우 갈림길 (좌 지그재그 5단 / 우 핀+범퍼) → 합류 → 엇갈림 ──
  pinField(api, 2940, 2940);
  api.pin(400, 3040, 12);
  api.rect(400, 3500, 16, 880, 0);
  [[3120, 'wall'], [3280, 'div'], [3440, 'wall'], [3600, 'div'], [3760, 'wall']].forEach(([y, from]) => {
    if (from === 'wall') shelf(api, 40, 322, y as number, 18); else shelf(api, 392, 110, y as number, -18);
  });
  const xb = [{ x: 584, y: 3300, r: 18 }, { x: 520, y: 3650, r: 18 }];
  xb.forEach((b) => api.bumper(b.x, b.y, b.r));
  const xrz = [shelf(api, 760, 520, 3200, -15), shelf(api, 408, 640, 3560, 15)];
  row = 0;
  for (let y = 3100; y <= 3900; y += 80, row++) {
    const xs = row % 2 ? [488, 552, 616, 680] : [456, 520, 584, 648, 712];
    for (const x of xs) if (!inZones(xb.map((b) => ({ ...b, r: 44 })), x, y) && !inRects(xrz, x, y)) api.pin(x, y);
  }
  shelf(api, 40, 300, 4020, 16); shelf(api, 760, 500, 4020, -16);
  const xfz = [shelf(api, 40, 330, 4160, 14), shelf(api, 760, 470, 4250, -14)];
  pinField(api, 4220, 4360, { rects: xfz, deflect: true });
  return { speedCap: 16 };
}

// ───────────── 3. 회전 장애물 핀볼 ─────────────
function buildRotor(api: MapApi): MapBuildResult {
  const rotors = [
    { x: 400, y: 720, len: 320, w: 1.5, arms: 1 },
    { x: 230, y: 1180, len: 220, w: -2.0, arms: 2 },
    { x: 570, y: 1180, len: 220, w: 2.0, arms: 2 },
    { x: 400, y: 1820, len: 440, w: -1.2, arms: 1 },
    { x: 400, y: 2680, len: 260, w: 2.4, arms: 2 },
  ];
  const bumpers = [[200, 2120], [400, 2150], [600, 2120], [300, 2300], [500, 2300], [200, 2450], [600, 2450]];
  rotors.forEach((r) => api.rotor(r.x, r.y, r.len, r.w, r.arms));
  bumpers.forEach(([x, y]) => api.bumper(x, y, 20));
  // 회전 반경·범퍼 주변은 비워 끼임 방지. 회전체는 벽에서 80px 이상 떨어져 안전한 우회로 확보
  const zones: Zone[] = [...rotors.map((r) => ({ x: r.x, y: r.y, r: r.len / 2 + 36 })), ...bumpers.map(([x, y]) => ({ x, y, r: 50 }))];
  // 회전체 사이 경사로: 공을 반대편 회전체·우회로로 보냄
  const rects = [shelf(api, 40, 300, 930, 14), shelf(api, 760, 500, 1420, -14), shelf(api, 760, 520, 2520, -12)];
  pinField(api, 400, 2860, { step: 92, zones, rects, deflect: true });
  // ── 확장 구간: 긴 막대 → 좌우 쌍 풍차 → 4날 풍차, 사이사이 범퍼·경사로 (벽과 80px 이상 간격) ──
  const xr = [
    { x: 400, y: 3150, len: 300, w: 1.4, arms: 1 },
    { x: 230, y: 3600, len: 220, w: -1.9, arms: 2 },
    { x: 570, y: 3600, len: 220, w: 1.9, arms: 2 },
    { x: 400, y: 4080, len: 260, w: -2.2, arms: 2 },
  ];
  const xb = [[180, 3380], [620, 3380], [400, 3850]];
  xr.forEach((r) => api.rotor(r.x, r.y, r.len, r.w, r.arms));
  xb.forEach(([x, y]) => api.bumper(x, y, 20));
  const xz: Zone[] = [...xr.map((r) => ({ x: r.x, y: r.y, r: r.len / 2 + 64 })), ...xb.map(([x, y]) => ({ x, y, r: 50 }))];
  const xrect = [shelf(api, 760, 520, 3260, -14), shelf(api, 40, 280, 3880, 14)];
  pinField(api, 2884, 4360, { step: 92, zones: xz, rects: xrect, deflect: true });
  return { speedCap: 15 };
}

// ───────────── 4. 순간이동 핀볼 ─────────────
function buildPortal(api: MapApi): MapBuildResult {
  const portals = [
    { a: [170, 950], b: [610, 1960], c: 0x7ff3ff },  // 아래로 크게 이동
    { a: [630, 1380], b: [190, 720], c: 0xff7ff3 },  // 위로 되돌아감 (출구 아래에 1번 입구 → 이어 타기 가능, 무한 반복은 쿨타임으로 차단)
    { a: [400, 2330], b: [400, 2760], c: 0xffd166 }, // 결승 직전 지름길
  ];
  portals.forEach((p) => api.portal(p.a[0], p.a[1], p.b[0], p.b[1], p.c));
  const bumpers = [[400, 1150], [250, 1650], [560, 2550]];
  bumpers.forEach(([x, y]) => api.bumper(x, y, 18));
  const zones: Zone[] = [
    ...portals.flatMap((p) => [{ x: p.a[0], y: p.a[1], r: 70 }, { x: p.b[0], y: p.b[1], r: 70 }]),
    ...bumpers.map(([x, y]) => ({ x, y, r: 48 })),
  ];
  const rects = [shelf(api, 760, 480, 1080, -14), shelf(api, 40, 330, 1740, 14), shelf(api, 760, 470, 2140, -14)];
  pinField(api, 400, 2860, { step: 92, zones, rects, deflect: true });
  // ── 확장 구간: 아래로 건너뛰는 포털 + 위로 되돌리는 포털 한 쌍 추가 ──
  const xp = [
    { a: [200, 3250], b: [600, 3900], c: 0x9dff7f },
    { a: [620, 3600], b: [190, 3020], c: 0xff9f7f },
  ];
  xp.forEach((p) => api.portal(p.a[0], p.a[1], p.b[0], p.b[1], p.c));
  const xb = [[400, 3420], [250, 4050]];
  xb.forEach(([x, y]) => api.bumper(x, y, 18));
  const xz: Zone[] = [
    ...xp.flatMap((p) => [{ x: p.a[0], y: p.a[1], r: 70 }, { x: p.b[0], y: p.b[1], r: 70 }]),
    ...xb.map(([x, y]) => ({ x, y, r: 48 })),
  ];
  const xrect = [shelf(api, 760, 480, 3150, -14), shelf(api, 40, 330, 3780, 14), shelf(api, 760, 470, 4150, -14)];
  pinField(api, 2884, 4360, { step: 92, zones: xz, rects: xrect, deflect: true });
  return { speedCap: 16 };
}

// ───────────── 5. 대환장 랜덤 핀볼: 검증된 패턴 4개를 구간별로 조합 ─────────────
// 모든 패턴은 구간 상단 60px을 비워 둠(포털 출구 안전 지대) + 벽에서 통로 확보 → 어떤 조합이어도 경로 유지
const SLOTS: [number, number][] = [[420, 1000], [1060, 1640], [1700, 2280], [2340, 2860], [2920, 3500], [3560, 4140]]; // 5·6번은 확장 구간
type Pattern = (api: MapApi, y0: number, y1: number, slot: number) => void;

const P_PINS: Pattern = (api, y0, y1) => pinField(api, y0 + 90, y1 - 40, { deflect: true });
const P_BUMPERS: Pattern = (api, y0) => {
  const bs = [[220, y0 + 220], [580, y0 + 220], [400, y0 + 360], [220, y0 + 500], [580, y0 + 500]];
  bs.forEach(([x, y]) => api.bumper(x, y, 20));
  pinField(api, y0 + 100, y0 + 100, { zones: bs.map(([x, y]) => ({ x, y, r: 50 })) });
};
const P_ROTOR_PAIR: Pattern = (api, y0) => {
  const w = api.rng.range(1.6, 2.2);
  api.rotor(230, y0 + 300, 220, -w, 2); api.rotor(570, y0 + 300, 220, w, 2);
  pinField(api, y0 + 100, y0 + 100, { zones: [{ x: 230, y: y0 + 300, r: 150 }, { x: 570, y: y0 + 300, r: 150 }] });
};
const P_ROTOR_BAR: Pattern = (api, y0, y1) => {
  api.rotor(400, y0 + 300, 360, api.rng.range(1.2, 1.6) * (api.rng.next() < 0.5 ? -1 : 1), 1);
  const z = [{ x: 400, y: y0 + 300, r: 216 }];
  pinField(api, y0 + 90, y0 + 90, { zones: z }); pinField(api, y1 - 40, y1 - 40, { zones: z });
};
const P_SPLIT: Pattern = (api, y0, y1) => {
  api.pin(290, y0 + 90, 12); api.pin(510, y0 + 90, 12);
  api.rect(290, (y0 + 100 + y1 - 60) / 2, 14, y1 - 60 - (y0 + 100), 0);
  api.rect(510, (y0 + 100 + y1 - 60) / 2, 14, y1 - 60 - (y0 + 100), 0);
  let row = 0;
  for (let y = y0 + 170; y <= y1 - 90; y += 80, row++) {
    for (const x of row % 2 ? [150] : [110, 190]) api.pin(x, y);
    for (const x of row % 2 ? [650] : [610, 690]) api.pin(x, y);
  }
  api.bumper(400, y0 + 260, 18); api.bumper(400, y0 + 420, 18);
};
// 지그재그(개선): 긴 경사판 2개(520px)에 공이 일렬로 쌓이던 문제 → 짧은 경사판 4개 + 출구 3갈래 + 작은 풍차·범퍼
const P_ZIGZAG: Pattern = (api, y0, y1) => {
  shelf(api, 40, 250, y0 + 110, 14); shelf(api, 760, 550, y0 + 110, -14);   // 1단: 양 벽에서 가운데로, 가운데 300px 통로
  api.rotor(400, y0 + 260, 120, api.rng.next() < 0.5 ? -1.2 : 1.2, 2, 12);  // 가운데 흐름을 좌우로 나눔
  api.pin(300, y0 + 230); api.pin(500, y0 + 230);
  shelf(api, 150, 330, y0 + 340, 12); shelf(api, 650, 470, y0 + 340, -12);  // 2단: 벽 쪽 110px 출구 2개 + 가운데 출구
  api.bumper(400, y0 + 400, 16);
  pinField(api, y1 - 50, y1 - 50);
};
const P_VSPLIT: Pattern = (api, y0, y1) => { // 갈라졌다가 다시 합쳐짐
  api.pin(400, y0 + 100, 12);
  shelf(api, 395, 200, y0 + 130, -16); shelf(api, 405, 600, y0 + 130, 16);
  shelf(api, 40, 300, y0 + 330, 16); shelf(api, 760, 500, y0 + 330, -16);
  pinField(api, y1 - 40, y1 - 40);
};
const P_ZIGZAG3: Pattern = (api, y0) => { // 짧은 3단 지그재그
  shelf(api, 40, 470, y0 + 100, 12); shelf(api, 760, 330, y0 + 260, -12); shelf(api, 40, 470, y0 + 420, 12);
};
const portalPattern = (exitSlot: number): Pattern => (api, y0, y1) => {
  const ax = api.rng.range(180, 620), ay = y0 + 300;
  const [ey0] = SLOTS[exitSlot];
  const bx = api.rng.range(160, 640), by = ey0 + 30;
  api.portal(ax, ay, bx, by, 0x7ff3ff);
  pinField(api, y0 + 90, y1 - 40, { zones: [{ x: ax, y: ay, r: 70 }], deflect: true });
};

function buildChaos(api: MapApi): MapBuildResult {
  const { rng } = api;
  const pick = <T>(xs: T[]) => xs[rng.int(xs.length)];
  // 6구간에 [회전체, 포털, 미로형, 채움, 미로형, 회전체] → 매 판 모든 요소가 등장. 포털은 마지막 구간 제외(출구가 아래 구간)
  const kinds = ['rotor', 'portal', 'maze', 'fill', 'maze', 'rotor'];
  const last = kinds.length - 1;
  for (let i = last; i > 0; i--) { const j = rng.int(i + 1); [kinds[i], kinds[j]] = [kinds[j], kinds[i]]; }
  if (kinds[last] === 'portal') { const j = rng.int(last); [kinds[last], kinds[j]] = [kinds[j], kinds[last]]; }
  kinds.forEach((k, i) => {
    const [y0, y1] = SLOTS[i];
    const p: Pattern = k === 'rotor' ? pick([P_ROTOR_PAIR, P_ROTOR_BAR])
      : k === 'maze' ? pick([P_SPLIT, P_ZIGZAG, P_VSPLIT, P_ZIGZAG3])
        : k === 'fill' ? pick([P_PINS, P_BUMPERS])
          : portalPattern(Math.min(last, i + 1 + rng.int(2)));
    p(api, y0, y1, i);
  });
  pinField(api, 4230, 4390, { deflect: true }); // 결승 직전 두 줄
  return { speedCap: 15 };
}

export function buildPinballMap(id: MapId, api: MapApi): MapBuildResult {
  switch (id) {
    case 'maze': return buildMaze(api);
    case 'rotor': return buildRotor(api);
    case 'portal': return buildPortal(api);
    case 'chaos': return buildChaos(api);
    default: return buildBasic(api);
  }
}
