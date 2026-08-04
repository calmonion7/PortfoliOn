// task#282 S8 라이브 UAT — 선도기술 리포트 상세의 구조 전환 3레인을 잰다.
//   레인 A: 「시장 규모」 삼중 중복 제거(요약 카드·CAGR 배지·캡션 출처 join 제거)
//   레인 B: 산문 전 섹션 접힘 시작 + 관계도 접근성(role="img" 제거 → sr-only 전수 노출)
//   레인 C: market.estimates[] 기관별 추정 편차 막대(신규 additive 필드)
//
// 두 모드를 **같은 루프**로 돈다:
//   (real)   주입 0 — 라이브 실데이터 GET만. 레인 A·B(산문)와 구데이터 graceful(ⓔ)을 잰다.
//   (inject) page.route로 `market.estimates` + `related`를 얹은 응답을 fulfill.
//            ★ 실발행 아님 — prod tech_reports는 GET조차 이 경로로 가지 않는다(라우트가 가로챈다). 쓰기 0.
//            레인 C 막대와 관계도 접근성(ⓒ)이 여기서만 측정된다(아래 정의역 참조).
//
// ⚠️ SW가 /api/*를 가로채므로 컨텍스트는 **serviceWorkers:'block'** 필수(안 하면 page.route가 무음 no-op).
//
// ── 응답 봉투·필드명은 추정하지 않았다. 착수 시 1콜 실측(2026-08-04) ─────────────────────────
//   GET /api/tech-reports/{slug} → { slug, reports:[ { id, slug, published_date, title, description,
//     difficulty:{score,rationale}, players:[…], challenges:[], related:{prerequisites,derivatives,
//     complements,competitors}, market:{as_of,cagr_pct,forecast,history,share_basis},
//     sources:[{title,url}], created_at, key_points:[…], milestones:[…] } ] }
//   실측 요지 —
//     smr             : market.as_of='2026-03 (Precedence Research)' · cagr_pct=8.78 · history 1점(2025 $7.49B)
//                       · forecast 2점(2026 $8.16B · 2035 $17.37B) · estimates **키 없음** · sources 21건
//                       · related 4키 모두 [] · challenges 0 · 대괄호 헤딩 4개 + rationale 545자
//     reusable-rocket : as_of='2026-07 (Fortune Business Insights, 2026-07-13 갱신)' · cagr_pct=12.97
//                       · history 1점(2025 $8.44B) · forecast 2점(2026 $12.09B · 2034 $32.08B)
//                       · estimates **키 없음** · sources 29건 · related 4키 모두 [] · challenges 0
//                       · 대괄호 헤딩 4개 + rationale 559자
//   ★ 세 사실이 이 프로브의 축 설계를 지배한다 —
//     ① `as_of`는 날짜가 아니라 **자유 서술 문자열**이고 기관명을 품는다(`… (Fortune Business Insights, …)`).
//        그 기관명은 **출처 제목의 접두어와 같다**. 그래서 「출처 제목 0건」 축은 반드시 **전체 제목**으로
//        대조해야 한다 — 기관명·단어 조각으로 세면 정당한 as_of가 거짓 FAIL한다(실측 최소 제목 길이 35·61자).
//     ② rr의 출처 제목 1번에 `CAGR 12.97%`가 들어 있고 description에도 `CAGR`이 1회 있다. 그래서
//        「CAGR ≤2회」는 **문서 전체가 아니라 KPI 스트립 + 시장 규모 섹션**으로 범위를 좁혀야 성립한다
//        (전역으로 세면 정상 구현이 4회로 읽힌다 — 판정 범위를 좁히라는 규율의 실사례).
//     ③ 두 판 모두 `related` 4키가 빈 배열이고 `estimates` 키가 없다 → ⓒ·ⓓ는 **실데이터 정의역 밖**이고
//        inject 모드가 그 축의 유일한 정의역이다(무음 스킵이 아니라 데이터로 실행 전에 결정되는 정의역).
//
// ── 계획 지시에서의 이탈 1건(가토 ⑥ 역산 — 지시가 완료기준을 실제로 달성하는지 대조) ────────────
//   계획 S8ⓐ는 「캡션이 **1줄**(Set(top) 실측)」을 지시했다. 착수 시 산술로 대조하니 **그 지시를 전
//   뷰포트에 걸면 정당한 발행이 FAIL한다**:
//     · 기대 캡션(위 실응답에서 유도) — smr 75자 / reusable-rocket 99자
//       rr: `$8.4B (2025) → $32.1B (2034), CAGR 12.97% · 기준 2026-07 (Fortune Business Insights, 2026-07-13 갱신)`
//     · 가용 폭 — PC 1440: 본문 780 − 페이지패딩 32 − chartbox(border 2 + padding 36) = **710px**
//                 m390: 358 − 38 = **320px** · m350: 318 − 38 = **280px**  (`.chartbox` pc.css:224-229, `.sub` 12px)
//     · 99자 캡션의 1줄 필요폭은 320·280px을 **원리적으로** 넘는다 → 모바일 2~3줄이 정상이고,
//       그걸 FAIL로 만들면 유일한 "수정"은 **한국어 자유 서술(as_of)을 자르는 것**인데 그건 가토 ⑬이
//       금지한다(ellipsis는 문자열 끝을 먹어 기관명·갱신일부터 사라진다).
//   → 지시를 **정의역으로 좁혀** 산다: `caption-lines`는 폭 1000px 이상(PC)에서만 게이트하고,
//     모바일은 줄 수를 **실측 출력**한다(게이트 아님). 대신 전 뷰포트에서 무조건 게이트하는 것은
//     ⓐ 캡션 텍스트 **정확일치**(중복·출처 join이 살아 있으면 여기서 죽는다) ⓑ 잘림 0 ⓒ 본문 가로스크롤 0.
//     캡션의 **1줄 필요폭 실측**(nowrap 클론)을 항상 출력해 "왜 2줄인가"가 추정이 아니라 수치로 남게 한다.
//
// ── 판정 규율 ────────────────────────────────────────────────────────────────────────────
//  · 조건부 단언(`if (조건) assert`) 금지 — 전부 무조건 단언하고 미검출을 sentinel 기대값으로 FAIL시켜
//    총계를 구조적으로 고정한다. 재실행 간 총계가 줄면 통과가 아니라 측정 실패다.
//    ※ mode(real/inject)·뷰포트는 **실행 전에 결정되는 축의 정의역**이지 조건부 스킵이 아니다(가토 ⑧ⓛ).
//      해당 분기마다 이유를 주석으로 명시한다.
//  · 축마다 `*-domain` sentinel — `eq(tag, 위반목록, [])` 꼴은 정의역이 비면 공허하게 통과한다.
//    sentinel은 **정확일치가 아니라 하한 + 실측 출력**으로 짠다(정당한 구조 변경에 거짓 FAIL하지 않게).
//  · 리터럴 금지 — 기대값은 전부 실응답/픽스처에서 **유도**한다(캡션 문자열·막대 폭·노드 수·접힘 수).
//  · 판정 범위는 본문 컨테이너(`main.page-wrap .page|.m-page` → 리드의 부모)로 한정하고, CAGR·출처 축은
//    다시 **시장 규모 섹션 블록**으로 좁힌다(전역 마스트헤드·산문·출처 섹션이 섞이면 정상 구현이 거짓 FAIL).
//  · identity를 판정축보다 **먼저** 둔다 — 판정축이 대상과 독립이면 404·다른 슬러그 위에서도 통과한다.
//  · 진짜 줄 수 = **서로 다른 top 개수**. `range.getClientRects().length`는 텍스트 노드마다 rect가
//    나오므로 줄 수가 아니다(task#275에서 22건 거짓 FAIL).
//  · 세로 잘림(line-clamp·max-height) 축은 **두지 않았다** — 이 4표면(캡션·막대·산문 details·관계도)에
//    그 메커니즘이 하나도 없음을 소스 직독으로 확인했고, 유일한 `overflowY:hidden`은 관계도 가로
//    스크롤러의 세로 스크롤바 억제라 클리핑이 아니다(높이 auto). 그 수(`vclipCount`)는 **출력해** 이
//    주장이 검증 가능하게 남긴다 — 단언하면 스크롤바 산술로 거짓 FAIL할 수 있다.
//
// ── 대조군(기본 꺼짐) — 0건 축이 이빨을 가졌는지 실증. 게이트 아님 ────────────────────────────
//   CONTROL=capclip   : 캡션을 nowrap+80px로 → `caption-clip`이 FAIL해야 정상.
//   CONTROL=srctitle  : 캡션에 **실제 출처 제목 1건**을 덧붙임 → `market-no-src-titles`·`caption-exact` FAIL.
//   CONTROL=proseopen : 산문 details를 전부 open → `prose-open`이 FAIL해야 정상.
//   CONTROL=estbar    : 막대 폭을 전부 100%로 → `est-bar-pct`·`est-bar-monotonic`이 FAIL해야 정상.
//   CONTROL=roleimg   : 관계도 svg에 role="img"를 되돌림 → `graph-role-img`·`graph-svg-aria` FAIL.
//   ⚠️ 주입이 조용히 no-op하지 않았는지는 **측정값 이동**으로 먼저 확인한다(원시 실측 로그에 실린다).
//      인라인 스타일을 이기려면 `!important`가 필요하다.
import { chromium, devices } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat282';
fs.mkdirSync(OUT, { recursive: true });

