// task#277 S5 라이브 UAT — 선도기술 리포트 상세: 시장 성장 차트 · 점유율 · 기술수준 밴드 · 3열 관계도.
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
//   - techGraphLayout의 capColumn: MAX_PER_COL=5 → shown=slice(0,4), overflow=len-4.
//     **⚠️ 계획 문서(.forge/plan.md S4 완료기준 서술 "6노드 입력에서 5노드 + `+1개` 접힘")는 부정확하다.**
//     TechGraph.test.jsx:74-87(이미 vitest green)이 못박은 실제 값은 "6개 입력 → 4개 노출 + 폴드 1개
//     = 5노드, 폴드 라벨 `+2개`"다(overflow = 6 - 4 = 2, "+1개"가 아니라 "+2개"). 이 스크립트는
//     **코드/테스트 쪽 진실("+2개")을 기준으로 픽스처·단언을 짠다** — 계획 문서의 오기를 따라가지 않는다.
//
// 판정축 — 재사용 4계열(uat276 관용구 그대로: 잘림 2계열·줄 수·간격·색, 각 정의역 sentinel과 짝) +
// task#277 신규 4계열(①관계도 기하 ②CJK 실측(getComputedTextLength, jsdom 폴백 아닌 라이브 실측)
// ③recharts 대상은 기하(x-클러스터)로 특정 ④실선/점선). 신뢰성 규칙(⑧ⓑ 무조건 단언·sentinel FAIL,
// ⑧ⓐ 커버리지, ⑧ⓘ 대상 identity 우선, ⑧ⓛ 정의역 명시)은 uat275/276과 동형.
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
    data2: readBgToken('--data-2'), border: readBgToken('--border'),
    tagHold: readToken('--tag-hold-color'), tagWatch: readToken('--tag-watch-color'),
  };

  // ── ① 기술수준 밴드 (S3) ──────────────────────────────────────────────
  const bandEl = root.querySelector('[data-testid="tech-level-band"]');
  const bandRows = bandEl ? [...bandEl.querySelectorAll('[data-testid="tech-level-band-row"]')].map(row => {
    const nameEl = row.querySelector('.tech-level-band__name');
    const cellsEl = row.querySelector('.tech-level-band__cells');
    const filled = cellsEl ? cellsEl.querySelectorAll('.tech-level-band__cell--filled').length : null;
    const totalCells = cellsEl ? cellsEl.querySelectorAll('.tech-level-band__cell').length : null;
    const emptyEl = row.querySelector('.tech-level-band__empty');
    const leaderEl = row.querySelector('.tech-level-band__leader');
    const gapEl = row.querySelector('.tech-level-band__gap');
    const filledCellColor = filled > 0 ? cs(cellsEl.querySelector('.tech-level-band__cell--filled')).backgroundColor : null;
    const unfilledCellEl = cellsEl ? cellsEl.querySelector('.tech-level-band__cell:not(.tech-level-band__cell--filled)') : null;
    return {
      name: nameEl ? txt(nameEl) : null,
      filled, totalCells, isEmpty: !!emptyEl,
      leaderColor: leaderEl ? cs(leaderEl).color : null,
      gapColor: gapEl ? cs(gapEl).color : null,
      filledCellColor, unfilledCellColor: unfilledCellEl ? cs(unfilledCellEl).backgroundColor : null,
    };
  }) : null;
  const bandLegendEl = bandEl ? bandEl.querySelector('.tech-level-band__legend') : null;
  let bandLegendGap = null;
  if (bandLegendEl && bandRows && bandRows.length) {
    const firstRowEl = bandEl.querySelector('[data-testid="tech-level-band-row"]');
    bandLegendGap = Math.round(firstRowEl.getBoundingClientRect().top - bandLegendEl.getBoundingClientRect().bottom);
  }

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

  // ── ⑤ 관계도 (S4) — 노드 rect/text 실측(px 변환 없이 SVG 로컬 좌표 그대로) ──────
  const graphEl = root.querySelector('[data-testid="tech-graph"]');
  const svgEl = graphEl ? graphEl.querySelector('[data-testid="tech-graph-svg"]') : null;
  let graphNodes = null, graphEdges = null, graphViewBox = null;
  if (svgEl) {
    const vb = svgEl.getAttribute('viewBox').split(/\s+/).map(Number);
    graphViewBox = { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
    // 숨은 SVG <text>로 "완전한(미절단)" 라벨의 실제 렌더 폭을 잰다(컴포넌트 자신의 truncateLabel과
    // 같은 기법 — 라이브 브라우저이므로 getComputedTextLength가 실측된다, jsdom 폴백 경로 아님).
    const measureEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    measureEl.setAttribute('font-size', '12');
    svgEl.appendChild(measureEl);
    const fullTextLen = (str) => { measureEl.textContent = str; return measureEl.getComputedTextLength(); };
    graphNodes = [...svgEl.querySelectorAll('[data-testid="tech-graph-node"]')].map(g => {
      const rect = g.querySelector('rect');
      const textEl = g.querySelector('text');
      const titleEl = g.querySelector('title');
      const x = +rect.getAttribute('x'), y = +rect.getAttribute('y'), w = +rect.getAttribute('width'), h = +rect.getAttribute('height');
      const visibleLabel = txt(textEl);
      const fullLabel = titleEl ? txt(titleEl) : visibleLabel;
      return {
        id: g.getAttribute('data-node-id'), col: Number(g.getAttribute('data-col')),
        x, y, w, h,
        visibleLabel, fullLabel,
        wasTruncated: visibleLabel !== fullLabel,
        visibleLen: textEl.getComputedTextLength(),
        fullLen: fullTextLen(fullLabel),
        textFill: cs(textEl).fill,
        // ⚠️ 위 x/y/w/h·visibleLen은 전부 **viewBox 좌표계**다 — `width:100%` + 고정 viewBox면
        // 화면 픽셀은 컨테이너 폭에 비례해 줄어드는데 viewBox 좌표는 그대로라, 기존 기하·잘림 축이
        // **전부 통과하면서 모바일에서 못 읽는** 상태가 성립한다(실측 task#277: 350px에서 6px).
        // → 화면 실측 높이를 별도로 싣는다(bbox는 viewBox 스케일이 반영된다).
        renderedTextH: +textEl.getBoundingClientRect().height.toFixed(1),
        isFold: g.getAttribute('data-node-id')?.endsWith('-more') ?? false,
        isTarget: g.getAttribute('data-node-id') === 'target',
      };
    });
    measureEl.remove();
    graphEdges = [...svgEl.children].filter(c => c.tagName === 'path').map(p => {
      const d = p.getAttribute('d');
      const nums = (d.match(/-?\d+\.?\d*/g) || []).map(Number);
      // d = "M x1,y1 C mx,y1 mx,y2 x2,y2" → 8 numbers: [x1,y1, mx,y1, mx,y2, x2,y2]
      const xs = [nums[0], nums[2], nums[4], nums[6]];
      const ys = [nums[1], nums[3], nums[5], nums[7]];
      return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    });
  }
  const complementsEl = graphEl ? graphEl.querySelector('[data-testid="tech-graph-complements"]') : null;
  const competitorsEl = graphEl ? graphEl.querySelector('[data-testid="tech-graph-competitors"]') : null;

  return {
    found: true, rootRight: Math.round(rr.right),
    items, clippers, allText: root.textContent, tokens,
    bandFound: !!bandEl, bandRows, bandLegendGap,
    shareFound: !!shareEl, shareRows, shareCaptionGap,
    growthFound: !!growthEl, growthEmpty: !!growthEmptyEl,
    growthCaptionText: growthCaptionEl ? txt(growthCaptionEl) : null,
    growthCaptionColor,
    growthAxis, growthLines, growthGap,
    growthRootRight: growthRootRect ? Math.round(growthRootRect.right) : null,
    growthRootLeft: growthRootRect ? Math.round(growthRootRect.left) : null,
    graphFound: !!graphEl, graphNodes, graphEdges, graphViewBox,
    complementsText: complementsEl ? txt(complementsEl) : null,
    competitorsText: competitorsEl ? txt(competitorsEl) : null,
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
      eq(`section-band:${tag}`, m.bandFound ? 'PRESENT' : 'BAND_MISSING', 'PRESENT');
      bump('section');
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
      eq(`gap-band-domain:${tag}`, m.bandLegendGap != null ? 'OK' : 'GAP_BAND_DOMAIN_EMPTY', 'OK');
      if (m.bandLegendGap != null) eq(`gap-band:${tag}`, m.bandLegendGap >= -2 && m.bandLegendGap <= 24 ? 'OK' : `${m.bandLegendGap}px`, 'OK', `실측 ${m.bandLegendGap}px`);
      bump('gap');
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
        const leaderRow = m.bandRows.find(r => r.leaderColor);
        const gapRow = m.bandRows.find(r => r.gapColor);
        eq(`color-band-meta-domain:${tag}`, [!!leaderRow, !!gapRow].every(Boolean) ? 'OK' : `EMPTY(leader=${!!leaderRow},gap=${!!gapRow})`, 'OK');
        if (leaderRow) eq(`color-band-leader:${tag}`, leaderRow.leaderColor, m.tokens.accent, `--accent=${m.tokens.accent}`);
        if (gapRow) eq(`color-band-gap:${tag}`, gapRow.gapColor, m.tokens.text3, `--text-3=${m.tokens.text3}`);
        bump('color', (leaderRow ? 1 : 0) + (gapRow ? 1 : 0));
        // 이빨 — 4토큰이 서로 다름(같으면 위 단언들이 아무것도 안 보면서 통과한다).
        const bandTokenSet = new Set([m.tokens.data2, m.tokens.border, m.tokens.accent, m.tokens.text3]);
        eq(`color-band-tokens-differ:${tag}`, bandTokenSet.size, 4, `data2=${m.tokens.data2} border=${m.tokens.border} accent=${m.tokens.accent} text3=${m.tokens.text3}`);
      } else {
        NOTE(`${tag} — 밴드 색 축 미검사(섹션 자체가 없음, 위 section-band sentinel이 이미 FAIL 처리)`);
      }

      // TechGraph: target/일반/폴드 노드 텍스트 fill(3 토큰) + 이빨.
      eq(`color-graph-section-domain:${tag}`, (m.graphNodes && m.graphNodes.length) ? 'OK' : 'GRAPH_MISSING_FOR_COLOR', 'OK');
      if (m.graphNodes && m.graphNodes.length) {
        const targetNode = m.graphNodes.find(n => n.isTarget);
        const foldNode = m.graphNodes.find(n => n.isFold);
        const regularNode = m.graphNodes.find(n => !n.isTarget && !n.isFold);
        eq(`color-graph-domain:${tag}`, [!!targetNode, !!foldNode, !!regularNode].every(Boolean) ? 'OK' : `EMPTY(target=${!!targetNode},fold=${!!foldNode},regular=${!!regularNode})`, 'OK');
        if (targetNode) eq(`color-graph-target:${tag}`, targetNode.textFill, m.tokens.accent, `--accent=${m.tokens.accent}`);
        if (regularNode) eq(`color-graph-regular:${tag}`, regularNode.textFill, m.tokens.text, `--text=${m.tokens.text}`);
        if (foldNode) eq(`color-graph-fold:${tag}`, foldNode.textFill, m.tokens.text3, `--text-3=${m.tokens.text3}`);
        bump('color', [targetNode, regularNode, foldNode].filter(Boolean).length);
        const graphTokenSet = new Set([m.tokens.accent, m.tokens.text, m.tokens.text3]);
        eq(`color-graph-tokens-differ:${tag}`, graphTokenSet.size, 3, `accent=${m.tokens.accent} text=${m.tokens.text} text3=${m.tokens.text3}`);
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

      // ═══════════════════════ task#277 신규 축 ①②③④ ═══════════════════════

      // ① 관계도 기하 — 4모서리가 viewBox 안 · 같은 열 노드 교차 0 · 엣지 bbox가 무관노드와 교차 0.
      // 무조건 단언(⑧ⓑ) — 그래프 부재 자체를 sentinel로 등록한다(section-graph와 별개로, 이 축 전용).
      eq(`graph-geometry-domain:${tag}`, (m.graphViewBox && m.graphNodes && m.graphNodes.length > 0) ? 'OK' : 'GRAPH_MISSING_FOR_GEOMETRY', 'OK');
      if (m.graphViewBox && m.graphNodes) {
        const vb = m.graphViewBox;
        const EPS = 0.5;
        const outOfBounds = m.graphNodes.filter(n =>
          n.x < -EPS || n.y < -EPS || n.x + n.w > vb.w + EPS || n.y + n.h > vb.h + EPS);
        eq(`graph-bounds:${tag}`, outOfBounds.map(n => `${n.id}(x=${n.x},y=${n.y},x+w=${n.x + n.w},y+h=${n.y + n.h})`), [],
          `검사 ${m.graphNodes.length}노드 · viewBox=${vb.w}x${vb.h}`);
        bump('graph-bounds', m.graphNodes.length);

        // ⭐ 가독성 축 — 기하가 아니라 **화면 픽셀**을 잰다. 위 bounds·잘림·겹침 축은 전부 viewBox
        // 좌표계라 `width:100%`+고정 viewBox의 축소를 원리적으로 못 본다(499단언 ALL PASS인데
        // 350px에서 6px로 렌더돼 육안이 유일한 포착 수단이었다 — 가토 ⑩의 5번째 발생).
        // 육안으로 잡은 결함은 축으로 승격한다: 다음번엔 육안에 기대지 않는다.
        const MIN_TEXT_H = 10;   // 한글 라벨이 읽히는 실질 하한(12px 선언 기준 스케일 0.83)
        const tooSmall = m.graphNodes
          .filter(n => n.renderedTextH != null && n.renderedTextH < MIN_TEXT_H)
          .map(n => `${n.id}(${n.renderedTextH}px)`);
        eq(`graph-text-legible:${tag}`, tooSmall, [],
          `실측 높이 ${JSON.stringify(m.graphNodes.map(n => n.renderedTextH))} · 하한 ${MIN_TEXT_H}px`);
        bump('graph-text-legible', m.graphNodes.length);

        const cols = [0, 1, 2];
        const overlapsByCol = [];
        for (const col of cols) {
          const rows = m.graphNodes.filter(n => n.col === col).sort((a, b) => a.y - b.y);
          for (let i = 1; i < rows.length; i++) {
            if (rows[i].y < rows[i - 1].y + rows[i - 1].h - EPS) overlapsByCol.push(`col${col}:${rows[i - 1].id}~${rows[i].id}`);
          }
        }
        eq(`graph-col-overlap:${tag}`, overlapsByCol, [], `검사 ${m.graphNodes.length}노드(3열)`);
        bump('graph-col-overlap', m.graphNodes.length);

        // 엣지 라벨은 이 구현엔 없다(techGraphLayout 소스 확인 — edges:{from,to,path}뿐, label 필드 없음).
        // 대신 엣지 path의 bbox(베지어는 항상 자기 제어점의 convex hull 안 — 안전한 초과-근사)가
        // 자신과 무관한 노드(from/to가 아닌 노드) rect와 겹치지 않는지를 잰다(더 실질적인 대체 축).
        if (m.graphEdges && m.graphEdges.length) {
          const edgeOverlaps = [];
          m.graphEdges.forEach((e, i) => {
            m.graphNodes.forEach(n => {
              const xOverlap = e.minX < n.x + n.w - EPS && n.x < e.maxX - EPS;
              const yOverlap = e.minY < n.y + n.h - EPS && n.y < e.maxY - EPS;
              if (xOverlap && yOverlap) edgeOverlaps.push(`edge${i}~${n.id}`);
            });
          });
          eq(`graph-edge-node-overlap:${tag}`, edgeOverlaps, [], `검사 엣지${m.graphEdges.length}×노드${m.graphNodes.length}`);
          bump('graph-edge-overlap', m.graphEdges.length);
        }
        eq(`graph-edge-domain:${tag}`, m.graphEdges && m.graphEdges.length > 0 ? 'OK' : 'GRAPH_EDGE_DOMAIN_EMPTY', 'OK');
      } else {
        NOTE(`${tag} — ① 관계도 기하 미검사(그래프 섹션 자체가 없음)`);
      }

      // ② CJK 실측 — 라이브 브라우저 getComputedTextLength(추정 아님). 시각 폭 <= 가용폭(w-2*PAD_X)
      //    + 절단 여부(fullLen>avail ⇔ wasTruncated)까지 뒤집어 확인(과잉절단·누락절단 둘 다 잡는다).
      // 무조건 단언(⑧ⓑ).
      eq(`cjk-section-domain:${tag}`, (m.graphNodes && m.graphNodes.length > 0) ? 'OK' : 'GRAPH_MISSING_FOR_CJK', 'OK');
      if (m.graphNodes && m.graphNodes.length) {
        const PAD_X = 10; // TechGraph.jsx의 PAD_X 상수 미러
        const TOL = 2; // 서브픽셀 라운딩 여유
        const overflowing = m.graphNodes.filter(n => n.visibleLen > (n.w - 2 * PAD_X) + TOL);
        eq(`cjk-fit:${tag}`, overflowing.map(n => `${n.id}(len=${n.visibleLen.toFixed(1)}>avail=${(n.w - 2 * PAD_X).toFixed(1)})`), [],
          `검사 ${m.graphNodes.length}노드`);
        bump('cjk-fit', m.graphNodes.length);
        const inconsistent = m.graphNodes.filter(n => n.wasTruncated !== (n.fullLen > (n.w - 2 * PAD_X) + TOL));
        eq(`cjk-truncation-consistency:${tag}`, inconsistent.map(n => `${n.id}(wasTruncated=${n.wasTruncated},fullLen=${n.fullLen.toFixed(1)},avail=${(n.w - 2 * PAD_X).toFixed(1)})`), [],
          '절단 여부가 실측 폭과 정합하는가(과잉·누락 절단 둘 다 검출)');
        bump('cjk-truncation', m.graphNodes.length);
        // CASC(전각 다수 포함, 아주 긴 이름)와 대응하는 pre* 픽스처는 노드 라벨이 아니라 플레이어명 —
        // 실제 CJK 폭 자극은 6개 전제 라벨 자체가 전부 한글이라는 사실만으로 충분(라틴 폴백 없음).
        eq(`cjk-domain:${tag}`, m.graphNodes.length >= 5 ? 'OK' : `CJK_DOMAIN_TOO_SMALL(${m.graphNodes.length})`, 'OK');
      } else {
        NOTE(`${tag} — ② CJK 실측 미검사(그래프 섹션 자체가 없음)`);
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

      // ── 연관기술 접힘 불변식 — 전제 6개 = 노출 4 + 폴드라벨의 숫자(리터럴 "+2개" 아니라 불변식) ──
      // 무조건 단언(⑧ⓑ).
      eq(`fold-section-domain:${tag}`, (m.graphNodes && m.graphNodes.length > 0) ? 'OK' : 'GRAPH_MISSING_FOR_FOLD', 'OK');
      if (m.graphNodes && m.graphNodes.length) {
        const col0 = m.graphNodes.filter(n => n.col === 0);
        const foldNode = col0.find(n => n.isFold);
        const shownCount = col0.filter(n => !n.isFold).length;
        const foldMatch = foldNode ? foldNode.visibleLabel.match(/^\+(\d+)개$/) : null;
        const hiddenCount = foldMatch ? Number(foldMatch[1]) : null;
        eq(`fold-invariant:${tag}`, shownCount + (hiddenCount ?? 0), PREREQ.length,
          `shown=${shownCount} hidden=${hiddenCount} foldLabel="${foldNode?.visibleLabel}"`);
        bump('fold');
        eq(`fold-node-count:${tag}`, col0.length, 5, '열당 최대 5노드(4노출+폴드1)');
        // 파생(3개, fold 없음) — 대조.
        const col2 = m.graphNodes.filter(n => n.col === 2);
        eq(`der-no-fold:${tag}`, col2.length, DERIV.length, 'derivatives는 3개뿐이라 fold 없음(대조)');
      }

      // ── 연관기술 identity — 노출된 4개 전제 + 3개 파생 + 칩(보완/경합) 전부 FOUND, 접힌 2개는 부재 확인 ──
      // 무조건 단언(⑧ⓑ) — graphNodes가 null이어도 각 항목이 sentinel로 FAIL해 총계를 고정한다.
      for (const p of PREREQ.slice(0, 4)) {
        const found = m.graphNodes ? m.graphNodes.some(n => n.fullLabel === p) : false;
        eq(`identity-pre:${tag}:${p.slice(0, 8)}`, found ? 'FOUND' : 'PREREQ_MISSING', 'FOUND');
        bump('identity');
      }
      for (const p of PREREQ.slice(4)) {
        // ⚠️ "부재 확인"은 그래프 자체가 없어도 공허하게 통과한다(m.graphNodes=null이면 foundAsNode는
        // 항상 false) — graph-geometry-domain이 OK일 때만 의미 있는 판정으로 좁힌다(share-section-absent와
        // 동일한 함정: 무언가의 부재를 확인하는 축은 "전부 안 그려짐"과 "정확히 그 항목만 없음"을
        // 구별하지 못하면 배포 전에도 거짓으로 통과한다).
        const domainOk = !!(m.graphNodes && m.graphNodes.length);
        const got = !domainOk ? 'CANNOT_VERIFY_GRAPH_MISSING' : (m.graphNodes.some(n => n.fullLabel === p) ? 'UNEXPECTEDLY_SHOWN' : 'CORRECTLY_HIDDEN');
        eq(`identity-pre-folded:${tag}:${p.slice(0, 8)}`, got, 'CORRECTLY_HIDDEN',
          '6번째 전제 초과분 — 폴드에 접혀 개별 노드로 안 보여야 한다(그래프 부재 시엔 검증 불가로 FAIL, 공허통과 방지)');
        bump('identity');
      }
      for (const d of DERIV) {
        const found = m.graphNodes ? m.graphNodes.some(n => n.fullLabel === d) : false;
        eq(`identity-der:${tag}:${d.slice(0, 8)}`, found ? 'FOUND' : 'DERIV_MISSING', 'FOUND');
        bump('identity');
      }
      for (const c of COMPLEMENTS) {
        eq(`identity-complement:${tag}:${c.slice(0, 8)}`, (m.complementsText ?? '').includes(c) ? 'FOUND' : 'MISSING', 'FOUND');
        bump('identity');
      }
      for (const c of COMPETITORS) {
        eq(`identity-competitor:${tag}:${c.slice(0, 8)}`, (m.competitorsText ?? '').includes(c) ? 'FOUND' : 'MISSING', 'FOUND');
        bump('identity');
      }

      // ── 시장 요약 캡션 — 리터럴 대신 픽스처에서 계산한 기대값(uat276 관용구). 무조건 단언(⑧ⓑ).
      eq(`growth-caption:${tag}`, m.growthCaptionText ?? 'CAPTION_MISSING', GROWTH_CAPTION_EXPECTED);
      // task#282 S3 — 별도 CAGR 배지 testid가 사라지고 CAGR 수치는 캡션 문자열 안에 있다(위
      // growth-caption 전체일치가 이미 덮지만, 캡션 포맷이 바뀌어도 "CAGR 수치가 어딘가엔 있다"를
      // 독립으로 지키도록 부분일치로 남긴다 — 축을 삭제하지 않고 새 구조를 재게 고친다).
      eq(`growth-cagr-text:${tag}`, (m.growthCaptionText ?? '').includes(`CAGR ${MARKET.cagr_pct}%`) ? 'FOUND' : 'CAGR_TEXT_MISSING', 'FOUND');

      // ── 콘솔 에러 ──
      eq(`console:${tag}`, errs, [], '주입 화면');
      bump('console');

      // ── 육안 스크린샷 — 밴드(대비 위험, S3 DoD) + 관계도(scrollIntoView 후 전용, 프레임 밖 무의미) ──
      await page.evaluate(() => document.querySelector('[data-testid="tech-level-band"]')?.scrollIntoView({ block: 'center' }));
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
      // 대조 먼저 — 같은 픽스처에서 tech_level은 그대로라 밴드/성장차트는 여전히 있어야 한다(share_pct와 무관).
      eq(`band-still-present:${tag}`, m.bandFound ? 'PRESENT' : 'BAND_MISSING', 'PRESENT', '대조 — share_pct와 무관한 섹션');
      eq(`growth-still-present:${tag}`, m.growthFound ? 'PRESENT' : 'GROWTH_MISSING', 'PRESENT', '대조 — share_pct와 무관한 섹션');
      bump('section', 2);
      // 목표 단언(plan S2 완료기준 ②) — share_pct 전무면 ShareChart 섹션 자체가 없어야 한다.
      // ⚠️ "부재 확인"은 그래프 부재와 같은 함정(위 identity-pre-folded 주석) — 페이지 자체가 아직
      // 미배포라 아무 섹션도 없는 상태에서는 shareFound=false가 "옳게 생략됨"과 구별되지 않는다.
      // 대조(band/growth still-present)가 실제로 PASS해야만("컨트롤이 살아있다") 이 판정이 의미를 가진다 —
      // 그래서 대조가 실패 중이면 이 단언도 검증불가로 FAIL시켜 공허통과를 막는다.
      const controlsOk = m.bandFound && m.growthFound;
      const shareAbsentGot = !controlsOk ? 'CANNOT_VERIFY_CONTROLS_MISSING' : (m.shareFound ? 'UNEXPECTEDLY_PRESENT' : 'ABSENT');
      eq(`share-section-absent:${tag}`, shareAbsentGot, 'ABSENT',
        'players 전원 share_pct=null → ShareChart는 null을 반환해야 함(코드: rows.length===0 → return null)');
      bump('section');
      eq(`console:${tag}`, errs, [], '주입 화면');
      bump('console');
      await page.evaluate(() => document.querySelector('[data-testid="tech-level-band"]')?.scrollIntoView({ block: 'center' }));
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
