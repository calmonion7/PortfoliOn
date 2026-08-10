// task#290 라이브 UAT — 사용자 경계(user boundary) 3건: B44(세션 고정)·B47(SW API 캐시)·B46(대시보드
// 캐시 스코프). B45(backlog PUT 게이트)는 이 프로브의 대상이 아니다 — admin/API키 전용 표면이라
// TESTING §7.5 4)"in-container 자체 호출" 대상이고, 그건 이 프로브(비admin 계정)가 원리적으로
// 열 수 없다. B45는 `backend/tests/test_report_router.py`의 pytest 2건(403·200 양성)이 커버한다.
//
// 각 축이 "무엇을 재는지" + "이 단언이 통과하면서도 깨질 수 있는 방식"(가토 ④ⓑ):
//
//   ⓐ B44 — `?token=&refresh=` 쿼리가 세션을 만들지 않는다.
//     대상 마커(비밀번호 입력칸)가 이 검증과 독립이면, 엉뚱한 화면(404 등) 위에서도 통과할 수
//     있다 → 로그인 화면 h1·brand·password-visible을 identity로 먼저 건다(가토 ⑧ⓘ).
//     그리고 `?diag=1`을 같은 URL에 함께 실으면 어떻게 되는지는 **추정하지 않고 코드로 확인했다**
//     (`App.jsx:134` — diag 체크가 authLoading/session 분기보다 먼저라 화면은 무조건 DiagLog로
//     바뀌지만, useAuthBootstrap의 훅 자체는 App() 안에서 그 체크보다 먼저 호출되므로 이펙트는
//     항상 실행된다). ⚠️ 함정 하나 더 발견: `DiagLog`는 `useState(() => readDiag())`로 **마운트
//     시점 1회** 스냅샷을 찍고 갱신하지 않는다 — App과 DiagLog는 같은 렌더 패스의 형제라, DiagLog의
//     스냅샷은 useAuthBootstrap의 이펙트(커밋 *이후*에 실행)보다 앞선 시점이라 **이번 로드 자신의
//     boot 항목이 화면 `<pre>`에는 못 실린다**(직전 로드분까지만 보인다). 그래서 boot.branch 판정은
//     화면 텍스트가 아니라 `localStorage.getItem('diag_log')`를 직접 읽어서 한다(이건 갱신되는
//     실제 값이다) — DOM 텍스트에 의존했으면 거짓 FAIL이 났을 자리다.
//
//   ⓑ B47 — 로그인 후 발생한 `/api/*` 응답이 SW Cache Storage 어디에도 없다.
//     "캐시가 없다"는 SW가 통째로 안 뜨거나 Cache Storage 자체가 죽어도 참이 되는 **공허한 참**이다
//     → precache·google-fonts·cdn-fonts 키 존재 + JS 번들이 실제로 `caches.match()`에 걸림을
//     이빨(대조군, TESTING §7.3 ⓔ)로 걸어 "선택적으로 안 캐시함"과 "캐싱 기능 자체가 죽음"을 가른다.
//     그리고 이름(`api-cache`)만 보면 부족하다 — 다른 이름의 캐시가 `/api/*` 응답을 우연히 들고
//     있을 수 있으므로, 관측된 `/api/*` URL마다 **전 캐시**를 `match()`해 내용 기준으로도 0건을 확인한다.
//
//   ⓒ B46 — 비admin 계정의 대시보드 새로고침(`DELETE /api/stocks/dashboard/cache`)이 200이다.
//     200은 라우팅(게이팅)만 증명하고 **스코프**(자기 캐시만 지웠는지, 구 버그는 전역 무효화)는
//     증명하지 못한다 — 계정이 1개뿐이라 교차사용자 격리는 라이브에서 잴 수 없다(프로브 한계로
//     명시). 또한 `usePortfolioData.fetchDashboard`는 `invalidate` 호출을 `.catch(() => {})`로
//     삼키므로(:41) **UI 증상(에러 배너 등)으로는 403을 구별할 수 없다** — 판정은 오직 Playwright가
//     가로챈 네트워크 응답 status에 둔다.
//
// 하니스 예외 — ⓑ만 `serviceWorkers:'allow'`(이 저장소 관례는 'block'). SW 설치·Cache Storage
//   자체가 판정 대상이라 block하면 원리적으로 아무것도 못 잰다(TESTING §7.2①). ⓐ·ⓒ는 관례대로 'block'.
// 뷰포트 — PC 1440×900 고정, 3축 전부 인증/캐시 로직이라 레이아웃과 독립(uat288·uat252 선례와 동일
//   근거) — 시각 회귀는 이 프로브의 대상이 아니다.
// 대상 identity — `test@portfolion.com`이 실제로 비admin인지는 **가정하지 않고** `GET /api/auth/me`로
//   1콜 확인한다(응답 필드는 `auth.py:124-129`를 직독해 `role`로 확정 — 추정 폴백 없음).
//
// 프로브 한계(재지 못하는 것):
//   · ⓒ의 교차사용자 캐시 격리(구 버그: 전역 invalidate) — 계정 1개뿐이라 라이브 실측 불가.
//     `backend/tests/test_stocks_router.py`가 `cache_svc.invalidate_dashboard` 호출 인자(user_id)로
//     이 스코프를 단위테스트 수준에서 고정한다.
//   · ⓑ의 "웜(재방문)" 시나리오 — 이 프로브는 SW가 이번 세션에서 처음 설치되는 콜드 케이스만 잰다
//     (claim 후 1회 reload로 "이번 로드가 SW-controlled"를 확보). ADR-0036이 명시하는 "새 SW 활성화
//     *전* 창에서는 옛 SW가 계속 캐시한다"는 별개 관심사(task#287의 SW 갱신 규율 소관)라 다루지 않는다.
//   · DiagLog UI의 스냅샷-1회 특성(위 ⓐ 주석) — B44와 무관한 기존 동작이라 FAIL로 잡지 않고 관찰로만
//     남긴다. 화면이 아니라 localStorage 직접 읽기로 우회했다.
import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat290';
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = 'test@portfolion.com';
const PASSWORD = 'test1234';

