import { useState, useEffect } from 'react'
import api from '../api'
import Skeleton from '../components/ui/Skeleton'
import { Spark, Sig, sparkFor, fmt } from '../components/ui/icons'
import InsiderBadge from '../components/ui/InsiderBadge'
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

  const holdings = digest?.stocks?.filter(s => s.is_holding) ?? []
  const watchlist = digest?.stocks?.filter(s => !s.is_holding) ?? []
  const nameMap = Object.fromEntries((digest?.stocks ?? []).map(s => [s.ticker, s.name]))

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span className="muted" style={{ fontSize: 13 }}>Daily Digest {digest?.date && `· ${digest.date}`}</span>
        <button className="btn" onClick={handleRefresh} disabled={refreshing} style={{ marginLeft: 'auto' }}>
          {refreshing ? '생성 중…' : '↺ 새로고침'}
        </button>
      </div>

      {error && <div style={{ color: 'var(--color-error)', marginBottom: 12, fontSize: 13 }}>{error}</div>}

      {loading ? (
        <>
          <div style={{ marginBottom: 12 }}>
            <Skeleton variant="chart" height={92} />
          </div>
          <Skeleton variant="row" count={6} />
        </>
      ) : !digest ? (
        <div className="muted">아직 생성된 Digest가 없습니다. 새로고침 버튼을 눌러 생성하세요.</div>
      ) : (
        <>
          {digest.anomalies.length > 0 && (
            <div className="digest-banner" style={{ marginBottom: 12, alignItems: 'flex-start' }}>
              <span style={{ paddingTop: 2 }}>⚠ 이상신호</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
                {digest.anomalies.map(a => (
                  <span key={a.ticker} className={a.change_pct >= 0 ? 'up' : 'down'}
                    style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1.3 }}>
                    <span style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                      <strong className="tnum" style={{ fontSize: 13, fontWeight: 600 }}>{a.ticker}</strong>
                      <span className="tnum" style={{ fontSize: 13 }}>
                        {a.change_pct >= 0 ? '+' : ''}{a.change_pct.toFixed(1)}%
                      </span>
                    </span>
                    {nameMap[a.ticker] && nameMap[a.ticker] !== a.ticker && (
                      <span style={{ fontSize: 10, opacity: 0.75, fontWeight: 400 }}>{nameMap[a.ticker]}</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 포트폴리오 요약 */}
          {(() => {
            const ps = digest.portfolio_summary
            const totalKrw = ps.total_value_krw ?? ps.total_value_usd
            const changeKrw = ps.daily_change_krw ?? null
            const changePct = ps.daily_change_pct
            const isUp = (changeKrw ?? changePct ?? 0) >= 0
            return (
              <div className="card" style={{ marginBottom: 12, padding: '14px 18px' }}>
                <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                  보유종목 평가금액 · {digest.date}
                </div>
                <div className="tnum" style={{ fontSize: isMobile ? 28 : 22, fontWeight: 700, letterSpacing: '-0.03em' }}>
                  ₩{fmt(totalKrw, 0)}
                </div>
                <div className={`tnum ${isUp ? 'up' : 'down'}`} style={{ fontSize: 13, marginTop: 5 }}>
                  {changeKrw != null ? (
                    <>
                      {changeKrw >= 0 ? '+' : ''}₩{fmt(Math.abs(changeKrw), 0)}
                      <span style={{ marginLeft: 6 }}>({changePct >= 0 ? '+' : ''}{changePct.toFixed(1)}%)</span>
                    </>
                  ) : (
                    <Sig v={changePct} />
                  )}
                  <span className="muted" style={{ marginLeft: 6, fontWeight: 400 }}>전일대비</span>
                </div>
              </div>
            )
          })()}

          {/* 향후 7일 이벤트 - 포트폴리오 요약 바로 아래 */}
          {digest.events_7d.length > 0 && (
            <div className="card" style={{ marginBottom: 12, padding: '12px 16px' }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>향후 7일 이벤트</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {digest.events_7d.map((ev, i) => (
                  <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 13 }}>
                    <span className="tnum" style={{ color: 'var(--accent)', minWidth: 36 }}>D-{ev.days_until}</span>
                    <span>{ev.ticker}</span>
                    {nameMap[ev.ticker] && nameMap[ev.ticker] !== ev.ticker && (
                      <span className="muted" style={{ fontSize: 11 }}>{nameMap[ev.ticker]}</span>
                    )}
                    <span className="muted">{ev.event_type === 'earnings' ? '실적발표' : '배당락일'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 내부자 순매수 종목 */}
          {(digest.insider_trades?.length ?? 0) > 0 && (
            <div className="card" style={{ marginBottom: 12, padding: '12px 16px' }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>내부자 지분공시</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {digest.insider_trades.map((it, i) => (
                  <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 13 }}>
                    <span>{it.ticker}</span>
                    {nameMap[it.ticker] && nameMap[it.ticker] !== it.ticker && (
                      <span className="muted" style={{ fontSize: 11 }}>{nameMap[it.ticker]}</span>
                    )}
                    <InsiderBadge direction={it.direction} />
                    {it.net_shares != null && (
                      <span className="muted tnum" style={{ fontSize: 12, marginLeft: 'auto' }}>
                        {it.net_shares >= 0 ? '+' : '−'}{Math.abs(it.net_shares).toLocaleString()}주
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 보유종목 */}
          {holdings.length > 0 && (
            <>
              <div className="muted" style={{ fontSize: 11, marginBottom: 6, paddingLeft: 2, display: 'flex', justifyContent: 'space-between' }}>
                <span>보유종목</span><span>전일대비</span>
              </div>
              <div className="digest-list" style={{ marginBottom: watchlist.length > 0 ? 16 : 0 }}>
                {holdings.map(s => <StockRow key={s.ticker} s={s} />)}
              </div>
            </>
          )}

          {/* 관심종목 */}
          {watchlist.length > 0 && (
            <>
              <div className="muted" style={{ fontSize: 11, marginBottom: 6, paddingLeft: 2, display: 'flex', justifyContent: 'space-between' }}>
                <span>관심종목</span><span>전일대비</span>
              </div>
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
