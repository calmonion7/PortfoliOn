// task#271 — 표시 포매터 정본화 라이브 게이트 (B13·B14 + 랭킹 US 가격).
//
// 왜 라이브인가: B13이 사는 `tickFormatter` 출력은 vitest로 원리적으로 못 본다.
// recharts는 jsdom에서 ResponsiveContainer가 0크기라 SVG를 아예 만들지 않는다(CONCERNS §9.3).
// 실브라우저는 SVG를 실제로 그리므로 틱 텍스트를 단언할 수 있다 — 이게 "정본이 화면에
// 닿았는지"의 유일한 자동 게이트다.
//
// 판정축 주의 (회고 누적):
// - ⑧ⓐ 실패만 기록하는 프로브의 ALL PASS는 아무것도 안 본 것과 구별되지 않는다
//   → 계열별 커버리지 카운터를 출력한다.
// - ⑧ⓑ `if (값 있으면) assert`는 무음 스킵 장치다 → 단언을 **무조건화**하고 미검출은
//   sentinel 기대값으로 FAIL시켜 총계를 구조적으로 고정한다(+1회 재시도).
// - ⑧ⓘ 판정 축이 대상과 독립이면 틀린 대상 위에서도 통과한다 → 각 화면의 **고유 마커**를
//   함께 단언한다. Y축 틱·합계·가격은 페이지 콘텐츠와 독립이라 404에서도 "통과"할 수 있다.
// - ⑧ⓕ OR로 묶은 단언은 어느 항으로 통과했는지 항별 실측치를 출력한다.
// - #212 ③ 커스텀 label은 `.recharts-pie-labels` 밖에 있고 빈 placeholder가 남는다
//   → `.recharts-surface text` + 내용 있는 것만 필터가 안전한 관용구.
//
// 대상 유효성은 착수 전 라이브 API·UI로 확인했다(추정 아님):
//   000660 investor-trend 252행 · 누적 최소 -58,332,227주(음수축 생김) · 억 단위 도달
//     ※ 리포트 목록은 보유(5)/관심(21) 탭 구조이고 국내는 보유 2·관심 2뿐이다.
//       005930은 *관심* 탭에 있어 기본 진입(보유)에서 안 보인다 → 보유·국내의 000660을 쓴다.
//   guru allocation total_value = 1,077,006,104,000 (≥1e12 → T 티어 대상)
//   rankings US에 SNDK $1,214.83 (4자리 → 천단위 쉼표 대상)
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const BASE = 'https://portfolion.taebro.com';
const SHOTS = 'screenshots-uat271';
const KR_TICKER = '000660';

const results = [];
const P = (ok, tag, msg) => results.push({ ok, tag, msg });
const cov = {};
const bump = (k, n = 1) => { cov[k] = (cov[k] || 0) + n; };

// 무조건 단언 — 미검출은 sentinel로 FAIL시킨다(⑧ⓑ: 조건부 단언 금지).
const eq = (tag, got, want, note = '') =>
  P(got === want, tag, `${got === want ? 'PASS' : 'FAIL'} — got=${JSON.stringify(got)} want=${JSON.stringify(want)}${note ? ' · ' + note : ''}`);

mkdirSync(SHOTS, { recursive: true });

const b = await chromium.launch();
// SW가 /api/*를 가로채고 PWA precache가 옛 번들을 서빙할 수 있다 — 방금 빌드한 번들을
// 확실히 받기 위해 차단한다(라이브 UAT 하니스 ①).
const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();

// ── 로그인 ────────────────────────────────────────────────────────────────
await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await p.fill('input[type="email"]', 'test@portfolion.com');
await p.fill('input[type="password"]', 'test1234');
await p.click('button[type="submit"]');
await p.waitForURL(u => !u.pathname.includes('/login'), { timeout: 30000 });

// 서빙 번들 해시 — 옛 번들 위에서 재고 있지 않은지 기록(⑧ⓘ 대상 유효성의 배포판).
const bundle = await p.evaluate(() =>
  [...document.querySelectorAll('script[src]')].map(s => s.src.split('/').pop()).filter(x => x.startsWith('index-'))[0] || 'NONE');
console.log(`서빙 번들: ${bundle}`);

