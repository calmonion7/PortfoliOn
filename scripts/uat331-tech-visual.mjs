// task#331 라이브 UAT(신규) — 주요기술 **시각 표면 2건**을 잰다.
//   B54 목록 카드 제목 잘림(`/tech-reports`)  ·  B55 점유율 막대 트랙 폭 불균일(`/tech-report/{slug}`)
// read-only(GET만) — page.route 주입 0, 쓰기 0.
//
// ⚠️ 이 파일은 **신설**이다. 이유는 하나 — 기존 tech 프로브 5종(uat280 · 296 · 298 · 299 · 282)에는
// 착수 시점에 이미 선재 FAIL 11건(280:4 · 299:3 · 282:4)이 있어 `exit 0`이 그쪽에서는 **원리적으로
// 도달 불가**하다. 그 파일에 새 축을 넣으면 내 축의 판정이 남의 선재 결함에 묶인다(task#316·#317).
// 여기는 선재 0이므로 **`exit 0`을 그대로 게이트로 쓸 수 있다** — 단 두 항을 함께 볼 것:
//     FAIL 0  AND  단언 총계 ≥ (첫 실행에서 기록된 총계)
// 후자가 없으면 축이 조용히 사라져도(정의역 붕괴) 통과한다(task#318 ⓑ).
//
// ── 착수 시 라이브 실측(2026-08-22, GET만) — 기대값은 전부 실응답에서 유도한다(리터럴 금지) ──────
//   GET /api/tech-reports → reports 15 · topics 15. 제목 길이 13~207자(7종이 90자 이상).
//   B54 결함 상태(옛 번들, 브라우저 실측):
//     제목 상자에 `overflow:hidden + text-overflow:ellipsis + white-space:nowrap`이 걸려 있고
//     잘림이 pc1440 **10/15** · m390 **8/15** · m350 **9/15**. 최악 `smr` = scrollWidth 2219 vs
//     clientWidth 258(가시 11.6%). 24자짜리 짧은 제목(`autonomous-driving`)도 pc1440·m350에서 잘렸다.
//     ⚠️ 이 결함은 **uat299의 `text-clipped-leaf` 축이 원리적으로 못 본다** — 그 축의 `isHandled()`가
//     `text-overflow:ellipsis`를 "스스로 넘침을 처리하도록 설계된 것"으로 보아 정의역에서 제외한다.
//     즉 "ellipsis로 자르는 것 자체가 결함"인 경우는 그 필터의 사각이다. 그래서 여기서 따로 잰다.
//   B54 what-if 실측(브라우저 안에서 제목 스타일만 바꿔 재측정 — 이 프로브의 기대값 근거):
//     잘림 0/15(3뷰포트 전부) · 제목 넘침 0 · 문서 가로 스크롤 0 · 최대 카드높이
//     pc1440 252→455 · m390 234→392 · m350 252→432 · 페이지 높이 1600→2194 / 4099→4999 / 4297→5377.
//   B55 결함 상태(옛 번들, 브라우저 실측):
//     `ai-datacenter-equipment` 11행 — `7.0%`(4자) 값칸 28.92px vs 나머지 36.14px →
//     **트랙 폭 2종**(pc1440 607.08/599.86 · m390 177.08/169.86 · m350 137.08/129.86).
//     `robotics` 4행(`1.0%`↔`32.0%`)도 동일. `solar-pv` 4행은 값이 전부 5자라 이미 균일 —
//     **그 판만 재면 축이 공허하게 통과한다**(아래 share-discriminating-sample 이 그것을 막는다).
//     단조성 위반은 실측 0이었다 — 길이가 다른 두 행의 값이 서로 가깝지 않았을 뿐이며, 형제
//     MarketEstimates.jsx는 같은 원인으로 이미 역전($12.5B 75.98px < $9B 84.86px)을 냈다.
//
// ── 판정 규율(TESTING §7.3) ───────────────────────────────────────────────────────────────────
//  · identity를 판정축보다 **먼저** 둔다 — 대상이 틀려도 통과하는 축을 만들지 않는다(⑧ⓘ).
//  · 조건부 단언 금지 — 정의역은 sentinel로 무조건 못박고, 정의역 안의 세부만 감싼다.
//  · 리터럴 금지 — slug·제목·값 문자열·행 수는 전부 GET 응답에서 유도한다.
//  · 진짜 줄 수 = 서로 다른 top 개수(rect 개수 아님).
//  · **이 프로브가 책임지는 것만 잰다** — 남의 선재 결함(uat280/282의 caption-lines·overflow-leaf 등)을
//    수입하지 않는다. 그래서 판정 범위를 제목 앵커·점유율 행으로 좁힌다.
//
// ── 대조군(기본 꺼짐 · 게이트 아님 · 이빨 실증용) ─────────────────────────────────────────────
//   CONTROL=clip     : 제목에 ellipsis를 되돌려 주입 → title-not-clipped / title-no-clip-decl 이 FAIL해야 정상.
//   CONTROL=widthoff : 값칸 예약폭을 auto로 무력화 → share-track-uniform 이 FAIL해야 정상.
//   ⚠️ 주입이 실제로 걸렸는지를 `control-injected` sentinel로 함께 단언한다 — 주입이 조용히 안 걸리면
//      "주입했는데도 통과 → 축에 이빨이 없다"는 **정반대 결론**이 나온다(가토: 계측 실패를 판정 성공으로 읽기).
import { chromium, devices } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat331';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const P = (ok, tag, msg) => results.push({ ok, tag, msg });
const cov = {};
const bump = (k, n = 1) => { cov[k] = (cov[k] || 0) + n; };
const eq = (tag, got, want, note = '') => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  P(ok, tag, `${ok ? 'PASS' : 'FAIL'} — got=${JSON.stringify(got)} want=${JSON.stringify(want)}${note ? ' · ' + note : ''}`);
};
const rawLog = [];
// 카드 하단 여백 축의 **판별 표본** — 다열 그리드가 있었는가 + 같은 행에서 제목 줄 수가 갈렸는가.
// 둘 중 하나라도 0이면 card-footer-at-bottom 은 구조적으로 통과하므로 「미검증」이다.
const MULTICOL_VIEWS = [];
const BLANK_STIMULUS = [];

