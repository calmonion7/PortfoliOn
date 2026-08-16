// task#276 S6ⓑ 라이브 UAT — 주요기술 리포트 목록·상세(S5, 1/2).
//
// 작성 착수 시점엔 라이브가 옛 프론트+미배포 백엔드였다(실측: GET /api/tech-reports → 404). 이 스크립트를
// 작성하는 동안 메인 세션이 S6 앞단(commit+push+build)을 병행 완료해, 이 파일이 완성된 시점엔 이미
// 라이브에 반영돼 있었다(재실측: 404 → 200, ALL PASS). 그래서 이 스크립트의 1차 실행 결과가 곧바로
// ALL PASS인 것이 실제 기록이다 — "지금 FAIL이 정상"이라는 전제는 배포 타이밍상 무효가 됐다.
// (이 스크립트가 배포 *전에* 다시 돌아갈 일이 있다면 여전히 route-intercept가 FIRED조차 안 돼
// section:SECTION_MISSING·intercept:ROUTE_NOT_INTERCEPTED로 FAIL하는 게 정상이다 — 옛 프론트엔
// /tech-reports 라우트 자체가 없다.)
//
// 응답 봉투 확인 방법(추정 금지 규칙) — 최초 라이브 1콜은 404라 봉투를 못 받아 **소스 직독**으로 확인했고
// (아래), 배포 후 재실행에서 그 형태 그대로 200이 왔다(주입 fixture가 그 형태를 그대로 썼으므로 간접 확인):
//   backend/routers/tech_reports.py `list_all`      → sanitize({"reports": svc.latest_all()})
//   backend/routers/tech_reports.py `list_by_slug`  → sanitize({"slug": slug, "reports": svc.list_by_slug(slug)})
//   frontend/src/pages/TechReports.jsx  : api.get('/api/tech-reports')        → data.reports
//   frontend/src/pages/TechReport.jsx   : api.get('/api/tech-reports/{slug}') → (data.reports||[])[0]
// (TechReport.test.jsx의 목 픽스처와 바이트 동일 — 프론트가 실제로 소비하는 형태임을 재확인.)
//
// ── task#280 S6 갱신 ──────────────────────────────────────────────────────
// 1/2가 상세 구조를 바꿨다(h1=기술명 / 141자 제목=리드 문단 / 업체 카드 N장→표 / 산문=본문 끝 접기).
// 그래서 **카드 구조를 전제하던 축 2개를 고쳐 남겼다**(버리지 않았다 — 없는 축은 다음 사람이 존재를 모른다):
//   · `gap-name-meta`(이름행 ↔ 메타행 세로 간격)는 표에서 그 대상이 소멸했다(row.children[1]이 국가 <td>라
//      gap이 음수가 되어 거짓 FAIL한다) → 등가 위험인 **셀 인접 간격**(이름 셀 right ↔ 국가 셀 left)으로 교체.
//   · leaves 셀렉터가 `span,div,p,a`뿐이라 PlayerTable의 nowrap 선언이 전부 붙어 있는 `<td>`와
//     ProseSections의 `<summary>`를 통째로 놓쳤다 → td·th·summary·button·h1을 추가(정의역이 조용히 줄던 구멍).
// 신규 축(구조 자체를 잰다): identity-h1/lead · order(섹션 배치) · kpi-count · prose-collapsed · table-order.
//
// ── task#280 S3(적대 리뷰 F3·F14 수정) 반영 — 축 2개를 또 고쳐 남겼다(버리거나 느슨하게 하지 않았다) ──
//   · `ellipsis-discipline`은 이제 **목록 전용**이다. 상세 표의 업체명이 `maxWidth:190 + ellipsis`를
//     버리고 `minWidth:0 + overflowWrap:break-word`가 되면서(F14) 전 행 ellCount=0이 됐다 — 옛 단언은
//     사라진 메커니즘을 박제한 것이라 거짓 FAIL이었다. 상세는 `shrink-discipline`으로 교체: 이름은
//     유연·무손실(nowrap 아님 · ellipsis 아님 · scrollW<=clientW · flex 자식), 형제 배지와 이름 밖 25셀은
//     고정(flex-shrink:0 · nowrap · 잘림 0). **옛 축보다 엄격하다** — ellipsis 부활도, 역할 뒤바뀜도 잡는다.
//   · `gap-title-table`은 제목 bottom ↔ 표 top을 한 번에 재서 33px로 거짓 FAIL했다. F3 수정이 매 행
//     반복되던 leader_name을 표 위 캡션 한 줄로 승격해 그 사이에 요소가 하나 낀 것인데, 실측하면 33px 중
//     17px이 **캡션 자신의 렌더 높이**다(빈 공간이 아니다). 사슬을 캡션을 통과해 재도록 바꿔 실제 void
//     10px·6px을 각각 판정한다 — 임계 24는 그대로다(둘 다 옛 임계보다 오히려 타이트하다).
// 도메인 수치는 정확일치가 아니라 **하한 + 실측 출력**으로 둔다 — 이전 사이클에서 정확일치 sentinel이
// 정당한 증가(24→46)에 거짓 FAIL을 냈다.
//
// ── task#296 S6 갱신 ──────────────────────────────────────────────────────
// PlayerTable이 열을 techReportUtils.playerColumns(현재 픽스처는 gap·share 둘 다 존재 → name·level·
// gap·share 4열)로 줄이고 **국가·티커를 열에서 빼 이름 셀 내부 메타줄로 옮겼다**(스크롤러도 함께 제거).
// 그래서 옛 6열 고정 인덱스(`cellTxt[2]`=level·`[3]`=gap, TABLE_COLS=6)는 렌더 실측 헤더 라벨로
// 교체한다(리터럴 인덱스가 아니라 실제 렌더된 `<th>` 텍스트로 찾는다 — 열 순서가 바뀌어도 안 깨진다).
// ProseSections도 `<details>/<summary>` 접기를 전부 제거하고 `<h3>` + 상시 노출로 바뀌었다 — 옛
// `detailsTotal`/`detailsOpen` 기반 `prose-total`/`prose-open`/`prose-collapsed`는 **뒤집는다**:
// 이제 `<details>` 자체가 0개여야 정상이고, 소제목 수는 `<h3>` 개수로 잰다. 뒤집는 근거는 task#280 S4의
// 기록(전부 접힘)이 아니라 task#296 계획(사용자 결정 — 스크롤+전역 목차가 항해를 대신한다, §7.4.6/task#264
// 절차)이다. **표의 스크롤러 제거는 이 파일의 정의역 밖이다** — 여기는 픽스처(무쓰기) 전용이고 표
// 스크롤러 존재/부재는 uat280(실데이터)·uat296(신규, 목차·note·스크롤러 전담)이 잰다.
// ⚠️ 이 스크립트는 **픽스처 전용**이다(page.route 주입). 실발행 데이터 측정은 scripts/uat280-tech-report.mjs가
//    담당한다 — 두 프로브는 상보적이다: 여기 픽스처는 실데이터에 **없는** 입력(대괄호 헤딩 앞 선행 문단,
//    gap_years null 업체, 보유/관심 배지)을 일부러 만들어 그 분기를 덮고, uat280은 실발행물이 그 축을
//    통과하는지를 덮는다. `first-screen-prose`는 uat280에만 둔다 — 픽스처 페이지 길이는 제품 성질이 아니라
//    프로브 아티팩트라 여기서 재면 그 자체가 거짓 판정이 된다.
//
// ── task#304 S3 갱신(ADR-0041 — 「기술수준 비교」 밴드가 「주요 업체」 표의 셀로 흡수) ──────────
//  · 행 파서 `cellTxt[levelIdx].match(/^(\d+)단계/)` → **원리적으로 항상 null**이 된다(셀 텍스트가
//    단계 숫자 하나뿐). 채움 칸 수(화면의 진실)로 읽고 aria-label과 교차 대조하도록 교체했다.
//    그대로 뒀으면 전 행 level=null → table-order 불변식이 통째로 거짓 FAIL했다.
//  · `shrink-discipline`의 「기술수준만 줄바꿈이 의도」 예외를 **제거**했다 — 그 예외는 task#296이
//    `5단계 · 양산상용` 14자를 278px 4열에 넣으려고 준 것인데 그 텍스트 자체가 사라졌다(축이 낡은
//    메커니즘을 박제하던 자리, 가토 ⑧ⓝ). 이제 수치 열은 전부 nowrap이고, 대신 **밴드 셀이 실제로
//    한 줄인가**(칸 묶음 자식들의 distinct-top == 1)를 별도로 잰다 — nowrap 선언만으론 flex 자식의
//    wrap을 못 본다(가토 ⑨: 넘치지 않는 줄바꿈).
//  · 제목→표 사슬에 **범례**가 끼어 링크가 2→3이 됐다(임계 24px은 그대로 — 완화 0).
//  · 신규: `level-band`(칸 5개·채움 수 == 픽스처 tech_level·role/aria·칸 **화면** 렌더 폭) ·
//    `legend` · `levels-section-absent` · `toc-no-levels`.
//  · 텍스트 leaf 표본 구성이 바뀐다(기술수준 `<td>`가 leaf에서 빠지고 단계 숫자 span이 들어오며
//    범례 5개가 추가) — 총계 변동의 원인을 `rawLog` 회계 줄로 출력한다.
//
// 판정축 4계열(+identity·console) — 각 축에 정의역 sentinel을 짝짓는다. 신뢰성 규칙(무조건 단언·
// sentinel FAIL·이빨 단언)은 scripts/uat275-segment.mjs의 관용구를 재사용. 범위는 그 스크립트의 실제
// 관용구(제목 텍스트에서 섹션 루트로 좁혀 재는 것)를 따라, `main.page-wrap` 그대로가 아니라 더 좁힌
// ROOT_SEL을 쓴다(아래 주석 — ResearchShell의 모바일 seg 탭바가 main.page-wrap 안에 같이 들어있어
// 뷰포트별로 표본 수가 달라지는 걸 실측으로 발견하고 고쳤다).
import { chromium, devices } from 'playwright';
import fs from 'fs';

