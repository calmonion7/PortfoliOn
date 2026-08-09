// task#283 라이브 UAT — bfcache 인증 불일치 가드가 전체 리로드(location.replace) 대신
// 같은 문서 안에서 상태를 뒤집고 forward(IdP 엔트리)를 잘라내는지 실측한다.
// Source of truth: ADR-0035, .forge/plan.md(task#283) — useBfcacheAuthGuard.js가
// `persisted===true`+토큰불일치일 때 `location.replace('/')`를 완전히 제거하고
// `pushState(현재URL)+back()`(로그인 방향에 한함) + `flushSync(resolveSession(...))`로
// 교체했는지를 가짜 IdP 하니스 위에서 확인한다.
//
// ⚠️ 실행 시점 주의 — 이 스크립트는 구현(useBfcacheAuthGuard.js 수정 + App.jsx 재배선)이
// 라이브에 배포되기 *전에* 저작됐다. 지금 돌리면 FAIL한다 — 그게 red-first 증거이지 결함이 아니다.
//
// ── 설계상 이탈(왜 문자 그대로 "동의 클릭 → 실제 토큰교환 → 실제 되감기"를 끝까지 안 밀어붙이는가) ──
// 실제 returnFromOAuth()의 history.go(-delta)는 오리진은 같지만 **다른 문서**(?oauth=code 랜딩
// 문서)에서 호출된다. 그 착지 엔트리(로그인 문서 슬롯)로의 이동은 그래서 반드시 **교차문서 이동**
// 이고, 그 슬롯 URL(`/`)은 no-store다. Playwright는 자동화 델리게이트라 bfcache를 항상 비활성화
// 하므로(task#246, CLAUDE.md 가토⑤·TESTING.md §7.4 — 3엔진 전부 대조군으로 확정) 그 슬롯은
// **항상 네트워크 재요청**으로 로드된다 — 새 문서가 토큰을 가진 채로 처음부터 깨끗하게 마운트되어
// isLoggedIn과 hasToken이 **이미 일치한 채로** 시작한다. 즉 실제 흐름을 끝까지 밀어붙이면 가드의
// 불일치 분기가 발동할 기회가 원리적으로 없다 — 이게 정확히 task#246이 말하는 한계다.
// ADR-0035 자신의 검증 전략도 이렇게 갈라놓는다 — "① 가짜 IdP 하니스로 *진짜 히스토리*를 세운 뒤
// ② *합성* pageshow로 가드를 발동시켜 ③ 실측한다."
//
// 그래서 이 프로브는 두 단계를 분리한다:
//   1) 구글 버튼을 실제로 클릭하고 가짜 IdP 2단계를 실제로 밟아 **진짜 forward 히스토리**
//      (fake-idp.test 엔트리 2개)를 만든다 — 단 "동의"는 누르지 않는다(누르면 위에서 설명한
//      대로 실제 되감기가 실행돼 항상-일치 상태로 착지해버린다). 대신 우리가 직접 goBack()을
//      2회 호출해 로그인 URL 슬롯으로 돌아간다. 그 슬롯도 `/`(no-store)라 실제 재요청이 일어나고
//      **깨끗한 새 문서**(토큰 없음·session=null·로그인 화면, 레이스 없음 — 토큰이 아예 없으므로
//      결정적)가 뜬다. forward에는 방금 만든 진짜 IdP 엔트리 2개가 그대로 남는다(traversal은
//      forward를 지우지 않는다 — 지우는 건 pushState/replaceState 같은 *새 엔트리 생성*뿐).
//   2) 이 문서 위에서 토큰을 **직접 localStorage에 기록**한다(다른 문서가 대신 써준 것을 흉내
//      낸다 — 이 앱엔 storage 이벤트 동기화가 없으므로 이 문서의 React 상태는 그대로
//      isLoggedIn=false로 남는다, CLAUDE.md "다중 탭 세션 동기화" 기존 성질). 이제
//      hasToken≠isLoggedIn — 실제 bfcache 복원이 만드는 것과 **똑같은 입력**이다. 여기서 합성
//      pageshow(persisted:true)를 쏘면 가드가 실제로 무엇을 하는지 실측된다.
//
// 폼 로그인으로 얻은 **실토큰**을 쓰는 이유는 uat252/253과 같다 — 가짜 토큰이면 Reports 진입 후
// 실제 API 호출이 401을 받아 api.js 인터셉터가 replace('/')를 실행해버려, 되감기와 무관한
// 리로드가 doc-loads에 섞인다.
//
// 판정 2축(⑧ⓖ): 목표(doc-swap·report-rendered·forward-pruned·back-exits)는 항상 검사하고,
// 메커니즘(실 persisted&&isTrusted 관측)은 커버리지로 별도 보고한다.
// 대상 유효성(⑧ⓘ): 센티넬·가짜IdP·착지 문서의 고유 마커를 판정축보다 먼저 확인하고 어긋나면 즉시
// die(). 리포트 화면 마커는 `.reports-layout`(Reports.jsx에만 존재 — grep으로 확인, LoginPage에는
// 없다) + 로그인폼(input[type=password]) 부재를 함께 쓴다.
// 대조군(ⓚ②): 라이브 코드를 되돌리지 않고 같은 실행·같은 프로브에서 처방(합성 pageshow)만
// `location.replace('/')` 직접 호출로 무효화한다. `CONTROL=1`이면 그 단독 실행만, 아니면
// 처방+대조군을 한 번에 돈다(uat252 방식 — 판별력을 매 실행 자동 확인).
import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const IDP = 'https://fake-idp.test';
const START = 'https://probe-start.test';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat283';
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = 'test@portfolion.com';
const PASSWORD = 'test1234';

