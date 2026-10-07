// task#379 라이브 스모크 — 경합 가드를 넣은 6화면(+SectorTab)이 열리고 콘솔 에러가 0인지.
// 경합 자체는 vitest(재현 테스트 + 게이트별 주입)가 지키고, 이 프로브는 「배포된 번들이 깨지지 않았다」만 본다.
// 각 화면은 「대상에 닿았다」를 독립 축으로 둔다 — 클릭 대상을 못 찾으면 후속 축이 공허해지기 때문이다.
// 연타(월 ›› · 칩 국내→해외 · 섹터 토글 · 검색어 연속 입력)로 가드 경로를 실제로 태운다.
import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat379';
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const lines = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; lines.push(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; lines.push(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const { access_token, refresh_token } = await login.json();
ok('login', !!access_token);

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`${page.url()} :: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`${page.url()} :: pageerror ${e.message}`));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.evaluate(([a, r]) => { localStorage.setItem('access_token', a); localStorage.setItem('refresh_token', r); }, [access_token, refresh_token]);
const settle = (ms = 2500) => page.waitForTimeout(ms);

// 1. 랭킹 — 행 클릭 → 모달 → 닫기, 그리고 A→B 연속 클릭
await page.goto(`${BASE}/ranking`, { waitUntil: 'domcontentloaded' });
await settle(4000);
const rows = page.locator('.card, [class*="card"]').filter({ hasText: /\d/ });
const rowCount = await rows.count();
ok('ranking: 행 도달', rowCount >= 2, `rows=${rowCount}`);
if (rowCount >= 2) {
  await rows.nth(0).click();
  ok('ranking: 모달 열림', await page.locator('.modal-overlay').count() === 1);
  await page.locator('.modal-overlay').click({ position: { x: 5, y: 5 } });
  await settle(3000);   // 늦은 응답이 닫은 모달을 다시 열지 않아야 한다
  ok('ranking: 닫은 모달 재오픈 없음', await page.locator('.modal-overlay').count() === 0);
}

// 2. 캘린더 — 다음 달 연타 후 헤더와 그리드
await page.goto(`${BASE}/calendar`, { waitUntil: 'domcontentloaded' });
await settle();
const next = page.getByLabel('다음 달');
ok('calendar: 다음 달 버튼 도달', await next.count() === 1);
if (await next.count() === 1) {
  await next.click(); await next.click();
  await settle(4000);
  ok('calendar: 그리드 렌더', await page.locator('.cal-grid').count() === 1);
  await page.screenshot({ path: `${OUT}/calendar.png`, fullPage: false });
}

// 3. 발굴 — 칩 국내→해외 연타
await page.goto(`${BASE}/recommend`, { waitUntil: 'domcontentloaded' });
await settle(4000);
const chips = page.locator('.filter-chips button');
ok('recommend: 칩 도달', await chips.count() === 3, `chips=${await chips.count()}`);
if (await chips.count() === 3) {
  await chips.nth(1).click(); await chips.nth(2).click();
  await settle(4000);
  ok('recommend: 해외 칩 활성', (await chips.nth(2).getAttribute('class'))?.includes('is-active'));
  ok('recommend: 실패 문구 없음', await page.getByText('발굴 목록을 불러오지 못했습니다.').count() === 0);
}

// 4. 종목 검색 — 연속 입력
await page.goto(`${BASE}/reports`, { waitUntil: 'domcontentloaded' });
await settle();
const box = page.getByPlaceholder(/종목 검색/).first();
ok('search: 입력창 도달', await box.count() === 1);
if (await box.count() === 1) {
  await box.fill('sam'); await page.waitForTimeout(500);
  await box.fill('samsung'); await settle(3000);
  ok('search: 로딩 표시 해제', await page.getByText('⏳').count() === 0);
}

// 5. 리포트 목록
await page.goto(`${BASE}/reports`, { waitUntil: 'domcontentloaded' });
await settle(4000);
ok('reports: 목록 실패 배너 없음', await page.getByText(/목록을 불러오지 못했/).count() === 0);

// 6. 포트폴리오 — 대시보드 + 분석 › 섹터 토글 연타
await page.goto(`${BASE}/portfolio`, { waitUntil: 'domcontentloaded' });
await settle(5000);
const analysis = page.getByRole('button', { name: '분석' });
ok('portfolio: 분석 탭 도달', await analysis.count() >= 1);
if (await analysis.count() >= 1) {
  await analysis.first().click(); await settle();
  const kr = page.getByRole('button', { name: '🇰🇷 국내' });
  const us = page.getByRole('button', { name: '🇺🇸 해외' });
  ok('sector: 토글 도달', await kr.count() >= 1 && await us.count() >= 1);
  if (await kr.count() >= 1) {
    await kr.first().click(); await us.first().click(); await kr.first().click();
    await settle(5000);
    ok('sector: 국내 레이아웃(업종 헤더)', await page.getByRole('columnheader', { name: '업종' }).count() >= 1);
  }
}

ok('console errors 0', errors.length === 0, errors.slice(0, 5).join(' | '));
await b.close();
console.log(lines.join('\n'));
console.log(`\n단언 총계 ${pass + fail} · PASS ${pass} · FAIL ${fail}`);
process.exit(fail ? 1 : 0);
