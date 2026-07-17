import { useState, useEffect, useRef, useCallback } from 'react'
import InvestorTrendSection from '../components/reports/InvestorTrendSection'
import api from '../api'
import Card from '../components/ui/Card'
import { ChangeBadge, MarketBadge } from '../components/ui/Badge'
import LoadingSpinner from '../components/LoadingSpinner'
import Skeleton from '../components/ui/Skeleton'
import { krFmt } from '../components/market/marketUtils.jsx'
import { useToast } from '../components/Toast'
import { trackEvent } from '../utils/analytics'
import ReportDetailTabs from '../components/reports/ReportDetailTabs'
import useIsMobile from '../hooks/useIsMobile'
import { SketchEmpty, SketchError } from '../components/sketches'

const LIMIT = 20

const MARKETS = [['KR', '🇰🇷 국내'], ['US', '🇺🇸 해외']]
const METRICS = [['value', '거래대금'], ['volume', '거래량'], ['change', '등락률'], ['supply', '수급']]
const TYPES = [['all', '전체'], ['stock', '주식만'], ['etf', 'ETF']]

const fmtPrice = (v, market) => {
  if (v == null) return '-'
  if (market === 'KR') return `₩${Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 0 })}`
  return `$${Number(v).toFixed(2)}`
}

const fmtChange = (v) => {
  if (v == null) return <span style={{ color: 'var(--text-3)' }}>-</span>
  const color = v > 0 ? 'var(--up)' : v < 0 ? 'var(--down)' : 'var(--text-3)'
  const sign = v > 0 ? '+' : ''
  return <span style={{ color, fontVariantNumeric: 'tabular-nums' }}>{sign}{v.toFixed(2)}%</span>
}

const fmtVolume = (v) => (v == null ? '-' : Number(v).toLocaleString('ko-KR'))

// 순매수(수량, 부호 정수) — +/- 색상. 외국인/기관/개인 컬럼 공용.
const fmtNet = (v) => {
  if (v == null) return <span style={{ color: 'var(--text-3)' }}>-</span>
  const color = v > 0 ? 'var(--up)' : v < 0 ? 'var(--down)' : 'var(--text-3)'
  const sign = v > 0 ? '+' : ''
  return <span style={{ color, fontVariantNumeric: 'tabular-nums' }}>{sign}{Number(v).toLocaleString('ko-KR')}주</span>
}

