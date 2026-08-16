// task#281/#282 라이브 UAT — 주요기술 리포트 상세의 신규 3필드
// (key_points · milestones · players[].category)가 만든 세 섹션을 잰다.
//
// ⚠️ 갱신(task#301 S2, ADR-0039) — 「계보 분류」 자체 섹션(CategoryGroups.jsx)이 삭제됐다. players[].
// category 필드는 살아 있지만 이제 표준 섹션이 아니라 PlayerTable 소제목행·ShareChart 그룹으로
// 흡수됐다(그 두 표면의 그룹핑 정합은 uat301-datacenter-split.mjs가 잰다). 이 파일은 "section-present
// -categories(PRESENT)"였던 자리를 "section-absent-categories(ABSENT)"로 뒤집고, 그 섹션 고유의 그룹
// 내용 검증(cat-domain 등)은 검증 대상 자체가 없어져 제거했다 — 남은 것은 key_points·milestones 두
// 섹션뿐이다(파일 상단 설명의 "세 섹션"은 이제 "두 섹션"이 정확하지만, 아래 히스토리 문단은
// 작성 시점 그대로 보존한다).
//
// 세 모드를 **같은 루프**로 돈다:
//   (a) inject — page.route로 **자립 픽스처**를 주입해 렌더·열수·가독·잘림·접힘·간격·색을 잰다.
//                ★ 실발행 아님. prod tech_reports는 GET조차 이 경로로 가지 않는다(라우트가 가로챈다).
//   (b) real   — 라이브 실데이터. 주입 0. 세 섹션이 **존재**하고 내용이 API 응답과 일치함을 잰다.
//                (S6c 실발행 검증)
//   (c) bare   — 세 필드를 **제거한** 응답을 주입해 graceful(섹션째 조용히 생략)을 잰다.
//
// ⚠️ SW가 /api/*를 가로채므로 컨텍스트는 **serviceWorkers:'block'** 필수(안 하면 page.route가 무음 no-op).
//
// ── 왜 축을 재배치했나 (2026-08-04 갱신) ──────────────────────────────────────
// 이 파일의 이전 판은 정반대를 단언했다 — 실데이터에 3필드가 **없음**을 domain sentinel로 못박고
// 세 섹션의 **부재**를 단언했다. 그리고 그 sentinel이 설계대로 FAIL했다:
//   ✗ section-absent-domain … LIVE_HAS_NEW_FIELDS(kp=true,ms=true,cat=true)
// 사용자 승인 실발행(smr · reusable-rocket)으로 3필드가 실데이터에 들어찼기 때문이다. 축을 지우지 않고
// 의도 기준으로 옮겼다:
//   · graceful(3필드 없는 판에서 섹션이 조용히 생략된다) → 이제 그것을 exercise할 실데이터가 없다.
//     **(c) bare 주입 경로**로 옮겼다(deterministic해서 오히려 낫다 — 라이브 발행 상태에 안 흔들린다).
//   · 실데이터 경로 → 반대를 단언한다. `real-fields-domain`이 "실응답에 3필드가 있음"을 판정축보다
//     먼저 확인하고(=`section-absent-domain`의 정신을 뒤집은 짝), 세 섹션 존재 + 내용 일치를 단언한다.
//   · `graceful-siblings`(기존 섹션이 그대로인가)는 **세 모드 모두**에서 산다.
//
// 그리고 진척 타임라인이 **가로 SVG → 세로 HTML 목록**으로 바뀌었다(MilestoneTimeline.jsx 직독).
// SVG·role="img"·"등간격" 캡션·"+N개" 폴드가 전부 사라졌으므로 SVG 전제 축(timeline-legible의
// <text> 화면높이 실측, timeline-scroller, content-tl-hidden/folds/cols)을 폐기하고 새 구조로 다시 썼다.
// 폐기의 근거가 된 결함은 "설계폭 > 가시폭"(SVG 폭 4,479~7,027px vs PC 748px)이었는데,
// **기존 축 3종(넘침·판독성·본문 가로스크롤)은 그 결함에 전부 통과했다** — 그래서 그 결함을 직접 재는
// `tl-self-overflow`(컴포넌트 자신과 모든 자손의 scrollWidth-clientWidth === 0)를 신설했다.
//
// ── 응답 봉투·필드명은 추정하지 않았다. 실측(2026-08-04) ──────────────────────
//   GET /api/tech-reports/{slug} → { slug, reports:[ { id, slug, published_date, title, description,
//     difficulty:{score,rationale}, players:[{name,country,ticker,tech_level,gap_years,leader_name,
//     share_pct,state_led,note,category}], challenges:[], related:{...}, market:{...}, sources:[],
//     created_at, key_points:[{title,metrics:[{label,value,change_pct}],body}],
//     milestones:[{year,actor,event,status}] } ] }
//   실측 요지 — smr: players 10 · key_points 4 · milestones 17 · category 4종(두산에너빌리티만 null)
//              reusable-rocket: players 9 · key_points 4 · milestones 18 · category 3종
//   ★ 두 판 모두 change_pct는 전부 null이다 → 증감 칩의 정의역이 실데이터에선 0이다.
//     그래서 색 축(color-chip)은 (a) 주입 픽스처가 exercise하고, 실데이터에선 "렌더된 증감 칩 수 ==
//     API에서 change_pct != null인 지표 수"를 무조건 단언한다(0==0도 공허하지 않다 — 응답과 화면의 대조다).
//     전 페이지에서 한 번도 증감 칩이 안 나왔다면 그건 색 축이 아무것도 못 본 것이므로
//     전역 이빨 `color-chip-teeth`가 잡는다.
//
// ── 판정 규율 ────────────────────────────────────────────────────────────────
//  · 조건부 단언(`if (조건) assert`) 금지 — 전부 무조건 단언하고 미검출을 sentinel 기대값으로 FAIL시켜
//    총계를 구조적으로 고정한다. 재실행 간 총계가 줄면 통과가 아니라 측정 실패다.
//    ※ 모드(inject/real/bare)는 **실행 전에 결정되는 축의 정의역**이지 조건부 스킵이 아니다(가토 ⑧ⓛ).
//      해당 분기마다 이유를 주석으로 명시한다.
//  · 축마다 `*-domain` sentinel을 짝으로 둔다 — `eq(tag, 위반목록, [])` 꼴은 정의역이 비면 공허 통과.
//  · 리터럴 금지 — 열 수는 `cols === (chips<=3 ? chips : 2)` 불변식, 간격은 "형제 섹션과 같은가",
//    색은 `:root` 토큰 실측값과 대조(테마마다 다르다), 타임라인 내용은 **API 응답에서 유도**.
//  · ★ 픽스처를 라이브에서 파생하면 그건 픽스처가 아니라 **드리프트하는 스냅샷**이다.
//    이전 판은 `players.map((p,i) => i<6 ? {...p, category:X} : {...p})`로 뒷부분의 category를
//    라이브에서 상속했고, 실발행으로 라이브가 category를 갖자 기대 4그룹 vs 실제 6그룹으로 깨졌다
//    (앱 결함 아님 — 픽스처 결함). 지금은 **모든** 업체의 category를 픽스처가 덮어쓰고,
//    기대 그룹은 그 픽스처 맵에서 유도한다(리터럴 기대값 0).
//  · 판정 범위는 **세 신규 섹션 블록 안**으로 좁힌다(전역 마스트헤드·업체 표가 섞이면 거짓 FAIL).
//  · identity를 판정축보다 **먼저** 둔다 — 판정축이 대상과 독립이면 틀린 페이지 위에서도 통과한다.
//  · 진짜 줄 수 = 서로 다른 top 개수. `range.getClientRects().length`는 텍스트 노드마다 rect가 나오므로
//    줄 수가 아니다(task#275에서 22건 거짓 FAIL).
//
// ── 대조군(기본 꺼짐) — 축이 이빨을 가졌는지 실증. 게이트 아님 ──────────────────
//   CONTROL=nowrap  : 타임라인 이벤트 문장을 nowrap으로 → 설계폭이 가시폭을 넘는다.
//                     tl-self-overflow · overflow-leaf · body-no-hscroll이 FAIL해야 정상.
//                     (= SVG 판의 결함을 HTML 구조에서 재현한 대조군)
//   CONTROL=clamp   : 이벤트 문장을 line-clamp:1로 → "넘치지 않는 잘림"(가토 ⑦).
//                     overflow-vert가 FAIL해야 정상(가로 축·bbox 축은 원리적으로 통과한다).
//   CONTROL=cols    : 칩 그리드를 4열로 강제 → chip-cols · chip-oneline이 FAIL해야 정상.
//   CONTROL=nocolor : 마커 색 규칙을 무효화 → tl-marker-color가 FAIL해야 정상(가토 ⑪).
//   ⚠️ 주입이 조용히 no-op하지 않았는지는 **측정값 이동**으로 먼저 확인한다(원시 실측 로그에 실린다).
//      인라인 스타일을 이기려면 `!important`가 필요하다.
import { chromium, devices } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat281';
fs.mkdirSync(OUT, { recursive: true });

