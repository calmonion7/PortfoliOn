import { useState, useEffect } from 'react'
import api from '../api'
import LoadingSpinner from '../components/LoadingSpinner'

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']

const EVENT_STYLE = {
  holding_earnings:   { background: 'var(--cal-earn-hold-bg)',  color: 'var(--cal-earn-hold-color)',  border: '1px solid var(--cal-earn-hold-border)' },
  holding_dividend:   { background: 'var(--cal-div-hold-bg)',   color: 'var(--cal-div-hold-color)',   border: '1px solid var(--cal-div-hold-border)' },
  watchlist_earnings: { background: 'transparent',              color: 'var(--cal-earn-wl-color)',    border: '1px dashed var(--cal-earn-wl-border)' },
  watchlist_dividend: { background: 'transparent',              color: 'var(--cal-div-wl-color)',     border: '1px dashed var(--cal-div-wl-border)' },
  holiday_us:         { background: 'var(--cal-hol-us-bg)',     color: 'var(--cal-hol-us-color)',     border: '1px solid var(--cal-hol-us-border)' },
  holiday_kr:         { background: 'var(--cal-hol-kr-bg)',     color: 'var(--cal-hol-kr-color)',     border: '1px solid var(--cal-hol-kr-border)' },
}

const EVENT_ICON = {
  holding_earnings:   '📈',
  holding_dividend:   '💰',
  watchlist_earnings: '📊',
  watchlist_dividend: '💵',
  holiday_us:         '🇺🇸',
  holiday_kr:         '🇰🇷',
}

function eventKey(e) {
  return e.type === 'holiday_us' || e.type === 'holiday_kr' ? e.type : `${e.stock_type}_${e.type}`
}

