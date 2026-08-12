// task#299 라이브 UAT(신규) — 「선도기술 리포트」 → 「주요기술 리포트」 개명 + 판 누적(이력) 폐기
// (ADR-0038 결정 1~3)을 GET만으로 검증한다. POST/PUT/DELETE 없음 — 라이브 프로덕션 쓰기 0.
// 옛 코드에 대고 돌려도 안전하다(순수 조회).
//
// 실행: node scripts/uat299-tech-rename.mjs
// ⚠️ 순서 — commit + push(+ 자동 배포) **전에** 1회 돌려 red를 확보하고, 배포 후(포트 바인딩 확인 후)
//   재실행해 green을 확인한다(CLAUDE.md 가토 §「배포 직후 API 무응답」 참조 — Up이어도 수분간 무응답
//   가능). CONTROL 대조군은 없음 — 이 파일은 이미 배포된 표면의 GET 정합만 잰다.
//
// ── 착수 시 라이브 실측(2026-08-12, GET만, 무쓰기) — 이 스크립트의 기대값은 리터럴이 아니라 실응답/
//    실제 DOM 구조에서 유도한다. 재확인 금지(이미 확보됨) ────────────────────────────────────────
//   컨테이너 TECH_TOPICS 4종(reusable-rocket·solid-state-battery·smr·robotics), tech_reports 4행
//   (이미 slug당 1행 — 배포 후 마이그레이션의 DELETE는 0건이 정상), UNIQUE(slug) 단독 인덱스 없음.
//   작업트리 직독(App.jsx·navSections.js·TechReports.jsx·TechReport.jsx·tech_reports.py 서비스+라우터,
//   2026-08-12)으로 확인한 구조 사실 3가지 — 이 프로브의 셀렉터·범위는 여기서 파생된다:
//     · PC: `<Masthead>`가 `<main className="page-wrap">`의 **형제**다 — 서브바(`.masthead-subbar`)는
//       page-wrap **밖**에 있다.
//     · 모바일: `ResearchShell`이 `useIsMobile()`(JS 판정, CSS 아님)일 때만 `.seg` 필 nav를
//       page-wrap **안**(`.m-page` 조상)에 렌더한다. PC에서는 이 표면 자체가 DOM에 없다(display:none이
//       아니라 렌더되지 않음 — 가토 ⑧ⓛ의 "정의역은 뷰포트마다 다르다"와 동형이라, PC에서 `.seg`가
//       0개인 것은 결함이 아니라 축의 정의역이다).
//     · 목록 카드는 `[data-testid="tech-report-card"][data-slug]`, 날짜 도장은 목록·상세 둘 다
//       `{published_date} 갱신` 리터럴 문자열(리터럴 "발행"은 report===null 빈 상태 문구에만 남는데
//       그 문구는 report가 있는 슬러그를 볼 때는 도달 불가라 date-stamp 축과 충돌하지 않는다).
//   나브·목록·상세 소스가 이미 "주요기술"·"갱신"으로 개서돼 있었다(S1~S4 wave가 이 프로브 저작과
//   동시에 진행 중 — 즉 지금 이 스크립트를 배포 전 로컬 대조 없이 라이브에 돌리면, 아직 push 전이라
//   라이브는 여전히 옛 문구/라우트를 서빙할 수 있고 그게 정상 RED다).
//
// ── 판정 규율(CLAUDE.md 가토 그대로) ──────────────────────────────────────────────────────────────
//  · 조건부 단언 금지 — 무조건 단언 + sentinel FAIL로 총계를 구조적으로 고정한다. 단, 도메인 자체를
//    무조건 sentinel로 먼저 못박은 *뒤*에 도메인 세부만 `if(도메인)`으로 감싸는 것은 조건부 스킵이
//    아니다(예: toc류 관용구, §7.3ⓛ).
//  · 축마다 *-domain sentinel(정의역이 뷰포트처럼 실행 전 결정되는 것이면 그 사실을 주석으로 명시하고
//    해당 정의역 밖에서는 sentinel도 스킵), 리터럴 금지, 판정 범위는 본문 루트(main.page-wrap)로 한정.
//    단 nav-label의 "존재" 축은 위 구조 사실 때문에 page-wrap 하나로 두 뷰포트를 못 잡는다 — 식별된
//    나브 컴포넌트 2곳(`.masthead-subbar`·`main.page-wrap .seg`)을 각각 조회한다. 이건 "document
//    전체"가 아니다(가토 ⑧ⓒ가 경계한 것은 비관련 매치가 섞이는 무차별 document 스캔). "부재"(선도기술
//    0건)는 반대로 document.body 전체에서 더 넓게 재 안전망을 둔다 — 부재 확인은 나브 사본이 여러
//    곳(마스트헤드·모바일 하단 탭바)에 동시 존재해도 거짓 FAIL을 만들지 않는다(존재/개수 단언만
//    다중 사본에 취약하다, 가토 ⑧ⓒ의 실제 우려는 그쪽).
//  · 대상 slug는 하드코딩하지 않고 GET /api/tech-reports 응답에서 받아 전수로 돌린다(2/2가 5종째를
//    발행하면 자동으로 포함된다).
//  · identity를 판정축보다 먼저(대상이 틀려도 통과하는 축을 만들지 않는다, §7.3⑧ⓘ).
import { chromium, devices } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat299';
fs.mkdirSync(OUT, { recursive: true });