const AX = {
  pre: 'ⓟ 전제-비admin계정',
  ai: 'ⓐ-identity',
  a: 'ⓐ B44-토큰비저장',
  bi: 'ⓑ-identity',
  b: 'ⓑ B47-캐시부재',
  bt: 'ⓑ B47-이빨대조군',
  ci: 'ⓒ-identity',
  c: 'ⓒ B46-게이팅유지',
  dom: '정의역-sentinel',
  h: 'ⓗ 프로브건전성',
};

const checks = [];
const cov = {};
const bump = (k, n = 1) => { cov[k] = (cov[k] || 0) + n; };
// want는 항상 측정과 무관한 고정 리터럴. got을 그대로 want에 넣으면 자기충족 단언이 되어
// 아무것도 검사하지 않는다 — 실측치는 want가 아니라 detail에 싣는다(TESTING §7.1).
const assert = (ax, name, got, want, detail = '') => {
  checks.push({ ax, name, got, want, detail, pass: JSON.stringify(got) === JSON.stringify(want) });
  bump(ax);
};
const assertDomain = (tag, cnt) =>
  assert(AX.dom, `${tag} 정의역`, cnt > 0 ? 'OK' : 'DOMAIN_EMPTY', 'OK', `n=${cnt}`);
const die = (msg) => { console.error(`\n✗ 중단 — ${msg}`); process.exit(2); };

async function safeEval(page, fn, arg) {
  for (let i = 0; i < 5; i++) {
    try { return await page.evaluate(fn, arg); } catch { await page.waitForTimeout(300); }
  }
  return null;
}

// SW가 실제로 활성 + 이 클라이언트를 컨트롤할 때까지 대기(uat288 waitSwControl과 동형).
// 목표 상태 도달 루프 — 도달 실패해도 관측값 그대로 반환해 아래 단언이 FAIL로 잡는다(무음 스킵 없음).
async function waitSwControl(page, timeout = 45000) {
  const t0 = Date.now();
  let st = null;
  while (Date.now() - t0 < timeout) {
    st = await safeEval(page, async () => {
      if (!('serviceWorker' in navigator)) return { supported: false, active: false, controller: false };
      let reg = null;
      try { reg = await navigator.serviceWorker.getRegistration(); } catch {}
      return {
        supported: true,
        active: !!(reg && reg.active),
        controller: !!navigator.serviceWorker.controller,
        ctrlUrl: navigator.serviceWorker.controller?.scriptURL || null,
      };
    });
    if (st && st.active && st.controller) return { ...st, waitedMs: Date.now() - t0 };
    await page.waitForTimeout(400);
  }
  return { ...(st || {}), waitedMs: Date.now() - t0, timedOut: true };
}

