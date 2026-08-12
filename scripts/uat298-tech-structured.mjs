// task#298 S6 라이브 UAT(신규) — 주요기술 리포트 상세의 「계열 비교」(VariantTable) + 「확인할 지표」
// (WatchItems) 두 섹션을 잰다.
//
// ⚠️⚠️ 순서 경고 — commit+push(+build) **전에** 돌릴 것. push ~20초 뒤 새 번들이 라이브가 되므로
// 그 순간 "지금 FAIL이 정상"이라는 이 파일의 전제가 무효화된다. 이 스크립트는 GET + page.route
// 주입뿐(POST 0) — 배포 전 실행이 안전하다.
//
// ── 착수 시 실측(2026-08-12, GET만, 무쓰기) ─────────────────────────────────────────────────────
//   frontend/src/pages/TechReport.jsx 직독 확인:
//     · 「계열 비교」(VariantTable, id="variants")는 **이미 배선됨**(S1~S4 완료) — 계보 분류 바로 앞,
//       게이트 `variantTableLayout(report.variants).axes.length > 0`.
//     · 「확인할 지표」는 **SECTIONS 배열에 없다** — `grep -rn "watch_items|watchItemsLayout|WatchItems"
//       frontend/src` 매치 0(주석 제외), `components/tech/WatchItems.jsx` 파일 자체가 없다(find 확인).
//       즉 이 섹션은 "배포 전이라 안 보이는" 것이 아니라 **이 체크아웃에 아직 존재하지 않는다**.
//       ⚠️ 이 사실은 배포와 무관하게 참이다 — 배포해도 watch-items 관련 축은 계속 RED로 남는다.
//       그것 자체가 신호다(구현 완료의 게이트). 아래 watch-item-* 셀렉터는 VariantTable.jsx의 testid
//       관례(`tech-report-variant-name`/`-examples`/`-feature`)를 그대로 확장한 **가정**이며,
//       실제 구현이 다른 testid를 쓰면 배포 후에도 이 축들은 DOMAIN_MISSING으로 남는다 — 구현 시
//       아래 셀렉터에 맞추거나 이 프로브를 갱신할 것(가정: 컨테이너 `tech-report-watch-items` · 항목
//       `tech-report-watch-item` · 라벨 `tech-report-watch-item-label` · 상세 `tech-report-watch-item-detail`
//       · 신호아님 배지(고정 문구, 1줄) `tech-report-watch-item-not-signal-badge` · 신호아님 문장(자유
//       서술, 다줄 허용) `tech-report-watch-item-not-signal-text`).
//   라이브 발행물 4종(reusable-rocket·robotics·smr·solid-state-battery) 전부 variants·watch_items가
//   NULL(메인 세션 확인 사실, 아래 실행에서 real 모드로 재확인) → absent-when-null 축의 근거.
//   콘텐츠 폭(실측): PC 1440 748px · m390 318px · m350 278px.
//   VariantTable.jsx 소스 직독(테이블 규율 계승): NAME_TEXT/EXAMPLES_TEXT/FEATURE_LINE 전부
//   `overflowWrap:'anywhere'`(`break-word` 아님, task#296 정정 준수) · minWidth/overflowX/nowrap 선언 0.
//
// ── 판정 규율(TESTING.md §7.3) ──────────────────────────────────────────────────────────────────
//  · 조건부 단언 금지 — 무조건 단언 + sentinel FAIL로 총계를 구조적으로 고정. mode(real/inject)는
//    실행 전에 결정되는 축의 정의역이라 조건부 스킵이 아니다(§7.3ⓛ) — 이유를 주석으로 명시.
//  · 축마다 `*-domain` sentinel, 리터럴 금지(기대값은 VariantTable.jsx를 그대로 미러링한 순수함수로
//    유도), 판정 범위는 본문 컨테이너로 한정, identity를 판정축보다 먼저.
//  · 진짜 줄 수 = 세로로 겹치지 않는 rect 묶음(task#293 measureLeaf 관용구 — top 동일성이 아니다).
//
// ── 대조군(기본 꺼짐, 이빨 실증 — 게이트 아님) ────────────────────────────────────────────────────
//   CONTROL=nowrap    : 계열 표 셀에 white-space:nowrap !important → page-h-scroll·
//                        variant-table-no-scroller가 FAIL해야 정상.
//   CONTROL=flatcolor : 신호아님 배지 색을 var(--text)로 강제 → not-signal-color가 FAIL해야 정상.
//                        ⚠️ WatchItems 미구현이므로 대상 셀렉터가 없다 — 이 실행은 지금 DOMAIN_MISSING만
//                        내고 이빨을 증명하지 못한다(구현 후에만 의미 있음, 헤더에 이미 경고).
import { chromium, devices } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat298';
fs.mkdirSync(OUT, { recursive: true });

