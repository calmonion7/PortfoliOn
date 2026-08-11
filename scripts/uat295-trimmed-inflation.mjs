// task#295 S6 라이브 UAT — 시장지표 탭 "절사평균 물가 (미국)"(TrimmedInflationSection) 프로브.
// **아직 배포되지 않았다** — 이 실행은 red-first 증거 확보용이다(TESTING.md §10①, 프론트 빌드=
// 배포라 이 세션은 빌드/커밋/푸시를 하지 않는다). 확인: `git rev-parse HEAD` == origin/main,
// TrimmedInflationSection.jsx는 untracked, `frontend/dist` mtime(01:09)이 컴포넌트 mtime(01:30)보다
// 이르다 — 라이브 번들에 이 컴포넌트가 없다. 배포 후 재실행하면 ALL PASS로 전환돼야 한다.
//
// 대상 컴포넌트는 uat294의 LaborSurveySection과 형태가 다르다 — 그대로 베끼면 축이 틀린 것을
// 잰다(TESTING §7.3ⓘ류 함정의 저작판): 이중 Y축 오버레이가 아니라 **4계열 전부 단일 축(%)**이고,
// "타일 2개"가 아니라 **`.chart-legend__item` 범례 4개**(코어 PCE·Dallas 절사평균·Cleveland 절사평균·
// 헤드라인 PCE, 이 순서)에 최신값이 실린다.
//
// 판정축(요청 9종을 아래로 매핑):
//  1. section-exists / section-healthy — 제목 "절사평균 물가 (미국)"이 main.page-wrap 본문에 있고
//     button(클릭 가능=정상) 상태인가.
//  2. chart-rendered — chartbox는 1개뿐. 플롯 surface는 `.recharts-surface` 첫 매치가 아니라
//     부모가 `.recharts-wrapper`인 것(TESTING §7.2⑦ — 첫 매치는 범례 아이콘 14×14일 수 있다).
//  3. ⭐ line-count — `.recharts-line-curve` 개수. 4보다 적으면 계열 누락.
//  4. ⭐⭐ yaxis-count — **1개**여야 한다(4종이 전부 같은 단위 %). `.recharts-yAxis` 하위 셀렉터는
//     recharts 3에서 0건이 난다(축 틱 <text>가 그 하위가 아니다) → 틱 <text>를 x 속성으로 군집화해
//     같은 x를 3개 이상 공유하는 군집을 세로축으로 판정. 2개면 단위 혼동으로 이중축이 생긴 신호.
//  5. ⭐⭐⭐ value-range[0..3] — 이 섹션의 **최대 위험을 겨냥한 축**: 지수값(약 131, 원래 FRED
//     레벨)이 %축(범위 0~10 기대)에 하나라도 새면 즉시 FAIL. identity(어느 지표인지)를 detail에 싣는다.
//  6. value-format[0..3] — 범례 값이 `-?\d+\.\d{2}%` 소수 2자리 형태인가(fmtPct2 계약).
//     + legend-label-teeth — 4개 라벨이 서로 다른가(이빨 단언, 결측 시 자기충족 통과 차단).
//  7·8. 잘림 2계열(leaf + overflow:hidden 컨테이너) + 접힘(줄 수) — 후보 9슬롯 고정
//     (legend0..3.lbl/.v + caption). 줄 수는 top 동일성이 아니라 **세로로 겹치지 않는 rect 묶음
//     개수**로 센다(uat293/uat294의 교정된 measureLeaf 그대로 — top 동일성은 한 줄에 폰트 크기가
//     섞이면 거짓 FAIL한다).
//  9. 뷰포트 4종 — PC 1440×900 · PC 1440×1000 · 모바일 390×844 · 모바일 350×700(최협 케이스).
//
// 도메인 sentinel: chart-domain/legend-domain/leaf-domain/yaxis-domain이 0이면 그 자체로
// "섹션이 없다"는 신호이자 지금 기대하는 red다. line-count·yaxis-count·value-range·value-format은
// want가 고정 리터럴(4·1·'OK')이라 도메인이 비어도 자연히 FAIL한다(공허한 통과가 원리적으로 불가).
// 총계는 재실행 간 고정(뷰포트 4 × 슬롯 고정 루프)이라 표본이 조용히 줄어드는 방식으로는
// 총계가 변하지 않는다(TESTING §7.3ⓑ).
//
// 이 프로브가 재지 못하는 것:
//  - 실제 FRED 데이터값(4계열 산술·YoY 파생 정확성)은 배포 전이라 검증 불가 — 배포 후 값의
//    그럴듯함(단위·스케일)은 별도 확인 필요(단, value-range 축은 "지수 대신 %가 왔는가"는 잡는다).
//  - 4계열의 색상 토큰이 서로 다른지(§9.7 축⑤)는 이 프로브가 안 잰다 — S7(라이브 검증) 이월.
//  - 좌표계(§9.7 축⑥)는 이 섹션에 SVG viewBox 축소가 없어 정의역 밖.
import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat295';
fs.mkdirSync(OUT, { recursive: true });

