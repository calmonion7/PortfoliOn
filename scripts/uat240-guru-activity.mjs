// task#240 라이브 UAT — 구루 상세 분기 활동 줄 · 전량매도 · 분기 표기.
// 83명 전수로 ① 활동 줄 수 == API activity 행 수(정합) ② 행 내부 가로 넘침 0 ③ 이름블록 폭이
// 기준 실측에서 감소 0 ④ 모바일 행높이 상한 ⑤ 활동 줄이 실제로 보이는지(0×0·잘림 아님)를 본다.
//
// 판정은 리터럴이 아니라 불변식으로 쓴다 — task#239에서 "보유 분기 == 활동 분기"를 리터럴로
// 단언했다가 정상 데이터(aq)를 FAIL로 찍었다(회고 #228 교훈의 재발).
// "이 단언이 통과하면서도 깨질 수 있는 방식": 줄이 렌더되지만 부모 overflow에 잘려 안 보이는 경우
// → 활동 줄 자체의 width/height > 0 도 함께 잰다(회고 #235: 판정 축이 모자라면 ALL PASS가 무의미).
import { chromium, devices } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat240';
fs.mkdirSync(OUT, { recursive: true });

// task#235에서 실측한 이름블록 폭 기준 — 활동 줄은 전폭 2번째 줄이므로 이 값이 줄어선 안 된다
const NAME_W_MIN = { pc: 700, mobile: 150 };
const MOBILE_ROW_H_MAX = { plain: 70, withActivity: 95 };

const r = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const { access_token, refresh_token } = await r.json();
const H = { Authorization: `Bearer ${access_token}` };
const mdata = await (await fetch(`${BASE}/api/guru/managers`, { headers: H })).json();
const managers = mdata.managers || [];

const results = [];
const fail = (tag, msg) => results.push({ ok: false, tag, msg });
const pass = (tag, msg) => results.push({ ok: true, tag, msg });

// ── 브라우저 안 측정기 ──────────────────────────────────────────
const readRows = () => {
  const bx = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, w: r.width, h: r.height }; };
  const rows = [...document.querySelectorAll('[data-testid="holding-row"]')];
  return {
    rowCount: rows.length,
    periodNote: document.querySelector('[data-testid="period-note"]')?.textContent.trim() ?? null,
    caption: !!document.querySelector('[data-testid="activity-caption"]'),
    soldOut: document.querySelector('[data-testid="sold-out"]')
      ? [...document.querySelectorAll('[data-testid="sold-out-chip"]')].map(c => c.children[0]?.textContent.trim())
      : null,
    rows: rows.map(row => {
      const inner = row.firstElementChild;
      const nameBlock = inner?.children[2];
      const line = row.querySelector('[data-testid="activity-line"]');
      const rowB = bx(row);
      const cs = getComputedStyle(row);
      const contentR = rowB.r - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
      // 행 안 모든 요소가 content box 오른쪽을 넘지 않아야 한다
      const over = [...row.querySelectorAll('*')].filter(e => bx(e).w > 0 && bx(e).r > contentR + 0.5).length;
      return {
        ticker: inner?.children[2]?.children[0]?.textContent.trim(),
        h: rowB.h,
        nameW: nameBlock ? bx(nameBlock).w : null,
        over,
        line: line ? { ...bx(line), text: line.textContent.trim() } : null,
      };
    }),
  };
};

// 스크린샷은 목록을 프레임에 담아야 육안 확인이 성립한다 — 상단만 잡으면 활동 줄이 안 보인다.
const shotList = async (page, path, sel = '[data-testid="period-note"]') => {
  await page.evaluate((q) => {
    document.querySelector(q)?.scrollIntoView({ block: 'start' });
  }, sel);
  await page.waitForTimeout(400);
  await page.screenshot({ path, fullPage: false });
};

const b = await chromium.launch({ headless: true });
const seed = async (page) => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([a, rr]) => {
    localStorage.setItem('access_token', a); localStorage.setItem('refresh_token', rr); localStorage.setItem('theme', 'light');
  }, [access_token, refresh_token]);
};
const settle = async (page) => {
  await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
};

// 전수는 PC 한 뷰포트로 돌고(정합·넘침), 모바일은 대표 표본만(행높이·폭)
const ctxPC = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const pagePC = await ctxPC.newPage();
await seed(pagePC);