// ── ① 로그인은 API 1콜 (표준 하니스, TESTING §7.1) ─────────────────────────
const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
const loginJson = await loginRes.json().catch(() => ({}));
const { access_token, refresh_token } = loginJson;
if (!access_token || !refresh_token) die(`로그인 실패 — status=${loginRes.status} body=${JSON.stringify(loginJson)}`);

// ── ② 대상 identity를 라이브 API로 확정 — 추정 폴백 금지(TESTING §7.1) ────
// 응답 필드는 auth.py:124-129를 직독해 확정: {user_id, email, role, menu_permissions}.
const meRes = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${access_token}` } });
const me = await meRes.json().catch(() => ({}));
if (!me?.role) die(`GET /api/auth/me에 role 필드가 없다 — 추정 폴백 금지, 즉시 중단. body=${JSON.stringify(me)}`);
assert(AX.pre, '테스트 계정 role ≠ admin', me.role === 'admin' ? 'ADMIN' : 'NON_ADMIN', 'NON_ADMIN',
  `role=${me.role} email=${me.email ?? '—'}`);
if (me.role === 'admin') die('테스트 계정이 admin이다 — ⓒ의 전제(비admin 게이팅 유지 확인)가 무의미해진다.');

// ════════════════════════════════════════════════════════════════════════
// ⓐ B44 — ?token=&refresh= 쿼리가 세션을 만들지 않는다
// ════════════════════════════════════════════════════════════════════════
async function runAxisA() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));

  // A1 — 분리형: 순수 로그인 화면 identity 확인(diag 없이).
  const TOK1 = 'uat290-fake-access-1', REF1 = 'uat290-fake-refresh-1';
  await page.goto(`${BASE}/?token=${TOK1}&refresh=${REF1}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="password"]', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(500);
  const s1 = await safeEval(page, () => {
    const vis = (el) => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const pw = [...document.querySelectorAll('input[type="password"]')].filter(vis);
    const h1 = [...document.querySelectorAll('h1')].map((e) => e.textContent.trim()).find(Boolean) || null;
    const brand = document.body.textContent.includes('PortfoliOn');
    return {
      title: document.title,
      loginFormVisible: pw.length > 0,
      h1,
      brand,
      access: localStorage.getItem('access_token'),
      refresh: localStorage.getItem('refresh_token'),
      url: location.href,
    };
  });
  assertDomain('A1 실측', s1 ? 1 : 0);
  if (!s1) { die('A1 — 페이지 평가 자체가 실패했다(컨텍스트 파괴 반복) — 이후 단언 무의미'); }

  // 대상 identity를 판정축보다 먼저(가토 ⑧ⓘ) — 이게 없으면 404 등 엉뚱한 화면에서도
  // "localStorage가 비었다"가 통과해 버린다.
  assert(AX.ai, 'A1 · document.title', s1.title, 'PortfoliOn', `url=${s1.url}`);
  // h1은 LoginPage.jsx:100 `당신의 자산을<br/>한 화면에서.` — <br/>가 textContent에서 개행 없이
  // 붙거나 공백 없이 이어질 수 있어 exact-match는 깨지기 쉽다. includes로 부분 마커만 확인한다.
  assert(AX.ai, 'A1 · 로그인 화면 h1 포함 "당신의 자산을"', s1.h1 && s1.h1.includes('당신의 자산을') ? 'OK' : 'H1_MISMATCH', 'OK', `h1=${JSON.stringify(s1.h1)}`);
  assert(AX.ai, 'A1 · 브랜드 마커 "PortfoliOn" 텍스트', s1.brand ? 'OK' : 'BRAND_MISSING', 'OK');
  assert(AX.ai, 'A1 · 로그인 폼(password input) 가시', s1.loginFormVisible ? 'OK' : 'LOGIN_FORM_MISSING', 'OK', `url=${s1.url}`);

  // 목표 — URL 쿼리 토큰이 세션을 확립하지 않는다.
  assert(AX.a, 'A1 · localStorage.access_token 미설정', s1.access === null ? 'NULL' : `SET(${s1.access})`, 'NULL');
  assert(AX.a, 'A1 · localStorage.refresh_token 미설정', s1.refresh === null ? 'NULL' : `SET(${s1.refresh})`, 'NULL');

  // A2 — 결합형: ?diag=1을 같은 URL에 함께 싣는다(위 헤더 주석 — App.jsx:134가 diag를 session/
  // authLoading보다 먼저 검사). diag_log는 A1에서 이미 1개(doc+boot) 쌍이 쌓여 있으므로, 이번
  // 내비게이션 고유 항목만 보려면 미리 지운다(가토 ⓒ — 판정 범위를 좁힌다, 여기선 시간 범위).
  await safeEval(page, () => { try { localStorage.removeItem('diag_log'); } catch {} });
  const TOK2 = 'uat290-fake-access-2', REF2 = 'uat290-fake-refresh-2';
  await page.goto(`${BASE}/?token=${TOK2}&refresh=${REF2}&diag=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="diag-log-pre"]', { timeout: 20000 }).catch(() => {});

  // boot 항목이 diag_log에 실제로 쓰일 때까지 폴링(useEffect는 커밋 이후 비동기로 실행됨).
  // 화면 <pre> 텍스트가 아니라 localStorage를 직접 읽는다 — 위 헤더 주석의 DiagLog 1회-스냅샷
  // 함정을 우회하는 지점이 바로 여기다.
  let log2 = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    log2 = (await safeEval(page, () => { try { return JSON.parse(localStorage.getItem('diag_log') || '[]'); } catch { return []; } })) || [];
    if (log2.some((e) => e.ev === 'boot')) break;
    await page.waitForTimeout(250);
  }
  const s2 = await safeEval(page, () => {
    const pre = document.querySelector('[data-testid="diag-log-pre"]');
    return {
      title: document.title,
      hasDiagPre: !!pre,
      access: localStorage.getItem('access_token'),
      refresh: localStorage.getItem('refresh_token'),
      url: location.href,
    };
  });
  assertDomain('A2 실측', s2 ? 1 : 0);
  if (!s2) die('A2 — 페이지 평가 자체가 실패했다 — 이후 단언 무의미');

  assert(AX.ai, 'A2 · document.title', s2.title, 'PortfoliOn', `url=${s2.url}`);
  assert(AX.ai, 'A2 · DiagLog 마커(data-testid=diag-log-pre) 존재 — diag=1이 authLoading/session보다 먼저 처리됨',
    s2.hasDiagPre ? 'OK' : 'DIAGLOG_MISSING', 'OK');

  assertDomain('A2 diag_log(이번 로드분)', log2.length);
  const boots2 = log2.filter((e) => e.ev === 'boot');
  const lastBoot2 = boots2[boots2.length - 1] || null;
  assert(AX.a, 'A2 · diag_log에 boot 항목 존재(이번 로드분, 미검출은 sentinel)',
    lastBoot2 ? 'OK' : 'BOOT_MISSING', 'OK', `전체 항목 ${log2.length}건 [${log2.map((e) => e.ev).join(',') || '없음'}]`);
  assert(AX.a, 'A2 · boot.branch — 제거된 token/refresh 분기가 아니라 stored(무-oauth) 경로',
    lastBoot2 ? lastBoot2.branch : 'BOOT_MISSING', 'stored', `boot=${JSON.stringify(lastBoot2)}`);
  assert(AX.a, 'A2(결합형) · localStorage.access_token 미설정', s2.access === null ? 'NULL' : `SET(${s2.access})`, 'NULL');
  assert(AX.a, 'A2(결합형) · localStorage.refresh_token 미설정', s2.refresh === null ? 'NULL' : `SET(${s2.refresh})`, 'NULL');

  await safeEval(page, () => window.scrollTo(0, 0));
  await page.screenshot({ path: `${OUT}/A1-login-screen.png` }).catch(() => {});
  await page.goto(`${BASE}/?diag=1`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/A2-diaglog.png`, fullPage: true }).catch(() => {});

  assert(AX.h, 'ⓐ 콘솔 pageerror 0건', errs.length === 0 ? 'OK' : 'PAGEERROR', 'OK',
    errs.length ? `${errs.length}건: ${[...new Set(errs)].slice(0, 3).join(' | ')}` : '0건');

  await browser.close();
}

