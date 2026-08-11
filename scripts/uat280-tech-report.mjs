// task#280 S6 라이브 UAT — 선도기술 리포트 상세를 **실발행 데이터**로 잰다(주입 0).
//
// 왜 별도 스크립트인가: scripts/uat276-tech-report.mjs는 전 API를 page.route로 주입하는 픽스처 전용
// 프로브라 **실데이터를 한 번도 재지 않는다**. 픽스처는 축을 자극하도록 설계된 입력이므로
// "설계한 축이 도는가"만 증명하고, 실발행물이 그 축을 통과하는지는 증명하지 않는다
// (fixture-pass-live-fail 가족). 이 스크립트가 그 구멍을 메운다 — page.route 금지, 실 API만.
//
// 응답 봉투·필드명은 추정하지 않았다. 착수 시 1콜로 실측 확인(2026-08-04):
//   GET /api/tech-reports/{slug} → {slug, reports:[{id, slug, published_date, title, description,
//     difficulty:{score,rationale}, players:[{name,country,ticker,tech_level,gap_years,leader_name,
//     share_pct,state_led,note}], challenges:[], related:{...}, market:{as_of,history,forecast,
//     cagr_pct,share_basis}, sources:[{title,url}], created_at}]}
//   프론트 소비: TechReport.jsx가 (data.reports || [])[0] 을 쓴다(소스 직독).
// 실측 요지 — smr: title 141자·players 9·cagr null·challenges 0·related 전무·share_pct 전무
//            reusable-rocket: title 181자·players 8·cagr 12.97·challenges 0·share_pct 1건(50.9)
// 두 판 모두 challenges/related가 비어 그 섹션은 렌더되지 않는다. 점유율 섹션은 **slug마다 다르다** —
// 리터럴로 박지 말고 응답에서 계산한 게이트식으로 단언한다(아래 share-gate).
//
// 판정 규율(전부 무조건 단언 + 축마다 *-domain sentinel):
//  - 조건부 단언(`if (조건) assert`) 금지 — 미검출은 sentinel 기대값으로 FAIL시켜 총계를 구조적으로 고정.
//  - 리터럴 금지 — 기대값은 전부 위 실응답에서 계산한다(정렬 순서·섹션 수·칩 수·점유율 게이트).
//  - 판정 범위는 본문 루트로 한정(전역 마스트헤드·모바일 seg 탭바가 섞이면 정상 구현이 거짓 FAIL한다).
//  - identity를 별도 축으로 먼저 둔다 — 판정축이 대상과 독립이면 틀린 페이지 위에서도 통과한다(가토 ⑧ⓘ).
//
// ── 추가: 선두 캡션 계열(caption-*) ────────────────────────────────────────
// S3의 F3 수정이 매 행 반복되던 leader_name을 셀에서 빼 **표 위 캡션 한 줄**로 승격했다
// (`선두 = CNNC (링룽 1호)`). 그건 이 변경이 새로 만든 UI 요소인데 이 스크립트가 한 번도 재지 않았다.
// 형제 프로브 uat276이 사슬 축(gap-title-caption/-table)을 갖췄지만 그건 **픽스처 전용**이고 그 픽스처는
// 고유 선두가 1개라 **다중 선두 캡션을 원리적으로 못 본다**. 실발행은 다르다(착수 시 실측):
//   smr             — 고유 leader_name 1개 → `선두 = CNNC (링룽 1호)`
//   reusable-rocket — 고유 leader_name 2개 → `선두 = SpaceX (Falcon 9) · SpaceX (Grasshopper …)`
// 길어진 캡션은 접히거나(정상) 잘리거나(결함) 본문을 가로로 밀 수 있다(결함). 그래서 여기서 잰다.
// 사슬 측정 관용구·임계(0~24px)는 uat276에서 그대로 가져왔다(완화 0) — 옛날 "33px 간격"은 빈 공간이
// 아니라 10px 여백 + 17px 캡션 텍스트 + 6px 여백이었고, 링크별로 재면 실제 여백은 임계보다 타이트하다.
//
// ── task#296 S6 갱신(적대적 리뷰 렌즈2 지목분 F1·표 + 렌즈1 직독으로 추가 확인분) ──────────────
// PlayerTable이 표 스크롤러(SCROLLER, overflowX:auto)와 note 접기(<details>/<summary>)를 전부
// 제거했다. 그래서 이 파일의 다음 축을 **뒤집는다**(버리지 않는다 — 없는 축은 다음 사람이 존재를
// 모른다):
//  · 행 파서(cells[2]=level·[3]=gap·[4]=share·[5]=ticker·[1]=country 고정 인덱스) → 렌더된 `<th>`
//    라벨로 찾는다. 국가·티커는 이제 열이 아니라 이름 셀 내부 메타줄이라 열 인덱스로 못 잡는다
//    (이 파일은 그 값을 애초에 단언하지 않으므로 제거 — 죽은 필드를 남기지 않는다).
//  · `table-scroller-domain`/`table-no-overflow`(PC만 스크롤러 *존재*를 요구) → 스크롤러가 완전히
//    없어졌으므로 **전 뷰포트**에서 "스크롤러 조상 0개 + table 자신 scrollW<=clientW"로 교체.
//  · `noteBtns`/`NOTE_TOGGLE_SEL`(summary 클릭 카운트) → note는 이제 클릭 없이 상시 렌더 —
//    `note-open`(클릭 1회 → 펼침 1개) 사이클을 통째로 없애고 `role="group"`을 직접 잰다.
//  · `detailsTotal`/`detailsOpen` 기반 prose-total/open/collapsed → `<details>` 0개 + `<h3>` 개수.
// 뒤집는 근거는 task#280 S4의 기록이 아니라 task#296 계획(사용자 결정, task#264 절차)이다.
import { chromium, devices } from 'playwright';
import fs from 'fs';

console.log('실데이터 — page.route 주입 없음(라이브 /api/tech-reports/{slug} 실응답). GET만 호출(무쓰기).');

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat280';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const P = (ok, tag, msg) => results.push({ ok, tag, msg });
// 캡션 실측 로그(단언 아님) — 개별 PASS 메시지는 FAIL이 하나라도 있으면 출력되지 않으므로(아래 보고
// 블록), 이 계열의 실측치는 별도로 모아 **무조건** 출력한다. 출력은 넓게, 단언은 목표에만(가토 ⑧ⓗ).
const capLog = [];
// KPI 첫 화면 가시성 — 정상 상태(게이트) 수치 보관 + 첫 방문 상태(게이트 아님) 실측 로그.
// 둘 다 **무조건** 출력한다(개별 PASS 메시지는 FAIL이 하나라도 있으면 안 찍히는 구조라서).
const kpiState = {};
const fvLog = [];
const cov = {};
const bump = (k, n = 1) => { cov[k] = (cov[k] || 0) + n; };
const eq = (tag, got, want, note = '') => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  P(ok, tag, `${ok ? 'PASS' : 'FAIL'} — got=${JSON.stringify(got)} want=${JSON.stringify(want)}${note ? ' · ' + note : ''}`);
};
// 정보성 로그(단언 아님) — "정의역이 실행 전에 결정돼 이 판에는 축이 없다"처럼 FAIL로 만들면 안 되는 사실 전용.
const NOTE = (msg) => console.log(`  ℹ ${msg}`);

// ── 로그인 (추정 폴백 없음 — 실패 시 즉시 exit) ──────────────────────────────
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const { access_token, refresh_token } = await login.json();
if (!access_token) { console.error('로그인 실패 — access_token 없음. 종료.'); process.exit(1); }

// TECH_NAMES 미러 — frontend/src/components/reports/techReportUtils.js 의 표시명 맵(백엔드는 이 이름을
// 응답에 싣지 않는다, ADR-0033 결정 2). h1 identity 단언의 기대값 소스이므로 슬러그가 없으면 즉시 exit.
const TECH_NAMES = { 'reusable-rocket': '재사용 로켓', 'solid-state-battery': '전고체 배터리', smr: 'SMR', robotics: '로봇' };

const SLUGS = ['smr', 'reusable-rocket'];

// ── 이빨 실증용 fault-injection(대조군) — 기본 꺼짐. `CAPTION_CONTROL=gap|clip` 으로 켠다 ──────
// 앱은 건드리지 않고 **처방만 무효화**하는 대조군이다(가토 ⑧ⓚ). 켠 실행은 캡션 축이 FAIL해야 정상이며
// 게이트로 쓰지 않는다(1회용 판별력 실증).
// ⚠️ PlayerTable의 캡션은 **인라인 스타일**(CAPTION 상수)이라 스타일시트 규칙이 진다 → `!important`
//    없이는 주입이 조용히 no-op하고, 그러면 "축에 이빨이 없다"고 오독하게 된다. 주입이 실제로 먹었는지는
//    아래 caption-gap / caption-clip 메시지의 실측치가 움직이는지로 확인한다(그게 유일한 증거다).
const CONTROL = process.env.CAPTION_CONTROL || '';
const CONTROL_CSS = {
  // 사슬을 양쪽으로 벌린다 — 제목↔캡션·캡션↔표 두 링크 모두 임계 24px를 넘겨야 한다.
  gap: '[data-testid="tech-report-players-leader"]{margin-top:80px !important;margin-bottom:80px !important}',
  // 캡션을 좁혀 잘리게 한다 — nowrap+hidden이면 접히지 못하고 scrollW > clientW가 된다.
  clip: '[data-testid="tech-report-players-leader"]{white-space:nowrap !important;overflow:hidden !important;max-width:60px !important;display:block !important}',
};
if (CONTROL && !CONTROL_CSS[CONTROL]) {
  console.error(`CAPTION_CONTROL=${CONTROL} 미지원(gap|clip 중 하나). 종료.`); process.exit(1);
}
if (CONTROL) console.log(`⚠ 대조군 실행 — CAPTION_CONTROL=${CONTROL}: 캡션 축이 FAIL해야 정상(게이트 아님).`);

// kpi-visible 게이트의 이빨 실증용 대조군 — `KPI_CONTROL=push`로 켠다(기본 꺼짐).
// 리드 문단 아래에 큰 여백을 강제해 스트립을 fold 아래로 민다. 스트립 top이 실제로 내려갔는지
// (= 주입이 no-op이 아닌지) FAIL 메시지의 실측치로 먼저 확인한다.
const KPI_CONTROL = process.env.KPI_CONTROL || '';
const KPI_CONTROL_CSS = {
  push: '[data-testid="tech-report-lead"]{padding-bottom:700px !important}',
};
if (KPI_CONTROL && !KPI_CONTROL_CSS[KPI_CONTROL]) {
  console.error(`KPI_CONTROL=${KPI_CONTROL} 미지원(push). 종료.`); process.exit(1);
}
if (KPI_CONTROL) console.log(`⚠ 대조군 실행 — KPI_CONTROL=${KPI_CONTROL}: kpi-visible이 FAIL해야 정상(게이트 아님).`);

