// 캐릭터 이미지 검증: node tools/check-images.mjs
// 40장(10명 × run/skill/ultimate/victory) 존재·WebP 형식·투명 채널·크기/비율·용량 점검
import { existsSync, readFileSync, statSync } from 'node:fs';
// 파일 접두어 기준 (난워니 파일명이 바뀌면 src/game/images.ts 와 함께 수정)
const IDS = ['yappu', 'harunotsuki', 'manjo', 'moya', 'yuntami', 'yamuji', 'nanwony', 'kkutinho', 'kimokdok', 'damyu'];
const POSES = ['run', 'skill', 'ultimate', 'victory'];

function webpInfo(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    const alpha = (buf[20] & 0x10) !== 0;
    const w = 1 + buf.readUIntLE(24, 3), h = 1 + buf.readUIntLE(27, 3);
    return { kind: 'VP8X', alpha, w, h };
  }
  if (chunk === 'VP8L') {
    const b = buf.readUInt32LE(21);
    return { kind: 'VP8L', alpha: ((b >> 28) & 1) === 1, w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8 ') return { kind: 'VP8', alpha: false, w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  return { kind: chunk, alpha: false, w: 0, h: 0 };
}

let ok = 0, warn = 0, fail = 0;
for (const id of IDS) {
  const cells = [];
  for (const pose of POSES) {
    const f = `public/characters/${id}_${pose}.webp`;
    if (!existsSync(f)) { cells.push(`${pose}: ❌없음`); fail++; continue; }
    const info = webpInfo(readFileSync(f));
    const kb = Math.round(statSync(f).size / 1024);
    if (!info) { cells.push(`${pose}: ❌WebP아님`); fail++; continue; }
    const notes = [];
    if (!info.alpha) notes.push('투명X');
    const ratio = info.w / info.h;
    if (ratio < 0.5 || ratio > 2) notes.push(`비율${ratio.toFixed(2)}`);
    if (Math.max(info.w, info.h) > 1024) notes.push('1024px초과');
    if (Math.max(info.w, info.h) < 128) notes.push('128px미만');
    if (kb > 400) notes.push(`${kb}KB`);
    if (notes.length) warn++; else ok++;
    cells.push(`${pose}: ${notes.length ? '⚠️' : '✅'}${info.w}x${info.h} ${kb}KB${notes.length ? ' ' + notes.join(',') : ''}`);
  }
  console.log(id.padEnd(12), cells.join(' | '));
}
console.log(`\n캐릭터: 정상 ${ok} / 경고 ${warn} / 실패 ${fail} (총 ${IDS.length * POSES.length})`);

// 배경·장애물·이펙트
const EXTRA = {
  backgrounds: ['stadium_day', 'stadium_night', 'victory_stage'],
  obstacles: ['obstacle_banana', 'obstacle_rock', 'obstacle_pit', 'obstacle_tornado', 'obstacle_slow_zone'],
  effects: ['effect_speed', 'effect_lightning', 'effect_wind', 'effect_impact', 'effect_teleport', 'effect_wave', 'effect_confusion',
    'effect_shield', 'effect_heart', 'effect_burst', 'effect_cutin', 'effect_victory', 'effect_speedlines'],
};
for (const [dir, names] of Object.entries(EXTRA)) {
  const cells = names.map((n) => {
    const f = `public/${dir}/${n}.webp`;
    if (!existsSync(f)) { fail++; return `${n}: ❌없음`; }
    const info = webpInfo(readFileSync(f));
    if (!info) { fail++; return `${n}: ❌WebP아님`; }
    return `${n}: ${info.w}x${info.h}${info.alpha ? '' : ' 투명X'} ${Math.round(statSync(f).size / 1024)}KB`;
  });
  console.log(`[${dir}]`, cells.join(' | '));
}
process.exitCode = fail ? 1 : 0;
