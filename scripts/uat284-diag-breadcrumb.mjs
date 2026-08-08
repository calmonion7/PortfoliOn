// task#284 라이브 UAT — 콜드스타트 첫 구글 로그인 잔상의 원인(가: bfcache 복원 / 나: 문서
// 재요청)을 가르기 위해 심은 진단 브레드크럼(`diag.js`)이 실제로 그 구분에 필요한 데이터를
// 남기는지 실측한다. 이 프로브는 잔상 자체를 고치지 않는다 — 계측이 올바른지만 잰다.
//
// ⚠️ 실행 시점 주의 — 이 스크립트는 계측(diag.js·useAuthBootstrap·oauthHistory·
// useBfcacheAuthGuard·DiagLog)이 라이브에 배포되기 *전에* 저작됐다. `frontend/dist`는 nginx가
// 직접 서빙하므로 `npm run build`가 돌기 전에는 옛 번들이 떠 있다 — 지금 돌리면 계측이 없어
// 반드시 FAIL하고 그게 "구현 결함"으로 오독된다. 메인 세션이 빌드한 뒤 별도 단계에서 실행할 것.
//
// ── 시나리오 설계(uat252 하니스 재사용, 완주로 조정) ──────────────────────────────
// uat252/283은 되감기 메커니즘 자체를 검증하는 게 목적이라 "동의"를 누르지 않거나(283) IdP
// 왕복만 확인(252)하지만, 이 작업은 "1차 로그인 흐름 그대로" 실제 boot:oauth-ok와 rewind가
// 로그에 남는지 보는 것이므로 **동의까지 완주**한다 — 폼 로그인으로 얻은 실토큰을
// `**/api/auth/oauth/token*`에 물려 코드교환을 성공시킨다(가짜 토큰이면 401→api.js가
// replace('/')를 쏴 되감기와 무관한 리로드가 섞인다, uat252/283과 동일 회피 이유).
//
// 판정 2축(TESTING §7.3 ⓖ): 목표(doc≥2·rewind 1건·boot:oauth-ok·오버레이 렌더)는 항상 검사하고,
// pageshow(메커니즘 참여)는 커버리지 INFO로만 보고한다 — Playwright는 bfcache를 발동시킬 수
// 없으므로(task#246, 3엔진 대조군 확정) persisted=true 관측 0건이 실패가 아니라 기준선이다.
// 대상 유효성(⑧ⓘ): 센티넬·가짜IdP·오리진 3종의 고유 마커를 판정축보다 먼저 확인하고 어긋나면
// 즉시 die() — nav/보드 판정은 문서 내용과 독립이라 틀린 문서 위에서도 통과할 수 있기 때문이다.
// 시나리오 자기검증: doc 로그 자체에서 `?oauth=probe-code` URL이 실제로 찍혔는지(replaceState
// *이전*에 logDiag('doc',...)가 먼저 호출되므로 가능하다, useAuthBootstrap.js:16)와 최종 착지가
// 실제 로그인-완료 상태인지를 diag 로그와 **독립인** DOM 스냅샷으로 교차 확인한다.
import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const IDP = 'https://fake-idp.test';
const START = 'https://probe-start.test';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat284';
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = 'test@portfolion.com';
const PASSWORD = 'test1234';

const results = [];
const P = (ok, tag, msg) => results.push({ kind: 'assert', ok, tag, msg });
const INFO = (tag, msg) => results.push({ kind: 'info', tag, msg });
const cov = {};
const bump = (k, n = 1) => { cov[k] = (cov[k] || 0) + n; };

const die = (msg) => { console.error(`\n✗ 중단 — ${msg}`); process.exit(2); };

// 정의역 sentinel — 표본이 0이면 "위반목록 0건=통과"로 공허해지는 것을 막는다(TESTING §7.3 ⓑ).
const assertDomain = (tag, arr) => {
  bump(`${tag}-domain`);
  P(arr.length > 0, `${tag}-domain`, arr.length > 0 ? `OK (n=${arr.length})` : 'DOMAIN_EMPTY(0)');
};

const html = (title, body) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;

const SENTINEL = html('start', '<h1>PROBE START</h1><p>로그인 이전 지점</p>');
const IDP1 = html('idp', '<h1>FAKE IDP</h1><a id="pick" href="/step2">계정 선택</a>');
// uat283과 달리 "동의"를 실제로 눌러 완주한다 — boot:oauth-ok/rewind가 실제로 로그에 남으려면
// 코드교환까지 실행돼야 한다.
const IDP2 = html('idp', `<h1>FAKE IDP</h1><a id="consent" href="${BASE}/?oauth=probe-code">동의</a>`);