// ════════════════════════════════════════════════════════════════════════
// ⓑ B47 — /api/* 가 SW Cache Storage에 없다
// ════════════════════════════════════════════════════════════════════════
async function runAxisB() {
  const browser = await chromium.launch({ headless: true });
  // ⚠️ 하니스 예외 — SW 설치·Cache Storage 자체가 판정 대상이라 'block'하면 원리적으로 못 본다.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'allow' });
  await ctx.addInitScript(([a, r]) => {
    try { localStorage.setItem('access_token', a); localStorage.setItem('refresh_token', r); } catch {}
  }, [access_token, refresh_token]);

  const apiResponses = [];
  const nonGetWrites = [];
  ctx.on('request', (req) => {
    const m = req.method();
    if (m !== 'GET' && m !== 'HEAD') nonGetWrites.push(`${m} ${req.url()}`);
  });
  ctx.on('response', (res) => {
    const u = res.url();
    if (/\/api\//.test(u)) apiResponses.push({ url: u, status: res.status() });
  });

  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));

  await page.goto(`${BASE}/reports`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.page-wrap', { timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);

  const ident0 = await safeEval(page, () => ({
    title: document.title,
    pageWrap: document.querySelectorAll('main.page-wrap').length,
    loginFormVisible: [...document.querySelectorAll('input[type="password"]')].some((el) => el.offsetWidth || el.offsetHeight),
  }));
  assertDomain('ⓑ 1차 로드 실측', ident0 ? 1 : 0);
  if (!ident0 || ident0.pageWrap !== 1 || ident0.loginFormVisible) {
    die(`ⓑ — 대상 페이지(로그인된 앱)가 확립되지 않았다: ${JSON.stringify(ident0)}`);
  }
  assert(AX.bi, 'ⓑ 1차 로드 · document.title', ident0.title, 'PortfoliOn');
  assert(AX.bi, 'ⓑ 1차 로드 · AppShell 마커(main.page-wrap) 1개', ident0.pageWrap, 1);

  // SW 활성+이 클라이언트 컨트롤 대기 → 그 다음 reload로 "이번 로드 자체가 SW-controlled"를 확보한다
  // (§7.3 ⓐ: 안 기다리면 표본 0으로 공허 통과 — 이 대기가 그 사전 차단이다).
  const sw0 = await waitSwControl(page);
  assert(AX.bt, 'ⓑ SW 활성+controller 확보(reload 전제)', sw0.active && sw0.controller ? 'OK' : 'SW_NOT_READY', 'OK',
    `active=${sw0.active} controller=${sw0.controller} waited=${sw0.waitedMs}ms${sw0.timedOut ? ' ⚠️TIMEOUT' : ''}`);

  apiResponses.length = 0; // 이 reload부터만 센다(1차 로드의 /api/*는 SW-uncontrolled일 수 있어 축이 어긋난다)
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.page-wrap', { timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3000); // 폰트 스타일시트 + 잔여 /api 트래픽 정착

  const ident1 = await safeEval(page, () => ({
    title: document.title,
    pageWrap: document.querySelectorAll('main.page-wrap').length,
    swController: navigator.serviceWorker.controller?.scriptURL || null,
  }));
  assert(AX.bi, 'ⓑ reload 후 · document.title', ident1?.title ?? 'EVAL_FAILED', 'PortfoliOn');
  assert(AX.bi, 'ⓑ reload 후 · AppShell 마커 1개', ident1?.pageWrap ?? 0, 1);
  assert(AX.bt, 'ⓑ reload 후 · SW controller 존재(이번 로드가 SW-controlled)', !!ident1?.swController ? 'OK' : 'NO_CONTROLLER', 'OK',
    `controller=${ident1?.swController ?? '(없음)'}`);

  const apiUrls = [...new Set(apiResponses.map((r) => r.url))];
  assertDomain('ⓑ /api/* 관측', apiUrls.length);
  if (apiUrls.length === 0) die('ⓑ — /api/* 요청이 관측되지 않았다(정의역이 비었다) — 이 축은 판정 불가.');

  const snap = await page.evaluate(async (urls) => {
    const keys = await caches.keys();
    const hits = [];
    for (const u of urls) {
      for (const k of keys) {
        try {
          const c = await caches.open(k);
          const m = await c.match(u);
          if (m) hits.push({ url: u, key: k });
        } catch { /* 캐시 열기 실패는 hit 없음으로 취급(과대 FAIL 방지 — 실패 자체는 아래 keys로 드러남) */ }
      }
    }
    const bundleEntry = (performance.getEntriesByType('resource') || [])
      .find((r) => typeof r?.name === 'string' && /\/assets\/index-[^/]*\.js$/.test(r.name));
    let bundleCachedIn = null;
    if (bundleEntry) {
      for (const k of keys) {
        try {
          const c = await caches.open(k);
          const m = await c.match(bundleEntry.name);
          if (m) { bundleCachedIn = k; break; }
        } catch {}
      }
    }
    return { keys, hits, bundleUrl: bundleEntry?.name ?? null, bundleCachedIn };
  }, apiUrls);

  assertDomain('ⓑ 캐시 키 목록', snap.keys.length);

  // ── 목표 축: /api/* 응답이 어느 캐시에도 없다 ─────────────────────────
  assert(AX.b, "ⓑ 'api-cache' 이름의 캐시 부재", snap.keys.some((k) => k.includes('api-cache')) ? 'PRESENT' : 'ABSENT', 'ABSENT',
    `전체 키 [${snap.keys.join(', ')}]`);
  assert(AX.b, `ⓑ 관측된 /api/* ${apiUrls.length}건이 전 캐시에 매칭되지 않음(이름이 아니라 내용 기준)`,
    snap.hits.length === 0 ? 'OK' : 'CACHE_HIT_FOUND', 'OK',
    snap.hits.length ? `히트 ${snap.hits.length}건: ${snap.hits.slice(0, 5).map((h) => `${h.url} ∈ ${h.key}`).join(' | ')}` : '히트 0건');

  // ── 이빨(대조군) — Cache Storage 자체는 살아 있다(TESTING §7.3 ⓔ) ─────
  assert(AX.bt, 'ⓑ 이빨 · precache 캐시 키 존재', snap.keys.some((k) => /precache/i.test(k)) ? 'OK' : 'PRECACHE_MISSING', 'OK',
    `키 목록 [${snap.keys.join(', ')}]`);
  assert(AX.bt, 'ⓑ 이빨 · google-fonts 캐시 키 존재', snap.keys.some((k) => k.includes('google-fonts')) ? 'OK' : 'GOOGLE_FONTS_MISSING', 'OK');
  assert(AX.bt, 'ⓑ 이빨 · cdn-fonts 캐시 키 존재', snap.keys.some((k) => k.includes('cdn-fonts')) ? 'OK' : 'CDN_FONTS_MISSING', 'OK');
  assert(AX.bt, 'ⓑ 이빨 · JS 번들이 실제로 caches.match()에 걸림(매칭 기능 자체가 동작)',
    snap.bundleCachedIn ? 'OK' : (snap.bundleUrl ? 'BUNDLE_NOT_CACHED' : 'BUNDLE_ENTRY_MISSING'), 'OK',
    `bundle=${snap.bundleUrl ?? '(리소스 엔트리 없음)'} · cachedIn=${snap.bundleCachedIn ?? '(없음)'}`);

  // ── 프로브 자신은 read-only였는가(이 축에서 우리가 만든 요청 감사) ─────
  assert(AX.h, 'ⓑ 이 프로브가 만든 비-GET/HEAD 요청 0건(순수 read)', nonGetWrites.length === 0 ? 'OK' : 'WRITE_OBSERVED', 'OK',
    nonGetWrites.length ? `${nonGetWrites.length}건: ${nonGetWrites.slice(0, 5).join(' | ')}` : '0건');
  assert(AX.h, 'ⓑ 콘솔 pageerror 0건', errs.length === 0 ? 'OK' : 'PAGEERROR', 'OK',
    errs.length ? `${errs.length}건: ${[...new Set(errs)].slice(0, 3).join(' | ')}` : '0건');

  console.log(`\n[ⓑ 정보] 관측된 /api/* ${apiUrls.length}건: ${apiUrls.slice(0, 8).join(' | ')}${apiUrls.length > 8 ? ' ...' : ''}`);
  console.log(`[ⓑ 정보] 전체 캐시 키(${snap.keys.length}): ${snap.keys.join(' | ')}`);

  await safeEval(page, () => window.scrollTo(0, 0));
  await page.screenshot({ path: `${OUT}/B-reports-warm.png` }).catch(() => {});

  await browser.close();
}

