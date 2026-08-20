// task#277 S5 라이브 UAT — 주요기술 리포트 상세: 시장 성장 차트 · 점유율 · 기술수준 밴드 · 3열 관계도.
//
// ── task#304 S3 갱신(ADR-0041) ─────────────────────────────────────────────────────────────
// 「기술수준 비교」 밴드가 **별도 섹션에서 「주요 업체」 표의 셀로 흡수**됐다. 이 파일의 밴드 축은
// 삭제하지 않고 **컨테이너 선택자만 표 셀로 재지향**했다 — CSS 클래스명(tech-level-band__cells /
// __cell / __cell--filled / __legend)이 유지됐기 때문에(ADR-0041 결정 5가 정확히 이 비용을 아끼려고
// 내린 결정) 칸 수·채움 수·채움색 대조·토큰 이빨 축이 **그대로 살아 있다**.
// 옮긴 것: ① `[data-testid="tech-level-band"]` → `[data-testid="tech-report-players"]`
//          ② `.tech-level-band__name` → `[data-testid="tech-report-player-name"]`
//          ③ `.tech-level-band__empty` → 「기술수준」 셀 텍스트 `—`
//          ④ `.tech-level-band__leader`/`__gap` → 「선두 대비」 셀(둘이 같은 셀이 됐다 — 아래 색 축 주석)
//          ⑤ 범례 간격 대상: (범례 → 첫 밴드 행) → (범례 → 표)
// 추가: `section-band-absent`·`toc-no-levels`(옛 섹션·목차 칩 부재) · `level-band`(칸 5개 · 채움 수 ==
//       픽스처 tech_level · role/aria · 칸 **화면** 렌더 폭 · 접힘 0) · `legend-items`.
//
// ⚠️ 착수 시점 실측: frontend/dist(로컬)와 라이브 index-BBU0cTEJ.js가 바이트 동일하고, 그 번들엔
// `market-growth-chart`/`tech-graph-svg`/`tech-level-band`/`tech-share-chart` 문자열이 전무하다
// (grep 0건, dist mtime 20:24:19 < TechReport.jsx 소스 mtime 20:54:11 — dist가 S1~S4 배선보다 먼저
// 빌드됐다). 즉 **이 스크립트를 처음 돌리는 시점의 라이브는 아직 옛 번들**이고, 신규 축은 전부
// section:*-MISSING으로 FAIL하는 게 정상이다(지시사항 그대로). uat276과 달리 이번엔 "메인 세션이
// 병행 완료해 이미 라이브"인 상황이 아니었다 — 배선은 됐지만 커밋·빌드는 아직.
//
// 응답 봉투(추정 금지, uat276이 이미 1콜로 확인해둔 그대로 재사용):
//   backend/routers/tech_reports.py list_by_slug → sanitize({"slug": slug, "reports": svc.list_by_slug(slug)})
//   frontend/src/pages/TechReport.jsx            → api.get('/api/tech-reports/{slug}') → (data.reports||[])[0]
//
// 새 컴포넌트 4종(소스 직독, frontend/src/components/tech/*.jsx)의 데이터 계약을 이 스크립트가
// **미러**한다(uat276 관용구 — import하지 않고 리터럴 로직을 복제하되 근거를 주석에 남긴다):
//   - formatMarketSize/formatMarketSummary: techReportUtils.js와 바이트 동일 로직(uat276에서 이미 검증).
//   - TechGraph(관계도)의 계약은 아래 task#317 갱신 절과 「새 DOM 계약」을 참조 — 캡·폴드가 없어
//     옛 techGraphLayout/capColumn(MAX_PER_COL=5·"+2개" 폴드) 미러는 더 이상 유효하지 않다(삭제).
//
// 판정축 — 재사용 4계열(uat276 관용구 그대로: 잘림 2계열·줄 수·간격·색, 각 정의역 sentinel과 짝) +
// task#277 신규 2계열(③recharts 대상은 기하(x-클러스터)로 특정 ④실선/점선 — 관계도와 무관, 불변) +
// task#317 신규 6계열(관계도: graph-groups·graph-items-set·graph-chips-set·graph-labels·
// color-graph-*·graph-no-clip — 전부 DOM 구조·집합·색이고, 대상이 사라진 SVG 기하·CJK 절단측정은
// 삭제됨). 신뢰성 규칙(⑧ⓑ 무조건 단언·sentinel FAIL, ⑧ⓐ 커버리지, ⑧ⓘ 대상 identity 우선, ⑧ⓛ
// 정의역 명시)은 uat275/276과 동형.
//
// ── task#317 갱신 ───────────────────────────────────────────────────────────────────────────
// 「연관 기술」 관계도가 3열 계층 SVG DAG → **세로 흐름 HTML**로 재작성됐다(TechGraph.jsx, ADR-0033
// 결정4를 뒤집음 — 근거는 그 파일 헤더: 모바일 2배 가로 스크롤 + 26자 이름 말줄임 + 완전 팬 엣지가
// 0비트 정보). 이 프로브의 graph 축은 SVG 좌표계(viewBox·<path>·<rect>) 전제였으므로 통째로 스테일.
//
// 삭제한 것: graphNodes/graphEdges/graphViewBox 수집 블록(옛 :367-413, svgEl·측정용 숨은 <text>
// 포함) · graph-geometry-domain·graph-bounds·graph-text-legible·graph-col-overlap·
// graph-edge-node-overlap·graph-edge-domain(SVG 기하 축 6종 — 대상 자체가 없다) ·
// cjk-section-domain·cjk-fit·cjk-truncation-consistency·cjk-domain(getComputedTextLength 절단
// 축 — 세로 흐름은 자연 줄바꿈이라 절단이 없다) · fold-section-domain·fold-invariant·
// fold-node-count·der-no-fold(캡·폴드 자체가 사라졌다, TechGraph.jsx:51 "eco: 상한이 없다") ·
// identity-pre·identity-pre-folded·identity-der·identity-complement·identity-competitor(개별
// FOUND 루프 — 아래 graph-items-set/graph-chips-set의 집합비교가 대체한다. 캡이 없으니 "접혀서
// 안 보임" 판정 자체가 무의미해졌다).
//
// 신설한 것(전부 기하가 아니라 DOM 구조·집합·색으로 재구성):
//   graph-groups     렌더된 data-group 집합·순서 == prerequisites→target→derivatives
//   graph-items-set  그룹별 [data-testid="tech-graph-item"] 텍스트 집합 == related[key] 집합
//                    (개수 리터럴 없음 — 캡·폴드·말줄임 부재를 이 한 축이 한번에 잡는다)
//   graph-chips-set  보완/경합 칩 텍스트 집합 == related.complements/competitors 집합
//   graph-labels     그룹 라벨 3종이 접근 가능 텍스트(aria-hidden 아님) + 화살표만 aria-hidden="true"
//   color-graph-*    재작성 — SVG <text> fill 대신 칩 getComputedStyle(chip).color
//                    (대상=인라인 var(--accent), 일반=.badge--neutral의 var(--text-2))
//   graph-no-clip    흐름 안 전 칩이 scrollWidth<=clientWidth+1(줄바꿈으로 흡수, 잘림 없음)
// 유지한 것: section-graph(루트 존재) — 그대로.
//
// ⚠️ 착수 시점 실측(2026-08-20, 옛 번들): 단언 541 · PASS 535 · FAIL 6(전부 clip-container, 원인은
// `.sr-only` 목록 172>1 — 이 태스크와 무관, sr-only가 사라지면 자동 해소). 신규 축은 라이브가 아직
// 옛 SVG 번들이므로 배포 전엔 FAIL이 정상이다(red-first).
import { chromium, devices } from 'playwright';
import fs from 'fs';

console.log('실발행 아님 — 주입 응답 (page.route 픽스처, prod tech_reports 무관)');

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat277';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const P = (ok, tag, msg) => results.push({ ok, tag, msg });
const cov = {};
const bump = (k, n = 1) => { cov[k] = (cov[k] || 0) + n; };
const eq = (tag, got, want, note = '') => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  P(ok, tag, `${ok ? 'PASS' : 'FAIL'} — got=${JSON.stringify(got)} want=${JSON.stringify(want)}${note ? ' · ' + note : ''}`);
};
const NOTE = (msg) => console.log(`  ℹ ${msg}`);
// 실측 원시 로그(단언 아님, 무조건 출력) — 개별 PASS 메시지는 FAIL이 하나라도 있으면 안 찍히므로
// "단언하지 않지만 다음 사람이 봐야 하는 사실"은 여기로 모은다(출력은 넓게, 단언은 목표에만).
const rawLog = [];

// ── 로그인 (추정 폴백 없음) ──────────────────────────────────────────────────
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const { access_token, refresh_token } = await login.json();
if (!access_token) { console.error('로그인 실패 — access_token 없음. 종료.'); process.exit(1); }

