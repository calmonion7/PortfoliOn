// 기술 해부 — 자가 서로 다른 [[지분 축]] 3개의 파생·조인·색 배정 (ADR-0042, task#306 S1).
//
// 이 모듈은 순수함수만 갖는다 — TechAnatomy.jsx는 여기서 나온 것을 그리기만 한다.
// 세 축은 **분모가 달라 합칠 수 없다**(기술=남은 난제 총량 / 광물=원재료비 / 전문가=인력 병목
// 총량). 그래서 축마다 독립으로 100%가 닫히고, 화면은 축마다 별도 막대 + 「기준」 문구를 상시
// 노출한다 — 안 하면 독자가 광물 32%와 기술 32%를 같은 뜻으로 읽는다(ADR-0042 결정 2).

// 축의 정본 — 순서·제목·기준 문구가 여기 한 곳에 있다. 화면·프로브·테스트가 이걸 공유한다.
export const AXIS_META = [
  { key: 'tech', title: '필요 기술', basis: '남은 난제 총량 기준' },
  { key: 'minerals', title: '핵심 광물', basis: '원재료비 기준' },
  { key: 'experts', title: '전문가', basis: '인력 병목 총량 기준' },
]

// 세그먼트 색 — 항목 **순서** 기준 결정론적 배정. 토큰이 5개라 6·7번째는 1·2번째와 같은 색이
// 되지만 **인접하지는 않는다**(연속 인덱스는 항상 다른 토큰으로 간다) — 항목 상한이 7이라
// 같은 색 두 조각이 맞붙는 경우는 원리적으로 없다.
export const SEGMENT_TOKENS = ['--data-1', '--data-2', '--data-3', '--data-4', '--data-5']
export function segmentColor(i) {
  return `var(${SEGMENT_TOKENS[i % SEGMENT_TOKENS.length]})`
}

/** composition → 렌더할 축 배열. 빈 축은 제외한다(루틴이 모르는 축은 통째로 생략한다). */
export function deriveAxes(composition) {
  if (!composition) return []
  return AXIS_META
    .map((meta) => {
      const raw = Array.isArray(composition[meta.key]) ? composition[meta.key] : []
      // share_pct가 수치인 항목만 — 발행 시점 검증을 통과했으므로 정상 판에선 전부 남는다.
      // 구판·손상 데이터에서 NaN/누락이 들어와도 막대가 깨지지 않게 하는 방어다.
      const items = raw
        .filter((it) => it && Number.isFinite(it.share_pct))
        .map((it, i) => ({ ...it, color: segmentColor(i) }))
      return { ...meta, items }
    })
    .filter((axis) => axis.items.length > 0)
}

/**
 * 기술 축 항목의 `leaders[]`(이름만)를 `players[]`와 이름으로 조인해 기술수준·티커·국가를 붙인다.
 *
 * 매칭 실패는 **이름만 남기고 조용히 통과**한다 — 발행 시점에 `_composition_leaders_exist_in_players`가
 * 이미 422로 걸렀으므로 여기서 다시 던지면 구판 하나 때문에 페이지 전체가 죽는다(wrong < missing).
 */
export function joinLeaders(items, players, companyIndex) {
  const byName = new Map((players || []).filter((p) => p && p.name).map((p) => [p.name, p]))
  const fromIndex = (name) => companyIndex?.get(name) ?? null
  return (items || []).map((it) => ({
    ...it,
    leaderChips: (Array.isArray(it.leaders) ? it.leaders : []).map((name) => {
      const p = byName.get(name)
      // 티커는 **판 전역**에서 해결한다 — `players[].ticker`가 null이어도 같은 페이로드의
      // `producers[]`가 알고 있으면 그 값을 쓴다(라이브 실례: 이데미쓰코산은 players에선
      // null, 광물축 producers에선 `5019`). 안 그러면 같은 회사가 광물축에선 ◆인데 기술축에선
      // 무표시가 되고 요약이 「난제 N곳」을 빠뜨린다(적대검토 finding 6·11).
      const e = p?.ticker ? null : fromIndex(name)
      return p
        ? { name, tech_level: p.tech_level, ticker: p.ticker ?? e?.ticker ?? null, country: p.country ?? e?.country ?? null }
        : { name, tech_level: null, ticker: e?.ticker ?? null, country: e?.country ?? null }
    }),
  }))
}

/** 표시용 — `share_pct`는 5의 배수라 소수점이 없다(40.0 → "40%"). */
export function formatShare(v) {
  return Number.isFinite(v) ? `${Number.isInteger(v) ? v : v.toFixed(1)}%` : ''
}