console.log('(a) inject — **실발행 아님 · page.route 주입 응답**(prod tech_reports 무관, 쓰기 0).');
console.log('(b) real   — 주입 0, 라이브 실데이터 GET만(무쓰기).');
console.log('(c) bare   — 3필드를 제거한 주입 응답(graceful 검증, 실발행 아님).');

const results = [];
const P = (ok, tag, msg) => results.push({ ok, tag, msg });
const cov = {};
const bump = (k, n = 1) => { cov[k] = (cov[k] || 0) + n; };
const eq = (tag, got, want, note = '') => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  P(ok, tag, `${ok ? 'PASS' : 'FAIL'} — got=${JSON.stringify(got)} want=${JSON.stringify(want)}${note ? ' · ' + note : ''}`);
};
// 단언 아님 — 조합별 원시 수치. 개별 PASS 메시지는 FAIL이 하나라도 있으면 안 찍히므로 따로 모아 무조건 출력한다.
const rawLog = [];

const CONTROL = process.env.CONTROL || '';
const CONTROL_CSS = {
  // 이벤트 문장이 접히지 못하게 → 설계폭이 가시폭을 넘는다(SVG 판 결함의 HTML 재현)
  nowrap: '.mstone__event-text{white-space:nowrap !important;overflow-wrap:normal !important;word-break:normal !important}',
  // "넘치지 않는 잘림" — 박스를 넘지 않고 박스 **안에서** 내용을 지운다
  clamp: '.mstone__event-text{display:-webkit-box !important;-webkit-line-clamp:1 !important;-webkit-box-orient:vertical !important;overflow:hidden !important}',
  cols: '[data-testid="tech-key-point-chips"]{grid-template-columns:repeat(4,minmax(0,1fr)) !important}',
  // 상태별 색 규칙만 무효화 → 클래스는 그대로 붙어 있고 색만 사라진다
  nocolor: '.mstone__marker--done,.mstone__marker--in_progress{border-color:var(--text-3) !important;background:var(--bg) !important;background-image:none !important}',
};
if (CONTROL && !CONTROL_CSS[CONTROL]) { console.error(`CONTROL=${CONTROL} 미지원(${Object.keys(CONTROL_CSS).join('|')}). 종료.`); process.exit(1); }
if (CONTROL) console.log(`⚠ 대조군 실행 — CONTROL=${CONTROL}: 해당 축이 FAIL해야 정상(게이트 결과 아님).`);

// ── 로그인 (추정 폴백 없음 — 실패 시 즉시 exit) ────────────────────────────────
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const { access_token, refresh_token } = await login.json();
if (!access_token) { console.error('로그인 실패 — access_token 없음. 종료.'); process.exit(1); }

// TECH_NAMES 미러 — frontend/src/components/reports/techReportUtils.js(백엔드는 표시명을 응답에 싣지 않는다,
// ADR-0033 결정 2). h1 identity 단언의 기대값 소스이므로 슬러그가 없으면 즉시 exit(추정 금지).
const TECH_NAMES = {
  'reusable-rocket': '재사용 로켓', 'solid-state-battery': '전고체 배터리', smr: 'SMR', robotics: '로봇',
  'ai-datacenter-equipment': 'AI 데이터센터 설비', 'ai-datacenter-ops': 'AI 데이터센터 운영',
};
// task#304 S3 — 대상 slug를 **4종**으로 맞춘다(결함의 가시성이 판마다 갈린다). 착수 실측
// (2026-08-16, GET /api/tech-reports): ai-datacenter-equipment 25업체·25분류(최다 행·최다 분류) ·
// solid-state-battery 12·12(최장 leader_name) · reusable-rocket 9·9(최장 country, tech_level 1~5 전 단계) ·
// smr 11업체·**9분류**(부분 분류 — 분류 없는 업체가 groupByCategory 마지막 그룹으로 모인다).
const SLUGS = ['ai-datacenter-equipment', 'solid-state-battery', 'reusable-rocket', 'smr'];
const INJECT_SLUG = 'smr';              // (a) 자립 픽스처 주입 대상
const BARE_SLUG = 'reusable-rocket';    // (c) 3필드 제거 주입 대상(두 슬러그를 고루 태운다)

// ── MilestoneTimeline.jsx 미러(소스 직독) ─────────────────────────────────────
// 프로브가 기대값을 리터럴로 박지 않고 API/픽스처에서 **유도**하기 위한 순수 함수.
// 규칙: year가 유한수이고 event가 비지 않은 항목만, 연도 오름차순(동률은 입력 순서 유지).
// 연도 그룹 = 정렬 후 연속 동일 연도. 폴드·생략 없음(전량 표시).
const STATUSES = ['done', 'in_progress', 'planned'];
const STATUS_LABEL = { done: '완료', in_progress: '진행 중', planned: '예정' };
const tlLayout = (milestones) => {
  const items = (Array.isArray(milestones) ? milestones : [])
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m && typeof m.year === 'number' && Number.isFinite(m.year)
      && typeof m.event === 'string' && m.event.trim().length > 0)
    .sort((a, b) => a.m.year - b.m.year || a.i - b.i)
    .map(({ m }) => ({
      year: m.year,
      event: m.event.trim(),
      actor: typeof m.actor === 'string' && m.actor.trim() ? m.actor.trim() : null,
      status: STATUSES.includes(m.status) ? m.status : 'planned',
    }));
  const years = [];
  for (const it of items) if (years[years.length - 1] !== it.year) years.push(it.year);
  return { items, years, legend: STATUSES.filter((s) => items.some((it) => it.status === s)) };
};

// CategoryGroups.jsx 미러는 task#301 S2에서 그 컴포넌트가 삭제되며 함께 제거했다(UNCLASSIFIED_LABEL·
// catGroupsOf) — 아래 cat-* 단언 제거를 참조.

// ── 실응답 수집 ───────────────────────────────────────────────────────────────
const DATA = {};
for (const slug of SLUGS) {
  const res = await fetch(`${BASE}/api/tech-reports/${slug}`, { headers: { Authorization: `Bearer ${access_token}` } });
  const body = await res.json();
  const rep = (body.reports || [])[0];
  if (!rep) { console.error(`발행물 없음 — /api/tech-reports/${slug} reports[0] 부재. 종료.`); process.exit(1); }
  if (!TECH_NAMES[slug]) { console.error(`TECH_NAMES 미러에 ${slug} 없음(기대값 소스 부재). 종료.`); process.exit(1); }
  if (!rep.title) { console.error(`${slug}: title 부재 — lead identity 기대값을 만들 수 없다. 종료.`); process.exit(1); }
  const players = rep.players || [];
  const kp = Array.isArray(rep.key_points) ? rep.key_points : [];
  const lay = tlLayout(rep.milestones);
  DATA[slug] = { rep, players, techName: TECH_NAMES[slug], title: rep.title };
  console.log(`  [실응답] ${slug}: title ${rep.title.length}자 · players ${players.length}` +
    ` · key_points ${kp.length}(칩 ${JSON.stringify(kp.map((p) => (Array.isArray(p.metrics) ? p.metrics.length : 0)))}` +
    `, change_pct 유효 ${kp.reduce((s, p) => s + (Array.isArray(p.metrics) ? p.metrics.filter((m) => m.change_pct != null).length : 0), 0)}건)` +
    ` · milestones raw ${(rep.milestones || []).length}→유효 ${lay.items.length} · 연도 ${JSON.stringify(lay.years)}` +
    ` · 최장 event ${Math.max(0, ...lay.items.map((i) => i.event.length))}자` +
    ` · category ${JSON.stringify([...new Set(players.map((p) => p.category).filter(Boolean))])}` +
    ` · 미분류 ${players.filter((p) => !p.category).length}곳`);
}