// 축 틱 추출 — **기하 기반**. recharts 3에서 틱 `text`는 `.recharts-yAxis` 하위가 아니라
// `.recharts-cartesian-axis-tick-label` 레이어에 있어(실측), 클래스 계층으로 파면 0건이 나온다.
// 세로축 틱은 같은 x를 공유하고 X축 틱은 x가 흩어진다 → x 군집으로 좌/우축을 가른다.
const readAxes = (page, caption) => page.evaluate((cap) => {
  // 캡션에서 위로 올라가 차트를 *포함하는* 첫 조상 → 그 안의 첫 surface = 대상 차트
  const capEl = [...document.querySelectorAll('div')]
    .find(d => d.children.length === 0 && (d.textContent || '').includes(cap));
  if (!capEl) return { found: false, left: [], right: [], xaxis: [] };
  let n = capEl;
  while (n && !n.querySelector('.recharts-surface')) n = n.parentElement;
  const sv = n && n.querySelector('.recharts-surface');
  if (!sv) return { found: false, left: [], right: [], xaxis: [] };

  const ticks = [...sv.querySelectorAll('text')]
    .filter(t => (t.getAttribute('class') || '').includes('cartesian-axis-tick'))
    .map(t => ({ txt: (t.textContent || '').trim(), x: Math.round(+t.getAttribute('x') || 0) }))
    .filter(t => t.txt);
  const byX = {};
  for (const t of ticks) (byX[t.x] = byX[t.x] || []).push(t.txt);
  // 같은 x를 3개 이상 공유 = 세로축
  const cols = Object.entries(byX).filter(([, v]) => v.length >= 3)
    .map(([x, v]) => ({ x: +x, v })).sort((a, b) => a.x - b.x);
  const used = new Set(cols.map(c => c.x));
  return {
    found: true,
    left: cols.length ? cols[0].v : [],
    right: cols.length > 1 ? cols[cols.length - 1].v : [],
    xaxis: ticks.filter(t => !used.has(t.x)).map(t => t.txt),
  };
}, caption);