/**
 * 축 항목 하나에 등장하는 업체 목록 — 기술 축은 `players[]`를 **이름으로 조인**해 티커를 얻고,
 * 광물 축은 `producers[].ticker`를 직접 쓴다. **전문가 축은 항상 빈 배열**이다: ADR-0042 결정 4가
 * 전문가 축에 업체를 붙이지 않기로 했으므로 교차를 원리적으로 잴 수 없다(0이 아니라 «못 잼»).
 *
 * 반환 `[{ name, ticker, country }]` — 대조 불가·미등록이면 `ticker: null`.
 * `country`는 `matchableTicker`의 6자리 가드가 쓴다(버리면 그 가드가 시장을 판정할 수 없다).
 * S3(항목 배지)와 `crossHoldings`가 **같은 이 함수**를 쓴다 — 매칭 규칙을 두 곳에 적으면
 * 배지 수와 요약 수가 갈라진다.
 */
export function itemCompanies(axisKey, item, players, companyIndex) {
  if (!item) return []
  if (axisKey === 'tech') {
    return joinLeaders([item], players, companyIndex)[0].leaderChips
      .map((c) => ({ name: c.name, ticker: c.ticker ?? null, country: c.country ?? null }))
  }
  if (axisKey === 'minerals') {
    return (Array.isArray(item.producers) ? item.producers : [])
      .filter((p) => p && p.name)
      .map((p) => {
        const e = p.ticker ? null : companyIndex?.get(p.name)
        return { name: p.name, ticker: p.ticker ?? e?.ticker ?? null, country: p.country ?? e?.country ?? null }
      })
  }
  return []
}

/**
 * 판 전역 이름→`{ticker, country}` 인덱스 — `players[]` ∪ 모든 `minerals[].producers[]`.
 * 앞이 우선이고, **티커를 가진 항목만** 싣는다.
 *
 * 축-로컬 값만 보면 같은 회사가 축마다 다르게 취급된다(finding 6·11). 이 인덱스가
 * `joinLeaders`·`itemCompanies`의 폴백이라 **마커·배지·요약이 같은 티커를 본다**.
 * ⚠️ `country`도 함께 싣는다 — 티커만 폴백하면 국가가 null로 남아 `matchableTicker`의
 * 6자리 가드가 **한국 업체를 오히려 배제**한다(내 폴백이 내 가드에 걸리는 자리였다).
 */
export function buildCompanyIndex({ axes, players } = {}) {
  const idx = new Map()
  const put = (c) => {
    if (c?.name && c?.ticker && !idx.has(c.name)) idx.set(c.name, { ticker: c.ticker, country: c.country ?? null })
  }
  for (const p of players || []) put(p)
  for (const axis of axes || []) {
    for (const item of axis?.items || []) {
      for (const pr of Array.isArray(item?.producers) ? item.producers : []) put(pr)
    }
  }
  return idx
}

// 이 앱이 추적하는 티커 공간은 **KR(6자리 숫자) · US(알파벳)** 둘뿐이다(`/api/stocks`의 market은
// KR 아니면 US). 그래서 6자리 숫자 티커는 곧 KR 종목코드이고, 같은 형태를 쓰는 선전·상하이
// 상장사와 **문자 그대로 충돌**한다 — 간펑리튬 `002460`은 KOSPI에도 실재하는 코드라서, 그걸
// 보유한 사용자에게 화면이 「중국 리튬 채굴사를 보유했다」는 투자판단용 거짓을 말한다(finding 1).
// eco: 티커 *형태*로 시장을 유추한다(6자리↔KR). 근본 해법은 (ticker, market) 쌍 대조인데
// 그건 `useTrackedStocks`가 market을 함께 반환해야 한다 — 알파벳 티커가 해외 거래소와
// 겹치는 경우(런던 GLEN vs 미국 GLEN)는 여전히 열려 있고, 그때 그 쌍으로 올릴 것.
const KR_CODE = /^\d{6}$/
function isKorean(country) {
  const s = String(country ?? '')
  return s.includes('한국') || s.includes('대한민국') || /^KR|KOREA/i.test(s.toUpperCase())
}

/** 대조 가능한 티커 — 대조할 수 없으면 `null`(티커 부재와 같은 취급). */
export function matchableTicker(ticker, country) {
  if (!ticker) return null
  if (KR_CODE.test(ticker) && !isKorean(country)) return null
  return ticker
}

/**
 * 업체 하나의 추적 상태 — `'holding' | 'watchlist' | null`.
 * 칩 마커·항목 배지·상단 요약이 **모두 이 함수**를 쓴다(판정을 두 곳에 적으면 갈라진다).
 */
export function trackedState(marks, company, companyIndex) {
  // 축-로컬 티커가 null이면 판 전역 인덱스로 폴백한다 — 그래서 같은 회사가 기술축·광물축에서
  // 같은 마커를 받는다(finding 6·11). 인덱스를 안 넘기면 축-로컬 값만 본다.
  const e = company?.ticker ? null : companyIndex?.get(company?.name)
  const t = matchableTicker(company?.ticker ?? e?.ticker ?? null, company?.country ?? e?.country ?? null)
  const state = t ? (marks || {})[t] : null
  return state === 'holding' || state === 'watchlist' ? state : null
}

