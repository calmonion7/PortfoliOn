// #79 KR 색 관례 UAT — 콘텐츠 로딩 완료를 명시 대기 후 캡처(task#78 retro 교훈 적용).
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'https://portfolion.taebro.com';
const EMAIL = 'test@portfolion.com';
const PASSWORD = 'test1234';
const OUT = path.join(__dirname, '..', 'screenshots', 'uat79');

const VIEWPORTS = [
  { key: 'pc',     width: 1440, height: 900, isMobile: false, hasTouch: false, dsf: 1 },
  { key: 'mobile', width: 390,  height: 844, isMobile: true,  hasTouch: true,  dsf: 2 },
];

async function getTokens() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error('login failed ' + res.status);
  return res.json();
}

// wait until loading text disappears AND some content height exists
async function waitContent(page, ms = 12000) {
  try {
    await page.waitForFunction(() => {
      const t = document.body.innerText || '';
      const loading = t.includes('불러오는 중') || t.includes('데이터 불러오는');
      return !loading;
    }, { timeout: ms });
  } catch {}
  // lazy charts
  try {
    await page.evaluate(async () => {
      const h = document.body.scrollHeight;
      for (let y = 0; y < h; y += window.innerHeight * 0.8) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 150)); }
      window.scrollTo(0, 0);
    });
  } catch {}
  await page.waitForTimeout(1200);
}

async function shot(page, dir, name) {
  await page.screenshot({ path: path.join(dir, name + '.png'), fullPage: true });
  console.log('   ✅', name);
}

async function clickText(page, label, { exact = false } = {}) {
  const h = await page.evaluateHandle(({ label, exact }) => {
    const els = [...document.querySelectorAll('button, .tab-btn, a, [role=tab]')];
    const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const norm = s => (s || '').replace(/\s+/g, ' ').trim();
    const m = els.find(el => vis(el) && (exact ? norm(el.textContent) === label : norm(el.textContent).includes(label)));
    if (m) { m.scrollIntoView({ block: 'center' }); m.click(); return true; }
    return false;
  }, { label, exact });
  return h.jsonValue();
}

async function run() {
  const { access_token, refresh_token } = await getTokens();
  console.log('🔐 tokens acquired');
  const browser = await chromium.launch({ headless: true });

  for (const vp of VIEWPORTS) {
    const dir = path.join(OUT, vp.key);
    fs.mkdirSync(dir, { recursive: true });
    console.log(`\n=== ${vp.key} ===`);
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.isMobile, hasTouch: vp.hasTouch, deviceScaleFactor: vp.dsf,
    });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(([a, r]) => { localStorage.setItem('access_token', a); localStorage.setItem('refresh_token', r); }, [access_token, refresh_token]);
    const step = async (n, fn) => { try { await fn(); } catch (e) { console.log('   ⚠', n, e.message); } };

    // Reports list (PnL/change/weather colors)
    await step('reports', async () => {
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await waitContent(page);
      await shot(page, dir, '10-reports');
    });
    // Ranking (등락률/순매수 price colors) — KR
    await step('ranking', async () => {
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await waitContent(page);
      await clickText(page, '랭킹', { exact: true }); await page.waitForTimeout(800); await waitContent(page);
      await shot(page, dir, '12-ranking');
    });
    // Correlation heatmap (neutral palette + legend)
    await step('correlation', async () => {
      await page.goto(BASE + '/portfolio', { waitUntil: 'domcontentloaded' }); await waitContent(page);
      await clickText(page, '분석', { exact: true }); await page.waitForTimeout(600);
      await clickText(page, '상관관계', { exact: true }); await page.waitForTimeout(800); await waitContent(page);
      await shot(page, dir, '33-correlation');
    });
    // Macro corr table (new legend)
    await step('macro', async () => {
      await page.goto(BASE + '/portfolio', { waitUntil: 'domcontentloaded' }); await waitContent(page);
      await clickText(page, '분석', { exact: true }); await page.waitForTimeout(600);
      await clickText(page, '매크로', { exact: true }); await page.waitForTimeout(800); await waitContent(page);
      await shot(page, dir, '32-macro');
    });
    // Market indicators (FX/VIX/commodities change colors + chart series)
    await step('market', async () => {
      await page.goto(BASE + '/market', { waitUntil: 'domcontentloaded' }); await waitContent(page, 16000);
      await shot(page, dir, '40-market');
      if (await clickText(page, '수급지표', { exact: true })) { await page.waitForTimeout(1000); await waitContent(page, 16000); await shot(page, dir, '41-supply'); }
    });
    // Report detail (consensus buy/sell, target gap, insider)
    await step('report-detail', async () => {
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await waitContent(page);
      await clickText(page, '리포트', { exact: true }); await page.waitForTimeout(1000);
      const cards = await page.$$('.stock-card');
      let opened = false;
      for (let i = 0; i < Math.min(cards.length, 8) && !opened; i++) {
        try {
          await cards[i].scrollIntoViewIfNeeded(); await cards[i].click(); await page.waitForTimeout(2000);
          opened = await page.evaluate(() => [...document.querySelectorAll('.tab-btn')].some(b => /요약|지표|사업분석|히스토리/.test(b.textContent)));
        } catch {}
      }
      if (!opened) { console.log('   ⚠ detail not opened'); return; }
      await waitContent(page); await shot(page, dir, '20-detail-summary');
      if (await clickText(page, '지표')) { await page.waitForTimeout(1500); await waitContent(page); await shot(page, dir, '21-detail-indicators'); }
      if (await clickText(page, '사업분석')) { await page.waitForTimeout(1500); await waitContent(page); await shot(page, dir, '22-detail-deepdive'); }
    });

    await ctx.close();
  }
  await browser.close();
  console.log('\n🎉 #79 UAT capture ->', OUT);
}
run().catch(e => { console.error('FATAL', e); process.exit(1); });
