// task#288 라이브 UAT — `useAuthBootstrap.bootTimings()`가 doc 진단 로그에 싣는 부팅 성분
// (req·resp·di·js)이 **실제 라이브 문서에서 살아남는지**를 실측하고, 그 성분으로
// 「콜백 문서 부팅」과 「로그인 문서 부팅」을, 그리고 「콜드(SW 미설치)」와 「웜(SW 컨트롤)」을 대조한다.
//
// 왜 이 프로브가 필요한가(존재 이유):
//   task#284가 구글 로그인 체감 2513ms 중 **89.6%가 콜백 문서의 SPA 부팅(2251ms)**임을 밝혔지만,
//   그 2251ms의 내부는 한 덩어리였다. #288 S1이 그 덩어리를 0→req(리다이렉트·연결) /
//   req→resp(서버) / resp→di(HTML 파싱) / di→마운트(번들 실행)로 쪼개는 계측을 넣었고,
//   이 프로브는 **그 계측이 라이브에서 실제로 값을 남기는가**를 잰다.
//   `bootTimings()`는 유한값일 때만 키를 싣는다 → **키 부재 = 그 값을 못 얻었다**는 뜻이고,
//   그건 조용히 사라진다. 특히 **웜 arm의 `js`**(SW 캐시가 서빙한 번들이
//   PerformanceResourceTiming을 남기는가)는 적대적 리뷰가 지목한 미확증 MED다.
//   → 여기서는 부드럽게 통과시키지 않는다. 키 부재는 sentinel(`FIELD_MISSING`)로 **FAIL**시킨다.
//
// ⚠️ 하니스 예외 — `serviceWorkers: 'allow'`:
//   이 저장소 관례는 'block'이지만(SW가 /api/*를 NetworkFirst로 가로채 응답 주입을 무력화하므로),
//   **SW 설치 여부가 콜드/웜 축 그 자체**라 block하면 웜 arm이 원리적으로 존재하지 않는다.
//   그 대가로 응답 주입에 의존하는 축은 하나도 쓰지 않는다(전부 라이브 실응답).
//   참고: task#290(ADR-0036)부터 vite.config.js runtimeCaching에 `/api/*` 패턴 자체가 없다
//   (기존 `!/\/api\/auth\//` 제외 규칙째로 제거) — `/api/*` 전체가 SW 라우트를 안 타므로
//   코드교환 호출도 당연히 SW에 오염되지 않는다.
//
// 측정 대상 — 진짜 콜백 문서 부팅:
//   `/?oauth=<무효코드>`로 진입하면 백엔드 `auth.py:232 oauth_token_exchange`가
//   `_pop_oauth_tokens`(순수 인메모리 dict)에서 못 찾아 **400**을 주고, 프론트는
//   `useAuthBootstrap.js:104` → `resolveStored()` → `boot{branch:'oauth-fail'}`로
//   **정상 성공 경로와 같은 코드 경로**를 탄다. uat253이 이미 쓰는 확립된 패턴이며 **DB 쓰기 0**이다
//   (400 경로는 dict pop 실패가 전부 — INSERT/UPDATE 없음. 아래 write-audit 축이 이를 실측한다).
//
// 4조합(전부 필수) — 콜드/웜은 **SW 설치 여부**로 가른다:
//   컨텍스트 A(새로) ① /?oauth=uat288-cold-cb  첫 로드  = 콜드·콜백
//                    → SW 활성·claim 대기 →
//                    ② /?oauth=uat288-warm-cb            = 웜·콜백
//   컨텍스트 B(새로) ③ /                        첫 로드  = 콜드·로그인
//                    → SW 활성·claim 대기 →
//                    ④ /                                  = 웜·로그인
//
// 판정축:
//   ⓐ 필드 생존 — req·resp·di·js가 실리고 비0 (미검출은 sentinel FAIL, 조건부 단언 없음)
//   ⓑ 성분 정합 — 0 ≤ req ≤ resp ≤ di ≤ doc.rel ≤ boot.rel 단조 (구간 5개 전부 단언·출력)
//   ⓒ 콜백 vs 로그인 대조 — 구간표 나란히 출력(**단언이 아니라 출력이 목적**, TESTING §7.3 ⓗ)
//   ⓓ 콜드 vs 웜 대조 — 같은 형식 + **이빨 단언**(콜드 ctrl=false / 웜 ctrl=true).
//      이빨이 없으면 "콜드/웜"이 이름뿐인 같은 조건일 수 있고 그러면 ⓓ 전체가 공허하다.
//   ⓔ 대상 identity — title · 그 arm의 코드가 실제 doc.url에 · boot.branch · 코드교환 400
//      (판정축(타이밍)은 문서 내용과 독립이라 **틀린 문서 위에서도 통과**한다, 가토 ⑧ⓘ)
//   ⓕ 문서 지문 — `t − rel`(= 그 문서의 navigationStart, task#284 ⓠ)로 항목을 문서별로 묶는다.
//      한 컨텍스트에 문서가 여러 개 생기므로(콜백 arm은 returnFromOAuth의 replace('/')로 문서를
//      하나 더 만든다) 지문 없이 묶으면 arm이 섞인다.
//
// 판별력(대조군, TESTING §7.3 ⓔ): 별도 대조 페이지를 짓지 않는다 — **콜드 arm이 웜 arm의 대조군**이다.
//   콜드에서 `js`가 관측되는데 웜에서만 사라지면 그건 프로브의 무능이 아니라 SW의 성질이다.
//   반대로 콜드에서도 안 보이면 계측 자체가 못 남기는 것이다 — 두 결론이 실측으로 갈린다.
//
// 단언 규율: 모든 `want`는 **측정과 무관한 고정 리터럴**('OK' 등)이다. got을 그대로 want에 넣으면
//   자기충족 단언이 되어 무엇도 검사하지 않는다 — 실측치는 want가 아니라 `detail`에 싣는다.
//
// 프로브 한계(재지 못하는 것):
//   · 뷰포트 축 없음(PC 1440×900 고정). 이 프로브가 재는 것은 문서 부팅 타이밍이라 레이아웃과 독립이고,
//     4조합이 이미 콜드/웜 × 콜백/로그인이다. 시각 회귀는 이 프로브의 대상이 아니다.
//   · 실제 구글 IdP 왕복은 없다(무효 코드로 콜백 문서만 재현). 코드교환은 라이브 400 실응답.
//   · 헤드리스 1대 머신 실측이라 **절대 수치는 회귀 게이트가 아니다**(TESTING §7.2 성능 프로브 규약).
//     임계값을 하나도 단언하지 않는 이유다 — 단언은 "필드가 살아있는가·성분이 정합한가"에만 건다.
import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat288';
fs.mkdirSync(OUT, { recursive: true });

