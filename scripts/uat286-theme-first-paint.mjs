// task#286 라이브 UAT — 첫 페인트 전 테마 확정(다크 사용자의 라이트 플래시 제거).
//
// 대상 동작(커밋 5b18504, 라이브 번들 assets/index-CCq790of.js · assets/index-CeCAQHFp.css):
//   frontend/index.html <head>에
//     ① 인라인 <style>  html{background:#f6f1e7} html[data-theme="dark"]{background:#171310}
//     ② 렌더 차단 위치의 동기 인라인 <script>(themeBoot 사본) — localStorage.theme==='dark'면
//        <html>에 data-theme="dark" + meta[name=theme-color]를 #171310으로 교체
//     ③ OAuth 스플래시 다크 분기가 @media(prefers-color-scheme:dark) → [data-theme="dark"]
//
// ── 이 프로브의 핵심 기법: 번들 로드 전 창을 벌린다 ──────────────────────────────
// route로 /assets/*.js·/assets/*.css 응답을 **게이트**(수동 해제 promise)로 붙잡아 3단계 창을
// 만든다(task#285에서 확립한 응답 지연 기법의 게이트판):
//   W1 = 인라인 <style>만 적용된 상태(번들 CSS·JS 둘 다 미도착)
//        → getComputedStyle(documentElement).backgroundColor 가 **부트스트랩의 결과 그 자체**다.
//   W2 = 번들 CSS만 도착(React 미마운트) → body{background:var(--bg)}가 칠하는,
//        **실사용자가 플래시 창에서 실제로 보는** 배경. 육안 캡처는 여기서 찍는다(아래 주석).
//   W3 = 번들 JS까지 도착·마운트 완료 → 인계(useTheme lazy init)가 값을 뒤집지 않는가.
//
// ⚠️ W1은 원리적으로 **화면이 안 칠해진다**: 폰트 CDN 2장 + /assets/index-*.css 가 전부
//    render-blocking 이라 브라우저는 그 셋이 다 올 때까지 first paint를 미룬다. 그래서 W1의
//    판정은 computed style(측정)로 하고, **육안 캡처는 W2**에서 찍는다(W1 캡처도 남기되 참고용).
//    이건 도구 한계가 아니라 브라우저 사양이며, 실사용자의 플래시도 정확히 W2 구간에서 보인다.
// ⚠️ 렌더가 막힌 창에서는 rAF가 안 돌 수 있으므로 waitForFunction은 전부 polling:100(인터벌).
//
// 로그인 불필요 — W1/W2에는 React가 아직 없고, 인증 리다이렉트는 번들 실행 이후다.
// SW는 index.html까지 precache하므로 serviceWorkers:'block' 필수(안 막으면 옛 문서를 잰다).
//
// 색 리터럴 근거: tokens.css `--bg` 라이트 #f6f1e7 / 다크 #171310 (useTheme.js THEME_COLORS 동일).
// 리터럴을 그냥 믿지 않고 축 ⓖ가 번들 로드 후 실제 --bg 토큰을 rgb 정규화해 대조한다.
import { chromium, devices } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat286';
fs.mkdirSync(OUT, { recursive: true });

const LIGHT_RGB = 'rgb(246, 241, 231)'; // #f6f1e7
const DARK_RGB = 'rgb(23, 19, 16)';     // #171310
const LIGHT_HEX = '#f6f1e7';
const DARK_HEX = '#171310';

const results = [];
const cov = {};
const bump = (k, n = 1) => { cov[k] = (cov[k] || 0) + n; };
// 단언은 전부 무조건 실행된다. 미검출은 sentinel 기대값(*_MISSING)으로 FAIL시켜 총계를 고정한다.
const eq = (tag, got, want, note = '') => {
  const ok = got === want;
  results.push({ kind: 'assert', ok, tag, msg: `got=${JSON.stringify(got)} want=${JSON.stringify(want)}${note ? ` · ${note}` : ''}` });
  return ok;
};
const INFO = (tag, msg) => results.push({ kind: 'info', tag, msg });
const die = (msg) => { console.error(`\n✗ 중단 — ${msg}`); process.exit(2); };

// ── 게이트: 응답을 붙잡았다가 수동으로 흘려보낸다 ──────────────────────────────
const makeGate = () => { let rel; const p = new Promise(r => { rel = r; }); return { p, open: () => rel() }; };

