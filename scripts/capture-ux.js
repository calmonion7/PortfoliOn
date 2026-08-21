// UI/UX audit capture — prod + test account, headless, mobile + PC.
// task#78 (ui-ux-service-audit). Output: ../screenshots/<viewport>/<nn>-<screen>.png
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'https://portfolion.taebro.com';
const EMAIL = 'test@portfolion.com';
const PASSWORD = 'test1234';
const OUT = path.join(__dirname, '..', 'screenshots');

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
  return res.json(); // { access_token, refresh_token }
}

async function settle(page, ms = 2500) {
  try { await page.waitForLoadState('domcontentloaded', { timeout: 8000 }); } catch {}
  await page.waitForTimeout(ms);
  // trigger lazy/intersection-rendered charts
  try {
    await page.evaluate(async () => {
      const h = document.body.scrollHeight;
      for (let y = 0; y < h; y += window.innerHeight * 0.8) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); }
      window.scrollTo(0, 0);
    });
  } catch {}
  await page.waitForTimeout(900);
}

async function shot(page, dir, name) {
  const file = path.join(dir, name + '.png');
  await page.screenshot({ path: file, fullPage: true });
  console.log('   ✅', name);
}

// click first visible clickable whose trimmed text contains `label`
async function clickText(page, label, { exact = false } = {}) {
  const handle = await page.evaluateHandle(({ label, exact }) => {
    const els = [...document.querySelectorAll('button, .tab-btn, a, [role=tab]')];
    const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const norm = s => (s || '').replace(/\s+/g, ' ').trim();
    let m = els.find(el => vis(el) && (exact ? norm(el.textContent) === label : norm(el.textContent).includes(label)));
    if (m) { m.scrollIntoView({ block: 'center' }); m.click(); return true; }
    return false;
  }, { label, exact });
  const ok = await handle.jsonValue();
  return ok;
}

async function run() {
  const { access_token, refresh_token } = await getTokens();
  console.log('🔐 tokens acquired');
  const browser = await chromium.launch({ headless: true });

  for (const vp of VIEWPORTS) {
    const dir = path.join(OUT, vp.key);
    fs.mkdirSync(dir, { recursive: true });
    console.log(`\n=== ${vp.key} (${vp.width}x${vp.height}) ===`);
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.isMobile, hasTouch: vp.hasTouch, deviceScaleFactor: vp.dsf,
    });
    const page = await ctx.newPage();

    // 1. Login page (logged out)
    try { await page.goto(BASE, { waitUntil: 'domcontentloaded' }); await settle(page, 1800); await shot(page, dir, '00-login'); }
    catch (e) { console.log('   ⚠ login page', e.message); }

    // 2. Inject tokens -> logged in
    await page.evaluate(([a, r]) => { localStorage.setItem('access_token', a); localStorage.setItem('refresh_token', r); }, [access_token, refresh_token]);

    const step = async (name, fn) => { try { await fn(); } catch (e) { console.log('   ⚠', name, e.message); } };

    // 3. Research (/)
    await step('research', async () => {
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await settle(page);
      await shot(page, dir, '10-research-reports');
      for (const [label, nm] of [['추천','11-research-recommendations'],['랭킹','12-research-ranking'],['다이제스트','13-research-digest'],['캘린더','14-research-calendar']]) {
        if (await clickText(page, label, { exact: true })) { await settle(page); await shot(page, dir, nm); }
        else console.log('   ⚠ tab not found:', label);
      }
    });

    // 4. Report detail (from 리포트 tab -> 관심 sub-tab -> click a card with a report)
    await step('report-detail', async () => {
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await settle(page);
      await clickText(page, '리포트', { exact: true }); await settle(page, 1200);
      await clickText(page, '관심'); await settle(page, 1200);
      // try first few cards until detail tabs appear
      const cards = await page.$$('.stock-card');
      let opened = false;
      for (let i = 0; i < Math.min(cards.length, 6) && !opened; i++) {
        try {
          await cards[i].scrollIntoViewIfNeeded(); await cards[i].click(); await page.waitForTimeout(1800);
          opened = await page.evaluate(() => [...document.querySelectorAll('.tab-btn')].some(b => /요약|지표|사업분석|히스토리/.test(b.textContent)));
        } catch {}
      }
      if (!opened) { console.log('   ⚠ report detail did not open'); return; }
      await settle(page, 800); await shot(page, dir, '20-report-detail-summary');
      for (const [label, nm] of [['지표','21-report-detail-indicators'],['사업분석','22-report-detail-deepdive'],['히스토리','23-report-detail-history']]) {
        if (await clickText(page, label)) { await settle(page, 1500); await shot(page, dir, nm); }
      }
    });

    // 5. Portfolio (/portfolio)
    await step('portfolio', async () => {
      await page.goto(BASE + '/portfolio', { waitUntil: 'domcontentloaded' }); await settle(page);
      await shot(page, dir, '30-portfolio-dashboard');
      if (await clickText(page, '분석', { exact: true })) {
        await settle(page);
        for (const [label, nm] of [['섹터','31-portfolio-analysis-sector'],['매크로','32-portfolio-analysis-macro'],['상관관계','33-portfolio-analysis-correlation']]) {
          if (await clickText(page, label, { exact: true })) { await settle(page); await shot(page, dir, nm); }
        }
      }
    });

    // 6. Market (/market)
    await step('market', async () => {
      await page.goto(BASE + '/market', { waitUntil: 'domcontentloaded' }); await settle(page, 3200);
      await shot(page, dir, '40-market-indicators');
      if (await clickText(page, '수급지표', { exact: true })) { await settle(page, 3200); await shot(page, dir, '41-market-supply'); }
    });

    // 7. Guru (/guru)
    await step('guru', async () => {
      await page.goto(BASE + '/guru', { waitUntil: 'domcontentloaded' }); await settle(page);
      await shot(page, dir, '50-guru-managers');
      if (await clickText(page, '추천 통계', { exact: true })) { await settle(page); await shot(page, dir, '51-guru-stats'); }
    });

    // 8. Settings (/settings) — light pass
    await step('settings', async () => {
      await page.goto(BASE + '/settings', { waitUntil: 'domcontentloaded' }); await settle(page);
      await shot(page, dir, '60-settings');
    });

    await ctx.close();
  }
  await browser.close();
  console.log('\n🎉 capture complete ->', OUT);
}

run().catch(e => { console.error('FATAL', e); process.exit(1); });