const AX = {
  e: 'ⓔ 대상-identity',
  a: 'ⓐ 필드생존',
  b: 'ⓑ 성분정합',
  d: 'ⓓ 콜드웜-이빨',
  f: 'ⓕ 문서지문',
  dom: '정의역-sentinel',
  h: 'ⓗ 프로브건전성',
};

const checks = [];
const infos = [];
const cov = {};                                     // 축별 **단언** 수 (assert()가 자동 증가)
const samples = {};                                 // 표본 카운터 — 단언이 아니다(혼동 방지로 분리)
const bump = (k, n = 1) => { cov[k] = (cov[k] || 0) + n; };
const sample = (k, n = 1) => { samples[k] = (samples[k] || 0) + n; };
// want는 항상 고정 리터럴, 실측치는 detail로 — 자기충족 단언 금지.
const assert = (ax, name, got, want, detail = '') => {
  checks.push({ ax, name, got, want, detail, pass: JSON.stringify(got) === JSON.stringify(want) });
  bump(ax);
};
const INFO = (tag, msg) => infos.push({ tag, msg });
const die = (msg) => { console.error(`\n✗ 중단 — ${msg}`); process.exit(2); };

// 정의역 sentinel — 표본이 0이면 "위반 0건 = 통과"로 공허해지는 것을 막는다(TESTING §7.3 ⓐ/ⓑ).
const assertDomain = (tag, cnt) =>
  assert(AX.dom, `${tag} 정의역`, cnt > 0 ? 'OK' : 'DOMAIN_EMPTY', 'OK', `n=${cnt}`);

// ── 문서 지문 ────────────────────────────────────────────────────────────────
// logDiag는 각 항목에 t=Date.now()·rel=Math.round(performance.now())을 싣는다.
// performance.now()는 문서별 navigationStart 기준이므로 `t − rel` = 그 문서의 navigationStart다.
const SAME = 60;                                   // 같은 문서로 볼 허용오차(ms). 문서 교체는 최소 수백 ms.
const fpOf = (e) => e.t - e.rel;
const sameDoc = (x, y) => x != null && y != null && Math.abs(x - y) <= SAME;

