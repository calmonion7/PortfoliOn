// task#275 라이브 UAT — 사업부문 시장 분석 섹션.
//
// 라이브 데이터 상태(착수 시 1쿼리 확인): market_outlook 보유 124종목 중 segments 보유 **0종목**.
// → 실데이터로 "채워진 상태"를 UAT할 수 없다(task#260 회고 ⑤). 대체 3축으로 간다:
//   ⓐ in-container 실데이터 build_data_block 1회 호출 — 이 스크립트 밖(메인 세션)에서 수행, PASS.
//   ⓑ 라이브 번들 + page.route 주입 응답으로 렌더 검증  ← 이 스크립트 (※ 실발행 아님·실데이터 아님)
//   ⓒ 실제 구데이터(segments 없는 종목)에서 섹션 생략·콘솔 에러 0  ← 이 스크립트
//
// 판정축
//   (1) target-identity — 지금 보는 게 그 문서인가(⑧ⓘ). 판정축이 대상과 독립이면 404 위에서도 통과한다.
//   (2) section        — 주입 화면엔 섹션 존재 / 구데이터 화면엔 부재
//   (3) segname        — 주입한 부문명이 전부 렌더
//   (4) formula        — 산식 캡션이 문자열로 드러남(DoD 명시 항목). 실측 문자열을 출력에 싣는다.
//   (5) line-visible   — Range.getClientRects().length === 1 (접힘은 bbox에 안 잡힌다, 가토 ⑨)
//   (6) clip           — scrollWidth <= clientWidth (ellipsis 잘림은 넘침에 안 잡힌다, 가토 ⑦)
//   (7) bbox           — 자식이 섹션 루트를 가로로 넘지 않음
//   (8) gap            — 산식 캡션 ↔ 시나리오 칩 근접(가토 ⑩ — 요소 *간* 거리는 위 어느 축에도 안 잡힌다)
//   (9) color          — 누적막대 라벨이 var(--bg)로 적용됐는가(가토 ⑪ — 클래스만 붙고 규칙이 없으면 색이 사라진다)
//  (10) console        — 에러 0
//
// 축의 정의역 (⑧ⓛ — 조건부 스킵이 아니라 축의 적용 범위. 코드에 이유와 함께 명시한다)
//   · clip 축: `text-overflow: ellipsis`가 걸린 요소는 **설계상 줄어도 되는 것**(부문명)이라 clip 축의
//     정의역 밖이다. 대신 "카드당 ellipsis 지정 요소는 정확히 1개"를 별도로 단언해 규율을 고정한다.
//   · line-visible 축: `note`(서술 산문, lineHeight 1.6)와 `출처:` 줄은 **여러 줄이 정상**이라 정의역 밖.
//     나머지(스탯 라벨·값·산식·칩·범례·막대 라벨)는 전부 1줄이어야 한다.
//
// 신뢰성 규칙: 단언은 무조건화 — 미검출은 sentinel(SECTION_MISSING 등)로 FAIL시켜 총계를 구조적으로
// 고정한다(⑧ⓑ: `if (조건) assert(...)` 금지). 커버리지는 계열별로 출력해 재실행 간 비교 가능하게 한다(⑧ⓐ).
import { chromium, devices } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat275';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const P = (ok, tag, msg) => results.push({ ok, tag, msg });
const cov = {};
const bump = (k, n = 1) => { cov[k] = (cov[k] || 0) + n; };
const eq = (tag, got, want, note = '') => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  P(ok, tag, `${ok ? 'PASS' : 'FAIL'} — got=${JSON.stringify(got)} want=${JSON.stringify(want)}${note ? ' · ' + note : ''}`);
};

// ── 로그인 + 대상 ground-truth (추정 폴백 금지 — 없으면 즉시 exit, ⑧ⓘ) ──────────
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const { access_token, refresh_token } = await login.json();
const AUTH = { Authorization: `Bearer ${access_token}` };