console.log('실발행 아님 — 주입 응답 (page.route 픽스처, prod tech_reports 무관)');

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat276';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const P = (ok, tag, msg) => results.push({ ok, tag, msg });
const cov = {};
const bump = (k, n = 1) => { cov[k] = (cov[k] || 0) + n; };
const eq = (tag, got, want, note = '') => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  P(ok, tag, `${ok ? 'PASS' : 'FAIL'} — got=${JSON.stringify(got)} want=${JSON.stringify(want)}${note ? ' · ' + note : ''}`);
};
// 정보성 로그(단언 아님) — "정의역이 설계상 부재"처럼 FAIL로 만들면 안 되는 사실을 남길 때만 쓴다.
const NOTE = (msg) => console.log(`  ℹ ${msg}`);
// 실측 원시 로그(단언 아님, 무조건 출력) — 개별 PASS 메시지는 FAIL이 하나라도 있으면 안 찍히므로,
// 총계 변동의 **원인**처럼 다음 사람이 반드시 봐야 하는 수치는 여기로 모은다(가토 ⑧ⓐ/ⓗ).
const rawLog = [];

// ── 로그인 (추정 폴백 없음 — 실패 시 즉시 exit) ──────────────────────────────
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const { access_token, refresh_token } = await login.json();
if (!access_token) { console.error('로그인 실패 — access_token 없음. 종료.'); process.exit(1); }

// ── 대상 slug — 저작 당시 백엔드 TECH_TOPICS(services/tech_reports.py) 정본 4종, 소스 직독으로 확인.
// ⚠️ task#301(ADR-0039)로 6종(data-center 은퇴 → ai-datacenter-equipment·ai-datacenter-ops 분할)이
// 됐지만 이 목록은 카드 그리드 레이아웃용 **자립 픽스처**(page.route 주입)라 실제 종수와 무관하다 —
// LIST_REPORTS.length가 항상 이 배열에서 자기유도되므로 하드코딩 4는 무해(카드 4장으로도 그리드
// 축을 충분히 자극한다). 대상 identity가 라이브 종수에 의존하는 uat299가 그 축을 대신 잰다. ──
const SLUG = 'reusable-rocket';
const LIST_SLUGS = ['reusable-rocket', 'solid-state-battery', 'smr', 'robotics'];
// 표시명 미러 — frontend/src/components/reports/techReportUtils.js TECH_NAMES(백엔드는 응답에 안 싣는다).
// 1/2에서 h1이 제목 → 기술명으로 바뀌었으므로 이 맵이 h1 identity 단언의 기대값 소스다.
const TECH_NAMES = { 'reusable-rocket': '재사용 로켓', 'solid-state-battery': '전고체 배터리', smr: 'SMR', robotics: '로봇' };
// 기술 성숙 단계 5단계 라벨 미러(techReportUtils.TECH_LEVEL_LABELS) — 범례·aria-label 기대값 소스.
const TECH_LEVEL_LABELS = ['', '기초연구', '시제품', '실증', '초기상용', '양산상용'];

// playerColumns 미러(techReportUtils.js와 동일 로직, task#296) — 열 수를 리터럴로 박지 않고 픽스처
// 입력에서 유도한다. name·level 항상 + gap·share는 전 행 결측이면 제외(share는 `>= 0`이 게이트 —
// 0은 결측이 아니라 값이다).
function mirrorPlayerColumns(players) {
  const list = Array.isArray(players) ? players : [];
  const cols = ['name', 'level'];
  if (list.some(p => p?.gap_years != null)) cols.push('gap');
  if (list.some(p => Number.isFinite(p?.share_pct) && p.share_pct >= 0)) cols.push('share');
  return cols;
}

// ── formatMarketSize/formatMarketSummary 미러(frontend techReportUtils.js와 바이트 동일 로직) ──
// 리터럴 문자열을 하드코딩하지 않고 픽스처 입력에서 기대값을 "계산"한다(리터럴이 아니라 불변식 규율).
const UNIT_LABEL = { USD: { mn: 'M', bn: 'B', tn: 'T' }, KRW: { mn: '백만원', bn: '십억원', tn: '조원' } };
function fmtSize(size) {
  if (!size || typeof size.value !== 'number' || !Number.isFinite(size.value)) return null;
  const label = UNIT_LABEL[size.currency]?.[size.unit];
  if (!label) return null;
  const v = Math.round(size.value * 10) / 10;
  return size.currency === 'USD' ? `$${v}${label}` : `${v}${label}`;
}
function fmtSummary(market) {
  const history = [...(market.history || [])].sort((a, b) => a.year - b.year);
  const forecast = [...(market.forecast || [])].sort((a, b) => a.year - b.year);
  const current = history[history.length - 1] ?? null;
  const final = forecast[forecast.length - 1] ?? null;
  const partText = (p) => { const amt = fmtSize(p.size); return amt ? `${amt} (${p.year})` : null; };
  const curTxt = current ? partText(current) : null;
  const finTxt = final ? partText(final) : null;
  if (!curTxt && !finTxt) return null;
  const cagrTxt = market.cagr_pct != null ? `, CAGR ${market.cagr_pct}%` : '';
  return curTxt && finTxt ? `${curTxt} → ${finTxt}${cagrTxt}` : `${curTxt ?? finTxt}${cagrTxt}`;
}

// ── 상세 픽스처 — 축을 실제로 자극하도록 설계 ───────────────────────────────
// player[1](CASC)은 이름을 일부러 길게(ellipsis 축), state_led:true(색 축).
// player[2]는 ticker=COST(라이브 실계정 보유종목, 보유 배지 색 축), player[3]는 ticker=AAPL(관심 배지 색 축).
// player[4]는 gap_years:null — 정렬 불변식의 "null 최후"를 결정적으로 자극한다(같은 tech_level 4인
// player[2]보다 뒤에 와야 한다). 실데이터에도 같은 형태가 있지만(두산에너빌리티) 여기선 결정적으로 고정.
const PLAYERS = [
  { name: 'SpaceX', country: 'US', state_led: false, ticker: null, tech_level: 5, gap_years: 0, leader_name: null, share_pct: 42.5, note: '재사용 1위, 팰컨9 누적 발사 최다.' },
  { name: '중국항천과기집단공사(CASC, China Aerospace Science and Technology Corporation)', country: 'CN', state_led: true, ticker: null, tech_level: 3, gap_years: 5, leader_name: 'SpaceX', share_pct: 18.2, note: '국가 주도 투자로 격차를 좁히는 중이며, 장정 계열 재사용 시험이 최근 이어지고 있다는 점이 특징이다.' },
  { name: 'Rocket Lab Holdings', country: 'US', state_led: false, ticker: 'COST', tech_level: 4, gap_years: 2, leader_name: 'SpaceX', share_pct: 15.0, note: null },
  { name: 'Blue Origin', country: 'US', state_led: false, ticker: 'AAPL', tech_level: 3, gap_years: 6, leader_name: 'SpaceX', share_pct: 8.3, note: null },
  { name: '격차미산정 업체(UAT276)', country: 'KR', state_led: false, ticker: null, tech_level: 4, gap_years: null, leader_name: null, share_pct: null, note: null },
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
const SOURCES = [
  { title: 'NASA', url: null },
  { title: 'Gartner 2024', url: 'https://example.com/gartner' },
  { title: '옴디아', url: null },
];
const CHALLENGES = [
  { title: '재점화 신뢰성', body: '다회 재점화 엔진의 내구성과 정비 주기를 단축해야 회수-재사용 경제성이 유지된다.' },
  { title: '대량생산 전환', body: '시험기 생산 체계에서 월 수십 기 양산 체계로 전환하는 공정 표준화가 관건이다.' },
];
const TITLE = '재사용 로켓, 궤도당 비용을 다시 쓴다 (UAT276 프로브)';
// description은 **대괄호 헤딩 앞에 선행 문단**을 둔다 — 실발행 2건은 첫 줄이 헤딩이라 이 분기를
// 라이브에서 자극할 수 없다(uat280과 상보). ProseSections는 선행 문단을 접지 않고 항상 보이는 <p>로
// 남겨야 한다(소제목이 없으면 접을 라벨도 없다 = 내용만 숨는다). 헤딩 2개 + 난이도 근거 → details 3개.
const LEAD_PARA = '헤딩 없는 선행 문단 — 접히지 않고 항상 보여야 한다(정보 손실 0의 절대 조건).';
const DESCRIPTION = [
  LEAD_PARA,
  '[기술 개요]',
  '1단 재사용은 발사 비용을 궤도당 비용 기준으로 낮추는 구조적 전환이다.',
  '[투자 관점]',
  '회수·재정비·재발사 주기가 짧아질수록 규모의 경제가 강화된다.',
].join('\n');
const RATIONALE = '극저온 추진제 재점화와 착륙 정밀도가 아직 완전히 표준화되지 않았다.';
const DETAIL_REPORT = {
  slug: SLUG, published_date: '2026-08-03', title: TITLE,
  description: DESCRIPTION,
  difficulty: { score: 5, rationale: RATIONALE },
  players: PLAYERS, challenges: CHALLENGES, related: {}, market: MARKET, sources: SOURCES,
};
// <h3> 소제목 수 = 소제목 섹션 수 + 난이도 근거 1(task#296 — 전부 상시 노출, 접기 자체가 없다).
// 픽스처 리터럴이 아니라 픽스처 **입력에서 계산**한다 — 입력을 바꾸면 기대값이 따라온다.
const TITLED_ITEMS = DESCRIPTION.split('\n').filter((l) => /^\[[^\]]+\]$/.test(l.trim())).length
  + (RATIONALE.trim() !== '' ? 1 : 0);