// ── 접지선 계측기(문서마다 주입) ─────────────────────────────────────────────
// 앱의 diag_log와 **독립**인 기록. 목적 둘:
//   ① 문서 시작 시점의 `navigator.serviceWorker.controller` 유무(= 콜드/웜의 접지선).
//      settle 후에 읽으면 그 사이 claim이 끼어 웜/콜드가 뒤섞인다 — 반드시 문서 *시작*에 찍는다.
//   ② 그 문서의 title(대상 identity). init 시점엔 <head> 미파싱이라 ''이므로 채워지는 즉시 캡처한다.
//   ③ 그 문서의 메인 번들 **PerformanceResourceTiming 원본**(workerStart·transferSize·responseEnd).
//      `workerStart > 0`이면 그 요청이 실제로 SW의 fetch 핸들러를 통과했다는 뜻이다 —
//      이게 없으면 "웜"이 **SW 캐시**인지 그냥 **HTTP 디스크 캐시**인지 구별되지 않아
//      ⓓ 축이 대상(SW)과 독립이 된다(가토 ⑧ⓘ). 또한 이 원본 responseEnd는 앱 자신이 기록한
//      `doc.js`의 **접지선**이 되어 "앱 로거가 그 값을 옳게 실었는가"를 교차검증한다.
// ⚠️ 정의역 정정(task#284 ⓔ 접지선판): 우리 오리진 최상위 https 문서만 센다.
//    /api/* · about:blank 같은 프로브·브라우저 인공물은 계측 대상이 아니다.
const RECORDER = () => {
  try {
    if (window.top !== window) return;
    if (location.protocol !== 'https:') return;
    if (location.pathname.startsWith('/api/')) return;
    const K = 'uat288_docs';
    const push = (o) => {
      try {
        const l = JSON.parse(localStorage.getItem(K) || '[]');
        l.push({ t: Date.now(), rel: Math.round(performance.now()), ...o });
        while (l.length > 200) l.shift();
        localStorage.setItem(K, JSON.stringify(l));
      } catch { /* 계측이 앱을 죽이지 않는다 */ }
    };
    const sw = navigator.serviceWorker;
    push({
      k: 'start',
      url: location.pathname + location.search,
      ctrl: !!(sw && sw.controller),
      ctrlUrl: (sw && sw.controller && sw.controller.scriptURL) || null,
    });
    let titleDone = false;
    const cap = () => {
      if (titleDone) return;
      const t = document.title;
      if (!t) return;
      titleDone = true;
      push({ k: 'title', url: location.pathname + location.search, title: t });
    };
    // 번들 resource 엔트리 원본 — bootTimings()와 **같은 정규식**으로 찾는다(다른 자로 재면 대조가 무의미).
    let resDone = false;
    const capRes = () => {
      if (resDone) return;
      let e = null;
      try {
        e = (performance.getEntriesByType('resource') || [])
          .find((r) => typeof r?.name === 'string' && /\/assets\/index-[^/]*\.js$/.test(r.name));
      } catch { return; }
      if (!e) return;
      resDone = true;
      push({
        k: 'res',
        file: String(e.name).split('/').pop(),
        workerStart: Math.round(e.workerStart),      // >0 = SW fetch 핸들러를 통과했다
        responseEnd: Math.round(e.responseEnd),      // doc.js의 접지선
        transferSize: e.transferSize,
        encodedBodySize: e.encodedBodySize,
        deliveryType: e.deliveryType ?? null,
        nextHopProtocol: e.nextHopProtocol ?? null,
      });
    };
    document.addEventListener('DOMContentLoaded', () => { cap(); capRes(); });
    cap(); capRes();
    const iv = setInterval(() => {
      cap(); capRes();
      if (titleDone && resDone) clearInterval(iv);
    }, 20);
    setTimeout(() => clearInterval(iv), 8000);
  } catch { /* no-op */ }
};

// ── 유틸 ────────────────────────────────────────────────────────────────────
// 콜백 arm은 returnFromOAuth()의 replace('/')로 문서가 갈리므로 evaluate가
// 'Execution context was destroyed'로 깨질 수 있다 → 재시도(uat287 safeEval과 동형).
async function safeEval(page, fn, arg) {
  for (let i = 0; i < 6; i++) {
    try { return await page.evaluate(fn, arg); } catch { await page.waitForTimeout(350); }
  }
  return null;
}
const readDiag = (page) => safeEval(page, () => {
  try { return JSON.parse(localStorage.getItem('diag_log') || '[]'); } catch { return []; }
});
const readRec = (page) => safeEval(page, () => {
  try { return JSON.parse(localStorage.getItem('uat288_docs') || '[]'); } catch { return []; }
});
const clearLogs = (page) => safeEval(page, () => {
  try { localStorage.removeItem('diag_log'); localStorage.removeItem('uat288_docs'); } catch {}
});

async function pollDiag(page, pred, timeout = 40000) {
  const t0 = Date.now();
  let last = [];
  while (Date.now() - t0 < timeout) {
    const l = (await readDiag(page)) || [];
    last = l;
    if (l.some(pred)) return l;
    await page.waitForTimeout(200);
  }
  return last;
}