let totalActivityLines = 0, managersWithSoldOut = 0, managersNoActivity = 0, donutless = 0;
let maxRowH = 0;
// 검사 수를 세어 마지막에 명시한다 — 실패만 기록하면 "단언 1건 ALL PASS"처럼 커버리지가
// 실제보다 훨씬 얇아 보이고, 그건 프로브가 아무것도 안 봤을 때와 구별되지 않는다.
const donutlessIds = [];
const checks = { 'activity-count': 0, overflow: 0, 'name-width': 0, 'line-visible': 0, period: 0, caption: 0, 'sold-out': 0, 'mobile-row': 0 };

for (const m of managers) {
  const detail = await (await fetch(`${BASE}/api/guru/managers/${m.id}`, { headers: H })).json();
  const holdings = detail.holdings || detail.top10 || [];
  const shown = holdings.slice(0, 20);                       // 기본 20행만 렌더된다
  const apiActs = shown.filter(h => h.activity).length;
  const apiSold = (detail.sold_out || []).length;

  await pagePC.goto(`${BASE}/guru/${m.id}`, { waitUntil: 'domcontentloaded' });
  await settle(pagePC);
  const out = await pagePC.evaluate(readRows);

  // DOM 0행은 두 가지가 섞인다: 진짜 보유 0(MP)과 렌더가 아직 안 끝난 경우. 후자를 조용히
  // 스킵하면 커버리지가 소리 없이 줄어든다(실제로 재실행마다 활동 줄 수가 20개씩 흔들렸다).
  // 한 번 재시도한 뒤에도 API가 보유를 주는데 DOM이 비면 FAIL로 올린다.
  let rows = out;
  if (rows.rowCount === 0 && holdings.length > 0) {
    await pagePC.reload({ waitUntil: 'domcontentloaded' });
    await settle(pagePC);
    rows = await pagePC.evaluate(readRows);
  }
  if (rows.rowCount === 0) {
    if (holdings.length > 0) fail('render', `${m.id}: API 보유 ${holdings.length}행인데 DOM 0행(재시도 후에도)`);
    else { donutless++; donutlessIds.push(m.id); }
    continue;
  }
  Object.assign(out, rows);

  // ① 활동 줄 정합
  const domActs = out.rows.filter(r => r.line).length;
  checks['activity-count']++;
  if (domActs !== apiActs) fail('activity-count', `${m.id}: DOM ${domActs} != API ${apiActs}`);
  totalActivityLines += domActs;
  if (apiActs === 0) managersNoActivity++;

  // ② 가로 넘침 0
  const over = out.rows.reduce((s, r) => s + r.over, 0);
  checks.overflow += out.rows.length;
  if (over > 0) fail('overflow', `${m.id}: 가로 넘침 ${over}건`);

  // ③ 이름블록 폭 감소 0 (PC 기준)
  const minName = Math.min(...out.rows.map(r => r.nameW ?? Infinity));
  checks['name-width'] += out.rows.length;
  if (minName < NAME_W_MIN.pc) fail('name-width', `${m.id}: 이름블록 ${Math.round(minName)}px < ${NAME_W_MIN.pc}`);

  // ⑤ 활동 줄이 실제로 보이는가 — 렌더됐지만 0×0이거나 잘리면 PASS가 무의미하다
  for (const row of out.rows.filter(r => r.line)) {
    checks['line-visible']++;
    if (row.line.w <= 0 || row.line.h <= 0) fail('line-visible', `${m.id}/${row.ticker}: 활동 줄 ${row.line.w}×${row.line.h}`);
    if (!row.line.text) fail('line-visible', `${m.id}/${row.ticker}: 활동 줄 텍스트 없음`);
  }

  // 분기 표기 문자열이 API period와 일치
  checks.period++;
  if (detail.period) {
    if (!out.periodNote) fail('period', `${m.id}: period ${detail.period} 인데 표기 없음`);
    else if (!out.periodNote.startsWith(detail.period)) fail('period', `${m.id}: "${out.periodNote}" != ${detail.period}`);
  } else if (out.periodNote) fail('period', `${m.id}: period 없는데 표기 존재`);

  // 캡션은 활동이 있을 때만
  checks.caption++;
  if ((apiActs > 0) !== out.caption) fail('caption', `${m.id}: 활동 ${apiActs} / 캡션 ${out.caption}`);

  // 전량매도 섹션 — 있으면 전 종목 렌더, 없으면 섹션 부재
  checks['sold-out']++;
  if (apiSold > 0) {
    managersWithSoldOut++;
    if (!out.soldOut) fail('sold-out', `${m.id}: sold_out ${apiSold}건인데 섹션 없음`);
    else if (out.soldOut.length !== apiSold) fail('sold-out', `${m.id}: 칩 ${out.soldOut.length} != API ${apiSold}`);
  } else if (out.soldOut) fail('sold-out', `${m.id}: sold_out 0인데 섹션 존재`);

  maxRowH = Math.max(maxRowH, ...out.rows.map(r => r.h));
}
if (results.every(r => r.ok)) pass('pc-sweep', `PC 전수 ${managers.length - donutless}명 통과`);

