// task#285 라이브 UAT — OAuth 되감기 착지(forward 잡음 절단) + 이탈~복귀 단일 스플래시.
//
// 대상 동작(커밋 a66a817):
//  A. markOAuthStart가 pushState(LANDING)로 forward 잡음을 절단한 *뒤에* 기준값을 기록한다
//     → 되감기 delta가 잡음 개수와 무관해진다.
//  B. 그 처방을 무효화하는 대조군(sessionStorage 저장값 +1 tamper)이 원래 실패(비-우리-오리진
//     착지)를 재현하는가 — 대조군 없인 A의 PASS가 판별력 없는 우연일 수 있다(⑧ⓔ).
//  C. 떠나기 직전(leaving)과 콜백 착지(landing) 스플래시가 픽셀 동일 — bfcache가 복원하는 건
//     "떠나기 직전 DOM"이므로 이 동일성이 성립해야 문서 전환이 화면상 안 보인다.
//  D. 로그인 후 뒤로가기 위생 — IdP로 안 나간다(≤2회 이내 이전 지점 이탈).
//  E. 구글 취소 후 복귀 — 로그인 폼이 돌아온다(Playwright는 bfcache를 못 태우므로 이건
//     "문서 재요청" 경로의 검증이다 — 미측정 라벨 부착, TESTING.md §7.4).
//  F. 착지 슬롯 URL == /reports.
//
// 하니스는 scripts/uat252-oauth-history.mjs의 가짜 IdP(2단계, location.replace 302 대체,
// serviceWorkers:'block', 실토큰 폼로그인)를 그대로 본뜬다. uat252는 건드리지 않는다.
//
// diag_log는 앱이 이미 무조건 기록한다(logDiag, ?diag=1 무관 — 렌더링만 그 쿠키에 의존한다).
// 그래서 별도 계측 스텁 없이 localStorage.diag_log를 착지 직후 우리 오리진에서 그대로 읽는다
// (크로스오리진 함정 — 회고 §7.2: "착지 직후 우리 오리진에서 읽는다").
//
// A4 리터럴 경고: 이 harness(가짜 IdP 2클릭 구조: pick→step2, consent→landing)는 실제 구글의
// 단일 동의 화면(302 collapse 1회)과 홉 수가 다르다 — 산수로 delta의 절대값을 미리 못박지 않고
// "junk가 있어도 delta가 junk-無 케이스와 같다"는 불변식으로 검증한다(before/after 같은 자,
// TESTING.md ⓚ). 절대값은 출력만 하고 단언에는 쓰지 않는다.
import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const IDP = 'https://fake-idp.test';
const START = 'https://probe-start.test';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat285';
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = 'test@portfolion.com';
const PASSWORD = 'test1234';

const results = [];
const cov = {};
const bump = (k, n = 1) => { cov[k] = (cov[k] || 0) + n; };
const P = (ok, tag, msg) => { results.push({ kind: 'assert', ok, tag, msg }); return ok; };
const INFO = (tag, msg) => results.push({ kind: 'info', tag, msg });
const UNMEASURED = (tag, msg) => results.push({ kind: 'unmeasured', tag, msg });
const die = (msg) => { console.error(`\n✗ 중단 — ${msg}`); process.exit(2); };

const html = (title, body) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;

const SENTINEL = html('start', '<h1>PROBE START</h1><p>로그인 이전 지점</p>');
const IDP1 = html('idp', '<h1>FAKE IDP</h1><a id="pick" href="/step2">계정 선택</a>');
const IDP2 = html('idp', `<h1>FAKE IDP</h1><a id="consent" href="${BASE}/?oauth=probe-code">동의</a>`);

// 대조군(축 B) — 처방만 무효화. oauth_hist_len에 대한 setItem 값을 +1 tamper해, 픽스 전
// 규칙(잡음이 기준값에 그대로 반영)과 동등한 off-by-N을 재현한다. 라이브를 되돌리지 않고
// addInitScript로만 처방을 무효화한다(TESTING.md ⓔ 처방-무효화형 대조군).
function CONTROL_PATCH() {
  const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    if (k === 'oauth_hist_len') return orig.call(this, k, String(Number(v) + 1));
    return orig.call(this, k, v);
  };
}