const results = [];
const P = (ok, tag, msg) => results.push({ kind: 'assert', ok, tag, msg });
const INFO = (tag, msg) => results.push({ kind: 'info', tag, msg });
const cov = {};
const bump = (k, n = 1) => { cov[k] = (cov[k] || 0) + n; };

const die = (msg) => { console.error(`\n✗ 중단 — ${msg}`); process.exit(2); };

const html = (title, body) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;

const SENTINEL = html('start', '<h1>PROBE START</h1><p>로그인 이전 지점</p>');
const IDP1 = html('idp', '<h1>FAKE IDP</h1><a id="pick" href="/step2">계정 선택</a>');
const IDP2 = html('idp', '<h1>FAKE IDP</h1><a id="consent" href="#">동의(누르지 않음)</a>');

// 이빨 단언 — 세 오리진이 서로 다름(합성 오리진 상수를 잘못 겹쳐 쓰면 판정이 공허해진다).
bump('target-validity');
P(new Set([BASE, IDP, START]).size === 3, '오리진-이빨',
  `대상 오리진 3개가 서로 다름: ${BASE} / ${IDP} / ${START}`);

// 문서마다 심는 계측기. sessionStorage는 오리진·탭 스코프라 교차문서(재요청)에도 살아남는다.
//  · doc-loads: 문서가 새로 로드될 때마다 +1 — "문서 교체가 일어났는가"의 직접 측정.
//  · real-bfcache: 우리가 아닌 브라우저가 실제로 쏜 persisted pageshow만 셈(isTrusted 필터 —
//    합성 dispatchEvent는 isTrusted=false이므로 이 필터가 자동으로 자기 자극을 배제한다, task#245 D).
//  · history-go 호출 로그 — 이 가드는 history.go를 쓰지 않지만(pushState+back), 배선 확인용으로 남긴다.
const INIT = `
(() => {
  try {
    const DK = '__uat283_doc_loads';
    sessionStorage.setItem(DK, String(Number(sessionStorage.getItem(DK) || '0') + 1));
    const BK = '__uat283_real_bfcache';
    window.addEventListener('pageshow', (e) => {
      if (e.persisted && e.isTrusted) {
        sessionStorage.setItem(BK, String(Number(sessionStorage.getItem(BK) || '0') + 1));
      }
    });
    const HK = '__uat283_history_go';
    const goOrig = history.go.bind(history);
    history.go = (delta) => {
      const a = JSON.parse(sessionStorage.getItem(HK) || '[]');
      a.push(delta); sessionStorage.setItem(HK, JSON.stringify(a));
      return goOrig(delta);
    };
  } catch {}
})();
`;

