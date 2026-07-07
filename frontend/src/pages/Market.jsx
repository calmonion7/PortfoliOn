import { useState } from 'react'
import IndexSection from '../components/market/IndexSection'
import TreasurySection from '../components/market/TreasurySection'
import FxSection from '../components/market/FxSection'
import VixSection from '../components/market/VixSection'
import FearGreedSection from '../components/market/FearGreedSection'
import CommoditiesSection from '../components/market/CommoditiesSection'
import EconIndicatorsSection from '../components/market/EconIndicatorsSection'
import MacroSignalsSection from '../components/market/MacroSignalsSection'
import KospiSignalSection from '../components/market/KospiSignalSection'
import M7EarningsSection from '../components/market/M7EarningsSection'
import KrTop2Section from '../components/market/KrTop2Section'
import KrExportsSection from '../components/market/KrExportsSection'
import LeverageSection from '../components/market/LeverageSection'
import LendingSection from '../components/market/LendingSection'

export default function Market() {
  const [tab, setTab] = useState('market')

  return (
    <div style={{ maxWidth: 900 }}>
      <div className="tabs" style={{ marginBottom: 18, width: 'fit-content' }}>
        <button className={tab === 'market' ? 'is-active' : ''} onClick={() => setTab('market')}>시장지표</button>
        <button className={tab === 'supply' ? 'is-active' : ''} onClick={() => setTab('supply')}>수급지표</button>
      </div>
      {tab === 'market' && (
        <>
          <IndexSection />
          <TreasurySection />
          <FxSection />
          <VixSection />
          <FearGreedSection />
          <CommoditiesSection />
          <EconIndicatorsSection />
          <MacroSignalsSection />
          <KospiSignalSection />
          <M7EarningsSection />
          <KrTop2Section />
          <KrExportsSection />
        </>
      )}
      {tab === 'supply' && (
        <>
          <LeverageSection />
          <LendingSection />
        </>
      )}
    </div>
  )
}