const readDiag = (page) =>
  page.evaluate(() => { try { return JSON.parse(localStorage.getItem('diag_log') || '[]'); } catch { return []; } });

// 로그인 화면인지 = 비밀번호 입력칸이 보이는지(#245 D4 — visible 필터 필수).
const snapshot = (page) => page.evaluate(() => {
  const vis = (el) => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const pw = [...document.querySelectorAll('input[type="password"]')].filter(vis);
  const splash = document.querySelector('.oauth-splash');
  return {
    loginForm: pw.length > 0,
    appShell: !!document.querySelector('.app-pc, .app-main, main.page-wrap'),
    hasToken: !!localStorage.getItem('access_token'),
    h1: document.querySelector('h1')?.textContent?.trim() || null,
    url: location.href,
    hasSplash: !!splash,
  };
});

const splashSnapshot = (page) => page.evaluate(() => {
  const el = document.querySelector('.oauth-splash');
  const pw = [...document.querySelectorAll('input[type="password"]')]
    .filter(e => e.offsetWidth || e.offsetHeight || e.getClientRects().length);
  return {
    hasSplash: !!el,
    outerHTML: el ? el.outerHTML : null,
    bg: el ? getComputedStyle(el).backgroundColor : null,
    color: el ? getComputedStyle(el).color : null,
    hasPassword: pw.length > 0,
  };
});

// 육안 캡처는 부수 산출물이지 판정축이 아니다 — 폰트 로드 대기(외부 CDN) 등으로 걸리면 전체
// 프로브가 죽지 않도록 짧은 타임아웃 + best-effort로 감싼다.
const snap = async (page, path, timeout = 8000) => {
  try { await page.screenshot({ path, timeout }); }
  catch (e) { INFO('스크린샷실패', `${path}: ${e.message.split('\n')[0]}`); }
};

// 도구 한계(신규 실측) — page.screenshot()은 "프레임이 안정될 때까지" 내부적으로 대기하는데,
// location.href 대입으로 진행 중인 내비게이션이 있으면 그 대기가 **네비게이션이 끝날 때까지
// 절대 안 풀린다**(never-resolve 라우트로 대조 확인 — 8초를 줘도 계속 타임아웃). 반면 raw CDP
// `Page.captureScreenshot`은 그 내부 대기 래퍼를 안 거쳐 즉시(수십 ms) 캡처된다(같은 상황에서
// 대조 확인). "떠나기 직전" 프레임처럼 진행 중인 내비게이션과 겹치는 캡처는 이 경로가 필수.
const snapCDP = async (ctx, page, path) => {
  try {
    const cdp = await ctx.newCDPSession(page);
    const result = await Promise.race([
      cdp.send('Page.captureScreenshot', { format: 'png' }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('CDP_SCREENSHOT_TIMEOUT')), 4000)),
    ]);
    fs.writeFileSync(path, Buffer.from(result.data, 'base64'));
  } catch (e) {
    INFO('스크린샷실패', `${path}: ${e.message.split('\n')[0]}`);
  }
};

const waitSettle = async (page) => {
  await Promise.race([
    page.waitForSelector('.app-pc, .app-main, main.page-wrap', { timeout: 15000 }).catch(() => null),
    page.waitForFunction(() => document.querySelector('h1')?.textContent === 'FAKE IDP', { timeout: 15000 }).catch(() => null),
    page.waitForTimeout(15000),
  ]);
  await page.waitForTimeout(600);
};

// ── 실토큰 확보(폼 로그인, uat252와 동형) ─────────────────────────
const browser = await chromium.launch();
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

const installRoutes = async (ctx, { googleDelay = 0, tokenDelay = 0 } = {}) => {
  await ctx.route(`${START}/**`, r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: SENTINEL }));
  await ctx.route(`${IDP}/step1`, r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: IDP1 }));
  await ctx.route(`${IDP}/step2`, r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: IDP2 }));
  // route.fulfill의 302는 후속 요청이 라우팅을 안 탄다(실측, uat252 주석) → location.replace로
  // 떠나는 200 문서를 준다. googleDelay는 "떠나기 직전 DOM"을 관측할 창을 인위로 벌린다.
  await ctx.route('**/api/auth/oauth/google', async r => {
    if (googleDelay) await new Promise(res => setTimeout(res, googleDelay));
    await r.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: html('redirect', `<script>location.replace(${JSON.stringify(`${IDP}/step1`)})</script>`),
    });
  });
  await ctx.route('**/api/auth/oauth/token*', async r => {
    if (tokenDelay) await new Promise(res => setTimeout(res, tokenDelay));
    await r.fulfill({ contentType: 'application/json', body: JSON.stringify(tokens) });
  });
};

