// task#252 라이브 UAT — OAuth 로그인 후 뒤로가기가 IdP 화면으로 나가지 않는다.
//
// 우리는 구글 계정이 없어(테스트 계정 test@portfolion.com) 진짜 구글 플로우를 돌릴 수 없다.
// 그래서 구글 자리에 **가짜 IdP**(다른 오리진 2페이지, 클릭으로 실제 엔트리를 만든다)를 심어
// 되감기를 실측한다. 회고 #246 ⑧ⓔ의 대조군 방식 — 다만 여기선 두 가지를 증명해야 한다:
//   ① 되감기가 켜지면 뒤로가기가 IdP로 가지 않는다(목표)
//   ② 되감기를 끄면 뒤로가기가 IdP로 간다(= 이 프로브가 실패를 관측할 수 있다)
// ②가 없으면 ①의 PASS는 "프로브가 원래 IdP를 못 보는 것"과 구별되지 않는다.
//
// 판정 2축(⑧ⓖ): 목표 단언은 메커니즘 발동 여부와 무관하게 항상 검사하고, 되감기가 실제로
// 참여했는지(history.go 호출·delta 값)는 커버리지로 별도 보고한다.
// 대상 유효성(⑧ⓘ): 가짜 IdP·센티넬 페이지의 고유 마커를 단언하고, 어긋나면 즉시 종료한다 —
// nav·뒤로가기 판정은 페이지 내용과 독립이라 '엉뚱한 문서 위에서도' 통과할 수 있기 때문이다.
// 미측정(⑤): bfcache 복원 착지 경로는 Playwright로 발동시킬 수 없다(task#246, 3엔진 확정).
//   실측된 것은 '되감기 후 문서 재실행(리로드)' 경로다.
//
// ⚠️ 토큰은 폼 로그인으로 얻은 **실토큰**을 쓴다. 가짜 토큰을 주면 앱의 실 API 호출이 401을
//    받고 api.js 인터셉터가 replace('/')를 실행해, 되감기와 무관하게 로그인 화면으로 튄다.
import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const IDP = 'https://fake-idp.test';
const START = 'https://probe-start.test';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat252';
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = 'test@portfolion.com';
const PASSWORD = 'test1234';

const results = [];
const P = (ok, tag, msg) => results.push({ kind: 'assert', ok, tag, msg });
const INFO = (tag, msg) => results.push({ kind: 'info', tag, msg });
const UNMEASURED = (tag, msg) => results.push({ kind: 'unmeasured', tag, msg });

const die = (msg) => { console.error(`\n✗ 중단 — ${msg}`); process.exit(2); };

const html = (title, body) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;

const SENTINEL = html('start', '<h1>PROBE START</h1><p>로그인 이전 지점</p>');
const IDP1 = html('idp', '<h1>FAKE IDP</h1><a id="pick" href="/step2">계정 선택</a>');
const IDP2 = html('idp', `<h1>FAKE IDP</h1><a id="consent" href="${BASE}/?oauth=probe-code">동의</a>`);

// 문서마다 심는 계측기. window 변수는 되감기·replace로 문서가 바뀌면 사라지므로 sessionStorage에
// 누적한다. sessionStorage/history의 *메서드 래핑*은 history.go만 한다 —
// Storage는 이름있는 프로퍼티 세터를 가져서 `sessionStorage.setItem = fn`이 메서드 교체가 아니라
// 'setItem'이라는 항목 저장이 될 수 있다(그래서 기준값은 래핑이 아니라 문서별 스냅샷으로 잡는다).
const INIT = (control) => `
(() => {
  try {
    const K = '__uat252_log';
    const log = (e) => {
      const a = JSON.parse(sessionStorage.getItem(K) || '[]');
      a.push(e); sessionStorage.setItem(K, JSON.stringify(a));
    };
    log({ t: 'doc', url: location.pathname + location.search, len: history.length,
          marked: sessionStorage.getItem('oauth_hist_len') });
    const go = history.go.bind(history);
    history.go = (n) => { log({ t: 'go', n, len: history.length }); return go(n); };
    if (${control}) {
      // 대조군: 랜딩 문서가 App의 useEffect보다 먼저 기준값을 잃으므로 returnFromOAuth()가
      // 폴백(replace('/'))을 탄다 = 되감기 도입 전의 동작 그대로다.
      const b = sessionStorage.getItem('oauth_hist_len');
      if (b) { log({ t: 'control-clear', base: b, len: history.length }); sessionStorage.removeItem('oauth_hist_len'); }
    }
  } catch {}
})();
`;