const CONTROL = process.env.CONTROL || '';
const CONTROL_CSS = {
  clip: '[data-testid="tech-report-card-title"]{white-space:nowrap !important;overflow:hidden !important;text-overflow:ellipsis !important;word-break:normal !important;overflow-wrap:normal !important}',
  widthoff: '[data-testid="tech-share-chart-value"]{width:auto !important}',
  // 카드 하단 여백 결함을 되돌린다 — footer가 in-flow 자연 위치에 머물고 그 아래가 빈다.
  // card-footer-at-bottom 이 FAIL해야 정상(그 축의 이빨 실증).
  footeroff: '[data-testid="tech-report-card"]{display:block !important}[data-testid="tech-report-card-footer"]{margin-top:8px !important}',
};
if (CONTROL && !CONTROL_CSS[CONTROL]) { console.error(`CONTROL=${CONTROL} 미지원(clip|widthoff|footeroff). 종료.`); process.exit(1); }
if (CONTROL) console.log(`⚠ 대조군 실행 — CONTROL=${CONTROL}: 해당 축 FAIL이 정상이며 게이트 결과가 아니다.`);

// ── 로그인(추정 폴백 없음) ────────────────────────────────────────────────────
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const { access_token, refresh_token } = await login.json();
if (!access_token) { console.error('로그인 실패 — access_token 없음. 종료.'); process.exit(1); }
const AUTH = { Authorization: `Bearer ${access_token}` };

// ── ground truth ─────────────────────────────────────────────────────────────
const listRes = await fetch(`${BASE}/api/tech-reports`, { headers: AUTH });
const listJson = await listRes.json();
const REPORTS = listJson.reports || [];
if (REPORTS.length === 0) { console.error(`GET /api/tech-reports → ${listRes.status} · reports 0건. 대상 없음 — 종료.`); process.exit(1); }

// 컴포넌트와 **같은 식**으로 채택한다(ShareChart.jsx: Number.isFinite && >= 0, 값 내림차순).
const shareRows = (rep) => (rep.players || [])
  .filter((p) => p && Number.isFinite(p.share_pct) && p.share_pct >= 0)
  .sort((a, b) => b.share_pct - a.share_pct);
const pctText = (v) => `${v.toFixed(1)}%`;

// 대상 slug = 점유율 행이 2개 이상인 발행물 전수(1행이면 트랙 폭 비교가 정의되지 않는다).
const SHARE_SLUGS = REPORTS.filter((r) => shareRows(r).length >= 2).map((r) => r.slug);
// 그중 **값 문자열 길이가 행마다 다른** 것이 이 결함을 자극하는 판별 표본이다.
const DISCRIM = REPORTS
  .filter((r) => new Set(shareRows(r).map((p) => pctText(p.share_pct).length)).size > 1)
  .map((r) => r.slug);

console.log(`[실응답] reports ${REPORTS.length}종 · 제목 길이 ${Math.min(...REPORTS.map((r) => (r.title || '').length))}~${Math.max(...REPORTS.map((r) => (r.title || '').length))}자`);
console.log(`[실응답] 점유율 ≥2행 ${SHARE_SLUGS.length}종: ${SHARE_SLUGS.join(', ') || '(없음)'}`);
console.log(`[실응답] 판별 표본(값 문자열 길이 상이) ${DISCRIM.length}종: ${DISCRIM.join(', ') || '(없음)'}`);