// ── (a) 자립 픽스처 ───────────────────────────────────────────────────────────
// 제목·업체명·시장·산문은 실데이터를 베이스로 쓴다(레이아웃을 프로덕션과 같은 조건에서 재기 위해).
// 그러나 **판정 대상이 되는 세 필드는 전부 픽스처가 소유한다** — 라이브에서 상속하지 않는다.
const KEY_POINTS = [
  { title: '육상 상용 1호 자리는 중국 링룽 1호로 굳어졌다',
    metrics: [
      { label: '계통연결', value: '2026년' },
      { label: '설계출력', value: '125 MWe' },
      { label: '건설기간', value: '5.5년', change_pct: -8.4 },
      { label: '누적투자', value: '1.1조원', change_pct: 22.5 },
    ],
    body: '착공 2021년, 계통연결 2026년. 서방 설계가 인허가 단계에 머무는 동안 유일하게 공정을 끝냈다.' },
  { title: '서방에서 실제 착공에 들어간 설계는 BWRX-300뿐이다',
    metrics: [
      { label: '착공', value: '2025년' },
      { label: '가동목표', value: '2029년' },
      { label: '확정수주', value: '4기', change_pct: 0 },
    ],
    body: 'GE-히타치 BWRX-300이 캐나다 다링턴에서 굴착을 마쳤다. 나머지는 설계인가 단계다.' },
  { title: '한국 i-SMR은 표준설계 인가 심사에 들어갔다',
    metrics: [{ label: '인가목표', value: '2034년' }],
    body: '2028년 표준설계 인가를 목표로 심사 중이며, 실증호기 부지는 아직 확정되지 않았다.' },
  { title: '규제 조화가 남은 최대 병목이다',
    metrics: [],
    body: '설계별 인허가가 국가마다 갈라져 있어, 같은 노형도 수출 때마다 심사를 다시 받는다.' },
];
const MILESTONES = [
  // actor는 선택 필드 — 명시적 null도 실제 응답에 온다(Optional 계약). 한 건은 일부러 null로 둔다.
  // 2026은 4건 — 한 연도 그룹에 여러 이벤트가 붙는 분기를 자극한다(그룹당 1건뿐이면 그 구조가 안 잡힌다).
  // 입력을 **일부러 연도 역순으로 섞어** 둔다 — 정렬 미적용을 tl-years가 잡게 하기 위해서다.
  { year: 2029, actor: 'GE-히타치', event: 'BWRX-300 1호기 가동', status: 'planned' },
  { year: 2020, actor: null, event: '로모노소프 부유식 상업운전', status: 'done' },
  { year: 2026, actor: 'CNNC', event: '링룽 1호 계통연결', status: 'in_progress' },
  { year: 2034, actor: '한수원', event: 'i-SMR 표준설계 인가', status: 'planned' },
  { year: 2026, actor: '뉴스케일', event: 'RoPower 최종투자결정', status: 'in_progress' },
  { year: 2023, actor: '중국 화능', event: 'HTR-PM 상업운전 개시', status: 'done' },
  { year: 2026, actor: '홀텍', event: 'SMR-300 부지 착공', status: 'planned' },
  { year: 2026, actor: '롤스로이스', event: '영국 GDA 3단계 통과', status: 'planned' },
];
const INJ_CATS = ['경수형(PWR)', '고온가스로(HTGR)', '소듐냉각고속로(SFR)'];
const INJ_CAT_SPAN = 6;   // 앞 6곳만 분류 — 나머지는 명시적 null(미분류 버킷이 비면 그 분기가 공허해진다)

// 세 필드를 얹은 응답. **모든** 업체의 category를 픽스처가 덮어쓴다(라이브 상속 0).
const injectedRep = (slug) => {
  const rep = DATA[slug].rep;
  return {
    ...rep,
    players: (rep.players || []).map((p, i) => ({ ...p, category: i < INJ_CAT_SPAN ? INJ_CATS[i % INJ_CATS.length] : null })),
    key_points: KEY_POINTS,
    milestones: MILESTONES,
  };
};
// 세 필드를 **제거**한 응답 — graceful 검증용.
// category는 두 형태를 섞는다: 키 자체 없음(구발행물) / 명시적 null(신규 판의 생략).
// CategoryGroups.jsx가 "두 형태를 같이 흡수해야 한다"고 주석으로 못박은 그 분기를 실제로 태운다.
const bareRep = (slug) => {
  const rep = DATA[slug].rep;
  return {
    ...rep,
    players: (rep.players || []).map((p, i) => { const q = { ...p }; if (i % 2 === 0) delete q.category; else q.category = null; return q; }),
    key_points: null,
    milestones: null,
  };
};

const INJ = injectedRep(INJECT_SLUG);
const BARE = bareRep(BARE_SLUG);
{
  const lay = tlLayout(MILESTONES);
  console.log(`  [주입 픽스처] ${INJECT_SLUG}: key_points ${KEY_POINTS.length}장` +
    `(칩 ${JSON.stringify(KEY_POINTS.map((p) => p.metrics.length))} · change_pct ${KEY_POINTS.reduce((s, p) => s + p.metrics.filter((m) => m.change_pct != null).length, 0)}건)` +
    ` · milestones ${MILESTONES.length}건 → 연도 ${JSON.stringify(lay.years)} · 상태 ${JSON.stringify(lay.legend)}` +
    ` · category ${INJ.players.filter((p) => p.category).length}/${INJ.players.length}곳(미분류 ${INJ.players.filter((p) => !p.category).length})`);
  console.log(`  [bare 픽스처] ${BARE_SLUG}: key_points=${JSON.stringify(BARE.key_points)} · milestones=${JSON.stringify(BARE.milestones)}` +
    ` · category 키없음 ${BARE.players.filter((p) => !('category' in p)).length}곳 / null ${BARE.players.filter((p) => p.category === null).length}곳`);
}

// ── 브라우저 안 측정기 ────────────────────────────────────────────────────────
// ResearchShell이 PC는 `.page`, 모바일은 `.m-page`로 children만 감싼다 — 그 안쪽을 루트로 잡아야
// 모바일 seg 탭바·마스트헤드가 표본에 섞이지 않는다(uat276/uat280에서 실측 확정한 관용구).
const ROOT_SEL = 'main.page-wrap .page, main.page-wrap .m-page';