console.log('※ 배포 전 실행 — red가 정상: variants-*(미배포)·watch-items-*(미구현, 배포 후에도 계속 RED 예상).');
console.log('※ inject 모드 = 실발행 아님 — page.route 주입 응답(prod tech_reports 쓰기 0). real 모드 = 실데이터 GET만.');

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
  nowrap: '[data-testid="tech-report-variant-table"] td, [data-testid="tech-report-variant-table"] th{white-space:nowrap !important}',
  flatcolor: '[data-testid="tech-report-watch-item-not-signal-badge"]{color:var(--text) !important}',
};
if (CONTROL && !CONTROL_CSS[CONTROL]) { console.error(`CONTROL=${CONTROL} 미지원(nowrap|flatcolor). 종료.`); process.exit(1); }
if (CONTROL) console.log(`⚠ 대조군 실행 — CONTROL=${CONTROL}: 해당 축이 FAIL해야 정상(게이트 결과 아님).`);

// ── 로그인(추정 폴백 없음) ────────────────────────────────────────────────────
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const { access_token, refresh_token } = await login.json();
if (!access_token) { console.error('로그인 실패 — access_token 없음. 종료.'); process.exit(1); }

const TECH_NAMES = { 'reusable-rocket': '재사용 로켓', 'solid-state-battery': '전고체 배터리', smr: 'SMR', robotics: '로봇' };
const SLUGS = ['smr', 'robotics']; // 축 1개 판(smr) · 축 2개 판(robotics) — 계약대로.

// ── 미러 1: VariantTable.jsx 소스 직독 그대로(리터럴 금지 — 기대값을 이 순수함수로 유도) ──────────
function buildRow(o) {
  const name = typeof o?.name === 'string' && o.name.trim() !== '' ? o.name : null;
  if (!name) return null;
  const examples = Array.isArray(o?.examples) ? o.examples.filter((e) => typeof e === 'string' && e.trim() !== '') : [];
  const examplesText = examples.length > 0 ? examples.join(' · ') : null;
  const strength = typeof o?.strength === 'string' && o.strength.trim() !== '' ? o.strength : null;
  const tradeoff = typeof o?.tradeoff === 'string' && o.tradeoff.trim() !== '' ? o.tradeoff : null;
  return { name, examplesText, strength, tradeoff };
}
function buildAxis(v) {
  const axisLabel = typeof v?.axis_label === 'string' && v.axis_label.trim() !== '' ? v.axis_label : null;
  if (!axisLabel) return null;
  const options = Array.isArray(v?.options) ? v.options : [];
  const rows = options.map(buildRow).filter(Boolean);
  if (rows.length < 2) return null;
  return { axisLabel, rows };
}
function variantTableLayoutMirror(variants) {
  const list = Array.isArray(variants) ? variants : [];
  return { axes: list.map(buildAxis).filter(Boolean) };
}
const DASH = '—';

// ── 미러 2: WatchItems — 구현이 없어 plan.md S1 스펙을 그대로 미러링(추정이 아니라 계획서 인용) ───
function buildWatchItem(o) {
  const label = typeof o?.label === 'string' && o.label.trim() !== '' ? o.label : null;
  if (!label) return null;
  const detail = typeof o?.detail === 'string' && o.detail.trim() !== '' ? o.detail : null;
  const notSignal = typeof o?.not_signal === 'string' && o.not_signal.trim() !== '' ? o.not_signal : null;
  return { label, detail, notSignal };
}
function watchItemsLayoutMirror(watchItems) {
  const list = Array.isArray(watchItems) ? watchItems : [];
  return { items: list.map(buildWatchItem).filter(Boolean) };
}

// ── 실응답 수집(GET만) + variants/watch_items NULL 사실 재확인 ──────────────────────────────────
const DATA = {};
for (const slug of SLUGS) {
  const res = await fetch(`${BASE}/api/tech-reports/${slug}`, { headers: { Authorization: `Bearer ${access_token}` } });
  const body = await res.json();
  const rep = (body.reports || [])[0];
  if (!rep) { console.error(`발행물 없음 — /api/tech-reports/${slug} reports[0] 부재. 종료.`); process.exit(1); }
  if (!TECH_NAMES[slug]) { console.error(`TECH_NAMES 미러에 ${slug} 없음. 종료.`); process.exit(1); }
  if (!rep.title) { console.error(`${slug}: title 부재 — identity 기대값 소스 없음. 종료.`); process.exit(1); }
  DATA[slug] = { rep, techName: TECH_NAMES[slug], title: rep.title, challenges: (rep.challenges || []).length };
  console.log(`  [실응답] ${slug}: title ${rep.title.length}자 · variants=${JSON.stringify(rep.variants)} · watch_items=${JSON.stringify(rep.watch_items)} · challenges ${DATA[slug].challenges}건`);
}

