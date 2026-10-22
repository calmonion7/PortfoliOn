// task#403 라이브 UAT — 시장지표 탭의 「반도체」 카드(SOX + DRAMeXchange 메모리 현물가). read-only(GET) + 화면 내 행 탭·분류 선택뿐, 쓰기 0.
// task#404: 메모리 현물가가 「분류 콤보(select) → 그 분류 표 → 바로 아래 차트」로 바뀌어, 분류별 축은 select로 전 분류를 순회하며 잰다.
// 대상: BASE(기본 dev 스택 http://127.0.0.1:8084). 기능 배포 전에는 도달 축에서 FAIL/exit한다(red-first).
// 응답 봉투는 계약(S3)에서 가져왔다: GET /api/market/semiconductor -> {categories:[{key,label,updated_at,items:[{id,name,avg,high,low,change_pct,history}]}],fetched_at}.
// 축 순서: ⓐ 도달·identity(API 카테고리 라벨 == select 옵션) → ⓑ 판정축. 뷰포트당 단언 총계는 고정(EXPECT_PER_VP) — 줄면 측정 실패.
// 판정 한계: 색(--up/--down)·SOX 차트 실제 픽셀은 육안 캡처(screenshots-uat403/<viewport>.png)로 확인한다. 네이티브 select의 iOS 피커 렌더는 Chromium이 못 본다.
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:8084';
const OUT = 'screenshots-uat403';
const DEFAULT_ITEM = 'dram:475';
// 소스 독립 리터럴(task#403 회고) — 화면↔API 대조는 API 자체의 결함(단종 품목 부활 등)에 블라인드하다. 소스 품목 목록이 바뀌면 의도적으로 갱신할 것.
const EXPECT_CATS = 6, EXPECT_TOTAL = 23;
const CHART_GAP_MAX = 24;
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const cov = {}; const bump = (k, n = 1) => { cov[k] = (cov[k] || 0) + n; };
const ok = (name, cond, detail = '') => { results.push({ name, pass: !!cond, detail }); console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };

// ── 로그인(응답 봉투 추정 금지: access_token/refresh_token 이 없으면 즉시 exit) ──
const lr = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'uat-admin@portfolion.dev', password: 'uat-admin-1234' }) });
const lj = await lr.json().catch(() => ({}));
if (!lj.access_token || !lj.refresh_token) { console.log(`LOGIN_FAIL status=${lr.status} keys=${Object.keys(lj)}`); process.exit(1); }
const { access_token, refresh_token } = lj;

// ── 기대값은 API에서 유도 ──
const sr = await fetch(`${BASE}/api/market/semiconductor`, { headers: { Authorization: `Bearer ${access_token}` } });
const sj = await sr.json().catch(() => ({}));
const cats = Array.isArray(sj.categories) ? sj.categories : null;
if (!cats || cats.length === 0 || !cats.every(c => c.updated_at && c.items?.length)) {
  console.log(`TARGET_MISSING status=${sr.status} categories=${cats ? cats.length : 'NOT_ARRAY'} — 기능 미배포이거나 dev DB에 메모리 현물가가 없다(백필 선행)`);
  process.exit(1);
}
const allItems = cats.flatMap(c => c.items);
const defCat = cats.find(c => c.items.some(i => i.id === DEFAULT_ITEM));
// 탭 대상은 초기 표(기본 분류) 안의 비기본 품목 — 분류 콤보 뒤로는 다른 분류 행이 DOM에 없다
const nonDefault = defCat?.items.find(i => i.id !== DEFAULT_ITEM && i.history?.length > 0);
if (!defCat || !nonDefault) { console.log(`TARGET_MISSING defCat=${defCat?.key} nonDefault=${nonDefault?.id}`); process.exit(1); }
// 이빨: 기본 품목과 탭 대상의 이름·id가 서로 달라야 「차트 품목 변경」이 관측 가능하다
const defaultItem = defCat.items.find(i => i.id === DEFAULT_ITEM);
if (new Set([defaultItem.id, nonDefault.id]).size !== 2 || defaultItem.name === nonDefault.name) { console.log('TEETH_FAIL default/tap 품목이 구별되지 않는다'); process.exit(1); }
console.log(`target: cats=${cats.map(c => c.key + ':' + c.items.length).join(',')} default=${defaultItem.name} tap=${nonDefault.id}(${nonDefault.name})`);
ok('api-total-literal', cats.length === EXPECT_CATS && allItems.length === EXPECT_TOTAL, `cats=${cats.length}/${EXPECT_CATS} items=${allItems.length}/${EXPECT_TOTAL}`);