const measure = (page) => page.evaluate((ROOT_SEL) => {
  const root = document.querySelector(ROOT_SEL);
  if (!root) return { found: false, why: 'ROOT_MISSING' };
  const leadEl = root.querySelector('[data-testid="tech-report-lead"]');
  if (!leadEl) return { found: false, why: 'LEAD_MISSING' };
  const container = leadEl.parentElement;   // TechReport 본문 컨테이너(maxWidth 780)

  const cs = (el) => getComputedStyle(el);
  const txt = (el) => (el ? el.textContent.trim() : '');

  // 토큰 → rgb 정규화: 임시 노드에 실어 브라우저가 계산한 값을 되읽는다(하드코딩 hex 대조 금지 —
  // 토큰은 테마마다 다르다).
  const rootCS = cs(document.documentElement);
  const norm = (v) => {
    const el = document.createElement('span');
    el.style.color = (v || '').trim();
    document.body.appendChild(el);
    const c = cs(el).color;
    el.remove();
    return c;
  };
  const tok = (n) => norm(rootCS.getPropertyValue(n));

  // 진짜 줄 수 = 서로 다른 top 개수(rect 개수가 아니다 — 텍스트 노드마다 rect가 나온다).
  const lineCount = (el) => {
    const r = document.createRange(); r.selectNodeContents(el);
    return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size || 1;
  };
  // 컨테이너 직속 섹션 블록 — 간격 축의 측정 단위
  const blockOf = (el) => { let e = el; while (e && e.parentElement && e.parentElement !== container) e = e.parentElement; return e && e.parentElement === container ? e : null; };
  const gapPx = (a, b) => Math.round(b.getBoundingClientRect().top - a.getBoundingClientRect().bottom);

  const q = (s) => root.querySelector(s);
  const kpEl = q('[data-testid="tech-key-points"]');
  const tlEl = q('[data-testid="milestone-timeline"]');
  const catEl = q('[data-testid="tech-report-categories"]');
  const kpisEl = q('[data-testid="tech-report-kpis"]');
  const playersEl = q('[data-testid="tech-report-players"]');
  // task#304(ADR-0041) — 「기술수준 비교」 밴드가 표의 셀로 흡수돼 **섹션이 사라졌다**. 이 파일의
  // band 앵커는 도달 불가해졌으므로 순서·간격 사슬에서 뺀다(삭제가 아니라 부재 자체를 축으로 승격 —
  // 아래 section-absent-band). 그대로 두면 order-domain이 ANCHOR_MISSING으로 **구조적 상시 FAIL**한다
  // (task#301이 categories 앵커에서 이미 겪은 것과 같은 형태 — 뒤집을 축이 아니라 고쳐야 할 버그다).
  const bandGone = root.querySelectorAll('[data-testid="tech-level-band"]').length
    + root.querySelectorAll('[data-tech-section="levels"]').length;

  // ── 섹션 문서 순서 ──
  const all = [...root.querySelectorAll('*')];
  const idxOf = (sel) => { const el = q(sel); return el ? all.indexOf(el) : -1; };
  const order = {
    lead: idxOf('[data-testid="tech-report-lead"]'),
    kpis: idxOf('[data-testid="tech-report-kpis"]'),
    keyPoints: idxOf('[data-testid="tech-key-points"]'),
    timeline: idxOf('[data-testid="milestone-timeline"]'),
    players: idxOf('[data-testid="tech-report-players"]'),
    categories: idxOf('[data-testid="tech-report-categories"]'),
    prose: idxOf('[data-testid="tech-report-prose"]'),
    sources: idxOf('[data-testid="tech-report-sources"]'),
  };

  // ── 핵심 포인트 ──
  // 카드 내부 구조는 KeyPointCards.jsx 직독(testid가 없는 자리는 위치로 집는다):
  //   Card > [0] 제목행(span 번호 · div 제목) / [1] 본문(칩 그리드? · p body)
  const cards = kpEl ? [...kpEl.querySelectorAll('[data-testid="tech-key-point"]')] : [];
  const kpTitles = cards.map((c) => txt(c.children[0] && c.children[0].children[1]));
  const kpNumerals = cards.map((c) => txt(c.children[0] && c.children[0].children[0]));
  const grids = kpEl ? [...kpEl.querySelectorAll('[data-testid="tech-key-point-chips"]')].map((g) => {
    const gc = cs(g);
    return {
      chips: g.children.length,
      cols: gc.gridTemplateColumns.trim().split(/\s+/).length,
      raw: gc.gridTemplateColumns,
      trackW: Math.round(g.getBoundingClientRect().width / Math.max(1, gc.gridTemplateColumns.trim().split(/\s+/).length)),
    };
  }) : [];
  // 증감 칩 색 — 전역 유틸 클래스 .up/.down이 CSS에 실재해야 색이 붙는다(가토 ⑪: 없는 클래스는
  // 아무도 죽지 않고 색만 조용히 사라진다). computed color를 :root 토큰 실측값과 대조한다.
  const changes = kpEl ? [...kpEl.querySelectorAll('[data-testid="tech-key-point-change"]')].map((e) => ({
    t: txt(e), cls: e.className, color: cs(e).color,
  })) : [];
  // 칩 label/값의 줄 수 — 1줄이 설계 의도인 자리(task#225: 좁은 트랙에서 접히면 카드가 오히려 커진다)
  const chipLines = [];
  if (kpEl) for (const g of kpEl.querySelectorAll('[data-testid="tech-key-point-chips"]')) {
    for (const chip of g.children) {
      if (chip.children[0]) chipLines.push({ kind: 'label', t: txt(chip.children[0]).slice(0, 24), lines: lineCount(chip.children[0]) });
      if (chip.children[1]) chipLines.push({ kind: 'value', t: txt(chip.children[1]).slice(0, 24), lines: lineCount(chip.children[1]) });
    }
  }

  // ── 진척 타임라인 (세로 HTML 목록 — SVG 아님) ──
  const tlItemEls = tlEl ? [...tlEl.querySelectorAll('[data-testid="milestone-item"]')] : [];
  const tlItems = tlItemEls.map((li) => {
    const mk = li.querySelector('.mstone__marker');
    const sr = li.querySelector('.sr-only');
    const ev = li.querySelector('.mstone__event-text');
    const ac = li.querySelector('.mstone__actor');
    const mc = mk ? cs(mk) : null;
    return {
      status: li.getAttribute('data-status'),
      year: li.getAttribute('data-year'),
      event: txt(ev),
      actor: ac ? txt(ac) : null,
      sr: sr ? txt(sr) : null,
      markerCls: mk ? mk.className : null,
      markerAria: mk ? mk.getAttribute('aria-hidden') : null,
      borderColor: mc ? mc.borderColor : null,
      bgColor: mc ? mc.backgroundColor : null,
      bgImage: mc ? (mc.backgroundImage === 'none' ? 'none' : 'gradient') : null,
    };
  });
  const tlYears = tlEl ? [...tlEl.querySelectorAll('[data-testid="milestone-year"]')].map((e) => txt(e)) : [];
  const tlLegend = tlEl ? [...tlEl.querySelectorAll('[data-testid="milestone-legend"] > span')].map((e) => txt(e)) : [];
  const tlLists = tlEl ? {
    ol: tlEl.querySelectorAll('ol.mstone__list').length,
    ul: tlEl.querySelectorAll('ul.mstone__events').length,
    groups: tlEl.querySelectorAll('li.mstone__group').length,
  } : null;
  // ★ 이번 결함(설계폭 > 가시폭)을 **직접** 재는 축 — 컴포넌트 자신과 모든 자손이 자기 상자를
  //   가로로 넘지 않는가. 기존 3축(leaf 넘침·판독성·본문 가로스크롤)은 SVG 판에서 전부 통과했다.
  //   ⚠️ `.sr-only`는 제외한다 — `width:1px;overflow:hidden`이 **설계**라 항상 scrollW≫clientW다
  //      (실측 24/1·40/1). 시각적 넘침이 아니라 시각적 은폐이며, 아래 srOnly 카운터가 제외 규모를
  //      그대로 보고해 이 제외가 다른 표본까지 삼키지 않았음을 드러낸다.
  const isSR = (e) => e.classList && e.classList.contains('sr-only');
  const tlSelfOverflow = tlEl
    ? [tlEl, ...tlEl.querySelectorAll('*')].filter((e) => !isSR(e) && e.scrollWidth - e.clientWidth > 1)
        .map((e) => `${e.className || e.tagName}(${e.scrollWidth}>${e.clientWidth})`)
    : null;
  const tlBox = tlEl ? { scrollW: tlEl.scrollWidth, clientW: tlEl.clientWidth, w: Math.round(tlEl.getBoundingClientRect().width) } : null;

  // ── 계보 분류 ──
  const catGroups = catEl ? [...catEl.querySelectorAll('[data-testid="tech-report-category-group"]')].map((g) => ({
    label: txt(g.children[0]),
    chips: [...g.querySelectorAll('[data-testid="tech-report-category-chip"]')].map((c) => txt(c)),
  })) : [];
  const catLabelLines = catEl ? [...catEl.querySelectorAll('[data-testid="tech-report-category-group"]')]
    .map((g) => ({ t: txt(g.children[0]).slice(0, 24), lines: g.children[0] ? lineCount(g.children[0]) : 0 })) : [];
  // 업체 표에 **실제로 렌더된 순서**(= 페이지가 정한 ordered). 계보 칩 순서의 기대값은 여기서 만든다 —
  // sortPlayers를 프로브가 다시 구현하지 않는다. 새 소비처가 report.players(API 원순서)를 쓰면
  // 두 순서가 갈리고 이 대조가 잡는다(task#280 F1의 재발 지점).
  const tableNames = playersEl
    ? [...playersEl.querySelectorAll('[data-testid="tech-report-player-row"]')]
        .map((tr) => txt(tr.querySelector('[data-testid="tech-report-player-name"]')))
    : [];

  // ── 넘침 3계열 — 정의역은 **세 신규 블록 안**으로 좁힌다 ──
  const blocks = [kpEl, tlEl, catEl].filter(Boolean);
  const LEAF_SEL = 'span, div, p, a, li, button';
  const srCount = blocks.reduce((s, b) => s + b.querySelectorAll('.sr-only').length, 0);
  // ① 텍스트 leaf의 가로 자기 넘침
  const leaves = blocks.flatMap((b) => [...b.querySelectorAll(LEAF_SEL)])
    .filter((e) => e.children.length === 0 && txt(e).length > 0 && !isSR(e))
    .map((e) => ({ t: txt(e).slice(0, 28), scrollW: e.scrollWidth, clientW: e.clientWidth, scrollH: e.scrollHeight, clientH: e.clientHeight }));
  // ② 잘라내는 주체가 **부모**인 경우 — 자식이 nowrap이면 자식의 scrollWidth==clientWidth라 leaf 축이
  //    전부 통과한다(task#275 실측). overflow-x:hidden 컨테이너를 별도 계열로 잰다.
  const clippers = blocks.flatMap((b) => [...b.querySelectorAll('*')])
    .filter((e) => cs(e).overflowX === 'hidden' && txt(e).length > 0 && !isSR(e))
    .map((e) => ({ t: txt(e).slice(0, 28), tag: e.tagName.toLowerCase(), scrollW: e.scrollWidth, clientW: e.clientWidth }));
  // ③ **세로** 잘림 — "넘치지 않는 잘림"(가토 ⑦). line-clamp·max-height는 박스를 넘지 않고 박스
  //    **안에서** 내용을 지우므로 ①②가 원리적으로 못 본다. overflow-y가 hidden/clip인 것만 정의역.
  const vclippers = blocks.flatMap((b) => [...b.querySelectorAll('*')])
    .filter((e) => ['hidden', 'clip'].includes(cs(e).overflowY) && txt(e).length > 0 && !isSR(e))
    .map((e) => ({ t: txt(e).slice(0, 28), tag: e.tagName.toLowerCase(), scrollH: e.scrollHeight, clientH: e.clientHeight }));

  // ── 섹션 제목 줄 수 — 짧은 라벨이라 어느 폭에서도 1줄이 설계 의도. 정의역은 컨테이너 전체(모드 무관).
  const titles = [...container.querySelectorAll('.rpt-title__text')].map((t) => ({ t: txt(t).slice(0, 20), lines: lineCount(t) }));

  // ── 섹션 간 간격 — 리터럴 30px이 아니라 "형제 섹션과 같은가"(불변식). 존재하는 블록만 연쇄한다.
  const chain = [['kpis', kpisEl], ['keyPoints', kpEl], ['timeline', tlEl], ['players', playersEl], ['categories', catEl]]
    .map(([k, el]) => [k, el ? blockOf(el) : null]).filter(([, b]) => b);
  const gaps = [];
  for (let i = 0; i + 1 < chain.length; i++) gaps.push({ from: chain[i][0], to: chain[i + 1][0], px: gapPx(chain[i][1], chain[i + 1][1]) });

  return {
    found: true,
    order,
    hasKeyPoints: !!kpEl, hasTimeline: !!tlEl, hasCategories: !!catEl,
    hasPlayers: !!playersEl, bandGone, hasKpis: !!kpisEl,
    cards: cards.length, kpTitles, kpNumerals, grids, changes, chipLines,
    tlItems, tlYears, tlLegend, tlLists, tlSelfOverflow, tlBox,
    tlRoleImg: blocks.reduce((s, b) => s + b.querySelectorAll('[role="img"]').length, 0),
    catGroups, catLabelLines, tableNames,
    leaves, clippers, vclippers, srCount, titles, gaps, chainKeys: chain.map(([k]) => k),
    tokens: { up: tok('--up'), down: tok('--down'), text: tok('--text'), success: tok('--color-success'), warn: tok('--warn'), text3: tok('--text-3'), bg: tok('--bg') },
    h1Text: txt(root.querySelector('h1')) || null,
    leadText: txt(leadEl) || null,
    docScrollW: document.documentElement.scrollWidth,
    docClientW: document.documentElement.clientWidth,
    vw: window.innerWidth, vh: window.innerHeight,
  };
}, ROOT_SEL);

