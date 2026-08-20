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
//
// ── task#315 추가 축: 보유·관심 교차 마커 ────────────────────────────────────────────────
//  · 기대값을 **화면이 아니라 API에서 독립 재계산**한다(`crossExpect`) — 화면 숫자를 화면에서
//    읽어 자기 자신과 비교하면 아무것도 검증되지 않는다.
//  · `xc-*` 대상은 **실행 시점에** 고른다: TARGET + 보유 마커가 있는 판 + 관심 마커가 있는 판 +
//    겹침 0인 판 + 전문가 축이 있는 판. 「2026-08-20엔 X였다」는 스냅샷이므로 코드에 박지 않는다.
//  · **광물 축 마커는 라이브에서 dormant**다(producers 티커 ∩ 보유·관심 = 0). 그 사실은
//    `mineral-live-pin`이 **핀 단언**으로 박제한다 — 0이면 「통과」가 아니라 **「미검증」**이고,
//    누군가 그 티커를 추적하는 날 이 단언이 FAIL하며 축의 승격을 요구한다. 종목을 추가해 억지로
//    밟지 않는다(사용자 확정) — 렌더 경로는 `minj-*`가 `/api/stocks` **GET 응답 합성 주입**으로
//    밟는다(쓰기 0). `minj-*`의 PASS는 「라이브 겹침이 있다」가 아니라 「겹침이 생기면 광물 칩이
//    마커를 받는다」다.
//  · 대조군 둘 다 **주입으로 합성**한다 — 「빈 slug」·「전문가 축만 있는 판」을 실데이터로 쓰면
//    백필 한 번에 대조군이 소멸한다(task#307 ①). 주입 대상은 고유 마커로 함께 단언한다.
//  · ⚠️ **이 축들은 프론트 빌드 이후에만 통과한다.** nginx가 `frontend/dist`를 직접 서빙하므로
//    빌드 전 라이브 번들에는 마커·배지·요약이 아예 없다 → 배포 전 실행은 **red-first 확보용**이다
//    (2026-08-20 실측: 선재축 265/265 PASS · 신규축 81 FAIL).
//
// ── task#316 추가 축: 카드 히트 오버레이(클릭 목적지) + 탭 타깃 칩 높이 ──────────────────
//  · **클릭 목적지는 목표 자체다.** S3의 vitest는 `position/zIndex`가 *선언됐는지*만 쟀고(jsdom엔
//    z축·히트테스트·레이아웃이 없다), 「오버레이가 「해부」 칩을 삼키는가」는 원리적으로 못 본다.
//    그래서 ⓐ 카드 padding 4점 클릭 → 리포트 · ⓑ 「해부」 칩 클릭 → 해부를 **쌍으로** 잰다.
//    ⓑ가 없으면 오버레이가 칩을 삼켜도 ⓐ가 통과해 판별력이 0이 된다.
//  · **칩 경계 +3px**도 잰다 — 오버레이 도입의 대가는 「해부」 칩이 리포트 링크에 포위되는 것이라
//    중앙만 재는 축은 그 밴드에 블라인드하다(`TechReports.jsx` 주석의 대가 ⓑ가 요구한 축).
//  · `card-anchors`(href 집합)·`card-anchor-count`는 **오버레이가 `<span>`이라 도입 여부와 무관하게
//    통과한다** — 회귀 가드이고 새 기능의 증거가 **아니다**(단언 메시지에도 그렇게 적었다).
//  · 칩 높이는 **34px 정확히**(목차) / **≥34px**(출처 링크)로 가른다. 출처 칩은 `whiteSpace: nowrap`이
//    없어 긴 제목이 여러 줄이 되고, 컨테이너가 `align-items: stretch`(기본값)라 **같은 flex 줄의 칩이
//    가장 높은 칩에 맞춰 늘어난다** → 「모든 출처 칩 == 34」는 원리적으로 FAIL한다. 그래서
//    ⓐ 전 칩 하한(≥34) ⓑ **1줄 칩만 있는 flex 줄**의 칩은 정확히 34 두 축으로 쪼갠다(후자는 폭마다
//    정의역이 다르므로 「그런 줄이 하나라도 있었는가」를 **전 폭 합산 sentinel**로 못박는다).
//  · **34px는 부모가 flex인 동안만 참이다** — block이면 인라인 요소의 세로 padding이 줄 상자에
//    반영되지 않아 축이 조용히 무의미해진다(task#309). 그래서 두 컨테이너의 computed display를
//    판정축으로 함께 둔다.
//  · 목차 nav 높이는 리터럴이 아니라 **불변식**으로 잰다: `navH == 줄수*칩높이 + (줄수-1)*rowGap`.
//    줄 수·gap·칩 높이 전부 실측이라 정당한 데이터 변화(칩 수 증감)에 거짓 실패하지 않는다.
//  · 칩 성장이 KPI 스트립을 밀지 않는 **메커니즘**(목차가 스트립 *아래*)은 두 축으로 못박는다:
//    ⓐ `tocNav.top >= strip.bottom`(순서 계약) ⓑ **처방-무효화 대조군**(칩을 `4px 10px`·line-height
//    1.5로 되돌리는 `!important` 주입)에서 스트립 bottom이 **바이트 동일**한지. ⓑ는 baseline 리터럴에
//    의존하지 않는 직접 증거이고, 동시에 「칩 높이 축이 상수를 재고 있지 않다」는 이빨이기도 하다
//    (대조군 칩 높이 < 34가 관측돼야 한다 — 옛 실측 27px를 재현하면 대조군 자체가 검증된다).
//  · ⚠️ 이 축들의 측정 slug은 기존 `TARGET`(항목 최대 = 목차 칩 최다)이다. `smr` ·
//    `ai-datacenter-equipment`는 `uat280 kpi-visible`의 **선재 FAIL 대상**이므로 여기서 재지 않는다
//    — 선재 결함을 이 프로브로 수입하면 증감 귀속이 불가능해진다(baseline 표 대조가 유일한 수단이다).
//  · ⚠️ **선재 FAIL 2건(`chip-hscroll-doc:m278`·`chip-hscroll-main:m278`) — task#316과 무관하다.**
//    2026-08-20 배포 *전*(라이브 번들 칩이 아직 `4px 10px`) 실측: 문서 넘침 **18px**·본문 **17px**.
//    범인은 칩이 아니라 **`tech-report-players` 표의 min-content 259px**다(우변 295 > 278; 스크롤러
//    바깥 요소만 남기고 재서 확정 — 위 `wide` 진단이 그 목록을 FAIL 메시지에 싣는다). 가토 ⑯의
//    그 클래스이고, `uat280`은 최협 폭이 **350px**이라 이 결함을 원리적으로 못 본다(350에선 맞는다).
//    → **완화하지 않는다**(프로브가 우회해 통과시킨 현상은 앱 결함이다 — task#272). 이 2건은 표를
//    소유한 슬라이스의 몫이고, 그때까지 이 프로브의 기대값은 `FAIL 2 · 그 둘뿐`이다.
//    2026-08-20 배포 전 전체 실측: **단언 728 · PASS 687 · FAIL 41**(2런 동일) —
//    선재축 586 **전부 PASS** · 신규축 142 중 FAIL 41(= 목차칩 4 · 출처칩 4 · 대조군 이빨 4 ·
//    오버레이 12 · 클릭 15 · m278 표 넘침 2).
import { chromium, devices } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-tech-anatomy';
fs.mkdirSync(OUT, { recursive: true });
// 옛 실행의 PNG를 지운다 — 아래 캡처 열거가 **이번 실행**만 반영해야 빠진 화면이 눈에 띈다.
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.png')) fs.unlinkSync(`${OUT}/${f}`);

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

// ── 광물 축 producers 대상 (task#314) ────────────────────────────────────────
// TARGET은 *항목 수* 최대인 판이라 producers가 0개일 수 있고(실측: semiconductor-equipment는
// 17항목·producers 0), 그러면 아래 chip 축이 producer 칩을 **한 번도 만나지 않고 통과**한다
// (⑧ⓐ 정의역 sentinel). 그래서 producers가 가장 많은 판을 **따로** 잡아 그 경로를 밟는다.
const prodCount = (r) => (r.composition?.minerals || []).reduce((n, m) => n + (m.producers || []).length, 0);
const PROD_TARGET = [...WITH].sort((a, b) => prodCount(b) - prodCount(a) || a.slug.localeCompare(b.slug))[0];
const PROD_API = (PROD_TARGET.composition?.minerals || []).flatMap((m) => (m.producers || []));
const PROD_BASIS = PROD_TARGET.composition?.minerals_share_basis ?? null;
rawLog.push(`producers 대상=${PROD_TARGET.slug}(칩 ${PROD_API.length}개 · %표기 ${PROD_API.filter((p) => p.share_pct != null).length}개) · basis=${PROD_BASIS ? '있음' : 'null'}`);

const API_COUNTS = {};
for (const k of TARGET_AXES) API_COUNTS[k] = TARGET.composition[k].length;
rawLog.push(`해부 보유 ${WITH.length}종 / 발행물 ${REPORTS.length}종 · DOM 대상=${TARGET.slug}(항목 ${weight(TARGET)}개)`);
rawLog.push(`API 축별 항목 수: ${JSON.stringify(API_COUNTS)}`);


// ══ 교차 마커(보유·관심) — 기대값을 **API에서 독립 재계산**한다 (task#315) ═══════════
// 화면 숫자를 화면에서 읽어 자기 자신과 비교하면 아무것도 검증되지 않는다. 아래는
// `techAnatomyUtils.js`의 계약(buildCompanyIndex · itemCompanies · matchableTicker ·
// trackedState · crossHoldings · itemCross)을 프로브가 **독립으로 다시 구현한 것**이고,
// 구현과 여기가 어긋나면 그 자체가 FAIL이다.
//
// `/api/stocks` 봉투는 **1콜 찍어 확인했다**(2026-08-20): 최상위가 **배열**이고 항목은
//   {ticker, name, type:'holding'|'watchlist', market, enriched_at, analyst_target}
// `useTrackedStocks`가 `map[s.ticker] = s.type`으로 그대로 싣는다(hooks/useTrackedStocks.js:48).
// 추정 폴백은 만들지 않는다 — 봉투가 배열이 아니면 즉시 종료한다(⑧ⓘ: 필드를 추정하면 틀린
// 대상 위에서도 통과한다).
const STOCKS_RAW = await (await fetch(`${BASE}/api/stocks`, { headers: AUTH })).json();
if (!Array.isArray(STOCKS_RAW)) { console.error('/api/stocks 봉투가 배열이 아니다 — 폴백 없이 종료.'); process.exit(1); }
const SMAP = {};
for (const s of STOCKS_RAW) if (s?.ticker) SMAP[s.ticker] = s.type;
const TRACKED_N = Object.keys(SMAP).length;