// 목록 픽스처 — 4종 slug 전부, 각 제목에 고유 마커(대상 identity용).
const LIST_REPORTS = LIST_SLUGS.map((slug, i) => ({
  slug, published_date: '2026-08-03',
  title: `UAT276 목록카드 ${i} — ${slug} 표시명 검증용 매우 긴 제목이라 반드시 ellipsis로 잘려야 정상이다`,
  difficulty: { score: (i % 5) + 1, rationale: 'r' },
  players: PLAYERS.slice(0, i + 1), // 개수 다양화(업체 수 스탯)
  market: MARKET,
}));

// ── 보유/관심 배지용 /api/stocks 픽스처(무쓰기 — GET만) ─────────────────────
const STOCKS_FIXTURE = [
  { ticker: 'COST', name: 'Costco', type: 'holding', market: 'US' },
  { ticker: 'AAPL', name: 'Apple Inc.', type: 'watchlist', market: 'US' },
];

// ── 브라우저 안 측정기 ────────────────────────────────────────────────────
// 범위 — `main.page-wrap`만으로는 부족하다(실측으로 발견): ResearchShell이 모바일에서 seg 탭바
// (`.seg a` 6개, `white-space:nowrap` 상속)와 검색바를 그 안에 함께 렌더해 PC엔 없는 표본이
// mobile390/350에만 섞여 든다(실측: main.page-wrap 그대로 쓰면 detail nowrap 24 vs 30으로 뷰포트마다
// 달라짐). ResearchShell은 PC에선 `.page`, 모바일에선 `.m-page`로 **children만** 감싸므로(코드 확인,
// ResearchShell.jsx) 그 안쪽을 루트로 잡으면 세 뷰포트가 동일 도메인(list=4/detail=24)으로 정합해진다
// (디버그 스크립트로 확인). "본문으로 한정"을 이 페이지에 맞게 한 단계 더 좁힌 것 — task#275도 실제로는
// main.page-wrap이 아니라 섹션 루트로 좁혀서 측정했다(그 스크립트를 다시 읽어 확인).
const ROOT_SEL = 'main.page-wrap .page, main.page-wrap .m-page';

const measureList = (page) => page.evaluate((ROOT_SEL) => {
  const root = document.querySelector(ROOT_SEL);
  if (!root) return { found: false };
  const cards = [...root.querySelectorAll('[data-testid="tech-report-card"]')];
  if (!cards.length) return { found: false };
  const cs = (el) => getComputedStyle(el);
  const txt = (el) => el.textContent.trim();
  const lineCount = (el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    const tops = [...r.getClientRects()].map(x => Math.round(x.top));
    return new Set(tops).size || 1;
  };
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
  const perCard = cards.map(c => {
    const ell = [...c.querySelectorAll('span, div')].filter(e => e.children.length === 0 && cs(e).textOverflow === 'ellipsis' && cs(e).overflow !== 'visible');
    return { slug: c.getAttribute('data-slug'), ellCount: ell.length };
  });
  const rr = root.getBoundingClientRect();
  return { found: true, items, clippers, perCard, allText: root.textContent, rootRight: Math.round(rr.right) };
}, ROOT_SEL);

