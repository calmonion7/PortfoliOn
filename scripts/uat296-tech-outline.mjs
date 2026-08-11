// task#296 S6 라이브 UAT(신규) — 선도기술 리포트 상세의 <details> 펼치기 제거 + 전역 목차 + 표
// 스크롤러 제거를 잰다. **배포 전 실행 — 신규 축은 red가 정상**이다(라이브가 아직 task#280/282
// 상태 — SCROLLER 래퍼·6열 표·details 접기·note 토글이 그대로다, git show HEAD로 직독 확인).
// 이 스크립트는 read-only(GET만) — 무쓰기.
//
// ⚠️ 순서 경고(가토 §10①) — commit+push+build 전에 돌릴 것. 빌드는 즉시 라이브라 그 순간
// "지금 FAIL이 정상"이라는 이 파일의 전제가 무효화된다.
//
// ── 착수 시 라이브 실측(2026-08-12, GET만, 무쓰기) — 이 스크립트의 기대값은 전부 이 실측 또는
//    실응답에서 유도한다(리터럴 금지) ─────────────────────────────────────────────────────────
//   GET /api/tech-reports/smr      → players 10 · gap 9 · share 0 · ticker 0 · note 10 · headings 4
//                                     + rationale 1 → titledItems 5 · challenges 0 · related 전부 []
//   GET /api/tech-reports/robotics → players 12 · gap 12 · share 5 · ticker 4 · note 12 · headings 4
//                                     + rationale 1 → titledItems 5 · challenges 4 · related 전부 비어있지 않음
//   현재 라이브 DOM(git show HEAD 직독, PlayerTable.jsx·ProseSections.jsx 구판):
//     · `<div style={{overflowX:'auto', containerType:'inline-size'}}>`(export명 SCROLLER)가
//       `<table minWidth:600>`을 감싼다 — table-no-scroller의 정의역이 "스크롤러 조상 0개"인데
//       지금은 반드시 1개 있다(RED).
//     · 표는 6열 고정(업체·국가·기술수준·선두 대비·점유율·티커) — 국가·티커가 셀이다(post는 이름
//       셀 내부 메타줄로 이동, 열이 아니다).
//     · note 행은 `<details><summary aria-label="{name} 설명">설명</summary><div>{note}</div></details>`
//       — 기본 닫힘(브라우저 네이티브 <details> 미-open 기본값) → note 본문은 **클릭 전엔 rect 0**
//       (note-visible-without-click의 RED 근거). `role="group"`은 아예 없다(post 신규).
//     · ProseSections 소제목은 `<details data-testid="tech-prose-section"><summary>{title}</summary>
//       <p>{body 전체 1문단}</p></details>` — id·data-tech-section 속성 없음(목차 앵커 자체가 없다),
//       `<h3>` 0개, `<details>` = 소제목수+근거 = smr 5·robotics 5.
//     · `[data-testid="tech-report-toc"]` 자체가 없다(신규 표면) → toc-domain이 진짜 결함이 아니라
//       "아직 안 만들어진 기능"이라는 뜻의 RED다.
//   PC 1440 콘텐츠 748px(`.masthead-sticky` h=80, `position:sticky;top:0`) / m390 318px(마스트헤드
//   `display:none` h=0) / m350 278px(동일) — `documentElement` scrollW/clientW는 지금 이미 0
//   (표가 스크롤러 안이라) → **page-h-scroll은 회귀방지축**(지금도 PASS, 배포 후에도 PASS해야 한다).
//
// ── 판정 규율(TESTING.md §7.3 그대로) ────────────────────────────────────────────────────────
//  · 조건부 단언 금지 — 무조건 단언 + sentinel FAIL로 총계를 구조적으로 고정한다. 단, "이 기능이
//    아직 배포 전이다"·"뷰포트가 이렇다"처럼 **실행 전에 결정되는 축의 정의역**은 조건부 스킵이
//    아니다(§7.3ⓛ) — 그 경우도 도메인 자체를 무조건 sentinel로 먼저 못박고, 도메인 안의 세부
//    항목만 `if(도메인)`으로 감싼다(uat280/282의 `if (D.leaders.length > 0) {...} else NOTE(...)`
//    관용구와 동형).
//  · 축마다 *-domain sentinel, 리터럴 금지(기대값은 실응답에서 유도), 판정 범위는 본문 루트로 한정.
//  · identity를 판정축보다 먼저(§7.3ⓘ) — 대상이 틀려도 통과하는 축을 만들지 않는다.
//  · 진짜 줄 수 = 서로 다른 top 개수(rect 개수 아님, task#275).
//
// ── 대조군(기본 꺼짐, 이빨 실증 — 게이트 아님) ────────────────────────────────────────────────
//   CONTROL=notehide  : note 본문(role="group")을 강제로 숨김 → note-visible이 FAIL해야 정상.
//   CONTROL=scroller  : 「주요 업체」 섹션 래퍼에 overflow-x:auto를 주입 → table-no-scroller가
//                       FAIL해야 정상(스크롤러 조상이 다시 생긴 상태를 재현).
//   ⚠️ 이 대조군은 배포 *후* 대상 셀렉터(#players·role="group")가 실재해야 의미가 있다 — 배포 전
//   실행에서는 대상 자체가 없어 대조군도 DOMAIN_MISSING을 낼 뿐이며, 그건 결함이 아니다.
import { chromium, devices } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat296';
fs.mkdirSync(OUT, { recursive: true });

