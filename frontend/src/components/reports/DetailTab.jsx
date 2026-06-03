import { useState } from 'react'
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts'
import { fmtPrice as fmt } from '../../utils'
import { fmtN, SectionTitle, _weather } from './reportUtils.jsx'
import ConsensusChart from './ConsensusChart'
import FinancialsChart from './FinancialsChart'
import api from '../../api'

function PriceLevelChart({ rsiData, price, vp, target, title, market }) {
  const [view, setView] = useState('B')
  if (!price && !vp?.poc) return null

  const levels = [
    ...(vp?.hvn || []).map((h, i) => ({ value: h, label: `HVN${i+1}`, color: '#81c784' })),
    vp?.poc != null && { value: vp.poc, label: 'POC', color: '#80cbc4' },
    vp?.vah != null && { value: vp.vah, label: 'VAH', color: '#4fc3f7' },
    vp?.val != null && { value: vp.val, label: 'VAL', color: '#4fc3f7' },
    target != null && { value: target, label: '목표가', color: '#ffcc80' },
    rsiData?.target_20 != null && { value: rsiData.target_20, label: 'RSI20', color: '#4db6ac' },
    rsiData?.target_25 != null && { value: rsiData.target_25, label: 'RSI25', color: '#4db6ac' },
    rsiData?.target_30 != null && { value: rsiData.target_30, label: 'RSI30', color: '#4db6ac' },
    rsiData?.target_70 != null && { value: rsiData.target_70, label: 'RSI70', color: '#ff8a65' },
    rsiData?.target_75 != null && { value: rsiData.target_75, label: 'RSI75', color: '#ff8a65' },
    rsiData?.target_80 != null && { value: rsiData.target_80, label: 'RSI80', color: '#ff8a65' },
  ].filter(Boolean)

  const currentEntry = price != null ? {
    value: price,
    label: `현재가${rsiData?.rsi != null ? ` (RSI ${rsiData.rsi.toFixed(1)})` : ''}`,
    color: 'var(--text)', isCurrent: true,
  } : null

  const allRows = [...levels, ...(currentEntry ? [currentEntry] : [])].sort((a, b) => b.value - a.value)
  const pctFrom = v => price != null ? ((v - price) / price * 100) : null

  const togglesJSX = (
    <div style={{ display: 'flex', gap: 3, marginBottom: 8 }}>
      {[['B', '바+리스트'], ['C', '지지/저항']].map(([v, lbl]) => (
        <button key={v} onClick={() => setView(v)} style={{
          padding: '2px 8px', fontSize: 9, borderRadius: 3, border: 'none', cursor: 'pointer',
          background: view === v ? '#5b8dee' : 'rgba(255,255,255,0.08)',
          color: view === v ? '#fff' : 'var(--text-3)',
        }}>{lbl}</button>
      ))}
    </div>
  )

  if (view === 'B') {
    const vals = allRows.map(l => l.value)
    const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1
    const LABEL_H = 14
    const GAP_H = 26  // 지그재그 효과 공간 확보
    // naturalH > LABEL_H (전체 대비 ~7% 이상) → 갭 마커 표시
    const uniquePrices = [...new Set(vals)].sort((a, b) => b - a)
    const segments = []
    for (let i = 0; i < uniquePrices.length - 1; i++) {
      const segHi = uniquePrices[i], segLo = uniquePrices[i + 1]
      const naturalH = (segHi - segLo) / span * 200
      const isGap = naturalH > LABEL_H
      segments.push({ hi: segHi, lo: segLo, isGap, h: isGap ? GAP_H : LABEL_H })
    }
    const BAR_H = segments.reduce((s, seg) => s + seg.h, 0) + 14

    // 압축 포함 가격 → y 변환
    const priceToY = v => {
      let y = 7
      for (const seg of segments) {
        if (v > seg.hi) break
        if (v < seg.lo) { y += seg.h; continue }
        y += ((seg.hi - v) / (seg.hi - seg.lo)) * seg.h
        break
      }
      return y
    }

    // 같은 가격 항목을 먼저 그룹핑한 뒤 overlap avoidance — 중복 슬롯으로 인한 빈 공간 방지
    const seenVals = new Map()
    for (const l of allRows) {
      if (seenVals.has(l.value)) {
        seenVals.get(l.value).mergedLabels.push({ label: l.label, color: l.color })
      } else {
        seenVals.set(l.value, { ...l, mergedLabels: [{ label: l.label, color: l.color }] })
      }
    }
    const groupedPositioned = [...seenVals.values()]
      .map(l => ({ ...l, y: priceToY(l.value) }))
      .sort((a, b) => a.y - b.y)
    for (let i = 1; i < groupedPositioned.length; i++) {
      if (groupedPositioned[i].y < groupedPositioned[i-1].y + LABEL_H)
        groupedPositioned[i].y = groupedPositioned[i-1].y + LABEL_H
    }

    const gapSegs = segments.filter(s => s.isGap)

    return (
      <div style={{ marginTop: 8 }}>
        {title && <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>{title}</div>}
        {togglesJSX}
        <div style={{ display: 'flex', height: BAR_H, position: 'relative', width: '100%' }}>
          {/* 왼쪽: 금액 */}
          <div style={{ flex: 1, position: 'relative' }}>
            {groupedPositioned.map((l, i) => (
              <div key={i} style={{
                position: 'absolute', right: 6, top: l.y - 7,
                fontSize: l.isCurrent ? 10 : 9, textAlign: 'right', whiteSpace: 'nowrap',
                color: l.isCurrent ? 'var(--text)' : 'var(--text-2)',
                fontWeight: l.isCurrent ? 700 : 400, fontVariantNumeric: 'tabular-nums',
              }}>
                {fmt(l.value, market)}
              </div>
            ))}
          </div>

          {/* 중앙 바 */}
          <div style={{ width: 64, flexShrink: 0, position: 'relative' }}>
            {vp?.vah != null && vp?.val != null && (() => {
              const top = priceToY(vp.vah)
              const height = Math.max(2, priceToY(vp.val) - priceToY(vp.vah))
              return <>
                {/* 배경 fill */}
                <div style={{ position: 'absolute', left: 8, width: 48, top, height, background: 'rgba(79,195,247,0.08)', zIndex: 6 }} />
                {/* 좌우 테두리 — 갭 SVG(zIndex:5) 위에 */}
                <div style={{ position: 'absolute', left: 8, width: 1, top, height, background: 'rgba(79,195,247,0.5)', zIndex: 6 }} />
                <div style={{ position: 'absolute', left: 55, width: 1, top, height, background: 'rgba(79,195,247,0.5)', zIndex: 6 }} />
              </>
            })()}
            <div style={{ position: 'absolute', left: 20, top: 0, bottom: 0, width: 24, borderRadius: 3, overflow: 'hidden', zIndex: 1 }}>
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.1)' }} />
              {price != null && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: priceToY(price), background: 'rgba(239,154,154,0.3)' }} />}
              {price != null && <div style={{ position: 'absolute', top: priceToY(price), left: 0, right: 0, bottom: 0, background: 'rgba(129,199,132,0.3)' }} />}
            </div>
            {allRows.map((l, i) => {
              const isKey = l.isCurrent || l.label === 'VAH' || l.label === 'VAL' || l.label === '목표가'
              const isVahVal = l.label === 'VAH' || l.label === 'VAL'
              const isTarget = l.label === '목표가'
              return (
                <div key={i} style={{
                  position: 'absolute',
                  left: isKey ? 8 : 20, right: isKey ? 8 : 20,
                  height: l.isCurrent ? 2.5 : isVahVal ? 2 : isTarget ? 2 : 1.5,
                  background: l.color, top: priceToY(l.value), borderRadius: 1,
                  zIndex: l.isCurrent ? 8 : (isVahVal || isTarget) ? 7 : 1,
                }} />
              )
            })}
            {/* 갭 구간: 바 마스킹 + 지그재그 */}
            {gapSegs.map((seg, i) => {
              const y = priceToY(seg.hi)
              return (
                <svg key={i} style={{ position: 'absolute', left: 0, top: y, width: 64, height: GAP_H, zIndex: 5 }}>
                  {/* 바 컬럼(x=20~44) 바깥만 마스킹 */}
                  <rect x="0" y="0" width="20" height={GAP_H} style={{ fill: 'var(--bg-elev)' }} />
                  <rect x="44" y="0" width="20" height={GAP_H} style={{ fill: 'var(--bg-elev)' }} />
                  {/* 중간 끊김 구간 바 컬럼도 마스킹 */}
                  <rect x="20" y="7" width="24" height={GAP_H - 14} style={{ fill: 'var(--bg-elev)' }} />
                  {/* 위 물결 */}
                  <polyline
                    points="18,9 22,7 32,9 42,7 46,9"
                    fill="none" style={{ stroke: 'var(--text-3)', strokeOpacity: 0.8 }} strokeWidth="1.3"
                    strokeLinecap="round" strokeLinejoin="round"
                  />
                  {/* 아래 물결 */}
                  <polyline
                    points={`18,${GAP_H-9} 22,${GAP_H-7} 32,${GAP_H-9} 42,${GAP_H-7} 46,${GAP_H-9}`}
                    fill="none" style={{ stroke: 'var(--text-3)', strokeOpacity: 0.8 }} strokeWidth="1.3"
                    strokeLinecap="round" strokeLinejoin="round"
                  />
                </svg>
              )
            })}
          </div>

          {/* 오른쪽: % + 수치명 (같은 가격은 합산) */}
          <div style={{ flex: 1, position: 'relative' }}>
            {groupedPositioned.map((l, i) => {
              const p = l.isCurrent ? null : pctFrom(l.value)
              return (
                <div key={i} style={{
                  position: 'absolute', left: 6, top: l.y - 7,
                  display: 'flex', gap: 4, alignItems: 'center', whiteSpace: 'nowrap',
                }}>
                  {p != null && (
                    <span style={{ fontSize: 9, color: p > 0 ? '#ef9a9a' : '#81c784', fontVariantNumeric: 'tabular-nums' }}>
                      {p >= 0 ? '+' : ''}{p.toFixed(1)}%
                    </span>
                  )}
                  <span style={{ fontSize: l.isCurrent ? 10 : 9, fontWeight: l.isCurrent ? 700 : 500 }}>
                    {l.mergedLabels.map((lb, j) => (
                      <span key={j} style={{ color: lb.color }}>
                        {j > 0 && <span style={{ color: 'var(--text-3)' }}>, </span>}
                        {lb.label}
                      </span>
                    ))}
                  </span>
                </div>
              )
            })}
          </div>

        </div>
      </div>
    )
  }

  // View C — 지지/저항 카드형
  const below = levels.filter(l => price == null || l.value <= price).sort((a, b) => b.value - a.value)
  const above = levels.filter(l => price != null && l.value > price).sort((a, b) => a.value - b.value)

  // 같은 가격끼리 그룹핑: [{ value, items: [...] }, ...]
  const groupByPrice = (arr) => {
    const map = new Map()
    arr.forEach(l => {
      if (!map.has(l.value)) map.set(l.value, [])
      map.get(l.value).push(l)
    })
    return [...map.entries()].map(([value, items]) => ({ value, items }))
  }

  const belowGroups = groupByPrice(below)
  const aboveGroups = groupByPrice(above)

  const hexToRgba = (hex, alpha) => {
    if (!hex || hex.startsWith('var(')) return `rgba(160,160,160,${alpha})`
    const h = hex.replace('#', '')
    return `rgba(${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)},${alpha})`
  }

  const renderCard = (group, isBelow) => {
    const { value, items } = group
    const p = pctFrom(value)
    const firstColor = items[0].color
    return (
      <div key={value} style={{
        padding: '5px 8px', borderRadius: 6, marginBottom: 4,
        background: hexToRgba(firstColor, 0.10),
        border: `1px solid ${hexToRgba(firstColor, 0.45)}`,
        textAlign: isBelow ? 'right' : 'left',
      }}>
        <div style={{ display: 'flex', justifyContent: isBelow ? 'flex-end' : 'flex-start', alignItems: 'center', gap: 4, marginBottom: 2, flexWrap: 'wrap' }}>
          {items.map((item, idx) => (
            <span key={idx} style={{ fontSize: 9, fontWeight: 700 }}>
              {items.length > 1 && <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>{String.fromCharCode(97 + idx)}. </span>}
              <span style={{ color: item.color }}>{item.label}</span>
            </span>
          ))}
          {p != null && (
            <span style={{ fontSize: 9, color: isBelow ? '#81c784' : '#ef9a9a', fontVariantNumeric: 'tabular-nums' }}>
              {p >= 0 ? '+' : ''}{p.toFixed(1)}%
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
          {fmt(value, market)}
        </div>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 8 }}>
      {title && <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>{title}</div>}
      {togglesJSX}
      <div style={{ padding: '5px 10px', textAlign: 'center', background: 'rgba(255,255,255,0.06)', borderRadius: 4, marginBottom: 6 }}>
        {price != null && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{fmt(price, market)}</span>}
        {rsiData?.rsi != null && <span style={{ fontSize: 9, color: 'var(--text-3)', marginLeft: 8 }}>RSI {rsiData.rsi.toFixed(1)}</span>}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, color: '#81c784', fontWeight: 600, textAlign: 'right', marginBottom: 4 }}>지지 구간 ▼</div>
          {belowGroups.length > 0
            ? belowGroups.map(g => renderCard(g, true))
            : <div style={{ fontSize: 9, color: 'var(--text-3)', textAlign: 'right', padding: '4px 6px' }}>없음</div>}
        </div>
        <div style={{ width: 1, background: 'rgba(255,255,255,0.1)', alignSelf: 'stretch' }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, color: '#ef9a9a', fontWeight: 600, marginBottom: 4 }}>저항 구간 ▲</div>
          {aboveGroups.length > 0
            ? aboveGroups.map(g => renderCard(g, false))
            : <div style={{ fontSize: 9, color: 'var(--text-3)', padding: '4px 6px' }}>없음</div>}
        </div>
      </div>
    </div>
  )
}