console.log('(real)   주입 0 — 라이브 실데이터 GET만(무쓰기).');
console.log('(inject) **실발행 아님 · page.route 주입 응답** — market.estimates + related를 얹는다. prod tech_reports 쓰기 0, GET도 가로채졌다.');

const results = [];
const P = (ok, tag, msg) => results.push({ ok, tag, msg });
const cov = {};
const bump = (k, n = 1) => { cov[k] = (cov[k] || 0) + n; };
const eq = (tag, got, want, note = '') => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  P(ok, tag, `${ok ? 'PASS' : 'FAIL'} — got=${JSON.stringify(got)} want=${JSON.stringify(want)}${note ? ' · ' + note : ''}`);
};
// 정보성 로그(단언 아님) — "정의역이 실행 전에 결정돼 이 판에는 축이 없다"처럼 FAIL로 만들면 안 되는 사실 전용.
const NOTE = (msg) => console.log(`  ℹ ${msg}`);
// 조합별 원시 수치. 개별 PASS 메시지는 FAIL이 하나라도 있으면 안 찍히므로 따로 모아 **무조건** 출력한다.
const rawLog = [];

// ── 대조군 ────────────────────────────────────────────────────────────────────
const CONTROL = process.env.CONTROL || '';
const CONTROL_CSS = {
  capclip: '[data-testid="market-growth-caption"]{white-space:nowrap !important;overflow:hidden !important;max-width:80px !important;display:block !important}',
  estbar: '[data-testid="market-estimate-bar"]{width:100% !important}',
};
const CONTROL_DOM = {
  // 캡션에 실제 출처 제목을 덧붙인다 — S3이 제거한 "출처 join" 상태의 최소 재현.
  srctitle: (title) => {
    const c = document.querySelector('[data-testid="market-growth-caption"]');
    if (c) c.textContent = `${c.textContent} · 출처 ${title}`;
  },
  proseopen: () => document.querySelectorAll('[data-testid="tech-report-prose"] details').forEach((d) => { d.open = true; }),
  roleimg: () => {
    const s = document.querySelector('[data-testid="tech-graph-svg"]');
    if (s) { s.setAttribute('role', 'img'); s.removeAttribute('aria-hidden'); }
  },
};
if (CONTROL && !CONTROL_CSS[CONTROL] && !CONTROL_DOM[CONTROL]) {
  console.error(`CONTROL=${CONTROL} 미지원(${[...Object.keys(CONTROL_CSS), ...Object.keys(CONTROL_DOM)].join('|')}). 종료.`);
  process.exit(1);
}
if (CONTROL) console.log(`⚠ 대조군 실행 — CONTROL=${CONTROL}: 해당 축이 FAIL해야 정상(게이트 결과 아님).`);

// ── 로그인 (추정 폴백 없음 — 실패 시 즉시 exit) ────────────────────────────────
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const { access_token, refresh_token } = await login.json();
if (!access_token) { console.error('로그인 실패 — access_token 없음. 종료.'); process.exit(1); }

// TECH_NAMES 미러 — frontend/src/components/reports/techReportUtils.js(백엔드는 표시명을 응답에 싣지
// 않는다, ADR-0033 결정 2). h1 identity 단언의 기대값 소스이므로 슬러그가 없으면 즉시 exit(추정 금지).
const TECH_NAMES = { 'reusable-rocket': '재사용 로켓', 'solid-state-battery': '전고체 배터리', smr: 'SMR', robotics: '로봇' };
const SLUGS = ['smr', 'reusable-rocket'];

// ── 소스 직독 미러(순수함수) — 기대값을 리터럴로 박지 않기 위한 것 ────────────────────────────
// techReportUtils.js: formatMarketSize / splitSeries / formatMarketSummary
const UNIT_LABEL = { USD: { mn: 'M', bn: 'B', tn: 'T' }, KRW: { mn: '백만원', bn: '십억원', tn: '조원' } };
const fmtSize = (s) => {
  if (!s || typeof s.value !== 'number' || !Number.isFinite(s.value)) return null;
  const label = (UNIT_LABEL[s.currency] || {})[s.unit];
  if (!label) return null;
  const v = Math.round(s.value * 10) / 10;
  return s.currency === 'USD' ? `$${v}${label}` : `${v}${label}`;
};
const splitSeries = (m) => {
  const sortByYear = (a) => (Array.isArray(a) ? [...a].sort((x, y) => x.year - y.year) : []);
  return { history: sortByYear(m && m.history), forecast: sortByYear(m && m.forecast) };
};
const fmtSummary = (m) => {
  const { history, forecast } = splitSeries(m);
  const cur = history[history.length - 1] ?? null;
  const fin = forecast[forecast.length - 1] ?? null;
  const part = (p) => { const amt = fmtSize(p.size); return amt ? `${amt} (${p.year})` : null; };
  const curTxt = cur ? part(cur) : null;
  const finTxt = fin ? part(fin) : null;
  if (!curTxt && !finTxt) return null;
  const cagrTxt = m && m.cagr_pct != null ? `, CAGR ${m.cagr_pct}%` : '';
  return curTxt && finTxt ? `${curTxt} → ${finTxt}${cagrTxt}` : `${curTxt ?? finTxt}${cagrTxt}`;
};
// MarketGrowthChart.jsx S3 판 직독 — captionParts = [요약?, `기준 {as_of}`?].join(' · ')
const expectedCaption = (m) => {
  const parts = [];
  const s = fmtSummary(m);
  if (s) parts.push(s);
  if (m && m.as_of) parts.push(`기준 ${m.as_of}`);
  return parts.join(' · ');
};
// MarketEstimates.jsx: marketEstimatesLayout 직독(값 내림차순 · min<=0 또는 1건이면 배수 문구 생략)
const estLayout = (estimates) => {
  const rows = (Array.isArray(estimates) ? estimates : [])
    .filter((e) => e && e.size && Number.isFinite(e.size.value) && e.size.value >= 0)
    .sort((a, b) => b.size.value - a.size.value);
  if (rows.length === 0) return { rows, year: null, max: 0, multiplierTxt: null };
  const max = rows[0].size.value;
  const min = rows[rows.length - 1].size.value;
  return {
    rows, year: rows[0].year, max,
    multiplierTxt: rows.length > 1 && min > 0 ? `${(max / min).toFixed(1)}배` : null,
  };
};
const estCaptionOf = (lay) => `기관별 ${lay.year}년 추정${lay.multiplierTxt ? ` · 최대·최소 ${lay.multiplierTxt}` : ''}`;
// techReportUtils.js: parseDescriptionSections 규칙 — "그 줄 전체가 [..]"인 줄만 헤딩
const bracketHeadings = (t) => (typeof t === 'string' ? t.split('\n') : []).filter((l) => /^\[[^\]]+\]$/.test(l.trim())).length;
// TechGraph.jsx: capColumn(MAX_PER_COL=5) — 5 초과면 앞 4개 + "+N개" 폴드 1칸
const MAX_PER_COL = 5;
const nodeCountOf = (list) => (list.length <= MAX_PER_COL ? list.length : MAX_PER_COL);

// ── 실응답 수집 + 기대값 계산 ─────────────────────────────────────────────────
const RELATED_KEYS = ['prerequisites', 'derivatives', 'complements', 'competitors'];
const DATA = {};
for (const slug of SLUGS) {
  const res = await fetch(`${BASE}/api/tech-reports/${slug}`, { headers: { Authorization: `Bearer ${access_token}` } });
  const body = await res.json();
  const rep = (body.reports || [])[0];
  if (!rep) { console.error(`발행물 없음 — /api/tech-reports/${slug} reports[0] 부재. 종료.`); process.exit(1); }
  if (!TECH_NAMES[slug]) { console.error(`TECH_NAMES 미러에 ${slug} 없음(기대값 소스 부재). 종료.`); process.exit(1); }
  if (!rep.title) { console.error(`${slug}: title 부재 — lead identity 기대값을 만들 수 없다. 종료.`); process.exit(1); }
  const rationale = ((rep.difficulty || {}).rationale || '').trim();
  const srcTitles = (rep.sources || []).map((s) => s && s.title).filter((t) => typeof t === 'string' && t.trim() !== '');
  DATA[slug] = {
    rep,
    techName: TECH_NAMES[slug],
    title: rep.title,
    players: rep.players || [],
    srcTitles,
    // 산문 접힘 축의 기대값 — 소제목 섹션 수 + (난이도 근거 있으면 1)
    titledItems: bracketHeadings(rep.description) + (rationale ? 1 : 0),
    rationale,
    // 손실 0 대조용 — 헤딩 줄은 <summary>로 승격되며 대괄호가 벗겨지므로 대상에서 뺀다.
    proseLines: (rep.description || '').split('\n').map((l) => l.trim()).filter((l) => l !== '' && !/^\[[^\]]+\]$/.test(l)),
  };
  const m = rep.market || {};
  console.log(`  [실응답] ${slug}: title ${rep.title.length}자 · players ${DATA[slug].players.length}` +
    ` · market 키 ${JSON.stringify(Object.keys(m).sort())}` +
    ` · cagr ${m.cagr_pct} · as_of ${JSON.stringify(m.as_of)}` +
    ` · estimates ${JSON.stringify(m.estimates)}` +
    ` · sources ${srcTitles.length}건(최단 ${Math.min(...srcTitles.map((t) => t.length))}자)` +
    ` · related ${JSON.stringify(RELATED_KEYS.map((k) => (Array.isArray((rep.related || {})[k]) ? (rep.related || {})[k].length : 'KEY_MISSING')))}` +
    ` · 소제목항목 ${DATA[slug].titledItems} · 기대캡션 ${expectedCaption(m).length}자`);
  console.log(`             기대캡션 = ${JSON.stringify(expectedCaption(m))}`);
}