// ════════════════════════════════════════════════════════════════════════
// ⓒ B46 — 비admin 대시보드 새로고침(DELETE .../dashboard/cache)이 200이다
// ════════════════════════════════════════════════════════════════════════
async function runAxisC() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  await ctx.addInitScript(([a, r]) => {
    try { localStorage.setItem('access_token', a); localStorage.setItem('refresh_token', r); } catch {}
  }, [access_token, refresh_token]);

  let deleteResp = null;
  const nonGetWrites = [];
  ctx.on('request', (req) => {
    const m = req.method();
    if (m !== 'GET' && m !== 'HEAD') nonGetWrites.push(`${m} ${req.url()}`);
  });
  ctx.on('response', (res) => {
    if (res.request().method() === 'DELETE' && /\/api\/stocks\/dashboard\/cache/.test(res.url())) {
      deleteResp = { status: res.status(), url: res.url() };
    }
  });

  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));

  await page.goto(`${BASE}/portfolio`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.page-wrap', { timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(800);

  const ident = await safeEval(page, () => {
    const wrap = document.querySelector('main.page-wrap');
    const scope = wrap || document.body; // 판정 범위 좁히기(TESTING §7.3 ⓒ) — main.page-wrap 본문
    return {
      title: document.title,
      pageWrap: document.querySelectorAll('main.page-wrap').length,
      hasKpiLabel: scope.textContent.includes('총 종목'),
      refreshBtn: !!scope.querySelector('button[aria-label="새로고침"]'),
      loginFormVisible: [...document.querySelectorAll('input[type="password"]')].some((el) => el.offsetWidth || el.offsetHeight),
    };
  });
  assertDomain('ⓒ 실측', ident ? 1 : 0);
  if (!ident || ident.pageWrap !== 1 || ident.loginFormVisible || !ident.refreshBtn) {
    die(`ⓒ — 대상 페이지(비admin 포트폴리오 대시보드)가 확립되지 않았다: ${JSON.stringify(ident)}`);
  }

  assert(AX.ci, 'ⓒ · document.title', ident.title, 'PortfoliOn');
  assert(AX.ci, 'ⓒ · AppShell 마커(main.page-wrap) 1개', ident.pageWrap, 1);
  assert(AX.ci, 'ⓒ · KPI 라벨 "총 종목" 존재(대시보드 탭 렌더 확인)', ident.hasKpiLabel ? 'OK' : 'KPI_LABEL_MISSING', 'OK');
  assert(AX.ci, 'ⓒ · "새로고침" 버튼 존재(main.page-wrap 범위)', ident.refreshBtn ? 'OK' : 'REFRESH_BTN_MISSING', 'OK');

  // 버튼이 disabled(dashboardLoading 중)면 클릭 무의미 — 로딩 종료까지 대기(무음 스킵이 아니라
  // 목표 상태 도달 루프 + 미도달 시 아래 클릭이 no-op으로 남아 그 자체가 실패로 드러난다).
  await page.waitForSelector('main.page-wrap button[aria-label="새로고침"]:not([disabled])', { timeout: 20000 }).catch(() => {});
  await page.click('main.page-wrap button[aria-label="새로고침"]').catch((e) => {
    console.error(`ⓒ 새로고침 버튼 클릭 실패: ${e.message}`);
  });

  const t0 = Date.now();
  while (!deleteResp && Date.now() - t0 < 15000) await page.waitForTimeout(200);

  assert(AX.c, 'ⓒ DELETE /api/stocks/dashboard/cache 응답 관측', deleteResp ? 'OK' : 'NO_RESPONSE_OBSERVED', 'OK',
    deleteResp ? `status=${deleteResp.status} url=${deleteResp.url}` : '15초 내 응답 없음');
  assert(AX.c, 'ⓒ 비admin 사용자에게 200(admin 전용으로 좁혀지지 않았음)',
    deleteResp ? String(deleteResp.status) : 'NO_RESPONSE', '200',
    `role=${me.role} · 이것이 "게이팅을 admin-only로 올리지 않았음"의 라이브 증거`);

  // ⚠️ 참고(단언 아님) — usePortfolioData.js:41이 invalidate 호출을 .catch(()=>{})로 삼키므로
  // UI 증상(에러 배너 등)으로는 403을 구별할 수 없다. 판정은 위 네트워크 status 하나뿐이다.
  console.log(`[ⓒ 정보] 프론트가 DELETE 실패를 삼키는 코드(usePortfolioData.js:41) — 그래서 UI 증상이 아니라 네트워크 응답만으로 판정했다.`);

  await page.waitForTimeout(1000);
  // 정확히 1건을 기대하지 않는다 — Portfolio.jsx:101-108의 bounded self-heal(최대 3회, "헤더는
  // N인데 그리드가 빈" 콜드 글리치에서 자동으로 invalidate:true 재시도)이 우리 클릭과 무관하게
  // 추가 DELETE를 낼 수 있다(계정에 보유종목이 있고 그 글리치가 실제로 발생한 드문 경우). 그래서
  // 단언은 "그 외 엔드포인트로 나간 쓰기가 없다"로 좁힌다 — 개수 자체는 정보로만 남긴다.
  const otherWrites = nonGetWrites.filter((w) => !/\/api\/stocks\/dashboard\/cache/.test(w));
  assert(AX.h, 'ⓒ dashboard/cache 이외 엔드포인트로 나간 비-GET/HEAD 요청 0건',
    otherWrites.length === 0 ? 'OK' : 'UNEXPECTED_WRITE', 'OK',
    `dashboard/cache 쓰기 ${nonGetWrites.length - otherWrites.length}건(self-heal 포함 가능) · 그 외 ${otherWrites.length}건 [${otherWrites.join(' | ')}]`);
  assert(AX.h, 'ⓒ 콘솔 pageerror 0건', errs.length === 0 ? 'OK' : 'PAGEERROR', 'OK',
    errs.length ? `${errs.length}건: ${[...new Set(errs)].slice(0, 3).join(' | ')}` : '0건');

  await safeEval(page, () => window.scrollTo(0, 0));
  await page.screenshot({ path: `${OUT}/C-portfolio-dashboard.png` }).catch(() => {});

  await browser.close();
}

await runAxisA();
await runAxisB();
await runAxisC();

// ── 판정 ────────────────────────────────────────────────────────────────
const failed = checks.filter((c) => !c.pass);
console.log('\n=== task#290 — 사용자 경계 3건(B44·B47·B46) 라이브 실측 ===\n');
console.log(`대상: ${BASE} · 계정: ${EMAIL} (role=${me.role})\n`);
for (const c of checks) {
  console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.ax} — ${c.name} · got=${JSON.stringify(c.got)} want=${JSON.stringify(c.want)}${c.detail ? ` · ${c.detail}` : ''}`);
}

console.log('\n=== 커버리지(축별 단언 수) ===');
console.log(`   ${Object.entries(cov).map(([k, v]) => `${k}:${v}`).join(' · ')}`);
console.log(`   단언 합계 ${checks.length}건 · PASS ${checks.length - failed.length} · FAIL ${failed.length}`);
console.log(`   스크린샷: ${OUT}`);

fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ base: BASE, me, cov, checks }, null, 2));

console.log(failed.length ? `\n>>> FAIL ${failed.length}/${checks.length}` : `\n>>> ALL PASS ${checks.length}/${checks.length}`);
process.exit(failed.length ? 1 : 0);