console.log('배포 전 실행 — 신규 축(toc-*, prose-details/h3, note-visible-without-click, table-no-scroller)은');
console.log('  FAIL이 정상이고, page-h-scroll·prose-lossless는 회귀방지축으로 PASS가 정상이다.');
console.log('실데이터 GET만(무쓰기) — page.route 주입 0.');

const results = [];
const P = (ok, tag, msg) => results.push({ ok, tag, msg });
const cov = {};
const bump = (k, n = 1) => { cov[k] = (cov[k] || 0) + n; };
const eq = (tag, got, want, note = '') => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  P(ok, tag, `${ok ? 'PASS' : 'FAIL'} — got=${JSON.stringify(got)} want=${JSON.stringify(want)}${note ? ' · ' + note : ''}`);
};
const NOTE = (msg) => console.log(`  ℹ ${msg}`);
const rawLog = [];

// ── 대조군 ────────────────────────────────────────────────────────────────────
const CONTROL = process.env.CONTROL || '';
const CONTROL_CSS = {
  notehide: '[data-testid="tech-report-player-note"] [role="group"]{display:none !important}',
  scroller: '[data-tech-section="players"]{overflow-x:auto !important}',
};
if (CONTROL && !CONTROL_CSS[CONTROL]) {
  console.error(`CONTROL=${CONTROL} 미지원(notehide|scroller). 종료.`); process.exit(1);
}
if (CONTROL) console.log(`⚠ 대조군 실행 — CONTROL=${CONTROL}: 해당 축이 FAIL해야 정상(게이트 결과 아님). 대상 배포 전엔 DOMAIN_MISSING일 수 있다.`);

// ── 로그인(추정 폴백 없음) ────────────────────────────────────────────────────
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const { access_token, refresh_token } = await login.json();
if (!access_token) { console.error('로그인 실패 — access_token 없음. 종료.'); process.exit(1); }

// TECH_NAMES 미러 — techReportUtils.js(백엔드는 표시명을 응답에 싣지 않는다, ADR-0033 결정 2).
const TECH_NAMES = { 'reusable-rocket': '재사용 로켓', 'solid-state-battery': '전고체 배터리', smr: 'SMR', robotics: '로봇' };
// slug 3종 — 열 조합과 폭 최악값을 함께 덮는다(라이브 DB 실측, 2026-08-12):
//   smr             = share·ticker 전 행 결측 → 3열(생략 판)
//   robotics        = share 5·ticker 4 → 4열 + 난제·연관 존재
//   reusable-rocket = share 1(SpaceX 50.9%) → **4열이고** country가 `프랑스·독일·일본`(9자)로 최장이다.
//     ⚠️ 이 판이 폭 최악값이다 — 적대 리뷰 렌즈1이 "전 열은 robotics뿐"이라는 계획 정정 자체를 정정했다.
//     스크롤러를 없앤 뒤 국가 문자열의 min-content가 곧 페이지 가로 스크롤이 되므로 반드시 포함한다.
const SLUGS = ['smr', 'robotics', 'reusable-rocket'];
const bracketHeadings = (t) => (typeof t === 'string' ? t.split('\n') : []).filter((l) => /^\[[^\]]+\]$/.test(l.trim())).length;

// ── 실응답 수집(GET만) ───────────────────────────────────────────────────────
const DATA = {};
for (const slug of SLUGS) {
  const res = await fetch(`${BASE}/api/tech-reports/${slug}`, { headers: { Authorization: `Bearer ${access_token}` } });
  const body = await res.json();
  const rep = (body.reports || [])[0];
  if (!rep) { console.error(`발행물 없음 — /api/tech-reports/${slug} reports[0] 부재. 종료.`); process.exit(1); }
  if (!TECH_NAMES[slug]) { console.error(`TECH_NAMES 미러에 ${slug} 없음. 종료.`); process.exit(1); }
  if (!rep.title) { console.error(`${slug}: title 부재 — lead identity 기대값 소스 없음. 종료.`); process.exit(1); }
  const rationale = ((rep.difficulty || {}).rationale || '').trim();
  const players = rep.players || [];
  const notedPlayers = players.filter((p) => typeof p.note === 'string' && p.note.trim() !== '');
  DATA[slug] = {
    rep, techName: TECH_NAMES[slug], title: rep.title, players,
    titledItems: bracketHeadings(rep.description) + (rationale ? 1 : 0),
    rationale,
    proseLines: (rep.description || '').split('\n').map((l) => l.trim()).filter((l) => l !== '' && !/^\[[^\]]+\]$/.test(l)),
    notedPlayers,
  };
  console.log(`  [실응답] ${slug}: title ${rep.title.length}자 · players ${players.length} · note있는업체 ${notedPlayers.length}` +
    ` · 소제목항목 ${DATA[slug].titledItems}(헤딩 ${bracketHeadings(rep.description)}+근거 ${rationale ? 1 : 0})`);
}

// ── 브라우저 안 측정기 ────────────────────────────────────────────────────────
const ROOT_SEL = 'main.page-wrap .page, main.page-wrap .m-page';

