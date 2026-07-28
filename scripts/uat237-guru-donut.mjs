// task#237 라이브 UAT — ① 라벨 폭 실측 ③ PC 2열 배치 ④ 목록 상위 10행 색 점.
// 83명 전수로 라벨 밴드 이탈·라벨 상호 교차를 **네 모서리** 반지름 기준으로 본다(중심만 보면
// 가로 넘침을 놓친다 — task#235에서 실제로 거짓 PASS가 났다).
// 기준 상자는 추정하지 않고 렌더된 sector path의 d에서 실측한다(task#228 교훈).
// 색 점은 색 문자열을 하드코딩하지 않고 도넛 sector의 계산 fill과 인덱스별로 대조한다.
import { chromium, devices } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat237';
fs.mkdirSync(OUT, { recursive: true });
const BASELINE_LABELS = 370;      // task#235 계획 단계 83명 전수 실측
const BASELINE_OUTER_R = 130;     // 변경 전 PC/모바일 공통 outerR
const MOBILE_DONUT_MAX_H = 340;   // 모바일 도넛 블록 높이 상한(task#235 수준 유지)

const r = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const { access_token, refresh_token } = await r.json();
const mdata = await (await fetch(`${BASE}/api/guru/managers`, { headers: { Authorization: `Bearer ${access_token}` } })).json();
const managers = mdata.managers || [];

const results = [];
const fail = (tag, msg, data) => results.push({ ok: false, tag, msg, data });
const pass = (tag, msg, data) => results.push({ ok: true, tag, msg, data });

const b = await chromium.launch({ headless: true });
const seed = async (page) => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([a, rr]) => {
    localStorage.setItem('access_token', a); localStorage.setItem('refresh_token', rr); localStorage.setItem('theme', 'light');
  }, [access_token, refresh_token]);
};
const settle = async (page, ms = 1500) => {
  await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(ms);
};

// ── 브라우저 안에서 도는 측정기 ───────────────────────────────
const readDetail = () => {
  const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; };
  const donutEl = document.querySelector('.guru-donut');
  const rows = [...document.querySelectorAll('[data-testid="holding-row"]')];
  const common = {
    split: !!document.querySelector('.guru-detail-split'),
    donut: donutEl ? box(donutEl) : null,
    firstRow: rows.length ? box(rows[0]) : null,
    // 행이 컬럼 안에서 잘리지 않았는지 — 가로 오버플로 0
    rowOverflow: rows.filter(e => e.scrollWidth > e.clientWidth + 1).length,
    rowCount: rows.length,
    // 색 점: data-donut 인덱스 → 계산된 배경색
    dots: [...document.querySelectorAll('.guru-dot[data-donut]')].map(e => ({
      i: Number(e.getAttribute('data-donut')), bg: getComputedStyle(e).backgroundColor,
    })),
    dotNodes: document.querySelectorAll('.guru-dot').length,
    // 실측 경로가 배선돼 있는지 — 숨은 측정용 SVG 존재
    measurer: !!document.querySelector('svg[aria-hidden="true"] [data-m="name"]'),
  };
  const svg = document.querySelector('.recharts-surface');
  if (!svg) return { present: false, ...common };
  const sectors = [...document.querySelectorAll('.recharts-sector')];
  const radii = sectors.flatMap(p => [...(p.getAttribute('d') || '').matchAll(/A\s*([\d.]+),\s*([\d.]+)/g)].map(m => parseFloat(m[1])));
  const sb = box(svg);
  const C = { x: sb.cx, y: sb.cy };
  // 커스텀 label은 .recharts-pie-labels가 아니라 zIndex 레이어에 들어가고 recharts가 빈
  // .recharts-pie-label-text placeholder를 따로 남긴다 → 내용 있는 text만 센다(task#235 D3).
  const labels = [...document.querySelectorAll('.recharts-surface text')]
    .filter(t => (t.textContent || '').trim())
    .map(t => {
      const q = box(t);
      const rs = [[q.l, q.t], [q.r, q.t], [q.l, q.b], [q.r, q.b]].map(([x, y]) => Math.hypot(x - C.x, y - C.y));
      return { text: t.textContent, ...q, minR: Math.min(...rs), maxR: Math.max(...rs) };
    });
  return {
    present: true,
    ...common,
    svg: sb,
    innerR: radii.length ? Math.min(...radii) : null,
    outerR: radii.length ? Math.max(...radii) : null,
    sectors: sectors.length,
    // 조각 fill을 인덱스 순서로 — 색 점 대조용(색 문자열 하드코딩 금지)
    sectorFills: sectors.map(p => getComputedStyle(p).fill),
    labels,
  };
};

