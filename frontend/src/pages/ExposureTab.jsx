// frontend/src/pages/ExposureTab.jsx
import { useState, useEffect, useCallback } from 'react'
import api from '../api'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Skeleton from '../components/ui/Skeleton'
import useIsMobile from '../hooks/useIsMobile'

const pctText = (v) => v == null ? '—' : `${v.toFixed(1)}%`

// 경고 배지 전용색(caution 주황) — success/danger 변형 금지(--up=빨강/--down=파랑 반전, SupplyBadge 규약).
const warnStyle = { background: 'rgba(245, 124, 0, 0.16)', color: '#f57c00', borderColor: 'rgba(245, 124, 0, 0.32)' }

const DATA_COLORS = ['var(--data-1)', 'var(--data-2)', 'var(--data-3)', 'var(--data-4)', 'var(--data-5)']

function WeightBar({ label, weight, color = 'var(--accent)', warn = false }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
        <span style={{ color: 'var(--text)' }}>{label}</span>
        <span className="tnum" style={{ color: warn ? '#f57c00' : 'var(--text-3)', fontWeight: warn ? 600 : 400 }}>{pctText(weight)}</span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: 'var(--bg-elev)', overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(weight, 100)}%`, height: '100%', background: color }} />
      </div>
    </div>
  )
}

export default function ExposureTab() {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(true)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    api.get('/api/portfolio/exposure')
      .then(r => { setData(r.data); setError(null); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  useEffect(load, [load])

  if (loading) return <Skeleton variant="card" count={3} />
  if (error) return <div style={{ color: 'var(--color-error)' }}>오류: {error}</div>
  if (!data || !data.holdings.length) return (
    <div style={{ color: 'var(--text-3)' }}>보유 종목이 없습니다.</div>
  )

  const { currency, sector, holdings, concentration, warnings, no_fx } = data
  const sectorEntries = Object.entries(sector).sort((a, b) => b[1].weight - a[1].weight)
  const otherSector = sectorEntries.find(([name]) => name === '기타')

  const body = (
    <>
      <p style={{ color: 'var(--text-3)', fontSize: 12, marginBottom: 16 }}>
        보유 종목 기준, 전체 포트폴리오 KRW 환산 비중으로 통화·섹터·단일종목 쏠림을 봅니다.
      </p>

      {(warnings.single_name || warnings.sector) && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          {warnings.single_name && <Badge variant="neutral" size="sm" style={warnStyle}>⚠ 단일종목 25% 초과</Badge>}
          {warnings.sector && <Badge variant="neutral" size="sm" style={warnStyle}>⚠ 섹터 40% 초과</Badge>}
        </div>
      )}

      <Card padding="sm" style={{ marginBottom: 12 }}>
        <h3 style={{ color: 'var(--text)', fontSize: 14, marginBottom: 10 }}>통화 노출</h3>
        {Object.entries(currency).sort((a, b) => b[1].weight - a[1].weight).map(([mkt, g], i) => (
          <WeightBar key={mkt} label={mkt} weight={g.weight} color={DATA_COLORS[i % DATA_COLORS.length]} />
        ))}
      </Card>

      <Card padding="sm" style={{ marginBottom: 12 }}>
        <h3 style={{ color: 'var(--text)', fontSize: 14, marginBottom: 10 }}>섹터 노출</h3>
        {sectorEntries.map(([name, g], i) => (
          <WeightBar
            key={name}
            label={name}
            weight={g.weight}
            color={DATA_COLORS[i % DATA_COLORS.length]}
            warn={g.weight > 40}
          />
        ))}
        {otherSector && (
          <p style={{ color: 'var(--text-3)', fontSize: 11, marginTop: 4 }}>
            기타: 섹터 미분류 종목 — 리포트 생성 시 채워짐
          </p>
        )}
      </Card>

      <Card padding="sm">
        <h3 style={{ color: 'var(--text)', fontSize: 14, marginBottom: 4 }}>단일종목 집중도</h3>
        <p style={{ color: 'var(--text-3)', fontSize: 12, marginBottom: 10 }}>
          상위 3종목 {pctText(concentration.top3_pct)} · 상위 5종목 {pctText(concentration.top5_pct)}
          {concentration.max_single && <> · 최대 단일종목 {concentration.max_single.ticker} ({pctText(concentration.max_single.weight)})</>}
        </p>
        {holdings.map(h => (
          <WeightBar
            key={h.ticker}
            label={h.name && h.name !== h.ticker ? `${h.ticker} ${h.name}` : h.ticker}
            weight={h.weight}
            warn={h.weight > 25}
          />
        ))}
        {no_fx.count > 0 && (
          <p style={{ color: 'var(--text-3)', fontSize: 11, marginTop: 4 }}>
            환산불가 {no_fx.count}종목 ({no_fx.tickers.join(', ')}) — 환율 없어 집계에서 제외
          </p>
        )}
      </Card>
    </>
  )

  return (
    <div>
      {isMobile ? (
        <button className="accordion-header" onClick={() => setOpen(o => !o)}>
          <span style={{ color: 'var(--text)', fontWeight: 600 }}>노출</span>
          <span>{open ? '∧' : '∨'}</span>
        </button>
      ) : (
        <h2 style={{ color: 'var(--text)', marginBottom: 8 }}>노출</h2>
      )}
      {(!isMobile || open) && body}
    </div>
  )
}
