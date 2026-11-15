// 사운드 시스템: BGM 3종(HTMLAudio, 트랙당 1개 재사용) + 효과음(MP3는 WebAudio 버퍼, 일부 합성음) + 설정 저장
import { assetUrl } from '../game/images';

// ───────────── 설정 (localStorage) ─────────────
export interface SoundSettings { bgm: number; sfx: number; muted: boolean } // 볼륨 0~1
const KEY = 'gguhansung-sports-day:sound';
const DEFAULTS: SoundSettings = { bgm: 0.6, sfx: 0.8, muted: false };

function loadSettings(): SoundSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const v = JSON.parse(raw) as Partial<SoundSettings>;
    const clamp = (x: unknown, d: number) => (typeof x === 'number' && x >= 0 && x <= 1 ? x : d);
    return { bgm: clamp(v.bgm, DEFAULTS.bgm), sfx: clamp(v.sfx, DEFAULTS.sfx), muted: v.muted === true };
  } catch { return { ...DEFAULTS }; }
}

let settings = loadSettings();
const listeners = new Set<(s: SoundSettings) => void>();

export const getSoundSettings = () => settings;
export function setSoundSettings(patch: Partial<SoundSettings>): void {
  settings = { ...settings, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* 저장 불가 환경은 무시 */ }
  applyVolumes();
  listeners.forEach((f) => f(settings));
}
export function onSoundSettings(f: (s: SoundSettings) => void): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}
export const isMuted = () => settings.muted;
export const setMuted = (m: boolean) => setSoundSettings({ muted: m });

// ───────────── 오디오 컨텍스트 (사용자 클릭 후 활성화) ─────────────
let ctx: AudioContext | null = null;
let sfxBus: GainNode | null = null;
let unlocked = false;

export function initAudio(): void {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      sfxBus = ctx.createGain();
      sfxBus.connect(ctx.destination);
      applyVolumes();
      void preloadSfx();
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch { ctx = null; }
  if (!unlocked) {
    unlocked = true;
    if (wantedBgm) playBgm(wantedBgm); // 자동재생 제한으로 미뤄둔 BGM 시작
  }
}

/** 첫 사용자 입력에서 오디오 활성화 + 버튼 클릭음 (전역 1회 등록) */
export function installAudioUnlock(): void {
  window.addEventListener('pointerdown', () => initAudio(), { capture: true });
  window.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement | null)?.closest('button, [role="radio"]');
    if (el && !(el as HTMLButtonElement).disabled) playSfx('click');
  }, { capture: true });
}

// ───────────── BGM ─────────────
export type BgmName = 'main' | 'race' | 'victory';
const bgmEls = new Map<BgmName, HTMLAudioElement>();
let currentBgm: BgmName | null = null;
let wantedBgm: BgmName | null = null;
const fades = new Map<HTMLAudioElement, number>();
const FADE_MS = 450;

const bgmTarget = () => (settings.muted ? 0 : settings.bgm);

function bgmEl(name: BgmName): HTMLAudioElement {
  let el = bgmEls.get(name);
  if (!el) {
    el = new Audio(assetUrl(`audio/bgm/${name}.mp3`));
    el.loop = true;
    el.preload = 'auto';
    el.volume = 0;
    bgmEls.set(name, el);
  }
  return el;
}

function fadeTo(el: HTMLAudioElement, to: number, then?: () => void): void {
  const prev = fades.get(el);
  if (prev) cancelAnimationFrame(prev);
  const from = el.volume;
  const t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / FADE_MS);
    el.volume = Math.max(0, Math.min(1, from + (to - from) * k));
    if (k < 1) fades.set(el, requestAnimationFrame(step));
    else { fades.delete(el); then?.(); }
  };
  fades.set(el, requestAnimationFrame(step));
}

/** 화면별 BGM 전환 (같은 곡이면 유지, 다른 곡이면 짧은 페이드 전환) */
export function playBgm(name: BgmName): void {
  wantedBgm = name;
  if (!unlocked) return;
  if (currentBgm === name) {
    const el = bgmEl(name);
    if (el.paused) void el.play().catch(() => undefined);
    fadeTo(el, bgmTarget());
    return;
  }
  if (currentBgm) {
    const old = bgmEl(currentBgm);
    fadeTo(old, 0, () => { old.pause(); });
  }
  currentBgm = name;
  const el = bgmEl(name);
  el.currentTime = 0;
  el.volume = 0;
  void el.play().catch(() => undefined);
  fadeTo(el, bgmTarget());
}

export const currentBgmName = () => currentBgm;

function applyVolumes(): void {
  if (sfxBus && ctx) sfxBus.gain.setValueAtTime(settings.muted ? 0 : settings.sfx, ctx.currentTime);
  if (currentBgm) {
    const el = bgmEl(currentBgm);
    const f = fades.get(el);
    if (f) { cancelAnimationFrame(f); fades.delete(el); }
    el.volume = bgmTarget();
  }
}