// 라이브 실측에서 도출한 한 줄 수용량 하한 — 제목 상자 clientWidth는 pc1440 258 / m390 316 / m350 276px이고
// 15px 세리프 한글은 22~24자에서 그 폭을 넘는다. 40자를 넘는 제목은 **반드시** 2줄 이상이어야 한다.
const WRAP_CHARS = 40;

// ── 측정 ─────────────────────────────────────────────────────────────────────
const measureList = (page) => page.evaluate(() => {
  const lineCount = (el) => {
    const r = document.createRange(); r.selectNodeContents(el);
    return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size;
  };
  const cards = [...document.querySelectorAll('[data-testid="tech-report-card"]')];
  const rows = cards.map((c) => {
    const t = c.querySelector('[data-testid="tech-report-card-title"]');
    const cb = c.getBoundingClientRect();
    const cs = getComputedStyle(c);
    const inner = {
      left: cb.left + parseFloat(cs.paddingLeft), right: cb.right - parseFloat(cs.paddingRight),
      top: cb.top + parseFloat(cs.paddingTop), bottom: cb.bottom - parseFloat(cs.paddingBottom),
    };
    // 카드 하단 여백 — footer(구분선 + 해부 칩) 아래로 남는 빈 공간. stretch 그리드에서 한 행이
    // 가장 긴 제목에 맞춰 커질 때 footer가 in-flow 자연 위치에 머물면 이 값이 커진다(최대 309.5px 실측).
    // 기준은 카드의 **padding box 하단**이다 — border box(`cb.bottom`)로 재면 테두리 폭만큼 상수 오차가 붙는다.
    const f = c.querySelector('[data-testid="tech-report-card-footer"]');
    const blank = f ? Math.round(inner.bottom - f.getBoundingClientRect().bottom) : null;
    const cardLeft = Math.round(cb.left);
    if (!t) return { slug: c.dataset.slug, titleFound: false, footerFound: !!f, blank, cardLeft, cardTop: Math.round(cb.top), cardH: Math.round(cb.height) };
    const tb = t.getBoundingClientRect();
    const ts = getComputedStyle(t);
    // 제목 바로 다음 형제(지표 행)와의 간격 — 축④(요소 *간* 거리). 형제가 없으면 null.
    const sib = t.nextElementSibling;
    const gap = sib ? Math.round(sib.getBoundingClientRect().top - tb.bottom) : null;
    return {
      slug: c.dataset.slug, titleFound: true, text: t.textContent,
      chars: t.textContent.length, lines: lineCount(t),
      sw: t.scrollWidth, cw: t.clientWidth,
      overflowR: Math.round(Math.max(0, tb.right - inner.right)),
      overflowB: Math.round(Math.max(0, tb.bottom - inner.bottom)),
      decl: {
        textOverflow: ts.textOverflow, whiteSpace: ts.whiteSpace,
        wordBreak: ts.wordBreak, overflowWrap: ts.overflowWrap,
        lineClamp: ts.webkitLineClamp || ts.getPropertyValue('-webkit-line-clamp') || 'none',
      },
      gap, footerFound: !!f, blank, cardLeft,
      cardTop: Math.round(cb.top), cardH: Math.round(cb.height),
    };
  });
  return {
    found: cards.length > 0,
    rows,
    docScrollW: document.documentElement.scrollWidth,
    docClientW: document.documentElement.clientWidth,
    pageH: Math.round(document.documentElement.scrollHeight),
  };
});

const measureShare = (page) => page.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-testid="tech-share-chart-row"]')];
  return rows.map((r) => {
    const v = r.querySelector('[data-testid="tech-share-chart-value"]');
    const tr = r.querySelector('[data-testid="tech-share-chart-track"]');
    const bar = r.querySelector('[data-testid="tech-share-chart-bar"]');
    const vs = v ? getComputedStyle(v) : null;
    return {
      txt: v ? v.textContent.trim() : null,
      val: v ? parseFloat(v.textContent) : NaN,
      valueW: v ? +v.getBoundingClientRect().width.toFixed(2) : null,
      valueSw: v ? v.scrollWidth : null, valueCw: v ? v.clientWidth : null,
      valueAlign: vs ? vs.textAlign : null,
      trackW: tr ? +tr.getBoundingClientRect().width.toFixed(2) : null,
      barW: bar ? +bar.getBoundingClientRect().width.toFixed(2) : null,
    };
  });
});

// ── 실행 ─────────────────────────────────────────────────────────────────────
const VIEWS = [
  { key: 'pc1440-light', theme: 'light', opts: { viewport: { width: 1440, height: 1000 } } },
  { key: 'pc1440-dark', theme: 'dark', opts: { viewport: { width: 1440, height: 1000 } } },
  { key: 'm390-light', theme: 'light', opts: { ...devices['iPhone 13'] } },
  { key: 'm350-dark', theme: 'dark', opts: { viewport: { width: 350, height: 700 } } },
];

