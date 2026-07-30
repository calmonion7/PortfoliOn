// task#247 라이브 UAT — 구루 투자금 탭의 필이 「표시 줄 수」가 아니라 「합산 대상 구루
// 코호트」로 동작하는지 + 「데이터 기준」 설명란.
//
// ① 4스코프 API 값(ticker_count·total_value·Σratio) ② 화면 행 수 == 응답 ticker_count
// + 상위3 일치 ③ 필 4개 + 그룹 라벨 ④ 모바일 350px 필 행 넘침 0(실측)
// ⑤ 설명란 8항목 + 잘림 0(scrollWidth 축) + PC 본문 폭 ≤680px ⑥ 코호트 밖 검색 안내
// ⑦ 스크린샷(설명란은 요소 캡처) ⑧ 백엔드 [GuruStats] 신규 경고 0
//
// 판정축 주의 (회고 누적):
// - #241 D2: `ellipsis`/`line-clamp`는 박스를 넘지 않고 **박스 안에서 내용을 지우므로**
//   getBoundingClientRect 넘침 검사에 원리적으로 안 잡힌다 → 설명란 잘림은 별도 축
//   `scrollWidth > clientWidth`(+ scrollHeight)로 잰다.
// - #225·#228: 폭·열 수를 추정하지 말고 실측하고, **비교 대상 상자도** 실측한다
//   → 모바일 필 행은 부모 content box를 getBoundingClientRect로 재서 비교한다.
// - #238 ⓐ·ⓑ: 실패만 기록하는 프로브의 ALL PASS는 아무것도 안 본 것과 구별되지 않는다
//   → 계열별 커버리지 카운터를 출력하고 재실행 간 총계를 비교할 것.
// - #238 ⓒ: 판정 범위는 본문(main)으로 한정 — 전역 내비가 섞이면 정상 구현이 거짓 FAIL.
// - #235 ⓐ: 프로브 PASS 후에도 육안 스크린샷 1장이 유일한 포착 수단이었던 적이 2번 있다.
import { chromium, devices } from 'playwright';
import { execSync } from 'child_process';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat247';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const P = (ok, tag, msg) => results.push({ ok, tag, msg });
const cov = {};                                   // 계열별 검사 수 — 총계를 재실행 간 비교
const bump = (k, n = 1) => { cov[k] = (cov[k] || 0) + n; };

// ── 로그인 + API 4스코프 ──────────────────────────────────────────
const r = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const { access_token, refresh_token } = await r.json();

// 계획의 fg-ask 실측 기준값(HEAD 332cb91, 크롤 2026-07-29T11:40) — 크롤이 갱신되면
// 값이 이동하므로 근방 허용(티커 ±3%, 금액 ±3%)으로 잰다. 리터럴 동일성이 목적이 아니라
// "코호트가 실제로 달라지는가"가 목적이다.
const SCOPES = [
  { key: 10,    label: '10명', tickers: 709,   value: 765.9e9 },
  { key: 20,    label: '20명', tickers: 1024,  value: 896.3e9 },
  { key: 50,    label: '50명', tickers: 1475,  value: 1052.1e9 },
  { key: 'all', label: '전체', tickers: 1723,  value: 1077.0e9 },
];

const apiOf = async (key) => {
  const url = key === 'all'
    ? `${BASE}/api/guru/stats/allocation`
    : `${BASE}/api/guru/stats/allocation?top=${key}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${access_token}` } });
  return { status: res.status, body: res.status === 200 ? await res.json() : null };
};

const API = {};
for (const s of SCOPES) {
  const { status, body } = await apiOf(s.key);
  API[s.key] = body;
  bump('api', 4);
  P(status === 200, `api/${s.label}/200`, `HTTP ${status}`);
  if (!body) continue;
  const near = (a, b, pct) => Math.abs(a - b) / b <= pct;
  P(near(body.ticker_count, s.tickers, 0.03), `api/${s.label}/ticker_count`,
    `ticker_count=${body.ticker_count} (기준 ${s.tickers} ±3%)`);
  P(near(body.total_value, s.value, 0.03), `api/${s.label}/total_value`,
    `total_value=$${(body.total_value / 1e9).toFixed(1)}B (기준 $${(s.value / 1e9).toFixed(1)}B ±3%)`);
  const sum = body.rows.reduce((a, x) => a + x.ratio, 0);
  P(Math.abs(sum - 100) <= 0.1, `api/${s.label}/ratio-sum`, `Σratio=${sum.toFixed(3)} (100±0.1)`);
}

