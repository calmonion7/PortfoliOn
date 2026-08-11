// task#293 S6 라이브 UAT — 시장지표 탭 "신규 창업 신청 (미국)"(BusinessFormationSection) 프로브.
// **아직 배포 전이다** — 이 실행은 red-first 증거 확보용이다(TESTING.md §10①, 프론트 빌드=배포라
// 이 세션은 빌드/커밋/푸시를 하지 않는다). 배포 후 재실행하면 ALL PASS로 전환돼야 한다.
//
// 판정축(요청 7종):
//  1. section-exists / section-healthy — 제목 "신규 창업 신청 (미국)"이 main.page-wrap 본문에
//     있고, 로딩/에러가 아니라 정상(클릭 가능한 <button>) 상태인가.
//  2. chart-rendered[0,1] — 부문 2개 각각의 recharts 플롯이 실제로 그려졌는가. 플롯 surface는
//     `.recharts-surface` 첫 매치가 아니라 부모가 `.recharts-wrapper`인 것(TESTING §7.2⑦) —
//     이 컴포넌트는 <Legend/>를 쓰지 않아(BusinessFormationSection.jsx 직독 확인) 범례 아이콘
//     surface 자체가 없지만, 셀렉터는 방어적으로 그 관용구를 그대로 쓴다.
//  3. tile-ma3-present[0,1] / tile-raw-present[0,1] / tile-label-teeth — 부문 2개 타일에
//     3MA·원계열 값이 *둘 다* 있는가 + 두 부문 라벨이 실제로 다른가(이빨 단언).
//  4. caption-ma3-phrase[0,1] — "3개월 이동평균" 문구가 각 차트 캡션에 있는가(원계열이 아님이
//     화면에 드러나야 한다).
//  5. leaf-not-clipped / container-not-clipped — 잘림 2계열(CONVENTIONS §9.7②): 텍스트 leaf 자신의
//     scrollWidth>clientWidth + 조상 중 overflow:hidden인 컨테이너의 scrollWidth>clientWidth.
//     후보 6슬롯 고정(tile0.lbl·tile0.v·tile1.lbl·tile1.v·caption0·caption1) — `.d`(전월대비)는
//     데이터 유무에 따라 앱이 조건부로 렌더하는 슬롯이라(BusinessFormationSection.jsx:60,
//     chg==null이면 렌더 안 함) 정의역에서 뺀다. 이건 "무음 스킵"이 아니라 앱 설계상의 정의역
//     제외다(TESTING §7.3 ⓛ) — 코드에 이유를 명시했으니 여기 적어둔다.
//  6. leaf-lines — 접힘(CONVENTIONS §9.7③): 같은 6슬롯의 실제 렌더 줄 수(서로 다른 top 값의
//     개수, `range.getClientRects().length` 아님 — TESTING §9②).
//  7. 뷰포트 4종 — PC 1440×900 · PC 1440×1000 · 모바일 390×844 · 모바일 350×700(최협 케이스).
//     ※ 프롬프트 문구가 "PC 1440 · 모바일 390 · 모바일 350"(3폭) + "4뷰포트"로 개수가 어긋나
//     있어, TESTING §7.1의 실사용 상수(1440×900/1440×1000·390×844·350×700)에서 PC 두 높이를
//     별도 뷰로 세어 4개를 채웠다 — 추정을 감추지 않고 이 자리에 명시한다.
//
// 도메인 sentinel: chart-domain/tile-domain/leaf-domain이 0이면 그 자체로 "섹션이 없다"는
// 신호이자 지금 기대하는 red다. 총계는 재실행 간 고정(뷰포트 4 × 슬롯 고정 루프)이라 표본이
// 조용히 줄어드는 방식으로는 총계가 변하지 않는다(TESTING §7.3ⓑ).
//
// 이 프로브가 재지 못하는 것: 실제 FRED 데이터값(3MA vs 원계열의 구체적 수치 정합)은 배포 전
// 이라 검증 불가 — 배포 후 재실행 시 값 자체의 그럴듯함(단위·스케일)은 별도 확인 필요.
import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat293';
fs.mkdirSync(OUT, { recursive: true });

const TITLE = '신규 창업 신청 (미국)';
const FIXED_SLOTS = ['tile0.lbl', 'tile0.v', 'tile1.lbl', 'tile1.v', 'caption0', 'caption1'];

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
const apiProbe = await fetch(`${BASE}/api/market/business-formation`, {
  headers: { Authorization: `Bearer ${access_token}` },
});
const apiBody = await apiProbe.text();
console.log(`[진단] GET /api/market/business-formation → ${apiProbe.status} · body(200자)=${apiBody.slice(0, 200)}`);