// ── 주입 픽스처(자립 — 라이브에서 상속하지 않는다) ────────────────────────────────────────────────
// smr = 축 1개(4옵션: 둘다있음·strength만·tradeoff만·둘다없음 — 「한쪽만 있는 행」 축의 표본).
const VARIANTS_SMR = [{
  axis_label: '냉각재 방식',
  options: [
    { name: '소듐냉각고속로', examples: ['한국형 SFR-PGSFR', '러시아 BN-800'],
      strength: '열전달 효율이 높아 노심을 소형화하는 데 유리하다', tradeoff: '소듐이 물·공기와 반응하면 화재 위험이 있다' },
    { name: '용융염냉각로', examples: ['테라파워 MCFR'], strength: '상압 운전이 가능해 압력용기 부담이 작다' },
    { name: '헬륨냉각 고온가스로', tradeoff: '열전달 계수가 낮아 대형 열교환기가 필요하다' },
    { name: '경수냉각 소형모듈로' },
  ],
}];
// robotics = 축 2개(계약: "축 수가 갈리는 두 판을 반드시 함께 잰다") — 간격 축의 표본.
const VARIANTS_ROBOTICS = [
  {
    axis_label: '구동 방식',
    options: [
      { name: '전동 액추에이터', examples: ['보스턴다이내믹스 Atlas'], strength: '정밀 제어가 쉽고 유지보수가 단순하다', tradeoff: '동력밀도가 유압 대비 낮다' },
      { name: '유압 액추에이터', strength: '순간 출력이 높아 고하중 작업에 유리하다', tradeoff: '누유·소음 관리 비용이 크다' },
      { name: '공압 액추에이터', tradeoff: '위치 제어 정밀도가 낮다' },
    ],
  },
  {
    axis_label: '자율성 수준',
    options: [
      { name: '원격 조작형', strength: '검증된 방식이라 즉시 현장 투입이 가능하다' },
      { name: '반자율 협업형', examples: ['LG 클로이'], strength: '단순 반복작업을 자동화해 인력 부담을 줄인다', tradeoff: '예외 상황 대응은 여전히 사람이 개입해야 한다' },
      { name: '완전자율형', tradeoff: '안전 인증·책임 소재 기준이 아직 미성숙하다' },
    ],
  },
];
const WATCH_ITEMS_SMR = [
  { label: '착공 신고 접수 여부', detail: '지자체 착공신고가 실제로 접수돼야 공정이 개시된 것으로 본다', not_signal: '설계 변경 논의 자체는 착공 지연의 신호가 아니다' },
  { label: '1차 안전성 심사 통과', detail: '규제기관 심사 통과 시점이 상용화 일정의 실질 지표다' },
  { label: '연료 공급 계약 체결', not_signal: '양해각서(MOU) 체결은 계약 체결과 다르다 — 구속력이 없다' },
  { label: '노형 인허가 신청 접수' },
];
const WATCH_ITEMS_ROBOTICS = [
  { label: '양산 라인 가동률', detail: '시제품이 아니라 실제 양산 라인의 가동률이 핵심이다', not_signal: '데모 영상 조회수는 양산 여부와 무관하다' },
  { label: '고객사 재구매 여부', detail: '초기 파일럿 이후 재주문이 있는지가 실질 수요 신호다' },
  { label: '핵심 부품 국산화율', not_signal: '보도자료의 "국산화 추진" 발표는 실제 국산화와 다르다' },
  { label: '누적 가동 시간(MTBF)' },
  { label: '안전사고 신고 건수', detail: '산업안전공단 신고 기준으로 집계한다' },
];
const FIXTURES = { smr: { variants: VARIANTS_SMR, watchItems: WATCH_ITEMS_SMR }, robotics: { variants: VARIANTS_ROBOTICS, watchItems: WATCH_ITEMS_ROBOTICS } };
for (const slug of SLUGS) {
  const lay = variantTableLayoutMirror(FIXTURES[slug].variants);
  const wLay = watchItemsLayoutMirror(FIXTURES[slug].watchItems);
  console.log(`  [주입 픽스처] ${slug}: 축 ${lay.axes.length}개(행 ${lay.axes.map((a) => a.rows.length).join(',')}) · 확인할 지표 ${wLay.items.length}건(신호아님 ${wLay.items.filter((i) => i.notSignal).length}건)`);
}
const injectedRep = (slug) => ({ ...DATA[slug].rep, variants: FIXTURES[slug].variants, watch_items: FIXTURES[slug].watchItems });

// ── 브라우저 안 측정기 ────────────────────────────────────────────────────────
const ROOT_SEL = 'main.page-wrap .page, main.page-wrap .m-page';

