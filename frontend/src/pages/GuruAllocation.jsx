import { useState, useEffect, useRef } from 'react'
import api from '../api'
import LoadingSpinner from '../components/LoadingSpinner'
import Input from '../components/ui/Input'
import { SketchEmpty, SketchError } from '../components/sketches'
import { WatchlistBtn } from './GuruStats'
import { useToast } from '../components/Toast'
import useTrackedStocks from '../hooks/useTrackedStocks'
import '../components/ui/Button.css'
import { fmtUsdCompact } from '../utils'

// 포트폴리오 규모(13F 신고 자산) 상위 N명 코호트 — 스코프가 곧 집계 범위다(더 이상 표시
// 줄 수만 자르는 필이 아니다, task#247). 스코프별로 백엔드에 별도 요청(`?top=`)해 코호트
// 자체가 바뀐다. 'all'은 top 파라미터 없이 요청해 전 구루를 코호트로 삼는다.
const SCOPES = [
  { key: 10,    label: '10명' },
  { key: 20,    label: '20명' },
  { key: 50,    label: '50명' },
  { key: 'all', label: '전체' },
]

const scopeUrl = (key) => key === 'all'
  ? '/api/guru/stats/allocation'
  : `/api/guru/stats/allocation?top=${key}`

// 데이터 기준 설명란(task#247 S3) 전용 포맷터 — 응답의 periods/last_updated를 그대로 문장화.
const fmtPeriods = (periods) => {
  const entries = Object.entries(periods || {})
  return entries.length ? entries.map(([p, c]) => `${p} ${c}명`).join(' · ') : '—'
}

const fmtUpdated = (iso) => iso ? iso.replace('T', ' ').slice(0, 16) : '—'

// 전체 스코프에선 "전체 83명 중 83명이지만 구루 자산의 100.0%를 덮는다"가 무의미한 노이즈로
// 읽힌다(PC·모바일 라이브 육안 확인) — 코호트를 실제로 좁혔을 때만 커버리지를 밝힌다.
const coverageSentence = (d) => d.manager_count >= d.all_manager_count
  ? `지금은 전체 ${d.all_manager_count}명 전부를 합산한다.`
  : `전체 ${d.all_manager_count}명 중 ${d.manager_count}명이지만 구루 자산의 `
    + `${(d.all_total_value ? d.total_value / d.all_total_value * 100 : 0).toFixed(1)}%를 덮는다.`