// ══ 화면 1 — B13: 리포트 상세 > 지표 > 기술·수급 > 수급 추이 Y축 ═══════════
{
  await p.goto(`${BASE}/reports`, { waitUntil: 'domcontentloaded' });
  // PC(1440px)에서 `.reports-sidebar`는 display:none이고 본문은 `.stock-card` 그리드다
  // — `.report-item`은 그 숨은 사이드바 안에 있어 클릭 불가(실측으로 확정, 프로브 결함이었다).
  await p.locator('.stock-card').first().waitFor({ timeout: 40000 });
  await p.getByRole('button', { name: /국내/ }).first().click({ timeout: 20000 });   // 기본은 보유 탭
  await p.waitForTimeout(2000);
  await p.locator('.stock-card', { hasText: KR_TICKER }).first().click({ timeout: 30000 });
  await p.getByRole('button', { name: '📈 지표' }).click({ timeout: 20000 });
  await p.getByRole('button', { name: '기술·수급' }).click({ timeout: 20000 });

  // 대상 유효성 — nav/축은 콘텐츠와 독립이라 엉뚱한 페이지에서도 "통과"한다(⑧ⓘ).
  const marker = await p.locator('text=수급 추이').first().isVisible().catch(() => false);
  eq('B13/대상', marker, true, `리포트 상세(${KR_TICKER}) 수급 추이 섹션 가시`);
  bump('target-marker');

  let ax = { found: false, left: [], right: [], xaxis: [] };
  for (let attempt = 0; attempt < 5; attempt++) {
    ax = await readAxes(p, '누적 순매수(수량)');
    if (ax.left.length) break;
    await p.waitForTimeout(3000);
  }
  const left = ax.left, right = ax.right;
  console.log(`  B13 좌축 틱(${left.length}): ${left.join(' · ')}`);
  console.log(`  B13 우축 틱(${right.length}): ${right.join(' · ')}`);
  console.log(`  B13 X축 틱(${ax.xaxis.length}): ${ax.xaxis.slice(0, 6).join(' · ')}`);
  bump('yaxis-tick', left.length);
  bump('yaxis-tick-right', right.length);

  // 차트를 못 찾은 것과 틱이 0건인 것을 구분해 각각 FAIL 고정(⑧ⓑ)
  eq('B13/차트발견', ax.found ? 'CHART_FOUND' : 'CHART_MISSING', 'CHART_FOUND', '캡션 조상에서 surface 탐색');

  // 틱이 하나도 없으면 "아무것도 안 본 것" — sentinel로 FAIL 고정(⑧ⓑ)
  eq('B13/틱존재', left.length > 0 ? 'HAS_TICKS' : 'TICKS_MISSING', 'HAS_TICKS', `좌축 ${left.length}개`);

  // ① '조' 0건 — 옛 krFmt(억원 입력)에 주식수를 넘겨 "541.4조"가 뜨던 결함
  const jo = left.filter(t => t.includes('조'));
  eq('B13/조없음', jo.length, 0, `조 표기 ${jo.length}건${jo.length ? ' → ' + jo.join(',') : ''}`);

  // ② 주식수 규모(만/억)로 읽힘
  const scaled = left.filter(t => /[만억]/.test(t));
  eq('B13/주식수규모', scaled.length > 0 ? 'SHARE_SCALE' : 'NO_SHARE_SCALE', 'SHARE_SCALE',
     `만/억 틱 ${scaled.length}건: ${scaled.slice(0, 4).join(',')}`);

  // ③ 순매도 구간 음수 부호 생존 (Math.abs를 쓰면 방향이 뒤집힌다)
  const neg = left.filter(t => t.trim().startsWith('-'));
  eq('B13/음수부호', neg.length > 0 ? 'SIGN_KEPT' : 'SIGN_LOST', 'SIGN_KEPT',
     `음수 틱 ${neg.length}건: ${neg.slice(0, 4).join(',')}`);

  // 프레임 밖이면 육안 확인이 무의미(⑧ⓓ)
  await p.locator('text=누적 순매수(수량)').first().scrollIntoViewIfNeeded().catch(() => {});
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${SHOTS}/1-b13-investor-trend.png`, fullPage: false });
}

// ══ 화면 2 — B14: 구루 투자금 탭 총 투자금 ═══════════════════════════════
{
  await p.goto(`${BASE}/guru`, { waitUntil: 'domcontentloaded' });
  await p.getByRole('button', { name: '투자금' }).first().click({ timeout: 30000 });
  await p.locator('.guru-stat-row').first().waitFor({ timeout: 40000 }).catch(() => {});

  const marker = await p.locator('text=합계').first().isVisible().catch(() => false);
  eq('B14/대상', marker, true, '구루 투자금 탭 합계 캡션 가시');
  bump('target-marker');

  let total = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    total = await p.locator('text=/합계\\s*\\$/').first().textContent().catch(() => '') || '';
    if (total) break;
    await p.waitForTimeout(2500);
  }
  bump('guru-total', total ? 1 : 0);
  console.log(`  B14 합계 텍스트: ${JSON.stringify(total)}`);

  eq('B14/합계존재', total ? 'HAS_TOTAL' : 'TOTAL_MISSING', 'HAS_TOTAL', JSON.stringify(total));
  // ① T 티어로 표기 ② 옛 B 표기 0건 — 항별 실측치를 함께 싣는다(⑧ⓕ)
  const tMatch = total.match(/\$[\d.]+T/);
  eq('B14/T티어', tMatch ? 'T_TIER' : 'NO_T_TIER', 'T_TIER', `매치=${tMatch ? tMatch[0] : '없음'}`);
  eq('B14/옛B표기', /\$[\d,]{4,}\.\dB/.test(total) ? 'OLD_B' : 'NO_OLD_B', 'NO_OLD_B',
     `$1,077.0B류 ${/\$[\d,]{4,}\.\dB/.test(total) ? '잔존' : '없음'}`);

  await p.locator('text=/합계\\s*\\$/').first().scrollIntoViewIfNeeded().catch(() => {});
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${SHOTS}/2-b14-guru-total.png`, fullPage: false });
}

