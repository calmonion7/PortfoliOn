import { useState, useEffect, useRef, useCallback } from 'react'
import InvestorTrendSection from '../components/reports/InvestorTrendSection'
import api from '../api'
import LoadingSpinner from '../components/LoadingSpinner'
import { krFmt } from '../components/market/marketUtils.jsx'
import { useToast } from '../components/Toast'
import { trackEvent } from '../utils/analytics'
import DetailSummaryTab, { RsiTable } from '../components/reports/DetailTab'
import { ReportSectionCompetitors, RisksSection, MoatSection, GrowthPlanSection, RecentDisclosuresSection } from '../components/reports/Sections'

const LIMIT = 20

const GRID_COLS = '32px minmax(0, 1fr) 84px 64px 90px 92px'
const SUPPLY_GRID_COLS = '32px minmax(0, 1fr) 72px 76px 76px 76px'

const MARKETS = [['KR', '🇰🇷 국내'], ['US', '🇺🇸 해외']]
const METRICS = [['value', '거래대금'], ['volume', '거래량'], ['supply', '수급']]
const TYPES = [['all', '전체'], ['stock', '주식만'], ['etf', 'ETF']]

const fmtPrice = (v, market) => {
  if (v == null) return '-'
  if (market === 'KR') return `₩${Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 0 })}`
  return `$${Number(v).toFixed(2)}`
}

const fmtChange = (v) => {
  if (v == null) return <span style={{ color: 'var(--text-3)' }}>-</span>
  const color = v > 0 ? '#81c784' : v < 0 ? '#ef9a9a' : 'var(--text-3)'
  const sign = v > 0 ? '+' : ''
  return <span style={{ color, fontVariantNumeric: 'tabular-nums' }}>{sign}{v.toFixed(2)}%</span>
}

const fmtVolume = (v) => (v == null ? '-' : Number(v).toLocaleString('ko-KR'))