// ── 실응답 수집 + 기대값 계산(전부 응답에서 유도 — 리터럴 0) ────────────────
// parseDescriptionSections 미러(techReportUtils.js 규칙 직독): "그 줄 전체가 [..]"인 줄만 헤딩.
// 소제목 있는 섹션만 <details>가 되고, 헤딩 앞 선행 문단은 접히지 않는 <p>(tech-prose-plain)로 남는다.
const bracketHeadings = (text) =>
  (typeof text === 'string' ? text.split('\n') : []).filter((l) => /^\[[^\]]+\]$/.test(l.trim())).length;

// playerColumns 미러(techReportUtils.js와 동일 로직, task#296) — 열 수·순서를 리터럴로 박지 않고
// 실응답에서 유도한다. 국가·티커는 이제 열이 아니라 이름 셀 내부 메타줄이라 이 배열엔 없다.
const mirrorPlayerColumns = (players) => {
  const list = Array.isArray(players) ? players : [];
  const cols = ['name', 'level'];
  if (list.some((p) => p?.gap_years != null)) cols.push('gap');
  if (list.some((p) => Number.isFinite(p?.share_pct) && p.share_pct >= 0)) cols.push('share');
  return cols;
};
const DATA = {};
for (const slug of SLUGS) {
  const res = await fetch(`${BASE}/api/tech-reports/${slug}`, { headers: { Authorization: `Bearer ${access_token}` } });
  const body = await res.json();
  const rep = (body.reports || [])[0];
  if (!rep) { console.error(`발행물 없음 — /api/tech-reports/${slug} reports[0] 부재. 종료.`); process.exit(1); }
  if (!TECH_NAMES[slug]) { console.error(`TECH_NAMES 미러에 ${slug} 없음(기대값 소스 부재). 종료.`); process.exit(1); }

  const players = rep.players || [];
  // 접힘 항목 수 = 소제목 섹션 수 + (난이도 근거 있으면 1). ProseSections는 task#280 S4에서 전부
  // 접힘으로 뒤집혔다(firstTitled만 open이던 구동작은 폐기) — 접힌 수 = 총 details 전체.
  const rationale = rep.difficulty?.rationale;
  const titled = bracketHeadings(rep.description) + (typeof rationale === 'string' && rationale.trim() !== '' ? 1 : 0);

  DATA[slug] = {
    rep, players,
    techName: TECH_NAMES[slug],
    title: rep.title,
    titledItems: titled,
    rationale: (rationale || '').trim(),
    // 손실 0 대조용 — 헤딩 줄은 <h3>로 승격되며 대괄호가 벗겨지므로 대상에서 뺀다.
    proseLines: (rep.description || '').split('\n').map((l) => l.trim())
      .filter((l) => l !== '' && !/^\[[^\]]+\]$/.test(l)),
    // 점유율 섹션 게이트 — TechReport.jsx의 채택식과 같은 식(ShareChart의 필터와도 동일).
    hasShare: players.some((p) => Number.isFinite(p.share_pct) && p.share_pct >= 0),
    // x축 틱 하한 = 시계열에 등장하는 연도 수(리터럴 아님)
    years: new Set([...(rep.market?.history || []), ...(rep.market?.forecast || [])].map((p) => p.year)).size,
    names: players.map((p) => p.name),
    // 캡션 identity의 기대값 — PlayerTable의 조립 규칙(`rows.filter(p => p.gap_years > 0 && p.leader_name)`의
    // 고유값)을 **실응답에 그대로 적용**해 계산한다. 리터럴 0. 정렬(sortPlayers)은 집합을 바꾸지 않으므로
    // 여기선 순서를 쓰지 않고 집합으로만 대조한다(순서 리터럴을 박으면 정당한 정렬 변경에 거짓 FAIL한다).
    leaders: [...new Set(players.filter((p) => p.gap_years > 0 && p.leader_name).map((p) => p.leader_name))],
    // task#296 — 열 집합(리터럴 아님, 실응답에서 유도) + note 있는 업체(name으로 식별 — 렌더는
    // sortPlayers로 API 순서와 달라지므로 note 행 순서를 index로 API players에 대응시키면 안 된다).
    cols: mirrorPlayerColumns(players),
    notedPlayers: players.filter((p) => typeof p.note === 'string' && p.note.trim() !== ''),
  };
  console.log(`  [실응답] ${slug}: title ${rep.title.length}자 · players ${players.length} · 소제목항목 ${titled}` +
    ` · cagr ${rep.market?.cagr_pct} · challenges ${(rep.challenges || []).length} · share섹션 ${DATA[slug].hasShare}` +
    ` · sources ${(rep.sources || []).length} · 연도 ${DATA[slug].years}` +
    ` · 고유선두 ${DATA[slug].leaders.length}명 ${JSON.stringify(DATA[slug].leaders)}`);
}

// ── 브라우저 안 측정기 ────────────────────────────────────────────────────
// 범위: ResearchShell이 PC는 `.page`, 모바일은 `.m-page`로 **children만** 감싼다(소스 확인) — 그 안쪽을
// 루트로 잡아야 모바일 seg 탭바·마스트헤드가 표본에 섞이지 않는다(uat276에서 실측으로 확정한 관용구).
const ROOT_SEL = 'main.page-wrap .page, main.page-wrap .m-page';