// SW가 실제로 활성 + 이 클라이언트를 컨트롤할 때까지 대기 = 웜 arm의 전제.
// 조건부 스킵이 아니라 **목표 상태 도달 루프**이고, 도달 실패해도 관측값 그대로 반환해
// 아래 ⓓ 이빨 단언이 그것을 FAIL로 잡는다(무음 스킵 없음).
async function waitSwControl(page, timeout = 45000) {
  const t0 = Date.now();
  let st = null;
  while (Date.now() - t0 < timeout) {
    st = await safeEval(page, async () => {
      if (!('serviceWorker' in navigator)) return { supported: false, active: false, controller: false, ctrlUrl: null };
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

// ── arm 정의 ────────────────────────────────────────────────────────────────
const ARMS = [
  { id: 'cold·callback', ctx: 'A', kind: 'callback', warm: false, code: 'uat288-cold-cb' },
  { id: 'warm·callback', ctx: 'A', kind: 'callback', warm: true, code: 'uat288-warm-cb' },
  { id: 'cold·login', ctx: 'B', kind: 'login', warm: false, code: null },
  { id: 'warm·login', ctx: 'B', kind: 'login', warm: true, code: null },
];

const measured = {};                                // id -> { log, rec }
const swPerArm = {};                                // id -> 문서 시작 시점 controller 상태
const writeAudit = [];                              // 비-GET/HEAD 요청 전수(DB 쓰기 0 근거)
const tokenCalls = [];                              // /api/auth/oauth/token 응답 전수
const pageErrorsAll = [];

// ── 컨텍스트 1개 실행 ────────────────────────────────────────────────────────
async function runContext(label, arms) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    serviceWorkers: 'allow',                        // ⚠️ 하니스 예외 — SW 설치 여부가 판정축이다
  });
  await ctx.addInitScript(RECORDER);

  // 요청 감사 — 페이지·SW 양쪽에서 나가는 모든 요청을 컨텍스트 레벨로 받는다.
  ctx.on('request', (req) => {
    const m = req.method();
    if (m !== 'GET' && m !== 'HEAD') writeAudit.push(`[ctx ${label}] ${m} ${req.url()}`);
  });
  ctx.on('response', (res) => {
    if (res.url().includes('/api/auth/oauth/token')) {
      tokenCalls.push({ ctx: label, url: res.url(), status: res.status() });
    }
  });

  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));

  for (let i = 0; i < arms.length; i++) {
    const arm = arms[i];

    if (i > 0) {
      // 웜 전제 확보 → 그 다음 로그를 비워 arm 경계를 만든다(문서 지문으로도 가르지만,
      // 로그를 비워 두면 링버퍼 포화·arm 간 오염 가능성이 구조적으로 사라진다).
      const sw = await waitSwControl(page);
      INFO(`${arm.id}/SW 대기`,
        `active=${sw.active} controller=${sw.controller} waited=${sw.waitedMs}ms ` +
        `ctrl=${sw.ctrlUrl || 'null'}${sw.timedOut ? ' ⚠️TIMEOUT' : ''}`);
      await clearLogs(page);
    }

    const url = arm.kind === 'callback' ? `${BASE}/?oauth=${arm.code}` : `${BASE}/`;
    await page.goto(url, { waitUntil: 'domcontentloaded' })
      .catch(() => { /* replace('/')와 겹치면 abort — 판정은 로그 실측으로 한다 */ });

    // 부트스트랩 완주 대기 — 콜백은 코드교환 왕복 1회 뒤 boot{oauth-fail}, 로그인은 즉시 boot{stored}.
    const wantBranch = arm.kind === 'callback' ? 'oauth-fail' : 'stored';
    await pollDiag(page, (e) => e.ev === 'boot' && e.branch === wantBranch, 40000);
    // 콜백 arm은 그 직후 returnFromOAuth() → replace('/') → 두 번째 문서가 뜬다. 정착까지 기다린다.
    await page.waitForFunction(() => {
      const vis = (el) => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const pw = [...document.querySelectorAll('input[type="password"]')].filter(vis);
      return pw.length > 0 || !!document.querySelector('.app-pc, .app-main, main.page-wrap');
    }, { timeout: 30000 }).catch(() => null);
    await page.waitForTimeout(1500);

    measured[arm.id] = {
      log: (await readDiag(page)) || [],
      rec: (await readRec(page)) || [],
      landedUrl: page.url(),
    };

    await safeEval(page, () => window.scrollTo(0, 0));
    await page.screenshot({ path: `${OUT}/${arm.id.replace('·', '-')}.png` }).catch(() => {});
  }

  pageErrorsAll.push({ label, errs });
  assert(AX.h, `[ctx ${label}] 콘솔 pageerror`, errs.length === 0 ? 'OK' : 'PAGEERROR', 'OK',
    errs.length ? `${errs.length}건: ${[...new Set(errs)].slice(0, 3).join(' | ')}` : '0건');

  await ctx.close();
  await browser.close();
}

await runContext('A', ARMS.filter((a) => a.ctx === 'A'));
await runContext('B', ARMS.filter((a) => a.ctx === 'B'));

// ── 판정 ────────────────────────────────────────────────────────────────────
assertDomain('arm 실측', Object.keys(measured).length);
if (Object.keys(measured).length !== ARMS.length) {
  die(`arm ${ARMS.length}개 중 ${Object.keys(measured).length}개만 실측됐다 — 대조가 성립하지 않는다`);
}

const rows = [];
const armFps = [];

