// task#294 S6 라이브 UAT — 시장지표 탭 "고용 조사 격차 (미국)"(LaborSurveySection) 프로브.
// **아직 배포 전이다** — 이 실행은 red-first 증거 확보용이다(TESTING.md §10①, 프론트 빌드=배포라
// 이 세션은 빌드/커밋/푸시를 하지 않는다). 배포 후 재실행하면 ALL PASS로 전환돼야 한다.
// (git rev-parse HEAD 확인 시 LaborSurveySection.jsx는 untracked·미배포 상태였다.)
//
// 대상 컴포넌트는 uat293의 BusinessFormationSection과 형태가 다르다 — 그대로 베끼면 축이
// 틀린 것을 잰다(TESTING §7.3ⓘ류 함정의 저작판): 부문 2개짜리 별도 차트가 아니라
// **단일 차트 + 이중 Y축 오버레이**(가계조사=좌축, 기업조사=우축, 독립 스케일)이고,
// 타일에는 "3MA/원계열" 짝이 아니라 "최신값 + 12개월 증감(부호)"이 있다.
//
// 판정축(요청 8종을 아래로 매핑):
//  1. section-exists / section-healthy — 제목 "고용 조사 격차 (미국)"이 main.page-wrap 본문에
//     있고 button(클릭 가능=정상) 상태인가.
//  2. chart-rendered — 이 섹션은 chartbox가 **1개뿐**(우려2처럼 [0,1] 배열이 아님). 플롯 surface는
//     `.recharts-surface` 첫 매치가 아니라 부모가 `.recharts-wrapper`인 것(TESTING §7.2⑦).
//  3. ⭐ yaxis-count — 세로축이 실제로 2개인가. `.recharts-yAxis` 하위 셀렉터는 recharts 3에서
//     0건이 난다(축 틱 <text>가 그 하위가 아니다) → 틱 <text>를 x 속성으로 군집화해 **같은 x를
//     3개 이상 공유하는 군집 = 세로축**으로 판정(가장 작은 x=좌축·가장 큰 x=우축). X축(날짜) 틱은
//     간격이 데이터 의존이라 같은 x를 3개 이상 공유할 일이 없어 자연히 제외된다.
//  4. tile-label-present[0,1] / tile-value-present[0,1] / tile-label-teeth(이빨) /
//     tile-change-present[0,1] — 타일 2개(가계조사·기업조사) 각각에 최신값이 있고, 두 라벨이
//     실제로 다르고(이빨 단언), **12개월 증감이 부호(▲/▼/─)와 함께** 있는가.
//     ⚠️ uat293은 이 컴포넌트의 형제격 `.d`를 "데이터 유무 조건부"로 정의역에서 뺐지만, 이
//     프로브는 뺀다 대신 **요구축으로 승급**한다 — FRED 5년 백필이면 13개월+ 데이터가 항상
//     있어야 하므로(S1 완료 노트) 결측은 무음 스킵이 아니라 진짜 FAIL이어야 한다.
//  5. axis-warning-phrase — 이중축이 독립 스케일이라 "교차 지점이 의미가 아니다"를 밝히는
//     설명문(`<p>`)이 패널에 있는가. LaborSurveySection.jsx:74 원문 그대로("같아졌다는 의미가
//     아닙니다")를 부분일치로 잰다 — 문서 전체가 아니라 패널 스코프의 <p> 1개로 한정.
//  6·7. 잘림 2계열 + 접힘(줄 수) — 후보 7슬롯 고정(tile0.lbl·tile0.v·tile0.d·tile1.lbl·tile1.v·
//     tile1.d·caption). caption은 uat293처럼 caption0/1이 아니라 **caption 1개뿐**(차트가 1개라서).
//     줄 수는 top 동일성이 아니라 **세로로 겹치지 않는 rect 묶음 개수**로 센다(uat293의 교정된
//     measureLeaf 그대로 — top 동일성은 한 줄에 폰트 크기가 섞이면 거짓 FAIL한다).
//  8. 뷰포트 4종 — PC 1440×900 · PC 1440×1000 · 모바일 390×844 · 모바일 350×700(최협 케이스).
//     `.metric-tile{flex:1,minWidth:170}`이 350px 폭에서 타일 2개+gap을 못 감당하면 `.d`
//     ("▲ 185.8만 명 12개월 전 대비")가 줄바꿈할 후보다 — 접힘 축이 그 자리를 잰다.
//
// 도메인 sentinel: chart-domain/tile-domain/leaf-domain/yaxis-domain이 0이면 그 자체로
// "섹션이 없다"는 신호이자 지금 기대하는 red다. 총계는 재실행 간 고정(뷰포트 4 × 슬롯 고정
// 루프)이라 표본이 조용히 줄어드는 방식으로는 총계가 변하지 않는다(TESTING §7.3ⓑ).
//
// 이 프로브가 재지 못하는 것:
//  - 실제 FRED 데이터값(가계조사 vs 기업조사 수치 정합, 12개월 증감 산술)은 배포 전이라
//    검증 불가 — 배포 후 값의 그럴듯함(단위·스케일)은 별도 확인 필요.
//  - 좌·우축이 **실제로 독립 스케일**인지(둘 다 우연히 같은 domain을 골랐을 가능성)는 이 프로브가
//    안 잰다 — yaxis-count==2는 "두 개의 축이 그려졌다"만 보증하고 "스케일이 다르다"는 못 본다.
import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat294';
fs.mkdirSync(OUT, { recursive: true });