const readLog = (page) =>
  page.evaluate(() => { try { return JSON.parse(sessionStorage.getItem('__uat252_log') || '[]'); } catch { return []; } });

// 로그인 화면인지 = 비밀번호 입력칸이 보이는지. 앱 화면인지 = 셸이 있는지.
// (#245 D4 — PC/모바일이 같은 셀렉터를 DOM에 함께 두고 CSS로만 가리므로 visible 필터 필수)
const snapshot = (page) => page.evaluate(() => {
  const vis = (el) => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const pw = [...document.querySelectorAll('input[type="password"]')].filter(vis);
  return {
    loginForm: pw.length > 0,
    appShell: !!document.querySelector('.app-pc, .app-main, main.page-wrap'),
    hasToken: !!localStorage.getItem('access_token'),
    h1: document.querySelector('h1')?.textContent?.trim() || null,
    url: location.href,
    historyLength: history.length,
  };
});

// ── 실토큰 확보(폼 로그인) ───────────────────────────────────────
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
  // 폼 로그인은 곧바로 replace('/')로 문서를 갈아치운다 — 새 문서가 뜬 뒤에 읽어야
  // evaluate가 'Execution context was destroyed'로 깨지지 않는다.
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
INFO('전제/실토큰', `폼 로그인으로 access/refresh 확보 (가짜 토큰의 401 오염 회피)`);

