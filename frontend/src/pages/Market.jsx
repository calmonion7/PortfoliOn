import { useState, useEffect } from 'react'
import axios from 'axios'
import {
  LineChart, Line, LabelList,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'

const krFmt = v => {
  if (v == null) return '-'
  if (Math.abs(v) >= 10000) return `${(v / 10000).toFixed(1)}조`
  return `${Math.round(v).toLocaleString()}억`
}

const CARD_STYLE = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '12px 16px',
}

const SECTION_STYLE = { marginBottom: 40 }

const SECTION_HEADER_STYLE = {
  color: 'var(--text)',
  fontSize: 16,
  fontWeight: 600,
  marginBottom: 6,
  borderBottom: '1px solid var(--border)',
  paddingBottom: 8,
}

const DESC_STYLE = {
  fontSize: 12,
  color: 'var(--text-muted)',
  marginBottom: 16,
  lineHeight: 1.6,
}

function LoadingBox() {
  return (
    <div style={{ ...CARD_STYLE, color: 'var(--text-muted)', fontSize: 13, padding: 24 }}>
      데이터 수집 중입니다. 처음 로드 시 수분 소요될 수 있습니다...
    </div>
  )
}

function ErrorBox({ msg }) {
  return (
    <div style={{ ...CARD_STYLE, color: '#e57373', fontSize: 13, padding: 16 }}>
      {msg || '데이터를 불러오지 못했습니다.'}
    </div>
  )
}

