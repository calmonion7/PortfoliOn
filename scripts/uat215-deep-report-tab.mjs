// uat215 — 심층 리포트의 화면 경계 (task#215 신설 → task#324/ADR-0047로 전면 재작성)
//
// ⚠️ 재작성 이유 2가지 (둘 다 「게이트가 아니었다」는 문제다):
//  ① 옛 판은 **단언이 0개인 관측 덤프**였다(`exit(`·assert·✓/✗ 0건) → 무엇이 깨져도 exit 0이었다.
//     그래서 정지조건에 쓸 수 없었다(가토: 「이미 도달한 값」은 게이트가 아니다, task#318).
//  ② 대상 종목을 하드코딩(035420 NAVER)했는데 그 발행물이 사라져 축이 **조용히 스킵**됐다
//     ("skipped: link not visible"). 이제 대상은 **런타임에 라이브 데이터에서 고른다** —
//     발행물 목록 ∩ 내 보유 목록에서 하나, 그 여집합에서 하나(대조군).
//
// 재는 것(ADR-0047 적용 결과):
//   ⓐ 발행물 있는 종목 리포트 상세 = 탭 5개이고 「🎯 심층 리포트」가 그중 하나
//   ⓑ 그 탭을 눌러 **그 발행물이 실제로 렌더**된다 — ⓘ identity: API가 준 그 발행물의 `title`이
//      탭 클릭 *전*엔 없고 *후*엔 있다 ⓘⓘ 빈 렌더 차단: 렌즈 표시명 9개 중 1개 이상이 보인다.
//      (task#375: 옛 v1 본문 축 「투자 포인트·적정주가 밴드·투자의견·리스크 요인」은 렌즈 형식 v2
//      — ADR `261006-232406` — 이후 영구 FAIL이라 교체. 렌즈 본문 세부는 uat369의 몫이다.
//      렌즈 이름 축만 두면 다른 종목의 발행물이 떠도 통과하므로 identity와 쌍으로 둔다.)
//   ⓒ 발행물 **없는** 종목 = 탭 4개 (대조군 — 없으면 「항상 5탭」 구현도 통과한다).
//      표본은 발행물 있는/없는 쪽 **둘 다 `!is_etf`** — ETF는 요약·사업분석을 숨겨 탭이 2개다
//      (`ReportDetailTabs.jsx`; task#375 이전엔 대조군이 QQQ로 뽑혀 영구 FAIL이었다).
//   ⓓ enrich 탭이 「📝 사업분석」이고 「심층분석」은 화면에 없다
//   ⓔ 목록의 「심층」 배지가 발행물 있는 종목에만 붙는다(대조군 동봉)
//   ⓕ 문서 단독 라우트가 살아 있고(ⓑ와 같은 identity·렌즈 이름 2축) 「← 종목 리포트」로 돌아온다
//   ⓖ 비-admin이 `/analyst-reports`에 가면 `/reports`로 리다이렉트된다
//   ⓗ nav에 「심층 리포트」 항목이 없고, 문서 경로에서 「리포트」가 active다
//   ⓘ 기술 리포트 업체 표의 상장 티커가 그 종목 리포트를 연다 — 표본은 **내 목록(`/api/report/list`)에
//      있고 리포트 날짜가 있는** 티커로 고른다. 추적하지 않는 티커는 `/reports`에서 목록에 멈추는데
//      그건 제품 결함(CONCERNS §0 B83)이고 이 축의 대상이 아니다(task#375).
//   ⓙ 콘솔 에러 0
//
// 뷰포트 3폭(m278·m390·pc)에서 전부 돌고, 발행물 탭 스크린샷을 screenshots-uat324/에 남긴다
// (시각을 바꾸는 변경은 프로브 PASS 후에도 육안 1장이 필요하다 — 가토 ⓐ).
import { chromium, devices } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat215';
const OUT324 = '/Users/calmonion/Project/PortfoliOn/screenshots-uat324';
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(OUT324, { recursive: true });

const DETAIL_TAB_RE = /^[📊📈📝🎯📅]/;   // 상세 탭 라벨만 — 목록 필터도 .tab-btn을 쓴다