// 심층 리포트 대상: {reports:[{ticker, published_date, ...}]} (라이브 1콜로 확인한 실제 봉투)
const arList = await (await fetch(`${BASE}/api/analyst-reports?limit=5`, { headers: AUTH })).json();
const AR = (arList.reports || [])[0];
if (!AR?.ticker || !AR?.published_date) {
  console.error('대상 유효성 실패 — analyst-reports 목록에서 ticker/published_date를 얻지 못했다. 추정 폴백 없이 종료.');
  process.exit(1);
}
// 일반 리포트 대상: {stocks:{TICKER:{dates:[...]}}} (라이브 1콜로 확인한 실제 봉투)
const rList = await (await fetch(`${BASE}/api/report/list`, { headers: AUTH })).json();
const rTicker = Object.keys(rList.stocks || {})[0];
const rDate = rList.stocks?.[rTicker]?.dates?.[0];
if (!rTicker || !rDate) {
  console.error('대상 유효성 실패 — report/list에서 ticker/date를 얻지 못했다. 추정 폴백 없이 종료.');
  process.exit(1);
}
console.log(`대상 — 심층리포트 ${AR.ticker}/${AR.published_date} · 일반리포트 ${rTicker}/${rDate}`);

// ── 주입 페이로드 (※ 실데이터 아님 — 라이브엔 segments 보유 종목이 0개다) ──────────
// 부문명 하나를 길게 둬 ellipsis 규율(clip 축의 정의역)을 실제로 자극한다.
const SEG_NAMES = ['메모리', '파운드리 및 시스템LSI 통합 사업부문', 'MX / 네트워크', 'SDC'];
const mkSegments = (period, prevPeriod) => [
  { name: SEG_NAMES[0], period, prev_period: prevPeriod, revenue_share_pct: 42.0, prev_revenue_share_pct: 35.0,
    market: { size: 1200, unit: '억달러', year: 2024, size_forecast: 1900, forecast_year: 2030, cagr_pct: 8.0 },
    share_pct: 12.0, note: 'HBM 수요가 서버 투자 사이클과 맞물려 단가를 끌어올린다.', sources: ['Gartner 2024'] },
  { name: SEG_NAMES[1], period, prev_period: prevPeriod, revenue_share_pct: 23.5, prev_revenue_share_pct: 27.0,
    market: { size: 800, unit: '억달러', year: 2024, size_forecast: 1100, forecast_year: 2030, cagr_pct: 5.5 },
    share_pct: 7.5, share_pct_forecast: 9.0, sources: ['TrendForce'] },
  { name: SEG_NAMES[2], period, prev_period: prevPeriod, revenue_share_pct: 24.0, prev_revenue_share_pct: 26.0,
    market: { size: 4200, unit: '억달러', year: 2024, size_forecast: 5000, forecast_year: 2030, cagr_pct: 2.9 },
    share_pct: 18.0, sources: ['IDC'] },
  // 4번째는 LABEL_MIN_PCT(8) 미만이라 조각 내 라벨이 생략되고 범례로 내려간다 — 폭 규율 경로를 실제로 탄다.
  { name: SEG_NAMES[3], period, prev_period: prevPeriod, revenue_share_pct: 5.5, prev_revenue_share_pct: 6.0,
    share_pct: 21.0, sources: ['옴디아'] },
];

// ── 브라우저 안 측정기 ────────────────────────────────────────────────────────
const SECTION_LABEL = '사업부문 시장 분석';

