// 주요기술 리포트(ADR-0033, task#276, 개명·저장모델 ADR-0038) 프론트 순수 헬퍼 —
// TechReports.jsx·TechReport.jsx가 쓰고, 2/2(task#277) 차트·관계도도 이 모듈에서 가져다 쓴다.
// formatMarketSize는 이름에 입력 단위를 지닌다(ADR-0031) — currency/unit을 그대로 표시하고 절대
// 환산하지 않는다(수주잔고 ×100 오저장 계열 단위함정 원천차단, ADR-0033 결정 3).

// 백엔드 TECH_TOPICS(services/tech_reports.py)의 표시명 미러 — 그 상수는 slug 검증에만 쓰이고
// API 응답에 노출되지 않는다(ADR-0033 결정 2). dual-source — slug를 늘리면 백엔드 TECH_TOPICS와
// 함께 갱신할 것(한쪽만 고치면 목록 카드 소제목이 slug 원문으로 뜬다).
export const TECH_NAMES = {
  'reusable-rocket': '재사용 로켓',
  'solid-state-battery': '전고체 배터리',
  smr: 'SMR',
  robotics: '로봇',
  'data-center': '데이터 센터',
}

// 기술 성숙 단계 공통 5단계 라벨(CONTEXT.md) — index = tech_level(1~5). 0번은 미사용(placeholder).
export const TECH_LEVEL_LABELS = ['', '기초연구', '시제품', '실증', '초기상용', '양산상용']

const UNIT_LABEL = {
  USD: { mn: 'M', bn: 'B', tn: 'T' },
  KRW: { mn: '백만원', bn: '십억원', tn: '조원' },
}

// {value, currency, unit} → 표시 문자열. currency/unit이 enum 밖이면(스키마 드리프트 방어) null —
// 렌더러는 이걸 받아 금액만 생략하고 나머지(성장 곡선·업체 표 등)는 그대로 보인다.
export function formatMarketSize(size) {
  if (!size || typeof size.value !== 'number' || !Number.isFinite(size.value)) return null
  const label = UNIT_LABEL[size.currency]?.[size.unit]
  if (!label) return null
  const v = Math.round(size.value * 10) / 10
  return size.currency === 'USD' ? `$${v}${label}` : `${v}${label}`
}

// market{history,forecast} → 연도순 정렬된 두 배열(실측/예상은 별개 배열, 한 배열에 섞지 않는다).
// 결측·비배열 입력은 빈 배열로 정규화.
export function splitSeries(market) {
  const sortByYear = (arr) => (Array.isArray(arr) ? [...arr].sort((a, b) => a.year - b.year) : [])
  return { history: sortByYear(market?.history), forecast: sortByYear(market?.forecast) }
}

// 텍스트 요약(이번 사이클 범위 — 성장 곡선 차트는 2/2 몫): "{현재} (연도) → {예상} (연도), CAGR N%"
export function formatMarketSummary(market) {
  const { history, forecast } = splitSeries(market)
  const current = history[history.length - 1] ?? null
  const final = forecast[forecast.length - 1] ?? null
  const partText = (p) => {
    const amt = formatMarketSize(p.size)
    return amt ? `${amt} (${p.year})` : null
  }
  const curTxt = current ? partText(current) : null
  const finTxt = final ? partText(final) : null
  if (!curTxt && !finTxt) return null
  const cagrTxt = market?.cagr_pct != null ? `, CAGR ${market.cagr_pct}%` : ''
  return curTxt && finTxt ? `${curTxt} → ${finTxt}${cagrTxt}` : `${curTxt ?? finTxt}${cagrTxt}`
}

// 결측 표시 — 애널리스트 리포트 관례. 추정하지 않는다(wrong < missing, ADR-0033 결정 3).
const DASH = '—'

