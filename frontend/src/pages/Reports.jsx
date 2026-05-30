import { useState, useEffect, useCallback, useRef } from 'react'
import api from '../api'
import { fmtPrice as fmt } from '../utils'
import LoadingSpinner from '../components/LoadingSpinner'
import { useToast } from '../components/Toast'
import { TH, TD, fmtN, rsiColor, TargetTooltip, overallWeather } from '../components/reports/reportUtils.jsx'
import ConsensusChart from '../components/reports/ConsensusChart'
import DetailSummaryTab, { RsiTable } from '../components/reports/DetailTab'
import FinancialsChart from '../components/reports/FinancialsChart'
import HistoryTab from '../components/reports/HistoryTab'
import { ReportSectionText, ReportSectionCompetitors, ReportSectionNews } from '../components/reports/Sections'






export default function Reports() {
  const [reportList, setReportList] = useState({})
  const [selected, setSelected] = useState({ ticker: null, date: null })
  const [detail, setDetail] = useState({ summary: null })
  const [loading, setLoading] = useState(false)
  const [listLoading, setListLoading] = useState(true)
  const [hasFetched, setHasFetched] = useState(false)
  const { showToast } = useToast()
  const [generating, setGenerating] = useState(null)
  const [genProgress, setGenProgress] = useState({ done: 0, total: 0, failed: [] })
  const pollRef = useRef(null)
  const [activeTab, setActiveTab] = useState('holdings')
  const [watchlistSub, setWatchlistSub] = useState('low')
  const [view, setView] = useState('list')
  const [detailRefreshKey, setDetailRefreshKey] = useState(0)
  const [activeDetailTab, setActiveDetailTab] = useState('summary')
  const [marketFilter, setMarketFilter] = useState('ALL')
  const [guruMap, setGuruMap] = useState({})  // ticker -> count

  useEffect(() => {
    api.get('/api/guru/stats/popularity')
      .then(({ data }) => {
        const map = {}
        data.forEach(r => { if (r.count > 0) map[r.ticker] = r.count })
        setGuruMap(map)
      })
      .catch(() => {})
  }, [])

const fetchList = useCallback(() => {
    setListLoading(true)
    api.get('/api/report/list')
      .then(({ data }) => setReportList(data))
      .finally(() => { setListLoading(false); setHasFetched(true) })
  }, [])

  useEffect(() => { fetchList() }, [])

  useEffect(() => {
    if (!selected.ticker || !selected.date) return
    setLoading(true)
    api.get(`/api/report/${selected.ticker}/${selected.date}`)
      .then(({ data }) => setDetail({ summary: data.summary }))
      .finally(() => setLoading(false))
  }, [selected, detailRefreshKey])

  const openDetail = (ticker, date) => {
    setSelected({ ticker, date })
    setView('detail')
    setActiveDetailTab('summary')
  }

  const generateOne = async (ticker) => {
    setGenerating(ticker)
    setGenProgress({ done: 0, total: 0 })
    clearInterval(pollRef.current)
    try {
      await api.post(`/api/report/generate/${ticker}`)
      pollRef.current = setInterval(async () => {
        try {
          const { data } = await api.get('/api/report/progress')
          setGenProgress({ done: data.done, total: data.total, failed: data.failed || [] })
          if (!data.running && data.total > 0 && data.done >= data.total) {
            clearInterval(pollRef.current)
            setGenerating(null)
            if (data.failed?.length) {
              const f = data.failed[0]
              const tickerName = typeof f === 'string' ? f : (f?.ticker || ticker)
              const rawErr = typeof f === 'object' ? f?.error : ''
              const errStr = rawErr?.length > 80 ? rawErr.slice(0, 80) + '…' : rawErr
              const msg = errStr ? `생성 실패: ${tickerName} — ${errStr}` : `생성 실패: ${tickerName}`
              showToast(msg, 'error')
            } else showToast(`${ticker} 리포트 생성 완료`)
            api.get('/api/report/list').then(({ data: list }) => {
              setReportList(list)
              const dates = list[ticker]?.dates || []
              const newDate = dates[0]
              if (!newDate) return
              if (view === 'detail' && selected.ticker === ticker) {
                if (newDate !== selected.date) {
                  setSelected(prev => ({ ...prev, date: newDate }))
                } else {
                  setDetailRefreshKey(k => k + 1)
                }
              }
            })
          }
        } catch {}
      }, 1500)
    } catch {
      setGenerating(null)
      showToast('리포트 생성 실패', 'error')
    }
  }

  const generateBatch = async (tickers) => {
    if (!tickers.length) return
    setGenerating('__batch__')
    setGenProgress({ done: 0, total: 0 })
    clearInterval(pollRef.current)
    try {
      await api.post(`/api/report/generate?tickers=${tickers.join(',')}`)
      pollRef.current = setInterval(async () => {
        try {
          const { data } = await api.get('/api/report/progress')
          setGenProgress({ done: data.done, total: data.total, failed: data.failed || [] })
          if (!data.running && data.total > 0 && data.done >= data.total) {
            clearInterval(pollRef.current)
            setGenerating(null)
            if (data.failed?.length) {
              const toName = f => typeof f === 'string' ? f : (f?.ticker || '?')
              const names = data.failed.map(toName).join(', ')
              const first = data.failed[0]
              const rawErr = typeof first === 'object' ? first?.error : ''
              const errStr = rawErr?.length > 80 ? rawErr.slice(0, 80) + '…' : rawErr
              const msg = data.failed.length === 1 && errStr
                ? `생성 실패: ${toName(first)} — ${errStr}`
                : `생성 실패: ${names}`
              showToast(msg, 'error')
            } else showToast(`리포트 ${data.done}개 생성 완료`)
            api.get('/api/report/list').then(({ data: list }) => setReportList(list))
          }
        } catch {}
      }, 1500)
    } catch {
      setGenerating(null)
      showToast('리포트 생성 실패', 'error')
    }
  }

  useEffect(() => () => clearInterval(pollRef.current), [])

  const holdingsCount = Object.values(reportList).filter(v => v.category === 'holdings').length
  const watchlistAll = Object.entries(reportList).filter(([, v]) => v.category === 'watchlist')
  const _targetPct = (s) => { const t = s?.target_mean, p = s?.price; return (t != null && p) ? (t - p) / p * 100 : null }
  const _hasWarning = (s) => {
    if (!s) return false
    const total = (s.buy ?? 0) + (s.hold ?? 0) + (s.sell ?? 0)
    return total <= 10  // 의견 0개 포함
  }
  const watchlistWarnCount = watchlistAll.filter(([, v]) => _hasWarning(v.summary)).length
  const watchlistLowCount = watchlistAll.filter(([, v]) => { if (_hasWarning(v.summary)) return false; const g = _targetPct(v.summary); return g === null || g >= 40 }).length
  const watchlistHighCount = watchlistAll.filter(([, v]) => { if (_hasWarning(v.summary)) return false; const g = _targetPct(v.summary); return g !== null && g < 40 }).length
  const watchlistCount = watchlistAll.length
  const _isUngenerated = ([, v]) => v.dates.length === 0 || v.summary?.price == null
  const ungeneratedTickers = Object.entries(reportList).filter(_isUngenerated).map(([t]) => t)
  const ungeneratedCount = ungeneratedTickers.length
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (activeTab === 'ungenerated' && ungeneratedCount === 0) setActiveTab('holdings')
  }, [ungeneratedCount, activeTab])

  const _matchSubTab = ([, v]) => {
    if (activeTab === 'ungenerated') return _isUngenerated([, v])
    if (activeTab === 'holdings') return v.category === 'holdings'
    if (v.category !== 'watchlist') return false
    if (watchlistSub === 'warn') return _hasWarning(v.summary)
    const g = _targetPct(v.summary)
    if (watchlistSub === 'low') return !_hasWarning(v.summary) && (g === null || g >= 40)
    return !_hasWarning(v.summary) && (g !== null && g < 40)
  }
  const subTabEntries = Object.entries(reportList).filter(_matchSubTab)
  const mCountAll = subTabEntries.length
  const mCountKR = subTabEntries.filter(([, v]) => (v.summary?.market || v.market) === 'KR').length
  const mCountUS = subTabEntries.filter(([, v]) => (v.summary?.market || v.market) === 'US').length

  const tabEntries = subTabEntries
    .filter(([, v]) => {
      if (marketFilter === 'ALL') return true
      const m = v.summary?.market || v.market
      return m === marketFilter
    })
    .sort(([, a], [, b]) => {
      const gapOf = (s) => {
        const t = s.summary?.target_mean, p = s.summary?.price
        return t != null && p ? (t - p) / p * 100 : null
      }
      if (activeTab === 'holdings') {
        // 1차 평균목표가 비율 낮은순, 2차 RSI 일봉 높은순
        const gapA = gapOf(a), gapB = gapOf(b)
        if (gapA !== gapB) {
          if (gapA === null) return 1
          if (gapB === null) return -1
          return gapA - gapB
        }
        const rsiA = a.summary?.daily_rsi?.rsi ?? null
        const rsiB = b.summary?.daily_rsi?.rsi ?? null
        if (rsiA === null && rsiB === null) return 0
        if (rsiA === null) return 1
        if (rsiB === null) return -1
        return rsiB - rsiA
      }
      // 관심종목: 1차 평균목표가 비율 높은순, 2차 RSI 일봉 낮은순
      const gapA = gapOf(a), gapB = gapOf(b)
      if (gapA !== gapB) {
        if (gapA === null) return 1
        if (gapB === null) return -1
        return gapB - gapA
      }
      const rsiA = a.summary?.daily_rsi?.rsi ?? null
      const rsiB = b.summary?.daily_rsi?.rsi ?? null
      if (rsiA === null && rsiB === null) return 0
      if (rsiA === null) return 1
      if (rsiB === null) return -1
      return rsiA - rsiB
    })

  const renderFilters = () => (
    <>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: (activeTab === 'watchlist' || activeTab === 'ungenerated') ? 0 : 12 }}>
        <button className={`tab-btn${activeTab === 'holdings' ? ' active' : ''}`} onClick={() => setActiveTab('holdings')}>보유 ({holdingsCount})</button>
        <button className={`tab-btn${activeTab === 'watchlist' ? ' active' : ''}`} onClick={() => setActiveTab('watchlist')}>관심 ({watchlistCount})</button>
        {ungeneratedCount > 0 && (
          <button className={`tab-btn${activeTab === 'ungenerated' ? ' active' : ''}`} onClick={() => setActiveTab('ungenerated')} style={{ color: activeTab === 'ungenerated' ? 'var(--accent)' : '#ffb74d' }}>미생성 ({ungeneratedCount})</button>
        )}
      </div>
      {activeTab === 'watchlist' && (
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 8, marginTop: 4 }}>
          <button className="tab-btn sm" style={{ color: watchlistSub === 'low' ? '#81c784' : 'var(--text-3)', borderBottomColor: watchlistSub === 'low' ? '#81c784' : 'transparent', fontWeight: watchlistSub === 'low' ? 600 : 400 }} onClick={() => setWatchlistSub('low')}>목표≥40% ({watchlistLowCount})</button>
          <button className="tab-btn sm" style={{ color: watchlistSub === 'high' ? '#ef9a9a' : 'var(--text-3)', borderBottomColor: watchlistSub === 'high' ? '#ef9a9a' : 'transparent', fontWeight: watchlistSub === 'high' ? 600 : 400 }} onClick={() => setWatchlistSub('high')}>목표&lt;40% ({watchlistHighCount})</button>
          <button className="tab-btn sm" style={{ color: watchlistSub === 'warn' ? '#ffb74d' : 'var(--text-3)', borderBottomColor: watchlistSub === 'warn' ? '#ffb74d' : 'transparent', fontWeight: watchlistSub === 'warn' ? 600 : 400 }} onClick={() => setWatchlistSub('warn')}>⚠ 경고 ({watchlistWarnCount})</button>
        </div>
      )}
      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        {[['ALL', '전체', mCountAll], ['KR', '🇰🇷 국내', mCountKR], ['US', '🇺🇸 해외', mCountUS]].map(([val, label, cnt]) => (
          <button
            key={val}
            onClick={() => setMarketFilter(val)}
            style={{
              flex: 1, padding: '3px 0', fontSize: 10,
              background: marketFilter === val ? 'var(--surface-hover)' : 'transparent',
              border: `1px solid ${marketFilter === val ? 'var(--accent)' : 'var(--border)'}`,
              color: marketFilter === val ? 'var(--accent)' : 'var(--text-3)',
              borderRadius: 3, cursor: 'pointer', lineHeight: 1.6,
            }}
          >
            {label}<br />
            <span style={{ fontSize: 9, opacity: 0.8 }}>({cnt})</span>
          </button>
        ))}
      </div>
      {activeTab === 'ungenerated' && !listLoading && ungeneratedCount > 0 && (
        <button
          onClick={() => generateBatch(ungeneratedTickers.filter(t => { const m = reportList[t]?.market; return marketFilter === 'ALL' || m === marketFilter }))}
          disabled={!!generating}
          style={{
            width: '100%', marginBottom: 8, padding: '5px 0', fontSize: 12,
            background: generating === '__batch__' ? 'var(--bg-elev)' : 'var(--accent)',
            color: generating === '__batch__' ? 'var(--accent)' : 'var(--bg)',
            border: '1px solid var(--accent)', borderRadius: 4, cursor: generating ? 'default' : 'pointer',
          }}
        >
          {generating === '__batch__'
            ? `생성 중 ${genProgress.done}/${genProgress.total || '?'}`
            : `모두 생성 (${tabEntries.length}개)`}
        </button>
      )}
    </>
  )

  const renderTickerItem = (ticker, info) => {
    const isSelected = selected.ticker === ticker && view === 'detail'
    const hasReport = info.dates.length > 0
    const isBroken = hasReport && info.summary?.price == null
    const s = info.summary
    const market = s?.market || info.market
    const rsi = s?.daily_rsi?.rsi
    const targetGap = s?.target_mean && s?.price ? (s.target_mean - s.price) / s.price * 100 : null
    const buy = s?.buy ?? 0, hold = s?.hold ?? 0, sell = s?.sell ?? 0
    const total = buy + hold + sell
    return (
      <div
        key={ticker}
        onClick={() => (hasReport && !isBroken) ? openDetail(ticker, info.dates[0]) : generateOne(ticker)}
        className="report-item"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '8px 10px', borderRadius: 10, cursor: 'pointer', background: isSelected ? 'var(--surface-hover)' : undefined, outline: isSelected ? '2px solid var(--accent)' : undefined, outlineOffset: -1 }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            <span style={{ color: isSelected ? 'var(--accent)' : 'var(--text)', fontWeight: 600, fontSize: 13 }}>{ticker}</span>
            {(() => { const w = overallWeather(s); return w ? <span title={w.label} style={{ fontSize: 12, lineHeight: 1 }}>{w.icon}</span> : null })()}
            {market && (
              <span style={{ fontSize: 9, padding: '0 4px', borderRadius: 2, background: market === 'KR' ? '#1a3a2a' : 'var(--bg-elev-2)', color: market === 'KR' ? '#81c784' : '#4fc3f7', border: `1px solid ${market === 'KR' ? '#2e6b4a' : 'var(--border)'}` }}>
                {market === 'KR' ? '🇰🇷 KR' : '🇺🇸 US'}
              </span>
            )}
          </span>
          {s?.name && (
            <div style={{ color: 'var(--text-3)', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
          )}
          {guruMap[ticker] && (
            <div style={{ color: '#ffb74d', fontSize: 10 }}>구루 {guruMap[ticker]}명</div>
          )}
          {(!hasReport || isBroken) && <div style={{ color: isBroken ? '#ef9a9a' : 'var(--text-3)', fontSize: 10 }}>{isBroken ? '데이터 오류 — 클릭하여 재생성' : '클릭하여 생성'}</div>}
          {hasReport && s && (
            <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: '2px 10px' }}>
              {s.price != null && (
                <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{fmt(s.price, market)}</span>
              )}
              {s.drop_from_high_20d != null && (
                <span style={{ fontSize: 11, color: s.drop_from_high_20d >= 0 ? '#81c784' : '#ef9a9a' }}>
                  고점 {s.drop_from_high_20d >= 0 ? '+' : ''}{s.drop_from_high_20d.toFixed(1)}%
                </span>
              )}
              {targetGap != null && (
                <span style={{ fontSize: 11, color: targetGap >= 0 ? '#81c784' : '#ef9a9a' }}>
                  목표 {fmt(s.target_mean, market)} ({targetGap >= 0 ? '+' : ''}{targetGap.toFixed(1)}%)
                </span>
              )}
              {rsi != null && (
                <span style={{ fontSize: 11, color: rsiColor(rsi) }}>RSI {fmtN(rsi)}</span>
              )}
              {total > 0 && (
                <span style={{ fontSize: 11 }}>
                  <span style={{ color: '#81c784' }}>B{buy}</span>
                  <span style={{ color: 'var(--text-3)' }}>/H{hold}</span>
                  <span style={{ color: '#ef9a9a' }}>/S{sell}</span>
                  {total <= 10 && (
                    <span title={`애널리스트 ${total}명 — 의견 수가 적어 신뢰도가 낮을 수 있습니다`} style={{ color: '#ffb74d', marginLeft: 3, cursor: 'help' }}>⚠{total}</span>
                  )}
                </span>
              )}
            </div>
          )}
          {generating === ticker && genProgress.total > 0 && (
            <div style={{ marginTop: 3 }}>
              <div style={{ background: 'var(--surface-hover)', borderRadius: 2, height: 3, overflow: 'hidden' }}>
                <div style={{ width: `${Math.round(genProgress.done / genProgress.total * 100)}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.4s ease' }} />
              </div>
            </div>
          )}
        </div>
        <button
          onClick={e => { e.stopPropagation(); generateOne(ticker) }}
          disabled={!!generating}
          style={{ background: 'transparent', border: '1px solid var(--border)', color: generating === ticker ? 'var(--accent)' : 'var(--text-3)', borderRadius: 3, padding: '1px 6px', fontSize: 11, cursor: generating ? 'default' : 'pointer', flexShrink: 0, marginTop: 2 }}
        >
          {generating === ticker ? `${genProgress.done}/${genProgress.total || '?'}` : '생성'}
        </button>
      </div>
    )
  }

  return (
    <div className="reports-layout" data-view={view}>
      {/* 좌측 사이드바 */}
      <div className="reports-sidebar">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ color: 'var(--text)', margin: 0 }}>리포트 목록</h3>
        </div>
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: (activeTab === 'watchlist' || activeTab === 'ungenerated') ? 0 : 12 }}>
          <button className={`tab-btn${activeTab === 'holdings' ? ' active' : ''}`} onClick={() => setActiveTab('holdings')}>보유 ({holdingsCount})</button>
          <button className={`tab-btn${activeTab === 'watchlist' ? ' active' : ''}`} onClick={() => setActiveTab('watchlist')}>관심 ({watchlistCount})</button>
          {ungeneratedCount > 0 && (
            <button className={`tab-btn${activeTab === 'ungenerated' ? ' active' : ''}`} onClick={() => setActiveTab('ungenerated')} style={{ color: activeTab === 'ungenerated' ? 'var(--accent)' : '#ffb74d' }}>미생성 ({ungeneratedCount})</button>
          )}
        </div>
        {activeTab === 'watchlist' && (
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 8, marginTop: 4 }}>
            <button
              className="tab-btn sm"
              style={{ color: watchlistSub === 'low' ? '#81c784' : 'var(--text-3)', borderBottomColor: watchlistSub === 'low' ? '#81c784' : 'transparent', fontWeight: watchlistSub === 'low' ? 600 : 400 }}
              onClick={() => setWatchlistSub('low')}
            >목표≥40% ({watchlistLowCount})</button>
            <button
              className="tab-btn sm"
              style={{ color: watchlistSub === 'high' ? '#ef9a9a' : 'var(--text-3)', borderBottomColor: watchlistSub === 'high' ? '#ef9a9a' : 'transparent', fontWeight: watchlistSub === 'high' ? 600 : 400 }}
              onClick={() => setWatchlistSub('high')}
            >목표&lt;40% ({watchlistHighCount})</button>
            <button
              className="tab-btn sm"
              style={{ color: watchlistSub === 'warn' ? '#ffb74d' : 'var(--text-3)', borderBottomColor: watchlistSub === 'warn' ? '#ffb74d' : 'transparent', fontWeight: watchlistSub === 'warn' ? 600 : 400 }}
              onClick={() => setWatchlistSub('warn')}
            >⚠ 경고 ({watchlistWarnCount})</button>
          </div>
        )}
        <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
          {[['ALL', '전체', mCountAll], ['KR', '🇰🇷 국내', mCountKR], ['US', '🇺🇸 해외', mCountUS]].map(([val, label, cnt]) => (
            <button
              key={val}
              onClick={() => setMarketFilter(val)}
              style={{
                flex: 1, padding: '3px 0', fontSize: 10,
                background: marketFilter === val ? 'var(--surface-hover)' : 'transparent',
                border: `1px solid ${marketFilter === val ? 'var(--accent)' : 'var(--border)'}`,
                color: marketFilter === val ? 'var(--accent)' : 'var(--text-3)',
                borderRadius: 3, cursor: 'pointer', lineHeight: 1.6,
              }}
            >
              {label}<br />
              <span style={{ fontSize: 9, opacity: 0.8 }}>({cnt})</span>
            </button>
          ))}
        </div>
        {activeTab === 'ungenerated' && !listLoading && ungeneratedCount > 0 && (
          <button
            onClick={() => generateBatch(ungeneratedTickers.filter(t => { const m = reportList[t]?.market; return marketFilter === 'ALL' || m === marketFilter }))}
            disabled={!!generating}
            style={{
              width: '100%', marginBottom: 8, padding: '5px 0', fontSize: 12,
              background: generating === '__batch__' ? 'var(--bg-elev)' : 'var(--accent)',
              color: generating === '__batch__' ? 'var(--accent)' : 'var(--bg)',
              border: '1px solid var(--accent)', borderRadius: 4, cursor: generating ? 'default' : 'pointer',
            }}
          >
            {generating === '__batch__'
              ? `생성 중 ${genProgress.done}/${genProgress.total || '?'}`
              : `모두 생성 (${tabEntries.length}개)`}
          </button>
        )}
        {listLoading
          ? <LoadingSpinner label="" size={20} style={{ padding: 20 }} />
          : (hasFetched && tabEntries.length === 0)
            ? <p style={{ color: 'var(--text-3)', fontSize: 12 }}>리포트 없음</p>
            : null
        }
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {!listLoading && tabEntries.map(([t, info]) => renderTickerItem(t, info))}
        </div>
      </div>

      {/* 우측 패널 */}
      <div className="reports-main">
        {view === 'list' ? (
          /* 목록화면 */
          listLoading ? (
            <LoadingSpinner label="리포트 불러오는 중입니다." style={{ marginTop: 80 }} />
          ) : (hasFetched && tabEntries.length === 0) ? (
            <div style={{ textAlign: 'center', marginTop: 80, color: 'var(--text-3)' }}>
              <p>리포트가 없습니다.</p>
              <p style={{ marginTop: 8, fontSize: 13 }}>설정 페이지에서 "지금 생성" 버튼을 눌러 첫 리포트를 만드세요.</p>
            </div>
          ) : (
            <table style={{ borderCollapse: 'collapse', color: 'var(--text)', width: '100%' }}>
              <thead>
                <tr style={{ background: 'var(--bg-elev-2)' }}>
                  <th style={{ ...TH, textAlign: 'left', left: 0, zIndex: 3 }}>종목명 (티커)</th>
                  <th style={{ ...TH, textAlign: 'left' }}>시장</th>
                  <th style={{ ...TH, textAlign: 'left' }}>섹터</th>
                  <th style={TH}>현재가</th>
                  <th style={{ ...TH, color: '#ffb74d' }}>20일고점대비</th>
                  <th style={TH}>POC</th>
                  <th style={TH}>평균목표가<br/><span style={{ color: 'var(--text-3)', fontWeight: 400 }}>vs 현재가</span></th>
                  <th style={{ ...TH, color: '#81c784' }}>Buy</th>
                  <th style={TH}>Hold</th>
                  <th style={{ ...TH, color: '#ef9a9a' }}>Sell</th>
                  <th style={TH}>PER<br/><span style={{ color: 'var(--text-3)', fontWeight: 400 }}>Fwd</span></th>
                  <th style={TH}>PBR</th>
                  <th style={TH}>Finviz</th>
                  <th style={{ ...TH, borderLeft: '1px solid var(--border)' }}>RSI<br/><span style={{ color: 'var(--text-3)', fontWeight: 400 }}>일/주/월</span></th>
                  <th style={{ ...TH, color: '#4db6ac' }}>RSI20<br/><span style={{ color: 'var(--text-3)', fontWeight: 400 }}>일/주/월</span></th>
                  <th style={{ ...TH, color: '#4db6ac' }}>RSI25<br/><span style={{ color: 'var(--text-3)', fontWeight: 400 }}>일/주/월</span></th>
                  <th style={{ ...TH, color: '#4db6ac' }}>RSI30<br/><span style={{ color: 'var(--text-3)', fontWeight: 400 }}>일/주/월</span></th>
                  <th style={{ ...TH, color: '#ff8a65' }}>RSI70<br/><span style={{ color: 'var(--text-3)', fontWeight: 400 }}>일/주/월</span></th>
                  <th style={{ ...TH, color: '#ff8a65' }}>RSI75<br/><span style={{ color: 'var(--text-3)', fontWeight: 400 }}>일/주/월</span></th>
                  <th style={{ ...TH, color: '#ff8a65' }}>RSI80<br/><span style={{ color: 'var(--text-3)', fontWeight: 400 }}>일/주/월</span></th>
                </tr>
              </thead>
              <tbody>
                {tabEntries.map(([ticker, info]) => {
                  const s = info.summary
                  const dr = s?.daily_rsi
                  const wr = s?.weekly_rsi
                  const mr = s?.monthly_rsi
                  const rsiKeys = ['target_20', 'target_25', 'target_30', 'target_70', 'target_75', 'target_80']
                  let closestKey = null; let minDiff = Infinity
                  if (s?.price && dr) {
                    rsiKeys.forEach(k => {
                      if (dr[k] == null) return
                      const diff = Math.abs(dr[k] - s.price)
                      if (diff < minDiff) { minDiff = diff; closestKey = k }
                    })
                  }
                  const hasReport = info.dates.length > 0
                  const market = s?.market || info.market
                  return (
                    <tr
                      key={ticker}
                      onClick={() => (hasReport && !isBroken) ? openDetail(ticker, info.dates[0]) : generateOne(ticker)}
                      style={{ cursor: 'pointer', borderBottom: '1px solid var(--border)', opacity: hasReport ? 1 : 0.6 }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-hover)'; e.currentTarget.querySelector('td').style.background = 'var(--surface-hover)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.querySelector('td').style.background = 'var(--bg)' }}
                    >
                      <td style={{ ...TD, textAlign: 'left', color: 'var(--accent)', fontWeight: 600, position: 'sticky', left: 0, zIndex: 1, background: 'var(--bg)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          {s?.name || ticker}
                          {(() => { const w = overallWeather(s); return w ? <span title={w.label} style={{ fontSize: 13, lineHeight: 1, fontWeight: 400 }}>{w.icon}</span> : null })()}
                        </div>
                        <div style={{ color: 'var(--text-3)', fontWeight: 400, fontSize: 11 }}>{ticker}</div>
                        {guruMap[ticker] && <div style={{ color: '#ffb74d', fontSize: 10 }}>구루 {guruMap[ticker]}명</div>}
                        {!hasReport && <div style={{ color: 'var(--text-3)', fontSize: 10 }}>리포트 없음 — 클릭하여 생성</div>}
                      </td>
                      <td style={{ ...TD, textAlign: 'left' }}>
                        {market === 'KR'
                          ? <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: '#1a3a2a', color: '#81c784', border: '1px solid #2e6b4a', whiteSpace: 'nowrap' }}>🇰🇷 KR</span>
                          : <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'var(--bg-elev-2)', color: '#4fc3f7', border: '1px solid var(--border)', whiteSpace: 'nowrap' }}>🇺🇸 US</span>
                        }
                      </td>
                      <td style={{ ...TD, textAlign: 'left', color: 'var(--text-3)', fontSize: 11 }}>
                        <div>{s?.sector || '—'}</div>
                        {s?.industry ? <div style={{ color: 'var(--text-3)', fontSize: 10 }}>{s.industry}</div> : null}
                      </td>
                      <td style={TD}>{s ? fmt(s.price, s.market) : 'N/A'}</td>
                      <td style={TD}>
                        {s?.drop_from_high_20d != null ? (
                          <span style={{ color: s.drop_from_high_20d >= 0 ? '#81c784' : '#ef9a9a', fontWeight: 600 }}>
                            {s.drop_from_high_20d < -10 && <span title="20일 고점 대비 -10% 초과 하락">⚠ </span>}
                            {s.drop_from_high_20d >= 0 ? '+' : ''}{s.drop_from_high_20d.toFixed(1)}%
                          </span>
                        ) : '—'}
                      </td>
                      <td style={TD}>{fmt(s?.volume_profile?.poc, s?.market)}</td>
                      <td style={TD}>
                        <TargetTooltip s={s} />
                      </td>
                      {(() => {
                        const buy = s?.buy ?? 0, hold = s?.hold ?? 0, sell = s?.sell ?? 0
                        const total = buy + hold + sell
                        const pct = (n) => total > 0 ? `(${Math.round(n / total * 100)}%)` : ''
                        const lowAnalysts = s && total > 0 && total <= 10
                        return (<>
                          <td style={{ ...TD, color: '#81c784' }}>
                            {s ? `${buy}${pct(buy)}` : 'N/A'}
                            {lowAnalysts && (
                              <div title={`애널리스트 ${total}명 — 의견 수가 적어 신뢰도가 낮을 수 있습니다`} style={{ color: '#ffb74d', fontSize: 9, marginTop: 1, cursor: 'help' }}>⚠ 총 {total}명</div>
                            )}
                          </td>
                          <td style={TD}>{s ? `${hold}${pct(hold)}` : 'N/A'}</td>
                          <td style={{ ...TD, color: '#ef9a9a' }}>{s ? `${sell}${pct(sell)}` : 'N/A'}</td>
                        </>)
                      })()}
                      <td style={TD}>
                        {s?.per != null ? s.per.toFixed(1) : '—'}
                        {s?.forward_per != null && <div style={{ color: 'var(--text-3)', fontSize: 10 }}>{s.forward_per.toFixed(1)}</div>}
                      </td>
                      <td style={TD}>{s?.pbr != null ? s.pbr.toFixed(2) : '—'}</td>
                      <td style={TD}>{s ? fmtN(s.finviz_recom) : 'N/A'}</td>
                      <td style={{ ...TD, borderLeft: '1px solid var(--border)' }}>
                        <div style={{ color: rsiColor(dr?.rsi), fontWeight: 600 }}>{dr?.rsi != null ? fmtN(dr.rsi) : 'N/A'}</div>
                        <div style={{ color: rsiColor(wr?.rsi), fontSize: 10 }}>{wr?.rsi != null ? fmtN(wr.rsi) : 'N/A'}</div>
                        <div style={{ color: rsiColor(mr?.rsi), fontSize: 10 }}>{mr?.rsi != null ? fmtN(mr.rsi) : 'N/A'}</div>
                      </td>
                      {[
                        { key: 'target_20', dr: dr?.target_20, wr: wr?.target_20, mr: mr?.target_20, base: '#81c784', sub: '#4a8a5a' },
                        { key: 'target_25', dr: dr?.target_25, wr: wr?.target_25, mr: mr?.target_25, base: '#81c784', sub: '#4a8a5a' },
                        { key: 'target_30', dr: dr?.target_30, wr: wr?.target_30, mr: mr?.target_30, base: '#81c784', sub: '#4a8a5a' },
                        { key: 'target_70', dr: dr?.target_70, wr: wr?.target_70, mr: mr?.target_70, base: '#ef9a9a', sub: '#8a4a4a' },
                        { key: 'target_75', dr: dr?.target_75, wr: wr?.target_75, mr: mr?.target_75, base: '#ef9a9a', sub: '#8a4a4a' },
                        { key: 'target_80', dr: dr?.target_80, wr: wr?.target_80, mr: mr?.target_80, base: '#ef9a9a', sub: '#8a4a4a' },
                      ].map(({ key, dr: dv, wr: wv, mr: mv, base, sub }) => {
                        const gapEl = (t, sz) => {
                          if (t == null || !s?.price) return null
                          const p = (t - s.price) / s.price * 100
                          const txt = `(${p >= 0 ? '+' : ''}${p.toFixed(1)}%)`
                          return <span style={{ fontSize: sz ?? 12, color: p >= 0 ? '#81c784' : '#ef9a9a' }}>{txt}</span>
                        }
                        const isClosest = closestKey === key
                        return (
                          <td key={key} style={{ ...TD, color: base, background: isClosest ? 'var(--surface-hover)' : undefined, border: isClosest ? '2px solid var(--accent)' : undefined, fontWeight: isClosest ? 700 : undefined }}>
                            {dv != null ? <div>{fmt(dv, s?.market)}{gapEl(dv)}</div> : <div style={{ color: 'var(--text-3)' }}>N/A</div>}
                            <div style={{ fontSize: 10, color: wv != null ? sub : 'var(--text-3)' }}>{wv != null ? <>{fmt(wv, s?.market)}{gapEl(wv, 9)}</> : 'N/A'}</div>
                            <div style={{ fontSize: 10, color: mv != null ? sub : 'var(--text-3)' }}>{mv != null ? <>{fmt(mv, s?.market)}{gapEl(mv, 9)}</> : 'N/A'}</div>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )
        ) : (
          /* 상세화면 */
          <div>
            <div className="detail-header" style={{ marginBottom: 16 }}>
              {/* 행1: 네비 버튼 */}
              <div className="detail-header-nav">
                <button
                  onClick={() => setView('list')}
                  style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-3)', borderRadius: 4, padding: '4px 12px', fontSize: 12, cursor: 'pointer' }}
                >
                  ← 목록으로
                </button>
                <button
                  onClick={() => generateOne(selected.ticker)}
                  disabled={!!generating}
                  style={{ background: 'transparent', border: '1px solid var(--border)', color: generating === selected.ticker ? 'var(--accent)' : 'var(--text-3)', borderRadius: 4, padding: '4px 12px', fontSize: 12, cursor: generating ? 'default' : 'pointer' }}
                >
                  {generating === selected.ticker ? `${genProgress.done}/${genProgress.total || '?'}` : '생성'}
                </button>
              </div>
              {/* 행2: 종목명 + 뱃지 */}
              <div className="detail-header-title">
                <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: 17 }}>
                  {detail.summary?.name || selected.ticker}
                </span>
                <span style={{ color: 'var(--text-3)', fontSize: 13, marginLeft: 6 }}>({selected.ticker})</span>
                {detail.summary?.market === 'KR'
                  ? <span style={{ fontSize: 10, marginLeft: 6, padding: '1px 5px', borderRadius: 3, background: '#1a3a2a', color: '#81c784', border: '1px solid #2e6b4a' }}>🇰🇷 KR</span>
                  : <span style={{ fontSize: 10, marginLeft: 6, padding: '1px 5px', borderRadius: 3, background: 'var(--bg-elev-2)', color: '#4fc3f7', border: '1px solid var(--border)' }}>🇺🇸 US</span>
                }
                {guruMap[selected.ticker] && (
                  <span style={{ color: '#ffb74d', fontSize: 11, marginLeft: 6, background: '#2a1a00', padding: '2px 7px', borderRadius: 3 }}>
                    구루 {guruMap[selected.ticker]}명
                  </span>
                )}
              </div>
              {/* 행3: 날짜 + 현재가 + 고점대비 */}
              <div className="detail-header-price">
                {reportList[selected.ticker]?.dates?.length > 1 ? (
                  <select
                    value={selected.date}
                    onChange={e => setSelected({ ticker: selected.ticker, date: e.target.value })}
                    style={{ background: 'var(--bg-elev-2)', border: '1px solid var(--border)', color: 'var(--text-3)', borderRadius: 4, padding: '2px 6px', fontSize: 12, cursor: 'pointer' }}
                  >
                    {reportList[selected.ticker].dates.map(d => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                ) : (
                  <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{selected.date}</span>
                )}
                {detail.summary?.price != null && (
                  <span style={{ color: 'var(--text)', fontSize: 16, fontWeight: 700 }}>
                    {fmt(detail.summary.price, detail.summary.market)}
                  </span>
                )}
                {detail.summary?.drop_from_high_20d != null && (
                  <span style={{
                    fontSize: 11, padding: '2px 7px', borderRadius: 3,
                    background: detail.summary.drop_from_high_20d >= 0 ? '#1a3a1a' : '#2a1000',
                    color: detail.summary.drop_from_high_20d >= 0 ? '#81c784' : '#ffb74d',
                  }}>
                    {detail.summary.drop_from_high_20d < -10 && '⚠ '}
                    20일고점 {detail.summary.drop_from_high_20d >= 0 ? '+' : ''}{detail.summary.drop_from_high_20d.toFixed(1)}%
                  </span>
                )}
              </div>
              {/* 행4: 섹터 + PER + PBR */}
              <div className="detail-header-meta">
                {detail.summary?.sector && (
                  <span style={{ color: 'var(--accent)', fontSize: 11, background: 'var(--bg-elev-2)', padding: '2px 7px', borderRadius: 3 }}>
                    {detail.summary.sector}{detail.summary.industry ? ` / ${detail.summary.industry}` : ''}
                  </span>
                )}
                {detail.summary?.per != null && (
                  <span style={{ color: 'var(--text-3)', fontSize: 11, background: 'var(--bg-elev-2)', padding: '2px 7px', borderRadius: 3 }}>
                    PER {detail.summary.per.toFixed(1)}
                    {detail.summary.forward_per != null && <span style={{ marginLeft: 4 }}>/ Fwd {detail.summary.forward_per.toFixed(1)}</span>}
                  </span>
                )}
                {detail.summary?.pbr != null && (
                  <span style={{ color: 'var(--text-3)', fontSize: 11, background: 'var(--bg-elev-2)', padding: '2px 7px', borderRadius: 3 }}>
                    PBR {detail.summary.pbr.toFixed(2)}
                  </span>
                )}
              </div>
            </div>
            {/* 탭 바 */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 16, marginTop: 4 }}>
              {[
                { key: 'summary', label: '📊 요약' },
                { key: 'technical', label: '📈 기술적 분석' },
                { key: 'report', label: '📄 리포트' },
                { key: 'history', label: '📅 히스토리' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setActiveDetailTab(key)}
                  className={`tab-btn${activeDetailTab === key ? ' active' : ''}`}
                  style={{ padding: '6px 16px', fontSize: 12, marginBottom: -1 }}
                >
                  {label}
                </button>
              ))}
            </div>

            {loading && <LoadingSpinner />}
            {!loading && activeDetailTab === 'summary' && (
              detail.summary
                ? <DetailSummaryTab
                    summary={detail.summary}
                    ticker={selected.ticker}
                    onRefreshSuccess={(patched) => {
                      setDetail(prev => ({ ...prev, summary: { ...prev.summary, ...patched } }))
                      fetchList()
                    }}
                  />
                : <p style={{ color: 'var(--text-3)', fontSize: 13 }}>요약 데이터가 없습니다.</p>
            )}
            {!loading && activeDetailTab === 'technical' && (
              detail.summary?.daily_rsi
                ? (
                  <>
                    <RsiTable
                      dailyRsi={detail.summary.daily_rsi}
                      weeklyRsi={detail.summary.weekly_rsi}
                      monthlyRsi={detail.summary.monthly_rsi}
                      price={detail.summary.price}
                      vp={detail.summary.volume_profile}
                      target={detail.summary.target_mean}
                      market={detail.summary.market}
                    />
                  </>
                )
                : <p style={{ color: 'var(--text-3)', fontSize: 13 }}>기술적 분석 데이터가 없습니다.</p>
            )}
            {!loading && activeDetailTab === 'report' && (
              detail.summary
                ? (
                  <div style={{ padding: '0 4px' }}>
                    <ReportSectionCompetitors
                      competitors={detail.summary.competitors_data}
                      market={detail.summary.market}
                      ticker={selected.ticker}
                    />
                    <ReportSectionText title="⚠️ 리스크" text={detail.summary.risks} />
                    <ReportSectionText title="🏰 경제적 해자" text={detail.summary.moat} />
                    <ReportSectionText title="🌱 장기 성장 계획" text={detail.summary.growth_plan} />
                    <ReportSectionNews
                      disclosures={detail.summary.recent_disclosures}
                      news={detail.summary.news}
                    />
                  </div>
                )
                : <p style={{ color: 'var(--text-3)', fontSize: 13 }}>리포트 데이터가 없습니다.</p>
            )}
            {!loading && activeDetailTab === 'history' && (
              <HistoryTab
                ticker={selected.ticker}
                dates={reportList[selected.ticker]?.dates ?? []}
                market={reportList[selected.ticker]?.market ?? 'US'}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
