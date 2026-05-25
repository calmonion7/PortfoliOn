import { useState } from 'react'
import Market from './Market'
import Analytics from './Analytics'
import useIsMobile from '../hooks/useIsMobile'

export default function MarketHub() {
  const isMobile = useIsMobile()
  const [tab, setTab] = useState('indicators')

  if (isMobile) return (
    <>
      <header className="appbar">
        <h1>시장</h1>
      </header>
      <div className="seg-pad">
        <div className="seg">
          <button className={tab === 'indicators' ? 'is-active' : ''} onClick={() => setTab('indicators')}>시장지표</button>
          <button className={tab === 'analytics' ? 'is-active' : ''} onClick={() => setTab('analytics')}>포트폴리오 분석</button>
        </div>
      </div>
      <div className="m-page">
        {tab === 'indicators' && <Market />}
        {tab === 'analytics'  && <Analytics />}
      </div>
    </>
  )

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">시장</h1>
      </div>
      <div className="tabs" style={{ marginBottom: 20 }}>
        <button className={tab === 'indicators' ? 'is-active' : ''} onClick={() => setTab('indicators')}>시장지표</button>
        <button className={tab === 'analytics' ? 'is-active' : ''} onClick={() => setTab('analytics')}>분석</button>
      </div>
      {tab === 'indicators' && <Market />}
      {tab === 'analytics'  && <Analytics />}
    </div>
  )
}
