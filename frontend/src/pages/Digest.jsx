import { useState, useEffect } from 'react'
import api from '../api'
import LoadingSpinner from '../components/LoadingSpinner'
import { Spark, Sig, sparkFor, fmt } from '../components/ui/icons'
import useIsMobile from '../hooks/useIsMobile'

function StockRow({ s }) {
  return (
    <div className="digest-row">
      <div>
        <span className="tick">{s.ticker}</span>
        {s.name && s.name !== s.ticker && (
          <div className="muted" style={{ fontSize: 11, marginTop: 1 }}>{s.name}</div>
        )}
      </div>
      <Spark data={sparkFor(s.ticker, 30, s.change_pct >= 0 ? 0.3 : -0.3)} w={60} h={20}
        color={s.change_pct >= 0 ? 'var(--up)' : 'var(--down)'} />
      <Sig v={s.change_pct} />
    </div>
  )
}

export default function Digest() {
  const isMobile = useIsMobile()
  const [digest, setDigest] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => { fetchLatest() }, [])

  async function fetchLatest() {
    setLoading(true); setError(null)
    try {
      const r = await api.get('/api/digest/latest')
      setDigest(r.data)
    } catch (e) {
      if (e.response?.status !== 404) setError('데이터를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  async function handleRefresh() {
    setRefreshing(true); setError(null)
    try {
      const r = await api.post('/api/digest/generate')
      setDigest(r.data)
    } catch {
      setError('생성에 실패했습니다.')
    } finally {
      setRefreshing(false)
    }
  }

  if (loading) return <LoadingSpinner label="다이제스트 불러오는 중입니다." />

  const holdings = digest?.stocks?.filter(s => s.is_holding) ?? []
  const watchlist = digest?.stocks?.filter(s => !s.is_holding) ?? []

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span className="muted" style={{ fontSize: 13 }}>Daily Digest {digest?.date && `· ${digest.date}`}</span>
        <button className="btn" onClick={handleRefresh} disabled={refreshing} style={{ marginLeft: 'auto' }}>
          {refreshing ? '생성 중…' : '↺ 새로고침'}
        </button>
      </div>

      {error && <div style={{ color: 'var(--down)', marginBottom: 12, fontSize: 13 }}>{error}</div>}

      {!digest ? (
        <div className="muted">아직 생성된 Digest가 없습니다. 새로고침 버튼을 눌러 생성하세요.</div>
      ) : (
        <>
          {digest.anomalies.length > 0 && (
            <div className="digest-banner" style={{ marginBottom: 12 }}>
              <span>⚠ 이상신호 </span>
              {digest.anomalies.map(a => (
                <span key={a.ticker} className={a.change_pct >= 0 ? 'up tnum' : 'down tnum'} style={{ marginLeft: 8 }}>
                  {a.ticker} {a.change_pct >= 0 ? '+' : ''}{a.change_pct.toFixed(1)}%
                </span>
              ))}
            </div>
          )}

          {/* 포트폴리오 요약 */}
          {isMobile ? (
            <div className="hero" style={{ padding: '8px 0 14px' }}>
              <div className="label">포트폴리오 요약 · {digest.date}</div>
              <div className="val tnum">₩{fmt(digest.portfolio_summary.total_value_krw, 0)}</div>
              <div className={`delta tnum ${digest.portfolio_summary.daily_change_krw >= 0 ? 'up' : 'down'}`}>
                {digest.portfolio_summary.daily_change_krw >= 0 ? '+' : ''}₩{fmt(Math.abs(digest.portfolio_summary.daily_change_krw), 0)}
                <span style={{ marginLeft: 6, fontSize: 13 }}>
                  ({digest.portfolio_summary.daily_change_pct >= 0 ? '+' : ''}{digest.portfolio_summary.daily_change_pct.toFixed(1)}%)
                </span>
              </div>
            </div>
          ) : (
            <div className="card" style={{ marginBottom: 12, padding: '12px 16px' }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>포트폴리오 요약</div>
              <div style={{ display: 'flex', gap: 20, alignItems: 'baseline' }}>
                <span className="tnum" style={{ fontSize: 18, fontWeight: 600 }}>
                  ₩{fmt(digest.portfolio_summary.total_value_krw, 0)}
                </span>
                <Sig v={digest.portfolio_summary.daily_change_pct} />
              </div>
            </div>
          )}

          {/* 향후 7일 이벤트 - 포트폴리오 요약 바로 아래 */}
          {digest.events_7d.length > 0 && (
            <div className="card" style={{ marginBottom: 12, padding: '12px 16px' }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>향후 7일 이벤트</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {digest.events_7d.map((ev, i) => (
                  <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 13 }}>
                    <span className="tnum" style={{ color: 'var(--accent)', minWidth: 36 }}>D-{ev.days_until}</span>
                    <span>{ev.ticker}</span>
                    <span className="muted">{ev.event_type === 'earnings' ? '실적발표' : '배당락일'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 보유종목 */}
          {holdings.length > 0 && (
            <>
              {watchlist.length > 0 && (
                <div className="muted" style={{ fontSize: 11, marginBottom: 6, paddingLeft: 2 }}>보유종목</div>
              )}
              <div className="digest-list" style={{ marginBottom: watchlist.length > 0 ? 16 : 0 }}>
                {holdings.map(s => <StockRow key={s.ticker} s={s} />)}
              </div>
            </>
          )}

          {/* 관심종목 */}
          {watchlist.length > 0 && (
            <>
              <div className="muted" style={{ fontSize: 11, marginBottom: 6, paddingLeft: 2 }}>관심종목</div>
              <div className="digest-list">
                {watchlist.map(s => <StockRow key={s.ticker} s={s} />)}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