const measureDetail = (page) => page.evaluate((ROOT_SEL) => {
  const root = document.querySelector(ROOT_SEL);
  if (!root) return { found: false };
  const playersEl = root.querySelector('[data-testid="tech-report-players"]');
  if (!playersEl) return { found: false };
  const cs = (el) => getComputedStyle(el);
  const txt = (el) => el.textContent.trim();
  const lineCount = (el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    const tops = [...r.getClientRects()].map(x => Math.round(x.top));
    return new Set(tops).size || 1;
  };
  // 표는 축소하지 않고 설계폭(minWidth)을 지킨 채 자체 overflow-x 스크롤러에 담는 관용구다(가토 ⑫).
  // 그 안쪽 요소는 **설계상** 루트를 넘으므로 bbox 축의 정의역에서 뺀다(페이지 본문 가로 스크롤은 별도 축).
  const inXScroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = cs(p).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
    return false;
  };
  // td·th·summary·button·h1 추가 — 1/2에서 nowrap 선언이 전부 <td>로 옮겨갔고 소제목이 <summary>가 됐다.
  // 옛 셀렉터(span,div,p,a)로는 그 표본이 통째로 빠져 정의역이 조용히 줄어든다.
  const leaves = [...root.querySelectorAll('span, div, p, a, td, th, summary, li, button, h1')].filter(e => e.children.length === 0 && txt(e).length > 0);
  const items = leaves.map(el => {
    const s = cs(el);
    const isEllipsis = s.textOverflow === 'ellipsis' && s.overflow !== 'visible';
    const isNowrap = s.whiteSpace === 'nowrap';
    const b = el.getBoundingClientRect();
    return { t: txt(el).slice(0, 60), lines: lineCount(el), scrollW: el.scrollWidth, clientW: el.clientWidth, right: Math.round(b.right), isEllipsis, isNowrap, inScroller: inXScroller(el) };
  });
  const clippers = [...root.querySelectorAll('*')].filter(e => cs(e).overflow === 'hidden' && txt(e).length > 0)
    .map(e => ({ t: txt(e).slice(0, 40), scrollW: e.scrollWidth, clientW: e.clientWidth, isEllipsis: cs(e).textOverflow === 'ellipsis' }));

  // task#296 — 열 집합이 playerColumns(픽스처는 4열: 업체·기술수준·선두 대비·점유율)로 줄고 국가·티커는
  // 열이 아니라 이름 셀 내부로 옮겼다. 고정 인덱스(옛 cellTxt[2]=level·[3]=gap, 6열 가정)는 렌더된
  // `<th>` 라벨로 찾는다 — 열 순서·개수가 데이터에 따라 바뀌어도 안 깨진다(리터럴 인덱스 금지).
  const headLabels = [...playersEl.querySelectorAll('thead th')].map(th => txt(th));
  const levelIdx = headLabels.indexOf('기술수준');
  const gapIdx = headLabels.indexOf('선두 대비');

  // 업체 행 단위(1/2에서 카드 → <tr>) — 셀 인접 간격, ellipsis 규율, 배지 색, 정렬 불변식 입력.
  const rows = [...playersEl.querySelectorAll('[data-testid="tech-report-player-row"]')].map(row => {
    const nameEl = row.querySelector('[data-testid="tech-report-player-name"]');
    const cells = [...row.children];
    const cellTxt = cells.map(td => txt(td));
    // 역할 분담 축(shrink-discipline)의 입력 — 아래 3계열을 행마다 모은다.
    //   ⓐ 이름 = 유일하게 "줄어도 되는" 요소(유연·무손실)  ⓑ 이름의 flex 형제(배지) = 고정
    //   ⓒ 이름 열 밖의 모든 셀(수치·티커) = 고정
    const ns = nameEl ? cs(nameEl) : null;
    const nameParent = nameEl ? nameEl.parentElement : null;
    const nameCs = ns ? {
      ws: ns.whiteSpace, to: ns.textOverflow, ov: ns.overflow,
      sw: nameEl.scrollWidth, cw: nameEl.clientWidth,
      // 유연한 쪽은 flex 자식이어야 한다 — flex 컨테이너 밖이면 flexShrink 선언이 통째로 무효다.
      flexChild: nameParent ? /flex/.test(cs(nameParent).display) : false,
    } : null;
    const flexSibs = nameParent
      ? [...nameParent.children].filter(e => e !== nameEl).map(e => {
        const s = cs(e);
        return { t: txt(e).slice(0, 16), shrink: s.flexShrink, ws: s.whiteSpace };
      })
      : [];
    // label을 함께 싣는다 — 열 집합이 데이터 파생(playerColumns)이라 인덱스로 분류하면 판마다 어긋난다.
    const cellInfo = cells.map((td, ci) => {
      const s = cs(td);
      return { i: ci, label: headLabels[ci] ?? null, ws: s.whiteSpace, sw: td.scrollWidth, cw: td.clientWidth, w: Math.round(td.getBoundingClientRect().width) };
    });
    // 옛 축(이름행 ↔ 메타행 세로 간격)의 표 등가물 — 이름 셀과 그 다음 셀(task#296: 국가 → 기술수준)은
    // 한 행의 인접 열이므로 그 사이가 벌어지면 같은 업체의 정보가 두 덩어리로 읽힌다(가토 ⑩).
    const gap = cells.length >= 2
      ? Math.round(cells[1].getBoundingClientRect().left - cells[0].getBoundingClientRect().right)
      : null;
    // task#304(ADR-0041) — 기술수준 셀이 텍스트(`5단계 · 양산상용`)에서 **5칸 밴드**로 바뀌었다.
    // 옛 파서 `/^(\d+)단계/`는 셀 텍스트가 단계 숫자 하나로 줄어 **원리적으로 항상 null**이 된다
    // (그대로 두면 전 행 level=null → 아래 table-order 불변식이 통째로 거짓 FAIL한다). 화면의 진실인
    // **채움 칸 수**를 읽고 aria-label과 교차 대조한다.
    const levelTd = levelIdx >= 0 ? cells[levelIdx] : null;
    const cellsEl = levelTd ? levelTd.querySelector('.tech-level-band__cells') : null;
    const bandCells = cellsEl ? [...cellsEl.querySelectorAll('.tech-level-band__cell')] : [];
    const filledEl = cellsEl ? cellsEl.querySelector('.tech-level-band__cell--filled') : null;
    const fb = filledEl ? filledEl.getBoundingClientRect() : null;
    const band = cellsEl ? {
      total: bandCells.length,
      filled: bandCells.filter(c => c.classList.contains('tech-level-band__cell--filled')).length,
      aria: cellsEl.getAttribute('aria-label'), role: cellsEl.getAttribute('role'),
      cellW: fb ? Math.round(fb.width * 10) / 10 : null,
      cellH: fb ? Math.round(fb.height * 10) / 10 : null,
      // 칸 묶음이 접히지 않는가 — **세로로 겹치지 않는 rect 묶음의 개수**(가토 ⑨ 2차 정정판).
      // ⚠️ `서로 다른 top 개수`로 세면 안 된다: 칸(10px)과 단계 숫자(16.5px)는 align-items:center로
      // 같은 줄에 놓이면서도 top이 갈리므로 **정상 구현이 전 뷰포트에서 거짓 FAIL**한다(실측: 컨테이너
      // 높이 16.5 == 숫자 높이, 자식 6개가 left 723→758로 가로 일렬, 그런데 top 집합은 2였다).
      // 진짜 줄바꿈은 줄끼리 세로로 겹치지 않으므로 이 축이 오히려 더 엄격하다.
      lines: (() => {
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
      })(),
      digit: txt(cellsEl),
    } : null;
    // gap 셀은 이제 "선두 대비" 접두 없이 격차만 담는다(leader_name이 표 위 캡션으로 승격된 task#280
    // S3부터 이미 그랬다 — 옛 `/^선두 대비 (\d+)년/`은 그 시점부터 스테일이었다).
    const gapM = gapIdx >= 0 ? (cellTxt[gapIdx] || '').match(/^(\d+)년$/) : null;
    const holdBadge = [...row.querySelectorAll('span')].find(e => e.children.length === 0 && txt(e) === '보유');
    const watchBadge = [...row.querySelectorAll('span')].find(e => e.children.length === 0 && txt(e) === '관심');
    const stateBadge = [...row.querySelectorAll('span')].find(e => e.children.length === 0 && txt(e) === '정부주도');
    return {
      name: nameEl ? txt(nameEl) : null, nameCs, flexSibs, cellInfo, gap, cellCount: cells.length,
      band,
      level: band ? band.filled : null,
      // '현재 선두' = gap 0(0은 유효값 — falsy로 흘리면 선두를 놓친다), '—' = null
      gapYears: gapIdx >= 0 && cellTxt[gapIdx] === '현재 선두' ? 0 : (gapM ? Number(gapM[1]) : null),
      holdColor: holdBadge ? cs(holdBadge).color : null,
      watchColor: watchBadge ? cs(watchBadge).color : null,
      stateColor: stateBadge ? cs(stateBadge).color : null,
    };
  });

  // ── 1/2 신규 구조: h1(기술명) · 리드 문단 · KPI 스트립 · 산문 접기 · 섹션 배치 순서 ──
  const h1 = root.querySelector('h1');
  const leadEl = root.querySelector('[data-testid="tech-report-lead"]');
  const kpiEl = root.querySelector('[data-testid="tech-report-kpis"]');
  const proseEl = root.querySelector('[data-testid="tech-report-prose"]');
  // task#296 — <details>/<summary> 접기 완전 제거, 소제목은 <h3>로 상시 노출. detailsEls는
  // "제거됐는가"를 잡는 회귀 축으로 남기고(0이어야 정상), 소제목 수는 h3Els로 잰다.
  const detailsEls = proseEl ? [...proseEl.querySelectorAll('details')] : [];
  const h3Els = proseEl ? [...proseEl.querySelectorAll('h3')] : [];
  const all = [...root.querySelectorAll('*')];
  const idxOf = (sel) => { const el = root.querySelector(sel); return el ? all.indexOf(el) : -1; };
  const order = {
    lead: idxOf('[data-testid="tech-report-lead"]'),
    kpis: idxOf('[data-testid="tech-report-kpis"]'),
    players: idxOf('[data-testid="tech-report-players"]'),
    prose: idxOf('[data-testid="tech-report-prose"]'),
    sources: idxOf('[data-testid="tech-report-sources"]'),
  };
  // 「주요 업체」 제목 → (선두 캡션) → 표 (가토 ⑩ — 한 덩어리로 읽혀야 한다).
  // task#280 S3에서 이 자리가 2단이 됐다: 매 행 반복되던 leader_name을 셀에서 빼 표 위 캡션 한 줄로
  // 승격했다(적대 리뷰 F3 — 「선두 대비」 열이 302px로 부풀어 PC에서 표가 넘쳤다). 그래서 제목 bottom과
  // 표 top을 **한 번에** 재면 그 사이에 낀 캡션의 렌더 높이까지 "간격"으로 세게 된다(실측 33px 중
  // 17px이 캡션 자신의 텍스트다) → 사슬을 캡션을 **통과해** 잰다. 실제 void는 10px·6px이다.
  const playersCap = [...root.querySelectorAll('.rpt-title')].find(t => txt(t).includes('주요 업체'));
  const leaderEl = root.querySelector('[data-testid="tech-report-players-leader"]');
  const gapPx = (aEl, bEl) => Math.round(bEl.getBoundingClientRect().top - aEl.getBoundingClientRect().bottom);
  // 캡션 유무 = 축의 **정의역**이지 무음 스킵이 아니다(가토 ⑧ⓛ): 전 업체의 gap_years가 0/null이면
  // PlayerTable이 캡션을 렌더하지 않아(leaders 빈 배열) 사슬이 1링크가 된다. 링크 수 자체를 호출측에서
  // 픽스처 입력과 대조해 못박으므로, 링크가 조용히 사라지면 통과가 아니라 FAIL이 된다.
  // ⚠️ task#304 — 사슬에 **5단계 범례**가 새로 끼었다(제목 → 캡션 → 범례 → 표). 링크를 늘리지 않으면
  //    위 33px과 **똑같은 함정**에 다시 빠진다(범례 텍스트 자신의 높이가 "간격"으로 계상된다) —
  //    임계를 올리는 게 아니라 사슬을 링크로 쪼개는 것이 원래 의도다(가토 ⑧ⓝ).
  const legendEl = root.querySelector('.tech-level-band__legend');
  const chainNodes = [['title', playersCap], ['caption', leaderEl], ['legend', legendEl], ['table', playersEl]]
    .filter(([, el]) => el);
  const titleChain = !playersCap ? null
    : chainNodes.slice(1).map(([k, el], i) => ({ from: chainNodes[i][0], to: k, px: gapPx(chainNodes[i][1], el) }));
  const legendItems = legendEl ? [...legendEl.querySelectorAll('.tech-level-band__legend-item')].map(e => txt(e)) : null;
  // 옛 「기술수준 비교」 섹션·목차 칩의 부재(동작 ②③) — 하나라도 남으면 유령 UI다.
  const bandSectionGone = [
    root.querySelectorAll('[data-testid="tech-level-band"]').length,
    root.querySelectorAll('[data-tech-section="levels"]').length,
  ];
  const tocLabels = [...root.querySelectorAll('[data-testid="tech-toc-chip"]')].map(a => txt(a));

  // 출처 섹션 — "출처" 캡션(.rpt-title) ↔ 첫 칩
  const sourcesEl = root.querySelector('[data-testid="tech-report-sources"]');
  let sourceGap = null;
  const sourcesTexts = sourcesEl ? [...sourcesEl.children].map(c => txt(c)) : [];
  if (sourcesEl) {
    const capEl = [...root.querySelectorAll('.rpt-title')].find(t => txt(t).includes('출처'));
    const firstChip = sourcesEl.children[0];
    if (capEl && firstChip) sourceGap = Math.round(firstChip.getBoundingClientRect().top - capEl.getBoundingClientRect().bottom);
  }

  // task#282 S3 — 옛 요약 카드 testid가 제거되고 MarketGrowthChart 캡션이 요약+기준을 흡수했다.
  // 새 위치를 잰다(축은 삭제하지 않고 새 구조를 재게 고친다).
  const marketSummaryEl = root.querySelector('[data-testid="market-growth-chart"] [data-testid="market-growth-caption"]');

  // 색 토큰(가토 ⑪ — 하드코딩 금지, :root에서 임시 노드로 rgb 정규화해 읽는다)
  const readToken = (varName) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${varName})`; probe.style.position = 'absolute'; probe.style.opacity = '0';
    document.body.appendChild(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    return rgb;
  };
  const accentRgb = readToken('--accent');
  const tagHoldRgb = readToken('--tag-hold-color');
  const tagWatchRgb = readToken('--tag-watch-color');

  const rr = root.getBoundingClientRect();
  return {
    found: true, items, clippers, rows, sourceGap, sourcesTexts, order,
    titleChain, leaderText: leaderEl ? txt(leaderEl) : null,
    legendItems, bandSectionGone, tocLabels,
    headCols: playersEl.querySelectorAll('thead th').length,
    marketSummaryText: marketSummaryEl ? txt(marketSummaryEl) : null,
    h1Text: h1 ? txt(h1) : null,
    leadText: leadEl ? txt(leadEl) : null,
    kpiCount: kpiEl ? kpiEl.querySelectorAll('.stat').length : 0,
    kpiValues: kpiEl ? [...kpiEl.querySelectorAll('.stat__value')].map(v => txt(v)) : [],
    proseFound: !!proseEl,
    detailsTotal: detailsEls.length,
    detailsOpen: detailsEls.filter(d => d.open).length,
    h3Total: h3Els.length,
    // 클릭 없이 이미 보이는가(task#296의 핵심 주장) — closed <details> 자손은 rect가 0이 아닌 값을
    // 반환하는 함정이 실측으로 확인됐다(uat296 헤더 주석 참조) → closest('details')로 먼저 걸러낸다.
    h3Hidden: h3Els.filter(h => { const d = h.closest('details'); return d && !d.open; }).length,
    plainCount: proseEl ? proseEl.querySelectorAll('[data-testid="tech-prose-plain"]').length : 0,
    plainText: proseEl ? [...proseEl.querySelectorAll('[data-testid="tech-prose-plain"]')].map(p => txt(p)).join('\n') : '',
    allText: root.textContent, accentRgb, tagHoldRgb, tagWatchRgb,
    rootRight: Math.round(rr.right),
  };
}, ROOT_SEL);

// ── 실행 ──────────────────────────────────────────────────────────────────
const browser = await chromium.launch();

const VIEWS = [
  { key: 'pc', opts: { viewport: { width: 1440, height: 900 } } },
  { key: 'mobile390', opts: { ...devices['iPhone 13'] } },
  { key: 'mobile350', opts: { viewport: { width: 350, height: 700 } } },
];

for (const V of VIEWS) {
  // SW가 /api/*를 가로채면 page.route 주입이 안 먹는다 → serviceWorkers:'block' 필수.
  const ctx = await browser.newContext({ ...V.opts, serviceWorkers: 'block' });
  await ctx.addInitScript(([a, r]) => {
    localStorage.setItem('access_token', a); localStorage.setItem('refresh_token', r);
  }, [access_token, refresh_token]);

  for (const SCREEN of ['list', 'detail']) {
    const tag = `${V.key}/${SCREEN}`;
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', e => errs.push(String(e)));

    let intercepted = false;
    try {
      if (SCREEN === 'list') {
        // 정확히 "/api/tech-reports"로 끝나는 요청만(슬러그 붙은 상세 콜과 겹치지 않는다 — glob suffix 매칭).
        await page.route('**/api/tech-reports', async (route) => {
          intercepted = true;
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reports: LIST_REPORTS }) });
        });
      } else {
        await page.route(`**/api/tech-reports/${SLUG}`, async (route) => {
          intercepted = true;
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ slug: SLUG, reports: [DETAIL_REPORT] }) });
        });
        // 보유/관심 배지 결정성 확보(라이브 사용자 보유종목 변동에 무관하게 고정).
        await page.route('**/api/stocks', async (route) => {
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STOCKS_FIXTURE) });
        });
      }

      const url = SCREEN === 'list' ? `${BASE}/tech-reports` : `${BASE}/tech-report/${SLUG}`;
      await page.goto(url, { waitUntil: 'networkidle' }).catch((e) => errs.push(`goto:${e}`));
      await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0).catch(() => {});
      await page.waitForTimeout(1200);

      // (0) 라우트 인터셉트 실사 — 미배포면 옛 프론트가 이 엔드포인트를 아예 호출하지 않아 여기서 FAIL한다.
      // 무조건 단언 + sentinel(⑧ⓑ) — "if(intercepted) assert(...)"로 감싸지 않는다.
      eq(`intercept:${tag}`, intercepted ? 'FIRED' : 'ROUTE_NOT_INTERCEPTED', 'FIRED');
      bump('intercept');

      let m = SCREEN === 'list' ? await measureList(page) : await measureDetail(page);
      if (!m.found) { // 1회 재시도(무음 스킵 금지, id 로그 명시)
        console.log(`  (재시도) ${tag} — 섹션 미검출, 1.8s 대기 후 재측정`);
        await page.waitForTimeout(1800);
        m = SCREEN === 'list' ? await measureList(page) : await measureDetail(page);
      }
      eq(`section:${tag}`, m.found ? 'PRESENT' : 'SECTION_MISSING', 'PRESENT');
      bump('section');

      if (!m.found) {
        eq(`console:${tag}`, errs, [], '측정 불가 화면(참고용 — 콘솔에러도 함께 보고)');
        bump('console');
        await page.screenshot({ path: `${OUT}/${V.key}-${SCREEN}.png`, fullPage: false });
        await page.close();
        continue;
      }

      // (1) identity — 판정축이 대상과 독립이면 404 위에서도 통과한다(⑧ⓘ). 우리가 주입한 고유 마커로 확인.
      if (SCREEN === 'list') {
        for (const r of LIST_REPORTS) {
          eq(`identity:${tag}:${r.slug}`, m.allText.includes(r.title) ? 'FOUND' : 'TITLE_MISSING', 'FOUND', `slug=${r.slug}`);
          bump('identity');
        }
      } else {
        eq(`identity:${tag}`, m.allText.includes(TITLE) ? 'FOUND' : 'TITLE_MISSING', 'FOUND');
        bump('identity');
        // 1/2 격 교체 — h1은 기술명, 141자급 제목은 리드 문단. 옛 단언(제목이 어딘가 있다)은
        // 두 요소를 구별하지 못해 이 교체를 그냥 통과시킨다(판정축이 대상과 독립).
        eq(`identity-h1:${tag}`, m.h1Text ?? 'H1_MISSING', TECH_NAMES[SLUG], '기술명(TECH_NAMES 미러)');
        bump('identity');
        eq(`identity-lead:${tag}`, m.leadText ?? 'LEAD_MISSING', TITLE, '리드 = 주입 title 전문(잘림·생략 0)');
        bump('identity');
        eq(`identity-differ:${tag}`, new Set([TECH_NAMES[SLUG], TITLE]).size, 2, '이빨 단언 — 기술명 ≠ 제목');
        bump('identity');
        for (const p of PLAYERS) {
          eq(`segname:${tag}:${p.name.slice(0, 10)}`, m.allText.includes(p.name) ? 'FOUND' : 'SEGNAME_MISSING', 'FOUND');
          bump('segname');
        }
      }

      // ── 잘림 축 ⓐ leaf(설계상 ellipsis 지정 요소는 정의역 밖) ──────────────
      const clipDomain = m.items.filter(i => !i.isEllipsis);
      const clipped = clipDomain.filter(i => i.scrollW > i.clientW + 1);
      eq(`clip:${tag}`, clipped.map(c => `${c.t}(${c.scrollW}>${c.clientW})`), [], `검사 ${clipDomain.length}건`);
      bump('clip', clipDomain.length);
      const clipDomainMin = SCREEN === 'list' ? 15 : 20;
      eq(`clip-domain:${tag}`, clipDomain.length > clipDomainMin ? 'OK' : `CLIP_DOMAIN_TOO_SMALL(${clipDomain.length})`, 'OK');

      // ── 잘림 축 ⓑ overflow:hidden 컨테이너(하드 클립, ellipsis 아닌 것) ───────
      // 이 화면의 유일한 overflow:hidden 요소는 이름 span(ellipsis 짝)뿐임을 소스로 확인했다(설계상 도메인 0).
      // "ellipsis 없이 그냥 자르는" 컨테이너가 하나라도 생기면 여기서 잡힌다. 도메인 0은 FAIL이 아니라
      // "확인된 부재"이므로 sentinel로 강제 FAIL시키지 않고, 대신 ellipsis 메커니즘 자체가 실제로 걸려 있는지
      // (rawOverflowHidden>0)를 별도로 단언한다 — 그게 0이면 ellipsis 스타일이 애초에 안 먹은 것이라 진짜 결함이다.
      eq(`clip-raw-applied:${tag}`, m.clippers.length > 0 ? 'OK' : 'NO_OVERFLOW_HIDDEN_AT_ALL', 'OK', 'ellipsis 메커니즘 자체 적용 여부');
      bump('clip-raw', m.clippers.length);
      // 도메인 0일 수 있으므로(설계상 부재) 조건부로 감싸지 않고 **무조건** 단언한다 — 조건부 분기는
      // 재실행 간 총계를 흔든다. 대신 hard-clip 건수를 note에 실어 도메인 크기를 항상 눈에 보이게 둔다.
      const hardClippers = m.clippers.filter(c => !c.isEllipsis);
      const cut = hardClippers.filter(c => c.scrollW > c.clientW + 1);
      eq(`clip-container:${tag}`, cut.map(c => `${c.t}(${c.scrollW}>${c.clientW})`), [],
        `hard-clip 컨테이너 ${hardClippers.length}건 / overflow:hidden 총 ${m.clippers.length}건`);
      bump('clip-container', hardClippers.length);

      // ── 「줄어도 되는 것 / 줄면 안 되는 것」 역할 분담 축(task#275의 규율) ──────────────
      // 두 화면은 이 규율을 **다른 메커니즘**으로 지킨다 — 화면 분기는 축의 정의역이지 무음 스킵이 아니다
      // (각 분기가 무조건 2건씩 단언하므로 총계는 화면·뷰포트 수에 구조적으로 고정된다).
      //   · 목록 카드 = ellipsis 관용구(제목만 1줄 고정, TechReports.jsx:57 소스 확인) → 카드당 정확히 1개
      //   · 상세 표   = 무손실 관용구(task#280 S3) → 아래 shrink-discipline
      if (SCREEN === 'list') {
        const badEll = m.perCard.map((u, i) => u.ellCount === 1 ? null : `${i}:${u.ellCount}`).filter(Boolean);
        eq(`ellipsis-discipline:${tag}`, badEll, [], `단위 ${m.perCard.length}개`);
        bump('ellipsis-discipline', m.perCard.length);
        eq(`ellipsis-discipline-domain:${tag}`, m.perCard.length, LIST_REPORTS.length);
      } else {
        // task#280 S3에서 이 표면의 계약이 바뀌었다: NAME_TEXT가 `maxWidth:190 + ellipsis`를 버리고
        // `minWidth:0 + overflowWrap:break-word`가 됐다(적대 리뷰 F14 — 표가 전혀 넘치지 않는 PC에서도
        // 무조건 잘랐고 복구 수단이 title 속성뿐이라 터치 기기엔 전체 이름을 볼 방법이 없었다).
        // 그래서 옛 `ellCount === 1`은 **사라진 메커니즘을 박제한 단언**이 됐다(전 행 0 → 거짓 FAIL).
        // 축을 버리지 않고 task#275가 지키려던 *의도*로 다시 쓴다 — 줄어도 되는 것(업체명)만 유연하게
        // 두고, 줄면 안 되는 것(수치·티커·배지)은 고정해 **잘림이 수치를 먹지 않게** 한다.
        // 옛 축보다 엄격하다: ellipsis가 되살아나면 FAIL하고(옛 축은 그걸 PASS로 셌다), 역할이 뒤바뀌어도
        // (이름 nowrap / 수치 normal) FAIL한다. 잘림 축(clip:)과도 상보 — clip:은 `isEllipsis` 요소를
        // 정의역에서 빼므로 이름에 ellipsis가 붙는 순간 이름을 **조용히 놓친다**. 여기가 그 구멍을 막는다.
        const viol = [];
        let sibN = 0, cellN = 0;
        for (const [i, r] of m.rows.entries()) {
          const id = (r.name || `row${i}`).slice(0, 12);
          // ⓐ 이름 = 유일하게 유연한 요소 + 무손실(문자를 잃지 않는다)
          const n = r.nameCs;
          if (!n) viol.push(`name/${id}:NAME_MISSING`);
          else {
            if (n.ws === 'nowrap') viol.push(`name/${id}:NOWRAP(접힐 수 없음)`);
            if (n.to === 'ellipsis') viol.push(`name/${id}:ELLIPSIS(문자 삭제)`);
            if (n.sw > n.cw + 1) viol.push(`name/${id}:CLIPPED(${n.sw}>${n.cw})`);
            if (!n.flexChild) viol.push(`name/${id}:NOT_FLEX_CHILD`);
          }
          // ⓑ 이름의 flex 형제(배지) = 줄면 안 되는 것 → flex-shrink:0 + nowrap
          for (const s of r.flexSibs) {
            sibN++;
            if (s.shrink !== '0') viol.push(`sib/${id}/${s.t}:shrink=${s.shrink}`);
            if (s.ws !== 'nowrap') viol.push(`sib/${id}/${s.t}:ws=${s.ws}`);
          }
          // ⓒ 이름 열 밖의 셀(task#296: 국가·티커는 이름 셀 내부로 이동 — 이제 기술수준·선두 대비·
          //    점유율만 남는다). ⚠️ 셋을 한 규칙으로 묶지 말 것 — **기술수준만 줄바꿈이 의도**다
          //    (task#296 S3ⓒ: `5단계 · 양산상용` 14자가 278px 4열에서 넘쳐 2줄을 허용했다). 수치 열은
          //    여전히 nowrap이어야 한다(수치는 접히면 안 된다). 인덱스가 아니라 **헤더 라벨로 분류**
          //    한다 — 열 집합이 playerColumns 파생이라 판마다 인덱스가 달라진다.
          for (const c of r.cellInfo.filter(c => c.i > 0)) {
            cellN++;
            if (c.ws !== 'nowrap') viol.push(`cell/${id}/#${c.i}(${c.label}):ws=${c.ws} want=nowrap`);
            if (c.sw > c.cw + 1) viol.push(`cell/${id}/#${c.i}(${c.label}):CLIPPED(${c.sw}>${c.cw})`);
          }
          // ⓓ task#304 — 밴드 셀 자신이 접히지 않는가. 옛 규칙("기술수준만 줄바꿈이 의도")은
          //    task#296이 `5단계 · 양산상용` 14자를 278px 4열에 넣으려고 준 예외인데, ADR-0041이 그
          //    텍스트를 5칸 밴드로 바꾸면서 **예외의 근거 자체가 사라졌다**(밴드는 flex-shrink:0 고정
          //    요소라 접히지 않고, 폭은 칸 크기로 맞춘다). 그래서 위 규칙을 「수치 열은 전부 nowrap」
          //    으로 되돌리고, 밴드가 실제로 한 줄인지를 **별도 축**으로 잰다 — nowrap 선언만으로는
          //    flex 자식들이 wrap되는 것을 못 본다(가토 ⑨: 넘치지 않는 줄바꿈).
          if (r.band) {
            if (r.band.lines !== 1) viol.push(`band/${id}:LINES=${r.band.lines}(칸 묶음이 접혔다)`);
            if (r.band.total !== 5) viol.push(`band/${id}:cells=${r.band.total}`);
          } else if (r.level != null) {
            viol.push(`band/${id}:BAND_MISSING(level=${r.level})`);
          }
        }
        // 실측치를 PASS 메시지에 싣는다 — 이름 폭은 뷰포트마다 줄고(유연) 수치 열 폭은 안 줄어야 한다(고정).
        const nameW = m.rows.map(r => (r.nameCs ? `${r.nameCs.sw}/${r.nameCs.cw}` : 'NA')).join(',');
        const fixedW = (m.rows[0]?.cellInfo || []).filter(c => c.i > 0).map(c => c.w).join(',');
        eq(`shrink-discipline:${tag}`, viol, [],
          `유연 이름 ${m.rows.length}(sw/cw ${nameW}) · 고정 형제 ${sibN} · 고정 셀 ${cellN}(폭 ${fixedW})`);
        bump('shrink-discipline', m.rows.length + sibN + cellN);
        // 정의역 sentinel — 세 계열 중 하나라도 조용히 0이 되면 위 단언이 공허하게 통과한다(⑧ⓐ).
        // 기대값은 리터럴이 아니라 픽스처 입력에서 계산한다 — TABLE_COLS는 하드코딩 6이 아니라
        // playerColumns 미러(task#296: 국가·티커가 열에서 빠져 name·level·gap·share만 남을 수 있다).
        const TABLE_COLS = mirrorPlayerColumns(PLAYERS).length;
        const expSib = PLAYERS.filter(p => p.state_led).length; // 정부주도 배지 = 이름의 유일한 flex 형제
        eq(`shrink-discipline-domain:${tag}`,
          [m.headCols, m.rows.length, sibN, cellN],
          [TABLE_COLS, PLAYERS.length, expSib, PLAYERS.length * (TABLE_COLS - 1)],
          `[헤더 열, 행, 고정 형제, 고정 셀] — 픽스처 입력에서 계산(playerColumns=${JSON.stringify(mirrorPlayerColumns(PLAYERS))})`);
      }

      // ── 줄 수 축 — 도메인은 whiteSpace:nowrap 선언 leaf(이 컴포넌트의 "1줄 강제" 신호).
      // note/description/challenge body/제목 등 자유 텍스트는 nowrap이 없어(설계상 여러 줄 허용) 정의역 밖 —
      // task#275의 "inline lineHeight로 산문 배제" 대신 이 컴포넌트의 실제 관용구(nowrap=1줄 강제)로 정의역을
      // 잡는다(코드 확인: 이름·국가·단계·격차·점유율 span만 whiteSpace:'nowrap', 나머지는 미지정).
      // ⚠️ Badge(`ui/Badge.css` `.badge{white-space:nowrap}`)도 이 도메인에 들어온다 — 처음엔 놓쳐서
      // 실측 24 vs 기대 20으로 FAIL했다(디버그로 확인 후 반영). 리터럴이 아니라 같은 픽스처 배열에서
      // 유도한 불변식으로 기대치를 계산한다.
      const nowrapDomain = m.items.filter(i => i.isNowrap);
      const folded = nowrapDomain.filter(i => i.lines !== 1);
      eq(`line-visible:${tag}`, folded.map(f => `${f.t}(${f.lines}줄)`), [], `검사 ${nowrapDomain.length}건`);
      bump('line-visible', nowrapDomain.length);
      const badgeCount = SCREEN === 'detail'
        ? (DETAIL_REPORT.difficulty?.score != null ? 1 : 0)
          + PLAYERS.filter(p => p.state_led).length
          + PLAYERS.filter(p => p.ticker && STOCKS_FIXTURE.some(s => s.ticker === p.ticker)).length
        : 0; // 목록 카드엔 Badge가 없다(소스 확인 — Stat만 사용).
      // 1/2 표면이 스스로 기여하는 **최소** 표본 수. task#277이 같은 페이지에 4섹션(기술수준 밴드·
      // 점유율·성장차트·관계도)을 배선하면서 이 축의 도메인이 24 → 46으로 정당하게 늘었다 —
      // 정확일치로 두면 그 정당한 변경에 거짓 FAIL한다(리터럴이 아니라 불변식을 단언할 것).
      // 하한으로 두어도 ⑧ⓑ의 목적(표본이 조용히 사라지는 측정 실패 탐지)은 지켜진다: 1/2 기여분보다
      // 줄면 FAIL이고, 실측치는 아래 note로 항상 출력해 재실행 간 드리프트를 눈으로 비교할 수 있다.
      // task#280 1/2에서 nowrap 선언이 span → <td>로 옮겨갔다: 행당 **텍스트 전용** nowrap 셀 4개
      // (국가·기술수준·선두 대비·점유율 — 이름/티커 셀은 자식 요소가 있어 leaf가 아니다) + 헤더 6열.
      // ⚠️ task#304 — 표본 구성이 **바뀌었다(총계는 그대로거나 늘어난다)**. 기술수준 `<td>`는 이제
      //    자식(칸 묶음 div)을 가져 **텍스트 leaf에서 빠지고**, 대신 그 안의 **단계 숫자 span**이
      //    nowrap을 상속해 leaf로 들어온다 → 행당 1개는 유지된다. 여기에 5단계 범례 항목 5개
      //    (.tech-level-band__legend-item{white-space:nowrap})가 **새로 더해진다**. 빈 칸 span 5개는
      //    텍스트가 없어 정의역 밖이다. 총계 변동의 원인을 이 주석과 아래 회계 로그로 못박는다
      //    (총계가 조용히 움직이면 통과가 아니라 측정 실패다 — 가토 ⑧ⓑ).
      const LEGEND_ITEMS = 5;
      const minNowrap = SCREEN === 'list' ? LIST_REPORTS.length : PLAYERS.length * 4 + 6 + badgeCount + LEGEND_ITEMS;
      eq(`line-visible-domain:${tag}`,
        nowrapDomain.length >= minNowrap ? 'OK' : `DOMAIN_SHRANK(${nowrapDomain.length} < ${minNowrap})`, 'OK',
        `실측 ${nowrapDomain.length}건 · 1/2 하한 ${minNowrap} · badgeCount=${badgeCount} · 범례 ${LEGEND_ITEMS}`);
      // 기술수준 셀이 텍스트 leaf 계열에서 어떻게 재구성됐는지 **수치로** 남긴다(before/after 비교용).
      if (SCREEN === 'detail') {
        const digitLeaves = m.items.filter(i => /^[1-5]$/.test(i.t)).length;
        const legendLeaves = m.items.filter(i => /^[1-5] (기초연구|시제품|실증|초기상용|양산상용)$/.test(i.t)).length;
        const stageTextLeaves = m.items.filter(i => /단계 · /.test(i.t)).length;
        rawLog.push(`${tag} · leaf 총 ${m.items.length} · nowrap ${nowrapDomain.length}(하한 ${minNowrap})` +
          ` · 단계숫자 leaf ${digitLeaves} · 범례 leaf ${legendLeaves} · 옛 「N단계 · 라벨」 leaf ${stageTextLeaves}(0이 정상)`);
      }

      // ── bbox — 가로 넘침(전체 leaf, ellipsis 포함 — 시각적 박스는 ellipsis도 넘지 않는다).
      // 단 자체 overflow-x 스크롤러 안쪽은 정의역 밖 — 표는 축소하지 않고 설계폭을 지킨 채 스크롤한다(가토 ⑫).
      // 제외 건수를 커버리지에 별도 계상해 "정의역이 조용히 줄었다"가 눈에 보이게 둔다.
      const bboxDomain = m.items.filter(i => !i.inScroller);
      const over = bboxDomain.filter(i => i.right > m.rootRight + 1);
      eq(`bbox:${tag}`, over.map(o => `${o.t}(${o.right}>${m.rootRight})`), [],
        `검사 ${bboxDomain.length}건 · 스크롤러 내부 제외 ${m.items.length - bboxDomain.length}건 · root=${m.rootRight}`);
      bump('bbox', bboxDomain.length);
      bump('bbox-scroller-excluded', m.items.length - bboxDomain.length);

      if (SCREEN === 'detail') {
        // ── market-summary — task#282 S3: 요약 카드가 사라지고 MarketGrowthChart 캡션이
        // `{요약} · 기준 {as_of}`(출처 join은 제거됨)를 흡수했다. 리터럴이 아니라 픽스처에서
        // 계산한 기대값과 대조 ──
        const expected = `${fmtSummary(MARKET)} · 기준 ${MARKET.as_of}`;
        eq(`market-summary:${tag}`, m.marketSummaryText, expected);

        // ── sources — 주입한 출처 전부 노출, 캡션↔칩 간격(가토 ⑩) ──
        for (const s of SOURCES) {
          eq(`source:${tag}:${s.title}`, m.sourcesTexts.includes(s.title) ? 'FOUND' : 'SOURCE_MISSING', 'FOUND');
          bump('source');
        }
        eq(`gap-sources-domain:${tag}`, m.sourceGap != null ? 'OK' : 'GAP_SOURCES_DOMAIN_EMPTY', 'OK');
        if (m.sourceGap != null) {
          eq(`gap-sources:${tag}`, m.sourceGap >= 0 && m.sourceGap <= 24 ? 'OK' : `${m.sourceGap}px`, 'OK', `실측 ${m.sourceGap}px`);
        }

        // ── gap 축(1/2에서 교체) — 옛 `gap-name-meta`(이름행 ↔ 메타행 세로 간격)의 대상은 표에서
        //    소멸했다(row.children[1]이 국가 <td>라 세로 gap이 음수 → 거짓 FAIL). 축의 *이유*(한 업체의
        //    정보가 두 덩어리로 읽히면 안 된다)는 살아 있으므로 **셀 인접 간격**으로 교체한다.
        //    커버리지 키 `gap`은 유지 — 총계 비교선이 끊기지 않게(도메인은 PLAYERS.length 그대로).
        const gapDomain = m.rows.filter(r => r.gap != null);
        eq(`gap-cells-domain:${tag}`, gapDomain.length, PLAYERS.length, '행마다 이름·국가 두 셀이 있어야 한다');
        // 하한 −2px: border-collapse 표에서 인접 셀 박스는 정확히 맞닿거나 테두리 폭만큼 겹칠 수 있다
        // (그건 결함이 아니다). 이 축이 잡으려는 건 상한 쪽 — 붙어야 할 것이 떨어지는 경우다.
        const farGaps = gapDomain.filter(r => r.gap < -2 || r.gap > 24);
        eq(`gap-cells:${tag}`, farGaps.map(r => `${r.name}:${r.gap}px`), [], `실측 ${JSON.stringify(gapDomain.map(r => r.gap))}`);
        bump('gap', gapDomain.length);
        // 제목 → (선두 캡션) → 표 간격(가토 ⑩ — 붙어야 할 것이 떨어지면 한 그룹으로 안 읽힌다).
        // task#280 S3이 leader_name을 셀에서 캡션으로 승격해 이 자리가 2단이 됐다. 옛 축은 제목 bottom과
        // 표 top을 한 번에 재서 33px로 FAIL했는데, **그 33px은 빈 공간이 아니다** — 실측하면
        // 10px(제목↔캡션) + 17px(캡션 자신의 렌더 텍스트) + 6px(캡션↔표)이다. 즉 실제 void는 10·6px이고
        // 둘 다 옛 임계 24보다 **더 타이트**하다. 그래서 임계를 늘리는 게 아니라 사슬을 캡션을 **통과해**
        // 재는 것이 원래 의도를 그대로 지키는 형태다(임계 24는 그대로 두었다 — 완화 0).
        // 캡션 유무는 축의 정의역이다(위 measureDetail 주석 참조) — 링크 수를 픽스처에서 계산해 못박는다.
        const expLeaders = [...new Set(PLAYERS.filter(p => p.gap_years > 0 && p.leader_name).map(p => p.leader_name))];
        // task#304 — 범례가 끼어 링크가 하나 늘었다(캡션 있으면 3, 없으면 2). 기대값은 리터럴이
        // 아니라 픽스처에서 계산한다.
        const expLinks = expLeaders.length > 0 ? 3 : 2;
        const chain = m.titleChain || [];
        eq(`gap-title-table-domain:${tag}`, chain.length ? ['title', ...chain.map(l => l.to)] : 'GAP_TITLE_DOMAIN_EMPTY',
          ['title', ...(expLeaders.length > 0 ? ['caption'] : []), 'legend', 'table'],
          `사슬 ${JSON.stringify(chain)} · 링크 ${chain.length}(기대 ${expLinks})`);
        // 대상 유효성(⑧ⓘ) — 캡션은 이 축의 **새 측정 대상**이다. 간격만 재면 엉뚱한(빈·오조립) 캡션
        // 위에서도 통과한다. 기대 문자열은 PlayerTable의 조립 규칙을 픽스처 입력에 적용해 계산.
        eq(`gap-title-caption-identity:${tag}`, m.leaderText ?? 'CAPTION_ABSENT',
          expLeaders.length ? `선두 = ${expLeaders.join(' · ')}` : 'CAPTION_ABSENT', '픽스처 입력에서 계산');
        const farLinks = chain.filter(l => !(l.px >= 0 && l.px <= 24)).map(l => `${l.from}→${l.to}:${l.px}px`);
        eq(`gap-title-table:${tag}`, farLinks, [],
          `실측 ${chain.map(l => `${l.from}→${l.to} ${l.px}px`).join(' · ') || '사슬 없음'}`);
        bump('gap', chain.length);

        // ── 섹션 배치 순서 — 1/2의 목적 자체(산문이 앞이 아니라 뒤). 개별 존재 단언은 순서가
        //    뒤집혀도 전부 통과하므로 별도 축으로 세운다.
        const seq = ['lead', 'kpis', 'players', 'prose', 'sources'];
        const missingAnchor = seq.filter(k => m.order[k] < 0);
        eq(`order-domain:${tag}`, missingAnchor.length ? `ANCHOR_MISSING(${missingAnchor.join(',')})` : 'OK', 'OK',
          `인덱스 ${JSON.stringify(m.order)}`);
        const oidx = seq.map(k => m.order[k]);
        eq(`order:${tag}`, oidx.every((v, i) => i === 0 || (v > oidx[i - 1] && oidx[i - 1] >= 0)) ? 'OK' : `OUT_OF_ORDER(${JSON.stringify(m.order)})`, 'OK',
          'lead→kpis→players→prose→sources');
        bump('order', seq.length);

        // ── KPI 스트립 — deriveTechKpis는 항상 6칩(결측은 —). 칩 수가 데이터에 따라 흔들리면 안 된다.
        eq(`kpi-count:${tag}`, m.kpiCount, 6, `값=${JSON.stringify(m.kpiValues)}`);
        bump('kpi', m.kpiCount);

        // ── 산문 — task#296 S6에서 뒤집음(#264 절차: 그 태스크의 계획서 완료기준·비목표에 "열림
        //    상태"가 이름으로 등장하지 않았던 부수적 단언이라 뒤집는다, 근거는 task#296 plan.md —
        //    사용자 결정: 스크롤+전역 목차가 항해를 대신하므로 접기 자체를 없앤다).
        //    옛 `prose-total`/`prose-open`/`prose-collapsed`(detailsTotal 기반)는 이제 **부재**를
        //    요구하는 축으로 교체한다 — 완화가 아니라 더 엄격하다: 예전엔 "0개 열림"만 봤지만
        //    이제 "그 메커니즘 자체가 없다"(details 0)와 "클릭 없이 이미 보인다"(h3Hidden 0)를 본다.
        eq(`prose-details:${tag}`, m.detailsTotal, 0, '<details> 메커니즘 완전 제거');
        eq(`prose-h3-count:${tag}`, m.h3Total, TITLED_ITEMS, '소제목 섹션 + 난이도 근거를 <h3>로 렌더(픽스처 입력에서 계산)');
        eq(`prose-h3-visible:${tag}`, m.h3Hidden, 0, '클릭 없이 전부 가시(닫힌 <details> 자손이면 hidden으로 잡힌다)');
        // 실데이터엔 없는 분기(실발행 2건은 첫 줄이 헤딩이다) — 헤딩 앞 선행 문단은 접지 않고 보존.
        eq(`prose-plain:${tag}`, m.plainCount, 1, '소제목 없는 선행 문단은 <p>로 항상 보인다');
        eq(`prose-plain-text:${tag}`, m.plainText, LEAD_PARA, '선행 문단 원문 보존(정보 손실 0)');
        bump('prose', m.h3Total + m.plainCount);

        // ── task#304 신규 축 ⓐ — 기술수준 밴드가 **화면에서 읽히는가**(ADR-0041 결정 1) ─────────
        //    기대값은 리터럴이 아니라 픽스처(PLAYERS)에서 계산한다. 픽스처엔 tech_level 결측 행이
        //    없으므로 `—` 분기는 이 프로브의 정의역 밖이고(실데이터 판은 uat280이 덮는다) 그 사실을
        //    아래 domain 축이 수치로 못박는다.
        const wantLv = new Map(PLAYERS.map(p => [p.name, p.tech_level]));
        eq(`level-band-domain:${tag}`,
          [m.rows.length, m.rows.filter(r => r.band).length],
          [PLAYERS.length, PLAYERS.filter(p => TECH_LEVEL_LABELS[p.tech_level]).length],
          '픽스처 전 행이 tech_level을 가지므로 밴드도 전 행 렌더(결측 분기는 정의역 밖)');
        const lvViol = m.rows.flatMap(r => {
          const want = wantLv.get(r.name);
          if (want == null) return [`${r.name}:NOT_IN_FIXTURE`];
          if (!r.band) return [`${r.name}:BAND_MISSING(want L${want})`];
          const bad = [];
          if (r.band.total !== 5) bad.push(`${r.name}:cells=${r.band.total}`);
          if (r.band.filled !== want) bad.push(`${r.name}:filled=${r.band.filled}!=${want}`);
          if (r.band.role !== 'img') bad.push(`${r.name}:role=${r.band.role}`);
          if (r.band.aria !== `${want}단계 · ${TECH_LEVEL_LABELS[want]}`) bad.push(`${r.name}:aria=${JSON.stringify(r.band.aria)}`);
          if (r.band.digit !== String(want)) bad.push(`${r.name}:digit=${JSON.stringify(r.band.digit)}`);
          // 화면 실측(가토 ⑫) — 선언값 6×10px이 아니라 렌더 픽셀. 0px면 기하 축은 전부 통과하면서
          // 화면엔 아무것도 없다.
          if (!(r.band.cellW >= 4)) bad.push(`${r.name}:cellW=${r.band.cellW}(<4px)`);
          if (!(r.band.cellH >= 6)) bad.push(`${r.name}:cellH=${r.band.cellH}(<6px)`);
          return bad;
        });
        eq(`level-band:${tag}`, lvViol, [],
          `행 ${m.rows.length}개 · 칸 폭 ${JSON.stringify(m.rows.map(r => r.band && r.band.cellW))}`);
        bump('level-band', m.rows.length);
        // 이빨 — 픽스처의 tech_level이 전부 같으면 위 단언은 채움 로직을 상수로 바꿔도 통과한다.
        eq(`level-band-teeth:${tag}`, new Set(PLAYERS.map(p => p.tech_level)).size >= 2 ? 'OK' : 'SINGLE_LEVEL_FIXTURE', 'OK',
          `픽스처 tech_level ${JSON.stringify(PLAYERS.map(p => p.tech_level))}`);

        // ── task#304 동작 ①②③ — 범례 존재 · 옛 섹션 부재 · 목차 칩 감소 ────────────────────
        eq(`legend:${tag}`, m.legendItems, TECH_LEVEL_LABELS.slice(1).map((l, i) => `${i + 1} ${l}`),
          '표 위 5단계 범례 1줄(밴드 섹션 최상단 관례 승계)');
        bump('legend', m.legendItems ? m.legendItems.length : 0);
        eq(`levels-section-absent:${tag}`, m.bandSectionGone, [0, 0],
          '[data-testid="tech-level-band"] · [data-tech-section="levels"] 둘 다 0');
        eq(`toc-no-levels:${tag}`, m.tocLabels.filter(t => t.includes('기술수준')), [],
          `목차 칩 ${m.tocLabels.length}개 = ${JSON.stringify(m.tocLabels)}`);
        bump('section-absent', 2);

        // ── 표 정렬 불변식 — 리터럴 순서를 박지 않는다(기술수준 비증가 · 동값 구간 격차 비감소 · null 최후).
        const lv = (r) => (r.level == null ? -Infinity : r.level);
        const viol = [];
        for (let i = 1; i < m.rows.length; i++) {
          const a = m.rows[i - 1], b = m.rows[i];
          if (lv(b) > lv(a)) viol.push(`level↑ ${a.name}(${a.level})→${b.name}(${b.level})`);
          else if (lv(b) === lv(a)) {
            if (a.gapYears == null && b.gapYears != null) viol.push(`null선행 ${a.name}(null)→${b.name}(${b.gapYears})`);
            else if (a.gapYears != null && b.gapYears != null && b.gapYears < a.gapYears) viol.push(`gap↓ ${a.name}(${a.gapYears})→${b.name}(${b.gapYears})`);
          }
        }
        eq(`table-order:${tag}`, viol, [], `실측 ${JSON.stringify(m.rows.map(r => `${r.name}:L${r.level}/G${r.gapYears}`))}`);
        bump('table-order', Math.max(0, m.rows.length - 1));
        eq(`table-rowcount:${tag}`, m.rows.length, PLAYERS.length, '표에서 사라진 업체 0');
        eq(`table-names:${tag}`, [...m.rows.map(r => r.name)].sort(), [...PLAYERS.map(p => p.name)].sort(),
          '렌더 업체명 집합 = 주입 업체명 집합');
        // 이빨 단언 — 전 행의 (level,gap)이 같으면 위 불변식이 아무것도 안 보면서 통과한다.
        eq(`table-order-teeth:${tag}`,
          new Set(m.rows.map(r => `${r.level}/${r.gapYears}`)).size > 1 ? 'OK' : 'ALL_ROWS_IDENTICAL', 'OK',
          `구별되는 (level,gap) 조합 ${new Set(m.rows.map(r => `${r.level}/${r.gapYears}`)).size}종`);

        // ── 색 축 — state_led·보유·관심 배지, 하드코딩 없이 :root 토큰과 대조 + 이빨 단언 ──
        const stateColors = m.rows.map(r => r.stateColor).filter(Boolean);
        const holdColors = m.rows.map(r => r.holdColor).filter(Boolean);
        const watchColors = m.rows.map(r => r.watchColor).filter(Boolean);
        eq(`color-domain:${tag}`, [stateColors.length, holdColors.length, watchColors.length], [1, 1, 1],
          '정부주도·보유·관심 배지 각 1개(픽스처 설계상 불변식)');
        bump('color', stateColors.length + holdColors.length + watchColors.length);
        eq(`color-state:${tag}`, stateColors[0] ?? 'MISSING', m.accentRgb, `--accent=${m.accentRgb}`);
        eq(`color-hold:${tag}`, holdColors[0] ?? 'MISSING', m.tagHoldRgb, `--tag-hold-color=${m.tagHoldRgb}`);
        eq(`color-watch:${tag}`, watchColors[0] ?? 'MISSING', m.tagWatchRgb, `--tag-watch-color=${m.tagWatchRgb}`);
        // 이빨 단언 — 토큰이 서로 같으면 위 3건이 아무것도 안 보면서 통과한다.
        const tokenSet = new Set([m.accentRgb, m.tagHoldRgb, m.tagWatchRgb]);
        eq(`color-tokens-differ:${tag}`, tokenSet.size, 3, `--accent=${m.accentRgb} --tag-hold=${m.tagHoldRgb} --tag-watch=${m.tagWatchRgb}`);
      } else {
        NOTE(`${tag} — 색 축은 상세 화면 전용(목록 카드엔 state_led/보유/관심 배지가 없다, 소스 확인됨)`);
      }

      // ── 콘솔 에러 ──
      eq(`console:${tag}`, errs, [], '주입 화면');
      bump('console');

      // ── 육안 스크린샷 ──
      const scrollTarget = SCREEN === 'list' ? '[data-testid="tech-report-card"]' : '[data-testid="tech-report-players"]';
      await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: 'center' }), scrollTarget);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${V.key}-${SCREEN}.png`, fullPage: false });
    } catch (e) {
      // "문법 오류 없이 끝까지 돈다"(완료기준) — 한 화면의 예외가 전체 실행을 죽이지 않게 sentinel로 흡수.
      eq(`exception:${tag}`, `THROWN:${e && e.message}`, 'NO_EXCEPTION');
      bump('exception');
    }
    await page.close();
  }
  await ctx.close();
}

await browser.close();

// ── 보고 ──────────────────────────────────────────────────────────────────
const fails = results.filter(r => !r.ok);
console.log('\n' + '═'.repeat(72));
console.log('커버리지 (계열별 검사 수 — 재실행 간 비교용):');
for (const [k, v] of Object.entries(cov).sort()) console.log(`  ${k.padEnd(24)} ${v}`);
console.log(`\n단언 총계: ${results.length}건 · PASS ${results.length - fails.length} · FAIL ${fails.length}`);
console.log('\n텍스트 leaf 회계(단언 아님 — task#304 밴드 흡수로 표본 구성이 바뀐 자리):');
for (const l of rawLog) console.log(`  ${l}`);
console.log('※ OR로 묶은 단언 없음(전 축이 독립 단언) — 항별 실측치 출력 규칙은 이 스크립트엔 해당 없음.');
console.log('※ ⓑ 주입 화면 — 실발행 아님. prod tech_reports 무쓰기(이 스크립트는 GET만 호출).');
console.log('═'.repeat(72));
if (fails.length) {
  console.log('\nFAIL 상세:');
  for (const f of fails) console.log(`  ✗ ${f.tag}\n      ${f.msg}`);
  process.exit(1);
}
console.log('\nALL PASS');
for (const r of results) console.log(`  ✓ ${r.tag} — ${r.msg}`);
