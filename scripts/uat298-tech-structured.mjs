// task#298 S6 라이브 UAT — 주요기술 리포트 상세의 「계열 비교」(VariantTable) + 「확인할 지표」
// (WatchItems) 두 섹션을 잰다. **task#331 B79에서 계기 복구**(아래 「실측 갱신」 절).
//
// 쓰기 0 — GET + page.route 응답 가로채기뿐이다(POST 0, prod tech_reports 무접촉). 그래서 배포 전·후
// 어느 시점에 돌려도 안전하다.
//
// ── 실측 갱신(2026-08-22, task#331 B79 — GET만, 무쓰기) ────────────────────────────────────────
//   ⚠️ 옛 real-모드 축 3개(absent-variants·absent-watch-items·absent-toc-chips)는 「실발행물엔
//   variants·watch_items가 NULL이다」를 **하드 전제**로 ABSENT를 단언했다. 그 서술은 작성 시점
//   (2026-08-12, 발행 4종)엔 참이었으나 그 뒤 루틴이 두 필드를 채워 **거짓이 됐다** — 라이브 census
//   (2026-08-22, 목록 GET + slug 15개 개별 GET 대조): 발행 **15종 전부** `variants` 채워짐(축 1개 판
//   6종 · 2개 판 9종) · `watch_items` **15/15 전부 정확히 5건**(항목 키 label·detail·not_signal).
//   그래서 그 3축이 상시 거짓 FAIL 24건(4뷰 × 2 slug × 3축)을 냈고, 더 나쁘게는 블록 끝의 `continue`가
//   **상세 렌더 검증 블록을 real 모드에서 영원히 도달 불가**로 만들었다(총계 284 중 real 몫 9/run뿐).
//   → 3축을 「NULL이어야 한다」가 아니라 **「렌더가 그 발행물의 *실제* 데이터와 일치한다」(양방향)**로
//   재작성하고 `continue`를 제거했다.
//
//   ⭐ 게이트가 **모드가 아니라 런타임 데이터**인 이유: 데이터가 어느 방향으로 진화해도 축이 따라간다.
//   비면 want=ABSENT가 되어 「섹션이 안 뜬다」를, 채워지면 같은 축이 「뜬다 + 내용이 일치한다」를
//   단언한다. 옛 판이 스테일해진 원인은 코드가 아니라 **주석에 적힌 정당화**였다 — 「실행 전에 결정되는
//   정의역이니 조건부 스킵이 아니다」가 *데이터 상태에 대한 주장*에 기대고 있었고 그 주장이 썩었다.
//   주석이 코드 경로를 가두면 그 주석은 **테스트 없는 코드**다. 낡은 근거는 지웠고 이 근거를 남긴다.
//
//   구현 확인(소스 직독, 2026-08-22 — 옛 주석의 「가정」이 아니다):
//     · `components/tech/WatchItems.jsx` **존재**. testid `tech-report-watch-items` / `-watch-item` /
//       `-watch-item-label` / `-watch-item-not-signal-badge`(고정 문구 「신호 아님」, `whiteSpace:nowrap`,
//       `color: var(--warn)`) / `-watch-item-not-signal-text` — 아래 셀렉터와 일치.
//     · `watchItemsLayout`·`variantTableLayout`은 아래 미러 2종과 같은 판정을 한다(직독 대조).
//     · `TechReport.jsx` SECTIONS 실측 순서: key-points ① · **variants ②** · related ③ ·
//       **market ④**(show:true 고정) · players ⑤ · share ⑥ · milestones ⑦ ·
//       **challenges ⑧** · **watch-items ⑨** · prose ⑩ · sources ⑪.
//   콘텐츠 폭(실측): PC 1440 748px · m390 318px · m350 278px.
//   VariantTable.jsx 소스 직독(테이블 규율 계승): NAME_TEXT/EXAMPLES_TEXT/FEATURE_LINE 전부
//   `overflowWrap:'anywhere'`(`break-word` 아님, task#296 정정 준수) · minWidth/overflowX/nowrap 선언 0.
//
// ── 판정 규율(TESTING.md §7.3) ──────────────────────────────────────────────────────────────────
//  · 조건부 단언 금지 — 무조건 단언 + sentinel FAIL로 총계를 구조적으로 고정.
//  · **정의역 분기는 데이터에서 유도한 값만 쓴다**(`wantLay.axes.length` 등). 모드로 축을 가르지
//    않는다 — 그것이 B79의 결함이었다. 모드가 정하는 것은 *기대값의 출처*(`SRC`)뿐이다.
//  · 양방향 축의 두 방향 표본 수를 커버리지에 남긴다 — 한 방향이 0이면 「통과」가 아니라 「미검증」이다.
//  · 축마다 `*-domain` sentinel, 리터럴 금지(기대값은 VariantTable.jsx를 그대로 미러링한 순수함수로
//    유도), 판정 범위는 본문 컨테이너로 한정, identity를 판정축보다 먼저.
//  · 진짜 줄 수 = 세로로 겹치지 않는 rect 묶음(task#293 measureLeaf 관용구 — top 동일성이 아니다).
//
// ── 대조군(기본 꺼짐, 이빨 실증 — 게이트 아님) ────────────────────────────────────────────────────
//   CONTROL=nowrap    : 계열 표 셀에 white-space:nowrap !important → page-h-scroll·
//                        variant-table-no-scroller가 FAIL해야 정상.
//   CONTROL=flatcolor : 신호아님 배지 색을 var(--text)로 강제 → not-signal-color가 FAIL해야 정상.
//                        (WatchItems.jsx가 구현·배포돼 있으므로 이 대조군은 이제 실제로 이빨을 낸다.)
//   ※ 상시 대조군은 CONTROL이 아니라 **empty 모드**다 — 두 필드를 null로 주입해 「데이터가 없으면
//     섹션이 안 뜬다」 방향에 표본을 만든다(라이브 15종이 전부 채워져 있어 실데이터로는 불가).
//
// ── 이빨 실측(task#331 S5, FAST 1뷰 × 2 slug × 3모드 = 단언 139건 baseline) ──────────────────────
//   주입은 전부 **프로브 사본**에서 했고(원본 무변경) 프로덕션 코드는 건드리지 않았다. testid 개명은
//   「셀렉터가 깨진 상태」와 동형이라 셀렉터 주입 대용으로 썼다. 죽은 축 = 그 주입이 잡은 축:
//     축 제거(DOM)            → variant-axis-count 4 · variant-row-fidelity 4
//     계열명 텍스트 교체       → variant-row-fidelity 4
//     축 div overflowX:auto   → variant-table-no-scroller-ancestor 4
//     표를 block+120px+nowrap → variant-table-no-scroller-self 4 · variant-container-clip 4
//     leaf testid 개명         → variant-leaf-domain 4 · variant-row-fidelity 4
//     계열명 nowrap+32px       → variant-leaf-clip 4 · variant-container-clip 4
//     축 div hidden + 셀 420px → variant-container-clip 4
//     축 랩 gap:0              → variant-spacing 3(정의역 = 축 ≥2인 판 3개와 정확히 일치)
//     항목 1개 제거            → watch-item-count 4
//     배지 testid 개명          → watch-notsignal-domain 4
//     --warn := var(--text)    → watch-warn-token-teeth 4 · not-signal-color 4
//     배지 색 var(--text)       → not-signal-color 4
//     배지 normal+18px          → not-signal-badge-1line 4
//     칩이 가리키는 id 복제     → toc-href-unique 4
//     섹션 순서 역전            → section-order-{variants-before-market, market-before-watchitems,
//                                watchitems-after-challenges} 각 4
//     #categories 부활          → section-categories-removed 6
//     라우트 미등록/역등록      → route-injected 4 / 2 (양방향)
//     컨테이너 testid 뒤집기    → variants-render 6 · watch-items-render 6 (PRESENT 4 + ABSENT 2)
//     목차 칩 뒤집기            → toc-new-chips 6 (제거 4 + 가짜 추가 2)
//   ⚠️ **첫 시도가 0 FAIL이었던 축이 하나 있다** — `toc-href-unique`. **첫** 섹션(key-points) id를
//     복제했는데 이 축의 정의역은 「새 칩 2개가 가리키는 id」뿐이라 주입이 대상에 닿지 않았다.
//     0 FAIL을 「무이빨」로 읽지 말고 **주입이 임계·정의역에 도달했는지** 먼저 볼 것(스킬 ⓥ).
//     부수 사실: 이 축은 문서 **다른 곳**의 중복 id는 잡지 않는다(판정 범위를 좁힌 대가, 의도됨).
import { chromium, devices } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat298';
fs.mkdirSync(OUT, { recursive: true });

