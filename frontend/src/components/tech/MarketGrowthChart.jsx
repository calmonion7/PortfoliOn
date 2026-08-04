// 선도기술 리포트 시장 성장 차트(ADR-0033, task#277 S1 + task#282 S3) — 순수 표시 컴포넌트, fetch 없음.
// props: { market: { history:[{year,size}], forecast:[{year,size}], cagr_pct, as_of } }
// size = {value, currency:"USD"|"KRW", unit:"mn"|"bn"|"tn"} — formatMarketSize가 이름에 입력 단위를
// 지니므로(ADR-0031) 여기서 값을 직접 포맷하지 않고 항상 그 함수를 통과시킨다.
// task#282 S3 — 캡션의 "출처 {제목 join}"과 별도 CAGR 배지를 제거했다: 출처는 페이지 하단 「출처」
// 섹션과 순중복이었고(source 제목을 여기·거기 두 번), CAGR은 formatMarketSummary가 이미
// `, CAGR N%`로 문자열 끝에 붙이므로 배지가 같은 수치를 또 보여줬다. sources prop도 그래서 함께
// 제거한다(이 파일 유일 소비처가 없어졌다).
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { splitSeries, formatMarketSize, formatMarketSummary } from '../reports/techReportUtils.js'

// history/forecast를 연도 기준 단일 배열로 병합한다. 경계 연도(history 마지막 해)는 hist·fcst 양쪽에
// 같은 값을 채워 실선(hist)→점선(fcst)이 끊기지 않고 이어지게 한다
// (KrTop2Section.jsx의 top2_act/top2_est 패턴과 동일).
export function buildGrowthSeries(market) {
  const { history, forecast } = splitSeries(market)
  const rows = new Map()
  const put = (p, key) => {
    const row = rows.get(p.year) || { year: p.year }
    row[key] = p.size?.value ?? null
    row[`${key}Size`] = p.size ?? null
    rows.set(p.year, row)
  }
  history.forEach(p => put(p, 'hist'))
  forecast.forEach(p => put(p, 'fcst'))
  if (history.length && forecast.length) {
    const boundaryYear = history[history.length - 1].year
    const row = rows.get(boundaryYear)
    if (row && row.fcst == null) {
      row.fcst = row.hist
      row.fcstSize = row.histSize
    }
  }
  return [...rows.values()].sort((a, b) => a.year - b.year)
}

export default function MarketGrowthChart({ market }) {
  const { history, forecast } = splitSeries(market)

  if (!history.length && !forecast.length) {
    return (
      <div className="chartbox" data-testid="market-growth-chart">
        <p data-testid="market-growth-empty" style={{ color: 'var(--text-3)', fontSize: 13 }}>시장 데이터 없음</p>
      </div>
    )
  }

  const series = buildGrowthSeries(market)
  const anySize = history[0]?.size ?? forecast[0]?.size ?? null
  const axisUnit = anySize ? `${anySize.currency} ${anySize.unit}` : ''
  const tickFmt = (v) => (anySize ? (formatMarketSize({ value: v, currency: anySize.currency, unit: anySize.unit }) ?? v) : v)
  const tipFmt = (value, name, entry) => {
    const size = entry?.payload?.[`${entry?.dataKey}Size`]
    return [size ? (formatMarketSize(size) ?? String(value)) : String(value), name]
  }

  const captionParts = []
  const summary = formatMarketSummary(market)
  if (summary) captionParts.push(summary)
  if (market?.as_of) captionParts.push(`기준 ${market.as_of}`)

  return (
    <div className="chartbox" data-testid="market-growth-chart">
      <div className="sub" data-testid="market-growth-caption">{captionParts.join(' · ')}</div>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={series} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="year" tick={{ fontSize: 10, fill: 'var(--text-3)' }} />
          <YAxis tick={{ fontSize: 10, fill: 'var(--text-3)' }} tickFormatter={tickFmt} width={56}
                 label={{ value: axisUnit, angle: -90, position: 'insideLeft', fontSize: 10, fill: 'var(--text-3)' }} />
          <Tooltip contentStyle={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', fontSize: 12 }} formatter={tipFmt} />
          <Legend />
          <Line type="monotone" dataKey="hist" name="실측" stroke="var(--data-2)" dot={{ r: 3 }} strokeWidth={2} connectNulls={false} />
          <Line type="monotone" dataKey="fcst" name="예상" stroke="var(--data-2)" dot={{ r: 3 }} strokeWidth={1.5} strokeDasharray="5 3" connectNulls={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