const readDocLoads = (page) => page.evaluate(() => Number(sessionStorage.getItem('__uat283_doc_loads') || '0'));
const readRealBfcache = (page) => page.evaluate(() => Number(sessionStorage.getItem('__uat283_real_bfcache') || '0'));
const readHistoryGoCalls = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('__uat283_history_go') || '[]'));

// 로그인 화면인지 = 비밀번호 입력칸이 보이는지(#245 D4 — visible 필터 필수, PC/모바일 DOM 공존).
// 리포트 화면인지 = `.reports-layout`(Reports.jsx에만 존재 — grep 확인: LoginPage.jsx엔 없다).
const snapshot = (page) => page.evaluate(() => {
  const vis = (el) => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const pw = [...document.querySelectorAll('input[type="password"]')].filter(vis);
  return {
    loginForm: pw.length > 0,
    reportsMarker: !!document.querySelector('.reports-layout'),
    appShell: !!document.querySelector('.app-pc, .app-main, main.page-wrap'),
    hasToken: !!localStorage.getItem('access_token'),
    h1: document.querySelector('h1')?.textContent?.trim() || null,
    url: location.href,
    origin: location.origin,
    historyLength: history.length,
  };
});

const browser = await chromium.launch();

// ── 실토큰 확보(폼 로그인, uat252/253과 동일 패턴) ────────────────
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
INFO('전제/실토큰', '폼 로그인으로 access/refresh 확보 (가짜 토큰의 401 오염 회피 — uat252/253과 동일 이유)');

// ── 진짜 forward 히스토리를 만들고 로그인 슬롯으로 깨끗하게 재착지 ──
const buildPristineLoginWithForwardHistory = async (ctx) => {
  const page = await ctx.newPage();
  const trail = [];

  await page.goto(`${START}/`, { waitUntil: 'domcontentloaded' });
  const s0 = await snapshot(page);
  trail.push(s0.url);
  if (s0.h1 !== 'PROBE START') die(`센티넬 대상이 아니다 (h1=${s0.h1})`);

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="password"]', { timeout: 20000 });
  trail.push(page.url());

  await page.locator('button:has-text("Google로 계속"):visible').first().click();
  await page.waitForURL(`${IDP}/step1`, { timeout: 20000 });
  const i1 = await snapshot(page);
  trail.push(i1.url);
  if (i1.h1 !== 'FAKE IDP') die(`가짜 IdP(1단계) 대상이 아니다 (h1=${i1.h1})`);

  await page.click('#pick');
  await page.waitForURL(`${IDP}/step2`, { timeout: 20000 });
  const i2 = await snapshot(page);
  trail.push(i2.url);
  if (i2.h1 !== 'FAKE IDP') die(`가짜 IdP(2단계) 대상이 아니다 (h1=${i2.h1})`);

  // ⚠️ "동의"는 누르지 않는다 — 위 헤더 설명대로, 누르면 실제 토큰교환+되감기가 실행돼 항상
  // 일치 상태로 착지해버려 이후 불일치 분기 테스트가 공허해진다. 대신 우리가 직접 되감는다.
  await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null); // idp2 -> idp1
  await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null); // idp1 -> 로그인 슬롯(재요청)
  await page.waitForSelector('input[type="password"]', { timeout: 20000 });
  const landed = await snapshot(page);
  trail.push(landed.url);

  return { page, trail, landed };
};

