import { isKrMarketOpen, krFreshnessLabel } from '../../utils/marketHours'
import './PriceFreshness.css'

// 시세 freshness 표시: 라이브 배지(KR 장중 점멸) + 마켓별 라벨 + 마지막 갱신 시각.
// dotOnly=false면 라벨+시각까지, true면 점만(컴팩트 위치용).
export default function PriceFreshness({ lastUpdated, showTime = true }) {
  const krOpen = isKrMarketOpen()
  const time = showTime && lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null
  return (
    <span className="price-freshness">
      <span className={`price-freshness__dot${krOpen ? ' is-live' : ''}`} aria-hidden="true" />
      {krFreshnessLabel()}{time ? ` · ${time} 기준` : ''}
    </span>
  )
}