const measure = (page) => page.evaluate((ROOT_SEL) => {
  const root = document.querySelector(ROOT_SEL);
  if (!root) return { found: false };
  const playersEl = root.querySelector('[data-testid="tech-report-players"]');
  if (!playersEl) return { found: false };

  const cs = (el) => getComputedStyle(el);
  const txt = (el) => el.textContent.trim();
  const vw = window.innerWidth, vh = window.innerHeight;

  // 하단 fixed 탭바(MobileNav `nav.tabbar`) — 모바일에서 화면 바닥을 덮으므로 "가시" 판정의 유효
  // 바닥은 vh가 아니라 vh − 탭바 높이다. PC는 App.css가 display:none → getBoundingClientRect가
  // 0을 준다(그래서 하드코딩 0이 아니라 **런타임 실측**이며, 미디어쿼리가 바뀌면 자동으로 따라간다).
  const tabbarEl = document.querySelector('nav.tabbar');
  const tabbarH = tabbarEl ? Math.round(tabbarEl.getBoundingClientRect().height) : 0;
  const visibleBottom = vh - tabbarH;
  // PWA 설치 유도 배너 — **앱 전역** 프로모이지 이 페이지의 레이아웃이 아니다(App.jsx가 본문 위에
  // 마운트, `position: relative` 인플로우라 렌더되면 아래 콘텐츠를 통째로 밀어내린다 — mobile.css:344).
  // 루트 밖이므로 document에서 찾는다(tabbar와 같은 관용구). 조건은 pwa.js 직독:
  // `!isStandalone() && !isInstallSuppressed()` + iOS 또는 Android UA — 그래서 iPhone 13 디바이스
  // 프로필에서만 뜨고 평문 viewport(m350·pc1440)에선 UA가 데스크톱이라 **원래 안 뜬다**.
  const bannerEl = document.querySelector('.install-prompt');
  const bannerH = bannerEl ? Math.round(bannerEl.getBoundingClientRect().height) : 0;
  const box = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { h: Math.round(b.height), top: Math.round(b.top), bottom: Math.round(b.bottom) };
  };

  // ⚠️ 진짜 줄 수 = 서로 다른 top 값의 개수. range.getClientRects().length는 **텍스트 노드마다** rect가
  // 나오므로 줄 수가 아니다(JSX가 표현식으로 노드를 쪼개면 한 줄인데 4rect — task#275에서 22건 거짓 FAIL).
  const lineCount = (el) => {
    const r = document.createRange(); r.selectNodeContents(el);
    const tops = [...r.getClientRects()].map((x) => Math.round(x.top));
    return new Set(tops).size || 1;
  };

  // 가로 스크롤러(자체 overflow-x:auto) 안의 요소는 **설계상** 루트를 넘는다 — 표를 축소하지 않고
  // 설계폭(minWidth)을 지킨 채 스크롤러에 담는 관용구(가토 ⑫)라, bbox 축의 정의역에서 제외한다.
  // 페이지 본문의 가로 스크롤 여부는 별도 축(body-no-hscroll)이 잰다.
  const inXScroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = cs(p).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
    return false;
  };

  const LEAF_SEL = 'span, div, p, a, td, th, summary, li, button, h1, h2, h3';
  const leaves = [...root.querySelectorAll(LEAF_SEL)].filter((e) => e.children.length === 0 && txt(e).length > 0);
  const items = leaves.map((el) => {
    const s = cs(el);
    const b = el.getBoundingClientRect();
    return {
      t: txt(el).slice(0, 48),
      lines: lineCount(el),
      scrollW: el.scrollWidth, clientW: el.clientWidth,
      right: Math.round(b.right),
      isEllipsis: s.textOverflow === 'ellipsis' && s.overflow !== 'visible',
      // 시각적 숨김(.sr-only)은 `width:1px; overflow:hidden; clip:rect(0,0,0,0)`이 **메커니즘 자체**라
      // scrollWidth > clientWidth가 설계대로 늘 참이다. 잘림이 아니라 의도된 숨김이므로 이 축의
      // 정의역 밖이다(축의 정의역이지 무음 스킵이 아니다 — 가토 ⑧ⓛ). 접근성 텍스트를 잘림으로
      // 신고하면 a11y 개선이 프로브를 깨뜨리는 역인센티브가 된다.
      srOnly: el.classList.contains('sr-only') || (parseFloat(s.width) <= 1 && s.overflow === 'hidden'),
      isNowrap: s.whiteSpace === 'nowrap',
      inScroller: inXScroller(el),
    };
  });

  // 잘림 축 ⓑ — 잘라내는 주체가 **부모**인 경우. 자식이 nowrap이면 자식의 scrollWidth==clientWidth라
  // leaf 축이 전부 통과한다(task#275 실측) → overflow:hidden 컨테이너를 별도 계열로 잰다.
  const clippers = [...root.querySelectorAll('*')]
    .filter((e) => cs(e).overflow === 'hidden' && txt(e).length > 0)
    .map((e) => ({ t: txt(e).slice(0, 40), scrollW: e.scrollWidth, clientW: e.clientWidth,
                   isEllipsis: cs(e).textOverflow === 'ellipsis',
                   srOnly: e.classList.contains('sr-only') || (parseFloat(cs(e).width) <= 1 && cs(e).overflow === 'hidden') }));

  // ── 업체 표 행 — 화면에 실제로 렌더된 순서/값을 읽는다(API 순서가 아니라) ──
  // task#296 — 국가·티커가 열에서 빠져 이름 셀 내부로 이동했고 열 수도 데이터에 따라 3~4개로 변한다.
  // 고정 인덱스(cells[2]=level·[3]=gap·[4]=share·[5]=ticker·[1]=country)는 렌더된 `<th>` 라벨로
  // 찾는다 — 이 파일은 country/ticker 값을 애초에 단언하지 않으므로(그 필드는 죽은 코드였다) 제거한다.
  const headLabels = [...playersEl.querySelectorAll('thead th')].map((th) => txt(th));
  const levelIdx = headLabels.indexOf('기술수준');
  const gapIdx = headLabels.indexOf('선두 대비');
  const shareIdx = headLabels.indexOf('점유율');
  const rows = [...playersEl.querySelectorAll('[data-testid="tech-report-player-row"]')].map((tr) => {
    const cells = [...tr.children].map((td) => txt(td));
    const nameEl = tr.querySelector('[data-testid="tech-report-player-name"]');
    const lvM = (cells[levelIdx] || '').match(/^(\d+)단계/);
    // 「선두 대비」 셀은 격차만 담는다(`5년`). leader_name은 표 위 캡션으로 올라갔으므로 옛
    // `선두 대비 N년 · {이름}` 패턴으로 파싱하면 **전 행의 gap이 null**이 되어 정렬 불변식이
    // 거짓 FAIL한다(파서가 화면을 못 읽는 것을 구현 결함으로 오귀속하는 자리다).
    const gapM = gapIdx >= 0 ? (cells[gapIdx] || '').match(/^(\d+)년$/) : null;
    return {
      name: nameEl ? txt(nameEl) : null,
      level: lvM ? Number(lvM[1]) : null,
      // '현재 선두' = gap 0(0은 유효값이다 — falsy로 흘리면 선두를 통째 놓친다), '—' = null
      gap: gapIdx >= 0 && cells[gapIdx] === '현재 선두' ? 0 : (gapM ? Number(gapM[1]) : null),
      share: shareIdx >= 0 ? cells[shareIdx] : null,
      cellCount: cells.length,
      ellCount: [...tr.querySelectorAll('span, div')].filter((e) => e.children.length === 0 && cs(e).textOverflow === 'ellipsis' && cs(e).overflow !== 'visible').length,
    };
  });

  // ── KPI 스트립 ──
  const kpiEl = root.querySelector('[data-testid="tech-report-kpis"]');
  const chips = kpiEl ? [...kpiEl.querySelectorAll('.stat')].map((c) => {
    const b = c.getBoundingClientRect();
    return {
      label: txt(c.querySelector('.stat__label') || c).slice(0, 20),
      value: txt(c.querySelector('.stat__value') || c).slice(0, 30),
      top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right),
      // 바닥은 vh가 아니라 visibleBottom — 탭바에 가려진 칩을 "가시"로 통과시키면 이 축이
      // 깨진 구현을 승인한다(적대 리뷰 F5: 판정축이 느슨했다).
      fullyVisible: b.top >= -1 && b.bottom <= visibleBottom + 1 && b.left >= -1 && b.right <= vw + 1,
    };
  }) : [];

  // ── 산문(상세 설명) — task#296: <details>/<summary> 완전 제거, 소제목은 <h3> + 상시 노출 ──
  // detailsEls/summaryEls는 이제 "메커니즘이 정말 사라졌는가"(0개여야 정상)를 재는 회귀 축이고,
  // 소제목 수·본문 텍스트는 h3/새 구조로 잰다.
  const proseEl = root.querySelector('[data-testid="tech-report-prose"]');
  const detailsEls = proseEl ? [...proseEl.querySelectorAll('details')] : [];
  const summaryEls = proseEl ? [...proseEl.querySelectorAll('summary')] : [];
  const h3Els = proseEl ? [...proseEl.querySelectorAll('h3')] : [];
  const proseSectionEls = proseEl ? [...proseEl.querySelectorAll('[data-testid="tech-prose-section"]')] : [];
  // 산문 소제목은 `data-tech-anchor`다(목차 항목이 아니다 — `data-tech-section`은 전역 목차가
  // 가리키는 상위 섹션 전용, TechReport.css 주석 참조).
  const proseAnchors = proseSectionEls.map((el) => ({ id: el.id, dataAttr: el.getAttribute('data-tech-anchor') }));
  // 본문 = 소제목 섹션 안의 <p>(task#296: 더 이상 <details> 안이 아니다) + 소제목 없는 선행 문단.
  const bodyEls = proseEl ? [
    ...proseEl.querySelectorAll('[data-testid="tech-prose-section"] p'),
    ...proseEl.querySelectorAll('[data-testid="tech-prose-plain"]'),
  ] : [];
  // ⚠️ 닫힌 <details> 자손은 getBoundingClientRect()가 0이 아닌 값을 반환하는 페인트 억제 함정이
  // 있다(uat296 헤더 주석·실측 — content-visibility류 메커니즘) → closest('details')로 먼저 걸러낸다.
  const isDisclosureHidden = (el) => { const d = el.closest('details'); return !!(d && !d.open); };
  const firstScreen = bodyEls.map((el) => {
    const b = el.getBoundingClientRect();
    // top은 진단용 실측값이라 disclosure-hidden이어도 실제 기하를 남긴다(Math.min 집계가 null로
    // 오염되지 않게) — 가시성 판정만 강제로 false로 덮는다.
    const visible = !isDisclosureHidden(el) && b.height > 0 && b.width > 0 && b.bottom > 0 && b.top < vh;
    return { chars: txt(el).length, visible, top: Math.round(b.top) };
  });

  // ── 섹션 배치 순서(문서 순서 인덱스) ──
  const all = [...root.querySelectorAll('*')];
  const idxOf = (sel) => { const el = root.querySelector(sel); return el ? all.indexOf(el) : -1; };
  const order = {
    lead: idxOf('[data-testid="tech-report-lead"]'),
    kpis: idxOf('[data-testid="tech-report-kpis"]'),
    players: idxOf('[data-testid="tech-report-players"]'),
    prose: idxOf('[data-testid="tech-report-prose"]'),
    sources: idxOf('[data-testid="tech-report-sources"]'),
  };

  // ── SVG 텍스트 화면 실측(가토 ⑫ — 좌표계 기하가 아니라 화면 픽셀) ──
  const svgTexts = [...root.querySelectorAll('svg text')].filter((t) => txt(t).length > 0).map((t) => {
    const b = t.getBoundingClientRect();
    const m = t.getScreenCTM();
    return {
      t: txt(t).slice(0, 16),
      h: Math.round(b.height * 10) / 10,
      // viewBox 스케일 — width:100% + 고정 viewBox면 화면 폭에 비례해 글자까지 줄어든다.
      scale: m ? Math.round(Math.hypot(m.a, m.b) * 1000) / 1000 : null,
      fs: cs(t).fontSize,
    };
  });

  // ── 기술수준 밴드 행 이름 — 표와 **같은 순서**여야 한다(F1). 밴드는 자체 정렬을 하지 않으므로
  //    받은 배열 순서가 그대로 화면 순서다.
  const bandEl = root.querySelector('[data-testid="tech-level-band"]');
  const bandNames = bandEl
    ? [...bandEl.querySelectorAll('[data-testid="tech-level-band-row"]')]
        .map((r) => { const n = r.querySelector('.tech-level-band__name'); return n ? txt(n) : null; })
    : [];

  // ── task#296 — 표 스크롤러(overflowX:auto 래퍼)가 완전히 제거됐다. "조상에 그 메커니즘이 남아
  //    있는가"(회귀 감지, 0개여야 한다)와 "표 자신이 넘치는가"를 **전 뷰포트**에서 잰다 — 모바일도
  //    이제 열 생략(playerColumns)·줄바꿈 허용으로 폭에 맞추므로 스크롤이 필요 없어야 한다(옛날엔
  //    모바일만 "스크롤러가 있고 넘치는 것"이 정상이었지만 그 정의역 자체가 없어졌다).
  const scrollAncestors = [];
  for (let p = playersEl.parentElement; p && p !== document.body; p = p.parentElement) {
    const ox = cs(p).overflowX;
    if (ox === 'auto' || ox === 'scroll') scrollAncestors.push({ tag: p.tagName.toLowerCase(), testid: p.getAttribute('data-testid') || null });
  }
  const tableScrollW = playersEl.scrollWidth, tableClientW = playersEl.clientWidth;

  // ── note — task#296: 접기 제거, role="group"으로 상시 렌더. 클릭 없이 바로 잰다. 업체 식별은
  //    DOM 인접관계(바로 앞 행)로 한다 — sortPlayers가 렌더 순서를 API 순서와 다르게 만들므로 index
  //    매칭은 오탐을 낸다(uat296에서 실측으로 확정 — 이 파일도 옛 noteBtns 카운트만 쓰고 식별은
  //    안 했어서 노출은 안 됐지만, 새로 이름 대조를 넣으므로 같은 함정을 피해야 한다).
  //    ⚠️ 닫힌 <details> 자손은 getBoundingClientRect()가 0이 아닌 값을 반환하는 페인트 억제
  //    함정이 있다(uat296 헤더 주석·실측) → closest('details')로 먼저 걸러낸 뒤에만 rect를 믿는다.
  const noteRows = [...playersEl.querySelectorAll('[data-testid="tech-report-player-note"]')];
  const notes = noteRows.map((tr) => {
    const prevRow = tr.previousElementSibling;
    const prevNameEl = prevRow ? prevRow.querySelector('[data-testid="tech-report-player-name"]') : null;
    const group = tr.querySelector('[role="group"]');
    const bodyEl = group || tr.querySelector('div');
    const disclosureHidden = !!(bodyEl && bodyEl.closest('details') && !bodyEl.closest('details').open);
    const b = bodyEl && !disclosureHidden ? bodyEl.getBoundingClientRect() : null;
    return {
      playerName: prevNameEl ? txt(prevNameEl) : null,
      hasGroup: !!group, groupAriaLabel: group ? group.getAttribute('aria-label') : null,
      hasSummary: !!tr.querySelector('summary'), hasDetails: !!tr.querySelector('details'),
      visible: !!(bodyEl && !disclosureHidden && bodyEl.getClientRects().length > 0),
      bodyText: bodyEl ? bodyEl.textContent : '',
      bodyWidth: b ? Math.round(b.width) : null,
    };
  });

  // ── 「주요 업체」 제목 → 선두 캡션 → 표 사슬(uat276의 관용구를 그대로 재사용) ──────────────
  //    S3의 F3 수정이 leader_name을 표 위 캡션으로 승격해 이 자리가 2단이 됐다. 제목 bottom과 표 top을
  //    **한 번에** 재면 그 사이에 낀 캡션의 렌더 높이까지 "간격"으로 세게 된다(uat276 실측 33px 중
  //    17px이 캡션 자신의 텍스트다 — 빈 공간이 아니다) → 사슬을 캡션을 **통과해 링크별로** 잰다.
  const playersCap = [...root.querySelectorAll('.rpt-title')].find((t) => txt(t).includes('주요 업체'));
  const leaderEl = root.querySelector('[data-testid="tech-report-players-leader"]');
  const gapPx = (aEl, bEl) => Math.round(bEl.getBoundingClientRect().top - aEl.getBoundingClientRect().bottom);
  const titleChain = !playersCap ? null
    : leaderEl
      ? [{ from: 'title', to: 'caption', px: gapPx(playersCap, leaderEl) },
        { from: 'caption', to: 'table', px: gapPx(leaderEl, playersEl) }]
      : [{ from: 'title', to: 'table', px: gapPx(playersCap, playersEl) }];
  const capB = leaderEl ? leaderEl.getBoundingClientRect() : null;
  const caption = leaderEl ? {
    text: txt(leaderEl),
    // 진짜 줄 수 = 서로 다른 top 개수(위 lineCount 주석). 캡션은 `선두 = ` + {join} 으로 텍스트 노드가
    // 2개라 rect 개수를 줄 수로 쓰면 1줄인데 2줄로 읽힌다.
    lines: lineCount(leaderEl),
    scrollW: leaderEl.scrollWidth, clientW: leaderEl.clientWidth,
    left: Math.round(capB.left), right: Math.round(capB.right), h: Math.round(capB.height),
    inScroller: inXScroller(leaderEl),
    ws: cs(leaderEl).whiteSpace,
  } : null;

  const h1 = root.querySelector('h1');
  const leadEl = root.querySelector('[data-testid="tech-report-lead"]');
  const rr = root.getBoundingClientRect();

  return {
    found: true, items, clippers, rows, chips, firstScreen, order, svgTexts,
    bandNames, scrollAncestors, tableScrollW, tableClientW, notes, headCols: headLabels.length,
    titleChain, caption, capTitleFound: !!playersCap,
    tabbarH, visibleBottom, bannerH, bannerFound: !!bannerEl,
    leadBox: box(leadEl), stripBox: box(kpiEl),
    detailsTotal: detailsEls.length, summaryTotal: summaryEls.length, h3Total: h3Els.length,
    proseAnchors,
    // 접힌 <details>의 본문도 DOM에 남는다(네이티브 접기) — 손실 0 대조는 이 문자열로 한다.
    proseAllText: proseEl ? proseEl.textContent : '',
    proseFound: !!proseEl,
    plainCount: proseEl ? proseEl.querySelectorAll('[data-testid="tech-prose-plain"]').length : 0,
    h1Text: h1 ? txt(h1) : null,
    leadText: leadEl ? txt(leadEl) : null,
    hasShareChart: !!root.querySelector('[data-testid="tech-share-chart"]'),
    hasBand: !!root.querySelector('[data-testid="tech-level-band"]'),
    // task#282 S3 — 요약 카드 제거, MarketGrowthChart 캡션이 새 위치다(이 필드는 어느 eq()도 단언
    // 대상으로 쓰지 않는 정보성 캡처라 그대로 두면 항상 null이 되어 로그가 misleading해진다).
    marketSummary: (() => { const e = root.querySelector('[data-testid="market-growth-chart"] [data-testid="market-growth-caption"]'); return e ? txt(e) : null; })(),
    scrollY: Math.round(window.scrollY),
    docScrollW: document.documentElement.scrollWidth,
    docClientW: document.documentElement.clientWidth,
    rootRight: Math.round(rr.right), vw, vh,
  };
}, ROOT_SEL);