// 이 앱의 추적 티커 공간은 KR(6자리 숫자) · US(알파벳) 둘뿐 → 6자리는 곧 KR 종목코드다.
// 그래서 선전·상하이의 같은 형태 코드(간펑리튬 `002460`)는 **대조 대상이 아니다**.
const KR_CODE = /^\d{6}$/;
const isKorean = (c) => {
  const s = String(c ?? '');
  return s.includes('한국') || s.includes('대한민국') || /^KR|KOREA/i.test(s.toUpperCase());
};
const matchable = (t, c) => (!t ? null : (KR_CODE.test(t) && !isKorean(c) ? null : t));

const axisItems = (rep, k) => (rep.composition?.[k] || []).filter((i) => i && Number.isFinite(i.share_pct));
const buildIdx = (rep) => {   // 판 전역 이름→{ticker,country}. players 우선, 티커 가진 것만.
  const idx = new Map();
  const put = (c) => { if (c?.name && c?.ticker && !idx.has(c.name)) idx.set(c.name, { ticker: c.ticker, country: c.country ?? null }); };
  for (const p of rep.players || []) put(p);
  for (const k of AXIS_KEYS) for (const it of axisItems(rep, k)) for (const pr of it.producers || []) put(pr);
  return idx;
};
const companiesOf = (k, item, rep, idx) => {
  if (k === 'tech') {
    const byName = new Map((rep.players || []).filter((p) => p?.name).map((p) => [p.name, p]));
    return (item.leaders || []).map((n) => {
      const p = byName.get(n);
      const e = p?.ticker ? null : (idx.get(n) || null);
      return p
        ? { name: n, ticker: p.ticker ?? e?.ticker ?? null, country: p.country ?? e?.country ?? null }
        : { name: n, ticker: e?.ticker ?? null, country: e?.country ?? null };
    });
  }
  if (k === 'minerals') {
    return (item.producers || []).filter((p) => p?.name).map((p) => {
      const e = p.ticker ? null : (idx.get(p.name) || null);
      return { name: p.name, ticker: p.ticker ?? e?.ticker ?? null, country: p.country ?? e?.country ?? null };
    });
  }
  return [];   // 전문가 축은 업체를 붙이지 않는다(ADR-0042 결정 4) — 0이 아니라 «못 잼»
};
const AX_TITLE = { tech: '필요 기술', minerals: '핵심 광물', experts: '전문가' };

/** 판 하나의 기대 교차. `smap`을 **인자로** 받는다 — 합성 주입 대조군이 같은 함수를 쓴다. */
function crossExpect(rep, smap) {
  const idx = buildIdx(rep);
  const axisKeys = AXIS_KEYS.filter((k) => axisItems(rep, k).length > 0);
  const markers = [];   // 칩 마커 — **칩 등장마다 하나**(중복 이름도 각각). 화면 칩과 1:1이다.
  const badges = [];    // 항목 배지 — `axis|item|hN|wN`. 배지는 항목 안에서 **티커 Set**으로 센다.
  const hold = new Set(), watch = new Set(), tickered = new Set(), nameless = new Set();
  const hits = { tech: 0, minerals: 0 };
  let anyTicker = false;
  for (const k of ['tech', 'minerals']) {
    if (!axisKeys.includes(k)) continue;
    for (const item of axisItems(rep, k)) {
      const counts = { holding: 0, watchlist: 0 };
      const seen = new Set();
      let itemHit = false;
      for (const c of companiesOf(k, item, rep, idx)) {
        const t = matchable(c.ticker, c.country);
        if (!t) { nameless.add(c.name); continue; }
        tickered.add(c.name); anyTicker = true;
        const st = smap[t];
        if (st !== 'holding' && st !== 'watchlist') continue;
        markers.push({ axis: k, state: st, name: c.name });
        itemHit = true;
        (st === 'holding' ? hold : watch).add(t);
        if (!seen.has(t)) { seen.add(t); counts[st] += 1; }
      }
      if (itemHit) hits[k] += 1;
      if (counts.holding + counts.watchlist > 0) badges.push(`${k}|${item.name}|h${counts.holding}|w${counts.watchlist}`);
    }
  }
  for (const n of tickered) nameless.delete(n);
  const found = [];
  if (hold.size > 0) found.push(`◆ 보유 ${hold.size}`);
  if (watch.size > 0) found.push(`◇ 관심 ${watch.size}`);
  const where = [];
  if (hits.tech > 0) where.push(`${AX_TITLE.tech} ${hits.tech}곳`);
  if (hits.minerals > 0) where.push(`${AX_TITLE.minerals} ${hits.minerals}곳`);
  const scope = ['tech', 'minerals'].filter((k) => axisKeys.includes(k)).map((k) => AX_TITLE[k]);
  const notes = [where.length > 0 ? `${where.join(' · ')} 등장` : `${scope.join('·')} 축 전체 대조`];
  if (axisKeys.includes('experts')) notes.push(`${AX_TITLE.experts} 축 제외 — 업체 없음`);
  if (nameless.size > 0) notes.push(`대조할 수 없는 업체 ${nameless.size}곳 제외`);
  // 칩 텍스트에서 업체명을 되찾기 위한 사전 — 긴 이름 우선(부분일치 오귀속 방지).
  const names = [...new Set([
    ...(rep.players || []).map((p) => p?.name),
    ...AXIS_KEYS.flatMap((k) => axisItems(rep, k).flatMap((it) => [...(it.leaders || []), ...(it.producers || []).map((p) => p?.name)])),
  ].filter(Boolean))].sort((a, b) => b.length - a.length);
  return { axisKeys, markers, badges, holdN: hold.size, watchN: watch.size,
           techHits: hits.tech, minHits: hits.minerals, unmatched: nameless.size,
           measurable: anyTicker, found, notes, names };
}

// 대상 선정 — TARGET(항목 최대)에 ⓐ 보유 마커가 있는 판 · ⓑ 관심 마커가 있는 판 · ⓒ 겹침 0인 판 ·
// ⓓ 전문가 축이 있는 판을 더한다. **기존 265단언의 대상(TARGET·PROD_TARGET)은 바꾸지 않는다.**
const XREPS = WITH.map((r) => ({ r, x: crossExpect(r, SMAP) }));
const byMarks = (a, b) => b.x.markers.length - a.x.markers.length || a.r.slug.localeCompare(b.r.slug);
const CROSS_LIST = [];
const addX = (e) => { if (e && !CROSS_LIST.some((c) => c.r.slug === e.r.slug)) CROSS_LIST.push(e); };
addX(XREPS.find((e) => e.r.slug === TARGET.slug));
addX(XREPS.filter((e) => e.x.markers.some((m) => m.state === 'holding')).sort(byMarks)[0]);
addX(XREPS.filter((e) => e.x.markers.some((m) => m.state === 'watchlist')).sort(byMarks)[0]);
addX(XREPS.filter((e) => e.x.measurable && e.x.markers.length === 0).sort(byMarks)[0]);
addX(XREPS.filter((e) => e.x.axisKeys.includes('experts')).sort(byMarks)[0]);

// 정의역 sentinel — 표본 부재를 **FAIL로** 만든다(⑧ⓐ). 조건부 단언을 쓰지 않으므로 아래
// 슬러그별 단언은 기대값이 0이어도 무조건 돈다(0 기대 판은 「거짓 마커가 없다」를 검사한다).
const XTOT = CROSS_LIST.reduce((s, e) => ({ marks: s.marks + e.x.markers.length, badges: s.badges + e.x.badges.length }), { marks: 0, badges: 0 });
eq('xc-mark-domain', XTOT.marks > 0 ? 'OK' : `MARK_DOMAIN_EMPTY(${XTOT.marks})`, 'OK', `대상 ${CROSS_LIST.map((e) => e.r.slug).join(', ')}`);
eq('xc-badge-domain', XTOT.badges > 0 ? 'OK' : `BADGE_DOMAIN_EMPTY(${XTOT.badges})`, 'OK');
eq('xc-state-domain', [...new Set(CROSS_LIST.flatMap((e) => e.x.markers.map((m) => m.state)))].sort(), ['holding', 'watchlist'],
   '보유·관심 두 상태를 모두 밟았는가 — 한쪽만 밟으면 글리프·색 매핑이 절반만 검증된다');
eq('xc-none-domain', CROSS_LIST.some((e) => e.x.measurable && e.x.markers.length === 0) ? 'OK' : 'NONE_BRANCH_NOT_COVERED', 'OK');
eq('xc-experts-domain-any', CROSS_LIST.some((e) => e.x.axisKeys.includes('experts')) ? 'OK' : 'EXPERTS_AXIS_NOT_COVERED', 'OK');
bump('xc-domain', 5);

// 광물 축 마커의 **라이브** 겹침 — 핀 단언. 지금은 0이고 그건 「통과」가 아니라 **「미검증」**이다.
// 사용자가 producers 티커 중 하나를 보유·관심에 넣는 날 이 단언이 FAIL하며 축의 승격을 요구한다
// (도구·데이터 한계를 want로 박제하는 기법 — live-uat-probes ⑩). 억지로 밟으려고 종목을
// 추가하지 않는다(사용자 확정) — 렌더 경로는 아래 `minj-*` 합성 주입이 밟는다.
const PROD_TICKERS = [...new Set(WITH.flatMap((r) => axisItems(r, 'minerals').flatMap((m) => (m.producers || []).map((p) => p?.ticker).filter(Boolean))))];
const MIN_LIVE = XREPS.flatMap((e) => e.x.markers.filter((m) => m.axis === 'minerals').map((m) => `${e.r.slug}:${m.name}`));
eq('mineral-live-pin', MIN_LIVE.length === 0 ? 'UNVERIFIED_IN_LIVE' : `COVERED(${JSON.stringify(MIN_LIVE)})`, 'UNVERIFIED_IN_LIVE',
   `producers 티커 ${PROD_TICKERS.length}종 ∩ 추적 ${TRACKED_N}종 = ${MIN_LIVE.length}건 → 라이브 dormant. 광물 마커는 minj-* 합성 대조군과 vitest 픽스처가 유일한 검증 수단이다`);