const VIEWPORTS = [
  ['m360', { viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
  ['m390', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
  ['pc1440', { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 }],
];
const EXPECT_PER_VP = 17; // reached·identity-labels·card-adjacent·no-h-scroll·default-selected·tap-changes-chart·tap-selected-style·x-ticks-no-overlap·updated-at-labels·rows-count·cat-switch-chart·no-char-stack·name-not-clipped·row-spacing·chart-follows-table·tap-chart-in-view·no-pageerror
const SEL = '[data-testid="semi-cat-select"]';

// 현재 선택된 분류 1개의 표·행·차트 측정(표는 div[data-testid=semi-cat-<key>] — select·updated span과 구별)
const measure = page => page.evaluate(() => {
  const tables = [...document.querySelectorAll('div[data-testid^="semi-cat-"]')];
  const t = tables[0];
  const rows = t ? [...t.querySelectorAll('button[data-testid^="semi-row-"]')] : [];
  const names = rows.map(btn => {
    const el = btn.firstElementChild; const cs = getComputedStyle(el);
    let lh = parseFloat(cs.lineHeight); if (!(lh > 0)) lh = parseFloat(cs.fontSize) * 1.5;
    const r = el.getBoundingClientRect();
    return { text: el.textContent, h: r.height, w: r.width, lh, fs: parseFloat(cs.fontSize), scrollOK: el.scrollWidth <= el.clientWidth + 1 };
  });
  const gaps = rows.map(btn => {
    const [n, a, c] = btn.children; const rn = n.getBoundingClientRect(), ra = a.getBoundingClientRect(), rc = c.getBoundingClientRect(), rb = btn.getBoundingClientRect();
    return { nameAvg: ra.left - rn.right, avgChg: rc.left - ra.right, inRow: rc.right <= rb.right + 0.5, h: rb.height };
  });
  const chart = document.querySelector('[data-testid="semi-chart"]');
  const sel = document.querySelector('[data-testid="semi-cat-select"]');
  return {
    tables: tables.length, key: t?.dataset.testid.replace('semi-cat-', '') || 'TABLE_MISSING',
    selLabel: sel?.selectedOptions[0]?.textContent || '', updated: document.querySelector('[data-testid="semi-cat-updated"]')?.textContent || '',
    rows: rows.length, names, gaps, chart: chart?.dataset.item || 'CHART_MISSING',
    chartGap: chart && t ? chart.getBoundingClientRect().top - t.getBoundingClientRect().bottom : null,
  };
});

const b = await chromium.launch();
const perVp = {};
for (const [vp, opts] of VIEWPORTS) {
  const before = results.length;
  const ctx = await b.newContext({ ...opts, serviceWorkers: 'block' });
  await ctx.addInitScript(([a, r]) => {
    localStorage.setItem('access_token', a); localStorage.setItem('refresh_token', r);
    localStorage.setItem('pwa-install-dismissed-at', String(Date.now()));
  }, [access_token, refresh_token]);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 120)));
  await page.goto(`${BASE}/market/indicators`, { waitUntil: 'networkidle' });
  await page.waitForSelector(SEL, { timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0).catch(() => {});
  await page.waitForTimeout(800);

  // ⓐ 도달·identity — select 옵션(value·라벨)이 API 카테고리와 같다(순서 포함)
  const opt = await page.evaluate(s => [...(document.querySelector(s)?.options || [])].map(o => [o.value, o.textContent]), SEL);
  bump('cats', opt.length);
  ok(`${vp}/reached`, opt.length === cats.length && opt.length > 0, `options=${opt.length} api=${cats.length}`);
  ok(`${vp}/identity-labels`, JSON.stringify(opt) === JSON.stringify(cats.map(c => [c.key, c.label])),
    `dom=${opt.map(o => o[1])} api=${cats.map(c => c.label)}`);

  // 인접성 — 반도체 카드가 「주요 지수」 카드 바로 다음 형제
  const adj = await page.evaluate(() => {
    const outer = t => { const s = [...document.querySelectorAll('.mkt-title')].find(e => e.textContent.trim() === t); return s ? s.closest('button')?.parentElement : null; };
    const idx = outer('주요 지수'), semi = outer('반도체');
    return { idx: !!idx, semi: !!semi, adjacent: !!(idx && semi && idx.nextElementSibling === semi) };
  });
  ok(`${vp}/card-adjacent`, adj.idx && adj.semi && adj.adjacent, `indexCard=${adj.idx} semiCard=${adj.semi} nextSibling=${adj.adjacent}`);

  // 넘침 — 문서 가로 스크롤 0, innerWidth 가 설정 폭과 같음(㉢: 모바일 레이아웃 뷰포트 확장 방지)
  const ov = await page.evaluate(() => ({ iw: innerWidth, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  ok(`${vp}/no-h-scroll`, ov.iw === opts.viewport.width && ov.sw <= ov.cw, `innerWidth=${ov.iw} scrollWidth=${ov.sw} clientWidth=${ov.cw}`);

  // 기본 선택 상태(탭 전) — 기본 분류가 선택되고 DEFAULT_ITEM이 차트에
  const sel0 = await page.evaluate(([d, t, s]) => {
    const get = id => { const el = document.querySelector(`[data-testid="semi-row-${id}"]`); return el ? { pressed: el.getAttribute('aria-pressed'), bl: getComputedStyle(el).borderLeftColor } : null; };
    return { cat: document.querySelector(s)?.value, def: get(d), tap: get(t), chart: document.querySelector('[data-testid="semi-chart"]')?.dataset.item || 'CHART_MISSING' };
  }, [DEFAULT_ITEM, nonDefault.id, SEL]);
  ok(`${vp}/default-selected`, sel0.cat === defCat.key && sel0.def?.pressed === 'true' && sel0.tap?.pressed === 'false' && sel0.chart === DEFAULT_ITEM,
    `cat=${sel0.cat} chart=${sel0.chart} def=${sel0.def?.pressed} tap=${sel0.tap?.pressed}`);

  // 행 탭 — 비기본 행: 차트 품목 변경 + 선택 스타일(aria-pressed + 왼쪽 띠 색이 투명이 아님·이전과 다름)
  const rowSel = `[data-testid="semi-row-${nonDefault.id}"]`;
  await page.locator(rowSel).scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(500);
  let tapErr = '';
  try { if (opts.hasTouch) await page.locator(rowSel).tap({ timeout: 8000 }); else await page.locator(rowSel).click({ timeout: 8000 }); }
  catch (e) { tapErr = String(e).split('\n')[0].slice(0, 100); }
  await page.waitForTimeout(600);
  const sel1 = await page.evaluate(([d, t]) => {
    const get = id => { const el = document.querySelector(`[data-testid="semi-row-${id}"]`); return el ? { pressed: el.getAttribute('aria-pressed'), bl: getComputedStyle(el).borderLeftColor, bg: getComputedStyle(el).backgroundColor } : null; };
    return { def: get(d), tap: get(t), chart: document.querySelector('[data-testid="semi-chart"]')?.dataset.item || 'CHART_MISSING', title: document.querySelector('[data-testid="semi-chart"] .sub')?.textContent || 'TITLE_MISSING' };
  }, [DEFAULT_ITEM, nonDefault.id]);
  bump('row-taps');
  ok(`${vp}/tap-changes-chart`, !tapErr && sel1.chart === nonDefault.id && sel1.title === nonDefault.name,
    `err=${tapErr || '-'} chart=${sel1.chart} title=${sel1.title} want=${nonDefault.id}/${nonDefault.name}`);
  const transparent = c => !c || c === 'rgba(0, 0, 0, 0)' || c === 'transparent';
  ok(`${vp}/tap-selected-style`, sel1.tap?.pressed === 'true' && sel1.def?.pressed === 'false' && !transparent(sel1.tap?.bl) && transparent(sel1.def?.bl) && sel1.tap?.bl !== sel0.tap?.bl,
    `tap.pressed=${sel1.tap?.pressed} tap.borderLeft=${sel1.tap?.bl} (before ${sel0.tap?.bl}) def.pressed=${sel1.def?.pressed} def.borderLeft=${sel1.def?.bl}`);

  // X축 틱 라벨 겹침 — 넘침·잘림 축에 안 잡히는 「요소 간 간격」 클래스(m360 육안 포착, task#403).
  // 틱은 클래스가 아니라 기하로 고른다: 플롯 surface(부모 .recharts-wrapper)의 text 중 가장 아래 y 행.
  const ticks = await page.evaluate(() => [...document.querySelectorAll('[data-testid="semi-linebox"]')].map((box) => {
    const svg = [...box.querySelectorAll('.recharts-surface')].find((x) => x.parentElement?.classList.contains('recharts-wrapper'));
    const rs = [...(svg?.querySelectorAll('text') || [])].map((t) => t.getBoundingClientRect()).filter((r) => r.width > 0);
    const maxY = Math.max(...rs.map((r) => Math.round(r.top)));
    const row = rs.filter((r) => Math.abs(Math.round(r.top) - maxY) <= 2).sort((a, b) => a.left - b.left);
    const gaps = row.slice(1).map((r, i) => +(r.left - row[i].right).toFixed(1));
    return { title: box.querySelector('.sub')?.textContent, n: row.length, minGap: gaps.length ? Math.min(...gaps) : null };
  }));
  ok(`${vp}/x-ticks-no-overlap`, ticks.length === 2 && ticks.every((t) => t.n >= 2 && t.minGap >= 2),
    ticks.map((t) => `${t.title}: ticks=${t.n} minGap=${t.minGap}`).join(' | ') || 'LINEBOX_MISSING');

  // ⓑ 분류 순회 — select로 전 분류를 고르며 분류별로 잰다(DOM에는 한 번에 표 1개)
  const per = [];
  for (const c of cats) {
    await page.selectOption(SEL, c.key, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
    per.push({ c, m: await measure(page) });
  }
  bump('cat-visits', per.length);
  ok(`${vp}/updated-at-labels`, per.every(({ c, m }) => /^\d{4}-\d{2}-\d{2}$/.test(m.updated) && m.updated === c.updated_at && m.selLabel === c.label),
    per.map(({ c, m }) => `${c.key}=${m.updated || 'MISSING'}`).join(' '));
  bump('updated-label', per.length);
  const rowSum = per.reduce((s, { m }) => s + m.rows, 0);
  bump('rows', rowSum);
  ok(`${vp}/rows-count`, per.every(({ c, m }) => m.tables === 1 && m.key === c.key && m.rows === c.items.length) && rowSum === allItems.length,
    `sum=${rowSum}/${allItems.length} ${per.map(({ c, m }) => `${c.key}:${m.rows}/${c.items.length}${m.tables !== 1 ? `(tables=${m.tables})` : ''}`).join(' ')}`);
  // 분류 전환 → 그 분류 첫 품목이 차트(첫 품목에 이력이 없으면 차트 없음이 정상)
  ok(`${vp}/cat-switch-chart`, per.every(({ c, m }) => m.chart === (c.items[0].history?.length ? c.items[0].id : 'CHART_MISSING')),
    per.map(({ c, m }) => `${c.key}->${m.chart}`).join(' '));
  const names = per.flatMap(({ m }) => m.names), gaps = per.flatMap(({ m }) => m.gaps);
  bump('name-cells', names.length);
  const badNames = names.filter(n => n.h / n.lh > 3.2 || n.w < n.fs * 3);
  ok(`${vp}/no-char-stack`, names.length === allItems.length && badNames.length === 0,
    `cells=${names.length}/${allItems.length} maxH/lh=${Math.max(0, ...names.map(n => n.h / n.lh)).toFixed(2)} minW=${Math.min(...names.map(n => n.w)).toFixed(0)} bad=${badNames.map(n => `${n.text}(h${n.h.toFixed(0)}/lh${n.lh.toFixed(0)} w${n.w.toFixed(0)})`).join('|') || '-'}`);
  ok(`${vp}/name-not-clipped`, names.length > 0 && names.every(n => n.scrollOK), `clipped=${names.filter(n => !n.scrollOK).map(n => n.text).join('|') || '-'}`);
  ok(`${vp}/row-spacing`, gaps.length === allItems.length && gaps.every(g => g.nameAvg >= 4 && g.avgChg >= 4 && g.inRow && g.h >= 44),
    `rows=${gaps.length} minNameAvg=${Math.min(...gaps.map(g => g.nameAvg)).toFixed(1)} minAvgChg=${Math.min(...gaps.map(g => g.avgChg)).toFixed(1)} minH=${Math.min(...gaps.map(g => g.h)).toFixed(0)}`);
  // 차트가 표 바로 뒤 — 이력 있는 분류마다 차트 top − 표 bottom ∈ [0, CHART_GAP_MAX]
  const withChart = per.filter(({ m }) => m.chartGap != null);
  ok(`${vp}/chart-follows-table`, withChart.length > 0 && withChart.every(({ m }) => m.chartGap >= 0 && m.chartGap <= CHART_GAP_MAX),
    `${withChart.length}/${per.length} ${withChart.map(({ c, m }) => `${c.key}=${m.chartGap.toFixed(1)}`).join(' ')} max=${CHART_GAP_MAX}`);

  // 한 화면 — 행이 가장 많은 분류에서 select를 화면 맨 위에 두고 표 마지막 행을 탭 → 스크롤 없이 차트 상단이 뷰포트 안
  const big = cats.reduce((a, c) => (c.items.length > a.items.length ? c : a), cats[0]);
  await page.selectOption(SEL, big.key, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  await page.evaluate(s => document.querySelector(s)?.scrollIntoView({ block: 'start' }), SEL);
  await page.waitForTimeout(400);
  const last = big.items[big.items.length - 1];
  const y0 = await page.evaluate(() => scrollY);
  let lastErr = '';
  try { const l = page.locator(`[data-testid="semi-row-${last.id}"]`); if (opts.hasTouch) await l.tap({ timeout: 8000 }); else await l.click({ timeout: 8000 }); }
  catch (e) { lastErr = String(e).split('\n')[0].slice(0, 100); }
  await page.waitForTimeout(500);
  const inv = await page.evaluate(() => {
    const ch = document.querySelector('[data-testid="semi-chart"]');
    return { y: scrollY, ih: innerHeight, top: ch ? ch.getBoundingClientRect().top : null, item: ch?.dataset.item || 'CHART_MISSING' };
  });
  ok(`${vp}/tap-chart-in-view`, !lastErr && Math.abs(inv.y - y0) < 2 && inv.item === last.id && inv.top != null && inv.top >= 0 && inv.top < inv.ih,
    `err=${lastErr || '-'} cat=${big.key}(${big.items.length}) scroll ${y0}->${inv.y} chartTop=${inv.top?.toFixed(0)} vh=${inv.ih} item=${inv.item}/${last.id}`);

  ok(`${vp}/no-pageerror`, errs.length === 0, errs.join(' | ') || '0');

  // 육안 캡처 — ① SOX 영역 ② select를 맨 위에 둔 채 마지막 행을 탭한 순간(select·표·차트가 한 화면인지)
  await page.screenshot({ path: `${OUT}/${vp}.png` });
  console.log(`  capture: ${OUT}/${vp}.png`);
  await page.locator('[data-testid="semi-linebox"]').first().scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${vp}-top.png` });
  console.log(`  capture: ${OUT}/${vp}-top.png`);
  await ctx.close();
  perVp[vp] = results.length - before;
}
await b.close();

// 총계 고정 — 뷰포트당 단언 수가 기대치와 다르면 측정 실패(조건부 단언 금지의 구조적 보증)
for (const [vp] of VIEWPORTS) ok(`${vp}/assertion-total`, perVp[vp] === EXPECT_PER_VP, `got=${perVp[vp]} want=${EXPECT_PER_VP}`);

const failed = results.filter(r => !r.pass);
console.log(`\ncoverage: ${Object.entries(cov).map(([k, v]) => `${k}:${v}`).join(' · ')} · assertions:${results.length}`);
if (failed.length) { console.log(`FAIL ${failed.length}/${results.length}`); for (const f of failed) console.log(`  ✗ ${f.name} — ${f.detail}`); }
else console.log(`ALL PASS ${results.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