// ── techReportUtils.js 미러 (uat276과 바이트 동일 로직) ──────────────────────
const UNIT_LABEL = { USD: { mn: 'M', bn: 'B', tn: 'T' }, KRW: { mn: '백만원', bn: '십억원', tn: '조원' } };
function fmtSize(size) {
  if (!size || typeof size.value !== 'number' || !Number.isFinite(size.value)) return null;
  const label = UNIT_LABEL[size.currency]?.[size.unit];
  if (!label) return null;
  const v = Math.round(size.value * 10) / 10;
  return size.currency === 'USD' ? `$${v}${label}` : `${v}${label}`;
}
function splitSeries(market) {
  const sortByYear = (arr) => (Array.isArray(arr) ? [...arr].sort((a, b) => a.year - b.year) : []);
  return { history: sortByYear(market?.history), forecast: sortByYear(market?.forecast) };
}
function fmtSummary(market) {
  const { history, forecast } = splitSeries(market);
  const current = history[history.length - 1] ?? null;
  const final = forecast[forecast.length - 1] ?? null;
  const partText = (p) => { const amt = fmtSize(p.size); return amt ? `${amt} (${p.year})` : null; };
  const curTxt = current ? partText(current) : null;
  const finTxt = final ? partText(final) : null;
  if (!curTxt && !finTxt) return null;
  const cagrTxt = market?.cagr_pct != null ? `, CAGR ${market.cagr_pct}%` : '';
  return curTxt && finTxt ? `${curTxt} → ${finTxt}${cagrTxt}` : `${curTxt ?? finTxt}${cagrTxt}`;
}
// MarketGrowthChart.jsx의 captionParts 조립 로직 미러. task#282 S3 — 출처 join 제거(하단 「출처」
// 섹션과 순중복이었다), CAGR은 fmtSummary가 이미 문자열 끝에 붙인다.
function fmtGrowthCaption(market) {
  const parts = [];
  const summary = fmtSummary(market);
  if (summary) parts.push(summary);
  if (market?.as_of) parts.push(`기준 ${market.as_of}`);
  return parts.join(' · ');
}
const TECH_NAMES = { 'reusable-rocket': '재사용 로켓', 'solid-state-battery': '전고체 배터리', smr: 'SMR', robotics: '로봇' };
// 기술 성숙 단계 5단계 라벨 미러(techReportUtils.TECH_LEVEL_LABELS) — 범례·aria-label 기대값 소스.
const TECH_LEVEL_LABELS = ['', '기초연구', '시제품', '실증', '초기상용', '양산상용'];

// ── 픽스처 A — 메인(6뷰포트×테마 조합에서 재사용): 관계도 접힘(전제 6개→+2개) 포함 ──────
const SLUG = 'reusable-rocket';
const TARGET_LABEL = TECH_NAMES[SLUG];
const PLAYERS = [
  { name: 'SpaceX', country: 'US', state_led: false, ticker: null, tech_level: 5, gap_years: 0, leader_name: null, share_pct: 42.5, note: '재사용 1위, 팰컨9 누적 발사 최다.' },
  { name: '중국항천과기집단공사(CASC, China Aerospace Science and Technology Corporation)', country: 'CN', state_led: true, ticker: null, tech_level: 3, gap_years: 5, leader_name: 'SpaceX', share_pct: 18.2, note: '국가 주도 투자로 격차를 좁히는 중이다.' },
  { name: 'Rocket Lab Holdings', country: 'US', state_led: false, ticker: 'COST', tech_level: 4, gap_years: 2, leader_name: 'SpaceX', share_pct: 15.0, note: null },
  { name: 'Blue Origin', country: 'US', state_led: false, ticker: 'AAPL', tech_level: 3, gap_years: 6, leader_name: 'SpaceX', share_pct: 8.3, note: null },
];
const MARKET = {
  history: [
    { year: 2021, size: { value: 7.4, currency: 'USD', unit: 'bn' } },
    { year: 2024, size: { value: 12.5, currency: 'USD', unit: 'bn' } },
  ],
  forecast: [
    { year: 2027, size: { value: 20.1, currency: 'USD', unit: 'bn' } },
    { year: 2030, size: { value: 30.5, currency: 'USD', unit: 'bn' } },
  ],
  cagr_pct: 12.3,
  share_basis: '발사 횟수 기준(연간 궤도 발사 건수 점유율)',
  as_of: '2026-08-03',
};
const SOURCES = [{ title: 'NASA', url: null }, { title: 'Gartner 2024', url: 'https://example.com/gartner' }, { title: '옴디아', url: null }];
const CHALLENGES = [
  { title: '재점화 신뢰성', body: '다회 재점화 엔진의 내구성과 정비 주기를 단축해야 한다.' },
  { title: '대량생산 전환', body: '시험기 생산 체계에서 양산 체계로 전환하는 공정 표준화가 관건이다.' },
];
const TITLE = 'UAT277 재사용 로켓, 궤도당 비용을 다시 쓴다';
// 전제 6개(fold: 4노출+"+2개") · 파생 3개(fold 없음) · 보완/경합 각 2/1(칩 그룹, 그래프 밖).
const PREREQ = ['오비탈 랑데부 시스템', '극저온 추진제 저장', '재점화 가능 로켓엔진', '정밀 착륙 유도 시스템', '대기권 재진입 열보호막', '발사장 신속 정비 인프라'];
const DERIV = ['궤도상 서비싱', '초소형위성 저비용 발사', '우주 관광'];
const COMPLEMENTS = ['위성 소형화 기술', '발사장 자동화 시스템'];
const COMPETITORS = ['전통 소모성 발사체'];
const RELATED = { prerequisites: PREREQ, derivatives: DERIV, complements: COMPLEMENTS, competitors: COMPETITORS };
const DETAIL_REPORT = {
  slug: SLUG, published_date: '2026-08-03', title: TITLE,
  description: '1단 재사용은 발사 비용을 궤도당 비용 기준으로 낮추는 구조적 전환이다.',
  difficulty: { score: 5, rationale: '극저온 추진제 재점화와 착륙 정밀도가 아직 완전히 표준화되지 않았다.' },
  players: PLAYERS, challenges: CHALLENGES, related: RELATED, market: MARKET, sources: SOURCES,
};
const GROWTH_CAPTION_EXPECTED = fmtGrowthCaption(MARKET);
const AXIS_UNIT = 'USD bn'; // MarketGrowthChart.jsx:47 axisUnit = `${currency} ${unit}`

// ── 픽스처 B — share_pct 전무(ShareChart 섹션 자체가 생략돼야 한다, plan S2 완료기준) ────
const SLUG2 = 'smr';
const PLAYERS_NO_SHARE = PLAYERS.map(p => ({ ...p, share_pct: null }));
const DETAIL_REPORT2 = {
  slug: SLUG2, published_date: '2026-08-03', title: 'UAT277 SMR 픽스처 — share_pct 전무 검증용',
  description: 'SMR은 상용 점유율 지표가 아직 형성되지 않은 상태다.',
  difficulty: { score: 4, rationale: '노심 인허가 표준화가 국가마다 달라 상용화 일정이 불확실하다.' },
  players: PLAYERS_NO_SHARE, challenges: [], related: {}, market: MARKET, sources: SOURCES,
};

const STOCKS_FIXTURE = [
  { ticker: 'COST', name: 'Costco', type: 'holding', market: 'US' },
  { ticker: 'AAPL', name: 'Apple Inc.', type: 'watchlist', market: 'US' },
];

// ── 범위 — uat276 실측 그대로(main.page-wrap만 쓰면 ResearchShell 모바일 seg 탭바가 섞여든다) ──
const ROOT_SEL = 'main.page-wrap .page, main.page-wrap .m-page';