const TITLE = '고용 조사 격차 (미국)';
const FIXED_SLOTS = ['tile0.lbl', 'tile0.v', 'tile0.d', 'tile1.lbl', 'tile1.v', 'tile1.d', 'caption'];
const AXIS_PHRASE = '같아졌다는 의미가 아닙니다';

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
const apiProbe = await fetch(`${BASE}/api/market/labor-surveys`, {
  headers: { Authorization: `Bearer ${access_token}` },
});
const apiBody = await apiProbe.text();
console.log(`[진단] GET /api/market/labor-surveys → ${apiProbe.status} · body(200자)=${apiBody.slice(0, 200)}`);

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
  return page.evaluate(([t, phrase]) => {
    const scope = document.querySelector('main.page-wrap') || document.body;
    const span = [...scope.querySelectorAll('.mkt-title')].find(el => el.textContent.trim() === t);
    const sectionFound = !!span;
    const btn = sectionFound ? span.closest('button') : null;
    const healthy = !!btn;
    const panel = btn ? btn.nextElementSibling : null;

    const chartboxes = panel ? [...panel.querySelectorAll('.chartbox')] : [];
    const tiles = panel ? [...panel.querySelectorAll('.metric-tile')] : [];
    const descP = panel ? panel.querySelector('p') : null;

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
    const hasLineCurve = !!(surface && surface.querySelector('.recharts-line-curve'));

    // ⭐ 세로축 군집화 — 같은 x(속성)를 3개 이상 공유하는 틱 <text> 묶음 = 세로축.
    const byX = new Map();
    for (const el of allTicks) {
      const x = Math.round(Number(el.getAttribute('x') || NaN));
      if (Number.isNaN(x)) continue;
      byX.set(x, (byX.get(x) || 0) + 1);
    }
    const yAxisXs = [...byX.entries()].filter(([, n]) => n >= 3).map(([x]) => x).sort((a, b) => a - b);

    const numFrom = (txt) => {
      const m = (txt || '').match(/[\d.,]+/);
      return m ? Number(m[0].replace(/,/g, '')) : null;
    };
    const tileData = [0, 1].map(i => {
      const el = tiles[i];
      if (!el) return null;
      const lbl = el.querySelector('.lbl');
      const v = el.querySelector('.v');
      const d = el.querySelector('.d');
      const dText = d ? (d.textContent || '').trim() : null;
      return {
        label: (lbl?.textContent || '').trim(),
        valueText: (v?.textContent || '').trim(),
        valueNum: numFrom(v?.textContent),
        dText,
        dHasSign: dText ? /[▲▼─]/.test(dText) : false,
        dNum: dText ? numFrom(dText) : null,
      };
    });

    const captionEl = box ? box.querySelector('.sub') : null;
    const caption = captionEl ? (captionEl.textContent || '').trim() : null;
    const descText = descP ? (descP.textContent || '').trim() : null;
    const hasAxisWarning = descText ? descText.includes(phrase) : false;

    // 잘림·접힘 후보 7슬롯 고정 — 존재하는 것만 채우고, 없으면 Node 쪽에서 LEAF_MISSING sentinel.
    const measureLeaf = (el) => {
      const scrollW = el.scrollWidth, clientW = el.clientWidth;
      const clipped = scrollW > clientW + 1;
      const range = document.createRange();
      range.selectNodeContents(el);
      // 진짜 줄 수 = **세로로 겹치지 않는 rect 묶음의 개수**(uat293 교정판 그대로).
      // ⚠️ `new Set(rects.map(r => Math.round(r.top))).size`는 한 줄에 폰트 크기가 섞이면
      //    (예: `.d`의 값 텍스트 + 뒤이은 muted span) 같은 줄인데 top이 갈려 거짓 FAIL한다.
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
    for (let i = 0; i < 2; i++) {
      const tl = tiles[i];
      const lbl = tl?.querySelector('.lbl'), v = tl?.querySelector('.v'), d = tl?.querySelector('.d');
      if (lbl) leaves[`tile${i}.lbl`] = measureLeaf(lbl);
      if (v) leaves[`tile${i}.v`] = measureLeaf(v);
      if (d) leaves[`tile${i}.d`] = measureLeaf(d);
    }
    if (captionEl) leaves.caption = measureLeaf(captionEl);

    return {
      sectionFound, healthy, chartboxCount: chartboxes.length, tileCount: tiles.length,
      hasSurface: !!surface, ticks: allTicks.length, hasLineCurve, yAxisXs,
      tileData, caption, descText, hasAxisWarning, leaves,
    };
  }, [TITLE, AXIS_PHRASE]);
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
  assert(view, 'tile-domain', m.tileCount > 0 ? 'OK' : `DOMAIN_TOO_SMALL(${m.tileCount})`, 'OK');
  const leafDomainN = Object.keys(m.leaves).length;
  assert(view, 'leaf-domain', leafDomainN > 0 ? 'OK' : `DOMAIN_TOO_SMALL(${leafDomainN})`, 'OK');
  assert(view, 'yaxis-domain', m.ticks > 0 ? 'OK' : `DOMAIN_TOO_SMALL(${m.ticks})`, 'OK');

  // ── 2. chart-rendered — OR항 실측치를 detail에 싣는다(TESTING §7.3ⓖ) ─
  {
    const got = !m.hasSurface ? 'CHART_MISSING'
      : (m.ticks > 0 || m.hasLineCurve) ? 'OK'
      : `NOT_RENDERED(surface=${m.hasSurface},ticks=${m.ticks},line=${m.hasLineCurve})`;
    assert(view, 'chart-rendered', got, 'OK', `ticks=${m.ticks} line=${m.hasLineCurve}`);
  }

  // ── 3. yaxis-count — 세로축 2개(좌 가계·우 기업) ─────────────────
  assert(view, 'yaxis-count', m.yAxisXs.length, 2, `xs=${JSON.stringify(m.yAxisXs)}`);
  if (m.yAxisXs.length === 2) {
    assert(view, 'yaxis-order', m.yAxisXs[0] < m.yAxisXs[1], true, `left=${m.yAxisXs[0]} right=${m.yAxisXs[1]}`);
  } else {
    assert(view, 'yaxis-order', 'YAXIS_COUNT_WRONG', true, `xs=${JSON.stringify(m.yAxisXs)}`);
  }

  // ── 4. 타일 2개 — 라벨·값·이빨·증감(부호) ────────────────────────
  for (const i of [0, 1]) {
    const t = m.tileData[i];
    assert(view, `tile-label-present[${i}]`, (t?.label || '').length > 0 ? 'PRESENT' : 'TILE_MISSING', 'PRESENT', t?.label ?? '');
    assert(view, `tile-value-present[${i}]`, t?.valueNum != null ? 'PRESENT' : 'TILE_MISSING', 'PRESENT',
      t ? `${t.label}=${t.valueText}` : '');
    const got = !t ? 'TILE_MISSING'
      : !t.dText ? 'CHANGE_MISSING'
      : (t.dHasSign && t.dNum != null) ? 'PRESENT'
      : `NO_SIGN(${t.dText})`;
    assert(view, `tile-change-present[${i}]`, got, 'PRESENT', t ? `${t.label}: "${t.dText ?? ''}"` : '');
  }
  // 이빨: 둘 다 present일 때만 "다름"이 의미가 있다 — 결측을 자기충족으로 통과시키는 함정
  // (측정 없이 size===2 vacuous pass)을 막기 위해 존재 여부를 먼저 게이트한다(TESTING §7.3⑨류).
  const l0 = m.tileData[0]?.label, l1 = m.tileData[1]?.label;
  const bothLabelsPresent = !!l0 && !!l1;
  assert(view, 'tile-label-teeth', bothLabelsPresent ? (l0 !== l1) : 'LABEL_MISSING', true, `"${l0 ?? ''}" / "${l1 ?? ''}"`);

  // ── 5. axis-warning-phrase — 이중축 오독방지 설명문 ──────────────
  {
    const got = m.descText == null ? 'DESC_MISSING' : m.hasAxisWarning ? 'OK' : `MISSING_PHRASE(len=${m.descText.length})`;
    assert(view, 'axis-warning-phrase', got, 'OK', m.descText ? m.descText.slice(0, 60) : '');
  }

  // ── 6·7. 잘림 2계열 + 접힘(7 고정 슬롯) ───────────────────────────
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
