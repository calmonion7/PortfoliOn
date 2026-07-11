import IndexSection from '../components/market/IndexSection'
import KospiFuturesSection from '../components/market/KospiFuturesSection'
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

// tab='indicators'(시장지표) | 'flow'(수급지표) — 라우트(/market/indicators, /market/flow)가 지정한다.
export default function Market({ tab = 'indicators' }) {
  return (
    <div style={{ maxWidth: 900 }}>
      {tab === 'indicators' && (
        <>
          <IndexSection />
          <KospiFuturesSection />
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
      {tab === 'flow' && (
        <>
          <LeverageSection />
          <LendingSection />
        </>
      )}
    </div>
  )
}