// ───────────── 효과음 (MP3 9종) ─────────────
export type SfxName = 'click' | 'countdown' | 'start' | 'skill' | 'ultimate' | 'obstacle' | 'overtake' | 'finish-change' | 'finish';
const SFX: Record<SfxName, { gain: number; gap: number; maxVoices: number }> = {
  click: { gain: 0.5, gap: 60, maxVoices: 2 },
  countdown: { gain: 0.9, gap: 0, maxVoices: 1 },
  start: { gain: 0.95, gap: 0, maxVoices: 1 },
  skill: { gain: 0.38, gap: 220, maxVoices: 2 },         // 동시 다발 스킬은 최대 2개만 겹침
  ultimate: { gain: 1.0, gap: 0, maxVoices: 3 },         // 일반 스킬보다 확실히 크게
  obstacle: { gain: 0.5, gap: 150, maxVoices: 2 },
  overtake: { gain: 0.7, gap: 800, maxVoices: 1 },
  'finish-change': { gain: 1.0, gap: 0, maxVoices: 1 },
  finish: { gain: 0.95, gap: 0, maxVoices: 1 },
};
const buffers = new Map<SfxName, AudioBuffer>();
const lastPlay = new Map<SfxName, number>();
const voices = new Map<SfxName, number>();

async function preloadSfx(): Promise<void> {
  if (!ctx) return;
  await Promise.all((Object.keys(SFX) as SfxName[]).map(async (name) => {
    try {
      const res = await fetch(assetUrl(`audio/sfx/${name}.mp3`));
      if (!res.ok) return;
      buffers.set(name, await ctx!.decodeAudioData(await res.arrayBuffer()));
    } catch { /* 음원 없으면 무음 */ }
  }));
}

export function playSfx(name: SfxName): boolean {
  if (!ctx || !sfxBus || settings.muted) return false;
  const buf = buffers.get(name);
  if (!buf) return false;
  const spec = SFX[name];
  const now = performance.now();
  if (now - (lastPlay.get(name) ?? -1e9) < spec.gap) return false;
  if ((voices.get(name) ?? 0) >= spec.maxVoices) return false;
  lastPlay.set(name, now);
  voices.set(name, (voices.get(name) ?? 0) + 1);
  const src = ctx.createBufferSource();
  const g = ctx.createGain();
  g.gain.value = spec.gain;
  src.buffer = buf;
  src.connect(g).connect(sfxBus);
  src.onended = () => { voices.set(name, Math.max(0, (voices.get(name) ?? 1) - 1)); src.disconnect(); g.disconnect(); };
  src.start();
  return true;
}

// ───────────── 합성음 (MP3가 없는 보조 효과: 회피·방해·응원·2등 이하 골인) ─────────────
function tone(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.06, delay = 0, slideTo?: number): void {
  if (!ctx || !sfxBus || settings.muted) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(sfxBus);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, vol = 0.08, delay = 0): void {
  if (!ctx || !sfxBus || settings.muted) return;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  const g = ctx.createGain();
  g.gain.value = vol;
  src.buffer = buf;
  src.connect(g).connect(sfxBus);
  src.start(ctx.currentTime + delay);
}

/** 게임 이벤트용 효과음 (MP3 우선, 없으면 합성음 대체 — 중복 재생 없음) */
export const sfx = {
  countdown: () => { playSfx('countdown'); },              // 3초 길이 1회 → 3·2·1 표시와 맞춤
  go: () => { if (!playSfx('start')) { tone(990, 0.35, 'square', 0.08); tone(1320, 0.35, 'triangle', 0.05, 0.05); } },
  skill: () => { if (!playSfx('skill')) tone(520, 0.12, 'triangle', 0.05, 0, 880); },
  ult: () => { if (!playSfx('ultimate')) { tone(220, 0.5, 'sawtooth', 0.06, 0, 880); noise(0.3, 0.05, 0.05); } },
  hit: () => { if (!playSfx('obstacle')) { noise(0.15, 0.09); tone(140, 0.15, 'square', 0.05, 0, 70); } },
  overtake: () => { playSfx('overtake'); },
  finishMove: () => { if (!playSfx('finish-change')) [523, 494, 466, 440].forEach((f, i) => tone(f, 0.18, 'square', 0.06, i * 0.14)); },
  winner: () => { if (!playSfx('finish')) { tone(880, 0.1, 'square', 0.05); tone(1175, 0.18, 'square', 0.05, 0.08); } },
  dodge: () => tone(700, 0.1, 'sine', 0.05, 0, 1200),
  debuff: () => tone(400, 0.2, 'sawtooth', 0.04, 0, 160),
  finish: () => { tone(880, 0.1, 'square', 0.04); },
  cheer: () => noise(0.6, 0.04),
};