const TITLE = '절사평균 물가 (미국)';
const SERIES_LABELS = ['코어 PCE', 'Dallas Fed 절사평균', 'Cleveland Fed 16% 절사평균', '헤드라인 PCE'];
const FIXED_SLOTS = ['legend0.lbl', 'legend0.v', 'legend1.lbl', 'legend1.v', 'legend2.lbl', 'legend2.v', 'legend3.lbl', 'legend3.v', 'caption'];

const checks = [];
const cov = {};
const bump = (k, n = 1) => { cov[k] = (cov[k] || 0) + n; };
const assert = (view, axis, got, want, detail = '') => {
  bump(axis);
  checks.push({ view, axis, got, want, detail, pass: JSON.stringify(got) === JSON.stringify(want) });
};

// ── 로그인 ────────────────────────────────────────────────────────
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const { access_token, refresh_token } = await login.json();
if (!access_token) { console.error('로그인 실패 — 즉시 종료.'); process.exit(1); }

// ── 응답 봉투 1콜 확인(추정 폴백 금지) — 진단용, 판정축 아님 ─────────
const apiProbe = await fetch(`${BASE}/api/market/trimmed-inflation`, {
  headers: { Authorization: `Bearer ${access_token}` },
});
const apiBody = await apiProbe.text();
console.log(`[진단] GET /api/market/trimmed-inflation → ${apiProbe.status} · body(200자)=${apiBody.slice(0, 200)}`);

// ── 뷰포트 4종(TESTING §7.1 실사용 상수) ─────────────────────────
const VIEWS = [
  { key: 'pc-900', opts: { viewport: { width: 1440, height: 900 } } },
  { key: 'pc-1000', opts: { viewport: { width: 1440, height: 1000 } } },
  { key: 'mobile-390', opts: { viewport: { width: 390, height: 844 } } },
  { key: 'mobile-350', opts: { viewport: { width: 350, height: 700 } } },
];

async function settle(page) {
  await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);
}

// 클릭은 페이지 내 evaluate로(내비게이션이 없으니 Playwright locator 비동기 경계 불필요) —
// 스코프를 main.page-wrap으로 한정해 전역 내비 마스트헤드 오매치를 차단(TESTING §7.3ⓒ).
async function tryOpen(page) {
  return page.evaluate((t) => {
    const scope = document.querySelector('main.page-wrap') || document.body;
    const span = [...scope.querySelectorAll('.mkt-title')].find(el => el.textContent.trim() === t);
    const btn = span?.closest('button');
    if (btn) { btn.click(); return true; }
    return false;
  }, TITLE);
}