// ── 한 arm 실행 ─────────────────────────────────────────────────
const run = async (label, control) => {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(INIT);
  await ctx.route(`${START}/**`, r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: SENTINEL }));
  await ctx.route(`${IDP}/step1`, r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: IDP1 }));
  await ctx.route(`${IDP}/step2`, r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: IDP2 }));
  // 302 대신 location.replace로 떠나는 HTML을 fulfill — route.fulfill의 302는 후속 요청이
  // 인터셉트되지 않아 DNS 실패로 끝난다(task#252 실측, TESTING.md §7.2).
  await ctx.route('**/api/auth/oauth/google', r => r.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: html('redirect', `<script>location.replace(${JSON.stringify(`${IDP}/step1`)})</script>`),
  }));

  const { page, trail, landed } = await buildPristineLoginWithForwardHistory(ctx);
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  // 대상 유효성(⑧ⓘ) — 착지가 깨끗한 로그인 화면(토큰 없음)이어야 이후 단언이 의미를 갖는다.
  // 전제가 무너지면 sentinel 없이 즉시 die() — "틀린 대상 위에서 ALL PASS"를 막는다.
  bump('target-validity');
  P(landed.loginForm && !landed.hasToken && !landed.reportsMarker,
    `${label}/대상유효성-착지`,
    `로그인 슬롯 재착지가 깨끗하다 (loginForm=${landed.loginForm}, hasToken=${landed.hasToken}, reportsMarker=${landed.reportsMarker}, url=${landed.url})`);
  if (!(landed.loginForm && !landed.hasToken)) die(`${label}: 착지 전제가 깨졌다 — 이후 단언이 무의미하다`);

  const before = await readDocLoads(page);
  const histBefore = await page.evaluate(() => history.length);

  // 다른 문서가 대신 써준 토큰을 흉내낸다 — storage 이벤트 동기화가 없으므로(CLAUDE.md 기존
  // 성질) 이 문서의 React 상태(session=null)는 그대로다. 이제 hasToken≠isLoggedIn.
  await page.evaluate(([a, r]) => {
    localStorage.setItem('access_token', a);
    localStorage.setItem('refresh_token', r);
  }, [tokens.access_token, tokens.refresh_token]);

  if (control) {
    // 대조군 — 가드를 거치지 않고 옛 동작(location.replace)을 직접 실행한다. doc-loads가
    // 정확히 +1 되어야 이 프로브가 0과 1을 구별할 수 있음이 증명된다(ⓚ②, 라이브 되돌리기 없음).
    await page.evaluate(() => window.location.replace('/')).catch(() => null);
    await page.waitForLoadState('domcontentloaded').catch(() => null);
  } else {
    // 합성 pageshow — bfcache 복원을 흉내낸다. isTrusted는 dispatchEvent 기본값(false)으로
    // 남겨 우리 계측기(real-bfcache 카운터)가 이 자극을 세지 않게 한다(task#245 D).
    await page.evaluate(() => {
      const e = new Event('pageshow');
      Object.defineProperty(e, 'persisted', { value: true, configurable: true });
      window.dispatchEvent(e);
    });
  }
  await page.waitForTimeout(500); // flushSync 반영 안정화
  // Router 마운트('/'→'/reports' 리다이렉트)는 flushSync 밖의 별도 렌더 사이클이라 500ms로
  // 부족할 수 있다 — 도착하면 즉시, 없으면 타임아웃 후 그대로 진행한다(이후 단언은 무조건
  // 실행되므로 실제로 안 왔다면 정직하게 FAIL한다. 조건부 단언이 아니라 안정화 대기일 뿐).
  await page.waitForSelector('.reports-layout', { timeout: 4000 }).catch(() => null);

  const after = await readDocLoads(page);
  const histAfter = await page.evaluate(() => history.length);
  const goCalls = await readHistoryGoCalls(page);
  const post = await snapshot(page);
  await page.screenshot({ path: `${OUT}/${control ? 'control' : 'treatment'}-1-post.png` });

  bump('doc-swap');
  if (control) {
    P(after - before === 1, `${label}/판별력`,
      `대조군은 doc-loads가 정확히 +1 (before=${before}, after=${after}) — 프로브가 0/1을 구별한다`);
  } else {
    P(after - before === 0, `${label}/doc-swap`,
      `합성 pageshow 전후 문서 교체 없음 — 리로드가 발생하지 않았다 (before=${before}, after=${after})`);

    bump('report-rendered');
    P(post.reportsMarker && !post.loginForm, `${label}/report-rendered`,
      `가드 발동 후 리포트 화면 마커 존재·로그인폼 부재 (.reports-layout=${post.reportsMarker}, loginForm=${post.loginForm}, url=${post.url})`);

    // forward-pruned — 앞으로가기가 fake-idp.test에 닿지 않아야 한다(pushState가 forward를 잘랐다).
    await page.goForward({ waitUntil: 'domcontentloaded' }).catch(() => null);
    await page.waitForTimeout(400);
    const fwd = await snapshot(page);
    bump('forward-pruned');
    P(fwd.origin !== IDP, `${label}/forward-pruned`,
      `앞으로가기 착지가 fake-idp.test가 아니다 (origin=${fwd.origin}, url=${fwd.url}, h1=${fwd.h1})`);
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null); // 원위치 복귀
    await page.waitForTimeout(400);

    // back-exits — 뒤로가기가 로그인 화면(트랩)이 아니라 우리 오리진 밖(센티넬)으로 나가야 한다.
    // ⚠️ task#285 보정 — markOAuthStart가 기록 전에 pushState(LANDING)을 항상 삽입하게 되면서
    // (junk 유무와 무관, 매 OAuth 시작마다) 히스토리 스택이 통째로 한 칸씩 밀렸다. 그래서 여기
    // "원위치"(landed 슬롯)에서 1회 뒤로가기는 이제 그 pushState *이전* 엔트리(원래의 최초 로그인
    // 진입점 Q0)에 착지하는데, 그 시점엔 이미 localStorage에 토큰이 써져 있어(오리진 전역 공유라
    // 어느 문서 재요청이든 보임) Q0 재요청도 **인증된 Reports**로 뜬다 — 로그인폼도 없고 오리진도
    // 우리 것이라 기존 단일-백 단언이 거짓 FAIL한다(실측 확정: back1={reportsMarker:true,
    // hasToken:true, origin=BASE}, 그 다음 back2에서야 진짜 센티넬 도달). uat252가 같은 원인으로
    // 이미 1회→최대 2회 허용으로 보정된 것과 동형 — 그 패턴을 여기도 적용한다(앱 결함 아님,
    // 프로브의 스테일 단언 — task#285 라이브 계측 세션에서 실측 확정).
    const MAX_BACK = 2;
    const backs = [];
    for (let i = 0; i < MAX_BACK; i++) {
      await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null);
      await page.waitForTimeout(400);
      const b = await snapshot(page);
      backs.push(b);
      if (b.origin !== new URL(BASE).origin) break;
    }
    const back = backs[backs.length - 1];
    bump('back-exits');
    P(!back.loginForm && back.origin !== new URL(BASE).origin, `${label}/back-exits`,
      `뒤로가기 착지(${backs.length}회, 상한 ${MAX_BACK})에 로그인폼이 없고 우리 오리진을 이탈했다 ` +
      `(loginForm=${back.loginForm}, origin=${back.origin}, url=${back.url}, h1=${back.h1}) · ` +
      `경로: ${backs.map(b => b.origin).join(' → ')}`);
  }

  const realBf = await readRealBfcache(page);
  INFO(`${label}/커버리지`,
    `history.length before=${histBefore} after=${histAfter} · history.go 호출 ${goCalls.length}건 · 실 persisted&&isTrusted 관측 ${realBf}건(합성 제외)`);
  INFO(`${label}/경로`, `URL 타임라인: ${trail.join(' → ')} → (토큰주입) → (${control ? 'location.replace' : '합성pageshow'})`);
  INFO(`${label}/콘솔에러`, pageErrors.length ? pageErrors.join(' | ') : '없음');

  await ctx.close();
  return { before, after, realBf };
};