// task#296 — note가 클릭 없이 상시 렌더되므로 별도 measureNote(클릭→펼침→재측정) 사이클이
// 필요 없다. 위 measure()의 `notes` 필드가 이미 role="group" 본문을 직접 담는다.

// ── 실행 ──────────────────────────────────────────────────────────────────
// 4조합 = 3폭 × 2테마(가장 좁은 폭에 다크를 물려 최악 조합을 반드시 포함시킨다).
const VIEWS = [
  { key: 'pc1440-light', theme: 'light', opts: { viewport: { width: 1440, height: 1000 } } },
  { key: 'pc1440-dark', theme: 'dark', opts: { viewport: { width: 1440, height: 1000 } } },
  { key: 'm390-light', theme: 'light', opts: { ...devices['iPhone 13'] } },
  { key: 'm350-dark', theme: 'dark', opts: { viewport: { width: 350, height: 700 } } },
];

const browser = await chromium.launch();

for (const V of VIEWS) {
  // SW가 /api/*를 가로채므로 컨텍스트는 항상 serviceWorkers:'block'(이 스크립트는 주입은 안 하지만
  // SW 캐시가 옛 응답을 돌려줄 여지를 없앤다 — "실데이터를 잰다"가 이 스크립트의 존재 이유다).
  const ctx = await browser.newContext({ ...V.opts, serviceWorkers: 'block' });
  // 게이트 컨텍스트 = **정상 상태**(설치 배너를 닫아 둔 상태).
  // 키·값 형식은 추정이 아니라 소스 직독이다 — frontend/src/utils/pwa.js:
  //   SUPPRESS_KEY = 'pwa-install-dismissed-at' · suppressInstall()이 String(Date.now())를 넣고
  //   isInstallSuppressed()가 14일 이내면 배너를 억제한다.
  await ctx.addInitScript(([a, r, th]) => {
    localStorage.setItem('access_token', a);
    localStorage.setItem('refresh_token', r);
    localStorage.setItem('theme', th);
    localStorage.setItem('pwa-install-dismissed-at', String(Date.now()));
  }, [access_token, refresh_token, V.theme]);

  for (const slug of SLUGS) {
    const D = DATA[slug];
    const tag = `${V.key}/${slug}`;
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errs.push(msg.text()); });
    page.on('pageerror', (e) => errs.push(String(e)));

    try {
      await page.goto(`${BASE}/tech-report/${slug}`, { waitUntil: 'networkidle' }).catch((e) => errs.push(`goto:${e}`));
      await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0).catch(() => {});
      await page.waitForTimeout(1200);
      // 대조군(기본 꺼짐) — 앱을 되돌리지 않고 처방만 무효화한다. 켜면 캡션 축이 FAIL해야 정상.
      if (CONTROL) { await page.addStyleTag({ content: CONTROL_CSS[CONTROL] }); await page.waitForTimeout(300); }
      if (KPI_CONTROL) { await page.addStyleTag({ content: KPI_CONTROL_CSS[KPI_CONTROL] }); await page.waitForTimeout(300); }

      let m = await measure(page);
      if (!m.found) { // 1회 재시도 후에도 없으면 FAIL(무음 스킵 금지 — id를 로그에 명시)
        console.log(`  (재시도) ${tag} — 본문/업체표 미검출, 1.8s 대기 후 재측정`);
        await page.waitForTimeout(1800);
        m = await measure(page);
      }
      eq(`section:${tag}`, m.found ? 'PRESENT' : 'SECTION_MISSING', 'PRESENT');
      bump('section');

      if (!m.found) {
        eq(`console:${tag}`, errs, [], '측정 불가 화면(참고용)');
        bump('console');
        await page.screenshot({ path: `${OUT}/${V.key}-${slug}-top.png`, fullPage: false });
        await page.close();
        continue;
      }

      // ── (1) identity — 대상 유효성을 판정축보다 **먼저**. 아래 축들(칩·표·접힘)은 대상과 독립이라
      //        틀린 페이지 위에서도 통과할 수 있다(가토 ⑧ⓘ, 3회 관측).
      eq(`identity-h1:${tag}`, m.h1Text ?? 'H1_MISSING', D.techName, `기술명(TECH_NAMES 미러)`);
      bump('identity');
      eq(`identity-lead:${tag}`, m.leadText ?? 'LEAD_MISSING', D.title,
        `리드 = API title(${D.title.length}자) · 잘림·생략 0이어야 한다`);
      bump('identity');
      // 이빨 단언 — 기술명과 제목이 같으면 위 두 축이 아무것도 구별하지 못하면서 통과한다.
      eq(`identity-differ:${tag}`, new Set([D.techName, D.title]).size, 2, '기술명 ≠ 제목');
      bump('identity');

      // ── (2) 섹션 배치 순서 — 1/2의 목적 자체(산문이 앞이 아니라 뒤에 온다) ──
      const seq = ['lead', 'kpis', 'players', 'prose', 'sources'];
      const missing = seq.filter((k) => m.order[k] < 0);
      eq(`order-domain:${tag}`, missing.length ? `ANCHOR_MISSING(${missing.join(',')})` : 'OK', 'OK',
        `인덱스 ${JSON.stringify(m.order)}`);
      const idxs = seq.map((k) => m.order[k]);
      const monotonic = idxs.every((v, i) => i === 0 || (v > idxs[i - 1] && idxs[i - 1] >= 0));
      eq(`order:${tag}`, monotonic ? 'OK' : `OUT_OF_ORDER(${JSON.stringify(m.order)})`, 'OK',
        `lead→kpis→players→prose→sources`);
      bump('order', seq.length);

      // ── (3) first-screen-prose — 스크롤 0에서 산문 **본문** 문자 0자.
      //        리드 문단은 산문이 아니라 헤더다(계획이 첫 화면에 두기로 확정) → 정의역에서 제외.
      eq(`first-screen-scroll:${tag}`, m.scrollY, 0, '스크롤 0 상태에서만 이 축이 성립한다');
      const proseChars = m.firstScreen.reduce((s, f) => s + f.chars, 0);
      eq(`first-screen-prose-domain:${tag}`,
        m.proseFound && proseChars > 0 ? 'OK' : `PROSE_DOMAIN_EMPTY(found=${m.proseFound},chars=${proseChars})`, 'OK',
        `산문 본문 총 ${proseChars}자(DOM 기준)`);
      const visibleProse = m.firstScreen.filter((f) => f.visible);
      eq(`first-screen-prose:${tag}`, visibleProse.reduce((s, f) => s + f.chars, 0), 0,
        `vh=${m.vh} · 본문블록 ${m.firstScreen.length}개 · 최상단 top=${Math.min(...m.firstScreen.map((f) => f.top))}`);
      bump('first-screen', m.firstScreen.length);

      // ── (4) kpi-visible — 칩이 **탭바에 가려지지 않는** 초기 뷰포트 안에 전부 가시 ──
      //  ⚠️ 유효 바닥은 vh가 아니라 vh − 탭바 높이다(F5). `bottom <= vh`로 재면 하단 fixed 탭바(모바일
      //     실측 61px)에 덮인 칩도 "가시"로 통과해 **깨진 구현을 승인한다**. 탭바 높이는 런타임 실측이며
      //     PC는 display:none이라 0이 나온다(하드코딩 금지 — 미디어쿼리가 바뀌면 따라가야 한다).
      //  ⚠️ 이 축의 기대는 **구현 불변식이 아니다**(F15): 스트립이 첫 화면에 들어가느냐는 그 위에 오는
      //     리드 문단 높이 = **발행자가 정하는 title 길이**에 좌우된다(실측 smr 141자 · rr 181자).
      //     정당한 발행이 이 축을 FAIL시킬 수 있는데, 그때의 "수정"으로 제목을 자르는 것은 S1이 명시적으로
      //     금지했다(잘림은 문자열 끝을 먹어 결론의 뒷부분부터 사라진다 — 가토 ⑦). 옳은 조치는 헤더
      //     여백·스트립 밀도 재조정이다. 그래서 FAIL 메시지에 리드 높이·스트립 높이·가용 높이를 실측치로
      //     실어 **원인이 즉시 드러나게** 한다(그러지 않으면 다음 사람이 금지된 수정으로 간다).
      eq(`tabbar-domain:${tag}`,
        V.key.startsWith('pc')
          ? (m.tabbarH === 0 ? 'PC_HIDDEN' : `PC_TABBAR_VISIBLE(${m.tabbarH})`)
          : (m.tabbarH > 0 ? 'MOBILE_PRESENT' : 'MOBILE_TABBAR_MISSING'),
        V.key.startsWith('pc') ? 'PC_HIDDEN' : 'MOBILE_PRESENT',
        `런타임 실측 tabbarH=${m.tabbarH}px · 유효 바닥=${m.visibleBottom}(vh ${m.vh})`);
      bump('tabbar');
      //  ⚠️ **판정을 2축으로 쪼갰다**(task#280 후속): 이 게이트는 설치 배너를 **닫은 정상 상태**에서만
      //     잰다. 배너(.install-prompt)는 ⓐ 앱 전역이고 ⓑ 첫 방문 한정이며 ⓒ 사용자가 닫으면
      //     localStorage에 14일 영속되는 프로모라 **이 페이지의 레이아웃이 아니다**. 두 상태를 한 축에
      //     섞으면 FAIL이 났을 때 「리포트 레이아웃이 큰 것」과 「전역 배너가 민 것」이 구별되지 않는다
      //     (원인 귀속 불가). 그래서 목표는 정상 상태로 게이트하고, 첫 방문 비용은 숨기지 않고
      //     아래 kpi-visible-firstvisit 계열에서 **수치로 보고**한다(게이트 아님).
      //     단언 자체는 그대로 무조건이고 약화되지 않았다 — 측정 대상이 하나 늘었을 뿐이다.
      //  ⚠️ 지금 재는 상태가 **정말 정상 상태인지**를 별도 축으로 먼저 못박는다(가토 ⑧ⓘ): 억제 키가
      //     어긋나면(개명·형식 변경) 배너가 그대로 떠서 이 게이트는 조용히 *다른 상태*를 재게 된다.
      eq(`kpi-banner-state:${tag}`, m.bannerH === 0 ? 'DISMISSED' : `BANNER_VISIBLE(${m.bannerH}px)`, 'DISMISSED',
        'pwa-install-dismissed-at 주입이 실제로 배너를 억제했는가(억제 실패 시 게이트가 딴 상태를 잰다)');
      bump('kpi-banner');
      eq(`kpi-domain:${tag}`, m.chips.length, 6, 'deriveTechKpis는 항상 6칩(결측은 —)');
      const offscreen = m.chips.filter((c) => !c.fullyVisible);
      const headroom = `리드 ${m.leadBox ? `${m.leadBox.h}px(top=${m.leadBox.top})` : 'LEAD_MISSING'}` +
        ` · 스트립 ${m.stripBox ? `${m.stripBox.h}px(top=${m.stripBox.top},bottom=${m.stripBox.bottom})` : 'STRIP_MISSING'}` +
        ` · 가용 ${m.visibleBottom}px(vh ${m.vh} − 탭바 ${m.tabbarH})`;
      eq(`kpi-visible:${tag}`, offscreen.map((c) => `${c.label}(top=${c.top},bottom=${c.bottom})`), [],
        `${headroom} · 칩 ${m.chips.length}개 · 값=${JSON.stringify(m.chips.map((c) => c.value))}`);
      bump('kpi', m.chips.length);
      // 정상 상태 수치를 보관 — 아래 첫 방문 패스가 같은 줄에 나란히 출력해 두 상태 차이를
      // 눈으로 귀속할 수 있게 한다(둘을 따로 찍으면 독자가 머릿속에서 조인해야 한다).
      kpiState[tag] = {
        vis: m.chips.length - offscreen.length, n: m.chips.length,
        leadH: m.leadBox ? m.leadBox.h : null,
        stripH: m.stripBox ? m.stripBox.h : null,
        stripTop: m.stripBox ? m.stripBox.top : null,
        stripBottom: m.stripBox ? m.stripBox.bottom : null,
        bannerH: m.bannerH, visibleBottom: m.visibleBottom,
      };

      // ── (5) player-table-order — 리터럴 순서를 박지 않는다. 불변식 3개 + 완전성 ──
      eq(`table-rowcount:${tag}`, m.rows.length, D.players.length, '표에서 사라진 업체 0');
      const renderedNames = [...m.rows.map((r) => r.name)].sort();
      eq(`table-names:${tag}`, renderedNames, [...D.names].sort(), '렌더 업체명 집합 = API 업체명 집합');
      // 열 수(playerColumns 미러) — 헤더·행마다 렌더된 셀 수가 전부 같은 열 집합을 따르는가.
      eq(`table-cols:${tag}`, m.headCols, D.cols.length, `playerColumns=${JSON.stringify(D.cols)}`);
      const badColSpan = m.rows.map((r, i) => (r.cellCount === m.headCols ? null : `#${i}:${r.cellCount}`)).filter(Boolean);
      eq(`table-cols-per-row:${tag}`, badColSpan, [], `행 ${m.rows.length}개 · 헤더 열 ${m.headCols}`);
      bump('table-cols', m.rows.length + 1);
      const lv = (r) => (r.level == null ? -Infinity : r.level);
      const viol = [];
      for (let i = 1; i < m.rows.length; i++) {
        const a = m.rows[i - 1], b = m.rows[i];
        if (lv(b) > lv(a)) viol.push(`level↑ ${a.name}(${a.level})→${b.name}(${b.level})`);
        else if (lv(b) === lv(a)) {
          if (a.gap == null && b.gap != null) viol.push(`null선행 ${a.name}(null)→${b.name}(${b.gap})`);
          else if (a.gap != null && b.gap != null && b.gap < a.gap) viol.push(`gap↓ ${a.name}(${a.gap})→${b.name}(${b.gap})`);
        }
      }
      eq(`table-order:${tag}`, viol, [],
        `실측 ${JSON.stringify(m.rows.map((r) => `${r.name}:L${r.level}/G${r.gap}`))}`);
      bump('table-order', Math.max(0, m.rows.length - 1));
      // 이빨 단언 — 전 행의 level·gap이 동일하면 위 불변식은 아무것도 안 보면서 통과한다.
      eq(`table-order-teeth:${tag}`,
        new Set(m.rows.map((r) => `${r.level}/${r.gap}`)).size > 1 ? 'OK' : 'ALL_ROWS_IDENTICAL', 'OK',
        `구별되는 (level,gap) 조합 ${new Set(m.rows.map((r) => `${r.level}/${r.gap}`)).size}종`);

      // ── (5b) band-order — 표와 밴드가 **같은 순서**로 같은 업체를 나열한다(F1 재발 차단).
      //        30px 간격의 두 섹션이 같은 축을 다른 순서로 보이면 화면이 자기모순이다. 위 table-order는
      //        표 하나만 보므로 이 결함에 **원리적으로 블라인드**하다(판정축이 대상과 독립 — 가토 ⑧ⓘ).
      eq(`band-order-domain:${tag}`,
        m.bandNames.length === D.players.length && m.rows.length === D.players.length
          ? 'OK' : `BAND_DOMAIN(band=${m.bandNames.length},table=${m.rows.length},api=${D.players.length})`, 'OK',
        '밴드·표 행 수가 API 업체 수와 같아야 순서 비교가 성립한다');
      eq(`band-order:${tag}`, m.bandNames, m.rows.map((r) => r.name), '밴드 행 이름 == 표 행 이름(순서 포함)');
      bump('band-order', m.bandNames.length);
      // 이 표본에서 정렬이 API 순서를 실제로 바꿨는가 — 안 바꾸면 위 단언은 정렬을 통째로 지워도
      // 통과한다(공허한 초록). 전 표본 합산으로 아래 band-order-teeth가 판별력을 게이트한다.
      if (JSON.stringify(m.rows.map((r) => r.name)) !== JSON.stringify(D.names)) bump('band-order-reordered');

      // ── (5c) table-no-scroller — task#296 뒤집음: 표 스크롤러(overflowX:auto 래퍼)가 완전히
      //     제거됐다. 옛 축은 "PC에서만 스크롤러가 존재하고 안 넘친다"를 요구했지만(모바일은 스크롤러가
      //     흡수하는 게 정상이라 정의역 밖) 이제 그 정의역 자체가 없다 — **전 뷰포트**에서 "스크롤러
      //     조상 0개 + 표 자신이 안 넘친다"로 교체한다(뒤집는 근거는 task#280 S4/F3의 기록이 아니라
      //     task#296 계획 — 모바일도 이제 열 생략(playerColumns)·줄바꿈 허용으로 폭에 맞춘다).
      eq(`table-no-scroller-ancestor:${tag}`, m.scrollAncestors, [],
        `표 조상 중 overflowX auto/scroll 0개 기대 — 실측 ${JSON.stringify(m.scrollAncestors)}`);
      eq(`table-no-scroller-self:${tag}`,
        m.tableScrollW <= m.tableClientW + 1 ? 'OK' : `TABLE_OVERFLOW(${m.tableScrollW}>${m.tableClientW})`, 'OK',
        `표 자신 scrollW=${m.tableScrollW}/clientW=${m.tableClientW}(전 뷰포트 무조건 — 모바일도 이제 스크롤 불필요)`);
      bump('table-no-scroller', 2);

      // ── (5d) 선두 캡션 계열 — S3(F3)이 **새로 만든 UI 요소**를 잰다 ──────────────────────────
      //  형제 프로브 uat276이 같은 사슬을 재지만 픽스처의 고유 선두는 1개라 **다중 선두 캡션을 원리적으로
      //  못 본다**. 실발행 reusable-rocket은 고유 2개라 캡션이 길어진다 — 그 판이 여기서만 측정된다.
      //  ⚠️ 정의역: 전 업체의 gap_years가 0/null이면 표시할 선두가 없어 PlayerTable이 캡션을 아예
      //     렌더하지 않는다(leaders 빈 배열 → `{leaders.length > 0 && …}`). 이 정의역은 뷰포트처럼
      //     **실행 전에** API 응답으로 결정된다 — 측정이 사라지는 무음 스킵이 아니다. 정의역 **안에서는**
      //     대상 부재를 sentinel FAIL로 만들어 총계를 구조적으로 고정한다. 지금 두 발행물은 각각
      //     고유 선두 1명·2명이라 **둘 다 정의역 안**이며, 그 사실은 아래 caption-teeth가 게이트한다.
      if (D.leaders.length > 0) {
        eq(`caption-domain:${tag}`, m.caption ? 'PRESENT' : 'CAPTION_MISSING', 'PRESENT',
          `API 고유 선두 ${D.leaders.length}명 → 캡션이 반드시 있어야 한다`);
        // 파싱 전제 — 이름 자체에 구분자가 들어 있으면 아래 split 파싱이 모호해진다(축의 정직한 한계).
        eq(`caption-parse-safe:${tag}`, D.leaders.filter((n) => n.includes(' · ')), [],
          '구분자 " · "가 이름 안에 없어야 split identity 파싱이 성립한다');

        // identity(가토 ⑧ⓘ) — 아래 간격·잘림 축은 **빈·오조립 캡션 위에서도 전부 통과**한다(판정축이
        // 대상과 독립). 캡션이 실제로 그 대상인지를 접두어 + 이름 집합으로 먼저 못박는다.
        const capText = m.caption ? m.caption.text : null;
        eq(`caption-prefix:${tag}`,
          capText == null ? 'CAPTION_MISSING'
            : (capText.startsWith('선두 = ') ? 'OK' : `BAD_PREFIX(${JSON.stringify(capText.slice(0, 14))})`), 'OK');
        const capNames = capText == null ? null
          : capText.replace(/^선두 = /, '').split(' · ').map((s) => s.trim()).filter(Boolean);
        eq(`caption-identity:${tag}`, capNames ? [...capNames].sort() : 'CAPTION_MISSING', [...D.leaders].sort(),
          `실측 캡션=${JSON.stringify(capText)} · 기대는 gap_years>0 행의 고유 leader_name 집합(실응답에서 계산)`);
        bump('caption');
        bump('caption-names', capNames ? capNames.length : 0);

        // 사슬 — 링크별로 잰다. 임계 0~24px은 uat276과 동일(완화 0).
        const chain = m.titleChain || [];
        eq(`caption-gap-domain:${tag}`, m.capTitleFound ? chain.length : 'PLAYERS_TITLE_MISSING', 2,
          `사슬 ${JSON.stringify(chain)} · 캡션이 있으면 링크는 반드시 2개(제목→캡션→표)`);
        const farLinks = chain.filter((l) => !(l.px >= 0 && l.px <= 24)).map((l) => `${l.from}→${l.to}:${l.px}px`);
        eq(`caption-gap:${tag}`, farLinks, [],
          `실측 ${chain.map((l) => `${l.from}→${l.to} ${l.px}px`).join(' · ') || '사슬 없음'} · 임계 0~24px`);
        bump('caption-gap', chain.length);

        // 줄 수는 **FAIL 조건이 아니다** — 캡션은 표 스크롤러 *밖*이라 좁은 폭에서 접히는 것이 정상이고
        // 다중 선두면 더 길어진다. 실측치는 출력만 하고, 단언은 ⓐ 잘리지 않는가 ⓑ 본문을 가로로 밀지
        // 않는가 두 가지에만 건다(줄 수를 단언하면 정당한 접힘에 거짓 FAIL한다).
        const capLines = m.caption ? m.caption.lines : null;
        bump('caption-lines', capLines || 0);
        eq(`caption-clip:${tag}`,
          m.caption && m.caption.scrollW <= m.caption.clientW + 1
            ? 'OK' : `CAPTION_CLIPPED(${m.caption && m.caption.scrollW}>${m.caption && m.caption.clientW})`, 'OK',
          `줄 수 ${capLines} · h=${m.caption && m.caption.h}px · white-space=${m.caption && m.caption.ws}` +
          ` · scrollW=${m.caption && m.caption.scrollW} clientW=${m.caption && m.caption.clientW}`);
        eq(`caption-bbox:${tag}`,
          m.caption && !m.caption.inScroller && m.caption.right <= m.rootRight + 1
            ? 'OK'
            : `CAPTION_OVERFLOW(right=${m.caption && m.caption.right}>root=${m.rootRight},inScroller=${m.caption && m.caption.inScroller})`,
          'OK', `캡션은 표 스크롤러 밖이라(설계) 본문 폭을 넘으면 페이지 전체가 가로로 밀린다`);

        // 이 표본이 다중/단일 중 무엇을 실제로 덮었는지 — 전역 caption-teeth의 입력.
        bump(D.leaders.length >= 2 ? 'caption-multi' : 'caption-single');
        capLog.push(`${tag.padEnd(30)} 선두 ${D.leaders.length}명 · ${capLines}줄 · h=${m.caption && m.caption.h}px` +
          ` · 사슬 ${chain.map((l) => `${l.from}→${l.to} ${l.px}px`).join(' · ')}` +
          ` · scrollW/clientW=${m.caption && m.caption.scrollW}/${m.caption && m.caption.clientW}` +
          ` · right=${m.caption && m.caption.right}(root ${m.rootRight}) · ${JSON.stringify(capText)}`);
      } else {
        NOTE(`${tag} — caption 계열 정의역 밖(gap_years>0 & leader_name 있는 업체 0곳 → 표시할 선두 없음). ` +
          `축 자체가 없는 판이며 무음 스킵이 아니다.`);
      }

      // ── (6) 산문 — task#296 뒤집음(#264 절차: task#280 S4의 "전부 접힘" 기록이 아니라 task#296
      //    plan.md의 사용자 결정 — 스크롤+전역 목차가 항해를 대신하므로 접기 자체를 없앤다).
      //    이 분기는 **축의 정의역**이지 무음 스킵이 아니다: 소제목 항목이 0개면 h3가 0개다.
      //    정의역은 실행 *전에* API 응답으로 결정되며(뷰포트처럼), 그 사실은 아래 NOTE로 항상 출력한다.
      if (D.titledItems >= 1) {
        eq(`prose-details:${tag}`, m.detailsTotal, 0, '<details> 메커니즘 완전 제거');
        eq(`prose-summaries:${tag}`, m.summaryTotal, 0, '<summary> 0개');
        eq(`prose-h3-count:${tag}`, m.h3Total, D.titledItems, '소제목 섹션 + 난이도 근거를 <h3>로 렌더(응답에서 계산)');
        bump('prose-mech', 3);
        // 산문 앵커 계약 — id·data-tech-section 동일값·유일성(ProseSections.test.jsx⑤의 라이브 짝).
        eq(`prose-anchor-domain:${tag}`, m.proseAnchors.length, D.titledItems, 'h3 섹션 수 == 소제목 항목 수');
        const badAnchors = m.proseAnchors.map((a, i) => (a.id && a.id === a.dataAttr) ? null : `#${i}:id=${a.id},data=${a.dataAttr}`).filter(Boolean);
        eq(`prose-anchor:${tag}`, badAnchors, [], `${m.proseAnchors.length}개 대조`);
        bump('prose-anchor', m.proseAnchors.length);
        bump('prose', m.h3Total);
        // 손실 0이 S4/S2의 절대 조건이다 — "접었다"와 "지웠다"를 개수만으로는 구별할 수 없다.
        // 응답 산문의 모든 비-헤딩 줄 + 난이도 근거가 산문 블록 textContent 안에 그대로 있어야 한다.
        eq(`prose-lossless:${tag}`, D.proseLines.filter((l) => !m.proseAllText.includes(l)).map((l) => l.slice(0, 24) + '…'), [],
          `본문 ${D.proseLines.length}줄 대조 · 산문 DOM ${m.proseAllText.length}자`);
        eq(`prose-lossless-rationale:${tag}`,
          m.proseAllText.includes(D.rationale) ? 'OK' : 'RATIONALE_LOST', 'OK', `근거 ${D.rationale.length}자`);
        bump('prose-lossless', D.proseLines.length + 1);
      } else {
        NOTE(`${tag} — prose-* 세부 축 정의역 밖(소제목 항목 ${D.titledItems}개). 축 자체가 없는 판이며 무음 스킵이 아니다.`);
      }

      // ── (7) 점유율 섹션 게이트 — slug마다 다른 실데이터로 양쪽 분기를 덮는다
      //        (smr: share_pct 전무 → 섹션 없음 / reusable-rocket: 50.9 → 섹션 있음) ──
      eq(`share-gate:${tag}`, m.hasShareChart, D.hasShare,
        `share_pct 유한·음수아님 업체 ${D.rep.players.filter((p) => Number.isFinite(p.share_pct) && p.share_pct >= 0).length}곳`);
      bump('share-gate');

      // ── (8) 잘림 축 ⓐ leaf(설계상 ellipsis 지정 요소는 정의역 밖 — 거긴 잘리는 게 정상) ──
      const clipDomain = m.items.filter((i) => !i.isEllipsis && !i.srOnly);
      const clipped = clipDomain.filter((i) => i.scrollW > i.clientW + 1);
      eq(`clip:${tag}`, clipped.map((c) => `${c.t}(${c.scrollW}>${c.clientW})`), [], `검사 ${clipDomain.length}건`);
      bump('clip', clipDomain.length);
      // task#296 — 국가·티커가 열에서 빠져 이름 셀 내부 메타줄(리프이긴 하다)로 이동했다. 하한을
      // 리터럴 4가 아니라 실제 렌더 규칙(playerColumns + 국가 유무)에서 유도한다: level은 항상 렌더,
      // gap·share는 그 열이 있을 때만(전 행 렌더, DASH 포함), 국가는 값이 있는 행만.
      const clipMin = D.players.length // 기술수준 셀(항상)
        + (D.cols.includes('gap') ? D.players.length : 0)
        + (D.cols.includes('share') ? D.players.length : 0)
        + D.players.filter((p) => p.country).length; // 이름 셀 내부 국가 메타(리프)
      eq(`clip-domain:${tag}`, clipDomain.length >= clipMin ? 'OK' : `CLIP_DOMAIN_TOO_SMALL(${clipDomain.length}<${clipMin})`, 'OK',
        `실측 ${clipDomain.length}건 · 하한 ${clipMin}`);

      // ── (9) 잘림 축 ⓑ overflow:hidden 컨테이너(ellipsis 없이 그냥 자르는 부모) ──
      eq(`clip-raw-applied:${tag}`, m.clippers.length > 0 ? 'OK' : 'NO_OVERFLOW_HIDDEN_AT_ALL', 'OK',
        'ellipsis 메커니즘이 실제로 걸렸는지(0이면 스타일 자체가 안 먹은 것)');
      bump('clip-raw', m.clippers.length);
      const hard = m.clippers.filter((c) => !c.isEllipsis && !c.srOnly);
      const cut = hard.filter((c) => c.scrollW > c.clientW + 1);
      eq(`clip-container:${tag}`, cut.map((c) => `${c.t}(${c.scrollW}>${c.clientW})`), [],
        `hard-clip 컨테이너 ${hard.length}건 / overflow:hidden 총 ${m.clippers.length}건`);
      bump('clip-container', hard.length);

      // ── (10) 줄 수 축 — 정의역은 nowrap 선언 leaf(이 표면의 "1줄 강제" 신호). 산문·note는 여러 줄이
      //         정상이라 정의역 밖. 진짜 줄 수는 서로 다른 top 개수로 센다(위 lineCount 주석).
      const nowrapDomain = m.items.filter((i) => i.isNowrap);
      const folded = nowrapDomain.filter((i) => i.lines !== 1);
      eq(`line-visible:${tag}`, folded.map((f) => `${f.t}(${f.lines}줄)`), [], `검사 ${nowrapDomain.length}건`);
      bump('line-visible', nowrapDomain.length);
      // 하한(정확일치 아님) — 표 열이 늘거나 배지가 붙으면 정당하게 증가한다. 줄면 측정 실패다.
      // task#296 — 기술수준 셀은 이제 whiteSpace:normal(TD_LEVEL, 줄바꿈 허용)이라 nowrap 도메인에서
      // **빠진다**. 대신 국가 메타 span이 nowrap으로 새로 들어온다(META_TEXT). 배지·티커 구분자는
      // 하한에서 뺀다(비동기 holdings 로드·데이터 유무에 따라 변동 — 실제 값은 항상 이 하한 이상이다).
      const nowrapMin = D.cols.length // 헤더 <th> 전부 nowrap
        + (D.cols.includes('gap') ? D.players.length : 0)
        + (D.cols.includes('share') ? D.players.length : 0)
        + D.players.filter((p) => p.country).length; // 이름 셀 내부 국가 메타(nowrap)
      eq(`line-visible-domain:${tag}`,
        nowrapDomain.length >= nowrapMin ? 'OK' : `DOMAIN_SHRANK(${nowrapDomain.length}<${nowrapMin})`, 'OK',
        `실측 ${nowrapDomain.length}건 · 하한 ${nowrapMin}`);

      // ── (11) bbox — 루트 밖으로 삐져나온 leaf. 가로 스크롤러 안은 설계상 넘치므로 정의역 밖 ──
      const bboxDomain = m.items.filter((i) => !i.inScroller);
      const over = bboxDomain.filter((i) => i.right > m.rootRight + 1);
      eq(`bbox:${tag}`, over.map((o) => `${o.t}(${o.right}>${m.rootRight})`), [],
        `검사 ${bboxDomain.length}건 · 스크롤러 내부 제외 ${m.items.length - bboxDomain.length}건 · root=${m.rootRight}`);
      bump('bbox', bboxDomain.length);
      bump('bbox-scroller-excluded', m.items.length - bboxDomain.length);

      // ── (12) body-no-hscroll — 표를 스크롤러에 담았으므로 **페이지 본문**은 가로 스크롤 0이어야 한다 ──
      eq(`body-no-hscroll:${tag}`, m.docScrollW <= m.docClientW + 1 ? 'OK' : `HSCROLL(${m.docScrollW}>${m.docClientW})`, 'OK',
        `scrollW=${m.docScrollW} clientW=${m.docClientW}`);
      bump('body-no-hscroll');

      // ── (13) graph-text-legible — 좌표계 기하가 아니라 **화면 픽셀**(가토 ⑫) ──
      eq(`graph-domain:${tag}`, m.svgTexts.length >= D.years ? 'OK' : `SVG_TEXT_TOO_FEW(${m.svgTexts.length}<${D.years})`, 'OK',
        `svg text ${m.svgTexts.length}건 · 연도 ${D.years}개(x축 틱 하한)`);
      const tiny = m.svgTexts.filter((t) => t.h < 10);
      eq(`graph-text-legible:${tag}`, tiny.map((t) => `${t.t}(h=${t.h},fs=${t.fs})`), [],
        `검사 ${m.svgTexts.length}건 · h 최소 ${Math.min(...m.svgTexts.map((t) => t.h))}px`);
      bump('graph-text', m.svgTexts.length);
      // 축소 자체를 잰다 — width:100%+고정 viewBox면 좁은 폭에서 scale이 떨어지고 글자가 같이 줄어든다.
      const shrunk = m.svgTexts.filter((t) => t.scale != null && t.scale < 0.9);
      eq(`graph-scale:${tag}`, shrunk.map((t) => `${t.t}(scale=${t.scale})`), [],
        `scale 최소 ${Math.min(...m.svgTexts.map((t) => t.scale ?? 1))}`);

      // ── (14) ellipsis 규율 — 표 행에는 잘리는 요소가 **하나도 없어야** 한다.
      //  ⚠️ 기대값이 1→0으로 뒤집혔다: 옛 규율("줄어도 되는 이름만 ellipsis 상자에")은 이름이 잘려도
      //     복구 수단이 `title` 속성뿐이라 터치 기기에서 전체 이름을 볼 방법이 없었다(적대 리뷰 F14).
      //     이제 이름은 잘리지 않고 **접히고**(overflowWrap) 수치·배지는 nowrap+shrink0으로 고정한다.
      //     기대값을 1로 둔 채로 두면 그 옳은 구현이 거짓 FAIL한다. 이름이 실제로 온전한지는 clip 축이
      //     지킨다 — ellipsis가 빠지면서 이름 요소가 clip 축의 정의역 안으로 들어왔다(축이 서로 인계).
      const badEll = m.rows.map((r, i) => (r.ellCount === 0 ? null : `${r.name ?? i}:${r.ellCount}`)).filter(Boolean);
      eq(`ellipsis-discipline:${tag}`, badEll, [], `행 ${m.rows.length}개 · 잘리는 요소 0 기대`);
      bump('ellipsis-discipline', m.rows.length);

      // ── (14b) note — task#296 뒤집음: 접기 완전 제거, 클릭 없이 role="group"으로 상시 렌더.
      //        옛 축은 "클릭 1회 → 펼침 1개"(펼치는 동작 자체가 축의 일부)였다 — 이제 그 동작이
      //        없다는 것 자체가 주장이므로 **부재**를 무조건 단언하고, 본문은 클릭 없이 바로 잰다.
      //  ⚠️ 정의역: note가 있는 업체가 0곳인 판(축 자체가 없다). API 응답으로 **실행 전에** 결정되며
      //     무음 스킵이 아니다.
      eq(`note-domain:${tag}`, m.notes.length, D.notedPlayers.length, 'note 행 수 = note 있는 업체 수(응답에서 계산)');
      bump('note');
      if (D.notedPlayers.length > 0) {
        const noDetails = m.notes.map((n, i) => n.hasDetails ? `#${i}` : null).filter(Boolean);
        eq(`note-no-details:${tag}`, noDetails, [], `${m.notes.length}건 — <details> 완전 제거`);
        const noSummary = m.notes.map((n, i) => n.hasSummary ? `#${i}` : null).filter(Boolean);
        eq(`note-no-summary:${tag}`, noSummary, [], '<summary> 토글 완전 제거');
        const notVisible = m.notes.map((n, i) => n.visible ? null : `#${i}`).filter(Boolean);
        eq(`note-visible-without-click:${tag}`, notVisible, [], `${m.notes.length}건 — 클릭 0회로 전부 가시`);
        bump('note-mech', m.notes.length * 3);

        // 업체 식별은 이름으로(렌더 순서가 sortPlayers로 API 순서와 다르므로 index 매칭은 오탐을 낸다).
        const noteByName = new Map(m.notes.map((n) => [n.playerName, n]));
        eq(`note-name-domain:${tag}`, D.notedPlayers.filter((p) => !noteByName.has(p.name)).map((p) => p.name), [],
          'note-name 매칭 실패 0건');
        const badAccessName = D.notedPlayers.map((p) => {
          const n = noteByName.get(p.name);
          if (!n || !n.hasGroup) return `${p.name.slice(0, 12)}:GROUP_MISSING`;
          return n.groupAriaLabel && n.groupAriaLabel.includes(p.name) ? null : `${p.name.slice(0, 12)}:label=${n.groupAriaLabel}`;
        }).filter(Boolean);
        eq(`note-access-name:${tag}`, badAccessName, [], `${D.notedPlayers.length}건 대조 · role="group" aria-label에 업체명 포함`);
        bump('note-access', D.notedPlayers.length);

        // 손실 0 — 원문 note 텍스트가 렌더에 그대로 있는가.
        const noteLoss = D.notedPlayers.map((p) => {
          const n = noteByName.get(p.name);
          return n && n.bodyText.includes(p.note) ? null : `${p.name.slice(0, 12)}:NOTE_LOST`;
        }).filter(Boolean);
        eq(`note-lossless:${tag}`, noteLoss, [], `${D.notedPlayers.length}건 대조`);
        bump('note-lossless', D.notedPlayers.length + 1);

        // note-width(F4 재발 차단, task#296 갱신) — 스크롤러가 없어졌으므로 기준은 **표 자신의
        // clientWidth**다(옛 스크롤러 100cqi 기준은 더 이상 존재하지 않는다).
        const overWidth = m.notes.map((n, i) => (n.bodyWidth != null && n.bodyWidth > m.tableClientW + 1)
          ? `#${i}:${n.bodyWidth}>${m.tableClientW}` : null).filter(Boolean);
        eq(`note-width:${tag}`, overWidth, [], `표 clientW=${m.tableClientW}px · 본문폭 ${JSON.stringify(m.notes.map((n) => n.bodyWidth))}`);
        bump('note-width');
      } else {
        NOTE(`${tag} — note-* 세부 축 정의역 밖(note 있는 업체 0곳). 축의 정의역이며 무음 스킵이 아니다.`);
      }

      // ── (15) 콘솔 에러 ──
      eq(`console:${tag}`, errs, [], '실데이터 화면');
      bump('console');

      // ── 육안 캡처 ── top = 첫 화면 주장(스크롤 0·프레임 그대로) / full = 전체(대상이 프레임 밖일 수 없다)
      await page.screenshot({ path: `${OUT}/${V.key}-${slug}-top.png`, fullPage: false });
      await page.evaluate(() => document.querySelector('[data-testid="tech-report-players"]')?.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${OUT}/${V.key}-${slug}-table.png`, fullPage: false });
      // 캡션 전용 캡처 — `-table.png`는 표를 중앙에 두느라 그 위의 캡션이 프레임 밖으로 나간다.
      // 육안 확인은 대상이 프레임 안에 있어야 성립한다(가토 ⑧ⓐ 짝) → 캡션을 직접 중앙에 놓는다.
      await page.evaluate(() =>
        document.querySelector('[data-testid="tech-report-players-leader"]')?.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${OUT}/${V.key}-${slug}-caption.png`, fullPage: false });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${OUT}/${V.key}-${slug}-full.png`, fullPage: true });
    } catch (e) {
      // 한 화면의 예외가 전체 실행을 죽이지 않게 sentinel로 흡수(끝까지 돈다).
      eq(`exception:${tag}`, `THROWN:${e && e.message}`, 'NO_EXCEPTION');
      bump('exception');
    }
    await page.close();
  }
  await ctx.close();

  // ── kpi-visible-firstvisit — 첫 방문(설치 배너 미닫힘) 상태. **게이트가 아니다** ──────────
  //  위 게이트가 정상 상태를 재므로, 첫 방문의 추가 비용은 여기서 따로 잰다. 여기서는 가시성을
  //  FAIL로 만들지 않는다 — 배너는 앱 전역 프로모지 이 페이지의 레이아웃이 아니고, 그 높이를 리포트의
  //  완료기준으로 게이트하면 이 페이지가 남의 결정에 인질이 된다. 대신 **숨기지 않고 수치로 싣는다**.
  //  배너가 원래 안 뜨는 조합(pwa.js가 iOS/Android UA에서만 렌더 → 평문 viewport는 데스크톱 UA)에서는
  //  두 상태가 같은 값이 나오는 것이 정상이며, `배너 0px(rendered=false)` 출력이 그 사실을 드러낸다.
  const ctxFV = await browser.newContext({ ...V.opts, serviceWorkers: 'block' });
  await ctxFV.addInitScript(([a, r, th]) => {
    localStorage.setItem('access_token', a);
    localStorage.setItem('refresh_token', r);
    localStorage.setItem('theme', th);
    // pwa-install-dismissed-at 를 **일부러 넣지 않는다** — 그게 이 패스의 존재 이유다.
  }, [access_token, refresh_token, V.theme]);
  for (const slug of SLUGS) {
    const tag = `${V.key}/${slug}`;
    const page = await ctxFV.newPage();
    try {
      await page.goto(`${BASE}/tech-report/${slug}`, { waitUntil: 'networkidle' }).catch(() => {});
      await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0).catch(() => {});
      await page.waitForTimeout(1200);
      let fm = await measure(page);
      if (!fm.found) { await page.waitForTimeout(1800); fm = await measure(page); }
      // 측정 무결성 sentinel — 가시성은 판정하지 않지만 **측정이 실제로 이뤄졌는지**는 단언한다.
      // 이게 없으면 이 패스가 조용히 빈 표본을 내고도 "배너 영향 없음"으로 읽힌다(공허한 보고).
      eq(`kpi-firstvisit-domain:${tag}`, fm.found ? fm.chips.length : 'SECTION_MISSING', 6,
        '첫 방문 상태에서도 6칩이 렌더돼야 측정이 성립한다(가시성 판정이 아니다)');
      bump('kpi-firstvisit-domain');
      const g = kpiState[tag];
      const fvVis = fm.found ? fm.chips.filter((c) => c.fullyVisible).length : 0;
      bump('kpi-firstvisit', fm.found ? fm.chips.length : 0);
      if (fm.found && fm.bannerH > 0) bump('kpi-firstvisit-banner-rendered');
      fvLog.push(
        `${tag.padEnd(30)} 배너 ${String(fm.bannerH).padStart(3)}px(rendered=${fm.bannerFound})` +
        ` · 가시칩 정상 ${g ? `${g.vis}/${g.n}` : 'n/a'} → 첫방문 ${fvVis}/${fm.found ? fm.chips.length : 0}` +
        ` · 스트립 top ${g ? g.stripTop : 'n/a'}→${fm.found && fm.stripBox ? fm.stripBox.top : 'n/a'}` +
        ` bottom ${g ? g.stripBottom : 'n/a'}→${fm.found && fm.stripBox ? fm.stripBox.bottom : 'n/a'}` +
        ` · 리드h ${g ? g.leadH : 'n/a'}/${fm.found && fm.leadBox ? fm.leadBox.h : 'n/a'}` +
        ` · 가용 ${fm.found ? fm.visibleBottom : 'n/a'}px(vh ${fm.found ? fm.vh : '?'} − 탭바 ${fm.found ? fm.tabbarH : '?'})`);
    } catch (e) {
      eq(`exception-firstvisit:${tag}`, `THROWN:${e && e.message}`, 'NO_EXCEPTION');
      bump('exception');
    }
    await page.close();
  }
  await ctxFV.close();
}

await browser.close();

// ── 전역 이빨 단언 — band-order가 판별력을 갖는가 ─────────────────────────
// 정렬이 API 순서를 한 번도 바꾸지 않았다면 `밴드==표`는 정렬 배선을 통째로 지워도 통과한다
// (둘 다 API 순서가 되므로). 최소 1표본에서 재정렬이 실제로 일어나야 이 축이 F1을 잡는다.
eq('band-order-teeth', (cov['band-order-reordered'] || 0) > 0 ? 'OK' : 'ORDER_NEVER_DIFFERS_FROM_API', 'OK',
  `재정렬이 관측된 표본 ${cov['band-order-reordered'] || 0}건 / 전체 ${cov['band-order'] ? VIEWS.length * SLUGS.length : 0}조합`);

// ── 전역 이빨 단언 — 캡션 계열이 실제로 **다중 선두**를 봤는가 ─────────────
// 이 계열의 존재 이유가 "픽스처(고유 선두 1개)가 원리적으로 못 보는 판을 덮는 것"이므로, 다중 선두
// 표본이 한 번도 측정되지 않았다면 이 계열은 uat276과 같은 것만 재면서 초록을 내는 셈이다(공허한 통과).
// 단일 선두 표본도 함께 요구한다 — 두 조립 분기(이름 1개 / ' · '로 이은 N개)가 모두 실측돼야 한다.
const capMulti = cov['caption-multi'] || 0, capSingle = cov['caption-single'] || 0;
eq('caption-teeth', capMulti > 0 && capSingle > 0 ? 'OK' : `CAPTION_VARIETY_MISSING(multi=${capMulti},single=${capSingle})`, 'OK',
  `다중 선두(고유 2+) 표본 ${capMulti}건 · 단일 선두 표본 ${capSingle}건 · ` +
  SLUGS.map((s) => `${s}=${DATA[s].leaders.length}명`).join(' / '));

// ── 보고 ──────────────────────────────────────────────────────────────────
const fails = results.filter((r) => !r.ok);
console.log('\n' + '═'.repeat(72));
console.log('커버리지 (계열별 검사 수 — 재실행 간 비교용):');
for (const [k, v] of Object.entries(cov).sort()) console.log(`  ${k.padEnd(26)} ${v}`);
console.log(`\n단언 총계: ${results.length}건 · PASS ${results.length - fails.length} · FAIL ${fails.length}`);
console.log(`대상: ${SLUGS.map((s) => `${s}(players ${DATA[s].players.length}·소제목 ${DATA[s].titledItems}·점유율 ${DATA[s].hasShare})`).join(' / ')}`);
console.log(`선두 캡션: ${SLUGS.map((s) => `${s} → 고유 ${DATA[s].leaders.length}명 「선두 = ${DATA[s].leaders.join(' · ')}」`).join(' / ')}`);
console.log('\n선두 캡션 실측(단언 아님 — 조합별 원시 수치):');
for (const l of capLog) console.log(`  ${l}`);
console.log('\nkpi-visible-firstvisit — 첫 방문 프로모 배너 포함, **게이트 아님**(실측 보고 전용):');
console.log('  ※ 게이트(kpi-visible)는 배너를 닫은 정상 상태로 잰다. 배너는 앱 전역·첫 방문 한정·닫으면');
console.log('    14일 영속되는 프로모라 이 페이지의 레이아웃이 아니다(pwa.js·mobile.css:344 직독).');
for (const l of fvLog) console.log(`  ${l}`);
if (CONTROL) console.log(`⚠ 이 실행은 대조군이다(CAPTION_CONTROL=${CONTROL}) — 캡션 축 FAIL이 정상이며 게이트 결과가 아니다.`);
console.log('※ 실데이터 — page.route 주입 0. prod tech_reports 무쓰기(GET만).');
console.log(`※ 육안 캡처 ${OUT}/ — {view}-{slug}-{top|table|caption|full}.png (4조합 × 2 slug × 4장)`);
console.log('═'.repeat(72));
if (fails.length) {
  console.log('\nFAIL 상세:');
  for (const f of fails) console.log(`  ✗ ${f.tag}\n      ${f.msg}`);
  process.exit(1);
}
console.log('\nALL PASS');
for (const r of results) console.log(`  ✓ ${r.tag} — ${r.msg}`);