// 순매수(수량, 부호 정수) — +/- 색상. 외국인/기관/개인 컬럼 공용.
const fmtNet = (v) => {
  if (v == null) return <span style={{ color: 'var(--text-3)' }}>-</span>
  const color = v > 0 ? '#81c784' : v < 0 ? '#ef9a9a' : 'var(--text-3)'
  const sign = v > 0 ? '+' : ''
  return <span style={{ color, fontVariantNumeric: 'tabular-nums' }}>{sign}{Number(v).toLocaleString('ko-KR')}</span>
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

  // 기본정보 모달의 '관심종목 추가' — 기존 watchlist 추가 흐름 재사용
  const addToWatchlist = (row) => {
    setAdding(true)
    api.post('/api/watchlist', {
      ticker: row.ticker,
      name: row.name || row.ticker,
      market,
      exchange: market === 'KR' ? (row.exchange || 'KS') : '',
      security_type: row.is_etf ? 'ETF' : 'EQUITY',
    })
      .then(() => {
        showToast(`${row.ticker} 관심종목에 추가됐습니다.\n리포트는 새벽 자동 생성 파이프라인이 만듭니다.`)
        closeModal()
      })
      .catch((err) => {
        showToast(err?.response?.data?.detail || '관심종목 추가에 실패했습니다.', 'error')
      })
      .finally(() => setAdding(false))
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

      {/* 헤더 */}
      {isSupply ? (
        <div style={{
          display: 'grid', gridTemplateColumns: SUPPLY_GRID_COLS,
          gap: 6, padding: '6px 8px', fontSize: 11, color: 'var(--text-3)',
          borderBottom: '1px solid var(--border)', fontWeight: 600,
        }}>
          <span>순위</span>
          <span>종목</span>
          <span style={{ textAlign: 'right' }}>외국인 보유율</span>
          <span style={{ textAlign: 'right' }}>외국인</span>
          <span style={{ textAlign: 'right' }}>기관</span>
          <span style={{ textAlign: 'right' }}>개인</span>
        </div>
      ) : (
        <div style={{
          display: 'grid', gridTemplateColumns: GRID_COLS,
          gap: 6, padding: '6px 8px', fontSize: 11, color: 'var(--text-3)',
          borderBottom: '1px solid var(--border)', fontWeight: 600,
        }}>
          <span>순위</span>
          <span>종목</span>
          <span style={{ textAlign: 'right' }}>현재가</span>
          <span style={{ textAlign: 'right' }}>등락률</span>
          <span style={{ textAlign: 'right' }}>거래대금</span>
          <span style={{ textAlign: 'right' }}>거래량</span>
        </div>
      )}

      <div>
        {isSupply ? items.map((row, i) => (
          <div
            key={`${row.ticker}-${i}`}
            onClick={() => onRowClick(row)}
            style={{
              display: 'grid', gridTemplateColumns: SUPPLY_GRID_COLS,
              gap: 6, padding: '8px 8px', alignItems: 'center', cursor: 'pointer',
              borderBottom: '1px solid var(--border)', fontSize: 12,
            }}
            className="ranking-row"
          >
            <span style={{ color: 'var(--text-3)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
            <span style={{ minWidth: 0 }}>
              <span style={{ color: 'var(--text)', fontWeight: 600, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name || row.ticker}</span>
              <span style={{ display: 'block', fontSize: 10, color: 'var(--text-3)' }}>{row.ticker}</span>
            </span>
            <span style={{ textAlign: 'right', color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>{row.foreign_hold_ratio == null ? '-' : `${row.foreign_hold_ratio.toFixed(2)}%`}</span>
            <span style={{ textAlign: 'right' }}>{fmtNet(row.foreign_net)}</span>
            <span style={{ textAlign: 'right' }}>{fmtNet(row.organ_net)}</span>
            <span style={{ textAlign: 'right' }}>{fmtNet(row.individual_net)}</span>
          </div>
        )) : items.map((row) => (
          <div
            key={`${row.ticker}-${row.rank}`}
            onClick={() => onRowClick(row)}
            style={{
              display: 'grid', gridTemplateColumns: GRID_COLS,
              gap: 6, padding: '8px 8px', alignItems: 'center', cursor: 'pointer',
              borderBottom: '1px solid var(--border)', fontSize: 12,
            }}
            className="ranking-row"
          >
            <span style={{ color: 'var(--text-3)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{row.rank}</span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--text)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name || row.ticker}</span>
                {row.is_etf && (
                  <span style={{ fontSize: 9, padding: '0 4px', borderRadius: 3, background: 'var(--bg-elev-2)', color: '#ce93d8', border: '1px solid var(--border)' }}>ETF</span>
                )}
              </span>
              <span style={{ display: 'block', fontSize: 10, color: 'var(--text-3)' }}>{row.ticker}</span>
            </span>
            <span style={{ textAlign: 'right', color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>{fmtPrice(row.price, market)}</span>
            <span style={{ textAlign: 'right' }}>{fmtChange(row.change_pct)}</span>
            <span style={{ textAlign: 'right', color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>{fmtTradingValue(row.trading_value, market)}</span>
            <span style={{ textAlign: 'right', color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>{fmtVolume(row.trading_volume)}</span>
          </div>
        ))}
      </div>

      {loading && <LoadingSpinner label="불러오는 중입니다." size={20} style={{ padding: 24 }} />}

      {!loading && error && (
        <div style={{ textAlign: 'center', color: '#ef9a9a', fontSize: 13, padding: 32 }}>랭킹을 불러오지 못했습니다.</div>
      )}

      {!loading && !error && items.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: 13, padding: 32 }}>표시할 랭킹이 없습니다.</div>
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

// 스냅샷 보유 종목: 기존 리포트 표시 컴포넌트 재사용 (Reports.jsx 상세화면 패턴)
function ResearchDetail({ summary, ticker, date, enriched_at, onClose }) {
  const [tab, setTab] = useState('summary')
  const market = summary.market
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: 17 }}>{summary.name || ticker}</span>
          <span style={{ color: 'var(--text-3)', fontSize: 13, marginLeft: 6 }}>({ticker})</span>
          {market === 'KR'
            ? <span style={{ fontSize: 10, marginLeft: 6, padding: '1px 5px', borderRadius: 3, background: '#1a3a2a', color: '#81c784', border: '1px solid #2e6b4a' }}>🇰🇷 KR</span>
            : <span style={{ fontSize: 10, marginLeft: 6, padding: '1px 5px', borderRadius: 3, background: 'var(--bg-elev-2)', color: '#4fc3f7', border: '1px solid var(--border)' }}>🇺🇸 US</span>}
          {date && <span style={{ color: 'var(--text-3)', fontSize: 11, marginLeft: 8 }}>{date}</span>}
        </div>
        <button onClick={onClose} className="btn" style={{ flexShrink: 0 }}>닫기</button>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 14 }}>
        {[
          { key: 'summary', label: '📊 요약' },
          { key: 'technical', label: '📈 기술적 분석' },
          { key: 'report', label: '📄 리포트' },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)} className={`tab-btn${tab === key ? ' active' : ''}`} style={{ padding: '6px 16px', fontSize: 12, marginBottom: -1 }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
        {tab === 'summary' && (
          <DetailSummaryTab summary={summary} ticker={ticker} onRefreshSuccess={() => {}} />
        )}
        {tab === 'technical' && (
          summary.daily_rsi
            ? <RsiTable
                dailyRsi={summary.daily_rsi}
                weeklyRsi={summary.weekly_rsi}
                monthlyRsi={summary.monthly_rsi}
                price={summary.price}
                vp={summary.volume_profile}
                target={summary.target_mean}
                market={market}
              />
            : <p style={{ color: 'var(--text-3)', fontSize: 13 }}>기술적 분석 데이터가 없습니다.</p>
        )}
        {tab === 'report' && (
          <div style={{ padding: '0 4px' }}>
            {enriched_at && (
              <div style={{ marginBottom: 14, fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#81c784', fontWeight: 600 }}>✓</span>
                AI 분석 업데이트: {new Date(enriched_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </div>
            )}
            <ReportSectionCompetitors competitors={summary.competitors_data} market={market} ticker={ticker} />
            <RisksSection risks={summary.risks} />
            <MoatSection moat={summary.moat} />
            <GrowthPlanSection growth_plan={summary.growth_plan} />
            <RecentDisclosuresSection disclosures={summary.recent_disclosures} news={summary.news} />
          </div>
        )}
        {market === 'KR' && <InvestorTrendSection ticker={ticker} />}
      </div>
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
            <span style={{ fontSize: 9, marginLeft: 6, padding: '0 4px', borderRadius: 3, background: 'var(--bg-elev-2)', color: '#ce93d8', border: '1px solid var(--border)' }}>ETF</span>
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
