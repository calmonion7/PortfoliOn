import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { trackEvent } from '../utils/analytics'
import Reports from './Reports'
import Calendar from './Calendar'
import Digest from './Digest'
import Ranking from './Ranking'
import Recommendations from './Recommendations'
import Compare from './Compare'
import useIsMobile from '../hooks/useIsMobile'

export default function Research() {
  const isMobile = useIsMobile()
  const location = useLocation()
  const [tab, setTab] = useState(location.state?.tab || 'reports')
  // 추천 '분석 보기' 딥링크 대상 종목 — 수동 탭 전환 시 해제(재진입 반복 방지)
  const [deepTicker, setDeepTicker] = useState(location.state?.ticker || null)

  // 같은 라우트('/') 재네비게이션은 재마운트가 없어 location.state 변화에 직접 반응해야 한다 (task#131)
  useEffect(() => {
    if (location.state?.tab) setTab(location.state.tab)
    if (location.state?.ticker) setDeepTicker(location.state.ticker)
  }, [location.state])

  const go = (t, evt) => {
    setTab(t)
    setDeepTicker(null)
    if (evt) trackEvent(evt)
  }

  if (isMobile) return (
    <>
      <header className="appbar">
        <h1>리서치</h1>
      </header>
      <div className="seg-pad">
        <div className="seg">
          <button className={tab === 'reports' ? 'is-active' : ''} onClick={() => go('reports', 'tab_reports')}>리포트</button>
          <button className={tab === 'recommendations' ? 'is-active' : ''} onClick={() => go('recommendations')}>추천</button>
          <button className={tab === 'ranking' ? 'is-active' : ''} onClick={() => go('ranking', 'tab_ranking')}>랭킹</button>
          <button className={tab === 'compare' ? 'is-active' : ''} onClick={() => go('compare', 'tab_compare')}>비교</button>
          <button className={tab === 'digest' ? 'is-active' : ''} onClick={() => go('digest', 'tab_digest')}>다이제스트</button>
          <button className={tab === 'calendar' ? 'is-active' : ''} onClick={() => go('calendar', 'tab_calendar')}>캘린더</button>
        </div>
      </div>
      <div className="m-page">
        {tab === 'digest'   && <Digest />}
        {tab === 'reports'  && <Reports initialTicker={deepTicker} />}
        {tab === 'recommendations' && <Recommendations />}
        {tab === 'ranking'  && <Ranking />}
        {tab === 'compare'  && <Compare />}
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
        <button className={tab === 'reports' ? 'is-active' : ''} onClick={() => go('reports', 'tab_reports')}>리포트</button>
        <button className={tab === 'recommendations' ? 'is-active' : ''} onClick={() => go('recommendations')}>추천</button>
        <button className={tab === 'ranking' ? 'is-active' : ''} onClick={() => go('ranking', 'tab_ranking')}>랭킹</button>
        <button className={tab === 'compare' ? 'is-active' : ''} onClick={() => go('compare', 'tab_compare')}>비교</button>
        <button className={tab === 'calendar' ? 'is-active' : ''} onClick={() => go('calendar', 'tab_calendar')}>캘린더</button>
        <button className={tab === 'digest' ? 'is-active' : ''} onClick={() => go('digest', 'tab_digest')}>다이제스트</button>
      </div>
      {tab === 'reports'  && <Reports initialTicker={deepTicker} />}
      {tab === 'recommendations' && <Recommendations />}
      {tab === 'ranking'  && <Ranking />}
      {tab === 'compare'  && <Compare />}
      {tab === 'calendar' && <Calendar />}
      {tab === 'digest'   && <Digest />}
    </div>
  )
}
