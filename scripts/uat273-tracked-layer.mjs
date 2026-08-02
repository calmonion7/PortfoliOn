// task#273 라이브 UAT — 랭킹의 추적 상태(useTrackedStocks 흡수) 판정축 4개 + B27 전환 축.
//
// 판정축 (plan.md S6):
//  (a) 랭킹 KR·US 각각에서 보유 종목 행에 클릭 가능한 토글이 없다.
//  (b) 「보유중」 표식 텍스트의 렌더 줄 수 == 1 (Range.getClientRects — 접힘은 bbox로 안 잡힌다, 가토 ⑨).
//  (c) 카드 헤더 scrollWidth <= clientWidth (ellipsis 잘림은 넘침에 안 잡힌다, 가토 ⑦).
//  (d) 커버리지 카운터 출력.
//  + 추가 축(B27): KR 로드 완료 → '해외' 전환 → 6자리 국내 티커 잔존 0건(S4 검증).
//
// 신뢰성 규칙 준수:
//  - 단언은 무조건화. 보유 행 미검출은 sentinel(HOLDING_ROW_MISSING/NO_HOLDINGS_IN_ACCOUNT)로 FAIL
//    시켜 총계를 구조적으로 고정한다(가토 ⑧ⓑ). 1회 재시도 후 확정 + 검색 대상 id를 로그에 남긴다.
//  - 대상 유효성(마켓 토글 버튼 존재)을 판정축과 분리해 먼저 단언한다(⑧ⓘ).
//  - 판정 범위는 main.page-wrap 본문으로 한정(⑧ⓒ) — 전역 내비 混입 방지.
//  - 커버리지는 재실행 간 비교 가능하도록 계열별로 출력한다(⑧ⓐ).
//
// API ground-truth: GET /api/stocks 응답은 배열 [{ticker,name,type,market,...}]이다
// (routers/stocks.py:get_stocks 직독 확인, 추정 아님). type==='holding'인 항목을 market별로
// 모아 화면의 보유 종목 행을 찾는 검색 대상으로 쓴다(하드코딩 금지 — 계정 보유 종목은 바뀐다).
import { chromium, devices } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat273';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const P = (ok, tag, msg) => results.push({ ok, tag, msg });
const cov = {};
const bump = (k, n = 1) => { cov[k] = (cov[k] || 0) + n; };

// 무조건 단언 — 미검출은 sentinel로 FAIL시킨다(⑧ⓑ: 조건부 단언 금지).
const eq = (tag, got, want, note = '') =>
  P(JSON.stringify(got) === JSON.stringify(want), tag,
    `${JSON.stringify(got) === JSON.stringify(want) ? 'PASS' : 'FAIL'} — got=${JSON.stringify(got)} want=${JSON.stringify(want)}${note ? ' · ' + note : ''}`);

// ── 로그인 + API ground-truth ────────────────────────────────────────────
const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const { access_token, refresh_token } = await loginRes.json();

const stocksRes = await fetch(`${BASE}/api/stocks`, { headers: { Authorization: `Bearer ${access_token}` } });
const stocks = await stocksRes.json();
if (!Array.isArray(stocks)) {
  console.error('대상 유효성 실패 — GET /api/stocks 응답이 배열이 아니다. 추정 폴백 없이 종료.',
    JSON.stringify(stocks).slice(0, 300));
  process.exit(1);
}
const HOLDINGS = { KR: new Set(), US: new Set() };
for (const s of stocks) {
  if (s && s.type === 'holding' && (s.market === 'KR' || s.market === 'US')) HOLDINGS[s.market].add(s.ticker);
}
console.log(`보유 종목 ground-truth — KR[${[...HOLDINGS.KR].join(',') || '없음'}] · US[${[...HOLDINGS.US].join(',') || '없음'}]`);

