// task#359 육안 스크린샷 2장 — 프로브 통과 뒤에도 필수(CLAUDE.md 가토 ⓐ).
//   ① m390 기술 리포트 상단~「경쟁」 단 — 그룹 헤더와 플로팅 바 칩 4개가 함께 보이는 프레임
//   ② pc1440 「우위」~「근거」 단
// 「장 라벨(4) + 단 헤더(7)」 2수준이 실제로 읽히는지, 두 헤더가 붙는 자리에서 구분선이
// 겹쳐 보이지 않는지가 육안 판단의 핵심이다(계측만으로는 알 수 없다).
// 바 높이는 착수 시와 같은지 수치로 병기한다(계획 DoD 6).
import { chromium, devices } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat359';
const SLUG = process.env.SLUG || 'smr';
fs.mkdirSync(OUT, { recursive: true });

const r = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const { access_token, refresh_token } = await r.json();

const measure = (page) => page.evaluate(() => {
  const txt = (e) => (e.textContent || '').trim();
  const bar = document.querySelector('[data-tech-chapter-nav]');
  return {
    stageHeaders: [...document.querySelectorAll('[data-testid="group-header"]')].map(txt),
    chapterLabels: [...document.querySelectorAll('[data-tech-chapter]')].map(txt),
    sectionOrder: [...document.querySelectorAll('[data-tech-section]')].map(e => e.getAttribute('data-tech-section')),
    tocChips: [...document.querySelectorAll('[data-testid="tech-toc-chip"]')].map(txt),
    barChips: bar ? [...bar.querySelectorAll('[data-tech-chapter-nav-chip]')].map(txt) : null,
    barHeight: bar ? Math.round(bar.getBoundingClientRect().height) : null,
  };
});

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
  await page.goto(`${BASE}/tech-report/${SLUG}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1800);

  if (key === 'm390') {
    // 「경쟁」 단으로 스크롤해 바가 뜬 상태(스크롤 후에만 보인다)에서 찍는다.
    await page.evaluate(() => {
      const h = [...document.querySelectorAll('[data-testid="group-header"]')].find(e => (e.textContent || '').trim() === '경쟁');
      if (h) h.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(900);
    out[key] = await measure(page);
    await page.screenshot({ path: `${OUT}/01-m390-competition-with-bar.png`, fullPage: false });
  } else {
    await page.evaluate(() => {
      const h = [...document.querySelectorAll('[data-testid="group-header"]')].find(e => (e.textContent || '').trim() === '우위');
      if (h) h.scrollIntoView({ block: 'start' });
    });
    await page.waitForTimeout(900);
    out[key] = await measure(page);
    await page.screenshot({ path: `${OUT}/02-pc1440-edge-to-evidence.png`, fullPage: false });
  }
  await b.close();
}

console.log(JSON.stringify(out, null, 2));