// ── 뷰포트 4종(§7 주석 참조) ─────────────────────────────────────
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
  return page.evaluate((t) => {
    const scope = document.querySelector('main.page-wrap') || document.body;
    const span = [...scope.querySelectorAll('.mkt-title')].find(el => el.textContent.trim() === t);
    const sectionFound = !!span;
    const btn = sectionFound ? span.closest('button') : null;
    const healthy = !!btn;
    const panel = btn ? btn.nextElementSibling : null;

    const chartboxes = panel ? [...panel.querySelectorAll('.chartbox')] : [];
    const tiles = panel ? [...panel.querySelectorAll('.metric-tile')] : [];

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

    const charts = [0, 1].map(i => {
      const box = chartboxes[i];
      if (!box) return null;
      const surface = pickPlotSurface(box);
      const ticks = surface ? [...surface.querySelectorAll('text')].filter(el => (el.textContent || '').trim().length > 0).length : 0;
      const hasLineCurve = !!(surface && surface.querySelector('.recharts-line-curve'));
      return { hasSurface: !!surface, ticks, hasLineCurve };
    });

    const numFrom = (txt) => {
      const m = (txt || '').match(/[\d,]+/);
      return m ? Number(m[0].replace(/,/g, '')) : null;
    };
    const tileData = [0, 1].map(i => {
      const el = tiles[i];
      if (!el) return null;
      const lbl = el.querySelector('.lbl');
      const v = el.querySelector('.v');
      const rawDiv = [...el.children].find(c => !c.classList.contains('lbl') && !c.classList.contains('v') && !c.classList.contains('d'));
      return {
        label: (lbl?.textContent || '').trim(),
        ma3Text: (v?.textContent || '').trim(),
        ma3Num: numFrom(v?.textContent),
        rawText: (rawDiv?.textContent || '').trim(),
        rawNum: numFrom(rawDiv?.textContent),
      };
    });

    const captions = [0, 1].map(i => {
      const c = chartboxes[i]?.querySelector('.sub');
      return c ? (c.textContent || '').trim() : null;
    });

    // 잘림·접힘 후보 6슬롯 고정 — 존재하는 것만 채우고, 없으면 Node 쪽에서 LEAF_MISSING sentinel.
    const measureLeaf = (el) => {
      const scrollW = el.scrollWidth, clientW = el.clientWidth;
      const clipped = scrollW > clientW + 1;
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = [...range.getClientRects()];
      const lines = rects.length ? new Set(rects.map(r => Math.round(r.top))).size : 0;
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
    for (let i = 0; i < 2; i++) {
      const tl = tiles[i], box = chartboxes[i];
      const lbl = tl?.querySelector('.lbl'), v = tl?.querySelector('.v'), sub = box?.querySelector('.sub');
      if (lbl) leaves[`tile${i}.lbl`] = measureLeaf(lbl);
      if (v) leaves[`tile${i}.v`] = measureLeaf(v);
      if (sub) leaves[`caption${i}`] = measureLeaf(sub);
    }

    return { sectionFound, healthy, chartboxCount: chartboxes.length, tileCount: tiles.length, charts, tileData, captions, leaves };
  }, TITLE);
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

  if (!m.sectionFound) { // ⑧ⓑ: 무음 스킵 금지 — id 명시 1회 재시도 후에도 없으면 그대로 FAIL
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

  // ── domain sentinel 3종 ───────────────────────────────────────────
  assert(view, 'chart-domain', m.chartboxCount > 0 ? 'OK' : `DOMAIN_TOO_SMALL(${m.chartboxCount})`, 'OK');
  assert(view, 'tile-domain', m.tileCount > 0 ? 'OK' : `DOMAIN_TOO_SMALL(${m.tileCount})`, 'OK');
  const leafDomainN = Object.keys(m.leaves).length;
  assert(view, 'leaf-domain', leafDomainN > 0 ? 'OK' : `DOMAIN_TOO_SMALL(${leafDomainN})`, 'OK');

  // ── 2. chart-rendered[0,1] — OR항 실측치를 detail에 싣는다(⑧ⓖ) ────
  for (const i of [0, 1]) {
    const c = m.charts[i];
    const got = !c ? 'CHART_MISSING'
      : (c.hasSurface && (c.ticks > 0 || c.hasLineCurve)) ? 'OK'
      : `NOT_RENDERED(surface=${c.hasSurface},ticks=${c.ticks},line=${c.hasLineCurve})`;
    assert(view, `chart-rendered[${i}]`, got, 'OK', c ? `ticks=${c.ticks} line=${c.hasLineCurve}` : '');
  }

  // ── 3. tile-ma3-present / tile-raw-present / label 이빨 ──────────
  for (const i of [0, 1]) {
    const t = m.tileData[i];
    assert(view, `tile-label-present[${i}]`, (t?.label || '').length > 0 ? 'PRESENT' : 'TILE_MISSING', 'PRESENT', t?.label ?? '');
    assert(view, `tile-ma3-present[${i}]`, t?.ma3Num != null ? 'PRESENT' : 'TILE_MISSING', 'PRESENT',
      t ? `${t.label}=${t.ma3Text}` : '');
    assert(view, `tile-raw-present[${i}]`, t?.rawNum != null ? 'PRESENT' : 'TILE_MISSING', 'PRESENT',
      t ? `${t.label}=${t.rawText}` : '');
  }
  // 이빨: 둘 다 present일 때만 "다름"이 의미가 있다 — sentinel을 서로 다르게 채워 결측을
  // 자기충족으로 통과시키는 함정(측정 없이 size===2 vacuous pass)을 막기 위해 존재 여부를
  // 먼저 게이트한다.
  const l0 = m.tileData[0]?.label, l1 = m.tileData[1]?.label;
  const bothLabelsPresent = !!l0 && !!l1;
  assert(view, 'tile-label-teeth', bothLabelsPresent ? (l0 !== l1) : 'LABEL_MISSING', true, `"${l0 ?? ''}" / "${l1 ?? ''}"`);

  // ── 4. caption-ma3-phrase[0,1] ────────────────────────────────────
  for (const i of [0, 1]) {
    const cap = m.captions[i];
    const got = cap == null ? 'CAPTION_MISSING' : cap.includes('3개월 이동평균') ? 'OK' : `MISSING_PHRASE(${cap})`;
    assert(view, `caption-ma3-phrase[${i}]`, got, 'OK', cap ?? '');
  }

  // ── 5·6. 잘림 2계열 + 접힘(6 고정 슬롯) ───────────────────────────
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
// 다른 모든 축의 카운트가 이미 "4"로 찍혀 몇 개 뷰가 돌았는지 드러난다 — 여기선 그 4가
// 코드 상수(VIEWS.length)와 실제 일치하는지만 별도로 못박는다(bump 중복 방지로 axis명과
// 다르게 둔다).
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
