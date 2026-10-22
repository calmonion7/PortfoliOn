// task#403 라이브 UAT — 시장지표 탭의 「반도체」 카드(SOX + DRAMeXchange 메모리 현물가). read-only(GET) + 화면 내 행 탭뿐, 쓰기 0.
// 대상: BASE(기본 dev 스택 http://127.0.0.1:8084). 기능 배포 전에는 도달 축에서 FAIL/exit한다(red-first).
// 응답 봉투는 계약(S3)에서 가져왔다: GET /api/market/semiconductor -> {categories:[{key,label,updated_at,items:[{id,name,avg,high,low,change_pct,history}]}],fetched_at}.
// 축 순서: ⓐ 도달·identity(API 카테고리 라벨 == 화면 라벨) → ⓑ 판정축. 뷰포트당 단언 총계는 고정(EXPECT_PER_VP) — 줄면 측정 실패.
// 판정 한계: 색(--up/--down)·SOX 차트 실제 픽셀은 육안 캡처(screenshots-uat403/<viewport>.png)로 확인한다.
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:8084';
const OUT = 'screenshots-uat403';
const DEFAULT_ITEM = 'dram:475';
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
const nonDefault = allItems.find(i => i.id !== DEFAULT_ITEM && i.history?.length > 0);
const hasDefault = allItems.some(i => i.id === DEFAULT_ITEM);
if (!nonDefault || !hasDefault) { console.log(`TARGET_MISSING nonDefault=${nonDefault?.id} hasDefault=${hasDefault}`); process.exit(1); }
// 이빨: 기본 품목과 탭 대상의 이름·id가 서로 달라야 「차트 품목 변경」이 관측 가능하다
const defaultItem = allItems.find(i => i.id === DEFAULT_ITEM);
if (new Set([defaultItem.id, nonDefault.id]).size !== 2 || defaultItem.name === nonDefault.name) { console.log('TEETH_FAIL default/tap 품목이 구별되지 않는다'); process.exit(1); }
console.log(`target: cats=${cats.map(c => c.key + ':' + c.items.length).join(',')} default=${defaultItem.name} tap=${nonDefault.id}(${nonDefault.name})`);