// ══════════════════════════════════════════════════════════════════
// MAIN ARM — 잡음 주입 + 처방 정상 동작. 축 A(착지)·C(스플래시)·D(위생)·F(URL)를 여기서 다 잰다.
// ══════════════════════════════════════════════════════════════════
const runMain = async () => {
  const label = '본진';
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
  await installRoutes(ctx, { googleDelay: 700, tokenDelay: 600 });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  const trail = [];

  await page.goto(`${START}/`, { waitUntil: 'domcontentloaded' });
  let s = await snapshot(page);
  trail.push(s.url);
  if (s.h1 !== 'PROBE START') die(`센티넬 대상이 아니다 (h1=${s.h1})`);
  P(true, `${label}/대상유효성-센티넬`, `로그인 이전 지점이 실재한다 (h1="PROBE START")`);
  bump('대상유효성');

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="password"]', { timeout: 20000 });
  trail.push(page.url());

  // ── C3: 일반 로드에는 스플래시가 뜨지 않는다 ──
  // ⚠️ #oauth-splash(id)는 #root의 자식이라 React 마운트가 #root 전체를 갈아치우며 **사라진다**
  // (실측: 로그인 폼이 뜬 뒤 getElementById('oauth-splash')는 이미 null — hidden 속성 점검은
  // React 마운트 *전* 창에서만 유효한 질문이라 이 시점엔 공허하다). 실제로 의미 있는 불변식은
  // "마운트 후 화면에 .oauth-splash 마크업(실제 스플래시 클래스)이 아예 없다"이다.
  const general = await snapshot(page);
  P(general.hasSplash === false, `${label}/C3-일반로드무스플래시`,
    `일반 로드(쿼리 없음)·마운트 후: .oauth-splash 존재=${general.hasSplash} (want false)`);
  bump('C3');

  // ── 축 A/B 전제: forward 잡음 1개를 만든다(pushState 후 goBack) ──
  await page.evaluate(() => { history.pushState({}, '', location.href); });
  await page.goBack();
  await page.waitForTimeout(300);
  await page.waitForSelector('input[type="password"]', { timeout: 10000 }); // 여전히 로그인 화면
  bump('잡음주입');

  // ── C1: 떠나기 직전(leaving) — 클릭 직후, 이동 전 DOM ──
  // 함정(실측, 디버그 트레이스로 확정): Playwright의 locator.click()은 클릭이 트리거한
  // 내비게이션이 실질적으로 끝날 때까지(googleDelay 700ms + replace 왕복) 그 *click() 자체가
  // 반환되지 않는다 — click() 이후에 여는 어떤 evaluate/waitForFunction도 항상 "이미 이동한 뒤"에야
  // 실행된다(실측: click()이 t=737ms에야 resolve, 그 사이 evaluate는 전부 context-destroyed 또는
  // IDP1 착지 후). 그래서 "클릭"과 "직후 DOM 읽기"를 **같은 동기 evaluate 안**에 넣어 네트워크
  // 왕복이 시작되기도 전에(진짜 button.click() → flushSync 커밋 → location.href 대입은 전부
  // 동기) 스냅숏을 뜬다 — 비동기 경계를 아예 만들지 않는 방법.
  const leaving = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Google로 계속');
    if (!btn) return { err: 'BUTTON_NOT_FOUND' };
    btn.click();
    const el = document.querySelector('.oauth-splash');
    const pw = [...document.querySelectorAll('input[type="password"]')]
      .filter(e => e.offsetWidth || e.offsetHeight || e.getClientRects().length);
    return {
      hasSplash: !!el, outerHTML: el ? el.outerHTML : null,
      bg: el ? getComputedStyle(el).backgroundColor : null, color: el ? getComputedStyle(el).color : null,
      hasPassword: pw.length > 0,
    };
  }).catch(e => ({ err: e.message.split('\n')[0] }));
  await snapCDP(ctx, page, `${OUT}/1-leaving-splash.png`); // 진행 중 내비게이션과 겹치므로 raw CDP 경로(위 주석)
  P(!!(leaving && leaving.hasSplash) && !leaving?.hasPassword, `${label}/C1-떠나기직전스플래시`,
    `클릭 직후·이동 전 DOM(동기 read): splash=${leaving?.hasSplash} password=${leaving?.hasPassword} err=${leaving?.err ?? 'none'}`);
  bump('C1');

  await page.waitForURL(`${IDP}/step1`, { timeout: 20000 });
  const i1 = await snapshot(page);
  trail.push(i1.url);
  if (i1.h1 !== 'FAKE IDP') die(`가짜 IdP 대상이 아니다 (h1=${i1.h1})`);
  P(true, `${label}/대상유효성-IdP`, `IdP 자리를 실제로 밟았다 (h1="FAKE IDP", ${i1.url})`);
  bump('대상유효성');

  await page.click('#pick');
  await page.waitForURL(`${IDP}/step2`, { timeout: 20000 });
  trail.push(page.url());

  await page.click('#consent');
  // ── C2: 콜백 문서(landing) 착지 — authLoading 창 안 스플래시 ──
  // 단일 evaluate는 "새 문서가 아직 안정되지 않은 순간"과 부딛히면 컨텍스트 파괴로 크래시한다
  // (1·2차 실행 실측). waitForFunction은 내비게이션을 넘나들며 재시도하도록 설계돼 있어 그
  // 경계를 안전하게 넘는다 — 조건이 참이 될 때까지 폴링하고 그 참인 스냅숏을 전역에 남긴다.
  const landing1 = await page.waitForFunction(() => {
    const el = document.querySelector('.oauth-splash');
    if (!el) return false;
    window.__uat285_landing1 = {
      hasSplash: true,
      outerHTML: el.outerHTML,
      bg: getComputedStyle(el).backgroundColor,
      color: getComputedStyle(el).color,
    };
    return true;
  }, { timeout: 8000 }).then(() => page.evaluate(() => window.__uat285_landing1)).catch(() => null);
  await snap(page, `${OUT}/2-callback-splash.png`);

  P(!!(landing1 && landing1.hasSplash), `${label}/C2-콜백문서스플래시`,
    `콜백 착지 authLoading 창: splash=${landing1?.hasSplash} (outerHTML길이=${landing1?.outerHTML?.length ?? 'null'})`);
  bump('C2');

  // ── C4: 쌍둥이 동일성 — leaving과 landing의 스플래시가 픽셀 동일 ──
  const twinHtml = !!leaving?.hasSplash && !!landing1?.hasSplash && leaving.outerHTML === landing1.outerHTML;
  const twinStyle = !!leaving?.hasSplash && !!landing1?.hasSplash && leaving.bg === landing1.bg && leaving.color === landing1.color;
  P(twinHtml, `${label}/C4-쌍둥이outerHTML동일`,
    `leaving.outerHTML===landing.outerHTML → ${twinHtml} (leaving길이=${leaving?.outerHTML?.length ?? 'null'}, landing길이=${landing1?.outerHTML?.length ?? 'null'})`);
  P(twinStyle, `${label}/C4-쌍둥이computed동일`,
    `bg: leaving=${leaving?.bg} landing=${landing1?.bg} · color: leaving=${leaving?.color} landing=${landing1?.color}`);
  bump('C4', 2);

  await page.waitForFunction(() => !!localStorage.getItem('access_token'), { timeout: 30000 });
  await page.waitForSelector('.app-pc, .app-main, main.page-wrap', { timeout: 30000 });
  const landed = await snapshot(page);
  trail.push(landed.url);
  await snap(page, `${OUT}/3-rewind-landing.png`);

  // ── 진단 로그(우리 오리진에서 착지 직후 즉시 읽는다 — 크로스오리진 함정 회피) ──
  const log = await readDiag(page);
  const oauthStart = log.filter(e => e.ev === 'oauth-start');
  const rewinds = log.filter(e => e.ev === 'rewind');
  const bootOk = log.filter(e => e.ev === 'boot' && e.branch === 'oauth-ok');
  const bootAll = log.filter(e => e.ev === 'boot');
  const docs = log.filter(e => e.ev === 'doc');

  // A3 — junk 도메인 sentinel: 잡음을 만들지 못했으면 축 A 전체가 공허하다.
  const junk = oauthStart[0]?.junk;
  P(typeof junk === 'number' && junk >= 1, `${label}/A3-잡음도메인`,
    `oauth-start.junk=${junk ?? 'MISSING'} (junk<1이면 잡음 주입 실패 — 축 A 공허)`);
  bump('A3');

  // A1 — 착지 오리진이 우리 것, 특히 /api/auth/oauth/google이 아니다.
  const onOurOrigin = landed.url.startsWith(BASE);
  const onGoogleStub = landed.url.includes('/api/auth/oauth/google');
  P(onOurOrigin && !onGoogleStub, `${label}/A1-착지오리진`,
    `착지 url=${landed.url} (우리오리진=${onOurOrigin}, google스텁=${onGoogleStub})`);
  bump('A1');

  // A2 — OAuth 왕복 정확히 1회.
  P(rewinds.length === 1, `${label}/A2-rewind1회`, `rewind 로그 ${rewinds.length}건 (want 1)`);
  P(bootOk.length === 1, `${label}/A2-oauthok1회`, `boot{oauth-ok} ${bootOk.length}건 (want 1) · boot 전체 ${bootAll.length}건`);
  bump('A2', 2);

  // A4 — path==='go' + delta 출력(리터럴 대신 "junk가 반영 안 됨"을 그대로 노출).
  const rw = rewinds[0] || {};
  const oldRuleWouldBe = typeof rw.delta === 'number' && typeof junk === 'number' ? rw.delta - junk : null;
  P(rw.path === 'go', `${label}/A4-되감기경로`,
    `rewind.path=${rw.path} (want 'go' — 'replace'면 되감기가 포기하고 폴백한 것)`);
  INFO(`${label}/A4-delta수치`,
    `실측 delta=${rw.delta} · base=${rw.base} · len=${rw.len} · junk=${junk} · 옛규칙이면(delta-junk)=${oldRuleWouldBe} (참고 출력, 리터럴 미단언)`);
  bump('A4');

  INFO(`${label}/진단로그커버리지`, `doc ${docs.length}건 · oauth-start ${oauthStart.length}건 · rewind ${rewinds.length}건 · boot ${bootAll.length}건(oauth-ok ${bootOk.length})`);
  INFO(`${label}/경로`, `URL 타임라인: ${trail.join(' → ')}`);

  // ── 축 D: 뒤로가기 위생 — 매 착지가 IdP 아님, 2회 이내 이전 지점 이탈 ──
  const MAX_BACK = 2;
  const backs = [];
  for (let i = 0; i < MAX_BACK; i++) {
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null);
    await page.waitForTimeout(1200);
    const b = await snapshot(page);
    backs.push(b);
    trail.push(b.url);
    if (b.h1 === 'PROBE START') break;
  }
  const idpHits = backs.filter(b => b.url.startsWith(IDP));
  P(idpHits.length === 0, `${label}/D1-IdP아님`,
    `뒤로가기 착지 ${backs.length}회 모두 IdP가 아니다 (${backs.map(b => b.url).join(' → ')})`);
  const last = backs[backs.length - 1];
  P(last?.h1 === 'PROBE START', `${label}/D2-이전지점복귀`,
    `뒤로가기 ${backs.length}회(상한 ${MAX_BACK}) 이내 로그인 이전 지점 이탈 (h1=${last?.h1})`);
  bump('D', 2);

  P(pageErrors.length === 0, `${label}/콘솔에러없음`, `pageerror ${pageErrors.length}건 ${pageErrors.slice(0, 3).join(' | ')}`);
  bump('콘솔');

  await ctx.close();
  return { rewinds, bootOk, landed, junk, delta: rw.delta };
};

