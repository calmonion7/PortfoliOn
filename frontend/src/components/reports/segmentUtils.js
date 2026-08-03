// 사업부문 시장 분석(task#275) — market_outlook.segments[]를 렌더 가능한 파생값으로 바꾸는 순수 함수.
// AI는 %만 기입하고 금액(부문매출·시장기회)은 여기서 환산한다(수주잔고 ×100 오저장 계열
// 단위함정 원천차단 — CLAUDE.md 수주잔고 gotcha 참조).
//
// 환산 게이트 2개(금액만 생략, 부문명·비중·시장 수치·서술은 남긴다):
//   (a) period 불일치 — 그 부문에 맞는 실적 행이 없으면 그 부문의 매출 금액만 null
//   (b) Σ비중 초과   — Σrevenue_share_pct > 100 + 허용치(1.0)면 전 부문 매출 금액 null
// 시장기회(opportunity)는 market.size·share_pct에서만 나오므로 재무 정합과 무관 — 두 게이트에
// 걸리지 않는다(task#248→#249 "정상값을 지우는 과보수" 재발 방지, 계약 문구의 명시적 해석 결정).

const SHARE_SUM_TOLERANCE = 1.0

// 결측(null)뿐 아니라 NaN/Infinity도 여기서 걸러 그 필드만 null로 만든다(오염 격리).
const _num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

// financialsAnnual에서 period가 문자열 일치하는 행의 revenue(유한수만). 못 찾으면 null.
const _findRevenue = (financialsAnnual, period) => {
  if (period == null || !Array.isArray(financialsAnnual)) return null
  const row = financialsAnnual.find((f) => f && String(f.period) === String(period))
  return row ? _num(row.revenue) : null
}

export function deriveSegments(marketOutlook, financialsAnnual) {
  const segments = marketOutlook?.segments
  if (!Array.isArray(segments) || segments.length === 0) return null

  // 게이트 (b) — 유효한 비중값만 합산(NaN이 섞여도 합계를 오염시키지 않도록 _num 선통과)
  const shareSum = segments.reduce((sum, s) => {
    const v = _num(s?.revenue_share_pct)
    return v != null ? sum + v : sum
  }, 0)
  const shareSumExceeded = shareSum > 100 + SHARE_SUM_TOLERANCE

  const rows = segments.map((s) => {
    const sharePct = _num(s?.revenue_share_pct)
    const prevSharePct = _num(s?.prev_revenue_share_pct)
    const shareDeltaPp = sharePct != null && prevSharePct != null ? sharePct - prevSharePct : null

    // 게이트 (a) — 당기 period 매출 행이 없으면 그 부문 매출 금액 전부 생략
    const currentRevenueRow = _findRevenue(financialsAnnual, s?.period)
    let revenueCurrent = null
    let revenuePrev = null
    if (currentRevenueRow != null && !shareSumExceeded) {
      revenueCurrent = sharePct != null ? currentRevenueRow * sharePct / 100 : null
      const prevRevenueRow = _findRevenue(financialsAnnual, s?.prev_period)
      revenuePrev = prevRevenueRow != null && prevSharePct != null ? prevRevenueRow * prevSharePct / 100 : null
    }
    const revenueChangePct = revenueCurrent != null && revenuePrev != null && revenuePrev !== 0
      ? (revenueCurrent - revenuePrev) / revenuePrev * 100
      : null

    const rawMarket = s?.market
    const market = rawMarket ? {
      size: _num(rawMarket.size),
      unit: rawMarket.unit ?? null,
      year: _num(rawMarket.year),
      sizeForecast: _num(rawMarket.size_forecast),
      forecastYear: _num(rawMarket.forecast_year),
      cagrPct: _num(rawMarket.cagr_pct),
    } : null

    const sharePctOfMarket = _num(s?.share_pct)
    const sharePctForecast = _num(s?.share_pct_forecast)
    const scenarioLabel = sharePctForecast != null ? '회사 전망' : '점유율 유지 가정'

    const opportunityCurrent = market?.size != null && sharePctOfMarket != null
      ? market.size * sharePctOfMarket / 100 : null
    const effectiveForecastShare = sharePctForecast != null ? sharePctForecast : sharePctOfMarket
    const opportunityForecast = market?.sizeForecast != null && effectiveForecastShare != null
      ? market.sizeForecast * effectiveForecastShare / 100 : null

    return {
      name: s?.name ?? null,
      period: s?.period ?? null,
      prevPeriod: s?.prev_period ?? null,
      sharePct, prevSharePct, shareDeltaPp,
      revenueCurrent, revenuePrev, revenueChangePct,
      market,
      sharePctOfMarket, sharePctForecast,
      opportunityCurrent, opportunityForecast,
      scenarioLabel,
      note: s?.note ?? null,
      sources: Array.isArray(s?.sources) ? s.sources : [],
    }
  })

  // '기타'를 억지로 만들지 않는다 — 비중이 있는 부문만 담고 Σ<100의 남는 폭은 렌더러가 여백으로 둔다.
  const distribution = {
    current: rows.filter((r) => r.sharePct != null).map((r) => ({ name: r.name, pct: r.sharePct })),
    prev: rows.filter((r) => r.prevSharePct != null).map((r) => ({ name: r.name, pct: r.prevSharePct })),
  }

  return { rows, distribution, gate: { shareSumExceeded, shareSum } }
}
