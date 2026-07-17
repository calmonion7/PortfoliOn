import { useState, useEffect } from 'react'
import api from '../api'
import Skeleton from '../components/ui/Skeleton'
import Button from '../components/ui/Button'
import { Spark, Sig, sparkFor, fmt } from '../components/ui/icons'
import InsiderBadge from '../components/ui/InsiderBadge'
import useIsMobile from '../hooks/useIsMobile'
import { SketchEmpty, SketchError } from '../components/sketches'

function decodeHtml(str) {
  if (!str) return str
  const txt = document.createElement('textarea')
  txt.innerHTML = str
  return txt.value
}

function StockRow({ s }) {
  return (
    <div className="digest-row anim-fade-up">
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

function NewsItem({ n, nameMap }) {
  return (
    <div style={{ fontSize: 13 }}>
      <span style={{ fontWeight: 600 }}>{n.ticker}</span>
      {nameMap[n.ticker] && nameMap[n.ticker] !== n.ticker && (
        <span className="muted" style={{ fontSize: 11, marginLeft: 4 }}>{nameMap[n.ticker]}</span>
      )}
      <div>
        <a href={n.link} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>{decodeHtml(n.title)}</a>
        <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>— {n.publisher} ({n.published_at})</span>
      </div>
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
  // 뉴스 scope는 digest.stocks의 is_holding에서 파생(모든 news ticker ⊆ stocks). 미매핑은 관심 취급.
  const holdingTickerSet = new Set((digest?.stocks ?? []).filter(s => s.is_holding).map(s => (s.ticker || '').toUpperCase()))
  const holdingNews = (digest?.news ?? []).filter(n => holdingTickerSet.has((n.ticker || '').toUpperCase()))
  const watchNews = (digest?.news ?? []).filter(n => !holdingTickerSet.has((n.ticker || '').toUpperCase()))

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span className="muted" style={{ fontSize: 13 }}>다이제스트 {digest?.date && `· ${digest.date}`}</span>
        <Button variant="secondary" size="sm" icon="↺" onClick={handleRefresh} loading={refreshing} style={{ marginLeft: 'auto' }}>
          {refreshing ? '생성 중…' : '새로고침'}
        </Button>
      </div>

      {error && digest && <div style={{ color: 'var(--color-error)', marginBottom: 12, fontSize: 13 }}>{error}</div>}

      {loading ? (
        <>
          <div style={{ marginBottom: 12 }}>
            <Skeleton variant="chart" height={92} />
          </div>
          <Skeleton variant="row" count={6} />
        </>
      ) : !digest && error ? (
        <div style={{ textAlign: 'center', padding: '48px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div className="sketch-draw" style={{ color: 'var(--text-3)' }}><SketchError size={140} /></div>
          <div className="muted" style={{ fontSize: 14 }}>{error}</div>
          <Button variant="secondary" onClick={handleRefresh} loading={refreshing}>다시 시도</Button>
        </div>
      ) : !digest ? (
        <div style={{ textAlign: 'center', padding: '48px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div className="sketch-draw" style={{ color: 'var(--text-3)' }}><SketchEmpty size={140} /></div>
          <div className="muted" style={{ fontSize: 14 }}>아직 생성된 다이제스트가 없습니다.</div>
          <Button variant="primary" onClick={handleRefresh} loading={refreshing}>
            {refreshing ? '생성 중…' : '다이제스트 생성'}
          </Button>
        </div>
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

          {/* 종목 뉴스 — 보유/관심 분리 */}
          {(digest.news?.length ?? 0) > 0 && (
            <div className="card" style={{ marginBottom: 12, padding: '12px 16px' }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>종목 뉴스</div>
              {[['보유', holdingNews], ['관심', watchNews]].map(([label, list], gi) =>
                list.length === 0 ? null : (
                  <div key={label} style={{ marginTop: gi === 1 && holdingNews.length > 0 ? 12 : 0 }}>
                    <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>{label}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {list.map((n, i) => <NewsItem key={`${n.ticker}-${i}`} n={n} nameMap={nameMap} />)}
                    </div>
                  </div>
                )
              )}
            </div>
          )}

          {/* 보유종목 */}
          {holdings.length > 0 && (
            <>
              <div className="muted" style={{ fontSize: 11, marginBottom: 6, paddingLeft: 2, display: 'flex', justifyContent: 'space-between' }}>
                <span>보유종목</span><span>전일대비</span>
              </div>
              <div className="digest-list anim-stagger" style={{ marginBottom: watchlist.length > 0 ? 16 : 0 }}>
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
              <div className="digest-list anim-stagger">
                {watchlist.map(s => <StockRow key={s.ticker} s={s} />)}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
