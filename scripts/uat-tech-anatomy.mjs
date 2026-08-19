// task#306 라이브 UAT(신규) — 기술 해부 `/tech-anatomy/:slug` (ADR-0042).
// GET만 — POST/PUT/DELETE 없음, 라이브 프로덕션 쓰기 0. 옛 코드에 돌려도 안전하다.
//
// 실행: node scripts/uat-tech-anatomy.mjs
//
// ── 판정 규율(live-uat-probes 스킬 그대로) ──────────────────────────────────────────────
//  · identity를 판정축보다 **먼저** — 대상이 틀려도 통과하는 축을 만들지 않는다(⑧ⓘ).
//  · 축마다 `*-domain` sentinel — 표본 부재를 FAIL로 만든다(⑧ⓐ). 조건부 단언 금지.
//  · **대조군** — composition 없는 slug에서 축 0개 + 안내 노출. 없으면 "앱이 안 그런다"와
//    "계측기가 못 본다"가 구별되지 않는다(⑧ⓔ).
//  · 잘림 축은 **두 계열** — 텍스트 leaf의 scrollWidth + `overflow:hidden` 컨테이너의
//    scrollWidth. leaf만 재면 부모가 자르는 절반이 원리적으로 안 보인다(⑦/task#275).
//  · 줄 수는 rect 개수가 아니라 **세로로 겹치지 않는 rect 묶음의 개수** — 텍스트 노드가
//    쪼개지면 한 줄인데 여러 rect가 나오고(task#275), 같은 줄에 폰트 크기가 섞이면 top이
//    갈린다(task#293). 겹침 기준이라 둘 다 흡수한다.
//  · 이 화면은 막대 조각 안에 텍스트가 없다(ADR-0042 결정 5) — 그 사실 자체를 축으로 둔다.
import { chromium, devices } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-tech-anatomy';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const cov = {};
const rawLog = [];
const P = (ok, tag, msg) => results.push({ ok, tag, msg });
const bump = (k, n = 1) => { cov[k] = (cov[k] || 0) + n; };
const eq = (tag, got, want, note = '') => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  P(ok, tag, `${ok ? 'PASS' : 'FAIL'} — got=${JSON.stringify(got)} want=${JSON.stringify(want)}${note ? ' · ' + note : ''}`);
};

// ── 로그인 + 대상 선정 ────────────────────────────────────────────────────────
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const { access_token, refresh_token } = await login.json();
if (!access_token) { console.error('로그인 실패 — access_token 없음. 종료.'); process.exit(1); }
const AUTH = { Authorization: `Bearer ${access_token}` };

const listRes = await fetch(`${BASE}/api/tech-reports`, { headers: AUTH });
const REPORTS = (await listRes.json()).reports || [];
const WITH = REPORTS.filter((r) => r.composition);
const WITHOUT = REPORTS.filter((r) => !r.composition);

const AXIS_KEYS = ['tech', 'minerals', 'experts'];

// ── ⓒ 해부 보유 slug 수의 **하한 래칫** ──────────────────────────────────────
// 루틴 upsert의 현재 계약은 「키 생략 = 삭제」다. 그래서 루틴이 한 번 돌면 `composition`이
// 통째로 사라질 수 있는데, 그때 화면은 조용히 「미작성」으로 돌아가고 나머지 축은 **전부 통과**한다
// (잴 대상이 사라지면 축이 안 도니까). 그 소실을 드러내는 유일한 축이 이 하한이다.
// 백필로 slug을 채울 때마다 이 수를 함께 올린다(task#308).
const MIN_WITH_ANATOMY = 6;
eq('anatomy-count-floor', WITH.length >= MIN_WITH_ANATOMY, true,
   `해부 보유 ${WITH.length}종 · 하한 ${MIN_WITH_ANATOMY} · 미작성 ${WITHOUT.length}종`);
bump('floor');

if (WITH.length === 0) { console.error('해부 보유 slug 0건 — 잴 대상이 없다. 종료.'); process.exit(1); }

