import { useState, useEffect } from 'react'
import api from '../api'
import LoadingSpinner from '../components/LoadingSpinner'
import { Spark, Sig, sparkFor } from '../components/ui/icons'

export default function Digest() {
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
            <div className="digest-banner">
              <span>⚠ 이상신호 </span>
              {digest.anomalies.map(a => (
                <span key={a.ticker} className={a.change_pct >= 0 ? 'up tnum' : 'down tnum'} style={{ marginLeft: 8 }}>
                  {a.ticker} {a.change_pct >= 0 ? '+' : ''}{a.change_pct.toFixed(1)}%
                </span>
              ))}
            </div>
          )}

          {/* 포트폴리오 요약 */}
          <div className="card" style={{ marginBottom: 12, padding: '12px 16px' }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>포트폴리오 요약</div>
            <div style={{ display: 'flex', gap: 20, alignItems: 'baseline' }}>
              <span className="tnum" style={{ fontSize: 18, fontWeight: 600 }}>
                ₩{(digest.portfolio_summary.total_value_krw ?? digest.portfolio_summary.total_value_usd).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
              <Sig v={digest.portfolio_summary.daily_change_pct} />
            </div>
          </div>

          {/* 종목별 등락 */}
          <div className="digest-list">
            {digest.stocks.map(s => (
              <div key={s.ticker} className="digest-row">
                <div>
                  <span className="tick">{s.ticker}</span>
                  {!s.is_holding && <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>관심</span>}
                  {s.name && s.name !== s.ticker && (
                    <div className="muted" style={{ fontSize: 11, marginTop: 1 }}>{s.name}</div>
                  )}
                </div>
                <Spark data={sparkFor(s.ticker, 30, s.change_pct >= 0 ? 0.3 : -0.3)} w={60} h={20}
                  color={s.change_pct >= 0 ? 'var(--up)' : 'var(--down)'} />
                <Sig v={s.change_pct} />
              </div>
            ))}
          </div>

          {/* 향후 7일 이벤트 */}
          {digest.events_7d.length > 0 && (
            <div className="card" style={{ marginTop: 12, padding: '12px 16px' }}>
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
        </>
      )}
    </div>
  )
}