// ── 브라우저 안 측정기 ────────────────────────────────────────────────────────
const measureDetail = (page) => page.evaluate((ROOT_SEL) => {
  const root = document.querySelector(ROOT_SEL);
  if (!root) return { found: false };
  const playersEl = root.querySelector('[data-testid="tech-report-players"]');
  if (!playersEl) return { found: false }; // task#276 표면(불변) — 존재해야 페이지가 우리 픽스처로 렌더된 것

  const cs = (el) => getComputedStyle(el);
  const txt = (el) => el.textContent.trim();
  const lineCount = (el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    const tops = [...r.getClientRects()].map(x => Math.round(x.top));
    return new Set(tops).size || 1;
  };

  // ── 재사용 축(uat276 관용구 그대로) — 잘림 2계열·줄 수·bbox ──────────────
  const leaves = [...root.querySelectorAll('span, div, p, a')].filter(e => e.children.length === 0 && txt(e).length > 0);
  const items = leaves.map(el => {
    const s = cs(el);
    const isEllipsis = s.textOverflow === 'ellipsis' && s.overflow !== 'visible';
    const isNowrap = s.whiteSpace === 'nowrap';
    const b = el.getBoundingClientRect();
    return { t: txt(el).slice(0, 60), lines: lineCount(el), scrollW: el.scrollWidth, clientW: el.clientWidth, right: Math.round(b.right), isEllipsis, isNowrap };
  });
  const clippers = [...root.querySelectorAll('*')].filter(e => cs(e).overflow === 'hidden' && txt(e).length > 0)
    .map(e => ({ t: txt(e).slice(0, 40), scrollW: e.scrollWidth, clientW: e.clientWidth, isEllipsis: cs(e).textOverflow === 'ellipsis' }));
  const rr = root.getBoundingClientRect();

  // ── 색 토큰(:root에서 임시 노드로 rgb 정규화, 가토 ⑪ — 하드코딩 금지) ────
  const readToken = (varName) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${varName})`; probe.style.position = 'absolute'; probe.style.opacity = '0';
    document.body.appendChild(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    return rgb;
  };
  const readBgToken = (varName) => {
    const probe = document.createElement('span');
    probe.style.background = `var(${varName})`; probe.style.position = 'absolute'; probe.style.opacity = '0';
    document.body.appendChild(probe);
    const rgb = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return rgb;
  };
  const tokens = {
    accent: readToken('--accent'), text: readToken('--text'), text3: readToken('--text-3'),
    text2: readToken('--text-2'), // task#317 — 관계도 일반 칩(.badge--neutral) 색 대조용
    data2: readBgToken('--data-2'), border: readBgToken('--border'),
    tagHold: readToken('--tag-hold-color'), tagWatch: readToken('--tag-watch-color'),
  };

  // ── ① 기술수준 밴드 (S3 → task#304/ADR-0041: 별도 섹션이 아니라 「주요 업체」 표의 셀이다) ─────
  //    컨테이너 선택자만 표 셀로 재지향한다 — 클래스명(tech-level-band__cell*)을 유지했으므로
  //    칸 수·채움 수·채움색 대비·이빨 축은 **그대로 살아 있다**(ADR-0041 결정 5가 노린 것이 이것이다).
  //    행/선두/격차/결측 축은 표 등가물(<tr> · 「현재 선두」 · `N년` · `—`)로 옮겼다.
  const bandEl = root.querySelector('[data-testid="tech-report-players"]');
  const headLabels = bandEl ? [...bandEl.querySelectorAll('thead th')].map(th => txt(th)) : [];
  const levelIdx = headLabels.indexOf('기술수준');
  const gapIdx = headLabels.indexOf('선두 대비');
  const bandRows = bandEl ? [...bandEl.querySelectorAll('[data-testid="tech-report-player-row"]')].map(row => {
    const nameEl = row.querySelector('[data-testid="tech-report-player-name"]');
    const levelTd = levelIdx >= 0 ? row.children[levelIdx] : null;
    const gapTd = gapIdx >= 0 ? row.children[gapIdx] : null;
    const cellsEl = levelTd ? levelTd.querySelector('.tech-level-band__cells') : null;
    const filled = cellsEl ? cellsEl.querySelectorAll('.tech-level-band__cell--filled').length : null;
    const totalCells = cellsEl ? cellsEl.querySelectorAll('.tech-level-band__cell').length : null;
    // 결측(tech_level 없음)의 표 등가물 — 옛 `.tech-level-band__empty` 대신 셀 텍스트 `—`.
    const isEmpty = !cellsEl && !!levelTd && txt(levelTd) === '—';
    // 「현재 선두」/격차는 이제 별도 span이 아니라 「선두 대비」 셀의 텍스트다(표는 열이 축이다).
    const gapText = gapTd ? txt(gapTd) : null;
    const filledEl = cellsEl ? cellsEl.querySelector('.tech-level-band__cell--filled') : null;
    const unfilledCellEl = cellsEl ? cellsEl.querySelector('.tech-level-band__cell:not(.tech-level-band__cell--filled)') : null;
    const fb = filledEl ? filledEl.getBoundingClientRect() : null;
    return {
      name: nameEl ? txt(nameEl) : null,
      filled, totalCells, isEmpty,
      aria: cellsEl ? cellsEl.getAttribute('aria-label') : null,
      role: cellsEl ? cellsEl.getAttribute('role') : null,
      // 화면 실측(가토 ⑫) — 칸이 CSS 선언대로 실제 픽셀을 갖는가.
      cellW: fb ? Math.round(fb.width * 10) / 10 : null,
      cellH: fb ? Math.round(fb.height * 10) / 10 : null,
      // 칸 묶음이 접히지 않는가 — **세로로 겹치지 않는 rect 묶음의 개수**(가토 ⑨ 2차 정정판).
      // ⚠️ `서로 다른 top 개수`는 정상 구현을 거짓 FAIL시킨다 — 칸(10px)과 단계 숫자(16.5px)가
      // align-items:center로 같은 줄에 놓이면서 top이 갈리기 때문(실측 확인). uat276과 동일 관용구.
      cellLines: cellsEl ? (() => {
        const ks = [...cellsEl.children].map(c => c.getBoundingClientRect())
          .map(r => ({ top: r.top, bottom: r.bottom })).sort((a, b) => a.top - b.top);
        const ls = [];
        for (const k of ks) {
          const hit = ls.find(L => (Math.min(L.bottom, k.bottom) - Math.max(L.top, k.top))
            > 0.3 * Math.min(L.bottom - L.top, k.bottom - k.top));
          if (hit) { hit.top = Math.min(hit.top, k.top); hit.bottom = Math.max(hit.bottom, k.bottom); }
          else ls.push({ top: k.top, bottom: k.bottom });
        }
        return ls.length;
      })() : null,
      gapText,
      isLeaderRow: gapText === '현재 선두',
      // 옛 `.tech-level-band__leader`(--accent) / `.tech-level-band__gap`(--text-3) 두 색을 재던 자리.
      // 표에서는 둘 다 같은 셀(TD_MUTED)이라 **색이 하나다** — 아래 color-gap-cell이 그 사실을 잰다.
      gapColor: gapTd ? cs(gapTd).color : null,
      filledCellColor: filledEl ? cs(filledEl).backgroundColor : null,
      unfilledCellColor: unfilledCellEl ? cs(unfilledCellEl).backgroundColor : null,
    };
  }) : null;
  // 범례는 이제 밴드 섹션 안이 아니라 **표 위**다(ADR-0041 결정 1) — 간격 축의 대상도 표로 옮긴다.
  const bandLegendEl = root.querySelector('.tech-level-band__legend');
  const bandLegendItems = bandLegendEl ? [...bandLegendEl.querySelectorAll('.tech-level-band__legend-item')].map(e => txt(e)) : null;
  const bandLegendGap = (bandLegendEl && bandEl)
    ? Math.round(bandEl.getBoundingClientRect().top - bandLegendEl.getBoundingClientRect().bottom) : null;
  // 옛 섹션이 정말 사라졌는가(동작 ②) — 하나라도 남으면 유령 UI다.
  const bandSectionGone = [
    root.querySelectorAll('[data-testid="tech-level-band"]').length,
    root.querySelectorAll('[data-tech-section="levels"]').length,
  ];
  const tocLabels = [...root.querySelectorAll('[data-testid="tech-toc-chip"]')].map(a => txt(a));

  // ── ② 점유율 차트 (S2) ────────────────────────────────────────────────
  const shareEl = root.querySelector('[data-testid="tech-share-chart"]');
  const shareRows = shareEl ? [...shareEl.querySelectorAll('[data-testid="tech-share-chart-row"]')].map(row => {
    const nameEl = [...row.querySelectorAll('span')].find(e => cs(e).textOverflow === 'ellipsis');
    const pctEl = [...row.querySelectorAll('span')].find(e => /\d%$/.test(txt(e)));
    return { name: nameEl ? txt(nameEl) : null, pctText: pctEl ? txt(pctEl) : null };
  }) : null;
  const shareCaptionEl = root.querySelector('[data-testid="tech-share-chart-caption"]');
  let shareCaptionGap = null;
  if (shareCaptionEl && shareRows && shareRows.length) {
    const lastRowEl = [...shareEl.querySelectorAll('[data-testid="tech-share-chart-row"]')].pop();
    shareCaptionGap = Math.round(shareCaptionEl.getBoundingClientRect().top - lastRowEl.getBoundingClientRect().bottom);
  }

  // ── ③ 시장 성장 차트 (S1) — recharts 대상은 기하로 특정(클래스 계층 의존 금지) ──────
  const growthEl = root.querySelector('[data-testid="market-growth-chart"]');
  const growthEmptyEl = growthEl ? growthEl.querySelector('[data-testid="market-growth-empty"]') : null;
  const growthCaptionEl = growthEl ? growthEl.querySelector('[data-testid="market-growth-caption"]') : null;
  // task#282 S3 — 별도 CAGR 배지(`market-growth-cagr`)가 제거되고 formatMarketSummary가 이미
  // 캡션 문자열 끝에 `, CAGR N%`를 붙인다(순중복 해소). 배지 자리를 대신하던 "캡션→다음 요소" 간격
  // 축은 이제 캡션의 **바로 다음 형제**(배지 제거로 곧장 차트 wrapper가 온다)로 재측정한다
  // (축을 삭제하지 않고 새 구조를 재게 고친다).
  const growthChartWrapEl = growthCaptionEl ? growthCaptionEl.nextElementSibling : null;
  // ⚠️ `.recharts-surface` 첫 매치를 쓰면 **범례 아이콘**을 잡는다 — 실측(task#277): 차트 루트 안에
  // surface가 3개이고 [0][1]은 `recharts-legend-item` 안의 14×14 아이콘(틱 0개), [2]만 실제 플롯
  // (`recharts-wrapper` 자식, 710×220, 틱 9개)이다. 첫 매치로는 축 틱·선이 **원리적으로 0건**이라
  // "차트가 안 그려졌다"와 구별되지 않는다(FAIL 30건의 원인이었고 앱은 정상이었다).
  // → 플롯 surface = 부모가 `.recharts-wrapper`인 것. 폴백은 면적 최대.
  const surfaceEl = (() => {
    if (!growthEl) return null;
    const all = [...growthEl.querySelectorAll('.recharts-surface')];
    if (!all.length) return null;
    const plot = all.find(s => (s.parentElement?.getAttribute('class') || '').includes('recharts-wrapper'));
    if (plot) return plot;
    return all.map(s => ({ s, a: (+s.getAttribute('width') || 0) * (+s.getAttribute('height') || 0) }))
      .sort((x, y) => y.a - x.a)[0].s;
  })();
  let growthAxis = null;
  let growthLines = null;
  let growthGap = null;
  if (surfaceEl) {
    const allTexts = [...surfaceEl.querySelectorAll('text')].filter(t => txt(t).length > 0);
    // x 속성으로 군집화 — 같은 x를 3개 이상 공유 = 세로축(가장 작은 x가 좌축). 나머지는 X축/라벨.
    const byX = new Map();
    allTexts.forEach(t => {
      const x = Math.round(parseFloat(t.getAttribute('x') || '0'));
      if (!byX.has(x)) byX.set(x, []);
      byX.get(x).push(t);
    });
    const clusters = [...byX.entries()].filter(([, arr]) => arr.length >= 3).sort((a, b) => a[0] - b[0]);
    const yAxisCluster = clusters.length ? clusters[0][1] : [];
    const yAxisXs = new Set(clusters.length ? [clusters[0][0]] : []);
    const nonYAxis = allTexts.filter(t => !yAxisXs.has(Math.round(parseFloat(t.getAttribute('x') || '0'))));
    const yTickTexts = yAxisCluster.map(t => txt(t));
    const xTickCandidates = nonYAxis.map(t => txt(t));
    // Y축 라벨(회전된 축 제목) — 클래스가 아니라 **내용**으로 특정(픽스처가 만드는 정확한 문자열).
    const yLabelEl = allTexts.find(t => txt(t) === 'USD bn');
    growthAxis = {
      yTickCount: yAxisCluster.length, yTickTexts,
      xTickCandidates,
      yLabelFound: !!yLabelEl,
      yLabelRect: yLabelEl ? (({ left, right, top, bottom }) => ({ left: Math.round(left), right: Math.round(right), top: Math.round(top), bottom: Math.round(bottom) }))(yLabelEl.getBoundingClientRect()) : null,
    };
    // ── ④ 실선/점선 — Line 컴포넌트가 렌더한 curve path(JSX 순서: hist 먼저, fcst 다음) ──
    const linePaths = [...surfaceEl.querySelectorAll('path.recharts-line-curve')];
    // ⚠️ `dasharray === 'none'`으로 실선을 판정하면 안 된다 — recharts는 선 그리기 애니메이션을
    // `stroke-dasharray`로 구현하므로 **실선에도** `"213.75px, 213.75px"`(≈경로 길이) 가 남는다(실측).
    // 그건 경로 전체를 한 대시로 덮어 **렌더는 실선**이다. 안정적 판별자는 최소 대시 조각 길이:
    // 실선/애니메이션 산물은 조각이 크고(≥20px), 의도된 점선은 짧다(`5px, 3px` → 3px).
    growthLines = linePaths.map(p => {
      const da = cs(p).strokeDasharray;
      const segs = (da || '').match(/[\d.]+/g)?.map(Number).filter(n => n > 0) ?? [];
      return { dasharray: da, minSeg: segs.length ? Math.min(...segs) : null, segCount: segs.length };
    });
  }
  if (growthCaptionEl && growthChartWrapEl) {
    growthGap = Math.round(growthChartWrapEl.getBoundingClientRect().top - growthCaptionEl.getBoundingClientRect().bottom);
  }
  const growthCaptionColor = growthCaptionEl ? cs(growthCaptionEl).color : null;
  const growthRootRect = growthEl ? growthEl.getBoundingClientRect() : null;

  // ── ⑤ 관계도 (task#317 — 3열 SVG DAG → 세로 흐름 HTML, TechGraph.jsx 직독 100줄) ──────────
  //    SVG 좌표계·엣지·폴드·절단이 전부 사라졌다 — 세로 흐름은 자연 줄바꿈이라 절단 메커니즘이
  //    없고, 캡도 없어 related 배열 전량이 그대로 렌더된다(TechGraph.jsx:51 "eco: 상한이 없다").
  //    판정은 기하가 아니라 **집합 동일성과 색**으로 재구성한다(아래 판정 코드 참조).
  const graphEl = root.querySelector('[data-testid="tech-graph"]');
  const graphFlowEl = graphEl ? graphEl.querySelector('[data-testid="tech-graph-flow"]') : null;
  const graphGroups = graphFlowEl ? [...graphFlowEl.querySelectorAll('[data-testid="tech-graph-group"]')].map(li => {
    // 그룹 라벨 = li의 첫 자식 <span>(li.children는 element만 — 공백 텍스트노드는 안 섞인다).
    const labelEl = li.children[0];
    // 화살표 = li의 직계 자식 span[aria-hidden](라벨 span엔 aria-hidden이 없어 :scope>span[aria-hidden]로 구분).
    const arrowEl = li.querySelector(':scope > span[aria-hidden]');
    const itemEls = [...li.querySelectorAll('[data-testid="tech-graph-item"]')];
    return {
      key: li.getAttribute('data-group'),
      labelText: labelEl ? txt(labelEl) : null,
      labelAriaHidden: labelEl ? labelEl.hasAttribute('aria-hidden') : false,
      arrowText: arrowEl ? txt(arrowEl) : null,
      arrowAriaHidden: arrowEl ? arrowEl.getAttribute('aria-hidden') : null,
      items: itemEls.map(chip => ({
        text: txt(chip), scrollW: chip.scrollWidth, clientW: chip.clientWidth, color: cs(chip).color,
      })),
    };
  }) : [];
  // 보완/경합 칩 그룹(방향 없는 관계, 흐름 밖) — 칩은 `.badge`이고 `tech-graph-item` testid는 없다.
  // 라벨 span은 `.badge` 클래스가 없는 첫 span으로 구분(순서 의존 없이 안전하게 특정).
  const readChipRow = (testid) => {
    const el = graphEl ? graphEl.querySelector(`[data-testid="${testid}"]`) : null;
    if (!el) return null;
    const labelEl = el.querySelector('span:not(.badge)');
    return {
      labelText: labelEl ? txt(labelEl) : null,
      items: [...el.querySelectorAll('.badge')].map(chip => ({ text: txt(chip), scrollW: chip.scrollWidth, clientW: chip.clientWidth })),
    };
  };
  const graphComplements = readChipRow('tech-graph-complements');
  const graphCompetitors = readChipRow('tech-graph-competitors');

  return {
    found: true, rootRight: Math.round(rr.right),
    items, clippers, allText: root.textContent, tokens,
    bandFound: !!bandEl, bandRows, bandLegendGap, bandLegendItems, bandSectionGone, tocLabels,
    shareFound: !!shareEl, shareRows, shareCaptionGap,
    growthFound: !!growthEl, growthEmpty: !!growthEmptyEl,
    growthCaptionText: growthCaptionEl ? txt(growthCaptionEl) : null,
    growthCaptionColor,
    growthAxis, growthLines, growthGap,
    growthRootRight: growthRootRect ? Math.round(growthRootRect.right) : null,
    growthRootLeft: growthRootRect ? Math.round(growthRootRect.left) : null,
    graphFound: !!graphEl, graphGroups, graphComplements, graphCompetitors,
  };
}, ROOT_SEL);

// ── 실행 ──────────────────────────────────────────────────────────────────────
const browser = await chromium.launch();

const VIEWS = [
  { key: 'pc', opts: { viewport: { width: 1440, height: 900 } } },
  { key: 'mobile390', opts: { ...devices['iPhone 13'] } },
  { key: 'mobile350', opts: { viewport: { width: 350, height: 700 } } },
];
const THEMES = ['light', 'dark'];

for (const V of VIEWS) {
  for (const THEME of THEMES) {
    const tag = `${V.key}/${THEME}`;
    const ctx = await browser.newContext({ ...V.opts, serviceWorkers: 'block' });
    await ctx.addInitScript(([a, r, th]) => {
      localStorage.setItem('access_token', a); localStorage.setItem('refresh_token', r);
      localStorage.setItem('theme', th);
    }, [access_token, refresh_token, THEME]);

    const page = await ctx.newPage();
    const errs = [];
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', e => errs.push(String(e)));

    let intercepted = false;
    try {
      await page.route(`**/api/tech-reports/${SLUG}`, async (route) => {
        intercepted = true;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ slug: SLUG, reports: [DETAIL_REPORT] }) });
      });
      await page.route('**/api/stocks', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STOCKS_FIXTURE) });
      });

      await page.goto(`${BASE}/tech-report/${SLUG}`, { waitUntil: 'networkidle' }).catch((e) => errs.push(`goto:${e}`));
      await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0).catch(() => {});
      await page.waitForTimeout(1200);

      // (0) 라우트 인터셉트 실사 — 무조건 단언(⑧ⓑ).
      eq(`intercept:${tag}`, intercepted ? 'FIRED' : 'ROUTE_NOT_INTERCEPTED', 'FIRED');
      bump('intercept');

      let m = await measureDetail(page);
      if (!m.found) {
        console.log(`  (재시도) ${tag} — players 섹션 미검출, 1.8s 대기 후 재측정`);
        await page.waitForTimeout(1800);
        m = await measureDetail(page);
      }
      eq(`section:${tag}`, m.found ? 'PRESENT' : 'SECTION_MISSING', 'PRESENT', 'task#276 표면(불변) — 우리 픽스처로 렌더됐는지');
      bump('section');

      if (!m.found) {
        eq(`console:${tag}`, errs, [], '측정 불가 화면(참고용)');
        bump('console');
        await page.screenshot({ path: `${OUT}/${V.key}-${THEME}-nosection.png`, fullPage: false });
        await page.close(); await ctx.close();
        continue;
      }

      // (1) identity — 판정축이 대상과 독립이면 틀린 문서 위에서도 통과한다(⑧ⓘ). 최우선.
      eq(`identity:${tag}`, m.allText.includes(TITLE) ? 'FOUND' : 'TITLE_MISSING', 'FOUND');
      bump('identity');
      for (const p of PLAYERS) {
        eq(`identity-player:${tag}:${p.name.slice(0, 10)}`, m.allText.includes(p.name) ? 'FOUND' : 'PLAYER_MISSING', 'FOUND');
        bump('identity');
      }

      // ── task#277 신규 섹션 존재 sentinel (무조건, 미배포면 여기서 FAIL하는 게 정상) ──
      // task#304 — 「기술수준」은 이제 표의 셀이므로 이 sentinel의 대상은 **표**다. 그리고 옛 밴드
      // 섹션이 정말 사라졌는지를 **짝 축**으로 함께 못박는다(하나만 두면 흡수가 반쪽인 상태를 통과시킨다).
      eq(`section-band:${tag}`, m.bandFound ? 'PRESENT' : 'PLAYERS_TABLE_MISSING', 'PRESENT', '기술수준 셀의 컨테이너 = 주요 업체 표');
      bump('section');
      eq(`section-band-absent:${tag}`, m.bandSectionGone, [0, 0],
        '[data-testid="tech-level-band"] · [data-tech-section="levels"] 둘 다 0');
      eq(`toc-no-levels:${tag}`, m.tocLabels.filter(t => t.includes('기술수준')), [],
        `목차 칩 ${m.tocLabels.length}개 = ${JSON.stringify(m.tocLabels)}`);
      bump('section', 2);
      eq(`section-share:${tag}`, m.shareFound ? 'PRESENT' : 'SHARE_MISSING', 'PRESENT', 'players 전원 share_pct 有 → 섹션 필수');
      bump('section');
      eq(`section-growth:${tag}`, m.growthFound ? 'PRESENT' : 'GROWTH_MISSING', 'PRESENT');
      bump('section');
      eq(`section-graph:${tag}`, m.graphFound ? 'PRESENT' : 'GRAPH_MISSING', 'PRESENT', 'related 비어있지 않음 → 섹션 필수');
      bump('section');

      // ═══ 재사용 축 1 — 잘림(leaf ellipsis 제외 scrollW>clientW) ═══════════
      const clipDomain = m.items.filter(i => !i.isEllipsis);
      const clipped = clipDomain.filter(i => i.scrollW > i.clientW + 1);
      eq(`clip:${tag}`, clipped.map(c => `${c.t}(${c.scrollW}>${c.clientW})`), [], `검사 ${clipDomain.length}건`);
      bump('clip', clipDomain.length);
      eq(`clip-domain:${tag}`, clipDomain.length > 20 ? 'OK' : `CLIP_DOMAIN_TOO_SMALL(${clipDomain.length})`, 'OK');

      // ═══ 재사용 축 2 — 잘림(overflow:hidden 컨테이너, ellipsis 아닌 것) ══════
      const hardClippers = m.clippers.filter(c => !c.isEllipsis);
      eq(`clip-raw-applied:${tag}`, m.clippers.length > 0 ? 'OK' : 'NO_OVERFLOW_HIDDEN_AT_ALL', 'OK', 'ellipsis 메커니즘 적용 여부');
      bump('clip-raw', m.clippers.length);
      if (hardClippers.length > 0) {
        const cut = hardClippers.filter(c => c.scrollW > c.clientW + 1);
        eq(`clip-container:${tag}`, cut.map(c => `${c.t}(${c.scrollW}>${c.clientW})`), [], `검사 ${hardClippers.length}건`);
        bump('clip-container', hardClippers.length);
      } else {
        NOTE(`${tag} — clip-container 도메인 0(ShareChart 진행바 wrapper는 overflow:hidden이지만 자기 텍스트가 없어 정의역 밖 — 소스 확인됨)`);
      }

      // ═══ 재사용 축 3 — 줄 수(nowrap leaf의 distinct-top 개수, 접힘=④ 모바일 350 포함) ═
      const nowrapDomain = m.items.filter(i => i.isNowrap);
      const folded = nowrapDomain.filter(i => i.lines !== 1);
      eq(`line-visible:${tag}`, folded.map(f => `${f.t}(${f.lines}줄)`), [], `검사 ${nowrapDomain.length}건`);
      bump('line-visible', nowrapDomain.length);
      eq(`line-visible-domain:${tag}`, nowrapDomain.length > 15 ? 'OK' : `LINE_DOMAIN_TOO_SMALL(${nowrapDomain.length})`, 'OK');

      // ═══ 재사용 축 4(전개) — bbox 가로 넘침 ═══════════════════════════════
      const over = m.items.filter(i => i.right > m.rootRight + 1);
      eq(`bbox:${tag}`, over.map(o => `${o.t}(${o.right}>${m.rootRight})`), [], `검사 ${m.items.length}건 · root=${m.rootRight}`);
      bump('bbox', m.items.length);

      // ═══ 간격 축 — 신규 섹션 4쌍 ══════════════════════════════════════════
      // task#304 — 범례가 밴드 섹션 최상단에서 **표 위**로 옮겨졌다. 측정 쌍도 (범례 → 첫 밴드 행)에서
      // (범례 → 표)로 옮긴다. 임계는 그대로(완화 0). 범례 내용도 여기서 함께 못박는다(축 ③ 이관).
      eq(`gap-band-domain:${tag}`, m.bandLegendGap != null ? 'OK' : 'GAP_BAND_DOMAIN_EMPTY', 'OK');
      if (m.bandLegendGap != null) eq(`gap-band:${tag}`, m.bandLegendGap >= -2 && m.bandLegendGap <= 24 ? 'OK' : `${m.bandLegendGap}px`, 'OK', `실측 ${m.bandLegendGap}px`);
      eq(`legend-items:${tag}`, m.bandLegendItems, TECH_LEVEL_LABELS.slice(1).map((l, i) => `${i + 1} ${l}`),
        '표 위 5단계 범례 1줄(ADR-0041 결정 1)');
      bump('gap');
      bump('legend', m.bandLegendItems ? m.bandLegendItems.length : 0);
      eq(`gap-share-domain:${tag}`, m.shareCaptionGap != null ? 'OK' : 'GAP_SHARE_DOMAIN_EMPTY', 'OK');
      if (m.shareCaptionGap != null) eq(`gap-share:${tag}`, m.shareCaptionGap >= -2 && m.shareCaptionGap <= 24 ? 'OK' : `${m.shareCaptionGap}px`, 'OK', `실측 ${m.shareCaptionGap}px`);
      bump('gap');
      eq(`gap-growth-domain:${tag}`, m.growthGap != null ? 'OK' : 'GAP_GROWTH_DOMAIN_EMPTY', 'OK');
      if (m.growthGap != null) eq(`gap-growth:${tag}`, m.growthGap >= -2 && m.growthGap <= 24 ? 'OK' : `${m.growthGap}px`, 'OK', `실측 ${m.growthGap}px`);
      bump('gap');

      // ═══ ellipsis 규율 — 밴드/점유율 행당 정확히 이름 1개만 ellipsis ═══════
      // 무조건 단언(⑧ⓑ) — 섹션 부재는 sentinel로 등록하고, 있을 때만 세부를 본다.
      eq(`ellipsis-band-domain:${tag}`, (m.bandRows && m.bandRows.length) ? 'OK' : 'BAND_ROWS_EMPTY', 'OK');
      if (m.bandRows && m.bandRows.length) {
        const bandBad = m.bandRows.map((r, i) => (r.name != null || r.isEmpty) ? null : `row${i}:no-name-or-empty`).filter(Boolean);
        eq(`ellipsis-band:${tag}`, bandBad, [], `밴드 행 ${m.bandRows.length}개`);
        bump('ellipsis-discipline', m.bandRows.length);
      }

      // ═══ 신규 축 ⓐ(task#304) — 기술수준 밴드가 **화면에서 읽히는가** ══════════════════════
      //   기대값은 리터럴이 아니라 픽스처(PLAYERS)에서 계산한다. 픽스처엔 tech_level 결측 행이 없으므로
      //   `—` 분기는 이 프로브의 정의역 밖이고(실데이터 판은 uat280이 덮는다) 그 사실을 sentinel로 남긴다.
      const wantLevel = new Map(PLAYERS.map(p => [p.name, p.tech_level]));
      eq(`level-band-domain:${tag}`,
        m.bandRows ? [m.bandRows.length, m.bandRows.filter(r => r.filled != null).length] : 'BAND_ROWS_NULL',
        [PLAYERS.length, PLAYERS.length], '픽스처 전 행이 tech_level을 가지므로 밴드도 전 행 렌더');
      const lvViol = (m.bandRows || []).flatMap(r => {
        const want = wantLevel.get(r.name);
        if (want == null) return [`${r.name}:NOT_IN_FIXTURE`];
        const bad = [];
        if (r.totalCells !== 5) bad.push(`${r.name}:cells=${r.totalCells}`);
        if (r.filled !== want) bad.push(`${r.name}:filled=${r.filled}!=${want}`);
        if (r.role !== 'img') bad.push(`${r.name}:role=${r.role}`);
        if (r.aria !== `${want}단계 · ${TECH_LEVEL_LABELS[want]}`) bad.push(`${r.name}:aria=${JSON.stringify(r.aria)}`);
        if (r.cellLines !== 1) bad.push(`${r.name}:LINES=${r.cellLines}(칸 묶음이 접혔다)`);
        // 화면 실측 — 선언값(6×10px)이 아니라 렌더 픽셀. 0px면 기하 축은 전부 통과하면서 화면엔 없다.
        if (!(r.cellW >= 4)) bad.push(`${r.name}:cellW=${r.cellW}(<4px)`);
        if (!(r.cellH >= 6)) bad.push(`${r.name}:cellH=${r.cellH}(<6px)`);
        return bad;
      });
      eq(`level-band:${tag}`, lvViol, [], `행 ${(m.bandRows || []).length}개 · 폭 ${JSON.stringify((m.bandRows || []).map(r => r.cellW))}`);
      bump('level-band', (m.bandRows || []).length);
      // 이빨 — 픽스처의 tech_level이 전부 같으면 위 단언은 채움 로직을 상수로 바꿔도 통과한다.
      eq(`level-band-teeth:${tag}`, new Set(PLAYERS.map(p => p.tech_level)).size >= 2 ? 'OK' : 'SINGLE_LEVEL_FIXTURE', 'OK',
        `픽스처 tech_level ${JSON.stringify(PLAYERS.map(p => p.tech_level))}`);
      eq(`ellipsis-share-domain:${tag}`, (m.shareRows && m.shareRows.length) ? 'OK' : 'SHARE_ROWS_EMPTY', 'OK');
      if (m.shareRows && m.shareRows.length) {
        const shareBad = m.shareRows.map((r, i) => r.name != null && r.pctText != null ? null : `row${i}`).filter(Boolean);
        eq(`ellipsis-share:${tag}`, shareBad, [], `점유율 행 ${m.shareRows.length}개`);
        bump('ellipsis-discipline', m.shareRows.length);
      }

      // ═══ 재사용 축 5 — 색(신규 섹션 4종, 토큰 대조 + 이빨 단언) ════════════
      // TechLevelBand: 채움 칸 vs 빈 칸(2 토큰), 선두 vs 격차 라벨(2 토큰).
      // 무조건 단언(⑧ⓑ) — 색 축 전체의 존재 여부부터 sentinel로 등록한다(섹션 부재 시 여기서 FAIL).
      eq(`color-band-section-domain:${tag}`, (m.bandRows && m.bandRows.length) ? 'OK' : 'BAND_MISSING_FOR_COLOR', 'OK');
      if (m.bandRows && m.bandRows.length) {
        const filledColors = m.bandRows.map(r => r.filledCellColor).filter(Boolean);
        const unfilledColors = m.bandRows.map(r => r.unfilledCellColor).filter(Boolean);
        eq(`color-band-domain:${tag}`, [filledColors.length, unfilledColors.length].every(n => n > 0) ? 'OK' : `EMPTY(filled=${filledColors.length},unfilled=${unfilledColors.length})`, 'OK');
        if (filledColors.length) eq(`color-band-filled:${tag}`, filledColors[0], m.tokens.data2, `--data-2=${m.tokens.data2}`);
        if (unfilledColors.length) eq(`color-band-unfilled:${tag}`, unfilledColors[0], m.tokens.border, `--border=${m.tokens.border}`);
        bump('color', filledColors.length + unfilledColors.length);
        // task#304 — 옛 밴드는 「현재 선두」를 `.tech-level-band__leader`(--accent)로, 격차를
        // `.tech-level-band__gap`(--text-3)으로 **서로 다른 색**으로 그렸다. 표에서는 둘 다 같은
        // 「선두 대비」 셀(TD_MUTED = --text-3)이라 **선두의 강조색이 사라졌다**. ADR-0041은 이 색 변화를
        // 논의하지 않았다 — 여기서는 현재 구현을 그대로 잰다(구현을 무고하지 않는다). 두 색이 같아진
        // 사실 자체는 아래 rawLog로 출력해 다음 사람이 의도인지 판단할 수 있게 남긴다.
        const leaderRow = m.bandRows.find(r => r.isLeaderRow);
        const gapRow = m.bandRows.find(r => r.gapText && r.gapText !== '현재 선두' && r.gapText !== '—');
        eq(`color-band-meta-domain:${tag}`, [!!leaderRow, !!gapRow].every(Boolean) ? 'OK' : `EMPTY(leader=${!!leaderRow},gap=${!!gapRow})`, 'OK',
          `「선두 대비」 셀 텍스트 ${JSON.stringify(m.bandRows.map(r => r.gapText))}`);
        if (leaderRow) eq(`color-band-leader:${tag}`, leaderRow.gapColor, m.tokens.text3, `--text-3=${m.tokens.text3}(표에서는 선두도 격차와 같은 셀 = 같은 색)`);
        if (gapRow) eq(`color-band-gap:${tag}`, gapRow.gapColor, m.tokens.text3, `--text-3=${m.tokens.text3}`);
        bump('color', (leaderRow ? 1 : 0) + (gapRow ? 1 : 0));
        rawLog.push(`${tag} · 선두 셀 색 ${leaderRow ? leaderRow.gapColor : 'n/a'} vs 격차 셀 색 ${gapRow ? gapRow.gapColor : 'n/a'}` +
          ` · --accent=${m.tokens.accent}(옛 밴드의 선두 강조색 — 표 흡수 후 미사용)`);
        // 이빨 — 밴드가 실제로 대조하는 3토큰이 서로 다름(같으면 위 단언들이 아무것도 안 보면서 통과한다).
        // accent는 이 계열에서 더는 비교 상대가 아니므로 4 → 3으로 줄인다(느슨화가 아니라 정의역 정정).
        const bandTokenSet = new Set([m.tokens.data2, m.tokens.border, m.tokens.text3]);
        eq(`color-band-tokens-differ:${tag}`, bandTokenSet.size, 3, `data2=${m.tokens.data2} border=${m.tokens.border} text3=${m.tokens.text3}`);
      } else {
        NOTE(`${tag} — 밴드 색 축 미검사(섹션 자체가 없음, 위 section-band sentinel이 이미 FAIL 처리)`);
      }

      // TechGraph(task#317 재작성) — SVG <text> fill 3토큰(대상/일반/폴드) 대신 **칩 색** 2토큰.
      // 폴드 칩이 사라졌으므로 그 색 축은 없다(캡·폴드 삭제, 위 갱신 절 참조).
      const flowChips = m.graphGroups.flatMap(g => g.items.map(i => ({ ...i, isTarget: g.key === 'target' })));
      eq(`color-graph-section-domain:${tag}`, flowChips.length ? 'OK' : 'GRAPH_MISSING_FOR_COLOR', 'OK');
      if (flowChips.length) {
        const targetChip = flowChips.find(c => c.isTarget);
        const regularChip = flowChips.find(c => !c.isTarget);
        eq(`color-graph-domain:${tag}`, [!!targetChip, !!regularChip].every(Boolean) ? 'OK' : `EMPTY(target=${!!targetChip},regular=${!!regularChip})`, 'OK');
        if (targetChip) eq(`color-graph-target:${tag}`, targetChip.color, m.tokens.accent, `--accent=${m.tokens.accent}(인라인 CHIP_TARGET_STYLE)`);
        if (regularChip) eq(`color-graph-regular:${tag}`, regularChip.color, m.tokens.text2, `--text-2=${m.tokens.text2}(.badge--neutral)`);
        bump('color', [targetChip, regularChip].filter(Boolean).length);
        // 이빨 — 두 토큰이 실제로 다름(같으면 위 두 단언이 아무것도 안 보면서 통과한다).
        const graphTokenSet = new Set([m.tokens.accent, m.tokens.text2]);
        eq(`color-graph-tokens-differ:${tag}`, graphTokenSet.size, 2, `accent=${m.tokens.accent} text2=${m.tokens.text2}`);
      } else {
        NOTE(`${tag} — 관계도 색 축 미검사(섹션 자체가 없음)`);
      }

      // MarketGrowthChart: Y/X축 틱·라벨 fill = --text-3. 무조건 단언(⑧ⓑ).
      eq(`color-growth-tick-domain:${tag}`, (m.growthAxis && m.growthAxis.yTickCount > 0) ? 'OK' : 'Y_TICK_DOMAIN_EMPTY', 'OK');
      if (m.growthAxis) bump('color', m.growthAxis.yTickCount);
      // task#282 S3 — 별도 CAGR 배지가 사라지고 CAGR 수치는 캡션 문자열 안에 텍스트로 들어간다.
      // 배지 자체 색 대신 그 텍스트를 담은 캡션 요소의 색을 잰다(같은 "보이는가" 관심사를
      // 새 구조로 재측정 — 축을 삭제하지 않는다).
      eq(`color-growth-caption-visible:${tag}`, m.growthCaptionColor
        ? (m.growthCaptionColor !== 'rgba(0, 0, 0, 0)' ? 'OK' : 'TRANSPARENT')
        : 'CAPTION_MISSING', 'OK', `실측 ${m.growthCaptionColor}`);
      bump('color');

      // ═══════════════════════ task#317 신규 축(관계도, SVG 기하 대체) ═══════════════════════

      // ① graph-groups — 렌더된 data-group 집합·순서 == prerequisites→target→derivatives.
      // 무조건 단언(⑧ⓑ) — 그래프 부재 자체를 sentinel로 등록한다(section-graph와 별개, 이 축 전용).
      eq(`graph-groups-domain:${tag}`, m.graphFound ? 'OK' : 'GRAPH_MISSING_FOR_GROUPS', 'OK');
      if (m.graphFound) {
        const expectedKeys = [PREREQ.length > 0 ? 'prerequisites' : null, 'target', DERIV.length > 0 ? 'derivatives' : null].filter(Boolean);
        const gotKeys = m.graphGroups.map(g => g.key);
        eq(`graph-groups:${tag}`, gotKeys, expectedKeys, '항목 0개인 그룹은 렌더 안 됨(정의역), target은 항상 렌더');
        bump('graph-groups', gotKeys.length);
      }

      // ② graph-items-set — 그룹별 칩 텍스트 집합 == related[key] 집합(리터럴 개수 없음).
      // 이 축이 캡·폴드·말줄임 부재를 한 번에 잡는다 — 잘리면 텍스트가 달라 집합이 안 맞는다.
      // missing/extra를 별도 단언으로 쪼갠다(⑧ⓕ — 어느 쪽으로 깨졌는지 실측치를 바로 읽게).
      // 무조건 단언(⑧ⓑ) — 도메인 sentinel을 그룹별로 둔다.
      const EXPECTED_GRAPH_ITEMS = { prerequisites: PREREQ, target: [TARGET_LABEL], derivatives: DERIV };
      for (const key of ['prerequisites', 'target', 'derivatives']) {
        const want = EXPECTED_GRAPH_ITEMS[key];
        eq(`graph-items-set-domain:${tag}:${key}`, want.length > 0 ? 'OK' : `EMPTY_EXPECTED(${key})`, 'OK');
        const group = m.graphFound ? m.graphGroups.find(g => g.key === key) : null;
        const got = group ? group.items.map(i => i.text) : [];
        const gotSet = new Set(got), wantSet = new Set(want);
        const missing = want.filter(w => !gotSet.has(w));
        const extra = got.filter(g => !wantSet.has(g));
        eq(`graph-items-missing:${tag}:${key}`, missing, [], `렌더 ${got.length}개 vs 기대 ${want.length}개`);
        eq(`graph-items-extra:${tag}:${key}`, extra, [], `렌더 ${JSON.stringify(got)}`);
        bump('graph-items-set', want.length);
      }

      // ③ graph-chips-set — 보완/경합 칩 텍스트 집합 == related.complements/competitors 집합.
      const EXPECTED_GRAPH_CHIPS = { complements: COMPLEMENTS, competitors: COMPETITORS };
      const GOT_GRAPH_CHIPS = { complements: m.graphComplements, competitors: m.graphCompetitors };
      for (const key of ['complements', 'competitors']) {
        const want = EXPECTED_GRAPH_CHIPS[key];
        eq(`graph-chips-set-domain:${tag}:${key}`, want.length > 0 ? 'OK' : `EMPTY_EXPECTED(${key})`, 'OK');
        const row = m.graphFound ? GOT_GRAPH_CHIPS[key] : null;
        const got = row ? row.items.map(i => i.text) : [];
        const gotSet = new Set(got), wantSet = new Set(want);
        const missing = want.filter(w => !gotSet.has(w));
        const extra = got.filter(g => !wantSet.has(g));
        eq(`graph-chips-missing:${tag}:${key}`, missing, [], `렌더 ${got.length}개 vs 기대 ${want.length}개 · 라벨="${row ? row.labelText : null}"`);
        eq(`graph-chips-extra:${tag}:${key}`, extra, [], `렌더 ${JSON.stringify(got)}`);
        bump('graph-chips-set', want.length);
      }

      // ── 연관기술 identity(task#317 적응 — 캡·폴드가 없어 「접혀서 안 보임」 개념이 사라졌고,
      //    전 항목을 개별 FOUND로 검사한다. 위 graph-items-set/graph-chips-set의 집합비교와
      //    중복이지만 실패 시 "어느 항목인지"를 바로 짚는 세분 진단이다). 무조건 단언(⑧ⓑ) —
      //    graphGroups가 비어도(옛 번들) 각 항목이 sentinel로 FAIL해 총계를 고정한다.
      const groupItemTexts = (key) => {
        const g = m.graphFound ? m.graphGroups.find(x => x.key === key) : null;
        return g ? g.items.map(i => i.text) : [];
      };
      const preTexts = groupItemTexts('prerequisites');
      for (const p of PREREQ) {
        eq(`identity-pre:${tag}:${p.slice(0, 8)}`, preTexts.includes(p) ? 'FOUND' : 'PREREQ_MISSING', 'FOUND');
        bump('identity');
      }
      const targetTexts = groupItemTexts('target');
      eq(`identity-graph-target:${tag}`, targetTexts.includes(TARGET_LABEL) ? 'FOUND' : 'TARGET_MISSING', 'FOUND');
      bump('identity');
      const derTexts = groupItemTexts('derivatives');
      for (const d of DERIV) {
        eq(`identity-der:${tag}:${d.slice(0, 8)}`, derTexts.includes(d) ? 'FOUND' : 'DERIV_MISSING', 'FOUND');
        bump('identity');
      }
      const compTexts = (m.graphFound && m.graphComplements) ? m.graphComplements.items.map(i => i.text) : [];
      for (const c of COMPLEMENTS) {
        eq(`identity-complement:${tag}:${c.slice(0, 8)}`, compTexts.includes(c) ? 'FOUND' : 'MISSING', 'FOUND');
        bump('identity');
      }
      const competTexts = (m.graphFound && m.graphCompetitors) ? m.graphCompetitors.items.map(i => i.text) : [];
      for (const c of COMPETITORS) {
        eq(`identity-competitor:${tag}:${c.slice(0, 8)}`, competTexts.includes(c) ? 'FOUND' : 'MISSING', 'FOUND');
        bump('identity');
      }

      // ④ graph-labels — 그룹 라벨 3종이 접근 가능 텍스트(aria-hidden 아님) + 화살표만 aria-hidden="true"
      //    이고 그 텍스트는 "↓"뿐. 마지막 그룹 뒤에는 화살표가 없어야 한다(짝 축).
      eq(`graph-labels-domain:${tag}`, (m.graphFound && m.graphGroups.length > 0) ? 'OK' : 'GRAPH_MISSING_FOR_LABELS', 'OK');
      if (m.graphFound && m.graphGroups.length > 0) {
        const LABEL_MAP = { prerequisites: '전제·선행', target: '대상 기술', derivatives: '파생·응용' };
        const labelBad = m.graphGroups.flatMap(g => {
          const bad = [];
          if (g.labelText !== LABEL_MAP[g.key]) bad.push(`${g.key}:label="${g.labelText}"`);
          if (g.labelAriaHidden) bad.push(`${g.key}:label-aria-hidden`);
          return bad;
        });
        eq(`graph-labels:${tag}`, labelBad, [], `그룹 ${m.graphGroups.length}개 라벨=${JSON.stringify(m.graphGroups.map(g => g.labelText))}`);
        bump('graph-labels', m.graphGroups.length);

        const nonLastGroups = m.graphGroups.slice(0, -1);
        const arrowBad = nonLastGroups.flatMap(g => {
          const bad = [];
          if (g.arrowText !== '↓') bad.push(`${g.key}:arrow-text="${g.arrowText}"`);
          if (g.arrowAriaHidden !== 'true') bad.push(`${g.key}:arrow-aria-hidden="${g.arrowAriaHidden}"`);
          return bad;
        });
        eq(`graph-arrow:${tag}`, arrowBad, [], `화살표 검사 ${nonLastGroups.length}개(마지막 그룹 제외)`);
        bump('graph-labels', nonLastGroups.length);
        const lastGroup = m.graphGroups[m.graphGroups.length - 1];
        eq(`graph-arrow-last-none:${tag}`, lastGroup.arrowText, null, '마지막 그룹 뒤에는 화살표가 없어야 한다');
        bump('graph-labels');
      } else {
        NOTE(`${tag} — ④ graph-labels 미검사(그래프 섹션 자체가 없음)`);
      }

      // ⑥ graph-no-clip — 흐름 안 전 칩이 잘리지 않는가(줄바꿈으로 흡수, 절단 메커니즘 자체가 없다).
      const allFlowChips = m.graphFound ? m.graphGroups.flatMap(g => g.items) : [];
      eq(`graph-no-clip-domain:${tag}`, allFlowChips.length > 0 ? 'OK' : 'GRAPH_NO_CLIP_DOMAIN_EMPTY', 'OK');
      if (allFlowChips.length > 0) {
        const clipped = allFlowChips.filter(c => c.scrollW > c.clientW + 1);
        eq(`graph-no-clip:${tag}`, clipped.map(c => `${c.text}(${c.scrollW}>${c.clientW})`), [], `검사 ${allFlowChips.length}개 칩`);
        bump('graph-no-clip', allFlowChips.length);
      } else {
        NOTE(`${tag} — ⑥ graph-no-clip 미검사(그래프 섹션 자체가 없음)`);
      }

      // ③ recharts 대상 특정은 기하(x-클러스터)로 — 클래스 계층 의존 금지. 무조건 단언(⑧ⓑ).
      eq(`chart-axis-section-domain:${tag}`, m.growthAxis ? 'OK' : 'SURFACE_MISSING_FOR_AXIS', 'OK');
      if (m.growthAxis) {
        eq(`chart-yaxis-cluster:${tag}`, m.growthAxis.yTickCount >= 2 ? 'OK' : `Y_CLUSTER_TOO_SMALL(${m.growthAxis.yTickCount})`, 'OK',
          `Y축 틱 실측: ${JSON.stringify(m.growthAxis.yTickTexts)}`);
        bump('chart-axis');
        // Y틱은 formatMarketSize를 통과하므로(USD/bn 픽스처) $로 시작해야 한다(리터럴 숫자 아님, 형식 불변식).
        const badYTicks = m.growthAxis.yTickTexts.filter(t => !/^\$[\d.,]+[A-Za-z]*$/.test(t));
        eq(`chart-yaxis-format:${tag}`, badYTicks, [], `검사 ${m.growthAxis.yTickTexts.length}건`);
        bump('chart-axis', m.growthAxis.yTickTexts.length);
        // X축(연도) — 클러스터 밖으로 걸러진 후보 중 픽스처 연도가 전부 있는가(내용 기반, 클래스 무관).
        const years = ['2021', '2024', '2027', '2030'];
        const missingYears = years.filter(y => !m.growthAxis.xTickCandidates.includes(y));
        eq(`chart-xaxis-years:${tag}`, missingYears, [], `후보 ${JSON.stringify(m.growthAxis.xTickCandidates)}`);
        bump('chart-axis');
        // Y축 라벨(회전된 축 제목) — 내용으로 특정(클래스 무관), 잘림 축5(⑦남긴 함정#1)의 실측 처리.
        eq(`chart-ylabel-found:${tag}`, m.growthAxis.yLabelFound ? 'FOUND' : 'YLABEL_MISSING', 'FOUND', `axisUnit="${AXIS_UNIT}"`);
        bump('chart-axis');
        if (m.growthAxis.yLabelFound && m.growthRootLeft != null) {
          // 회전된 라벨이 차트 컨테이너 좌측 밖으로 크게 새지 않는가(overflow 축, 축1의 SVG 적용).
          const bleed = m.growthRootLeft - m.growthAxis.yLabelRect.left;
          eq(`chart-ylabel-bleed:${tag}`, bleed <= 20 ? 'OK' : `${bleed}px`, 'OK', `라벨left=${m.growthAxis.yLabelRect.left} 컨테이너left=${m.growthRootLeft}`);
          bump('chart-axis');
        }
      } else {
        NOTE(`${tag} — ③ recharts 대상 특정 미검사(성장 차트 섹션 자체가 없거나 recharts-surface 미검출)`);
      }

      // ④ 실선/점선 구분 — hist(실측)=none, fcst(예상)=dasharray 존재. JSX 순서 그대로 매칭.
      // 무조건 단언(⑧ⓑ) — 도메인 sentinel을 if 밖으로.
      eq(`line-style-domain:${tag}`, (m.growthLines && m.growthLines.length >= 2) ? 'OK' : `LINE_DOMAIN_EMPTY_OR_TOO_SMALL(${m.growthLines ? m.growthLines.length : 'null'})`, 'OK');
      if (m.growthLines && m.growthLines.length >= 2) {
        // 판별자는 최소 대시 조각(위 수집부 주석) — 실측치를 항별로 출력해 무엇을 봤는지 남긴다(⑧ⓕ/ⓗ).
        const meas = m.growthLines.map(l => `minSeg=${l.minSeg}·segs=${l.segCount}`).join(' | ');
        const h = m.growthLines[0], f = m.growthLines[1];
        eq(`line-style-hist-solid:${tag}`,
          (h.minSeg == null || h.minSeg >= 20) ? 'SOLID' : `DASHED_UNEXPECTED(minSeg=${h.minSeg})`, 'SOLID', meas);
        eq(`line-style-fcst-dashed:${tag}`,
          (f.minSeg != null && f.minSeg <= 10) ? 'DASHED' : `SOLID_UNEXPECTED(minSeg=${f.minSeg})`, 'DASHED', meas);
        // 이빨: 두 선의 판별자가 실제로 서로 달라야 한다(같으면 축이 아무것도 안 보면서 통과한다).
        eq(`line-style-differ:${tag}`, h.minSeg !== f.minSeg ? 'DIFFER' : 'SAME_SUSPECT', 'DIFFER', meas);
        bump('line-style', 3);
      }

      // task#317 — 옛 "연관기술 접힘 불변식"(fold-section-domain·fold-invariant·fold-node-count·
      // der-no-fold)은 여기 있었고 **완전 삭제**했다 — 캡·폴드 자체가 사라져 "shown+hidden==total"
      // 같은 불변식이 성립할 대상이 없다(hidden이 항상 0). "연관기술 identity"는 위 ②(graph-items-set)
      // 블록 안으로 옮기고 **적응**했다(캡이 없으므로 PREREQ.slice(0,4) 같은 부분슬라이스 없이 전 항목).

      // ── 시장 요약 캡션 — 리터럴 대신 픽스처에서 계산한 기대값(uat276 관용구). 무조건 단언(⑧ⓑ).
      eq(`growth-caption:${tag}`, m.growthCaptionText ?? 'CAPTION_MISSING', GROWTH_CAPTION_EXPECTED);
      // task#282 S3 — 별도 CAGR 배지 testid가 사라지고 CAGR 수치는 캡션 문자열 안에 있다(위
      // growth-caption 전체일치가 이미 덮지만, 캡션 포맷이 바뀌어도 "CAGR 수치가 어딘가엔 있다"를
      // 독립으로 지키도록 부분일치로 남긴다 — 축을 삭제하지 않고 새 구조를 재게 고친다).
      eq(`growth-cagr-text:${tag}`, (m.growthCaptionText ?? '').includes(`CAGR ${MARKET.cagr_pct}%`) ? 'FOUND' : 'CAGR_TEXT_MISSING', 'FOUND');

      // ── 콘솔 에러 ──
      eq(`console:${tag}`, errs, [], '주입 화면');
      bump('console');

      // ── 육안 스크린샷 — 밴드 셀(대비 위험, S3 DoD → task#304: 대상이 표다) + 관계도(전용 캡처) ──
      await page.evaluate(() => document.querySelector('[data-testid="tech-report-players"]')?.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${V.key}-${THEME}-band.png`, fullPage: false });
      await page.evaluate(() => document.querySelector('[data-testid="tech-graph"]')?.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${V.key}-${THEME}-graph.png`, fullPage: false });
    } catch (e) {
      eq(`exception:${tag}`, `THROWN:${e && e.message}`, 'NO_EXCEPTION');
      bump('exception');
    }
    await page.close();
    await ctx.close();
  }
}

// ── 별도 패스 — share_pct 전무(ShareChart 섹션 생략, plan S2 완료기준 ②) ─────────────
{
  const tag = 'pc/light/no-share';
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  await ctx.addInitScript(([a, r]) => {
    localStorage.setItem('access_token', a); localStorage.setItem('refresh_token', r);
    localStorage.setItem('theme', 'light');
  }, [access_token, refresh_token]);
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push(String(e)));
  try {
    let intercepted = false;
    await page.route(`**/api/tech-reports/${SLUG2}`, async (route) => {
      intercepted = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ slug: SLUG2, reports: [DETAIL_REPORT2] }) });
    });
    await page.route('**/api/stocks', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STOCKS_FIXTURE) });
    });
    await page.goto(`${BASE}/tech-report/${SLUG2}`, { waitUntil: 'networkidle' }).catch((e) => errs.push(`goto:${e}`));
    await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0).catch(() => {});
    await page.waitForTimeout(1200);

    eq(`intercept:${tag}`, intercepted ? 'FIRED' : 'ROUTE_NOT_INTERCEPTED', 'FIRED');
    bump('intercept');

    let m = await measureDetail(page);
    if (!m.found) { await page.waitForTimeout(1800); m = await measureDetail(page); }
    eq(`section:${tag}`, m.found ? 'PRESENT' : 'SECTION_MISSING', 'PRESENT');
    bump('section');

    if (m.found) {
      eq(`identity:${tag}`, m.allText.includes(DETAIL_REPORT2.title) ? 'FOUND' : 'TITLE_MISSING', 'FOUND');
      bump('identity');
      // 대조 먼저 — 같은 픽스처에서 tech_level은 그대로라 기술수준 밴드 셀/성장차트는 여전히 있어야
      // 한다(share_pct와 무관). task#304 — 대조 대상이 「밴드 섹션 존재」에서 「표에 밴드 셀이 렌더됨」
      // 으로 옮겼다. 섹션 존재만 보면 흡수 후 그 대조가 영원히 FAIL해 share 부재 판정이 통째로
      // CANNOT_VERIFY가 된다(대조군이 죽으면 목표 단언도 죽는다 — 가토 ⑧ⓔ).
      const bandCellsAlive = !!m.bandRows && m.bandRows.length > 0 && m.bandRows.every(r => r.totalCells === 5);
      eq(`band-still-present:${tag}`, bandCellsAlive ? 'PRESENT' : `BAND_CELLS_MISSING(${JSON.stringify((m.bandRows || []).map(r => r.totalCells))})`, 'PRESENT',
        '대조 — share_pct와 무관한 표면(기술수준 밴드 셀)');
      eq(`growth-still-present:${tag}`, m.growthFound ? 'PRESENT' : 'GROWTH_MISSING', 'PRESENT', '대조 — share_pct와 무관한 섹션');
      bump('section', 2);
      // 목표 단언(plan S2 완료기준 ②) — share_pct 전무면 ShareChart 섹션 자체가 없어야 한다.
      // ⚠️ "부재 확인"은 그래프 부재와 같은 함정(위 graph-items-set 등 domain sentinel과 같은 원리) — 페이지 자체가 아직
      // 미배포라 아무 섹션도 없는 상태에서는 shareFound=false가 "옳게 생략됨"과 구별되지 않는다.
      // 대조(band/growth still-present)가 실제로 PASS해야만("컨트롤이 살아있다") 이 판정이 의미를 가진다 —
      // 그래서 대조가 실패 중이면 이 단언도 검증불가로 FAIL시켜 공허통과를 막는다.
      const controlsOk = bandCellsAlive && m.growthFound;
      const shareAbsentGot = !controlsOk ? 'CANNOT_VERIFY_CONTROLS_MISSING' : (m.shareFound ? 'UNEXPECTEDLY_PRESENT' : 'ABSENT');
      eq(`share-section-absent:${tag}`, shareAbsentGot, 'ABSENT',
        'players 전원 share_pct=null → ShareChart는 null을 반환해야 함(코드: rows.length===0 → return null)');
      bump('section');
      eq(`console:${tag}`, errs, [], '주입 화면');
      bump('console');
      await page.evaluate(() => document.querySelector('[data-testid="tech-report-players"]')?.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/pc-light-no-share.png`, fullPage: false });
    } else {
      eq(`console:${tag}`, errs, [], '측정 불가 화면(참고용)');
      bump('console');
    }
  } catch (e) {
    eq(`exception:${tag}`, `THROWN:${e && e.message}`, 'NO_EXCEPTION');
    bump('exception');
  }
  await page.close();
  await ctx.close();
}

