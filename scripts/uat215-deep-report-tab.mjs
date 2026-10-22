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
//   ⓕ 문서 단독 라우트가 살아 있고(ⓑ와 같은 identity·렌즈 이름 2축) 「← 심층 목록」으로 `/analyst-reports`에 돌아온다
//      (task#402 — 옛 목적지 「← 종목 리포트」는 task#396 목록 재개방으로 근거가 사라졌다).
//      ⓕ' 내 목록 밖 발행물: 심층 목록 카드 → 문서 → pill → 다시 `/analyst-reports`(표본 0이면 sentinel FAIL)
//   ⓖ 비-admin이 `/analyst-reports`에 가면 **머문다**(task#396 — 리다이렉트 폐지, 목록 전 사용자 재개방):
//      URL 유지 · 발행물 링크 ≥ 1 · 목록 API 첫 발행물의 이름/티커가 보임(identity) · 관리 수단 미노출
//   ⓗ nav에 「심층 리포트」 항목이 없고, 문서 경로에서 「심층」이 active다(「리포트」·「기술」은 아님 — 대조군, task#396)
//   ⓘ 기술 리포트 업체 표의 상장 티커가 그 종목 리포트를 연다 — 표본은 **내 목록(`/api/report/list`)에
//      있고 리포트 날짜가 있는** 티커로 고른다. 「열렸다」는 본문 어딘가의 티커 문자열이 아니라
//      `.reports-layout[data-view="detail"]` + **상세 영역(.reports-main) 안** 티커로 잰다(task#378 —
//      본문 전체에서 찾으면 목록 카드·안내 배너의 같은 티커로 거짓 통과한다). 대조군: 배너가 없다.
//   ⓚ (task#378, B83) 업체 표의 **미추적** 티커(내 목록에 키가 없음)를 누르면 목록에 머물되 조용히 멈추지
//      않는다 — 안내 배너(그 티커 + 「추적하지 않는」) · 「관심종목에 추가」 버튼 · 버튼이 그 티커로 채워진
//      관심 모달을 연다 · **닫기만 한다**(POST /api/watchlist 0건 — 프로덕션 쓰기 금지) · 닫은 뒤에도 목록.
//      표본은 런타임에 고르고 0이면 sentinel FAIL. 배너 넘침(뷰포트 밖·문서 가로 스크롤) 0도 함께 잰다.
//   ⓖ' (task#397, B54) 목록 카드의 이름·한줄 논지가 잘리지 않는다 — 커버리지(잰 카드 == 카드 수 > 0) ·
//      scrollWidth ≤ clientWidth + text-overflow≠ellipsis · 문서 가로 넘침 0 · 우측 묶음·날짜 right가 카드 간
//      ±0.5px(+ marginRight 주입 대조군 FAIL) · 이름 높이 ≤ 2줄(낱자 적층 sentinel). m350·m390·pc만(m278 제외).
//   ⓙ 콘솔 에러 0
//
// 뷰포트 4폭(m278·m350·m390·pc)에서 전부 돌고, 발행물 탭 스크린샷을 screenshots-uat324/에 남긴다
// (시각을 바꾸는 변경은 프로브 PASS 후에도 육안 1장이 필요하다 — 가토 ⓐ).
import { chromium, devices } from 'playwright';
import fs from 'fs';

const BASE = process.env.BASE || 'https://portfolion.taebro.com';
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
// ⓕ' 표본 — 발행물은 있는데 내 목록(키)에 없는 종목(task#402: 이 종목들의 도달 경로는 심층 목록뿐이다)
const outPub = pubs.find(p => !mine.some(([t]) => t === p.ticker));
const OUT_T = outPub?.ticker, OUT_DATE = outPub?.published_date;

