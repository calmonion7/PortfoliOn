// task#306 라이브 UAT(신규) — 기술 해부 `/tech-anatomy/:slug` (ADR-0042).
// GET만 — POST/PUT/DELETE 없음, 라이브 프로덕션 쓰기 0. 옛 코드에 돌려도 안전하다.
//
// 실행: node scripts/uat-tech-anatomy.mjs
//
// ── 판정 규율(live-uat-probes 스킬 그대로) ──────────────────────────────────────────────
//  · identity를 판정축보다 **먼저** — 대상이 틀려도 통과하는 축을 만들지 않는다(⑧ⓘ).
//  · 축마다 `*-domain` sentinel — 표본 부재를 FAIL로 만든다(⑧ⓐ). 조건부 단언 금지.
//  · **대조군** — composition 없는 slug에서 축 0개 + 안내 노출. 없으면 "앱이 안 그런다"와
//    "계측기가 못 본다"가 구별되지 않는다(⑧ⓔ).
//  · 잘림 축은 **두 계열** — 텍스트 leaf의 scrollWidth + `overflow:hidden` 컨테이너의
//    scrollWidth. leaf만 재면 부모가 자르는 절반이 원리적으로 안 보인다(⑦/task#275).
//  · 줄 수는 rect 개수가 아니라 **세로로 겹치지 않는 rect 묶음의 개수** — 텍스트 노드가
//    쪼개지면 한 줄인데 여러 rect가 나오고(task#275), 같은 줄에 폰트 크기가 섞이면 top이
//    갈린다(task#293). 겹침 기준이라 둘 다 흡수한다.
//  · 이 화면은 막대 조각 안에 텍스트가 없다(ADR-0042 결정 5) — 그 사실 자체를 축으로 둔다.
import { chromium, devices } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-tech-anatomy';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const cov = {};
const rawLog = [];
const P = (ok, tag, msg) => results.push({ ok, tag, msg });
const bump = (k, n = 1) => { cov[k] = (cov[k] || 0) + n; };
const eq = (tag, got, want, note = '') => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  P(ok, tag, `${ok ? 'PASS' : 'FAIL'} — got=${JSON.stringify(got)} want=${JSON.stringify(want)}${note ? ' · ' + note : ''}`);
};

// ── 로그인 + 대상 선정 ────────────────────────────────────────────────────────
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const { access_token, refresh_token } = await login.json();
if (!access_token) { console.error('로그인 실패 — access_token 없음. 종료.'); process.exit(1); }
const AUTH = { Authorization: `Bearer ${access_token}` };

const listRes = await fetch(`${BASE}/api/tech-reports`, { headers: AUTH });
const REPORTS = (await listRes.json()).reports || [];
const WITH = REPORTS.filter((r) => r.composition);
const WITHOUT = REPORTS.filter((r) => !r.composition);
if (WITH.length === 0) { console.error('composition이 있는 발행물이 0건 — 이 프로브는 게이트가 될 수 없다. 종료.'); process.exit(1); }
if (WITHOUT.length === 0) { console.error('대조군(composition 없는 slug)이 0건 — 대조 없이 판정할 수 없다. 종료.'); process.exit(1); }
const TARGET = WITH[0];
const CONTROL = WITHOUT[0];
rawLog.push(`대상 slug=${TARGET.slug} (composition 있음) · 대조군 slug=${CONTROL.slug} (composition 없음)`);
rawLog.push(`발행물 ${REPORTS.length}건 중 해부 ${WITH.length}건 · 미작성 ${WITHOUT.length}건`);

// API가 말하는 축별 항목 수 — 화면 카운트를 이것과 대조한다(커버리지 카운터의 기준선).
const AXIS_KEYS = ['tech', 'minerals', 'experts'];
const API_COUNTS = {};
for (const k of AXIS_KEYS) API_COUNTS[k] = (TARGET.composition[k] || []).length;
rawLog.push(`API 축별 항목 수: ${JSON.stringify(API_COUNTS)}`);

const VIEWS = [
  { name: 'm278', opts: { ...devices['iPhone SE'], viewport: { width: 278, height: 800 }, isMobile: true, hasTouch: true } },
  { name: 'm768', opts: { viewport: { width: 768, height: 1000 } } },
  { name: 'pc1280', opts: { viewport: { width: 1280, height: 1000 } } },
];

