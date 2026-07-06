import { useState, useEffect } from 'react'
import api from '../../api'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { CARD_STYLE, DESC_STYLE, SectionCard, SectionCardLoading, SectionCardError } from './marketUtils.jsx'

// CNN Fear & Greed rating → 한글 라벨 + 전용색(SupplyBadge 패턴: success/danger Badge 변형은
// --up(빨강)/--down(파랑) KR 가격색에 물려있어 금지, 여기선 --color-success/--color-error 등
// 가격과 무관한 토큰을 직접 지정)
const RATING_DISPLAY = {
  'extreme fear': { label: '극단적 공포', color: 'var(--color-error)' },
  fear: { label: '공포', color: 'var(--warn)' },
  neutral: { label: '중립', color: 'var(--text-3)' },
  greed: { label: '탐욕', color: 'var(--data-5)' },
  'extreme greed': { label: '극단적 탐욕', color: 'var(--color-success)' },
}

function ratingDisplay(rating, score) {
  if (rating && RATING_DISPLAY[rating]) return RATING_DISPLAY[rating]
  // rating 결측 시 CNN 밴드 기준(score)으로 폴백
  if (score >= 75) return RATING_DISPLAY['extreme greed']
  if (score >= 55) return RATING_DISPLAY.greed
  if (score >= 45) return RATING_DISPLAY.neutral
  if (score >= 25) return RATING_DISPLAY.fear
  return RATING_DISPLAY['extreme fear']
}

function Delta({ label, diff }) {
  if (diff == null) return null
  const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '─'
  return (
    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
      {label} {arrow} {Math.abs(diff).toFixed(1)}
    </div>
  )
}

export default function FearGreedSection() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.get('/api/market/fear-greed')
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <SectionCardLoading title="공포·탐욕지수 (Fear & Greed)" />
  if (error || !data) return <SectionCardError title="공포·탐욕지수 (Fear & Greed)" />

  const { score, rating, timestamp, previous_close, previous_1_week, previous_1_month } = data
  const { label, color } = ratingDisplay(rating, score)
  const change = previous_close != null ? score - previous_close : null
  const history = (data.history || []).slice(-60)

  const daysAgo = timestamp ? Math.floor((Date.now() - new Date(timestamp).getTime()) / 86400000) : null
  const stale = daysAgo != null && daysAgo >= 1

  return (
    <SectionCard title="공포·탐욕지수 (Fear & Greed)" summary={`${score.toFixed(1)} ${label}`} change={change} changeSuffix="" changeInverted open={open} onToggle={() => setOpen(o => !o)}>
      <p style={DESC_STYLE}>CNN이 시장 지표 7종을 종합해 산출하는 투자심리 지수입니다(0=극단적 공포, 100=극단적 탐욕). 25 이하는 공포, 75 이상은 탐욕 구간으로, 극단으로 치우칠 때 역발상 신호로 참고됩니다.</p>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ ...CARD_STYLE, minWidth: 140 }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>현재값</div>
          <div style={{ fontSize: 28, fontWeight: 700, color }}>{score.toFixed(1)}</div>
          <div style={{ fontSize: 12, color, marginTop: 2 }}>{label}</div>
          {stale && <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>{daysAgo}일 전 기준</div>}
        </div>
        <div style={{ ...CARD_STYLE, minWidth: 140, display: 'flex', flexDirection: 'column', gap: 4, justifyContent: 'center' }}>
          <Delta label="전일" diff={change} />
          <Delta label="1주" diff={previous_1_week != null ? score - previous_1_week : null} />
          <Delta label="1개월" diff={previous_1_month != null ? score - previous_1_month : null} />
        </div>
      </div>
      <div style={{ ...CARD_STYLE, marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>게이지</div>
        <div style={{ position: 'relative', height: 8, borderRadius: 4, background: 'linear-gradient(to right, var(--color-error), var(--warn), var(--text-3), var(--data-5), var(--color-success))' }}>
          <div style={{ position: 'absolute', top: -3, left: `calc(${Math.min(100, Math.max(0, score))}% - 2px)`, width: 4, height: 14, borderRadius: 2, background: 'var(--text)' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
          <span>공포</span><span>중립</span><span>탐욕</span>
        </div>
      </div>
      {history.length > 0 && (
        <div style={CARD_STYLE}>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>추이 (최근 60일)</div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={history} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-3)' }}
                     tickFormatter={v => v.slice(5)} interval={Math.floor(history.length / 6)} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-3)' }} domain={[0, 100]} width={28} />
              <Tooltip contentStyle={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', fontSize: 12 }}
                       labelStyle={{ color: 'var(--text-3)' }} />
              <ReferenceLine y={50} stroke="var(--text-3)" strokeDasharray="4 2" label={{ value: '중립', fill: 'var(--text-3)', fontSize: 10 }} />
              <Line type="monotone" dataKey="value" name="Fear & Greed" stroke="var(--data-3)" dot={false} strokeWidth={1.5} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </SectionCard>
  )
}
