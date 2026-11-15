// WebAudio 합성 효과음 (외부 음원 파일 없음)
let ctx: AudioContext | null = null;
let muted = false;

export function initAudio(): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch { ctx = null; }
}
export const setMuted = (m: boolean) => { muted = m; };
export const isMuted = () => muted;

function tone(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.06, delay = 0, slideTo?: number): void {
  if (!ctx || muted) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, vol = 0.08, delay = 0): void {
  if (!ctx || muted) return;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  const g = ctx.createGain();
  g.gain.value = vol;
  src.buffer = buf;
  src.connect(g).connect(ctx.destination);
  src.start(ctx.currentTime + delay);
}

export const sfx = {
  count: () => tone(660, 0.15, 'square', 0.07),
  go: () => { tone(990, 0.35, 'square', 0.08); tone(1320, 0.35, 'triangle', 0.05, 0.05); },
  skill: () => tone(520, 0.12, 'triangle', 0.05, 0, 880),
  ult: () => { tone(220, 0.5, 'sawtooth', 0.06, 0, 880); tone(440, 0.4, 'square', 0.04, 0.12, 1320); noise(0.3, 0.05, 0.05); },
  hit: () => { noise(0.15, 0.09); tone(140, 0.15, 'square', 0.05, 0, 70); },
  dodge: () => tone(700, 0.1, 'sine', 0.05, 0, 1200),
  debuff: () => tone(400, 0.2, 'sawtooth', 0.04, 0, 160),
  finishMove: () => { [523, 494, 466, 440].forEach((f, i) => tone(f, 0.18, 'square', 0.06, i * 0.14)); },
  finish: () => { tone(880, 0.1, 'square', 0.05); tone(1175, 0.18, 'square', 0.05, 0.08); },
  cheer: () => noise(0.6, 0.04),
  fanfare: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, i === 3 ? 0.6 : 0.16, 'square', 0.06, i * 0.15)); },
};