for (const arm of ARMS) {
  const { log, rec, landedUrl } = measured[arm.id];

  // 정의역 sentinel — 로그가 비면 아래 전부가 공허해진다.
  assertDomain(`${arm.id}/diag_log`, log.length);
  assertDomain(`${arm.id}/접지선`, rec.length);

  const docs = log.filter((e) => e.ev === 'doc');
  // 대상 문서 선별: 콜백은 **그 arm의 코드**로(다른 arm의 문서와 섞이지 않게), 로그인은 '/'.
  const targets = arm.kind === 'callback'
    ? docs.filter((d) => (d.url || '').includes(arm.code))
    : docs.filter((d) => (d.url || '') === '/');

  // ⓕ-1 대상 문서가 정확히 1개
  assert(AX.f, `${arm.id} · 대상 doc 정확히 1건`, targets.length === 1 ? 'OK' : 'COUNT_MISMATCH', 'OK',
    `대상 ${targets.length}건 / 전체 doc [${docs.map((d) => d.url).join(', ') || '없음'}]`);

  const doc = targets[0] || null;
  const fp = doc ? fpOf(doc) : null;
  armFps.push(fp);
  const boots = log.filter((e) => e.ev === 'boot');
  const boot = fp != null ? boots.find((b) => sameDoc(fpOf(b), fp)) : null;
  const recStart = fp != null ? rec.find((r) => r.k === 'start' && sameDoc(fpOf(r), fp)) : null;
  const recTitle = fp != null ? rec.find((r) => r.k === 'title' && sameDoc(fpOf(r), fp)) : null;
  const recRes = fp != null ? rec.find((r) => r.k === 'res' && sameDoc(fpOf(r), fp)) : null;

  // ⓕ-2 doc와 boot가 **같은 문서**에서 나왔는가(ⓑ의 전제 — 다른 문서의 rel을 섞으면 무의미)
  assert(AX.f, `${arm.id} · doc↔boot 같은 문서 지문`,
    fp == null ? 'DOC_MISSING' : (boot ? 'OK' : 'BOOT_MISSING'), 'OK',
    `fp=${fp ?? '—'} · boot fp=${boot ? fpOf(boot) : '—'} · Δ=${boot ? Math.abs(fpOf(boot) - fp) : '—'}ms · ` +
    `이 arm의 boot branch 목록 [${boots.map((b) => `${b.branch}@${fpOf(b)}`).join(', ') || '없음'}]`);

  // ⓕ-3 접지선(독립 계측기)이 같은 문서를 봤는가
  assert(AX.f, `${arm.id} · 접지선 start 결합`, recStart ? 'OK' : 'GROUND_START_MISSING', 'OK',
    `접지선 문서 [${rec.filter((r) => r.k === 'start').map((r) => `${r.url}@${fpOf(r)}`).join(', ') || '없음'}]`);

  // ── ⓔ 대상 identity (판정축보다 먼저) ──────────────────────────────────
  assert(AX.e, `${arm.id} · title`, recTitle?.title ?? 'TITLE_MISSING', 'PortfoliOn',
    `착지 URL=${landedUrl}`);
  const urlOk = arm.kind === 'callback'
    ? !!(doc && (doc.url || '').includes(`oauth=${arm.code}`))
    : !!(doc && doc.url === '/');
  assert(AX.e, `${arm.id} · 대상 doc.url`, urlOk ? 'OK' : 'URL_MISMATCH', 'OK',
    `doc.url=${doc?.url ?? '(DOC_MISSING)'} · 기대=${arm.kind === 'callback' ? `?oauth=${arm.code}` : '/'}`);
  assert(AX.e, `${arm.id} · boot.branch`, boot?.branch ?? 'BOOT_MISSING',
    arm.kind === 'callback' ? 'oauth-fail' : 'stored',
    `session=${boot?.session ?? '—'}`);
  // 코드교환: 콜백 arm은 **그 arm의 코드로** 400을 받았어야 하고, 로그인 arm은 아예 호출이 없어야 한다.
  const myCalls = arm.kind === 'callback'
    ? tokenCalls.filter((c) => c.url.includes(arm.code))
    : tokenCalls.filter((c) => c.ctx === arm.ctx);
  const exchangeOk = arm.kind === 'callback'
    ? (myCalls.length > 0 && myCalls.every((c) => c.status === 400))
    : (myCalls.length === 0);
  assert(AX.e, `${arm.id} · 코드교환 관측`, exchangeOk ? 'OK' : 'EXCHANGE_MISMATCH', 'OK',
    arm.kind === 'callback'
      ? `상태 [${myCalls.map((c) => c.status).join(', ') || '호출 없음'}] (기대 400×≥1)`
      : `호출 ${myCalls.length}건 (기대 0 — 로그인 arm은 코드교환을 타지 않는다)`);

  // ── ⓐ 필드 생존 (조건부 단언 없음 — 미검출은 sentinel FAIL로 총계를 구조적으로 고정) ──
  const vals = {};
  for (const f of ['req', 'resp', 'di', 'js']) {
    const v = doc ? doc[f] : undefined;
    vals[f] = Number.isFinite(v) ? v : null;
    const got = doc == null ? 'DOC_MISSING'
      : !Number.isFinite(v) ? 'FIELD_MISSING'
        : v > 0 ? 'OK' : 'ZERO';
    assert(AX.a, `${arm.id} · doc.${f}`, got, 'OK',
      `값=${Number.isFinite(v) ? v + 'ms' : '(키 없음 — bootTimings는 유한값일 때만 키를 싣는다)'}`);
  }
  // ⓐ 접지선 교차검증 — 앱이 실은 `js`가 브라우저 원본 responseEnd와 같은가.
  // "키가 있고 비0"만으로는 **틀린 엔트리를 집었을 가능성**을 배제하지 못한다(값이 살아 있으면서 오값).
  const jsGt = recRes ? recRes.responseEnd : null;
  const jsOk = Number.isFinite(vals.js) && Number.isFinite(jsGt) && Math.abs(vals.js - jsGt) <= 2;
  assert(AX.a, `${arm.id} · doc.js == 접지선 resource.responseEnd`,
    recRes == null ? 'RES_ENTRY_MISSING' : (vals.js == null ? 'FIELD_MISSING' : (jsOk ? 'OK' : 'VALUE_MISMATCH')), 'OK',
    `앱 doc.js=${vals.js ?? '—'}ms vs 접지선=${jsGt ?? '—'}ms (${recRes?.file ?? '엔트리 없음'})`);

  // ── ⓑ 성분 정합 — 0 ≤ req ≤ resp ≤ di ≤ doc.rel ≤ boot.rel ────────────
  const docRel = doc ? doc.rel : null;
  const bootRel = boot ? boot.rel : null;
  const chain = [
    ['0→req', 0, vals.req],
    ['req→resp', vals.req, vals.resp],
    ['resp→di', vals.resp, vals.di],
    ['di→doc.rel', vals.di, docRel],
    ['doc.rel→boot.rel', docRel, bootRel],
  ];
  const spans = {};
  for (const [nm, a, b] of chain) {
    const ok = Number.isFinite(a) && Number.isFinite(b);
    spans[nm] = ok ? b - a : null;
    assert(AX.b, `${arm.id} · ${nm}`,
      !ok ? 'MEASURE_FAIL' : (b - a >= 0 ? 'OK' : 'NEGATIVE'), 'OK',
      ok ? `${a} → ${b} = ${b - a}ms` : `a=${a ?? '—'} b=${b ?? '—'}`);
  }

  // ── ⓓ 콜드/웜 이빨 — 두 조건이 실제로 다른가(아니면 ⓓ 대조가 공허하다) ──
  const ctrl = recStart ? recStart.ctrl : null;
  swPerArm[arm.id] = {
    ctrl, ctrlUrl: recStart?.ctrlUrl ?? null, expected: arm.warm, res: recRes ?? null,
  };
  assert(AX.d, `${arm.id} · 문서 시작 시 SW controller`,
    recStart == null ? 'GROUND_START_MISSING' : String(ctrl), String(arm.warm),
    `controller=${recStart?.ctrlUrl ?? '(없음)'}`);
  // ⓓ 이빨 2 — 번들 요청이 **실제로 SW를 통과했는가**. 이게 없으면 "웜"이 SW 캐시인지 HTTP
  // 디스크 캐시인지 구별되지 않아 ⓓ 축이 대상(SW)과 독립이 된다.
  const ws = recRes ? recRes.workerStart : null;
  const wsOk = recRes == null ? false : (arm.warm ? ws > 0 : ws === 0);
  assert(AX.d, `${arm.id} · 번들 요청이 SW를 통과(workerStart)`,
    recRes == null ? 'RES_ENTRY_MISSING' : (wsOk ? 'OK' : (arm.warm ? 'NO_WORKER' : 'UNEXPECTED_WORKER')), 'OK',
    recRes
      ? `workerStart=${ws}ms · transfer=${recRes.transferSize}B · encoded=${recRes.encodedBodySize}B · ` +
        `delivery=${recRes.deliveryType === '' ? '(network)' : recRes.deliveryType} · proto=${recRes.nextHopProtocol || '(없음)'} · ${recRes.file} · 기대 ${arm.warm ? '>0' : '=0'}`
      : '접지선 resource 엔트리 없음');

  // ── ⓗ 프로브 건전성 — diag 링버퍼(MAX 50) 포화는 측정 손실이다 ─────────
  assert(AX.h, `${arm.id} · diag 링버퍼 미포화(<50)`, log.length < 50 ? 'OK' : 'SATURATED', 'OK',
    `항목 ${log.length}건`);

  sample('arm(측정 표본)');
  rows.push({
    id: arm.id, kind: arm.kind, warm: arm.warm,
    nav: doc?.nav ?? 'MISSING', hasToken: doc?.hasToken ?? null,
    req: vals.req, resp: vals.resp, di: vals.di, js: vals.js,
    docRel, bootRel, spans, ctrl, fp,
  });
}

