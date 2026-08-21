// Focused re-capture of report detail (4 tabs), both viewports. task#78. v2 robust loading wait.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const BASE = 'https://portfolion.taebro.com';
const OUT = path.join(__dirname, '..', 'screenshots');

async function getTokens() {
  const res = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }) });
  return res.json();
}
async function clickText(page, label) {
  return page.evaluate((label) => {
    const els = [...document.querySelectorAll('button, .tab-btn, a, [role=tab]')];
    const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const norm = s => (s || '').replace(/\s+/g, ' ').trim();
    const m = els.find(el => vis(el) && norm(el.textContent).includes(label));
    if (m) { m.scrollIntoView({ block: 'center' }); m.click(); return true; }
    return false;
  }, label);
}
async function autoScroll(page) {
  await page.evaluate(async () => { const h = document.body.scrollHeight; for (let y = 0; y < h; y += window.innerHeight * 0.8) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 100)); } window.scrollTo(0, 0); });
  await page.waitForTimeout(700);
}
async function shot(page, dir, name) { await page.screenshot({ path: path.join(dir, name + '.png'), fullPage: true }); console.log('   ✅', name); }

(async () => {
  const { access_token, refresh_token } = await getTokens();
  const browser = await chromium.launch({ headless: true });
  for (const vp of [{ key: 'pc', width: 1440, height: 900, isMobile: false, hasTouch: false, dsf: 1 }, { key: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true, dsf: 2 }]) {
    const dir = path.join(OUT, vp.key); fs.mkdirSync(dir, { recursive: true });
    console.log(`=== ${vp.key} ===`);
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch, deviceScaleFactor: vp.dsf });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(([a, r]) => { localStorage.setItem('access_token', a); localStorage.setItem('refresh_token', r); }, [access_token, refresh_token]);
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    try {
      // wait for list to FINISH loading (spinner text gone + cards present)
      await page.waitForFunction(() => !document.body.innerText.includes('불러오는 중') && document.querySelectorAll('.stock-card').length > 0, { timeout: 30000 });
      await page.waitForTimeout(1200);
      // click first card via JS, wait for detail tabs AND not-loading
      let opened = false;
      for (let i = 0; i < 5 && !opened; i++) {
        await page.evaluate((i) => { const c = document.querySelectorAll('.stock-card'); if (c[i]) { c[i].scrollIntoView({ block: 'center' }); c[i].click(); } }, i);
        try {
          await page.waitForFunction(() => { const t = [...document.querySelectorAll('.tab-btn')]; return t.some(b => /요약|지표|사업분석|히스토리/.test(b.textContent)) && !document.body.innerText.includes('불러오는 중'); }, { timeout: 6000 });
          opened = true;
        } catch {}
      }
      if (!opened) { console.log('   ⚠ detail did not open'); await ctx.close(); continue; }
      await page.waitForTimeout(1500); await autoScroll(page); await shot(page, dir, '20-report-detail-summary');
      for (const [label, nm] of [['지표', '21-report-detail-indicators'], ['사업분석', '22-report-detail-deepdive'], ['히스토리', '23-report-detail-history']]) {
        if (await clickText(page, label)) { await page.waitForTimeout(2200); await autoScroll(page); await shot(page, dir, nm); }
        else console.log('   ⚠ tab not found:', label);
      }
    } catch (e) { console.log('   ⚠', e.message.split('\n')[0]); }
    await ctx.close();
  }
  await browser.close();
  console.log('done');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