// ── inject 픽스처 (자립 — 라이브에서 상속하지 않는다) ─────────────────────────────
// ★ 픽스처를 라이브에서 파생하면 그건 픽스처가 아니라 드리프트하는 스냅샷이다(task#281 실사례).
//   판정 대상인 두 필드(market.estimates · related)는 **전부 픽스처가 소유**한다. market의 나머지
//   (history/forecast/as_of/cagr)는 실데이터를 그대로 둔다 — 캡션 기대값이 real과 **동일**해야
//   "estimates 추가가 캡션을 건드리지 않는다"까지 같은 축으로 증명된다.
//
// 값 설계(리터럴이 아니라 목표에서 역산): max 17 / min 5 → (17/5).toFixed(1) = '3.4' → 캡션 `3.4배`.
//   · year·currency·unit은 배열 내 전부 동일(서버 model_validator가 422로 강제하는 계약과 같은 형태)
//   · is_basis는 **최대값이 아닌 2번째**에 둔다 — 마커가 데이터를 따라가는지 위치를 따라가는지 갈린다
//   · scope는 있는 것/없는 것을 섞는다(있으면 `기관 · scope`, 없으면 기관명만 — 빈 노드가 남지 않는가)
//   · 기관명에 실재 기관을 쓴다: as_of가 이미 기관명을 품고 출처 제목도 기관명으로 시작하므로
//     「출처 제목 0건」 축이 **조각이 아니라 전체 제목**으로 대조해야 함을 이 픽스처가 그대로 자극한다.
//   · ★ 입력을 **일부러 값 순서가 아니게 섞어** 둔다. 정렬된 픽스처를 주면 `est-values`가 정렬 배선을
//     통째로 지워도 통과한다(공허한 초록) — uat280의 band-order-teeth와 같은 함정이다.
//     아래 `est-sort-teeth`가 "입력 순서 ≠ 렌더 순서"를 실제로 확인한다.
const EST_YEAR = 2030;
const EST = [
  { institution: 'Fortune Business Insights', year: EST_YEAR, size: { value: 12.5, currency: 'USD', unit: 'bn' }, is_basis: true },
  { institution: 'IDTechEx', year: EST_YEAR, size: { value: 5.0, currency: 'USD', unit: 'bn' } },
  { institution: 'Precedence Research', year: EST_YEAR, size: { value: 17.0, currency: 'USD', unit: 'bn' }, scope: '노형 전체' },
  { institution: 'SNS Insider', year: EST_YEAR, size: { value: 7.2, currency: 'USD', unit: 'bn' } },
  { institution: 'Mordor Intelligence', year: EST_YEAR, size: { value: 9.0, currency: 'USD', unit: 'bn' }, scope: '신규 착공분만 집계' },
];
// prerequisites는 **6개** — MAX_PER_COL(5)을 넘겨 "+2개" 폴드를 자극한다. sr-only 목록은 캡하지
// 않으므로(전수 노출이 S5의 목표) 폴드로 SVG에서 사라진 2개가 텍스트에 남는지가 이 픽스처의 존재 이유다.
const REL = {
  prerequisites: ['고온 합금', '피복입자 연료', '헬륨 순환기', '디지털 I&C', '모듈 제작 공정', '규제 표준화'],
  derivatives: ['수소 생산', '해수 담수화', '산업 공정열'],
  complements: ['소형 터빈', '축열 저장'],
  competitors: ['대형 경수로', '가스 복합'],
};
const injectedRep = (slug) => {
  const rep = DATA[slug].rep;
  return { ...rep, market: { ...(rep.market || {}), estimates: EST }, related: REL };
};
{
  const lay = estLayout(EST);
  console.log(`  [주입 픽스처] estimates ${EST.length}건 · 기대 캡션 ${JSON.stringify(estCaptionOf(lay))}` +
    ` · 값 ${JSON.stringify(lay.rows.map((e) => fmtSize(e.size)))} · 기준마커 ${EST.filter((e) => e.is_basis === true).length}개` +
    ` · related ${JSON.stringify(RELATED_KEYS.map((k) => REL[k].length))} → SVG 노드 ${nodeCountOf(REL.prerequisites) + 1 + nodeCountOf(REL.derivatives)}개` +
    ` · 폴드로 SVG에서 접히는 라벨 ${REL.prerequisites.length - (MAX_PER_COL - 1)}개`);
}

// ── 브라우저 안 측정기 ────────────────────────────────────────────────────────
// 범위: ResearchShell이 PC는 `.page`, 모바일은 `.m-page`로 children만 감싼다(소스 확인) — 그 안쪽을
// 루트로 잡아야 모바일 seg 탭바·마스트헤드가 표본에 섞이지 않는다(uat276/280/281에서 확정한 관용구).
const ROOT_SEL = 'main.page-wrap .page, main.page-wrap .m-page';

