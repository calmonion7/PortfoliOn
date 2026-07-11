import { useState, useEffect } from 'react'
import api from '../api'
import LoadingSpinner from '../components/LoadingSpinner'
import Button from '../components/ui/Button'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'

const EVENT_LABELS = {
  nav_portfolio:    '종목관리',
  nav_research:     '리서치',
  nav_market:       '시장',
  nav_guru:         '구루',
  nav_settings:     '설정',
  tab_holdings:     '보유 탭',
  tab_watch:        '관심 탭',
  tab_dash:         '대시보드 탭',
  tab_analysis:     '분석 탭',
  tab_reports:      '리포트 탭',
  tab_digest:       '다이제스트 탭',
  tab_calendar:     '캘린더 탭',
  report_view_open: '리포트 열기',
  report_tab_switch:'리포트 탭전환',
  stock_search:     '종목 검색',
  stock_add:        '종목 추가',
  stock_delete:     '종목 삭제',
  stock_promote:    '보유 전환',
  report_generate:  '리포트 생성',
  guru_crawl:       '구루 크롤',
}
const eName = (key) => EVENT_LABELS[key] || key

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
    }).catch((e) => { console.warn('[AdminAnalytics] 요약+사용자(/admin/analytics) 조회 실패', e) }).finally(() => setLoading(false))
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
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">사용자 행동</h1>
      </div>
      <div className="tabs" style={{ marginBottom: 24 }}>
        {DAYS_OPTIONS.map(o => (
          <button key={o.value}
            className={days === o.value ? 'is-active' : ''}
            onClick={() => setDays(o.value)}>
            {o.label}
          </button>
        ))}
      </div>

      {/* Summary Cards */}
      {/* eco: .kpi-row는 4열 그리드(Portfolio.jsx 소비)지만 이 화면은 KPI 3개뿐 — 인라인으로 3열 오버라이드 */}
      {summary && (
        <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {[
            { label: '오늘 DAU',       value: summary.dau },
            { label: `${days}일 총 이벤트`, value: summary.total_events },
            { label: 'Top 기능',        value: eName(summary.top_events[0]?.name) ?? '—' },
          ].map(({ label, value }) => (
            <div key={label} className="kpi">
              <div className="label">{label}</div>
              <div className="val">{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Top Events Bar Chart */}
      {summary?.top_events?.length > 0 && (
        <div style={{ marginBottom: 40 }}>
          <h3 style={{ color: 'var(--text)', marginBottom: 12, fontSize: 14 }}>기능별 사용 랭킹 (상위 10개)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={summary.top_events.map(e => ({ ...e, name: eName(e.name) }))} margin={{ top: 0, right: 4, bottom: 40, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fill: 'var(--text-3)', fontSize: 11 }} angle={-30} textAnchor="end" interval={0} />
              <YAxis tick={{ fill: 'var(--text-3)', fontSize: 11 }} width={36}
                tickFormatter={v => v >= 10000 ? `${(v / 10000).toFixed(v % 10000 === 0 ? 0 : 1)}만` : v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}천` : v} />
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
            <Button variant="secondary" size="sm" onClick={() => setSelectedUser(null)}>← 목록</Button>
            <h3 style={{ color: 'var(--text)', margin: 0, fontSize: 14 }}>이벤트 히스토리 (최근 200건)</h3>
          </div>
          {histLoading ? <LoadingSpinner label="로딩 중..." /> : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr><th>이벤트</th><th>properties</th><th>시각</th></tr>
                </thead>
                <tbody>
                  {history.map((row, i) => (
                    <tr key={i}>
                      <td>{eName(row.event_name)}</td>
                      <td className="mono" style={{ color: 'var(--text-3)' }}>{JSON.stringify(row.properties)}</td>
                      <td style={{ color: 'var(--text-3)' }}>{row.created_at ? new Date(row.created_at).toLocaleString('ko-KR') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div>
          <h3 style={{ color: 'var(--text)', marginBottom: 12, fontSize: 14 }}>사용자별 통계</h3>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>이메일</th><th>총 이벤트</th><th>마지막 활동</th><th /></tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.user_id}>
                    <td>{u.email}</td>
                    <td>{u.total_events}</td>
                    <td style={{ color: 'var(--text-3)' }}>{u.last_active ? new Date(u.last_active).toLocaleDateString('ko-KR') : '—'}</td>
                    <td className="actions">
                      <Button variant="ghost" size="sm" onClick={() => showUserHistory(u.user_id)}>상세</Button>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr><td colSpan={4} style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)' }}>데이터 없음</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
