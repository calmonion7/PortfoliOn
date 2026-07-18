import { useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, LabelList, ComposedChart, Bar } from 'recharts'
import { _weather, SectionTitle } from './reportUtils.jsx'
import { GlossaryText } from '../Glossary.jsx'

export default function FinancialsChart({ financials, financialsAnnual, market }) {
  const [finTab, setFinTab] = useState('annual')
  if (!financials?.length) return null

  const isKR = market === 'KR'

  // 차트 Y축용 (짧은 표현)
  const fmtVal = (v) => {
    if (v == null) return '—'
    if (isKR) {
      const abs = Math.abs(v)
      if (abs >= 1e12) return `${(v / 1e12).toFixed(0)}조`
      if (abs >= 1e8)  return `${Math.round(v / 1e8)}억`
      return Math.round(v).toLocaleString()
    }
    const abs = Math.abs(v)
    if (abs >= 1e12) return `${(v / 1e12).toFixed(1)}T`
    if (abs >= 1e9)  return `${(v / 1e9).toFixed(1)}B`
    if (abs >= 1e6)  return `${(v / 1e6).toFixed(0)}M`
    return `${(v / 1e3).toFixed(0)}K`
  }

  // 툴팁/테이블용 (상세 표현)
  const fmtValFull = (v) => {
    if (v == null) return '—'
    if (isKR) {
      const abs = Math.abs(v)
      if (abs >= 1e12) return `${(v / 1e12).toFixed(2)}조원`
      return `${Math.round(v / 1e8).toLocaleString()}억원`
    }
    return fmtVal(v)
  }

  // EPS/BPS 포맷
  const fmtShare = (v) => {
    if (v == null) return '—'
    if (isKR) return `${Math.round(v).toLocaleString()}원`
    const abs = Math.abs(v)
    if (abs >= 10000) return `${(v / 1000).toFixed(0)}K`
    if (abs >= 100)   return v.toFixed(0)
    return v.toFixed(2)
  }

  // EPS/BPS 차트 축용 (짧게)
  const fmtShareAxis = (v) => {
    if (v == null) return '—'
    if (isKR) {
      const abs = Math.abs(v)
      if (abs >= 10000) return `${Math.round(v / 1000)}K`
      return Math.round(v).toLocaleString()
    }
    return fmtShare(v)
  }

  const calcChg = (curr, prev) => {
    if (curr == null || prev == null) return { abs: null, pct: null }
    const abs = curr - prev
    const pct = prev !== 0 ? Math.round((abs / Math.abs(prev)) * 1000) / 10 : null
    return { abs, pct }
  }

  const toChartData = (list) => {
    const reversed = [...list].reverse()
    return reversed.map((f, i) => {
      const p = i > 0 ? reversed[i - 1] : null
      const rev = calcChg(f.revenue, p?.revenue)
      const op  = calcChg(f.operating_income, p?.operating_income)
      const eps = calcChg(f.eps, p?.eps)
      const bps = calcChg(f.bps, p?.bps)
      return {
        period: f.is_consensus ? `${f.period}(E)` : f.period,
        revenue:   f.revenue,
        op_income: f.operating_income,
        net_income: f.net_income ?? null,
        eps: f.eps ?? null,
        bps: f.bps ?? null,
        per: f.per ?? null,
        pbr: f.pbr ?? null,
        operating_margin: f.operating_margin ?? null,
        net_margin:       f.net_margin       ?? null,
        roe:              f.roe              ?? null,
        debt_ratio:       f.debt_ratio       ?? null,
        quick_ratio:      f.quick_ratio      ?? null,
        is_consensus: f.is_consensus,
        margin: f.revenue && f.operating_income != null
          ? Math.round(f.operating_income / f.revenue * 100) : null,
        rev_chg_abs: rev.abs,  rev_chg_pct: rev.pct,
        op_chg_abs:  op.abs,   op_chg_pct:  op.pct,
        eps_chg_abs: eps.abs,  eps_chg_pct: eps.pct,
        bps_chg_abs: bps.abs,  bps_chg_pct: bps.pct,
        fcf:      f.fcf      ?? null,
        coverage: f.interest_coverage ?? null,
      }
    })
  }

  const quarterData = toChartData(financials)
  const annualData  = financialsAnnual?.length ? toChartData(financialsAnnual) : []

  // 범례 용어 설명은 용어집 클릭 팝오버로 통합 (기존 hover 툴팁 대체 — 모바일 탭도 지원)
  const Legend = ({ items, weather }) => (
    <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--text-3)', marginBottom: 4, alignItems: 'center' }}>
      {items.map(({ color, label }) => (
        <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 16, height: 2, background: color, display: 'inline-block', borderRadius: 1 }} />
          <span><GlossaryText text={label} /></span>
        </span>
      ))}
      {weather && <span title={weather.label} style={{ marginLeft: 4, fontSize: 13, lineHeight: 1 }}>{weather.icon}</span>}
    </div>
  )

  const axisStyle = { fontSize: 10, fill: 'var(--text-3)' }
  const chartMargin = { top: 4, right: 8, left: 0, bottom: 0 }
  const lineCfg = { type: 'monotone', strokeWidth: 2, dot: { r: 3 }, activeDot: { r: 5 }, connectNulls: true }

  const CHG_KEYS = {
    revenue:   { abs: 'rev_chg_abs', pct: 'rev_chg_pct' },
    op_income: { abs: 'op_chg_abs',  pct: 'op_chg_pct'  },
    eps:       { abs: 'eps_chg_abs', pct: 'eps_chg_pct' },
    bps:       { abs: 'bps_chg_abs', pct: 'bps_chg_pct' },
  }

  const ChgBadge = ({ abs, pct, fmtFn }) => {
    if (abs == null) return null
    const pos = abs >= 0
    const arrow = pos ? '▲' : '▼'
    const color = pos ? 'var(--up)' : 'var(--down)'
    return (
      <span style={{ color, marginLeft: 6, fontSize: 10 }}>
        {arrow} {fmtFn(Math.abs(abs))} ({pos ? '+' : ''}{pct}%)
      </span>
    )
  }

  const makeTooltip = (isBig) => ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    const row = payload[0]?.payload
    return (
      <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', fontSize: 11 }}>
        <div style={{ color: 'var(--accent)', fontWeight: 700, marginBottom: 4 }}>{label}</div>
        {payload.map(p => {
          const ck = CHG_KEYS[p.dataKey]
          return (
            <div key={p.dataKey} style={{ color: p.stroke, marginBottom: 2 }}>
              {p.name}: {p.value != null ? (isBig ? fmtValFull(p.value) : p.value.toFixed(1)) : '—'}
              {ck && <ChgBadge abs={row?.[ck.abs]} pct={row?.[ck.pct]} fmtFn={isBig ? fmtValFull : (v) => v.toFixed(1)} />}
            </div>
          )
        })}
      </div>
    )
  }

  const makeShareTooltip = () => ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    const row = payload[0]?.payload
    return (
      <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', fontSize: 11 }}>
        <div style={{ color: 'var(--accent)', fontWeight: 700, marginBottom: 4 }}>{label}</div>
        {payload.map(p => {
          const ck = CHG_KEYS[p.dataKey]
          return (
            <div key={p.dataKey} style={{ color: p.stroke, marginBottom: 2 }}>
              {p.name}: {p.value != null ? fmtShare(p.value) : '—'}
              {ck && <ChgBadge abs={row?.[ck.abs]} pct={row?.[ck.pct]} fmtFn={fmtShare} />}
            </div>
          )
        })}
      </div>
    )
  }

  // 차트 라벨: % 변화율 (데이터 포인트 위에 표시)
  // LabelList는 dataKey에 해당하는 값을 value로 전달
  const PctLabel = () => ({ x, y, value, index }) => {
    if (index === 0 || value == null) return null
    const pos = value >= 0
    return (
      <text x={x} y={y - 10} textAnchor="middle" fontSize={8} fill={pos ? 'var(--up)' : 'var(--down)'}>
        {pos ? '+' : ''}{value.toFixed(1)}%
      </text>
    )
  }

  const calcFinancialsWeather = (data) => {
    const real = data.filter(d => !d.is_consensus)
    if (real.length < 2) return null
    const recent = real.slice(-3)
    const revPcts = recent.slice(1).map(d => d.rev_chg_pct).filter(v => v != null)
    const opPcts  = recent.slice(1).map(d => d.op_chg_pct).filter(v => v != null)
    if (!revPcts.length && !opPcts.length) return null
    const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length
    const avgRev = revPcts.length ? avg(revPcts) : 0
    const avgOp  = opPcts.length  ? avg(opPcts)  : avgRev
    if (avgRev > 5 && avgOp > 5) return _weather(0)
    if (avgRev > 0 && avgOp > 0) return _weather(1)
    if (avgRev > -5 || avgOp > -5) return _weather(2)
    return _weather(3)
  }

  const pctWeather = (pcts) => {
    if (!pcts.length) return null
    const avg = pcts.reduce((a, b) => a + b, 0) / pcts.length
    if (avg > 5) return _weather(0)
    if (avg > 0) return _weather(1)
    if (avg > -5) return _weather(2)
    return _weather(3)
  }

  const Section = ({ data, title, isAnnual }) => {
    const hasEpsBps = data.some(d => d.eps != null || d.bps != null)
    const hasPerPbr = data.some(d => d.per != null || d.pbr != null)
    const weather = calcFinancialsWeather(data)

    const real = data.filter(d => !d.is_consensus)
    const recent = real.slice(-3)

    const revOpWeather = pctWeather([
      ...recent.slice(1).map(d => d.rev_chg_pct).filter(v => v != null),
      ...recent.slice(1).map(d => d.op_chg_pct).filter(v => v != null),
    ])
    const epsWeather = pctWeather(
      recent.slice(1).map(d => d.eps_chg_pct).filter(v => v != null)
    )
    const perWeather = (() => {
      const pers = recent.filter(d => d.per != null).map(d => d.per)
      if (pers.length < 2) return null
      const diff = pers[pers.length - 1] - pers[0]
      // PER 하락 = 저평가되거나 이익 증가 = 긍정
      if (diff < -3) return _weather(0)
      if (diff < 0)  return _weather(1)
      if (diff < 3)  return _weather(2)
      return _weather(3)
    })()

    return (
      <div style={{ background: 'var(--bg-elev)', borderRadius: 6, padding: 14, marginTop: 12 }}>
        <SectionTitle weather={weather}>{title}</SectionTitle>

        {/* 매출 / 영업이익 / 순이익 */}
        {(() => {
          const hasNetIncome = data.some(d => d.net_income != null)
          return (
            <div style={{ marginTop: 8 }}>
              <Legend items={[
                { color: 'var(--data-2)', label: '매출' },
                { color: 'var(--data-5)', label: '영업이익' },
                ...(hasNetIncome ? [{ color: 'var(--data-3)', label: '순이익' }] : []),
              ]} weather={revOpWeather} />
              <ResponsiveContainer width="100%" height={165}>
                <LineChart data={data} margin={{ ...chartMargin, top: 18 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                  <XAxis dataKey="period" tick={axisStyle} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={fmtVal} tick={axisStyle} axisLine={false} tickLine={false} width={36} />
                  <Tooltip content={makeTooltip(true)} />
                  <ReferenceLine y={0} stroke="var(--border)" />
                  <Line {...lineCfg} dataKey="revenue"    name="매출"    stroke="var(--data-2)">
                    <LabelList dataKey="rev_chg_pct" content={PctLabel()} />
                  </Line>
                  <Line {...lineCfg} dataKey="op_income"  name="영업이익" stroke="var(--data-5)">
                    <LabelList dataKey="op_chg_pct" content={PctLabel()} />
                  </Line>
                  {hasNetIncome && (
                    <Line {...lineCfg} dataKey="net_income" name="순이익" stroke="var(--data-3)" strokeDasharray="4 2" />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )
        })()}

        {/* EPS / BPS */}
        {hasEpsBps && (
          <div style={{ marginTop: 12 }}>
            <Legend items={[{ color: 'var(--data-2)', label: 'EPS' }, { color: 'var(--data-3)', label: 'BPS' }]} weather={epsWeather} />
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={data} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="period" tick={axisStyle} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={fmtShareAxis} tick={axisStyle} axisLine={false} tickLine={false} width={36} />
                <Tooltip content={makeShareTooltip()} />
                <Line {...lineCfg} dataKey="eps" name="EPS" stroke="var(--data-2)" />
                <Line {...lineCfg} dataKey="bps" name="BPS" stroke="var(--data-3)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* PER / PBR */}
        {hasPerPbr && (
          <div style={{ marginTop: 12 }}>
            <Legend items={[{ color: 'var(--data-3)', label: 'PER' }, { color: 'var(--data-4)', label: 'PBR' }]} weather={perWeather} />
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={data} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="period" tick={axisStyle} axisLine={false} tickLine={false} />
                <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={36} />
                <Tooltip content={makeTooltip(false)} />
                <Line {...lineCfg} dataKey="per" name="PER" stroke="var(--data-3)" />
                <Line {...lineCfg} dataKey="pbr" name="PBR" stroke="var(--data-4)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* 수익성 % */}
        {data.some(d => d.operating_margin != null || d.net_margin != null || d.roe != null) && (
          <div style={{ marginTop: 12 }}>
            <Legend items={[
              { color: 'var(--data-1)', label: '영업이익률' },
              { color: 'var(--data-5)', label: '순이익률' },
              { color: 'var(--data-3)', label: 'ROE' },
            ]} />
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={data} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="period" tick={axisStyle} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={v => `${v}%`} tick={axisStyle} axisLine={false} tickLine={false} width={36} />
                <Tooltip content={makeTooltip(false)} />
                <ReferenceLine y={0} stroke="var(--border)" />
                <Line {...lineCfg} dataKey="operating_margin" name="영업이익률" stroke="var(--data-1)" />
                <Line {...lineCfg} dataKey="net_margin"       name="순이익률"   stroke="var(--data-5)" />
                <Line {...lineCfg} dataKey="roe"              name="ROE"        stroke="var(--data-3)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* 안정성 % */}
        {data.some(d => d.debt_ratio != null || d.quick_ratio != null) && (
          <div style={{ marginTop: 12 }}>
            <Legend items={[
              { color: 'var(--warn)', label: '부채비율' },
              { color: 'var(--data-2)', label: '당좌비율' },
            ]} />
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={data} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="period" tick={axisStyle} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={v => `${v}%`} tick={axisStyle} axisLine={false} tickLine={false} width={42} />
                <Tooltip content={makeTooltip(false)} />
                <ReferenceLine y={0} stroke="var(--border)" />
                <Line {...lineCfg} dataKey="debt_ratio"  name="부채비율" stroke="var(--warn)" />
                <Line {...lineCfg} dataKey="quick_ratio" name="당좌비율" stroke="var(--data-2)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* FCF + 이자보상배율 (연간 전용) */}
        {isAnnual && data.some(d => d.fcf != null) && (() => {
          const hasCoverage = data.some(d => d.coverage != null)
          return (
            <div style={{ marginTop: 12 }}>
              <Legend items={[
                { color: 'var(--data-2)', label: 'FCF' },
                ...(hasCoverage ? [{ color: 'var(--data-3)', label: '이자보상배율' }] : []),
              ]} />
              <ResponsiveContainer width="100%" height={150}>
                <ComposedChart data={data} margin={chartMargin}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                  <XAxis dataKey="period" tick={axisStyle} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="left"  tickFormatter={fmtVal} tick={axisStyle} axisLine={false} tickLine={false} width={36} />
                  {hasCoverage && (
                    <YAxis yAxisId="right" orientation="right" tickFormatter={v => `${v}x`} tick={axisStyle} axisLine={false} tickLine={false} width={32} />
                  )}
                  <Tooltip content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    return (
                      <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', fontSize: 11 }}>
                        <div style={{ color: 'var(--accent)', fontWeight: 700, marginBottom: 4 }}>{label}</div>
                        {payload.map(p => (
                          <div key={p.dataKey} style={{ color: p.stroke ?? p.fill, marginBottom: 2 }}>
                            {p.name}: {p.value != null
                              ? (p.dataKey === 'coverage' ? `${p.value.toFixed(1)}x` : fmtValFull(p.value))
                              : '—'}
                          </div>
                        ))}
                      </div>
                    )
                  }} />
                  <ReferenceLine yAxisId="left" y={0} stroke="var(--border)" />
                  <Bar dataKey="fcf" yAxisId="left" name="FCF" fill="var(--data-2)" opacity={0.75} radius={[2,2,0,0]} />
                  {hasCoverage && (
                    <Line {...lineCfg} dataKey="coverage" yAxisId="right" name="이자보상배율" stroke="var(--data-3)" strokeDasharray="5 3" />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )
        })()}
      </div>
    )
  }

  const hasAnnual = annualData.length > 0
  const activeFin = (hasAnnual && finTab === 'annual') ? 'annual' : 'quarter'

  return (
    <>
      {hasAnnual && (
        <div style={{ display: 'flex', gap: 4, alignSelf: 'flex-start', marginTop: 12 }}>
          {[
            { key: 'annual', label: '📈 연간' },
            { key: 'quarter', label: '📊 분기' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFinTab(key)}
              style={{
                padding: '4px 12px', fontSize: 11, borderRadius: 6, cursor: 'pointer',
                background: activeFin === key ? 'var(--accent-soft)' : 'transparent',
                color: activeFin === key ? 'var(--accent)' : 'var(--text-3)',
                border: `1px solid ${activeFin === key ? 'var(--accent)' : 'var(--border)'}`,
                fontWeight: activeFin === key ? 600 : 400,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {activeFin === 'annual'
        ? <Section data={annualData} title="📈 연간 실적 추이" isAnnual={true} />
        : <Section data={quarterData} title="📊 분기 실적 추이" isAnnual={false} />}
    </>
  )
}