console.log('※ 3모드 — real(실데이터 GET) · inject(픽스처 주입) · empty(두 필드를 null로 주입한 대조군).');
console.log('※ 쓰기 0 — GET + page.route 응답 가로채기뿐이다(실발행 아님, prod tech_reports 무접촉).');

const results = [];
const P = (ok, tag, msg) => results.push({ ok, tag, msg });
const cov = {};
const bump = (k, n = 1) => { cov[k] = (cov[k] || 0) + n; };
const eq = (tag, got, want, note = '') => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  P(ok, tag, `${ok ? 'PASS' : 'FAIL'} — got=${JSON.stringify(got)} want=${JSON.stringify(want)}${note ? ' · ' + note : ''}`);
};
const NOTE = (msg) => console.log(`  ℹ ${msg}`);
const rawLog = [];
const shotLog = [];

// ── 대조군 ────────────────────────────────────────────────────────────────────
const CONTROL = process.env.CONTROL || '';
const CONTROL_CSS = {
  nowrap: '[data-testid="tech-report-variant-table"] td, [data-testid="tech-report-variant-table"] th{white-space:nowrap !important}',
  flatcolor: '[data-testid="tech-report-watch-item-not-signal-badge"]{color:var(--text) !important}',
};
if (CONTROL && !CONTROL_CSS[CONTROL]) { console.error(`CONTROL=${CONTROL} 미지원(nowrap|flatcolor). 종료.`); process.exit(1); }
if (CONTROL) console.log(`⚠ 대조군 실행 — CONTROL=${CONTROL}: 해당 축이 FAIL해야 정상(게이트 결과 아님).`);

// ── 로그인(추정 폴백 없음) ────────────────────────────────────────────────────
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const { access_token, refresh_token } = await login.json();
if (!access_token) { console.error('로그인 실패 — access_token 없음. 종료.'); process.exit(1); }

const TECH_NAMES = { 'reusable-rocket': '재사용 로켓', 'solid-state-battery': '전고체 배터리', smr: 'SMR', robotics: '로봇' };
// 픽스처가 축 1개(smr)·2개(robotics)로 갈린다. 라이브는 2026-08-22 census에서 **둘 다 2축**이므로
// 기대값을 여기 리터럴로 적지 않고 런타임에 유도한다(census 값이 또 변해도 축이 따라간다).
const SLUGS = ['smr', 'robotics'];

// ── 미러 1: VariantTable.jsx 소스 직독 그대로(리터럴 금지 — 기대값을 이 순수함수로 유도) ──────────
function buildRow(o) {
  const name = typeof o?.name === 'string' && o.name.trim() !== '' ? o.name : null;
  if (!name) return null;
  const examples = Array.isArray(o?.examples) ? o.examples.filter((e) => typeof e === 'string' && e.trim() !== '') : [];
  const examplesText = examples.length > 0 ? examples.join(' · ') : null;
  const strength = typeof o?.strength === 'string' && o.strength.trim() !== '' ? o.strength : null;
  const tradeoff = typeof o?.tradeoff === 'string' && o.tradeoff.trim() !== '' ? o.tradeoff : null;
  return { name, examplesText, strength, tradeoff };
}
function buildAxis(v) {
  const axisLabel = typeof v?.axis_label === 'string' && v.axis_label.trim() !== '' ? v.axis_label : null;
  if (!axisLabel) return null;
  const options = Array.isArray(v?.options) ? v.options : [];
  const rows = options.map(buildRow).filter(Boolean);
  if (rows.length < 2) return null;
  return { axisLabel, rows };
}
function variantTableLayoutMirror(variants) {
  const list = Array.isArray(variants) ? variants : [];
  return { axes: list.map(buildAxis).filter(Boolean) };
}
const DASH = '—';

// ── 미러 2: WatchItems — 구현이 없어 plan.md S1 스펙을 그대로 미러링(추정이 아니라 계획서 인용) ───
function buildWatchItem(o) {
  const label = typeof o?.label === 'string' && o.label.trim() !== '' ? o.label : null;
  if (!label) return null;
  const detail = typeof o?.detail === 'string' && o.detail.trim() !== '' ? o.detail : null;
  const notSignal = typeof o?.not_signal === 'string' && o.not_signal.trim() !== '' ? o.not_signal : null;
  return { label, detail, notSignal };
}
function watchItemsLayoutMirror(watchItems) {
  const list = Array.isArray(watchItems) ? watchItems : [];
  return { items: list.map(buildWatchItem).filter(Boolean) };
}

// ── 실응답 수집(GET만) + variants/watch_items NULL 사실 재확인 ──────────────────────────────────
const DATA = {};
for (const slug of SLUGS) {
  const res = await fetch(`${BASE}/api/tech-reports/${slug}`, { headers: { Authorization: `Bearer ${access_token}` } });
  const body = await res.json();
  const rep = (body.reports || [])[0];
  if (!rep) { console.error(`발행물 없음 — /api/tech-reports/${slug} reports[0] 부재. 종료.`); process.exit(1); }
  if (!TECH_NAMES[slug]) { console.error(`TECH_NAMES 미러에 ${slug} 없음. 종료.`); process.exit(1); }
  if (!rep.title) { console.error(`${slug}: title 부재 — identity 기대값 소스 없음. 종료.`); process.exit(1); }
  DATA[slug] = { rep, techName: TECH_NAMES[slug], title: rep.title, challenges: (rep.challenges || []).length };
  const lv = variantTableLayoutMirror(rep.variants);
  const lw = watchItemsLayoutMirror(rep.watch_items);
  const cnt = (v) => (Array.isArray(v) ? `${v.length}건` : String(v));
  console.log(`  [실응답] ${slug}: title ${rep.title.length}자 · variants ${cnt(rep.variants)} → 유효 축 ${lv.axes.length}개(행 ${lv.axes.map((a) => a.rows.length).join(',') || '-'}) · watch_items ${cnt(rep.watch_items)} → 유효 ${lw.items.length}건(신호아님 ${lw.items.filter((i) => i.notSignal).length}건) · challenges ${DATA[slug].challenges}건`);
}

