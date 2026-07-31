// task#255 — 구루 투자금 탭 렌더 비용 실측(계산 도구).
//
// ⚠️ 이것은 회귀 게이트가 아니다. 성능 수치는 머신·부하·네트워크 의존이라 리터럴 임계값을
//    봉인하면 다음 사람이 무관한 이유로 FAIL을 본다. CI에 걸지 말 것. 임계값은 "이번에
//    착수할지"를 가르는 1회용 판정선이고, 스크립트는 그 수치를 계산하는 도구로만 남긴다.
//
// 무엇을 재나 — 4시나리오 × 2스로틀(1x·4x) × 2스코프(10명·전체):
//   ① 첫 진입      = fetch + 마운트 + 페인트 (수치만, 임계값 단언 없음 — fetch가 섞여 귀속 불가)
//   ② 스코프 전환  = 마운트·diff (캐시 워밍 후 = 순수 렌더)          [단언]
//   ③ 스크롤 3초   = 레이아웃·페인트 (longtask 최댓값)                [단언]
//   ④ 검색 5키     = 검색 JS diff + 페인트                            [단언]
//
// 측정 기법:
// - 상호작용은 **인페이지**에서 발생시킨다(t0와 클릭 사이에 CDP 왕복이 끼지 않게).
// - "다음 페인트"는 `requestAnimationFrame(() => setTimeout(fn, 0))` — rAF는 페인트 직전,
//   그 안의 setTimeout(0)은 페인트 직후 태스크로 실행된다.
// - **스코프 전환은 rAF 폴링으로 행 수 도달까지 기다린다.** 캐시 히트 분기의 `setData`가
//   useEffect(=passive effect, 페인트 이후 실행)에서 일어나므로, 클릭의 동기 flush에는
//   행 변화가 포함되지 않는다. 반면 **검색은 onChange 직접 setState**(discrete 이벤트
//   동기 flush)라 dispatch 반환 시점에 DOM이 이미 갱신돼 있다 — 그래서 둘의 기법이 다르다.
//
// 판정축 주의 (회고 누적):
// - #238 ⓐ·ⓑ: 실패만 기록하는 프로브의 ALL PASS는 아무것도 안 본 것과 구별되지 않는다
//   → 시나리오별 측정 횟수(커버리지)를 출력하고, **조건부 단언을 쓰지 않는다**. 미측정은
//   sentinel(`MEASURE_FAIL`)을 기대값과 비교해 FAIL시켜 단언 총계를 구조적으로 고정한다.
// - #246 ⓔ: 대조군 없이는 "앱이 안 그런다"와 "프로브가 못 본다"가 구별되지 않는다
//   → S2 판별력 실증(4x>1x · 전체>10명) 양축이 통과해야 이 프로브의 수치를 근거로 쓴다.
// - #249 ⓗ: 출력은 넓게, 단언은 목표에만 → 대리지표(heap·문서높이·DOM 노드)와 프레임
//   간격은 **출력만** 하고 단언에서 뺀다.
import { chromium } from 'playwright';

const BASE = 'https://portfolion.taebro.com';
const THROTTLES = [1, 4];
const SCROLL_MS = 3000;
const SEARCH_KEYS = ['A', 'AP', 'APP', 'APPL', 'APPLE'];   // 누적 입력 5단계(키당 1측정)

// 임계값 (계획서 사전 명시 — 실측 후 조정 금지)
const TH_SWITCH = 200;   // ms, INP '좋음' 상한
const TH_LONGTASK = 100; // ms, 체감 버벅 실용 기준
const TH_SEARCH = 200;   // ms

const results = [];
const P = (ok, tag, msg) => results.push({ ok, tag, msg });
const cov = {};
const bump = (k, n = 1) => { cov[k] = (cov[k] || 0) + n; };
const num = (v) => typeof v === 'number' && Number.isFinite(v);
// 무조건 단언 — 미측정은 sentinel로 FAIL시킨다(#238 ⓑ: `if (측정됨)` 가드 금지).
const assertMs = (v, limit, tag, label) => {
  const got = num(v) ? `${v.toFixed(0)}ms` : `MEASURE_FAIL(${JSON.stringify(v)})`;
  P(num(v) && v <= limit, tag, `${label} = ${got} (임계 ${limit}ms)`);
};