bump('mineral-pin');

// 합성 주입용 티커 — PROD_TARGET의 producers 중 **대조 가능하고 아직 추적하지 않는** 티커에서
// 칩 등장 수가 최대인 것(동률은 티커 사전순). 데이터에서 파생하므로 producers가 바뀌어도 산다.
const MINJ = (() => {
  const idx = buildIdx(PROD_TARGET);
  const cnt = new Map();
  for (const it of axisItems(PROD_TARGET, 'minerals')) {
    for (const c of companiesOf('minerals', it, PROD_TARGET, idx)) {
      const t = matchable(c.ticker, c.country);
      if (!t || SMAP[t]) continue;
      cnt.set(t, (cnt.get(t) || 0) + 1);
    }
  }
  const best = [...cnt.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return best ? { ticker: best[0], chips: best[1] } : null;
})();
const MINJ_X = crossExpect(PROD_TARGET, MINJ ? { ...SMAP, [MINJ.ticker]: 'watchlist' } : SMAP);

rawLog.push(`추적 종목 ${TRACKED_N}종(보유 ${STOCKS_RAW.filter((s) => s.type === 'holding').length} · 관심 ${STOCKS_RAW.filter((s) => s.type === 'watchlist').length})`);
rawLog.push(`교차 대상 ${CROSS_LIST.length}판: ${CROSS_LIST.map((e) => `${e.r.slug}(마커 ${e.x.markers.length}·배지 ${e.x.badges.length}·측정가능 ${e.x.measurable}·미대조 ${e.x.unmatched})`).join(' / ')}`);
rawLog.push(`광물 합성 주입: ${MINJ ? `${MINJ.ticker}→watchlist (칩 ${MINJ.chips}개, 기대 광물마커 ${MINJ_X.markers.filter((m) => m.axis === 'minerals').length}개)` : '주입 가능 티커 없음'}`);

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
// 교차 마커·배지·요약 판독기 (task#315) — 브라우저 안에서 한 번에 모은다.
// names는 프로브가 API에서 만든 업체명 사전(긴 이름 우선)이다. 칩 텍스트는 마커·이름·단계가
// 구분자 없이 붙으므로(「◆SK하이닉스4단계」) 사전 역참조로 이름을 되찾는다 — 못 찾으면
// UNRESOLVED(...)를 반환해 **기대 다중집합과 어긋나 FAIL**이 된다(무음 스킵 금지).
window.__readCross = function (names) {
  const root = document.querySelector('[data-testid="tech-anatomy"]');
  if (!root) return null;
  const nameOf = (txt) => (names || []).find((n) => txt.includes(n)) || ('UNRESOLVED(' + txt.slice(0, 24) + ')');
  const marks = [...root.querySelectorAll('[data-testid="anatomy-chip-owned"]')].map((el) => {
    const chip = el.closest('[data-testid="anatomy-leader-chip"], [data-testid="anatomy-producer-chip"]');
    const ax = el.closest('[data-testid="anatomy-axis"]');
    return {
      axis: ax ? ax.getAttribute('data-axis') : 'NO_AXIS',
      state: el.getAttribute('data-owned'),
      glyph: (el.textContent || '').trim(),
      role: el.getAttribute('role'),
      aria: el.getAttribute('aria-label'),
      color: getComputedStyle(el).color,
      name: chip ? nameOf(chip.textContent.trim()) : 'NO_CHIP',
    };
  });
  const badges = [...root.querySelectorAll('[data-testid="anatomy-item-cross"]')].map((el) => {
    const item = el.closest('[data-testid="anatomy-item"]');
    const ax = el.closest('[data-testid="anatomy-axis"]');
    return {
      axis: ax ? ax.getAttribute('data-axis') : 'NO_AXIS',
      item: item ? (item.querySelector('[data-testid="anatomy-item-name"]')?.textContent || '').trim() : 'NO_ITEM',
      h: Number(el.getAttribute('data-holding')), w: Number(el.getAttribute('data-watchlist')),
      lines: window.__lines(el),
      boxW: Math.round(el.getBoundingClientRect().width),
      aria: el.getAttribute('aria-label'),
    };
  });
  // 토큰 실측 — 기준값을 하드코딩하지 않는다(테마별로 다르다). 「:root」에서 읽어 rgb 정규화.
  const probe = document.createElement('span');
  probe.style.position = 'absolute'; probe.style.visibility = 'hidden';
  document.body.appendChild(probe);
  const tok = (v) => { probe.style.color = 'var(' + v + ')'; return getComputedStyle(probe).color; };
  const tokens = { hold: tok('--tag-hold-color'), watch: tok('--tag-watch-color'), text: tok('--text') };
  probe.remove();
  const pcts = [...root.querySelectorAll('[data-testid="anatomy-axis"]')].map((ax) => ({
    key: ax.getAttribute('data-axis'),
    rights: [...ax.querySelectorAll('[data-testid="anatomy-item-pct"]')].map((e) => Math.round(e.getBoundingClientRect().right)),
    nameW: [...ax.querySelectorAll('[data-testid="anatomy-item-name"]')].map((e) => Math.round(e.getBoundingClientRect().width)),
  }));
  const sm = root.querySelector('[data-testid="anatomy-cross-summary"]');
  const bar = root.querySelector('[data-testid="anatomy-bar"]');
  const br = bar ? bar.getBoundingClientRect() : null;
  const de = document.documentElement;
  const main = document.querySelector('main.page-wrap') || de;
  return {
    h1: (root.querySelector('h1')?.textContent || '').trim(),
    axes: [...root.querySelectorAll('[data-testid="anatomy-axis"]')].map((a) => a.getAttribute('data-axis')),
    itemNames: [...root.querySelectorAll('[data-testid="anatomy-item-name"]')].map((e) => e.textContent.trim()),
    expertsItems: root.querySelectorAll('[data-axis="experts"] [data-testid="anatomy-item"]').length,
    expertsMarks: root.querySelectorAll('[data-axis="experts"] [data-testid="anatomy-chip-owned"]').length,
    expertsBadges: root.querySelectorAll('[data-axis="experts"] [data-testid="anatomy-item-cross"]').length,
    marks, badges, pcts, tokens,
    summary: !!sm,
    summaryLines: sm ? window.__lines(sm) : -1,
    found: sm ? (sm.querySelector('[data-testid="anatomy-cross-found"]')?.textContent || '').trim() : null,
    none: sm ? !!sm.querySelector('[data-testid="anatomy-cross-none"]') : null,
    note: sm ? (sm.querySelectorAll('p')[1]?.textContent || '').trim() : null,
    legend: !!root.querySelector('[data-testid="anatomy-cross-legend"]'),
    firstBarBottom: br ? Math.round(br.bottom) : -1,
    vh: innerHeight,
    docOver: de.scrollWidth - de.clientWidth,
    mainOver: main.scrollWidth - main.clientWidth,
  };
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

  // ══ ⓙ 광물 축 producers 칩 (task#314) — 이 화면 경로는 라이브에서 처음 렌더된다 ══
  // `anatomy-minerals-basis`는 `minerals_share_basis`가 있을 때만 렌더되므로, 채우기 전에는
  // 그 요소가 DOM에 아예 없었다. 즉 이 축은 「통과」가 아니라 「처음 도달」이다.
  if (PROD_API.length > 0) {
    await page.goto(`${BASE}/tech-anatomy/${PROD_TARGET.slug}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="tech-anatomy"]', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(700);
    const pr = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="tech-anatomy"]');
      if (!root) return null;
      const chips = [...root.querySelectorAll('[data-testid="anatomy-producer-chip"]')].map((e) => {
        const lv = e.querySelector('.tech-anatomy__chip-lv');
        return {
          text: e.textContent.trim(),
          pct: lv ? lv.textContent.trim() : null,
          lines: window.__lines(e),
          sw: e.scrollWidth, cw: e.clientWidth,
        };
      });
      const mb = root.querySelector('[data-testid="anatomy-minerals-basis"]');
      const wrap = root.querySelector('[data-testid="anatomy-producer-chips"]');
      return {
        chips,
        basisText: mb ? mb.textContent.trim() : null,
        parentDisplay: wrap ? getComputedStyle(wrap).display : null,
        docSw: document.documentElement.scrollWidth, docCw: document.documentElement.clientWidth,
      };
    });
    // 정의역 sentinel — DOM 칩 수가 API 수와 같아야 「검사했다」가 성립한다
    eq(`prod-domain:${V.name}`, pr ? pr.chips.length : -1, PROD_API.length,
       `${PROD_TARGET.slug} · API ${PROD_API.length}개`);
    // 부모가 flex여야 clientWidth가 유효하다(task#309 — block이면 넘침 축이 원리적으로 무의미)
    eq(`prod-parent-flex:${V.name}`, pr?.parentDisplay ?? 'MISSING', 'flex');
    // 「이름(국가)」 패턴 — 국가 괄호가 없는 칩은 위반
    eq(`prod-name-country:${V.name}`,
       (pr?.chips || []).filter((c) => !/\([A-Z]{2}\)/.test(c.text)).map((c) => c.text), []);
    // %표기 — 있는 칩/없는 칩을 **둘 다** 센다(한쪽만 재면 판별력이 없다)
    eq(`prod-pct-count:${V.name}`, (pr?.chips || []).filter((c) => c.pct).length,
       PROD_API.filter((p) => p.share_pct != null).length);
    eq(`prod-nopct-count:${V.name}`, (pr?.chips || []).filter((c) => !c.pct).length,
       PROD_API.filter((p) => p.share_pct == null).length);
    eq(`prod-pct-format:${V.name}`,
       (pr?.chips || []).filter((c) => c.pct && !/^\d+(\.\d)?%$/.test(c.pct)).map((c) => c.pct), []);
    // basis — share_pct가 하나라도 있으면 이 문구가 실재해야 한다(스키마가 요구하는 그 짝)
    eq(`prod-basis-present:${V.name}`, !!pr?.basisText, PROD_BASIS != null,
       `basis=${JSON.stringify((pr?.basisText || '').slice(0, 40))}`);
    eq(`prod-basis-text:${V.name}`,
       PROD_BASIS ? (pr?.basisText || '').includes(PROD_BASIS) : 'NO_BASIS', PROD_BASIS ? true : 'NO_BASIS');
    // 한 칩이 한 덩어리로 유지되는가 + 문서 넘침 0
    eq(`prod-chip-1line:${V.name}`, (pr?.chips || []).filter((c) => c.lines !== 1).map((c) => `${c.text}=${c.lines}줄`), []);
    eq(`prod-no-hscroll:${V.name}`, pr ? pr.docSw <= pr.docCw : 'NO_ROOT', true, `${pr?.docSw} <= ${pr?.docCw}`);
    bump('producer', 9);
    rawLog.push(`${V.name} producers 칩 ${pr?.chips.length}개(%표기 ${(pr?.chips || []).filter((c) => c.pct).length}) · ${PROD_TARGET.slug}`);
    await page.screenshot({ path: `${OUT}/${V.name}-producers.png`, fullPage: true });
  } else {
    eq(`prod-domain:${V.name}`, 'NO_PRODUCERS_IN_LIVE', 'OK',
       '⚠️ 라이브에 producers가 0개다 — 이 축은 통과가 아니라 미검증이다');
    bump('producer');
  }

  // ══ ⓐ~ⓓ 교차 마커·항목 배지·요약 (task#315) ═════════════════════════════════
  // 기대값은 화면이 아니라 **API에서 독립 재계산**한 것이다(위 crossExpect). 판마다 마커/배지
  // 기대가 0일 수도 있는데 그 경우도 단언은 **무조건** 돈다 — 0 기대 판은 「거짓 마커가 없다」를
  // 검사한다(조건부 단언을 쓰면 총계가 데이터 상태에 따라 흔들려 측정 실패가 통과로 보인다).
  for (const CS of CROSS_LIST) {
    const slug = CS.r.slug, X = CS.x, P0 = `${V.name}:${slug}`;
    await page.goto(`${BASE}/tech-anatomy/${slug}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="tech-anatomy"]', { timeout: 20000 }).catch(() => {});
    await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0).catch(() => {});
    await page.waitForTimeout(900);
    const D = await page.evaluate((n) => window.__readCross(n), X.names);

    // identity를 판정축보다 **먼저** — 마커·배지 축은 페이지 내용과 독립이라 틀린 판 위에서도
    // 통과한다(⑧ⓘ). URL과 h1을 함께 본다.
    eq(`xc-identity:${P0}`, !!D && /해부$/.test(D.h1) && page.url().includes(`/tech-anatomy/${slug}`), true,
       `h1="${D?.h1}" url=${page.url()}`);
    // 이빨 — 보유·관심·본문 세 색이 서로 다름. 같아지면 아래 색 단언은 아무것도 안 본다.
    eq(`xc-token-teeth:${P0}`, D ? new Set([D.tokens.hold, D.tokens.watch, D.tokens.text]).size : -1, 3,
       JSON.stringify(D?.tokens));

    // ── ⓐ 칩 마커: 개수 · (축|상태|이름) 다중집합 · 글리프 · 접근성 이름 · 색 ──
    eq(`xc-mark-count:${P0}`, D ? D.marks.length : -1, X.markers.length, `기대 ${JSON.stringify(X.markers)}`);
    eq(`xc-mark-pairs:${P0}`, (D?.marks || []).map((m) => `${m.axis}|${m.state}|${m.name}`).sort(),
       X.markers.map((m) => `${m.axis}|${m.state}|${m.name}`).sort());
    eq(`xc-mark-glyph:${P0}`,
       (D?.marks || []).filter((m) => m.glyph !== (m.state === 'holding' ? '◆' : '◇')).map((m) => `${m.name}=${m.glyph}`), []);
    // 기하·색이 옳아도 AT에서 프루닝되면 이 화면의 핵심 정보가 통째로 사라진다(⑭).
    eq(`xc-mark-a11y:${P0}`,
       (D?.marks || []).filter((m) => m.role !== 'img' || m.aria !== `${m.state === 'holding' ? '보유' : '관심'} 종목`)
                       .map((m) => `${m.name}=${m.role}/${m.aria}`), []);
    // ⑪ 색 미적용 클래스 — 클래스는 붙었는데 규칙이 없으면 무채색으로 조용히 사라진다.
    eq(`xc-mark-color:${P0}`,
       (D?.marks || []).filter((m) => m.color !== (m.state === 'holding' ? D.tokens.hold : D.tokens.watch))
                       .map((m) => `${m.name}=${m.color}`), []);
    bump('xcross', 7);

    // ── 항목 배지: 개수 == techItemHits+mineralItemHits · **오배치까지** 잡는 집합 대조 ──
    eq(`xc-badge-count:${P0}`, D ? D.badges.length : -1, X.techHits + X.minHits,
       `techHits=${X.techHits} minHits=${X.minHits}`);
    eq(`xc-badge-set:${P0}`, (D?.badges || []).map((b) => `${b.axis}|${b.item}|h${b.h}|w${b.w}`).sort(), [...X.badges].sort());
    eq(`xc-badge-1line:${P0}`, (D?.badges || []).filter((b) => b.lines !== 1).map((b) => `${b.item}=${b.lines}줄`), []);
    bump('xcross', 3);

    // ── ⓒ 전문가 축 배지·마커 0 — 「그 축이 실재하는 판을 검사했다」를 sentinel로 함께 둔다 ──
    // sentinel 없이 0을 단언하면 전문가 축이 없는 판에서도 통과해 아무것도 증언하지 않는다.
    eq(`xc-experts-domain:${P0}`, D ? (D.expertsItems > 0) : null, X.axisKeys.includes('experts'),
       `API experts=${X.axisKeys.includes('experts')} DOM items=${D?.expertsItems}`);
    eq(`xc-experts-zero:${P0}`, D ? [D.expertsMarks, D.expertsBadges] : null, [0, 0]);
    bump('xcross', 2);

    // ── ⓑ 요약 블록: 존재/부재가 그 판의 실제 교차와 일치하는가 ──
    // 「없음」은 조회 성공 + 대조 완료에서만 할 수 있는 말이다(task#307의 3상태 규율).
    eq(`xc-summary-present:${P0}`, D ? D.summary : null, X.measurable, `measurable=${X.measurable}`);
    eq(`xc-summary-found:${P0}`, D ? (D.summary ? (D.none ? 'NONE' : D.found) : 'NO_SUMMARY') : 'NO_ROOT',
       X.measurable ? (X.found.length > 0 ? X.found.join(' · ') : 'NONE') : 'NO_SUMMARY');
    // 부기 — 필수 조각 전부 포함. 문구 전체 동일성이 아니라 **수치를 실은 조각**을 본다.
    eq(`xc-summary-note:${P0}`,
       X.measurable ? X.notes.filter((n) => !(D?.note || '').includes(n)) : (D?.summary ? ['SUMMARY_SHOULD_BE_ABSENT'] : []),
       [], `note="${(D?.note || '').slice(0, 100)}"`);
    eq(`xc-legend:${P0}`, D ? D.legend : null, X.measurable && (X.holdN + X.watchN) > 0);
    bump('xcross', 4);

    // ── ⓓ 가로 스크롤 0 — 배지가 이름 트랙에서 폭을 빼앗는 판이 관측 지점이다(⑰) ──
    eq(`xc-hscroll-doc:${P0}`, D ? D.docOver <= 0 : null, true, `scrollWidth-clientWidth=${D?.docOver}`);
    eq(`xc-hscroll-main:${P0}`, D ? D.mainOver <= 0 : null, true, `diff=${D?.mainOver}`);
    // 축 내 % 열 우측 정렬 — 배지가 끼어도 값 열이 지그재그가 되지 않아야 한다(⑩ 간격 축).
    const pctD = (D?.pcts || []).filter((p) => p.rights.length >= 2);
    eq(`xc-pct-domain:${P0}`, pctD.length > 0 ? 'OK' : `PCT_DOMAIN_TOO_SMALL(${pctD.length})`, 'OK');
    eq(`xc-pct-right:${P0}`, pctD.filter((p) => new Set(p.rights).size !== 1).map((p) => `${p.key}=${JSON.stringify([...new Set(p.rights)])}`), []);
    // 첫 화면 세로 예산 — 요약 한 덩어리가 첫 막대를 화면 밖으로 밀지 않았는가(⑰ 세로판).
    // 요약 **줄 수**는 대리지표라 단언에서 뺀다(출력만 — ⑧ⓗ). 단언은 목표 자체다.
    eq(`xc-firstbar-inview:${P0}`, D ? (D.firstBarBottom > 0 && D.firstBarBottom <= D.vh) : null, true,
       `barBottom=${D?.firstBarBottom} vh=${D?.vh} · 요약 ${D?.summaryLines}줄`);
    bump('xcross', 5);
    rawLog.push(`${P0} 마커 ${D?.marks.length}/기대 ${X.markers.length} · 배지 ${D?.badges.length}/기대 ${X.badges.length} · 요약 ${D?.summary}(${D?.summaryLines}줄) · 첫막대 ${D?.firstBarBottom}/${D?.vh} · 이름폭 ${JSON.stringify((D?.pcts || []).map((p) => p.nameW))}`);
    await page.screenshot({ path: `${OUT}/${V.name}-cross-${slug}.png`, fullPage: true });

    // ── 배지 숨김 대조군 — 라이브를 되돌리지 않고 **처방만 무효화**한다(⑧ⓚ②) ──
    // 목적 둘: ① % 열 정렬이 배지와 무관함을 확인 ② 배지가 이름 트랙에서 가져간 폭을 실측해
    // 「이웃 열 비용 이전」(⑰)의 크기를 남긴다(출력만 — 정당한 변경에 거짓 실패하지 않게).
    await page.addStyleTag({ content: '[data-testid="anatomy-item-cross"]{display:none !important}' });
    await page.waitForTimeout(200);
    const D2 = await page.evaluate((n) => window.__readCross(n), X.names);
    eq(`xc-nobadge-applied:${P0}`, (D2?.badges || []).filter((b) => b.boxW !== 0).map((b) => `${b.item}=${b.boxW}px`), [],
       `대조군 대상 배지 ${D2?.badges.length}개`);
    eq(`xc-nobadge-pct-right:${P0}`,
       (D2?.pcts || []).filter((p) => p.rights.length >= 2 && new Set(p.rights).size !== 1).map((p) => p.key), []);
    bump('xcross', 2);
    rawLog.push(`${P0} 배지숨김 대조: 이름폭 ${JSON.stringify((D?.pcts || []).map((p) => p.nameW))} → ${JSON.stringify((D2?.pcts || []).map((p) => p.nameW))}`);
  }

  // ══ 대조군 A — **measurable=false 합성**: 전문가 축만 남긴 composition을 주입한다 ══════
  // 실데이터에도 「전문가 축만 있는 판」이 지금은 있지만(ai-datacenter-ops) 그건 **데이터 상태**다.
  // 대조군이 데이터에 인질로 잡히면 백필 한 번에 소멸한다(task#307 ①) → 주입으로 합성한다.
  // 주입 대상의 **고유 마커**(합성 항목명)를 함께 단언한다 — 대조군 자체의 대상도 검증 대상이다(⑧ⓔ).
  const XCTRL_ITEMS = ['ZZ대조군-전문가A', 'ZZ대조군-전문가B'];
  let xinj = 0;
  await page.route('**/api/tech-reports/**', async (route) => {
    const res = await route.fetch();
    let body; try { body = await res.json(); } catch { return route.fulfill({ response: res }); }
    if (Array.isArray(body?.reports)) {
      body.reports = body.reports.map((r) => ({ ...r, composition: {
        experts: XCTRL_ITEMS.map((n, i) => ({ name: n, share_pct: i === 0 ? 60 : 40, rationale: '대조군 — 업체를 붙이지 않는 축' })),
      } }));
      xinj += 1;
    }
    await route.fulfill({ response: res, body: JSON.stringify(body), contentType: 'application/json' });
  });
  await page.goto(`${BASE}/tech-anatomy/${TARGET.slug}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="tech-anatomy"]', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(800);
  const XC = await page.evaluate((n) => window.__readCross(n), XCTRL_ITEMS);
  eq(`xctrl-injected:${V.name}`, xinj > 0, true, `가로챈 응답 ${xinj}건`);
  eq(`xctrl-target:${V.name}`, XC ? XC.axes : null, ['experts'], '주입이 실제로 그 판을 덮었는가');
  eq(`xctrl-item:${V.name}`, XC ? XC.itemNames : null, XCTRL_ITEMS, '대조군의 대상도 고유 마커로 단언한다');
  eq(`xctrl-summary-absent:${V.name}`, XC ? XC.summary : null, false,
     'measurable=false에서 요약이 나오면 화면이 「없음」이라는 거짓 진술을 한다(task#307)');
  eq(`xctrl-marks0:${V.name}`, XC ? [XC.marks.length, XC.badges.length, XC.legend] : null, [0, 0, false]);
  bump('xctrl', 5);
  await page.screenshot({ path: `${OUT}/${V.name}-xctrl.png`, fullPage: true });
  await page.unroute('**/api/tech-reports/**');

  // ══ 대조군 B — **광물 축 마커 경로의 합성 검증** ═══════════════════════════════
  // ⚠️ 라이브 실측: producers 티커 ∩ 보유·관심 = 0건(위 `mineral-live-pin`). 이 경로는 라이브에서
  // **원리적으로 dormant**다. 종목을 추가해 억지로 밟지 않고(사용자 확정) `/api/stocks` **GET
  // 응답에 한 종목을 합성 주입**해 렌더 경로를 밟는다 — 응답 가로채기라 프로덕션 쓰기 0이다.
  // 이 축의 PASS는 「라이브 겹침이 있다」가 아니라 **「겹침이 생기면 광물 칩이 마커를 받는다」**다.
  // 카운터를 **둘로** 쪼갠다: 라우트 발화(sreq)와 주입 적용(sinj). 하나로 두면 0이 「화면이
  // 그 훅을 안 쓴다」와 「프로브 패턴이 틀렸다」를 구별하지 못한다(⑧ⓔ의 자기적용).
  // 패턴 자체의 관측가능성은 별도 실측으로 확인했다: 같은 `**/api/stocks`가 `/tech-report/:slug`
  // 에서는 1건 발화한다(그 화면은 인라인 fetch로 같은 엔드포인트를 쓴다).
  let sreq = 0, sinj = 0;
  await page.route('**/api/stocks', async (route) => {
    sreq += 1;
    const res = await route.fetch();
    let body; try { body = await res.json(); } catch { return route.fulfill({ response: res }); }
    if (Array.isArray(body) && MINJ) {
      body.push({ ticker: MINJ.ticker, name: `합성-${MINJ.ticker}`, type: 'watchlist', market: 'US', enriched_at: null, analyst_target: false });
      sinj += 1;
    }
    await route.fulfill({ response: res, body: JSON.stringify(body), contentType: 'application/json' });
  });
  await page.goto(`${BASE}/tech-anatomy/${PROD_TARGET.slug}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="tech-anatomy"]', { timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0).catch(() => {});
  await page.waitForTimeout(900);
  const MD = await page.evaluate((n) => window.__readCross(n), MINJ_X.names);
  eq(`minj-domain:${V.name}`, MINJ ? 'OK' : 'NO_INJECTABLE_PRODUCER_TICKER', 'OK',
     MINJ ? `${MINJ.ticker} 칩 ${MINJ.chips}개 · ${PROD_TARGET.slug}` : '');
  eq(`minj-route-fired:${V.name}`, sreq > 0, true,
     `/api/stocks 요청 ${sreq}건 — 0이면 화면이 그 훅을 쓰지 않는다는 뜻이다(패턴 블라인드가 아니다)`);
  eq(`minj-injected:${V.name}`, sinj > 0, true, `가로챈 /api/stocks ${sinj}건`);
  eq(`minj-mark-mineral:${V.name}`, (MD?.marks || []).filter((m) => m.axis === 'minerals').length,
     MINJ_X.markers.filter((m) => m.axis === 'minerals').length, '광물 축 마커 — 라이브 dormant 경로의 합성 검증');
  eq(`minj-mark-pairs:${V.name}`, (MD?.marks || []).map((m) => `${m.axis}|${m.state}|${m.name}`).sort(),
     MINJ_X.markers.map((m) => `${m.axis}|${m.state}|${m.name}`).sort());
  eq(`minj-badge-set:${V.name}`, (MD?.badges || []).map((b) => `${b.axis}|${b.item}|h${b.h}|w${b.w}`).sort(), [...MINJ_X.badges].sort());
  eq(`minj-summary:${V.name}`, MD ? (MD.summary ? (MD.none ? 'NONE' : MD.found) : 'NO_SUMMARY') : 'NO_ROOT',
     MINJ_X.measurable ? (MINJ_X.found.length > 0 ? MINJ_X.found.join(' · ') : 'NONE') : 'NO_SUMMARY');
  eq(`minj-hscroll:${V.name}`, MD ? MD.docOver <= 0 : null, true, `diff=${MD?.docOver}`);
  bump('minj', 8);
  rawLog.push(`${V.name} 광물 합성 주입: 마커 ${(MD?.marks || []).filter((m) => m.axis === 'minerals').length}/기대 ${MINJ_X.markers.filter((m) => m.axis === 'minerals').length} · 배지 ${MD?.badges.length}/기대 ${MINJ_X.badges.length}`);
  await page.screenshot({ path: `${OUT}/${V.name}-minj.png`, fullPage: true });
  await page.unroute('**/api/stocks');

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

  // ══ ⓛ 카드 히트 오버레이 — 기하 (task#316) ═══════════════════════════════════
  // S3의 vitest는 `position: absolute` + 롱핸드 오프셋이 **선언됐는지**만 쟀다. 그 선언이 실제로
  // 카드 상자(padding 포함) 전체를 덮는지는 라이브 rect만이 확인한다 — 조상이 static이면 오버레이가
  // 딴 조상에 붙어 히트 영역이 통째로 어긋나는데 jsdom에선 둘이 구별되지 않는다.
  const ov = await page.evaluate(() => {
    const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 }; };
    return [...document.querySelectorAll('[data-testid="tech-report-card"]')].map((c) => {
      const o = c.querySelector('[data-testid="card-hit-overlay"]');
      const lk = c.querySelector('[data-testid="card-link-anatomy"]');
      const body = c.querySelector('[data-testid="card-to-report"]');
      const os = o ? getComputedStyle(o) : null;
      const ls = lk ? getComputedStyle(lk) : null;
      return {
        slug: c.getAttribute('data-slug'),
        cardPos: getComputedStyle(c).position,
        // `top/right/bottom/left:0`은 **padding box** 기준이고 getBoundingClientRect는 **border box**다.
        // 그 차이가 정확히 테두리 폭이므로, 그것을 안 빼면 축이 1px 테두리를 「안 덮였다」로 읽는다.
        cardBw: (() => { const cs = getComputedStyle(c); return {
          l: parseFloat(cs.borderLeftWidth) || 0, t: parseFloat(cs.borderTopWidth) || 0,
          r: parseFloat(cs.borderRightWidth) || 0, b: parseFloat(cs.borderBottomWidth) || 0 }; })(),
        card: box(c),
        body: body ? box(body) : null,
        ov: o ? { tag: o.tagName, aria: o.getAttribute('aria-hidden'), pos: os.position, pe: os.pointerEvents, box: box(o) } : null,
        lk: lk ? { pos: ls.position, z: ls.zIndex, box: box(lk) } : null,
      };
    });
  });
  eq(`overlay-domain:${V.name}`, ov.length > 0 ? 'OK' : 'DOMAIN_TOO_SMALL(0)', 'OK');
  // 오버레이의 오프셋 기준이 되는 positioned 조상 — static이면 `top/right/bottom/left:0`이 딴 상자를 잡는다
  eq(`overlay-card-relative:${V.name}`, ov.filter((c) => c.cardPos !== 'relative').map((c) => `${c.slug}=${c.cardPos}`), []);
  eq(`overlay-present:${V.name}`, ov.filter((c) => !c.ov).map((c) => c.slug), []);
  eq(`overlay-shape:${V.name}`,
     ov.filter((c) => c.ov && (c.ov.tag !== 'SPAN' || c.ov.aria !== 'true' || c.ov.pos !== 'absolute'))
       .map((c) => `${c.slug}=${c.ov.tag}/${c.ov.aria}/${c.ov.pos}`), []);
  // 히트 영역 = 카드의 **padding box**와 동일해야 한다(S1 실측 죽은 영역: m278 padBottom 68 · pc1280 86).
  // ⚠️ 처음엔 border box(=`getBoundingClientRect`)와 대조했는데 그건 **원리적으로 FAIL한다** —
  //    절대배치의 `top/right/bottom/left:0`은 positioned 조상의 *padding box*를 기준으로 하므로
  //    오버레이는 테두리 폭만큼 작다(실측 238×250.1 vs 카드 240×252.1 = 1px 테두리 양쪽).
  //    죽은 영역이었던 것은 *padding*이고 그건 덮였다. 그래서 축을 padding box 대조로 정확화한다.
  const padBox = (c) => ({ l: c.card.l + c.cardBw.l, t: c.card.t + c.cardBw.t,
                           r: c.card.r - c.cardBw.r, b: c.card.b - c.cardBw.b });
  eq(`overlay-covers-card:${V.name}`,
     ov.filter((c) => !c.ov || ['l', 't', 'r', 'b'].some((k) => Math.abs(c.ov.box[k] - padBox(c)[k]) > 0.5))
       .map((c) => `${c.slug}=${c.ov ? JSON.stringify([c.ov.box.w, c.ov.box.h]) : 'NO_OVERLAY'} vs padBox ${JSON.stringify([c.card.w - c.cardBw.l - c.cardBw.r, Math.round((c.card.h - c.cardBw.t - c.cardBw.b) * 10) / 10])}`), []);
  // 이빨 — 위 축을 padding box로 느슨하게 한 대가를 여기서 되받는다. 안 덮인 띠가 **정확히 테두리**여야
  // 하므로, 오버레이가 그보다 조금이라도 더 줄면(예: `inset: 2px`) 이 축이 FAIL한다.
  eq(`overlay-gap-is-border:${V.name}`,
     ov.filter((c) => c.ov).filter((c) => ['l', 't'].some((k) => Math.abs((c.ov.box[k] - c.card[k]) - c.cardBw[k]) > 0.5)
                                       || ['r', 'b'].some((k) => Math.abs((c.card[k] - c.ov.box[k]) - c.cardBw[k]) > 0.5))
       .map((c) => `${c.slug}: gap=[${(c.ov.box.l - c.card.l).toFixed(1)},${(c.ov.box.t - c.card.t).toFixed(1)}] bw=[${c.cardBw.l},${c.cardBw.t}]`), []);
  // `pointerEvents: none`이면 오버레이는 존재하는데 클릭을 안 받는다 — 무음 no-op의 두 번째 경로
  eq(`overlay-hittable:${V.name}`, ov.filter((c) => c.ov && c.ov.pe !== 'auto').map((c) => `${c.slug}=${c.ov.pe}`), []);
  // 「해부」 칩이 오버레이 **위**에 있는가 — 이 쌍이 끊기면 해부 진입점이 통째로 가려진다
  eq(`overlay-chip-above:${V.name}`,
     ov.filter((c) => !c.lk || c.lk.pos !== 'relative' || c.lk.z !== '1').map((c) => `${c.slug}=${c.lk ? c.lk.pos + '/' + c.lk.z : 'NO_LINK'}`), []);
  // ⓓ 앵커 수 — ⚠️ 오버레이는 `<span>`이라 이 축은 **도입 여부와 무관하게 통과한다**. 회귀 가드이고
  //    새 기능의 증거가 아니다(오버레이를 `<a>`로 잘못 바꾸면 여기서 걸린다).
  eq(`card-anchor-count:${V.name}`, cards.filter((c) => c.hrefs.length !== 2).map((c) => `${c.slug}=${c.hrefs.length}개`), [],
     '회귀 가드 — 오버레이가 span인 한 이 축은 오버레이 유무에 블라인드하다');
  bump('overlay', 8);
  for (const c of ov) {
    if (c.slug !== TARGET.slug) continue;
    rawLog.push(`${V.name} 카드 죽은영역 실측(${c.slug}): 카드 ${c.card.w}x${c.card.h} · 본문 ${c.body ? `${c.body.w}x${c.body.h}` : 'NONE'} · padTop ${c.body ? Math.round(c.body.t - c.card.t) : '?'} padBottom ${c.body ? Math.round(c.card.b - c.body.b) : '?'} padLeft ${c.body ? Math.round(c.body.l - c.card.l) : '?'} · 오버레이 ${c.ov ? `${c.ov.box.w}x${c.ov.box.h}` : 'NONE'}`);
  }

  // ══ ⓐⓑⓒ 클릭 목적지 — **쌍으로** 잰다 (task#316) ═══════════════════════════
  // ⓐ 카드 padding 4점 → 리포트 / ⓒ 칩 경계 +3px → 리포트 / ⓑ 칩 중앙 → 해부.
  // ⓑ가 없으면 오버레이가 칩을 삼켜도 ⓐ가 전부 통과해 판별력이 0이 된다.
  // 클릭 실패는 프로브를 죽이지 않고 `CLICK_BLOCKED`를 **축의 값**으로 만든다(무음 스킵 금지).
  const HIT_KINDS = ['tl', 'tr', 'bl', 'br', 'rightOfChip', 'chip'];
  const hitWant = (k) => (k === 'chip' ? `/tech-anatomy/${TARGET.slug}` : `/tech-report/${TARGET.slug}`);
  for (const kind of HIT_KINDS) {
    await page.goto(`${BASE}/tech-reports`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="tech-report-card"]', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(400);
    // 좌표는 **스크롤 후에** 잰다 — 스크롤 전 좌표로 클릭하면 딴 곳을 누르고 그 실패가 앱 결함처럼 보인다.
    const P = await page.evaluate(([slug, k]) => {
      const c = document.querySelector(`[data-testid="tech-report-card"][data-slug="${slug}"]`);
      if (!c) return { err: 'NO_CARD' };
      c.scrollIntoView({ block: 'center' });
      const lk = c.querySelector('[data-testid="card-link-anatomy"]');
      if (!lk) return { err: 'NO_ANATOMY_LINK' };
      const cr = c.getBoundingClientRect(), lr = lk.getBoundingClientRect();
      const IN = 8;   // radius 12 코너 원 안쪽(중심 (12,12)에서 거리 8.49 < 12)이라 카드 히트 영역이다
      const map = {
        tl: [cr.left + IN, cr.top + IN], tr: [cr.right - IN, cr.top + IN],
        bl: [cr.left + IN, cr.bottom - IN], br: [cr.right - IN, cr.bottom - IN],
        rightOfChip: [lr.right + 3, (lr.top + lr.bottom) / 2],
        chip: [(lr.left + lr.right) / 2, (lr.top + lr.bottom) / 2],
      };
      const [x, y] = map[k];
      const el = document.elementFromPoint(x, y);
      return {
        x, y,
        top: el ? (el.closest('[data-testid]')?.getAttribute('data-testid') || el.tagName) : 'NONE',
        inCard: x > cr.left && x < cr.right && y > cr.top && y < cr.bottom,
        inChip: x >= lr.left && x <= lr.right && y >= lr.top && y <= lr.bottom,
        inView: x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight,
        card: [cr.left, cr.top, cr.right, cr.bottom].map((v) => Math.round(v)),
        chipBox: [lr.left, lr.top, lr.right, lr.bottom].map((v) => Math.round(v)),
      };
    }, [TARGET.slug, kind]);
    let dest;
    if (P.err) dest = `SETUP_FAIL(${P.err})`;
    else {
      try {
        await page.mouse.click(P.x, P.y);
        await page.waitForTimeout(900);
        dest = new URL(page.url()).pathname;
      } catch (e) { dest = `CLICK_BLOCKED(${String(e.message).split('\n')[0].slice(0, 48)})`; }
    }
    // 대상 유효성을 목적지보다 **먼저** — 좌표가 카드 밖·화면 밖이거나 코너가 칩 위면 이 축은 딴 것을 잰다
    eq(`hit-point-domain:${V.name}:${kind}`,
       P.err ? `SETUP(${P.err})` : [P.inCard, P.inView, kind === 'chip' ? P.inChip : !P.inChip],
       [true, true, true],
       P.err ? '' : `pt=(${Math.round(P.x)},${Math.round(P.y)}) card=${JSON.stringify(P.card)} chip=${JSON.stringify(P.chipBox)}`);
    eq(`hit-dest:${V.name}:${kind}`, dest, hitWant(kind),
       P.err ? '' : `topmost=${P.top} · pt=(${Math.round(P.x)},${Math.round(P.y)})`);
    bump('hit', 2);
    rawLog.push(`${V.name} 클릭 ${kind}: pt=(${P.err ? P.err : Math.round(P.x) + ',' + Math.round(P.y)}) topmost=${P.top ?? '?'} → ${dest}`);
    // 육안 증거는 **착지 화면**이다(그 축이 재는 것이 목적지이므로) — 쌍의 양쪽만 남긴다:
    // padding 클릭(tl)과 칩 클릭(chip). 6종 전부 찍으면 파일이 18장 늘어 빠진 화면이 안 보인다.
    if (kind === 'tl' || kind === 'chip') {
      await page.screenshot({ path: `${OUT}/${V.name}-hit-${kind}.png` });
    }
  }
  // 뒤이은 왕복 내비 블록은 목록 화면을 전제한다 — 클릭 축이 떠난 자리를 되돌려 놓는다.
  await page.goto(`${BASE}/tech-reports`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="tech-report-card"]', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(400);

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