/**
 * 내 보유·관심 종목이 이 판의 **기술 축·광물 축**에 어디까지 걸쳐 있나 (task#315 S1).
 *
 * 인자: `{ axes, players, stockMap }` — `axes`는 `deriveAxes()` 결과, `stockMap`은
 * `useTrackedStocks`의 `{ticker: 'holding'|'watchlist'}`. **`toggle`은 쓰지 않는다**(읽기 전용 화면).
 *
 * 반환
 * - `holdingTickers` / `watchTickers` — 이 판에 등장하는 **보유/관심 티커**(중복 제거).
 *   같은 티커가 기술·광물 두 축에 동시 등장해도 **한 번만** 센다(축을 가로질러 합산하지
 *   않는다 — ADR-0042 결정 2). 순서는 축 → 항목 → 업체 등장 순(결정론적).
 * - `techItemHits` / `mineralItemHits` — **항목 수**다(티커 수가 아니다). 보유·관심 티커가
 *   1개 이상 걸린 난제/광물의 개수. 축별로 따로 세므로 두 축에 걸친 티커는 양쪽에 1씩 기여한다
 *   — 그게 사실이다(그 종목은 난제에도, 광물에도 걸려 있다).
 * - `unmatchedCount` — 기술·광물 축에 등장하지만 **대조가 원리적으로 불가한** 업체 수
 *   (업체명 기준 중복 제거). 한 축에서 티커를 얻은 업체는 다른 축에서 이름만 등장해도 여기
 *   안 센다(라이브 실례: 이데미쓰코산은 기술 축 `players`에선 ticker=null이지만 광물 축
 *   producers에선 `5019`다 — 그래서 `buildCompanyIndex`가 두 축을 잇는다).
 *   ⚠️ 이 수는 원인 **셋**을 구별하지 못한다: ① 티커 미등록(비상장 등) ② 이름 조인
 *   실패(dangling — task#313 배포 이후 발행 시점 422로 막힌다) ③ **다른 시장의 6자리
 *   코드**(`matchableTicker`가 거른다 — finding 1). 그래서 화면 문구는 원인을 단정하지 않고
 *   「대조할 수 없는 업체」로 말한다(`wrong < missing`의 문구판).
 * - `measurable` — 기술·광물 축에 **대조 가능한** 티커를 가진 업체가 1명 이상인가. false면 화면은 요약을
 *   그리지 않는다: 그건 「겹침 0」이 아니라 **「물어볼 수 없다」**다(전문가 축만 있는 판 등).
 *
 * `stockMap`이 비어 있어도 `measurable`은 판의 성질이라 그대로 계산된다 — 조회 실패(`unknown`)와
 * 로딩 중(`loaded === false`)의 구별은 **호출측**의 몫이다(이 함수는 그 둘을 모른다).
 */
export function crossHoldings({ axes, players, stockMap } = {}) {
  const map = stockMap || {}
  const index = buildCompanyIndex({ axes, players })
  const holdingTickers = []
  const watchTickers = []
  const counted = new Set()   // 티커 중복 카운트 방지(두 축 동시 등장)
  const tickered = new Set()  // 대조 가능한 티커를 가진 업체명
  const nameless = new Set()  // 대조할 수 없는 업체명(티커 부재 · 다른 시장의 6자리 코드)
  const hits = { tech: 0, minerals: 0 }
  let anyTicker = false

  for (const axis of axes || []) {
    // 전문가 축은 대상이 아니다(ADR-0042 결정 4). ⚠️ 이 줄은 `itemCompanies`의 축 키 디스패치와
    // **중복 방어**다 — 주입 실측: 이 줄만 지워도 32개가 전부 통과하고, 둘을 *모두* 지워야
    // 「전문가 항목이 업체를 실어도 0건」 테스트가 깨진다. 즉 어느 하나도 단독 load-bearing이
    // 아니다(CLAUDE.md task#305). 같은 주입을 다시 하지 않도록 여기 남긴다.
    if (axis?.key !== 'tech' && axis?.key !== 'minerals') continue
    for (const item of axis.items || []) {
      let itemHit = false
      for (const c of itemCompanies(axis.key, item, players, index)) {
        const ticker = matchableTicker(c.ticker, c.country)
        if (!ticker) { nameless.add(c.name); continue }
        tickered.add(c.name)
        anyTicker = true
        const state = trackedState(map, c)
        if (!state) continue
        itemHit = true
        if (counted.has(ticker)) continue
        counted.add(ticker)
        ;(state === 'holding' ? holdingTickers : watchTickers).push(ticker)
      }
      if (itemHit) hits[axis.key] += 1
    }
  }
  for (const n of tickered) nameless.delete(n)

  return {
    holdingTickers,
    watchTickers,
    techItemHits: hits.tech,
    mineralItemHits: hits.minerals,
    unmatchedCount: nameless.size,
    measurable: anyTicker,
  }
}