console.log('GET만(무쓰기) — 배포 전 실행이면 nav-label·list-heading·date-stamp·history-gone이');
console.log('  RED일 수 있다(아직 push 전이라 라이브가 옛 문구/라우트를 서빙 중일 수 있음) — 정상.');

const results = [];
const P = (ok, tag, msg) => results.push({ ok, tag, msg });
const cov = {};
const bump = (k, n = 1) => { cov[k] = (cov[k] || 0) + n; };
const eq = (tag, got, want, note = '') => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  P(ok, tag, `${ok ? 'PASS' : 'FAIL'} — got=${JSON.stringify(got)} want=${JSON.stringify(want)}${note ? ' · ' + note : ''}`);
};
const rawLog = [];

// ── 로그인(추정 폴백 없음) ────────────────────────────────────────────────────
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const { access_token, refresh_token } = await login.json();
if (!access_token) { console.error('로그인 실패 — access_token 없음. 종료.'); process.exit(1); }
const AUTH = { Authorization: `Bearer ${access_token}` };

// TECH_NAMES 미러 — techReportUtils.js(백엔드는 표시명을 응답에 싣지 않는다, ADR-0033 결정 2).
// data-center 포함(작업트리 직독으로 이미 반영됨 확인, 2/2가 발행하기 전엔 목록에 안 보여도 무해).
const TECH_NAMES = {
  'reusable-rocket': '재사용 로켓', 'solid-state-battery': '전고체 배터리',
  smr: 'SMR', robotics: '로봇', 'data-center': '데이터 센터',
};

// ── 목록 실응답(GET만) — 대상 slug는 여기서 전수로 유도한다(하드코딩 금지) ──────────────────────
const listRes = await fetch(`${BASE}/api/tech-reports`, { headers: AUTH });
const listBody = await listRes.json();
const REPORTS = listBody.reports || [];
console.log(`  [실응답] GET /api/tech-reports → ${REPORTS.length}건: ${REPORTS.map((r) => r.slug).join(', ') || '(없음)'}`);
for (const r of REPORTS) {
  if (!TECH_NAMES[r.slug]) { console.error(`TECH_NAMES 미러에 ${r.slug} 없음 — 미러 갱신 필요. 종료.`); process.exit(1); }
  if (!r.title) { console.error(`${r.slug}: title 부재 — identity 기대값 소스 없음. 종료.`); process.exit(1); }
}

// ── 브라우저 안 측정기 ────────────────────────────────────────────────────────
const ROOT_SEL = 'main.page-wrap .page, main.page-wrap .m-page';

