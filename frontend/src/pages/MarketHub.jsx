import { useState } from 'react'
import Market from './Market'
import Analytics from './Analytics'

export default function MarketHub() {
  const [tab, setTab] = useState('indicators')

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