const overlaps = (a, c) => !(a.r <= c.l || a.l >= c.r || a.b <= c.t || a.t >= c.b);

// ══ 83명 전수 (PC) ═════════════════════════════════════════
const ctx2 = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p2 = await ctx2.newPage();
await seed(p2);

let totalLabels = 0, bandOut = 0, interTotal = 0, notRendered = [], splitMissing = [], overflowRows = 0, dotMismatch = [];
const SHOT_TAGS = new Set();   // 스크린샷 3표본: 라벨 최다 / 라벨 최소 / 조각 최다
const bigSlices = (m) => (m.top10 || []).filter(h => (h.weight_pct || 0) >= 5).length;
const byLabels = [...managers].sort((a, c) => bigSlices(c) - bigSlices(a));
const shotIds = new Set([byLabels[0]?.id, byLabels[byLabels.length - 1]?.id,
  [...managers].sort((a, c) => (c.num_stocks || 0) - (a.num_stocks || 0))[0]?.id].filter(Boolean));

for (const m of managers) {
  await p2.goto(`${BASE}/guru/${m.id}`, { waitUntil: 'domcontentloaded' });
  await settle(p2, 900);
  const d = await p2.evaluate(readDetail);

  if (shotIds.has(m.id)) { await p2.screenshot({ path: `${OUT}/pc-${m.id}.png` }); SHOT_TAGS.add(m.id); }

  if (!d.measurer) fail(`S3/${m.id}`, '라벨 폭 실측용 숨은 SVG 부재', {});
  overflowRows += d.rowOverflow;

  if (!d.present) { notRendered.push({ id: m.id, num_stocks: m.num_stocks ?? 0 }); continue; }

  // ③ PC 2열 — 도넛 우측 끝이 목록 첫 행 좌측보다 왼쪽(나란히, 교차 0)
  if (!d.split) splitMissing.push(m.id);
  else if (d.firstRow && !(d.donut.r <= d.firstRow.l + 1)) {
    fail(`S1/${m.id}`, '도넛과 목록이 나란히 놓이지 않음', { donutR: Math.round(d.donut.r), rowL: Math.round(d.firstRow.l) });
  }

  // ④ 색 점 ↔ 조각 fill 인덱스별 일치 (rgb 문자열끼리 대조 — 하드코딩 없음)
  for (const dot of d.dots) {
    const fillRgb = d.sectorFills[dot.i];
    if (!fillRgb) continue;
    if (dot.bg.replace(/\s/g, '') !== fillRgb.replace(/\s/g, '')) {
      dotMismatch.push({ id: m.id, i: dot.i, dot: dot.bg, sector: fillRgb });
    }
  }

  // ① 라벨 — 네 모서리 기준 밴드 이탈
  totalLabels += d.labels.length;
  const outside = d.labels.filter(l => l.minR < d.innerR - 1 || l.maxR > d.outerR + 1);
  if (outside.length) {
    bandOut += outside.length;
    fail(`S4/${m.id}`, `라벨 ${outside.length}개가 밴드(${Math.round(d.innerR)}~${Math.round(d.outerR)}) 이탈`,
      { outside: outside.map(l => ({ t: l.text, minR: Math.round(l.minR), maxR: Math.round(l.maxR), w: Math.round(l.w) })) });
  }
  // 라벨 상호 교차
  let inter = 0;
  for (let i = 0; i < d.labels.length; i++) for (let j = i + 1; j < d.labels.length; j++) if (overlaps(d.labels[i], d.labels[j])) inter++;
  if (inter) { interTotal += inter; fail(`S4/${m.id}`, `라벨 상호 교차 ${inter}건`, { labels: d.labels.map(l => l.text) }); }
}

