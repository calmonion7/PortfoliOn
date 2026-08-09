import { chromium, devices } from 'playwright';
import fs from 'fs';

// task#287 라이브 UAT — useSwUpdateReload(새 SW claim 후 라우트 전환·탭 재활성 시점에 리로드).
//
// ⚠️ 하니스 예외: 이 프로브만 `serviceWorkers: 'allow'`로 돈다. 이 저장소의 관례는 'block'이지만
//    (SW가 /api/*를 NetworkFirst로 가로채 응답 주입을 무력화하므로) **SW 자체가 판정 대상**이라
//    block하면 원리적으로 아무것도 못 잰다. 그 대가로 응답 주입에 의존하는 축은 넣지 않았다.
//
// 무장(arming)은 합성 dispatchEvent가 아니라 **진짜 controllerchange**로 만든다 — 브라우저는
// 쿼리가 다른 스크립트 URL을 다른 SW로 취급하므로 register('/sw.js?uat287-…')가 install→
// skipWaiting→activate→clientsClaim을 거쳐 실제 controllerchange를 1회 발화시킨다.
//
// 판정 도구 = **문서 지문**. logDiag는 각 항목에 t=Date.now()·rel=Math.round(performance.now())을
// 실으므로 `t − rel`이 그 문서의 navigationStart다(task#284 ⓠ). 지문이 바뀌면 문서 교체(=리로드),
// 그대로면 SPA 내부 전환. 현재 문서 지문은 같은 식(Date.now()−performance.now())으로 페이지에서 읽는다.
//
// 무장/미무장의 증거도 diag에서 직접 읽는다 — 훅은 **무장했을 때만** sw-update를 남기고
// 최초 설치의 controllerchange는 로그 없이 삼킨다. 그래서 "이 문서 지문의 sw-update 유무"가
// 곧 무장 여부이고, 이것이 ⓒ(미무장 대조)·ⓓ(오발화 차단)의 이빨이 된다(⑧ⓐ sentinel).
const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat287';
fs.mkdirSync(OUT, { recursive: true });

const AX = {
  f: 'ⓕ 대상-identity', d: 'ⓓ 최초방문-오발화차단', c: 'ⓒ 이빨-미무장대조',
  d2: 'ⓓ2 이빨-1회스왈로리셋', a: 'ⓐ 라우트경로', b: 'ⓑ 재가시화',
  e: 'ⓔ 가드-모달', ei: 'ⓔ 가드-입력', g: 'ⓖ 내부리다이렉트흡수', h: 'ⓗ 프로브건전성',
};

const checks = [];
const cov = {};
const bump = (k, n = 1) => { cov[k] = (cov[k] || 0) + n; };
const assert = (view, ax, name, got, want) => {
  checks.push({ view, ax, name, got, want, pass: JSON.stringify(got) === JSON.stringify(want) });
  bump(`${ax}`);
};

// ── 로그인(라이브 토큰) ──────────────────────────────────────────────────────
const lr = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const { access_token, refresh_token } = await lr.json();
if (!access_token) { console.error('로그인 실패 — 추정 폴백 없이 종료.'); process.exit(1); }