const browser = await chromium.launch();

for (const V of VIEWS) {
  // SW가 /api/*를 가로챈다 — 옛 캐시 응답을 돌려줄 여지를 없앤다.
  const ctx = await browser.newContext({ ...V.opts, serviceWorkers: 'block' });
  await ctx.addInitScript(([a, r, th]) => {
    localStorage.setItem('access_token', a); localStorage.setItem('refresh_token', r);
    localStorage.setItem('theme', th);
    localStorage.setItem('pwa-install-dismissed-at', String(Date.now()));
  }, [access_token, refresh_token, V.theme]);
  // 대조군 CSS는 컨텍스트 단위 API가 없으므로 **페이지마다** page.addStyleTag로 주입한다(아래).

  // ══ B54 목록 페이지 ══════════════════════════════════════════════════════
  {
    const tag = `${V.key}/list`;
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto(`${BASE}/tech-reports`, { waitUntil: 'networkidle' }).catch((e) => errs.push(`goto:${e}`));
    await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0).catch(() => {});
    await page.waitForTimeout(900);
    if (CONTROL) await page.addStyleTag({ content: CONTROL_CSS[CONTROL] });
    await page.waitForTimeout(150);

    let m = await measureList(page);
    if (!m.found) { await page.waitForTimeout(1500); m = await measureList(page); }

    eq(`list-present:${tag}`, m.found ? 'PRESENT' : 'CARDS_MISSING', 'PRESENT');
    bump('list-present');

    if (CONTROL === 'clip') {
      // 주입이 실제로 걸렸는가 — 안 걸린 채 통과하면 "이빨 없음"으로 오독한다.
      const injected = m.rows.filter((r) => r.titleFound && r.decl.textOverflow === 'ellipsis').length;
      eq(`control-injected:${tag}`, injected === m.rows.length ? 'OK' : `PARTIAL(${injected}/${m.rows.length})`, 'OK');
      bump('control-injected');
    }

    // (0) identity — 대상이 틀려도 통과하는 축을 만들지 않는다.
    eq(`identity-slugs:${tag}`, m.rows.map((r) => r.slug).sort(), REPORTS.map((r) => r.slug).sort(),
      `카드 ${m.rows.length}장 vs 응답 ${REPORTS.length}종`);
    bump('identity');

    // (1) 정의역 sentinel — 제목 앵커가 카드마다 정확히 1개. 앵커가 사라지면 아래 축 전부가
    //     정의역을 잃고 "대상 0개"를 통과로 셀 수 있다.
    eq(`title-domain:${tag}`, m.rows.filter((r) => r.titleFound).length, m.rows.length,
      `제목 앵커 ${m.rows.filter((r) => r.titleFound).length}/${m.rows.length}`);
    bump('title-domain');

    const T = m.rows.filter((r) => r.titleFound);
    // ⚠️ 앵커가 없으면 아래 축들은 **정의역이 비어 전부 공허하게 통과**한다(빈 배열 == 빈 배열).
    // 배포 전 red-first 실행에서 실제로 그랬다 — 상위 sentinel(title-domain)이 FAIL해 exit는 1이었지만
    // 개별 축은 초록이었고, 그건 "0을 성공으로 읽는 게이트"다. 그래서 정의역이 모자라면 got을
    // sentinel 문자열로 바꿔 **그 축들도 FAIL**시킨다(단언 개수는 그대로 유지 — 총계 게이트가 흔들리지 않는다).
    const titleOK = m.rows.length > 0 && T.length === m.rows.length;
    const ST = (v) => (titleOK ? v : `DOMAIN_MISSING(${T.length}/${m.rows.length})`);

    // (2) 잘림 0 — 축②. 옛 판의 정확한 결함이다(라이브 10/15·8/15·9/15).
    eq(`title-not-clipped:${tag}`, ST(T.filter((r) => r.sw > r.cw + 1).map((r) => `${r.slug}(${r.sw}>${r.cw})`)), [],
      `제목 ${T.length}개 대조`);
    bump('title-not-clipped', T.length);

    // (3) 선언이 라이브에서 실제로 적용됐는가 — 축⑤ 계열(선언은 있는데 CSS가 덮어써 무효가 되는 경우).
    //     인라인 스타일이라 확실해 보이지만, 시트의 `!important`나 상속 규칙이 덮을 수 있다.
    eq(`title-no-clip-decl:${tag}`,
      ST(T.filter((r) => r.decl.textOverflow === 'ellipsis' || /^(nowrap|pre)$/.test(r.decl.whiteSpace) || !/^(none|)$/.test(String(r.decl.lineClamp)))
        .map((r) => `${r.slug}:${r.decl.textOverflow}/${r.decl.whiteSpace}/${r.decl.lineClamp}`)), [],
      '잘라내는 선언 0');
    eq(`title-wrap-decl:${tag}`,
      ST(T.filter((r) => r.decl.wordBreak !== 'keep-all' || r.decl.overflowWrap !== 'break-word')
        .map((r) => `${r.slug}:${r.decl.wordBreak}/${r.decl.overflowWrap}`)), [],
      '어절 줄바꿈 + 안전망 쌍(안전망은 `break-word` — `anywhere`는 Safari/iOS 15.4+ 전용이라 그 미만에서 선언이 드롭돼 가로 스크롤이 된다. 이 Chromium 프로브는 두 값의 *결과* 차이에 원리적으로 블라인드하므로 선언 자체를 못박는다)');
    bump('title-decl', 2 * T.length);

    // (4) 전문 보존 — 응답 title과 **글자 단위로** 같다. JS 절단(slice+'…')을 막는 이빨이다.
    const titleOf = Object.fromEntries(REPORTS.map((r) => [r.slug, r.title || '']));
    eq(`title-full-text:${tag}`, ST(T.filter((r) => r.text !== titleOf[r.slug]).map((r) => `${r.slug}(${r.chars}자≠${titleOf[r.slug].length}자)`)), [],
      `응답 제목과 대조 ${T.length}건`);
    bump('title-full-text', T.length);

    // (5) 실제로 **접혔는가** — 40자 초과 제목이 1줄이면 그건 접힌 게 아니라 상자가 넓어진 것이다
    //     (그 경우 아래 page-no-hscroll 이나 title-inside-card 가 잡지만, 원인을 여기서 이름 붙인다).
    const longT = T.filter((r) => r.chars > WRAP_CHARS);
    eq(`title-wrap-domain:${tag}`, longT.length > 0 ? 'OK' : 'DOMAIN_EMPTY', 'OK', `40자 초과 제목 ${longT.length}개`);
    eq(`title-wrapped:${tag}`, ST(longT.filter((r) => r.lines < 2).map((r) => `${r.slug}(${r.chars}자/${r.lines}줄)`)), [], '40자 초과는 2줄 이상');
    bump('title-wrapped', 1 + longT.length);

    // (6) 넘침 0 — 축①. keep-all 단독이면 긴 라틴 토큰이 카드를 넘긴다(그래서 anywhere를 쌍으로 뒀다).
    eq(`title-inside-card:${tag}`, ST(T.filter((r) => r.overflowR > 0 || r.overflowB > 0).map((r) => `${r.slug}(R${r.overflowR}/B${r.overflowB})`)), [],
      '제목 rect ⊆ 카드 content box');
    eq(`page-no-hscroll:${tag}`, m.docScrollW <= m.docClientW + 1 ? 'OK' : `HSCROLL(${m.docScrollW}>${m.docClientW})`, 'OK');
    bump('title-overflow', T.length + 1);

    // (7) 축④ 간격 — 제목이 커지면서 아래 지표 행과의 거리가 벌어지지 않았는지. margin 10px 설계.
    const gaps = T.filter((r) => r.gap != null);
    // ⚠️ 기준을 T.length로 잡으면 앵커가 0개일 때 `0 === 0`으로 공허하게 통과한다 — 카드 수로 잡는다.
    eq(`title-gap-domain:${tag}`, gaps.length, m.rows.length, '제목 다음 형제 존재(카드 수 기준)');
    eq(`title-gap:${tag}`, ST(gaps.filter((r) => r.gap < 0 || r.gap > 24).map((r) => `${r.slug}(${r.gap}px)`)), [], '제목↔지표 간격 0~24px');
    bump('title-gap', 1 + gaps.length);

    // (8) 이웃 열로의 비용 이전 — 카드가 높아지는 것은 **의도된 대가**이지만, 같은 그리드 행의
    //     카드 높이가 서로 어긋나면 그건 정렬이 깨진 것이다(stretch가 안 먹는 상태).
    const byRow = {};
    for (const r of m.rows) { (byRow[r.cardTop] ||= []).push(r.cardH); }
    const ragged = Object.entries(byRow).filter(([, hs]) => new Set(hs).size > 1).map(([top, hs]) => `top=${top}:${JSON.stringify(hs)}`);
    eq(`grid-row-domain:${tag}`, Object.keys(byRow).length > 0 ? 'OK' : 'DOMAIN_EMPTY', 'OK', `그리드 행 ${Object.keys(byRow).length}개`);
    eq(`grid-row-heights-equal:${tag}`, ragged, [], '같은 행의 카드 높이 동일(stretch)');
    bump('grid-row', 1 + Object.keys(byRow).length);

    // (9) B54의 **시각 부산물** — 구분선이 카드 중간에 뜨고 그 아래가 빈다.
    //     ⚠️ 위 (8)은 이 결함을 **원리적으로 못 잡는다**: 「행 높이가 같다」를 *요구*하므로 오히려
    //     그 상태를 고정한다. 제목이 항상 1줄이던 옛 판에는 이 격차가 없었고, 제목 전문 노출이
    //     stretch와 결합해 만들어진 결함이다(합성 실측 pc1440 최대 309.5px = 카드의 60%).
    //     기준은 카드 padding box 하단 — footer는 column flex의 마지막 항목이므로 여백은 0이어야 한다.
    //     허용 2px는 서브픽셀 반올림 여유이고, 그 이상은 「구분선이 떠 있다」는 뜻이다.
    eq(`card-footer-domain:${tag}`, m.rows.filter((r) => r.footerFound).length, m.rows.length,
      `footer 앵커 ${m.rows.filter((r) => r.footerFound).length}/${m.rows.length}`);
    const blanks = m.rows.filter((r) => r.blank != null);
    const SB = (v) => (m.rows.length > 0 && blanks.length === m.rows.length ? v : `DOMAIN_MISSING(${blanks.length}/${m.rows.length})`);
    eq(`card-footer-at-bottom:${tag}`, SB(blanks.filter((r) => r.blank > 2).map((r) => `${r.slug}(${r.blank}px)`)), [],
      `카드 하단 여백 최대 ${blanks.length ? Math.max(...blanks.map((r) => r.blank)) : 'n/a'}px`);
    bump('card-footer', 1 + blanks.length);

    // (10) 이 뷰포트에서 그 결함이 **성립 가능했는가**(판별 표본) — 1열이면 한 행에 카드가 하나뿐이라
    //      stretch 격차가 원리적으로 안 생기고 여백은 구조적으로 0이다. 즉 모바일에서 위 축이
    //      통과해도 아무것도 증명하지 않는다. 뷰포트별로 열 수를 기록해 전 실행에서 다열 표본이
    //      최소 하나 있었는지를 아래에서 무조건 단언한다(「표본 0은 통과가 아니라 미검증」).
    const maxCols = Math.max(...Object.values(byRow).map((hs) => hs.length), 0);
    const colsPerRow = Object.entries(byRow).map(([top]) => m.rows.filter((r) => r.cardTop === Number(top)).length);
    if (maxCols > 1) MULTICOL_VIEWS.push(`${V.key}(${maxCols}열)`);
    // 같은 행 안에서 제목 줄 수가 갈리는가 = stretch 격차를 실제로 만드는 자극이 있었는가.
    for (const [top, hs] of Object.entries(byRow)) {
      if (hs.length < 2) continue;
      const lines = m.rows.filter((r) => r.cardTop === Number(top) && r.titleFound).map((r) => r.lines);
      if (new Set(lines).size > 1) BLANK_STIMULUS.push(`${V.key}/top=${top}:${JSON.stringify(lines)}`);
    }
    rawLog.push(`${tag} · 열 ${JSON.stringify(colsPerRow)} · 하단여백 ${JSON.stringify(blanks.map((r) => r.blank))}`);

    eq(`console:${tag}`, errs, [], '');
    bump('console');

    rawLog.push(`${tag} · 카드 ${m.rows.length} · 최대높이 ${Math.max(...m.rows.map((r) => r.cardH))} · 페이지높이 ${m.pageH} · 줄수 ${JSON.stringify(T.map((r) => r.lines))}`);

    await page.screenshot({ path: `${OUT}/${V.key}-list-top.png`, fullPage: false });
    await page.screenshot({ path: `${OUT}/${V.key}-list-full.png`, fullPage: true });
    await page.close();
  }

  // ══ B55 점유율 막대 ═════════════════════════════════════════════════════
  // 판별 표본이 0이면 그건 통과가 아니라 **미검증**이다 — 뷰마다 무조건 단언한다.
  eq(`share-discriminating-sample:${V.key}`, DISCRIM.length > 0 ? 'OK' : 'SAMPLE_ZERO', 'OK',
    `값 문자열 길이가 갈리는 발행물 ${DISCRIM.length}종(${DISCRIM.join(',') || '없음'}) — 0이면 트랙 폭 축이 공허하다`);
  eq(`share-slug-domain:${V.key}`, SHARE_SLUGS.length > 0 ? 'OK' : 'DOMAIN_EMPTY', 'OK', `≥2행 발행물 ${SHARE_SLUGS.length}종`);
  bump('share-sample', 2);

  for (const slug of SHARE_SLUGS) {
    const tag = `${V.key}/${slug}`;
    const rep = REPORTS.find((r) => r.slug === slug);
    const want = shareRows(rep);
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto(`${BASE}/tech-report/${slug}`, { waitUntil: 'networkidle' }).catch((e) => errs.push(`goto:${e}`));
    await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0).catch(() => {});
    await page.waitForTimeout(900);
    if (CONTROL) await page.addStyleTag({ content: CONTROL_CSS[CONTROL] });
    await page.evaluate(() => document.querySelector('[data-testid="tech-share-chart"]')?.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(300);

    const rows = await measureShare(page);

    // (0) identity — 렌더된 값 집합이 응답의 채택 행과 같다. 이게 없으면 다른 판을 재고도 통과한다.
    // ⚠️ DOM 순서를 그대로 비교하면 **안 된다** — 분류가 있는 판은 `groupByCategory`가 그룹 단위로
    // 재배열하므로 전역 내림차순이 아니다(실측 ai-datacenter-equipment: 82,7 | 55,25,20 | 40,27.5 | …).
    // 그래서 값 내림차순으로 정규화해 **다중집합**을 대조한다(순서는 아래 단조성 축이 따로 본다).
    const sorted = [...rows].sort((a, b) => b.val - a.val);
    eq(`share-identity:${tag}`, sorted.map((r) => r.txt), want.map((p) => pctText(p.share_pct)),
      `행 ${rows.length} vs 응답 ${want.length}`);
    bump('share-identity');

    // (1) 정의역 sentinel — 트랙·값 앵커가 행마다 있다.
    const anchored = rows.filter((r) => r.trackW != null && r.valueW != null && r.barW != null).length;
    eq(`share-anchor-domain:${tag}`, anchored, rows.length, `앵커 ${anchored}/${rows.length}`);
    bump('share-anchor-domain');

    if (rows.length > 0) {
      // ⚠️ 앵커(트랙·값·막대)가 하나라도 없으면 아래 기하 축은 **전부 공허하게 통과**한다 —
      // `Math.round(null) === 0`이라 폭 집합이 `[0]`(균일!)이 되고, null 비교는 모두 false라 단조성·
      // 비례·잘림 축이 통과한다. 배포 전 red-first 실행에서 실제로 그랬다(상위 sentinel만 FAIL).
      // 그래서 정의역이 모자라면 got을 sentinel로 바꿔 그 축들도 FAIL시킨다(단언 개수는 유지).
      const geomOK = rows.every((r) => r.trackW != null && r.valueW != null && r.barW != null);
      const SG = (v) => (geomOK ? v : 'DOMAIN_MISSING');
      // (2) 값칸 폭이 전 행 동일 — 이 결함의 **원인**이다.
      const vw = [...new Set(rows.map((r) => Math.round(r.valueW)))];
      eq(`share-value-width-uniform:${tag}`, SG(vw.length), 1, `값칸 폭 ${JSON.stringify(vw)}`);
      // (3) 트랙 폭이 전 행 동일 — 이 결함의 **증상**이자 핵심 축(TESTING §9 ⑦의 처방 그대로).
      const tw = [...new Set(rows.map((r) => Math.round(r.trackW)))];
      eq(`share-track-uniform:${tag}`, SG(tw.length), 1, `트랙 폭 ${JSON.stringify(tw)}`);
      // (4) 예약폭 안에서 값이 잘리지 않는다 — 폭을 상수로 박아 최장 값을 자르는 우회를 막는다.
      eq(`share-value-not-clipped:${tag}`, SG(rows.filter((r) => r.valueSw > r.valueCw + 1).map((r) => `${r.txt}(${r.valueSw}>${r.valueCw})`)), [], '값칸 잘림 0');
      eq(`share-value-align:${tag}`, [...new Set(rows.map((r) => r.valueAlign))], ['right'], '값 우측 정렬(tnum 소수점 정렬)');
      // (5) 사용자가 보는 결과 — 큰 값의 막대가 항상 더 길다. ⚠️ DOM 순서가 아니라 **값 내림차순**
      //     으로 정렬한 뒤 비교한다(그룹 렌더는 DOM 순서가 전역 내림차순이 아니다 — 위 identity 주석).
      //     이 결함의 사용자 증상이 바로 "더 작은 값이 더 긴 막대"이므로 이 축이 목표 자체다.
      const mono = [];
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].barW > sorted[i - 1].barW + 0.5) mono.push(`${sorted[i - 1].txt}(${sorted[i - 1].barW}) < ${sorted[i].txt}(${sorted[i].barW})`);
      }
      eq(`share-bar-monotonic:${tag}`, SG(mono), [], `${rows.length}행 인접쌍 ${Math.max(0, rows.length - 1)}개`);
      // (6) 성분 분해 — 막대/트랙 비율이 곧 그 행의 값이어야 한다. 단조성만 보면 두 오류가 상쇄되는
      //     조합에서 통과하지만, 이 축은 트랙 폭과 퍼센트를 각각 붙잡는다. 기대값은 **그 행이 실제로
      //     표시한 숫자**에서 파생한다(인덱스로 응답과 짝지으면 그룹 재배열에서 어긋난다).
      const bad = rows.map((r) => {
        const pct = Math.min(Math.max(r.val, 0), 100);
        const got = r.trackW > 0 ? (r.barW / r.trackW) * 100 : NaN;
        return Math.abs(got - pct) > 0.6 ? `${r.txt}:${Number.isFinite(got) ? got.toFixed(2) : got}%≠${pct}%` : null;
      }).filter(Boolean);
      eq(`share-bar-proportional:${tag}`, SG(bad), [], `막대/트랙 == 표시값(±0.6%p) ${rows.length}행`);
      bump('share-geometry', 6 + rows.length * 2);

      if (CONTROL === 'widthoff' && DISCRIM.includes(slug)) {
        // 판별 표본에서만 의미가 있다 — 값 문자열 길이가 같은 판은 폭을 auto로 풀어도 균일하다.
        // 주입이 걸렸으면 값칸 폭이 2종 이상이어야 한다(균일했던 것이 흔들린 상태).
        eq(`control-injected:${tag}`, vw.length > 1 ? 'OK' : `NOT_APPLIED(${JSON.stringify(vw)})`, 'OK',
          '판별 표본에서 값칸 폭이 갈렸는지 — 안 갈렸으면 주입 미적용이며 "이빨 없음"으로 읽으면 오독이다');
        bump('control-injected');
      }

      rawLog.push(`${tag} · ${rows.length}행 · 값칸 ${JSON.stringify(vw)} · 트랙 ${JSON.stringify(tw)} · 막대 ${JSON.stringify(rows.map((r) => r.barW))}`);
    }

    eq(`console:${tag}`, errs, [], '');
    bump('console');
    await page.screenshot({ path: `${OUT}/${V.key}-${slug}-share.png`, fullPage: false });
    await page.close();
  }
  await ctx.close();
}
await browser.close();