const fmtTradingValue = (v, market) => {
  if (v == null) return '-'
  if (market === 'KR') return krFmt(v / 1e8)  // KRW → 억 단위로 변환 후 krFmt(억/조)
  return `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

const fmtTs = (ts) => {
  if (!ts) return null
  try {
    return new Date(ts).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return null
  }
}

const decodeHtml = (str) => {
  if (!str) return str
  const txt = document.createElement('textarea')
  txt.innerHTML = str
  return txt.value
}

export default function Ranking() {
  const { showToast } = useToast()
  const isMobile = useIsMobile()
  const [market, setMarket] = useState('KR')
  const [metric, setMetric] = useState('value')
  const [type, setType] = useState('all')

  const [items, setItems] = useState([])
  const [baseTs, setBaseTs] = useState(null)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  const sentinelRef = useRef(null)
  const loadingRef = useRef(false)

  // 종목 클릭 → 리서치 분기 모달 상태
  // detail: 스냅샷 리포트 / basic: 기본정보 + 관심추가 CTA
  const [modal, setModal] = useState(null)   // { row, mode: 'detail'|'basic', summary?, date?, enriched_at? }
  const [modalLoading, setModalLoading] = useState(false)
  const [adding, setAdding] = useState(false)

  // 관심종목 토글: watched=등록된 ticker(대문자) Set, pending=요청 중 ticker Set(더블클릭 방지)
  const [watched, setWatched] = useState(() => new Set())
  const [pending, setPending] = useState(() => new Set())

  const isSupply = metric === 'supply'

  const fetchPage = useCallback((off, reset) => {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    // 수급 뷰: 스크리닝 엔드포인트(외국인 보유율 desc, 서버 정렬). 그 외: 기존 랭킹.
    const req = metric === 'supply'
      ? api.get('/api/investor/screening', { params: { limit: LIMIT, offset: off } })
      : api.get('/api/rankings', { params: { market, metric, type, limit: LIMIT, offset: off } })
    req
      .then(({ data }) => {
        const rows = data.items || []
        setBaseTs(metric === 'supply' ? (data.latest_date ?? null) : (data.base_ts ?? null))
        setItems(prev => reset ? rows : [...prev, ...rows])
        setOffset(off + rows.length)
        setHasMore(rows.length === LIMIT)
        setError(false)
      })
      .catch(() => setError(true))
      .finally(() => {
        loadingRef.current = false
        setLoading(false)
      })
  }, [market, metric, type])

  // 수급은 KR 전용 — US로 전환 시 거래대금으로 폴백
  useEffect(() => {
    if (market === 'US' && metric === 'supply') setMetric('value')
  }, [market, metric])

  // 토글 변경 시 리셋 후 첫 페이지 로드
  useEffect(() => {
    setItems([])
    setOffset(0)
    setHasMore(true)
    setError(false)
    fetchPage(0, true)
  }, [market, metric, type, fetchPage])

  // 무한 스크롤
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasMore && !loadingRef.current && items.length > 0) {
        fetchPage(offset, false)
      }
    }, { rootMargin: '200px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [hasMore, items.length, offset, fetchPage])

  // 모달 오픈 동안 배경(body) 스크롤 잠금 — 레이어 스크롤이 바닥 페이지로 전파되는 현상 방지, 닫히면 원복
  const modalOpen = modal != null
  useEffect(() => {
    if (!modalOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [modalOpen])

  // 진입 시 관심종목 목록 1회 로드 → 행 별표 상태 표시
  useEffect(() => {
    api.get('/api/watchlist')
      .then(({ data }) => setWatched(new Set((data || []).map(s => s.ticker.toUpperCase()))))
      .catch(() => {})
  }, [])

  // 클릭 시 스냅샷 가용 여부로 분기: 있으면 리서치 리포트 모달, 없으면 기본정보 모달 + 관심추가 CTA.
  const onRowClick = (row) => {
    trackEvent('ranking_row_click', { ticker: row.ticker, market })
    setModal({ row, mode: 'basic' })
    setModalLoading(true)
    // 최신 스냅샷 날짜 조회 (history는 날짜 오름차순)
    api.get(`/api/report/${row.ticker}/history`)
      .then(({ data }) => {
        const dated = (data || []).filter(d => d.has_snapshot)
        const latest = dated.length ? dated[dated.length - 1].date : null
        if (!latest) return null
        return api.get(`/api/report/${row.ticker}/${latest}`).then(({ data }) => ({ data, date: latest }))
      })
      .then((res) => {
        if (res && res.data?.summary) {
          setModal({ row, mode: 'detail', summary: res.data.summary, date: res.date, enriched_at: res.data.enriched_at || null })
        }
        // res 없으면 basic 모드 유지
      })
      .catch(() => { /* 404 등 → basic 모드 유지 */ })
      .finally(() => setModalLoading(false))
  }

  const closeModal = () => { setModal(null); setModalLoading(false) }

  // watchlist 추가 payload (모달 추가 · 행 토글 공유)
  const watchPayload = (row) => ({
    ticker: row.ticker,
    name: row.name || row.ticker,
    market,
    exchange: market === 'KR' ? (row.exchange || 'KS') : '',
    security_type: row.is_etf ? 'ETF' : 'EQUITY',
  })

  // 기본정보 모달의 '관심종목 추가' — 기존 watchlist 추가 흐름 재사용
  const addToWatchlist = (row) => {
    setAdding(true)
    api.post('/api/watchlist', watchPayload(row))
      .then(() => {
        setWatched(prev => new Set(prev).add(row.ticker.toUpperCase()))
        showToast(`${row.ticker} 관심종목에 추가됐습니다.\n리포트는 새벽 자동 생성 파이프라인이 만듭니다.`)
        closeModal()
      })
      .catch((err) => {
        showToast(err?.response?.data?.detail || '관심종목 추가에 실패했습니다.', 'error')
      })
      .finally(() => setAdding(false))
  }

  // 행 별표 토글 — 등록 시 DELETE, 미등록 시 POST. 행 클릭(모달)과 분리.
  const toggleWatch = (row, e) => {
    e.stopPropagation()
    const t = row.ticker.toUpperCase()
    if (pending.has(t)) return
    const isWatched = watched.has(t)
    setPending(prev => new Set(prev).add(t))
    const req = isWatched
      ? api.delete(`/api/watchlist/${row.ticker}`)
      : api.post('/api/watchlist', watchPayload(row))
    req
      .then(() => {
        setWatched(prev => {
          const n = new Set(prev)
          if (isWatched) n.delete(t); else n.add(t)
          return n
        })
        trackEvent('ranking_watch_toggle', { ticker: row.ticker, market, action: isWatched ? 'remove' : 'add' })
        showToast(isWatched ? `${row.ticker} 관심종목에서 제거됐습니다.` : `${row.ticker} 관심종목에 추가됐습니다.`)
      })
      .catch((err) => {
        showToast(err?.response?.data?.detail || (isWatched ? '관심종목 제거에 실패했습니다.' : '관심종목 추가에 실패했습니다.'), 'error')
      })
      .finally(() => setPending(prev => { const n = new Set(prev); n.delete(t); return n }))
  }

  // 행 끝 별표 버튼 — ★ 등록 / ☆ 미등록
  const renderStar = (row) => {
    const t = row.ticker.toUpperCase()
    const on = watched.has(t)
    const busy = pending.has(t)
    return (
      <button
        onClick={(e) => toggleWatch(row, e)}
        disabled={busy}
        title={on ? '관심종목에서 제거' : '관심종목 추가'}
        aria-label={on ? '관심종목에서 제거' : '관심종목 추가'}
        style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          fontSize: 16, lineHeight: 1, justifySelf: 'center',
          color: on ? 'var(--accent)' : 'var(--text-3)', opacity: busy ? 0.4 : 1,
        }}
      >{on ? '★' : '☆'}</button>
    )
  }

  // 수급 baseTs는 ISO 날짜(latest_date)라 날짜만, 그 외는 기존 datetime 라벨.
  const tsLabel = isSupply ? baseTs : fmtTs(baseTs)
  // 수급은 KR 전용이라 US에서는 metric 토글에서 숨김.
  const metricOptions = market === 'US' ? METRICS.filter(([v]) => v !== 'supply') : METRICS

  const Toggle = ({ options, value, onChange }) => (
    <div className="tabs" style={{ width: 'fit-content' }}>
      {options.map(([val, label]) => (
        <button key={val} className={value === val ? 'is-active' : ''} onClick={() => onChange(val)}>{label}</button>
      ))}
    </div>
  )

  // 종목 카드 셸 — 순위 뱃지 + 종목명/ticker + 별표. 본문은 모드별 children.
  // 클릭 시 onRowClick(모달). 기존 Card(ui) 재사용으로 hover·서피스 통일.
  const RankCard = ({ rank, row, children }) => (
    <Card
      hover
      padding="sm"
      className="anim-fade-up"
      onClick={() => onRowClick(row)}
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{
          flexShrink: 0, minWidth: 22, height: 22, padding: '0 6px',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 6, background: 'var(--bg-elev-2)', border: '1px solid var(--border)',
          color: 'var(--text-3)', fontWeight: 700, fontSize: 12, fontVariantNumeric: 'tabular-nums',
        }}>{rank}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            <span style={isMobile
              ? { color: 'var(--text)', fontWeight: 600, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', wordBreak: 'break-word', minWidth: 0 }
              : { color: 'var(--text)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name || row.ticker}</span>
            {row.is_etf && (
              <span style={{ fontSize: 9, padding: '0 4px', borderRadius: 3, background: 'var(--tag-etf-bg)', color: 'var(--tag-etf-color)', border: '1px solid var(--tag-etf-border)' }}>ETF</span>
            )}
          </div>
          <span style={{ display: 'block', fontSize: 10, color: 'var(--text-3)' }}>{row.ticker}</span>
        </div>
        {renderStar(row)}
      </div>
      {children}
    </Card>
  )

  // 카드 본문 라벨/값 한 줄
  const statRow = (label, val) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
      <span style={{ color: 'var(--text-3)' }}>{label}</span>
      <span style={{ color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>{val}</span>
    </div>
  )

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 12 }}>
        <Toggle options={MARKETS} value={market} onChange={setMarket} />
        <Toggle options={metricOptions} value={metric} onChange={setMetric} />
        {!isSupply && <Toggle options={TYPES} value={type} onChange={setType} />}
        {tsLabel && (
          <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 'auto' }}>기준 {tsLabel}</span>
        )}
      </div>

      {/* 카드 그리드 — PC 멀티컬럼/모바일 1~2열 자동 줄바꿈, 모든 카드 동일 크기 */}
      <div className="anim-stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
        {isSupply ? items.map((row, i) => (
          <RankCard key={`${row.ticker}-${i}`} rank={i + 1} row={row}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
              {statRow('외국인 보유율', row.foreign_hold_ratio == null ? '-' : `${row.foreign_hold_ratio.toFixed(2)}%`)}
              {statRow('외국인', fmtNet(row.foreign_net))}
              {statRow('기관', fmtNet(row.organ_net))}
              {statRow('개인', fmtNet(row.individual_net))}
            </div>
          </RankCard>
        )) : items.map((row) => (
          <RankCard key={`${row.ticker}-${row.rank}`} rank={row.rank} row={row}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16, fontVariantNumeric: 'tabular-nums' }}>{fmtPrice(row.price, market)}</span>
              {/* eco: ChangeBadge 재사용 — DashboardCard 헤드라인 변동률과 동일 패턴 */}
              <ChangeBadge value={row.change_pct} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
              {statRow('거래대금', fmtTradingValue(row.trading_value, market))}
              {statRow('거래량', fmtVolume(row.trading_volume))}
            </div>
          </RankCard>
        ))}
      </div>

      {loading && items.length === 0 && <Skeleton variant="card" count={6} />}

      {loading && items.length > 0 && <LoadingSpinner label="불러오는 중입니다." size={20} style={{ padding: 24 }} />}

      {!loading && error && (
        <div style={{ textAlign: 'center', padding: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <div className="sketch-draw" style={{ color: 'var(--text-3)' }}><SketchError size={140} /></div>
          <span style={{ color: 'var(--color-error)', fontSize: 13 }}>랭킹을 불러오지 못했습니다.</span>
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div style={{ textAlign: 'center', padding: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <div className="sketch-draw" style={{ color: 'var(--text-3)' }}><SketchEmpty size={140} /></div>
          <span style={{ color: 'var(--text-3)', fontSize: 13 }}>표시할 랭킹이 없습니다.</span>
        </div>
      )}

      {/* 무한 스크롤 센티넬 */}
      <div ref={sentinelRef} style={{ height: 1 }} />

      {modal && (
        <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) closeModal() }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 720, width: '100%' }}>
            {modalLoading ? (
              <LoadingSpinner label="리서치 불러오는 중입니다." style={{ padding: 32 }} />
            ) : modal.mode === 'detail' && modal.summary ? (
              <ResearchDetail
                summary={modal.summary}
                ticker={modal.row.ticker}
                date={modal.date}
                enriched_at={modal.enriched_at}
                onClose={closeModal}
              />
            ) : (
              <BasicInfo
                row={modal.row}
                market={market}
                adding={adding}
                onAdd={() => addToWatchlist(modal.row)}
                onClose={closeModal}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// 스냅샷 보유 종목: 기존 리포트 표시 컴포넌트 재사용 (Reports.jsx 상세화면 구성과 동일)
function ResearchDetail({ summary, ticker, date, enriched_at, onClose }) {
  const market = summary.market
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <div>
            <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: 17 }}>{summary.name || ticker}</span>
            <span style={{ color: 'var(--text-3)', fontSize: 13, marginLeft: 6 }}>({ticker})</span>
            {/* eco: MarketBadge 재사용 — 수기 KR/US 필과 동일 톤(색 무변경) */}
            <span style={{ marginLeft: 6 }}><MarketBadge market={market} /></span>
            {date && <span style={{ color: 'var(--text-3)', fontSize: 11, marginLeft: 8 }}>{date}</span>}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 6 }}>
            {summary.price != null && (
              <span style={{ color: 'var(--text)', fontSize: 16, fontWeight: 700 }}>{fmtPrice(summary.price, market)}</span>
            )}
            {summary.drop_from_high_20d != null && (
              <span style={{
                fontSize: 11, padding: '2px 7px', borderRadius: 3,
                background: summary.drop_from_high_20d >= 0 ? 'var(--up-soft)' : 'var(--down-soft)',
                color: summary.drop_from_high_20d >= 0 ? 'var(--up)' : 'var(--down)',
              }}>
                {summary.drop_from_high_20d < -10 && '⚠ '}
                20일고점 {summary.drop_from_high_20d >= 0 ? '+' : ''}{summary.drop_from_high_20d.toFixed(1)}%
              </span>
            )}
            {summary.sector && (
              <span style={{ color: 'var(--accent)', fontSize: 11, background: 'var(--bg-elev-2)', padding: '2px 7px', borderRadius: 3 }}>
                {summary.sector}{summary.industry ? ` / ${summary.industry}` : ''}
              </span>
            )}
            {summary.per != null && (
              <span style={{ color: 'var(--text-3)', fontSize: 11, background: 'var(--bg-elev-2)', padding: '2px 7px', borderRadius: 3 }}>
                PER {summary.per.toFixed(1)}
                {summary.forward_per != null && <span style={{ marginLeft: 4 }}>/ Fwd {summary.forward_per.toFixed(1)}</span>}
              </span>
            )}
            {summary.pbr != null && (
              <span style={{ color: 'var(--text-3)', fontSize: 11, background: 'var(--bg-elev-2)', padding: '2px 7px', borderRadius: 3 }}>PBR {summary.pbr.toFixed(2)}</span>
            )}
          </div>
        </div>
        <button onClick={onClose} className="btn" style={{ flexShrink: 0 }}>닫기</button>
      </div>

      <ReportDetailTabs
        key={ticker}
        summary={summary}
        ticker={ticker}
        enrichedAt={enriched_at}
        historyDates={[]}
        contentMaxHeight="60vh"
      />
    </div>
  )
}

// 스냅샷 미보유 종목: 랭킹 행 데이터로 구성한 기본정보 + 관심추가 CTA
function BasicInfo({ row, market, adding, onAdd, onClose }) {
  const [news, setNews] = useState(null)  // null=로딩 중, []=없음
  useEffect(() => {
    let cancelled = false
    setNews(null)
    api.get(`/api/stocks/${row.ticker}/news`, { params: { market: row.market || market || 'US' } })
      .then(({ data }) => { if (!cancelled) setNews(data.news || []) })
      .catch(() => { if (!cancelled) setNews([]) })
    return () => { cancelled = true }
  }, [row.ticker, row.market, market])

  const rows = [
    ['현재가', fmtPrice(row.price, market)],
    ['등락률', fmtChange(row.change_pct)],
    ['거래대금', fmtTradingValue(row.trading_value, market)],
    ['거래량', fmtVolume(row.trading_volume)],
    ['시가총액', fmtTradingValue(row.market_cap, market)],
  ]
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <div>
          <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: 17 }}>{row.name || row.ticker}</span>
          {row.is_etf && (
            <span style={{ fontSize: 9, marginLeft: 6, padding: '0 4px', borderRadius: 3, background: 'var(--tag-etf-bg)', color: 'var(--tag-etf-color)', border: '1px solid var(--tag-etf-border)' }}>ETF</span>
          )}
          <div style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 2 }}>{row.ticker}</div>
        </div>
        <button onClick={onClose} className="btn" style={{ flexShrink: 0 }}>닫기</button>
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '4px 0 14px' }}>아직 생성된 리서치 리포트가 없습니다.</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
        {rows.map(([label, val]) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
            <span style={{ color: 'var(--text-3)' }}>{label}</span>
            <span style={{ color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>{val}</span>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 18 }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)', marginBottom: 8 }}>뉴스</div>
        {news === null ? (
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>뉴스 불러오는 중…</p>
        ) : news.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>관련 뉴스가 없습니다.</p>
        ) : (
          <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: 12, lineHeight: 1.8 }}>
            {news.map((item, i) => (
              <li key={i}>
                <a href={item.link} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>{decodeHtml(item.title)}</a>
                <span style={{ color: 'var(--text-3)', marginLeft: 6 }}>— {item.publisher} ({item.published_at})</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button className="btn btn-primary" onClick={onAdd} disabled={adding} style={{ width: '100%' }}>
        {adding ? '추가 중…' : '관심종목 추가'}
      </button>

      {(row.market || market) === 'KR' && <InvestorTrendSection ticker={row.ticker} />}
    </div>
  )
}

// 수급 추이 차트 (KR 전용): 외국인/기관/개인 누적 순매수(좌축) + 외국인 보유율(우축) dual-axis.
// 종목 클릭 모달(ResearchDetail·BasicInfo) 하단에 렌더. US 종목은 호출부에서 미렌더.
// InvestorTrendSection은 components/reports/InvestorTrendSection.jsx로 분리(랭킹·리포트 상세 공유)