// ── 한 arm 실행 ─────────────────────────────────────────────────
const run = async (label, control) => {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(INIT(control));

  await ctx.route(`${START}/**`, r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: SENTINEL }));
  await ctx.route(`${IDP}/step1`, r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: IDP1 }));
  await ctx.route(`${IDP}/step2`, r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: IDP2 }));
  // 백엔드의 302 → 구글을 모사한다. ⚠️ route.fulfill의 302로는 안 된다 — 그 리다이렉트가 만든
  // 요청은 라우팅을 타지 않아 fake-idp.test가 DNS 실패로 chrome-error가 된다(실측). 대신
  // location.replace로 떠나는 문서를 준다: replace라 엔트리를 늘리지 않아 302와 히스토리 의미가 같다.
  await ctx.route('**/api/auth/oauth/google', r => r.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: html('redirect', `<script>location.replace(${JSON.stringify(`${IDP}/step1`)})</script>`),
  }));
  await ctx.route('**/api/auth/oauth/token*', r => r.fulfill({
    contentType: 'application/json', body: JSON.stringify(tokens),
  }));

  const page = await ctx.newPage();
  const trail = [];

  // E1 — 로그인 이전 지점(센티넬). 이게 없으면 되감기 후 뒤로가기가 '무동작'이 되어
  // "IdP가 아니다"가 아무것도 증명하지 못한다.
  await page.goto(`${START}/`, { waitUntil: 'domcontentloaded' });
  const s1 = await snapshot(page);
  trail.push(s1.url);
  if (s1.h1 !== 'PROBE START') die(`센티넬 대상이 아니다 (h1=${s1.h1}) — 대조 지점을 잘못 잡았다`);
  P(true, `${label}/대상유효성-센티넬`, `로그인 이전 지점이 실재한다 (h1="PROBE START")`);

  // E2 — 우리 로그인 화면
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="password"]', { timeout: 20000 });
  const base = await page.evaluate(() => history.length);
  trail.push(page.url());

  // E2에서 push로 떠난다(task#252) → 302 → 가짜 IdP
  await page.locator('button:has-text("Google로 계속"):visible').first().click();
  await page.waitForURL(`${IDP}/step1`, { timeout: 20000 });
  const i1 = await snapshot(page);
  trail.push(i1.url);
  if (i1.h1 !== 'FAKE IDP') die(`가짜 IdP 대상이 아니다 (h1=${i1.h1}) — 라우팅이 의도대로 안 걸렸다`);
  P(true, `${label}/대상유효성-IdP`, `IdP 자리를 실제로 밟았다 (h1="FAKE IDP", ${i1.url})`);

  // E3, E4 — IdP 내부 클릭(실제 내비게이션 = 엔트리 생성)
  await page.click('#pick');
  await page.waitForURL(`${IDP}/step2`, { timeout: 20000 });
  trail.push(page.url());
  await page.click('#consent');

  // 랜딩 → 토큰 저장 → 되감기(or 폴백) → 앱 렌더
  await page.waitForFunction(() => !!localStorage.getItem('access_token'), { timeout: 30000 });
  await page.waitForSelector('.app-pc, .app-main, main.page-wrap', { timeout: 30000 });
  const landing = await snapshot(page);
  trail.push(landing.url);
  await page.screenshot({ path: `${OUT}/${control ? 'control' : 'rewind'}-1-landing.png` });

  // ⚠️ 계측 로그는 *여기서* 읽는다. goBack() 뒤에 읽으면 착지 오리진(센티넬/IdP)의
  // sessionStorage를 읽게 되어 우리 오리진의 go 호출이 0건으로 보인다 — 판정 대상과 계측
  // 대상이 어긋나는 자기적용 함정(회고 ⑧ⓘ). 첫 실행에서 실제로 'go 0건'이 나왔다.
  const log = await readLog(page);
  const goCalls = log.filter(e => e.t === 'go');
  const docs = log.filter(e => e.t === 'doc');
  const landingLen = Math.max(...docs.map(e => e.len), 0);
  const markedBase = docs.map(e => e.marked).filter(Boolean).pop() || null;
  const delta = landingLen - base;
  P(landing.appShell && !landing.loginForm && landing.hasToken,
    `${label}/랜딩`, `로그인 완료·앱 렌더 (appShell=${landing.appShell}, loginForm=${landing.loginForm}, url=${landing.url})`);

  // 목표 축 — 뒤로가기로 로그인 이전 지점까지 이탈한다.
  // ⚠️ task#285에서 `markOAuthStart`가 기준값을 기록하기 *전에* forward 잡음을 절단하려고
  // `pushState(LANDING)`을 하면서, 되감기 착지 슬롯이 원 로그인 엔트리 **뒤**에 하나 더 생겼다.
  // 그래서 이탈에 뒤로가기가 2회 필요하다(1회째는 같은 문서 안 재리다이렉트라 화면상 무동작).
  // 이 비용은 그릴링에서 명시 수용했다. task#252 계획서의 라이브 완료기준은 (a) IdP 아님
  // (b) 로그인 폼 없음 **두 축뿐**이고(그 plan.md의 라이브 슬라이스 판정 2축), 'PROBE START로
  // 1회에 정확 복귀'는 계획에 없던 부수 단언이었다. 그래서 여기서 *의도 기준*으로 다시 쓴다 —
  // 매 착지가 IdP가 아니고 로그인 폼도 없으며, 2회 이내에 로그인 이전 지점으로 이탈한다.
  // (IdP 축은 첫 착지만 보던 것에서 **모든 중간 착지**로 넓어져 오히려 엄격해진다.)
  const MAX_BACK = 2;
  const backs = [];
  for (let i = 0; i < MAX_BACK; i++) {
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null);
    await page.waitForTimeout(1200); // 착지 문서의 리다이렉트/렌더가 끝나기를 기다린다
    const s = await snapshot(page);
    backs.push(s);
    trail.push(s.url);
    await page.screenshot({ path: `${OUT}/${control ? 'control' : 'rewind'}-2-after-back${i + 1}.png` });
    if (s.h1 === 'PROBE START') break;
    if (control) break; // 대조군은 1회만 — 되감기가 없으면 그 자리에서 IdP여야 한다
  }
  const back = backs[0];
  const last = backs[backs.length - 1];
  const onIdp = back.url.startsWith(IDP);

  if (control) {
    // ⑧ⓔ — 되감기를 끄면 뒤로가기가 IdP로 간다는 것을 실측해, 이 프로브가 실패를 관측할 수
    // 있음을 증명한다. 이게 FAIL이면 treatment arm의 PASS는 판별력이 없다.
    P(onIdp, `${label}/관측가능성`,
      `되감기 없으면 뒤로가기가 IdP로 간다 (url=${back.url}, h1=${back.h1}) — 프로브가 실패를 볼 수 있다`);
  } else {
    const idpHits = backs.filter(s => s.url.startsWith(IDP));
    P(idpHits.length === 0, `${label}/목표-IdP아님`,
      `뒤로가기 착지 ${backs.length}회 모두 IdP가 아니다 (${backs.map(s => s.url).join(' → ')})`);
    const formHits = backs.filter(s => s.loginForm);
    P(formHits.length === 0, `${label}/목표-로그인폼없음`,
      `뒤로가기 착지 ${backs.length}회 모두 로그인 폼이 없다 (발견 ${formHits.length}건)`);
    P(last.h1 === 'PROBE START', `${label}/목표-이전지점복귀`,
      `뒤로가기 ${backs.length}회(상한 ${MAX_BACK}) 이내에 로그인 이전 지점으로 이탈했다 (h1=${last.h1})`);
  }

  INFO(`${label}/커버리지`,
    `기준값 base=${base}(랜딩 문서가 본 값=${markedBase}) · 랜딩 history.length=${landingLen} · delta=${delta} · history.go 호출 ${goCalls.length}건${goCalls.length ? `(n=${goCalls.map(g => g.n).join(',')})` : ''} · 우리오리진 문서로그 ${log.length}건(doc ${docs.length})`);
  INFO(`${label}/경로`, `URL 타임라인: ${trail.join(' → ')}`);

  await ctx.close();
  return { goCalls: goCalls.length, delta, onIdp, backUrl: back.url };
};