// ══════════════════════════════════════════════════════════════════
// FLOW1 (URL 슬롯 F1) — MAIN과 별개 컨텍스트로, 랜딩 URL 경로만 정밀 확인.
// (본진 아치는 goBack까지 진행해 URL이 이동하므로, "착지 직후" 시점을 별도로 깨끗하게 잰다)
// ══════════════════════════════════════════════════════════════════
const runUrlSlot = async () => {
  const label = 'URL슬롯';
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
  await installRoutes(ctx);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="password"]', { timeout: 20000 });
  await page.locator('button:has-text("Google로 계속"):visible').first().click();
  await page.waitForURL(`${IDP}/step1`, { timeout: 20000 });
  await page.click('#pick');
  await page.waitForURL(`${IDP}/step2`, { timeout: 20000 });
  await page.click('#consent');
  await page.waitForFunction(() => !!localStorage.getItem('access_token'), { timeout: 30000 });
  await page.waitForSelector('.app-pc, .app-main, main.page-wrap', { timeout: 30000 });
  await page.waitForTimeout(400);
  const u = new URL(page.url());
  P(u.pathname === '/reports', `${label}/F1-착지슬롯경로`, `착지 pathname=${u.pathname} (want /reports)`);
  bump('F1');
  await ctx.close();
};