// ── 브라우저 안 측정기 ────────────────────────────────────────────────────────
// 한 번에 다 걷어온다(출력은 넓게, 단언은 목표에만 — TESTING.md ⓗ).
const MEASURE = () => {
  const de = document.documentElement;
  const meta = document.querySelector('meta[name=theme-color]');
  const boot = [...document.querySelectorAll('script')].find(s => !s.src && s.textContent.includes('theme-boot'));
  const sheets = [...document.styleSheets].map(s => s.href || '(inline)');
  const bundleCss = sheets.filter(h => h.includes('/assets/') && h.endsWith('.css'));
  const norm = (v) => {
    if (!document.body) return 'BODY_MISSING';
    const d = document.createElement('div');
    d.style.color = String(v).trim();
    document.body.appendChild(d);
    const c = getComputedStyle(d).color;
    d.remove();
    return c;
  };
  const bgVar = getComputedStyle(de).getPropertyValue('--bg');
  return {
    title: document.title || 'TITLE_MISSING',
    bootPresent: !!boot,
    bootComplete: !!boot && boot.textContent.includes('theme-boot:end'),
    htmlBg: getComputedStyle(de).backgroundColor || 'BG_MISSING',
    bodyBg: document.body ? (getComputedStyle(document.body).backgroundColor || 'BG_MISSING') : 'BODY_MISSING',
    dataTheme: de.getAttribute('data-theme') ?? 'ABSENT',
    metaContent: meta ? (meta.getAttribute('content') ?? 'CONTENT_MISSING') : 'META_MISSING',
    bgVarRaw: bgVar === '' ? 'VAR_MISSING' : bgVar.trim(),
    bgVarRgb: bgVar === '' ? 'VAR_MISSING' : norm(bgVar),
    bundleCssCount: bundleCss.length,
    sheetCount: sheets.length,
    sheets,
    rootChildren: document.getElementById('root') ? document.getElementById('root').children.length : -1,
    mounted: !!document.querySelector('.app-pc, .app-main, main.page-wrap')
      || [...document.querySelectorAll('input[type="password"]')].some(e => e.offsetWidth || e.offsetHeight || e.getClientRects().length),
    hasSplashMarkup: !!document.querySelector('.oauth-splash'),
    readyState: document.readyState,
    shimHits: window.__uat286_shim_hits || 0,
    rawStored: (() => { try { return localStorage.theme ?? 'NONE'; } catch (e) { return 'THROW'; } })(),
    getItemTheme: (() => { try { const v = localStorage.getItem('theme'); return v === null ? 'null' : v; } catch (e) { return 'THROW'; } })(),
  };
};

// 진행 중 내비게이션·렌더 차단과 겹쳐도 즉시 캡처되는 경로(page.screenshot은 그 상황에서 안 풀린다).
const snapCDP = async (ctx, page, path, { timeout = 5000, tag = '스크린샷실패' } = {}) => {
  try {
    const cdp = await ctx.newCDPSession(page);
    const r = await Promise.race([
      cdp.send('Page.captureScreenshot', { format: 'png' }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('CDP_SCREENSHOT_TIMEOUT')), timeout)),
    ]);
    fs.writeFileSync(path, Buffer.from(r.data, 'base64'));
    return true;
  } catch (e) {
    INFO(tag, `${path}: ${e.message.split('\n')[0]}`);
    return false;
  }
};

// ── 초기화 스크립트(페이지 스크립트보다 먼저 돈다) ────────────────────────────
function SEED_DARK() { try { localStorage.setItem('theme', 'dark'); } catch (e) { /* private mode */ } }
function SEED_LIGHT() { try { localStorage.removeItem('theme'); } catch (e) { /* private mode */ } }
// 대조군 — 라이브를 되돌리지 않고 **처방만 무효화**한다(TESTING.md ⓔ 처방-무효화형).
// 저장값은 진짜로 'dark'로 남겨두고(localStorage.theme 직접 접근으로 확인 가능),
// 부트스트랩이 쓰는 getItem('theme')만 null로 가려 no-op으로 만든다 → 픽스 도입 전 동작 재현.
function CONTROL_INIT() {
  try { localStorage.setItem('theme', 'dark'); } catch (e) { /* private mode */ }
  const orig = Storage.prototype.getItem;
  Storage.prototype.getItem = function (k) {
    if (k === 'theme') { window.__uat286_shim_hits = (window.__uat286_shim_hits || 0) + 1; return null; }
    return orig.call(this, k);
  };
}

const browser = await chromium.launch();

const VIEWPORTS = [
  { v: 'pc', opts: { viewport: { width: 1440, height: 900 } } },
  { v: 'mobile', opts: { ...devices['iPhone 13'] } },
];

const firstPaint = {}; // `${v}/${theme}` → W1 htmlBg (이빨 단언용)

