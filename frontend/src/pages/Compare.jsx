import { useState, useEffect, useMemo, Fragment } from 'react'
import api from '../api'
import usePortfolioData from '../hooks/usePortfolioData'
import useReportList from '../hooks/useReportList'
import Skeleton from '../components/ui/Skeleton'
import { fmtPrice } from '../utils'

const MAX_SELECT = 4

// 프론트 섹터 정규화 — backend market/format.py:_SECTOR_NORM 미러. US는 yfinance raw,
// KR은 백엔드 정규화라, exact-match 그룹핑 시 US "Financial Services"와 KR "Financials"가
// 딴 그룹으로 갈라진다. 여기서 GICS 표준명으로 통일해 한 그룹으로 병합.
const SECTOR_NORM = {
  'Healthcare': 'Health Care',
  'Financial Services': 'Financials',
  'Consumer Cyclical': 'Consumer Discretionary',
  'Consumer Defensive': 'Consumer Staples',
  'Basic Materials': 'Materials',
}
const OTHER_SECTOR = '기타'
const normSector = (s) => (s ? (SECTOR_NORM[s] || s) : OTHER_SECTOR)

// candidates → [{ sector, rows }] : 섹터별 그룹, 종목 개수 desc(동수는 섹터명 A→Z), '기타' 맨 뒤
export function groupCandidatesBySector(candidates) {
  const map = new Map()
  for (const c of candidates) {
    const sector = normSector(c.sector)
    if (!map.has(sector)) map.set(sector, [])
    map.get(sector).push(c)
  }
  return [...map.entries()]
    .map(([sector, rows]) => ({ sector, rows }))
    .sort((a, b) => {
      if (a.sector === OTHER_SECTOR) return 1
      if (b.sector === OTHER_SECTOR) return -1
      if (b.rows.length !== a.rows.length) return b.rows.length - a.rows.length
      return a.sector.localeCompare(b.sector)
    })
}

const GROUPS = ['valuation', 'financial', 'technical']
const GROUP_LABELS = { valuation: '밸류에이션', financial: '재무', technical: '기술' }
const METRIC_LABELS = {
  per: 'PER', pbr: 'PBR', psr: 'PSR', ev_ebitda: 'EV/EBITDA',
  target_mean: '목표가', upside: '상승여력',
  roe: 'ROE', operating_margin: '영업이익률', debt_ratio: '부채비율', fcf: 'FCF',
  rsi: 'RSI', week52_position: '52주 위치', hv: '역사적 변동성(HV)', beta: '베타 (β)',
}