// 잘림 축(가토 ⑦) — leaf 텍스트 scrollWidth 초과 + overflow:hidden 컨테이너 scrollWidth 초과.
// leaf 후보(자식 없고 텍스트 있음)는 어떤 실제 렌더 페이지에도 반드시 존재한다(도메인 상시 OK).
// hidden-container 후보는 그 페이지가 그 순간 어떤 데이터를 렌더하느냐에 따라 0일 수 있다(예: 계보
// 표가 없는 슬러그) — 그건 결함이 아니라 콘텐츠 의존이라 domain sentinel을 걸지 않고 후보 수만
// 커버리지로 보고한다(가토 ⑧ⓛ의 "구조적 정의역"과는 다른, 콘텐츠 의존 케이스). page.evaluate 콜백은
// 직렬화 경계라 함수를 공유할 수 없으므로 measureList/measureDetail 양쪽에 그대로 인라인한다.
// 실행해서 실측으로 잡은 함정 2가지(1차 라이브 실행 결과, 이 저장소 기존 관용구와 대조해 확정) —
// 이 축의 목적은 "이 개명이 새 잘림을 만들었는가"이지 이 태스크가 손대지 않는 컴포넌트의 기존 UI
// 관행을 심판하는 것이 아니다:
//   ① `.sr-only`(App.css: position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0))
//      는 스크린리더 전용 접근성 라벨이라 의도적으로 1px다(MilestoneTimeline.jsx 상태 라벨·
//      TechGraph.jsx `tech-graph-sr-list`, 가토 ⑭의 처방 그 자체) — 시각적으로 존재하지 않는
//      요소를 "잘림"으로 재면 접근성 장치를 결함으로 오탐한다(예: `span:"완료"(24>1)`).
//   ② `text-overflow: ellipsis` 또는 `overflow-wrap: anywhere|break-word`가 걸린 요소는 넘침을
//      스스로 처리하도록 설계된 것이다(ShareChart.jsx·MarketEstimates.jsx의 `title=` 툴팁 폴백,
//      PlayerTable.jsx `NAME_TEXT`의 `overflowWrap:'anywhere'`, TechLevelBand.jsx `__name`의
//      ellipsis) — 전부 이 태스크가 건드리지 않는 파일의 기존 설계다. 이 처리 없이 그냥 넘치는
//      요소만 "잘림"으로 잡는다(진짜 대상: 아무 CSS 처리 없이 박스 밖으로 새는 경우).
// 두 필터 다 page.evaluate 콜백 안에서 다시 선언해야 한다(직렬화 경계 — 모듈 스코프 함수를 참조
// 못 한다).
const measureList = (page) => page.evaluate(([ROOT_SEL]) => {
  const root = document.querySelector(ROOT_SEL);
  if (!root) return { found: false, why: 'ROOT_MISSING' };
  const h3 = root.querySelector('h3');
  const cards = [...root.querySelectorAll('[data-testid="tech-report-card"]')];
  const isSrOnly = (el) => !!el.closest('.sr-only');
  const isHandled = (el) => {
    const cs = getComputedStyle(el);
    return cs.textOverflow === 'ellipsis' || cs.overflowWrap === 'anywhere' || cs.overflowWrap === 'break-word';
  };
  const all = [...root.querySelectorAll('*')].filter((el) => !isSrOnly(el));
  const leafCandidates = all.filter((el) => el.children.length === 0 && el.textContent.trim() !== '');
  const leafOver = leafCandidates
    .filter((el) => el.scrollWidth > el.clientWidth + 1 && !isHandled(el))
    .map((el) => `${el.tagName.toLowerCase()}:"${el.textContent.trim().slice(0, 24)}"(${el.scrollWidth}>${el.clientWidth})`);
  const hiddenCandidates = all.filter((el) => getComputedStyle(el).overflow === 'hidden');
  const hiddenOver = hiddenCandidates
    .filter((el) => el.scrollWidth > el.clientWidth + 1 && !isHandled(el))
    .map((el) => `${el.tagName.toLowerCase()}[testid=${el.getAttribute('data-testid')}](${el.scrollWidth}>${el.clientWidth})`);
  return {
    found: true,
    h3Text: h3 ? h3.textContent.trim() : null,
    cardSlugs: cards.map((c) => c.getAttribute('data-slug')),
    leafDomain: leafCandidates.length, leafOver,
    hiddenDomain: hiddenCandidates.length, hiddenOver,
    docScrollW: document.documentElement.scrollWidth, docClientW: document.documentElement.clientWidth,
  };
}, [ROOT_SEL]);

