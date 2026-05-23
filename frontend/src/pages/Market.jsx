import { useState, useEffect } from 'react'
import axios from 'axios'
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'

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
  marginBottom: 16,
  borderBottom: '1px solid var(--border)',
  paddingBottom: 8,
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

  return (
    <div style={SECTION_STYLE}>
      <h3 style={SECTION_HEADER_STYLE}>M7 vs 나머지 S&P 500 순이익</h3>
      <div style={CARD_STYLE}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
          분기별 순이익 합산 ({data.unit}) — AAPL·MSFT·GOOGL·AMZN·NVDA·META·TSLA vs S&P 500 ex-M7
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data.quarters} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="q" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
            <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="m7" name="M7" fill="#4fc3f7" radius={[2, 2, 0, 0]} />
            <Bar dataKey="rest" name="나머지" fill="#546e7a" radius={[2, 2, 0, 0]} />
          </BarChart>
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

  if (loading) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>삼성전자+SK하이닉스 vs KOSPI 200 나머지 순이익</h3><LoadingBox /></div>
  if (error || !data) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>삼성전자+SK하이닉스 vs KOSPI 200 나머지 순이익</h3><ErrorBox /></div>

  return (
    <div style={SECTION_STYLE}>
      <h3 style={SECTION_HEADER_STYLE}>삼성전자+SK하이닉스 vs KOSPI 200 나머지 순이익</h3>
      <div style={CARD_STYLE}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
          분기별 순이익 합산 ({data.unit}) — 삼성전자(005930) + SK하이닉스(000660) vs KOSPI 200 나머지
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data.quarters} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="q" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
            <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="top2" name="삼성+하이닉스" fill="#4fc3f7" radius={[2, 2, 0, 0]} />
            <Bar dataKey="rest" name="나머지 KOSPI 200" fill="#546e7a" radius={[2, 2, 0, 0]} />
          </BarChart>
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
          <p style={{ marginTop: 8 }}>
            <code>KITA_API_KEY</code> 환경변수 설정 후 서버를 재시작하세요.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={SECTION_STYLE}>
      <h3 style={SECTION_HEADER_STYLE}>한국 수출: 반도체 vs 비반도체</h3>
      <div style={CARD_STYLE}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
          월별 수출액 (억달러) — 반도체 vs 비반도체
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data.months} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                   tickFormatter={v => v.slice(2)} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
            <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="semiconductor" name="반도체" fill="#4fc3f7" radius={[2, 2, 0, 0]} />
            <Bar dataKey="non_semiconductor" name="비반도체" fill="#546e7a" radius={[2, 2, 0, 0]} />
          </BarChart>
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
      <M7EarningsSection />
      <KrTop2Section />
      <KrExportsSection />
    </div>
  )
}