const measure = (page) => page.evaluate(([ROOT_SEL]) => {
  const root = document.querySelector(ROOT_SEL);
  if (!root) return { found: false, why: 'ROOT_MISSING' };
  const leadEl = root.querySelector('[data-testid="tech-report-lead"]');
  const h1 = root.querySelector('h1');
  if (!leadEl && !h1) return { found: false, why: 'HEADER_MISSING' };

  const cs = (el) => getComputedStyle(el);
  const txt = (el) => (el ? el.textContent.trim() : '');
  // ⚠️ 실측으로 발견한 신규 함정 — 닫힌 `<details>` 안의 자손은 Chromium이 내부적으로
  // `content-visibility: hidden`류 메커니즘으로 페인트를 억제하는데, **자손 자신의
  // `getBoundingClientRect()`/`getClientRects()`는 여전히 0이 아닌 값을 반환한다**(스크린샷으로
  // 미육안 렌더를 확인하면서도 rect는 `{w:284,h:40}`처럼 잡힌 걸 직접 재현·확정했다) — 그래서
  // rect 기반 가시성 검사만 쓰면 "닫힌 details 안 콘텐츠"를 전부 '보인다'로 오판한다(⑥의 사촌:
  // 저건 접근성 트리에서만 사라지고, 이건 **페인트에서만** 사라지는데 bbox엔 흔적이 남는 경우).
  // 그래서 rect 검사 *전에* "닫힌 <details> 자손인가"를 명시적으로 먼저 걸러낸다.
  const isDisclosureHidden = (el) => { const d = el.closest('details'); return !!(d && !d.open); };
  const rectVisible = (el) => {
    if (isDisclosureHidden(el)) return false;
    const r = el.getClientRects();
    return r.length > 0 && r[0].width > 0 && r[0].height > 0;
  };
  // 진짜 줄 수 = 서로 다른 top 개수(rect 개수 아님 — task#275, 폰트 혼합 시 top 반올림 필요, task#293).
  const lineCount = (el) => {
    const r = document.createRange(); r.selectNodeContents(el);
    return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size || 1;
  };

  // ── 마스트헤드 실측(하드코딩 금지 — 미디어쿼리가 바뀌면 자동으로 따라간다) ──
  const mastheadEl = document.querySelector('.masthead-sticky');
  const mastheadH = mastheadEl ? Math.round(mastheadEl.getBoundingClientRect().height) : 0;

  // ── 전역 목차 ──
  const tocEl = root.querySelector('[data-testid="tech-report-toc"]');
  const chips = tocEl ? [...tocEl.querySelectorAll('[data-testid="tech-toc-chip"]')].map((a) => {
    const b = a.getBoundingClientRect();
    return { label: txt(a), href: a.getAttribute('href'), left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top) };
  }) : [];
  // `[data-tech-section]`은 상위 섹션 전용이라 필터가 필요 없다 — 산문 소제목은 `data-tech-anchor`다.
  // (초안은 두 곳이 같은 속성을 써서 11-id 리터럴로 걸러야 했고, 그 목록이 페이지·vitest·이 프로브
  //  3곳에 복제됐다. 섹션이 12개가 되면 필터가 stale해져 정상 구현이 거짓 FAIL한다 → 속성을 갈랐다.)
  const sectionEls = [...root.querySelectorAll('[data-tech-section]')];
  const sectionInfo = sectionEls.map((el) => {
    const t = el.querySelector('.rpt-title__text');
    return { id: el.id, dataAttr: el.getAttribute('data-tech-section'), titleText: t ? txt(t) : null };
  });
  const allDtsIds = [...root.querySelectorAll('[data-tech-section]')].map((el) => el.id);
  // 산문 소제목 앵커 — 목차 항목은 아니지만 scroll-margin을 함께 타야 한다(TechReport.css).
  // 두 속성이 서로 배타적임을 잰다: 겹치면 `[data-tech-section]` 개수가 목차 칩 수와 어긋난다.
  const anchorEls = [...root.querySelectorAll('[data-tech-anchor]')];
  const anchorIds = anchorEls.map((el) => el.id);
  const anchorAlsoSection = anchorEls.filter((el) => el.hasAttribute('data-tech-section')).map((el) => el.id);

  // ── 산문 — h3 기반(post) vs details 기반(pre) 둘 다 잰다 ──
  const proseEl = root.querySelector('[data-testid="tech-report-prose"]');
  const proseDetails = proseEl ? proseEl.querySelectorAll('details').length : 0;
  const proseSummaries = proseEl ? proseEl.querySelectorAll('summary').length : 0;
  const proseSectionEls = proseEl ? [...proseEl.querySelectorAll('[data-testid="tech-prose-section"]')] : [];
  const h3s = proseEl ? [...proseEl.querySelectorAll('h3')] : [];
  const proseSubAnchors = proseSectionEls.map((el) => ({
    id: el.id, dataAttr: el.getAttribute('data-tech-section'),
    hasId: !!el.id, matches: el.id === el.getAttribute('data-tech-section'),
  }));
  // h3+그 뒤 문단들이 클릭 없이 이미 보이는가(post의 핵심 주장) — 각 섹션의 h3와 그 형제 <p> 전부.
  const h3Visible = h3s.map((h) => ({ t: txt(h).slice(0, 20), visible: rectVisible(h) }));
  const proseParas = proseEl ? [...proseEl.querySelectorAll('p')] : [];
  const proseParasVisible = proseParas.map((p) => rectVisible(p));

  // ── note ──
  const playersEl = root.querySelector('[data-testid="tech-report-players"]');
  const noteRows = playersEl ? [...playersEl.querySelectorAll('[data-testid="tech-report-player-note"]')] : [];
  // 업체 식별자를 index가 아니라 **DOM 인접 관계**로 구한다 — PlayerTable이 sortPlayers()로 정렬해
  // 렌더하므로 note 행 순서는 API 응답 순서와 다르다(fixed-index 매칭은 다른 업체의 note와 잘못
  // 대조하는 정렬-드리프트 버그를 만든다 — 위 note-lossless 1차 실행에서 실제로 3건 오탐이 났다).
  // note 행은 항상 그 업체 행의 바로 다음 형제다(PlayerTable.jsx 렌더 순서).
  const notes = noteRows.map((tr) => {
    const prevRow = tr.previousElementSibling;
    const nameEl = prevRow ? prevRow.querySelector('[data-testid="tech-report-player-name"]') : null;
    const group = tr.querySelector('[role="group"]');
    const summary = tr.querySelector('summary');
    const detailsEl = tr.querySelector('details');
    const bodyEl = group || tr.querySelector('div');
    const b = bodyEl ? bodyEl.getBoundingClientRect() : null;
    return {
      playerName: nameEl ? txt(nameEl) : null,
      hasGroup: !!group, groupAriaLabel: group ? group.getAttribute('aria-label') : null,
      hasSummary: !!summary, hasDetails: !!detailsEl,
      bodyVisibleNow: bodyEl ? rectVisible(bodyEl) : false,
      bodyText: bodyEl ? bodyEl.textContent : '',
      bodyWidth: b ? Math.round(b.width) : null,
    };
  });
  const tableClientW = playersEl ? playersEl.clientWidth : null;

  // ── table-no-scroller — 조상 중 overflowX auto/scroll이 있는가(0개여야 한다, post) ──
  const scrollAncestors = [];
  if (playersEl) {
    for (let p = playersEl.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = cs(p).overflowX;
      if (ox === 'auto' || ox === 'scroll') {
        scrollAncestors.push({ tag: p.tagName.toLowerCase(), testid: p.getAttribute('data-testid'), sectionId: p.id || null });
      }
    }
  }
  const tableScrollW = playersEl ? playersEl.scrollWidth : null;
  const tableClientW2 = playersEl ? playersEl.clientWidth : null;

  const rr = root.getBoundingClientRect();
  return {
    found: true,
    h1Text: h1 ? txt(h1) : null, leadText: leadEl ? txt(leadEl) : null,
    mastheadH,
    tocFound: !!tocEl, chips, sectionInfo, allDtsIds, anchorIds, anchorAlsoSection,
    proseFound: !!proseEl, proseDetails, proseSummaries, proseH3Count: h3s.length,
    proseSubAnchors, h3Visible, proseParaCount: proseParas.length, proseParasVisible,
    proseAllText: proseEl ? proseEl.textContent : '',
    noteRowCount: noteRows.length, notes, tableClientW,
    scrollAncestors, tableScrollW, tableClientW2,
    rootRight: Math.round(rr.right),
    docScrollW: document.documentElement.scrollWidth, docClientW: document.documentElement.clientWidth,
    vw: window.innerWidth, vh: window.innerHeight,
  };
}, [ROOT_SEL]);