const measureDetail = (page) => page.evaluate(([ROOT_SEL]) => {
  const root = document.querySelector(ROOT_SEL);
  if (!root) return { found: false, why: 'ROOT_MISSING' };
  const h1 = root.querySelector('h1');
  const lead = root.querySelector('[data-testid="tech-report-lead"]');
  if (!h1 && !lead) return { found: false, why: 'HEADER_MISSING' };
  const dateMatches = [...(root.textContent.match(/\d{4}-\d{2}-\d{2}\s*(갱신|발행)/g) || [])];
  // headerStamp — 도장 축을 *그 요소*에 묶는다. root.textContent 전역 매치만 쓰면 리포트 데이터가
  // 담은 「(2026-07-13 갱신)」류 문자열(sources 제목·market.as_of에 루틴이 출처 갱신일을 적는다,
  // reusable-rocket 실측 2건)로도 통과하므로, 헤더 도장이 통째로 사라져도 red가 안 난다
  // (판정축이 대상과 독립이면 틀린 대상 위에서도 PASS한다 — CLAUDE.md 가토 ⑧ⓘ).
  const stampEl = h1 && h1.parentElement
    ? [...h1.parentElement.querySelectorAll('*')].find(
        (el) => el.children.length === 0 && /^\d{4}-\d{2}-\d{2}\s*(갱신|발행)$/.test(el.textContent.trim()))
    : null;
  const headerStamp = stampEl ? stampEl.textContent.trim() : null;
  const isSrOnly = (el) => !!el.closest('.sr-only');
  const isHandled = (el) => {
    const cs = getComputedStyle(el);
    return cs.textOverflow === 'ellipsis' || cs.overflowWrap === 'anywhere' || cs.overflowWrap === 'break-word';
  };
  const all = [...root.querySelectorAll('*')].filter((el) => !isSrOnly(el));
  const leafCandidates = all.filter((el) => el.children.length === 0 && el.textContent.trim() !== '');
  const leafOver = leafCandidates
    .filter((el) => el.scrollWidth > el.clientWidth + 1 && !isHandled(el))
    .map((el) => `${el.tagName.toLowerCase()}:"${el.textContent.trim().slice(0, 24)}"(${el.scrollWidth}>${el.clientWidth})`);
  const hiddenCandidates = all.filter((el) => getComputedStyle(el).overflow === 'hidden');
  const hiddenOver = hiddenCandidates
    .filter((el) => el.scrollWidth > el.clientWidth + 1 && !isHandled(el))
    .map((el) => `${el.tagName.toLowerCase()}[testid=${el.getAttribute('data-testid')}](${el.scrollWidth}>${el.clientWidth})`);
  return {
    found: true,
    h1Text: h1 ? h1.textContent.trim() : null,
    leadText: lead ? lead.textContent.trim() : null,
    dateMatches, headerStamp,
    leafDomain: leafCandidates.length, leafOver,
    hiddenDomain: hiddenCandidates.length, hiddenOver,
    docScrollW: document.documentElement.scrollWidth, docClientW: document.documentElement.clientWidth,
  };
}, [ROOT_SEL]);