// ══════════════════════════════════════════════════════════════════════════════
// 본진 — 4조합(PC/모바일 × 다크/라이트). W1 → W2 → W3 3창 전부 측정.
// ══════════════════════════════════════════════════════════════════════════════
const runArm = async ({ v, opts }, theme) => {
  const label = `${v}/${theme}`;
  const wantBg = theme === 'dark' ? DARK_RGB : LIGHT_RGB;
  const wantHex = theme === 'dark' ? DARK_HEX : LIGHT_HEX;
  const wantAttr = theme === 'dark' ? 'dark' : 'ABSENT';

  const ctx = await browser.newContext({ ...opts, serviceWorkers: 'block', colorScheme: 'light' });
  await ctx.addInitScript(theme === 'dark' ? SEED_DARK : SEED_LIGHT);

  const cssGate = makeGate();
  const jsGate = makeGate();
  await ctx.route(u => u.pathname.startsWith('/assets/') && u.pathname.endsWith('.css'), async r => { await cssGate.p; await r.continue(); });
  await ctx.route(u => u.pathname.startsWith('/assets/') && u.pathname.endsWith('.js'), async r => { await jsGate.p; await r.continue(); });

  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e).split('\n')[0]));

  await page.goto(`${BASE}/`, { waitUntil: 'commit' });

  // ── W1: 인라인 <style>만 적용된 창 ──
  // ⚠️ 이 창에서는 `document.body`가 **아직 없다**(실측). <head> 끝의 parser-blocking
  // `<script src="/registerSW.js">`가 자기 앞의 미완료 스타일시트(=우리가 게이트한 번들 CSS)를
  // 기다리느라 파서가 head에서 멈추기 때문이다. 그래서 대기 조건에 body를 넣으면 **영원히 안 참**
  // 이 되어 25초 무음 타임아웃이 된다(1차 설계의 결함 — 조건을 boot 완결로만 좁혔다).
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('script')].find(s => !s.src && s.textContent.includes('theme-boot'));
    return !!b && b.textContent.includes('theme-boot:end');
  }, null, { polling: 100, timeout: 25000 }).catch(() => null);
  const w1 = await page.evaluate(MEASURE);
  // 이 캡처는 **매번 실패하는 것이 정상**이다(브라우저 사양: 미도착 render-blocking 스타일시트가
  // 있으면 first paint 자체가 없다). 도구 한계를 매 실행에서 재확인하는 증거로 남긴다 —
  // 실제 육안 캡처는 아래 W2와 별도의 `인라인전용` arm이 담당한다.
  await snapCDP(ctx, page, `${OUT}/${v}-${theme}-w1-inline-only.png`,
    { timeout: 2500, tag: 'W1캡처-렌더차단(예상된 도구한계)' });

  // 대상 유효성(TESTING.md ⓘ) — 판정축(배경색)은 문서 정체와 독립이므로 먼저 못박는다.
  eq(`${label}/identity-title`, w1.title, 'PortfoliOn');
  eq(`${label}/identity-bootscript`, w1.bootComplete ? 'OK' : (w1.bootPresent ? 'BOOT_SCRIPT_TRUNCATED' : 'BOOT_SCRIPT_MISSING'), 'OK',
    `인라인 부트스트랩 <script>(theme-boot 마커) 존재·완결`);
  bump('대상유효성', 2);

  // W1 정의역 sentinel — 번들이 새어들어왔거나 React가 이미 마운트됐으면 이 창의 측정은 무의미하다.
  eq(`${label}/w1-domain`,
    (w1.bundleCssCount === 0 && !w1.mounted && w1.bootComplete) ? 'OK'
      : `DOMAIN_BROKEN(bundleCss=${w1.bundleCssCount},mounted=${w1.mounted},boot=${w1.bootComplete})`,
    'OK', `readyState=${w1.readyState} · styleSheets=${w1.sheetCount} · #root children=${w1.rootChildren} · body=${w1.bodyBg === 'BODY_MISSING' ? '아직없음(파서가 head에서 대기)' : '존재'}`);
  bump('w1-domain');

  // ⓐ/ⓑ 첫 페인트 배경 — 이 창의 값은 인라인 <style> + 부트스트랩의 결과 그 자체다.
  eq(`${label}/w1-first-paint-bg`, w1.htmlBg, wantBg, `html 배경(번들 CSS 이전) · 저장테마=${theme}`);
  bump('w1-bg');
  eq(`${label}/w1-data-theme`, w1.dataTheme, wantAttr, `<html data-theme>`);
  bump('w1-attr');
  // ⓓ theme-color 메타
  eq(`${label}/w1-theme-color-meta`, w1.metaContent, wantHex, `meta[name=theme-color]`);
  bump('w1-meta');
  firstPaint[label] = w1.htmlBg;

  INFO(`${label}/w1-덤프`, `htmlBg=${w1.htmlBg} bodyBg=${w1.bodyBg} dataTheme=${w1.dataTheme} meta=${w1.metaContent} --bg=${w1.bgVarRaw} sheets=${JSON.stringify(w1.sheets)}`);

  // ── W2: 번들 CSS만 해제(React 미마운트) — 실사용자가 플래시 창에서 실제로 보는 화면 ──
  cssGate.open();
  await page.waitForFunction(
    () => [...document.styleSheets].some(s => s.href && s.href.includes('/assets/') && s.href.endsWith('.css')),
    null, { polling: 100, timeout: 25000 },
  ).catch(() => null);
  await page.waitForTimeout(400);
  const w2 = await page.evaluate(MEASURE);
  await snapCDP(ctx, page, `${OUT}/${v}-${theme}-w2-bundlecss-prereact.png`);

  eq(`${label}/w2-domain`,
    (w2.bundleCssCount >= 1 && !w2.mounted) ? 'OK' : `DOMAIN_BROKEN(bundleCss=${w2.bundleCssCount},mounted=${w2.mounted})`,
    'OK', `번들 CSS는 왔고 React는 아직 없다`);
  bump('w2-domain');
  eq(`${label}/w2-html-bg`, w2.htmlBg, wantBg, `번들 CSS 도착 후에도 html 배경 유지`);
  eq(`${label}/w2-body-bg`, w2.bodyBg, wantBg, `body{background:var(--bg)} — 육안 캡처가 보는 색`);
  bump('w2-bg', 2);

  INFO(`${label}/w2-덤프`, `htmlBg=${w2.htmlBg} bodyBg=${w2.bodyBg} dataTheme=${w2.dataTheme} meta=${w2.metaContent} --bg=${w2.bgVarRaw}→${w2.bgVarRgb}`);

  // ── W3: 번들 JS 해제 → 마운트 완료. 인계(useTheme lazy init)가 뒤집지 않는가(축 ⓔ) ──
  jsGate.open();
  await page.waitForFunction(() => {
    const vis = (e) => e.offsetWidth || e.offsetHeight || e.getClientRects().length;
    return !!document.querySelector('.app-pc, .app-main, main.page-wrap')
      || [...document.querySelectorAll('input[type="password"]')].some(vis);
  }, null, { polling: 100, timeout: 40000 }).catch(() => null);
  await page.waitForTimeout(800);
  const w3 = await page.evaluate(MEASURE);

  eq(`${label}/w3-domain`, w3.mounted ? 'OK' : 'NOT_MOUNTED', 'OK',
    `readyState=${w3.readyState} · #root children=${w3.rootChildren}`);
  bump('w3-domain');
  eq(`${label}/w3-handover-data-theme`, w3.dataTheme, wantAttr, `마운트 후에도 인라인이 세운 값 유지`);
  eq(`${label}/w3-handover-body-bg`, w3.bodyBg, wantBg, `마운트 후 배경이 같은 테마`);
  eq(`${label}/w3-handover-meta`, w3.metaContent, wantHex, `마운트 후 theme-color 동일`);
  bump('w3-handover', 3);

  // ⓖ 토큰 정합 — 하드코딩 리터럴이 tokens.css의 --bg와 어긋나면 여기서 잡힌다.
  eq(`${label}/token-consistency`, w3.bgVarRgb, wantBg, `--bg 원문=${w3.bgVarRaw} → rgb 정규화`);
  bump('토큰정합');

  eq(`${label}/console-error`, pageErrors.length === 0 ? 'NONE' : `${pageErrors.length}건: ${pageErrors.slice(0, 3).join(' | ')}`, 'NONE');
  bump('콘솔');

  await ctx.close();
  return { w1, w2, w3, pageErrors };
};