// ══════════════════════════════════════════════════════════════════
// CONTROL ARM (축 B) — 처방만 무효화(저장 기준값 +1 tamper). 잡음 주입은 MAIN과 동일.
// ══════════════════════════════════════════════════════════════════
const runControl = async () => {
  const label = '대조군';
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(CONTROL_PATCH);
  await installRoutes(ctx);
  const page = await ctx.newPage();
  const trail = [];

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="password"]', { timeout: 20000 });
  trail.push(page.url());

  await page.evaluate(() => { history.pushState({}, '', location.href); });
  await page.goBack();
  await page.waitForTimeout(300);
  await page.waitForSelector('input[type="password"]', { timeout: 10000 });

  await page.locator('button:has-text("Google로 계속"):visible').first().click();
  await page.waitForURL(`${IDP}/step1`, { timeout: 20000 });
  trail.push(page.url());
  if ((await snapshot(page)).h1 !== 'FAKE IDP') die('대조군: 가짜 IdP 대상 아님');

  await page.click('#pick');
  await page.waitForURL(`${IDP}/step2`, { timeout: 20000 });
  trail.push(page.url());
  await page.click('#consent');
  // ⚠️ 처방이 무효화되면 되감기가 즉시(1초 내) 실행돼 IDP1로 재착지한다(실측, 디버그 트레이스로
  // 확인) — 그 문서는 우리 오리진이 아니므로 access_token을 기다리면 원리적으로 타임아웃한다.
  // 그래서 "app-shell 또는 IdP 재착지" 둘 중 하나를 레이스로 기다린다(waitSettle).
  await waitSettle(page);
  const landed = await snapshot(page);
  trail.push(landed.url);
  await snap(page, `${OUT}/control-landing.png`);

  const log = await readDiag(page).catch(() => []); // IdP 착지면 우리 오리진이 아니라 빈 배열일 수 있음(정상)
  const rewinds = log.filter(e => e.ev === 'rewind');
  const bootOk = log.filter(e => e.ev === 'boot' && e.branch === 'oauth-ok');
  const junk = log.find(e => e.ev === 'oauth-start')?.junk;

  const onIdp = landed.url.startsWith(IDP);
  const onOurOrigin = landed.url.startsWith(BASE);
  const onGoogleStub = landed.url.includes('/api/auth/oauth/google');
  const reproduced = onIdp || !onOurOrigin || onGoogleStub;

  // B1 — 원래 실패 지문을 재현한다(=이 프로브가 실패를 관측할 수 있다). PASS는 "관측가능성"이다.
  // OR 3항이므로 각 항의 실측치를 전부 싣는다(TESTING.md ⓕ — 어느 항으로 통과했는지 알아야 한다).
  P(reproduced, `${label}/B1-관측가능성`,
    `처방 무효화 시 실패 지문 재현 (url=${landed.url}, onIdp=${onIdp} · onOurOrigin부정=${!onOurOrigin} · onGoogleStub=${onGoogleStub}) — reproduced=${reproduced}`);
  bump('B1');

  INFO(`${label}/수치`,
    `rewind ${rewinds.length}건(delta=${rewinds[0]?.delta ?? 'N/A'}) · boot{oauth-ok} ${bootOk.length}건 · junk=${junk ?? 'N/A(다른오리진일 수 있음)'} · 착지=${landed.url}`);
  INFO(`${label}/경로`, `URL 타임라인: ${trail.join(' → ')}`);

  await ctx.close();
  return { reproduced, landed };
};