// ── 토큰 + 기대 행 수 ────────────────────────────────────────────
const r = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const { access_token, refresh_token } = await r.json();

const apiRows = async (top) => {
  const url = top ? `${BASE}/api/guru/stats/allocation?top=${top}` : `${BASE}/api/guru/stats/allocation`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${access_token}` } });
  if (res.status !== 200) throw new Error(`allocation ${top || 'all'} → HTTP ${res.status}`);
  const b = await res.json();
  return b.rows.length;
};
const ROWS = { '10명': await apiRows(10), '전체': await apiRows(null) };
console.log(`기대 행 수 — 10명 ${ROWS['10명']} · 전체 ${ROWS['전체']}`);
if (!ROWS['10명'] || !ROWS['전체'] || ROWS['10명'] >= ROWS['전체']) {
  console.log('중단 — 코호트 행 수가 비었거나 10명 >= 전체. 대상이 예상과 다르다(#251 ⓘ).');
  process.exit(1);
}

// ── 인페이지 계측 헬퍼 ───────────────────────────────────────────
const HELPERS = () => {
  const rowCount = () => document.querySelectorAll('.guru-stat-row').length;
  const afterPaint = () => new Promise(res =>
    requestAnimationFrame(() => setTimeout(() => res(performance.now()), 0)));

  // 클릭 → 행 수가 expect에 도달한 뒤의 페인트까지. passive effect 경유라 폴링이 필요하다.
  window.__clickScope = (label, expect, timeout) => new Promise(resolve => {
    const btn = [...document.querySelectorAll('.guru-alloc-scopes button')]
      .find(b => b.textContent.trim() === label);
    if (!btn) return resolve({ err: 'BUTTON_MISSING', label });
    const t0 = performance.now();
    btn.click();
    const tick = () => {
      const n = rowCount();
      if (n === expect) {
        afterPaint().then(t1 => resolve({ ms: t1 - t0, rows: n }));
      } else if (performance.now() - t0 > timeout) {
        resolve({ err: 'TIMEOUT', rows: n, expect });
      } else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // 검색: React 제어 입력이라 native setter + input 이벤트. discrete 이벤트 동기 flush라
  // dispatch 반환 시 DOM이 이미 갱신돼 있고, 남은 건 페인트뿐이다.
  window.__typeSearch = async (value) => {
    const input = document.querySelector('.guru-toolbar input');
    if (!input) return { err: 'INPUT_MISSING' };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const t0 = performance.now();
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const rowsSync = rowCount();
    const t1 = await afterPaint();
    return { ms: t1 - t0, rows: rowCount(), rowsSync };
  };

  // 스크롤 3초 — longtask 최댓값(단언축) + 프레임 간격(출력만).
  window.__scroll = (ms) => new Promise(resolve => {
    const lt = [];
    let po;
    try {
      po = new PerformanceObserver(l => { for (const e of l.getEntries()) lt.push(e.duration); });
      po.observe({ entryTypes: ['longtask'] });
    } catch { return resolve({ err: 'NO_LONGTASK_API' }); }
    window.scrollTo(0, 0);
    const gaps = [];
    const t0 = performance.now();
    let last = t0, first = true;
    const y0 = window.scrollY;
    const step = () => {
      const now = performance.now();
      if (first) first = false; else gaps.push(now - last);
      last = now;
      window.scrollBy(0, 400);
      if (now - t0 >= ms) {
        po.disconnect();
        return resolve({
          maxLongtask: lt.length ? Math.max(...lt) : 0,
          longtaskCount: lt.length,
          frames: gaps.length,
          maxGap: gaps.length ? Math.max(...gaps) : null,
          scrolled: window.scrollY - y0,
        });
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

  window.__proxy = () => ({
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
    docHeight: document.documentElement.scrollHeight,
    domNodes: document.getElementsByTagName('*').length,
    rows: rowCount(),
  });
};

// ── 실행 ────────────────────────────────────────────────────────
const M = {};   // M[throttle][scenario][scope] = 수치
const put = (t, sc, scope, v) => { (M[t] ||= {}); (M[t][sc] ||= {}); M[t][sc][scope] = v; };

const browser = await chromium.launch({ headless: true });

for (const rate of THROTTLES) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await page.addInitScript(HELPERS);

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([a, rr]) => {
    localStorage.setItem('access_token', a);
    localStorage.setItem('refresh_token', rr);
    localStorage.setItem('theme', 'light');
  }, [access_token, refresh_token]);
  await page.goto(`${BASE}/guru`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  // ② 안에는 「React 재조정+DOM 생성」과 「초기 style·layout·paint」가 함께 들어 있다.
  // ③(이미 마운트된 행의 스크롤 재페인트)은 그 *초기* 레이아웃 비용을 재지 않으므로,
  // ②를 통째로 마운트·diff에 귀속하면 추정이 된다(#246: 계측으로 확정할 것).
  // CDP 누적 카운터의 전후 차분으로 실제 분해한다.
  await cdp.send('Performance.enable');
  const metrics = async () => Object.fromEntries(
    (await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  const splitOf = (a, b) => ({
    script: (b.ScriptDuration - a.ScriptDuration) * 1000,
    style: (b.RecalcStyleDuration - a.RecalcStyleDuration) * 1000,
    layout: (b.LayoutDuration - a.LayoutDuration) * 1000,
    task: (b.TaskDuration - a.TaskDuration) * 1000,
  });

  // ① 첫 진입(전체) — 탭 마운트 = fetch + 마운트 + 페인트. 수치만.
  const first = await page.evaluate(async ([expect]) => {
    const tab = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '투자금');
    if (!tab) return { err: 'TAB_MISSING' };
    const t0 = performance.now();
    tab.click();
    return await new Promise(resolve => {
      const tick = () => {
        if (document.querySelectorAll('.guru-stat-row').length === expect) {
          requestAnimationFrame(() => setTimeout(() => resolve({ ms: performance.now() - t0 }), 0));
        } else if (performance.now() - t0 > 90000) {
          resolve({ err: 'TIMEOUT', rows: document.querySelectorAll('.guru-stat-row').length, expect });
        } else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, [ROWS['전체']]);
  put(rate, 'first', '전체', first.ms ?? first);
  bump('①첫진입');

  // ① 10명 첫 전환 — 캐시 미스라 fetch가 섞인다. 수치만.
  const firstTen = await page.evaluate(([l, e]) => window.__clickScope(l, e, 90000), ['10명', ROWS['10명']]);
  put(rate, 'first', '10명', firstTen.ms ?? firstTen);
  bump('①첫진입');

  // 여기서부터 10명·전체 모두 cacheRef에 적재됨 → 이후 전환은 순수 렌더.
  // ② 스코프 전환(캐시 워밍) — 양방향.
  const m0 = await metrics();
  const sw1 = await page.evaluate(([l, e]) => window.__clickScope(l, e, 60000), ['전체', ROWS['전체']]);
  put(rate, 'split', '10명→전체', splitOf(m0, await metrics()));
  put(rate, 'switch', '10명→전체', sw1.ms ?? sw1);
  bump('②스코프전환');
  const sw2 = await page.evaluate(([l, e]) => window.__clickScope(l, e, 60000), ['10명', ROWS['10명']]);
  put(rate, 'switch', '전체→10명', sw2.ms ?? sw2);
  bump('②스코프전환');

  // ③·④ 는 스코프별로. 현재 10명 상태.
  for (const scope of ['10명', '전체']) {
    if (scope === '전체') {
      const back = await page.evaluate(([l, e]) => window.__clickScope(l, e, 60000), ['전체', ROWS['전체']]);
      if (back.err) console.log(`  경고 — 전체 복귀 실패: ${JSON.stringify(back)}`);
    }
    put(rate, 'proxy', scope, await page.evaluate(() => window.__proxy()));

    const sc = await page.evaluate((ms) => window.__scroll(ms), SCROLL_MS);
    put(rate, 'scroll', scope, sc);
    bump('③스크롤');

    const keys = [];
    for (const v of SEARCH_KEYS) {
      keys.push(await page.evaluate((val) => window.__typeSearch(val), v));
      bump('④검색');
    }
    await page.evaluate(() => window.__typeSearch(''));
    put(rate, 'search', scope, keys);
    await page.evaluate(() => window.scrollTo(0, 0));
  }

  await ctx.close();
}
await browser.close();

// ── 출력 ────────────────────────────────────────────────────────
const ms = (v) => num(v) ? `${v.toFixed(0)}ms` : `실패(${JSON.stringify(v)})`;
console.log('\n════ 수치 ════');
for (const rate of THROTTLES) {
  console.log(`\n── CPU ${rate}x ──`);
  console.log(`① 첫 진입(fetch+렌더, 단언 없음)  전체 ${ms(M[rate].first['전체'])} · 10명(첫 전환) ${ms(M[rate].first['10명'])}`);
  console.log(`② 스코프 전환(순수 렌더)          10명→전체 ${ms(M[rate].switch['10명→전체'])} · 전체→10명 ${ms(M[rate].switch['전체→10명'])}`);
  const sp = M[rate].split?.['10명→전체'];
  console.log(`   ② 내부 분해(CDP 누적 차분) — Script ${sp ? sp.script.toFixed(0) : '—'}ms`
    + ` · RecalcStyle ${sp ? sp.style.toFixed(0) : '—'}ms · Layout ${sp ? sp.layout.toFixed(0) : '—'}ms`
    + ` · Task총 ${sp ? sp.task.toFixed(0) : '—'}ms`);
  for (const scope of ['10명', '전체']) {
    const s = M[rate].scroll[scope];
    console.log(`③ 스크롤 3초 [${scope}]  최장 longtask ${num(s?.maxLongtask) ? s.maxLongtask.toFixed(0) + 'ms' : '실패'}`
      + ` (건수 ${s?.longtaskCount ?? '—'} · 프레임 ${s?.frames ?? '—'} · 최장 프레임간격 ${s?.maxGap ? s.maxGap.toFixed(0) + 'ms' : '—'} · 스크롤 ${s?.scrolled ?? '—'}px)`);
    const k = M[rate].search[scope] || [];
    console.log(`④ 검색 [${scope}]  ${k.map((x, i) => `${SEARCH_KEYS[i]}:${num(x?.ms) ? x.ms.toFixed(0) : '실패'}`).join(' · ')}`
      + `  (행 ${k.map(x => x?.rows ?? '—').join('/')})`);
    const p = M[rate].proxy[scope];
    console.log(`   대리지표 [${scope}] — heap ${p?.heapMB ?? '—'}MB · 문서높이 ${p?.docHeight?.toLocaleString() ?? '—'}px · DOM 노드 ${p?.domNodes?.toLocaleString() ?? '—'} · 행 ${p?.rows ?? '—'}`);
  }
}

// ── 단언 ────────────────────────────────────────────────────────
for (const rate of THROTTLES) {
  // ① 측정 성공만 확인(임계값 단언 아님 — 태그로 구분).
  for (const scope of ['전체', '10명']) {
    const v = M[rate].first[scope];
    P(num(v), `measured/${rate}x/①첫진입/${scope}`, `첫 진입 ${scope} = ${ms(v)}`);
  }
  // ② 스코프 전환
  for (const dir of ['10명→전체', '전체→10명']) {
    assertMs(M[rate].switch[dir], TH_SWITCH, `${rate}x/②전환/${dir}`, `전환 ${dir}`);
  }
  for (const scope of ['10명', '전체']) {
    // ③ 스크롤 longtask — 프레임 0이면 스크롤 자체가 안 돈 것이라 측정 실패로 FAIL.
    const s = M[rate].scroll[scope];
    const okMeasured = s && num(s.maxLongtask) && s.frames > 0 && s.scrolled > 0;
    P(okMeasured && s.maxLongtask <= TH_LONGTASK, `${rate}x/③스크롤/${scope}`,
      okMeasured ? `최장 longtask ${s.maxLongtask.toFixed(0)}ms (임계 ${TH_LONGTASK}ms · 프레임 ${s.frames} · 스크롤 ${s.scrolled}px)`
        : `MEASURE_FAIL(${JSON.stringify(s)})`);
    // ④ 검색 5키
    const k = M[rate].search[scope] || [];
    for (let i = 0; i < SEARCH_KEYS.length; i++) {
      assertMs(k[i]?.ms, TH_SEARCH, `${rate}x/④검색/${scope}/${SEARCH_KEYS[i]}`, `검색 "${SEARCH_KEYS[i]}"`);
    }
  }
}

// ── S2 판별력 실증 (대조 — #246 ⓔ) ─────────────────────────────
console.log('\n════ 판별력 실증 ════');
const ratio = (a, b) => num(a) && num(b) && b > 0 ? a / b : null;
const meanSearch = (rate, scope) => {
  const k = (M[rate].search[scope] || []).map(x => x?.ms).filter(num);
  return k.length ? k.reduce((a, b) => a + b, 0) / k.length : null;
};

// ⓐ 스로틀 4x > 1x — 계측기가 CPU 비용에 반응하는가
const aSwitch = ratio(M[4].switch['10명→전체'], M[1].switch['10명→전체']);
const aSearch = ratio(meanSearch(4, '전체'), meanSearch(1, '전체'));
console.log(`ⓐ 4x/1x — 스코프 전환 ×${aSwitch?.toFixed(2) ?? '—'} · 검색(전체 평균) ×${aSearch?.toFixed(2) ?? '—'}`);
P(num(aSwitch) && aSwitch >= 1.5, 'S2ⓐ/throttle/전환', `4x/1x 전환 배수 = ${aSwitch?.toFixed(2) ?? 'MEASURE_FAIL'} (≥1.5)`);
P(num(aSearch) && aSearch >= 1.5, 'S2ⓐ/throttle/검색', `4x/1x 검색 배수 = ${aSearch?.toFixed(2) ?? 'MEASURE_FAIL'} (≥1.5)`);

// ⓑ 전체(1,723행) > 10명 — 행 수가 실제로 비용인가
const bSearch = ratio(meanSearch(4, '전체'), meanSearch(4, '10명'));
const bScroll = ratio(M[4].scroll['전체']?.maxLongtask, M[4].scroll['10명']?.maxLongtask);
console.log(`ⓑ 전체/10명 (4x) — 검색 ×${bSearch?.toFixed(2) ?? '—'} · 스크롤 longtask ×${bScroll?.toFixed(2) ?? '—'}`);
P(num(bSearch) && bSearch >= 1.5, 'S2ⓑ/rows/검색', `전체/10명 검색 배수 = ${bSearch?.toFixed(2) ?? 'MEASURE_FAIL'} (≥1.5)`);
// 스코프 전환은 방향이 다른 두 측정이라 행수 축 대조에 부적합 → 검색·스크롤만 단언.
// 스크롤은 longtask가 양쪽 0일 수 있어(페인트는 longtask로 안 잡힌다) 출력만 한다.

// ── 요약 ────────────────────────────────────────────────────────
console.log('\n════ 커버리지 ════');
console.log(Object.entries(cov).map(([k, v]) => `${k} ${v}`).join(' · '));
const fail = results.filter(x => !x.ok);
console.log(`\n════ 단언 ${results.length}건 · 실패 ${fail.length}건 ════`);
for (const x of results) console.log(`${x.ok ? 'PASS' : 'FAIL'} ${x.tag} — ${x.msg}`);
if (!fail.length) console.log('\nALL PASS');
process.exit(fail.length ? 1 : 0);
