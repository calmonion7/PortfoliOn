// task#253 라이브 UAT — OAuth 에러·소진 코드 착지가 유효한 세션을 죽이지 않는다.
//
// 결함: 부트스트랩의 3분기(?error= · 코드교환 실패 · 네트워크 실패)가 localStorage 토큰을 보지
// 않고 "세션 없음"을 단정해, 로그인돼 있는 사용자에게 로그인 화면이 떴다(새로고침하면 돌아오므로
// 유령 버그로 보인다). 지배적 트리거는 사용자 거절이 아니라 **뒤로가기로 콜백 엔트리 재실행**이다
// — OAuth 코드는 1회용(TTL 120초)이라 재실행은 반드시 400이 된다.
//
// 판별력(⑧ⓔ): 각 arm마다 **토큰 없는 대조군**을 쌍으로 돌린다. 대조군에서 로그인 화면이 떠야
// 이 프로브가 "로그인 화면이 뜬 상태"를 관측할 수 있음이 증명된다 — 없으면 treatment의 PASS가
// "프로브가 원래 로그인 화면을 못 보는 것"과 구별되지 않는다.
// 메커니즘 커버리지(⑧ⓖ): 소진 코드 arm이 실제로 400을 받았는지 응답 상태로 별도 보고한다.
//   목표 단언(앱이 유지된다)은 상태코드와 무관하게 항상 검사한다.
// 대상 유효성(⑧ⓘ): 우리 오리진·URL 청소(replaceState '/')·토큰 존재를 함께 단언한다 —
//   appShell/loginForm 판정만으로는 '엉뚱한 문서'를 배제하지 못한다.
//
// ⚠️ 토큰은 폼 로그인으로 얻은 **실토큰**을 쓴다(#252와 같은 이유). 가짜 토큰은 첫 API 호출이
//    401을 받아 api.js 인터셉터가 replace('/')를 실행해, 에러 분기와 무관하게 로그인 화면으로 튄다.
// ⚠️ SW가 /api/*를 가로채므로 컨텍스트는 serviceWorkers: 'block' (CLAUDE.md 라이브 UAT ①).
import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat253';
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = 'test@portfolion.com';
const PASSWORD = 'test1234';

const results = [];
const P = (ok, tag, msg) => results.push({ kind: 'assert', ok, tag, msg });
const INFO = (tag, msg) => results.push({ kind: 'info', tag, msg });

const die = (msg) => { console.error(`\n✗ 중단 — ${msg}`); process.exit(2); };

// 로그인 화면인지 = 비밀번호 입력칸이 보이는지. 앱 화면인지 = 셸이 있는지.
// (#245 D4 — PC/모바일이 같은 셀렉터를 DOM에 함께 두고 CSS로만 가리므로 visible 필터 필수)
const snapshot = (page) => page.evaluate(() => {
  const vis = (el) => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const pw = [...document.querySelectorAll('input[type="password"]')].filter(vis);
  return {
    loginForm: pw.length > 0,
    appShell: !!document.querySelector('.app-pc, .app-main, main.page-wrap'),
    hasToken: !!localStorage.getItem('access_token'),
    url: location.href,
    search: location.search,
    origin: location.origin,
  };
});

const browser = await chromium.launch();

// ── 실토큰 확보(폼 로그인) ───────────────────────────────────────
const grabTokens = async () => {
  const c = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
  const p = await c.newPage();
  await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input[type="password"]', { timeout: 20000 });
  await p.fill('input[type="email"]', EMAIL);
  await p.fill('input[type="password"]', PASSWORD);
  await p.click('button[type="submit"]');
  await p.waitForFunction(() => !!localStorage.getItem('access_token'), { timeout: 20000 });
  await p.waitForSelector('.app-pc, .app-main, main.page-wrap', { timeout: 30000 });
  const t = await p.evaluate(() => ({
    access_token: localStorage.getItem('access_token'),
    refresh_token: localStorage.getItem('refresh_token'),
  }));
  await c.close();
  return t;
};

const tokens = await grabTokens();
if (!tokens.access_token || !tokens.refresh_token) die('폼 로그인으로 실토큰을 얻지 못했다 — 이후 단언은 무의미하다');
INFO('전제/실토큰', '폼 로그인으로 access/refresh 확보 (가짜 토큰의 401 오염 회피)');