// nav-label — 존재 축은 식별된 나브 컴포넌트 2곳(PC 서브바 / 모바일 seg)을 각각 조회한다
// (위 헤더 주석의 구조 사실 참조 — main.page-wrap 하나로는 두 뷰포트를 동시에 못 잡는다).
const measureNav = (page) => page.evaluate(() => {
  const texts = (sel) => [...document.querySelectorAll(sel)].map((a) => a.textContent.trim());
  return {
    subbar: texts('.masthead-subbar a'),
    seg: texts('main.page-wrap .seg a'),
    // 부재(선도기술 0건) 안전망은 document 전체 — 다중 나브 사본이 있어도 부재 확인엔 무해하다.
    bodyStale: (document.body.textContent.match(/선도기술/g) || []).length,
  };
});

// ── 실행 ──────────────────────────────────────────────────────────────────────
const VIEWS = [
  { key: 'pc1440', opts: { viewport: { width: 1440, height: 1000 } } },
  { key: 'm390', opts: { ...devices['iPhone 13'] } },
];

const browser = await chromium.launch();

for (const V of VIEWS) {
  // SW가 /api/*를 가로챈다 — 옛 캐시된 응답을 돌려줄 여지를 없앤다.
  const ctx = await browser.newContext({ ...V.opts, serviceWorkers: 'block' });
  await ctx.addInitScript(([a, r]) => {
    localStorage.setItem('access_token', a);
    localStorage.setItem('refresh_token', r);
    localStorage.setItem('theme', 'light');
    localStorage.setItem('pwa-install-dismissed-at', String(Date.now()));
  }, [access_token, refresh_token]);

  // ══ 목록 페이지 ═══════════════════════════════════════════════════════════
  {
    const tag = `${V.key}/list`;
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push(String(e)));

    await page.goto(`${BASE}/tech-reports`, { waitUntil: 'networkidle' }).catch((e) => errs.push(`goto:${e}`));
    await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0).catch(() => {});
    await page.waitForTimeout(600);

    let m = await measureList(page);
    if (!m.found) {
      await page.waitForTimeout(1500);
      m = await measureList(page);
    }
    eq(`section:${tag}`, m.found ? 'PRESENT' : `SECTION_MISSING(${m.why})`, 'PRESENT');
    bump('section');

    if (m.found) {
      // (1) list-heading
      eq(`list-heading:${tag}`, m.h3Text, '주요기술 리포트', 'h3');
      bump('list-heading');

      // (2) card-count — API 응답 길이와 정확히 대조(개수뿐 아니라 slug 집합도, 가토 ⑧ⓘ 대응)
      eq(`card-count:${tag}`, m.cardSlugs.length, REPORTS.length, `카드 ${m.cardSlugs.length} vs 응답 ${REPORTS.length}`);
      eq(`card-count-slugs:${tag}`, [...m.cardSlugs].sort(), REPORTS.map((r) => r.slug).sort(), '카드 slug 집합 == 응답 slug 집합');
      bump('card-count', 2);

      // (6) page-h-scroll (list)
      eq(`page-h-scroll:${tag}`, m.docScrollW <= m.docClientW + 1 ? 'OK' : `HSCROLL(${m.docScrollW}>${m.docClientW})`, 'OK');
      bump('page-h-scroll');

      // (7) text-clipped (list)
      eq(`text-clipped-leaf-domain:${tag}`, m.leafDomain > 0 ? 'OK' : 'DOMAIN_EMPTY', 'OK', `leaf후보 ${m.leafDomain}개`);
      eq(`text-clipped-leaf:${tag}`, m.leafOver, [], `leaf ${m.leafDomain}개 대조`);
      eq(`text-clipped-hidden:${tag}`, m.hiddenOver, [], `hidden컨테이너 후보 ${m.hiddenDomain}개(콘텐츠 의존, domain sentinel 없음) 대조`);
      bump('text-clipped', 2 + m.leafDomain + m.hiddenDomain);

      eq(`console:${tag}`, errs, [], '');
      bump('console');

      await page.screenshot({ path: `${OUT}/${V.key}-list.png`, fullPage: true });
    } else {
      eq(`console:${tag}`, errs, [], '측정 불가 화면');
      bump('console');
      await page.screenshot({ path: `${OUT}/${V.key}-list-fail.png`, fullPage: false });
    }

    // (1) nav-label — 목록 페이지에서 측정(나브는 라우트 무관하게 동일 구조)
    const nav = await measureNav(page);
    const allNavTexts = [...nav.subbar, ...nav.seg];
    eq(`nav-label-domain:${tag}`, allNavTexts.length > 0 ? 'OK' : `DOMAIN_EMPTY(subbar=${nav.subbar.length},seg=${nav.seg.length})`, 'OK',
      `subbar=${JSON.stringify(nav.subbar)} seg=${JSON.stringify(nav.seg)}`);
    eq(`nav-label-present:${tag}`, allNavTexts.includes('주요기술'), true, '두 나브 표면 중 하나에 「주요기술」 존재');
    eq(`nav-label-absent:${tag}`, allNavTexts.filter((t) => t === '선도기술'), [], '두 나브 표면 어디에도 「선도기술」 없음');
    eq(`nav-label-stale-body:${tag}`, nav.bodyStale, 0, 'document 전체(마스트헤드+모바일 하단 탭바 포함) 안전망 — 「선도기술」 0건');
    bump('nav-label', 4);

    rawLog.push(`${tag.padEnd(16)} h3=${JSON.stringify(m.h3Text)} · cards=${m.cardSlugs?.length ?? 'N/A'} · nav subbar=${JSON.stringify(nav.subbar)} seg=${JSON.stringify(nav.seg)} · docHscroll=${m.docScrollW}/${m.docClientW}`);
    await page.close();
  }

  // ══ 상세 페이지 — 대상 slug 전수(하드코딩 금지) ══════════════════════════════
  for (const rep of REPORTS) {
    const slug = rep.slug;
    const tag = `${V.key}/${slug}`;
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push(String(e)));

    await page.goto(`${BASE}/tech-report/${slug}`, { waitUntil: 'networkidle' }).catch((e) => errs.push(`goto:${e}`));
    await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0).catch(() => {});
    await page.waitForTimeout(600);

    let m = await measureDetail(page);
    if (!m.found) {
      await page.waitForTimeout(1500);
      m = await measureDetail(page);
    }
    eq(`section:${tag}`, m.found ? 'PRESENT' : `SECTION_MISSING(${m.why})`, 'PRESENT');
    bump('section');

    if (m.found) {
      // identity — 판정축보다 먼저(가토 ⑧ⓘ)
      eq(`identity-h1:${tag}`, m.h1Text ?? 'H1_MISSING', TECH_NAMES[slug], '기술명(TECH_NAMES 미러)');
      eq(`identity-lead:${tag}`, m.leadText ?? 'LEAD_MISSING', rep.title, `리드 = API title(${rep.title.length}자)`);
      bump('identity', 2);

      // (4) date-stamp
      eq(`date-stamp-domain:${tag}`, m.dateMatches.length > 0 ? 'OK' : 'DOMAIN_EMPTY(날짜 도장 텍스트가 없다)', 'OK',
        `matches=${JSON.stringify(m.dateMatches)}`);
      const staleStamps = m.dateMatches.filter((s) => s.includes('발행'));
      eq(`date-stamp-updated:${tag}`, staleStamps, [], `「발행」 도장 0건이어야 한다 · 전체=${JSON.stringify(m.dateMatches)}`);
      // 헤더 도장 자체를 API published_date와 exact 대조 — 위 두 축은 root 전역 매치라
      // 리포트 데이터의 「… 갱신」 문자열로도 통과한다(그 느슨함을 이 축이 막는다, 가토 ⑧ⓘ).
      eq(`date-stamp-header:${tag}`, m.headerStamp ?? 'HEADER_STAMP_MISSING', `${rep.published_date} 갱신`,
        `헤더 도장 = API published_date + 「갱신」`);
      bump('date-stamp', 3 + m.dateMatches.length);

      // (6) page-h-scroll (detail)
      eq(`page-h-scroll:${tag}`, m.docScrollW <= m.docClientW + 1 ? 'OK' : `HSCROLL(${m.docScrollW}>${m.docClientW})`, 'OK');
      bump('page-h-scroll');

      // (7) text-clipped (detail)
      eq(`text-clipped-leaf-domain:${tag}`, m.leafDomain > 0 ? 'OK' : 'DOMAIN_EMPTY', 'OK', `leaf후보 ${m.leafDomain}개`);
      eq(`text-clipped-leaf:${tag}`, m.leafOver, [], `leaf ${m.leafDomain}개 대조`);
      eq(`text-clipped-hidden:${tag}`, m.hiddenOver, [], `hidden컨테이너 후보 ${m.hiddenDomain}개(콘텐츠 의존) 대조`);
      bump('text-clipped', 2 + m.leafDomain + m.hiddenDomain);

      eq(`console:${tag}`, errs, [], '');
      bump('console');

      await page.screenshot({ path: `${OUT}/${V.key}-${slug}.png`, fullPage: true });
    } else {
      eq(`console:${tag}`, errs, [], '측정 불가 화면');
      bump('console');
      await page.screenshot({ path: `${OUT}/${V.key}-${slug}-fail.png`, fullPage: false });
    }

    // (5) history-gone — 그 slug의 실제 published_date로 옛 단건 조회 라우트를 때린다(GET만).
    const histRes = await fetch(`${BASE}/api/tech-reports/${slug}/${rep.published_date}`, { headers: AUTH });
    const histCat = (histRes.status === 404 || histRes.status === 405) ? 'GONE' : String(histRes.status);
    eq(`history-gone:${tag}`, histCat, 'GONE',
      `GET /api/tech-reports/${slug}/${rep.published_date} → ${histRes.status}(기대: 404 또는 405)`);
    bump('history-gone');

    rawLog.push(`${tag.padEnd(16)} h1=${JSON.stringify(m.h1Text)} · dateMatches=${JSON.stringify(m.dateMatches)} · history=${histRes.status} · docHscroll=${m.docScrollW}/${m.docClientW}`);
    await page.close();
  }

  await ctx.close();
}
await browser.close();