const measure = (page, sectionLabel) => page.evaluate((LABEL) => {
  // 섹션 루트 = 제목을 품고, 카드 그리드를 **직계 자식**으로 갖는 첫 조상.
  // 클래스명에 기대지 않는다(recharts 사례처럼 클래스 계층은 버전마다 바뀐다).
  const titleEl = [...document.querySelectorAll('span, div, h2, h3')]
    .find(e => e.children.length === 0 && e.textContent.trim().includes(LABEL));
  if (!titleEl) return { found: false };
  let root = titleEl;
  while (root && root !== document.body) {
    if ([...root.children].some(c => (c.getAttribute('style') || '').includes('grid-template-columns'))) break;
    root = root.parentElement;
  }
  if (!root || root === document.body) return { found: false };

  const rr = root.getBoundingClientRect();
  const cs = (el) => getComputedStyle(el);
  const txt = (el) => el.textContent.trim();
  // 텍스트 leaf = 자식 요소 없이 텍스트만 가진 요소
  const leaves = [...root.querySelectorAll('span, div')].filter(e => e.children.length === 0 && txt(e).length > 0);

  // 실제 렌더 줄 수 — Range로 잰다(접힘은 bbox 넘침에 안 잡힌다).
  // ⚠️ `getClientRects().length`를 그대로 쓰면 안 된다 — Range는 **텍스트 노드마다** rect를 준다.
  // JSX `{name} {pct}%`는 텍스트 노드를 3~4개로 쪼개므로 한 줄인데도 4rect가 나온다(1차 실행에서
  // 실제로 22건 거짓 FAIL). 진짜 줄 수 = **서로 다른 top 값의 개수**.
  const lineCount = (el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    const tops = [...r.getClientRects()].map(x => Math.round(x.top));
    return new Set(tops).size || 1;
  };

  const items = leaves.map(el => {
    const s = cs(el);
    const isEllipsis = s.textOverflow === 'ellipsis' && s.overflow !== 'visible';
    // 산문(note) 판정은 **인라인 선언**으로 한다. computed lineHeight를 쓰면 전역 CSS의 1.6이
    // 전 요소를 산문으로 삼켜 line-visible 축이 아무것도 안 보면서 통과한다(1차 실행에서 실제로 발생,
    // 커버리지 0으로 포착 — 가토 ⑧ⓐ). 이 컴포넌트에서 인라인 lineHeight를 갖는 건 note 하나뿐이다.
    const isProse = el.style.lineHeight !== '';
    const isSources = txt(el).startsWith('출처:');
    const b = el.getBoundingClientRect();
    return {
      t: txt(el).slice(0, 60),
      lines: lineCount(el),
      scrollW: el.scrollWidth, clientW: el.clientWidth,
      right: Math.round(b.right), bottom: Math.round(b.bottom), top: Math.round(b.top),
      isEllipsis, isProse, isSources,
      color: s.color,
    };
  });

  // 카드 = 그리드의 직계 자식
  const grid = [...root.children].find(c => (c.getAttribute('style') || '').includes('grid-template-columns'));
  const cards = grid ? [...grid.children] : [];
  const perCard = cards.map(card => {
    const ell = [...card.querySelectorAll('span, div')]
      .filter(e => e.children.length === 0 && cs(e).textOverflow === 'ellipsis' && cs(e).overflow !== 'visible');
    // 간격 축: 산식 캡션(.mono.tnum) ↔ 시나리오 칩. 둘 다 있는 카드에서만 거리가 정의된다.
    const formulas = [...card.querySelectorAll('.mono.tnum')];
    const chip = [...card.querySelectorAll('span')].find(e =>
      e.children.length === 0 && /점유율 유지 가정|회사 전망/.test(txt(e)));
    let gap = null;
    if (formulas.length && chip) {
      gap = Math.round(chip.getBoundingClientRect().top - formulas[formulas.length - 1].getBoundingClientRect().bottom);
    }
    return { ellipsisCount: ell.length, hasFormula: formulas.length > 0, hasChip: !!chip, gap };
  });

  // 누적막대 조각 내부 라벨의 색 — 가토 ⑪(클래스만 붙고 규칙이 없으면 색이 조용히 사라진다).
  // 기준값은 하드코딩하지 않고 :root에서 --bg 토큰을 읽어 임시 노드로 rgb 정규화해 대조한다.
  const probe = document.createElement('span');
  probe.style.color = 'var(--bg)'; probe.style.position = 'absolute'; probe.style.opacity = '0';
  document.body.appendChild(probe);
  const bgRgb = getComputedStyle(probe).color;
  probe.style.color = 'var(--text)';
  const textRgb = getComputedStyle(probe).color;
  probe.remove();

  const barLabels = [...root.querySelectorAll('span')]
    .filter(e => e.children.length === 0 && /\d%$/.test(txt(e)) && parseFloat(cs(e).fontSize) <= 9.5)
    .map(e => ({ t: txt(e).slice(0, 30), color: cs(e).color }));

  const formulaStrings = [...root.querySelectorAll('.mono.tnum')].map(e => txt(e));

  // 잘림 축의 두 번째 표면 — `overflow:hidden` **컨테이너**가 자식 텍스트를 자르는가.
  // 누적막대 조각(overflow:hidden)이 nowrap 라벨을 ellipsis 없이 그냥 잘라내는 경로가 여기 잡힌다.
  // 텍스트 leaf만 재면 원리적으로 안 보인다(스크롤러는 조각 쪽이지 라벨 쪽이 아니다).
  const clippers = [...root.querySelectorAll('div')]
    .filter(e => cs(e).overflow === 'hidden' && txt(e).length > 0)
    .map(e => ({ t: txt(e).slice(0, 40), scrollW: e.scrollWidth, clientW: e.clientWidth }));

  return {
    found: true, rootRight: Math.round(rr.right), rootWidth: Math.round(rr.width),
    items, perCard, barLabels, formulaStrings, bgRgb, textRgb, clippers,
    allText: root.textContent,
  };
}, sectionLabel);

// ── 실행 ──────────────────────────────────────────────────────────────────────
const browser = await chromium.launch();