async function measure(page) {
  return page.evaluate(([t]) => {
    const scope = document.querySelector('main.page-wrap') || document.body;
    const span = [...scope.querySelectorAll('.mkt-title')].find(el => el.textContent.trim() === t);
    const sectionFound = !!span;
    const btn = sectionFound ? span.closest('button') : null;
    const healthy = !!btn;
    const panel = btn ? btn.nextElementSibling : null;

    const chartboxes = panel ? [...panel.querySelectorAll('.chartbox')] : [];
    const legendItems = panel ? [...panel.querySelectorAll('.chart-legend__item')] : [];

    const pickPlotSurface = (root) => {
      const surfaces = [...root.querySelectorAll('.recharts-surface')];
      if (!surfaces.length) return null;
      const wrapped = surfaces.find(s => s.parentElement?.classList.contains('recharts-wrapper'));
      if (wrapped) return wrapped;
      return surfaces.reduce((best, s) => {
        const r = s.getBoundingClientRect(), rb = best.getBoundingClientRect();
        return (r.width * r.height > rb.width * rb.height) ? s : best;
      }, surfaces[0]);
    };

    const box = chartboxes[0] || null;
    const surface = box ? pickPlotSurface(box) : null;
    const allTicks = surface ? [...surface.querySelectorAll('text')].filter(el => (el.textContent || '').trim().length > 0) : [];
    const lineCurveCount = surface ? surface.querySelectorAll('.recharts-line-curve').length : 0;

    // ⭐ 세로축 군집화 — 같은 x(속성)를 3개 이상 공유하는 틱 <text> 묶음 = 세로축.
    const byX = new Map();
    for (const el of allTicks) {
      const x = Math.round(Number(el.getAttribute('x') || NaN));
      if (Number.isNaN(x)) continue;
      byX.set(x, (byX.get(x) || 0) + 1);
    }
    const yAxisXs = [...byX.entries()].filter(([, n]) => n >= 3).map(([x]) => x).sort((a, b) => a - b);

    // 범례 항목 구조: [dot(aria-hidden) span, 라벨 span, 값 span] — dot을 제외하고 순서로 취한다.
    const numFrom = (txt) => {
      const m = (txt || '').match(/-?\d+(\.\d+)?/);
      return m ? Number(m[0]) : null;
    };
    const legendData = [0, 1, 2, 3].map(i => {
      const item = legendItems[i];
      if (!item) return null;
      const textSpans = [...item.querySelectorAll(':scope > span')].filter(s => s.getAttribute('aria-hidden') !== 'true');
      const lbl = textSpans[0] || null;
      const v = textSpans[1] || null;
      const valueText = v ? (v.textContent || '').trim() : null;
      return {
        labelEl: lbl, valueEl: v,
        label: lbl ? (lbl.textContent || '').trim() : null,
        valueText,
        valueNum: numFrom(valueText),
      };
    });

    const captionEl = box ? box.querySelector('.sub') : null;
    const caption = captionEl ? (captionEl.textContent || '').trim() : null;

    // 잘림·접힘 후보 9슬롯 고정 — 존재하는 것만 채우고, 없으면 Node 쪽에서 LEAF_MISSING sentinel.
    const measureLeaf = (el) => {
      const scrollW = el.scrollWidth, clientW = el.clientWidth;
      const clipped = scrollW > clientW + 1;
      const range = document.createRange();
      range.selectNodeContents(el);
      // 진짜 줄 수 = **세로로 겹치지 않는 rect 묶음의 개수**(uat293/uat294 교정판 그대로).
      // ⚠️ `new Set(rects.map(r => Math.round(r.top))).size`는 한 줄에 폰트 크기가 섞이면 거짓 FAIL한다.
      const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0);
      const groups = [];
      for (const r of [...rects].sort((a, b) => a.top - b.top)) {
        const g = groups.find((g) => {
          const ov = Math.min(g.bottom, r.bottom) - Math.max(g.top, r.top);
          return ov > 0.3 * Math.min(g.bottom - g.top, r.bottom - r.top);
        });
        if (g) { g.top = Math.min(g.top, r.top); g.bottom = Math.max(g.bottom, r.bottom); }
        else groups.push({ top: r.top, bottom: r.bottom });
      }
      const lines = groups.length;
      let hiddenAncestorFound = false, hiddenAncestorClipped = false, cur = el.parentElement, depth = 0;
      while (cur && depth < 40) {
        const cs = getComputedStyle(cur);
        if (cs.overflow === 'hidden' || cs.overflowX === 'hidden') {
          hiddenAncestorFound = true;
          if (cur.scrollWidth > cur.clientWidth + 1) hiddenAncestorClipped = true;
        }
        cur = cur.parentElement; depth++;
      }
      return { text: (el.textContent || '').trim(), scrollW, clientW, clipped, lines, hiddenAncestorFound, hiddenAncestorClipped };
    };
    const leaves = {};
    for (let i = 0; i < 4; i++) {
      const ld = legendData[i];
      if (ld?.labelEl) leaves[`legend${i}.lbl`] = measureLeaf(ld.labelEl);
      if (ld?.valueEl) leaves[`legend${i}.v`] = measureLeaf(ld.valueEl);
    }
    if (captionEl) leaves.caption = measureLeaf(captionEl);

    return {
      sectionFound, healthy, chartboxCount: chartboxes.length, legendCount: legendItems.length,
      hasSurface: !!surface, ticks: allTicks.length, lineCurveCount, yAxisXs,
      legendData: legendData.map(d => d ? { label: d.label, valueText: d.valueText, valueNum: d.valueNum } : null),
      caption, leaves,
    };
  }, [TITLE]);
}