// ══════════════════════════════════════════════════════════════════════════════
// 대조군(red-first) — 저장값은 진짜 'dark'인데 부트스트랩의 getItem('theme')만 가린다.
// 픽스 도입 전 동작(다크 사용자인데 첫 페인트가 라이트)이 재현되어야 이 프로브가 판별력을 갖는다.
// ══════════════════════════════════════════════════════════════════════════════
const runControl = async ({ v, opts }) => {
  const label = `대조군/${v}`;
  const ctx = await browser.newContext({ ...opts, serviceWorkers: 'block', colorScheme: 'light' });
  await ctx.addInitScript(CONTROL_INIT);

  const cssGate = makeGate();
  const jsGate = makeGate();
  await ctx.route(u => u.pathname.startsWith('/assets/') && u.pathname.endsWith('.css'), async r => { await cssGate.p; await r.continue(); });
  await ctx.route(u => u.pathname.startsWith('/assets/') && u.pathname.endsWith('.js'), async r => { await jsGate.p; await r.continue(); });

  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'commit' });
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('script')].find(s => !s.src && s.textContent.includes('theme-boot'));
    return !!b && b.textContent.includes('theme-boot:end');
  }, null, { polling: 100, timeout: 25000 }).catch(() => null);
  const c = await page.evaluate(MEASURE);
  await snapCDP(ctx, page, `${OUT}/${v}-CONTROL-w1-inline-only.png`,
    { timeout: 2500, tag: 'W1캡처-렌더차단(예상된 도구한계)' });

  // 대조군 자체의 유효성 3축 — 대조군의 대상·발동을 검증하지 않으면 "그럴듯한 0건"이 나온다(ⓔ 부수).
  eq(`${label}/identity-title`, c.title, 'PortfoliOn');
  eq(`${label}/control-storage-real`, c.rawStored, 'dark',
    `localStorage.theme 직접 접근(=실제 저장값). getItem만 가렸으므로 여기엔 dark가 살아있어야 한다`);
  eq(`${label}/control-shim-effective`, c.getItemTheme, 'null',
    `부트스트랩이 쓰는 getItem('theme') 반환값`);
  eq(`${label}/control-shim-hit`, c.shimHits >= 1 ? 'HIT' : `NO_HIT(${c.shimHits})`, 'HIT',
    `shim 호출 ${c.shimHits}회 — 부트스트랩의 read를 실제로 가로챘는가`);
  bump('대조군검증', 4);

  // red-first 재현 — 다크 사용자인데 첫 페인트가 라이트여야 "관측 가능"이 실증된다.
  eq(`${label}/RED-first-paint-라이트재현`, c.htmlBg, LIGHT_RGB,
    `처방 무효화 시 첫 페인트=${c.htmlBg} (처방 정상이면 ${DARK_RGB}) → 재현=${c.htmlBg === LIGHT_RGB}`);
  eq(`${label}/RED-data-theme-없음`, c.dataTheme, 'ABSENT', `부트스트랩 no-op → 속성 미설정`);
  eq(`${label}/RED-meta-라이트`, c.metaContent, LIGHT_HEX, `theme-color도 라이트 하드코딩 그대로`);
  bump('대조군재현', 3);

  INFO(`${label}/덤프`, `htmlBg=${c.htmlBg} dataTheme=${c.dataTheme} meta=${c.metaContent} rawStored=${c.rawStored} getItem=${c.getItemTheme} shimHits=${c.shimHits} bundleCss=${c.bundleCssCount} mounted=${c.mounted}`);

  cssGate.open(); jsGate.open();
  await ctx.close();
  return c;
};