// history-gone 도메인 sentinel — 전수 실행 후 한 번에(위 루프에서 REPORTS가 비면 이 축 자체가 0건).
eq('history-gone-domain', REPORTS.length > 0 ? 'OK' : 'DOMAIN_EMPTY(발행물이 하나도 없다)', 'OK', `발행물 ${REPORTS.length}건`);
bump('history-gone-domain');

// ── 보고 ──────────────────────────────────────────────────────────────────────
const fails = results.filter((r) => !r.ok);
console.log('\n' + '═'.repeat(78));
console.log('커버리지 (계열별 검사 수 — 재실행 간 비교용, 줄면 통과가 아니라 측정 실패):');
for (const [k, v] of Object.entries(cov).sort()) console.log(`  ${k.padEnd(24)} ${v}`);
console.log(`  ${'(합계)'.padEnd(24)} ${Object.values(cov).reduce((a, b) => a + b, 0)}`);
console.log(`\n단언 총계: ${results.length}건 · PASS ${results.length - fails.length} · FAIL ${fails.length}`);
console.log(`뷰 ${VIEWS.length}조합 × (목록 1 + 상세 ${REPORTS.length}) = ${VIEWS.length * (1 + REPORTS.length)}페이지`);
console.log('\n원시 실측(단언 아님):');
for (const l of rawLog) console.log(`  ${l}`);
console.log(`\n※ 육안 캡처 ${OUT}/ — {view}-{list|slug}.png`);
console.log('═'.repeat(78));
fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ cov, results, reportsAtRun: REPORTS.map((r) => r.slug) }, null, 2));
if (fails.length) {
  console.log('\nFAIL 상세:');
  for (const f of fails) console.log(`  ✗ ${f.tag}\n      ${f.msg}`);
  process.exit(1);
}
console.log(`\nALL PASS ${results.length}/${results.length}`);
