import { chromium, devices } from 'playwright';
import fs from 'fs';

// task#303 S0 — 라이브 baseline 실측(읽기 전용). 옛 코드가 라이브인 동안만 잴 수 있는 창.
// 축1: 시계열 엔드포인트의 심볼별 history {길이, 첫날짜, 끝날짜} — S6의 「줄지 않음」 판정 기준선.
// 축2: 시장지표 탭이 에러 0으로 렌더 + 4개 섹션 차트 존재.
// 응답 봉투는 추정하지 않는다 — {date,...} 리스트를 재귀 탐색해 실제 구조에서 뽑는다.
const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat303';
fs.mkdirSync(OUT, { recursive: true });

const checks = [];
const cov = {};
const bump = (k, n = 1) => { cov[k] = (cov[k] || 0) + n; };
const eq = (name, got, want, ctx = '') => {
  checks.push({ name, ctx, got, want, pass: JSON.stringify(got) === JSON.stringify(want) });
};

// ── 인증 (test@portfolion.com 은 비-admin. 이 엔드포인트들은 전부 read라 무관) ──
const lr = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const auth = await lr.json();
if (!auth.access_token) { console.error('로그인 실패 — 폴백 없이 종료.', lr.status, JSON.stringify(auth).slice(0, 300)); process.exit(1); }
console.log(`로그인 OK (${lr.status})`);

// ── 축1: API baseline ──
const EPS = ['commodities', 'treasury', 'fx', 'indices', 'vix', 'kospi-signal'];
const apiRows = [];   // {ep, path, len, first, last}
const apiStatus = {};

const walk = (node, path, out) => {
  if (Array.isArray(node)) {
    if (node.length && node[0] && typeof node[0] === 'object' && 'date' in node[0]) {
      // dates 전체를 싣는다 — S6 는 길이 비교가 아니라 겹치는 창의 날짜 집합차로 판정해야 한다
      // (cache.py:105 가 366일 롤링 컷오프라 앞쪽 점은 매일 정상 소멸한다 → 단순 길이 비교는 거짓 FAIL).
      out.push({ path: path || '(root)', len: node.length, first: node[0].date, last: node[node.length - 1].date, dates: node.map(p => p.date) });
    }
    return;
  }
  if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k, out);
};

for (const ep of EPS) {
  const res = await fetch(`${BASE}/api/market/${ep}`, { headers: { Authorization: `Bearer ${auth.access_token}` } });
  apiStatus[ep] = res.status;
  eq('API 200', res.status, 200, ep);
  bump('api-endpoint');
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  const found = [];
  if (body) walk(body, '', found);
  // 표본 부재를 무음 스킵하지 않는다 — sentinel 로 FAIL 시킨다.
  eq('시계열 표본 존재(>0)', found.length > 0 ? 'OK' : `NO_SERIES(${found.length})`, 'OK', ep);
  for (const f of found) {
    apiRows.push({ ep, ...f });
    bump('api-series');
    bump('api-points', f.len);
    // 각 시리즈가 실제로 점을 갖는지 무조건 단언(빈 배열은 walk 가 못 잡으므로 여기선 항상 참이지만, 총계를 구조적으로 고정한다)
    eq('시리즈 길이 > 0', f.len > 0 ? 'OK' : `EMPTY(${f.path})`, 'OK', `${ep} ${f.path}`);
  }
}

// ── 축2: 화면 ──
const TARGETS = ['주요 지수', '원자재', '미국 국채금리', '환율'];

