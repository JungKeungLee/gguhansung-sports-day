// Chromium smoke test: real browser executes 10-runner return to original 0m.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const seed = Number(process.argv[2]);
if (!Number.isInteger(seed) || seed < 0) throw new Error('Seed required');
const server = spawn('npm', ['run', 'preview', '--', '--port', '4317', '--strictPort'], { stdio: 'ignore', detached: true });
const errors = [];
let browser;
try {
  await sleep(2300);
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:4317/?seed=' + seed);
  await page.getByRole('button', { name: /100m 달리기/ }).click();
  const cards = page.locator('.char-card');
  for (let i = 0; i < 10; i++) await cards.nth(i).click();
  await page.getByRole('button', { name: /경기 시작/ }).click();
  await page.locator('.race-dist').getByText('반전 세계', { exact: false }).waitFor({ timeout: 80000 });
  const miniReverse = await page.locator('.mm-finish.reverse').count();
  const remaining = await page.locator('.rk-pos').first().textContent();
  await page.locator('.result-screen').waitFor({ timeout: 140000 });
  const summary = await page.locator('.result-card .rc-line').first().textContent();
  const rankingCount = await page.locator('.result-table tbody tr').count();
  if (miniReverse !== 1 || !remaining?.includes('남음') || !summary?.includes('0m') || errors.length) {
    throw new Error(JSON.stringify({ miniReverse, remaining, summary, errors }));
  }
  console.log('REVERSE_BROWSER '+JSON.stringify({seed,miniReverse,remaining,summary,rankingCount,errors}));
} finally {
  if (browser) await browser.close();
  try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill(); }
}