// 이빨 단언 — 세 오리진이 서로 다름(합성 오리진을 잘못 겹쳐 쓰면 판정이 공허해진다, uat283과 동형).
bump('target-validity');
P(new Set([BASE, IDP, START]).size === 3, '오리진-이빨',
  `대상 오리진 3개가 서로 다름: ${BASE} / ${IDP} / ${START}`);

// 앱의 diag.js와 *독립*인 접지선 — BASE 오리진 문서 로드마다 +1(오리진 스코프라 IDP/START 방문은
// 안 섞인다). 앱 자신의 doc 로그 개수와 대조해 "로거가 빠뜨리지 않았는가"를 검증한다.
const GROUND_INIT = `
(() => {
  try {
    const K = '__uat284_loads';
    const a = JSON.parse(sessionStorage.getItem(K) || '[]');
    const nav = performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null;
    a.push({ url: location.pathname + location.search, navType: nav ? nav.type : null });
    sessionStorage.setItem(K, JSON.stringify(a));
  } catch {}
})();
`;

const readGroundLoads = (page) =>
  page.evaluate(() => { try { return JSON.parse(sessionStorage.getItem('__uat284_loads') || '[]'); } catch { return []; } });

// 앱의 diag_log — localStorage라 문서 재요청을 넘어 살아남는다(diag.js 계약).
const readDiagLog = (page) =>
  page.evaluate(() => { try { return JSON.parse(localStorage.getItem('diag_log') || '[]'); } catch { return []; } });

// 로그인 화면인지 = 비밀번호 입력칸이 보이는지(#245 D4 — visible 필터 필수, PC/모바일 DOM 공존).
const snapshot = (page) => page.evaluate(() => {
  const vis = (el) => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const pw = [...document.querySelectorAll('input[type="password"]')].filter(vis);
  return {
    loginForm: pw.length > 0,
    appShell: !!document.querySelector('.app-pc, .app-main, main.page-wrap'),
    hasToken: !!localStorage.getItem('access_token'),
    h1: document.querySelector('h1')?.textContent?.trim() || null,
    url: location.href,
  };
});

const browser = await chromium.launch();

// ── 실토큰 확보(폼 로그인, uat252/283과 동일 패턴) ────────────────
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
INFO('전제/실토큰', '폼 로그인으로 access/refresh 확보 (가짜 토큰의 401 오염 회피 — uat252/283과 동일 이유)');

// ── 본 시나리오: 가짜 IdP 2단계 완주 → 코드교환 성공 → 되감기 ──────
const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(GROUND_INIT);
await ctx.route(`${START}/**`, r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: SENTINEL }));
await ctx.route(`${IDP}/step1`, r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: IDP1 }));
await ctx.route(`${IDP}/step2`, r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: IDP2 }));
// 302 대신 location.replace로 떠나는 HTML을 fulfill — route.fulfill의 302는 후속 요청이
// 인터셉트되지 않아 DNS 실패로 끝난다(task#252 실측, TESTING.md §7.2).
await ctx.route('**/api/auth/oauth/google', r => r.fulfill({
  contentType: 'text/html; charset=utf-8',
  body: html('redirect', `<script>location.replace(${JSON.stringify(`${IDP}/step1`)})</script>`),
}));
await ctx.route('**/api/auth/oauth/token*', r => r.fulfill({
  contentType: 'application/json', body: JSON.stringify(tokens),
}));

const page = await ctx.newPage();
const trail = [];
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

// E1 — 센티넬(로그인 이전 지점). 대상 유효성 확인 전 판정하면 안 되므로 즉시 die().
await page.goto(`${START}/`, { waitUntil: 'domcontentloaded' });
const s0 = await snapshot(page);
trail.push(s0.url);
bump('target-validity');
if (s0.h1 !== 'PROBE START') die(`센티넬 대상이 아니다 (h1=${s0.h1})`);
P(true, '대상유효성-센티넬', `로그인 이전 지점이 실재한다 (h1="PROBE START")`);

// E2 — 우리 로그인 화면
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('input[type="password"]', { timeout: 20000 });
trail.push(page.url());

// E3 — Google 버튼 클릭 → push 내비 → 302 모사(location.replace) → 가짜 IdP 1단계
await page.locator('button:has-text("Google로 계속"):visible').first().click();
await page.waitForURL(`${IDP}/step1`, { timeout: 20000 });
const i1 = await snapshot(page);
trail.push(i1.url);
bump('target-validity');
if (i1.h1 !== 'FAKE IDP') die(`가짜 IdP(1단계) 대상이 아니다 (h1=${i1.h1})`);
P(true, '대상유효성-IdP1', `IdP 1단계를 실제로 밟았다 (h1="FAKE IDP", ${i1.url})`);