// ── ⓐ 데이터 규율 **전수** — composition을 가진 모든 slug에 건다 ─────────────
// 옛 판은 WITH[0] 하나만 쟀다. 그러면 나중에 채운 slug이 규율을 어겨도 프로브는 통과한다
// (대상이 틀려도 통과하는 축 = ⑧ⓘ). 규율은 데이터 성질이라 목록 응답 하나로 전수 검사된다.
for (const R of WITH) {
  const pnames = new Set((R.players || []).map((p) => p.name));
  let axesSeen = 0;
  for (const k of AXIS_KEYS) {
    const items = R.composition[k];
    if (!items) continue;   // 성립하지 않는 축의 통째 생략은 정당하다(ADR-0042 결정 2)
    axesSeen += 1;
    const sum = items.reduce((s, i) => s + i.share_pct, 0);
    eq(`rule-sum100:${R.slug}:${k}`, Math.abs(sum - 100) <= 1e-9, true, `Σ=${sum}`);
    eq(`rule-grid5:${R.slug}:${k}`,
       items.filter((i) => Math.abs(i.share_pct / 5 - Math.round(i.share_pct / 5)) > 1e-9)
            .map((i) => `${i.name}=${i.share_pct}`), []);
    eq(`rule-len:${R.slug}:${k}`, items.length >= 3 && items.length <= 7, true, `items=${items.length}`);
    eq(`rule-rationale:${R.slug}:${k}`,
       items.filter((i) => !String(i.rationale || '').trim()).map((i) => i.name), []);
    const ns = items.map((i) => i.name);
    eq(`rule-uniq:${R.slug}:${k}`, ns.length - new Set(ns).size, 0, `names=${ns.length}`);
    bump('rule', 5);
  }
  eq(`rule-axes:${R.slug}`, axesSeen >= 1, true, `축 ${axesSeen}개`);
  // tech 축 선도기업은 그 리포트 players[].name에 실재해야 한다(ADR-0042 결정 4)
  const missing = (R.composition.tech || []).flatMap((t) => (t.leaders || []).filter((n) => !pnames.has(n)));
  eq(`rule-leaders:${R.slug}`, missing, [], `players=${pnames.size}명`);
  bump('rule', 2);
}

// ── DOM 대상 = 항목 수가 가장 많은 slug ──────────────────────────────────────
// 목록 순서(WITH[0])가 아니라 **가장 무거운 판**을 고른다: 7항목 축이 생기면 278px에서 조각 폭이
// 가장 좁아지고, 그 최악 케이스가 곧 시각 회귀의 관측 지점이기 때문이다. 동률은 slug 사전순으로
// 깨서 재실행 간 대상이 흔들리지 않게 한다(대상이 바뀌면 커버리지 비교가 무의미해진다).
const weight = (r) => AXIS_KEYS.reduce((s, k) => s + (r.composition[k] || []).length, 0);
const TARGET = [...WITH].sort((a, b) => weight(b) - weight(a) || a.slug.localeCompare(b.slug))[0];
const TARGET_AXES = AXIS_KEYS.filter((k) => (TARGET.composition[k] || []).length > 0);

const API_COUNTS = {};
for (const k of TARGET_AXES) API_COUNTS[k] = TARGET.composition[k].length;
rawLog.push(`해부 보유 ${WITH.length}종 / 발행물 ${REPORTS.length}종 · DOM 대상=${TARGET.slug}(항목 ${weight(TARGET)}개)`);
rawLog.push(`API 축별 항목 수: ${JSON.stringify(API_COUNTS)}`);

const VIEWS = [
  { name: 'm278', opts: { ...devices['iPhone SE'], viewport: { width: 278, height: 800 }, isMobile: true, hasTouch: true } },
  { name: 'm768', opts: { viewport: { width: 768, height: 1000 } } },
  { name: 'pc1280', opts: { viewport: { width: 1280, height: 1000 } } },
];