// ── 카드 하단 여백 축의 판별 표본 (뷰 전체 집계) ──────────────────────────────
// 뷰포트별로 조건부 단언을 하면 모바일(1열)에서 원리적 FAIL 또는 공허 PASS가 된다 →
// **전 실행 집계**로 무조건 단언한다. 표본 0이면 통과가 아니라 미검증이다.
eq('card-blank-multicol-sample', MULTICOL_VIEWS.length > 0 ? 'OK' : 'SINGLE_COLUMN_ONLY', 'OK',
  `다열 그리드 뷰 ${MULTICOL_VIEWS.length}개(${MULTICOL_VIEWS.join(',') || '없음'}) — 0이면 stretch 격차가 원리적으로 안 생겨 축이 공허하다`);
eq('card-blank-stimulus-sample', BLANK_STIMULUS.length > 0 ? 'OK' : 'STIMULUS_ZERO', 'OK',
  `같은 행에서 제목 줄 수가 갈린 표본 ${BLANK_STIMULUS.length}건(${BLANK_STIMULUS.slice(0, 3).join(' / ') || '없음'})`);
bump('card-blank-sample', 2);

// ── 보고 ─────────────────────────────────────────────────────────────────────
const fails = results.filter((r) => !r.ok);
console.log('\n' + '═'.repeat(78));
console.log('커버리지 (계열별 검사 수 — 재실행 간 비교용, 줄면 통과가 아니라 측정 실패):');
for (const [k, v] of Object.entries(cov).sort()) console.log(`  ${k.padEnd(28)} ${v}`);
console.log(`  ${'(합계)'.padEnd(28)} ${Object.values(cov).reduce((a, b) => a + b, 0)}`);
console.log(`\n단언 총계: ${results.length}건 · PASS ${results.length - fails.length} · FAIL ${fails.length}`);
console.log(`뷰 ${VIEWS.length}조합 × (목록 1 + 점유율 ${SHARE_SLUGS.length}판)`);
console.log('\n원시 실측(단언 아님):');
for (const l of rawLog) console.log(`  ${l}`);
if (CONTROL) console.log(`⚠ 이 실행은 대조군이다(CONTROL=${CONTROL}) — 해당 축 FAIL이 정상이며 게이트 결과가 아니다.`);
console.log(`※ 육안 캡처 ${OUT}/ — {view}-list-{top|full}.png · {view}-{slug}-share.png`);
console.log('※ 게이트는 두 항이다: FAIL 0 **AND** 단언 총계 ≥ 첫 실행 기록값(축이 조용히 사라지는 것을 막는다).');
console.log('═'.repeat(78));
fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ control: CONTROL || null, cov, results, rawLog }, null, 2));
if (fails.length) {
  console.log('\nFAIL 상세:');
  for (const f of fails) console.log(`  ✗ ${f.tag}\n      ${f.msg}`);
  process.exit(1);
}
console.log(`\nALL PASS ${results.length}/${results.length}`);
for (const r of results) console.log(`  ✓ ${r.tag} — ${r.msg}`);