// 전수 집계
(bandOut === 0 ? pass : fail)('S4/전수', `83명 라벨 밴드 이탈 0건 (라벨 총 ${totalLabels}개)`, { bandOut, totalLabels });
(interTotal === 0 ? pass : fail)('S4/전수', '83명 라벨 상호 교차 0건', { interTotal });
(totalLabels >= BASELINE_LABELS ? pass : fail)('S4/전수', `라벨 총수 ${totalLabels} ≥ baseline ${BASELINE_LABELS}(도넛 확대분)`, { totalLabels, baseline: BASELINE_LABELS });
(notRendered.length === 1 && notRendered[0].num_stocks === 0 ? pass : fail)('S4/전수', '도넛 미렌더는 num_stocks:0 1명만', { notRendered });
(splitMissing.length === 0 ? pass : fail)('S1/전수', '도넛 있는 전 매니저에 2열 wrapper', { splitMissing });
(overflowRows === 0 ? pass : fail)('S1/전수', '목록 행 가로 잘림 0건', { overflowRows });
(dotMismatch.length === 0 ? pass : fail)('S2/전수', '상위 10행 색 점 = 도넛 조각 fill (인덱스별 대조)', { n: dotMismatch.length, sample: dotMismatch.slice(0, 3) });

// PC 도넛 확대 — 표본 1건에서 반지름 확인
{
  const id = byLabels[0].id;
  await p2.goto(`${BASE}/guru/${id}`, { waitUntil: 'domcontentloaded' });
  await settle(p2, 1200);
  const d = await p2.evaluate(readDetail);
  (d.outerR > BASELINE_OUTER_R ? pass : fail)('S1/pc', `PC 도넛 확대 outerR ${Math.round(d.outerR)} > ${BASELINE_OUTER_R}`, { innerR: Math.round(d.innerR), outerR: Math.round(d.outerR) });
  // 실측 경로 안정성 — 재렌더 후에도 라벨 집합 동일
  const before = d.labels.map(l => l.text).sort().join('|');
  await p2.reload({ waitUntil: 'domcontentloaded' });
  await settle(p2, 1200);
  const d2 = await p2.evaluate(readDetail);
  const after = d2.labels.map(l => l.text).sort().join('|');
  (before === after ? pass : fail)('S3/pc', `실측 캐시 후 라벨 집합 안정(재렌더 동일, ${d.labels.length}개)`, { before, after });
}

// ══ 모바일 회귀 — 1열 순차 + 블록 높이 ══════════════════════
const ctx = await b.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
await seed(page);
for (const id of shotIds) {
  await page.goto(`${BASE}/guru/${id}`, { waitUntil: 'domcontentloaded' });
  await settle(page, 1200);
  const d = await page.evaluate(readDetail);
  await page.screenshot({ path: `${OUT}/m-${id}.png` });
  if (!d.present) { pass(`S1/m-${id}`, '도넛 데이터 없음 → 스킵(기존 폴백)', {}); continue; }
  (d.firstRow && d.donut.b <= d.firstRow.t + 1 ? pass : fail)(`S1/m-${id}`, '모바일 1열 순차 — 도넛이 목록 위',
    { donutB: Math.round(d.donut.b), rowT: Math.round(d.firstRow?.t) });
  (d.donut.h <= MOBILE_DONUT_MAX_H ? pass : fail)(`S1/m-${id}`, `모바일 도넛 블록 높이 ${Math.round(d.donut.h)} ≤ ${MOBILE_DONUT_MAX_H}`, { h: Math.round(d.donut.h) });
  (d.rowOverflow === 0 ? pass : fail)(`S1/m-${id}`, '모바일 목록 행 잘림 0', { rowOverflow: d.rowOverflow });
}

await b.close();

const failed = results.filter(x => !x.ok);
console.log(`\n매니저 ${managers.length}명 순회 · 라벨 총 ${totalLabels}개 · 스크린샷 표본 ${[...SHOT_TAGS].join(', ')}`);
for (const x of results) console.log(`${x.ok ? 'PASS' : 'FAIL'}  [${x.tag}] ${x.msg}  ${JSON.stringify(x.data)}`);
console.log(`\n=== ${failed.length === 0 ? 'ALL PASS' : `${failed.length} FAIL`} (${results.length}건) ===`);
process.exit(failed.length === 0 ? 0 : 1);