// ── 실행 ──────────────────────────────────────────────────────────────────────
// 4조합 = 3폭 × 2테마(가장 좁은 폭에 다크를 물려 최악 조합을 반드시 포함시킨다).
const VIEWS = [
  { key: 'pc1440-light', theme: 'light', mobile: false, opts: { viewport: { width: 1440, height: 1000 } } },
  { key: 'pc1440-dark', theme: 'dark', mobile: false, opts: { viewport: { width: 1440, height: 1000 } } },
  { key: 'm390-light', theme: 'light', mobile: true, opts: { ...devices['iPhone 13'] } },
  { key: 'm350-dark', theme: 'dark', mobile: true, opts: { viewport: { width: 350, height: 700 } } },
];

const geomWidths = new Set();   // 전역 이빨 — 기하 축이 정말 서로 다른 제약 아래에서 돌았는가
const realEventSig = {};        // 전역 이빨 — 두 슬러그가 서로 다른 내용을 렌더했는가
const browser = await chromium.launch();

for (const V of VIEWS) {
  // SW가 /api/*를 가로채면 page.route 주입이 조용히 no-op한다 → serviceWorkers:'block' 필수.
  const ctx = await browser.newContext({ ...V.opts, serviceWorkers: 'block' });
  // pwa 설치 배너는 앱 전역 프로모라 이 페이지의 레이아웃이 아니다 — 닫힌(정상) 상태로 고정한다.
  // 키·형식은 frontend/src/utils/pwa.js 직독(SUPPRESS_KEY = 'pwa-install-dismissed-at', String(Date.now())).
  await ctx.addInitScript(([a, r, th]) => {
    localStorage.setItem('access_token', a);
    localStorage.setItem('refresh_token', r);
    localStorage.setItem('theme', th);
    localStorage.setItem('pwa-install-dismissed-at', String(Date.now()));
  }, [access_token, refresh_token, V.theme]);

  // 모드 × 대상: (a) 주입 1건 + (c) bare 1건 + (b) 실데이터 2건
  const RUNS = [
    { mode: 'inject', slug: INJECT_SLUG, rep: INJ },
    { mode: 'bare', slug: BARE_SLUG, rep: BARE },
    ...SLUGS.map((s) => ({ mode: 'real', slug: s, rep: DATA[s].rep })),
  ];

  for (const R of RUNS) {
    const tag = `${V.key}/${R.mode}:${R.slug}`;
    const D = DATA[R.slug];
    const SRC = R.rep;                                   // 이 실행의 **기대값 소스**(주입이면 픽스처, real이면 실응답)
    const srcKp = Array.isArray(SRC.key_points) ? SRC.key_points : [];
    const srcLay = tlLayout(SRC.milestones);
    // srcCatValues는 bare 모드의 fixture 무결성 확인(bareOk)에만 쓰인다 — cat-* 단언 자체는 제거됨.
    const srcCatValues = (SRC.players || []).map((p) => p.category).filter((c) => typeof c === 'string' && c.trim() !== '');
    const expChangeCount = srcKp.reduce((s, p) => s + (Array.isArray(p.metrics) ? p.metrics.filter((m) => m.change_pct != null).length : 0), 0);

    const page = await ctx.newPage();
    const errs = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errs.push(msg.text()); });
    page.on('pageerror', (e) => errs.push(String(e)));

    let intercepted = 0;
    try {
      if (R.mode !== 'real') {
        await page.route(`**/api/tech-reports/${R.slug}`, async (route) => {
          intercepted += 1;
          await route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ slug: R.slug, reports: [SRC] }),
          });
        });
      }

      await page.goto(`${BASE}/tech-report/${R.slug}`, { waitUntil: 'networkidle' }).catch((e) => errs.push(`goto:${e}`));
      await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0).catch(() => {});
      await page.waitForTimeout(1200);
      if (CONTROL) { await page.addStyleTag({ content: CONTROL_CSS[CONTROL] }); await page.waitForTimeout(400); }

      let m = await measure(page);
      if (!m.found) {   // 무음 스킵 금지 — id 명시 1회 재시도 후에도 없으면 FAIL
        console.log(`  (재시도) ${tag} — 본문 미검출(${m.why}), 1.8s 대기 후 재측정`);
        await page.waitForTimeout(1800);
        m = await measure(page);
      }
      eq(`page:${tag}`, m.found ? 'PRESENT' : `PAGE_MISSING(${m.why})`, 'PRESENT');
      bump('page');

      if (!m.found) {
        eq(`console:${tag}`, errs, [], '측정 불가 화면(참고용)');
        bump('console');
        await page.screenshot({ path: `${OUT}/${V.key}-${R.mode}-${R.slug}-fail.png`, fullPage: false });
        await page.close();
        continue;
      }

      // ── (1) identity — 판정축보다 **먼저**. 아래 축들은 대상과 독립이라 틀린 문서 위에서도 통과한다.
      eq(`identity-h1:${tag}`, m.h1Text ?? 'H1_MISSING', D.techName, '기술명(TECH_NAMES 미러)');
      eq(`identity-lead:${tag}`, m.leadText ?? 'LEAD_MISSING', D.title, `리드 = API title(${D.title.length}자)`);
      eq(`identity-differ:${tag}`, new Set([D.techName, D.title]).size, 2, '이빨 — 기술명 ≠ 제목이어야 두 축이 서로 다른 것을 본다');
      bump('identity', 3);

      // 주입 모드는 라우트가 실제로 발동했는지 먼저 — 미발동이면 아래 전부가 "실데이터를 재는" 다른 실험이 된다.
      // (real은 주입이 없으므로 이 축의 정의역 밖이다 — 실행 전에 결정되는 분기, 조건부 스킵 아님)
      if (R.mode !== 'real') {
        eq(`intercept:${tag}`, intercepted > 0 ? 'FIRED' : 'ROUTE_NOT_INTERCEPTED', 'FIRED', `호출 ${intercepted}회`);
        bump('intercept');
      }

      // ── (2) 기존 섹션 보존 — 세 모드 공통. 신규 섹션이 있든 없든 형제는 그대로여야 한다.
      eq(`graceful-siblings:${tag}`, { kpis: m.hasKpis, players: m.hasPlayers }, { kpis: true, players: true },
        '신규 3섹션의 유무가 다른 섹션 렌더에 영향 0(task#304: band는 표로 흡수돼 형제가 아니다)');
      // 흡수가 반쪽인 상태(섹션이 남아 있는데 셀도 생김)를 통과시키지 않도록 부재를 무조건 단언한다.
      eq(`section-absent-band:${tag}`, m.bandGone, 0,
        '[data-testid="tech-level-band"] + [data-tech-section="levels"] 합계(ADR-0041)');
      bump('graceful-siblings', 2);

      if (R.mode === 'bare') {
        // ── (c) graceful — 3필드 없는 판에서 세 섹션이 조용히 생략된다 ──
        // domain: 픽스처가 정말 3필드를 갖지 않는가(주입이므로 deterministic — 라이브 발행 상태에 안 흔들린다).
        const bareOk = SRC.key_points == null && SRC.milestones == null && srcCatValues.length === 0;
        eq(`section-absent-domain:${tag}`, bareOk ? 'OK' : `FIXTURE_HAS_FIELDS(kp=${SRC.key_points != null},ms=${SRC.milestones != null},cat=${srcCatValues.length})`, 'OK',
          `category 키없음 ${(SRC.players || []).filter((p) => !('category' in p)).length}곳 / null ${(SRC.players || []).filter((p) => p.category === null).length}곳 — 두 생략 형태를 모두 태운다`);
        eq(`section-absent-keypoints:${tag}`, m.hasKeyPoints ? 'UNEXPECTED_SECTION' : 'ABSENT', 'ABSENT');
        eq(`section-absent-timeline:${tag}`, m.hasTimeline ? 'UNEXPECTED_SECTION' : 'ABSENT', 'ABSENT');
        eq(`section-absent-categories:${tag}`, m.hasCategories ? 'UNEXPECTED_SECTION' : 'ABSENT', 'ABSENT');
        bump('section-absent', 4);

        // 생략된 자리에 유령 간격이 남지 않는가 — 남은 블록들의 간격이 여전히 균일해야 한다.
        eq(`gap-domain:${tag}`, m.gaps.length, m.chainKeys.length - 1, `연쇄 ${JSON.stringify(m.chainKeys)}`);
        eq(`gap-uniform:${tag}`, [...new Set(m.gaps.map((g) => g.px))].length, 1,
          `실측 ${m.gaps.map((g) => `${g.from}→${g.to}=${g.px}px`).join(' · ')}`);
        bump('gap', m.gaps.length + 1);

        // 배치 순서(신규 3섹션 제외)
        const seq = ['lead', 'kpis', 'players', 'prose', 'sources'];
        const miss = seq.filter((k) => m.order[k] < 0);
        eq(`order-domain:${tag}`, miss.length ? `ANCHOR_MISSING(${miss.join(',')})` : 'OK', 'OK', JSON.stringify(m.order));
        const idxs = seq.map((k) => m.order[k]);
        eq(`order:${tag}`, idxs.every((v, i) => i === 0 || (v > idxs[i - 1] && idxs[i - 1] >= 0)) ? 'OK' : `OUT_OF_ORDER(${JSON.stringify(m.order)})`, 'OK', seq.join('→'));
        bump('order', seq.length);

        rawLog.push(`${tag} · 신규 섹션 부재(kp/ms/cat=${m.hasKeyPoints}/${m.hasTimeline}/${m.hasCategories})` +
          ` · 기존 섹션 kpis/players=${m.hasKpis}/${m.hasPlayers} · 밴드 잔존 ${m.bandGone} · 간격 ${JSON.stringify(m.gaps.map((g) => g.px))}`);
      } else {
        // ══ (a) inject · (b) real 공통 배터리 — 기대값은 전부 SRC(픽스처 또는 실응답)에서 유도한다 ══

        // ── 대상 유효성: 이 소스가 정말 3필드를 담고 있는가 ──
        // real에서 이것이 FAIL하면 "실발행이 3필드를 채웠다"는 전제가 깨진 것이다(이전 판의
        // section-absent-domain을 뒤집은 짝 — 조용히 통과하지 않는다).
        const srcOk = srcKp.length > 0 && srcLay.items.length > 0;
        eq(`${R.mode === 'real' ? 'real-fields' : 'inject-fixture'}-domain:${tag}`,
          srcOk ? 'OK' : `SOURCE_MISSING_FIELDS(kp=${srcKp.length},ms=${srcLay.items.length})`, 'OK',
          `key_points ${srcKp.length} · milestones ${srcLay.items.length}`);
        eq(`section-present-keypoints:${tag}`, m.hasKeyPoints ? 'PRESENT' : 'SECTION_MISSING', 'PRESENT');
        eq(`section-present-timeline:${tag}`, m.hasTimeline ? 'PRESENT' : 'SECTION_MISSING', 'PRESENT');
        // task#301 S2 — 「계보 분류」 섹션이 완전히 제거됐다(CategoryGroups.jsx 삭제, ADR-0039).
        // 예전엔 여기서 PRESENT를 기대했다 — 뒤집었다(없는 축을 다음 사람이 모르게 하지 않는다,
        // TESTING.md §7.3ⓘ). 같은 데이터(players[].category)로 업체를 축별로 묶는 신 UI(PlayerTable
        // 소제목행·ShareChart 그룹)는 이 파일의 몫이 아니라 uat301-datacenter-split.mjs가 잰다.
        eq(`section-absent-categories:${tag}`, m.hasCategories ? 'UNEXPECTED_SECTION' : 'ABSENT', 'ABSENT');
        bump('section-present', 4);

        // ── 섹션 배치 순서(확정 순서) ── task#301 S2: 계보(categories) 앵커가 사라져 시퀀스에서 뺐다 —
        // 그대로 두면 앵커가 영원히 없어 order-domain이 구조적으로 항상 FAIL한다(뒤집을 축이 아니라
        // 고쳐야 할 버그였다). 부재 자체는 바로 위 section-absent-categories가 이미 단언한다.
        const seq = ['lead', 'kpis', 'keyPoints', 'timeline', 'players', 'prose', 'sources'];
        const miss = seq.filter((k) => m.order[k] < 0);
        eq(`order-domain:${tag}`, miss.length ? `ANCHOR_MISSING(${miss.join(',')})` : 'OK', 'OK', JSON.stringify(m.order));
        const idxs = seq.map((k) => m.order[k]);
        eq(`order:${tag}`, idxs.every((v, i) => i === 0 || (v > idxs[i - 1] && idxs[i - 1] >= 0)) ? 'OK' : `OUT_OF_ORDER(${JSON.stringify(m.order)})`, 'OK',
          'lead→kpis→핵심포인트→타임라인→업체→산문→출처(task#304: 밴드 섹션 제거)');
        bump('order', seq.length);

        // ── 핵심 포인트 내용 = 소스와 일치 ──
        eq(`content-kp-titles:${tag}`, m.kpTitles, srcKp.map((p) => p.title), `카드 ${m.cards}장`);
        eq(`content-kp-numerals:${tag}`, m.kpNumerals, srcKp.map((_, i) => String(i + 1).padStart(2, '0')), '번호는 01부터');
        bump('content-kp', 2);

        // ── point-chip-cols — 리터럴 금지, 칩 수에 맞춘 열 수 불변식 ──
        eq(`chip-cols-domain:${tag}`, m.grids.map((g) => g.chips), srcKp.map((p) => (Array.isArray(p.metrics) ? p.metrics.length : 0)).filter((n) => n > 0),
          `그리드 ${m.grids.length}개 — 칩 0개인 카드는 그리드를 만들지 않는다`);
        eq(`chip-cols:${tag}`, m.grids.map((g) => g.cols), m.grids.map((g) => (g.chips <= 3 ? g.chips : 2)),
          `raw ${JSON.stringify(m.grids.map((g) => g.raw))} · 트랙 ${JSON.stringify(m.grids.map((g) => g.trackW))}px`);
        bump('chip-cols', m.grids.length + 1);

        // ── 증감 칩 — 렌더 수가 소스와 일치하는가(0==0도 응답↔화면 대조라 공허하지 않다) ──
        eq(`color-chip-count:${tag}`, m.changes.length, expChangeCount, `클래스 ${JSON.stringify(m.changes.map((c) => `${c.t}|${c.cls.replace('mono tnum ', '')}`))}`);
        // 색 자체 — 클래스는 붙었는데 CSS 규칙이 없으면 색만 조용히 사라진다(가토 ⑪).
        eq(`color-teeth:${tag}`, new Set([m.tokens.up, m.tokens.down, m.tokens.text]).size, 3,
          `--up/--down/--text 상이 ${JSON.stringify([m.tokens.up, m.tokens.down, m.tokens.text])}`);
        eq(`color-chip:${tag}`, m.changes.map((c) => c.color), m.changes.map((c) => (c.cls.includes('down') ? m.tokens.down : m.tokens.up)),
          `증감 칩 ${m.changes.length}개(실데이터는 change_pct가 전부 null이라 0 — 전역 color-chip-teeth가 이 축의 관측가능성을 증명한다)`);
        if (m.changes.length > 0) bump('color-chip-exercised', m.changes.length);
        bump('color-chip', m.changes.length + 3);

        // ══ 진척 타임라인 (세로 HTML 목록) ══
        // ① 전량 표시 — 폴드·생략 0. 렌더 항목 수 == 소스의 유효 milestones 수.
        eq(`tl-domain:${tag}`, srcLay.items.length >= 5 ? 'OK' : `MILESTONE_DOMAIN_TOO_SMALL(${srcLay.items.length})`, 'OK',
          `소스 raw ${(SRC.milestones || []).length}건 → 유효 ${srcLay.items.length}건 · 연도 ${srcLay.years.length}그룹`);
        eq(`tl-items:${tag}`, m.tlItems.length, srcLay.items.length, '폴드·"+N개" 없이 전량 표시');
        // ② 이벤트 문장이 API 원문과 **완전일치**(잘림 0) — 순서까지
        eq(`tl-events-exact:${tag}`, m.tlItems.map((i) => i.event), srcLay.items.map((i) => i.event),
          `최장 ${Math.max(0, ...srcLay.items.map((i) => i.event.length))}자`);
        eq(`tl-no-ellipsis:${tag}`, m.tlItems.filter((i) => /…|\+\d+\s*개/.test(i.event)).map((i) => i.event.slice(0, 24)), [],
          '말줄임·"+N개" 폴드 흔적 0');
        // ③ actor(선택 필드) — null인 건은 렌더되지 않아야 한다
        eq(`tl-actors:${tag}`, m.tlItems.map((i) => i.actor), srcLay.items.map((i) => i.actor),
          `actor 있는 항목 ${srcLay.items.filter((i) => i.actor).length}/${srcLay.items.length}`);
        // ④ 연도 헤더 = 유일 연도 오름차순(픽스처는 일부러 역순 입력이라 정렬 미적용을 이 축이 잡는다)
        eq(`tl-years:${tag}`, m.tlYears, srcLay.years.map(String), `그룹 ${m.tlLists ? m.tlLists.groups : 'n/a'}개`);
        eq(`tl-years-asc:${tag}`, m.tlYears.map(Number).every((y, i, a) => i === 0 || y > a[i - 1]) ? 'OK' : `NOT_ASCENDING(${JSON.stringify(m.tlYears)})`, 'OK');
        eq(`tl-item-years:${tag}`, m.tlItems.map((i) => i.year), srcLay.items.map((i) => String(i.year)), 'data-year가 항목별로 정확한가');
        bump('tl-content', m.tlItems.length * 3 + 4);

        // ⑤ ★ 이번 결함(설계폭 > 가시폭)을 직접 재는 축 — 컴포넌트와 모든 자손의 가로 자기 넘침 0
        eq(`tl-self-overflow-domain:${tag}`, m.tlBox && m.tlBox.clientW > 0 ? 'OK' : `TIMELINE_BOX_MISSING(${JSON.stringify(m.tlBox)})`, 'OK',
          `타임라인 박스 ${m.tlBox ? `${m.tlBox.scrollW}/${m.tlBox.clientW}` : 'n/a'}`);
        eq(`tl-self-overflow:${tag}`, m.tlSelfOverflow ?? 'TIMELINE_MISSING', [],
          `.sr-only 제외(설계상 width:1px) — 제외 표본 ${m.srCount}개`);
        bump('tl-self-overflow', 2);

        // ⑥ 상태 마커 — data-status ↔ 클래스 접미사 ↔ 색 토큰
        const wantCls = m.tlItems.map((i) => `mstone__marker mstone__marker--${i.status}`);
        eq(`tl-status-classes:${tag}`, m.tlItems.map((i) => i.markerCls), wantCls, `상태 ${JSON.stringify([...new Set(m.tlItems.map((i) => i.status))])}`);
        eq(`tl-status-domain:${tag}`, [...new Set(m.tlItems.map((i) => i.status))].sort(), [...new Set(srcLay.items.map((i) => i.status))].sort(),
          '렌더된 상태 집합 == 소스 상태 집합');
        // 이빨 — 세 의미 토큰이 서로 달라야 이 축이 무언가를 구별한다(가토 ⑪).
        eq(`tl-marker-color-teeth:${tag}`, new Set([m.tokens.success, m.tokens.warn, m.tokens.text3]).size, 3,
          `success/warn/text-3 상이 ${JSON.stringify([m.tokens.success, m.tokens.warn, m.tokens.text3])}`);
        const wantBorder = { done: m.tokens.success, in_progress: m.tokens.warn, planned: m.tokens.text3 };
        eq(`tl-marker-color:${tag}`, m.tlItems.map((i) => i.borderColor), m.tlItems.map((i) => wantBorder[i.status] ?? 'UNKNOWN_STATUS'),
          '의미 토큰(success/warn/neutral) — 가격 방향 --up/--down 교차 사용 금지');
        // 채움까지 본다 — planned는 기본 규칙과 값이 같아 borderColor만으로는 규칙 부재를 구별 못 한다.
        // done(단색 success)·in_progress(그라디언트)가 이 축의 이빨이다.
        const fillOf = (i) => (i.bgImage === 'gradient' ? 'gradient' : (i.bgColor === m.tokens.success ? 'solid-success' : (i.bgColor === m.tokens.bg ? 'solid-bg' : `other(${i.bgColor})`)));
        const wantFill = { done: 'solid-success', in_progress: 'gradient', planned: 'solid-bg' };
        eq(`tl-marker-fill:${tag}`, m.tlItems.map(fillOf), m.tlItems.map((i) => wantFill[i.status] ?? 'UNKNOWN_STATUS'));
        bump('tl-marker', m.tlItems.length * 3 + 2);

        // ⑦ 범례 — 렌더된 상태만, STATUSES 순서로
        eq(`tl-legend:${tag}`, m.tlLegend, srcLay.legend.map((s) => STATUS_LABEL[s]), `상태 ${JSON.stringify(srcLay.legend)}`);
        bump('tl-legend');

        // ⑧ 시맨틱 — role="img" 0(SVG 판의 원자화 함정), 리스트 role 존재, 마커 aria-hidden, sr-only 상태
        eq(`tl-role-img:${tag}`, m.tlRoleImg, 0, 'SVG role="img"는 자손을 접근성 트리에서 감춘다 — 세 블록 전체에서 0이어야 한다');
        eq(`tl-list-roles:${tag}`, m.tlLists, { ol: 1, ul: srcLay.years.length, groups: srcLay.years.length }, '연도 그룹마다 ul.mstone__events');
        eq(`tl-marker-aria:${tag}`, m.tlItems.filter((i) => i.markerAria !== 'true').map((i) => i.status), [], '마커는 장식 — 전부 aria-hidden');
        eq(`tl-sr-status:${tag}`, m.tlItems.map((i) => i.sr), srcLay.items.map((i) => STATUS_LABEL[i.status]), '상태는 sr-only 텍스트로 전달');
        bump('tl-semantics', m.tlItems.length * 2 + 2);

        // task#301 S2 — 「계보 분류」 자체 섹션의 그룹·조인 검증(cat-domain·cat-join-domain·
        // cat-mirror-domain·cat-groups·cat-total)은 그 섹션이 삭제되며 함께 제거했다 — 검증 대상이던
        // CategoryGroups.jsx가 없다. m.tableNames·m.catGroups(항상 [])는 이제 죽은 계측값이다.

        // ══ 넘침 3계열 (정의역 = 세 신규 블록 안) ══
        // 두 계열의 domain sentinel은 **합산**으로 건다. clip/vclip 계열만 따로 `>0`을 요구하면, 이
        // 설계에 그런 클리퍼가 실제로 없을 때 정상 구현이 영원히 red가 된다 — 그건 "표본이 사라진
        // 측정 실패"가 아니라 실행 전에 결정되는 축의 정의역이다(가토 ⑧ⓛ). 대신 계열별 실측 수를
        // 커버리지·원시로그에 그대로 실어 어느 계열이 공허했는지를 읽는 사람이 즉시 알 수 있게 한다.
        eq(`overflow-domain:${tag}`, m.leaves.length >= 20 ? 'OK' : `OVERFLOW_DOMAIN_TOO_SMALL(leaf=${m.leaves.length},clip=${m.clippers.length},vclip=${m.vclippers.length})`, 'OK',
          `텍스트 leaf ${m.leaves.length} · overflow-x:hidden ${m.clippers.length} · overflow-y:hidden ${m.vclippers.length}`);
        eq(`overflow-leaf:${tag}`, m.leaves.filter((e) => e.scrollW > e.clientW + 1).map((e) => `${e.t}(${e.scrollW}>${e.clientW})`), []);
        eq(`overflow-clip:${tag}`, m.clippers.filter((e) => e.scrollW > e.clientW + 1).map((e) => `${e.tag}:${e.t}(${e.scrollW}>${e.clientW})`), []);
        // 세로 잘림 — "넘치지 않는 잘림"(가토 ⑦). 가로 축은 원리적으로 못 본다.
        eq(`overflow-vert:${tag}`, m.vclippers.filter((e) => e.scrollH > e.clientH + 1).map((e) => `${e.tag}:${e.t}(${e.scrollH}>${e.clientH})`), []);
        // sr-only 제외가 다른 표본까지 삼키지 않았는가 — 제외 규모 == 타임라인 항목 수여야 한다.
        eq(`overflow-sronly-teeth:${tag}`, m.srCount, m.tlItems.length, '.sr-only 제외 표본은 마일스톤 상태 텍스트뿐(다른 요소를 삼키지 않았다)');
        bump('overflow-leaf', m.leaves.length + 1);
        bump('overflow-clip', m.clippers.length + 1);
        bump('overflow-vert', m.vclippers.length + 2);

        // ══ 1줄이 설계 의도인 자리 ══
        // ① 섹션 제목 — 짧은 라벨이라 어느 폭에서도 1줄.
        // (② 계보 그룹 라벨 축은 task#301 S2에서 그 섹션과 함께 제거 — m.catLabelLines는 이제 항상 [].)
        eq(`line-title-domain:${tag}`, m.titles.length >= 4 ? 'OK' : `TITLE_DOMAIN_TOO_SMALL(${m.titles.length})`, 'OK', `섹션 제목 ${m.titles.length}개`);
        eq(`line-title:${tag}`, m.titles.filter((t) => t.lines !== 1).map((t) => `${t.t}=${t.lines}줄`), []);
        bump('line-title', m.titles.length + 1);

        // ③ 핵심 포인트 칩 label/값 1줄 — **주입 모드에서만** 단언한다(축의 정의역, 조건부 스킵 아님).
        //    근거: task#225가 못박은 불변식은 *그 태스크의 픽스처 길이*에서 "label을 1줄에 유지"였다.
        //    실데이터의 metrics는 편집 산문(`Falcon 9 단일 부스터 최다` 등)이라 350px 트랙(≈139px)에서
        //    자연 줄바꿈하며, 그건 잘림이 아니라 **손실 0의 접힘**이다(아래 real 실측을 원시로그에 그대로
        //    싣는다 — 숨기지 않는다). 잘림·은폐는 overflow 3계열이 실데이터에서도 무조건 단언한다.
        if (R.mode === 'inject') {
          eq(`chip-oneline-domain:${tag}`, m.chipLines.length, srcKp.reduce((s, p) => s + (Array.isArray(p.metrics) ? p.metrics.length : 0), 0) * 2,
            `칩 label/값 ${m.chipLines.length}개`);
          eq(`chip-oneline:${tag}`, m.chipLines.filter((c) => c.lines !== 1).map((c) => `${c.kind}:${c.t}=${c.lines}줄`), []);
          // 이빨 — 두 분기(≤3칩 / 4칩)가 모두 관측돼야 열수 불변식이 무언가를 구별한다.
          eq(`chip-cols-teeth:${tag}`,
            m.grids.some((g) => g.chips >= 4) && m.grids.some((g) => g.chips <= 3) ? 'OK' : `BRANCH_MISSING(${JSON.stringify(m.grids.map((g) => g.chips))})`, 'OK');
          bump('chip-oneline', m.chipLines.length + 2);
        }

        // ══ 섹션 간 간격 — 리터럴이 아니라 "형제 섹션과 같은가" ══
        eq(`gap-domain:${tag}`, m.gaps.length, m.chainKeys.length - 1, `연쇄 ${JSON.stringify(m.chainKeys)}`);
        eq(`gap-uniform:${tag}`, [...new Set(m.gaps.map((g) => g.px))].length, 1,
          `실측 ${m.gaps.map((g) => `${g.from}→${g.to}=${g.px}px`).join(' · ')}`);
        bump('gap', m.gaps.length + 1);

        // 전역 이빨용 수집
        if (m.tlBox) geomWidths.add(m.tlBox.clientW);
        if (R.mode === 'real') realEventSig[R.slug] = m.tlItems.map((i) => i.event).join('¶');

        rawLog.push(`${tag} · 타임라인 ${m.tlItems.length}항목/${m.tlYears.length}연도 · 박스 ${m.tlBox.scrollW}/${m.tlBox.clientW}` +
          ` · 최장문장 ${Math.max(0, ...m.tlItems.map((i) => i.event.length))}자 · 가로넘침 ${m.tlSelfOverflow.length}건` +
          ` · 그리드 ${JSON.stringify(m.grids.map((g) => `${g.chips}칩→${g.cols}열(${g.trackW}px)`))}` +
          ` · 칩줄수 ${JSON.stringify(m.chipLines.reduce((a, c) => { a[c.lines] = (a[c.lines] || 0) + 1; return a; }, {}))}` +
          (R.mode === 'real' && m.chipLines.some((c) => c.lines !== 1)
            ? ` [real 접힘(단언 아님·관측): ${m.chipLines.filter((c) => c.lines !== 1).map((c) => `${c.kind}:${c.t}=${c.lines}`).join(', ')}]` : '') +
          ` · 계보 ${m.catGroups.length}그룹/${m.catGroups.reduce((s, g) => s + g.chips.length, 0)}칩` +
          ` · leaf ${m.leaves.length}/clip ${m.clippers.length}/vclip ${m.vclippers.length} · 간격 ${JSON.stringify(m.gaps.map((g) => g.px))}`);
      }

      // ── 공통: 본문 가로 스크롤 · 콘솔 ──
      eq(`body-no-hscroll:${tag}`, m.docScrollW <= m.docClientW ? 'OK' : `HSCROLL(${m.docScrollW}>${m.docClientW})`, 'OK',
        `doc ${m.docScrollW}/${m.docClientW} · vw ${m.vw}`);
      eq(`console:${tag}`, errs, []);
      bump('body-no-hscroll');
      bump('console');

      // ── 육안 캡처 (캡처 전 scrollIntoView — 프레임 밖이면 육안 확인이 무의미하다) ──
      await page.screenshot({ path: `${OUT}/${V.key}-${R.mode}-${R.slug}-top.png`, fullPage: false });
      if (R.mode !== 'bare') {
        for (const [name, sel] of [['keypoints', '[data-testid="tech-key-points"]'], ['timeline', '[data-testid="milestone-timeline"]']]) {
          const loc = page.locator(sel).first();
          if (await loc.count()) {
            await loc.scrollIntoViewIfNeeded().catch(() => {});
            await page.waitForTimeout(200);
            await page.screenshot({ path: `${OUT}/${V.key}-${R.mode}-${R.slug}-${name}.png`, fullPage: false });
          } else {
            // 캡처 스킵을 조용히 넘기지 않는다(육안 확인이 통째로 사라지는 자리다). 렌더 여부 자체는
            // 위 section-present가 이미 무조건 단언하므로 여기서 또 단언하지는 않는다.
            console.log(`  ⚠ 캡처 스킵 ${V.key}-${R.mode}-${R.slug}-${name}.png — 섹션 미렌더(section-present가 FAIL로 보고 중)`);
          }
        }
      }
      await page.screenshot({ path: `${OUT}/${V.key}-${R.mode}-${R.slug}-full.png`, fullPage: true });
    } catch (e) {
      P(false, `exception:${tag}`, `FAIL — ${String(e).slice(0, 300)}`);
    }
    await page.close();
  }
  await ctx.close();
}
await browser.close();