// ══════════════════════════════════════════════════════════════════════════════
// 육안 캡처 전용 arm — "인라인 <style>만 적용된 화면"을 **실제로 칠해서** 찍는다.
//
// 왜 별도 arm인가: 위 W1은 render-blocking 스타일시트 3장(폰트 CDN 2 + 번들 CSS)이 미도착이라
// 브라우저가 first paint 자체를 미룬다 → CDP 캡처가 타임아웃한다(실측: 5s 초과, 4조합 전부).
// 그래서 여기서는 그 3장을 **빈 CSS로 fulfill**해 pending을 없애고(내용은 0바이트라 스타일 기여
// 0 = 여전히 "인라인만 적용된 상태"), 번들 JS는 abort해 React를 영구히 막는다.
// 즉 화면에 남는 색의 출처는 index.html 인라인 <style> + 부트스트랩뿐임이 구조적으로 보장된다
// (bundle-css-rules=0 을 축으로 단언해 그 보장을 실측한다).
// ══════════════════════════════════════════════════════════════════════════════
const runInlineOnlyCapture = async ({ v, opts }, theme) => {
  const label = `인라인전용/${v}/${theme}`;
  const wantBg = theme === 'dark' ? DARK_RGB : LIGHT_RGB;
  const wantAttr = theme === 'dark' ? 'dark' : 'ABSENT';
  const ctx = await browser.newContext({ ...opts, serviceWorkers: 'block', colorScheme: 'light' });
  await ctx.addInitScript(theme === 'dark' ? SEED_DARK : SEED_LIGHT);
  const EMPTY_CSS = { status: 200, contentType: 'text/css; charset=utf-8', body: '' };
  // 폰트 CDN 2장도 빈 CSS로 fulfill한다 — pending을 없애 render-blocking을 풀기 위함(폰트 파일
  // 대기도 사라진다). ⚠️ 이 둘은 **크로스오리진이라 cssRules 접근이 SecurityError**를 던진다
  // (1차 실행에서 실측). 그래서 아래 정의역 sentinel은 크로스오리진 규칙 수를 읽는 대신
  // ① same-origin(번들 CSS) 규칙 0 ② `--bg` 토큰 미정의 ③ body 배경 transparent 로 판정한다
  // — 셋 다 참이면 화면의 색은 index.html 인라인 <style> 말고 나올 곳이 없다.
  let fontRouteHits = 0;
  await ctx.route(u => u.hostname === 'fonts.googleapis.com' || u.hostname === 'cdn.jsdelivr.net',
    r => { fontRouteHits++; return r.fulfill(EMPTY_CSS); });
  // 번들 CSS는 **빈 내용으로 fulfill**한다(same-origin이라 규칙 수를 실제로 셀 수 있고,
  // "번들 CSS가 왔는데도 규칙 0" = 색의 출처가 인라인뿐임이 실측으로 못박힌다).
  await ctx.route(u => u.pathname.startsWith('/assets/') && u.pathname.endsWith('.css'), r => r.fulfill(EMPTY_CSS));
  await ctx.route(u => u.pathname.startsWith('/assets/') && u.pathname.endsWith('.js'), r => r.abort());

  const page = await ctx.newPage();
  page.on('pageerror', () => { /* 번들 abort로 인한 모듈 로드 실패는 이 arm의 의도된 조건 */ });
  await page.goto(`${BASE}/`, { waitUntil: 'commit' });
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('script')].find(s => !s.src && s.textContent.includes('theme-boot'));
    return !!b && b.textContent.includes('theme-boot:end') && !!document.body;
  }, null, { polling: 100, timeout: 25000 }).catch(() => null);
  await page.waitForTimeout(600);
  const m = await page.evaluate(MEASURE);
  const ext = await page.evaluate(() => {
    const out = { sameOriginRules: 0, sameOrigin: [], crossOrigin: [] };
    for (const s of document.styleSheets) {
      if (!s.href) continue; // 인라인 <style>은 세지 않는다 — 여기 남아야 하는 유일한 출처다
      try { out.sameOriginRules += s.cssRules.length; out.sameOrigin.push(s.href); }
      catch (e) { out.crossOrigin.push(s.href); } // 크로스오리진(폰트 CDN) — 원리적으로 못 읽는다
    }
    return out;
  });
  const path = `${OUT}/${v}-${theme}-w1paint-inline-only.png`;
  const shot = await snapCDP(ctx, page, path);

  eq(`${label}/identity-title`, m.title, 'PortfoliOn');
  const inlineOnly = ext.sameOriginRules === 0 && m.bgVarRaw === 'VAR_MISSING' && m.bodyBg === 'rgba(0, 0, 0, 0)';
  eq(`${label}/domain-인라인만`,
    inlineOnly ? 'OK' : `NOT_INLINE_ONLY(sameOriginRules=${ext.sameOriginRules},--bg=${m.bgVarRaw},bodyBg=${m.bodyBg})`,
    'OK',
    `same-origin 시트 ${ext.sameOrigin.length}장 규칙 ${ext.sameOriginRules}개 · 크로스오리진(읽기불가) ${ext.crossOrigin.length}장 · --bg=${m.bgVarRaw} · bodyBg=${m.bodyBg} · 폰트route hit=${fontRouteHits}`);
  eq(`${label}/domain-미마운트`, m.mounted ? 'MOUNTED' : 'OK', 'OK', `#root children=${m.rootChildren}`);
  eq(`${label}/paint-bg`, m.htmlBg, wantBg, `인라인만 적용된 화면의 배경`);
  eq(`${label}/paint-data-theme`, m.dataTheme, wantAttr);
  eq(`${label}/캡처성공`, shot ? 'OK' : 'CAPTURE_FAILED', 'OK', path);
  bump('인라인전용캡처', 6);
  INFO(`${label}/덤프`, `htmlBg=${m.htmlBg} bodyBg=${m.bodyBg} dataTheme=${m.dataTheme} meta=${m.metaContent} sameOrigin규칙=${ext.sameOriginRules} 크로스오리진=${ext.crossOrigin.length} 전체시트=${m.sheetCount} 폰트route=${fontRouteHits}`);

  await ctx.close();
  return { m, ext, shot };
};