// ── 모바일 표본: 행높이·이름블록 폭 ────────────────────────────
const ctxM = await b.newContext({ ...devices['iPhone 14 Pro'] });
const pageM = await ctxM.newPage();
await seed(pageM);
// 활동 많은 매니저 · 전량매도 많은 매니저 · 활동 0인 매니저 · 보유 0인 매니저
const SAMPLES = ['VAN', 'psc', 'aq', 'MP'];
for (const mid of SAMPLES) {
  await pageM.goto(`${BASE}/guru/${mid}`, { waitUntil: 'domcontentloaded' });
  await settle(pageM);
  const out = await pageM.evaluate(readRows);
  if (out.rowCount === 0) { console.log(`  [${mid}] 모바일 보유 0행 — 스킵(무음 스킵 금지 위해 로그)`); continue; }
  for (const row of out.rows) {
    checks['mobile-row']++;
    const cap = row.line ? MOBILE_ROW_H_MAX.withActivity : MOBILE_ROW_H_MAX.plain;
    if (row.h > cap) fail('mobile-row-h', `${mid}/${row.ticker}: ${Math.round(row.h)}px > ${cap}`);
    if ((row.nameW ?? 0) < NAME_W_MIN.mobile) fail('mobile-name-w', `${mid}/${row.ticker}: 이름블록 ${Math.round(row.nameW)}px < ${NAME_W_MIN.mobile}`);
    if (row.over > 0) fail('mobile-overflow', `${mid}/${row.ticker}: 넘침 ${row.over}건`);
  }
  console.log(`  [${mid}] 모바일 행 ${out.rowCount} · 활동줄 ${out.rows.filter(r => r.line).length} · `
    + `행높이 ${Math.round(Math.min(...out.rows.map(r => r.h)))}~${Math.round(Math.max(...out.rows.map(r => r.h)))} · `
    + `전량매도 ${out.soldOut?.length ?? 0} · ${out.periodNote ?? '분기표기 없음'}`);
  await shotList(pageM, `${OUT}/m-${mid}.png`);
}

// ── 스크린샷(육안 확인용) ───────────────────────────────────────
for (const mid of ['psc', 'VAN', 'aq']) {
  await pagePC.goto(`${BASE}/guru/${mid}`, { waitUntil: 'domcontentloaded' });
  await settle(pagePC);
  await shotList(pagePC, `${OUT}/pc-${mid}.png`);
}
// 전량매도 섹션은 목록 20행 아래라 위 캡처 프레임 밖이다 — 새 시각 요소이므로 따로 담는다
for (const mid of ['VAN', 'psc']) {
  await pagePC.goto(`${BASE}/guru/${mid}`, { waitUntil: 'domcontentloaded' });
  await settle(pagePC);
  await shotList(pagePC, `${OUT}/pc-${mid}-soldout.png`, '[data-testid="sold-out"]');
}

await b.close();

console.log(`\n활동 줄 총 ${totalActivityLines}개 · 전량매도 매니저 ${managersWithSoldOut}명 · `
  + `활동 0인 매니저 ${managersNoActivity}명 · 보유 0(미렌더) ${donutless}명 [${donutlessIds.join(',')}] · PC 최대 행높이 ${Math.round(maxRowH)}px`);
for (const [k, n] of Object.entries(checks)) if (n > 0) pass(k, `${n}건 검사`);
console.log('검사 내역: ' + Object.entries(checks).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(' · '));
const fails = results.filter(r => !r.ok);
for (const f of fails) console.log(`  ✗ ${f.tag}: ${f.msg}`);
console.log(`\n${fails.length ? 'FAIL' : 'ALL PASS'} — 단언 ${results.length}건, 실패 ${fails.length}건`);
process.exit(fails.length ? 1 : 0);