// 기술 리포트 — 내 목록에 있는(추적 중) 상장 티커가 있는 첫 slug, 그리고 **미추적** 티커(B83 표본)
// 미추적 = 내 목록에 키 자체가 없음(날짜 0인 추적 종목은 「미생성」이지 미추적이 아니다).
const myKeys = new Set(mine.map(([t]) => t));
let techSlug = null, techTicker = null, untrSlug = null, untrTicker = null;
const techIdx = ((await (await fetch(`${BASE}/api/tech-reports`, { headers: H })).json()).reports || []);
for (const t of techIdx) {
  const d = await (await fetch(`${BASE}/api/tech-reports/${t.slug}`, { headers: H })).json();
  const players = (d.reports || [])[0]?.players || [];
  const p = players.find(x => x.ticker && tracked.has(x.ticker));
  if (p && !techSlug) { techSlug = t.slug; techTicker = p.ticker; }
  // 다른 업체 티커의 부분문자열이 아닌 것만 — 링크를 hasText로 고르므로 오클릭을 막는다
  const all = players.map(x => x.ticker).filter(Boolean);
  const u = players.find(x => x.ticker && !myKeys.has(x.ticker.toUpperCase())
    && !all.some(o => o !== x.ticker && o.includes(x.ticker)));
  if (u && !untrSlug) { untrSlug = t.slug; untrTicker = u.ticker.toUpperCase(); }
  if (techSlug && untrSlug) break;
}