function MonthGrid({ year, month, events }) {
  const [selectedDate, setSelectedDate] = useState(null)

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

  const selectedEvents = selectedDate ? (byDate[selectedDate] || []) : []

  const fmtDate = (dateStr) => {
    if (!dateStr) return ''
    const [, m, d] = dateStr.split('-')
    const dow = DAY_LABELS[new Date(dateStr).getDay()]
    return `${parseInt(m)}월 ${parseInt(d)}일 (${dow})`
  }

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, background: 'var(--border)' }}>
        {DAY_LABELS.map(d => (
          <div key={d} style={{ background: 'var(--bg-elev-2)', padding: '6px', textAlign: 'center', fontSize: 11, color: 'var(--text-3)' }}>
            {d}
          </div>
        ))}
        {cells.map((day, i) => {
          const dateStr = day
            ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            : null
          const dayEvents = dateStr ? (byDate[dateStr] || []) : []
          const isToday = dateStr === todayStr
          const isSelected = dateStr === selectedDate
          return (
            <div
              key={i}
              onClick={() => {
                if (!day || dayEvents.length === 0) return
                setSelectedDate(isSelected ? null : dateStr)
              }}
              style={{
                background: day ? 'var(--bg-elev)' : 'var(--bg)',
                aspectRatio: '1 / 1',
                padding: 4,
                overflow: 'hidden',
                cursor: day && dayEvents.length > 0 ? 'pointer' : 'default',
                outline: isToday ? '2px solid var(--accent)' : 'none',
                outlineOffset: -2,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {day && (
                <div style={{ fontSize: 11, fontWeight: isToday ? 700 : 400, color: isToday ? 'var(--accent)' : 'var(--text-3)' }}>
                  {day}
                </div>
              )}
              {dayEvents.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 1, marginTop: 'auto' }}>
                  {dayEvents.slice(0, 4).map((e, j) => (
                    <span key={j} style={{ fontSize: 11, lineHeight: 1 }}>
                      {EVENT_ICON[eventKey(e)] || '●'}
                    </span>
                  ))}
                  {dayEvents.length > 4 && (
                    <span style={{ fontSize: 8, color: 'var(--text-3)', lineHeight: '12px' }}>+{dayEvents.length - 4}</span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {selectedDate && selectedEvents.length > 0 && (
        <div
          onClick={() => setSelectedDate(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg-elev)', border: '1px solid var(--border)',
              borderRadius: 12, overflow: 'hidden', minWidth: 280, maxWidth: 400, width: '90%',
              maxHeight: '80vh', display: 'flex', flexDirection: 'column',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{fmtDate(selectedDate)}</span>
              <button onClick={() => setSelectedDate(null)} style={{ background: 'none', border: 'none', color: 'var(--text-3)', fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: '0 2px' }}>×</button>
            </div>
            <div style={{ overflowY: 'auto' }}>
              {selectedEvents.map((e, i) => {
                const key = eventKey(e)
                const s = EVENT_STYLE[key] || EVENT_STYLE.holding_earnings
                const isHoliday = e.type === 'holiday_us' || e.type === 'holiday_kr'
                return (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px',
                    borderBottom: i < selectedEvents.length - 1 ? '1px solid var(--border)' : 'none',
                  }}>
                    <span style={{ fontSize: 18, flexShrink: 0 }}>{EVENT_ICON[key] || '●'}</span>
                    <span style={{ ...s, padding: '2px 8px', borderRadius: 4, fontSize: 11, whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {isHoliday ? (e.type === 'holiday_us' ? 'NYSE 휴장' : 'KRX 휴장') : e.type === 'earnings' ? '실적' : '배당락'}
                    </span>
                    {!isHoliday && e.ticker && (
                      <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--accent)' }}>{e.ticker}</span>
                    )}
                    {!isHoliday && (
                      <span style={{ fontSize: 12, color: 'var(--text-3)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {e.name || ''}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
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
  const [refreshErr, setRefreshErr] = useState('')

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
    api.get(`/api/calendar?month=${monthStr}`)
      .then(r => {
        setEvents(r.data.events)
        adjacentMonths().forEach(m => api.get(`/api/calendar?month=${m}`).catch(() => {}))
      })
      .catch(() => setError('이벤트 불러오기 실패'))
      .finally(() => setLoading(false))
  }, [year, month, fetchKey])

  const refresh = () => {
    setRefreshErr('')
    api.delete(`/api/calendar/cache?month=${monthStr}`)
      .then(() => setFetchKey(k => k + 1))
      .catch(() => setRefreshErr('새로고침 실패'))
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
          <button onClick={refresh} disabled={loading} title="캐시 삭제 후 새로고침"
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-3)', cursor: loading ? 'default' : 'pointer', padding: '2px 8px', borderRadius: 4, fontSize: 13 }}>↺</button>
          {refreshErr && <span style={{ fontSize: 11, color: 'var(--error, #ef5350)' }}>{refreshErr}</span>}
          <button onClick={prevMonth}
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', cursor: 'pointer', padding: '2px 10px', borderRadius: 4, fontSize: 16 }}>‹</button>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', minWidth: 90, textAlign: 'center' }}>
            {year}년 {month}월
          </span>
          <button onClick={nextMonth}
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', cursor: 'pointer', padding: '2px 10px', borderRadius: 4, fontSize: 16 }}>›</button>
        </div>
      </div>

      {loading
        ? <LoadingSpinner label="캘린더 불러오는 중입니다." />
        : error
        ? <div style={{ color: 'var(--text-3)', textAlign: 'center', padding: 48 }}>{error}</div>
        : <MonthGrid year={year} month={month} events={events} />
      }

      <div style={{ marginTop: 10, display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-3)', flexWrap: 'wrap' }}>
        <span style={{ ...EVENT_STYLE.holding_earnings,   padding: '1px 6px', borderRadius: 3 }}>보유 실적</span>
        <span style={{ ...EVENT_STYLE.holding_dividend,   padding: '1px 6px', borderRadius: 3 }}>보유 배당락</span>
        <span style={{ ...EVENT_STYLE.watchlist_earnings, padding: '1px 6px', borderRadius: 3 }}>관심 실적</span>
        <span style={{ ...EVENT_STYLE.watchlist_dividend, padding: '1px 6px', borderRadius: 3 }}>관심 배당락</span>
        <span style={{ ...EVENT_STYLE.holiday_us,         padding: '1px 6px', borderRadius: 3 }}>NYSE 휴장</span>
        <span style={{ ...EVENT_STYLE.holiday_kr,         padding: '1px 6px', borderRadius: 3 }}>KRX 휴장</span>
      </div>
    </div>
  )
}
