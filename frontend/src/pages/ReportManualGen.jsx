import { useState, useEffect, useRef } from 'react'
import api from '../api'
import { useAuth } from '../contexts/AuthContext'

// 종목 market을 KR/US 기대날짜 키로 정규화 (비-KR 전부 US).
function marketKey(market) {
  return (market || '').toUpperCase() === 'KR' ? 'KR' : 'US'
}

export default function ReportManualGen() {
  const { role } = useAuth() || { role: null }
  const isAdmin = role === 'admin'

  const [expectedDates, setExpectedDates] = useState(null) // { KR, US } | null

  const [generating, setGenerating] = useState(false)
  const [genMsg, setGenMsg] = useState('')
  const [progress, setProgress] = useState({ done: 0, total: 0, current: '' })
  const pollRef = useRef(null)

  const [stockList, setStockList] = useState(null)
  const [listLoading, setListLoading] = useState(true)
  const [genTab, setGenTab] = useState('pending')
  const [ownerFilter, setOwnerFilter] = useState('all') // 'all' | 'mine' | 'others'
  const [marketFilter, setMarketFilter] = useState('all') // 'all' | 'kr' | 'us'

  const [backfilling, setBackfilling] = useState(false)
  const [backfillMsg, setBackfillMsg] = useState('')
  const [backfillProgress, setBackfillProgress] = useState({ done: 0, total: 0, current: '', created: 0 })
  const backfillPollRef = useRef(null)
  const [backfillDays, setBackfillDays] = useState(60)
  const [backfillForce, setBackfillForce] = useState(false)

  useEffect(() => {
    if (role !== null) loadStockList()
  }, [role]) // eslint-disable-line

  const loadStockList = async () => {
    setListLoading(true)
    try {
      const scopeParam = role === 'admin' ? '?scope=all' : ''
      const { data } = await api.get(`/api/report/list${scopeParam}`)
      setStockList(data.stocks ?? data)
      if (data.last_scheduled_date) setExpectedDates(data.last_scheduled_date)
    } catch (e) {
      console.warn('[ReportManualGen] 종목 목록(/report/list) 조회 실패', e)
    }
    setListLoading(false)
  }

  const { pendingStocks, doneStocks } = (() => {
    if (!stockList) return { pendingStocks: [], doneStocks: [] }
    const pending = [], done = []
    for (const [ticker, info] of Object.entries(stockList)) {
      const name = info.summary?.name || ''
      const market = info.market || ''
      const entry = { ticker, name, is_mine: info.is_mine, market }
      const latestDate = info.dates?.[0]
      // 종목 market의 기대날짜로 미생성/생성 판정 (KR/US 기준일이 다름).
      const expected = expectedDates?.[marketKey(market)]
      if (expected && latestDate && String(latestDate) >= expected) done.push(entry)
      else pending.push(entry)
    }
    const byTicker = (a, b) => a.ticker.localeCompare(b.ticker)
    pending.sort(byTicker); done.sort(byTicker)
    return { pendingStocks: pending, doneStocks: done }
  })()

  const applyOwnerFilter = (stocks) => {
    if (!isAdmin || ownerFilter === 'all') return stocks
    if (ownerFilter === 'mine') return stocks.filter(s => s.is_mine)
    return stocks.filter(s => !s.is_mine)
  }

  const applyMarketFilter = (stocks) => {
    if (marketFilter === 'all') return stocks
    if (marketFilter === 'kr') return stocks.filter(s => (s.market || '').toUpperCase() === 'KR')
    return stocks.filter(s => (s.market || '').toUpperCase() !== 'KR')
  }

  const startPolling = (onDone) => {
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get('/api/report/progress')
        setProgress({ done: data.done, total: data.total, current: data.current })
        if (!data.running && data.total > 0 && data.done >= data.total) {
          clearInterval(pollRef.current)
          setGenerating(false)
          const failed = data.failed || []
          const ok = data.done - failed.length
          if (failed.length > 0) {
            setGenMsg(`완료: ${ok}/${data.total} 생성됨 | 실패 ${failed.length}개: ${failed.map(f => f.error ? `${f.ticker} (${f.error})` : f.ticker).join(', ')}`)
          } else {
            setGenMsg(`완료: ${data.done}/${data.total} 종목 생성됨`)
          }
          onDone?.()
        }
      } catch {}
    }, 1500)
  }

  const handleGenerate = async (targets) => {
    if (targets.length === 0) return
    setGenerating(true)
    setGenMsg('')
    setProgress({ done: 0, total: 0, current: '' })
    const tickerParam = targets.map(s => s.ticker).join(',')
    try {
      // date 생략 → 서버가 종목 market별 기대날짜(KR/US)로 분리 생성한다.
      await api.post(`/api/report/generate?tickers=${encodeURIComponent(tickerParam)}`)
      startPolling(loadStockList)
    } catch (err) {
      setGenMsg(err.response?.data?.detail || '생성 실패')
      setGenerating(false)
    }
  }

  useEffect(() => () => clearInterval(pollRef.current), [])

  const handleBackfill = async () => {
    setBackfilling(true)
    setBackfillMsg('')
    setBackfillProgress({ done: 0, total: 0, current: '', created: 0 })
    clearInterval(backfillPollRef.current)
    try {
      await api.post(`/api/report/backfill?days=${backfillDays}&force=${backfillForce}`)
      backfillPollRef.current = setInterval(async () => {
        try {
          const { data } = await api.get('/api/report/backfill/progress')
          setBackfillProgress(data)
          if (!data.running && data.total > 0 && data.done >= data.total) {
            clearInterval(backfillPollRef.current)
            setBackfilling(false)
            setBackfillMsg(`완료: ${data.created}개 스냅샷 생성`)
          }
        } catch {}
      }, 1500)
    } catch (err) {
      setBackfillMsg(err.response?.data?.detail || '백필 실패')
      setBackfilling(false)
    }
  }

  useEffect(() => () => clearInterval(backfillPollRef.current), [])

  const pct = progress.total > 0 ? Math.round(progress.done / progress.total * 100) : 0
  const secondTabStocks = doneStocks
  const secondTabLabel = '생성됨'
  const rawTabStocks = genTab === 'pending' ? pendingStocks : secondTabStocks
  const currentTabStocks = applyMarketFilter(applyOwnerFilter(rawTabStocks))
  const filteredPending = applyMarketFilter(applyOwnerFilter(pendingStocks))

  return (
    <div style={{ maxWidth: 480 }}>
      {/* 즉시 리포트 생성 */}
      <div className="s-group-h" style={{ paddingLeft: 0, paddingRight: 0, paddingTop: 8 }}>즉시 리포트 생성</div>
      <div className="list-card" style={{ margin: '0 0 6px' }}>
        <div style={{ padding: '10px 12px 0', display: 'flex', gap: 4 }}>
          {[
            { key: 'pending', label: `미생성 (${listLoading ? '…' : pendingStocks.length})` },
            { key: 'done',    label: `${secondTabLabel} (${listLoading ? '…' : secondTabStocks.length})` },
          ].map(({ key, label }) => (
            <button key={key}
              onClick={() => setGenTab(key)}
              style={{
                padding: '6px 14px', border: 'none', borderRadius: 8,
                fontSize: 13, fontWeight: 500, cursor: 'pointer',
                background: genTab === key ? 'var(--text)' : 'var(--accent-soft)',
                color: genTab === key ? 'var(--bg)' : 'var(--text-2)',
              }}>
              {label}
            </button>
          ))}
        </div>

        <div style={{ padding: '8px 12px 0', display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          {isAdmin && (
            <>
              {[
                { key: 'all', label: '전체' },
                { key: 'mine', label: '내꺼' },
                { key: 'others', label: '그외' },
              ].map(({ key, label }) => (
                <button key={key} onClick={() => setOwnerFilter(key)} style={{
                  padding: '3px 10px', border: 'none', borderRadius: 6,
                  fontSize: 12, fontWeight: 500, cursor: 'pointer',
                  background: ownerFilter === key ? 'var(--accent)' : 'var(--accent-soft)',
                  color: ownerFilter === key ? 'var(--bg)' : 'var(--text-2)',
                }}>
                  {label}
                </button>
              ))}
              <span style={{ width: 1, height: 14, background: 'var(--border)', margin: '0 2px', flexShrink: 0 }} />
            </>
          )}
          {[
            { key: 'all', label: '전체' },
            { key: 'kr', label: '국내' },
            { key: 'us', label: '해외' },
          ].map(({ key, label }) => (
            <button key={key} onClick={() => setMarketFilter(key)} style={{
              padding: '3px 10px', border: 'none', borderRadius: 6,
              fontSize: 12, fontWeight: 500, cursor: 'pointer',
              background: marketFilter === key ? 'var(--accent)' : 'var(--accent-soft)',
              color: marketFilter === key ? 'var(--bg)' : 'var(--text-2)',
            }}>
              {label}
            </button>
          ))}
        </div>

        {listLoading ? (
          <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>불러오는 중...</div>
        ) : currentTabStocks.length === 0 ? (
          <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
            {genTab === 'pending' ? `모든 종목의 최신 리포트가 생성되었습니다.` : `${secondTabLabel} 종목이 없습니다.`}
          </div>
        ) : (
          <div style={{ maxHeight: 200, overflowY: 'auto', borderTop: '1px solid var(--border)', marginTop: 8 }}>
            {currentTabStocks.map(({ ticker, name, is_mine }) => (
              <div key={ticker} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '7px 16px', borderBottom: '1px solid var(--border)', fontSize: 13,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: 12, flexShrink: 0 }}>{ticker}</span>
                  {name && <span style={{ color: 'var(--text-3)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>}
                </div>
                {isAdmin && ownerFilter === 'all' && (
                  <span style={{
                    flexShrink: 0, marginLeft: 8, fontSize: 10, fontWeight: 600,
                    padding: '1px 6px', borderRadius: 4,
                    background: is_mine ? 'var(--color-info-soft)' : 'var(--bg-elev-2)',
                    color: is_mine ? 'var(--color-info)' : 'var(--text-faint)',
                  }}>
                    {is_mine ? '나' : '그외'}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
          {genTab === 'pending' ? (
            <>
              <button className="btn btn-primary" onClick={() => handleGenerate(filteredPending)}
                disabled={generating || filteredPending.length === 0}
                style={{ width: '100%', justifyContent: 'center' }}>
                {generating ? '생성 중...' : filteredPending.length > 0 ? `지금 생성 (${filteredPending.length}개)` : '생성할 종목 없음'}
              </button>
              {generating && progress.total > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>
                    <span>{progress.current || '준비 중...'}</span>
                    <span style={{ color: 'var(--text)', fontWeight: 600 }}>{progress.done} / {progress.total}</span>
                  </div>
                  <div style={{ background: 'var(--accent-soft)', borderRadius: 999, height: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: 'var(--text)', borderRadius: 999, transition: 'width 0.4s ease' }} />
                  </div>
                </div>
              )}
              {genMsg && <p style={{ marginTop: 10, color: 'var(--color-success)', fontSize: 13, margin: '10px 0 0' }}>{genMsg}</p>}
            </>
          ) : (
            <>
              <button className="btn btn-primary" onClick={() => handleGenerate(currentTabStocks)}
                disabled={generating || currentTabStocks.length === 0}
                style={{ width: '100%', justifyContent: 'center' }}>
                {generating ? '생성 중...' : currentTabStocks.length > 0 ? `재생성 (${currentTabStocks.length}개)` : '종목 없음'}
              </button>
              {generating && progress.total > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>
                    <span>{progress.current || '준비 중...'}</span>
                    <span style={{ color: 'var(--text)', fontWeight: 600 }}>{progress.done} / {progress.total}</span>
                  </div>
                  <div style={{ background: 'var(--accent-soft)', borderRadius: 999, height: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: 'var(--text)', borderRadius: 999, transition: 'width 0.4s ease' }} />
                  </div>
                </div>
              )}
              {genMsg && <p style={{ marginTop: 10, color: 'var(--color-success)', fontSize: 13, margin: '10px 0 0' }}>{genMsg}</p>}
            </>
          )}
        </div>
      </div>

      {/* 과거 스냅샷 백필 */}
      <div className="s-group-h" style={{ paddingLeft: 0, paddingRight: 0 }}>과거 스냅샷 백필</div>
      <div className="list-card" style={{ margin: '0 0 6px' }}>
        <div style={{ padding: '14px 16px' }}>
          <p style={{ color: 'var(--text-3)', fontSize: 13, margin: '0 0 4px', lineHeight: 1.6 }}>
            지정한 기간만큼 과거 거래일의 스냅샷을 생성합니다. 이미 있는 날짜는 건너뜁니다.
          </p>
          <p style={{ color: 'var(--text-faint)', fontSize: 12, margin: '0 0 16px', lineHeight: 1.5 }}>
            가격·RSI·볼륨프로파일은 실제 이력 데이터, 재무/컨센서스는 현재 데이터를 사용합니다.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <span style={{ fontSize: 13, color: 'var(--text-3)', flexShrink: 0 }}>기간</span>
            <div style={{ flex: 1, display: 'flex', gap: 2, padding: 3, background: 'var(--accent-soft)', borderRadius: 10 }}>
              {[30, 60, 90].map(d => (
                <button key={d} onClick={() => setBackfillDays(d)} style={{
                  flex: 1, border: 0, padding: '7px 0', fontSize: 13, fontWeight: 500,
                  borderRadius: 8, letterSpacing: '-0.01em',
                  background: backfillDays === d ? 'var(--bg-elev)' : 'transparent',
                  color: backfillDays === d ? 'var(--text)' : 'var(--text-3)',
                  boxShadow: backfillDays === d ? 'var(--shadow-sm)' : 'none',
                  cursor: 'pointer',
                }}>
                  {d}일
                </button>
              ))}
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, cursor: 'pointer', fontSize: 13, color: 'var(--text-3)' }}>
            <input type="checkbox" checked={backfillForce} onChange={e => setBackfillForce(e.target.checked)} />
            기존 데이터 덮어쓰기 (잘못 생성된 날짜 재생성)
          </label>
          <button className="btn btn-primary" onClick={handleBackfill} disabled={backfilling}
            style={{ width: '100%', justifyContent: 'center' }}>
            {backfilling ? '백필 중...' : '과거 스냅샷 생성'}
          </button>
          {backfilling && backfillProgress.total > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>
                <span>{backfillProgress.current || '준비 중...'}</span>
                <span style={{ color: 'var(--text)', fontWeight: 600 }}>
                  {backfillProgress.done} / {backfillProgress.total}
                  {backfillProgress.created > 0 && ` (+${backfillProgress.created})`}
                </span>
              </div>
              <div style={{ background: 'var(--accent-soft)', borderRadius: 999, height: 4, overflow: 'hidden' }}>
                <div style={{
                  width: `${Math.round(backfillProgress.done / backfillProgress.total * 100)}%`,
                  height: '100%', background: 'var(--text)', borderRadius: 999, transition: 'width 0.4s ease'
                }} />
              </div>
            </div>
          )}
          {backfillMsg && <p style={{ marginTop: 10, color: 'var(--color-success)', fontSize: 13, margin: '10px 0 0' }}>{backfillMsg}</p>}
        </div>
      </div>
    </div>
  )
}