// E4 — IdP 2단계
await page.click('#pick');
await page.waitForURL(`${IDP}/step2`, { timeout: 20000 });
const i2 = await snapshot(page);
trail.push(i2.url);
bump('target-validity');
if (i2.h1 !== 'FAKE IDP') die(`가짜 IdP(2단계) 대상이 아니다 (h1=${i2.h1})`);
P(true, '대상유효성-IdP2', `IdP 2단계를 실제로 밟았다 (h1="FAKE IDP", ${i2.url})`);

// E5 — 동의 클릭(완주). 착지 → replaceState → 코드교환(fetch) → boot:oauth-ok → returnFromOAuth()
// → rewind 로그 → go(-delta) 또는 replace('/') 순으로 빠르게 진행된다. 중간 문서에서 evaluate하면
// 'Execution context was destroyed'로 깨지므로(uat252 주석과 동일 이유) 최종 정착까지 기다린다 —
// diag_log는 localStorage라 어느 문서를 거치든 누적되므로 최종 시점에 한 번만 읽어도 손실이 없다.
await page.click('#consent');
await page.waitForSelector('.app-pc, .app-main, main.page-wrap, input[type="password"]', { timeout: 30000 });
await page.waitForTimeout(800); // pageshow/뒤늦은 렌더 안정화
trail.push(page.url());

const finalSnap = await snapshot(page);
await page.screenshot({ path: `${OUT}/1-final-landing.png` });

// 시나리오 자기검증(대상 유효성의 짝) — diag 로그와 *독립*인 DOM으로 "완주가 실제로 됐는가"를 먼저
// 확인한다. 이게 깨지면 아래 로그 기반 단언은 전부 "틀린 대상 위의 통과"가 된다(⑧ⓘ).
bump('target-validity');
P(finalSnap.appShell && finalSnap.hasToken && !finalSnap.loginForm, 'target-flow-completed',
  `최종 착지가 로그인 완료 상태 (appShell=${finalSnap.appShell}, hasToken=${finalSnap.hasToken}, loginForm=${finalSnap.loginForm}, url=${finalSnap.url})`);
if (!(finalSnap.appShell && finalSnap.hasToken)) die('OAuth 완주 전제가 깨졌다 — 이후 diag 로그 단언이 무의미하다');

// ── diag_log 판독(1~3, 5) ──────────────────────────────────────────
const log = await readDiagLog(page);
const docs = log.filter(e => e.ev === 'doc');
const boots = log.filter(e => e.ev === 'boot');
const rewinds = log.filter(e => e.ev === 'rewind');
const pageshows = log.filter(e => e.ev === 'pageshow');
const groundLoads = await readGroundLoads(page);

// ── 1) doc 항목 ≥2, 각 항목 nav 출력 ────────────────────────────────
assertDomain('doc', docs);
P(docs.length >= 2, 'doc-count', `doc 항목 ${docs.length}건 (기대 ≥2: 초기 '/' + '/?oauth=')`);
INFO('doc-nav-values', docs.map((d, i) => `#${i}: nav=${d.nav ?? 'MISSING'} url=${d.url}`).join(' | ') || '(없음)');

// 시나리오 자기검증 — oauth 코드 착지 문서가 실제로 doc 로그에 찍혔는가. useAuthBootstrap.js:16이
// replaceState *이전에* logDiag('doc',...)를 호출하므로 url에 '?oauth=probe-code'가 남아야 한다.
// 안 남으면 boot:oauth-ok가 있어도 "doc≥2"가 다른 이유(예: /?diag=1 재방문)로 우연히 채워진
// 것일 수 있다 — 판정 축이 대상과 독립인 함정(⑧ⓘ)을 막는다.
const oauthLandingDoc = docs.find(d => (d.url || '').includes('oauth=probe-code'));
P(!!oauthLandingDoc, 'target-oauth-landing-doc',
  `OAuth 코드 착지 문서가 doc 로그에 실제로 기록됐다 (url=${oauthLandingDoc?.url ?? 'MISSING'})`);

// 접지선 교차검증 — 앱 자신의 doc 로그 개수가 독립 카운터(브라우저 자체 navigation 발생 수)와
// 일치하는가. 어긋나면 로거가 빠뜨렸거나(무음 스킵) 중복 기록한 것이다.
bump('ground-truth');
P(groundLoads.length === docs.length, 'ground-truth-cross-check',
  `독립 접지선 로드 수=${groundLoads.length} vs 앱 자체 doc 로그=${docs.length} (${groundLoads.map(g => g.navType).join(',')})`);