// ══════════════════════════════════════════════════════════════════
// CANCEL ARM (축 E) — IdP 1단계까지 간 뒤 동의 없이 뒤로가기. 토큰 없음 → 로그인 폼 복귀.
// (Playwright는 bfcache를 못 태우므로 이건 "문서 재요청" 경로의 검증 — 미측정 라벨 부착)
// ══════════════════════════════════════════════════════════════════
const runCancel = async () => {
  const label = '취소복귀';
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
  await installRoutes(ctx);
  const page = await ctx.newPage();

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="password"]', { timeout: 20000 });
  await page.locator('button:has-text("Google로 계속"):visible').first().click();
  await page.waitForURL(`${IDP}/step1`, { timeout: 20000 });
  if ((await snapshot(page)).h1 !== 'FAKE IDP') die('취소복귀: 가짜 IdP 대상 아님');

  // 동의하지 않고 이탈 — 뒤로가기.
  await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null);
  await page.waitForTimeout(1200);
  const back = await snapshot(page);
  await snap(page, `${OUT}/4-cancel-return-login.png`);

  P(!back.hasToken, `${label}/전제-토큰없음`, `취소 경로엔 토큰이 없어야 한다 (hasToken=${back.hasToken})`);
  P(back.loginForm, `${label}/E1-로그인폼복귀`,
    `취소 후 뒤로가기 착지: loginForm=${back.loginForm}, splash=${back.hasSplash}, url=${back.url}`);
  bump('E1');

  await ctx.close();
};