// ── 라이브 정의역 census — 아래 전역 sentinel 2쌍의 **기대값 소스**(리터럴 금지) ──────────────────
// task#331 S5 실측으로 이 census가 필요해졌다. 주입 2종을 돌려 보니 이 프로브에는 두 개의 무음 구멍이
// 있었다(둘 다 **FAIL 0 · exit 0**으로 지나갔고 총계만 조용히 줄었다):
//   ⓐ 게이트 드리프트 — real 모드에서 세부 축 블록을 건너뛰게 만들자(B79의 `continue`와 동형)
//      총계 135 → 109, FAIL 0. 즉 이 파일이 방금 고쳐진 그 결함이 **재발해도 아무 신호가 없다.**
//   ⓑ 라이브 소실 — 응답과 기대값에서 두 필드를 동시에 비우자(루틴 upsert의 키 생략 = 삭제)
//      총계 135 → 103, 진짜 FAIL 0. 양방향 축이 want=ABSENT로 따라가 **전부 옳게 통과**한다.
// 두 구멍은 **다른 sentinel**을 요구한다: ⓐ는 census 대조(실행 판수), ⓑ는 **하한**이다.
// ⓑ에 census 대조를 쓰면 기대값이 0으로 degenerate해 관측 0과 일치한다(스킬 ⓨ의 그 형태다).
const LIVE_VAR_SLUGS = SLUGS.filter((s) => variantTableLayoutMirror(DATA[s].rep.variants).axes.length > 0);
const LIVE_WATCH_SLUGS = SLUGS.filter((s) => watchItemsLayoutMirror(DATA[s].rep.watch_items).items.length > 0);
console.log(`  [라이브 정의역] variants 유효 ${LIVE_VAR_SLUGS.length}/${SLUGS.length} slug ${JSON.stringify(LIVE_VAR_SLUGS)}` +
  ` · watch_items 유효 ${LIVE_WATCH_SLUGS.length}/${SLUGS.length} slug ${JSON.stringify(LIVE_WATCH_SLUGS)}` +
  ` → real 모드 세부 축 실행 기대 ${LIVE_VAR_SLUGS.length}·${LIVE_WATCH_SLUGS.length} × 뷰수`);

// ── 주입 픽스처(자립 — 라이브에서 상속하지 않는다) ────────────────────────────────────────────────
// smr = 축 1개(4옵션: 둘다있음·strength만·tradeoff만·둘다없음 — 「한쪽만 있는 행」 축의 표본).
const VARIANTS_SMR = [{
  axis_label: '냉각재 방식',
  options: [
    { name: '소듐냉각고속로', examples: ['한국형 SFR-PGSFR', '러시아 BN-800'],
      strength: '열전달 효율이 높아 노심을 소형화하는 데 유리하다', tradeoff: '소듐이 물·공기와 반응하면 화재 위험이 있다' },
    { name: '용융염냉각로', examples: ['테라파워 MCFR'], strength: '상압 운전이 가능해 압력용기 부담이 작다' },
    { name: '헬륨냉각 고온가스로', tradeoff: '열전달 계수가 낮아 대형 열교환기가 필요하다' },
    { name: '경수냉각 소형모듈로' },
  ],
}];
// robotics = 축 2개(계약: "축 수가 갈리는 두 판을 반드시 함께 잰다") — 간격 축의 표본.
const VARIANTS_ROBOTICS = [
  {
    axis_label: '구동 방식',
    options: [
      { name: '전동 액추에이터', examples: ['보스턴다이내믹스 Atlas'], strength: '정밀 제어가 쉽고 유지보수가 단순하다', tradeoff: '동력밀도가 유압 대비 낮다' },
      { name: '유압 액추에이터', strength: '순간 출력이 높아 고하중 작업에 유리하다', tradeoff: '누유·소음 관리 비용이 크다' },
      { name: '공압 액추에이터', tradeoff: '위치 제어 정밀도가 낮다' },
    ],
  },
  {
    axis_label: '자율성 수준',
    options: [
      { name: '원격 조작형', strength: '검증된 방식이라 즉시 현장 투입이 가능하다' },
      { name: '반자율 협업형', examples: ['LG 클로이'], strength: '단순 반복작업을 자동화해 인력 부담을 줄인다', tradeoff: '예외 상황 대응은 여전히 사람이 개입해야 한다' },
      { name: '완전자율형', tradeoff: '안전 인증·책임 소재 기준이 아직 미성숙하다' },
    ],
  },
];
const WATCH_ITEMS_SMR = [
  { label: '착공 신고 접수 여부', detail: '지자체 착공신고가 실제로 접수돼야 공정이 개시된 것으로 본다', not_signal: '설계 변경 논의 자체는 착공 지연의 신호가 아니다' },
  { label: '1차 안전성 심사 통과', detail: '규제기관 심사 통과 시점이 상용화 일정의 실질 지표다' },
  { label: '연료 공급 계약 체결', not_signal: '양해각서(MOU) 체결은 계약 체결과 다르다 — 구속력이 없다' },
  { label: '노형 인허가 신청 접수' },
];
const WATCH_ITEMS_ROBOTICS = [
  { label: '양산 라인 가동률', detail: '시제품이 아니라 실제 양산 라인의 가동률이 핵심이다', not_signal: '데모 영상 조회수는 양산 여부와 무관하다' },
  { label: '고객사 재구매 여부', detail: '초기 파일럿 이후 재주문이 있는지가 실질 수요 신호다' },
  { label: '핵심 부품 국산화율', not_signal: '보도자료의 "국산화 추진" 발표는 실제 국산화와 다르다' },
  { label: '누적 가동 시간(MTBF)' },
  { label: '안전사고 신고 건수', detail: '산업안전공단 신고 기준으로 집계한다' },
];
const FIXTURES = { smr: { variants: VARIANTS_SMR, watchItems: WATCH_ITEMS_SMR }, robotics: { variants: VARIANTS_ROBOTICS, watchItems: WATCH_ITEMS_ROBOTICS } };
for (const slug of SLUGS) {
  const lay = variantTableLayoutMirror(FIXTURES[slug].variants);
  const wLay = watchItemsLayoutMirror(FIXTURES[slug].watchItems);
  console.log(`  [주입 픽스처] ${slug}: 축 ${lay.axes.length}개(행 ${lay.axes.map((a) => a.rows.length).join(',')}) · 확인할 지표 ${wLay.items.length}건(신호아님 ${wLay.items.filter((i) => i.notSignal).length}건)`);
}
// inject = 픽스처 주입 · empty = 두 필드만 null로 덮은 대조군(그 외 필드는 실응답 그대로 — 대상
// 동일성이 보장되므로 「데이터가 원래 없어서」와 「화면이 빈 상태를 옳게 그린다」가 구별된다).
const injectedRep = (mode, slug) => (mode === 'inject'
  ? { ...DATA[slug].rep, variants: FIXTURES[slug].variants, watch_items: FIXTURES[slug].watchItems }
  : { ...DATA[slug].rep, variants: null, watch_items: null });

