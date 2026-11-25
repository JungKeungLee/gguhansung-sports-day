// speed_controls_panel.webp 의 '2배속' 숫자 2 → 3 교체 (원본: assets-backup/ui/speed_controls_panel.orig.webp)
// 실행: node tools/speed-panel-3x.mjs   — 외부 라이브러리 없이 Chrome Canvas로 처리 (blank-commentary-panel.mjs 와 같은 방식)
// 방식: 숫자 '2' 영역을 주변 배경으로 확산 보간 → 같은 스타일(흰 글자·어두운 외곽선)로 '3' 그림 → WebP 저장
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = 'assets-backup/ui/speed_controls_panel.orig.webp';
const DST = 'public/ui/speed_controls_panel.webp';
const REGION = { x0: 178, y0: 74, x1: 201, y1: 102 }; // 숫자 '2' 영역 (원본 409x123 기준, '배속' 글자 제외)

const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await b.newPage();
const dataUrl = await p.evaluate(async ({ src, R }) => {
  const img = new Image(); img.src = src; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
  const id = g.getImageData(0, 0, c.width, c.height); const d = id.data; const W = c.width;
  const w = R.x1 - R.x0, h = R.y1 - R.y0;
  const mask = new Uint8Array(w * h);
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) mask[y * w + x] = 1;
  const buf = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = ((y + R.y0) * W + (x + R.x0)) * 4, j = (y * w + x) * 3;
    buf[j] = d[i]; buf[j + 1] = d[i + 1]; buf[j + 2] = d[i + 2];
  }
  for (let it = 0; it < 800; it++) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      let r = 0, gg = 0, bb = 0, n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = (ny * w + nx) * 3; r += buf[j]; gg += buf[j + 1]; bb += buf[j + 2]; n++;
      }
      const j = (y * w + x) * 3; buf[j] = r / n; buf[j + 1] = gg / n; buf[j + 2] = bb / n;
    }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    const i = ((y + R.y0) * W + (x + R.x0)) * 4, j = (y * w + x) * 3;
    d[i] = buf[j]; d[i + 1] = buf[j + 1]; d[i + 2] = buf[j + 2];
  }
  g.putImageData(id, 0, 0);
  // '3': 기존 글자와 같은 흰 글자 + 어두운 외곽선 (숫자 높이 약 18px)
  g.font = '900 23px "Malgun Gothic", "Arial Black", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.lineJoin = 'round'; g.lineWidth = 5; g.strokeStyle = '#1a0a0e';
  g.strokeText('3', 189.5, 97); g.fillStyle = '#f4f1ee'; g.fillText('3', 189.5, 97);
  return c.toDataURL('image/webp', 0.95);
}, { src: 'data:image/webp;base64,' + readFileSync(SRC).toString('base64'), R: REGION });
await b.close();
writeFileSync(DST, Buffer.from(dataUrl.split(',')[1], 'base64'));
console.log('저장:', DST);