// ══════════════════════════════════════════════════════════════════════════════
// 스플래시 신호 arm — 이번 커밋의 **두 번째** 동작 변화를 재는 축.
// index.html 스플래시 CSS의 다크 분기가 @media(prefers-color-scheme:dark) → [data-theme="dark"]
// 로 교체됐다. uat285는 두 스플래시의 computed 값을 **서로** 비교할 뿐 색 리터럴이 없고, 게다가
// Playwright 기본 colorScheme='light'라 교체가 깨져도 red가 안 난다 → 여기서만 잡힌다.
// 번들 JS를 영구히 게이트한 채로 재므로 코드교환 API 호출이 발생하지 않는다(무쓰기).
// ══════════════════════════════════════════════════════════════════════════════
const SPLASH = { dark: { bg: DARK_RGB, fg: 'rgb(236, 228, 212)' }, light: { bg: LIGHT_RGB, fg: 'rgb(32, 27, 19)' } }; // index.html 인라인 CSS 실값(#ece4d4 / #201b13)
const splashSeen = {};
const runSplash = async (theme) => {
  const label = `스플래시/${theme}`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', colorScheme: 'light' });
  await ctx.addInitScript(theme === 'dark' ? SEED_DARK : SEED_LIGHT);
  // ⚠️ 여기서는 번들 CSS를 **게이트하면 안 된다** — 미완료 스타일시트가 <head> 끝의
  // parser-blocking `registerSW.js`를 막아 파서가 body에 도달하지 못하고, 스플래시 마크업이
  // 아예 생기지 않는다(1차 실행에서 present=false로 실측). 대신 **빈 CSS로 fulfill**해
  // 파서를 풀되 스타일 기여는 0으로 두면, `.oauth-splash` 색의 출처는 index.html 인라인 CSS뿐이다
  // (라이브 번들 CSS에 `.oauth-splash` 규칙 0건임을 curl로 확인).
  const EMPTY_CSS = { status: 200, contentType: 'text/css; charset=utf-8', body: '' };
  await ctx.route(u => u.hostname === 'fonts.googleapis.com' || u.hostname === 'cdn.jsdelivr.net', r => r.fulfill(EMPTY_CSS));
  await ctx.route(u => u.pathname.startsWith('/assets/') && u.pathname.endsWith('.css'), r => r.fulfill(EMPTY_CSS));
  // 번들 JS는 abort — React가 마운트되지 않으므로 `?oauth=` 코드교환 API 호출이 발생하지 않는다(무쓰기).
  await ctx.route(u => u.pathname.startsWith('/assets/') && u.pathname.endsWith('.js'), r => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', () => { /* 번들 abort는 이 arm의 의도된 조건 */ });
  await page.goto(`${BASE}/?oauth=uat286-probe`, { waitUntil: 'commit' });
  await page.waitForFunction(() => {
    const el = document.querySelector('.oauth-splash');
    return !!el && !document.getElementById('oauth-splash').hidden;
  }, null, { polling: 100, timeout: 25000 }).catch(() => null);
  const s = await page.evaluate(() => {
    const el = document.querySelector('.oauth-splash');
    const de = document.documentElement;
    let sameOriginRules = 0;
    for (const x of document.styleSheets) { if (!x.href) continue; try { sameOriginRules += x.cssRules.length; } catch (e) { /* 폰트 CDN(크로스오리진) */ } }
    return {
      present: !!el,
      revealed: !!document.getElementById('oauth-splash') && !document.getElementById('oauth-splash').hidden,
      bg: el ? getComputedStyle(el).backgroundColor : 'SPLASH_MISSING',
      fg: el ? getComputedStyle(el).color : 'SPLASH_MISSING',
      htmlBg: getComputedStyle(de).backgroundColor,
      dataTheme: de.getAttribute('data-theme') ?? 'ABSENT',
      sameOriginRules,
      mounted: !!document.querySelector('.app-pc, .app-main, main.page-wrap'),
    };
  });
  await snapCDP(ctx, page, `${OUT}/pc-${theme}-splash-prebundle.png`);

  eq(`${label}/domain`, (s.present && s.revealed && s.sameOriginRules === 0 && !s.mounted) ? 'OK'
    : `DOMAIN_BROKEN(present=${s.present},revealed=${s.revealed},sameOrigin규칙=${s.sameOriginRules},mounted=${s.mounted})`,
    'OK', `?oauth= 착지 문서에서 스플래시가 드러났고, 번들 CSS 규칙 0 · React 미마운트 — 색의 출처는 인라인뿐`);
  eq(`${label}/bg-리터럴`, s.bg, SPLASH[theme].bg, `index.html 인라인 스플래시 CSS 실값 대조`);
  eq(`${label}/fg-리터럴`, s.fg, SPLASH[theme].fg);
  eq(`${label}/data-theme`, s.dataTheme, theme === 'dark' ? 'dark' : 'ABSENT');
  // 리터럴과 별개로 **불변식**도 건다 — 스플래시와 앱이 같은 신호를 따르는가(리터럴이 바뀌어도 유효).
  eq(`${label}/앱과같은신호`, s.bg === s.htmlBg ? 'OK' : `MISMATCH(splash=${s.bg} html=${s.htmlBg})`, 'OK',
    `스플래시 배경 == <html> 배경`);
  bump('스플래시', 5);
  splashSeen[theme] = s.bg;
  INFO(`${label}/덤프`, `splashBg=${s.bg} splashFg=${s.fg} htmlBg=${s.htmlBg} dataTheme=${s.dataTheme} sameOrigin규칙=${s.sameOriginRules}`);

  await ctx.close();
};

// ══════════════════════════════════════════════════════════════════════════════
// 비목표 1 가드 — 시스템 선호(prefers-color-scheme: dark)를 따라가지 않는다.
// 이번 커밋이 스플래시 다크 분기를 @media → [data-theme]로 바꿨으므로, "시스템 다크인데 저장값
// 없음"이 여전히 라이트인지가 이 커밋의 회귀 축이다.
// ══════════════════════════════════════════════════════════════════════════════
const runSystemDark = async () => {
  const label = '시스템다크/pc';
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', colorScheme: 'dark' });
  await ctx.addInitScript(SEED_LIGHT);
  const cssGate = makeGate();
  const jsGate = makeGate();
  await ctx.route(u => u.pathname.startsWith('/assets/') && u.pathname.endsWith('.css'), async r => { await cssGate.p; await r.continue(); });
  await ctx.route(u => u.pathname.startsWith('/assets/') && u.pathname.endsWith('.js'), async r => { await jsGate.p; await r.continue(); });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'commit' });
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('script')].find(s => !s.src && s.textContent.includes('theme-boot'));
    return !!b && b.textContent.includes('theme-boot:end') && !!document.body;
  }, null, { polling: 100, timeout: 25000 }).catch(() => null);
  const s = await page.evaluate(MEASURE);
  const media = await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);

  eq(`${label}/domain-매체다크`, media ? 'OK' : 'MEDIA_NOT_DARK', 'OK', `matchMedia(prefers-color-scheme:dark)=${media}`);
  eq(`${label}/identity-title`, s.title, 'PortfoliOn');
  eq(`${label}/시스템선호무시-bg`, s.htmlBg, LIGHT_RGB, `저장값 없음 + 시스템 다크 → 라이트 유지(비목표 1)`);
  eq(`${label}/시스템선호무시-attr`, s.dataTheme, 'ABSENT');
  bump('시스템선호', 4);
  INFO(`${label}/덤프`, `htmlBg=${s.htmlBg} dataTheme=${s.dataTheme} meta=${s.metaContent} media=${media}`);

  cssGate.open(); jsGate.open();
  await ctx.close();
  return s;
};