async function settle(page) {
  await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

// 섹션 카드 = .mkt-title 을 가진 최상위 카드 컨테이너. 판정 범위를 그 카드로 한정한다(⑧ⓒ).
// 카드 해소: SectionCard 는 .reveal 래퍼를 가진다(useReveal). Loading/Error 카드는 .reveal 이 없으므로
// 헤더 div 의 부모(=SECTION_CARD_OUTER div)로 폴백한다. ⚠️ .mkt-title 의 부모(button/헤더div)로 멈추면
// 카드 본문이 범위 밖이라 차트가 원리적으로 0건이 된다(1차 실행에서 실제로 8건 거짓 FAIL).
const probeSections = (titles) => (ts) => {
  const cards = [...document.querySelectorAll('.mkt-title')].map(t => ({
    title: t.textContent.trim(),
    card: t.closest('.reveal') || (t.parentElement && t.parentElement.parentElement) || t,
  }));
  const out = { _docPlots: [...document.querySelectorAll('.recharts-wrapper > .recharts-surface')].length };
  for (const want of ts) {
    const hit = cards.find(c => c.title === want);
    if (!hit) { out[want] = { found: false }; continue; }
    const card = hit.card;
    const txt = card.textContent || '';
    // 플롯 surface = 부모가 .recharts-wrapper 인 것(범례 아이콘 surface 배제, 가토 recharts ⓐ)
    const surfaces = [...card.querySelectorAll('.recharts-surface')];
    const plots = surfaces.filter(s => s.parentElement && s.parentElement.classList.contains('recharts-wrapper'));
    const box = card.getBoundingClientRect();
    out[want] = {
      found: true,
      errorMark: /오류/.test(txt) || /데이터를 불러오지 못했습니다/.test(txt),
      emptyMark: /아직 데이터가 없|데이터 없음/.test(txt),
      surfaces: surfaces.length,
      plots: plots.length,
      plotW: plots[0] ? Math.round(plots[0].getBoundingClientRect().width) : 0,
      plotH: plots[0] ? Math.round(plots[0].getBoundingClientRect().height) : 0,
      cardH: Math.round(box.height),
    };
  }
  return out;
};

async function run(view, ctxOpts) {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ ...ctxOpts, serviceWorkers: 'block' }); // SW가 /api/* 를 가로챈다
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([a, r]) => { localStorage.setItem('access_token', a); localStorage.setItem('refresh_token', r); }, [auth.access_token, auth.refresh_token]);
  await page.goto(`${BASE}/market/indicators`, { waitUntil: 'domcontentloaded' });
  await settle(page);

  // 원자재·국채·환율은 기본 접힘(useState(false)) → 펼친다. 주요 지수만 기본 펼침.
  for (const t of ['원자재', '미국 국채금리', '환율']) {
    const clicked = await page.evaluate((title) => {
      const el = [...document.querySelectorAll('.mkt-title')].find(x => x.textContent.trim() === title);
      const btn = el && el.closest('button');
      if (btn) { btn.click(); return true; }
      return false;
    }, t);
    eq('섹션 토글 버튼 클릭 성공', clicked, true, `${view} ${t}`);
    bump('section-toggle');
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(1500);

  const secs = await page.evaluate(probeSections(TARGETS), TARGETS);
  console.log(`\n[${view}] 섹션 실측`, JSON.stringify(secs, null, 1));

  for (const t of TARGETS) {
    const s = secs[t] || { found: false };
    bump('section');
    eq('섹션 존재', s.found, true, `${view} ${t}`);
    eq('에러 마커 0', s.found ? s.errorMark : 'SECTION_MISSING', false, `${view} ${t}`);
    eq('빈 상태 마커 0', s.found ? s.emptyMark : 'SECTION_MISSING', false, `${view} ${t}`);
    eq('플롯 surface ≥1', s.found ? (s.plots >= 1 ? 'OK' : `NO_PLOT(surfaces=${s.surfaces})`) : 'SECTION_MISSING', 'OK', `${view} ${t}`);
    if (s.found && s.plots >= 1) bump('chart-plot');
  }

  // 육안 캡처 — 캡처 전 scrollIntoView(⑧ⓓ)
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('.mkt-title')].find(x => x.textContent.trim() === '원자재');
    if (el) el.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${view}-sections.png`, fullPage: false });
  await page.screenshot({ path: `${OUT}/${view}-full.png`, fullPage: true });

  console.log(`[${view}] 콘솔/페이지 에러 ${errs.length}건`, errs.slice(0, 6));
  eq('페이지 에러 0', errs.length, 0, view);
  await b.close();
  return { errs, secs };
}

const pc = await run('pc', { viewport: { width: 1440, height: 1000 } });
const mo = await run('mobile', { ...devices['iPhone 13'] });

// ── 출력 ──
console.log('\n=== API 상태 ===');
for (const ep of EPS) console.log(`  /api/market/${ep} → ${apiStatus[ep]}`);
console.log('\n=== API baseline (심볼별 history) ===');
console.log('| endpoint | path (symbol) | len | first | last |');
console.log('|---|---|---:|---|---|');
for (const r of apiRows) console.log(`| ${r.ep} | ${r.path} | ${r.len} | ${r.first} | ${r.last} |`);

const failed = checks.filter(c => !c.pass);
console.log(`\n=== 커버리지: ${Object.entries(cov).map(([k, v]) => `${k}:${v}`).join(' · ')} · 단언 ${checks.length}건 ===`);
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'} [${c.ctx}] ${c.name} — got=${JSON.stringify(c.got)} want=${JSON.stringify(c.want)}`);
console.log(failed.length ? `\n>>> FAIL ${failed.length}/${checks.length}` : `\n>>> ALL PASS ${checks.length}/${checks.length}`);
fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ apiStatus, apiRows, cov, checks, pcSecs: pc.secs, moSecs: mo.secs }, null, 2));
process.exit(failed.length ? 1 : 0);