// 목차 칩 클릭 후 착지 위치(같은 문서 내 앵커 이동 — 내비게이션 아니므로 클릭/읽기 분리에 하니스
// 함정(§7.2④)이 없다). 클릭과 측정을 분리한다 — 앵커 스크롤이 실제로 안착할 시간을 준다.
const clickChipAndMeasure = async (page, href) => {
  await page.evaluate((h) => document.querySelector(`[data-testid="tech-toc-chip"][href="${h}"]`)?.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(80);
  await page.click(`[data-testid="tech-toc-chip"][href="${href}"]`);
  await page.waitForTimeout(350);
  return page.evaluate((h) => {
    const id = h.slice(1);
    const el = document.getElementById(id);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { top: Math.round(b.top), vh: window.innerHeight, scrollY: Math.round(window.scrollY) };
  }, href);
};

// ── 실행 ──────────────────────────────────────────────────────────────────────
const VIEWS = [
  { key: 'pc1440-light', theme: 'light', pc: true, opts: { viewport: { width: 1440, height: 1000 } } },
  { key: 'pc1440-dark', theme: 'dark', pc: true, opts: { viewport: { width: 1440, height: 1000 } } },
  { key: 'm390-light', theme: 'light', pc: false, opts: { ...devices['iPhone 13'] } },
  { key: 'm350-dark', theme: 'dark', pc: false, opts: { viewport: { width: 350, height: 700 } } },
];

const browser = await chromium.launch();

for (const V of VIEWS) {
  // SW가 /api/*를 가로챈다 — 이 스크립트는 주입은 안 하지만 SW 캐시가 옛 응답을 돌려줄 여지를 없앤다.
  const ctx = await browser.newContext({ ...V.opts, serviceWorkers: 'block' });
  await ctx.addInitScript(([a, r, th]) => {
    localStorage.setItem('access_token', a);
    localStorage.setItem('refresh_token', r);
    localStorage.setItem('theme', th);
    localStorage.setItem('pwa-install-dismissed-at', String(Date.now())); // 배너 억제(pwa.js 직독)
  }, [access_token, refresh_token, V.theme]);

  for (const slug of SLUGS) {
    const D = DATA[slug];
    const tag = `${V.key}/${slug}`;
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push(String(e)));

    try {
      await page.goto(`${BASE}/tech-report/${slug}`, { waitUntil: 'networkidle' }).catch((e) => errs.push(`goto:${e}`));
      await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0).catch(() => {});
      await page.waitForTimeout(1200);
      if (CONTROL) { await page.addStyleTag({ content: CONTROL_CSS[CONTROL] }); await page.waitForTimeout(300); }

      let m = await measure(page);
      if (!m.found) { // 1회 재시도(무음 스킵 금지, id 명시)
        console.log(`  (재시도) ${tag} — 본문 미검출(${m.why}), 1.8s 대기 후 재측정`);
        await page.waitForTimeout(1800);
        m = await measure(page);
      }
      eq(`section:${tag}`, m.found ? 'PRESENT' : `SECTION_MISSING(${m.why})`, 'PRESENT');
      bump('section');
      if (!m.found) {
        eq(`console:${tag}`, errs, [], '측정 불가 화면');
        bump('console');
        await page.screenshot({ path: `${OUT}/${V.key}-${slug}-fail.png`, fullPage: false });
        await page.close();
        continue;
      }

      // ── (1) identity — 판정축보다 먼저 ──
      eq(`identity-h1:${tag}`, m.h1Text ?? 'H1_MISSING', D.techName, '기술명(TECH_NAMES 미러)');
      eq(`identity-lead:${tag}`, m.leadText ?? 'LEAD_MISSING', D.title, `리드 = API title(${D.title.length}자)`);
      eq(`identity-differ:${tag}`, new Set([D.techName, D.title]).size, 2, '이빨 — 기술명 ≠ 제목');
      bump('identity', 3);

      // ── (2) 마스트헤드 실측(기준 상자 추정 금지, §7.3③) ──
      eq(`masthead:${tag}`, V.pc ? (m.mastheadH > 0 ? 'PC_VISIBLE' : `PC_HIDDEN(${m.mastheadH})`) : (m.mastheadH === 0 ? 'MOBILE_HIDDEN' : `MOBILE_VISIBLE(${m.mastheadH})`),
        V.pc ? 'PC_VISIBLE' : 'MOBILE_HIDDEN', `실측 h=${m.mastheadH}px`);
      bump('masthead');

      // ══ ⓐ 전역 목차 — 신규 표면. 배포 전엔 존재 자체가 없어 그 사실이 RED다 ══════════════════
      eq(`toc-domain:${tag}`, m.tocFound ? 'PRESENT' : 'TOC_MISSING(신규 기능 — 배포 전 정상 RED)', 'PRESENT');
      bump('toc');
      if (m.tocFound) {
        // 목차 칩 수 == 상위 섹션 수. `[data-tech-section]`은 상위 섹션 전용이라 필터가 없다.
        eq(`toc-chip-count:${tag}`, m.chips.length, m.sectionInfo.length,
          `칩 ${m.chips.length}개 vs 상위 섹션 ${m.sectionInfo.length}개`);
        bump('toc-chip', m.chips.length);

        // ⚠️ 옛 `toc-filter-teeth`(전체 data-tech-section > 필터된 상위 섹션)를 **의도 기준으로 재작성**했다.
        // 속성을 가른 뒤엔 그 부등식이 구조적으로 성립 불가라 정상 구현에서 FAIL한다 — 임계를 완화하는
        // 대신 그 축이 원래 지키려던 보장을 직접 잰다(§7.3⑧ⓝ: 축이 낡은 메커니즘을 박제했으면 재작성).
        // 원래 보장 = 「산문 소제목 앵커가 목차 섹션으로 세어지지 않는다」. 두 조건으로 쪼갠다:
        //   ⓐ 산문 앵커가 실제로 존재한다(없으면 이 보장은 공허하다 → domain sentinel)
        //   ⓑ 두 속성이 배타적이다(한 요소가 둘 다 가지면 개수가 다시 어긋난다)
        eq(`toc-anchor-domain:${tag}`, m.anchorIds.length > 0 ? 'OK' : `NO_PROSE_ANCHORS(${m.anchorIds.length})`, 'OK',
          `data-tech-anchor ${m.anchorIds.length}개(산문 소제목) · data-tech-section ${m.allDtsIds.length}개(상위 섹션)`);
        eq(`toc-anchor-exclusive:${tag}`, m.anchorAlsoSection, [],
          `두 속성을 동시에 가진 요소 0개여야 한다 — 겹치면 칩 수 대조가 무의미해진다`);
        bump('toc-anchor', m.anchorIds.length);

        // href 고유성 — 문서 내 유일 요소로 해석되는가.
        const ids = m.sectionInfo.map((s) => s.id);
        eq(`toc-id-unique:${tag}`, new Set(ids).size, ids.length, `id ${ids.length}개 중 중복 0`);
        bump('toc-id', ids.length);

        // 칩 순서 == 상위 섹션 문서 순서(라벨·href로 대조 — 둘 다 같은 SECTIONS 배열에서 파생돼야 한다).
        eq(`toc-order:${tag}`, m.chips.map((c) => c.href), m.sectionInfo.map((s) => `#${s.id}`),
          `칩 순서 ${JSON.stringify(m.chips.map((c) => c.label))}`);
        bump('toc-order', m.chips.length);

        // 라벨 == 대상 섹션의 SectionTitle 텍스트(대상이 맞는가, §7.3⑧ⓘ) — "핵심 포인트" 섹션은
        // KeyPointCards가 자기 제목을 소유하므로 같은 `.rpt-title__text` 관용구로 잡힌다.
        const labelMismatch = m.chips.map((c) => {
          const target = m.sectionInfo.find((s) => `#${s.id}` === c.href);
          return target && target.titleText === c.label ? null : `${c.label}→${c.href}:titleText=${target ? target.titleText : 'TARGET_MISSING'}`;
        }).filter(Boolean);
        eq(`toc-label-match:${tag}`, labelMismatch, [], `칩 ${m.chips.length}개 대조`);
        bump('toc-label', m.chips.length);

        // 간격 축(가토 ⑩) — 칩끼리 한 덩어리로 읽히는가(인접 칩 간 거리) + 목차 ↔ 리드 문단 거리.
        const chipGaps = [];
        for (let i = 1; i < m.chips.length; i++) {
          if (Math.abs(m.chips[i].top - m.chips[i - 1].top) < 4) { // 같은 줄
            chipGaps.push(Math.round(m.chips[i].left - m.chips[i - 1].right));
          }
        }
        const farChipGaps = chipGaps.filter((g) => g < -2 || g > 30);
        eq(`toc-chip-gap:${tag}`, farChipGaps, [], `같은 줄 인접칩 간격 ${JSON.stringify(chipGaps)}px(gap:8 CSS 기준)`);
        bump('toc-chip-gap', chipGaps.length);

        // ⓐ 클릭-스크롤 — 각 칩을 눌러 대상이 마스트헤드 밑(가시 영역)에 착지하는가.
        //    기준 상자(마스트헤드)는 위에서 실측한 값을 쓴다(추정 금지).
        const badLandings = [];
        for (const c of m.chips) {
          const land = await clickChipAndMeasure(page, c.href);
          bump('toc-click');
          if (!land) { badLandings.push(`${c.href}:TARGET_GONE`); continue; }
          // 마스트헤드에 가려지지 않고(top >= mastheadH - 4) 화면 안에 있어야 한다(top <= vh).
          // 문서 끝 근처 섹션은 스크롤 여지가 부족해 margin만큼 못 올라올 수 있으나, 그 경우도
          // top은 마스트헤드보다 아래(더 큰 값)일 뿐 가려지지는 않는다 — 상한만 넉넉히 둔다.
          if (!(land.top >= m.mastheadH - 4 && land.top <= land.vh + 4)) {
            badLandings.push(`${c.href}:top=${land.top}(masthead=${m.mastheadH},vh=${land.vh})`);
          }
        }
        eq(`toc-scroll:${tag}`, badLandings, [], `클릭 ${m.chips.length}회`);
        // 원위치(다음 측정·캡처가 스크롤 잔여로 오염되지 않게)
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(200);
      } else {
        NOTE(`${tag} — toc-* 세부 축 정의역 밖(nav 자체가 없다). 배포 전 정상 상태이며 위 toc-domain이 이미 FAIL시켰다.`);
      }

      // ══ ⓑ 산문 — <details> 제거 + h3 상시 노출 ═══════════════════════════════════════════
      // 두 계열을 둘 다 잰다: 옛 메커니즘(details/summary)의 **부재**(post 주장) + 새 메커니즘
      // (h3, 클릭 없이 가시)의 **존재**(post 주장). 둘 다 지금은 반대 방향으로 RED다.
      eq(`prose-domain:${tag}`, m.proseFound ? 'OK' : 'PROSE_MISSING', 'OK', `titledItems=${D.titledItems}`);
      bump('prose');
      eq(`prose-details:${tag}`, m.proseFound ? m.proseDetails : 'PROSE_MISSING', 0,
        '<details> 메커니즘 완전 제거(배포 전엔 titledItems만큼 존재)');
      eq(`prose-summaries:${tag}`, m.proseFound ? m.proseSummaries : 'PROSE_MISSING', 0, '<summary> 0개');
      eq(`prose-h3-count:${tag}`, m.proseH3Count, D.titledItems, '소제목이 <h3>로 렌더(응답에서 유도)');
      bump('prose-mech', 3);

      // 산문 앵커 계약 — id·data-tech-section 동일값·유일성(TOC가 링크하지 않아도 구조 계약은
      // 지켜야 한다 — TechReport.test.jsx의 사촌 축, ProseSections.test.jsx⑤와 라이브 짝).
      eq(`prose-anchor-domain:${tag}`, m.proseSubAnchors.length, D.titledItems, 'h3 섹션 수 == 소제목 항목 수');
      const badAnchors = m.proseSubAnchors.map((a, i) => (a.hasId && a.matches) ? null : `#${i}:id=${a.id},data=${a.dataAttr}`).filter(Boolean);
      eq(`prose-anchor:${tag}`, badAnchors, [], `${m.proseSubAnchors.length}개 대조`);
      bump('prose-anchor', m.proseSubAnchors.length);

      // 클릭 없이 이미 보이는가(post의 핵심 주장) — h3와 그 뒤 문단 전부.
      eq(`prose-h3-visible-domain:${tag}`, m.h3Visible.length > 0 ? 'OK' : `H3_DOMAIN_EMPTY(titledItems=${D.titledItems})`, 'OK',
        `h3 ${m.h3Visible.length}개`);
      const hiddenH3 = m.h3Visible.filter((h) => !h.visible).map((h) => h.t);
      eq(`prose-h3-visible:${tag}`, hiddenH3, [], '클릭 없이 h3 전부 렌더 가시');
      bump('prose-h3-visible', m.h3Visible.length);
      eq(`prose-para-domain:${tag}`, m.proseParaCount > 0 ? 'OK' : 'PARA_DOMAIN_EMPTY', 'OK', `<p> ${m.proseParaCount}개`);
      const hiddenParas = m.proseParasVisible.filter((v) => !v).length;
      eq(`prose-para-visible:${tag}`, hiddenParas, 0, `<p> ${m.proseParaCount}개 중 숨겨진 것 0`);
      bump('prose-para', m.proseParaCount);

      // 손실 0 — 문단 분리·h3 승격 어느 쪽도 원문 글자를 지우지 않는다(회귀방지축 — pre/post 모두 PASS).
      eq(`prose-lossless:${tag}`, D.proseLines.filter((l) => !m.proseAllText.includes(l)).map((l) => l.slice(0, 24) + '…'), [],
        `본문 ${D.proseLines.length}줄 대조 · DOM ${m.proseAllText.length}자`);
      eq(`prose-lossless-rationale:${tag}`, D.rationale && m.proseAllText.includes(D.rationale) ? 'OK' : (D.rationale ? 'RATIONALE_LOST' : 'NO_RATIONALE'), D.rationale ? 'OK' : 'NO_RATIONALE');
      bump('prose-lossless', D.proseLines.length + 1);

      // ══ ⓒ note — 접기 제거 + role="group" 접근 이름 ═══════════════════════════════════════
      eq(`note-domain:${tag}`, m.noteRowCount, D.notedPlayers.length, 'note 있는 업체 수(응답에서 계산)');
      bump('note');
      const noNoteDetails = m.notes.map((n, i) => n.hasDetails ? `#${i}` : null).filter(Boolean);
      eq(`note-no-details:${tag}`, noNoteDetails, [], `${m.notes.length}건 — <details> 완전 제거(배포 전엔 전부 hasDetails)`);
      const noNoteSummary = m.notes.map((n, i) => n.hasSummary ? `#${i}` : null).filter(Boolean);
      eq(`note-no-summary:${tag}`, noNoteSummary, [], '<summary> 토글 완전 제거');
      // 클릭 없이 이미 보이는가(post의 핵심 주장) — 배포 전엔 닫힌 <details> 안이라 전부 rect 0.
      const notVisible = m.notes.map((n, i) => n.bodyVisibleNow ? null : `#${i}`).filter(Boolean);
      eq(`note-visible-without-click:${tag}`, notVisible, [], `${m.notes.length}건 — 클릭 0회로 전부 가시`);
      bump('note-mech', m.notes.length * 2);

      // 업체 식별은 이름으로(정렬 순서가 API 순서와 다르므로 index 매칭은 오탐을 낸다 — 1차 실행
      // 실측: 두산에너빌리티 등 3건이 fixed-index로 다른 업체의 note와 대조돼 거짓 NOTE_LOST가 났다).
      const noteByName = new Map(m.notes.map((n) => [n.playerName, n]));
      eq(`note-name-domain:${tag}`, D.notedPlayers.filter((p) => !noteByName.has(p.name)).map((p) => p.name), [],
        `note-name 매칭 실패 0건이어야 한다(=이름으로 렌더 note를 전부 찾을 수 있다)`);

      // role="group" + aria-label에 업체명 — <div aria-label>만으론 접근성 트리에 이름이 안 남는다(가토 ⑭).
      const badAccessName = D.notedPlayers.map((p) => {
        const n = noteByName.get(p.name);
        if (!n || !n.hasGroup) return `${p.name.slice(0, 12)}:GROUP_MISSING`;
        return n.groupAriaLabel && n.groupAriaLabel.includes(p.name) ? null : `${p.name.slice(0, 12)}:label=${n.groupAriaLabel}`;
      }).filter(Boolean);
      eq(`note-access-name:${tag}`, badAccessName, [], `${D.notedPlayers.length}건 대조 · aria-label에 업체명 포함해야 함`);
      bump('note-access', D.notedPlayers.length);

      // 손실 0 — 원문 note 텍스트가 렌더에 그대로 있는가(회귀방지축 성격 — textContent 기준이라 pre도
      // 사실 통과하지만, "클릭 안 해도" 보이는 위 note-visible-without-click과 짝지어야 의미가 있다).
      const noteLoss = D.notedPlayers.map((p) => {
        const n = noteByName.get(p.name);
        return n && n.bodyText.includes(p.note) ? null : `${p.name.slice(0, 12)}:NOTE_LOST`;
      }).filter(Boolean);
      eq(`note-lossless:${tag}`, noteLoss, [], `${D.notedPlayers.length}건 대조`);
      bump('note-lossless', D.notedPlayers.length + 1);

      // note 폭 — 표 자체 클라이언트폭 안(예전엔 스크롤러 100cqi 기준, 이제 스크롤러가 없으니
      // 표(=table 자신, 더 이상 스크롤러가 아니다) 클라이언트폭이 기준이다. 배포 전엔 닫혀 있어
      // width=null이 대부분이라(rect 0) 이 축은 배포 후에야 실질적으로 작동한다 — 출력은 지금도 한다.
      const noteWidthOver = m.notes.map((n, i) => (n.bodyWidth != null && m.tableClientW != null && n.bodyWidth > m.tableClientW + 1)
        ? `#${i}:${n.bodyWidth}>${m.tableClientW}` : null).filter(Boolean);
      eq(`note-width:${tag}`, noteWidthOver, [], `표 클라이언트폭=${m.tableClientW}px · 본문폭 ${JSON.stringify(m.notes.map((n) => n.bodyWidth))}`);

      // ══ ⓓ table-no-scroller / page-h-scroll ══════════════════════════════════════════════
      eq(`table-domain:${tag}`, m.tableScrollW != null ? 'OK' : 'TABLE_MISSING', 'OK');
      bump('table');
      eq(`table-no-scroller-ancestor:${tag}`, m.scrollAncestors, [],
        `조상 중 overflowX auto/scroll 0개 기대(배포 전엔 SCROLLER 래퍼 1개 존재)`);
      eq(`table-no-scroller-self:${tag}`, m.tableScrollW <= m.tableClientW2 + 1 ? 'OK' : `TABLE_OVERFLOW(${m.tableScrollW}>${m.tableClientW2})`, 'OK',
        `table 자신 scrollW=${m.tableScrollW}/clientW=${m.tableClientW2}(모바일은 배포 전엔 스크롤러가 흡수해 이 항목만 보면 정상처럼 보일 수 있다)`);
      bump('table-scroller', 2);
      // 회귀방지축 — 표가 스크롤러에 담겨 있든(pre) 없든(post) 문서 자체는 가로로 안 밀려야 한다.
      eq(`page-h-scroll:${tag}`, m.docScrollW <= m.docClientW + 1 ? 'OK' : `HSCROLL(${m.docScrollW}>${m.docClientW})`, 'OK',
        `doc scrollW=${m.docScrollW}/clientW=${m.docClientW} · vw=${m.vw}`);
      bump('page-h-scroll');

      eq(`console:${tag}`, errs, [], '실데이터 화면');
      bump('console');

      rawLog.push(`${tag.padEnd(20)} masthead=${m.mastheadH}px · toc=${m.tocFound}(칩${m.chips.length}) · ` +
        `prose details=${m.proseDetails}/summary=${m.proseSummaries}/h3=${m.proseH3Count} · ` +
        `note rows=${m.noteRowCount}(group=${m.notes.filter((n) => n.hasGroup).length},visible=${m.notes.filter((n) => n.bodyVisibleNow).length}) · ` +
        `scrollAncestors=${JSON.stringify(m.scrollAncestors)} · table ${m.tableScrollW}/${m.tableClientW2} · doc ${m.docScrollW}/${m.docClientW}`);

      // ── 육안 캡처 ──
      await page.screenshot({ path: `${OUT}/${V.key}-${slug}-top.png`, fullPage: false });
      await page.evaluate(() => document.querySelector('[data-testid="tech-report-players"]')?.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${OUT}/${V.key}-${slug}-table.png`, fullPage: false });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${OUT}/${V.key}-${slug}-full.png`, fullPage: true });
    } catch (e) {
      eq(`exception:${tag}`, `THROWN:${e && e.message}`, 'NO_EXCEPTION');
      bump('exception');
    }
    await page.close();
  }
  await ctx.close();
}
await browser.close();

