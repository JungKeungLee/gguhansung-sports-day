// 브라우저 통합 QA: node tools/e2e.mjs [chrome|msedge] [스크린샷폴더]   (npm run build 후)
// 2/5/10명 × 낮·야간 × 1920/1366/2560, 결승선 이동, 시상식, 순위 복사, 다시 하기, FPS, 메모리
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const channel = process.argv[2] ?? 'chrome';
const out = process.argv[3] ?? 'e2e-shots';
mkdirSync(out, { recursive: true });
const server = spawn('npx vite preview --port 4317 --strictPort', { shell: true });
await new Promise((r) => setTimeout(r, 2500));
const url = 'http://localhost:4317/';
const log = (...a) => console.log('[e2e]', ...a);
const errors = [];

const CASES = [
  { w: 1920, h: 1080, theme: '낮', cards: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], seed: 12345, full: true },
  { w: 1366, h: 768, theme: '야간', cards: [0, 1, 2, 3, 4], seed: 3, speed2: true }, // 결승선 100→150m
  { w: 2560, h: 1440, theme: '야간', cards: [6, 7], seed: 77, speed2: true },        // 2명 → 3등 빈자리
];

const fpsOf = (page) => page.evaluate(() => new Promise((res) => {
  let n = 0; const t0 = performance.now();
  const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(n / 3); };
  requestAnimationFrame(f);
}));

const browser = await chromium.launch({ channel, headless: true, args: ['--enable-precise-memory-info'] });
try {
  for (const c of CASES) {
    const tag = `${c.w}-${c.cards.length}p-${c.theme === '낮' ? 'day' : 'night'}`;
    const ctx = await browser.newContext({ viewport: { width: c.w, height: c.h }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${tag} ${m.type()}: ${m.text()}`); });
    await page.goto(`${url}?seed=${c.seed}`);
    const start = page.getByRole('button', { name: /경기 시작/ });
    if (c.full) {
      await page.locator('.char-card').nth(0).click();
      log('1명 → 시작 비활성:', await start.isDisabled());
      await page.locator('.char-card').nth(0).click();
      log('재클릭 해제 → 선택수:', await page.locator('.char-card.on').count());
      log('기본 경기장(낮) 선택됨:', (await page.locator('.theme-btn.on').textContent())?.includes('낮'));
    }
    for (const i of c.cards) await page.locator('.char-card').nth(i).click();
    await page.getByRole('radio', { name: new RegExp(c.theme) }).click();
    log(`${tag}: 선택 ${await page.locator('.char-card.on').count()}명, 시작 가능 ${await start.isEnabled()}`);
    if (c.full) await page.screenshot({ path: `${out}/${tag}-select.png` });
    await start.click();
    await page.waitForTimeout(1200);
    if (c.speed2) await page.getByRole('button', { name: '2배속', exact: true }).click();
    await page.waitForTimeout(c.full ? 9000 : 5000);
    await page.screenshot({ path: `${out}/${tag}-race.png` });
    log(`${tag}: FPS ${(await fpsOf(page)).toFixed(1)}, 게이지 노출 ${/gauge|게이지/i.test(await page.content())}`);
    if (c.seed === 3) {
      await page.locator('.finish-change').waitFor({ timeout: 40000 });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${out}/${tag}-finishmove.png` });
      log(`${tag}: 결승선 이동 배너 "${await page.locator('.fc-value').textContent()}", 헤더 "${await page.locator('.race-dist').textContent()}"`);
    }
    if (c.full) {
      await page.locator('.cutin').first().waitFor({ timeout: 40000 }).then(() => page.screenshot({ path: `${out}/${tag}-cutin.png` }))
        .catch(() => log('컷인 미포착'));
    }
    await page.locator('.result-screen').waitFor({ timeout: 150000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}/${tag}-result.png` });
    log(`${tag}: 시상대 인원 ${await page.locator('.podium-spot').count()}, 표 행 ${await page.locator('.result-table tbody tr').count()}`);
    await page.getByRole('button', { name: /순위 복사/ }).click();
    await page.waitForTimeout(300);
    log(`${tag}: 복사 "${await page.locator('.copy-msg').textContent()}"`);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    log(`${tag}: 클립보드 결승선 줄 "${clip.split('\n').find((l) => l.includes('최종 결승선'))}", 참가 "${clip.split('\n').find((l) => l.includes('참가 인원'))}"`);
    if (c.full) {
      const heap = () => page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
      const h1 = await heap();
      for (let k = 0; k < 2; k++) { // 다시 하기 2회 반복 후 메모리·캔버스 정리 확인
        await page.getByRole('button', { name: /다시 하기/ }).click();
        await page.waitForTimeout(1000);
        await page.getByRole('button', { name: '2배속', exact: true }).click();
        await page.locator('.result-screen').waitFor({ timeout: 150000 });
      }
      await page.evaluate(() => (window.gc ? window.gc() : 0));
      const h2 = await heap();
      log(`다시 하기 2회: 캔버스 수 ${await page.locator('canvas').count()}, JS 힙 ${(h1 / 1e6).toFixed(1)}MB → ${(h2 / 1e6).toFixed(1)}MB`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  spawn(`taskkill /pid ${server.pid} /T /F`, { shell: true });
}
log('콘솔 오류/경고:', errors.length ? [...new Set(errors)] : '없음');
process.exit(0);
