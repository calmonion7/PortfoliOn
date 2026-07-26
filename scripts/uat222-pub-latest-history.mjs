// task#222 live smoke — 발행물 목록 종목당 최신 1건 · 문서 내 이력 이동 · 비admin 삭제 버튼 미노출.
// 테스트 계정은 비admin이라 admin 삭제 버튼은 vitest + 사용자 UAT가 커버.
import { chromium, devices } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat222';
fs.mkdirSync(OUT, { recursive: true });

const r = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const { access_token, refresh_token } = await r.json();
const results = [];

async function settle(page) {
  await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1400);
}

async function run(label, ctxOpts) {
  const b = await chromium.launch({ headless: true });
  const page = await (await b.newContext(ctxOpts)).newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([a, rr]) => { localStorage.setItem('access_token', a); localStorage.setItem('refresh_token', rr); }, [access_token, refresh_token]);

  // 1. 심층 리포트 탭 — 종목당 1건, 삭제 버튼 미노출(비admin)
  await page.goto(`${BASE}/analyst-reports`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await page.screenshot({ path: `${OUT}/${label}-01-list.png`, fullPage: true });
  const hrefs = await page.$$eval('a[href^="/analyst-report/"]', els => els.map(e => e.getAttribute('href')));
  const tickers = hrefs.map(h => h.split('/')[2]);
  results.push({ label, screen: 'pub-list',
    cardCount: hrefs.length,
    tickers,
    onePerTicker: new Set(tickers).size === tickers.length,
    deleteBtnHiddenForUser: (await page.locator('button[title="발행물 삭제 (이력 포함)"]').count()) === 0,
    consoleErrors: [...errs] });
  errs.length = 0;

  // 2. 2판 있는 종목(005930) 문서 → '이전 판' 링크 노출
  await page.goto(`${BASE}/analyst-report/005930/2026-07-26`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await page.screenshot({ path: `${OUT}/${label}-02-doc-history.png`, fullPage: false });
  const olderLinks = await page.$$eval('a[href^="/analyst-report/005930/"]', els => els.map(e => e.getAttribute('href')));
  const body = await page.evaluate(() => document.body.innerText || '');
  results.push({ label, screen: 'doc-history',
    docRendered: body.includes('투자 포인트') && body.includes('리스크 요인'),
    hasHistoryLabel: body.includes('이전 판'),
    olderLinks,
    excludesCurrent: !olderLinks.includes('/analyst-report/005930/2026-07-26'),
    consoleErrors: [...errs] });
  errs.length = 0;

  // 3. 이전 판 링크 클릭 → 그 판 문서 렌더
  const older = page.locator('a[href="/analyst-report/005930/2026-07-25"]').first();
  if (await older.isVisible().catch(() => false)) {
    await older.click(); await settle(page);
    const b2 = await page.evaluate(() => document.body.innerText || '');
    await page.screenshot({ path: `${OUT}/${label}-03-older-version.png`, fullPage: false });
    results.push({ label, screen: 'older-version',
      url: page.url(),
      rendered: b2.includes('투자 포인트'),
      showsOlderDate: b2.includes('2026-07-25 발행'),
      backLinkToLatest: (await page.locator('a[href="/analyst-report/005930/2026-07-26"]').count()) > 0,
      consoleErrors: [...errs] });
  } else {
    results.push({ label, screen: 'older-version', skipped: '이전 판 링크 미노출' });
  }

  // 4. 판이 1개인 종목(CRCL) → 이력 섹션 미노출
  errs.length = 0;
  await page.goto(`${BASE}/analyst-report/CRCL/2026-07-26`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  const b3 = await page.evaluate(() => document.body.innerText || '');
  await page.screenshot({ path: `${OUT}/${label}-04-single-version.png`, fullPage: false });
  results.push({ label, screen: 'single-version',
    rendered: b3.includes('투자 포인트'),
    noHistorySection: !b3.includes('이전 판'),
    consoleErrors: [...errs] });

  await b.close();
}

await run('desktop', { viewport: { width: 1440, height: 1000 } });
await run('mobile', { ...devices['iPhone 13'] });
console.log(JSON.stringify(results, null, 2));