// ── 브라우저 안 측정기 ────────────────────────────────────────────────────────
const ROOT_SEL = 'main.page-wrap .page, main.page-wrap .m-page';

const measure = (page) => page.evaluate((ROOT_SEL) => {
  const root = document.querySelector(ROOT_SEL);
  if (!root) return { found: false, why: 'ROOT_MISSING' };
  const leadEl = root.querySelector('[data-testid="tech-report-lead"]');
  const h1 = root.querySelector('h1');
  if (!leadEl && !h1) return { found: false, why: 'HEADER_MISSING' };

  const txt = (el) => (el ? el.textContent.trim() : '');
  const cs = (el) => getComputedStyle(el);

  // 진짜 줄 수 = 세로로 겹치지 않는 rect 묶음(task#293 measureLeaf 관용구 — top 동일성 아님).
  const measureLeaf = (el) => {
    const scrollW = el.scrollWidth, clientW = el.clientWidth;
    const range = document.createRange(); range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    const groups = [];
    for (const r of [...rects].sort((a, b) => a.top - b.top)) {
      const g = groups.find((g) => {
        const ov = Math.min(g.bottom, r.bottom) - Math.max(g.top, r.top);
        return ov > 0.3 * Math.min(g.bottom - g.top, r.bottom - r.top);
      });
      if (g) { g.top = Math.min(g.top, r.top); g.bottom = Math.max(g.bottom, r.bottom); }
      else groups.push({ top: r.top, bottom: r.bottom });
    }
    return { text: txt(el), scrollW, clientW, clipped: scrollW > clientW + 1, lines: groups.length || 1 };
  };
  const titleTextOf = (el) => { const t = el.querySelector('.rpt-title__text'); return t ? t.textContent.trim() : null; };
  // 임시 노드에 CSS 변수를 실어 rgb 정규화(하드코딩 금지, §7.3③).
  const tokenColor = (name) => {
    const p = document.createElement('span'); p.style.color = `var(${name})`;
    document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c;
  };

  // ── 목차 ──
  const tocEl = root.querySelector('[data-testid="tech-report-toc"]');
  const chips = tocEl ? [...tocEl.querySelectorAll('[data-testid="tech-toc-chip"]')].map((a) => ({ label: txt(a), href: a.getAttribute('href') })) : [];
  const sectionEls = [...root.querySelectorAll('[data-tech-section]')];
  const sectionInfo = sectionEls.map((el) => ({ id: el.id, titleText: titleTextOf(el) }));

  // ── 계열 비교(variants) ──
  const variantsRoot = root.querySelector('[data-testid="tech-report-variants"]');
  const axisEls = variantsRoot ? [...variantsRoot.querySelectorAll('[data-testid="tech-report-variant-axis"]')] : [];
  const axisMetrics = axisEls.map((ax) => {
    const labelEl = ax.querySelector(':scope > div');
    const tableEl = ax.querySelector('[data-testid="tech-report-variant-table"]');
    const axRect = ax.getBoundingClientRect();
    const labelRect = labelEl ? labelEl.getBoundingClientRect() : null;
    const tableRect = tableEl ? tableEl.getBoundingClientRect() : null;
    const rows = [...ax.querySelectorAll('[data-testid="tech-report-variant-row"]')].map((tr) => {
      const nameEl = tr.querySelector('[data-testid="tech-report-variant-name"]');
      const exEl = tr.querySelector('[data-testid="tech-report-variant-examples"]');
      const featEl = tr.querySelector('[data-testid="tech-report-variant-feature"]');
      return {
        name: nameEl ? txt(nameEl) : null,
        nameLeaf: nameEl ? measureLeaf(nameEl) : null,
        exLeaf: exEl ? measureLeaf(exEl) : null,
        featChildren: featEl ? featEl.children.length : null,
        featText: featEl ? txt(featEl) : null,
        featLeaf: featEl ? measureLeaf(featEl) : null,
      };
    });
    return {
      top: axRect.top, bottom: axRect.bottom,
      labelBottom: labelRect ? labelRect.bottom : null, tableTop: tableRect ? tableRect.top : null,
      tableScrollW: tableEl ? tableEl.scrollWidth : null, tableClientW: tableEl ? tableEl.clientWidth : null,
      scrollAncestors: (() => {
        const out = [];
        for (let p = tableEl && tableEl.parentElement; p && p !== document.body; p = p.parentElement) {
          const ox = cs(p).overflowX;
          if (ox === 'auto' || ox === 'scroll') out.push(p.tagName.toLowerCase());
        }
        return out;
      })(),
      rows,
    };
  });
  const variantsHiddenClippers = variantsRoot ? [...variantsRoot.querySelectorAll('*')]
    .filter((e) => cs(e).overflowX === 'hidden' && txt(e).length > 0)
    .map((e) => ({ scrollW: e.scrollWidth, clientW: e.clientWidth })) : [];

  // ── 확인할 지표(watch-items) — 셀렉터는 WatchItems.jsx 직독으로 확인한 실제 testid다(헤더 주석).
  const watchRoot = root.querySelector('[data-testid="tech-report-watch-items"]');
  const watchItemEls = watchRoot ? [...watchRoot.querySelectorAll('[data-testid="tech-report-watch-item"]')] : [];
  const watchItems = watchItemEls.map((it) => {
    const labelEl = it.querySelector('[data-testid="tech-report-watch-item-label"]');
    const badgeEl = it.querySelector('[data-testid="tech-report-watch-item-not-signal-badge"]');
    const nsTextEl = it.querySelector('[data-testid="tech-report-watch-item-not-signal-text"]');
    return {
      label: labelEl ? txt(labelEl) : null,
      hasBadge: !!badgeEl,
      badgeLeaf: badgeEl ? measureLeaf(badgeEl) : null,
      badgeColor: badgeEl ? cs(badgeEl).color : null,
      hasNsText: !!nsTextEl,
      nsTextLeaf: nsTextEl ? measureLeaf(nsTextEl) : null,
    };
  });

  const warnColor = tokenColor('--warn');
  const textColor = tokenColor('--text');
  const text2Color = tokenColor('--text-2');

  const rr = root.getBoundingClientRect();
  return {
    found: true, h1Text: h1 ? txt(h1) : null, leadText: leadEl ? txt(leadEl) : null,
    tocFound: !!tocEl, chips, sectionInfo,
    variantsFound: !!variantsRoot, axisCount: axisEls.length, axisMetrics,
    variantsHiddenClippers,
    watchFound: !!watchRoot, watchItemCount: watchItemEls.length, watchItems,
    warnColor, textColor, text2Color,
    docScrollW: document.documentElement.scrollWidth, docClientW: document.documentElement.clientWidth,
    vw: window.innerWidth,
  };
}, ROOT_SEL);

