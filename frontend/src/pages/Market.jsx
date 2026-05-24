import TreasurySection from '../components/market/TreasurySection'
import FxSection from '../components/market/FxSection'
import VixSection from '../components/market/VixSection'
import CommoditiesSection from '../components/market/CommoditiesSection'
import EconIndicatorsSection from '../components/market/EconIndicatorsSection'
import M7EarningsSection from '../components/market/M7EarningsSection'
import KrTop2Section from '../components/market/KrTop2Section'
import KrExportsSection from '../components/market/KrExportsSection'

export default function Market() {
  return (
    <div style={{ maxWidth: 900 }}>
      <h2 style={{ color: 'var(--text)', marginBottom: 24 }}>시장지표</h2>
      <TreasurySection />
      <FxSection />
      <VixSection />
      <CommoditiesSection />
      <EconIndicatorsSection />
      <M7EarningsSection />
      <KrTop2Section />
      <KrExportsSection />
    </div>
  )
}