// 브라우저 안에서 도는 측정기 — 줄 수는 "세로로 겹치지 않는 rect 묶음"으로 센다.
const MEASURE = `
window.__lines = function (el) {
  const rects = [];
  const walk = (n) => {
    if (n.nodeType === 3 && n.textContent.trim()) {
      const r = document.createRange(); r.selectNodeContents(n);
      for (const x of r.getClientRects()) if (x.width > 0 && x.height > 0) rects.push(x);
    }
    for (const c of n.childNodes) walk(c);
  };
  walk(el);
  if (!rects.length) return 0;
  rects.sort((a, b) => a.top - b.top);
  const lines = [];
  for (const r of rects) {
    const hit = lines.find((L) => {
      const ov = Math.min(L.bottom, r.bottom) - Math.max(L.top, r.top);
      return ov > 0.3 * Math.min(L.bottom - L.top, r.height);
    });
    if (hit) { hit.top = Math.min(hit.top, r.top); hit.bottom = Math.max(hit.bottom, r.bottom); }
    else lines.push({ top: r.top, bottom: r.bottom });
  }
  return lines.length;
};
`;

const browser = await chromium.launch();
for (const V of VIEWS) {
  // SW가 /api/*를 가로채므로 차단 필수 — 안 하면 응답 기반 판정이 통째로 헛돈다.
  const ctx = await browser.newContext({ ...V.opts, serviceWorkers: 'block' });
  await ctx.addInitScript(([a, r]) => {
    localStorage.setItem('access_token', a);
    localStorage.setItem('refresh_token', r);
    localStorage.setItem('theme', 'light');
    localStorage.setItem('pwa-install-dismissed-at', String(Date.now()));
  }, [access_token, refresh_token]);
  const page = await ctx.newPage();
  await page.addInitScript(MEASURE);

  // ══ 대상 페이지 ══════════════════════════════════════════════════════════
  await page.goto(`${BASE}/tech-anatomy/${TARGET.slug}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="tech-anatomy"]', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(900);

  // ── identity: 지금 보고 있는 것이 그 대상인가 (판정축보다 먼저) ──
  const ident = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="tech-anatomy"]');
    return { present: !!root, h1: root ? (root.querySelector('h1')?.textContent || '').trim() : null };
  });
  eq(`identity:${V.name}`, ident.present && /해부$/.test(ident.h1 || ''), true, `h1="${ident.h1}"`);
  bump('identity');

  // ── ⓐ 3축 렌더 + 축별 커버리지 카운터(항목 수가 API 응답과 일치) ──
  const axes = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="tech-anatomy"]');
    if (!root) return null;
    return [...root.querySelectorAll('[data-testid="anatomy-axis"]')].map((ax) => {
      const bar = ax.querySelector('[data-testid="anatomy-bar"]');
      const segs = [...ax.querySelectorAll('[data-testid="anatomy-seg"]')];
      return {
        key: ax.getAttribute('data-axis'),
        title: (ax.querySelector('[data-testid="anatomy-axis-title"]')?.textContent || '').trim(),
        basis: (ax.querySelector('[data-testid="anatomy-basis"]')?.textContent || '').trim(),
        items: ax.querySelectorAll('[data-testid="anatomy-item"]').length,
        segs: segs.length,
        barW: bar ? bar.getBoundingClientRect().width : 0,
        segSum: segs.reduce((s, e) => s + e.getBoundingClientRect().width, 0),
        segText: segs.reduce((s, e) => s + (e.textContent || '').trim().length, 0),
        levels: [...ax.querySelectorAll('[data-testid="anatomy-leader-level"]')].map((e) => e.textContent.trim()),
      };
    });
  });
  eq(`axes-domain:${V.name}`, axes && axes.length > 0 ? 'OK' : `DOMAIN_TOO_SMALL(${axes ? axes.length : 'null'})`, 'OK');
  eq(`axes-count:${V.name}`, axes ? axes.map((a) => a.key) : null, AXIS_KEYS);
  bump('axes', 2);

  for (const a of axes || []) {
    // 커버리지 카운터 — 화면 항목 수가 API와 다르면 렌더가 무음으로 빠뜨린 것이다.
    eq(`axis-items:${V.name}:${a.key}`, a.items, API_COUNTS[a.key], `segs=${a.segs}`);
    eq(`axis-segs:${V.name}:${a.key}`, a.segs, API_COUNTS[a.key]);
    // ⓑ 「기준」 문구 상시 노출 (축마다 1개, 비어있지 않음)
    eq(`axis-basis:${V.name}:${a.key}`, a.basis.length > 0, true, `basis="${a.basis}"`);
    // ⓒ Σ=100의 시각적 진술 — 조각 폭 합 ≈ 막대 폭(±2px)
    eq(`axis-segsum:${V.name}:${a.key}`, Math.abs(a.segSum - a.barW) <= 2, true,
       `segSum=${a.segSum.toFixed(1)} barW=${a.barW.toFixed(1)}`);
    // 막대 조각에는 텍스트가 없다(ADR-0042 결정 5) — 있으면 조각의 overflow:hidden이 자른다
    eq(`axis-segtext:${V.name}:${a.key}`, a.segText, 0);
    bump('axis', 5);
    rawLog.push(`${V.name} ${a.key}: title="${a.title}" basis="${a.basis}" items=${a.items} barW=${a.barW.toFixed(1)} segSum=${a.segSum.toFixed(1)}`);
  }

  // ── ⓕ 기술 축 선도 칩에 단계 숫자가 실제로 붙는가 ──
  const techAxis = (axes || []).find((a) => a.key === 'tech');
  eq(`leader-domain:${V.name}`, techAxis && techAxis.levels.length > 0 ? 'OK' : 'DOMAIN_TOO_SMALL(0)', 'OK');
  eq(`leader-levels:${V.name}`, (techAxis?.levels || []).every((t) => /^[1-5]단계$/.test(t)), true,
     `levels=${JSON.stringify(techAxis?.levels || [])}`);
  bump('leader', 2);

  // ── ⓓ 가로 스크롤 0 (문서 + 본문 루트) ──
  const hscroll = await page.evaluate(() => {
    const de = document.documentElement;
    const main = document.querySelector('main.page-wrap') || de;
    return {
      doc: de.scrollWidth - de.clientWidth,
      main: main.scrollWidth - main.clientWidth,
      cw: de.clientWidth,
    };
  });
  eq(`h-scroll-doc:${V.name}`, hscroll.doc <= 0, true, `scrollWidth-clientWidth=${hscroll.doc} (cw=${hscroll.cw})`);
  eq(`h-scroll-main:${V.name}`, hscroll.main <= 0, true, `diff=${hscroll.main}`);
  bump('h-scroll', 2);

  // ── ⓔ 잘림 두 계열 — 텍스트 leaf + overflow:hidden 컨테이너 ──
  const clip = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="tech-anatomy"]');
    if (!root) return null;
    const leaf = [], box = [];
    for (const el of root.querySelectorAll('*')) {
      const txt = (el.textContent || '').trim();
      const cs = getComputedStyle(el);
      const hasOwnText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (hasOwnText && el.scrollWidth > el.clientWidth + 1) leaf.push(`${el.className}|${txt.slice(0, 28)}`);
      // 부모가 자르는 절반 — 자식이 nowrap이면 자식의 scrollWidth == clientWidth라 leaf 축이 못 본다
      if (cs.overflow === 'hidden' || cs.overflowX === 'hidden') {
        if (el.scrollWidth > el.clientWidth + 1) box.push(`${el.className}|${txt.slice(0, 28)}`);
      }
    }
    const leafN = root.querySelectorAll('*').length;
    return { leaf, box, scanned: leafN };
  });
  eq(`clip-domain:${V.name}`, clip && clip.scanned > 20 ? 'OK' : `DOMAIN_TOO_SMALL(${clip?.scanned})`, 'OK');
  eq(`clip-leaf:${V.name}`, clip?.leaf || null, []);
  eq(`clip-box:${V.name}`, clip?.box || null, []);
  bump('clip', 3);
  rawLog.push(`${V.name} clip 스캔 ${clip?.scanned}개 노드`);

  // ── 칩 접힘 — 칩 텍스트는 어느 폭에서도 1줄(flex-wrap 컨테이너 + nowrap 자식) ──
  const chips = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="tech-anatomy"]');
    if (!root) return [];   // 대상 부재는 FAIL로 기록돼야지 프로브를 죽여선 안 된다(보고가 통째로 사라진다)
    const els = [...root.querySelectorAll('[data-testid="anatomy-leader-chip"], [data-testid="anatomy-producer-chip"]')];
    return els.map((e) => ({ t: e.textContent.trim().slice(0, 24), lines: window.__lines(e) }));
  });
  eq(`chip-domain:${V.name}`, chips.length > 0 ? 'OK' : 'DOMAIN_TOO_SMALL(0)', 'OK');
  eq(`chip-1line:${V.name}`, chips.filter((c) => c.lines !== 1).map((c) => `${c.t}=${c.lines}줄`), []);
  bump('chip', 2);
  rawLog.push(`${V.name} 칩 ${chips.length}개 검사`);

  await page.screenshot({ path: `${OUT}/${V.name}-anatomy.png`, fullPage: true });

  // ══ ⓖ 대조군 — composition 없는 slug ══════════════════════════════════════
  await page.goto(`${BASE}/tech-anatomy/${CONTROL.slug}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="tech-anatomy"]', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(700);
  const ctrl = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="tech-anatomy"]');
    return {
      axes: root ? root.querySelectorAll('[data-testid="anatomy-axis"]').length : -1,
      empty: !!root?.querySelector('[data-testid="anatomy-empty"]'),
      emptyText: (root?.querySelector('[data-testid="anatomy-empty"]')?.textContent || '').trim().slice(0, 40),
    };
  });
  // 축이 0개여야 한다 — 이게 없으면 "3축이 보인다"는 단언이 무엇을 봤는지 증명되지 않는다
  eq(`control-axes0:${V.name}`, ctrl.axes, 0);
  eq(`control-empty:${V.name}`, ctrl.empty, true, `text="${ctrl.emptyText}"`);
  bump('control', 2);
  await page.screenshot({ path: `${OUT}/${V.name}-control.png`, fullPage: true });

  // ══ ⓗ 왕복 내비 — 목록 → 해부 → 리포트 → 해부 → 뒤로가기 ═══════════════
  await page.goto(`${BASE}/tech-reports`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="tech-report-card"]', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(500);
  const cardLink = page.locator(`[data-testid="tech-report-card"][data-slug="${TARGET.slug}"] [data-testid="card-link-anatomy"]`);
  const navOk = { list2anatomy: false, anatomy2report: false, report2anatomy: false, back: false };
  if (await cardLink.count() > 0) {
    await cardLink.first().click();
    await page.waitForTimeout(900);
    navOk.list2anatomy = page.url().includes(`/tech-anatomy/${TARGET.slug}`);
    const toReport = page.locator('[data-testid="anatomy-to-report"]');
    if (await toReport.count() > 0) {
      await toReport.first().click(); await page.waitForTimeout(900);
      navOk.anatomy2report = page.url().includes(`/tech-report/${TARGET.slug}`);
      const toAnatomy = page.locator('[data-testid="report-to-anatomy"]');
      if (await toAnatomy.count() > 0) {
        await toAnatomy.first().click(); await page.waitForTimeout(900);
        navOk.report2anatomy = page.url().includes(`/tech-anatomy/${TARGET.slug}`);
        await page.goBack(); await page.waitForTimeout(900);
        navOk.back = page.url().includes(`/tech-report/${TARGET.slug}`);
      }
    }
  }
  eq(`nav-roundtrip:${V.name}`, navOk, { list2anatomy: true, anatomy2report: true, report2anatomy: true, back: true });
  bump('nav');

  await ctx.close();
}
await browser.close();