const measure = (page) => page.evaluate((ROOT_SEL) => {
  const root = document.querySelector(ROOT_SEL);
  if (!root) return { found: false, why: 'ROOT_MISSING' };
  const leadEl = root.querySelector('[data-testid="tech-report-lead"]');
  const h1 = root.querySelector('h1');
  if (!leadEl && !h1) return { found: false, why: 'HEADER_MISSING' };

  const txt = (el) => (el ? el.textContent.trim() : '');
  const cs = (el) => getComputedStyle(el);

  // 진짜 줄 수 = 세로로 겹치지 않는 rect 묶음(task#293 measureLeaf 관용구 — top 동일성 아님).
  const measureLeaf = (el) => {
    const scrollW = el.scrollWidth, clientW = el.clientWidth;
    const range = document.createRange(); range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    const groups = [];
    for (const r of [...rects].sort((a, b) => a.top - b.top)) {
      const g = groups.find((g) => {
        const ov = Math.min(g.bottom, r.bottom) - Math.max(g.top, r.top);
        return ov > 0.3 * Math.min(g.bottom - g.top, r.bottom - r.top);
      });
      if (g) { g.top = Math.min(g.top, r.top); g.bottom = Math.max(g.bottom, r.bottom); }
      else groups.push({ top: r.top, bottom: r.bottom });
    }
    return { text: txt(el), scrollW, clientW, clipped: scrollW > clientW + 1, lines: groups.length || 1 };
  };
  const titleTextOf = (el) => { const t = el.querySelector('.rpt-title__text'); return t ? t.textContent.trim() : null; };
  // 임시 노드에 CSS 변수를 실어 rgb 정규화(하드코딩 금지, §7.3③).
  const tokenColor = (name) => {
    const p = document.createElement('span'); p.style.color = `var(${name})`;
    document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c;
  };

  // ── 목차 ──
  const tocEl = root.querySelector('[data-testid="tech-report-toc"]');
  const chips = tocEl ? [...tocEl.querySelectorAll('[data-testid="tech-toc-chip"]')].map((a) => ({ label: txt(a), href: a.getAttribute('href') })) : [];
  const sectionEls = [...root.querySelectorAll('[data-tech-section]')];
  const sectionInfo = sectionEls.map((el) => ({ id: el.id, titleText: titleTextOf(el) }));

  // ── 계열 비교(variants) ──
  const variantsRoot = root.querySelector('[data-testid="tech-report-variants"]');
  const axisEls = variantsRoot ? [...variantsRoot.querySelectorAll('[data-testid="tech-report-variant-axis"]')] : [];
  const axisMetrics = axisEls.map((ax) => {
    const labelEl = ax.querySelector(':scope > div');
    const tableEl = ax.querySelector('[data-testid="tech-report-variant-table"]');
    const axRect = ax.getBoundingClientRect();
    const labelRect = labelEl ? labelEl.getBoundingClientRect() : null;
    const tableRect = tableEl ? tableEl.getBoundingClientRect() : null;
    const rows = [...ax.querySelectorAll('[data-testid="tech-report-variant-row"]')].map((tr) => {
      const nameEl = tr.querySelector('[data-testid="tech-report-variant-name"]');
      const exEl = tr.querySelector('[data-testid="tech-report-variant-examples"]');
      const featEl = tr.querySelector('[data-testid="tech-report-variant-feature"]');
      return {
        name: nameEl ? txt(nameEl) : null,
        nameLeaf: nameEl ? measureLeaf(nameEl) : null,
        exLeaf: exEl ? measureLeaf(exEl) : null,
        featChildren: featEl ? featEl.children.length : null,
        featText: featEl ? txt(featEl) : null,
        featLeaf: featEl ? measureLeaf(featEl) : null,
      };
    });
    return {
      top: axRect.top, bottom: axRect.bottom,
      labelBottom: labelRect ? labelRect.bottom : null, tableTop: tableRect ? tableRect.top : null,
      tableScrollW: tableEl ? tableEl.scrollWidth : null, tableClientW: tableEl ? tableEl.clientWidth : null,
      scrollAncestors: (() => {
        const out = [];
        for (let p = tableEl && tableEl.parentElement; p && p !== document.body; p = p.parentElement) {
          const ox = cs(p).overflowX;
          if (ox === 'auto' || ox === 'scroll') out.push(p.tagName.toLowerCase());
        }
        return out;
      })(),
      rows,
    };
  });
  const variantsHiddenClippers = variantsRoot ? [...variantsRoot.querySelectorAll('*')]
    .filter((e) => cs(e).overflowX === 'hidden' && txt(e).length > 0)
    .map((e) => ({ scrollW: e.scrollWidth, clientW: e.clientWidth })) : [];

  // ── 확인할 지표(watch-items) — 가정 셀렉터(헤더 주석 참조, 미구현이면 전부 null/0) ──
  const watchRoot = root.querySelector('[data-testid="tech-report-watch-items"]');
  const watchItemEls = watchRoot ? [...watchRoot.querySelectorAll('[data-testid="tech-report-watch-item"]')] : [];
  const watchItems = watchItemEls.map((it) => {
    const labelEl = it.querySelector('[data-testid="tech-report-watch-item-label"]');
    const badgeEl = it.querySelector('[data-testid="tech-report-watch-item-not-signal-badge"]');
    const nsTextEl = it.querySelector('[data-testid="tech-report-watch-item-not-signal-text"]');
    return {
      label: labelEl ? txt(labelEl) : null,
      hasBadge: !!badgeEl,
      badgeLeaf: badgeEl ? measureLeaf(badgeEl) : null,
      badgeColor: badgeEl ? cs(badgeEl).color : null,
      hasNsText: !!nsTextEl,
      nsTextLeaf: nsTextEl ? measureLeaf(nsTextEl) : null,
    };
  });

  const warnColor = tokenColor('--warn');
  const textColor = tokenColor('--text');
  const text2Color = tokenColor('--text-2');

  const rr = root.getBoundingClientRect();
  return {
    found: true, h1Text: h1 ? txt(h1) : null, leadText: leadEl ? txt(leadEl) : null,
    tocFound: !!tocEl, chips, sectionInfo,
    variantsFound: !!variantsRoot, axisCount: axisEls.length, axisMetrics,
    variantsHiddenClippers,
    watchFound: !!watchRoot, watchItemCount: watchItemEls.length, watchItems,
    warnColor, textColor, text2Color,
    docScrollW: document.documentElement.scrollWidth, docClientW: document.documentElement.clientWidth,
    vw: window.innerWidth,
  };
}, ROOT_SEL);