// ── 실행: 되감기 켬(목표) / 끔(관측가능성 대조군) ───────────────
const rewind = await run('되감기', false);
const control = await run('대조군(되감기 끔)', true);

// 메커니즘 커버리지(목표 단언과 별개 축 — ⑧ⓖ)
INFO('메커니즘', `되감기 arm: history.go ${rewind.goCalls}건 · delta ${rewind.delta} / 대조군: history.go ${control.goCalls}건(폴백 replace 경로)`);
UNMEASURED('bfcache 착지 변형',
  'Playwright는 bfcache를 발동시킬 수 없다(task#246, chromium·webkit·firefox 대조군 확정) — 위 PASS는 되감기 후 *문서 재실행(리로드)* 경로만 실측한다. bfcache 복원 착지는 useBfcacheAuthGuard가 덮으며 그 분기는 vitest가 고정한다.');

// ── 리포트 ──────────────────────────────────────────────────────
const asserts = results.filter(r => r.kind === 'assert');
const failed = asserts.filter(r => !r.ok);
const unmeasured = results.filter(r => r.kind === 'unmeasured');

console.log('\n=== task#252 — OAuth 로그인 후 뒤로가기 IdP 차단(히스토리 되감기) ===\n');
for (const r of results) {
  const mark = r.kind === 'assert' ? (r.ok ? 'PASS' : 'FAIL') : (r.kind === 'unmeasured' ? '미측정' : 'info');
  console.log(`[${mark}] ${r.tag} — ${r.msg}`);
}
console.log('\n--- 커버리지 ---');
console.log(`단언 ${asserts.length}건 (PASS ${asserts.length - failed.length} · FAIL ${failed.length}) · 미측정 ${unmeasured.length}건`);
console.log(`판별력: 되감기 arm 뒤로가기=${rewind.backUrl} vs 대조군=${control.backUrl}`);
console.log(`스크린샷: ${OUT}`);

await browser.close();
process.exit(failed.length ? 1 : 0);
