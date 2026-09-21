// task#358 육안 스크린샷 3장 — 프로브 ALL PASS 뒤에도 필수(CLAUDE.md 가토 ⓐ).
//   ① m390 사업분석 탭 상단(결론 한 줄 + stance 칩 + 「시장」 헤더)
//   ② pc1440 사업분석 탭 「경쟁」 단(경쟁사 → 관련 기술 행)
//   ③ m390 「심층 리포트」 탭 임베드(컨센서스 근거 접힘 상태)
// 계측값도 함께 찍어 육안 판단을 수치로 보조한다(헤더 순서·관련 기술 행 수·접힘 여부).
import { chromium, devices } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat358';
const TICKER = '005930';
fs.mkdirSync(OUT, { recursive: true });

const r = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const { access_token, refresh_token } = await r.json();

async function settle(page, ms = 1500) {
  await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

// 상세 진입 — 리포트 목록에서 종목을 클릭해야 상세가 열린다(uat212와 동일 경로).
async function openDetail(page) {
  await page.goto(`${BASE}/reports`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  const wl = page.locator('button, a').filter({ hasText: /^관심/ }).first();
  if (await wl.isVisible().catch(() => false)) { await wl.click(); await settle(page); }
  const side = page.locator('.reports-sidebar >> text=삼성전자').first();
  const card = page.locator('.stock-card-grid >> text=삼성전자').first();
  const t = (await side.isVisible().catch(() => false)) ? side
    : (await card.isVisible().catch(() => false)) ? card : null;
  if (!t) return false;
  await t.click();
  await settle(page);
  return true;
}

const clickTab = (page, label) => page.evaluate((l) => {
  Array.from(document.querySelectorAll('.tab-btn')).filter(t => (t.textContent || '').includes(l)).forEach(t => t.click());
}, label);

const out = {};

for (const [key, opts] of [['m390', { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } }],
                           ['pc1440', { viewport: { width: 1440, height: 1000 } }]]) {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ ...opts, serviceWorkers: 'block' });
  await ctx.addInitScript(([a, rr]) => {
    localStorage.setItem('access_token', a); localStorage.setItem('refresh_token', rr);
    localStorage.setItem('pwa-install-dismissed-at', String(Date.now()));
  }, [access_token, refresh_token]);
  const page = await ctx.newPage();

  if (!(await openDetail(page))) { out[key] = { error: '상세 진입 실패 — 계측 실패이지 판정 실패가 아니다' }; await b.close(); continue; }

  await clickTab(page, '사업분석');
  await settle(page);

  const m = await page.evaluate(() => {
    const heads = Array.from(document.querySelectorAll('[data-testid="group-header"]')).map(e => (e.textContent || '').trim());
    const rows = Array.from(document.querySelectorAll('[data-testid="related-tech-row"]'));
    return {
      groupHeaders: heads,
      relatedTechRows: rows.length,
      relatedTechText: rows.map(e => (e.textContent || '').replace(/\s+/g, ' ').trim()),
      deepLine: !!Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('심층 리포트 탭')),
    };
  });
  out[key] = m;

  // ① / ② — 사업분석 탭. 모바일은 상단(결론), PC는 「경쟁」 단으로 스크롤.
  if (key === 'm390') {
    await page.screenshot({ path: `${OUT}/01-m390-analysis-top.png`, fullPage: false });
  } else {
    await page.evaluate(() => {
      const h = Array.from(document.querySelectorAll('[data-testid="group-header"]')).find(e => (e.textContent || '').trim() === '경쟁');
      if (h) h.scrollIntoView({ block: 'start' });
    });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/02-pc1440-competition.png`, fullPage: false });
  }

  // ③ — 심층 리포트 탭 임베드(컨센서스 접힘). 모바일만.
  if (key === 'm390') {
    await clickTab(page, '심층 리포트');
    await settle(page, 2000);
    const deep = await page.evaluate(() => {
      const tg = document.querySelector('[data-testid="consensus-toggle"]');
      return {
        toggle: tg ? (tg.textContent || '').trim() : null,
        expanded: tg ? tg.getAttribute('aria-expanded') : null,
        brokerageVisible: (document.body.textContent || '').includes('증권사별'),
      };
    });
    out.deepEmbed = deep;
    await page.evaluate(() => {
      const tg = document.querySelector('[data-testid="consensus-toggle"]');
      if (tg) tg.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/03-m390-deep-consensus-collapsed.png`, fullPage: false });
  }

  await b.close();
}

console.log(JSON.stringify(out, null, 2));