const measure = (page) => page.evaluate((ROOT_SEL) => {
  const root = document.querySelector(ROOT_SEL);
  if (!root) return { found: false, why: 'ROOT_MISSING' };
  const leadEl = root.querySelector('[data-testid="tech-report-lead"]');
  if (!leadEl) return { found: false, why: 'LEAD_MISSING' };
  const container = leadEl.parentElement;   // TechReport 본문 컨테이너(maxWidth 780)

  const cs = (el) => getComputedStyle(el);
  const txt = (el) => (el ? el.textContent.trim() : '');
  // .sr-only는 `width:1px;overflow:hidden`이 **메커니즘 자체**라 잘림 축의 정의역 밖이다(의도된 은폐).
  // 자손까지 제외해야 한다 — ul.sr-only 안의 li는 클래스를 갖지 않으므로 closest로 판정한다.
  const isSR = (el) => !!(el.closest && el.closest('.sr-only'));
  // display:none(닫힌 details 본문 등)은 rect가 0개 — 보이지 않는 것을 잘림 축의 표본으로 세면
  // 커버리지가 부풀고 실제로는 아무것도 안 본 것이 된다.
  const shown = (el) => el.getClientRects().length > 0;
  // 진짜 줄 수 = 서로 다른 top 개수(rect 개수가 아니다 — 텍스트 노드마다 rect가 나온다).
  const lineCount = (el) => {
    const r = document.createRange(); r.selectNodeContents(el);
    return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size || 1;
  };
  // 1줄 필요폭 실측 — 부모에 붙여 폰트를 상속시킨 nowrap 클론의 폭. "왜 2줄인가"를 수치로 남긴다
  // (기준 상자를 추정하지 말라는 규율의 적용 — 가용폭·필요폭 둘 다 실측한다).
  const nowrapW = (el) => {
    const c = el.cloneNode(true);
    Object.assign(c.style, { position: 'absolute', left: '-9999px', top: '0', visibility: 'hidden', whiteSpace: 'nowrap', width: 'auto', maxWidth: 'none' });
    el.parentElement.appendChild(c);
    const w = Math.round(c.getBoundingClientRect().width);
    c.remove();
    return w;
  };
  const titleTextOf = (el) => { const t = el.querySelector('.rpt-title__text'); return t ? t.textContent.trim() : null; };

  // ── 시장 규모 섹션 블록 ──
  // TechReport.jsx는 이 절의 SectionTitle을 **컨테이너 직속 자식**으로 두고(래퍼 없음) 차트·추정치
  // 블록을 형제로 잇는다. 다음 절(연관 기술·상세 설명)은 자기 SectionTitle을 래퍼 안에 품으므로,
  // "`.rpt-title`을 포함하는 형제를 만나면 멈춘다"가 절 경계가 된다.
  const marketTitle = [...container.children].find((c) => c.classList.contains('rpt-title') && titleTextOf(c) === '시장 규모') || null;
  const marketBlocks = [];
  if (marketTitle) {
    for (let e = marketTitle.nextElementSibling; e; e = e.nextElementSibling) {
      if (e.classList.contains('rpt-title') || e.querySelector('.rpt-title')) break;
      marketBlocks.push(e);
    }
  }
  const marketEls = marketTitle ? [marketTitle, ...marketBlocks] : [];
  const marketText = marketEls.map((e) => e.textContent).join('\n');

  // ── 캡션 ──
  const capEls = [...root.querySelectorAll('[data-testid="market-growth-caption"]')];
  const capEl = capEls[0] || null;
  const caption = capEl ? {
    text: txt(capEl),
    lines: lineCount(capEl),
    scrollW: capEl.scrollWidth, clientW: capEl.clientWidth,
    needW: nowrapW(capEl),
    h: Math.round(capEl.getBoundingClientRect().height),
    inMarket: marketEls.some((e) => e.contains(capEl)),
  } : null;

  // ── 기관별 추정 편차 막대 ──
  const estEl = root.querySelector('[data-testid="market-estimates"]');
  const estRows = estEl ? [...estEl.querySelectorAll('[data-testid="market-estimate-row"]')].map((r) => {
    const labelEl = r.children[0] || null;
    const barEl = r.querySelector('[data-testid="market-estimate-bar"]');
    const trackEl = barEl ? barEl.parentElement : null;
    const valEl = [...r.children].find((c) => c.classList && c.classList.contains('mono')) || null;
    const markerEl = r.querySelector('[data-testid="market-estimate-basis-marker"]');
    const rb = r.getBoundingClientRect();
    return {
      label: txt(labelEl),
      labelLines: labelEl ? lineCount(labelEl) : 0,
      labelClipped: labelEl ? labelEl.scrollWidth > labelEl.clientWidth + 1 : false,
      val: txt(valEl),
      valLines: valEl ? lineCount(valEl) : 0,
      valClipped: valEl ? valEl.scrollWidth > valEl.clientWidth + 1 : false,
      // 인라인 style의 % 문자열(구현이 계산한 값)과 실제 렌더 px를 **둘 다** 잡는다.
      barPct: barEl ? parseFloat(barEl.style.width) : null,
      barW: barEl ? Math.round(barEl.getBoundingClientRect().width * 100) / 100 : null,
      trackW: trackEl ? Math.round(trackEl.getBoundingClientRect().width) : null,
      marker: !!markerEl,
      markerClipped: markerEl ? markerEl.scrollWidth > markerEl.clientWidth + 1 : false,
      right: Math.round(rb.right),
    };
  }) : null;
  const estCaption = estEl ? txt(estEl.querySelector('[data-testid="market-estimates-caption"]')) : null;

  // ── 관계도 ──
  const graphEl = root.querySelector('[data-testid="tech-graph"]');
  const svgEl = root.querySelector('[data-testid="tech-graph-svg"]');
  const srListEl = graphEl ? graphEl.querySelector('[data-testid="tech-graph-sr-list"]') : null;
  const graph = graphEl ? {
    roleImg: graphEl.querySelectorAll('[role="img"]').length,
    svgCount: graphEl.querySelectorAll('[data-testid="tech-graph-svg"]').length,
    svgAria: svgEl ? svgEl.getAttribute('aria-hidden') : 'SVG_MISSING',
    svgAriaLabel: svgEl ? svgEl.getAttribute('aria-label') : null,
    nodes: [...graphEl.querySelectorAll('[data-testid="tech-graph-node"]')].map((g) => ({
      id: g.getAttribute('data-node-id'), col: g.getAttribute('data-col'),
      text: txt(g.querySelector('text')), title: txt(g.querySelector('title')),
    })),
    srPresent: !!srListEl,
    // 잎 li만(그룹 li는 중첩 ul을 자식으로 가진다) → 문서 순서로 전제·대상·파생
    srLabels: srListEl ? [...srListEl.querySelectorAll('li')].filter((li) => li.children.length === 0).map((li) => txt(li)) : [],
    complements: graphEl.querySelector('[data-testid="tech-graph-complements"]') ? 1 : 0,
    competitors: graphEl.querySelector('[data-testid="tech-graph-competitors"]') ? 1 : 0,
  } : null;

  // ── 산문 ──
  const proseEl = root.querySelector('[data-testid="tech-report-prose"]');
  const detailsEls = proseEl ? [...proseEl.querySelectorAll('details')] : [];
  const prose = {
    found: !!proseEl,
    total: detailsEls.length,
    open: detailsEls.filter((d) => d.open).length,
    plain: proseEl ? proseEl.querySelectorAll('[data-testid="tech-prose-plain"]').length : 0,
    // 닫힌 details의 본문도 DOM에 남는다(네이티브 접기) — 손실 0 대조는 이 문자열로 한다.
    allText: proseEl ? proseEl.textContent : '',
  };

  // ── 잘림 2계열 (정의역 = 본문 컨테이너 전체) ──
  const LEAF_SEL = 'span, div, p, a, li, button, summary, td, th, h1, h2, h3';
  const allLeaves = [...container.querySelectorAll(LEAF_SEL)].filter((e) => e.children.length === 0 && txt(e).length > 0);
  const leaves = allLeaves.filter((e) => !isSR(e) && shown(e)).map((e) => {
    const s = cs(e);
    return {
      t: txt(e).slice(0, 32), scrollW: e.scrollWidth, clientW: e.clientWidth,
      // 설계상 ellipsis가 지정된 요소는 "잘리는 것이 정상"이라 이 축의 정의역 밖이다(uat280 관용구).
      // 그 대신 줄면 안 되는 형제(값·배지)가 온전한지는 est-shrink-discipline이 잰다.
      ell: s.textOverflow === 'ellipsis' && s.overflow !== 'visible',
    };
  });
  // ② 잘라내는 주체가 **부모**인 경우 — 자식이 nowrap이면 자식의 scrollWidth==clientWidth라 leaf 축이
  //    전부 통과한다(task#275 실측). overflow-x:hidden 컨테이너를 별도 계열로 잰다.
  const clippers = [...container.querySelectorAll('*')]
    .filter((e) => cs(e).overflowX === 'hidden' && txt(e).length > 0 && !isSR(e) && shown(e))
    .map((e) => ({ t: txt(e).slice(0, 32), tag: e.tagName.toLowerCase(), scrollW: e.scrollWidth, clientW: e.clientWidth, ell: cs(e).textOverflow === 'ellipsis' }));
  // 세로 클리퍼 수 — **단언하지 않고 출력만** 한다(헤더 주석의 근거). 가로 스크롤러의 세로 hidden은
  // 스크롤바 억제이지 클리핑이 아니므로 제외한다.
  const vclipCount = [...container.querySelectorAll('*')]
    .filter((e) => ['hidden', 'clip'].includes(cs(e).overflowY) && !['auto', 'scroll'].includes(cs(e).overflowX) && txt(e).length > 0 && !isSR(e) && shown(e)).length;
  // .sr-only 제외가 **다른 표본까지 삼키지 않았는가** — 제외 규모를 총계 하나로 보면 알 수 없으므로
  // 소유자별로 쪼갠다. 이 페이지의 정당한 소유자는 둘뿐이다: 관계도 sr 목록(S5 신규)과
  // MilestoneTimeline의 항목별 상태 텍스트(task#281, 라이브 17~18건). 그 밖은 UNKNOWN으로 드러난다.
  const srLeaves = allLeaves.filter((e) => isSR(e));
  const srOwners = {};
  for (const e of srLeaves) {
    const own = e.closest('[data-testid="tech-graph-sr-list"]') ? 'graph-sr-list'
      : e.closest('[data-testid="milestone-timeline"]') ? 'milestone-timeline'
        : `UNKNOWN:${e.closest('[data-testid]') ? e.closest('[data-testid]').getAttribute('data-testid') : e.tagName.toLowerCase()}`;
    srOwners[own] = (srOwners[own] || 0) + 1;
  }
  const srExcluded = srLeaves.length;
  // role="img" 소유자 내역 — 본문에는 **정당한** role="img"가 이미 있다(TechLevelBand.jsx:33의 행별
  // 막대 SVG). 그래서 "본문 전체 0"은 정상 구현을 거짓 FAIL시킨다 → 게이트는 관계도로 좁히고,
  // 전역 내역은 출력해 형제 표면의 회귀가 눈에 보이게 남긴다(출력은 넓게, 단언은 목표에만).
  const roleImgOwners = {};
  for (const e of root.querySelectorAll('[role="img"]')) {
    const host = e.closest('[data-testid]');
    const own = host ? host.getAttribute('data-testid') : e.tagName.toLowerCase();
    roleImgOwners[own] = (roleImgOwners[own] || 0) + 1;
  }
  const marketLeaves = marketEls.flatMap((b) => [...b.querySelectorAll(LEAF_SEL)])
    .filter((e) => e.children.length === 0 && txt(e).length > 0 && !isSR(e) && shown(e)).length;

  const kpiEl = root.querySelector('[data-testid="tech-report-kpis"]');
  const countOf = (s, needle) => s.split(needle).length - 1;
  const cr = container.getBoundingClientRect();

  return {
    found: true,
    marketTitleFound: !!marketTitle,
    marketBlocks: marketBlocks.length,
    marketText,
    marketChartInSection: marketEls.some((e) => e.querySelector('[data-testid="market-growth-chart"]')),
    marketEmptyState: !!root.querySelector('[data-testid="market-growth-empty"]'),
    marketEstInSection: marketEls.some((e) => e.querySelector('[data-testid="market-estimates"]')),
    summaryCards: root.querySelectorAll('[data-testid="tech-report-market-summary"]').length,
    cagrBadges: root.querySelectorAll('[data-testid="market-growth-cagr"]').length,
    capCount: capEls.length, caption,
    cagrInMarket: countOf(marketText, 'CAGR'),
    cagrInKpi: kpiEl ? countOf(kpiEl.textContent, 'CAGR') : 'KPI_MISSING',
    cagrInContainer: countOf(container.textContent, 'CAGR'),
    estPresent: !!estEl, estRows, estCaption,
    graphPresent: !!graphEl, graph,
    rootRoleImg: root.querySelectorAll('[role="img"]').length,
    roleImgOwners,
    graphRoleImgAnywhere: root.querySelectorAll('[data-testid="tech-graph"] [role="img"]').length,
    prose,
    bodyDetailsOpen: container.querySelectorAll('details[open]').length,
    leaves, clippers, vclipCount, srExcluded, srOwners, marketLeaves,
    h1Text: txt(root.querySelector('h1')) || null,
    leadText: txt(leadEl) || null,
    containerRight: Math.round(cr.right),
    docScrollW: document.documentElement.scrollWidth,
    docClientW: document.documentElement.clientWidth,
    vw: window.innerWidth, vh: window.innerHeight,
  };
}, ROOT_SEL);