let pass = 0, fail = 0;
const lines = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; lines.push(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; lines.push(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

// ── 라이브에서 대상 고르기 (하드코딩 금지) ────────────────────────────────────
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const { access_token, refresh_token } = await login.json();
const H = { Authorization: `Bearer ${access_token}` };

const pubs = ((await (await fetch(`${BASE}/api/analyst-reports`, { headers: H })).json()).reports || []);
const pubBy = new Map(pubs.map(p => [p.ticker, p.published_date]));
const listResp = await (await fetch(`${BASE}/api/report/list`, { headers: H })).json();
const mine = Object.entries(listResp.stocks || {});
// 보유 탭에서 바로 보이는 종목을 우선(탭 전환 없이 클릭할 수 있다)
const rank = ([, v]) => (v.category === 'holdings' ? 0 : 1);
const withPub = mine.filter(([t, v]) => pubBy.has(t) && !v.is_etf).sort((a, b) => rank(a) - rank(b))[0];
const noPub = mine.filter(([t, v]) => !pubBy.has(t) && !v.is_etf && (v.dates || []).length > 0).sort((a, b) => rank(a) - rank(b))[0];
const pubTitle = new Map(pubs.map(p => [p.ticker, p.title]));
// 렌즈 표시명 — 화면 정본 `frontend/src/components/reports/LensReport.jsx::LENS_INFO`(uat369 `NAMES`와 같은 목록)
const LENS_NAMES = ['숫자의 신뢰도', '지금 매출 속도', '벌수록 남는 구조', '묶여 있는 비용', '망할 위험',
  '고객 이탈 위험', '경영진·대주주', '지금 주가 수준', '앞으로의 수요'];
const tracked = new Set(mine.filter(([, v]) => (v.dates || []).length > 0).map(([t]) => t));

// 기술 리포트 — 내 목록에 있는(추적 중) 상장 티커가 있는 첫 slug
let techSlug = null, techTicker = null;
const techIdx = ((await (await fetch(`${BASE}/api/tech-reports`, { headers: H })).json()).reports || []);
for (const t of techIdx) {
  const d = await (await fetch(`${BASE}/api/tech-reports/${t.slug}`, { headers: H })).json();
  const p = ((d.reports || [])[0]?.players || []).find(x => x.ticker && tracked.has(x.ticker));
  if (p) { techSlug = t.slug; techTicker = p.ticker; break; }
}

// 정의역 sentinel — 표본이 없으면 통과로 위장하지 말고 실패한다(가토: 표본 0은 「미검증」이다)
ok('표본:발행물-있는-종목', !!withPub, withPub ? `${withPub[0]} (${withPub[1].category}, 발행 ${pubBy.get(withPub[0])})` : '없음');
ok('표본:발행물-없는-종목', !!noPub, noPub ? `${noPub[0]} (${noPub[1].category})` : '없음');
ok('표본:기술-업체-티커', !!techSlug, techSlug ? `${techSlug} → ${techTicker}` : '없음');
if (!withPub || !noPub) {
  console.log(lines.join('\n'));
  console.log(`\n단언 총계 ${pass + fail} (PASS ${pass} / FAIL ${fail})`);
  process.exit(1);
}

const PUB_T = withPub[0], PUB_DATE = pubBy.get(PUB_T), NOPUB_T = noPub[0];
const PUB_TITLE = (pubTitle.get(PUB_T) || '').replace(/\s+/g, ' ').trim();
const norm = (s) => s.replace(/\s+/g, ' ');
const lensShown = (body) => LENS_NAMES.filter(n => body.includes(n));

async function settle(page) {
  await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);
}
const detailTabs = (page) => page.evaluate((re) =>
  [...document.querySelectorAll('button.tab-btn')].map(b => b.textContent.trim()).filter(t => new RegExp(re).test(t)),
  DETAIL_TAB_RE.source);

// ⚠️ 목록은 폭·뷰에 따라 사이드바(.report-item)와 카드(.stock-card) 중 한쪽이 `display:none`이다
// (pc.css: [data-view=list] .reports-sidebar / [data-view=detail] 반대). DOM에는 둘 다 있으므로
// **가시 요소를 골라** 클릭해야 한다 — .first()는 숨은 쪽을 집어 30초 타임아웃으로 죽는다.
async function clickFirstVisible(loc) {
  const n = await loc.count();
  for (let i = 0; i < n; i++) {
    const el = loc.nth(i);
    if (await el.isVisible().catch(() => false)) { await el.click(); return true; }
  }
  return false;
}
async function openDetail(page, ticker) {
  for (const sel of ['.report-item', '.stock-card']) {
    if (await clickFirstVisible(page.locator(sel, { hasText: ticker }))) { await settle(page); return true; }
  }
  return false;
}

async function run(label, ctxOpts) {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ ...ctxOpts, serviceWorkers: 'block' });   // SW가 /api/*를 가로챈다
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([a, r]) => { localStorage.setItem('access_token', a); localStorage.setItem('refresh_token', r); }, [access_token, refresh_token]);

  // ── ⓔ 목록의 「심층」 배지 (대조군 동봉) ──────────────────────────────────
  await page.goto(`${BASE}/reports`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  const badge = await page.evaluate(([pt, npt]) => {
    // 사이드바 행·카드 둘 다 같은 hasPub 계약을 진다 — 렌더된 쪽 전부를 본다(하나만 보면
    // 폭에 따라 축이 조용히 다른 렌더러를 재게 된다).
    const nodes = (t) => [...document.querySelectorAll('.report-item, .stock-card')].filter(el => el.textContent.includes(t));
    const has = (t) => { const ns = nodes(t); return ns.length === 0 ? null : ns.some(el => el.textContent.includes('심층')); };
    return { pub: has(pt), noPub: has(npt), n: nodes(pt).length };
  }, [PUB_T, NOPUB_T]);
  ok(`[${label}] 배지:발행물-있는-종목에-붙는다`, badge.pub === true, `${PUB_T} → ${badge.pub} (노드 ${badge.n}개)`);
  ok(`[${label}] 배지:없는-종목엔-안-붙는다(대조군)`, badge.noPub === false, `${NOPUB_T} → ${badge.noPub}`);

  // ── ⓐⓑⓓ 발행물 있는 종목 = 5탭 + 본문 렌더 ──────────────────────────────
  const opened = await openDetail(page, PUB_T);
  ok(`[${label}] 상세진입:${PUB_T}`, opened);
  let tabs = opened ? await detailTabs(page) : [];
  ok(`[${label}] 탭5개`, tabs.length === 5, `[${tabs.join(' | ')}]`);
  ok(`[${label}] 심층리포트탭-존재`, tabs.some(t => t.includes('심층 리포트')));
  ok(`[${label}] 사업분석-라벨`, tabs.some(t => t.includes('사업분석')), '개명 양성 축');
  ok(`[${label}] 심층분석-라벨-부재`, !tabs.some(t => t.includes('심층분석')));

  if (tabs.some(t => t.includes('심층 리포트'))) {
    // identity는 「클릭 전엔 없다」와 쌍이어야 이빨이 있다 — 탭 밖(목록 카드 등)에 같은 제목이 있으면 거짓 통과한다
    const before = norm(await page.evaluate(() => document.body.innerText || ''));
    await page.locator('button.tab-btn', { hasText: '심층 리포트' }).first().click();
    await settle(page);
    const body = norm(await page.evaluate(() => document.body.innerText || ''));
    ok(`[${label}] 탭내용:그-발행물-title(identity)`, !!PUB_TITLE && !before.includes(PUB_TITLE) && body.includes(PUB_TITLE),
      `클릭전=${before.includes(PUB_TITLE)} 클릭후=${body.includes(PUB_TITLE)} · ${PUB_TITLE.slice(0, 30)}…`);
    const shown = lensShown(body);
    ok(`[${label}] 탭내용:렌즈이름-1개이상`, shown.length >= 1, `${shown.length}/9`);
    // 탭 안에 머문다 — 라우팅으로 문서 페이지로 튀지 않는다
    ok(`[${label}] 탭안에-머문다`, page.url().includes('/reports'), page.url());
    await page.screenshot({ path: `${OUT324}/${label}-deep-tab.png`, fullPage: false });
    await page.screenshot({ path: `${OUT}/${label}-01-deep-tab.png`, fullPage: false });
  } else {
    ok(`[${label}] 탭내용:그-발행물-title(identity)`, false, '탭 자체가 없어 측정 불가');
    ok(`[${label}] 탭내용:렌즈이름-1개이상`, false, '탭 자체가 없어 측정 불가');
  }

  // ── ⓒ 발행물 없는 종목 = 4탭 (대조군) ───────────────────────────────────
  await page.goto(`${BASE}/reports`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  const opened2 = await openDetail(page, NOPUB_T);
  ok(`[${label}] 상세진입:${NOPUB_T}`, opened2);
  tabs = opened2 ? await detailTabs(page) : [];
  ok(`[${label}] 탭4개(대조군)`, tabs.length === 4, `[${tabs.join(' | ')}]`);
  ok(`[${label}] 심층리포트탭-부재(대조군)`, !tabs.some(t => t.includes('심층 리포트')));

  // ── ⓕ 문서 단독 라우트 + 복귀 ────────────────────────────────────────────
  await page.goto(`${BASE}/analyst-report/${PUB_T}/${PUB_DATE}`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  const docBody = norm(await page.evaluate(() => document.body.innerText || ''));
  ok(`[${label}] 문서라우트:그-발행물-title(identity)`, !!PUB_TITLE && docBody.includes(PUB_TITLE), PUB_TITLE.slice(0, 30));
  const docShown = lensShown(docBody);
  ok(`[${label}] 문서라우트:렌즈이름-1개이상`, docShown.length >= 1, `${docShown.length}/9`);
  const pill = page.locator('.list-pill').first();
  const pillTxt = (await pill.count()) ? (await pill.textContent()).trim() : '(없음)';
  ok(`[${label}] 문서라우트:복귀링크`, pillTxt.includes('종목 리포트'), pillTxt);
  // ⓗ 문서 경로에서 nav 상태
  const navState = await page.evaluate(() => {
    const links = [...document.querySelectorAll('a')];
    const named = (n) => links.filter(a => a.textContent.trim() === n);
    const activeOf = (n) => named(n).some(a => a.className.includes('is-active'));
    return { deepItem: named('심층 리포트').length, reportActive: activeOf('리포트'), techActive: activeOf('주요기술') };
  });
  ok(`[${label}] nav:심층리포트-항목-없음`, navState.deepItem === 0, `${navState.deepItem}개`);
  ok(`[${label}] nav:문서경로에서-리포트-active`, navState.reportActive === true);
  ok(`[${label}] nav:주요기술은-active-아님(대조군)`, navState.techActive === false);
  if (pillTxt.includes('종목 리포트')) {
    await pill.click(); await settle(page);
    ok(`[${label}] 복귀:리포트로-도달`, new URL(page.url()).pathname === '/reports', page.url());
  } else {
    ok(`[${label}] 복귀:리포트로-도달`, false, '복귀 링크 없음');
  }

  // ── ⓖ 비-admin 리다이렉트 ────────────────────────────────────────────────
  await page.goto(`${BASE}/analyst-reports`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  ok(`[${label}] 비-admin:목록→리포트-리다이렉트`, new URL(page.url()).pathname === '/reports', page.url());
  const afterBody = await page.evaluate(() => document.body.innerText || '');
  ok(`[${label}] 비-admin:관리수단-미노출`, !afterBody.includes('자동 발행 대상 관리'));

  // ── ⓘ 기술 업체표 티커 → 종목 리포트 ────────────────────────────────────
  if (techSlug) {
    await page.goto(`${BASE}/tech-report/${techSlug}`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    const tlink = page.locator(`a[href="/reports"]`).filter({ hasText: techTicker }).first();
    const found = await tlink.count() > 0;
    ok(`[${label}] 기술:티커가-링크다`, found, `${techSlug}/${techTicker}`);
    // 대조군 — 비상장 업체(티커 없는 행)는 링크가 아니다: 업체 표의 링크 수 == 티커 있는 업체 수 이하
    const linkCnt = await page.locator('table a[href="/reports"]').count();
    ok(`[${label}] 기술:링크는-티커있는-행만`, linkCnt > 0 && linkCnt <= await page.locator('table tr').count(), `${linkCnt}개`);
    if (found) {
      await tlink.click(); await settle(page);
      ok(`[${label}] 기술:클릭시-리포트-도달`, new URL(page.url()).pathname === '/reports', page.url());
      const rBody = await page.evaluate(() => document.body.innerText || '');
      ok(`[${label}] 기술:그-종목-상세가-열린다`, rBody.includes(techTicker), `${techTicker}`);
    }
  }

  ok(`[${label}] 콘솔에러 0`, errs.length === 0, errs.slice(0, 2).join(' / '));
  await b.close();
}

await run('pc', { viewport: { width: 1440, height: 1000 } });
await run('m390', { ...devices['iPhone 13'] });
await run('m278', { viewport: { width: 278, height: 664 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: devices['iPhone 13'].userAgent });

console.log(lines.join('\n'));
console.log(`\n단언 총계 ${pass + fail} (PASS ${pass} / FAIL ${fail})`);
process.exit(fail > 0 ? 1 : 0);