// ── 실행 ──────────────────────────────────────────────────────────────────────
const arms = {};
for (const vp of VIEWPORTS) {
  for (const theme of ['dark', 'light']) {
    arms[`${vp.v}/${theme}`] = await runArm(vp, theme);
  }
}
const controls = {};
for (const vp of VIEWPORTS) controls[vp.v] = await runControl(vp);
for (const vp of VIEWPORTS) {
  for (const theme of ['dark', 'light']) await runInlineOnlyCapture(vp, theme);
}
for (const theme of ['dark', 'light']) await runSplash(theme);
await runSystemDark();

// ── ⓒ 이빨 단언 — 두 토큰이 같아지면 위 축들이 아무것도 안 보면서 통과한다 ──
for (const vp of VIEWPORTS) {
  const d = firstPaint[`${vp.v}/dark`] ?? 'MISSING_DARK';
  const l = firstPaint[`${vp.v}/light`] ?? 'MISSING_LIGHT';
  eq(`이빨/${vp.v}-다크≠라이트`, d === l ? `SAME(${d})` : 'DISTINCT', 'DISTINCT', `dark=${d} · light=${l}`);
  bump('이빨');
}
const distinct = new Set(Object.values(firstPaint));
eq('이빨/전조합-값집합', `${distinct.size}종:${[...distinct].join(' | ')}`, `2종:${DARK_RGB} | ${LIGHT_RGB}`,
  `4조합 W1 첫 페인트 배경의 서로 다른 값 개수`);