const VIEWS = [
  { key: 'pc', opts: { viewport: { width: 1400, height: 900 } } },
  { key: 'mobile', opts: { ...devices['iPhone 13'] } },
];

for (const V of VIEWS) {
  // SW가 /api/*를 가로채면 page.route 주입이 안 먹는다 → serviceWorkers:'block' 필수.
  const ctx = await browser.newContext({ ...V.opts, serviceWorkers: 'block' });
  await ctx.addInitScript(([a, r]) => {
    localStorage.setItem('access_token', a); localStorage.setItem('refresh_token', r);
  }, [access_token, refresh_token]);

  // ── ⓑ 주입: 심층 리포트 ────────────────────────────────────────────────────
  for (const SCREEN of ['analyst', 'reportdetail']) {
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', e => errs.push(String(e)));

    // 일반 리포트 상세 딥링크는 URL이 아니라 `location.state.ticker`(라우터 state)라 URL로 지정할 수
    // 없다(App.jsx:50 ReportsRoute 직독). `/reports`는 진입 시 첫 종목을 자동 선택하므로, 티커를
    // 강제하는 대신 **앱이 실제로 요청하는 상세 응답**을 정규식으로 가로채 패치한다.
    // 그러면 "지금 보는 문서 == 내가 패치한 문서"가 구조적으로 보장된다(⑧ⓘ).
    const apiMatch = SCREEN === 'analyst'
      ? `**/api/analyst-reports/${AR.ticker}/${AR.published_date}`
      : /\/api\/report\/[^/?]+\/\d{4}-\d{2}-\d{2}(\?|$)/;
    const url = SCREEN === 'analyst'
      ? `${BASE}/analyst-report/${AR.ticker}/${AR.published_date}`
      : `${BASE}/reports`;
    let patchedTicker = null;

    // 원본 응답을 받아 **패치**한다 — 나머지는 전부 실데이터로 남긴다.
    await page.route(apiMatch, async (route) => {
      const res = await route.fetch();
      let body;
      try { body = await res.json(); } catch { return route.fulfill({ response: res }); }
      const holder = SCREEN === 'analyst' ? (body.data ||= {}) : (body.summary ||= {});
      const fa = holder.financials_annual || [];
      const actual = fa.filter(f => !f.is_consensus).map(f => String(f.period)).sort().reverse();
      const period = actual[0] ?? '2024';
      const prev = actual[1] ?? '2023';
      holder.market_outlook = { ...(holder.market_outlook || {}), segments: mkSegments(period, prev) };
      patchedTicker = decodeURIComponent(route.request().url()).split('/api/report')[1] || route.request().url();
      await route.fulfill({ response: res, body: JSON.stringify(body) });
    });

    await page.goto(url, { waitUntil: 'networkidle' });
    if (SCREEN === 'reportdetail') {
      // `/reports`는 상세를 자동 fetch하지 않는다(라이브 실측: `/api/report/list`만 요청).
      // 사이드바(.reports-sidebar)의 종목을 클릭해야 상세가 열린다 — 티커를 하드코딩하지 않고
      // 사이드바에 실제로 있는 첫 티커를 집는다.
      // PC는 사이드바가 display:none이고 `.reports-main` 표에서 고른다 / 모바일은 사이드바 — 뷰포트마다
      // 가시 표면이 다르므로 셀렉터를 고정하지 말고 **실제로 보이는 첫 티커**를 집는다(라이브 실측).
      await page.waitForSelector('.reports-layout', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const cands = page.locator('.reports-layout').getByText(/^([A-Z]{1,5}|\d{6})$/);
      const n = await cands.count();
      for (let i = 0; i < n; i++) {
        const c = cands.nth(i);
        if (!(await c.isVisible().catch(() => false))) continue;
        await c.click({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(2500);
        break;
      }
      // 「심층분석」 탭으로 전환 — 섹션은 그 탭 안에 있다.
      const tab = page.getByText(/심층분석/).first();
      if (await tab.count()) { await tab.click({ timeout: 8000 }).catch(() => {}); await page.waitForTimeout(1200); }
    }
    await page.waitForTimeout(1200);

    const tag = `${V.key}/${SCREEN}`;

    // (1) target-identity — 판정축이 대상과 독립이면 404 위에서도 통과한다(⑧ⓘ).
    // analyst: 페이지에 그 티커가 보이는가. reportdetail: 앱이 요청한 상세를 우리가 실제로 패치했는가.
    const bodyText = await page.evaluate(() => document.body.innerText);
    if (SCREEN === 'analyst') {
      eq(`identity:${tag}`, bodyText.includes(AR.ticker), true, `대상 마커 "${AR.ticker}"`);
    } else {
      eq(`identity:${tag}`, patchedTicker ? 'PATCHED' : 'DETAIL_REQUEST_NOT_SEEN', 'PATCHED',
        `패치한 상세 = ${patchedTicker}`);
    }
    bump('identity');

    let m = await measure(page, SECTION_LABEL);
    if (!m.found) { // 1회 재시도 후 확정(무음 스킵 금지)
      await page.waitForTimeout(1800);
      m = await measure(page, SECTION_LABEL);
    }

    // (2) section — 미검출은 sentinel로 FAIL(총계 고정)
    eq(`section:${tag}`, m.found ? 'PRESENT' : 'SECTION_MISSING', 'PRESENT');
    bump('section');

    if (!m.found) { await page.close(); continue; }

    // (3) segname — 주입한 4개 전부. 미검출은 sentinel 문자열로 FAIL.
    for (const n of SEG_NAMES) {
      eq(`segname:${tag}:${n.slice(0, 12)}`, m.allText.includes(n) ? 'FOUND' : 'SEGNAME_MISSING', 'FOUND');
      bump('segname');
    }

    // (4) formula — DoD 명시 항목. 실측 문자열을 출력에 싣는다(⑧ⓐ/ⓗ).
    const nf = m.formulaStrings.length;
    eq(`formula-count:${tag}`, nf >= 3 ? 'OK' : `FORMULA_TOO_FEW(${nf})`, 'OK',
      `실측: ${JSON.stringify(m.formulaStrings.slice(0, 3))}`);
    bump('formula', nf);
    const wellFormed = m.formulaStrings.filter(s => s.includes('×') && s.includes('=')).length;
    eq(`formula-shape:${tag}`, wellFormed, nf, '모든 산식이 "A × B% = C" 형태');

    // (5) line-visible — 정의역: 산문(note)·출처 줄 제외. 나머지는 전부 1줄.
    const lineDomain = m.items.filter(i => !i.isProse && !i.isSources);
    const folded = lineDomain.filter(i => i.lines !== 1);
    eq(`line-visible:${tag}`, folded.map(f => `${f.t}(${f.lines}줄)`), [], `검사 ${lineDomain.length}건`);
    bump('line-visible', lineDomain.length);
    // 정의역이 비면 축이 아무것도 안 본 것 → 빈 배열끼리 비교돼 공허하게 통과한다. sentinel로 막는다.
    eq(`line-visible-domain:${tag}`, lineDomain.length > 10 ? 'OK' : `LINE_DOMAIN_TOO_SMALL(${lineDomain.length})`, 'OK');

    // (6) clip — 정의역: ellipsis 지정 요소는 **설계상 줄어도 되는 것**이라 제외(조건부 스킵 아님).
    const clipDomain = m.items.filter(i => !i.isEllipsis);
    const clipped = clipDomain.filter(i => i.scrollW > i.clientW + 1);
    eq(`clip:${tag}`, clipped.map(c => `${c.t}(${c.scrollW}>${c.clientW})`), [], `검사 ${clipDomain.length}건`);
    bump('clip', clipDomain.length);
    eq(`clip-domain:${tag}`, clipDomain.length > 10 ? 'OK' : `CLIP_DOMAIN_TOO_SMALL(${clipDomain.length})`, 'OK');

    // (6b) clip-container — overflow:hidden 컨테이너가 자식을 자르는가(누적막대 조각 ↔ nowrap 라벨).
    const cut = m.clippers.filter(c => c.scrollW > c.clientW + 1);
    eq(`clip-container:${tag}`, cut.map(c => `${c.t}(${c.scrollW}>${c.clientW})`), [], `검사 ${m.clippers.length}건`);
    bump('clip-container', m.clippers.length);

    // ellipsis 규율 — 카드당 정확히 1개(부문명)만 줄어도 되는 것으로 지정돼야 한다.
    const badEll = m.perCard.map((c, i) => c.ellipsisCount === 1 ? null : `card${i}:${c.ellipsisCount}`).filter(Boolean);
    eq(`ellipsis-discipline:${tag}`, badEll, [], `카드 ${m.perCard.length}장`);
    bump('ellipsis-discipline', m.perCard.length);

    // (7) bbox — 가로 넘침
    const over = m.items.filter(i => i.right > m.rootRight + 1);
    eq(`bbox:${tag}`, over.map(o => `${o.t}(${o.right}>${m.rootRight})`), [], `검사 ${m.items.length}건 · rootW=${m.rootWidth}`);
    bump('bbox', m.items.length);

    // (8) gap — 산식 캡션 ↔ 시나리오 칩(가토 ⑩). 둘 다 있는 카드가 축의 정의역.
    const gapDomain = m.perCard.filter(c => c.gap != null);
    const farGaps = gapDomain.filter(c => c.gap > 24 || c.gap < 0);
    eq(`gap:${tag}`, farGaps.map(c => `${c.gap}px`), [], `검사 ${gapDomain.length}건 · 실측 ${JSON.stringify(gapDomain.map(c => c.gap))}`);
    bump('gap', gapDomain.length);
    // 정의역이 비면 축이 아무것도 안 본 것 → sentinel FAIL
    eq(`gap-domain:${tag}`, gapDomain.length > 0 ? 'OK' : 'GAP_DOMAIN_EMPTY', 'OK');

    // (9) color — 누적막대 라벨이 var(--bg)로 적용됐는가(가토 ⑪).
    const wrongColor = m.barLabels.filter(b => b.color !== m.bgRgb);
    eq(`color:${tag}`, wrongColor.map(b => `${b.t}=${b.color}`), [], `검사 ${m.barLabels.length}건 · --bg=${m.bgRgb}`);
    bump('color', m.barLabels.length);
    eq(`color-domain:${tag}`, m.barLabels.length > 0 ? 'OK' : 'BARLABEL_MISSING', 'OK');
    // 이빨 단언 — 토큰이 서로 같으면 위 색 단언이 아무것도 안 보면서 통과한다.
    eq(`color-tokens-differ:${tag}`, m.bgRgb !== m.textRgb, true, `--bg=${m.bgRgb} --text=${m.textRgb}`);

    // (10) console
    eq(`console:${tag}`, errs, [], '주입 화면');
    bump('console');

    // 육안 스크린샷 — 시각을 바꾸는 변경이라 필수(육안이 유일 포착 수단이었던 전례 4회)
    await page.evaluate((LABEL) => {
      const t = [...document.querySelectorAll('span, div')].find(e => e.children.length === 0 && e.textContent.trim().includes(LABEL));
      if (t) t.scrollIntoView({ block: 'center' });
    }, SECTION_LABEL);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${V.key}-${SCREEN}-injected.png`, fullPage: false });

    await page.close();
  }

  // ── ⓒ 실제 구데이터(주입 없음) — 섹션 생략 + 콘솔 에러 0 ────────────────────
  {
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', e => errs.push(String(e)));
    await page.goto(`${BASE}/analyst-report/${AR.ticker}/${AR.published_date}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const bodyText = await page.evaluate(() => document.body.innerText);
    const tag = `${V.key}/real-old`;
    eq(`identity:${tag}`, bodyText.includes(AR.ticker), true, `대상 마커 "${AR.ticker}"`);
    bump('identity');
    eq(`section-absent:${tag}`, bodyText.includes(SECTION_LABEL) ? 'UNEXPECTED_SECTION' : 'ABSENT', 'ABSENT',
      '구발행물엔 data.market_outlook 키 자체가 없다');
    bump('section');
    eq(`console:${tag}`, errs, [], '구데이터 화면');
    bump('console');
    await page.screenshot({ path: `${OUT}/${V.key}-real-old.png`, fullPage: false });
    await page.close();
  }

  await ctx.close();
}

await browser.close();

// ── 보고 ──────────────────────────────────────────────────────────────────────
const fails = results.filter(r => !r.ok);
console.log('\n' + '═'.repeat(72));
console.log('커버리지 (계열별 검사 수 — 재실행 간 비교용):');
for (const [k, v] of Object.entries(cov).sort()) console.log(`  ${k.padEnd(22)} ${v}`);
console.log(`\n단언 총계: ${results.length}건 · PASS ${results.length - fails.length} · FAIL ${fails.length}`);
console.log('※ ⓑ 주입 화면은 **실데이터 아님** — 라이브엔 segments 보유 종목이 0개다.');
console.log('═'.repeat(72));
if (fails.length) {
  console.log('\nFAIL 상세:');
  for (const f of fails) console.log(`  ✗ ${f.tag}\n      ${f.msg}`);
  process.exit(1);
}
console.log('\nALL PASS');
for (const r of results) console.log(`  ✓ ${r.tag} — ${r.msg}`);