// ── 한 arm 실행: 지정 쿼리로 착지 ────────────────────────────────
// seeded=true면 실토큰을 심는다(로그인된 사용자). false면 안 심는다(대조군).
const land = async (label, query, seeded, shot) => {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
  if (seeded) {
    await ctx.addInitScript(([a, r]) => {
      try {
        localStorage.setItem('access_token', a);
        localStorage.setItem('refresh_token', r);
      } catch {}
    }, [tokens.access_token, tokens.refresh_token]);
  }

  const page = await ctx.newPage();
  // 메커니즘 축 — 코드 교환 응답의 실제 상태코드를 기록한다(모킹 없음, 라이브 백엔드).
  const tokenCalls = [];
  page.on('response', (res) => {
    if (res.url().includes('/api/auth/oauth/token')) tokenCalls.push(res.status());
  });

  await page.goto(`${BASE}/${query}`, { waitUntil: 'domcontentloaded' });
  // 부트스트랩은 비동기다(코드 교환은 왕복 1회) — 로딩(authLoading)이 끝날 때까지 기다린다.
  // 어느 쪽으로 끝나든(앱 or 로그인 폼) 판정 가능한 상태가 되면 진행한다.
  await page.waitForFunction(() => {
    const vis = (el) => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const pw = [...document.querySelectorAll('input[type="password"]')].filter(vis);
    return pw.length > 0 || !!document.querySelector('.app-pc, .app-main, main.page-wrap');
  }, { timeout: 30000 }).catch(() => null);
  await page.waitForTimeout(1200); // 라우팅·렌더 안정화

  const s = await snapshot(page);
  if (shot) await page.screenshot({ path: `${OUT}/${shot}.png` });

  // 대상 유효성(⑧ⓘ) — 우리 오리진 위인지 먼저 못박는다.
  if (s.origin !== BASE) die(`${label}: 우리 오리진이 아니다 (origin=${s.origin}) — 판정 대상이 틀렸다`);

  await ctx.close();
  return { ...s, tokenCalls };
};

// ── arm 1·2: ?error= 착지 (토큰 있음 → 유지 / 없음 → 로그인 화면) ─
for (const err of ['oauth_denied', 'oauth_failed']) {
  const t = await land(`?error=${err}/토큰있음`, `?error=${err}`, true, `error-${err}-seeded`);
  P(t.appShell && !t.loginForm, `?error=${err}/목표-세션유지`,
    `앱이 유지된다 (appShell=${t.appShell}, loginForm=${t.loginForm}, hasToken=${t.hasToken})`);
  P(t.search === '', `?error=${err}/URL청소`,
    `에러 쿼리가 제거됐다 (search="${t.search}", url=${t.url})`);
  P(t.hasToken, `?error=${err}/토큰보존`, `저장 토큰이 남아 있다 (hasToken=${t.hasToken})`);

  const c = await land(`?error=${err}/토큰없음`, `?error=${err}`, false, null);
  P(c.loginForm && !c.appShell, `?error=${err}/판별력-대조군`,
    `토큰 없으면 로그인 화면이 뜬다 (loginForm=${c.loginForm}, appShell=${c.appShell}) — 프로브가 로그인 화면을 관측할 수 있다`);
}

// ── arm 3: 소진된 ?oauth= 코드 (지배적 트리거, 라이브 400) ───────
const USED = '?oauth=uat253-used-code';
const t3 = await land('소진코드/토큰있음', USED, true, 'used-code-seeded');
P(t3.appShell && !t3.loginForm, '소진코드/목표-세션유지',
  `앱이 유지된다 (appShell=${t3.appShell}, loginForm=${t3.loginForm}, hasToken=${t3.hasToken})`);
P(t3.search === '', '소진코드/URL청소', `oauth 쿼리가 제거됐다 (search="${t3.search}")`);

const c3 = await land('소진코드/토큰없음', USED, false, null);
P(c3.loginForm && !c3.appShell, '소진코드/판별력-대조군',
  `토큰 없으면 로그인 화면이 뜬다 (loginForm=${c3.loginForm}, appShell=${c3.appShell})`);

// 메커니즘 커버리지(⑧ⓖ) — 목표 단언과 별개 축.
const statuses = [...t3.tokenCalls, ...c3.tokenCalls];
INFO('메커니즘/코드교환',
  `라이브 코드 교환 응답 상태 ${statuses.length}건: [${statuses.join(', ')}]` +
  (statuses.some(s => s === 400)
    ? ' — 400 관측: 지배적 트리거(소진 코드)를 실제로 밟았다'
    : ' — ⚠️ 400 미관측: 위 소진코드 PASS는 400 경로를 실증하지 못한다(단위테스트 ③이 그 분기를 고정)'));

// ── 리포트 ──────────────────────────────────────────────────────
const asserts = results.filter(r => r.kind === 'assert');
const failed = asserts.filter(r => !r.ok);

console.log('\n=== task#253 — OAuth 에러·소진 코드 착지가 세션을 죽이지 않는다 ===\n');
for (const r of results) {
  const mark = r.kind === 'assert' ? (r.ok ? 'PASS' : 'FAIL') : 'info';
  console.log(`[${mark}] ${r.tag} — ${r.msg}`);
}
console.log('\n--- 커버리지 ---');
console.log(`단언 ${asserts.length}건 (PASS ${asserts.length - failed.length} · FAIL ${failed.length})`);
console.log(`arm 6개: ?error=oauth_denied/oauth_failed/소진코드 × (토큰있음·토큰없음 대조군)`);
console.log(`스크린샷: ${OUT}`);

await browser.close();
process.exit(failed.length ? 1 : 0);