await browser.close();

// ── 보고 ──────────────────────────────────────────────────────────────────────
const fails = results.filter(r => !r.ok);
console.log('\n' + '═'.repeat(72));
console.log('커버리지 (계열별 검사 수 — 재실행 간 비교용):');
for (const [k, v] of Object.entries(cov).sort()) console.log(`  ${k.padEnd(26)} ${v}`);
console.log(`\n단언 총계: ${results.length}건 · PASS ${results.length - fails.length} · FAIL ${fails.length}`);
console.log('\n실측 원시 로그(단언 아님 — 밴드 흡수로 색 구분이 사라진 자리 등):');
for (const l of rawLog) console.log(`  ${l}`);
console.log('※ OR로 묶은 단언 없음(모든 축이 독립 단언 또는 명시적 domain sentinel).');
console.log('※ 주입 화면 — 실발행 아님. prod tech_reports 무쓰기(이 스크립트는 GET만 호출).');
console.log('═'.repeat(72));
if (fails.length) {
  console.log('\nFAIL 상세:');
  for (const f of fails) console.log(`  ✗ ${f.tag}\n      ${f.msg}`);
  process.exit(1);
}
console.log('\nALL PASS');
for (const r of results) console.log(`  ✓ ${r.tag} — ${r.msg}`);
