import { useState, useEffect } from 'react'
import { fmtPrice as fmt } from '../../utils'
import { SectionTitle, _weather } from './reportUtils.jsx'
import ConsensusChart from './ConsensusChart'
import FinancialsChart from './FinancialsChart'
import BacklogChart from './BacklogChart'
import api from '../../api'
import useIsMobile from '../../hooks/useIsMobile'
import { SketchArrowUp } from '../sketches'
import './ReportDetail.css'

function PriceLevelChart({ rsiData, price, vp, target, title, market, chartOnly = false }) {
  const isMobile = useIsMobile()
  if (!price && !vp?.poc) return null

  const levels = [
    ...(vp?.hvn || []).map((h, i) => ({ value: h, label: `HVN${i+1}`, color: 'var(--data-5)' })),
    vp?.poc != null && { value: vp.poc, label: 'POC', color: 'var(--data-2)' },
    vp?.vah != null && { value: vp.vah, label: 'VAH', color: 'var(--color-info)' },
    vp?.val != null && { value: vp.val, label: 'VAL', color: 'var(--color-info)' },
    target != null && { value: target, label: '목표가', color: 'var(--data-3)' },
    rsiData?.target_20 != null && { value: rsiData.target_20, label: 'RSI20', color: 'var(--semantic-buy)', side: 'below' },
    rsiData?.target_25 != null && { value: rsiData.target_25, label: 'RSI25', color: 'var(--semantic-buy)', side: 'below' },
    rsiData?.target_30 != null && { value: rsiData.target_30, label: 'RSI30', color: 'var(--semantic-buy)', side: 'below' },
    rsiData?.target_70 != null && { value: rsiData.target_70, label: 'RSI70', color: 'var(--semantic-sell)', side: 'above' },
    rsiData?.target_75 != null && { value: rsiData.target_75, label: 'RSI75', color: 'var(--semantic-sell)', side: 'above' },
    rsiData?.target_80 != null && { value: rsiData.target_80, label: 'RSI80', color: 'var(--semantic-sell)', side: 'above' },
  ].filter(Boolean)

  const currentEntry = price != null ? {
    value: price,
    label: `현재가${rsiData?.rsi != null ? ` (RSI ${rsiData.rsi.toFixed(1)})` : ''}`,
    color: 'var(--text)', isCurrent: true,
  } : null

  const allRows = [...levels, ...(currentEntry ? [currentEntry] : [])].sort((a, b) => b.value - a.value)
  const pctFrom = v => price != null ? ((v - price) / price * 100) : null

  // ── 좌측: 바 + 리스트 ──
  const barListJSX = (() => {
    const vals = allRows.map(l => l.value)
    const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1
    const LABEL_H = 23
    const GAP_H = 39  // 지그재그 효과 공간 확보
    // naturalH > LABEL_H (전체 대비 ~7% 이상) → 갭 마커 표시
    const uniquePrices = [...new Set(vals)].sort((a, b) => b - a)
    const segments = []
    for (let i = 0; i < uniquePrices.length - 1; i++) {
      const segHi = uniquePrices[i], segLo = uniquePrices[i + 1]
      const naturalH = (segHi - segLo) / span * 320
      const isGap = naturalH > LABEL_H
      segments.push({ hi: segHi, lo: segLo, isGap, h: isGap ? GAP_H : LABEL_H })
    }
    const BAR_H = segments.reduce((s, seg) => s + seg.h, 0) + 24

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
        <div style={{ display: 'flex', justifyContent: 'center', height: BAR_H, position: 'relative', width: '100%' }}>
          {/* 왼쪽: 금액 */}
          <div style={{ flex: '0 0 120px', position: 'relative' }}>
            {groupedPositioned.map((l, i) => (
              <div key={i} style={{
                position: 'absolute', right: 6, top: l.y - 10,
                fontSize: l.isCurrent ? 15 : 13, textAlign: 'right', whiteSpace: 'nowrap',
                color: l.isCurrent ? 'var(--text)' : 'var(--text-2)',
                fontWeight: l.isCurrent ? 700 : 400, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)',
              }}>
                {fmt(l.value, market)}
              </div>
            ))}
          </div>

          {/* 중앙 바 */}
          <div style={{ width: 80, flexShrink: 0, position: 'relative' }}>
            {vp?.vah != null && vp?.val != null && (() => {
              const top = priceToY(vp.vah)
              const height = Math.max(2, priceToY(vp.val) - priceToY(vp.vah))
              return <>
                {/* 배경 fill */}
                <div style={{ position: 'absolute', left: 13, width: 54, top, height, background: 'color-mix(in srgb, var(--color-info) 8%, transparent)', zIndex: 6 }} />
                {/* 좌우 테두리 — 갭 SVG(zIndex:5) 위에 */}
                <div style={{ position: 'absolute', left: 13, width: 1, top, height, background: 'color-mix(in srgb, var(--color-info) 50%, transparent)', zIndex: 6 }} />
                <div style={{ position: 'absolute', left: 66, width: 1, top, height, background: 'color-mix(in srgb, var(--color-info) 50%, transparent)', zIndex: 6 }} />
              </>
            })()}
            <div style={{ position: 'absolute', left: 25, top: 0, bottom: 0, width: 30, borderRadius: 3, overflow: 'hidden', zIndex: 1 }}>
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.1)' }} />
              {price != null && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: priceToY(price), background: 'var(--color-error-soft)' }} />}
              {price != null && <div style={{ position: 'absolute', top: priceToY(price), left: 0, right: 0, bottom: 0, background: 'var(--color-success-soft)' }} />}
            </div>
            {allRows.map((l, i) => {
              const isKey = l.isCurrent || l.label === 'VAH' || l.label === 'VAL' || l.label === '목표가'
              const isVahVal = l.label === 'VAH' || l.label === 'VAL'
              const isTarget = l.label === '목표가'
              return (
                <div key={i} style={{
                  position: 'absolute',
                  left: isKey ? 13 : 25, right: isKey ? 13 : 25,
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
                <svg key={i} style={{ position: 'absolute', left: 0, top: y, width: 80, height: GAP_H, zIndex: 5 }}>
                  {/* 바 컬럼(x=25~55) 바깥만 마스킹 */}
                  <rect x="0" y="0" width="25" height={GAP_H} style={{ fill: 'var(--bg)' }} />
                  <rect x="55" y="0" width="25" height={GAP_H} style={{ fill: 'var(--bg)' }} />
                  {/* 중간 끊김 구간 바 컬럼도 마스킹 */}
                  <rect x="25" y="7" width="30" height={GAP_H - 14} style={{ fill: 'var(--bg)' }} />
                  {/* 위 물결 */}
                  <polyline
                    points="23,9 28,7 40,9 52,7 57,9"
                    fill="none" style={{ stroke: 'var(--text-3)', strokeOpacity: 0.8 }} strokeWidth="1.3"
                    strokeLinecap="round" strokeLinejoin="round"
                  />
                  {/* 아래 물결 */}
                  <polyline
                    points={`23,${GAP_H-9} 28,${GAP_H-7} 40,${GAP_H-9} 52,${GAP_H-7} 57,${GAP_H-9}`}
                    fill="none" style={{ stroke: 'var(--text-3)', strokeOpacity: 0.8 }} strokeWidth="1.3"
                    strokeLinecap="round" strokeLinejoin="round"
                  />
                </svg>
              )
            })}
          </div>

          {/* 오른쪽: % + 수치명 (같은 가격은 합산) */}
          <div style={{ flex: '0 0 150px', position: 'relative' }}>
            {groupedPositioned.map((l, i) => {
              const p = l.isCurrent ? null : pctFrom(l.value)
              return (
                <div key={i} style={{
                  position: 'absolute', left: 6, top: l.y - 10,
                  display: 'flex', gap: 4, alignItems: 'center', whiteSpace: 'nowrap',
                }}>
                  {p != null && (
                    <span style={{ fontSize: 13, color: p > 0 ? 'var(--color-error)' : 'var(--color-success)', fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}>
                      {p >= 0 ? '+' : ''}{p.toFixed(1)}%
                    </span>
                  )}
                  <span style={{ fontSize: l.isCurrent ? 15 : 13, fontWeight: l.isCurrent ? 700 : 500 }}>
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
    )
  })()

  // ── 우측: 지지/저항 카드 ──
  const below = levels.filter(l => l.side === 'below' || (l.side == null && (price == null || l.value <= price))).sort((a, b) => b.value - a.value)
  const above = levels.filter(l => l.side === 'above' || (l.side == null && price != null && l.value > price)).sort((a, b) => a.value - b.value)

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
    if (!hex) return `rgba(160,160,160,${alpha})`
    if (hex.startsWith('var(')) return `color-mix(in srgb, ${hex} ${Math.round(alpha * 100)}%, transparent)`
    const h = hex.replace('#', '')
    return `rgba(${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)},${alpha})`
  }

  const renderCard = (group, isBelow) => {
    const { value, items } = group
    const p = pctFrom(value)
    const accentColor = items[0].color
    const isMulti = items.length > 1
    return (
      <div key={value} style={{
        padding: '4px 7px',
        borderRadius: 5,
        marginBottom: 3,
        background: hexToRgba(accentColor, 0.13),
        border: `1px solid ${hexToRgba(accentColor, 0.45)}`,
        ...(isBelow
          ? { borderRight: `3px solid ${accentColor}` }
          : { borderLeft: `3px solid ${accentColor}` }),
      }}>
        <div style={{
          display: 'flex',
          justifyContent: isBelow ? 'flex-end' : 'flex-start',
          alignItems: 'center',
          gap: 5,
          flexWrap: 'wrap',
        }}>
          {isMulti ? (
            items.map((item, idx) => (
              <span key={idx} style={{ fontSize: 9, color: item.color, fontWeight: 700 }}>{item.label}</span>
            ))
          ) : (
            <span style={{ fontSize: 9, color: accentColor, fontWeight: 700 }}>{items[0].label}</span>
          )}
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}>
            {fmt(value, market)}
          </span>
          {p != null && (
            <span style={{ fontSize: 9, color: isBelow ? 'var(--color-success)' : 'var(--color-error)', fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}>
              {p >= 0 ? '+' : ''}{p.toFixed(1)}%
            </span>
          )}
        </div>
      </div>
    )
  }

  // 전체 레벨을 가격 내림차순 정렬 후 현재가 위치에 divider 삽입
  const allSorted = [
    ...aboveGroups.map(g => ({ group: g, isAbove: true })),
    ...belowGroups.map(g => ({ group: g, isAbove: false })),
  ].sort((a, b) => b.group.value - a.group.value)

  const rows = []
  let priceInserted = price == null
  for (const item of allSorted) {
    if (!priceInserted && item.group.value < price) {
      rows.push({ type: 'current' })
      priceInserted = true
    }
    rows.push({ type: 'level', ...item })
  }
  if (!priceInserted) rows.push({ type: 'current' })

  const srCardsJSX = (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
        <div style={{ flex: 1, textAlign: 'right' }}>
          <span style={{ fontSize: 9, color: 'var(--color-success)', fontWeight: 600 }}>지지 구간 ▼</span>
        </div>
        <div style={{ width: 1 }} />
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 9, color: 'var(--color-error)', fontWeight: 600 }}>저항 구간 ▲</span>
        </div>
      </div>
      {rows.map((row) => {
        if (row.type === 'current') {
          return (
            <div key="__current__" style={{ margin: '4px 0' }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '6px 12px', borderRadius: 6,
                background: 'rgba(91,141,238,0.18)',
                border: '1px solid rgba(91,141,238,0.45)',
                borderLeft: '3px solid #5b8dee',
                borderRight: '3px solid #5b8dee',
              }}>
                <span style={{ fontSize: 9, color: '#5b8dee', fontWeight: 600 }}>현재가</span>
                {price != null && (
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}>
                    {fmt(price, market)}
                  </span>
                )}
                {rsiData?.rsi != null && (
                  <span style={{ fontSize: 9, color: 'var(--text-3)' }}>RSI {rsiData.rsi.toFixed(1)}</span>
                )}
              </div>
            </div>
          )
        }
        return (
          <div key={row.group.value} style={{ display: 'flex', gap: 6 }}>
            <div style={{ flex: 1 }}>
              {!row.isAbove && renderCard(row.group, true)}
            </div>
            <div style={{ width: 1 }} />
            <div style={{ flex: 1 }}>
              {row.isAbove && renderCard(row.group, false)}
            </div>
          </div>
        )
      })}
    </div>
  )

  // chartOnly: 바 차트만(지지/저항 카드 생략) — 요약 탭에서 동일 레벨 중복 표시 제거(task#145).
  // 지표>기술·수급 탭은 chartOnly 미전달이라 기존 2단(차트+카드) 유지.
  if (chartOnly) {
    return (
      <div style={{ marginTop: 8, display: 'flex', justifyContent: isMobile ? 'center' : 'flex-start' }}>
        <div style={{ flex: '0 1 406px', minWidth: 0, maxWidth: 460, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg)', padding: 12 }}>
          {title && <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>{title}</div>}
          {barListJSX}
        </div>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 8 }}>
      {title && <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>{title}</div>}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap', justifyContent: isMobile ? 'center' : 'flex-start' }}>
        <div style={{ flex: '0 1 406px', minWidth: 0, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg)', padding: 12 }}>
          {/* 우측 카드 헤더(지지/저항 구간) 높이만큼 상단 여백 — 두 차트 상단 정렬 */}
          <div aria-hidden style={{ fontSize: 9, fontWeight: 600, marginBottom: 4, visibility: 'hidden' }}>여백</div>
          {barListJSX}
        </div>
        <div style={{ flex: '0 1 466px', minWidth: 0, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg)', padding: 12 }}>{srCardsJSX}</div>
      </div>
    </div>
  )
}

export function RsiTable({ dailyRsi, weeklyRsi, monthlyRsi, price, vp, target, market }) {
  const [tf, setTf] = useState('daily')
  if (!dailyRsi) return null
  const rows = [
    { key: 'daily', label: '일봉', d: dailyRsi },
    { key: 'weekly', label: '주봉', d: weeklyRsi },
    { key: 'monthly', label: '월봉', d: monthlyRsi },
  ]
  const keys = ['target_20', 'target_25', 'target_30', 'target_70', 'target_75', 'target_80']
  let minDiff = Infinity
  if (price && dailyRsi) {
    keys.forEach(k => {
      if (dailyRsi[k] == null) return
      const diff = Math.abs(dailyRsi[k] - price)
      if (diff < minDiff) { minDiff = diff }
    })
  }
  const available = rows.filter(r => r.d?.rsi != null)
  if (available.length === 0) return null  // RSI 전무 시 빈 '예상 타점' 헤더 박스 미렌더
  const activeTf = available.some(r => r.key === tf) ? tf : available[0]?.key
  const activeRow = available.find(r => r.key === activeTf)
  return (
    <div style={{ marginBottom: 16, background: 'var(--bg-elev)', borderRadius: 6, padding: '10px 12px' }}>
      <SectionTitle>🎯 RSI 예상 타점</SectionTitle>
      {available.length > 0 && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
          {available.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTf(key)}
              style={{
                padding: '4px 12px', fontSize: 11, borderRadius: 6, cursor: 'pointer',
                background: activeTf === key ? 'var(--accent-soft)' : 'transparent',
                color: activeTf === key ? 'var(--accent)' : 'var(--text-3)',
                border: `1px solid ${activeTf === key ? 'var(--accent)' : 'var(--border)'}`,
                fontWeight: activeTf === key ? 600 : 400,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {activeRow && (
        <PriceLevelChart rsiData={activeRow.d} price={price} vp={vp} target={target} market={market} />
      )}
    </div>
  )
}

export function ConsensusSummary({ summary, ticker, onRefreshSuccess }) {
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState(null)

  if (!summary) return null

  const { buy = 0, hold = 0, sell = 0 } = summary
  const total = buy + hold + sell
  const needsRefresh = summary.price == null || (summary.target_high == null && summary.target_low == null && total === 0)

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
  const gap = summary.target_mean != null && summary.price != null
    ? ((summary.target_mean - summary.price) / summary.price * 100)
    : null

  const consensusWeather = (() => {
    if (!summary.price || !summary.target_mean) return null
    const g = (summary.target_mean - summary.price) / summary.price * 100
    const buyPct = total > 0 ? buy / total * 100 : 50
    if (g >= 15 && buyPct >= 60) return _weather(0)
    if (g >= 5 && buyPct >= 45) return _weather(1)
    if (g >= -5) return _weather(2)
    return _weather(3)
  })()

  return (
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
        {refreshError && <div style={{ color: 'var(--color-error)', fontSize: 11, marginBottom: 4 }}>{refreshError}</div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {/* 평균목표가 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ color: 'var(--text-3)', fontSize: 9 }}>🎯 평균목표가</span>
            <span className="mono tnum" style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>{fmt(summary.target_mean, summary.market)}</span>
          </div>
          {/* 상승여력 */}
          {gap != null && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ color: 'var(--text-3)', fontSize: 9 }}>상승여력</span>
              <span className="mono tnum" style={{ fontSize: 12, fontWeight: 600, color: gap >= 0 ? 'var(--up)' : 'var(--down)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                {gap >= 0 ? '+' : ''}{gap.toFixed(1)}%
                {gap >= 0 && <SketchArrowUp size={13} className="rpt-upside-mark" />}
              </span>
            </div>
          )}
          <span style={{ color: 'var(--border)', fontSize: 10 }}>|</span>
          {/* 최고/최저 목표가 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ color: 'var(--text-3)', fontSize: 9 }}>최고목표가</span>
            <span className="mono tnum" style={{ color: 'var(--up)', fontSize: 12, fontWeight: 600 }}>{fmt(summary.target_high, summary.market)}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ color: 'var(--text-3)', fontSize: 9 }}>최저목표가</span>
            <span className="mono tnum" style={{ color: 'var(--down)', fontSize: 12, fontWeight: 600 }}>{fmt(summary.target_low, summary.market)}</span>
          </div>
          {summary.finviz_recom != null && (
            <>
              <span style={{ color: 'var(--border)', fontSize: 10 }}>|</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ color: 'var(--text-3)', fontSize: 9 }}>Finviz 추천</span>
                <span className="mono tnum" style={{ fontSize: 12, fontWeight: 600, color: summary.finviz_recom <= 2 ? 'var(--semantic-buy)' : 'var(--text)' }}>
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
                <div className="mono tnum" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: 'var(--semantic-buy)', fontSize: 11 }}>매수 {buy}</span>
                  <span style={{ color: 'var(--text-3)', fontSize: 11 }}>중립 {hold}</span>
                  <span style={{ color: 'var(--semantic-sell)', fontSize: 11 }}>매도 {sell}</span>
                  <div style={{ display: 'flex', height: 4, borderRadius: 2, overflow: 'hidden', width: 50, flexShrink: 0 }}>
                    <div style={{ width: `${Math.round(buy / total * 100)}%`, background: 'var(--semantic-buy)' }} />
                    <div style={{ width: `${Math.round(hold / total * 100)}%`, background: 'var(--data-4)' }} />
                    <div style={{ width: `${Math.round(sell / total * 100)}%`, background: 'var(--semantic-sell)' }} />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
  )
}

export function VolumeRsiSnapshot({ summary, chartOnly = false }) {
  if (!summary) return null

  const rsiWeather = (() => {
    const rsi = summary.daily_rsi?.rsi
    if (rsi == null) return null
    if (rsi < 30) return _weather(0)
    if (rsi < 45) return _weather(1)
    if (rsi < 65) return _weather(2)
    return _weather(3)
  })()

  return (
    <div style={{ background: 'var(--bg-elev)', borderRadius: 6, padding: 14 }}>
      <SectionTitle weather={rsiWeather}>📉 매물대 &amp; RSI 현황</SectionTitle>
      <div style={{ display: 'flex', columnGap: 14, rowGap: 6, flexWrap: 'wrap', marginBottom: 6, marginTop: 4 }}>
        {[
          { color: 'var(--text)', label: '현재가', desc: '현재 주가' },
          { color: 'var(--data-3)', label: '평균목표가', desc: '애널리스트 평균 목표주가' },
          { color: 'var(--data-2)', label: 'POC', desc: '거래량 최대 가격대' },
          { color: 'var(--data-5)', label: 'HVN', desc: '고거래량 가격대(지지·저항)' },
          { color: 'var(--semantic-buy)', label: 'RSI20~30', desc: '일봉 RSI 과매도 가격' },
          { color: 'var(--semantic-sell)', label: 'RSI70~80', desc: '일봉 RSI 과매수 가격' },
        ].map(({ color, label, desc }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }} title={desc}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-2)' }}>{label}</span>
            <span style={{ fontSize: 9, color: 'var(--text-3)' }}>{desc}</span>
          </div>
        ))}
      </div>
      <PriceLevelChart
        rsiData={summary.daily_rsi}
        price={summary.price}
        vp={summary.volume_profile}
        target={summary.target_mean}
        market={summary.market}
        chartOnly={chartOnly}
      />
    </div>
  )
}

// eco: inline-style only, no new CSS file — matches surrounding component idiom
export function TechnicalStats({ summary }) {
  if (!summary) return null
  const { week52_high, week52_low, ema20, ema50, ema200, trend, beta, hv, price, market } = summary

  const hasLevels = week52_high != null || week52_low != null || ema20 != null || ema50 != null || ema200 != null
  const hasTrend = trend != null
  const hasBetaHv = beta != null || hv != null

  if (!hasLevels && !hasTrend && !hasBetaHv) return null

  const fmtPct = v => (v == null || !Number.isFinite(v)) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
  const fmtFloat = (v, digits = 2) => (v == null || !Number.isFinite(v)) ? '—' : v.toFixed(digits)

  // above/below EMA: use price-direction tokens (--up=red=up, --down=blue=down) — KR convention
  const emaColor = (flag) => flag == null ? 'var(--text-3)' : flag ? 'var(--up)' : 'var(--down)'
  const emaLabel = (flag, ema) => {
    if (flag == null || ema == null) return '—'
    return flag ? '위 ▲' : '아래 ▼'
  }

  const StatRow = ({ label, value, valueColor }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{label}</span>
      <span className="mono tnum" style={{ fontSize: 12, fontWeight: 600, color: valueColor || 'var(--text)' }}>{value}</span>
    </div>
  )

  return (
    <div style={{ background: 'var(--bg-elev)', borderRadius: 6, padding: '10px 12px', marginBottom: 16 }}>
      <SectionTitle>📐 기술적 지표</SectionTitle>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>

        {/* 52주 고저 + EMA 레벨 */}
        {hasLevels && (
          <div style={{ flex: '1 1 160px', minWidth: 140 }}>
            <div style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 600, marginBottom: 4 }}>가격 레벨</div>
            <StatRow label="52주 고가" value={fmt(week52_high, market)} valueColor="var(--up)" />
            <StatRow label="52주 저가" value={fmt(week52_low, market)} valueColor="var(--down)" />
            <StatRow label="EMA 20" value={fmt(ema20, market)} />
            <StatRow label="EMA 50" value={fmt(ema50, market)} />
            <StatRow label="EMA 200" value={fmt(ema200, market)} />
          </div>
        )}

        {/* 추세 요약 */}
        {hasTrend && (
          <div style={{ flex: '1 1 160px', minWidth: 140 }}>
            <div style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 600, marginBottom: 4 }}>추세 요약</div>
            <StatRow
              label="EMA 20 대비"
              value={emaLabel(trend.above_ema20, ema20)}
              valueColor={emaColor(trend.above_ema20)}
            />
            <StatRow
              label="EMA 50 대비"
              value={emaLabel(trend.above_ema50, ema50)}
              valueColor={emaColor(trend.above_ema50)}
            />
            <StatRow
              label="EMA 200 대비"
              value={emaLabel(trend.above_ema200, ema200)}
              valueColor={emaColor(trend.above_ema200)}
            />
            <StatRow
              label="30일 수익률"
              value={fmtPct(trend.return_30d)}
              valueColor={trend.return_30d == null ? undefined : trend.return_30d >= 0 ? 'var(--up)' : 'var(--down)'}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0' }}>
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>크로스</span>
              <span style={{ fontSize: 11, fontWeight: 600 }}>
                {trend.golden_cross
                  ? <span style={{ color: 'var(--up)' }}>골든크로스 ✓</span>
                  : trend.dead_cross
                    ? <span style={{ color: 'var(--down)' }}>데드크로스 ✗</span>
                    : <span style={{ color: 'var(--text-3)' }}>—</span>
                }
              </span>
            </div>
          </div>
        )}

        {/* 베타·변동성 */}
        {hasBetaHv && (
          <div style={{ flex: '1 1 120px', minWidth: 110 }}>
            <div style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 600, marginBottom: 4 }}>리스크 지표</div>
            <StatRow label="베타 (β)" value={fmtFloat(beta)} />
            <StatRow label="역사적 변동성" value={beta != null || hv != null ? (hv == null ? '—' : `${fmtFloat(hv * 100, 1)}%`) : '—'} />
          </div>
        )}

      </div>
    </div>
  )
}

export function BacklogSection({ ticker, market }) {
  const [backlogData, setBacklogData] = useState(null)

  useEffect(() => {
    if (!ticker || market !== 'KR') return
    api.get(`/api/report/${ticker}/backlog`)
      .then(({ data }) => setBacklogData(data))
      .catch(() => setBacklogData([]))
  }, [ticker, market])

  if (market !== 'KR' || !backlogData?.length) return null
  return <BacklogChart data={backlogData} />
}

// 랭킹 페이지(Ranking.jsx)에서 재사용하는 기존 요약 레이아웃. 리포트 상세는
// 위 조각들을 탭별로 직접 조합하므로 이 래퍼를 쓰지 않는다.
export default function DetailSummaryTab({ summary, ticker, onRefreshSuccess }) {
  if (!summary) return null
  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <ConsensusSummary summary={summary} ticker={ticker} onRefreshSuccess={onRefreshSuccess} />
        <ConsensusChart ticker={ticker} market={summary.market} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <VolumeRsiSnapshot summary={summary} />
        </div>
      </div>
      <FinancialsChart financials={summary.financials} financialsAnnual={summary.financials_annual} market={summary.market} />
      <BacklogSection ticker={ticker} market={summary.market} />
    </div>
  )
}