// ── 실행: 기본은 처방+대조군을 한 번에(uat252 방식, 판별력을 매 실행 자동 확인).
//    CONTROL=1이면 대조군만 단독 실행(수동 디버깅용). ──────────────
if (process.env.CONTROL === '1') {
  await run('대조군(CONTROL=1 단독)', true);
} else {
  await run('처방(합성pageshow)', false);
  await run('대조군(location.replace)', true);
}

// ── 축 2 — 실 bfcache 관측 시도(자동, 사용자 작업 0). 미관측은 FAIL이 아니다 ──────
const argv = process.argv.slice(2);
const engineArg = argv.find(a => a.startsWith('--engine='))?.split('=')[1];
const cdpArg = argv.find(a => a.startsWith('--cdp='))?.split('=')[1];

const tryRealBfcache = async (label, launchFn) => {
  let b2;
  try {
    b2 = await launchFn();
  } catch (e) {
    INFO(`축2/${label}`, `미관측(엔진 한계) — 기동 실패: ${e.message}`);
    return;
  }
  // 이 축은 best-effort다 — 착지 문서가 about:blank·에러 페이지 등이면 sessionStorage 접근이
  // SecurityError로 던져질 수 있다(실측: goBack() 착지에서 재현). 미관측은 FAIL이 아니므로
  // 어떤 예외든 "미관측(엔진 한계)"로 흡수하고 절대 프로세스를 죽이지 않는다.
  try {
    const ctx2 = await b2.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
    await ctx2.addInitScript(INIT);
    const page2 = await ctx2.newPage();
    await page2.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page2.waitForSelector('input[type="password"]', { timeout: 20000 }).catch(() => null);
    await page2.goto(`${START}/`, { waitUntil: 'domcontentloaded' }).catch(() => null);
    await page2.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null);
    await page2.waitForTimeout(600);
    const n = await readRealBfcache(page2).catch(() => null);
    INFO(`축2/${label}`, n > 0 ? `실 bfcache 관측: ${n}건` : `미관측(엔진 한계)${n === null ? ' — 착지 문서에서 계측기 접근 불가' : ''}`);
    await ctx2.close();
  } catch (e) {
    INFO(`축2/${label}`, `미관측(엔진 한계) — 실행 중 예외: ${e.message}`);
  } finally {
    await b2.close().catch(() => null);
  }
};