export function RsiTable({ dailyRsi, weeklyRsi, monthlyRsi, price, vp, target, market }) {
  if (!dailyRsi) return null
  const rows = [
    { label: '일봉', d: dailyRsi },
    { label: '주봉', d: weeklyRsi },
    { label: '월봉', d: monthlyRsi },
  ]
  const keys = ['target_20', 'target_25', 'target_30', 'target_70', 'target_75', 'target_80']
  let closestKey = null, minDiff = Infinity
  if (price && dailyRsi) {
    keys.forEach(k => {
      if (dailyRsi[k] == null) return
      const diff = Math.abs(dailyRsi[k] - price)
      if (diff < minDiff) { minDiff = diff; closestKey = k }
    })
  }
  return (
    <div style={{ marginBottom: 16, background: 'var(--bg-elev)', borderRadius: 6, padding: '10px 12px' }}>
      <div style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 12, marginBottom: 8 }}>🎯 RSI 예상 타점</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {rows.map(({ label, d }) => d?.rsi != null && (
          <div key={label}>
            <div style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600, marginBottom: 2 }}>{label}</div>
            <PriceLevelChart rsiData={d} price={price} vp={vp} target={target} market={market} />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function DetailSummaryTab({ summary, ticker, onRefreshSuccess }) {
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState(null)

  if (!summary) return null

  const { buy = 0, hold = 0, sell = 0 } = summary
  const needsRefresh = summary.price == null || (summary.target_high == null && summary.target_low == null && buy + hold + sell === 0)

  const handleRefresh = async () => {
    setRefreshing(true)
    setRefreshError(null)
    try {
      const { data } = await api.post(`/api/report/${ticker}/refresh-analyst`)
      onRefreshSuccess?.(data)
    } catch (e) {
      setRefreshError(e.response?.data?.detail || '갱신 실패')
    } finally {
      setRefreshing(false)
    }
  }
  const total = buy + hold + sell
  const pct = (n) => total > 0 ? `${Math.round(n / total * 100)}%` : '—'
  const gap = summary.target_mean != null && summary.price != null
    ? ((summary.target_mean - summary.price) / summary.price * 100)
    : null

  const consensusWeather = (() => {
    if (!summary.price || !summary.target_mean) return null
    const gap = (summary.target_mean - summary.price) / summary.price * 100
    const buyPct = total > 0 ? buy / total * 100 : 50
    if (gap >= 15 && buyPct >= 60) return _weather(0)
    if (gap >= 5 && buyPct >= 45) return _weather(1)
    if (gap >= -5) return _weather(2)
    return _weather(3)
  })()

  const rsiWeather = (() => {
    const rsi = summary.daily_rsi?.rsi
    if (rsi == null) return null
    if (rsi < 30) return _weather(0)
    if (rsi < 45) return _weather(1)
    if (rsi < 65) return _weather(2)
    return _weather(3)
  })()

  return (
    <div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* 1행: 증권사 컨센서스 */}
      <div style={{ background: 'var(--bg-elev)', borderRadius: 6, padding: '8px 10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <SectionTitle weather={consensusWeather}>🏦 증권사 컨센서스</SectionTitle>
          {needsRefresh && (
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              style={{ background: 'transparent', border: '1px solid var(--border)', color: refreshing ? 'var(--accent)' : 'var(--text-3)', borderRadius: 3, padding: '2px 8px', fontSize: 11, cursor: refreshing ? 'default' : 'pointer' }}
            >{refreshing ? '갱신 중...' : '데이터 갱신'}</button>
          )}
        </div>
        {refreshError && <div style={{ color: '#ef9a9a', fontSize: 11, marginBottom: 4 }}>{refreshError}</div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {/* 평균목표가 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ color: 'var(--text-3)', fontSize: 9 }}>🎯 평균목표가</span>
            <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>{fmt(summary.target_mean, summary.market)}</span>
          </div>
          {/* 상승여력 */}
          {gap != null && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ color: 'var(--text-3)', fontSize: 9 }}>상승여력</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: gap >= 0 ? '#81c784' : '#ef9a9a' }}>
                {gap >= 0 ? '+' : ''}{gap.toFixed(1)}%
              </span>
            </div>
          )}
          <span style={{ color: 'var(--border)', fontSize: 10 }}>|</span>
          {/* 최고/최저 목표가 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ color: 'var(--text-3)', fontSize: 9 }}>최고목표가</span>
            <span style={{ color: '#81c784', fontSize: 12, fontWeight: 600 }}>{fmt(summary.target_high, summary.market)}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ color: 'var(--text-3)', fontSize: 9 }}>최저목표가</span>
            <span style={{ color: '#ef9a9a', fontSize: 12, fontWeight: 600 }}>{fmt(summary.target_low, summary.market)}</span>
          </div>
          {summary.finviz_recom != null && (
            <>
              <span style={{ color: 'var(--border)', fontSize: 10 }}>|</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ color: 'var(--text-3)', fontSize: 9 }}>Finviz 추천</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: summary.finviz_recom <= 2 ? '#81c784' : 'var(--text)' }}>
                  {summary.finviz_recom.toFixed(1)} <span style={{ fontSize: 9, color: 'var(--text-3)' }}>/ 5</span>
                </span>
              </div>
            </>
          )}
          {total > 0 && (
            <>
              <span style={{ color: 'var(--border)', fontSize: 10 }}>|</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ color: 'var(--text-3)', fontSize: 9 }}>애널리스트 의견</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#81c784', fontSize: 11 }}>매수 {buy}</span>
                  <span style={{ color: 'var(--text-3)', fontSize: 11 }}>중립 {hold}</span>
                  <span style={{ color: '#ef9a9a', fontSize: 11 }}>매도 {sell}</span>
                  <div style={{ display: 'flex', height: 4, borderRadius: 2, overflow: 'hidden', width: 50, flexShrink: 0 }}>
                    <div style={{ width: `${Math.round(buy / total * 100)}%`, background: '#43a047' }} />
                    <div style={{ width: `${Math.round(hold / total * 100)}%`, background: '#424242' }} />
                    <div style={{ width: `${Math.round(sell / total * 100)}%`, background: '#b71c1c' }} />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 컨센서스 추이 */}
      <ConsensusChart ticker={ticker} market={summary.market} />

      {/* 2행: 매물대·RSI 현황 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ background: 'var(--bg-elev)', borderRadius: 6, padding: 14 }}>
          <SectionTitle weather={rsiWeather}>📉 매물대 &amp; RSI 현황</SectionTitle>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 2, marginTop: 2 }}>
            {[
              { color: 'var(--text)', label: '현재가', desc: '현재 주가' },
              { color: '#ffcc80', label: '평균목표가', desc: '애널리스트 평균 목표주가' },
              { color: '#80cbc4', label: 'POC', desc: '거래량 최대 가격대' },
              { color: '#81c784', label: 'HVN', desc: '고거래량 가격대(지지·저항)' },
              { color: '#4db6ac', label: 'RSI20~30', desc: '일봉 RSI 과매도 가격' },
              { color: '#ff8a65', label: 'RSI70~80', desc: '일봉 RSI 과매수 가격' },
            ].map(({ color, label, desc }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }} title={desc}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
                <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{label}</span>
                <span style={{ fontSize: 9, color: 'var(--text-3)' }}>({desc})</span>
              </div>
            ))}
          </div>
          <PriceLevelChart
            rsiData={summary.daily_rsi}
            price={summary.price}
            vp={summary.volume_profile}
            target={summary.target_mean}
            market={summary.market}
          />
        </div>
      </div>
    </div>
    <FinancialsChart financials={summary.financials} financialsAnnual={summary.financials_annual} market={summary.market} />
    </div>
  )
}