// 정의역 sentinel — 표본이 없으면 통과로 위장하지 말고 실패한다(가토: 표본 0은 「미검증」이다)
ok('표본:발행물-있는-종목', !!withPub, withPub ? `${withPub[0]} (${withPub[1].category}, 발행 ${pubBy.get(withPub[0])})` : '없음');
ok('표본:발행물-없는-종목', !!noPub, noPub ? `${noPub[0]} (${noPub[1].category})` : '없음');
ok('표본:내-목록-밖-발행물(task#402)', !!OUT_T, OUT_T ? `${OUT_T} (발행 ${OUT_DATE})` : '없음');
ok('표본:기술-업체-티커', !!techSlug, techSlug ? `${techSlug} → ${techTicker}` : '없음');
ok('표본:미추적-기술-티커', !!untrSlug, untrSlug ? `${untrSlug} → ${untrTicker}` : '없음');
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
  ok(`[${label}] 문서라우트:복귀링크`, pillTxt === '← 심층 목록', pillTxt);
  // ⓗ 문서 경로에서 nav 상태
  const navState = await page.evaluate(() => {
    const links = [...document.querySelectorAll('a')];
    const named = (n) => links.filter(a => a.textContent.trim() === n);
    const activeOf = (n) => named(n).some(a => a.className.includes('is-active'));
    return { deepItem: named('심층 리포트').length, deepActive: activeOf('심층'), reportActive: activeOf('리포트'), techActive: activeOf('기술') };
  });
  ok(`[${label}] nav:심층리포트-항목-없음`, navState.deepItem === 0, `${navState.deepItem}개`);
  ok(`[${label}] nav:문서경로에서-심층-active`, navState.deepActive === true);
  ok(`[${label}] nav:리포트는-active-아님(대조군)`, navState.reportActive === false);
  ok(`[${label}] nav:기술은-active-아님(대조군)`, navState.techActive === false);
  if (pillTxt === '← 심층 목록') {
    await pill.click(); await settle(page);
    ok(`[${label}] 복귀:심층목록-도달`, new URL(page.url()).pathname === '/analyst-reports', page.url());
  } else {
    ok(`[${label}] 복귀:심층목록-도달`, false, '복귀 링크 없음');
  }
  // ⓕ' (task#402) 내 목록 밖 종목 — 목록 카드로 들어가 pill로 돌아오면 목록이다(옛 목적지 /reports는 「미추적」 안내로 떨어졌다)
  if (OUT_T) {
    await page.goto(`${BASE}/analyst-reports`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    const card = page.locator(`a[href="/analyst-report/${OUT_T}/${OUT_DATE}"]`).first();
    if (await card.count()) {
      await card.click(); await settle(page);
      ok(`[${label}] 미추적:카드→문서`, new URL(page.url()).pathname === `/analyst-report/${OUT_T}/${OUT_DATE}`, page.url());
      const p2 = page.locator('.list-pill').first();
      if (await p2.count()) {
        await p2.click(); await settle(page);
        ok(`[${label}] 미추적:복귀→심층목록`, new URL(page.url()).pathname === '/analyst-reports', page.url());
      } else ok(`[${label}] 미추적:복귀→심층목록`, false, 'pill 없음');
    } else ok(`[${label}] 미추적:카드→문서`, false, `카드 링크 없음 ${OUT_T}`);
  }

  // ── ⓖ 비-admin 목록 열람(task#396 — 리다이렉트 폐지) ────────────────────────
  await page.goto(`${BASE}/analyst-reports`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  ok(`[${label}] 비-admin:목록-URL-유지`, new URL(page.url()).pathname === '/analyst-reports', page.url());
  const pubLinks = await page.locator('a[href^="/analyst-report/"]').count();
  ok(`[${label}] 비-admin:발행물-링크-1개이상`, pubLinks >= 1, `${pubLinks}개 (API ${pubs.length}건)`);
  const afterBody = await page.evaluate(() => document.body.innerText || '');
  const firstPub = pubs[0] || {};
  ok(`[${label}] 비-admin:첫-발행물-identity`, !!(firstPub.name || firstPub.ticker) && afterBody.includes(firstPub.name || firstPub.ticker), firstPub.name || firstPub.ticker || '(발행물 0 — 미검증)');
  ok(`[${label}] 비-admin:관리수단-미노출`, !afterBody.includes('자동 발행 대상 관리'));

  // ── ⓖ' 목록 카드가 이름·한줄 논지를 자르지 않는다(task#397, B54) — m278은 계획 범위 밖이라 재지 않는다 ──
  // 요소는 구조가 아니라 텍스트로 찾는다(옛 2행 구조에서도 같은 축이 돌아 red-first가 가능하다).
  if (label !== 'm278') {
    const c = await page.evaluate((pubs) => {
      const byT = new Map(pubs.map(p => [p.ticker, p]));
      const cards = [...document.querySelectorAll('a[href^="/analyst-report/"]')];
      const leaf = (root, txt) => [...root.querySelectorAll('span,div')].find(e => e.children.length === 0 && e.textContent === txt);
      const cut = (e) => !e || e.scrollWidth > e.clientWidth || getComputedStyle(e).textOverflow === 'ellipsis';
      const rows = cards.map(a => {
        const p = byT.get(a.getAttribute('href').split('/')[2]) || {};
        const name = leaf(a, p.name || p.ticker), title = leaf(a, p.title), date = leaf(a, p.published_date);
        const meta = a.firstElementChild?.lastElementChild;   // 1행 우측 묶음(티커·신호점)
        const lh = name ? (parseFloat(getComputedStyle(name).lineHeight) || parseFloat(getComputedStyle(name).fontSize) * 1.5) : 0;
        return {
          t: p.ticker, measured: !!(name && title && date && meta),
          nameCut: cut(name), titleCut: cut(title),
          metaR: meta?.getBoundingClientRect().right, dateR: date?.getBoundingClientRect().right,
          nameH: name ? Math.round(name.getBoundingClientRect().height * 10) / 10 : null, lh,
        };
      });
      const spread = (k) => { const v = rows.map(r => r[k]).filter(x => x != null); return v.length ? Math.max(...v) - Math.min(...v) : Infinity; };
      // what-if 대조군(task#396 회고 ⓤ) — 한 장의 우측 묶음을 10px 밀면 정렬 축이 FAIL해야 이빨이 있다
      let ctl = null;
      const m0 = cards[0]?.firstElementChild?.lastElementChild;
      if (m0 && cards.length >= 2) {
        const keep = m0.style.marginRight; m0.style.marginRight = '10px';
        const v = cards.map(a => a.firstElementChild?.lastElementChild?.getBoundingClientRect().right);
        ctl = Math.max(...v) - Math.min(...v);
        m0.style.marginRight = keep;
      }
      return { n: cards.length, rows, metaSpread: spread('metaR'), dateSpread: spread('dateR'), ctl,
        docW: document.documentElement.scrollWidth, vw: window.innerWidth };
    }, pubs);
    const measured = c.rows.filter(r => r.measured).length;
    ok(`[${label}] 심층목록:커버리지`, c.n > 0 && measured === c.n, `잰 카드 ${measured}/${c.n}`);
    const cutN = c.rows.filter(r => r.nameCut || r.titleCut);
    ok(`[${label}] 심층목록:이름·제목-잘림0`, c.n > 0 && cutN.length === 0,
      `잘림 ${cutN.length}장 (이름 ${c.rows.filter(r => r.nameCut).length} · 제목 ${c.rows.filter(r => r.titleCut).length})`);
    ok(`[${label}] 심층목록:가로넘침0`, c.docW <= c.vw, `docW=${c.docW} vw=${c.vw}`);
    ok(`[${label}] 심층목록:우측묶음·날짜-같은선`, c.metaSpread <= 0.5 && c.dateSpread <= 0.5,
      `티커묶음 편차 ${c.metaSpread.toFixed(1)} · 날짜 편차 ${c.dateSpread.toFixed(1)}`);
    ok(`[${label}] 심층목록:정렬축-대조군-FAIL`, c.ctl != null && c.ctl > 0.5, `marginRight 10px 주입 시 편차 ${c.ctl}`);
    const tall = c.rows.filter(r => r.nameH == null || r.nameH > r.lh * 2 + 1);
    ok(`[${label}] 심층목록:이름-2줄이하(낱자적층-sentinel)`, c.n > 0 && tall.length === 0,
      tall.length ? tall.map(r => `${r.t}:${r.nameH}/${r.lh}`).join(' ') : `최대 ${Math.max(...c.rows.map(r => r.nameH))}px`);
    await page.screenshot({ path: `${OUT}/${label}-04-deep-list.png`, fullPage: true });
  }

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
    // task#402 후속 — 업체 표가 360 미만에서 문서를 가로로 밀어냈다(m278 ai-datacenter-ops 298>278). 넘치면
    // 레이아웃 뷰포트가 넓어져 클릭 좌표가 어긋나 아래 클릭이 헤더·이웃 칸에 막혔다(30초 크래시).
    const hs = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    ok(`[${label}] 기술:페이지-가로넘침-0`, hs[0] <= hs[1] + 1, `${techSlug} ${hs[0]}/${hs[1]}`);
    // 클릭 실패는 크래시가 아니라 이 축의 FAIL이다(나머지 축이 계속 기록되도록)
    const clicked = found && await tlink.click({ timeout: 10000 }).then(() => true, (e) => { ok(`[${label}] 기술:티커-클릭`, false, e.message.split('\n')[0]); return false; });
    if (clicked) {
      await settle(page);
      ok(`[${label}] 기술:클릭시-리포트-도달`, new URL(page.url()).pathname === '/reports', page.url());
      // task#378 ⓑ — 본문 전체가 아니라 「상세 뷰 + 상세 영역 안 티커」로 좁힌다
      const st = await page.evaluate((t) => {
        const main = document.querySelector('.reports-main');
        return {
          view: document.querySelector('.reports-layout')?.getAttribute('data-view'),
          inMain: !!main && (main.innerText || '').includes(t),
          notice: !!document.querySelector('[data-testid="deeplink-notice"]'),
        };
      }, techTicker);
      ok(`[${label}] 기술:그-종목-상세가-열린다`, st.view === 'detail' && st.inMain, `${techTicker} view=${st.view} 상세영역티커=${st.inMain}`);
      ok(`[${label}] 기술:추적-대조군-배너-없음`, !st.notice, `배너=${st.notice}`);
    }
  }

  // ── ⓚ 기술 업체표 **미추적** 티커 → 안내 배너 + 관심 추가 모달(열고 닫기만) — B83 ──────
  // 축은 조건 없이 전부 기록한다(진입 실패는 각 축의 FAIL로 드러난다 — 규칙 ⓑ).
  {
    let ufound = false;
    if (untrSlug) {
      await page.goto(`${BASE}/tech-report/${untrSlug}`, { waitUntil: 'domcontentloaded' });
      await settle(page);
    }
    const ulink = page.locator(`a[href="/reports"]`).filter({ hasText: untrTicker || '∅' }).first();
    ufound = !!untrSlug && await ulink.count() > 0;
    ok(`[${label}] 기술-미추적:티커가-링크다`, ufound, `${untrSlug}/${untrTicker}`);
    let posts = 0;
    const onReq = (r) => { if (r.method() === 'POST' && r.url().includes('/api/watchlist')) posts++; };
    page.on('request', onReq);
    if (ufound) {
      const hs2 = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      ok(`[${label}] 기술-미추적:페이지-가로넘침-0`, hs2[0] <= hs2[1] + 1, `${untrSlug} ${hs2[0]}/${hs2[1]}`);
      await ulink.click({ timeout: 10000 }).then(() => settle(page), (e) => ok(`[${label}] 기술-미추적:티커-클릭`, false, e.message.split('\n')[0]));
    }
    const u = await page.evaluate((t) => {
      // 「있다」가 아니라 「보인다」 — ≤640px 목록 뷰는 `.reports-main`을 display:none으로 숨기므로
      // DOM 존재만 재면 숨은 배너로 통과한다(task#378 1차 배포 실측: m390·m278에서 배너가 그 안에 갇혔다).
      const shown = (el) => { if (!el) return false; const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
      const n = document.querySelector('[data-testid="deeplink-notice"]');
      const r = n?.getBoundingClientRect();
      return {
        view: document.querySelector('.reports-layout')?.getAttribute('data-view') ?? null,
        notice: shown(n), kind: n?.getAttribute('data-kind') ?? null, text: (n?.innerText || '').replace(/\s+/g, ' '),
        right: r ? Math.round(r.right * 10) / 10 : null, vw: window.innerWidth,
        // 업체표 하단에서 누르면 스크롤 위치가 남는다 — 배너가 화면 밖이면 사용자에겐 「조용히 멈춤」과 같다
        inView: !!r && r.width > 0 && r.top >= 0 && r.bottom <= window.innerHeight,
        top: r ? Math.round(r.top) : null, vh: window.innerHeight,
        docW: document.documentElement.scrollWidth,
        btn: shown(document.querySelector('[data-testid="deeplink-add-watch"]')),
      };
    }, untrTicker);
    ok(`[${label}] 기술-미추적:목록에-머문다`, ufound && u.view === 'list', `view=${u.view}`);
    ok(`[${label}] 기술-미추적:배너-보임(티커+사유)`,
      u.notice && u.kind === 'untracked' && u.text.includes(untrTicker) && u.text.includes('추적하지 않는'),
      `kind=${u.kind} · ${u.text.slice(0, 50)}`);
    ok(`[${label}] 기술-미추적:배너-넘침없음`, u.notice && u.right <= u.vw + 0.5 && u.docW <= u.vw,
      `right=${u.right} vw=${u.vw} docW=${u.docW}`);
    ok(`[${label}] 기술-미추적:배너가-화면-안에-있다`, u.inView, `top=${u.top} vh=${u.vh}`);
    ok(`[${label}] 기술-미추적:추가버튼-보임`, u.btn);
    await page.screenshot({ path: `${OUT}/${label}-02-untracked-banner.png`, fullPage: false });   // 측정 지점에서 캡처
    let m = { open: false };
    if (u.btn) {
      await page.locator('[data-testid="deeplink-add-watch"]').click();
      await page.waitForTimeout(400);
      m = await page.evaluate(() => {
        const md = document.querySelector('.modal');
        const tin = md?.querySelector('input[placeholder^="티커"], input[placeholder^="6자리"]');
        return { open: !!md, title: md?.querySelector('h2')?.textContent?.trim() ?? null, tv: tin?.value ?? null };
      });
      await page.screenshot({ path: `${OUT}/${label}-03-untracked-modal.png`, fullPage: false });
    }
    ok(`[${label}] 기술-미추적:모달이-그-티커로-열린다`, m.open && m.title === '관심종목 추가' && m.tv === untrTicker,
      `open=${m.open} title=${m.title} ticker=${m.tv}`);
    let closed = false, after = null;
    if (m.open) {
      await page.locator('.modal button', { hasText: '취소' }).first().click();
      await page.waitForTimeout(400);
      closed = await page.locator('.modal').count() === 0;
      after = await page.evaluate(() => document.querySelector('.reports-layout')?.getAttribute('data-view') ?? null);
    }
    page.off('request', onReq);
    // 「모달을 열었다」를 함께 요구한다 — 안 열렸으면 POST 0은 공허하게 참이다(규칙 ⓩ)
    ok(`[${label}] 기술-미추적:닫은뒤-저장요청0`, m.open && closed && posts === 0, `closed=${closed} POST=${posts}`);
    ok(`[${label}] 기술-미추적:닫은뒤-목록유지`, m.open && after === 'list', `view=${after}`);
  }

  ok(`[${label}] 콘솔에러 0`, errs.length === 0, errs.slice(0, 2).join(' / '));
  await b.close();
}

await run('pc', { viewport: { width: 1440, height: 1000 } });
await run('m390', { ...devices['iPhone 13'] });
await run('m350', { viewport: { width: 350, height: 720 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: devices['iPhone 13'].userAgent });
await run('m278', { viewport: { width: 278, height: 664 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: devices['iPhone 13'].userAgent });

console.log(lines.join('\n'));
console.log(`\n단언 총계 ${pass + fail} (PASS ${pass} / FAIL ${fail})`);
process.exit(fail > 0 ? 1 : 0);