// ── 보고 ──────────────────────────────────────────────────────────────────────
const fails = results.filter((r) => !r.ok);
console.log('\n' + '═'.repeat(78));
console.log('커버리지 (계열별 검사 수 — 재실행 간 비교용, 줄면 통과가 아니라 측정 실패):');
for (const [k, v] of Object.entries(cov).sort()) console.log(`  ${k.padEnd(20)} ${v}`);
console.log(`  ${'(합계)'.padEnd(20)} ${Object.values(cov).reduce((a, b) => a + b, 0)}`);
console.log(`\n단언 총계: ${results.length}건 · PASS ${results.length - fails.length} · FAIL ${fails.length}`);
console.log('\n원시 실측(단언 아님):');
for (const l of rawLog) console.log(`  ${l}`);
console.log(`\n※ 육안 캡처 ${OUT}/ — {view}-{anatomy|control}.png`);
console.log('═'.repeat(78));
fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ cov, results, target: TARGET.slug, control: CONTROL.slug, API_COUNTS }, null, 2));
if (fails.length) {
  console.log('\nFAIL 상세:');
  for (const f of fails) console.log(`  ✗ ${f.tag}\n      ${f.msg}`);
  process.exit(1);
}
console.log(`\nALL PASS ${results.length}/${results.length}`);