const VIEWPORTS = [
  ['m360', { viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
  ['m390', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
  ['pc1440', { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 }],
];
const EXPECT_PER_VP = 14; // reached·identity-labels·updated-at-labels·rows-count·card-adjacent·no-h-scroll·no-char-stack·name-not-clipped·row-spacing·default-selected·tap-changes-chart·tap-selected-style·x-ticks-no-overlap·no-pageerror
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
  await page.waitForSelector('[data-testid^="semi-cat-"]', { timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0).catch(() => {});
  await page.waitForTimeout(800);

  // ⓐ 도달·identity — 카테고리 라벨/updated_at 이 API와 같다(순서 포함)
  const dom = await page.evaluate(() => {
    const catEls = [...document.querySelectorAll('[data-testid^="semi-cat-"]')];
    return catEls.map(el => ({
      key: el.dataset.testid.replace('semi-cat-', ''),
      label: el.querySelector('strong')?.textContent || '',
      updated: el.querySelector('strong')?.nextElementSibling?.textContent || '',
      rows: el.querySelectorAll('button[data-testid^="semi-row-"]').length,
    }));
  });
  bump('cats', dom.length);
  ok(`${vp}/reached`, dom.length === cats.length && dom.length > 0, `dom=${dom.length} api=${cats.length}`);
  ok(`${vp}/identity-labels`, JSON.stringify(dom.map(d => [d.key, d.label])) === JSON.stringify(cats.map(c => [c.key, c.label])),
    `dom=${dom.map(d => d.label)} api=${cats.map(c => c.label)}`);
  ok(`${vp}/updated-at-labels`, dom.length > 0 && dom.every((d, i) => /^\d{4}-\d{2}-\d{2}$/.test(d.updated) && d.updated === cats[i]?.updated_at),
    dom.map(d => `${d.key}=${d.updated || 'MISSING'}`).join(' '));
  bump('updated-label', dom.length);
  const rowTotal = dom.reduce((s, d) => s + d.rows, 0);
  bump('rows', rowTotal);
  ok(`${vp}/rows-count`, rowTotal === allItems.length && rowTotal > 1, `dom=${rowTotal} api=${allItems.length}`);

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

  // 낱자 적층 — 품목명 셀: 줄 수(세로로 안 겹치는 rect 묶음)와 높이/line-height, 폭
  const names = await page.evaluate(() => [...document.querySelectorAll('button[data-testid^="semi-row-"] > span:first-child')].map(el => {
    const cs = getComputedStyle(el);
    let lh = parseFloat(cs.lineHeight); if (!(lh > 0)) lh = parseFloat(cs.fontSize) * 1.5;
    const r = el.getBoundingClientRect();
    const rg = document.createRange(); rg.selectNodeContents(el);
    const rects = [...rg.getClientRects()].filter(x => x.height > 0).sort((a, b) => a.top - b.top);
    const lines = []; for (const x of rects) { const l = lines[lines.length - 1]; if (l && x.top < l.bottom - x.height * 0.3) { l.bottom = Math.max(l.bottom, x.bottom); } else lines.push({ top: x.top, bottom: x.bottom }); }
    return { text: el.textContent, h: r.height, w: r.width, lh, fs: parseFloat(cs.fontSize), lines: lines.length, scrollOK: el.scrollWidth <= el.clientWidth + 1 };
  }));
  bump('name-cells', names.length);
  const badNames = names.filter(n => n.h / n.lh > 3.2 || n.w < n.fs * 3);
  ok(`${vp}/no-char-stack`, names.length === allItems.length && badNames.length === 0,
    `cells=${names.length}/${allItems.length} maxLines=${Math.max(0, ...names.map(n => n.lines))} maxH/lh=${Math.max(0, ...names.map(n => n.h / n.lh)).toFixed(2)} minW=${Math.min(...names.map(n => n.w)).toFixed(0)} bad=${badNames.map(n => `${n.text}(h${n.h.toFixed(0)}/lh${n.lh.toFixed(0)} w${n.w.toFixed(0)})`).join('|') || '-'}`);
  ok(`${vp}/name-not-clipped`, names.length > 0 && names.every(n => n.scrollOK), `clipped=${names.filter(n => !n.scrollOK).map(n => n.text).join('|') || '-'}`);

  // 간격 — 이름과 평균가 사이 최소 거리(붙어 보이지 않음), 행 안에서 수치가 이름 위로 겹치지 않음
  const gaps = await page.evaluate(() => [...document.querySelectorAll('button[data-testid^="semi-row-"]')].map(btn => {
    const [n, a, c] = btn.children; const rn = n.getBoundingClientRect(), ra = a.getBoundingClientRect(), rc = c.getBoundingClientRect(), rb = btn.getBoundingClientRect();
    return { nameAvg: ra.left - rn.right, avgChg: rc.left - ra.right, inRow: rc.right <= rb.right + 0.5, h: rb.height };
  }));
  ok(`${vp}/row-spacing`, gaps.length === allItems.length && gaps.every(g => g.nameAvg >= 4 && g.avgChg >= 4 && g.inRow && g.h >= 44),
    `rows=${gaps.length} minNameAvg=${Math.min(...gaps.map(g => g.nameAvg)).toFixed(1)} minAvgChg=${Math.min(...gaps.map(g => g.avgChg)).toFixed(1)} minH=${Math.min(...gaps.map(g => g.h)).toFixed(0)}`);

  // 기본 선택 상태(탭 전)
  const sel0 = await page.evaluate(([d, t]) => {
    const get = id => { const el = document.querySelector(`[data-testid="semi-row-${id}"]`); return el ? { pressed: el.getAttribute('aria-pressed'), bl: getComputedStyle(el).borderLeftColor } : null; };
    return { def: get(d), tap: get(t), chart: document.querySelector('[data-testid="semi-chart"]')?.dataset.item || 'CHART_MISSING' };
  }, [DEFAULT_ITEM, nonDefault.id]);
  ok(`${vp}/default-selected`, sel0.def?.pressed === 'true' && sel0.tap?.pressed === 'false' && sel0.chart === DEFAULT_ITEM, `chart=${sel0.chart} def=${sel0.def?.pressed} tap=${sel0.tap?.pressed}`);

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

  ok(`${vp}/no-pageerror`, errs.length === 0, errs.join(' | ') || '0');

  // 육안 캡처 — 탭한 행·차트가 화면에 있는 순간(측정 지점에서 찍는다)
  await page.locator('[data-testid="semi-linebox"]').first().scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${vp}-top.png` });
  console.log(`  capture: ${OUT}/${vp}-top.png`);
  await page.locator('[data-testid="semi-chart"]').scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${vp}.png` });
  console.log(`  capture: ${OUT}/${vp}.png`);
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