export default function GuruAllocation() {
  const { showToast } = useToast()   // 스코프 전환 실패 토스트(토글 실패는 훅이 처리)
  const { stockMap, unknown, pending, toggle } = useTrackedStocks()
  const cacheRef = useRef({})   // scope -> 응답(재클릭 재요청 0)
  const [data, setData]         = useState(null)
  const [loading, setLoading]   = useState(true)  // 최초 로딩(전면 스피너)만
  const [fetching, setFetching] = useState(false) // 스코프 전환 캐시미스(기존 내용 유지 + 작은 표시)
  const [error, setError]       = useState(null)  // 빈 상태와 구분 — 실패를 "크롤링을 먼저"로 위장하지 않는다
  const [scope, setScope]       = useState('all')       // 선택된 스코프(필 강조·fetch 트리거)
  const [shownScope, setShownScope] = useState('all')   // 실제 렌더 중인 data가 속한 스코프(캡션·검색 가드는 이 값 기준 — fetch 대기 중엔 scope가 먼저 바뀌어도 data는 아직 이전 스코프라 어긋난다)
  const [query, setQuery]       = useState('')
  const [infoOpen, setInfoOpen] = useState(false)   // 데이터 기준 설명란 — 기본 접힘
  // 진입 애니메이션은 첫 진입 1회만 — 스코프 전환 시 1,723행 전량 동시 시작이 전환 비용의
  // ~190ms(4x 실측, task#257)를 차지한다. Ranking.jsx isFirstLoad 선례와 동형.
  const [isFirstLoad, setIsFirstLoad] = useState(true)
  const hasLoadedOnceRef = useRef(false)

  useEffect(() => {
    if (hasLoadedOnceRef.current) setIsFirstLoad(false)
    hasLoadedOnceRef.current = true
    const cached = cacheRef.current[scope]
    if (cached) {
      setData(cached)
      setShownScope(scope)
      setError(null)
      return
    }
    // 스코프를 빠르게 연속 전환하면 여러 요청이 동시에 in-flight 상태가 되고, 코호트별
    // 응답 크기가 달라 늦게 보낸 요청이 먼저 도착할 수 있다 — ignore 가드로 스테일 응답이
    // 최신 선택을 덮지 못하게 한다(Ranking.jsx의 `cancelled` 관용구, 리뷰 발견 수정).
    let ignore = false
    if (data !== null) setFetching(true)   // 최초 로딩이 아니면 기존 내용은 유지하고 작은 표시만
    api.get(scopeUrl(scope))
      .then(r => {
        if (ignore) return
        cacheRef.current[scope] = r.data
        setData(r.data)
        setShownScope(scope)
        setError(null)
      })
      .catch(e => {
        if (ignore) return
        console.error('[GuruAllocation] 자산 배분 조회 실패:', e)
        // 이미 표시 중인 데이터가 있으면 전면 에러로 갈아치우지 않는다 — 토스트로만
        // 알리고 필 선택을 마지막으로 성공한 스코프로 되돌린다(리뷰 발견 수정).
        if (data !== null) {
          showToast('자산 배분을 불러오지 못했습니다.', 'error')
          setScope(shownScope)
        } else {
          setError('자산 배분을 불러오지 못했습니다.')
        }
      })
      .finally(() => {
        if (ignore) return
        setLoading(false)
        setFetching(false)
      })
    return () => { ignore = true }
  }, [scope])

  if (loading) return <LoadingSpinner label="구루 자산 배분 불러오는 중입니다." />

  // 에러가 빈 상태보다 먼저다 — 실패에 "크롤링을 먼저 실행하세요"를 띄우면 잘못된 행동을 지시한다.
  if (error) return (
    <div className="guru-empty">
      <div className="sketch-draw"><SketchError size={140} /></div>
      <p style={{ color: 'var(--color-error)' }}>{error}</p>
    </div>
  )

  if (!data?.rows?.length) return (
    <div className="guru-empty">
      <div className="sketch-draw"><SketchEmpty size={140} /></div>
      <p className="muted">데이터 없음 — 크롤링을 먼저 실행하세요.</p>
    </div>
  )

  const q = query.trim().toLowerCase()
  const matches = r => r.ticker.toLowerCase().includes(q)
    || (r.name_kr || '').toLowerCase().includes(q)
    || (r.name || '').toLowerCase().includes(q)
  // 검색은 이제 코호트 한정이다 — data.rows 자체가 현 스코프가 요청한 코호트 응답이라
  // 그 안에서만 훑는다. 순위는 코호트 내 투자금 내림차순 위치(응답이 이미 그 순서로 정렬).
  const ranked = data.rows.map((r, i) => ({ r, rank: i + 1 }))
  const rows = q ? ranked.filter(({ r }) => matches(r)) : ranked
  // 코호트 밖일 수 있는 0건 — "구루 보유에 없음"과 "코호트를 좁혀 안 보임"을 구분한다.
  // shownScope 기준(= data가 실제로 속한 스코프) — fetch 대기 중엔 scope가 먼저 바뀐다.
  const cohortEmpty = q && rows.length === 0 && shownScope !== 'all'
  const scopeLabel = shownScope === 'all' ? '구루 전체' : '포트폴리오 규모 상위'

  // 비중 막대는 1위 비율로 정규화한 **상대** 폭이다(절대 %가 아니다 — 수치 정본은 메타줄).
  // rows는 투자금 내림차순이라 [0]이 최댓값. 코호트가 비거나 0이면 막대를 그리지 않는다.
  const maxRatio = data.rows[0]?.ratio || 0
  const barPct = (v) => maxRatio > 0 ? (v / maxRatio * 100) : 0

  return (
    <div>
      {/* 캡션과 「데이터 기준」 토글을 한 행에 둔다 — 접힌 기본 상태에서도 캡션·스코프·칩·검색이
          각각 독립 행이라 첫 카드가 458px(뷰포트 69%) 아래에 있었다(모바일 390 실측). */}
      <div className="guru-alloc-head">
        {/* 조각별 nowrap — 좁은 폭에서 줄이 바뀌어도 「합계 $1,077.0B」가 통째로 넘어간다
            (묶지 않으면 '합계'만 남고 금액이 다음 줄로 떨어져 읽힌다, 350px 육안 포착). */}
        <p className="guru-alloc-caption">
          <span>{scopeLabel} {data.manager_count}명</span>
          {' · '}
          <span>{data.ticker_count.toLocaleString()}종목</span>
          {' · '}
          <span>합계 {fmtUsdCompact(data.total_value)}</span>
        </p>
        <button className="filter-chip" aria-expanded={infoOpen} onClick={() => setInfoOpen(o => !o)}>
          {infoOpen ? '접기' : '데이터 기준'}
        </button>
      </div>

      <div className="guru-alloc-scopes">
        {/* 축약형 — 캡션이 이미 "포트폴리오 규모 상위 N명"을 말한다(중복 제거). 350px에서
            긴 라벨은 필 행을 2줄(84px)로 밀어냈다. 발견 신호는 유지된다(task#247). */}
        <span className="guru-alloc-scopes-label">규모 상위</span>
        {SCOPES.map(s => (
          <button
            key={s.key}
            onClick={() => setScope(s.key)}
            className={scope === s.key ? 'is-active' : ''}
          >
            {s.label}
          </button>
        ))}
      </div>
      {fetching && <LoadingSpinner label={null} size={14} style={{ padding: '0 0 8px' }} />}

      {infoOpen && (
        <div className="guru-alloc-info-panel">
          <div>
            <p className="guru-alloc-info-title">이 화면이 세는 범위</p>
            <p>탑N — 표시 줄 수가 아니라 13F 신고 자산 상위 N명 구루 합산. {coverageSentence(data)}</p>
            <p>비율 — 분모는 코호트 총액 {fmtUsdCompact(data.total_value)}. 필을 바꾸면 같은 종목의 비율도 변한다.</p>
            <p>보유 구루 수 — 코호트 안에서 든 수(전체 기준이 아니다).</p>
          </div>
          <div>
            <p className="guru-alloc-info-title">데이터 출처와 시점</p>
            <p>신고 분기 — {fmtPeriods(data.periods)} (여러 분기가 섞일 수 있다).</p>
            <p>갱신 — 주간 크롤 · 마지막 {fmtUpdated(data.last_updated)}.</p>
            <p>13F 성질 — 분기 지연 신고라 현재 포지션·현재 평가액이 아니다.</p>
          </div>
          <div>
            <p className="guru-alloc-info-title">집계 방식</p>
            <p>
              투자금 — 종목별 신고 금액의 합.
              {data.estimated_count > 0 && ` 없으면 비중% × 포트폴리오 규모로 추정 — 추정 ${data.estimated_count}행.`}
            </p>
            <p>집계 단위 — 티커. 듀얼클래스(GOOGL/GOOG · BRK.A/BRK.B) 미병합.</p>
          </div>
        </div>
      )}

      <div className="guru-toolbar">
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="티커 / 종목명 검색..."
          className="guru-search--flex"
        />
        {query && <span className="guru-count">{rows.length}개</span>}
      </div>

      {cohortEmpty ? (
        <div className="guru-empty">
          <p className="muted">선택한 코호트에 없습니다</p>
          <button className="btn btn--sm btn--secondary" onClick={() => setScope('all')}>전체에서 검색</button>
        </div>
      ) : (
        <div className={`${isFirstLoad ? 'anim-stagger ' : ''}guru-stat-grid guru-alloc-grid`}>
          {rows.map(({ r, rank }) => (
            <div key={r.ticker} className={`${isFirstLoad ? 'anim-fade-up ' : ''}guru-stat-row`}>
              <span className="guru-stat-rank">{rank}</span>
              <div className="guru-stat-main">
                <div className="guru-stat-head">
                  <span className="guru-stat-ticker">{r.ticker}</span>
                  <span className="guru-stat-value">{fmtUsdCompact(r.value)}</span>
                </div>
                {/* 잘리는 건 이름이어야 한다 — 숫자를 한 문자열에 섞으면 ellipsis가 문자열
                    *끝*을 먹어 비율·명수가 통째 사라진다(라이브 PC에서 50행 중 38행 발생). */}
                <div className="guru-stat-name">
                  <span className="guru-alloc-nm">{r.name_kr || r.name || '-'}</span>
                  <span className="guru-alloc-num">· {r.ratio.toFixed(2)}% · {r.holder_count}명</span>
                </div>
                {maxRatio > 0 && (
                  <div className="guru-alloc-bar" aria-hidden="true">
                    <span style={{ width: `${barPct(r.ratio).toFixed(2)}%` }} />
                  </div>
                )}
              </div>
              <WatchlistBtn
                ticker={r.ticker}
                name={r.name_kr || r.name}
                stockMap={stockMap}
                onToggle={toggle}
                unknown={unknown}
                pending={pending}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