// 코호트가 실제로 달라지는가 — 절단이 없으면 4스코프가 전부 같은 수를 낸다(가장 중요한 축)
const counts = SCOPES.map(s => API[s.key]?.ticker_count);
bump('cohort-distinct');
P(new Set(counts).size === 4, 'api/cohort-distinct', `4스코프 ticker_count 서로 다름: ${counts.join(' / ')}`);
// manager_count가 코호트 크기로 이동했는가 / all_* 은 top과 무관하게 불변인가
for (const s of SCOPES) {
  const b = API[s.key]; if (!b) continue;
  const expect = s.key === 'all' ? b.all_manager_count : s.key;
  bump('meta', 3);
  P(b.manager_count === expect, `api/${s.label}/manager_count`, `manager_count=${b.manager_count} (기대 ${expect})`);
  P(b.all_manager_count === API.all.all_manager_count, `api/${s.label}/all_manager_count`,
    `all_manager_count=${b.all_manager_count} (top 무관 불변)`);
  P(b.all_total_value === API.all.all_total_value, `api/${s.label}/all_total_value`,
    `all_total_value=$${(b.all_total_value / 1e9).toFixed(1)}B (top 무관 불변)`);
}
// all_total_value는 Σportfolio_value가 아니라 전체 집계 투자금 합 == 전체 스코프의 total_value
bump('all-total-identity');
P(API.all.all_total_value === API.all.total_value, 'api/all-total-identity',
  `전체 스코프에서 all_total_value(${API.all.all_total_value}) == total_value(${API.all.total_value})`);

// ⑥용 — 전체엔 있고 상위10엔 없는 티커를 **API에서 파생**(하드코딩 금지)
const top10Set = new Set(API[10].rows.map(x => x.ticker));
const outsideRow = API.all.rows.find(x => !top10Set.has(x.ticker) && /^[A-Z.]{1,6}$/.test(x.ticker));
const OUTSIDE = outsideRow?.ticker;
bump('derive-outside');
P(!!OUTSIDE, 'api/outside-ticker', `코호트 밖 티커 파생: ${OUTSIDE ?? '없음(파생 실패)'}`);

// ── 브라우저 안 측정기 ──────────────────────────────────────────
// 판정 범위를 본문으로 한정한다(#238 ⓒ) — 전역 내비/마스트헤드가 섞이면 거짓 FAIL.
const measure = () => {
  const bx = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, w: b.width, h: b.height }; };
  const main = document.querySelector('main.page-wrap') || document.querySelector('main') || document.body;
  const scopes = main.querySelector('.guru-alloc-scopes');
  const panel = main.querySelector('.guru-alloc-info-panel');
  // 렌더된 **실제 줄 수** — 텍스트 노드에 Range를 걸어 line box를 센다. 넘침(bbox) 검사만으로는
  // "컨테이너에 맞췄지만 버튼 텍스트가 '10/명'으로 접힌" 상태가 통과한다(1차 프로브가 실제로
  // 그랬다 — 회고 #235 ④ⓑ "대리지표가 아니라 목표 자체를 재라"의 재발).
  const lineCount = (el) => {
    const t = [...el.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
    if (!t) return 0;
    const rg = document.createRange();
    rg.selectNodeContents(t);
    return rg.getClientRects().length;
  };
  const scopeChildren = scopes ? [...scopes.children].map(c => ({
    tag: c.tagName, text: c.textContent.trim(), box: bx(c), lines: lineCount(c),
  })) : [];
  return {
    mainBox: bx(main),
    caption: main.querySelector('.guru-alloc-caption')?.textContent.trim() ?? null,
    groupLabel: main.querySelector('.guru-alloc-scopes-label')?.textContent.trim() ?? null,
    pills: scopes ? [...scopes.querySelectorAll('button')].map(b => ({
      label: b.textContent.trim(), active: b.classList.contains('is-active'), box: bx(b),
    })) : [],
    scopesBox: scopes ? bx(scopes) : null,
    scopesParentBox: scopes?.parentElement ? bx(scopes.parentElement) : null,
    scopeChildren,
    rowCount: main.querySelectorAll('.guru-stat-row').length,
    top3: [...main.querySelectorAll('.guru-stat-row')].slice(0, 3)
      .map(el => el.querySelector('.guru-stat-ticker')?.textContent.trim() ?? null),
    infoBtn: [...main.querySelectorAll('button.filter-chip')].map(b => b.textContent.trim()),
    panel: panel ? {
      box: bx(panel),
      // ellipsis/line-clamp는 bbox를 넘지 않는다 — scrollWidth/Height가 유일한 축(#241 D2)
      lines: [...panel.querySelectorAll('p')].map(p => ({
        text: p.textContent.trim(),
        box: bx(p),
        clippedX: p.scrollWidth > p.clientWidth + 1,
        clippedY: p.scrollHeight > p.clientHeight + 1,
        white: getComputedStyle(p).whiteSpace,
        overflowStyle: getComputedStyle(p).textOverflow,
      })),
    } : null,
    cohortEmptyNotice: main.textContent.includes('선택한 코호트에 없습니다'),
    searchAllBtn: !![...main.querySelectorAll('button')].find(b => b.textContent.trim() === '전체에서 검색'),
    queryValue: main.querySelector('.guru-search--flex input, input')?.value ?? null,
    countBadge: main.querySelector('.guru-count')?.textContent.trim() ?? null,
  };
};