// ⓕ-4 4개 arm이 서로 **다른 문서**를 쟀는가(같은 문서를 두 번 세면 대조가 공허하다)
let collide = 0;
for (let i = 0; i < armFps.length; i++) {
  for (let j = i + 1; j < armFps.length; j++) if (sameDoc(armFps[i], armFps[j])) collide++;
}
assert(AX.f, '4 arm의 문서 지문이 전부 서로 다름',
  armFps.some((x) => x == null) ? 'FP_MISSING' : (collide === 0 ? 'OK' : 'COLLISION'), 'OK',
  `지문 [${armFps.map((x) => x ?? '—').join(', ')}] · 충돌 ${collide}쌍 (허용오차 ±${SAME}ms)`);

// ⓗ DB 쓰기 0 — 출력만 하면 근거가 아니라 인상이다. **단언**으로 못박는다.
// 대상은 우리 백엔드(`/api/*`)로 나가는 비-GET/HEAD 요청이며, 서드파티 비콘(Cloudflare RUM
// `/cdn-cgi/rum`)은 우리 DB와 무관하므로 정의역에서 뺀다 — 다만 전수 목록은 아래에 출력한다.
const apiWrites = writeAudit.filter((w) => /\s\w+\shttps?:\/\/[^/]+\/api\//.test(w));
assert(AX.h, '우리 백엔드(/api/*)로 나간 비-GET/HEAD 요청 0건',
  apiWrites.length === 0 ? 'OK' : 'WRITE_OBSERVED', 'OK',
  `/api/* 쓰기 ${apiWrites.length}건 [${apiWrites.join(' | ') || '없음'}] · ` +
  `비-GET 전체 ${writeAudit.length}건(서드파티 포함)`);

// ── 출력 ────────────────────────────────────────────────────────────────────
const n = (v) => (v == null ? '    —' : String(v).padStart(5));
const pad = (s, w) => String(s).padEnd(w);

console.log('\n=== task#288 — OAuth 콜백/로그인 × 콜드/웜 문서 부팅 성분 실측 ===\n');
console.log(`대상 라이브: ${BASE}`);
console.log(`하니스: serviceWorkers:'allow' — 관례는 'block'이나 **SW 설치 여부가 콜드/웜 축 자체**라 block하면 웜 arm이 원리적으로 없다(응답 주입 축 미사용)`);
console.log(`뷰포트: PC 1440×900 고정 — 이 프로브의 축은 문서 부팅 타이밍이라 레이아웃과 독립(뷰포트 축 없음)`);
console.log(`토큰 시딩: 없음(로그아웃). 실제 첫 구글 로그인과 같은 전제 — 콜백 문서 도달 시점엔 토큰이 없다`);
console.log(`콜백 arm은 무효 코드 → 라이브 400 → boot{oauth-fail}(성공 경로와 같은 코드 경로, useAuthBootstrap.js:104)\n`);

console.log('── ⓒ/ⓓ 구간표 (ms, 문서 상대시각) ────────────────────────────────────────────────────────');
console.log(`${pad('arm', 15)} ${pad('nav', 9)} ${pad('SW', 5)} ${'0→req'.padStart(6)} ${'req→resp'.padStart(9)} ${'resp→di'.padStart(8)} ${'di→doc'.padStart(7)} ${'doc→boot'.padStart(9)}  │ ${'req'.padStart(5)} ${'resp'.padStart(5)} ${'di'.padStart(5)} ${'js'.padStart(5)} ${'doc'.padStart(5)} ${'boot'.padStart(5)}`);
for (const r of rows) {
  console.log(
    `${pad(r.id, 15)} ${pad(r.nav, 9)} ${pad(r.ctrl === null ? '?' : (r.ctrl ? 'ctrl' : 'none'), 5)} ` +
    `${n(r.spans['0→req'])}  ${n(r.spans['req→resp'])}     ${n(r.spans['resp→di'])}   ${n(r.spans['di→doc.rel'])}     ${n(r.spans['doc.rel→boot.rel'])}  │ ` +
    `${n(r.req)} ${n(r.resp)} ${n(r.di)} ${n(r.js)} ${n(r.docRel)} ${n(r.bootRel)}`);
}
console.log('  (SW: none=문서 시작 시 미컨트롤(콜드) · ctrl=SW가 컨트롤(웜) — 접지선 실측)');

// 관찰(단언 아님) — `js`(번들 responseEnd)가 단조 사슬의 **어디에** 떨어지는가.
// useAuthBootstrap.js:10-12의 주석은 구간을 「resp→di(HTML 파싱) / di→마운트(번들 다운로드·실행)」로
// 서술하지만, 실측에서 번들 responseEnd는 di **이전**에 온다 → 번들 다운로드는 di→마운트가 아니라
// resp→di 안에 들어 있다. 단언하지 않는 이유: 느린 기기·네트워크에서는 순서가 뒤집힐 수 있고,
// 그건 결함이 아니라 조건 차이다(리터럴이 아니라 관찰로 남긴다, TESTING §7.3 ⓗ).
console.log('\n── 관찰(단언 없음): 번들 responseEnd(js)가 사슬의 어디에 떨어지는가 ──');
for (const r of rows) {
  const rel = (r.js != null && r.di != null && r.resp != null)
    ? (r.js < r.resp ? `resp(${r.resp}) 이전` : r.js <= r.di ? `resp~di 구간 안 (di−js=${r.di - r.js}ms)` : `di 이후 (js−di=${r.js - r.di}ms)`)
    : '측정 불가';
  console.log(`   ${pad(r.id, 15)} js=${n(r.js)} · ${rel}`);
}

const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
const SPANS = ['0→req', 'req→resp', 'resp→di', 'di→doc.rel', 'doc.rel→boot.rel'];
const diffTable = (a, b, title) => {
  const A = byId[a], B = byId[b];
  if (!A || !B) return;
  console.log(`\n── ${title}   (${a} − ${b}) ──`);
  for (const k of SPANS) {
    const x = A.spans[k], y = B.spans[k];
    const d = (x != null && y != null) ? x - y : null;
    console.log(`   ${pad(k, 18)} ${n(x)} vs ${n(y)}   Δ ${d == null ? '—' : (d > 0 ? '+' : '') + d}ms`);
  }
  const d2 = (A.bootRel != null && B.bootRel != null) ? A.bootRel - B.bootRel : null;
  console.log(`   ${pad('총 boot.rel', 18)} ${n(A.bootRel)} vs ${n(B.bootRel)}   Δ ${d2 == null ? '—' : (d2 > 0 ? '+' : '') + d2}ms`);
};
console.log('\n══ ⓒ 콜백 vs 로그인 — 어느 구간이 콜백에서만 큰가(이 태스크의 답) ══');
diffTable('cold·callback', 'cold·login', '콜드');
diffTable('warm·callback', 'warm·login', '웜');
console.log('\n══ ⓓ 콜드 vs 웜 ══');
diffTable('cold·callback', 'warm·callback', '콜백');
diffTable('cold·login', 'warm·login', '로그인');

console.log('\n── 커버리지: arm별 SW 컨트롤 + 번들 전달경로(문서 *시작* 시점 접지선, 앱 로그와 독립) ──');
for (const a of ARMS) {
  const s = swPerArm[a.id] || {};
  const r = s.res;
  console.log(`   ${pad(a.id, 15)} 기대=${a.warm ? 'ctrl' : 'none'} · controller=${s.ctrl} · ${s.ctrlUrl || '(없음)'}`);
  console.log(`   ${pad('', 15)} 번들 ${r ? `workerStart=${r.workerStart}ms responseEnd=${r.responseEnd}ms transfer=${r.transferSize}B encoded=${r.encodedBodySize}B delivery=${r.deliveryType === '' ? '(network)' : r.deliveryType} proto=${r.nextHopProtocol || '—'} ${r.file}` : '(접지선 엔트리 없음)'}`);
}

console.log('\n── 메커니즘 커버리지: 코드교환 라이브 응답(모킹 0) ──');
console.log(`   ${tokenCalls.length}건 — ${tokenCalls.map((c) => `${c.status} code=${(c.url.split('code=')[1] || '?')}`).join(' | ') || '(없음)'}`);

console.log('\n── DB 쓰기 0 근거: 비-GET/HEAD 요청 전수 감사(페이지+SW, 컨텍스트 레벨) ──');
console.log(`   비-GET/HEAD 총 ${writeAudit.length}건 · 그중 우리 백엔드 /api/* 로 간 것 ${apiWrites.length}건`);
if (writeAudit.length === 0) {
  console.log('   (0건 — 이 프로브는 GET/HEAD만 보냈다)');
} else {
  for (const w of [...new Set(writeAudit)]) {
    console.log(`   ×${writeAudit.filter((x) => x === w).length}  ${w}   ${/\/api\//.test(w) ? '⚠️ 우리 백엔드' : '(서드파티 비콘 — 우리 DB와 무관)'}`);
  }
}
console.log(`   · 코드교환 400 경로는 auth.py:236 _pop_oauth_tokens(인메모리 dict pop) 실패가 전부 — INSERT/UPDATE 없음`);
console.log(`   · POST /api/auth/login(→ refresh_tokens 행 생성)도 호출하지 않았다(토큰 미시딩)`);

console.log('\n── 정보 ──');
for (const i of infos) console.log(`   [info] ${i.tag} — ${i.msg}`);

console.log('\n── 판정 ──');
const failed = checks.filter((c) => !c.pass);
for (const c of checks) {
  console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.ax} — ${c.name} · got=${JSON.stringify(c.got)} want=${JSON.stringify(c.want)}${c.detail ? ` · ${c.detail}` : ''}`);
}

console.log('\n=== 커버리지(축별 단언 수) ===');
console.log(`   ${Object.entries(cov).map(([k, v]) => `${k}:${v}`).join(' · ')}`);
console.log(`   표본 카운터(단언 아님): ${Object.entries(samples).map(([k, v]) => `${k}:${v}`).join(' · ') || '(없음)'}`);
console.log(`   단언 합계 ${checks.length}건 · PASS ${checks.length - failed.length} · FAIL ${failed.length}`);
console.log(`   OR로 묶은 단언: 0건 (전부 단일 조건 — 항별 실측치 출력 규약 해당 없음)`);
console.log(`   스크린샷: ${OUT}`);

fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({
  base: BASE, cov, samples, checks, rows, swPerArm, tokenCalls, writeAudit, pageErrors: pageErrorsAll,
}, null, 2));

console.log(failed.length ? `\n>>> FAIL ${failed.length}/${checks.length}` : `\n>>> ALL PASS ${checks.length}/${checks.length}`);
process.exit(failed.length ? 1 : 0);