bump('이빨');
eq('이빨/표본수', Object.keys(firstPaint).length, VIEWPORTS.length * 2, '첫 페인트 표본이 4조합 전부에서 걷혔는가');
bump('이빨');
eq('이빨/스플래시-다크≠라이트',
  (splashSeen.dark ?? 'MISSING_DARK') === (splashSeen.light ?? 'MISSING_LIGHT') ? `SAME(${splashSeen.dark})` : 'DISTINCT',
  'DISTINCT', `splash dark=${splashSeen.dark ?? 'MISSING'} · light=${splashSeen.light ?? 'MISSING'}`);
bump('이빨');

// ── 리포트 ────────────────────────────────────────────────────────────────────
const asserts = results.filter(r => r.kind === 'assert');
const failed = asserts.filter(r => !r.ok);

console.log('\n=== task#286 — 첫 페인트 전 테마 확정 (라이브 UAT) ===\n');
for (const r of results) {
  const mark = r.kind === 'assert' ? (r.ok ? 'PASS' : 'FAIL') : 'info';
  console.log(`[${mark}] ${r.tag} — ${r.msg}`);
}

console.log('\n--- 커버리지 ---');
const covLine = Object.entries(cov).map(([k, v]) => `${k}:${v}`).join(' · ');
console.log(covLine);
console.log(`커버리지 합계 ${Object.values(cov).reduce((a, b) => a + b, 0)} · 단언 ${asserts.length}건`);

console.log('\n--- 첫 페인트 실측(W1, 번들 CSS 이전) ---');
for (const [k, v] of Object.entries(firstPaint)) console.log(`  ${k}: ${v}`);
console.log(`  대조군(처방 무효화): ${Object.entries(controls).map(([k, c]) => `${k}=${c.htmlBg}`).join(' · ')}`);

if (failed.length) {
  console.log('\n--- FAIL 상세 ---');
  for (const f of failed) console.log(`  ${f.tag} — ${f.msg}`);
}

fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({
  task: 286, base: BASE, at: new Date().toISOString(),
  asserts: asserts.length, pass: asserts.length - failed.length, fail: failed.length,
  coverage: cov, firstPaint, control: Object.fromEntries(Object.entries(controls).map(([k, c]) => [k, c.htmlBg])),
  results,
}, null, 2));

console.log(`\n${failed.length ? `FAIL ${failed.length}/${asserts.length}` : `ALL PASS ${asserts.length}/${asserts.length}`}`);
console.log(`스크린샷: ${OUT}`);

await browser.close();
process.exit(failed.length ? 1 : 0);