// KPI 스트립 6칩(task#280 S2) → [{label, value}] 그대로 ui/Stat에 map 한다.
// 시장 규모는 formatMarketSize/splitSeries 재사용 — 새 환산을 만들지 않는다(ADR-0033 결정 3).
// 산문(description)에서 수치를 긁어오지 않는다(SMR 본문엔 CAGR 8.78%가 있지만 market.cagr_pct가
// null이므로 CAGR 칩은 —).
export function deriveTechKpis(report) {
  const players = Array.isArray(report?.players) ? report.players : []
  const market = report?.market
  const { history, forecast } = splitSeries(market)

  // 선두 = gap_years === 0(0은 유효값이다 — falsy로 흘리면 선두를 통째 놓친다).
  // leader_name은 "무엇 대비인지"를 나타내는 이름이지 판정 근거가 아니다.
  const leaders = players.filter((p) => p.gap_years === 0)
  const leaderTxt = leaders.length === 0
    ? DASH
    : leaders.length === 1 ? leaders[0].name : `${leaders[0].name} +${leaders.length - 1}`

  // 시장 규모 — 양측이면 `{현재} → {예상}`, **단측이면 연도를 붙인다**.
  // 백엔드 Market 모델은 history·forecast 둘 다 기본값 []이라 단측 발행이 유효한데, 연도 없이 금액만
  // 내면 2035년 전망치가 "지금 시장 규모"로 읽히고 같은 페이지 아래 시장 규모 섹션(`$17.4B (2035)`)과
  // 정면으로 모순된다. 연도 자체가 결측이면 금액만 — 연도를 만들어내지 않는다(wrong < missing).
  const curPt = history[history.length - 1]
  const finPt = forecast[forecast.length - 1]
  const cur = formatMarketSize(curPt?.size)
  const fin = formatMarketSize(finPt?.size)
  const withYear = (txt, pt) => (pt?.year != null ? `${txt} (${pt.year})` : txt)
  const sizeTxt = cur && fin
    ? `${cur} → ${fin}`
    : cur ? withYear(cur, curPt) : fin ? withYear(fin, finPt) : DASH

  const score = report?.difficulty?.score
  const cagr = market?.cagr_pct

  // text: true = 값이 수치가 아니라 **텍스트(회사명)**라는 표시. 소비처(TechKpiStrip)가 이 칩만
  // 일반 폰트로 렌더한다 — ui/Stat은 수치 프리미티브라 값에 monospace + tabular-nums를 강제하는데,
  // 회사명에 그 계약을 그대로 상속시키면 `CNNC (중국핵공업집단)`이 코드처럼 보이고 폭도 넓어진다.
  return [
    { label: '기술난이도', value: score != null ? `${score}/5` : DASH },
    { label: '선두 업체', value: leaderTxt, text: true },
    { label: '시장 규모', value: sizeTxt },
    { label: 'CAGR', value: cagr != null ? `${cagr}%` : DASH },
    { label: '주요 업체', value: players.length > 0 ? `${players.length}곳` : DASH },
    // 업체가 있으면 0곳도 실측값(결측 아님) — 업체가 아예 없을 때만 —
    { label: '양산상용', value: players.length > 0 ? `${players.filter((p) => p.tech_level === 5).length}곳` : DASH },
  ]
}

// 업체 표 정렬(task#280 S3) — 기술수준 내림차순 → 동단계 내 격차 오름차순 → gap_years null 최후
// (격차 미산정 업체가 같은 단계 상단을 차지하지 않게). 비파괴(원본 배열 무변형).
export function sortPlayers(players) {
  if (!Array.isArray(players)) return []
  const lv = (p) => (Number.isFinite(p?.tech_level) ? p.tech_level : -Infinity)
  return [...players].sort((a, b) => {
    if (lv(b) !== lv(a)) return lv(b) - lv(a)
    const ga = a?.gap_years, gb = b?.gap_years
    if (ga == null && gb == null) return 0
    if (ga == null) return 1
    if (gb == null) return -1
    return ga - gb
  })
}

// 업체 표에 렌더할 열(task#296 S1ⓐ). name·level은 항상 포함하고, gap·share는 전 행이 결측이면
// 통째로 뺀다(못 미더운 열을 채우지 않는다 — wrong < missing). share_pct === 0 / gap_years === 0은
// 값이다(0%도 유효 점유율·gap 0은 선두 자신) — falsy로 흘리면 그 행 하나만으로도 열을 잘못 지운다.
// ⚠️ share 게이트는 `>= 0`이다(`> 0` 아님) — 같은 페이지의 점유율 섹션·ShareChart와 같은 식을 써야
// 한 필드가 페이지 안에서 두 판정을 갖지 않는다. 국가·티커는 열이 아니라 업체 셀 내부로 들어간다.
export function playerColumns(players) {
  const list = Array.isArray(players) ? players : []
  const cols = ['name', 'level']
  if (list.some((p) => p?.gap_years != null)) cols.push('gap')
  if (list.some((p) => Number.isFinite(p?.share_pct) && p.share_pct >= 0)) cols.push('share')
  return cols
}

// description의 대괄호 헤딩([기술 개요] 등)을 [{title, body}]로 분해(task#280 S4).
// ⚠️ 대괄호 규약은 데이터 계약이 아니라 루틴의 자발적 습관이다 — 파싱 실패는 *정상 입력*이고
// 정보 손실 0이 절대 조건이다. 그래서 ① 헤딩은 "그 줄 전체가 [..]"일 때만 인정하고(줄 중간
// 각주 [1]·인용이 산문을 쪼개지 않는다) ② 헤딩이 하나도 없으면 전문을 title:null 단일 섹션으로
// ③ 첫 헤딩 앞 문단도 title:null 선행 섹션으로 보존한다(버리지 않는다).
export function parseDescriptionSections(text) {
  if (typeof text !== 'string' || text.trim() === '') return []
  const sections = []
  let title = null
  let buf = []
  const flush = () => {
    const body = buf.join('\n').trim()
    if (title != null || body !== '') sections.push({ title, body })
    buf = []
  }
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^\[([^\]]+)\]$/)
    if (m) {
      flush()
      title = m[1].trim()
    } else {
      buf.push(line)
    }
  }
  flush()
  return sections
}
