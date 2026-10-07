// task#373 라이브 UAT — 재발행된 심층 리포트 10종목의 새 표시(애널 추정치·렌즈 3 비교 기간·경계 근접)가
// 박제값과 종목·렌즈별로 일치하는가. read-only(GET만), 쓰기 0.
// 기대값은 전부 API 응답에서 유도한다. 축마다 **표본 카운터**를 두고, 양성 표본 0이면 PASS가 아니라 「미검증」으로
// 보고한다(task#318 — 새 필드가 0건이면 축이 공허하게 통과한다). 음성(false·부재 → 표시 없음)도 쌍으로 단언한다.
// 「FAIL 0」만 보지 말고 도달 축(reached)과 단언 총계도 볼 것.
import { chromium } from 'playwright';

const BASE = 'https://portfolion.taebro.com';
const TICKERS = (process.env.TICKERS || 'CRCL,LHX,MRVL,LLY,GOOGL,SPCX,MU,005930,005380,000660').split(',');
const BASIS_LABEL = { forward: '향후 기간 vs 전년 동기', yoy_quarter: '최근 분기 vs 전년 동기' };

const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }) });
const { access_token, refresh_token } = await r.json();
const H = { Authorization: `Bearer ${access_token}` };

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) pass++; else fail++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };
const samples = { consensus_pos: 0, consensus_neg: 0, basis: 0, near_pos: 0, near_neg: 0 };

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
await ctx.addInitScript(([a, rr]) => {
  localStorage.setItem('access_token', a); localStorage.setItem('refresh_token', rr);
  localStorage.setItem('pwa-install-dismissed-at', String(Date.now()));
}, [access_token, refresh_token]);
const page = await ctx.newPage();

for (const t of TICKERS) {
  const latest = (await (await fetch(`${BASE}/api/analyst-reports/${t}`, { headers: H })).json()).reports?.[0];
  const rep = latest && await (await fetch(`${BASE}/api/analyst-reports/${t}/${latest.published_date}`, { headers: H })).json();
  if (!rep || rep.format !== 2) { ok(`${t} api-format-2`, false, `format=${rep?.format}`); continue; }
  await page.goto(`${BASE}/analyst-report/${t}/${rep.published_date}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-lens-cell]', { timeout: 20000 }).catch(() => {});
  const m = await page.evaluate(() => ({
    cells: document.querySelectorAll('[data-lens-cell]').length,
    consensus: [...document.querySelectorAll('[id^="lens-"]')].map(c => ({
      id: c.id.replace('lens-', ''),
      badge: [...c.firstElementChild.querySelectorAll('.badge')].some(e => e.textContent.trim() === '애널 추정치'),
    })),
    basis: document.querySelector('#lens-3 [data-lens-basis]')?.textContent || null,
    near: [...document.querySelectorAll('[data-lens-cell]')].map(c => ({ id: c.getAttribute('data-lens-cell'), near: !!c.querySelector('[data-near-boundary]') })),
  }));
  ok(`${t} reached`, m.cells === 9 && m.consensus.length === 9, `cells=${m.cells} details=${m.consensus.length}`);
  const lenses = rep.lenses || [];
  // ⓐ 애널 추정치 — 박제 consensus_based와 상세 헤더 배지가 렌즈별로 일치(양·음 모두)
  const cMismatch = lenses.filter(l => {
    const want = !!l.computed?.consensus_based, got = !!m.consensus.find(x => x.id === String(l.id))?.badge;
    if (want) samples.consensus_pos++; else samples.consensus_neg++;
    return want !== got;
  }).map(l => l.id);
  ok(`${t} consensus-badge`, cMismatch.length === 0, cMismatch.length ? `불일치 렌즈 ${cMismatch}` : '');
  // ⓑ 렌즈 3 비교 기간 — 박제 basis의 표기, 없으면(na) 미표기
  const l3 = lenses.find(l => l.id === 3);
  const wantBasis = BASIS_LABEL[l3?.computed?.basis] || null;
  if (wantBasis) samples.basis++;
  ok(`${t} basis-label`, wantBasis ? (m.basis || '').includes(wantBasis) : m.basis === null, `api=${l3?.computed?.basis ?? '없음'} 화면="${m.basis ?? ''}"`);
  // ⓒ 경계 근접 — 게이지 near_boundary와 그 행의 「경계 근접」 표시가 일치(na 렌즈는 게이지를 안 그린다)
  const nMismatch = lenses.filter(l => l.signal !== 'na').filter(l => {
    const want = (l.computed?.gauge ?? l.gauge)?.near_boundary === true, got = !!m.near.find(x => x.id === String(l.id))?.near;
    if (want) samples.near_pos++; else samples.near_neg++;
    return want !== got;
  }).map(l => l.id);
  ok(`${t} near-boundary`, nMismatch.length === 0, nMismatch.length ? `불일치 렌즈 ${nMismatch}` : '');
}
await b.close();

// 표본 0인 양성 축은 통과가 아니라 미검증이다 — 그 사실을 숨기지 않는다
for (const [k, n] of Object.entries(samples)) console.log(`표본 ${k}=${n}${n === 0 ? ' — 미검증(양성 표본 없음)' : ''}`);
console.log(`단언 총계 ${pass + fail} · PASS ${pass} · FAIL ${fail} (기대 총계 ${TICKERS.length * 4})`);
process.exit(fail ? 1 : 0);