// ══════════════════════════════════════════════════════════════════════════════
// task#316 ⓔⓕ — 리포트 상세 `/tech-report/:slug`의 탭 타깃 칩 높이 + 목차 nav·스트립 세로 예산
// ──────────────────────────────────────────────────────────────────────────────
// 위 VIEWS 루프(3뷰)는 **건드리지 않는다** — 뷰포트를 하나 더 끼우면 선재 축 전부의 총계가 움직여
// 재실행 간 커버리지 비교가 무의미해진다(⑧ⓑ). 이 계열만 4폭(278/390/768/1280)으로 따로 돈다.
// 측정 대상은 기존 `TARGET`(= 목차 칩 최다 판, 2026-08-20 실측 `semiconductor-equipment` 11칩)이다.
// ══════════════════════════════════════════════════════════════════════════════
const CHIP_VIEWS = [
  { name: 'm278', opts: { ...devices['iPhone SE'], viewport: { width: 278, height: 800 }, isMobile: true, hasTouch: true } },
  { name: 'm390', opts: { ...devices['iPhone 13'] } },
  { name: 'm768', opts: { viewport: { width: 768, height: 1000 } } },
  { name: 'pc1280', opts: { viewport: { width: 1280, height: 1000 } } },
];
const SRC_URL_N = (TARGET.sources || []).filter((s) => s && s.url).length;
const SRC_NOURL_N = (TARGET.sources || []).filter((s) => s && !s.url).length;
rawLog.push(`칩 축 대상=${TARGET.slug} · 출처 ${(TARGET.sources || []).length}종(URL ${SRC_URL_N} · 무URL ${SRC_NOURL_N})`);

