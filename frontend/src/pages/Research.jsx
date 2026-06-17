import { useState } from 'react'
import { trackEvent } from '../utils/analytics'
import Reports from './Reports'
import Calendar from './Calendar'
import Digest from './Digest'
import Ranking from './Ranking'
import Recommendations from './Recommendations'
import useIsMobile from '../hooks/useIsMobile'

export default function Research() {
  const isMobile = useIsMobile()
  const [tab, setTab] = useState('reports')

  if (isMobile) return (
    <>
      <header className="appbar">
        <h1>리서치</h1>
      </header>
      <div className="seg-pad">
        <div className="seg">
          <button className={tab === 'reports' ? 'is-active' : ''} onClick={() => { setTab('reports'); trackEvent('tab_reports') }}>리포트</button>
          <button className={tab === 'recommendations' ? 'is-active' : ''} onClick={() => setTab('recommendations')}>추천</button>
          <button className={tab === 'ranking' ? 'is-active' : ''} onClick={() => { setTab('ranking'); trackEvent('tab_ranking') }}>랭킹</button>
          <button className={tab === 'digest' ? 'is-active' : ''} onClick={() => { setTab('digest'); trackEvent('tab_digest') }}>다이제스트</button>
          <button className={tab === 'calendar' ? 'is-active' : ''} onClick={() => { setTab('calendar'); trackEvent('tab_calendar') }}>캘린더</button>
        </div>
      </div>
      <div className="m-page">
        {tab === 'digest'   && <Digest />}
        {tab === 'reports'  && <Reports />}
        {tab === 'recommendations' && <Recommendations />}
        {tab === 'ranking'  && <Ranking />}
        {tab === 'calendar' && <Calendar />}
      </div>
    </>
  )

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">리서치</h1>
      </div>
      <div className="tabs" style={{ marginBottom: 18, width: 'fit-content' }}>
        <button className={tab === 'reports' ? 'is-active' : ''} onClick={() => { setTab('reports'); trackEvent('tab_reports') }}>리포트</button>
        <button className={tab === 'recommendations' ? 'is-active' : ''} onClick={() => setTab('recommendations')}>추천</button>
        <button className={tab === 'ranking' ? 'is-active' : ''} onClick={() => { setTab('ranking'); trackEvent('tab_ranking') }}>랭킹</button>
        <button className={tab === 'calendar' ? 'is-active' : ''} onClick={() => { setTab('calendar'); trackEvent('tab_calendar') }}>캘린더</button>
        <button className={tab === 'digest' ? 'is-active' : ''} onClick={() => { setTab('digest'); trackEvent('tab_digest') }}>다이제스트</button>
      </div>
      {tab === 'reports'  && <Reports />}
      {tab === 'recommendations' && <Recommendations />}
      {tab === 'ranking'  && <Ranking />}
      {tab === 'calendar' && <Calendar />}
      {tab === 'digest'   && <Digest />}
    </div>
  )
}
