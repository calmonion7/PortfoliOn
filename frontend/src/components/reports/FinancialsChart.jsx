import { useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, LabelList } from 'recharts'
import { fmtPrice as fmt } from '../../utils'
import { _weather, SectionTitle } from './reportUtils.jsx'

export default function FinancialsChart({ financials, financialsAnnual, market }) {
  const [hoveredLegend, setHoveredLegend] = useState(null)
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
        eps: f.eps ?? null,
        bps: f.bps ?? null,
        per: f.per ?? null,
        pbr: f.pbr ?? null,
        is_consensus: f.is_consensus,
        margin: f.revenue && f.operating_income != null
          ? Math.round(f.operating_income / f.revenue * 100) : null,
        rev_chg_abs: rev.abs,  rev_chg_pct: rev.pct,
        op_chg_abs:  op.abs,   op_chg_pct:  op.pct,
        eps_chg_abs: eps.abs,  eps_chg_pct: eps.pct,
        bps_chg_abs: bps.abs,  bps_chg_pct: bps.pct,
      }
    })
  }

  const quarterData = toChartData(financials)
  const annualData  = financialsAnnual?.length ? toChartData(financialsAnnual) : []

  const DESCS = {
    EPS: '주당순이익 — 순이익 ÷ 발행주식수',
    BPS: '주당순자산 — 순자산 ÷ 발행주식수',
    PER: '주가수익비율 — 주가 ÷ EPS (낮을수록 저평가)',
    PBR: '주가순자산비율 — 주가 ÷ BPS (낮을수록 저평가)',
  }

  const Legend = ({ items, weather }) => (
    <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--text-3)', marginBottom: 4, alignItems: 'center' }}>
      {items.map(({ color, label }) => {
        const desc = DESCS[label]
        return (
          <span
            key={label}
            style={{ display: 'flex', alignItems: 'center', gap: 4, position: 'relative', cursor: desc ? 'help' : 'default' }}
            onMouseEnter={() => desc && setHoveredLegend(label)}
            onMouseLeave={() => setHoveredLegend(null)}
          >
            <span style={{ width: 16, height: 2, background: color, display: 'inline-block', borderRadius: 1 }} />
            {label}
            {hoveredLegend === label && (
              <div style={{
                position: 'absolute', bottom: 'calc(100% + 6px)', left: 0,
                background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 4,
                padding: '5px 9px', fontSize: 10, color: 'var(--text-3)', whiteSpace: 'nowrap',
                zIndex: 50, pointerEvents: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
              }}>
                {desc}
              </div>
            )}
          </span>
        )
      })}
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
    const color = pos ? '#81c784' : '#ef9a9a'
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
      <text x={x} y={y - 10} textAnchor="middle" fontSize={8} fill={pos ? '#81c784' : '#ef9a9a'}>
        {pos ? '+' : ''}{value.toFixed(1)}%
      </text>
    )
  }

  const TH = ({ children, color }) => (
    <th style={{ color: color || 'var(--text-3)', textAlign: 'right', padding: '2px 6px', fontWeight: 400 }}>{children}</th>
  )
  const TD = ({ children, color }) => (
    <td style={{ color: color || 'var(--text-3)', textAlign: 'right', padding: '1px 6px' }}>{children}</td>
  )

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

  const Section = ({ data, title }) => {
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

        {/* 매출 / 영업이익 */}
        <div style={{ marginTop: 8 }}>
          <Legend items={[{ color: '#4fc3f7', label: '매출' }, { color: '#81c784', label: '영업이익' }]} weather={revOpWeather} />
          <ResponsiveContainer width="100%" height={165}>
            <LineChart data={data} margin={{ ...chartMargin, top: 18 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="period" tick={axisStyle} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={fmtVal} tick={axisStyle} axisLine={false} tickLine={false} width={36} />
              <Tooltip content={makeTooltip(true)} />
              <ReferenceLine y={0} stroke="var(--border)" />
              <Line {...lineCfg} dataKey="revenue"   name="매출"    stroke="#4fc3f7">
                <LabelList dataKey="rev_chg_pct" content={PctLabel()} />
              </Line>
              <Line {...lineCfg} dataKey="op_income" name="영업이익" stroke="#81c784">
                <LabelList dataKey="op_chg_pct" content={PctLabel()} />
              </Line>
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* EPS / BPS + PER / PBR (2열) */}
        {(hasEpsBps || hasPerPbr) && (
          <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
            {hasEpsBps && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <Legend items={[{ color: '#80cbc4', label: 'EPS' }, { color: '#f48fb1', label: 'BPS' }]} weather={epsWeather} />
                <ResponsiveContainer width="100%" height={120}>
                  <LineChart data={data} margin={chartMargin}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                    <XAxis dataKey="period" tick={axisStyle} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={fmtShareAxis} tick={axisStyle} axisLine={false} tickLine={false} width={36} />
                    <Tooltip content={makeShareTooltip()} />
                    <Line {...lineCfg} dataKey="eps" name="EPS" stroke="#80cbc4" />
                    <Line {...lineCfg} dataKey="bps" name="BPS" stroke="#f48fb1" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            {hasPerPbr && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <Legend items={[{ color: '#ffcc80', label: 'PER' }, { color: '#ce93d8', label: 'PBR' }]} weather={perWeather} />
                <ResponsiveContainer width="100%" height={120}>
                  <LineChart data={data} margin={chartMargin}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                    <XAxis dataKey="period" tick={axisStyle} axisLine={false} tickLine={false} />
                    <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={36} />
                    <Tooltip content={makeTooltip(false)} />
                    <Line {...lineCfg} dataKey="per" name="PER" stroke="#ffcc80" />
                    <Line {...lineCfg} dataKey="pbr" name="PBR" stroke="#ce93d8" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* 테이블 */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10, fontSize: 10 }}>
          <thead>
            <tr>
              <TH>기간</TH>
              <TH color="#4fc3f7">매출</TH>
              <TH color="#4fc3f7">매출 증감</TH>
              <TH color="#81c784">영업이익</TH>
              <TH color="#81c784">영업이익 증감</TH>
              <TH>영업이익률</TH>
              {hasEpsBps && <TH color="#80cbc4">EPS</TH>}
              {hasEpsBps && <TH color="#f48fb1">BPS</TH>}
              {hasPerPbr && <TH color="#ffcc80">PER</TH>}
              {hasPerPbr && <TH color="#ce93d8">PBR</TH>}
            </tr>
          </thead>
          <tbody>
            {data.map(d => {
              const revPos = d.rev_chg_abs == null ? null : d.rev_chg_abs >= 0
              const opPos  = d.op_chg_abs  == null ? null : d.op_chg_abs  >= 0
              return (
                <tr key={d.period} style={d.is_consensus ? { opacity: 0.75, fontStyle: 'italic' } : {}}>
                  <TD color={d.is_consensus ? '#ffcc80' : 'var(--text-3)'}>{d.period}</TD>
                  <TD color="#4fc3f7">{fmtValFull(d.revenue)}</TD>
                  <td style={{ textAlign: 'right', padding: '1px 6px', color: revPos === true ? '#81c784' : revPos === false ? '#ef9a9a' : 'var(--text-3)' }}>
                    {d.rev_chg_abs != null
                      ? <>{revPos ? '▲' : '▼'} {fmtValFull(Math.abs(d.rev_chg_abs))}<br /><span style={{ fontSize: 9 }}>({d.rev_chg_pct >= 0 ? '+' : ''}{d.rev_chg_pct}%)</span></>
                      : '—'}
                  </td>
                  <TD color={d.op_income != null && d.op_income >= 0 ? '#81c784' : '#ef9a9a'}>{fmtValFull(d.op_income)}</TD>
                  <td style={{ textAlign: 'right', padding: '1px 6px', color: opPos === true ? '#81c784' : opPos === false ? '#ef9a9a' : 'var(--text-3)' }}>
                    {d.op_chg_abs != null
                      ? <>{opPos ? '▲' : '▼'} {fmtValFull(Math.abs(d.op_chg_abs))}<br /><span style={{ fontSize: 9 }}>({d.op_chg_pct >= 0 ? '+' : ''}{d.op_chg_pct}%)</span></>
                      : '—'}
                  </td>
                  <TD>{d.margin != null ? `${d.margin}%` : '—'}</TD>
                  {hasEpsBps && <TD color="#80cbc4">{fmtShare(d.eps)}</TD>}
                  {hasEpsBps && <TD color="#f48fb1">{fmtShare(d.bps)}</TD>}
                  {hasPerPbr && <TD color="#ffcc80">{d.per ?? '—'}</TD>}
                  {hasPerPbr && <TD color="#ce93d8">{d.pbr ?? '—'}</TD>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <>
      {annualData.length > 0 && <Section data={annualData} title="📈 연간 실적 추이" />}
      <Section data={quarterData} title="📊 분기 실적 추이" />
    </>
  )
}
