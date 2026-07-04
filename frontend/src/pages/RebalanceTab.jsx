// frontend/src/pages/RebalanceTab.jsx
import { useState, useEffect, useCallback } from 'react'
import api from '../api'
import { useToast } from '../components/Toast'
import Card from '../components/ui/Card'
import Badge, { MarketBadge } from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import Skeleton from '../components/ui/Skeleton'
import useIsMobile from '../hooks/useIsMobile'

// 조정금액: 양수=매수, 음수=매도 (task#146 API_SPEC). 방향색은 KR 색 관례 혼동 회피 위해 미적용 — 라벨+부호로 표현.
const tradeText = (h) => {
  if (h.suggested_trade_krw == null) return '—'
  const dir = h.suggested_trade_krw >= 0 ? '매수' : '매도'
  const amt = Math.round(Math.abs(h.suggested_trade_krw)).toLocaleString('ko-KR')
  const shares = h.suggested_shares != null ? ` (${Math.abs(h.suggested_shares)}주)` : ''
  return `${dir} ₩${amt}${shares}`
}

const driftText = (pp) => pp == null ? '—' : `${pp >= 0 ? '+' : ''}${pp.toFixed(1)}%p`
const pctText = (v) => v == null ? '—' : `${v.toFixed(1)}%`

const labelStyle = { fontSize: 11, color: 'var(--text-3)', marginBottom: 2 }

export default function RebalanceTab() {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(true)
  const { showToast } = useToast()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [inputs, setInputs] = useState({})
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    api.get('/api/portfolio/rebalance')
      .then(r => {
        setData(r.data)
        const init = {}
        r.data.holdings.forEach(h => { init[h.ticker] = h.target_weight != null ? String(h.target_weight) : '' })
        setInputs(init)
        setError(null)
        setLoading(false)
      })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  useEffect(load, [load])

  const handleSave = () => {
    const weights = {}
    data.holdings.forEach(h => {
      const v = inputs[h.ticker]
      const n = parseFloat(v)
      if (v !== '' && Number.isFinite(n) && n >= 0) weights[h.ticker] = n
      else if ((v === '' || v == null) && h.target_weight != null) weights[h.ticker] = null  // 빈 입력 + 기존 타겟 → 삭제(null)
    })
    setSaving(true)
    api.put('/api/portfolio/rebalance/targets', weights)
      .then(() => { showToast('목표 비중이 저장되었습니다'); load() })
      .catch(e => showToast(e.response?.data?.detail || '저장에 실패했습니다', 'error'))
      .finally(() => setSaving(false))
  }

  if (loading) return <Skeleton variant="card" count={3} />
  if (error) return <div style={{ color: 'var(--color-error)' }}>오류: {error}</div>
  if (!data || !data.holdings.length) return (
    <div style={{ color: 'var(--text-3)' }}>보유 종목이 없습니다.</div>
  )

  // 합계 = 설정한 타겟 + 미설정 종목의 현재 비중(hold). no_fx 종목은 current_weight null이라 제외.
  const sumPct = data.holdings.reduce((s, h) => {
    const v = inputs[h.ticker]
    const n = parseFloat(v)
    if (v !== '' && Number.isFinite(n)) return s + n
    return s + (h.current_weight ?? 0)
  }, 0)
  const sumWarn = sumPct > 0 && Math.abs(sumPct - 100) > 0.05

  const body = (
    <>
      <p style={{ color: 'var(--text-3)', fontSize: 12, marginBottom: 16 }}>
        보유 종목별 목표 비중을 입력하면 현재 비중과의 드리프트, 목표 도달 조정금액(₩)을 계산합니다. 스코프는 보유 종목만(현금·관심종목 제외) · 주문 실행은 지원하지 않는 읽기전용 계산기입니다.
      </p>

      {data.holdings.map(h => (
        <Card key={h.ticker} padding="sm" style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <strong>{h.ticker}</strong>
            {h.name && h.name !== h.ticker && <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{h.name}</span>}
            <MarketBadge market={h.market} />
            {h.untargeted && <Badge variant="neutral" size="sm">미설정</Badge>}
            {h.no_fx && <Badge variant="neutral" size="sm">환율 없음</Badge>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 12 }}>
            <div>
              <div style={labelStyle}>현재 비중</div>
              <div className="tnum">{pctText(h.current_weight)}</div>
            </div>
            <div>
              <div style={labelStyle}>목표 비중</div>
              <Input
                type="number"
                min="0"
                step="0.1"
                placeholder="%"
                value={inputs[h.ticker] ?? ''}
                onChange={e => setInputs(prev => ({ ...prev, [h.ticker]: e.target.value }))}
                style={{ width: 80 }}
              />
            </div>
            <div>
              <div style={labelStyle}>드리프트</div>
              <div className="tnum">{driftText(h.drift_pp)}</div>
            </div>
            <div>
              <div style={labelStyle}>조정금액</div>
              <div className="tnum">{tradeText(h)}</div>
            </div>
          </div>
        </Card>
      ))}

      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
        <span style={{ fontSize: 13 }}>합계: <strong className="tnum">{sumPct.toFixed(1)}%</strong></span>
        {sumWarn && <span style={{ color: 'var(--text-3)', fontSize: 12 }}>포트폴리오 합이 100%가 아닙니다 (설정 타겟 + 미설정 종목 현재 비중)</span>}
        <Button variant="primary" size="sm" onClick={handleSave} loading={saving} disabled={saving} style={{ marginLeft: 'auto' }}>
          저장
        </Button>
      </div>
    </>
  )

  return (
    <div>
      {isMobile ? (
        <button className="accordion-header" onClick={() => setOpen(o => !o)}>
          <span style={{ color: 'var(--text)', fontWeight: 600 }}>리밸런싱</span>
          <span>{open ? '∧' : '∨'}</span>
        </button>
      ) : (
        <h2 style={{ color: 'var(--text)', marginBottom: 8 }}>리밸런싱</h2>
      )}
      {(!isMobile || open) && body}
    </div>
  )
}
