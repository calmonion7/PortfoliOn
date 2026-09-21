import { chromium, devices } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat212';
fs.mkdirSync(OUT, { recursive: true });

const r = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const { access_token, refresh_token } = await r.json();

const results = [];

async function waitSettled(page) {
  await page.waitForFunction(
    () => document.querySelectorAll('.skeleton-block').length === 0,
    { timeout: 15000 }
  ).catch(() => {});
  await page.waitForTimeout(1500);
}

async function run(label, ctxOpts) {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext(ctxOpts);
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([a, rr]) => {
    localStorage.setItem('access_token', a);
    localStorage.setItem('refresh_token', rr);
  }, [access_token, refresh_token]);

  // 1. 리서치 목록 — 발행물 섹션
  await page.goto(`${BASE}/reports`, { waitUntil: 'domcontentloaded' });
  await waitSettled(page);
  let body = await page.evaluate(() => document.body.innerText || '');
  await page.screenshot({ path: `${OUT}/${label}-01-reports-list.png`, fullPage: false });
  results.push({ label, screen: 'reports-list',
    hasPubSection: body.includes('애널리스트 리포트 발행물'),
    hasPubEntry: body.includes('2026-07-25'),
    consoleErrors: [...consoleErrors] });
  consoleErrors.length = 0;

  // 2. 발행물 목록에서 문서 페이지 진입(클릭)
  const link = page.locator('a[href^="/analyst-report/005930/"]').first();
  const linkVisible = await link.isVisible().catch(() => false);
  if (linkVisible) await link.click();
  else await page.goto(`${BASE}/analyst-report/005930/2026-07-25`, { waitUntil: 'domcontentloaded' });
  await waitSettled(page);
  body = await page.evaluate(() => document.body.innerText || '');
  await page.screenshot({ path: `${OUT}/${label}-02-doc-top.png`, fullPage: false });
  await page.screenshot({ path: `${OUT}/${label}-03-doc-full.png`, fullPage: true });
  results.push({ label, screen: 'doc', enteredByClick: linkVisible,
    sections: {
      header: body.includes('적정주가 밴드') && body.includes('발행 시점 현재가'),
      rating: body.includes('매수'),
      consensusTarget: body.includes('컨센서스 평균 목표가'),
      points: body.includes('투자 포인트'),
      valuation: body.includes('밸류에이션') && body.includes('밴드'),
      peers: body.includes('SK하이닉스') || body.includes('피어'),
      estimates: body.includes('실적 추정') && body.includes('(E)'),
      risks: body.includes('리스크 요인'),
    },
    consoleErrors: [...consoleErrors] });
  consoleErrors.length = 0;

  // 3. 리포트 상세 헤더 링크 (005930 상세 → 애널리스트 리포트 배지)
  // 발행물 섹션 링크가 아니라 리포트 목록(사이드바/카드)의 종목을 클릭해야 상세가 열린다
  await page.goto(`${BASE}/reports`, { waitUntil: 'domcontentloaded' });
  await waitSettled(page);
  // 005930은 test 계정 관심 탭에 있다 — 탭 전환 후 클릭
  const wlTab = page.locator('button, a').filter({ hasText: /^관심/ }).first();
  if (await wlTab.isVisible().catch(() => false)) { await wlTab.click(); await waitSettled(page); }
  const item = page.locator('.reports-sidebar >> text=삼성전자').first();
  const cardItem = page.locator('.stock-card-grid >> text=삼성전자').first();
  const target = (await item.isVisible().catch(() => false)) ? item
    : (await cardItem.isVisible().catch(() => false)) ? cardItem : null;
  if (target) {
    await target.click();
    await waitSettled(page);
    body = await page.evaluate(() => document.body.innerText || '');
    await page.screenshot({ path: `${OUT}/${label}-04-detail-entry.png`, fullPage: false });
    // task#358: 헤더의 「애널리스트 리포트 →」 칩은 제거됐다(ADR `260921-091825` 결정 2) —
    // 같은 목적지로 가는 진입점은 이제 「심층 리포트」 **탭**이다. 축을 지우지 않고 그리로 옮긴다.
    const hasDeepTab = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.tab-btn')).some(t => (t.textContent || '').includes('심층 리포트')));
    results.push({ label, screen: 'detail-entry',
      hasEntryLink: hasDeepTab,
      consoleErrors: [...consoleErrors] });
  } else {
    results.push({ label, screen: 'detail-entry', skipped: 'test 계정 목록에 005930 미노출' });
  }

  await b.close();
}

await run('desktop', { viewport: { width: 1440, height: 1000 } });
await run('mobile', { ...devices['iPhone 13'] });

console.log(JSON.stringify(results, null, 2));