// 브라우저 안 판독기. 줄 수는 위 MEASURE의 `__lines`(겹치지 않는 rect 묶음)를 그대로 쓴다.
const CHIP_READ = `
window.__readChips = function (pubDate) {
  const box = (e) => { const r = e.getBoundingClientRect();
    return { l: r.left, t: r.top, r: r.right, b: r.bottom,
             w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100 }; };
  const chip = (e) => ({ text: e.textContent.trim().slice(0, 20), box: box(e), lines: window.__lines(e),
                         sw: e.scrollWidth, cw: e.clientWidth,
                         pad: getComputedStyle(e).padding, lh: getComputedStyle(e).lineHeight });
  const nav = document.querySelector('[data-testid="tech-report-toc"]');
  const srcWrap = document.querySelector('[data-testid="tech-report-sources"]');
  const strip = document.querySelector('[data-testid="tech-report-kpis"]');
  const tabbar = document.querySelector('nav.tabbar');
  const tabbarH = tabbar ? Math.round(tabbar.getBoundingClientRect().height) : 0;
  const de = document.documentElement;
  const main = document.querySelector('main.page-wrap') || de;
  return {
    h1: (document.querySelector('h1')?.textContent || '').trim(),
    dateFound: document.body.textContent.includes(pubDate),
    nav: nav ? { box: box(nav), display: getComputedStyle(nav).display,
                 gap: parseFloat(getComputedStyle(nav).rowGap) || 0,
                 align: getComputedStyle(nav).alignItems } : null,
    toc: nav ? [...nav.querySelectorAll('[data-testid="tech-toc-chip"]')].map(chip) : [],
    src: srcWrap ? [...srcWrap.querySelectorAll('a[href]')].map(chip) : [],
    srcNoUrl: srcWrap ? [...srcWrap.querySelectorAll('span')].length : -1,
    srcWrapper: srcWrap ? { display: getComputedStyle(srcWrap).display,
                            align: getComputedStyle(srcWrap).alignItems,
                            gap: parseFloat(getComputedStyle(srcWrap).rowGap) || 0 } : null,
    strip: strip ? box(strip) : null,
    scrollY: Math.round(window.scrollY),
    vh: innerHeight, tabbarH, avail: innerHeight - tabbarH,
    docOver: de.scrollWidth - de.clientWidth,
    mainOver: main.scrollWidth - main.clientWidth,
    // 넘침 축이 FAIL할 때 **무엇이** 넘쳤는지 함께 남긴다 — 안 남기면 다음 사람이 임계를 건드리는
    // 쪽으로 간다(⑧ⓝ). 판정은 위 두 수치가 하고, 이건 진단 자료다(단언 아님).
    wide: (() => {
      const lim = main.getBoundingClientRect().right + 1;
      // ⚠️ 자기 스크롤러(overflow-x auto|scroll)·클리퍼(hidden) 안의 요소는 **문서를 밀지 못한다**
      //    — 그걸 안 걸러내면 의도된 가로 스크롤 다이어그램(TechGraph의 SVG)이 목록을 통째로 삼켜
      //    진짜 범인이 안 보인다(1차 실행에서 실제로 그랬다). 이 문자열은 템플릿 리터럴 안이므로
      //    백틱을 쓰지 않는다(쓰면 문자열이 끊겨 프로브가 로드 파손된다).
      const inScroller = (e) => {
        for (let p = e.parentElement; p && p !== main; p = p.parentElement) {
          const ox = getComputedStyle(p).overflowX;
          if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true;
        }
        return false;
      };
      const out = [];
      for (const e of main.querySelectorAll('*')) {
        const r = e.getBoundingClientRect();
        if (r.width <= 0 || r.right <= lim || inScroller(e)) continue;
        out.push({ tid: e.getAttribute('data-testid') || '', tag: e.tagName,
                   cls: String(e.className || '').slice(0, 24),
                   w: Math.round(r.width), over: Math.round(r.right - lim),
                   txt: (e.textContent || '').trim().slice(0, 18) });
      }
      return out.sort((a, b) => b.over - a.over).slice(0, 5);
    })(),
  };
};
`;

