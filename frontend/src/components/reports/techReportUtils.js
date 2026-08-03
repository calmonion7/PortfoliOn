// 선도기술 리포트(ADR-0033, task#276) 프론트 순수 헬퍼 — TechReports.jsx·TechReport.jsx가 쓰고,
// 2/2(task#277) 차트·관계도도 이 모듈에서 가져다 쓴다. formatMarketSize는 이름에 입력 단위를
// 지닌다(ADR-0031) — currency/unit을 그대로 표시하고 절대 환산하지 않는다(수주잔고 ×100 오저장 계열
// 단위함정 원천차단, ADR-0033 결정 3).

// 백엔드 TECH_TOPICS(services/tech_reports.py)의 표시명 미러 — 그 상수는 slug 검증에만 쓰이고
// API 응답에 노출되지 않는다(ADR-0033 결정 2). slug를 늘리면 백엔드 TECH_TOPICS와 함께 갱신할 것.
export const TECH_NAMES = {
  'reusable-rocket': '재사용 로켓',
  'solid-state-battery': '전고체 배터리',
  smr: 'SMR',
  robotics: '로봇',
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
