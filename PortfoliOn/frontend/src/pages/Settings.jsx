import { useState } from 'react'
import ReportSchedule from './ReportSchedule'
import GuruManagers from './GuruManagers'
import GuruStats from './GuruStats'
import GuruCrawlSettings from './GuruCrawlSettings'

const TOP_TABS  = [{ key: 'report', label: '리포트 스케줄' }, { key: 'guru', label: '구루 매니저' }]
const GURU_TABS = [{ key: 'managers', label: '매니저 목록' }, { key: 'stats', label: '추천 통계' }, { key: 'crawl', label: '크롤링 설정' }]

export default function Settings() {
  const [tab, setTab]         = useState('report')
  const [guruTab, setGuruTab] = useState('managers')

  const topTabStyle = (active) => ({
    padding: '8px 16px', border: 'none',
    borderBottom: active ? '2px solid #4fc3f7' : '2px solid transparent',
    background: 'none', color: active ? '#4fc3f7' : '#888',
    cursor: 'pointer', fontWeight: active ? 600 : 400, fontSize: 14,
  })

  const subTabStyle = (active) => ({
    padding: '6px 14px', borderRadius: 16,
    border: `1px solid ${active ? '#4fc3f7' : '#444'}`,
    background: active ? '#1565c0' : 'transparent',
    color: active ? 'white' : '#888',
    cursor: 'pointer', fontSize: 13,
  })

  return (
    <div style={{ maxWidth: 800 }}>
      <h1 style={{ color: '#90caf9', marginBottom: 20 }}>설정</h1>

      <div style={{ display: 'flex', borderBottom: '1px solid #333', marginBottom: 24 }}>
        {TOP_TABS.map(t => (
          <button key={t.key} style={topTabStyle(tab === t.key)} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'report' && <ReportSchedule />}

      {tab === 'guru' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            {GURU_TABS.map(t => (
              <button key={t.key} style={subTabStyle(guruTab === t.key)} onClick={() => setGuruTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>
          {guruTab === 'managers' && <GuruManagers />}
          {guruTab === 'stats'    && <GuruStats />}
          {guruTab === 'crawl'    && <GuruCrawlSettings />}
        </div>
      )}
    </div>
  )
}