// ── 실행 ──────────────────────────────────────────────────────────────────────
const VIEWS = [
  { key: 'pc1440-light', theme: 'light', opts: { viewport: { width: 1440, height: 1000 } } },
  { key: 'pc1440-dark', theme: 'dark', opts: { viewport: { width: 1440, height: 1000 } } },
  { key: 'm390-light', theme: 'light', opts: { ...devices['iPhone 13'] } },
  { key: 'm350-dark', theme: 'dark', opts: { viewport: { width: 350, height: 700 } } },
];

const browser = await chromium.launch();

for (const V of VIEWS) {
  // SW가 /api/*를 가로챈다 — serviceWorkers:'block' 필수(안 하면 page.route 주입이 무음 no-op).
  const ctx = await browser.newContext({ ...V.opts, serviceWorkers: 'block' });
  await ctx.addInitScript(([a, r, th]) => {
    localStorage.setItem('access_token', a);
    localStorage.setItem('refresh_token', r);
    localStorage.setItem('theme', th);
    localStorage.setItem('pwa-install-dismissed-at', String(Date.now()));
  }, [access_token, refresh_token, V.theme]);

  const RUNS = SLUGS.flatMap((slug) => [{ mode: 'real', slug }, { mode: 'inject', slug }]);

  for (const R of RUNS) {
    const tag = `${V.key}/${R.mode}:${R.slug}`;
    const D = DATA[R.slug];
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errs.push(msg.text()); });
    page.on('pageerror', (e) => errs.push(String(e)));

    try {
      if (R.mode === 'inject') {
        await page.route(`**/api/tech-reports/${R.slug}`, async (route) => {
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ slug: R.slug, reports: [injectedRep(R.slug)] }) });
        });
      }

      await page.goto(`${BASE}/tech-report/${R.slug}`, { waitUntil: 'networkidle' }).catch((e) => errs.push(`goto:${e}`));
      await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0).catch(() => {});
      await page.waitForTimeout(1200);
      if (CONTROL) { await page.addStyleTag({ content: CONTROL_CSS[CONTROL] }); await page.waitForTimeout(300); }

      let m = await measure(page);
      if (!m.found) {
        console.log(`  (재시도) ${tag} — 본문 미검출(${m.why}), 1.8s 대기 후 재측정`);
        await page.waitForTimeout(1800);
        m = await measure(page);
      }
      eq(`page:${tag}`, m.found ? 'PRESENT' : `PAGE_MISSING(${m.why})`, 'PRESENT');
      bump('page');
      if (!m.found) {
        eq(`console:${tag}`, errs, [], '측정 불가 화면');
        bump('console');
        await page.screenshot({ path: `${OUT}/${V.key}-${R.slug}-${R.mode}-fail.png`, fullPage: false });
        await page.close();
        continue;
      }

      // ── (1) identity — 판정축보다 먼저 ──
      eq(`identity-h1:${tag}`, m.h1Text ?? 'H1_MISSING', D.techName, '기술명(TECH_NAMES 미러)');
      eq(`identity-lead:${tag}`, m.leadText ?? 'LEAD_MISSING', D.title, `리드 = API title(${D.title.length}자)`);
      eq(`identity-differ:${tag}`, new Set([D.techName, D.title]).size, 2, '이빨 — 기술명 ≠ 제목');
      bump('identity', 3);

      // ── 회귀방지축 — 문서 자체는 가로로 안 밀려야 한다(mode·control 무관하게 항상) ──
      eq(`page-h-scroll:${tag}`, m.docScrollW <= m.docClientW + 1 ? 'OK' : `HSCROLL(${m.docScrollW}>${m.docClientW})`, 'OK',
        `doc scrollW=${m.docScrollW}/clientW=${m.docClientW} · vw=${m.vw}`);
      bump('page-h-scroll');

      if (R.mode === 'real') {
        // ══ absent-when-null — 실행 전에 결정되는 정의역(mode='real'), 조건부 스킵 아님 ══
        eq(`absent-variants:${tag}`, m.variantsFound ? 'PRESENT(회귀!)' : 'ABSENT', 'ABSENT', 'variants=NULL인 실발행물 위 렌더');
        eq(`absent-watch-items:${tag}`, m.watchFound ? 'PRESENT(회귀!)' : 'ABSENT', 'ABSENT', 'watch_items=NULL인 실발행물 위 렌더');
        const chipLabels = m.chips.map((c) => c.label);
        eq(`absent-toc-chips:${tag}`, chipLabels.filter((l) => l === '계열 비교' || l === '확인할 지표'), [], `목차 칩 ${chipLabels.length}개`);
        bump('absent', 3);
        eq(`console:${tag}`, errs, [], 'real 실데이터 화면');
        bump('console');
        rawLog.push(`${tag.padEnd(24)} variants=ABSENT(${!m.variantsFound}) watch=ABSENT(${!m.watchFound}) chips=${JSON.stringify(chipLabels)}`);
        await page.screenshot({ path: `${OUT}/${V.key}-${R.slug}-real.png`, fullPage: false });
        await page.close();
        continue;
      }

      // ══ inject 모드 — 신규 축(배포 전 red 정상) ══════════════════════════════════════════════
      const wantLay = variantTableLayoutMirror(FIXTURES[R.slug].variants);
      const wantWatchLay = watchItemsLayoutMirror(FIXTURES[R.slug].watchItems);

      // ⓐ 계열 비교 — domain sentinel
      eq(`variants-domain:${tag}`, m.variantsFound ? 'PRESENT' : 'VARIANTS_MISSING(배포 전 — 정상 RED)', 'PRESENT');
      bump('variants');
      if (m.variantsFound) {
        eq(`variant-axis-count:${tag}`, m.axisCount, wantLay.axes.length, `픽스처 축 ${wantLay.axes.length}개`);
        bump('variant-axis');

        // table-no-scroller — 각 축마다 표 조상에 overflowX auto/scroll 0개 · 표 자신 넘침 0.
        const scrollerViol = [];
        const overflowViol = [];
        m.axisMetrics.forEach((ax, i) => {
          if (ax.scrollAncestors.length > 0) scrollerViol.push(`axis${i}:${JSON.stringify(ax.scrollAncestors)}`);
          if (ax.tableScrollW != null && ax.tableClientW != null && ax.tableScrollW > ax.tableClientW + 1) {
            overflowViol.push(`axis${i}:${ax.tableScrollW}>${ax.tableClientW}`);
          }
        });
        eq(`variant-table-no-scroller-ancestor:${tag}`, scrollerViol, [], `축 ${m.axisMetrics.length}개 대조`);
        eq(`variant-table-no-scroller-self:${tag}`, overflowViol, [], `축 ${m.axisMetrics.length}개 대조`);
        bump('variant-table-no-scroller', 2 * Math.max(m.axisMetrics.length, 1));

        // 잘림 2계열 — leaf(name/examples/feature) + overflow:hidden 컨테이너.
        const leafDomain = m.axisMetrics.flatMap((ax) => ax.rows.flatMap((r) => [r.nameLeaf, r.exLeaf, r.featLeaf].filter(Boolean)));
        eq(`variant-leaf-domain:${tag}`, leafDomain.length > 0 ? 'OK' : 'LEAF_DOMAIN_EMPTY', 'OK', `leaf ${leafDomain.length}개`);
        const clippedLeaves = leafDomain.filter((l) => l.clipped).map((l) => l.text.slice(0, 20));
        eq(`variant-leaf-clip:${tag}`, clippedLeaves, [], `leaf ${leafDomain.length}개 중 잘림`);
        const clippedContainers = m.variantsHiddenClippers.filter((c) => c.scrollW > c.clientW + 1);
        eq(`variant-container-clip:${tag}`, clippedContainers, [], `overflow:hidden 컨테이너 ${m.variantsHiddenClippers.length}개 중 잘림`);
        bump('variant-leaf', leafDomain.length + m.variantsHiddenClippers.length);

        // 한쪽만 있는 행 — 픽스처에서 유도(리터럴 금지). featChildren == (strength?1:0)+(tradeoff?1:0),
        // 둘 다 없으면 DASH 텍스트.
        const rowMismatch = [];
        wantLay.axes.forEach((axis, ai) => {
          const gotAx = m.axisMetrics[ai];
          axis.rows.forEach((wr, ri) => {
            const gr = gotAx ? gotAx.rows[ri] : null;
            if (!gr) { rowMismatch.push(`axis${ai}/row${ri}:ROW_MISSING(${wr.name})`); return; }
            if (gr.name !== wr.name) { rowMismatch.push(`axis${ai}/row${ri}:name got=${gr.name} want=${wr.name}`); return; }
            const wantMarkers = (wr.strength ? 1 : 0) + (wr.tradeoff ? 1 : 0);
            if (wantMarkers === 0) {
              if (gr.featText !== DASH) rowMismatch.push(`axis${ai}/row${ri}(${wr.name}):dash got="${gr.featText}"`);
            } else if (gr.featChildren !== wantMarkers) {
              rowMismatch.push(`axis${ai}/row${ri}(${wr.name}):markers got=${gr.featChildren} want=${wantMarkers}`);
            }
            const wantEx = wr.examplesText;
            const gotExText = gr.exLeaf ? gr.exLeaf.text : null;
            if (wantEx && gotExText !== wantEx) rowMismatch.push(`axis${ai}/row${ri}(${wr.name}):examples got="${gotExText}" want="${wantEx}"`);
            if (!wantEx && gr.exLeaf) rowMismatch.push(`axis${ai}/row${ri}(${wr.name}):examples 유령렌더(want null)`);
          });
        });
        eq(`variant-row-fidelity:${tag}`, rowMismatch, [], `픽스처 행 ${wantLay.axes.reduce((a, x) => a + x.rows.length, 0)}개 대조(한쪽만 있는 행 포함)`);
        bump('variant-row', wantLay.axes.reduce((a, x) => a + x.rows.length, 0));

        // 간격 축(가토 ⑩) — 축이 2개 이상인 판에서만: 축 사이 간격 > 소제목↔표 간격.
        // (실행 전에 결정되는 정의역 — 이 픽스처 조합에서 robotics만 해당, 조건부 스킵 아님)
        if (wantLay.axes.length >= 2) {
          const spacingViol = [];
          for (let i = 0; i < m.axisMetrics.length; i++) {
            const ax = m.axisMetrics[i];
            const labelTableGap = (ax.labelBottom != null && ax.tableTop != null) ? ax.tableTop - ax.labelBottom : null;
            if (i > 0) {
              const prev = m.axisMetrics[i - 1];
              const axisGap = ax.top - prev.bottom;
              if (!(labelTableGap != null && axisGap > labelTableGap)) {
                spacingViol.push(`axis${i}: axisGap=${Math.round(axisGap)} labelTableGap=${labelTableGap != null ? Math.round(labelTableGap) : null}`);
              }
            }
          }
          eq(`variant-spacing:${tag}`, spacingViol, [], `축 ${m.axisMetrics.length}개 — 축간격 > 소제목↔표간격이어야 한 덩어리로 안 읽힌다`);
          bump('variant-spacing', Math.max(m.axisMetrics.length - 1, 0));
        } else {
          NOTE(`${tag} — variant-spacing 정의역 밖(축 1개, 비교 대상 없음). smr 픽스처는 애초에 1축이다.`);
        }
      } else {
        NOTE(`${tag} — variant-* 세부 축 정의역 밖(컨테이너 자체가 없다). variants-domain이 이미 FAIL시켰다.`);
      }

      // ⓑ 확인할 지표 — domain sentinel(WatchItems.jsx 미구현이므로 지금은 항상 MISSING이 정상)
      eq(`watch-items-domain:${tag}`, m.watchFound ? 'PRESENT' : 'WATCH_ITEMS_MISSING(미구현 — 정상 RED, 헤더 주석 참조)', 'PRESENT');
      bump('watch');
      if (m.watchFound) {
        eq(`watch-item-count:${tag}`, m.watchItemCount, wantWatchLay.items.length, `픽스처 항목 ${wantWatchLay.items.length}개`);
        bump('watch-item', m.watchItemCount);
        const nsItems = m.watchItems.filter((it) => it.hasBadge);
        const wantNs = wantWatchLay.items.filter((i) => i.notSignal).length;
        eq(`watch-notsignal-domain:${tag}`, nsItems.length > 0 ? 'OK' : `NS_DOMAIN_EMPTY(want=${wantNs})`, wantNs > 0 ? 'OK' : `NS_DOMAIN_EMPTY(want=${wantNs})`,
          `신호아님 배지 ${nsItems.length}개(기대 ${wantNs}개)`);
        // 이빨 — --warn 토큰이 본문 토큰과 실제로 다른가(같아지면 아래 색 비교가 공허해진다).
        eq(`watch-warn-token-teeth:${tag}`, m.warnColor !== m.textColor && m.warnColor !== m.text2Color ? 'DISTINCT' : `SAME(warn=${m.warnColor},text=${m.textColor},text2=${m.text2Color})`, 'DISTINCT');
        const colorMismatch = nsItems.filter((it) => it.badgeColor === m.textColor || it.badgeColor === m.text2Color).map((it) => it.label);
        eq(`not-signal-color:${tag}`, colorMismatch, [], `배지 ${nsItems.length}개 — color가 본문(--text/--text-2)과 달라야 한다(기대 --warn=${m.warnColor})`);
        const badgeLineViol = nsItems.filter((it) => it.badgeLeaf && it.badgeLeaf.lines !== 1).map((it) => `${it.label}:lines=${it.badgeLeaf.lines}`);
        eq(`not-signal-badge-1line:${tag}`, badgeLineViol, [], `배지 ${nsItems.length}개 — 「신호 아님」 고정 라벨은 1줄`);
        bump('watch-notsignal', nsItems.length * 3);
      } else {
        NOTE(`${tag} — watch-item-* 세부 축 정의역 밖(컨테이너 자체가 없다). watch-items-domain이 이미 FAIL시켰다.`);
      }

      // ⓒ 목차 — 두 라벨이 있고 href가 문서 내 유일 요소로 해석되는가.
      const wantLabels = [];
      if (wantLay.axes.length > 0) wantLabels.push('계열 비교');
      if (wantWatchLay.items.length > 0) wantLabels.push('확인할 지표');
      const chipMap = new Map(m.chips.map((c) => [c.label, c.href]));
      const tocMissing = wantLabels.filter((l) => !chipMap.has(l));
      eq(`toc-includes-new:${tag}`, tocMissing, [], `기대 라벨 ${JSON.stringify(wantLabels)} · 실제 칩 ${JSON.stringify(m.chips.map((c) => c.label))}`);
      const ids = m.sectionInfo.map((s) => s.id);
      const dupIds = wantLabels.map((l) => {
        const href = chipMap.get(l); if (!href) return null;
        const id = href.slice(1);
        const count = ids.filter((x) => x === id).length;
        return count === 1 ? null : `${l}:${id} count=${count}`;
      }).filter(Boolean);
      eq(`toc-href-unique:${tag}`, dupIds, [], `href가 가리키는 id의 문서 내 유일성`);
      bump('toc', wantLabels.length * 2);

      // ⓓ section-order — 시장 규모는 항상 렌더(show:true)라 무조건 앵커로 쓴다.
      // challenges는 실행 전 데이터에 의존하는 정의역(있으면 추가로 대조, 없으면 NOTE).
      const idxOf = (id) => ids.indexOf(id);
      if (wantLay.axes.length > 0) {
        const iVar = idxOf('variants'), iMkt = idxOf('market');
        eq(`section-order-variants-before-market:${tag}`, (iVar !== -1 && iMkt !== -1 && iVar < iMkt) ? 'OK' : `variants@${iVar} market@${iMkt}`, 'OK');
        bump('order');
      }
      // task#301: 「계보 분류」 섹션은 데이터 의존 정의역이 아니라 **구조적으로 제거**됐다(업체 분류 축은
      // PlayerTable·ShareChart의 그룹 렌더로 흡수). 옛 `section-order-variants-before-categories` 축은
      // iCat이 영구히 -1이라 else NOTE로만 흘러 **조용히 죽은 축**이 됐다(적대 리뷰 렌즈2) — 삭제하지 않고
      // 「부재」를 단언하는 축으로 뒤집는다. 없는 축은 다음 사람이 존재 자체를 모르고, 이 형태는 섹션이
      // 되살아나는 회귀까지 잡는다. 정의역 의존이 없으므로 **무조건** 단언한다.
      eq(`section-categories-removed:${tag}`, idxOf('categories') === -1 ? 'ABSENT' : `RESURRECTED@${idxOf('categories')}`, 'ABSENT');
      bump('order');
      if (wantWatchLay.items.length > 0) {
        const iWi = idxOf('watch-items'), iMkt = idxOf('market'), iChal = idxOf('challenges');
        eq(`section-order-watchitems-before-market:${tag}`, (iWi !== -1 && iMkt !== -1 && iWi < iMkt) ? 'OK' : `watch-items@${iWi} market@${iMkt}`, 'OK');
        bump('order');
        if (iChal !== -1) {
          eq(`section-order-watchitems-after-challenges:${tag}`, (iWi !== -1 && iChal < iWi) ? 'OK' : `challenges@${iChal} watch-items@${iWi}`, 'OK');
          bump('order');
        } else {
          NOTE(`${tag} — challenges 정의역 밖(이 발행물엔 난제 섹션이 없다). market 앵커로 이미 대조했다.`);
        }
      }

      eq(`console:${tag}`, errs, [], 'inject 화면');
      bump('console');

      rawLog.push(`${tag.padEnd(24)} axisCount=${m.axisCount}(want ${wantLay.axes.length}) watchFound=${m.watchFound} chips=${JSON.stringify(m.chips.map((c) => c.label))} ids=${JSON.stringify(ids)}`);

      // ── 육안 캡처 ──
      await page.screenshot({ path: `${OUT}/${V.key}-${R.slug}-inject-top.png`, fullPage: false });
      await page.evaluate(() => document.querySelector('[data-tech-section="variants"]')?.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${OUT}/${V.key}-${R.slug}-inject-variants.png`, fullPage: false });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${OUT}/${V.key}-${R.slug}-inject-full.png`, fullPage: true });
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
console.log(`뷰 ${VIEWS.length}조합 × slug ${SLUGS.length} × mode 2 = ${VIEWS.length * SLUGS.length * 2}페이지`);
console.log('\n원시 실측(단언 아님):');
for (const l of rawLog) console.log(`  ${l}`);
if (CONTROL) console.log(`⚠ 이 실행은 대조군이다(CONTROL=${CONTROL}) — 해당 축 FAIL이 정상이며 게이트 결과가 아니다.`);
console.log('※ 배포 전 실행이면 variants-*(전부 배포 전 RED)와 watch-items-*(WatchItems.jsx 미구현으로');
console.log('  배포 후에도 계속 RED — 헤더 주석 참조)가 FAIL하는 것이 정상이다. absent-*·page-h-scroll은 지금도 PASS해야 한다.');
console.log(`※ 육안 캡처 ${OUT}/`);
console.log('═'.repeat(78));
fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ control: CONTROL || null, cov, results }, null, 2));
if (fails.length) {
  console.log('\nFAIL 상세:');
  for (const f of fails) console.log(`  ✗ ${f.tag}\n      ${f.msg}`);
  process.exit(1);
}
console.log(`\nALL PASS ${results.length}/${results.length}`);
for (const r of results) console.log(`  ✓ ${r.tag} — ${r.msg}`);
