import { useState } from 'react'
import SectorTab from './SectorTab'
import MacroTab from './MacroTab'
import useIsMobile from '../hooks/useIsMobile'

export default function AnalysisHub() {
  const isMobile = useIsMobile()
  const [tab, setTab] = useState('sector')

  if (isMobile) return (
    <>
      <header className="appbar">
        <h1>분석</h1>
      </header>
      <div className="seg-pad">
        <div className="seg">
          <button className={tab === 'sector' ? 'is-active' : ''} onClick={() => setTab('sector')}>섹터 모멘텀</button>
          <button className={tab === 'macro' ? 'is-active' : ''} onClick={() => setTab('macro')}>매크로</button>
        </div>
      </div>
      <div className="m-page">
        {tab === 'sector' && <SectorTab />}
        {tab === 'macro'  && <MacroTab />}
      </div>
    </>
  )

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">분석</h1>
      </div>
      <div className="tabs" style={{ marginBottom: 20 }}>
        <button className={tab === 'sector' ? 'is-active' : ''} onClick={() => setTab('sector')}>섹터</button>
        <button className={tab === 'macro' ? 'is-active' : ''} onClick={() => setTab('macro')}>매크로</button>
      </div>
      {tab === 'sector' && <SectorTab />}
      {tab === 'macro'  && <MacroTab />}
    </div>
  )
}