// ── 2) rewind 항목 1건, base/len/delta/path 필드·값 출력 ─────────────
assertDomain('rewind', rewinds);
P(rewinds.length === 1, 'rewind-count', `rewind 항목 ${rewinds.length}건 (기대 정확히 1)`);
const r = rewinds[0] || {};
const rewindFieldsPresent = ['base', 'len', 'delta', 'path'].every(k => r[k] !== undefined);
P(rewindFieldsPresent, 'rewind-fields',
  `base=${r.base ?? 'MISSING'} len=${r.len ?? 'MISSING'} delta=${r.delta ?? 'MISSING'} path=${r.path ?? 'MISSING'}`);

// ── 3) boot 항목에 branch:"oauth-ok" 존재 ───────────────────────────
assertDomain('boot', boots);
P(boots.some(b => b.branch === 'oauth-ok'), 'boot-oauth-ok',
  `boot 항목 중 branch=oauth-ok 존재 (전체 branch 목록: ${boots.map(b => b.branch).join(',') || '(없음)'})`);

// ── 5) pageshow 존재/부재 — INFO만, 단언 없음(0건이 실패가 아니라 기준선) ────
bump('pageshow-domain', pageshows.length);
const persistedTrue = pageshows.filter(p => p.persisted === true);
INFO('pageshow-baseline',
  `pageshow 총 ${pageshows.length}건 · persisted=true ${persistedTrue.length}건(정상 기준선=0 — Playwright는 ` +
  `bfcache를 발동시킬 수 없다, task#246 3엔진 대조군 확정) · 상세: ${pageshows.map(p => `[persisted=${p.persisted},isTrusted=${p.isTrusted},hasToken=${p.hasToken},isLoggedIn=${p.isLoggedIn}]`).join(' ') || '(없음)'}`);

// ── 4) ?diag=1 오버레이 — 로그 전문 + 복사 버튼 ─────────────────────
// 같은 컨텍스트에서 이동 — localStorage는 문서 재요청을 넘어 보존되므로 지금까지 쌓인 로그가
// 오버레이에 그대로 보여야 한다(diag.js 계약: 링버퍼, sessionStorage 아님).
await page.goto(`${BASE}/?diag=1`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="diag-log-pre"]', { timeout: 10000 });
const overlayText = await page.locator('[data-testid="diag-log-pre"]').textContent().catch(() => null);
const copyBtnCount = await page.locator('button:has-text("로그 복사")').count();
await page.screenshot({ path: `${OUT}/2-diag-overlay.png` });

assertDomain('diag-overlay', overlayText ? [overlayText] : []);
P(!!overlayText && overlayText.length > 10, 'diag-overlay-content',
  `오버레이 로그 텍스트 길이=${overlayText?.length ?? 0}`);
P(copyBtnCount === 1, 'diag-overlay-copy-btn', `복사 버튼 개수=${copyBtnCount}`);
// 정체성 확인 — 오버레이가 "아무 로그"가 아니라 방금 쌓은 그 로그를 보여주는가.
P(!!overlayText && overlayText.includes('oauth-ok'), 'diag-overlay-shows-oauth-ok',
  `오버레이 텍스트에 'oauth-ok' 포함 여부=${overlayText?.includes('oauth-ok') ?? false}`);

// ── 콘솔 에러 — 계측이 앱을 죽이면 안 된다(diag.js 계약: 모든 함수 no-op 실패) ────
P(pageErrors.length === 0, 'no-page-errors', `콘솔 pageerror ${pageErrors.length}건: ${pageErrors.join(' | ') || '(없음)'}`);

INFO('경로', `URL 타임라인: ${trail.join(' → ')} → (?diag=1)`);

// ── 리포트 ──────────────────────────────────────────────────────
const asserts = results.filter(r => r.kind === 'assert');
const failed = asserts.filter(r => !r.ok);

console.log('\n=== task#284 — 진단 브레드크럼(diag_log) 정합성 실측 ===\n');
for (const r of results) {
  const mark = r.kind === 'assert' ? (r.ok ? 'PASS' : 'FAIL') : 'info';
  console.log(`[${mark}] ${r.tag} — ${r.msg}`);
}
console.log('\n--- 커버리지 ---');
console.log(Object.entries(cov).map(([k, v]) => `${k}:${v}`).join(' · '));
console.log(`단언 ${asserts.length}건 (PASS ${asserts.length - failed.length} · FAIL ${failed.length})`);
console.log(`스크린샷: ${OUT}`);
console.log(failed.length ? `\nFAIL ${failed.length}건` : `\nALL PASS ${asserts.length}/${asserts.length}`);

await ctx.close();
await browser.close();
process.exit(failed.length ? 1 : 0);
