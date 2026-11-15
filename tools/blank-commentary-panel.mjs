// commentary_panel.webp 의 예시 중계 문장 제거 (원본: assets-backup/ui/commentary_panel.orig.webp)
// 실행: node tools/blank-commentary-panel.mjs   — 외부 라이브러리 없이 Chrome Canvas로 처리
// 방식: 문장 직사각형을 주변 배경으로 확산 보간(인페인팅) → 알파 유지한 WebP 저장
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = 'assets-backup/ui/commentary_panel.orig.webp';
const DST = 'public/ui/commentary_panel.webp';
const REGION = { x0: 116, y0: 52, x1: 394, y1: 122 }; // 예시 문장 영역 (원본 521x150 기준). 탭·고양이·발바닥 아이콘 제외

const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await b.newPage();
const dataUrl = await p.evaluate(async ({ src, R }) => {
  const img = new Image(); img.src = src; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
  const id = g.getImageData(0, 0, c.width, c.height); const d = id.data; const W = c.width;
    // 1) 마스크: 문장 직사각형 전체(글자·검은 외곽선·노란 번짐 포함). 이 안에는 글자 외 장식이 없음
  //    영역 가장자리 4px은 원본 배경으로 남겨 보간의 경계값으로 사용
  const w = R.x1 - R.x0, h = R.y1 - R.y0;
  const mask = new Uint8Array(w * h);
  for (let y = 4; y < h - 4; y++) for (let x = 4; x < w - 4; x++) mask[y * w + x] = 1;
  // 2) 확산 보간: 마스크 픽셀을 이웃 평균으로 반복 갱신 (영역 경계의 원본 배경에서 안쪽으로 번짐)
  const buf = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = ((y + R.y0) * W + (x + R.x0)) * 4, j = (y * w + x) * 3;
    buf[j] = d[i]; buf[j + 1] = d[i + 1]; buf[j + 2] = d[i + 2];
    if (mask[y * w + x]) { buf[j] = 30; buf[j + 1] = 22; buf[j + 2] = 26; }
  }
  for (let it = 0; it < 1500; it++) {
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
  // 3) 기록 (알파는 원본 유지) + 미세 노이즈로 질감 맞춤
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    const i = ((y + R.y0) * W + (x + R.x0)) * 4, j = (y * w + x) * 3;
    const nz = (((x * 7919 + y * 104729) % 7) - 3) * 0.6;
    d[i] = buf[j] + nz; d[i + 1] = buf[j + 1] + nz; d[i + 2] = buf[j + 2] + nz;
  }
  g.putImageData(id, 0, 0);
  return c.toDataURL('image/webp', 0.95);
}, { src: 'data:image/webp;base64,' + readFileSync(SRC).toString('base64'), R: REGION });
await b.close();
writeFileSync(DST, Buffer.from(dataUrl.split(',')[1], 'base64'));
console.log('저장:', DST);