// ── 브라우저 안 측정기 ────────────────────────────────────────────────────
// 판정 범위는 main.page-wrap 본문으로 한정(⑧ⓒ). 카드 DOM 구조(Ranking.jsx RankCard)는:
//   .card > [header div] > [rankSpan, infoDiv(flex:1), starSlot]
//   infoDiv > [nameRow div, tickerSpan]  ← tickerSpan은 항상 infoDiv의 마지막 자식(ETF 배지
//   유무와 무관 — 배지는 nameRow의 자식이라 infoDiv 자식 수엔 영향 없음, 실측 확인).
//   starSlot은 renderStar()의 반환값 — 보유중이면 <span>, 그 외엔 <button>.
const getCards = (page) => page.evaluate(() => {
  const main = document.querySelector('main.page-wrap') || document.querySelector('main') || document.body;
  return [...main.querySelectorAll('.card')].map(card => {
    const header = card.children[0];
    if (!header) return null;
    const infoDiv = header.children[1];
    const tickerSpan = infoDiv ? infoDiv.lastElementChild : null;
    const ticker = tickerSpan ? tickerSpan.textContent.trim() : '';
    const starSlot = header.lastElementChild;
    const isButton = !!starSlot && starSlot.tagName === 'BUTTON';
    const starText = starSlot ? starSlot.textContent.trim() : '';
    // 주의: cursor는 상속 속성이라 `.card--hover{cursor:pointer}`가 모든 자손에 스민다
    // (plain span도 getComputedStyle().cursor==='pointer' — 실측 확인) → "클릭 가능"의
    // 판정축으로 쓸 수 없다. tagName(버튼 아님) + 라벨 텍스트 동일성만으로 축 (a)를 잡는다.
    // 「보유중」 텍스트 노드의 실제 렌더 줄 수 — flex 압축 접힘은 bbox로 안 잡힌다(가토 ⑨).
    let lines = null;
    if (starSlot && !isButton) {
      const t = [...starSlot.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
      if (t) {
        const rg = document.createRange();
        rg.selectNodeContents(t);
        lines = rg.getClientRects().length;
      }
    }
    return {
      ticker, isButton, starText, lines,
      header: { scrollWidth: header.scrollWidth, clientWidth: header.clientWidth },
    };
  }).filter(Boolean);
});

async function settle(page) {
  await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);
}

// 보유 종목 행을 무한스크롤 범위 안에서 찾는다 — 대상 부재를 무음 스킵하지 않는다(⑧ⓑ).
async function findHoldingRow(page, market, view) {
  const ids = [...HOLDINGS[market]];
  if (ids.length === 0) {
    console.log(`[${view}·${market}] ground-truth 보유 종목 0건 — 검색 대상 없음(계정 데이터 전제 미충족)`);
    return { row: null, cards: [], sentinel: 'NO_HOLDINGS_IN_ACCOUNT' };
  }
  let cards = await getCards(page);
  let row = cards.find(c => HOLDINGS[market].has(c.ticker));
  let iter = 0;
  const MAX_ITERS = 15;
  while (!row && iter < MAX_ITERS) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(700);
    cards = await getCards(page);
    row = cards.find(c => HOLDINGS[market].has(c.ticker));
    iter++;
  }
  if (!row) {
    // 1회 재시도(⑧ⓑ) — 대상 id를 로그에 명시.
    console.log(`[${view}·${market}] 보유 행 미검출(스크롤 ${iter}회, id=[${ids.join(',')}]) → 1회 재시도`);
    await page.waitForTimeout(2000);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);
    cards = await getCards(page);
    row = cards.find(c => HOLDINGS[market].has(c.ticker));
  }
  return { row, cards, sentinel: row ? null : 'HOLDING_ROW_MISSING' };
}

// KR→US 전환 완료 게이트 — '거래대금'류 공통 마커로는 전환 여부를 못 가른다(⑧ⓘ, task#271 재발
// 방지). 티커 형태(6자리=국내)로 잔존을 직접 잰다.
async function waitUsTransition(page, view) {
  let cards = [];
  for (let attempt = 0; attempt < 12; attempt++) {
    cards = await getCards(page);
    const residue = cards.filter(c => /^\d{6}$/.test(c.ticker));
    bump(`${view}/us-transition-poll`);
    if (cards.length > 0 && residue.length === 0) break;
    await page.waitForTimeout(1000);
  }
  return cards;
}

function headerFitCheck(cards, tag) {
  const offenders = [];
  for (const c of cards) {
    bump('header-fit');
    if (c.header.scrollWidth > c.header.clientWidth + 1) offenders.push(c.ticker);
  }
  P(offenders.length === 0, `${tag}/header-fit`,
    `헤더 오버플로 ${offenders.length}/${cards.length}건${offenders.length ? ' — ' + offenders.slice(0, 5).join(',') : ''}`);
}

function holdingAssertions(view, market, row, sentinel) {
  const id = row ? row.ticker : (sentinel || 'MISSING');
  console.log(`[${view}·${market}] 보유 행 검사 대상: ${id}`, row ? JSON.stringify(row) : '(미검출)');

  bump('holding-row', 2);
  const gotButton = row ? (row.isButton ? 'IS_BUTTON' : 'NOT_BUTTON') : sentinel;
  eq(`${view}/${market}/holding-no-toggle-button`, gotButton, 'NOT_BUTTON', `대상=${id}`);

  const gotLabel = row ? row.starText : sentinel;
  eq(`${view}/${market}/holding-label-text`, gotLabel, '보유중', `대상=${id}`);

  bump('line-visible', 1);
  const gotLines = row ? (row.lines === 1 ? 'ONE_LINE' : `LINES_${row.lines}`) : sentinel;
  eq(`${view}/${market}/holding-label-oneline`, gotLines, 'ONE_LINE', `대상=${id} lines=${row?.lines ?? '-'}`);
}