if (engineArg === 'chrome') {
  await tryRealBfcache('channel=chrome', () => chromium.launch({ channel: 'chrome', headless: false }));
} else {
  INFO('축2/channel=chrome', '미시도 — --engine=chrome 플래그 없이 실행됨');
}
if (cdpArg) {
  await tryRealBfcache('cdp', () => chromium.connectOverCDP(cdpArg));
} else {
  INFO('축2/cdp', '미시도 — --cdp=<endpoint> 플래그 없이 실행됨');
}

// ── 리포트 ──────────────────────────────────────────────────────
const asserts = results.filter(r => r.kind === 'assert');
const failed = asserts.filter(r => !r.ok);

console.log('\n=== task#283 — bfcache 인증 불일치 가드: in-place 뒤집기 + forward pruning ===\n');
for (const r of results) {
  const mark = r.kind === 'assert' ? (r.ok ? 'PASS' : 'FAIL') : 'info';
  console.log(`[${mark}] ${r.tag} — ${r.msg}`);
}
console.log('\n--- 커버리지 ---');
console.log(Object.entries(cov).map(([k, v]) => `${k}:${v}`).join(' · '));
console.log(`단언 ${asserts.length}건 (PASS ${asserts.length - failed.length} · FAIL ${failed.length})`);
console.log(`스크린샷: ${OUT}`);
console.log(failed.length ? `\nFAIL ${failed.length}건` : `\nALL PASS ${asserts.length}/${asserts.length}`);

await browser.close();
process.exit(failed.length ? 1 : 0);
