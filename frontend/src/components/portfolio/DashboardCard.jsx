import Card from '../ui/Card'
import './DashboardCard.css'
import { MarketBadge, ChangeBadge } from '../ui/Badge'
import { fmtPrice } from '../../utils'
import FlashValue from './FlashValue'

const _weather = (score) => {
  if (score <= 0) return { icon: '☀️', label: '맑음' }
  if (score <= 1) return { icon: '⛅', label: '구름 조금' }
  if (score <= 2) return { icon: '☁️', label: '흐림' }
  return { icon: '🌧️', label: '비' }
}

const overallWeather = (item) => {
  const scores = []
  if (item.current_price && item.target_mean) {
    const gap = (item.target_mean - item.current_price) / item.current_price * 100
    const total = (item.buy ?? 0) + (item.hold ?? 0) + (item.sell ?? 0)
    const buyPct = total > 0 ? (item.buy ?? 0) / total * 100 : 50
    if (gap >= 15 && buyPct >= 60) scores.push(0)
    else if (gap >= 5 && buyPct >= 45) scores.push(1)
    else if (gap >= -5) scores.push(2)
    else scores.push(3)
  }
  if (item.rsi != null) {
    if (item.rsi < 30) scores.push(0)
    else if (item.rsi < 45) scores.push(1)
    else if (item.rsi < 65) scores.push(2)
    else scores.push(3)
  }
  if (!scores.length) return null
  return _weather(Math.round(scores.reduce((a, b) => a + b, 0) / scores.length))
}

export default function DashboardCard({ item, tick }) {
  const weather = overallWeather(item)
  const pnlPct = item.current_price != null && item.avg_cost != null
    ? (item.current_price - item.avg_cost) / item.avg_cost * 100
    : null
  const consPct = item.current_price && item.target_mean
    ? (item.target_mean - item.current_price) / item.current_price * 100
    : null
  const consClass = consPct == null ? '' : consPct >= 0 ? 'up' : 'down'

  return (
    <Card>
      <div className="dashcard__header">
        {weather && <span className="dashcard__weather" title={weather.label}>{weather.icon}</span>}
        <strong className="dashcard__ticker">{item.ticker}</strong>
        <MarketBadge market={item.market || 'US'} exchange={item.exchange || ''} />
      </div>
      <div className="dashcard__name">{item.name}</div>
      <FlashValue as="div" className="dashcard__price-row" value={item.current_price} tick={tick}>
        <span className="dashcard__price tnum">
          {item.current_price == null ? '—' : fmtPrice(item.current_price, item.market)}
        </span>
        <ChangeBadge value={item.daily_change_pct} />
      </FlashValue>
      <div className="dashcard__change-row">
        <span className="dashcard__change-label">주간</span>
        <ChangeBadge value={item.weekly_change_pct} />
        <span className="dashcard__change-label">월간</span>
        <ChangeBadge value={item.monthly_change_pct} />
      </div>
      <div className="dashcard__stats">
        <div className="dashcard__stat">
          <span className="dashcard__stat-label">수익률</span>
          <ChangeBadge value={pnlPct} />
        </div>
        <div className="dashcard__stat">
          <span className="dashcard__stat-label">RSI</span>
          <span className="dashcard__stat-value tnum">
            {item.rsi != null ? item.rsi.toFixed(1) : '—'}
          </span>
        </div>
        <div className="dashcard__stat dashcard__stat--full">
          <span className="dashcard__stat-label">컨센서스</span>
          <span className={`dashcard__stat-value tnum ${consClass}`}>
            {consPct != null
              ? `${consPct >= 0 ? '+' : ''}${consPct.toFixed(0)}% · ${fmtPrice(item.target_mean, item.market)}`
              : '—'}
          </span>
        </div>
        <div className="dashcard__stat">
          <span className="dashcard__stat-label">POC</span>
          <span className="dashcard__stat-value tnum">
            {item.poc != null ? fmtPrice(item.poc, item.market) : '—'}
          </span>
        </div>
        <div className="dashcard__stat">
          <span className="dashcard__stat-label">VAH</span>
          <span className="dashcard__stat-value tnum">
            {item.vah != null ? fmtPrice(item.vah, item.market) : '—'}
          </span>
        </div>
        <div className="dashcard__stat">
          <span className="dashcard__stat-label">VAL</span>
          <span className="dashcard__stat-value tnum">
            {item.val != null ? fmtPrice(item.val, item.market) : '—'}
          </span>
        </div>
        <div className="dashcard__stat dashcard__stat--full">
          <span className="dashcard__stat-label">HVN</span>
          <span className="dashcard__stat-value tnum">
            {item.hvn?.length ? item.hvn.map(p => fmtPrice(p, item.market)).join(' · ') : '—'}
          </span>
        </div>
      </div>
    </Card>
  )
}