const b = await chromium.launch({ headless: true });
const openTab = async (page) => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([a, rr]) => {
    localStorage.setItem('access_token', a); localStorage.setItem('refresh_token', rr); localStorage.setItem('theme', 'light');
  }, [access_token, refresh_token]);
  await page.goto(`${BASE}/guru`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: '투자금', exact: true }).click();
  // 전체(1,723행)가 기본이라 렌더가 무겁다 — 넉넉히 기다린다.
  await page.waitForFunction(() => document.querySelectorAll('.guru-stat-row').length > 100, { timeout: 40000 });
  await page.waitForTimeout(800);
};

const VIEWS = [
  { name: 'pc',       ctx: { viewport: { width: 1440, height: 1000 } } },
  { name: 'mobile',   ctx: { ...devices['iPhone 13'] } },
  { name: 'narrow350', ctx: { viewport: { width: 350, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
];

for (const view of VIEWS) {
  const ctx = await b.newContext(view.ctx);
  const page = await ctx.newPage();
  await openTab(page);
  const m = await page.evaluate(measure);
  const V = view.name;

  // ③ 필 4개 + 그룹 라벨(이 기능의 유일한 발견 신호)
  bump(`${V}/pills`, 3);
  P(m.pills.map(p => p.label).join(',') === '10명,20명,50명,전체', `${V}/pills`,
    `필: ${m.pills.map(p => p.label).join(',')}`);
  P(m.groupLabel === '포트폴리오 규모 상위', `${V}/group-label`, `그룹 라벨: ${m.groupLabel}`);
  P(m.pills.find(p => p.active)?.label === '전체', `${V}/default-all`,
    `기본 활성: ${m.pills.find(p => p.active)?.label}`);

  // ② 기본(전체) 화면 행 수 == 응답 ticker_count + 상위3 일치
  bump(`${V}/rows`, 2);
  P(m.rowCount === API.all.ticker_count, `${V}/all/rowcount`,
    `행 ${m.rowCount} == ticker_count ${API.all.ticker_count}`);
  P(m.top3.join(',') === API.all.rows.slice(0, 3).map(x => x.ticker).join(','), `${V}/all/top3`,
    `상위3 DOM=${m.top3.join(',')} API=${API.all.rows.slice(0, 3).map(x => x.ticker).join(',')}`);

  // 캡션이 코호트 라벨·수치를 반영
  bump(`${V}/caption`);
  P(/구루 전체/.test(m.caption || ''), `${V}/caption-all`, `캡션: ${m.caption}`);

  // ④ 필 행 넘침 — 라벨 + 버튼 4개가 부모 content box를 넘지 않는지 **실측**
  //    비교 상자도 실측한다(#228). 부모의 right를 기준으로 자식 right를 본다.
  let scopeOverflow = 0;
  const parentR = m.scopesParentBox?.r ?? m.mainBox.r;
  for (const c of m.scopeChildren) { bump(`${V}/scope-overflow`); if (c.box.r > parentR + 1) scopeOverflow++; }
  P(scopeOverflow === 0, `${V}/scope-row-overflow`,
    `필 행 자식 ${m.scopeChildren.length}개 중 넘침 ${scopeOverflow} (부모 right=${parentR.toFixed(1)}, 필행 right=${m.scopesBox?.r.toFixed(1)}, 마지막 자식 right=${m.scopeChildren.at(-1)?.box.r.toFixed(1)})`);
  bump(`${V}/scope-box`);
  P((m.scopesBox?.r ?? 0) <= parentR + 1, `${V}/scope-box-within`,
    `필행 상자 right=${m.scopesBox?.r.toFixed(1)} ≤ 부모 ${parentR.toFixed(1)}`);
  // 넘침 0과 별개 축 — 라벨·버튼 텍스트가 접히면 "안 넘쳤지만 깨진" 상태다.
  const wrapped = m.scopeChildren.filter(c => c.lines > 1);
  for (const c of m.scopeChildren) bump(`${V}/scope-lines`);
  P(wrapped.length === 0, `${V}/scope-no-textwrap`,
    `필 행 자식 줄 수 [${m.scopeChildren.map(c => `${c.text.replace(/\s+/g, '')}:${c.lines}`).join(' ')}] — 2줄 이상 ${wrapped.length}개`);

  // ⑤ 설명란 — 기본 접힘 → 펼침 → 8항목 + 잘림 0 + PC 폭
  bump(`${V}/panel-collapsed`);
  P(m.panel === null, `${V}/panel-collapsed`, `기본 접힘 (패널 ${m.panel ? '노출' : '없음'})`);
  P(m.infoBtn.includes('데이터 기준'), `${V}/panel-btn`, `토글 버튼: ${m.infoBtn.join(' | ')}`);

  await page.getByRole('button', { name: '데이터 기준', exact: true }).click();
  await page.waitForTimeout(400);
  const m2 = await page.evaluate(measure);

  const LABELS = ['탑N', '비율', '보유 구루 수', '신고 분기', '갱신', '13F 성질', '투자금', '집계 단위'];
  const panelText = (m2.panel?.lines || []).map(l => l.text).join('\n');
  let missing = [];
  for (const L of LABELS) { bump(`${V}/panel-item`); if (!panelText.includes(L)) missing.push(L); }
  P(missing.length === 0, `${V}/panel-8items`, `8항목 중 누락 ${missing.length}${missing.length ? ': ' + missing.join(',') : ''}`);

  let clipX = 0, clipY = 0, badWhite = 0;
  for (const l of (m2.panel?.lines || [])) {
    bump(`${V}/panel-line`);
    if (l.clippedX) clipX++;
    if (l.clippedY) clipY++;
    if (l.white === 'nowrap' || l.overflowStyle === 'ellipsis') badWhite++;
  }
  P(clipX === 0 && clipY === 0, `${V}/panel-no-clip`,
    `설명란 ${m2.panel?.lines.length ?? 0}줄 중 가로잘림 ${clipX} · 세로잘림 ${clipY} (scrollWidth/Height 축)`);
  P(badWhite === 0, `${V}/panel-no-ellipsis`, `nowrap/ellipsis 적용된 줄 ${badWhite}`);

  // 동적 수치가 서버 값을 반영하는지 — 하드코딩이면 응답과 어긋난다
  bump(`${V}/panel-dynamic`, 2);
  P(panelText.includes(`전체 ${API.all.all_manager_count}명`), `${V}/panel-all-count`,
    `설명란이 all_manager_count(${API.all.all_manager_count}) 반영`);
  const periodKeys = Object.keys(API.all.periods || {});
  P(periodKeys.length === 0 || periodKeys.some(k => panelText.includes(k)), `${V}/panel-periods`,
    `설명란이 periods 반영 (응답 키: ${periodKeys.join(',') || '없음'})`);

  if (V === 'pc') {
    bump('pc/panel-width');
    P((m2.panel?.box.w ?? 0) <= 690, 'pc/panel-maxwidth',
      `PC 설명란 폭 ${m2.panel?.box.w.toFixed(1)}px ≤ 690 (통줄 금지)`);
  }

  // ⑦ 육안용 — 펼친 설명란은 **요소 캡처**(프레임 밖이면 무의미, #238 ⓓ)
  await page.locator('.guru-alloc-info-panel').scrollIntoViewIfNeeded();
  await page.locator('.guru-alloc-info-panel').screenshot({ path: `${OUT}/${V}-panel.png` }).catch(() => {});
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/${V}-top.png`, fullPage: false });
  // 설명란은 다시 접어 이후 단언에 영향 없게
  await page.getByRole('button', { name: '접기', exact: true }).click();
  await page.waitForTimeout(250);

  // ② 나머지 3스코프 — 행 수 == 응답 ticker_count, 상위3 일치
  for (const s of SCOPES.filter(x => x.key !== 'all')) {
    await page.getByRole('button', { name: s.label, exact: true }).click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('.guru-stat-row').length === n,
      API[s.key].ticker_count, { timeout: 30000 },
    ).catch(() => {});
    await page.waitForTimeout(400);
    const ms = await page.evaluate(measure);
    bump(`${V}/scope-rows`, 3);
    P(ms.rowCount === API[s.key].ticker_count, `${V}/${s.label}/rowcount`,
      `${s.label} → ${ms.rowCount}행 (ticker_count ${API[s.key].ticker_count})`);
    P(ms.top3.join(',') === API[s.key].rows.slice(0, 3).map(x => x.ticker).join(','), `${V}/${s.label}/top3`,
      `${s.label} 상위3 DOM=${ms.top3.join(',')} API=${API[s.key].rows.slice(0, 3).map(x => x.ticker).join(',')}`);
    P(/포트폴리오 규모 상위/.test(ms.caption || '') && ms.caption.includes(`${API[s.key].manager_count}명`),
      `${V}/${s.label}/caption`, `캡션: ${ms.caption}`);
  }

  // ⑥ 코호트 밖 검색 — 상위10 스코프에서 전체에만 있는 티커 → 안내 → [전체에서 검색]
  if (OUTSIDE) {
    await page.getByRole('button', { name: '10명', exact: true }).click();
    await page.waitForTimeout(1200);
    const input = page.locator('main input').first();
    await input.fill(OUTSIDE);
    await page.waitForTimeout(500);
    const mo = await page.evaluate(measure);
    bump(`${V}/cohort-search`, 2);
    P(mo.cohortEmptyNotice, `${V}/outside-notice`, `'${OUTSIDE}' 상위10 검색 → 안내 ${mo.cohortEmptyNotice ? '표시' : '없음'}`);
    P(mo.searchAllBtn, `${V}/outside-btn`, `[전체에서 검색] 버튼 ${mo.searchAllBtn ? '있음' : '없음'}`);

    await page.getByRole('button', { name: '전체에서 검색', exact: true }).click();
    await page.waitForTimeout(1500);
    const mf = await page.evaluate(measure);
    bump(`${V}/cohort-search-after`, 3);
    P(mf.queryValue === OUTSIDE, `${V}/query-kept`, `검색어 유지: '${mf.queryValue}' (기대 '${OUTSIDE}')`);
    P(mf.rowCount >= 1, `${V}/outside-found`, `전체 전환 후 결과 ${mf.rowCount}행`);
    P(mf.pills.find(p => p.active)?.label === '전체', `${V}/scope-switched`,
      `스코프 전환됨: ${mf.pills.find(p => p.active)?.label}`);
    await page.screenshot({ path: `${OUT}/${V}-outside-search.png`, fullPage: false });
  }

  await ctx.close();
}
await b.close();

// ⑧ 백엔드 [GuruStats] 신규 경고 0 — S1이 정상 값을 잘못 버리지 않는지
let logLines = '';
try {
  logLines = execSync(`docker logs --since 30m portfolion-backend-1 2>&1 | grep '\\[GuruStats\\]' || true`,
    { encoding: 'utf8' }).trim();
} catch { logLines = '(로그 조회 실패)'; }
const warnCount = logLines ? logLines.split('\n').filter(Boolean).length : 0;
bump('backend-log');
P(warnCount === 0, 'backend/gurustats-warn',
  `[GuruStats] 경고 ${warnCount}건${warnCount ? '\n    ' + logLines.split('\n').slice(0, 5).join('\n    ') : ''}`);

// ── 보고 ─────────────────────────────────────────────────────────
const failed = results.filter(x => !x.ok);
for (const x of results) console.log(`${x.ok ? 'PASS' : 'FAIL'} [${x.tag}] ${x.msg}`);
console.log('\n── 커버리지(계열별 검사 수 — 재실행 간 총계를 비교할 것) ──');
const covTotal = Object.values(cov).reduce((a, b) => a + b, 0);
console.log(Object.entries(cov).map(([k, v]) => `${k}:${v}`).join(' · '));
console.log(`커버리지 합계 ${covTotal} · 단언 ${results.length}건`);
console.log(`\n${failed.length ? `❌ FAIL ${failed.length}` : '✅ ALL PASS'}`);
console.log(`스크린샷: ${OUT}/{pc,mobile,narrow350}-{top,panel,outside-search}.png`);
process.exit(failed.length ? 1 : 0);