// ── 보고 ──────────────────────────────────────────────────────────────────────
const fails = results.filter((r) => !r.ok);
console.log('\n' + '═'.repeat(78));
console.log('커버리지 (계열별 검사 수 — 재실행 간 비교용, 줄면 통과가 아니라 측정 실패):');
for (const [k, v] of Object.entries(cov).sort()) console.log(`  ${k.padEnd(24)} ${v}`);
console.log(`  ${'(합계)'.padEnd(24)} ${Object.values(cov).reduce((a, b) => a + b, 0)}`);
console.log(`\n단언 총계: ${results.length}건 · PASS ${results.length - fails.length} · FAIL ${fails.length}`);
console.log(`뷰 ${VIEWS.length}조합 × slug ${SLUGS.length} = ${VIEWS.length * SLUGS.length}페이지`);
console.log('\n원시 실측(단언 아님):');
for (const l of rawLog) console.log(`  ${l}`);
if (CONTROL) console.log(`⚠ 이 실행은 대조군이다(CONTROL=${CONTROL}) — 해당 축 FAIL이 정상이며 게이트 결과가 아니다.`);
console.log('※ 배포 전 실행이면 신규 축(toc-*, prose-details/summary/h3-*, note-no-details/no-summary/');
console.log('  visible-without-click, table-no-scroller-*)이 FAIL하는 것이 정상이다.');
console.log(`※ 육안 캡처 ${OUT}/ — {view}-{slug}-{top|table|full}.png`);
console.log('═'.repeat(78));
fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ control: CONTROL || null, cov, results }, null, 2));
if (fails.length) {
  console.log('\nFAIL 상세:');
  for (const f of fails) console.log(`  ✗ ${f.tag}\n      ${f.msg}`);
  process.exit(1);
}
console.log(`\nALL PASS ${results.length}/${results.length}`);
for (const r of results) console.log(`  ✓ ${r.tag} — ${r.msg}`);