async function run(view, opts) {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ ...opts, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([a, r]) => {
    localStorage.setItem('access_token', a);
    localStorage.setItem('refresh_token', r);
    localStorage.setItem('theme', 'light');
    localStorage.setItem('pwa-install-dismissed-at', String(Date.now())); // pwa.js SUPPRESS_KEY
  }, [access_token, refresh_token]);

  await page.goto(`${BASE}/market/indicators`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await tryOpen(page);
  await page.waitForTimeout(2000);
  let m = await measure(page);

  if (!m.sectionFound) { // TESTING §7.3ⓑ: 무음 스킵 금지 — id 명시 1회 재시도 후에도 없으면 그대로 FAIL
    console.log(`[${view}] 섹션 미검출 → 1회 재시도`);
    await page.waitForTimeout(1500);
    await tryOpen(page);
    await page.waitForTimeout(1500);
    m = await measure(page);
  }

  console.log(`\n[${view}] ${JSON.stringify(m, null, 1)}`);
  if (pageErrors.length) console.log(`[${view}] 콘솔 에러 ${pageErrors.length}건: ${pageErrors.slice(0, 3).join(' | ')}`);

  // ── 1. section-exists / section-healthy ──────────────────────────
  assert(view, 'section-exists', m.sectionFound, true);
  assert(view, 'section-healthy', m.sectionFound ? m.healthy : 'SECTION_MISSING', true);

  // ── domain sentinel 4종 ───────────────────────────────────────────
  assert(view, 'chart-domain', m.chartboxCount > 0 ? 'OK' : `DOMAIN_TOO_SMALL(${m.chartboxCount})`, 'OK');
  assert(view, 'legend-domain', m.legendCount > 0 ? 'OK' : `DOMAIN_TOO_SMALL(${m.legendCount})`, 'OK');
  const leafDomainN = Object.keys(m.leaves).length;
  assert(view, 'leaf-domain', leafDomainN > 0 ? 'OK' : `DOMAIN_TOO_SMALL(${leafDomainN})`, 'OK');
  assert(view, 'yaxis-domain', m.ticks > 0 ? 'OK' : `DOMAIN_TOO_SMALL(${m.ticks})`, 'OK');

  // ── 2. chart-rendered — OR항 실측치를 detail에 싣는다(TESTING §7.3ⓖ) ─
  {
    const got = !m.hasSurface ? 'CHART_MISSING'
      : (m.ticks > 0 || m.lineCurveCount > 0) ? 'OK'
      : `NOT_RENDERED(surface=${m.hasSurface},ticks=${m.ticks},lines=${m.lineCurveCount})`;
    assert(view, 'chart-rendered', got, 'OK', `ticks=${m.ticks} lines=${m.lineCurveCount}`);
  }

  // ── 3. line-count — 4계열 전부 그려졌는가 ─────────────────────────
  assert(view, 'line-count', m.lineCurveCount, 4);

  // ── 4. yaxis-count — 단일 축(4종 동일 단위 %)이어야 한다 ──────────
  assert(view, 'yaxis-count', m.yAxisXs.length, 1, `xs=${JSON.stringify(m.yAxisXs)}`);

  // ── 5·6. 범례 4개 — 값 범위(0~10, identity 포함) + 소수 2자리 형식 ─
  for (const i of [0, 1, 2, 3]) {
    const t = m.legendData[i];
    const idOut = t ? `${t.label ?? ''}=${t.valueText ?? ''}` : `slot${i}=MISSING`;

    const rangeGot = !t || t.valueNum == null ? 'VALUE_MISSING'
      : (t.valueNum >= 0 && t.valueNum <= 10) ? 'OK'
      : `OUT_OF_RANGE(${t.valueNum})`;
    assert(view, `value-range[${i}]`, rangeGot, 'OK', idOut);

    const fmtGot = !t || !t.valueText ? 'VALUE_MISSING'
      : /^-?\d+\.\d{2}%$/.test(t.valueText) ? 'OK'
      : `BAD_FORMAT(${t.valueText})`;
    assert(view, `value-format[${i}]`, fmtGot, 'OK', idOut);
  }
  // 이빨: 4개 라벨이 모두 present일 때만 "서로 다르다"가 의미 있다 — 결측을 자기충족으로
  // 통과시키는 함정(측정 없이 size===4 vacuous pass)을 막는다(TESTING §7.3⑨류).
  const labels = m.legendData.map(d => d?.label);
  const allLabelsPresent = labels.every(l => !!l);
  assert(view, 'legend-label-teeth', allLabelsPresent ? (new Set(labels).size === 4) : 'LABEL_MISSING', true, JSON.stringify(labels));

  // ── 7·8. 잘림 2계열 + 접힘(9 고정 슬롯) ───────────────────────────
  for (const slot of FIXED_SLOTS) {
    const lf = m.leaves[slot];
    if (!lf) {
      assert(view, 'leaf-not-clipped', 'LEAF_MISSING', 'OK', slot);
      assert(view, 'container-not-clipped', 'LEAF_MISSING', 'OK', slot);
      assert(view, 'leaf-lines', 'LEAF_MISSING', 1, slot);
      continue;
    }
    assert(view, 'leaf-not-clipped', lf.clipped ? `CLIPPED(${lf.scrollW}>${lf.clientW})` : 'OK', 'OK', `${slot}="${lf.text}"`);
    assert(view, 'container-not-clipped', lf.hiddenAncestorClipped ? `CONTAINER_CLIPPED(${slot})` : 'OK', 'OK',
      `hiddenAncestorFound=${lf.hiddenAncestorFound}`);
    assert(view, 'leaf-lines', lf.lines, 1, `${slot}="${lf.text}"`);
  }

  // 육안 확인용 캡처(캡처 전 scrollIntoView) — 섹션 부재 시엔 페이지 전체를 남긴다.
  if (m.sectionFound) {
    await page.evaluate((t) => {
      const scope = document.querySelector('main.page-wrap') || document.body;
      const span = [...scope.querySelectorAll('.mkt-title')].find(el => el.textContent.trim() === t);
      span?.closest('button')?.scrollIntoView({ block: 'center' });
    }, TITLE);
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: `${OUT}/${view}.png`, fullPage: !m.sectionFound });

  await ctx.close();
  await b.close();
}

for (const v of VIEWS) await run(v.key, v.opts);
assert('meta', 'viewport-loop-count', VIEWS.length, 4);

// ── 보고 ──────────────────────────────────────────────────────────
const failed = checks.filter(c => !c.pass);
console.log(`\n=== 커버리지 ===`);
for (const k of Object.keys(cov).sort()) console.log(`${k}: ${cov[k]}`);
console.log(`\n=== 단언 총계 ${checks.length}건 · PASS ${checks.length - failed.length} · FAIL ${failed.length} ===`);
for (const c of checks) {
  console.log(`${c.pass ? 'PASS' : 'FAIL'} [${c.view} ${c.axis}] got=${JSON.stringify(c.got)} want=${JSON.stringify(c.want)}${c.detail ? ' · ' + c.detail : ''}`);
}
console.log(failed.length ? `\n>>> FAIL ${failed.length}/${checks.length}` : `\n>>> ALL PASS ${checks.length}/${checks.length}`);
fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ apiStatus: apiProbe.status, cov, checks }, null, 2));
process.exit(failed.length ? 1 : 0);