// 브라우저 안에서 도는 측정기 — 줄 수는 "세로로 겹치지 않는 rect 묶음"으로 센다.
const MEASURE = `
window.__lines = function (el) {
  const rects = [];
  const walk = (n) => {
    if (n.nodeType === 3 && n.textContent.trim()) {
      const r = document.createRange(); r.selectNodeContents(n);
      for (const x of r.getClientRects()) if (x.width > 0 && x.height > 0) rects.push(x);
    }
    for (const c of n.childNodes) walk(c);
  };
  walk(el);
  if (!rects.length) return 0;
  rects.sort((a, b) => a.top - b.top);
  const lines = [];
  for (const r of rects) {
    const hit = lines.find((L) => {
      const ov = Math.min(L.bottom, r.bottom) - Math.max(L.top, r.top);
      return ov > 0.3 * Math.min(L.bottom - L.top, r.height);
    });
    if (hit) { hit.top = Math.min(hit.top, r.top); hit.bottom = Math.max(hit.bottom, r.bottom); }
    else lines.push({ top: r.top, bottom: r.bottom });
  }
  return lines.length;
};
`;

const browser = await chromium.launch();
for (const V of VIEWS) {
  // SW가 /api/*를 가로채므로 차단 필수 — 안 하면 응답 기반 판정이 통째로 헛돈다.
  const ctx = await browser.newContext({ ...V.opts, serviceWorkers: 'block' });
  await ctx.addInitScript(([a, r]) => {
    localStorage.setItem('access_token', a);
    localStorage.setItem('refresh_token', r);
    localStorage.setItem('theme', 'light');
    localStorage.setItem('pwa-install-dismissed-at', String(Date.now()));
  }, [access_token, refresh_token]);
  const page = await ctx.newPage();
  await page.addInitScript(MEASURE);

  // ══ 대상 페이지 ══════════════════════════════════════════════════════════
  await page.goto(`${BASE}/tech-anatomy/${TARGET.slug}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="tech-anatomy"]', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(900);

  // ── identity: 지금 보고 있는 것이 그 대상인가 (판정축보다 먼저) ──
  const ident = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="tech-anatomy"]');
    return { present: !!root, h1: root ? (root.querySelector('h1')?.textContent || '').trim() : null };
  });
  eq(`identity:${V.name}`, ident.present && /해부$/.test(ident.h1 || ''), true, `h1="${ident.h1}"`);
  bump('identity');

  // ── ⓐ 3축 렌더 + 축별 커버리지 카운터(항목 수가 API 응답과 일치) ──
  const axes = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="tech-anatomy"]');
    if (!root) return null;
    return [...root.querySelectorAll('[data-testid="anatomy-axis"]')].map((ax) => {
      const bar = ax.querySelector('[data-testid="anatomy-bar"]');
      const segs = [...ax.querySelectorAll('[data-testid="anatomy-seg"]')];
      return {
        key: ax.getAttribute('data-axis'),
        title: (ax.querySelector('[data-testid="anatomy-axis-title"]')?.textContent || '').trim(),
        basis: (ax.querySelector('[data-testid="anatomy-basis"]')?.textContent || '').trim(),
        items: ax.querySelectorAll('[data-testid="anatomy-item"]').length,
        segs: segs.length,
        barW: bar ? bar.getBoundingClientRect().width : 0,
        segSum: segs.reduce((s, e) => s + e.getBoundingClientRect().width, 0),
        segText: segs.reduce((s, e) => s + (e.textContent || '').trim().length, 0),
        levels: [...ax.querySelectorAll('[data-testid="anatomy-leader-level"]')].map((e) => e.textContent.trim()),
      };
    });
  });
  eq(`axes-domain:${V.name}`, axes && axes.length > 0 ? 'OK' : `DOMAIN_TOO_SMALL(${axes ? axes.length : 'null'})`, 'OK');
  // 축이 생략된 slug도 정당하므로(ADR-0042 결정 2) 기대값은 3축 고정이 아니라 **그 대상이 실제로
  // 가진 축**이다. AXIS_KEYS로 고정하면 광물 축을 생략한 리포트가 옳은데도 FAIL이 된다.
  eq(`axes-count:${V.name}`, axes ? axes.map((a) => a.key) : null, TARGET_AXES);
  bump('axes', 2);

  for (const a of axes || []) {
    // 커버리지 카운터 — 화면 항목 수가 API와 다르면 렌더가 무음으로 빠뜨린 것이다.
    eq(`axis-items:${V.name}:${a.key}`, a.items, API_COUNTS[a.key], `segs=${a.segs}`);
    eq(`axis-segs:${V.name}:${a.key}`, a.segs, API_COUNTS[a.key]);
    // ⓑ 「기준」 문구 상시 노출 (축마다 1개, 비어있지 않음)
    eq(`axis-basis:${V.name}:${a.key}`, a.basis.length > 0, true, `basis="${a.basis}"`);
    // ⓒ Σ=100의 시각적 진술 — 조각 폭 합 ≈ 막대 폭(±2px)
    eq(`axis-segsum:${V.name}:${a.key}`, Math.abs(a.segSum - a.barW) <= 2, true,
       `segSum=${a.segSum.toFixed(1)} barW=${a.barW.toFixed(1)}`);
    // 막대 조각에는 텍스트가 없다(ADR-0042 결정 5) — 있으면 조각의 overflow:hidden이 자른다
    eq(`axis-segtext:${V.name}:${a.key}`, a.segText, 0);
    bump('axis', 5);
    rawLog.push(`${V.name} ${a.key}: title="${a.title}" basis="${a.basis}" items=${a.items} barW=${a.barW.toFixed(1)} segSum=${a.segSum.toFixed(1)}`);
  }

  // ── ⓕ 기술 축 선도 칩에 단계 숫자가 실제로 붙는가 ──
  const techAxis = (axes || []).find((a) => a.key === 'tech');
  eq(`leader-domain:${V.name}`, techAxis && techAxis.levels.length > 0 ? 'OK' : 'DOMAIN_TOO_SMALL(0)', 'OK');
  eq(`leader-levels:${V.name}`, (techAxis?.levels || []).every((t) => /^[1-5]단계$/.test(t)), true,
     `levels=${JSON.stringify(techAxis?.levels || [])}`);
  bump('leader', 2);

  // ── ⓓ 가로 스크롤 0 (문서 + 본문 루트) ──
  const hscroll = await page.evaluate(() => {
    const de = document.documentElement;
    const main = document.querySelector('main.page-wrap') || de;
    return {
      doc: de.scrollWidth - de.clientWidth,
      main: main.scrollWidth - main.clientWidth,
      cw: de.clientWidth,
    };
  });
  eq(`h-scroll-doc:${V.name}`, hscroll.doc <= 0, true, `scrollWidth-clientWidth=${hscroll.doc} (cw=${hscroll.cw})`);
  eq(`h-scroll-main:${V.name}`, hscroll.main <= 0, true, `diff=${hscroll.main}`);
  bump('h-scroll', 2);

  // ── ⓔ 잘림 두 계열 — 텍스트 leaf + overflow:hidden 컨테이너 ──
  const clip = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="tech-anatomy"]');
    if (!root) return null;
    const leaf = [], box = [];
    for (const el of root.querySelectorAll('*')) {
      const txt = (el.textContent || '').trim();
      const cs = getComputedStyle(el);
      const hasOwnText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (hasOwnText && el.scrollWidth > el.clientWidth + 1) leaf.push(`${el.className}|${txt.slice(0, 28)}`);
      // 부모가 자르는 절반 — 자식이 nowrap이면 자식의 scrollWidth == clientWidth라 leaf 축이 못 본다
      if (cs.overflow === 'hidden' || cs.overflowX === 'hidden') {
        if (el.scrollWidth > el.clientWidth + 1) box.push(`${el.className}|${txt.slice(0, 28)}`);
      }
    }
    const leafN = root.querySelectorAll('*').length;
    return { leaf, box, scanned: leafN };
  });
  eq(`clip-domain:${V.name}`, clip && clip.scanned > 20 ? 'OK' : `DOMAIN_TOO_SMALL(${clip?.scanned})`, 'OK');
  eq(`clip-leaf:${V.name}`, clip?.leaf || null, []);
  eq(`clip-box:${V.name}`, clip?.box || null, []);
  bump('clip', 3);
  rawLog.push(`${V.name} clip 스캔 ${clip?.scanned}개 노드`);

  // ── 칩 접힘 — 칩 텍스트는 어느 폭에서도 1줄(flex-wrap 컨테이너 + nowrap 자식) ──
  const chips = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="tech-anatomy"]');
    if (!root) return [];   // 대상 부재는 FAIL로 기록돼야지 프로브를 죽여선 안 된다(보고가 통째로 사라진다)
    const els = [...root.querySelectorAll('[data-testid="anatomy-leader-chip"], [data-testid="anatomy-producer-chip"]')];
    return els.map((e) => ({ t: e.textContent.trim().slice(0, 24), lines: window.__lines(e) }));
  });
  eq(`chip-domain:${V.name}`, chips.length > 0 ? 'OK' : 'DOMAIN_TOO_SMALL(0)', 'OK');
  eq(`chip-1line:${V.name}`, chips.filter((c) => c.lines !== 1).map((c) => `${c.t}=${c.lines}줄`), []);
  bump('chip', 2);
  rawLog.push(`${V.name} 칩 ${chips.length}개 검사`);

  // ── ⓘ 목록 복귀 pill (task#309) ─────────────────────────────────────────────
  // 「실재」만 재면 부족하다 — fixed 요소는 조상 transform·overflow로 화면 밖에 놓여도
  // DOM엔 남으므로(task#195) boundingBox가 뷰포트 안인지 함께 본다. 클릭 도달은 ⓗ에서.
  const pill = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.list-pill')];
    if (!els.length) return { n: 0 };
    const r = els[0].getBoundingClientRect();
    return { n: els.length, href: els[0].getAttribute('href'), text: els[0].textContent.trim(),
             box: [r.left, r.top, r.right, r.bottom].map((v) => Math.round(v)),
             vw: innerWidth, vh: innerHeight };
  });
  eq(`pill-domain:${V.name}`, pill.n > 0 ? 'OK' : 'PILL_MISSING(0)', 'OK');
  eq(`pill-count:${V.name}`, pill.n, 1);            // 중복 렌더 방지
  eq(`pill-href:${V.name}`, pill.href ?? 'NO_PILL', '/tech-reports');
  eq(`pill-inview:${V.name}`,
     pill.n ? (pill.box[0] >= 0 && pill.box[1] >= 0 && pill.box[2] <= pill.vw && pill.box[3] <= pill.vh) : 'NO_PILL',
     true, `box=${JSON.stringify(pill.box)} vp=${pill.vw}x${pill.vh}`);
  bump('pill', 4);

  await page.screenshot({ path: `${OUT}/${V.name}-anatomy.png`, fullPage: true });

  // ══ ⓖ 대조군 — **page.route 주입**으로 합성한다 ══════════════════════════
  // 옛 판은 "composition이 없는 실제 slug"을 대조군으로 썼다. 그 설계는 백필이 끝나 빈 slug이
  // 0개가 되는 순간 대조군이 소멸해 프로브가 통째로 죽는다(uat298이 데이터 상태 전제로 스테일해진
  // 것과 같은 구조). 주입은 데이터 상태와 무관하므로 규율이 데이터에 인질로 잡히지 않는다.
  // ⚠️ 응답 가로채기일 뿐이다 — 프로덕션에 아무것도 쓰지 않는다(이 프로브는 GET만 한다).
  // 대상은 **같은 TARGET slug**이다: 3축이 실재하는 판을 null로 덮으므로, 축 0개가 관측되면
  // 그것은 "데이터가 원래 없어서"가 아니라 **화면이 빈 상태를 옳게 그린다**는 증거가 된다.
  let injected = 0;
  await page.route('**/api/tech-reports/**', async (route) => {
    const res = await route.fetch();
    let body;
    try { body = await res.json(); } catch { return route.fulfill({ response: res }); }
    if (Array.isArray(body?.reports)) {
      body.reports = body.reports.map((r) => ({ ...r, composition: null }));
      injected += 1;
    }
    await route.fulfill({ response: res, body: JSON.stringify(body), contentType: 'application/json' });
  });
  await page.goto(`${BASE}/tech-anatomy/${TARGET.slug}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="tech-anatomy"]', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(900);
  const ctrl = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="tech-anatomy"]');
    return {
      axes: root ? root.querySelectorAll('[data-testid="anatomy-axis"]').length : -1,
      empty: !!root?.querySelector('[data-testid="anatomy-empty"]'),
      emptyText: (root?.querySelector('[data-testid="anatomy-empty"]')?.textContent || '').trim().slice(0, 40),
    };
  });
  // 계측기가 실제로 작동했는가 — 주입 0건이면 아래 "축 0개"는 앱의 성질이 아니라 측정 실패다.
  eq(`control-injected:${V.name}`, injected > 0, true, `가로챈 응답 ${injected}건`);
  // 축이 0개여야 한다 — 이게 없으면 "3축이 보인다"는 단언이 무엇을 봤는지 증명되지 않는다
  eq(`control-axes0:${V.name}`, ctrl.axes, 0);
  eq(`control-empty:${V.name}`, ctrl.empty, true, `text="${ctrl.emptyText}"`);
  bump('control', 3);
  await page.screenshot({ path: `${OUT}/${V.name}-control.png`, fullPage: true });
  await page.unroute('**/api/tech-reports/**');

  // ══ ⓗ 왕복 내비 — 목록 → 해부 → 리포트 → 해부 → 뒤로가기 ═══════════════
  await page.goto(`${BASE}/tech-reports`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="tech-report-card"]', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(500);
  // ── ⓙⓚ 카드 진입점 (task#309) — 전 카드 전수 ────────────────────────────────
  // ⓚ 앵커는 **개수가 아니라 href 집합**을 본다: 본문 Link가 사라지고 해부 버튼이 2개인
  //    판에서도 개수 단언은 통과한다.
  // ⓙ 탭 타깃은 높이 하한만 재면 라벨이 두 줄로 접힌 판이 **높이 증가로 통과**하므로
  //    줄 수(`__lines` — 겹치지 않는 rect 묶음)와 넘침(scrollWidth)을 쌍으로 둔다.
  const cards = await page.evaluate(() => [...document.querySelectorAll('[data-testid="tech-report-card"]')].map((c) => {
    const slug = c.getAttribute('data-slug');
    const btn = c.querySelector('[data-testid="card-link-anatomy"]');
    const r = btn ? btn.getBoundingClientRect() : null;
    return {
      slug,
      hrefs: [...c.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).sort(),
      h: r ? Math.round(r.height * 10) / 10 : -1,
      lines: btn ? window.__lines(btn) : -1,
      over: btn ? btn.scrollWidth > btn.clientWidth : null,
      label: btn ? btn.textContent.trim() : null,
    };
  }));
  eq(`card-domain:${V.name}`, cards.length > 0 ? 'OK' : 'DOMAIN_TOO_SMALL(0)', 'OK');
  eq(`card-anchors:${V.name}`,
     cards.filter((c) => JSON.stringify(c.hrefs) !== JSON.stringify([`/tech-anatomy/${c.slug}`, `/tech-report/${c.slug}`].sort()))
          .map((c) => `${c.slug}=${JSON.stringify(c.hrefs)}`), []);
  eq(`card-tap-h:${V.name}`, cards.filter((c) => !(c.h >= 32)).map((c) => `${c.slug}=${c.h}px`), []);
  eq(`card-tap-1line:${V.name}`, cards.filter((c) => c.lines !== 1).map((c) => `${c.slug}=${c.lines}줄`), []);
  eq(`card-tap-nooverflow:${V.name}`, cards.filter((c) => c.over !== false).map((c) => `${c.slug}=넘침`), []);
  bump('card', 4 * cards.length);
  rawLog.push(`${V.name} 카드 ${cards.length}장 · 해부버튼 h=${[...new Set(cards.map((c) => c.h))].join('/')}px · 라벨=${[...new Set(cards.map((c) => c.label))].join(' | ')}`);
  await page.screenshot({ path: `${OUT}/${V.name}-list.png`, fullPage: true });

  const cardLink = page.locator(`[data-testid="tech-report-card"][data-slug="${TARGET.slug}"] [data-testid="card-link-anatomy"]`);
  const navOk = { list2anatomy: false, anatomy2report: false, report2anatomy: false, back: false, anatomy2list: false };
  if (await cardLink.count() > 0) {
    await cardLink.first().click();
    await page.waitForTimeout(900);
    navOk.list2anatomy = page.url().includes(`/tech-anatomy/${TARGET.slug}`);
    const toReport = page.locator('[data-testid="anatomy-to-report"]');
    if (await toReport.count() > 0) {
      await toReport.first().click(); await page.waitForTimeout(900);
      navOk.anatomy2report = page.url().includes(`/tech-report/${TARGET.slug}`);
      const toAnatomy = page.locator('[data-testid="report-to-anatomy"]');
      if (await toAnatomy.count() > 0) {
        await toAnatomy.first().click(); await page.waitForTimeout(900);
        navOk.report2anatomy = page.url().includes(`/tech-anatomy/${TARGET.slug}`);
        await page.goBack(); await page.waitForTimeout(900);
        navOk.back = page.url().includes(`/tech-report/${TARGET.slug}`);
      }
    }
  }
  // 해부 → 목록 (pill 클릭 도달) — ⓘ의 「실재·뷰포트 내」에 도달까지 붙여 왕복을 닫는다.
  await page.goto(`${BASE}/tech-anatomy/${TARGET.slug}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="tech-anatomy"]', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(700);
  const pillLoc = page.locator('.list-pill');
  if (await pillLoc.count() > 0) {
    await pillLoc.first().click(); await page.waitForTimeout(900);
    navOk.anatomy2list = new URL(page.url()).pathname === '/tech-reports';
  }
  eq(`nav-roundtrip:${V.name}`, navOk, { list2anatomy: true, anatomy2report: true, report2anatomy: true, back: true, anatomy2list: true });
  bump('nav');

  await ctx.close();
}
await browser.close();

// ── 보고 ──────────────────────────────────────────────────────────────────────
const fails = results.filter((r) => !r.ok);
console.log('\n' + '═'.repeat(78));
console.log('커버리지 (계열별 검사 수 — 재실행 간 비교용, 줄면 통과가 아니라 측정 실패):');
for (const [k, v] of Object.entries(cov).sort()) console.log(`  ${k.padEnd(20)} ${v}`);
console.log(`  ${'(합계)'.padEnd(20)} ${Object.values(cov).reduce((a, b) => a + b, 0)}`);
console.log(`\n단언 총계: ${results.length}건 · PASS ${results.length - fails.length} · FAIL ${fails.length}`);
console.log('\n원시 실측(단언 아님):');
for (const l of rawLog) console.log(`  ${l}`);
console.log(`\n※ 육안 캡처 ${OUT}/ — {view}-{anatomy|control|list}.png`);
console.log('═'.repeat(78));
fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ cov, results, target: TARGET.slug, control: `injected:${TARGET.slug}`,
  withAnatomy: WITH.map((r) => r.slug), minFloor: MIN_WITH_ANATOMY, API_COUNTS }, null, 2));
if (fails.length) {
  console.log('\nFAIL 상세:');
  for (const f of fails) console.log(`  ✗ ${f.tag}\n      ${f.msg}`);
  process.exit(1);
}
console.log(`\nALL PASS ${results.length}/${results.length}`);