// ── 전역 이빨 단언 ────────────────────────────────────────────────────────────
// ① 기하 축이 정말 서로 다른 제약 아래에서 돌았는가. 전 조합이 같은 폭이었다면 "가로 넘침 0"은
//    한 가지 폭에서만 확인된 것이고, 이번 결함(좁은 폭에서 설계폭 초과)에 원리적으로 블라인드다.
eq('geom-teeth', geomWidths.size >= 2 ? 'OK' : `SINGLE_WIDTH(${[...geomWidths].join(',')})`, 'OK',
  `타임라인 가시폭 실측 ${JSON.stringify([...geomWidths].sort((a, b) => a - b))}px`);
// ② 두 실데이터 슬러그가 서로 다른 내용을 렌더했는가 — 같다면 내용 축이 상수를 비교한 것이다.
eq('content-teeth', new Set(Object.values(realEventSig)).size, Object.keys(realEventSig).length,
  `real 슬러그 ${Object.keys(realEventSig).join(',')} — 이벤트 문장 시그니처 상이`);
// ③ 증감 칩 색 축이 한 번이라도 실제 표본을 봤는가(실데이터는 change_pct가 전부 null이다).
eq('color-chip-teeth', (cov['color-chip-exercised'] || 0) > 0 ? 'OK' : 'NO_CHANGE_CHIP_EVER_RENDERED', 'OK',
  `증감 칩이 실제로 렌더된 표본 ${cov['color-chip-exercised'] || 0}개(주입 픽스처가 공급)`);