function FxSection() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    axios.get('/api/market/fx')
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>환율</h3><LoadingBox /></div>
  if (error || !data) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>환율</h3><ErrorBox /></div>

  const FX_LABELS = { usdkrw: 'USD/KRW', usdjpy: 'USD/JPY', eurusd: 'EUR/USD' }
  const rates = data.rates || {}
  const usdkrwHistory = (data.history?.usdkrw || []).slice(-252)

  return (
    <div style={SECTION_STYLE}>
      <h3 style={SECTION_HEADER_STYLE}>환율</h3>
      <p style={DESC_STYLE}>원/달러 환율은 수출 기업 수익성과 외국인 자금 흐름에 직접 영향을 미칩니다. 달러 강세(원화 약세)는 수출 채산성 개선 요인이지만 수입 물가 상승을 유발합니다. 엔화·위안화는 경쟁국 통화 동향 파악에 활용합니다.</p>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {['usdkrw', 'usdjpy', 'eurusd'].map(key => {
          const r = rates[key]
          const up = r?.change_pct > 0
          const down = r?.change_pct < 0
          return (
            <div key={key} style={{ ...CARD_STYLE, minWidth: 110, flex: 1 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{FX_LABELS[key]}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
                {r ? r.current.toLocaleString() : '-'}
              </div>
              {r && (
                <div style={{ fontSize: 12, color: up ? '#81c784' : down ? '#e57373' : 'var(--text-muted)', marginTop: 2 }}>
                  {up ? '▲' : down ? '▼' : '─'} {Math.abs(r.change_pct).toFixed(2)}%
                </div>
              )}
            </div>
          )
        })}
      </div>
      {usdkrwHistory.length > 0 && (
        <div style={CARD_STYLE}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>USD/KRW 추이 (1년)</div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={usdkrwHistory} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                     tickFormatter={v => v.slice(5)} interval={Math.floor(usdkrwHistory.length / 6)} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} domain={['auto', 'auto']} />
              <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', fontSize: 12 }}
                       labelStyle={{ color: 'var(--text-muted)' }} />
              <Line type="monotone" dataKey="value" name="USD/KRW" stroke="#4fc3f7" dot={false} strokeWidth={1.5} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

function VixSection() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    axios.get('/api/market/vix')
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>공포탐욕지수 (VIX)</h3><LoadingBox /></div>
  if (error || !data) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>공포탐욕지수 (VIX)</h3><ErrorBox /></div>

  const vix = data.current
  const vixColor = vix >= 30 ? '#e57373' : vix >= 20 ? '#ffb74d' : '#81c784'
  const vixLabel = vix >= 30 ? '공포' : vix >= 20 ? '주의' : '탐욕'
  const history = (data.history || []).slice(-252)

  return (
    <div style={SECTION_STYLE}>
      <h3 style={SECTION_HEADER_STYLE}>공포탐욕지수 (VIX)</h3>
      <p style={DESC_STYLE}>S&P 500 옵션 내재변동성을 기반으로 시장 심리를 수치화한 지수입니다. 20 이하는 안정, 20~30은 주의, 30 이상은 공포 구간으로 해석합니다. 급등 시 단기 과매도 신호로 활용되기도 합니다.</p>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <div style={{ ...CARD_STYLE, minWidth: 140 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>VIX 현재값</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: vixColor }}>
            {vix != null ? vix.toFixed(1) : '-'}
          </div>
          <div style={{ fontSize: 12, color: vixColor, marginTop: 2 }}>{vixLabel}</div>
          {data.change != null && (
            <div style={{ fontSize: 12, color: data.change > 0 ? '#e57373' : '#81c784', marginTop: 4 }}>
              {data.change > 0 ? '▲' : '▼'} {Math.abs(data.change).toFixed(2)}
            </div>
          )}
        </div>
      </div>
      {history.length > 0 && (
        <div style={CARD_STYLE}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>VIX 추이 (1년)</div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={history} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                     tickFormatter={v => v.slice(5)} interval={Math.floor(history.length / 6)} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} domain={[0, 'auto']} />
              <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', fontSize: 12 }}
                       labelStyle={{ color: 'var(--text-muted)' }} />
              <ReferenceLine y={30} stroke="#e57373" strokeDasharray="4 2" label={{ value: '30', fill: '#e57373', fontSize: 10 }} />
              <Line type="monotone" dataKey="value" name="VIX" stroke="#ffb74d" dot={false} strokeWidth={1.5} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

function CommoditiesSection() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    axios.get('/api/market/commodities')
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>원자재</h3><LoadingBox /></div>
  if (error || !data) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>원자재</h3><ErrorBox /></div>

  const LABELS = { gold: '금 (Gold)', oil: 'WTI 원유', copper: '구리 (Copper)' }
  const prices = data.prices || {}
  const history = data.history || {}

  return (
    <div style={SECTION_STYLE}>
      <h3 style={SECTION_HEADER_STYLE}>원자재</h3>
      <p style={DESC_STYLE}>금은 안전자산 수요와 실질금리를 반영합니다. WTI 원유는 경기 및 물가의 선행지표입니다. 구리는 '닥터 코퍼'로 불리며 산업 수요를 통해 경기 방향성을 선행 진단합니다.</p>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {['gold', 'oil', 'copper'].map(key => {
          const p = prices[key]
          const up = p?.change_pct > 0
          const down = p?.change_pct < 0
          return (
            <div key={key} style={{ ...CARD_STYLE, minWidth: 120, flex: 1 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{LABELS[key]}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
                {p ? `$${p.current.toLocaleString()}` : '-'}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{p?.unit}</div>
              {p && (
                <div style={{ fontSize: 12, color: up ? '#81c784' : down ? '#e57373' : 'var(--text-muted)', marginTop: 2 }}>
                  {up ? '▲' : down ? '▼' : '─'} {Math.abs(p.change_pct).toFixed(2)}%
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {[
          { key: 'gold', label: '금', color: '#ffd54f' },
          { key: 'oil',  label: 'WTI', color: '#4fc3f7' },
          { key: 'copper', label: '구리', color: '#ff8a65' },
        ].map(({ key, label, color }) => {
          const h = (history[key] || []).slice(-252)
          if (!h.length) return null
          return (
            <div key={key} style={{ ...CARD_STYLE, flex: 1, minWidth: 240 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{label} 추이 (1년)</div>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={h} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
                         tickFormatter={v => v.slice(5)} interval={Math.floor(h.length / 4)} />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', fontSize: 11 }}
                           labelStyle={{ color: 'var(--text-muted)' }} />
                  <Line type="monotone" dataKey="value" name={label} stroke={color} dot={false} strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function EconIndicatorsSection() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    axios.get('/api/market/econ-indicators')
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>경제지표 (미국)</h3><LoadingBox /></div>
  if (error || !data) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>경제지표 (미국)</h3><ErrorBox /></div>

  if (data.error) {
    return (
      <div style={SECTION_STYLE}>
        <h3 style={SECTION_HEADER_STYLE}>경제지표 (미국)</h3>
        <div style={{ ...CARD_STYLE, fontSize: 13, color: 'var(--text-muted)' }}>
          <p>{data.error}</p>
        </div>
      </div>
    )
  }

  const charts = [
    { key: 'cpi', label: 'CPI (소비자물가지수)', color: '#ce93d8', unit: '' },
    { key: 'unemployment', label: '실업률', color: '#80cbc4', unit: '%' },
  ]

  return (
    <div style={SECTION_STYLE}>
      <h3 style={SECTION_HEADER_STYLE}>경제지표 (미국)</h3>
      <p style={DESC_STYLE}>CPI는 소비자물가지수로 인플레이션 수준을 나타냅니다. 실업률은 노동시장 건강도를 측정합니다. 두 지표 모두 연준(Fed)의 금리 결정 핵심 근거로, 이중 책무(물가 안정·완전고용) 달성 여부를 판단합니다.</p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {charts.map(({ key, label, color, unit }) => {
          const h = data[key] || []
          return (
            <div key={key} style={{ ...CARD_STYLE, flex: 1, minWidth: 280 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{label} (3년)</div>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={h} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
                         tickFormatter={v => v.slice(0, 7)} interval={Math.floor(h.length / 5)} />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} domain={['auto', 'auto']}
                         tickFormatter={v => `${v}${unit}`} />
                  <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', fontSize: 11 }}
                           labelStyle={{ color: 'var(--text-muted)' }}
                           formatter={v => [`${v}${unit}`, label]} />
                  <Line type="monotone" dataKey="value" name={label} stroke={color} dot={false} strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TreasurySection() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    axios.get('/api/market/treasury')
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>미국 국채금리</h3><LoadingBox /></div>
  if (error || !data) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>미국 국채금리</h3><ErrorBox /></div>

  const LABELS = { '3m': '3개월', '5y': '5년', '10y': '10년', '30y': '30년' }
  const rates = data.rates || {}
  const h3m = Object.fromEntries((data.history?.['3m'] || []).map(d => [d.date, d.value]))
  const h10y = Object.fromEntries((data.history?.['10y'] || []).map(d => [d.date, d.value]))
  const chartData = Object.keys({ ...h3m, ...h10y }).sort().slice(-252).map(date => ({
    date: date.slice(5),
    '3개월': h3m[date] ?? null,
    '10년': h10y[date] ?? null,
    '스프레드': h3m[date] != null && h10y[date] != null
      ? Math.round((h10y[date] - h3m[date]) * 1000) / 1000
      : null,
  }))

  return (
    <div style={SECTION_STYLE}>
      <h3 style={SECTION_HEADER_STYLE}>미국 국채금리</h3>
      <p style={DESC_STYLE}>연준 통화정책 방향의 핵심 지표입니다. 단기(2년)는 금리 기대를, 장기(10년·30년)는 경기 및 인플레이션 전망을 반영합니다. 2년물이 10년물을 상회하는 장단기 역전은 역사적으로 경기 침체의 선행 신호입니다.</p>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {['3m', '5y', '10y', '30y'].map(key => {
          const r = rates[key]
          const up = r?.change_bp > 0
          const down = r?.change_bp < 0
          return (
            <div key={key} style={{ ...CARD_STYLE, minWidth: 110, flex: 1 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{LABELS[key]}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>
                {r ? `${r.current.toFixed(2)}%` : '-'}
              </div>
              {r && (
                <div style={{
                  fontSize: 12,
                  color: up ? '#81c784' : down ? '#e57373' : 'var(--text-muted)',
                  marginTop: 2,
                }}>
                  {up ? '▲' : down ? '▼' : '─'} {Math.abs(r.change_bp).toFixed(1)}bp
                </div>
              )}
            </div>
          )
        })}
      </div>
      {chartData.length > 0 && (
        <div style={CARD_STYLE}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
            3개월 / 10년 금리 추이 (1년) + 스프레드(10Y-3M)
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                     interval={Math.floor(chartData.length / 6)} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} domain={['auto', 'auto']} />
              <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', fontSize: 12 }}
                       labelStyle={{ color: 'var(--text-muted)' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine y={0} stroke="var(--border)" />
              <Line type="monotone" dataKey="10년" stroke="#4fc3f7" dot={false} strokeWidth={1.5} />
              <Line type="monotone" dataKey="3개월" stroke="#81c784" dot={false} strokeWidth={1.5} />
              <Line type="monotone" dataKey="스프레드" stroke="#ffb74d" dot={false} strokeWidth={1} strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

function M7EarningsSection() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    axios.get('/api/market/m7-earnings')
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>M7 vs 나머지 S&P 500 순이익</h3><LoadingBox /></div>
  if (error || !data) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>M7 vs 나머지 S&P 500 순이익</h3><ErrorBox /></div>

  const qs = data.quarters.map(q => ({
    ...q,
    m7share: q.m7 != null && q.rest != null ? q.m7 / (q.m7 + q.rest) * 100 : null,
  }))
  const latest = qs[qs.length - 1]
  const prev = qs[qs.length - 2]
  const [latestYear, latestQNum] = latest?.q?.split('Q') || []
  const yoy = qs.find(q => q.q === `${parseInt(latestYear) - 1}Q${latestQNum}`)
  const chg = (cur, base) => base ? ((cur - base) / Math.abs(base) * 100) : null
  const m7Share = latest ? (latest.m7 / (latest.m7 + latest.rest) * 100) : null
  const m7SharePrev = yoy ? (yoy.m7 / (yoy.m7 + yoy.rest) * 100) : null

  return (
    <div style={SECTION_STYLE}>
      <h3 style={SECTION_HEADER_STYLE}>M7 vs 나머지 S&P 500 순이익</h3>
      <p style={DESC_STYLE}>애플·마이크로소프트·구글·아마존·엔비디아·메타·테슬라 7개 빅테크의 분기 순이익과 S&P 500 나머지 493종목을 비교합니다. M7 비중이 높을수록 지수 수익률이 소수 종목에 집중되어 있음을 의미합니다.</p>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: 'M7', value: latest?.m7, qoq: chg(latest?.m7, prev?.m7), yoy: chg(latest?.m7, yoy?.m7), color: '#4fc3f7' },
          { label: '나머지 S&P 500', value: latest?.rest, qoq: chg(latest?.rest, prev?.rest), yoy: chg(latest?.rest, yoy?.rest), color: '#80cbc4' },
        ].map(({ label, value, qoq, yoy: yoyChg, color }) => (
          <div key={label} style={{ ...CARD_STYLE, minWidth: 140, flex: 1 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{label} 순이익 ({latest?.q})</div>
            <div style={{ fontSize: 20, fontWeight: 700, color }}>
              {value != null ? value.toLocaleString() : '-'} <span style={{ fontSize: 11, fontWeight: 400 }}>{data.unit}</span>
            </div>
            {qoq != null && (
              <div style={{ fontSize: 12, color: qoq > 0 ? '#81c784' : '#e57373', marginTop: 3 }}>
                {qoq > 0 ? '▲' : '▼'} {Math.abs(qoq).toFixed(1)}% <span style={{ color: 'var(--text-muted)' }}>QoQ</span>
              </div>
            )}
            {yoyChg != null && (
              <div style={{ fontSize: 12, color: yoyChg > 0 ? '#81c784' : '#e57373', marginTop: 2 }}>
                {yoyChg > 0 ? '▲' : '▼'} {Math.abs(yoyChg).toFixed(1)}% <span style={{ color: 'var(--text-muted)' }}>YoY</span>
              </div>
            )}
          </div>
        ))}
        <div style={{ ...CARD_STYLE, minWidth: 120, flex: 1 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>M7 순이익 비중</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#ffb74d' }}>
            {m7Share != null ? m7Share.toFixed(1) : '-'}<span style={{ fontSize: 13 }}>%</span>
          </div>
          {m7Share != null && m7SharePrev != null && (
            <div style={{ fontSize: 12, color: m7Share > m7SharePrev ? '#81c784' : '#e57373', marginTop: 3 }}>
              {m7Share > m7SharePrev ? '▲' : '▼'} {Math.abs(m7Share - m7SharePrev).toFixed(1)}%p <span style={{ color: 'var(--text-muted)' }}>YoY</span>
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>M7 / 전체 S&P 500</div>
        </div>
      </div>
      <div style={CARD_STYLE}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
          분기별 순이익 추이 ({data.unit}) — AAPL·MSFT·GOOGL·AMZN·NVDA·META·TSLA vs S&P 500 ex-M7
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={qs} margin={{ top: 16, right: 40, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="q" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
            <YAxis yAxisId="left" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} domain={['auto', 'auto']} />
            <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 10, fill: '#ffb74d' }} tickFormatter={v => `${v}%`} />
            <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', fontSize: 12 }}
                     formatter={(v, n) => n === 'M7 비중' ? [`${v?.toFixed(1)}%`, n] : v != null ? [v.toLocaleString() + ' ' + data.unit, n] : ['-', n]} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line yAxisId="left" type="monotone" dataKey="m7" name="M7" stroke="#4fc3f7" dot={{ r: 3 }} strokeWidth={2}>
              <LabelList dataKey="m7" position="top" style={{ fontSize: 9, fill: '#4fc3f7' }} formatter={v => v?.toFixed(0)} />
            </Line>
            <Line yAxisId="left" type="monotone" dataKey="rest" name="나머지" stroke="#80cbc4" dot={{ r: 3 }} strokeWidth={2}>
              <LabelList dataKey="rest" position="bottom" style={{ fontSize: 9, fill: '#80cbc4' }} formatter={v => v?.toFixed(0)} />
            </Line>
            <Line yAxisId="right" type="monotone" dataKey="m7share" name="M7 비중" stroke="#ffb74d" dot={false} strokeWidth={1.5} strokeDasharray="4 2" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function KrTop2Section() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    axios.get('/api/market/kr-top2-earnings')
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>삼성전자+SK하이닉스 vs KOSPI 나머지 전체 순이익</h3><LoadingBox /></div>
  if (error || !data) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>삼성전자+SK하이닉스 vs KOSPI 나머지 전체 순이익</h3><ErrorBox /></div>

  const qs = data.quarters.map(q => ({
    ...q,
    top2share: q.top2 != null && q.rest != null ? q.top2 / (q.top2 + q.rest) * 100 : null,
  }))
  const latest = qs[qs.length - 1]
  const prev = qs[qs.length - 2]
  const [latestYear2, latestQNum2] = latest?.q?.split('Q') || []
  const yoy2 = qs.find(q => q.q === `${parseInt(latestYear2) - 1}Q${latestQNum2}`)
  const chg2 = (cur, base) => base ? ((cur - base) / Math.abs(base) * 100) : null
  const top2Share = latest ? (latest.top2 / (latest.top2 + latest.rest) * 100) : null
  const top2SharePrev = yoy2 ? (yoy2.top2 / (yoy2.top2 + yoy2.rest) * 100) : null

  return (
    <div style={SECTION_STYLE}>
      <h3 style={SECTION_HEADER_STYLE}>삼성전자+SK하이닉스 vs KOSPI 나머지 전체 순이익</h3>
      <p style={DESC_STYLE}>삼성전자·SK하이닉스 두 반도체 대장주의 분기 순이익과 KOSPI 전체 나머지 종목을 비교합니다. 비중이 높을수록 한국 증시가 반도체 업황에 구조적으로 집중되어 있음을 나타냅니다.</p>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: '삼성+하이닉스', value: latest?.top2, qoq: chg2(latest?.top2, prev?.top2), yoy: chg2(latest?.top2, yoy2?.top2), color: '#4fc3f7' },
          { label: 'KOSPI 나머지 전체', value: latest?.rest, qoq: chg2(latest?.rest, prev?.rest), yoy: chg2(latest?.rest, yoy2?.rest), color: '#80cbc4' },
        ].map(({ label, value, qoq, yoy: yoyChg, color }) => (
          <div key={label} style={{ ...CARD_STYLE, minWidth: 140, flex: 1 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{label} 순이익 ({latest?.q})</div>
            <div style={{ fontSize: 20, fontWeight: 700, color }}>
              {krFmt(value)} <span style={{ fontSize: 11, fontWeight: 400 }}>원</span>
            </div>
            {qoq != null && (
              <div style={{ fontSize: 12, color: qoq > 0 ? '#81c784' : '#e57373', marginTop: 3 }}>
                {qoq > 0 ? '▲' : '▼'} {Math.abs(qoq).toFixed(1)}% <span style={{ color: 'var(--text-muted)' }}>QoQ</span>
              </div>
            )}
            {yoyChg != null && (
              <div style={{ fontSize: 12, color: yoyChg > 0 ? '#81c784' : '#e57373', marginTop: 2 }}>
                {yoyChg > 0 ? '▲' : '▼'} {Math.abs(yoyChg).toFixed(1)}% <span style={{ color: 'var(--text-muted)' }}>YoY</span>
              </div>
            )}
          </div>
        ))}
        <div style={{ ...CARD_STYLE, minWidth: 120, flex: 1 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>삼성+하이닉스 순이익 비중</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#ffb74d' }}>
            {top2Share != null ? top2Share.toFixed(1) : '-'}<span style={{ fontSize: 13 }}>%</span>
          </div>
          {top2Share != null && top2SharePrev != null && (
            <div style={{ fontSize: 12, color: top2Share > top2SharePrev ? '#81c784' : '#e57373', marginTop: 3 }}>
              {top2Share > top2SharePrev ? '▲' : '▼'} {Math.abs(top2Share - top2SharePrev).toFixed(1)}%p <span style={{ color: 'var(--text-muted)' }}>YoY</span>
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>삼성+하이닉스 / KOSPI 전체</div>
        </div>
      </div>
      <div style={CARD_STYLE}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
          분기별 순이익 추이 — 삼성전자(005930) + SK하이닉스(000660) vs KOSPI 나머지 전체
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={qs} margin={{ top: 16, right: 40, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="q" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
            <YAxis yAxisId="left" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} domain={['auto', 'auto']} tickFormatter={krFmt} />
            <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 10, fill: '#ffb74d' }} tickFormatter={v => `${v}%`} />
            <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', fontSize: 12 }}
                     formatter={(v, n) => n === '삼성+하이닉스 비중' ? [`${v?.toFixed(1)}%`, n] : [v != null ? `${krFmt(v)}원` : '-', n]} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line yAxisId="left" type="monotone" dataKey="top2" name="삼성+하이닉스" stroke="#4fc3f7" dot={{ r: 3 }} strokeWidth={2}>
              <LabelList dataKey="top2" position="top" style={{ fontSize: 9, fill: '#4fc3f7' }} formatter={krFmt} />
            </Line>
            <Line yAxisId="left" type="monotone" dataKey="rest" name="KOSPI 나머지 전체" stroke="#80cbc4" dot={{ r: 3 }} strokeWidth={2}>
              <LabelList dataKey="rest" position="bottom" style={{ fontSize: 9, fill: '#80cbc4' }} formatter={krFmt} />
            </Line>
            <Line yAxisId="right" type="monotone" dataKey="top2share" name="삼성+하이닉스 비중" stroke="#ffb74d" dot={false} strokeWidth={1.5} strokeDasharray="4 2" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function KrExportsSection() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    axios.get('/api/market/kr-exports')
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>한국 수출: 반도체 vs 비반도체</h3><LoadingBox /></div>
  if (error || !data) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>한국 수출: 반도체 vs 비반도체</h3><ErrorBox /></div>

  if (data.error) {
    return (
      <div style={SECTION_STYLE}>
        <h3 style={SECTION_HEADER_STYLE}>한국 수출: 반도체 vs 비반도체</h3>
        <div style={{ ...CARD_STYLE, fontSize: 13, color: 'var(--text-muted)' }}>
          <p>{data.error}</p>
        </div>
      </div>
    )
  }

  const months = (data.months || []).map(m => ({
    ...m,
    semishare: m.semiconductor != null && m.non_semiconductor != null
      ? m.semiconductor / (m.semiconductor + m.non_semiconductor) * 100 : null,
  }))
  const latest = months[months.length - 1]
  const prev = months[months.length - 2]
  const yoyMonth = latest ? `${parseInt(latest.month.slice(0, 4)) - 1}${latest.month.slice(4)}` : null
  const yoy3 = months.find(m => m.month === yoyMonth)
  const chg3 = (cur, base) => base ? ((cur - base) / Math.abs(base) * 100) : null
  const semiShare = latest ? (latest.semiconductor / (latest.semiconductor + latest.non_semiconductor) * 100) : null
  const semiSharePrev = yoy3 ? (yoy3.semiconductor / (yoy3.semiconductor + yoy3.non_semiconductor) * 100) : null
  const latestLabel = latest?.month?.replace(/(\d{4})(\d{2})/, '$1-$2')

  return (
    <div style={SECTION_STYLE}>
      <h3 style={SECTION_HEADER_STYLE}>한국 수출: 반도체 vs 비반도체</h3>
      <p style={DESC_STYLE}>관세청 월별 수출 통계 기준입니다. 반도체(HS 8542)는 한국 무역수지와 원화 가치의 핵심 동력으로, 수출 비중 상승은 업황 호조를 의미합니다. 비반도체 비중은 수출 다각화 정도를 나타냅니다.</p>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: '반도체', value: latest?.semiconductor, mom: chg3(latest?.semiconductor, prev?.semiconductor), yoy: chg3(latest?.semiconductor, yoy3?.semiconductor), color: '#4fc3f7' },
          { label: '비반도체', value: latest?.non_semiconductor, mom: chg3(latest?.non_semiconductor, prev?.non_semiconductor), yoy: chg3(latest?.non_semiconductor, yoy3?.non_semiconductor), color: '#80cbc4' },
        ].map(({ label, value, mom, yoy: yoyChg, color }) => (
          <div key={label} style={{ ...CARD_STYLE, minWidth: 140, flex: 1 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{label} 수출액 ({latestLabel})</div>
            <div style={{ fontSize: 20, fontWeight: 700, color }}>
              {value != null ? value.toLocaleString() : '-'} <span style={{ fontSize: 11, fontWeight: 400 }}>억달러</span>
            </div>
            {mom != null && (
              <div style={{ fontSize: 12, color: mom > 0 ? '#81c784' : '#e57373', marginTop: 3 }}>
                {mom > 0 ? '▲' : '▼'} {Math.abs(mom).toFixed(1)}% <span style={{ color: 'var(--text-muted)' }}>MoM</span>
              </div>
            )}
            {yoyChg != null && (
              <div style={{ fontSize: 12, color: yoyChg > 0 ? '#81c784' : '#e57373', marginTop: 2 }}>
                {yoyChg > 0 ? '▲' : '▼'} {Math.abs(yoyChg).toFixed(1)}% <span style={{ color: 'var(--text-muted)' }}>YoY</span>
              </div>
            )}
          </div>
        ))}
        <div style={{ ...CARD_STYLE, minWidth: 120, flex: 1 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>반도체 수출 비중</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#ffb74d' }}>
            {semiShare != null ? semiShare.toFixed(1) : '-'}<span style={{ fontSize: 13 }}>%</span>
          </div>
          {semiShare != null && semiSharePrev != null && (
            <div style={{ fontSize: 12, color: semiShare > semiSharePrev ? '#81c784' : '#e57373', marginTop: 3 }}>
              {semiShare > semiSharePrev ? '▲' : '▼'} {Math.abs(semiShare - semiSharePrev).toFixed(1)}%p <span style={{ color: 'var(--text-muted)' }}>YoY</span>
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>반도체 / 전체 수출</div>
        </div>
      </div>
      <div style={CARD_STYLE}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
          월별 수출액 추이 (억달러) — 반도체 vs 비반도체
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={months} margin={{ top: 16, right: 40, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                   tickFormatter={v => v.slice(2)} />
            <YAxis yAxisId="left" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} domain={['auto', 'auto']} />
            <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 10, fill: '#ffb74d' }} tickFormatter={v => `${v}%`} />
            <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', fontSize: 12 }}
                     labelFormatter={v => v.replace(/(\d{4})(\d{2})/, '$1-$2')}
                     formatter={(v, n) => n === '반도체 비중' ? [`${v?.toFixed(1)}%`, n] : [v.toLocaleString() + ' 억달러', n]} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line yAxisId="left" type="monotone" dataKey="semiconductor" name="반도체" stroke="#4fc3f7" dot={{ r: 3 }} strokeWidth={2}>
              <LabelList dataKey="semiconductor" position="top" style={{ fontSize: 9, fill: '#4fc3f7' }} formatter={v => v?.toFixed(0)} />
            </Line>
            <Line yAxisId="left" type="monotone" dataKey="non_semiconductor" name="비반도체" stroke="#80cbc4" dot={{ r: 3 }} strokeWidth={2}>
              <LabelList dataKey="non_semiconductor" position="bottom" style={{ fontSize: 9, fill: '#80cbc4' }} formatter={v => v?.toFixed(0)} />
            </Line>
            <Line yAxisId="right" type="monotone" dataKey="semishare" name="반도체 비중" stroke="#ffb74d" dot={false} strokeWidth={1.5} strokeDasharray="4 2" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default function Market() {
  return (
    <div style={{ maxWidth: 900 }}>
      <h2 style={{ color: 'var(--text)', marginBottom: 24 }}>시장지표</h2>
      <TreasurySection />
      <FxSection />
      <VixSection />
      <CommoditiesSection />
      <EconIndicatorsSection />
      <M7EarningsSection />
      <KrTop2Section />
      <KrExportsSection />
    </div>
  )
}
