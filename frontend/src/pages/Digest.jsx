import { useState, useEffect } from 'react'
import axios from 'axios'

export default function Digest() {
  const [digest, setDigest] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => { fetchLatest() }, [])

  async function fetchLatest() {
    setLoading(true)
    setError(null)
    try {
      const r = await axios.get('/api/digest/latest')
      setDigest(r.data)
    } catch (e) {
      if (e.response?.status !== 404) setError('데이터를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  async function handleRefresh() {
    setRefreshing(true)
    setError(null)
    try {
      const r = await axios.post('/api/digest/generate')
      setDigest(r.data)
    } catch {
      setError('생성에 실패했습니다.')
    } finally {
      setRefreshing(false)
    }
  }

  if (loading) return <div style={{ color: 'var(--text-muted)', padding: 16 }}>로딩 중...</div>

  return (
    <div style={{ maxWidth: 600 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0, color: 'var(--text)' }}>Daily Digest</h2>
        {digest && <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{digest.date}</span>}
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          style={{
            marginLeft: 'auto',
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            borderRadius: 4,
            padding: '4px 10px',
            cursor: refreshing ? 'wait' : 'pointer',
          }}
        >
          {refreshing ? '생성 중...' : '↺ 새로고침'}
        </button>
      </div>

      {error && <div style={{ color: '#e57373', marginBottom: 12 }}>{error}</div>}

      {!digest ? (
        <div style={{ color: 'var(--text-muted)' }}>
          아직 생성된 Digest가 없습니다. 새로고침 버튼을 눌러 생성하세요.
        </div>
      ) : (
        <>
          {digest.anomalies.length > 0 && (
            <div style={{
              background: 'rgba(229,115,115,0.1)',
              border: '1px solid rgba(229,115,115,0.3)',
              borderRadius: 6,
              padding: '10px 14px',
              marginBottom: 12,
            }}>
              <div style={{ color: '#e57373', fontWeight: 600, marginBottom: 6 }}>⚠ 이상신호</div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {digest.anomalies.map(a => (
                  <span key={a.ticker} style={{ color: a.change_pct >= 0 ? '#81c784' : '#e57373', fontSize: 13 }}>
                    {a.ticker} {a.change_pct >= 0 ? '+' : ''}{a.change_pct.toFixed(1)}%
                  </span>
                ))}
              </div>
            </div>
          )}

          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '12px 16px',
            marginBottom: 12,
          }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 6 }}>포트폴리오 요약</div>
            <div style={{ display: 'flex', gap: 20, alignItems: 'baseline' }}>
              <span style={{ color: 'var(--text)', fontSize: 18, fontWeight: 600 }}>
                ${digest.portfolio_summary.total_value_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
              <span style={{
                color: digest.portfolio_summary.daily_change_pct >= 0 ? '#81c784' : '#e57373',
                fontSize: 13,
              }}>
                {digest.portfolio_summary.daily_change_pct >= 0 ? '+' : ''}
                {digest.portfolio_summary.daily_change_pct.toFixed(1)}%
                &nbsp;({digest.portfolio_summary.daily_change_usd >= 0 ? '+' : ''}$
                {Math.abs(digest.portfolio_summary.daily_change_usd).toLocaleString(undefined, { maximumFractionDigits: 0 })})
              </span>
            </div>
          </div>

          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '12px 16px',
            marginBottom: 12,
          }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 8 }}>종목별 등락</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {digest.stocks.map(s => (
                <div key={s.ticker} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text)', fontSize: 13 }}>
                    {s.ticker}
                    {!s.is_holding && (
                      <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 6 }}>관심</span>
                    )}
                  </span>
                  <span style={{ color: s.change_pct >= 0 ? '#81c784' : '#e57373', fontSize: 13 }}>
                    {s.change_pct >= 0 ? '+' : ''}{s.change_pct.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          {digest.events_7d.length > 0 && (
            <div style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '12px 16px',
            }}>
              <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 8 }}>향후 7일 이벤트</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {digest.events_7d.map((ev, i) => (
                  <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 13 }}>
                    <span style={{ color: 'var(--accent)', minWidth: 36 }}>D-{ev.days_until}</span>
                    <span style={{ color: 'var(--text)' }}>{ev.ticker}</span>
                    <span style={{ color: 'var(--text-muted)' }}>
                      {ev.event_type === 'earnings' ? '실적발표' : '배당락일'}
                    </span>
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