// ── 뷰포트별 실행 ─────────────────────────────────────────────────────────
async function run(view, ctxOpts) {
  const b = await chromium.launch({ headless: true });
  // SW가 /api/*를 가로챈다(하니스 함정 §7.2) — 방금 빌드한 번들을 확실히 받도록 차단.
  const ctx = await b.newContext({ ...ctxOpts, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([a, rr]) => {
    localStorage.setItem('access_token', a); localStorage.setItem('refresh_token', rr);
  }, [access_token, refresh_token]);

  await page.goto(`${BASE}/ranking`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('.card').length > 0, { timeout: 40000 }).catch(() => {});
  await settle(page);

  // 서빙 번들 — 옛 번들 위에서 재고 있지 않은지 기록(배포 확인용, 완료 근거 아님).
  const bundle = await page.evaluate(() =>
    [...document.querySelectorAll('script[src]')].map(s => s.src.split('/').pop()).find(x => x.startsWith('index-')) || 'NONE');
  console.log(`[${view}] 서빙 번들: ${bundle}`);

  // 대상 유효성(⑧ⓘ) — 마켓 토글 버튼 존재는 판정축(보유 행)과 독립이라 먼저·별도로 확인.
  bump('target-marker', 2);
  const marker = await page.evaluate(() => {
    const main = document.querySelector('main.page-wrap') || document.body;
    const labels = [...main.querySelectorAll('button')].map(b => b.textContent.trim());
    return { kr: labels.some(t => t.includes('국내')), us: labels.some(t => t.includes('해외')) };
  });
  eq(`${view}/target/kr-toggle`, marker.kr, true, 'KR 마켓 토글 버튼');
  eq(`${view}/target/us-toggle`, marker.us, true, 'US 마켓 토글 버튼');

  // ── KR(기본 마켓) ──
  const krFound = await findHoldingRow(page, 'KR', view);
  holdingAssertions(view, 'KR', krFound.row, krFound.sentinel);
  headerFitCheck(krFound.cards, `${view}/KR`);

  // ── '해외' 전환 (B27) ──
  await page.getByRole('button', { name: /해외/ }).first().click({ timeout: 20000 });
  const usCards = await waitUsTransition(page, view);
  const residue = usCards.filter(c => /^\d{6}$/.test(c.ticker));
  bump('kr-residue-check');
  eq(`${view}/us-switch/kr-ticker-residue`, residue.length, 0,
    `잔존 국내티커 ${residue.length}건${residue.length ? ' — ' + residue.slice(0, 5).map(c => c.ticker).join(',') : ''} · 전체 ${usCards.length}행`);

  // ── US ──
  const usFound = await findHoldingRow(page, 'US', view);
  holdingAssertions(view, 'US', usFound.row, usFound.sentinel);
  headerFitCheck(usFound.cards, `${view}/US`);

  bump('pageerror');
  eq(`${view}/pageerror-zero`, errs.length, 0, errs.slice(0, 3).join(' | '));

  // 육안 확인용 캡처 — 대상이 프레임 밖이면 무의미하므로 scrollIntoView 먼저(⑧ⓓ).
  const targetTicker = usFound.row?.ticker;
  if (targetTicker) {
    await page.evaluate((tk) => {
      const main = document.querySelector('main.page-wrap') || document.body;
      for (const card of main.querySelectorAll('.card')) {
        const header = card.children[0];
        const infoDiv = header?.children[1];
        const tickerSpan = infoDiv?.lastElementChild;
        if (tickerSpan && tickerSpan.textContent.trim() === tk) { card.scrollIntoView({ block: 'center' }); return; }
      }
    }, targetTicker);
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: `${OUT}/${view}-ranking.png`, fullPage: false });

  await ctx.close();
  await b.close();
}

await run('pc', { viewport: { width: 1440, height: 900 } });
await run('mobile', { ...devices['iPhone 13'] });

// ── 보고 ──────────────────────────────────────────────────────────────────
console.log('\n═══ 단언 ═══');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} [${r.tag}] ${r.msg}`);

console.log('\n═══ 커버리지(계열별 검사 수 — 재실행 간 총계를 비교할 것) ═══');
const covTotal = Object.values(cov).reduce((a, v) => a + v, 0);
console.log(Object.entries(cov).map(([k, v]) => `${k}:${v}`).join(' · '));
console.log(`커버리지 합계 ${covTotal} · 단언 ${results.length}건`);

const failed = results.filter(r => !r.ok);
console.log(`\n${failed.length ? `❌ FAIL ${failed.length}/${results.length}` : `✅ ALL PASS ${results.length}/${results.length}`}`);
console.log(`스크린샷: ${OUT}/{pc,mobile}-ranking.png`);

fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ holdings: { KR: [...HOLDINGS.KR], US: [...HOLDINGS.US] }, cov, results }, null, 2));
process.exit(failed.length ? 1 : 0);
