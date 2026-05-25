import { useState } from 'react'
import Reports from './Reports'
import Calendar from './Calendar'
import Digest from './Digest'
import useIsMobile from '../hooks/useIsMobile'

export default function Research() {
  const isMobile = useIsMobile()
  const [tab, setTab] = useState('digest')

  if (isMobile) return (
    <>
      <header className="appbar">
        <h1>리서치</h1>
      </header>
      <div className="seg-pad">
        <div className="seg">
          <button className={tab === 'digest' ? 'is-active' : ''} onClick={() => setTab('digest')}>다이제스트</button>
          <button className={tab === 'reports' ? 'is-active' : ''} onClick={() => setTab('reports')}>리포트</button>
          <button className={tab === 'calendar' ? 'is-active' : ''} onClick={() => setTab('calendar')}>캘린더</button>
        </div>
      </div>
      {tab === 'digest'   && <Digest />}
      {tab === 'reports'  && <Reports />}
      {tab === 'calendar' && <Calendar />}
    </>
  )

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">리서치</h1>
      </div>
      <div className="tabs" style={{ marginBottom: 18 }}>
        <button className={tab === 'reports' ? 'is-active' : ''} onClick={() => setTab('reports')}>리포트</button>
        <button className={tab === 'calendar' ? 'is-active' : ''} onClick={() => setTab('calendar')}>캘린더</button>
        <button className={tab === 'digest' ? 'is-active' : ''} onClick={() => setTab('digest')}>다이제스트</button>
      </div>
      {tab === 'reports'  && <Reports />}
      {tab === 'calendar' && <Calendar />}
      {tab === 'digest'   && <Digest />}
    </div>
  )
}