// ── 실행 ──────────────────────────────────────────────────────────────────────
// 3뷰포트 = 1440 / 390(iPhone 13 디바이스 프로필) / 350(가장 좁은 폭에 다크를 물려 최악 조합 포함).
const VIEWS = [
  { key: 'pc1440-light', theme: 'light', pc: true, opts: { viewport: { width: 1440, height: 1000 } } },
  { key: 'm390-light', theme: 'light', pc: false, opts: { ...devices['iPhone 13'] } },
  { key: 'm350-dark', theme: 'dark', pc: false, opts: { viewport: { width: 350, height: 700 } } },
];

const capWidths = new Set();       // 전역 이빨 — 기하 축이 서로 다른 제약 아래에서 돌았는가
const capTexts = {};               // 전역 이빨 — 두 슬러그가 서로 다른 캡션을 렌더했는가
const browser = await chromium.launch();

for (const V of VIEWS) {
  // SW가 /api/*를 가로채면 page.route 주입이 조용히 no-op한다 → serviceWorkers:'block' 필수.
  const ctx = await browser.newContext({ ...V.opts, serviceWorkers: 'block' });
  // PWA 설치 배너는 앱 전역 프로모라 이 페이지의 레이아웃이 아니다 — 닫힌(정상) 상태로 고정한다.
  // 키·형식은 frontend/src/utils/pwa.js 직독(SUPPRESS_KEY='pwa-install-dismissed-at', String(Date.now())).
  await ctx.addInitScript(([a, r, th]) => {
    localStorage.setItem('access_token', a);
    localStorage.setItem('refresh_token', r);
    localStorage.setItem('theme', th);
    localStorage.setItem('pwa-install-dismissed-at', String(Date.now()));
  }, [access_token, refresh_token, V.theme]);

  const RUNS = SLUGS.flatMap((slug) => [
    { mode: 'real', slug, rep: DATA[slug].rep },
    { mode: 'inject', slug, rep: injectedRep(slug) },
  ]);

  for (const R of RUNS) {
    const tag = `${V.key}/${R.mode}:${R.slug}`;
    const D = DATA[R.slug];
    const SRC = R.rep;                                  // 이 실행의 **기대값 소스**(주입이면 픽스처, real이면 실응답)
    const srcMarket = SRC.market || {};
    const wantCaption = expectedCaption(srcMarket);
    const srcEstLay = estLayout(srcMarket.estimates);
    const srcRelated = SRC.related || {};
    const relOf = (k) => (Array.isArray(srcRelated[k]) ? srcRelated[k].filter((v) => typeof v === 'string' && v.trim()) : []);
    const pre = relOf('prerequisites'), der = relOf('derivatives');
    const wantGraph = RELATED_KEYS.some((k) => relOf(k).length > 0);
    const wantEst = srcEstLay.rows.length > 0;

    const page = await ctx.newPage();
    const errs = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errs.push(msg.text()); });
    page.on('pageerror', (e) => errs.push(String(e)));

    let intercepted = 0;
    try {
      if (R.mode === 'inject') {
        await page.route(`**/api/tech-reports/${R.slug}`, async (route) => {
          intercepted += 1;
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ slug: R.slug, reports: [SRC] }) });
        });
      }

      await page.goto(`${BASE}/tech-report/${R.slug}`, { waitUntil: 'networkidle' }).catch((e) => errs.push(`goto:${e}`));
      await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0).catch(() => {});
      await page.waitForTimeout(1200);
      if (CONTROL && CONTROL_CSS[CONTROL]) { await page.addStyleTag({ content: CONTROL_CSS[CONTROL] }); await page.waitForTimeout(400); }
      if (CONTROL && CONTROL_DOM[CONTROL]) { await page.evaluate(CONTROL_DOM[CONTROL], D.srcTitles[0] || ''); await page.waitForTimeout(400); }

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
        await page.screenshot({ path: `${OUT}/${V.key}-${R.slug}-${R.mode}-fail.png`, fullPage: false });
        await page.close();
        continue;
      }

      // ── (1) identity — 판정축보다 **먼저**. 아래 축들은 대상과 독립이라 404·다른 슬러그 위에서도 통과한다.
      eq(`identity-h1:${tag}`, m.h1Text ?? 'H1_MISSING', D.techName, '기술명(TECH_NAMES 미러)');
      eq(`identity-lead:${tag}`, m.leadText ?? 'LEAD_MISSING', D.title, `리드 = API title(${D.title.length}자)`);
      eq(`identity-differ:${tag}`, new Set([D.techName, D.title]).size, 2, '이빨 — 기술명 ≠ 제목이어야 두 축이 서로 다른 것을 본다');
      bump('identity', 3);

      // 주입 모드는 라우트가 실제로 발동했는지 먼저 — 미발동이면 아래 전부가 "실데이터를 재는" 다른 실험이 된다.
      // (real은 주입이 없어 이 축의 정의역 밖이다 — 실행 전에 결정되는 분기이며 조건부 스킵이 아니다)
      if (R.mode === 'inject') {
        eq(`intercept:${tag}`, intercepted > 0 ? 'FIRED' : 'ROUTE_NOT_INTERCEPTED', 'FIRED', `호출 ${intercepted}회`);
        bump('intercept');
      }

      // ══ ⓐ 레인 A — 「시장 규모」 절의 삼중 중복 제거 ══════════════════════════════════
      // domain: 절 경계가 실제로 잡혔는가. 하한(블록 ≥1)이며 정확일치가 아니다 —
      // estimates 유무로 블록 수가 1↔2로 정당하게 변한다.
      eq(`market-domain:${tag}`,
        m.marketTitleFound && m.marketBlocks >= 1 && m.marketChartInSection
          ? 'OK' : `MARKET_SECTION_NOT_SCOPED(title=${m.marketTitleFound},blocks=${m.marketBlocks},chart=${m.marketChartInSection})`,
        'OK', `블록 ${m.marketBlocks}개 · 절 텍스트 ${m.marketText.length}자`);
      // 하한만 요구한다 — 캡션 1 + recharts 범례 2가 실측이지만 범례 DOM은 라이브러리 소관이라
      // 3을 하한으로 박으면 정상 구현이 recharts 변경에 거짓 FAIL한다. 캡션 존재는 아래 정확일치가 게이트한다.
      eq(`market-leaf-domain:${tag}`, m.marketLeaves >= 1 ? 'OK' : 'MARKET_LEAF_DOMAIN_EMPTY', 'OK',
        `절 안 텍스트 leaf ${m.marketLeaves}개`);
      eq(`market-summary-card-absent:${tag}`, m.summaryCards, 0, '요약 Card 제거(구조적 100% 중복)');
      // 빈 상태도 중복 2회였다(요약 카드 + 차트) → 이제 차트 하나만 소유한다. 기대값은 소스에서 유도 —
      // history·forecast가 둘 다 비면 빈 상태가 정상이고, 있으면 빈 상태가 떠서는 안 된다.
      {
        const ss = splitSeries(srcMarket);
        eq(`market-empty-state:${tag}`, m.marketEmptyState, ss.history.length === 0 && ss.forecast.length === 0,
          `history ${ss.history.length}점 · forecast ${ss.forecast.length}점`);
      }
      eq(`market-cagr-badge-absent:${tag}`, m.cagrBadges, 0, '별도 CAGR 배지 제거(요약 문자열이 이미 `, CAGR N%`로 끝난다)');
      eq(`market-caption-count:${tag}`, m.capCount, 1, '요약은 캡션 **하나로만** 존재한다');
      eq(`market-caption-in-section:${tag}`, m.caption ? m.caption.inMarket : 'CAPTION_MISSING', true);
      // ★ 이 절의 실제 게이트 — 캡션 텍스트 정확일치. 출처 join·중복 요약·배지 잔존이 전부 여기서 죽는다.
      eq(`market-caption-exact:${tag}`, m.caption ? m.caption.text : 'CAPTION_MISSING', wantCaption,
        `${wantCaption.length}자 · MarketGrowthChart 캡션식 미러(요약 · 기준 as_of)`);
      // 출처 제목 0건 — **전체 제목**으로 대조한다(as_of가 기관명을 품고 출처 제목도 기관명으로 시작하므로
      // 조각으로 세면 정당한 as_of가 거짓 FAIL한다). 제목 최단 길이를 이빨로 함께 못박는다.
      const srcMin = Math.min(...D.srcTitles.map((t) => t.length));
      eq(`market-src-domain:${tag}`,
        D.srcTitles.length >= 5 && srcMin >= 12 ? 'OK' : `SRC_DOMAIN_WEAK(n=${D.srcTitles.length},min=${srcMin})`, 'OK',
        `출처 ${D.srcTitles.length}건 · 최단 ${srcMin}자(짧은 제목은 부분일치로 거짓 검출을 낸다)`);
      eq(`market-no-src-titles:${tag}`, D.srcTitles.filter((t) => m.marketText.includes(t)).map((t) => t.slice(0, 28) + '…'), [],
        `대조 ${D.srcTitles.length}건 · 절 텍스트 ${m.marketText.length}자`);
      // CAGR 노출 ≤2회 — 범위를 KPI 스트립 + 시장 규모 절로 좁힌다. 기대값은 데이터에서 유도:
      // KPI 라벨 1 + (cagr_pct 있으면 캡션 1). 전역 수치는 출력만(산문·출처 제목의 CAGR은 정당하다).
      eq(`market-cagr-count:${tag}`, m.cagrInMarket, srcMarket.cagr_pct != null ? 1 : 0,
        `cagr_pct=${srcMarket.cagr_pct} · 절 안 'CAGR' 등장 수`);
      eq(`kpi-cagr-count:${tag}`, m.cagrInKpi, 1, 'KPI 스트립 라벨 1회');
      eq(`cagr-exposure:${tag}`,
        (typeof m.cagrInKpi === 'number' ? m.cagrInKpi : 99) + m.cagrInMarket, 1 + (srcMarket.cagr_pct != null ? 1 : 0),
        `KPI ${m.cagrInKpi} + 절 ${m.cagrInMarket} ≤ 2 · 컨테이너 전체 ${m.cagrInContainer}회(산문·출처 포함, 정당)`);
      // 잘림 0 — 전 뷰포트 무조건. 접힘은 손실 0이지만 잘림은 문자열 끝(기관명·갱신일)을 먹는다.
      eq(`caption-clip:${tag}`,
        m.caption && m.caption.scrollW <= m.caption.clientW + 1
          ? 'OK' : `CAPTION_CLIPPED(${m.caption && m.caption.scrollW}>${m.caption && m.caption.clientW})`, 'OK',
        `줄 ${m.caption && m.caption.lines} · 1줄 필요폭 ${m.caption && m.caption.needW}px / 가용 ${m.caption && m.caption.clientW}px · h=${m.caption && m.caption.h}px`);
      bump('market', 14);
      // 0건 축(`market-no-src-titles`)이 **몇 건을 실제로 대조했는지**를 커버리지에 싣는다 — 빈 배열끼리
      // 비교해 공허하게 통과하는 것과 21·29건을 대조하고 0건인 것은 이 숫자로만 구별된다.
      bump('market-src-compared', D.srcTitles.length);
      // 캡션 줄 수 — **PC에서만 게이트**(헤더 주석의 이탈 1건). 모바일은 정당한 접힘이라 실측 출력만 한다.
      // 이건 뷰포트로 실행 전에 결정되는 축의 정의역이며 무음 스킵이 아니다(가토 ⑧ⓛ).
      if (V.pc) {
        eq(`caption-lines:${tag}`, m.caption ? m.caption.lines : 'CAPTION_MISSING', 1,
          `1줄 필요폭 ${m.caption && m.caption.needW}px / 가용 ${m.caption && m.caption.clientW}px` +
          ` — FAIL이면 as_of·요약이 길어진 것이다. 자르지 말고(가토 ⑬) 캡션 폭·배치를 볼 것.`);
        bump('caption-lines');
      } else {
        NOTE(`${tag} — caption-lines 정의역 밖(모바일). 실측 ${m.caption && m.caption.lines}줄 ·` +
          ` 1줄 필요폭 ${m.caption && m.caption.needW}px > 가용 ${m.caption && m.caption.clientW}px라 접힘이 정상이다. 무음 스킵이 아니다.`);
      }
      if (m.caption) { capWidths.add(m.caption.clientW); capTexts[`${R.mode}:${R.slug}`] = m.caption.text; }

      // ══ ⓑ 산문 — 소제목 섹션이 **전부 접힌** 상태로 시작 ═════════════════════════════
      // domain: 접을 대상이 실제로 있는가(기대값은 응답에서 유도 — 대괄호 헤딩 + 난이도 근거).
      eq(`prose-domain:${tag}`, m.prose.found ? m.prose.total : 'PROSE_MISSING', D.titledItems,
        `소제목 ${D.titledItems}항목(대괄호 헤딩 + 난이도 근거) · plain ${m.prose.plain}개`);
      eq(`prose-open:${tag}`, m.prose.open, 0, '전 섹션 접힘 시작 — 상세 설명이 목차로 읽힌다');
      // 손실 0 — "접었다"와 "지웠다"는 접힘 개수만으로 구별되지 않는다(닫힌 본문도 DOM에 남는다).
      eq(`prose-lossless:${tag}`, D.proseLines.filter((l) => !m.prose.allText.includes(l)).map((l) => l.slice(0, 24) + '…'), [],
        `본문 ${D.proseLines.length}줄 대조 · 산문 DOM ${m.prose.allText.length}자`);
      eq(`prose-lossless-rationale:${tag}`, m.prose.allText.includes(D.rationale) ? 'OK' : 'RATIONALE_LOST', 'OK',
        `근거 ${D.rationale.length}자`);
      bump('prose', m.prose.total + 2);
      bump('prose-lossless', D.proseLines.length + 1);

      // ══ ⓔ 구데이터 graceful / ⓓ 레인 C 게이트 — 둘 다 SRC에서 유도해 **무조건** 단언 ══════════
      // real: estimates 키가 없으므로 섹션째 부재 / inject: 5건이므로 존재. 기대값이 데이터에서
      // 나오므로 조건부가 아니다(같은 단언이 두 방향을 모두 게이트한다).
      eq(`est-gate:${tag}`, m.estPresent, wantEst, `소스 estimates ${srcEstLay.rows.length}건`);
      eq(`est-gate-in-section:${tag}`, m.marketEstInSection, wantEst, '추정치는 시장 규모 절 안에 붙는다(별도 SectionTitle 없음)');
      eq(`graph-gate:${tag}`, m.graphPresent, wantGraph,
        `소스 related ${JSON.stringify(RELATED_KEYS.map((k) => relOf(k).length))}`);
      // 관계도의 role="img" 0건은 **두 모드 모두** 무조건 잰다(관계도가 없으면 0이 자명하게 참이지만,
      // 그래야 실데이터 판에서 회귀가 되살아나는 것도 이 축이 잡는다).
      // ⚠️ 본문 전체 0을 요구하면 안 된다 — TechLevelBand.jsx:33의 행별 막대 SVG가 **정당한**
      //    role="img"를 갖고 있어(업체가 있으면 항상 렌더) 정상 구현이 거짓 FAIL한다. 전역 내역은
      //    아래 원시 로그에 소유자별로 출력해 형제 표면의 회귀가 눈에 보이게 남긴다.
      eq(`graph-role-img-anywhere:${tag}`, m.graphRoleImgAnywhere, 0,
        `본문 전체 role="img" 내역 ${JSON.stringify(m.roleImgOwners)} — 관계도 소유분만 0을 요구한다`);
      bump('gate', 4);

      // ── ⓓ 레인 C 본체 · ⓒ 관계도 접근성 ─────────────────────────────────────────────
      // ⚠️ 이 두 축의 정의역은 **주입 모드**다: 라이브 두 판 모두 `market.estimates` 키가 없고
      //    `related` 4키가 빈 배열이라 실데이터에는 대상이 존재하지 않는다(착수 시 1콜로 재확인).
      //    데이터로 실행 전에 결정되는 축의 정의역이며 무음 스킵이 아니다 — 정의역 **안에서는**
      //    아래 전 단언이 무조건이고 미검출을 sentinel 기대값으로 FAIL시킨다.
      if (R.mode === 'inject') {
        // ── 기관별 추정 편차 ──
        eq(`est-domain:${tag}`, m.estRows ? m.estRows.length : 'EST_MISSING', srcEstLay.rows.length,
          `픽스처 ${srcEstLay.rows.length}건 → 막대 행 수`);
        const rows = m.estRows || [];
        // identity — 어떤 기관이 어떤 값으로 렌더됐는가. 숫자만 찍으면 "막대 5개 PASS"로 조용히 지나간다.
        const wantLabels = srcEstLay.rows.map((e) => (e.scope ? `${e.institution} · ${e.scope}` : e.institution));
        const wantVals = srcEstLay.rows.map((e) => fmtSize(e.size) ?? '—');
        // ⚠️ 기관 라벨은 **설계상 ellipsis**(줄어도 되는 것)라 좁은 폭에서 잘린다 → textContent는 온전하지만
        //    화면에는 일부만 보인다. 그래서 텍스트 일치는 DOM 기준으로 단언하고, 잘림 규모는 아래에서 출력한다.
        eq(`est-labels:${tag}`, rows.map((r) => r.label), wantLabels, 'scope 있으면 `기관 · scope`, 없으면 기관명만(빈 노드 0)');
        eq(`est-values:${tag}`, rows.map((r) => r.val), wantVals, 'formatMarketSize 미러 — 환산 0(ADR-0033 결정 3) · 순서는 값 내림차순');
        // 이빨 — 픽스처 입력 순서가 이미 정렬돼 있으면 위 두 축은 정렬 배선을 **통째로 지워도** 통과한다.
        // 입력을 일부러 섞어 두었고, 그 사실을 여기서 실측으로 못박는다(공허한 초록 차단).
        eq(`est-sort-teeth:${tag}`,
          JSON.stringify((srcMarket.estimates || []).map((e) => e.size.value)) !== JSON.stringify(srcEstLay.rows.map((e) => e.size.value))
            ? 'OK' : 'FIXTURE_ALREADY_SORTED', 'OK',
          `입력 ${JSON.stringify((srcMarket.estimates || []).map((e) => e.size.value))} → 렌더 ${JSON.stringify(srcEstLay.rows.map((e) => e.size.value))}`);
        // 폭 = value/max — 리터럴이 아니라 불변식. 인라인 %와 실제 렌더 px을 둘 다 본다.
        const wantPct = srcEstLay.rows.map((e) => (srcEstLay.max > 0 ? (e.size.value / srcEstLay.max) * 100 : 0));
        eq(`est-bar-pct:${tag}`, rows.map((r) => Math.round((r.barPct ?? -1) * 100)), wantPct.map((p) => Math.round(p * 100)),
          `트랙 ${JSON.stringify(rows.map((r) => r.trackW))}px · 막대 ${JSON.stringify(rows.map((r) => r.barW))}px`);
        // px 단조 감소 — 트랙이 0으로 붕괴하면(전부 0px) 여기서 죽는다. 리터럴 하한 없이 같은 결함을 잡는다.
        eq(`est-bar-monotonic:${tag}`,
          rows.slice(1).map((r, i) => (r.barW < rows[i].barW ? null : `${rows[i].val}(${rows[i].barW}px)→${r.val}(${r.barW}px)`)).filter(Boolean), [],
          `실측 px ${JSON.stringify(rows.map((r) => r.barW))}`);
        eq(`est-marker-count:${tag}`, rows.filter((r) => r.marker).length, srcEstLay.rows.filter((e) => e.is_basis === true).length,
          '기준 마커는 is_basis=true인 행에만');
        eq(`est-marker-position:${tag}`, rows.map((r) => r.marker), srcEstLay.rows.map((e) => e.is_basis === true),
          '마커가 데이터를 따라가는가(순위가 아니라) — 픽스처는 2번째 행에 둔다');
        eq(`est-caption:${tag}`, m.estCaption ?? 'EST_CAPTION_MISSING', estCaptionOf(srcEstLay),
          `max/min = ${srcEstLay.max}/${srcEstLay.rows[srcEstLay.rows.length - 1].size.value}`);
        // 라벨 1줄 — 기관 라벨·값 모두 nowrap이 설계다(접히면 행 높이가 배가 된다, 가토 ⑨).
        eq(`est-label-lines:${tag}`, rows.filter((r) => r.labelLines !== 1).map((r) => `${r.label}=${r.labelLines}줄`), []);
        eq(`est-value-lines:${tag}`, rows.filter((r) => r.valLines !== 1).map((r) => `${r.val}=${r.valLines}줄`), []);
        // ★ 줄면 안 되는 것이 살아남는가(가토 ⑦ 구현 짝) — 값·기준 마커는 flexShrink:0이라 절대 잘리지
        //   않아야 한다. 기관 라벨만 ellipsis 대상이다.
        eq(`est-shrink-discipline:${tag}`,
          rows.filter((r) => r.valClipped || r.markerClipped).map((r) => `${r.label}(val=${r.valClipped},marker=${r.markerClipped})`), [],
          `기관 라벨 잘림(설계상 허용) ${rows.filter((r) => r.labelClipped).length}/${rows.length}건`);
        // 행이 본문 폭을 넘지 않는가 — 넘치면 페이지가 가로로 밀린다(아래 body-no-hscroll의 국소 판).
        eq(`est-row-bbox:${tag}`, rows.filter((r) => r.right > m.containerRight + 1).map((r) => `${r.label}(right=${r.right}>${m.containerRight})`), []);
        bump('est', rows.length * 6 + 6);

        // ── 관계도 접근성(S5) ──
        const g = m.graph || {};
        eq(`graph-domain:${tag}`, m.graphPresent && g.svgCount === 1 ? 'OK' : `GRAPH_MISSING(present=${m.graphPresent},svg=${g.svgCount})`, 'OK',
          `노드 ${(g.nodes || []).length}개 · sr 목록 ${g.srPresent}`);
        eq(`graph-role-img:${tag}`, g.roleImg, 0, 'role="img"는 ARIA leaf role — 자손 <text>가 접근성 트리에서 통째 프루닝된다(가토 ⑭)');
        eq(`graph-svg-aria:${tag}`, g.svgAria, 'true', 'svg는 aria-hidden — 값은 sr-only 목록이 노출한다');
        eq(`graph-svg-no-label:${tag}`, g.svgAriaLabel, null, 'aria-label 한 줄로 대체하던 옛 구조가 남아 있지 않은가');
        // SVG는 열당 5개로 캡하지만 sr 목록은 캡하지 않는다 — 폴드로 접힌 초과분까지 **전수** 있어야 한다.
        const wantNodes = nodeCountOf(pre) + 1 + nodeCountOf(der);
        eq(`graph-node-cap:${tag}`, (g.nodes || []).length, wantNodes,
          `capColumn 미러(MAX_PER_COL=${MAX_PER_COL}) — 전제 ${pre.length}→${nodeCountOf(pre)} · 대상 1 · 파생 ${der.length}→${nodeCountOf(der)}`);
        const wantSr = [...pre, `대상: ${D.techName}`, ...der];
        eq(`graph-sr-labels:${tag}`, g.srLabels, wantSr, `전제 ${pre.length} + 대상 1 + 파생 ${der.length} = ${wantSr.length}건`);
        // 이빨 — 폴드가 실제로 일어난 판인가. 안 일어나면 「전수 노출」은 SVG와 같은 것만 세면서 통과한다.
        const foldedAway = pre.slice(MAX_PER_COL - 1);
        eq(`graph-fold-teeth:${tag}`, foldedAway.length > 0 ? 'OK' : `NO_FOLD(pre=${pre.length})`, 'OK',
          `SVG에서 접힌 라벨 ${JSON.stringify(foldedAway)} — 이것이 sr 목록에 있어야 S5의 목적이 성립한다`);
        eq(`graph-folded-in-sr:${tag}`, foldedAway.filter((l) => !g.srLabels.includes(l)), []);
        // 보완·경합 칩은 SVG 밖 진짜 DOM Badge라 접근성 프루닝과 무관하다(S5가 손대지 않은 부분) —
        // 그래도 함께 잰다: 관계도 섹션의 값 중 절반이 여기 있고, 기대값은 픽스처에서 유도된다.
        eq(`graph-chips:${tag}`, [g.complements, g.competitors],
          [relOf('complements').length > 0 ? 1 : 0, relOf('competitors').length > 0 ? 1 : 0],
          `보완 ${relOf('complements').length}개 · 경합 ${relOf('competitors').length}개`);
        bump('graph', (g.nodes || []).length + g.srLabels.length + 8);
      } else {
        NOTE(`${tag} — est/graph 본체 정의역 밖(실데이터: market.estimates 키 없음 · related 4키 전부 빈 배열). ` +
          `대상이 존재하지 않는 판이며 무음 스킵이 아니다. 두 축의 부재는 est-gate·graph-gate가 무조건 단언한다.`);
      }

      // ══ ⓕ 잘림 2계열 ════════════════════════════════════════════════════════════
      // 하한은 표 셀 수에서 유도(리터럴 아님) — 행당 최소 4셀. 늘면 정당, 줄면 측정 실패다.
      const leafDomain = m.leaves.filter((e) => !e.ell);
      const leafMin = D.players.length * 4;
      eq(`overflow-domain:${tag}`,
        leafDomain.length >= leafMin ? 'OK' : `LEAF_DOMAIN_TOO_SMALL(${leafDomain.length}<${leafMin})`, 'OK',
        `leaf ${leafDomain.length}건(ellipsis 제외 ${m.leaves.length - leafDomain.length}건) · overflow-x:hidden ${m.clippers.length}건` +
        ` · sr-only 제외 ${m.srExcluded}건 · overflow-y:hidden(단언 아님·출력만) ${m.vclipCount}건`);
      eq(`overflow-leaf:${tag}`, leafDomain.filter((e) => e.scrollW > e.clientW + 1).map((e) => `${e.t}(${e.scrollW}>${e.clientW})`), []);
      // 정의역 sentinel — clippers가 0이면 hardClip도 0이라 아래 축이 빈 배열끼리 비교돼 공허하게 통과한다.
      // 형제 프로브(uat276:489 · uat277:463 · uat280:698)의 clip-raw-applied와 동형이며, 이 파일 헤더가
      // 스스로 못박은 "축마다 *-domain sentinel" 규약이 이 한 축에만 빠져 있었다(적대적 리뷰 L3 포착).
      eq(`clip-raw-applied:${tag}`, m.clippers.length > 0 ? 'OK' : 'NO_OVERFLOW_HIDDEN_AT_ALL', 'OK',
        `overflow-x:hidden 컨테이너 ${m.clippers.length}건(0이면 스타일 자체가 안 걸린 것 — 잘림 축 ⓑ가 무의미해진다)`);
      const hardClip = m.clippers.filter((c) => !c.ell);
      eq(`overflow-clip:${tag}`, hardClip.filter((c) => c.scrollW > c.clientW + 1).map((c) => `${c.tag}:${c.t}(${c.scrollW}>${c.clientW})`), [],
        `ellipsis 아닌 클리퍼 ${hardClip.length}건 / overflow-x:hidden 총 ${m.clippers.length}건`);
      // sr-only 제외가 다른 표본까지 삼키지 않았는가 — 총계 하나로는 알 수 없으므로 소유자별로 본다.
      // ⚠️ 총계를 리터럴로 박으면 안 된다: MilestoneTimeline이 항목마다 상태 sr 텍스트를 내므로
      //    라이브 판(마일스톤 17~18건)에서 제외 규모가 데이터에 따라 정당하게 변한다. 그래서
      //    ⓐ 정당한 소유자 밖(UNKNOWN)이 0인가 ⓑ 관계도 소유분이 픽스처에서 유도한 수와 정확히 같은가
      //    두 축으로 쪼갠다(ⓑ만이 이 태스크가 새로 만든 표면이다).
      //    ⓐ에는 정의역 sentinel이 필요하다 — 제외 표본이 0이면 UNKNOWN 필터가 빈 배열끼리 비교돼
      //    공허하게 통과하고, 그 상태는 "MilestoneTimeline의 sr-only 마크업이 통째 회귀했다"와 구별되지
      //    않는다(적대적 리뷰 L3 포착). 하한을 리터럴로 박지 않고 존재만 요구한다 — 마일스톤 수는
      //    데이터에 따라 정당하게 변하므로(라이브 smr 17 · reusable-rocket 18) 실측치는 note로만 흘린다.
      eq(`sronly-domain:${tag}`, m.srExcluded > 0 ? 'OK' : 'SRONLY_DOMAIN_EMPTY(0)', 'OK',
        `제외 ${m.srExcluded}건 · 마일스톤 ${(D.milestones || []).length}건(항목당 상태 sr 텍스트 1개)`);
      eq(`overflow-sronly-owners:${tag}`, Object.keys(m.srOwners).filter((k) => k.startsWith('UNKNOWN')), [],
        `제외 ${m.srExcluded}건 내역 ${JSON.stringify(m.srOwners)}`);
      eq(`overflow-sronly-graph:${tag}`, m.srOwners['graph-sr-list'] || 0, R.mode === 'inject' ? pre.length + 1 + der.length : 0,
        '관계도 sr 목록의 잎 li 수(소스에서 유도)');
      bump('overflow-leaf', leafDomain.length + 1);
      bump('overflow-clip', hardClip.length + 1);

      // ── 공통: 본문 가로 스크롤 · 콘솔 ──
      eq(`body-no-hscroll:${tag}`, m.docScrollW <= m.docClientW + 1 ? 'OK' : `HSCROLL(${m.docScrollW}>${m.docClientW})`, 'OK',
        `doc ${m.docScrollW}/${m.docClientW} · vw ${m.vw} · 관계도는 자체 스크롤러에 담기므로 본문은 밀리지 않아야 한다`);
      eq(`console:${tag}`, errs, []);
      bump('body-no-hscroll');
      bump('console');

      rawLog.push(`${tag.padEnd(34)} 캡션 ${m.caption ? `${m.caption.lines}줄 need=${m.caption.needW}px/avail=${m.caption.clientW}px h=${m.caption.h}` : 'MISSING'}` +
        ` · CAGR kpi${m.cagrInKpi}/절${m.cagrInMarket}/전체${m.cagrInContainer}` +
        ` · 산문 ${m.prose.total}개(open ${m.prose.open}) · body details[open] ${m.bodyDetailsOpen}` +
        ` · est ${m.estPresent ? `${(m.estRows || []).length}행 트랙${JSON.stringify((m.estRows || []).map((r) => r.trackW))} 막대${JSON.stringify((m.estRows || []).map((r) => r.barW))} 라벨잘림${(m.estRows || []).filter((r) => r.labelClipped).length}` : '부재'}` +
        ` · graph ${m.graphPresent ? `노드${(m.graph.nodes || []).length}/sr${m.graph.srLabels.length}/roleImg${m.graph.roleImg}` : '부재'}` +
        ` · leaf ${m.leaves.length}(ell ${m.leaves.filter((e) => e.ell).length})/clip ${m.clippers.length}/vclip ${m.vclipCount}` +
        ` · sr제외 ${m.srExcluded}${JSON.stringify(m.srOwners)} · role=img ${m.rootRoleImg}${JSON.stringify(m.roleImgOwners)}` +
        ` · doc ${m.docScrollW}/${m.docClientW}`);

      // ── 육안 캡처 (캡처 전 scrollIntoView — 프레임 밖이면 육안 확인이 무의미하다) ──
      const shot = async (name, sel) => {
        if (sel) {
          const loc = page.locator(sel).first();
          if (await loc.count()) {
            await loc.scrollIntoViewIfNeeded().catch(() => {});
            await page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: 'center' }), sel).catch(() => {});
            await page.waitForTimeout(250);
          } else {
            // 캡처 스킵을 조용히 넘기지 않는다(육안 확인이 통째로 사라지는 자리다). 렌더 여부 자체는
            // 위 게이트 단언이 이미 무조건 판정하므로 여기서 또 단언하지는 않는다.
            console.log(`  ⚠ 캡처 대상 부재 ${V.key}-${R.slug}-${R.mode}-${name} (${sel})`);
            return;
          }
        }
        await page.screenshot({ path: `${OUT}/${V.key}-${R.slug}-${R.mode}-${name}.png`, fullPage: false });
      };
      if (R.mode === 'real') {
        // ★ 1차 육안 대상(2 slug × 3 뷰포트 = 6장) — 레인 A의 결과가 여기 있다.
        await shot('market', '[data-testid="market-growth-chart"]');
        await shot('prose', '[data-testid="tech-report-prose"]');
      } else {
        await shot('estimates', '[data-testid="market-estimates"]');
        await shot('graph', '[data-testid="tech-graph"]');
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${OUT}/${V.key}-${R.slug}-${R.mode}-full.png`, fullPage: true });
    } catch (e) {
      // 한 화면의 예외가 전체 실행을 죽이지 않게 sentinel로 흡수(끝까지 돈다).
      eq(`exception:${tag}`, `THROWN:${e && e.message}`, 'NO_EXCEPTION');
      bump('exception');
    }
    await page.close();
  }
  await ctx.close();
}
await browser.close();

// ── 전역 이빨 단언 ────────────────────────────────────────────────────────────
// ① 캡션 기하 축이 정말 서로 다른 제약 아래에서 돌았는가. 전 조합이 같은 폭이었다면 "잘림 0"은
//    한 가지 폭에서만 확인된 것이고, 좁은 폭 결함에 원리적으로 블라인드다.
eq('geom-teeth', capWidths.size >= 2 ? 'OK' : `SINGLE_WIDTH(${[...capWidths].join(',')})`, 'OK',
  `캡션 가용폭 실측 ${JSON.stringify([...capWidths].sort((a, b) => a - b))}px`);
// ② 두 슬러그가 서로 다른 캡션을 렌더했는가 — 같다면 캡션 정확일치 축은 상수를 비교한 것이다.
eq('content-teeth', new Set(Object.values(capTexts)).size >= SLUGS.length,
  true, `캡션 시그니처 ${Object.keys(capTexts).length}종 수집 · 고유 ${new Set(Object.values(capTexts)).size}종`);
// ③ 레인 C·관계도 축이 한 번이라도 실제 표본을 봤는가(실데이터엔 대상이 없다 — 주입이 유일한 정의역).
eq('est-teeth', (cov.est || 0) > 0 ? 'OK' : 'EST_NEVER_RENDERED', 'OK', `est 계열 검사 ${cov.est || 0}건`);
eq('graph-teeth', (cov.graph || 0) > 0 ? 'OK' : 'GRAPH_NEVER_RENDERED', 'OK', `graph 계열 검사 ${cov.graph || 0}건`);
// ④ CAGR 축이 실제로 "캡션에 1회 있는" 표본을 봤는가 — 전 표본이 cagr null이었다면 그 축은 0==0만 봤다.
eq('cagr-teeth', SLUGS.some((s) => (DATA[s].rep.market || {}).cagr_pct != null) ? 'OK' : 'ALL_CAGR_NULL', 'OK',
  `cagr_pct ${JSON.stringify(SLUGS.map((s) => (DATA[s].rep.market || {}).cagr_pct))}`);

// ── 보고 ──────────────────────────────────────────────────────────────────────
const fails = results.filter((r) => !r.ok);
console.log('\n' + '═'.repeat(78));
console.log('커버리지 (계열별 검사 수 — 재실행 간 비교용, 줄면 통과가 아니라 측정 실패):');
for (const [k, v] of Object.entries(cov).sort()) console.log(`  ${k.padEnd(26)} ${v}`);
console.log(`  ${'(합계)'.padEnd(26)} ${Object.values(cov).reduce((a, b) => a + b, 0)}`);
console.log(`\n단언 총계: ${results.length}건 · PASS ${results.length - fails.length} · FAIL ${fails.length}`);
console.log(`뷰 ${VIEWS.length}조합 × ${SLUGS.length} slug × 2모드(real+inject) = ${VIEWS.length * SLUGS.length * 2} 페이지`);
console.log('\n원시 실측(단언 아님 — 조합별):');
for (const l of rawLog) console.log(`  ${l}`);
console.log('\n※ (inject)는 **실발행 아님 — page.route 주입 응답**이다. prod tech_reports 쓰기 0, GET도 가로채졌다.');
console.log('※ (real)은 주입 0 · 라이브 실데이터 GET만.');
console.log('※ caption-lines는 PC(폭 1000+)에서만 게이트한다 — 모바일 접힘은 정당하며 실측 줄 수·1줄 필요폭을 위에 출력했다.');
console.log('※ 세로 잘림(line-clamp)은 이 4표면에 메커니즘이 없어 축을 두지 않았다 — vclip 실측 수를 출력해 그 주장을 검증 가능하게 남겼다.');
if (CONTROL) console.log(`⚠ 이 실행은 대조군이다(CONTROL=${CONTROL}) — 해당 축 FAIL이 정상이며 게이트 결과가 아니다.`);
console.log(`※ 육안 캡처 ${OUT}/ — {view}-{slug}-{real|inject}-{market|prose|estimates|graph|full}.png`);
console.log('═'.repeat(78));
fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ control: CONTROL || null, cov, results }, null, 2));
if (fails.length) {
  console.log('\nFAIL 상세:');
  for (const f of fails) console.log(`  ✗ ${f.tag}\n      ${f.msg}`);
  process.exit(1);
}
console.log(`\nALL PASS ${results.length}/${results.length}`);
for (const r of results) console.log(`  ✓ ${r.tag} — ${r.msg}`);