// ── 실행 ────────────────────────────────────────────────────────
const mainResult = await runMain();
await runUrlSlot();
const controlResult = await runControl();
await runCancel();

UNMEASURED('bfcache 복원 자체',
  'Playwright는 bfcache를 발동시킬 수 없다(TESTING.md §7.4, chromium·webkit·firefox 3엔진 대조군 확정). ' +
  '위 되감기·취소복귀 PASS는 모두 "문서 재실행(리로드)" 경로만 실측한다 — leaving↔landing 스플래시의 ' +
  '픽셀 동일성(C4)은 그 리로드/재요청 프레임에도 적용되는 방어선이지만, bfcache 복원 프레임 자체의 ' +
  '동일성은 이 도구로 원리적으로 측정 불가.');
UNMEASURED('모바일 뷰포트',
  'leaving/landing 스플래시 분기(LoginPage.jsx `if(leaving)`, App.jsx `authLoading`)는 isMobile 분기보다 ' +
  '먼저 평가되고 스플래시 CSS는 position:fixed;inset:0로 뷰포트 무관이라 PC 단일 뷰포트로만 검증했다. ' +
  '되감기 히스토리 로직도 순수 JS(history API)로 CSS 미디어쿼리와 무관하다.');

// ── 리포트 ──────────────────────────────────────────────────────
const asserts = results.filter(r => r.kind === 'assert');
const failed = asserts.filter(r => !r.ok);
const unmeasured = results.filter(r => r.kind === 'unmeasured');

console.log('\n=== task#285 — OAuth 되감기 착지 + 이탈~복귀 단일 스플래시 ===\n');
for (const r of results) {
  const mark = r.kind === 'assert' ? (r.ok ? 'PASS' : 'FAIL') : (r.kind === 'unmeasured' ? '미측정' : 'info');
  console.log(`[${mark}] ${r.tag} — ${r.msg}`);
}
console.log('\n--- 커버리지 ---');
for (const [k, v] of Object.entries(cov)) console.log(`${k}:${v}`);
console.log(`\n단언 ${asserts.length}건 (PASS ${asserts.length - failed.length} · FAIL ${failed.length}) · 미측정 ${unmeasured.length}건`);
console.log(`판별력: 본진 착지=${mainResult.landed.url} vs 대조군 재현여부=${controlResult.reproduced} (착지=${controlResult.landed.url})`);
console.log(`스크린샷: ${OUT}`);

await browser.close();
process.exit(failed.length ? 1 : 0);