// ── 실행 ──────────────────────────────────────────────────────────────────────
const VIEWS = [
  { key: 'pc1440-light', theme: 'light', opts: { viewport: { width: 1440, height: 1000 } } },
  { key: 'pc1440-dark', theme: 'dark', opts: { viewport: { width: 1440, height: 1000 } } },
  { key: 'm390-light', theme: 'light', opts: { ...devices['iPhone 13'] } },
  { key: 'm350-dark', theme: 'dark', opts: { viewport: { width: 350, height: 700 } } },
];

const browser = await chromium.launch();

for (const V of VIEWS) {
  // SW가 /api/*를 가로챈다 — serviceWorkers:'block' 필수(안 하면 page.route 주입이 무음 no-op).
  const ctx = await browser.newContext({ ...V.opts, serviceWorkers: 'block' });
  await ctx.addInitScript(([a, r, th]) => {
    localStorage.setItem('access_token', a);
    localStorage.setItem('refresh_token', r);
    localStorage.setItem('theme', th);
    localStorage.setItem('pwa-install-dismissed-at', String(Date.now()));
  }, [access_token, refresh_token, V.theme]);

  // 3모드 — real(실데이터) · inject(픽스처) · empty(두 필드 null 주입 대조군).
  // empty가 없으면 양방향 축의 ABSENT 방향이 표본 0이 되어 「통과」가 아니라 「미검증」이 된다
  // (라이브 15종 전부 두 필드가 채워져 있어 실데이터로는 그 방향을 만들 수 없다 — 주입으로 합성한다).
  const RUNS = SLUGS.flatMap((slug) => [{ mode: 'real', slug }, { mode: 'inject', slug }, { mode: 'empty', slug }]);

  for (const R of RUNS) {
    const tag = `${V.key}/${R.mode}:${R.slug}`;
    const D = DATA[R.slug];
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errs.push(msg.text()); });
    page.on('pageerror', (e) => errs.push(String(e)));

    try {
      let injectedCount = 0;
      if (R.mode !== 'real') {
        await page.route(`**/api/tech-reports/${R.slug}`, async (route) => {
          injectedCount += 1;
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ slug: R.slug, reports: [injectedRep(R.mode, R.slug)] }) });
        });
      }

      await page.goto(`${BASE}/tech-report/${R.slug}`, { waitUntil: 'networkidle' }).catch((e) => errs.push(`goto:${e}`));
      await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0).catch(() => {});
      await page.waitForTimeout(1200);
      if (CONTROL) { await page.addStyleTag({ content: CONTROL_CSS[CONTROL] }); await page.waitForTimeout(300); }

      let m = await measure(page);
      if (!m.found) {
        console.log(`  (재시도) ${tag} — 본문 미검출(${m.why}), 1.8s 대기 후 재측정`);
        await page.waitForTimeout(1800);
        m = await measure(page);
      }
      eq(`page:${tag}`, m.found ? 'PRESENT' : `PAGE_MISSING(${m.why})`, 'PRESENT');
      bump('page');
      if (!m.found) {
        eq(`console:${tag}`, errs, [], '측정 불가 화면');
        bump('console');
        await page.screenshot({ path: `${OUT}/${V.key}-${R.slug}-${R.mode}-fail.png`, fullPage: false });
        await page.close();
        continue;
      }

      // ── (1) identity — 판정축보다 먼저 ──
      eq(`identity-h1:${tag}`, m.h1Text ?? 'H1_MISSING', D.techName, '기술명(TECH_NAMES 미러)');
      eq(`identity-lead:${tag}`, m.leadText ?? 'LEAD_MISSING', D.title, `리드 = API title(${D.title.length}자)`);
      eq(`identity-differ:${tag}`, new Set([D.techName, D.title]).size, 2, '이빨 — 기술명 ≠ 제목');
      bump('identity', 3);

      // ── 회귀방지축 — 문서 자체는 가로로 안 밀려야 한다(mode·control 무관하게 항상) ──
      eq(`page-h-scroll:${tag}`, m.docScrollW <= m.docClientW + 1 ? 'OK' : `HSCROLL(${m.docScrollW}>${m.docClientW})`, 'OK',
        `doc scrollW=${m.docScrollW}/clientW=${m.docClientW} · vw=${m.vw}`);
      bump('page-h-scroll');

      // ══ 기대값의 출처 — 모드가 아니라 **런타임 데이터**다 ══════════════════════════════════════
      // 옛 판은 여기서 `if (R.mode === 'real')`로 갈라 「두 필드가 NULL이어야 한다」를 단언하고
      // `continue`했다. 그 전제가 거짓이 되자 3축이 상시 거짓 FAIL이 되고 아래 상세 렌더 검증이
      // real 모드에서 영원히 도달 불가가 됐다(헤더 「실측 갱신」 절). 데이터에서 기대값을 유도하면
      // **데이터가 어느 방향으로 진화해도 축이 따라간다** — 그래서 같은 방식으로 다시 스테일해지지
      // 않는다. 모드는 *어느 데이터를 보는가*만 정하고, 판정은 그 데이터가 정한다.
      const SRC = R.mode === 'real'
        ? { variants: D.rep.variants, watchItems: D.rep.watch_items, src: 'live' }
        : R.mode === 'inject'
          ? { variants: FIXTURES[R.slug].variants, watchItems: FIXTURES[R.slug].watchItems, src: 'fixture' }
          : { variants: null, watchItems: null, src: 'fixture-null(대조군)' };
      const wantLay = variantTableLayoutMirror(SRC.variants);
      const wantWatchLay = watchItemsLayoutMirror(SRC.watchItems);
      const srcLen = (v) => (Array.isArray(v) ? `${v.length}건` : String(v));
      // 정의역 표본 카운터 — 두 방향의 표본 수를 커버리지에 남긴다(한 방향이 0이면 미검증이다).
      bump(wantLay.axes.length > 0 ? 'domain:variants-present' : 'domain:variants-absent');
      bump(wantWatchLay.items.length > 0 ? 'domain:watch-present' : 'domain:watch-absent');

      // 주입이 실제로 걸렸는가 — 양방향(real은 0건이어야 하고 주입 모드는 1건 이상이어야 한다).
      // 이 축이 없으면 「대조군이 옳게 통과했다」와 「라우트가 안 걸려 실데이터를 봤다」가 구별되지 않는다.
      eq(`route-injected:${tag}`, injectedCount > 0 ? 'FIRED' : 'NONE', R.mode === 'real' ? 'NONE' : 'FIRED',
        `가로챈 /api/tech-reports/${R.slug} 응답 ${injectedCount}건`);
      bump('route');

      // ══ 렌더 ↔ 데이터 일치(양방향) — 3축 무조건 단언 ══════════════════════════════════════════
      // 데이터가 있으면 렌더돼야 하고, 없으면 렌더되지 않아야 한다. 한 방향만 재면 이빨이 절반이다.
      eq(`variants-render:${tag}`, m.variantsFound ? 'PRESENT' : 'ABSENT', wantLay.axes.length > 0 ? 'PRESENT' : 'ABSENT',
        `${SRC.src} variants=${srcLen(SRC.variants)} → 유효 축 ${wantLay.axes.length}개`);
      eq(`watch-items-render:${tag}`, m.watchFound ? 'PRESENT' : 'ABSENT', wantWatchLay.items.length > 0 ? 'PRESENT' : 'ABSENT',
        `${SRC.src} watch_items=${srcLen(SRC.watchItems)} → 유효 항목 ${wantWatchLay.items.length}건`);
      // 목차 칩도 양방향 — 집합 동일성으로 단언한다(옛 `absent-toc-chips`(부재만)와
      // `toc-includes-new`(존재만)를 하나로 합친 것이며, 둘보다 엄격하다).
      const NEW_LABELS = ['계열 비교', '확인할 지표'];
      const wantLabels = [
        ...(wantLay.axes.length > 0 ? ['계열 비교'] : []),
        ...(wantWatchLay.items.length > 0 ? ['확인할 지표'] : []),
      ];
      const chipLabels = m.chips.map((c) => c.label);
      eq(`toc-new-chips:${tag}`, NEW_LABELS.filter((l) => chipLabels.includes(l)), wantLabels,
        `목차 칩 ${chipLabels.length}개 = ${JSON.stringify(chipLabels)}`);
      bump('render-matches-data', 3);

      // ⓐ 계열 비교 세부 — 컨테이너가 있을 때만 정의역이 선다(부재는 위 variants-render가 이미 판정).
      if (m.variantsFound) {
        if (R.mode === 'real') bump('detail-run-real:variants');   // 전역 sentinel의 관측값
        eq(`variant-axis-count:${tag}`, m.axisCount, wantLay.axes.length, `${SRC.src} 기준 유효 축 ${wantLay.axes.length}개`);
        bump('variant-axis');

        // table-no-scroller — 각 축마다 표 조상에 overflowX auto/scroll 0개 · 표 자신 넘침 0.
        const scrollerViol = [];
        const overflowViol = [];
        m.axisMetrics.forEach((ax, i) => {
          if (ax.scrollAncestors.length > 0) scrollerViol.push(`axis${i}:${JSON.stringify(ax.scrollAncestors)}`);
          if (ax.tableScrollW != null && ax.tableClientW != null && ax.tableScrollW > ax.tableClientW + 1) {
            overflowViol.push(`axis${i}:${ax.tableScrollW}>${ax.tableClientW}`);
          }
        });
        eq(`variant-table-no-scroller-ancestor:${tag}`, scrollerViol, [], `축 ${m.axisMetrics.length}개 대조`);
        eq(`variant-table-no-scroller-self:${tag}`, overflowViol, [], `축 ${m.axisMetrics.length}개 대조`);
        bump('variant-table-no-scroller', 2 * Math.max(m.axisMetrics.length, 1));

        // 잘림 2계열 — leaf(name/examples/feature) + overflow:hidden 컨테이너.
        const leafDomain = m.axisMetrics.flatMap((ax) => ax.rows.flatMap((r) => [r.nameLeaf, r.exLeaf, r.featLeaf].filter(Boolean)));
        eq(`variant-leaf-domain:${tag}`, leafDomain.length > 0 ? 'OK' : 'LEAF_DOMAIN_EMPTY', 'OK', `leaf ${leafDomain.length}개`);
        const clippedLeaves = leafDomain.filter((l) => l.clipped).map((l) => l.text.slice(0, 20));
        eq(`variant-leaf-clip:${tag}`, clippedLeaves, [], `leaf ${leafDomain.length}개 중 잘림`);
        const clippedContainers = m.variantsHiddenClippers.filter((c) => c.scrollW > c.clientW + 1);
        eq(`variant-container-clip:${tag}`, clippedContainers, [], `overflow:hidden 컨테이너 ${m.variantsHiddenClippers.length}개 중 잘림`);
        bump('variant-leaf', leafDomain.length + m.variantsHiddenClippers.length);

        // 한쪽만 있는 행 — 기대값을 SRC에서 유도한다(리터럴 금지 · 픽스처 전제 금지).
        // featChildren == (strength?1:0)+(tradeoff?1:0), 둘 다 없으면 DASH 텍스트.
        const rowMismatch = [];
        wantLay.axes.forEach((axis, ai) => {
          const gotAx = m.axisMetrics[ai];
          axis.rows.forEach((wr, ri) => {
            const gr = gotAx ? gotAx.rows[ri] : null;
            if (!gr) { rowMismatch.push(`axis${ai}/row${ri}:ROW_MISSING(${wr.name})`); return; }
            if (gr.name !== wr.name) { rowMismatch.push(`axis${ai}/row${ri}:name got=${gr.name} want=${wr.name}`); return; }
            const wantMarkers = (wr.strength ? 1 : 0) + (wr.tradeoff ? 1 : 0);
            if (wantMarkers === 0) {
              if (gr.featText !== DASH) rowMismatch.push(`axis${ai}/row${ri}(${wr.name}):dash got="${gr.featText}"`);
            } else if (gr.featChildren !== wantMarkers) {
              rowMismatch.push(`axis${ai}/row${ri}(${wr.name}):markers got=${gr.featChildren} want=${wantMarkers}`);
            }
            const wantEx = wr.examplesText;
            const gotExText = gr.exLeaf ? gr.exLeaf.text : null;
            if (wantEx && gotExText !== wantEx) rowMismatch.push(`axis${ai}/row${ri}(${wr.name}):examples got="${gotExText}" want="${wantEx}"`);
            if (!wantEx && gr.exLeaf) rowMismatch.push(`axis${ai}/row${ri}(${wr.name}):examples 유령렌더(want null)`);
          });
        });
        eq(`variant-row-fidelity:${tag}`, rowMismatch, [], `${SRC.src} 행 ${wantLay.axes.reduce((a, x) => a + x.rows.length, 0)}개 대조(한쪽만 있는 행 포함)`);
        bump('variant-row', wantLay.axes.reduce((a, x) => a + x.rows.length, 0));

        // 간격 축(가토 ⑩) — 축이 2개 이상인 판에서만: 축 사이 간격 > 소제목↔표 간격.
        // 정의역을 **데이터에서 유도**한다(모드가 아니다) — 축이 1개면 「축 사이」가 존재하지 않는다.
        if (wantLay.axes.length >= 2) {
          const spacingViol = [];
          for (let i = 0; i < m.axisMetrics.length; i++) {
            const ax = m.axisMetrics[i];
            const labelTableGap = (ax.labelBottom != null && ax.tableTop != null) ? ax.tableTop - ax.labelBottom : null;
            if (i > 0) {
              const prev = m.axisMetrics[i - 1];
              const axisGap = ax.top - prev.bottom;
              if (!(labelTableGap != null && axisGap > labelTableGap)) {
                spacingViol.push(`axis${i}: axisGap=${Math.round(axisGap)} labelTableGap=${labelTableGap != null ? Math.round(labelTableGap) : null}`);
              }
            }
          }
          eq(`variant-spacing:${tag}`, spacingViol, [], `축 ${m.axisMetrics.length}개 — 축간격 > 소제목↔표간격이어야 한 덩어리로 안 읽힌다`);
          bump('variant-spacing', Math.max(m.axisMetrics.length - 1, 0));
        } else {
          NOTE(`${tag} — variant-spacing 정의역 밖(${SRC.src} 유효 축 ${wantLay.axes.length}개, 「축 사이」가 없다).`);
        }
      } else {
        NOTE(`${tag} — variant-* 세부 축 정의역 밖(컨테이너 없음). variants-render가 데이터와 대조해 이미 판정했다(기대 축 ${wantLay.axes.length}개).`);
      }

      // ⓑ 확인할 지표 세부 — 부재 판정은 위 watch-items-render가 이미 양방향으로 했다.
      if (m.watchFound) {
        if (R.mode === 'real') bump('detail-run-real:watch-items');
        eq(`watch-item-count:${tag}`, m.watchItemCount, wantWatchLay.items.length, `${SRC.src} 기준 유효 항목 ${wantWatchLay.items.length}건`);
        bump('watch-item', m.watchItemCount);
        const nsItems = m.watchItems.filter((it) => it.hasBadge);
        const wantNs = wantWatchLay.items.filter((i) => i.notSignal).length;
        eq(`watch-notsignal-domain:${tag}`, nsItems.length > 0 ? 'OK' : `NS_DOMAIN_EMPTY(want=${wantNs})`, wantNs > 0 ? 'OK' : `NS_DOMAIN_EMPTY(want=${wantNs})`,
          `신호아님 배지 ${nsItems.length}개(기대 ${wantNs}개)`);
        // 이빨 — --warn 토큰이 본문 토큰과 실제로 다른가(같아지면 아래 색 비교가 공허해진다).
        eq(`watch-warn-token-teeth:${tag}`, m.warnColor !== m.textColor && m.warnColor !== m.text2Color ? 'DISTINCT' : `SAME(warn=${m.warnColor},text=${m.textColor},text2=${m.text2Color})`, 'DISTINCT');
        const colorMismatch = nsItems.filter((it) => it.badgeColor === m.textColor || it.badgeColor === m.text2Color).map((it) => it.label);
        eq(`not-signal-color:${tag}`, colorMismatch, [], `배지 ${nsItems.length}개 — color가 본문(--text/--text-2)과 달라야 한다(기대 --warn=${m.warnColor})`);
        const badgeLineViol = nsItems.filter((it) => it.badgeLeaf && it.badgeLeaf.lines !== 1).map((it) => `${it.label}:lines=${it.badgeLeaf.lines}`);
        eq(`not-signal-badge-1line:${tag}`, badgeLineViol, [], `배지 ${nsItems.length}개 — 「신호 아님」 고정 라벨은 1줄`);
        bump('watch-notsignal', nsItems.length * 3);
      } else {
        NOTE(`${tag} — watch-item-* 세부 축 정의역 밖(컨테이너 없음). watch-items-render가 데이터와 대조해 이미 판정했다(기대 항목 ${wantWatchLay.items.length}건).`);
      }

      // ⓒ 목차 href — 칩 존재/부재는 위 toc-new-chips가 양방향으로 단언했다. 여기선 href가 문서 내
      //   유일 요소로 해석되는지만 본다(정의역이 비면 위반 목록도 비므로 표본 수를 메시지에 싣는다 —
      //   `filter(위반).length === 0`은 빈 컬렉션에서 공허하게 참이다).
      const chipMap = new Map(m.chips.map((c) => [c.label, c.href]));
      const ids = m.sectionInfo.map((s) => s.id);
      const dupIds = wantLabels.map((l) => {
        const href = chipMap.get(l); if (!href) return null;
        const id = href.slice(1);
        const count = ids.filter((x) => x === id).length;
        return count === 1 ? null : `${l}:${id} count=${count}`;
      }).filter(Boolean);
      eq(`toc-href-unique:${tag}`, dupIds, [], `href가 가리키는 id의 문서 내 유일성 — 대조 대상 ${wantLabels.length}개 ${JSON.stringify(wantLabels)}`);
      bump('toc', wantLabels.length);

      // ⓓ section-order — 시장 규모는 항상 렌더(show:true)라 무조건 앵커로 쓴다.
      // challenges는 실행 전 데이터에 의존하는 정의역(있으면 추가로 대조, 없으면 NOTE).
      const idxOf = (id) => ids.indexOf(id);
      if (wantLay.axes.length > 0) {
        const iVar = idxOf('variants'), iMkt = idxOf('market');
        eq(`section-order-variants-before-market:${tag}`, (iVar !== -1 && iMkt !== -1 && iVar < iMkt) ? 'OK' : `variants@${iVar} market@${iMkt}`, 'OK');
        bump('order');
      }
      // task#301: 「계보 분류」 섹션은 데이터 의존 정의역이 아니라 **구조적으로 제거**됐다(업체 분류 축은
      // PlayerTable·ShareChart의 그룹 렌더로 흡수). 옛 `section-order-variants-before-categories` 축은
      // iCat이 영구히 -1이라 else NOTE로만 흘러 **조용히 죽은 축**이 됐다(적대 리뷰 렌즈2) — 삭제하지 않고
      // 「부재」를 단언하는 축으로 뒤집는다. 없는 축은 다음 사람이 존재 자체를 모르고, 이 형태는 섹션이
      // 되살아나는 회귀까지 잡는다. 정의역 의존이 없으므로 **무조건** 단언한다.
      eq(`section-categories-removed:${tag}`, idxOf('categories') === -1 ? 'ABSENT' : `RESURRECTED@${idxOf('categories')}`, 'ABSENT');
      bump('order');
      if (wantWatchLay.items.length > 0) {
        const iWi = idxOf('watch-items'), iMkt = idxOf('market'), iChal = idxOf('challenges');
        // ⚠️ **task#319가 이 축을 뒤집었다** — 시장 규모가 ⑧→④(장 2)로 올라가 이제 확인할 지표보다
        //    **앞**이다. task#298의 두 요구 중 「난제 바로 뒤」는 기록된 결정이라 아래에서 그대로 지키고
        //    (task#298: "안 풀린 관문 → 지켜볼 신호"가 논리 순서 · task#319 비목표 4에 이름으로 등장),
        //    뒤집힌 것은 「시장 규모 앞」쪽뿐이다 — 그건 시장 규모의 *위치* 이동에서 파생된 결과다.
        //    축을 버리지 않고 방향을 뒤집어 남긴다(없는 축은 다음 사람이 존재를 모른다).
        eq(`section-order-market-before-watchitems:${tag}`, (iWi !== -1 && iMkt !== -1 && iMkt < iWi) ? 'OK' : `market@${iMkt} watch-items@${iWi}`, 'OK');
        bump('order');
        if (iChal !== -1) {
          eq(`section-order-watchitems-after-challenges:${tag}`, (iWi !== -1 && iChal < iWi) ? 'OK' : `challenges@${iChal} watch-items@${iWi}`, 'OK');
          bump('order');
        } else {
          NOTE(`${tag} — challenges 정의역 밖(이 발행물엔 난제 섹션이 없다). market 앵커로 이미 대조했다.`);
        }
      }

      eq(`console:${tag}`, errs, [], `${R.mode} 화면`);
      bump('console');

      rawLog.push(`${tag.padEnd(26)} axes=${m.axisCount}(want ${wantLay.axes.length}) watchItems=${m.watchItemCount}(want ${wantWatchLay.items.length}) chips=${JSON.stringify(chipLabels)} ids=${JSON.stringify(ids)}`);

      // ── 육안 캡처 — **각 축을 측정하는 그 지점에서** 찍는다(모드마다 파일이 갈린다).
      //   옛 판은 파일명에 'inject'가 박혀 있어 real 모드 증거가 남지 않았다.
      const shots = [];
      const shot = async (name, full = false) => {
        const path = `${OUT}/${V.key}-${R.slug}-${R.mode}-${name}.png`;
        await page.screenshot({ path, fullPage: full });
        shots.push(path.split('/').pop());
      };
      await shot('top');
      if (m.variantsFound) {
        await page.evaluate(() => document.querySelector('[data-tech-section="variants"]')?.scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(250);
        await shot('variants');
      }
      if (m.watchFound) {
        await page.evaluate(() => document.querySelector('[data-tech-section="watch-items"]')?.scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(250);
        await shot('watch-items');
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(150);
      await shot('full', true);
      shotLog.push(`${tag.padEnd(26)} ${shots.join(' · ')}`);
    } catch (e) {
      eq(`exception:${tag}`, `THROWN:${e && e.message}`, 'NO_EXCEPTION');
      bump('exception');
    }
    await page.close();
  }
  await ctx.close();
}
await browser.close();