// 앱 정본 SW의 쿼리는 빌드마다 바뀐다 → 하드코딩하지 않고 라이브에서 읽는다.
// ⚠️ **앱이 요청하는 것과 똑같은 URL로** 읽어야 한다. 맨 경로 `/registerSW.js`는 nginx가
//    `immutable, max-age=1y`로 주고 Cloudflare가 캐싱해 **이전 빌드 내용**을 반환한다
//    (실측: cf-cache-status HIT · age 123613s · sw.js?20260808061549 vs 실제 20260809161458).
//    앱은 index.html의 <script src="/registerSW.js?<build>">로 받으므로 그 쿼리를 그대로 붙인다.
const liveHtml = await (await fetch(`${BASE}/index.html`, { cache: 'no-store' })).text();
const REG_SRC = (liveHtml.match(/src="(\/registerSW\.js[^"]*)"/) || [])[1];
if (!REG_SRC) { console.error('index.html에서 registerSW 스크립트 태그를 못 읽음 — 추정 폴백 없이 종료.'); process.exit(1); }
const regJs = await (await fetch(`${BASE}${REG_SRC}`)).text();
const APP_SW_Q = (regJs.match(/\/sw\.js\?([^'"]+)/) || [])[1];
if (!APP_SW_Q) { console.error('registerSW.js에서 앱 SW 쿼리를 못 읽음 — 추정 폴백 없이 종료:', regJs.slice(0, 200)); process.exit(1); }
console.log(`앱 정본 SW = /sw.js?${APP_SW_Q}  (출처 ${REG_SRC})`);

// ── 페이지 계측기(문서마다 주입) ────────────────────────────────────────────
// ⚠️ 정의역 정정(task#284 ⓔ 접지선판): 이 계측기는 우리 오리진의 **최상위 문서**만 센다.
//    프로브가 스스로 여는 about:blank 대조 페이지·API 문서는 계측 대상이 아니다.
const RECORDER = ([a, rr]) => {
  if (window.top !== window) return;
  if (location.protocol !== 'https:') return;          // about:blank 등 프로브 인공물 제외
  if (location.pathname.startsWith('/api/')) return;
  try {
    localStorage.setItem('access_token', a);
    localStorage.setItem('refresh_token', rr);
  } catch { /* 계측이 앱을 죽이지 않는다 */ }
  const K = 'uat287_ev';
  const push = (ev, data) => {
    try {
      const l = JSON.parse(localStorage.getItem(K) || '[]');
      l.push({ ev, t: Date.now(), rel: Math.round(performance.now()), ...data });
      while (l.length > 400) l.shift();
      localStorage.setItem(K, JSON.stringify(l));
    } catch { /* no-op */ }
  };
  const swq = () => (navigator.serviceWorker?.controller?.scriptURL || '').split('?')[1] || null;
  push('docstart', { path: location.pathname, ctrl: swq() });
  navigator.serviceWorker?.addEventListener('controllerchange', () => push('ctrlchange', { ctrl: swq() }));
  // isTrusted를 반드시 싣는다 — 합성 자극을 실 전이 증거로 세면 '없는 증거'가 된다(가토 ⑤ⓐ).
  document.addEventListener('visibilitychange', (e) => push('vis', {
    state: document.visibilityState,
    trusted: e.isTrusted === true,
    activeTag: document.activeElement?.tagName || null,
    overflow: document.body?.style.overflow || '',
  }));
  let mounted = false;
  let lastPath = location.pathname;
  const tick = () => {
    if (!mounted && document.querySelector('main.page-wrap')) {
      mounted = true;
      push('mount', { path: location.pathname, ctrl: swq() });
    }
    if (location.pathname !== lastPath) {
      push('pathchange', { from: lastPath, to: location.pathname });
      lastPath = location.pathname;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

// ── 유틸 ────────────────────────────────────────────────────────────────────
const SAME = 50;                                   // 같은 문서로 볼 지문 허용오차(ms). 문서 교체는 최소 수백 ms.
const sameDoc = (x, y) => x != null && y != null && Math.abs(x - y) <= SAME;
const fpOf = (e) => e.t - e.rel;

async function safeEval(page, fn, arg) {           // 리로드와 겹치면 컨텍스트가 파괴된다 → 재시도
  for (let i = 0; i < 5; i++) {
    try { return await page.evaluate(fn, arg); } catch { await page.waitForTimeout(400); }
  }
  return null;
}
const evs = (page) => safeEval(page, () => JSON.parse(localStorage.getItem('uat287_ev') || '[]'));
const diag = (page) => safeEval(page, () => JSON.parse(localStorage.getItem('diag_log') || '[]'));
const curFp = (page) => safeEval(page, () => Math.round(Date.now() - performance.now()));
const clearLogs = (page) => safeEval(page, () => {
  localStorage.removeItem('uat287_ev'); localStorage.removeItem('diag_log');
});

const waitMount = (page) => page
  .waitForFunction(() => !!document.querySelector('main.page-wrap'), { timeout: 30000 })
  .then(() => true).catch(() => false);

async function waitEv(page, pred, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const list = (await evs(page)) || [];
    const hit = list.filter(pred);
    if (hit.length) return hit[hit.length - 1];
    await page.waitForTimeout(250);
  }
  return null;
}
async function waitDiag(page, pred, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const list = (await diag(page)) || [];
    const hit = list.filter(pred);
    if (hit.length) return hit[hit.length - 1];
    await page.waitForTimeout(250);
  }
  return null;
}
async function waitFpChange(page, oldFp, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const f = await curFp(page);
    if (f != null && !sameDoc(f, oldFp)) return f;
    await page.waitForTimeout(250);
  }
  return null;
}

// 무장: 쿼리가 다른 스크립트 URL을 등록해 진짜 controllerchange를 유도한다.
// 증가 판정은 **현재 문서 지문 안에서** 센다 — 전역 카운트로 세면 직전 문서의 sw-update가 섞인다.
async function arm(page, tag) {
  const fp = await curFp(page);
  const n0 = ((await diag(page)) || []).filter((e) => e.ev === 'sw-update' && sameDoc(fpOf(e), fp)).length;
  await safeEval(page, (t) => navigator.serviceWorker.register(`/sw.js?${t}`, { scope: '/' }), tag);
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) {
    const n = ((await diag(page)) || []).filter((e) => e.ev === 'sw-update' && sameDoc(fpOf(e), fp)).length;
    if (n > n0) return true;
    await page.waitForTimeout(300);
  }
  return false;
}

// 미무장 정착 — 직전 페이즈가 probe SW를 남겨두면 다음 문서에서 registerSW가 정본으로 되돌리며
// controllerchange가 와서 그 문서는 **무장된 채로 시작**한다. 그래서 "미무장 문서"에 도달하려면
// 리로드가 최대 2회 필요하다(1회차: 정본 복귀 + 무장 / 2회차: 같은 URL 재등록이라 무변화 = 미무장).
// 조건부 스킵이 아니라 목표 상태 도달 루프이며, 도달 실패도 armed 값 그대로 반환해 단언이 잡는다.
async function settleUnarmed(page, q, max = 3) {
  let out = { fp: null, armed: -1, attempts: 0, ctrl: null };
  for (let i = 0; i < max; i++) {
    await clearLogs(page);
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await waitMount(page);
    await page.waitForTimeout(4500);               // controllerchange가 올 시간을 준다(오면 미무장 실패)
    const fp = await curFp(page);
    const armed = ((await diag(page)) || []).filter((e) => e.ev === 'sw-update' && sameDoc(fpOf(e), fp)).length;
    const ctrl = await safeEval(page, () => (navigator.serviceWorker.controller?.scriptURL || '').split('?')[1] || null);
    out = { fp, armed, attempts: i + 1, ctrl };
    if (armed === 0 && ctrl === q) return out;
  }
  return out;
}

// SPA 내부 이동(문서 로드가 아니어야 한다) — **보이는** 내부 링크를 실제로 클릭한다.
// ⚠️ `locator(a[href=X]).first()`는 DOM 순서 첫 매치라 모바일에서 display:none인 PC 마스트헤드
//    사본을 집어 클릭이 통째 실패한다(1차 실행에서 모바일 nav 6건 전부 이 이유로 FAIL).
//    후보 수집과 클릭 **양쪽 모두** 가시성으로 좁혀야 한다.
async function spaNavigate(page, avoid) {
  const all = await safeEval(page, () => {
    const cur = location.pathname;
    return [...document.querySelectorAll('a[href^="/"]')]
      .filter((a) => { const r = a.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
      .map((a) => a.getAttribute('href'))
      .filter((h) => h && !h.startsWith('//') && h !== cur);
  }) || [];
  // 미방문을 선호하되, 소진되면 방문한 곳이라도 쓴다(이동 자체가 목적 — 대상 고갈로 축이 사라지지 않게).
  const order = [...all.filter((h) => !avoid.includes(h)), ...all];
  if (!order.length) return { ok: false, reason: 'NAV_TARGET_MISSING', href: null };
  for (const href of order.slice(0, 3)) {
    try {
      await page.locator(`a[href="${href}"] >> visible=true`).first().click({ timeout: 6000 });
      return { ok: true, href };
    } catch (e) {
      // 리로드가 클릭과 겹치면 컨텍스트 파괴로 throw할 수 있다 — 이동 자체는 성사됐을 수 있으므로
      // 실패로 단정하지 않고 사유를 싣고 반환한다(판정은 지문·pathchange 실측으로 한다).
      if (/context was destroyed|Target closed|Execution context/i.test(e.message)) return { ok: true, href, note: 'ctx-destroyed' };
    }
  }
  return { ok: false, reason: 'NAV_CLICK_FAILED', href: order[0] };
}

// ── 본 실행 ─────────────────────────────────────────────────────────────────
async function run(view, ctxOpts) {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ ...ctxOpts, serviceWorkers: 'allow' });
  await ctx.addInitScript(RECORDER, [access_token, refresh_token]);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const visited = [];
  const detail = {};

  // ══ P0. 첫 로드 → ⓕ identity + ⓓ 최초방문 오발화 차단 ══════════════════
  await page.goto(`${BASE}/reports`, { waitUntil: 'domcontentloaded' });
  const mounted = await waitMount(page);

  // nav는 AppShell 마운트보다 몇 프레임 늦게 그려진다 — 마운트 직후에 세면 0이 나온다
  // (1차 실행 pc에서 routeLinks=0으로 거짓 FAIL). 이동 대상 정의역이므로 렌더를 기다린다.
  await page.waitForFunction(
    () => [...document.querySelectorAll('a[href^="/"]')].some((a) => a.getBoundingClientRect().width > 0),
    { timeout: 20000 },
  ).catch(() => {});
  const ident = await safeEval(page, () => ({
    title: document.title,
    pageWrap: document.querySelectorAll('main.page-wrap').length,
    appRoot: document.querySelectorAll('div.app-pc').length,
    brand: [...document.querySelectorAll('.brand .serif')].map((e) => e.textContent.trim())[0] || null,
    origin: location.origin,
    routeLinks: new Set([...document.querySelectorAll('a[href^="/"]')]
      .filter((a) => a.getBoundingClientRect().width > 0).map((a) => a.getAttribute('href'))).size,
    swSupported: 'serviceWorker' in navigator,
  })) || {};
  detail.identity = ident;
  // 대상 유효성은 다른 축보다 먼저. AppShell(main.page-wrap)은 세션이 있어야만 렌더되므로
  // 이 마커 자체가 "로그인된 우리 앱"의 증거다(LoginPage·404엔 없다).
  assert(view, AX.f, 'document.title', ident.title, 'PortfoliOn');
  assert(view, AX.f, 'AppShell 마커 main.page-wrap 1개(세션 증거)', ident.pageWrap, 1);
  assert(view, AX.f, '앱 루트 div.app-pc 1개', ident.appRoot, 1);
  assert(view, AX.f, '브랜드 마커', ident.brand, 'PortfoliOn');
  assert(view, AX.f, '오리진', ident.origin, BASE);
  assert(view, AX.f, 'serviceWorker 지원', ident.swSupported, true);
  assert(view, AX.f, '내부 라우트 링크 존재(이동 대상 정의역)', ident.routeLinks > 0 ? 'YES' : 'NAV_TARGET_MISSING', 'YES');
  if (!mounted || ident.pageWrap !== 1) {
    console.error(`[${view}] 대상 페이지 미확립 — 이후 축은 무의미하므로 종료.`, JSON.stringify(ident));
    await b.close();
    return { errs, detail };
  }

  // ⓓ — 최초 방문: 마운트 시점 controller 부재 + 그 뒤 claim → 리로드 없음(sw-update도 없음).
  const mountEv = await waitEv(page, (e) => e.ev === 'mount', 15000);
  const claimEv = await waitEv(page, (e) => e.ev === 'ctrlchange', 30000);
  const fp0 = await curFp(page);
  detail.firstVisit = { mount: mountEv, claim: claimEv, fp0 };
  assert(view, AX.d, '[domain] mount 이벤트 관측', mountEv ? 'YES' : 'MOUNT_MISSING', 'YES');
  assert(view, AX.d, '[domain] AppShell 마운트 시 controller 부재(=hadController false)',
    mountEv ? (mountEv.ctrl === null ? 'null' : `HAD_CONTROLLER(${mountEv.ctrl})`) : 'MOUNT_MISSING', 'null');
  assert(view, AX.d, '[domain] 최초 claim(controllerchange) 발화', claimEv ? 'YES' : 'CLAIM_MISSING', 'YES');
  assert(view, AX.d, '[domain] claim이 마운트 이후에 도착(훅이 듣고 있었다)',
    (mountEv && claimEv && claimEv.rel > mountEv.rel) ? 'YES' : `ORDER_BAD(mount=${mountEv?.rel},claim=${claimEv?.rel})`, 'YES');
  await page.waitForTimeout(2500);
  const d0 = (await diag(page)) || [];
  const fp0b = await curFp(page);
  assert(view, AX.d, '최초 claim은 무장하지 않는다(sw-update 0건)',
    d0.filter((e) => e.ev === 'sw-update' && sameDoc(fpOf(e), fp0)).length, 0);
  assert(view, AX.d, '최초 claim은 리로드하지 않는다(sw-reload 0건)',
    d0.filter((e) => e.ev === 'sw-reload').length, 0);
  assert(view, AX.d, '최초 claim 후 문서 지문 불변', sameDoc(fp0b, fp0) ? 'SAME' : `CHANGED(${fp0}→${fp0b})`, 'SAME');

  // ══ ⓒ 이빨/대조 — 미무장 상태에서 라우트 이동은 리로드하지 않는다 ══════
  // (미무장은 위 'sw-update 0건'으로 실증됨 — 가정이 아니다.)
  const nav1 = await spaNavigate(page, visited);
  if (nav1.href) visited.push(nav1.href);
  await page.waitForTimeout(3500);
  const pc1 = await waitEv(page, (e) => e.ev === 'pathchange', 8000);
  const fp1 = await curFp(page);
  const d1 = (await diag(page)) || [];
  detail.control = { nav: nav1, pathchange: pc1, fp1 };
  assert(view, AX.c, `[domain] 라우트 이동 성사(${nav1.href || 'none'})`, nav1.ok ? 'YES' : nav1.reason, 'YES');
  assert(view, AX.c, `[domain] pathchange 발생(${pc1 ? `${pc1.from}→${pc1.to}` : '없음'})`,
    pc1 ? 'YES' : 'PATHCHANGE_MISSING', 'YES');
  assert(view, AX.c, '미무장 라우트 이동 → 문서 지문 불변(SPA 유지)',
    sameDoc(fp1, fp0) ? 'SAME' : `CHANGED(${fp0}→${fp1})`, 'SAME');
  assert(view, AX.c, '미무장 라우트 이동 → sw-reload 0건', d1.filter((e) => e.ev === 'sw-reload').length, 0);

  // ══ ⓓ2 이빨 — 같은 문서의 2번째 controllerchange는 무장한다(1회 스왈로 리셋) ══
  const armed1 = await arm(page, `uat287-${view}-1`);
  const cc2 = ((await evs(page)) || []).filter((e) => e.ev === 'ctrlchange' && sameDoc(fpOf(e), fp0));
  const d2 = (await diag(page)) || [];
  detail.swallowReset = { armed1, ctrlchanges: cc2.map((e) => `${e.rel}:${e.ctrl}`) };
  assert(view, AX.d2, '[domain] 같은 문서에서 controllerchange 2회 이상 관측', cc2.length >= 2 ? 'YES' : `ONLY_${cc2.length}`, 'YES');
  assert(view, AX.d2, '2번째 controllerchange는 무장한다(sw-update 1건)',
    d2.filter((e) => e.ev === 'sw-update' && sameDoc(fpOf(e), fp0)).length, 1);

  // ══ ⓐ 라우트 경로 — 무장 후 라우트 이동 → 문서 교체 + via:'route' ══════
  const fpBeforeA = await curFp(page);
  const navA = await spaNavigate(page, visited);
  if (navA.href) visited.push(navA.href);
  const fpAfterA = await waitFpChange(page, fpBeforeA, 15000);
  await waitMount(page);
  const dA = (await diag(page)) || [];
  const reloadA = dA.filter((e) => e.ev === 'sw-reload' && sameDoc(fpOf(e), fpBeforeA));
  detail.route = { nav: navA, fpBefore: fpBeforeA, fpAfter: fpAfterA, entries: reloadA };
  assert(view, AX.a, `[domain] 라우트 이동 성사(${navA.href || 'none'})`, navA.ok ? 'YES' : navA.reason, 'YES');
  assert(view, AX.a, '무장 후 라우트 이동 → 문서 지문 변화(리로드)',
    fpAfterA ? 'CHANGED' : `UNCHANGED(${fpBeforeA})`, 'CHANGED');
  assert(view, AX.a, "sw-reload via", reloadA.length ? reloadA[reloadA.length - 1].via : 'SW_RELOAD_MISSING', 'route');
  assert(view, AX.a, 'sw-reload 정확히 1건', reloadA.length, 1);

  // ══ ⓑ 재가시화 ═══════════════════════════════════════════════════════════
  // ⓑ1 도구 한계 핀 — bringToFront가 **실** visibility 전이를 만드는가(대조군).
  //     대조군은 앱과 무관한 빈 페이지다: 0건이 나오면 그건 앱이 아니라 계측기의 성질이다(가토 ⑧ⓔ).
  //     want='NONE'은 한계를 승인하는 게 아니라 **현재 도구 사실을 핀으로 박는 것**이다 —
  //     이 단언이 FAIL하면 도구가 능력을 얻었다는 뜻이고, 그때 ⓑ2를 실 전이로 승격해야 한다(⑧ⓞ).
  const st1 = await settleUnarmed(page, APP_SW_Q);
  detail.settle1 = st1;
  assert(view, AX.b, '[domain] 정착 후 미무장(sw-update 0건)', st1.armed, 0);
  assert(view, AX.b, '[domain] 정착 후 controller = 앱 정본 SW', st1.ctrl, APP_SW_Q);
  const blank = await ctx.newPage();
  await blank.goto('about:blank');
  await blank.evaluate(() => {
    window.__vis = [];
    document.addEventListener('visibilitychange', (e) => window.__vis.push(`${document.visibilityState}/${e.isTrusted}`));
  });
  await page.bringToFront(); await page.waitForTimeout(900);
  await blank.bringToFront(); await page.waitForTimeout(900);
  await page.bringToFront(); await page.waitForTimeout(900);
  const ctrlVis = await blank.evaluate(() => window.__vis);
  const appTrustedVis = ((await evs(page)) || []).filter((e) => e.ev === 'vis' && e.trusted && sameDoc(fpOf(e), st1.fp));
  detail.visibilityTool = { controlTransitions: ctrlVis, appTrustedVisible: appTrustedVis.map((e) => e.state) };
  assert(view, AX.b, '[도구한계 핀] 대조군 빈 페이지에서 실 visibility 전이 관측 수', ctrlVis.length, 0);
  assert(view, AX.b, '[도구한계 핀] 앱 페이지에서 실 visible 전이 관측 수',
    appTrustedVis.filter((e) => e.state === 'visible').length, 0);
  await blank.close();
  await page.bringToFront();

  // ⓑ2 합성 소스 트리거(라벨 명시) — 이벤트 **출처만** 합성이고, 무장(진짜 controllerchange)·
  //     가드·리로드·문서 교체는 전부 실물이다. 실 탭 전이 측정이 아님을 출력에 라벨로 남긴다.
  const armedB = await arm(page, `uat287-${view}-2`);
  const fpBeforeB = await curFp(page);
  assert(view, AX.b, '[domain] 무장 성공(sw-update)', armedB ? 'YES' : 'ARM_FAILED', 'YES');
  await safeEval(page, () => document.dispatchEvent(new Event('visibilitychange')));
  const fpAfterB = await waitFpChange(page, fpBeforeB, 15000);
  await waitMount(page);
  const dB = (await diag(page)) || [];
  const reloadB = dB.filter((e) => e.ev === 'sw-reload' && sameDoc(fpOf(e), fpBeforeB));
  const visEvB = ((await evs(page)) || []).filter((e) => e.ev === 'vis' && sameDoc(fpOf(e), fpBeforeB));
  // ⚠️ 문서가 리로드로 교체될 때 브라우저가 **실제** visibilitychange(hidden)를 쏜다 — 마지막
  //    항목을 그냥 집으면 그 언로드 이벤트를 자극으로 오인한다(1차 실행 pc·mobile 거짓 FAIL).
  //    자극은 isTrusted=false인 항목으로 특정하고, 실 전이는 따로 0건임을 단언한다.
  const synthB = visEvB.filter((e) => e.trusted === false);
  detail.visibility = { armedB, fpBefore: fpBeforeB, fpAfter: fpAfterB, vis: visEvB, entries: reloadB, source: 'SYNTHETIC-EVENT(실 탭 전이 아님)' };
  assert(view, AX.b, '[domain] 합성 visibilitychange 정확히 1건 수신', synthB.length, 1);
  assert(view, AX.b, '[domain] 합성 트리거 시점 visibilityState',
    synthB.length ? synthB[synthB.length - 1].state : 'VIS_EVENT_MISSING', 'visible');
  assert(view, AX.b, '[domain] 이 축에 실(trusted) visible 전이가 섞이지 않았다',
    visEvB.filter((e) => e.trusted && e.state === 'visible').length, 0);
  assert(view, AX.b, '무장 후 재가시화 → 문서 지문 변화(리로드)',
    fpAfterB ? 'CHANGED' : `UNCHANGED(${fpBeforeB})`, 'CHANGED');
  assert(view, AX.b, 'sw-reload via', reloadB.length ? reloadB[reloadB.length - 1].via : 'SW_RELOAD_MISSING', 'visibility');

  // ══ ⓔ 가드(모달) + pending 보존 ═════════════════════════════════════════
  const st2 = await settleUnarmed(page, APP_SW_Q);
  detail.settle2 = st2;
  assert(view, AX.e, '[domain] 정착 후 미무장(sw-update 0건)', st2.armed, 0);
  assert(view, AX.e, '[domain] 정착 후 controller = 앱 정본 SW', st2.ctrl, APP_SW_Q);
  await safeEval(page, () => { document.body.style.overflow = 'hidden'; });
  const armedE = await arm(page, `uat287-${view}-3`);
  assert(view, AX.e, '[domain] 무장 성공(sw-update)', armedE ? 'YES' : 'ARM_FAILED', 'YES');
  const fpE0 = await curFp(page);
  const navE1 = await spaNavigate(page, visited);
  if (navE1.href) visited.push(navE1.href);
  await page.waitForTimeout(4000);
  const fpE1 = await curFp(page);
  const stateE = await safeEval(page, () => document.body.style.overflow);
  const pcE = ((await evs(page)) || []).filter((e) => e.ev === 'pathchange' && sameDoc(fpOf(e), fpE0));
  const dE1 = (await diag(page)) || [];
  detail.busyModal = { nav: navE1, overflowAtCheck: stateE, pathchanges: pcE.map((e) => `${e.from}→${e.to}`), fpE0, fpE1 };
  assert(view, AX.e, `[domain] 라우트 이동 성사(${navE1.href || 'none'})`, navE1.ok ? 'YES' : navE1.reason, 'YES');
  assert(view, AX.e, '[domain] pathchange 발생', pcE.length >= 1 ? 'YES' : 'PATHCHANGE_MISSING', 'YES');
  assert(view, AX.e, '[domain] 트리거 시점 body.overflow', stateE, 'hidden');
  assert(view, AX.e, '모달 열림 중 라우트 이동 → 지문 불변(리로드 미발동)',
    sameDoc(fpE1, fpE0) ? 'SAME' : `CHANGED(${fpE0}→${fpE1})`, 'SAME');
  assert(view, AX.e, '모달 열림 중 sw-reload 0건',
    dE1.filter((e) => e.ev === 'sw-reload' && sameDoc(fpOf(e), fpE0)).length, 0);
  // 해제 후 다음 트리거 — pending이 소비되지 않고 남아 있어야 한다.
  await safeEval(page, () => { document.body.style.overflow = ''; });
  const navE2 = await spaNavigate(page, visited);
  if (navE2.href) visited.push(navE2.href);
  const fpE2 = await waitFpChange(page, fpE0, 15000);
  await waitMount(page);
  const dE2 = (await diag(page)) || [];
  const reloadE = dE2.filter((e) => e.ev === 'sw-reload' && sameDoc(fpOf(e), fpE0));
  detail.busyModalRelease = { nav: navE2, fpE2, entries: reloadE };
  assert(view, AX.e, `[domain] 해제 후 라우트 이동 성사(${navE2.href || 'none'})`, navE2.ok ? 'YES' : navE2.reason, 'YES');
  assert(view, AX.e, '모달 해제 후 다음 트리거 → 리로드(pending 보존)',
    fpE2 ? 'CHANGED' : `UNCHANGED(${fpE0})`, 'CHANGED');
  assert(view, AX.e, '보존된 pending의 sw-reload via', reloadE.length ? reloadE[reloadE.length - 1].via : 'SW_RELOAD_MISSING', 'route');

  // ══ ⓔ 가드(입력 포커스) + pending 보존 ═════════════════════════════════
  // 라우트 클릭은 mousedown이 입력을 blur시켜 이 가드를 잴 수 없다 → 합성 visibilitychange를
  // 트리거로 쓴다(포커스를 건드리지 않는 유일한 트리거). 출처가 합성임은 위와 같이 라벨링.
  const st3 = await settleUnarmed(page, APP_SW_Q);
  detail.settle3 = st3;
  assert(view, AX.ei, '[domain] 정착 후 미무장(sw-update 0건)', st3.armed, 0);
  assert(view, AX.ei, '[domain] 정착 후 controller = 앱 정본 SW', st3.ctrl, APP_SW_Q);
  const focusInfo = await safeEval(page, () => {
    const real = [...document.querySelectorAll('input,textarea,select')]
      .find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    if (real) { real.focus(); return { src: 'app-input', tag: real.tagName, ph: real.placeholder || '' }; }
    const inj = document.createElement('input');
    inj.id = 'uat287-injected';
    document.body.appendChild(inj);
    inj.focus();
    return { src: 'injected-input', tag: inj.tagName, ph: '' };
  });
  const armedI = await arm(page, `uat287-${view}-4`);
  assert(view, AX.ei, '[domain] 무장 성공(sw-update)', armedI ? 'YES' : 'ARM_FAILED', 'YES');
  const fpI0 = await curFp(page);
  await safeEval(page, () => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(3500);
  const fpI1 = await curFp(page);
  const visI = ((await evs(page)) || []).filter((e) => e.ev === 'vis' && sameDoc(fpOf(e), fpI0));
  const synthI = visI.filter((e) => e.trusted === false);   // 언로드 hidden과 자극을 가른다(위 ⓑ와 동일)
  const dI1 = (await diag(page)) || [];
  detail.busyInput = { focusInfo, vis: visI, fpI0, fpI1 };
  assert(view, AX.ei, '[domain] 포커스 대상 확보', focusInfo?.tag || 'FOCUS_TARGET_MISSING', 'INPUT');
  assert(view, AX.ei, '[domain] 합성 visibilitychange 정확히 1건 수신', synthI.length, 1);
  assert(view, AX.ei, '[domain] 트리거 시점 activeElement',
    synthI.length ? synthI[synthI.length - 1].activeTag : 'VIS_EVENT_MISSING', 'INPUT');
  assert(view, AX.ei, '입력 포커스 중 재가시화 → 지문 불변(리로드 미발동)',
    sameDoc(fpI1, fpI0) ? 'SAME' : `CHANGED(${fpI0}→${fpI1})`, 'SAME');
  assert(view, AX.ei, '입력 포커스 중 sw-reload 0건',
    dI1.filter((e) => e.ev === 'sw-reload' && sameDoc(fpOf(e), fpI0)).length, 0);
  await safeEval(page, () => { document.activeElement?.blur?.(); document.getElementById('uat287-injected')?.remove(); });
  await safeEval(page, () => document.dispatchEvent(new Event('visibilitychange')));
  const fpI2 = await waitFpChange(page, fpI0, 15000);
  await waitMount(page);
  const dI2 = (await diag(page)) || [];
  const reloadI = dI2.filter((e) => e.ev === 'sw-reload' && sameDoc(fpOf(e), fpI0));
  detail.busyInputRelease = { fpI2, entries: reloadI };
  assert(view, AX.ei, '포커스 해제 후 다음 트리거 → 리로드(pending 보존)',
    fpI2 ? 'CHANGED' : `UNCHANGED(${fpI0})`, 'CHANGED');
  assert(view, AX.ei, '보존된 pending의 sw-reload via', reloadI.length ? reloadI[reloadI.length - 1].via : 'SW_RELOAD_MISSING', 'visibility');

  // ══ ⓖ 내부 리다이렉트 흡수 ═══════════════════════════════════════════════
  // '/'는 REDIRECTS 출발지 → 착지 즉시 <Navigate replace>로 '/reports'로 간다.
  // 그 전환은 사용자 이동이 아니므로 리로드를 일으켜선 안 된다.
  // 직전에 probe SW를 등록해 두면, 새 문서에서 registerSW가 정본으로 되돌리며 controllerchange가
  // 오므로 "리다이렉트 시점 vs 무장 시점"의 선후를 실측할 수 있다.
  const st4 = await settleUnarmed(page, APP_SW_Q);
  detail.settle4 = st4;
  assert(view, AX.g, '[domain] 정착 후 미무장(sw-update 0건)', st4.armed, 0);
  assert(view, AX.g, '[domain] 정착 후 controller = 앱 정본 SW', st4.ctrl, APP_SW_Q);
  await safeEval(page, (t) => navigator.serviceWorker.register(`/sw.js?${t}`, { scope: '/' }), `uat287-${view}-5`);
  await waitEv(page, (e) => e.ev === 'ctrlchange' && e.ctrl === `uat287-${view}-5`, 25000);
  await clearLogs(page);
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  const redirEv = await waitEv(page, (e) => e.ev === 'pathchange' && e.from === '/', 20000);
  const fpG = await curFp(page);
  const dsG = await waitEv(page, (e) => e.ev === 'docstart', 5000);
  const dG1 = (await diag(page)) || [];
  detail.redirect = { docstart: dsG, redirect: redirEv, fpG };
  assert(view, AX.g, '[domain] 문서가 REDIRECTS 출발지 "/"에 착지', dsG ? dsG.path : 'DOCSTART_MISSING', '/');
  assert(view, AX.g, '[domain] 내부 리다이렉트 관측',
    redirEv ? `${redirEv.from}→${redirEv.to}` : 'REDIRECT_MISSING', '/→/reports');
  assert(view, AX.g, '내부 리다이렉트 → 문서 지문 불변(리로드 없음)',
    (dsG && sameDoc(fpG, fpOf(dsG))) ? 'SAME' : `CHANGED(${dsG ? fpOf(dsG) : '?'}→${fpG})`, 'SAME');
  assert(view, AX.g, '내부 리다이렉트 → sw-reload 0건', dG1.filter((e) => e.ev === 'sw-reload').length, 0);

  // ⓖ2 이빨 — 흡수는 **1회 소진형**이어야 한다. 리다이렉트가 그 1회를 먹었으므로
  //     사용자의 첫 실제 이동은 흡수되지 않고 리로드해야 한다(안 그러면 흡수가 과잉이다).
  const armG = await waitDiag(page, (e) => e.ev === 'sw-update', 25000);
  const ccG = ((await evs(page)) || []).filter((e) => e.ev === 'ctrlchange');
  const fpG1 = await curFp(page);
  const navG = await spaNavigate(page, []);
  const fpG2 = await waitFpChange(page, fpG1, 15000);
  await waitMount(page);
  const dG2 = (await diag(page)) || [];
  const reloadG = dG2.filter((e) => e.ev === 'sw-reload' && sameDoc(fpOf(e), fpG1));
  detail.redirectTeeth = {
    nav: navG, armRel: armG?.rel ?? null, redirectRel: redirEv?.rel ?? null,
    ctrlchangeRels: ccG.map((e) => e.rel), fpG1, fpG2, entries: reloadG,
  };
  assert(view, AX.g, '[domain] 재무장 성공(앱 자신의 재등록)', armG ? 'YES' : 'ARM_FAILED', 'YES');
  assert(view, AX.g, `[domain] 이후 라우트 이동 성사(${navG.href || 'none'})`, navG.ok ? 'YES' : navG.reason, 'YES');
  assert(view, AX.g, '흡수는 1회 소진 — 그 다음 실제 이동은 리로드',
    fpG2 ? 'CHANGED' : `UNCHANGED(${fpG1})`, 'CHANGED');
  assert(view, AX.g, '소진 후 sw-reload via', reloadG.length ? reloadG[reloadG.length - 1].via : 'SW_RELOAD_MISSING', 'route');
  // 메커니즘 참여(커버리지) — 리다이렉트 시점에 pending이 실제로 true였는가.
  detail.redirectMechanism = (redirEv && armG)
    ? (armG.rel < redirEv.rel ? `ARMED-BEFORE-REDIRECT(arm=${armG.rel} < redirect=${redirEv.rel})`
      : `UNARMED-AT-REDIRECT(redirect=${redirEv.rel} < arm=${armG.rel})`)
    : 'UNKNOWN';

  // ══ ⓗ 프로브 건전성 — 로그 링버퍼(MAX 50) 넘침은 측정 손실이다 ══════════
  const dLen = ((await diag(page)) || []).length;
  assert(view, AX.h, 'diag 링버퍼 미포화(<50 — 포화 시 초기 항목 유실로 지문 대조 불가)', dLen < 50, true);
  detail.diagLen = dLen;

  // ── 육안 캡처 ──
  await safeEval(page, () => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${view}-app.png`, fullPage: false });
  await page.goto(`${BASE}/reports?diag=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${view}-diaglog.png`, fullPage: true });

  console.log(`\n===== [${view}] 상세 실측 =====`);
  console.log(JSON.stringify(detail, null, 1));
  if (errs.length) console.log(`[${view}] pageerror ${errs.length}건:`, [...new Set(errs)].slice(0, 5));
  await b.close();
  return { errs, detail };
}

const pc = await run('pc', { viewport: { width: 1440, height: 900 } });
const mo = await run('mobile', { ...devices['iPhone 13'] });

const failed = checks.filter((c) => !c.pass);
console.log('\n================ 판정 ================');
console.log(`하니스 예외: serviceWorkers:'allow' (이 저장소 관례는 'block'이나 SW 자체가 판정 대상 — 응답 주입 축은 배제)`);
console.log(`ⓑ 실 visibility 전이: 도구가 만들지 못함(대조군 실측) → ⓑ2는 **합성 소스** 트리거이며 실 탭 전이 측정이 아님`);
console.log(`ⓖ 메커니즘 참여: pc=${pc.detail?.redirectMechanism} · mobile=${mo.detail?.redirectMechanism}`);
for (const c of checks) {
  console.log(`${c.pass ? 'PASS' : 'FAIL'} [${c.view}] ${c.ax} — ${c.name} · got=${JSON.stringify(c.got)} want=${JSON.stringify(c.want)}`);
}
console.log('\n=== 커버리지(축별 단언 수) ===');
for (const [k, v] of Object.entries(cov)) console.log(`  ${k}: ${v}`);
const byView = (v) => checks.filter((c) => c.view === v).length;
console.log(`  합계 ${checks.length}건 (pc ${byView('pc')} · mobile ${byView('mobile')}) · PASS ${checks.length - failed.length} · FAIL ${failed.length}`);
console.log(failed.length ? `\n>>> FAIL ${failed.length}/${checks.length}` : `\n>>> ALL PASS ${checks.length}/${checks.length}`);
fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ appSw: APP_SW_Q, cov, checks, pc: pc.detail, mobile: mo.detail }, null, 2));
process.exit(failed.length ? 1 : 0);
