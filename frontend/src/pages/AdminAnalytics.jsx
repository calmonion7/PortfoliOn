import { useState, useEffect } from 'react'
import api from '../api'
import LoadingSpinner from '../components/LoadingSpinner'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'

const DAYS_OPTIONS = [
  { label: '7일', value: 7 },
  { label: '30일', value: 30 },
  { label: '전체', value: 9999 },
]

export default function AdminAnalytics() {
  const [days, setDays] = useState(7)
  const [summary, setSummary] = useState(null)
  const [users, setUsers] = useState([])
  const [selectedUser, setSelectedUser] = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [histLoading, setHistLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      api.get(`/api/admin/analytics/summary?days=${days}`),
      api.get('/api/admin/analytics/users'),
    ]).then(([s, u]) => {
      setSummary(s.data)
      setUsers(u.data)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [days])

  const showUserHistory = (userId) => {
    setSelectedUser(userId)
    setHistLoading(true)
    api.get(`/api/admin/analytics/users/${userId}`)
      .then(r => setHistory(r.data))
      .catch(() => setHistory([]))
      .finally(() => setHistLoading(false))
  }

  if (loading) return <LoadingSpinner label="로딩 중..." />

  return (
    <div style={{ padding: '24px 16px', maxWidth: 960, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ color: 'var(--text)', margin: 0 }}>사용자 Analytics</h2>
        <div className="tabs">
          {DAYS_OPTIONS.map(o => (
            <button key={o.value}
              className={days === o.value ? 'is-active' : ''}
              onClick={() => setDays(o.value)}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 32 }}>
          {[
            { label: '오늘 DAU',       value: summary.dau },
            { label: `${days}일 총 이벤트`, value: summary.total_events },
            { label: 'Top 기능',        value: summary.top_events[0]?.name ?? '—' },
          ].map(({ label, value }) => (
            <div key={label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '16px 20px' }}>
              <div style={{ color: 'var(--text-3)', fontSize: 11, marginBottom: 4 }}>{label}</div>
              <div style={{ color: 'var(--text)', fontSize: 22, fontWeight: 700 }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Top Events Bar Chart */}
      {summary?.top_events?.length > 0 && (
        <div style={{ marginBottom: 40 }}>
          <h3 style={{ color: 'var(--text)', marginBottom: 12, fontSize: 14 }}>기능별 사용 랭킹 (상위 10개)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={summary.top_events} margin={{ top: 0, right: 0, bottom: 40, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fill: 'var(--text-3)', fontSize: 11 }} angle={-30} textAnchor="end" interval={0} />
              <YAxis tick={{ fill: 'var(--text-3)', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6 }} />
              <Bar dataKey="count" fill="var(--accent)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Users Table */}
      {selectedUser ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <button onClick={() => setSelectedUser(null)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', color: 'var(--text-3)', fontSize: 12 }}>← 목록</button>
            <h3 style={{ color: 'var(--text)', margin: 0, fontSize: 14 }}>이벤트 히스토리 (최근 200건)</h3>
          </div>
          {histLoading ? <LoadingSpinner label="로딩 중..." /> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['이벤트', 'properties', '시각'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-3)', fontWeight: 500 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 12px', color: 'var(--text)', fontFamily: 'monospace' }}>{row.event_name}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--text-3)', fontFamily: 'monospace' }}>{JSON.stringify(row.properties)}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--text-3)' }}>{row.created_at ? new Date(row.created_at).toLocaleString('ko-KR') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div>
          <h3 style={{ color: 'var(--text)', marginBottom: 12, fontSize: 14 }}>사용자별 통계</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['이메일', '총 이벤트', '마지막 활동', ''].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-3)', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.user_id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 12px', color: 'var(--text)' }}>{u.email}</td>
                  <td style={{ padding: '8px 12px', color: 'var(--text)' }}>{u.total_events}</td>
                  <td style={{ padding: '8px 12px', color: 'var(--text-3)' }}>{u.last_active ? new Date(u.last_active).toLocaleDateString('ko-KR') : '—'}</td>
                  <td style={{ padding: '8px 12px' }}>
                    <button onClick={() => showUserHistory(u.user_id)}
                      style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 10px', cursor: 'pointer', color: 'var(--text-3)', fontSize: 11 }}>
                      상세
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={4} style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)' }}>데이터 없음</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