// ── 전역 sentinel (task#331 S5 — 위 census 주석의 두 구멍을 각각 막는다) ────────────────────────
// ⓐ 하한 — 라이브 표본이 통째로 사라지면 ⓑ의 기대값이 0으로 degenerate해 조용히 통과한다.
//    「몇 개」가 아니라 「하나라도 있는가」를 묻는다(발행 수는 정당하게 변하므로 정확일치는 거짓 FAIL한다).
eq('live-sample-variants', LIVE_VAR_SLUGS.length >= 1 ? 'OK' : `NO_LIVE_VARIANTS(${SLUGS.length}slug 전부 0)`, 'OK',
  `라이브 variants 유효 ${LIVE_VAR_SLUGS.length}/${SLUGS.length} slug ${JSON.stringify(LIVE_VAR_SLUGS)}`);
eq('live-sample-watch-items', LIVE_WATCH_SLUGS.length >= 1 ? 'OK' : `NO_LIVE_WATCH_ITEMS(${SLUGS.length}slug 전부 0)`, 'OK',
  `라이브 watch_items 유효 ${LIVE_WATCH_SLUGS.length}/${SLUGS.length} slug ${JSON.stringify(LIVE_WATCH_SLUGS)}`);
// ⓑ census 대조 — real 판에서 세부 축이 **실제로 돌았는가**. 조건부 스킵·`continue`·게이트 드리프트가
//    다시 들어오면 여기서 죽는다(주입 실측: 세부 블록을 real에서 건너뛰게 하니 이 축만 FAIL했다).
eq('real-detail-runs-variants', cov['detail-run-real:variants'] || 0, VIEWS.length * LIVE_VAR_SLUGS.length,
  `real 판 계열비교 세부 축 ${cov['detail-run-real:variants'] || 0}판 / 기대 ${VIEWS.length}뷰 × ${LIVE_VAR_SLUGS.length}slug`);