// 줄 = 서로 다른 top 값의 묶음(0.5px 허용). flex 줄 판정에 쓴다 — align-items:stretch면 같은 줄의
// 칩들이 가장 높은 칩에 맞춰 늘어나므로, 「1줄 칩만 있는 줄」을 골라야 34px 정확성을 물을 수 있다.
const flexRows = (chips) => {
  const rows = [];
  for (const c of chips) {
    const hit = rows.find((r) => Math.abs(r.top - c.box.t) <= 0.5);
    if (hit) hit.chips.push(c); else rows.push({ top: c.box.t, chips: [c] });
  }
  return rows.sort((a, b) => a.top - b.top);
};

let srcPureRowsAll = 0;          // 전 폭 합산 — 「1줄 칩만 있는 줄」을 한 번이라도 밟았는가
const srcPureByView = [];
const tocCountByView = [];

for (const W of CHIP_VIEWS) {
  const ctx = await browser.newContext({ ...W.opts, serviceWorkers: 'block' });
  await ctx.addInitScript(([a, r]) => {
    localStorage.setItem('access_token', a);
    localStorage.setItem('refresh_token', r);
    localStorage.setItem('theme', 'light');
    localStorage.setItem('pwa-install-dismissed-at', String(Date.now()));
  }, [access_token, refresh_token]);
  const page = await ctx.newPage();
  await page.addInitScript(MEASURE);
  await page.addInitScript(CHIP_READ);
  await page.goto(`${BASE}/tech-report/${TARGET.slug}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="tech-report-toc"]', { timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0).catch(() => {});
  await page.waitForTimeout(900);
  const C = await page.evaluate((d) => window.__readChips(d), TARGET.published_date);

  // ── identity를 판정축보다 먼저 — 칩 높이 축은 페이지 내용과 독립이라 틀린 문서에서도 통과한다(⑧ⓘ)
  eq(`chip-identity:${W.name}`,
     [page.url().includes(`/tech-report/${TARGET.slug}`), (C?.h1 || '').length > 0, !!C?.dateFound],
     [true, true, true], `h1="${C?.h1}" date=${TARGET.published_date} url=${page.url()}`);
  // 스트립 세로 예산 축은 **스크롤 0에서만** 성립한다
  eq(`chip-scroll0:${W.name}`, C ? C.scrollY : -1, 0);
  bump('chipident', 2);

  // ── ⓔ-1 목차 칩: 34px **정확히** (nowrap이라 전 칩이 1줄 → 전 칩이 같은 줄 높이) ──
  eq(`toc-domain:${W.name}`, (C?.toc.length || 0) >= 8 ? 'OK' : `TOC_DOMAIN_TOO_SMALL(${C?.toc.length})`, 'OK',
     `목차 칩 ${C?.toc.length}개 · gap ${C?.nav?.gap}px`);
  // 34px는 **부모가 flex인 동안만** 참이다 — block이면 인라인 요소의 세로 padding이 줄 상자에
  // 반영되지 않아 이 축이 조용히 무의미해진다(task#309).
  eq(`toc-parent-flex:${W.name}`, C?.nav?.display ?? 'NO_NAV', 'flex');
  eq(`toc-chip-h:${W.name}`, (C?.toc || []).filter((c) => Math.abs(c.box.h - 34) > 0.5).map((c) => `${c.text}=${c.box.h}px`), [],
     `실측 높이 ${JSON.stringify([...new Set((C?.toc || []).map((c) => c.box.h))])} · padding ${JSON.stringify([...new Set((C?.toc || []).map((c) => c.pad))])} · line-height ${JSON.stringify([...new Set((C?.toc || []).map((c) => c.lh))])}`);
  eq(`toc-chip-1line:${W.name}`, (C?.toc || []).filter((c) => c.lines !== 1).map((c) => `${c.text}=${c.lines}줄`), []);
  // 줄 수 축은 nowrap이 걸린 동안 공허하다 → 넘침 축과 **쌍으로** 둔다(가토 ⑨ 거울상, task#309).
  eq(`toc-chip-nooverflow:${W.name}`, (C?.toc || []).filter((c) => c.sw > c.cw + 1).map((c) => `${c.text}=${c.sw}>${c.cw}`), []);
  bump('toc', 5);

  // ── ⓕ 목차 nav 높이 — 리터럴이 아니라 **불변식**(줄 수·gap·칩 높이 전부 실측) ──
  const tocRows = flexRows(C?.toc || []);
  const tocChipH = Math.max(0, ...(C?.toc || []).map((c) => c.box.h));
  const navExp = tocRows.length > 0 ? tocRows.length * tocChipH + (tocRows.length - 1) * (C?.nav?.gap || 0) : -1;
  eq(`toc-nav-h:${W.name}`, C?.nav ? Math.abs(C.nav.box.h - navExp) <= 0.6 : 'NO_NAV', true,
     `navH=${C?.nav?.box.h} 기대=${navExp.toFixed(2)} (${tocRows.length}줄 × ${tocChipH}px + ${tocRows.length - 1} × gap ${C?.nav?.gap})`);
  // 칩 성장이 스트립을 밀지 않는 **메커니즘** — 목차가 스트립 아래라는 순서 계약
  eq(`toc-below-strip:${W.name}`, (C?.nav && C?.strip) ? C.nav.box.t >= C.strip.b : 'MISSING', true,
     `tocTop=${C?.nav?.box.t} stripBottom=${C?.strip?.b}`);
  // 첫 화면 세로 예산 — 유효 바닥은 vh가 아니라 vh − 탭바다(uat280과 같은 자)
  eq(`strip-inview:${W.name}`, C?.strip ? (C.strip.b > 0 && C.strip.b <= C.avail) : 'NO_STRIP', true,
     `stripBottom=${C?.strip?.b} 가용=${C?.avail}(vh ${C?.vh} − 탭바 ${C?.tabbarH}) · 여유 ${C?.strip ? Math.round(C.avail - C.strip.b) : '?'}px`);
  bump('tocnav', 3);

  // ── ⓔ-2 출처 링크 칩: 하한 ≥34 + 「1줄 칩만 있는 flex 줄」은 정확히 34 ──
  // 컨테이너가 align-items:stretch(기본값)라 같은 줄의 칩이 가장 높은 칩에 맞춰 늘어난다 →
  // 「모든 칩 == 34」는 원리적으로 FAIL한다. 하한과 정확성을 **다른 축**으로 가른다.
  eq(`src-domain:${W.name}`, C ? C.src.length : -1, SRC_URL_N, `API URL 보유 출처 ${SRC_URL_N}종`);
  eq(`src-parent-flex:${W.name}`, C?.srcWrapper?.display ?? 'NO_WRAP', 'flex');
  eq(`src-chip-hmin:${W.name}`, (C?.src || []).filter((c) => c.box.h < 33.5).map((c) => `${c.text}=${c.box.h}px`), [],
     `높이 분포 ${JSON.stringify([...new Set((C?.src || []).map((c) => c.box.h))].sort((a, b) => a - b))} · align-items=${C?.srcWrapper?.align}`);
  const srcRows = flexRows(C?.src || []);
  const pureRows = srcRows.filter((r) => r.chips.every((c) => c.lines === 1));
  srcPureRowsAll += pureRows.length;
  srcPureByView.push(`${W.name}:${pureRows.length}/${srcRows.length}줄`);
  eq(`src-oneline-exact:${W.name}`,
     pureRows.flatMap((r) => r.chips).filter((c) => Math.abs(c.box.h - 34) > 0.5).map((c) => `${c.text}=${c.box.h}px`), [],
     `1줄 전용 flex 줄 ${pureRows.length}개 / 전체 ${srcRows.length}개 — 0이면 이 폭엔 정의역이 없다(전 폭 합산 sentinel이 게이트다)`);
  // 가로 padding 10→12px로 칩 안 가용폭이 4px 줄어 넘침 임계가 내려갔다(TechReport.jsx 주석)
  eq(`src-chip-nooverflow:${W.name}`, (C?.src || []).filter((c) => c.sw > c.cw + 1).map((c) => `${c.text}=${c.sw}>${c.cw}`), []);
  bump('src', 5);

  // ── 가로 넘침 — **선재 결함을 수입하지 않도록 baseline 인식형으로 잰다** ──────────
  // ⚠️ 처음엔 `over <= 0`으로 뒀는데 m278에서 **원리적으로 FAIL**한다: 이 slug의
  //    `tech-report-players` 표가 task#311 baseline에 이미 넘침으로 박제돼 있다
  //    (선재 3/7종 — `reusable-rocket` 306 · `ai-datacenter-ops` 298 · `semiconductor-equipment` 296,
  //    cw 278. 원인은 「선두 대비」 열이고 이 태스크와 무관하다).
  //    항상 FAIL하는 축은 exit 1을 영구화해 신호를 죽이므로, **이 변경이 깨뜨릴 수 있는 것**으로
  //    축을 좁힌다: ⓐ 넘침의 범인에 **칩 계열이 없다** ⓑ 넘침량이 baseline 이하.
  //    칩이 범인이 되면 ⓐ가, 표가 더 넘치면 ⓑ가 잡는다.
  const HSCROLL_BASE = { m278: { doc: 18, main: 17 }, m390: { doc: 0, main: 0 }, m768: { doc: 0, main: 0 }, pc1280: { doc: 0, main: 0 } };
  const HB = HSCROLL_BASE[W.name] || { doc: 0, main: 0 };
  const wideTxt = JSON.stringify(C?.wide || []);
  const CHIP_TIDS = ['tech-toc-chip', 'tech-report-toc', 'tech-report-sources'];
  eq(`chip-hscroll-culprit-not-chip:${W.name}`,
     (C?.wide || []).filter((w) => CHIP_TIDS.includes(w.tid)).map((w) => `${w.tid}=${w.over}px`), [],
     `범인 ${wideTxt}`);
  eq(`chip-hscroll-doc:${W.name}`, C ? C.docOver <= HB.doc : 'NO_READ', true,
     `scrollWidth-clientWidth=${C?.docOver} <= baseline ${HB.doc} · 넘친 요소 ${wideTxt}`);
  eq(`chip-hscroll-main:${W.name}`, C ? C.mainOver <= HB.main : 'NO_READ', true,
     `diff=${C?.mainOver} <= baseline ${HB.main}`);
  bump('chip-hscroll', 3);

  tocCountByView.push(`${W.name}:${C?.toc.length}칩/${tocRows.length}줄`);
  rawLog.push(`${W.name} 목차: 칩 ${C?.toc.length}개 · ${tocRows.length}줄 · 칩h ${JSON.stringify([...new Set((C?.toc || []).map((c) => c.box.h))])} · navH ${C?.nav?.box.h} · 스트립 bottom ${C?.strip?.b}/가용 ${C?.avail}`);
  rawLog.push(`${W.name} 출처: 칩 ${C?.src.length}개 · ${srcRows.length}줄(1줄전용 ${pureRows.length}) · 높이 ${JSON.stringify([...new Set((C?.src || []).map((c) => c.box.h))].sort((a, b) => a - b))} · 줄수 ${JSON.stringify([...new Set((C?.src || []).map((c) => c.lines))].sort())}`);

  // 캡처는 **재는 그 지점**에서 — 스크롤 0 측정 상태의 전면 캡처(목차·스트립) + 출처 근접 캡처
  await page.screenshot({ path: `${OUT}/${W.name}-report-chips.png`, fullPage: true });
  await page.evaluate(() => document.querySelector('[data-testid="tech-report-sources"]')?.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/${W.name}-report-sources.png` });

  // ── 처방-무효화 대조군 — 라이브를 되돌리지 않고 칩만 옛 값으로 되돌린다(⑧ⓚ②) ──
  // 목적 셋: ① 칩 높이 축이 상수를 재고 있지 않음(이빨) ② 옛 실측 27px 재현으로 대조군 자체 검증
  // ③ **스트립 bottom이 바이트 동일**함을 직접 증명한다(= 칩 성장이 스트립을 밀지 않았다는 증거로,
  //    baseline 리터럴에 의존하지 않는다). `!important`가 필요하다 — 인라인 스타일을 이겨야 한다.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.addStyleTag({ content: '[data-testid="tech-toc-chip"],[data-testid="tech-report-sources"] a{padding:4px 10px !important;line-height:1.5 !important}' });
  await page.waitForTimeout(300);
  const C2 = await page.evaluate((d) => window.__readChips(d), TARGET.published_date);
  const c2h = [...new Set((C2?.toc || []).map((c) => c.box.h))];
  eq(`chipctrl-applied:${W.name}`, (C2?.toc || []).length > 0 && c2h.every((h) => h < 33.5), true,
     `대조군 목차 칩 높이 ${JSON.stringify(c2h)} — 옛 실측 27px를 재현하면 대조군 자체가 검증된다`);
  eq(`chipctrl-nav-shrank:${W.name}`, (C2?.nav && C?.nav) ? C2.nav.box.h < C.nav.box.h : 'MISSING', true,
     `navH ${C?.nav?.box.h} → ${C2?.nav?.box.h}`);
  eq(`chipctrl-strip-same:${W.name}`, (C2?.strip && C?.strip) ? Math.abs(C2.strip.b - C.strip.b) <= 0.5 : 'MISSING', true,
     `stripBottom ${C?.strip?.b} → ${C2?.strip?.b} (목차는 스트립 *아래*라 칩 높이가 스트립을 밀지 못한다)`);
  bump('chipctrl', 3);
  rawLog.push(`${W.name} 칩 대조군: 목차 칩 ${JSON.stringify([...new Set((C?.toc || []).map((c) => c.box.h))])} → ${JSON.stringify(c2h)} · navH ${C?.nav?.box.h} → ${C2?.nav?.box.h} · 스트립 bottom ${C?.strip?.b} → ${C2?.strip?.b}`);
  await page.screenshot({ path: `${OUT}/${W.name}-report-chipctrl.png` });
  await ctx.close();
}