// ══ 화면 3 — 랭킹 US 가격 천단위 쉼표 ════════════════════════════════════
{
  await p.goto(`${BASE}/ranking`, { waitUntil: 'domcontentloaded' });
  // ⚠️ 초기 KR fetch가 끝나기 전에 해외를 누르면 market만 US로 바뀌고 뒤늦게 도착한 KR 응답이
  // items를 덮어써, **국내 종목이 $ 포맷으로 렌더된 중간 상태**가 남는다(실측 확인한 레이스).
  await p.locator('.card').first().waitFor({ timeout: 40000 });
  await p.waitForTimeout(2500);
  await p.getByRole('button', { name: /해외/ }).first().click({ timeout: 30000 });
  await p.waitForTimeout(3000);

  // ⚠️ '거래대금|등락률'은 KR/US 공통이라 **전환 완료를 못 거른다** — 실제로 국내 종목이
  // US 포맷($)으로 렌더된 중간 상태를 재서 `SK하이닉스=$1,718,000.00`으로 통과했다(⑧ⓘ).
  // 티커 형태(6자리 숫자=국내)로 전환 완료를 게이트한다.
  let usReady = false, tickers = [];
  for (let attempt = 0; attempt < 12; attempt++) {
    tickers = await p.evaluate(() => [...document.querySelectorAll('.card')]
      .map(c => { const m = (c.innerText || '').match(/\b(\d{6}|[A-Z][A-Z.\-]{0,5})\b/); return m ? m[1] : ''; })
      .filter(Boolean));
    usReady = tickers.length > 0 && tickers.every(t => !/^\d{6}$/.test(t));
    if (usReady) break;
    await p.waitForTimeout(2000);
  }
  console.log(`  랭킹 티커 표본: ${tickers.slice(0, 6).join(' ')}`);
  eq('RANK/US전환', usReady ? 'US_ROWS' : 'KR_ROWS_STILL', 'US_ROWS', `티커 ${tickers.length}건 · 6자리 잔존 ${tickers.filter(t => /^\d{6}$/.test(t)).length}`);
  bump('target-marker');

  // ⚠️ body 전체를 긁으면 거래대금·시총까지 섞여 **주가가 아닌 값으로 통과**한다(⑧ⓘ).
  // 랭킹 카드의 가격 span만 집고, 어느 종목의 값인지 함께 싣는다.
  let pairs = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    pairs = await p.evaluate(() => [...document.querySelectorAll('.card')].map(c => {
      const name = (c.querySelector('span') || {}).textContent || '';
      const price = [...c.querySelectorAll('span')]
        .map(x => (x.textContent || '').trim())
        .find(t => /^\$[\d,]+\.\d{2}$/.test(t)) || '';
      return price ? { name: c.innerText.split('\n').slice(0, 2).join('/').slice(0, 22), price } : null;
    }).filter(Boolean));
    if (pairs.length) break;
    await p.waitForTimeout(2500);
  }
  const prices = pairs.map(x => x.price);
  bump('rank-price', prices.length);
  const commaed = pairs.filter(x => /\$\d{1,3},\d{3}/.test(x.price));
  console.log(`  랭킹 US 카드가격 ${prices.length}건 · 4자리+ ${commaed.length}건: ${commaed.slice(0, 5).map(x => x.name + '=' + x.price).join(' · ')}`);
  console.log(`  (표본 5) ${pairs.slice(0, 5).map(x => x.name + '=' + x.price).join(' · ')}`);

  eq('RANK/가격존재', prices.length > 0 ? 'HAS_PRICE' : 'PRICE_MISSING', 'HAS_PRICE', `${prices.length}건`);
  // 로컬 fmtPrice는 toFixed(2)라 쉼표가 없었다 → 정본(toLocaleString)이 닿으면 쉼표가 생긴다
  eq('RANK/천단위쉼표', commaed.length > 0 ? 'COMMA' : 'NO_COMMA', 'COMMA',
     `쉼표 가격 ${commaed.length}건: ${commaed.slice(0, 3).map(x => x.name + '=' + x.price).join(' , ')}`);

  await p.waitForTimeout(300);
  await p.screenshot({ path: `${SHOTS}/3-ranking-us-price.png`, fullPage: false });
}

await b.close();

// ── 리포트 ────────────────────────────────────────────────────────────────
console.log('\n═══ 커버리지 ═══');
console.log(Object.entries(cov).map(([k, v]) => `${k} ${v}`).join(' · '));
console.log('\n═══ 단언 ═══');
for (const r of results) console.log(`${r.ok ? '✅' : '❌'} [${r.tag}] ${r.msg}`);
const fail = results.filter(r => !r.ok);
console.log(`\n${fail.length ? `❌ ${fail.length} FAIL` : '✅ ALL PASS'} — 단언 ${results.length}건 · 스크린샷 3장 → ${SHOTS}/`);
process.exit(fail.length ? 1 : 0);