eq('real-detail-runs-watch-items', cov['detail-run-real:watch-items'] || 0, VIEWS.length * LIVE_WATCH_SLUGS.length,
  `real 판 확인할지표 세부 축 ${cov['detail-run-real:watch-items'] || 0}판 / 기대 ${VIEWS.length}뷰 × ${LIVE_WATCH_SLUGS.length}slug`);

// ── 보고 ──────────────────────────────────────────────────────────────────────
const fails = results.filter((r) => !r.ok);
console.log('\n' + '═'.repeat(78));
console.log('커버리지 (계열별 검사 수 — 재실행 간 비교용, 줄면 통과가 아니라 측정 실패):');
for (const [k, v] of Object.entries(cov).sort()) console.log(`  ${k.padEnd(24)} ${v}`);
console.log(`  ${'(합계)'.padEnd(24)} ${Object.values(cov).reduce((a, b) => a + b, 0)}`);
console.log(`\n단언 총계: ${results.length}건 · PASS ${results.length - fails.length} · FAIL ${fails.length}`);
console.log(`뷰 ${VIEWS.length}조합 × slug ${SLUGS.length} × mode 3(real·inject·empty) = ${VIEWS.length * SLUGS.length * 3}페이지`);
console.log('\n원시 실측(단언 아님):');
for (const l of rawLog) console.log(`  ${l}`);
if (CONTROL) console.log(`⚠ 이 실행은 대조군이다(CONTROL=${CONTROL}) — 해당 축 FAIL이 정상이며 게이트 결과가 아니다.`);
const dom = (k) => cov[k] || 0;
console.log('\n양방향 축의 정의역 표본(한 방향이 0이면 그 방향은 「통과」가 아니라 「미검증」이다):');
console.log(`  variants     PRESENT ${dom('domain:variants-present')} · ABSENT ${dom('domain:variants-absent')}`);
console.log(`  watch_items  PRESENT ${dom('domain:watch-present')} · ABSENT ${dom('domain:watch-absent')}`);
console.log('  (ABSENT 표본은 empty 모드가 만든다 — 라이브 15종은 전부 두 필드가 채워져 있어 실데이터로는 그 방향을 만들 수 없다.)');
console.log(`\n※ 육안 캡처 ${OUT}/`);
for (const l of shotLog) console.log(`  ${l}`);
console.log('═'.repeat(78));
fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ control: CONTROL || null, cov, results }, null, 2));
if (fails.length) {
  console.log('\nFAIL 상세:');
  for (const f of fails) console.log(`  ✗ ${f.tag}\n      ${f.msg}`);
  process.exit(1);
}
console.log(`\nALL PASS ${results.length}/${results.length}`);
for (const r of results) console.log(`  ✓ ${r.tag} — ${r.msg}`);