// 전 폭 합산 sentinel — 「1줄 칩만 있는 flex 줄」을 한 번도 못 밟았으면 `src-oneline-exact`는
// 전 폭에서 빈 배열끼리 비교돼 **공허하게 통과**한다(⑧ⓐ). 정의역 부재를 FAIL로 만든다.
eq('src-oneline-global-domain', srcPureRowsAll > 0 ? 'OK' : `NO_ONELINE_SOURCE_ROW(${srcPureRowsAll})`, 'OK',
   `폭별 1줄전용 줄 수 ${srcPureByView.join(' · ')}`);
// 목차 칩 수는 폭과 무관해야 한다 — 폭에 따라 달라지면 렌더가 무음으로 칩을 빠뜨린 것이다
eq('toc-count-consistent', [...new Set(tocCountByView.map((s) => s.split(':')[1].split('칩')[0]))].length, 1,
   `폭별 ${tocCountByView.join(' · ')}`);
bump('chip-global', 2);

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
console.log('\n※ 육안 캡처 — 이 실행이 남긴 전수(각 축을 재는 그 지점에서 찍었다):');
// 캡처는 각 축을 **재는 그 지점**에서 찍는다 — 그러면 시점과 대상이 동시에 맞는다(스킬 규율 1).
for (const f of fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).sort()) console.log(`  ${OUT}/${f}`);
console.log('═'.repeat(78));
fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ cov, results, target: TARGET.slug, control: `injected:${TARGET.slug}`,
  withAnatomy: WITH.map((r) => r.slug), minFloor: MIN_WITH_ANATOMY, API_COUNTS,
  crossTargets: CROSS_LIST.map((e) => ({ slug: e.r.slug, markers: e.x.markers.length, badges: e.x.badges.length,
    measurable: e.x.measurable, unmatched: e.x.unmatched, holdN: e.x.holdN, watchN: e.x.watchN })),
  trackedN: TRACKED_N, mineralLiveOverlap: MIN_LIVE.length,
  mineralInjected: MINJ ? MINJ.ticker : null,
  chipTarget: TARGET.slug, chipViews: CHIP_VIEWS.map((w) => w.name),
  tocByView: tocCountByView, srcPureRowsByView: srcPureByView, srcUrlN: SRC_URL_N, srcNoUrlN: SRC_NOURL_N },
  null, 2));
if (fails.length) {
  console.log('\nFAIL 상세:');
  for (const f of fails) console.log(`  ✗ ${f.tag}\n      ${f.msg}`);
  process.exit(1);
}
console.log(`\nALL PASS ${results.length}/${results.length}`);
