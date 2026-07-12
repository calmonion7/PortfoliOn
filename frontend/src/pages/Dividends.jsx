import { useState, useEffect } from 'react'
import api from '../api'
import Skeleton from '../components/ui/Skeleton'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import Stat from '../components/ui/Stat'
import Badge from '../components/ui/Badge'
import { fmtPrice } from '../utils'

// 예상/확정 배지 — KR 가격 토큰(--up 빨강/--down 파랑)과 무관한 전용색 (ADR-0023, 색 반전 방지)
const STATUS_STYLE = {
  confirmed: { background: 'var(--semantic-buy-soft)', color: 'var(--semantic-buy)', borderColor: 'var(--semantic-buy)' },
  projected: { background: 'var(--bg-elev-2)', color: 'var(--text-3)', border: '1px dashed var(--border)' },
}

const fmtDate = (iso) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${y}.${m}.${d}`
}

function DividendRow({ it }) {
  const isHolding = it.stock_type === 'holding'
  const st = STATUS_STYLE[it.status] || STATUS_STYLE.projected
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
      borderBottom: '1px solid var(--border)',
    }}>
      <div style={{ minWidth: 84, flexShrink: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{fmtDate(it.ex_date)}</div>
        <div style={{ fontSize: 10, color: 'var(--text-3)' }}>배당락</div>
        {it.pay_date && (
          <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>지급 {fmtDate(it.pay_date)}</div>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--accent)' }}>{it.ticker}</span>
          {/* 보유/관심 태그 — GuruManagers.jsx와 동일한 --tag-hold/--tag-watch 토큰 재사용 */}
          <Badge variant="neutral" size="sm" style={isHolding
            ? { background: 'var(--tag-hold-bg)', color: 'var(--tag-hold-color)', borderColor: 'var(--tag-hold-border)' }
            : { background: 'var(--tag-watch-bg)', color: 'var(--tag-watch-color)', borderColor: 'var(--tag-watch-border)' }}>
            {isHolding ? '보유' : '관심'}
          </Badge>
          <Badge variant="neutral" size="sm" style={st}>
            {it.status === 'confirmed' ? '확정' : '예상'}
          </Badge>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {it.name}
        </div>
      </div>

      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 12 }}>{fmtPrice(it.amount_per_share, it.market)}<span style={{ fontSize: 10, color: 'var(--text-3)' }}> /주</span></div>
        {isHolding && it.expected_amount != null && (
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', marginTop: 2 }}>
            {fmtPrice(it.expected_amount, it.market)}
          </div>
        )}
      </div>
    </div>
  )
}

// 보유/관심 영역 — 각 영역을 Card 박스로 감싸 시각적으로 분리(빈 영역은 숨김)
function DividendSection({ label, items }) {
  if (items.length === 0) return null
  return (
    <Card padding="none" style={{ marginBottom: 12, overflow: 'hidden' }}>
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 700 }}>{label}</div>
      {items.map((it, i) => <DividendRow key={`${it.ticker}-${it.ex_date}-${i}`} it={it} />)}
    </Card>
  )
}

export default function Dividends() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = () => {
    setLoading(true)
    setError(false)
    api.get('/api/portfolio/dividends')
      .then(({ data }) => setData(data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  if (loading) return (
    <div style={{ maxWidth: 700 }}>
      <div style={{ marginBottom: 14 }}><Skeleton variant="stat" count={1} /></div>
      <Skeleton variant="row" count={6} />
    </div>
  )

  if (error) return (
    <div style={{ maxWidth: 700, color: 'var(--text-3)', textAlign: 'center', padding: 48, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <span>배당 일정 불러오기 실패</span>
      <Button variant="secondary" size="sm" onClick={load}>다시 시도</Button>
    </div>
  )

  const items = data?.items || []
  const summary = data?.summary || {}
  const holdingItems = items.filter(it => it.stock_type === 'holding')
  const watchItems = items.filter(it => it.stock_type !== 'holding')

  return (
    <div style={{ maxWidth: 700 }}>
      <Card style={{ marginBottom: 14 }}>
        <Stat
          label="12개월 예상 배당 수령액 (보유)"
          value={fmtPrice(summary.total_expected_12m_krw || 0, 'KR')}
          helperText={`배당 예정 보유 ${summary.holdings_with_dividend || 0}종목${summary.fx_usdkrw ? ` · 환율 ₩${Math.round(summary.fx_usdkrw).toLocaleString('ko-KR')}/$` : ''}`}
        />
      </Card>

      {items.length === 0 ? (
        <div style={{ color: 'var(--text-3)', textAlign: 'center', padding: '32px 16px', fontSize: 13 }}>
          다가오는 배당 일정이 없습니다.
        </div>
      ) : (
        <>
          <DividendSection label="보유" items={holdingItems} />
          <DividendSection label="관심" items={watchItems} />
        </>
      )}

      <div style={{ marginTop: 10, fontSize: 10, color: 'var(--text-3)', lineHeight: 1.5 }}>
        <Badge variant="neutral" size="sm" style={{ ...STATUS_STYLE.confirmed, marginRight: 4 }}>확정</Badge> 발표된 일정 ·{' '}
        <Badge variant="neutral" size="sm" style={{ ...STATUS_STYLE.projected, margin: '0 4px' }}>예상</Badge> 과거 배당 주기 기반 추정 (국내·미확정)
      </div>
    </div>
  )
}
