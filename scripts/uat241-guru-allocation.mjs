// task#241 라이브 UAT — 구루 자산 배분 탭(투자금).
// ① 행 가로 넘침 0 ② 투자금 값 우측 정렬 ③ 좌 메타줄 ↔ 값 상자 교차 0
// ④ 화면 상위 3행 == API rows[0..2] ⑤ 필 4개 전환이 실제로 행 수를 바꾼다
//
// ②의 판정축 주의: PC의 .guru-stat-grid는 auto-fill 다열이라 "값 right가 행마다 동일"을
// 문자 그대로 재면 정상 구현도 FAIL이다. 정렬은 **열 안에서** 성립하므로 row.left로 열을
// 묶어 그룹별로 잰다(회고 #228 "기준 상자를 추정하지 말 것"의 축 버전).
// "이 단언이 통과하면서도 깨질 수 있는 방식": 행이 렌더되지만 값이 0×0이라 안 보이는 경우
// → 값 상자의 width/height > 0 도 함께 잰다(회고 #235: 판정축이 모자라면 ALL PASS가 무의미).
import { chromium, devices } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat241';
fs.mkdirSync(OUT, { recursive: true });

const r = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const { access_token, refresh_token } = await r.json();
const api = await (await fetch(`${BASE}/api/guru/stats/allocation`, {
  headers: { Authorization: `Bearer ${access_token}` },
})).json();

const results = [];
const P = (ok, tag, msg) => results.push({ ok, tag, msg });

// ── 브라우저 안 측정기 ──────────────────────────────────────────
const measure = () => {
  const bx = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, w: r.width, h: r.height }; };
  const grid = document.querySelector('.guru-stat-grid');
  const rows = [...document.querySelectorAll('.guru-stat-row')];
  return {
    grid: grid ? bx(grid) : null,
    caption: document.querySelector('.guru-alloc-caption')?.textContent.trim() ?? null,
    pills: [...document.querySelectorAll('.guru-alloc-scopes button')].map(b => ({
      label: b.textContent.trim(), active: b.classList.contains('is-active'),
    })),
    rows: rows.map(el => ({
      box: bx(el),
      ticker: el.querySelector('.guru-stat-ticker')?.textContent.trim() ?? null,
      meta: el.querySelector('.guru-stat-name') ? bx(el.querySelector('.guru-stat-name')) : null,
      metaText: el.querySelector('.guru-stat-name')?.textContent.trim() ?? null,
      // ellipsis는 박스를 넘지 않으므로 overflow 검사에 안 잡힌다 — scrollWidth로 따로 본다.
      numClipped: (() => {
        const n = el.querySelector('.guru-alloc-num');
        return n ? n.scrollWidth > n.clientWidth + 1 : true;
      })(),
      value: el.querySelector('.guru-stat-value') ? bx(el.querySelector('.guru-stat-value')) : null,
      valueText: el.querySelector('.guru-stat-value')?.textContent.trim() ?? null,
      side: el.querySelector('.guru-stat-side') ? bx(el.querySelector('.guru-stat-side')) : null,
    })),
  };
};

const b = await chromium.launch({ headless: true });
const settle = async (page) => {
  await page.waitForFunction(() => document.querySelectorAll('.guru-stat-row').length > 0, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(500);
};

const openTab = async (page) => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([a, rr]) => {
    localStorage.setItem('access_token', a); localStorage.setItem('refresh_token', rr); localStorage.setItem('theme', 'light');
  }, [access_token, refresh_token]);
  await page.goto(`${BASE}/guru`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: '투자금', exact: true }).click();
  await settle(page);
};

for (const view of ['pc', 'mobile']) {
  const ctx = view === 'pc'
    ? await b.newContext({ viewport: { width: 1440, height: 1000 } })
    : await b.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  await openTab(page);
  const m = await page.evaluate(measure);

  // ⑤-a 기본 진입은 탑20
  P(m.rows.length === 20, `${view}/default-20`, `기본 진입 20행 (실제 ${m.rows.length})`);
  P(m.pills.map(p => p.label).join(',') === '탑10,탑20,탑50,전체', `${view}/pills`, `필 4개 (실제 ${m.pills.map(p => p.label).join(',')})`);
  P(m.pills.find(p => p.active)?.label === '탑20', `${view}/pill-default`, `기본 활성 탑20 (실제 ${m.pills.find(p => p.active)?.label})`);
  P(!!m.caption && /명/.test(m.caption), `${view}/caption`, `캡션: ${m.caption}`);

  // ④ 화면 상위 3행 == API rows[0..2]
  const domTop3 = m.rows.slice(0, 3).map(r => r.ticker).join(',');
  const apiTop3 = api.rows.slice(0, 3).map(r => r.ticker).join(',');
  P(domTop3 === apiTop3, `${view}/top3`, `상위3 DOM=${domTop3} API=${apiTop3}`);

  // ① 행 가로 넘침 0 ③ 메타줄 ↔ 값 교차 0 + 값 상자가 실제로 보이는지
  let overflow = 0, cross = 0, invisible = 0;
  for (const row of m.rows) {
    if (row.box.r > m.grid.r + 1) overflow++;
    if (row.meta && row.side && row.meta.r > row.side.l + 1) cross++;
    if (!row.value || row.value.w <= 0 || row.value.h <= 0) invisible++;
  }
  const clipped = m.rows.filter(r => r.numClipped).length;
  P(clipped === 0, `${view}/num-not-clipped`, `비율·명수 잘린 행 ${clipped}/${m.rows.length}`);
  P(overflow === 0, `${view}/overflow`, `행 가로 넘침 ${overflow}/${m.rows.length}`);
  P(cross === 0, `${view}/cross`, `메타줄↔값 교차 ${cross}/${m.rows.length}`);
  P(invisible === 0, `${view}/value-visible`, `값 상자 0×0 ${invisible}/${m.rows.length}`);

  // ② 투자금 값 우측 정렬 — 열 그룹(row.left) 안에서 right가 동일해야 한다
  const cols = new Map();
  for (const row of m.rows) {
    const key = Math.round(row.box.l);
    if (!cols.has(key)) cols.set(key, []);
    cols.get(key).push(row.value.r);
  }
  let misaligned = 0;
  for (const [, rights] of cols) {
    const span = Math.max(...rights) - Math.min(...rights);
    if (span > 1) misaligned++;
  }
  P(misaligned === 0, `${view}/value-align`, `열 ${cols.size}개, 정렬 어긋난 열 ${misaligned} (열 안 right 편차 ≤1px)`);

  // ⑤-b 필 전환이 행 수를 바꾼다
  for (const [label, expect] of [['탑10', 10], ['탑50', 50], ['전체', api.rows.length], ['탑20', 20]]) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.waitForTimeout(label === '전체' ? 2500 : 400);
    const n = await page.evaluate(() => document.querySelectorAll('.guru-stat-row').length);
    P(n === expect, `${view}/scope-${label}`, `${label} → ${n}행 (기대 ${expect})`);
  }

  // 육안 확인용 스크린샷 — 프로브 PASS 후에도 이게 유일한 시각 포착 수단이다(회고 #235)
  await page.screenshot({ path: `${OUT}/${view}-allocation.png`, fullPage: false });

  await ctx.close();
}
await b.close();

const failed = results.filter(r => !r.ok);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} [${r.tag}] ${r.msg}`);
console.log(`\n${failed.length ? `❌ FAIL ${failed.length}` : '✅ ALL PASS'} / 단언 ${results.length}건`);
console.log(`스크린샷: ${OUT}/{pc,mobile}-allocation.png`);
process.exit(failed.length ? 1 : 0);