// 큰 원화/달러 값 축약 — FinancialsChart.fmtValFull과 동일 로직(fcf 표시용)
function fmtBig(v, market) {
  if (v == null || !Number.isFinite(v)) return '—'
  if (market === 'KR') {
    const abs = Math.abs(v)
    if (abs >= 1e12) return `${(v / 1e12).toFixed(2)}조원`
    return `${Math.round(v / 1e8).toLocaleString()}억원`
  }
  const abs = Math.abs(v)
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(0)}M`
  return `$${Math.round(v).toLocaleString()}`
}

function fmtMetric(key, v, market) {
  if (v == null || !Number.isFinite(v)) return '—'
  switch (key) {
    case 'per':
    case 'ev_ebitda':
    case 'rsi':
      return v.toFixed(1)
    case 'pbr':
    case 'psr':
    case 'beta':
      return v.toFixed(2)
    case 'target_mean':
      return fmtPrice(v, market)
    case 'upside':
    case 'roe':
    case 'operating_margin':
    case 'debt_ratio':
    case 'week52_position':
      return `${v.toFixed(1)}%`
    case 'fcf':
      return fmtBig(v, market)
    case 'hv':
      return `${(v * 100).toFixed(1)}%`
    default:
      return String(v)
  }
}

export default function Compare() {
  const { stocks, watchlist, listLoading: portfolioLoading } = usePortfolioData()
  const { reportList, listLoading: reportLoading } = useReportList()

  // 보유+관심 통합 목록 — 티커 중복 제거, 스냅샷(리포트) 유무 표기
  const candidates = useMemo(() => {
    const seen = new Set()
    const rows = []
    for (const s of [...stocks, ...watchlist]) {
      const t = s.ticker?.toUpperCase()
      if (!t || seen.has(t)) continue
      seen.add(t)
      const hasReport = (reportList[t]?.dates?.length ?? 0) > 0
      const sector = reportList[t]?.summary?.sector || ''
      rows.push({ ticker: t, name: s.name || t, market: s.market || 'US', hasReport, sector })
    }
    return rows
  }, [stocks, watchlist, reportList])

  const [selected, setSelected] = useState([])
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const toggle = (ticker) => {
    setSelected(prev => {
      if (prev.includes(ticker)) return prev.filter(t => t !== ticker)
      if (prev.length >= MAX_SELECT) return prev
      return [...prev, ticker]
    })
  }

  useEffect(() => {
    if (selected.length < 2) { setData(null); return }
    let cancelled = false
    setLoading(true)
    setError(null)
    api.get('/api/stocks/compare', { params: { tickers: selected.join(',') } })
      .then(({ data }) => { if (!cancelled) setData(data) })
      .catch(() => { if (!cancelled) setError('비교 데이터를 불러오지 못했습니다.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [selected])

  const marketOf = (ticker) => candidates.find(c => c.ticker === ticker)?.market || 'US'

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>
          비교할 종목을 최대 {MAX_SELECT}개 선택하세요 ({selected.length}/{MAX_SELECT})
        </div>
        {portfolioLoading || reportLoading ? (
          <Skeleton variant="row" count={4} />
        ) : candidates.length === 0 ? (
          <p style={{ color: 'var(--text-3)', fontSize: 13 }}>보유·관심 종목이 없습니다.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {groupCandidatesBySector(candidates).map(g => (
              <div key={g.sector}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', marginBottom: 6 }}>
                  {g.sector} <span style={{ fontWeight: 400 }}>({g.rows.length})</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
                  {g.rows.map(c => {
                    const checked = selected.includes(c.ticker)
                    const disabled = !c.hasReport || (!checked && selected.length >= MAX_SELECT)
                    return (
                      <label
                        key={c.ticker}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                          border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                          background: checked ? 'var(--accent-soft)' : 'var(--bg-elev)',
                          opacity: disabled && !checked ? 0.45 : 1,
                          cursor: disabled && !checked ? 'not-allowed' : 'pointer',
                        }}
                        title={!c.hasReport ? '아직 생성된 리포트가 없어 비교할 수 없습니다.' : undefined}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled && !checked}
                          onChange={() => toggle(c.ticker)}
                          style={{ cursor: 'pointer' }}
                        />
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <span style={{ color: 'var(--text)', fontWeight: 600 }}>{c.name}</span>
                          <span style={{ color: 'var(--text-3)', fontSize: 11, marginLeft: 4 }}>{c.ticker}</span>
                        </span>
                        {!c.hasReport && <span style={{ fontSize: 10, color: 'var(--text-3)', flexShrink: 0 }}>미보고</span>}
                      </label>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selected.length < 2 ? (
        <p style={{ color: 'var(--text-3)', fontSize: 13 }}>2개 이상 선택하면 비교표가 표시됩니다.</p>
      ) : loading ? (
        <Skeleton variant="row" count={6} />
      ) : error ? (
        <p style={{ color: 'var(--color-error)', fontSize: 13 }}>{error}</p>
      ) : data ? (
        // eco: .tbl-wrap/.tbl 재사용(pc.css) — 인라인 표 스타일 대체, num 정렬·행 hover 내장
        // .table-mobile-wrap 병기 — 5열(라벨+최대 4종목)이 좁은 화면에서 넘칠 때 overflow-x:auto로 스크롤 복원(.tbl-wrap 단독은 overflow:hidden)
        <div className="tbl-wrap table-mobile-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>지표</th>
                {data.tickers.map(t => (
                  <th key={t.ticker} className="num" style={{ textTransform: 'none' }}>
                    {t.name}
                    <span style={{ display: 'block', fontSize: 10, color: 'var(--text-3)', fontWeight: 400, textTransform: 'none' }}>{t.ticker}{!t.available && ' · 미보고'}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {GROUPS.map(group => (
                <Fragment key={group}>
                  <tr>
                    <td colSpan={data.tickers.length + 1} style={{ borderBottom: 0, fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>
                      {GROUP_LABELS[group]}
                    </td>
                  </tr>
                  {data.metrics.filter(m => m.group === group).map(m => (
                    <tr key={m.key}>
                      <td style={{ color: 'var(--text-3)' }}>{METRIC_LABELS[m.key] || m.key}</td>
                      {data.tickers.map(t => {
                        const v = m.values[t.ticker]
                        const isBest = m.best.includes(t.ticker)
                        return (
                          <td
                            key={t.ticker}
                            className="num"
                            style={isBest ? { color: 'var(--color-success)', background: 'var(--color-success-soft)', fontWeight: 700 } : undefined}
                          >
                            {fmtMetric(m.key, v, marketOf(t.ticker))}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}
