import { useState, useEffect } from 'react'
import axios from 'axios'

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']

const EVENT_STYLE = {
  holding_earnings:  { background: '#1a2a4a', color: '#4fc3f7', border: '1px solid #2a4a6a' },
  holding_dividend:  { background: '#1a3a2a', color: '#81c784', border: '1px solid #2e6b4a' },
  watchlist_earnings: { background: 'transparent', color: '#3a8aaa', border: '1px dashed #2a4a6a' },
  watchlist_dividend: { background: 'transparent', color: '#4a7a5a', border: '1px dashed #2e6b4a' },
}

function MonthGrid({ year, month, events }) {
  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  const firstDay = new Date(year, month - 1, 1).getDay()
  const daysInMonth = new Date(year, month, 0).getDate()
  const cells = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const byDate = {}
  for (const e of events) {
    if (!byDate[e.date]) byDate[e.date] = []
    byDate[e.date].push(e)
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, background: 'var(--border)' }}>
      {DAY_LABELS.map(d => (
        <div key={d} style={{ background: 'var(--bg-surface)', padding: '6px', textAlign: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
          {d}
        </div>
      ))}
      {cells.map((day, i) => {
        const dateStr = day
          ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          : null
        const dayEvents = dateStr ? (byDate[dateStr] || []) : []
        const isToday = dateStr === todayStr
        return (
          <div key={i} style={{ background: day ? 'var(--bg-card)' : 'var(--bg)', minHeight: 72, padding: 4, outline: isToday ? '2px solid var(--accent, #4fc3f7)' : 'none', outlineOffset: -2 }}>
            {day && (
              <div style={{ fontSize: 11, marginBottom: 4, fontWeight: isToday ? 700 : 400, color: isToday ? 'var(--accent, #4fc3f7)' : 'var(--text-muted)' }}>{day}</div>
            )}
            {dayEvents.map((e, j) => {
              const styleKey = `${e.stock_type}_${e.type}`
              const s = EVENT_STYLE[styleKey] || EVENT_STYLE.holding_earnings
              return (
                <div
                  key={j}
                  title={e.name ? `${e.name} (${e.ticker})` : e.ticker}
                  style={{
                    fontSize: 10,
                    padding: '1px 4px',
                    borderRadius: 3,
                    marginBottom: 2,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    cursor: 'default',
                    ...s,
                  }}
                >
                  {e.ticker} {e.type === 'earnings' ? '실적' : '배당락'}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

export default function Calendar() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [fetchKey, setFetchKey] = useState(0)

  const monthStr = `${year}-${String(month).padStart(2, '0')}`

  const adjacentMonths = () => {
    const prev = new Date(year, month - 2, 1)
    const next = new Date(year, month, 1)
    return [prev, next].map(d =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    )
  }

  useEffect(() => {
    setLoading(true)
    setError('')
    axios.get(`/api/calendar?month=${monthStr}`)
      .then(r => {
        setEvents(r.data.events)
        adjacentMonths().forEach(m => axios.get(`/api/calendar?month=${m}`).catch(() => {}))
      })
      .catch(() => setError('이벤트 불러오기 실패'))
      .finally(() => setLoading(false))
  }, [year, month, fetchKey])

  const refresh = () => {
    axios.delete(`/api/calendar/cache?month=${monthStr}`)
      .finally(() => setFetchKey(k => k + 1))
  }

  const prevMonth = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12) }
    else setMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1) }
    else setMonth(m => m + 1)
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={refresh}
            disabled={loading}
            title="캐시 삭제 후 새로고침"
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: loading ? 'default' : 'pointer', padding: '2px 8px', borderRadius: 4, fontSize: 13 }}
          >↺</button>
          <button
            onClick={prevMonth}
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', cursor: 'pointer', padding: '2px 10px', borderRadius: 4, fontSize: 16 }}
          >‹</button>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', minWidth: 90, textAlign: 'center' }}>
            {year}년 {month}월
          </span>
          <button
            onClick={nextMonth}
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', cursor: 'pointer', padding: '2px 10px', borderRadius: 4, fontSize: 16 }}
          >›</button>
        </div>
      </div>

      {loading
        ? <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 48 }}>불러오는 중...</div>
        : error
        ? <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 48 }}>{error}</div>
        : <MonthGrid year={year} month={month} events={events} />
      }

      <div style={{ marginTop: 10, display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
        <span style={{ ...EVENT_STYLE.holding_earnings, padding: '1px 6px', borderRadius: 3 }}>보유 실적</span>
        <span style={{ ...EVENT_STYLE.holding_dividend, padding: '1px 6px', borderRadius: 3 }}>보유 배당락</span>
        <span style={{ ...EVENT_STYLE.watchlist_earnings, padding: '1px 6px', borderRadius: 3 }}>관심 실적</span>
        <span style={{ ...EVENT_STYLE.watchlist_dividend, padding: '1px 6px', borderRadius: 3 }}>관심 배당락</span>
      </div>
    </div>
  )
}
