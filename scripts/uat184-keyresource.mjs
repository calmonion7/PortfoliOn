// task#184 UAT — BAH 리포트 상세 심층분석 탭의 핵심자원 차트 캡처 (pc-dark + mobile-light)
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'https://portfolion.taebro.com';
const OUT = path.join(__dirname, '..', 'screenshots-uat184');

const COMBOS = [
  { key: 'pc-dark',      width: 1440, height: 900, isMobile: false, hasTouch: false, dsf: 1, theme: 'dark',  clickSel: '.report-item' },
  { key: 'mobile-light', width: 390,  height: 844, isMobile: true,  hasTouch: true,  dsf: 2, theme: 'light', clickSel: '.stock-card' },
];

async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }) });
  return r.json();
}
async function settle(page, ms = 1500) {
  try { await page.waitForFunction(() => !document.querySelector('.spinner, .loading-spinner, [data-loading="true"]'), { timeout: 6000 }); } catch {}
  await page.waitForTimeout(ms);
}

async function run() {
  const { access_token, refresh_token } = await login();
  const browser = await chromium.launch({ headless: true });
  for (const c of COMBOS) {
    console.log(`=== ${c.key} ===`);
    const ctx = await browser.newContext({ viewport: { width: c.width, height: c.height }, isMobile: c.isMobile, hasTouch: c.hasTouch, deviceScaleFactor: c.dsf });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(([a, r, t]) => { localStorage.setItem('access_token', a); localStorage.setItem('refresh_token', r); localStorage.setItem('theme', t); }, [access_token, refresh_token, c.theme]);
    await page.goto(BASE + '/reports', { waitUntil: 'domcontentloaded' });
    await settle(page);
    // 관심 탭 → 하위칩 순회하며 BAH 탐색, zero-size 컨테이너라 DOM click 직접 디스패치
    const domClick = (sel, text) => page.evaluate(([s, t]) => {
      const els = Array.from(document.querySelectorAll(s));
      const el = els.find(e => e.textContent && e.textContent.includes(t));
      if (el) { el.click(); return true } return false
    }, [sel, text]);
    await domClick('button', '관심'); await settle(page, 800);
    let found = false;
    for (const chip of [null, '목표<40%', '경고']) {
      if (chip) { await domClick('button', chip); await settle(page, 800); }
      if (await page.evaluate(sel => Array.from(document.querySelectorAll(sel)).some(e => /BAH|Booz/i.test(e.textContent || '')), c.clickSel)) { found = true; break; }
    }
    if (!found) { console.log('   ⚠ BAH 미발견'); await ctx.close(); continue; }
    await page.evaluate(sel => {
      const el = Array.from(document.querySelectorAll(sel)).find(e => /BAH|Booz/i.test(e.textContent || ''))
      el && el.click()
    }, c.clickSel);
    await page.waitForSelector('.tab-btn', { state: 'attached', timeout: 6000 });
    await settle(page, 1200);
    await page.evaluate(() => {
      Array.from(document.querySelectorAll('.tab-btn')).filter(t => (t.textContent || '').includes('심층분석')).forEach(t => t.click())
    });
    await settle(page, 1500);
    // 핵심 자원 섹션으로 스크롤
    try { await page.getByText('핵심 자원', { exact: false }).first().scrollIntoViewIfNeeded(); } catch {}
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, `${c.key}-keyresource.png`), fullPage: true });
    console.log('   ✅ saved');
    await ctx.close();
  }
  await browser.close();
}
run().catch(e => { console.error(e); process.exit(1); });