// ── 보고 ──────────────────────────────────────────────────────────────────────
const fails = results.filter((r) => !r.ok);
console.log('\n' + '═'.repeat(76));
console.log('커버리지 (계열별 검사 수 — 재실행 간 비교용, 줄면 통과가 아니라 측정 실패):');
for (const [k, v] of Object.entries(cov).sort()) console.log(`  ${k.padEnd(26)} ${v}`);
console.log(`  ${'(합계)'.padEnd(26)} ${Object.values(cov).reduce((a, b) => a + b, 0)}`);
console.log(`\n단언 총계: ${results.length}건 · PASS ${results.length - fails.length} · FAIL ${fails.length}`);
console.log(`뷰 ${VIEWS.length}조합 × (주입 1 + bare 1 + 실데이터 ${SLUGS.length}) = ${VIEWS.length * (2 + SLUGS.length)} 페이지`);
console.log('\n원시 실측(단언 아님 — 조합별):');
for (const l of rawLog) console.log(`  ${l}`);
console.log('\n※ (a)inject·(c)bare는 **실발행 아님 — page.route 주입 응답**이다. prod tech_reports 쓰기 0, GET도 가로채졌다.');
console.log('※ (b)real은 주입 0 · 라이브 실데이터 GET만.');
if (CONTROL) console.log(`⚠ 이 실행은 대조군이다(CONTROL=${CONTROL}) — 해당 축 FAIL이 정상이며 게이트 결과가 아니다.`);
console.log(`※ 육안 캡처 ${OUT}/`);
console.log('═'.repeat(76));
fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ control: CONTROL || null, cov, results }, null, 2));
if (fails.length) {
  console.log('\nFAIL 상세:');
  for (const f of fails) console.log(`  ✗ ${f.tag}\n      ${f.msg}`);
  process.exit(1);
}
console.log(`\nALL PASS ${results.length}/${results.length}`);
for (const r of results) console.log(`  ✓ ${r.tag} — ${r.msg}`);
