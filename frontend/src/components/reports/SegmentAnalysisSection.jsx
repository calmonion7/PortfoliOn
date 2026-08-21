import { deriveSegments } from './segmentUtils.js'
import { SectionTitle } from './reportUtils.jsx'

// 사업부문 시장 분석(task#275) — market_outlook.segments[]를 보여주는 단일 렌더러.
// 일반 리포트 「사업분석」 탭과 애널리스트 리포트(발행 시점 박제)가 이 컴포넌트 하나를 공유한다.
// 계산은 전부 segmentUtils.deriveSegments가 하고, 여기선 렌더만 한다(AI %입력 → 금액은 그 모듈이 환산).

// MarketOutlookSection.jsx의 스타일 패턴을 그대로 따른다(새 디자인 언어를 만들지 않음).
const _CHIP = (color) => ({ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: 'var(--bg-elev-2)', color })
const STAT = { display: 'flex', flexDirection: 'column', background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 5, padding: '6px 10px', gap: 2, minWidth: 90 }
const STAT_LABEL = { fontSize: 10, color: 'var(--text-3)' }
const STAT_VAL = { fontSize: 13, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }

// 가격방향(--up/--down)과 교차 사용 금지(task#194) — 카테고리 팔레트만 순환.
// 6개 이상 부문에서 색 충돌 방지 위해 corr-pos/neg를 6·7번째로 확장(BacklogChart.jsx SECTOR_COLORS 선례).
const DATA_COLORS = ['var(--data-1)', 'var(--data-2)', 'var(--data-3)', 'var(--data-4)', 'var(--data-5)', 'var(--corr-pos)', 'var(--corr-neg)']

// 누적 막대 조각 폭(정규화 % 기준) 임계 — 미만이면 조각 내부 라벨을 생략하고 범례로 내린다.
// jsdom엔 실측 px가 없어(recharts 금지·div 기반이라도 레이아웃은 라이브만 실측 가능) % 임계로 근사한다.
const LABEL_MIN_PCT = 8

function fmtNum(v) {
  return v.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

// 시장 규모 문자열 — MarketOutlookSection의 fmtSize와 동일 관례(값+단위+연도).
function fmtMarketSize(size, unit, year) {
  if (size == null) return null
  const yr = year != null ? ` (${year})` : ''
  return `${fmtNum(size)}${unit || ''}${yr}`
}

// "1,200억달러 × 12.0% = 144억달러" 산식 캡션. 셋 중 하나라도 없으면 null(부분 산식 렌더 안 함).
function opportunityFormula(size, pct, result, unit) {
  if (size == null || pct == null || result == null) return null
  return `${fmtNum(size)}${unit || ''} × ${pct.toFixed(1)}% = ${fmtNum(result)}${unit || ''}`
}

function fmtPctSigned(v) {
  if (v == null) return null
  const sign = v >= 0 ? '+' : ''
  return `${sign}${v.toFixed(1)}%`
}

// ① 사업 분포 — 100% 누적 가로 막대 한 줄(전기/당기 공용).
function StackedBarRow({ label, items, colorMap }) {
  const total = items.reduce((s, it) => s + (it.pct ?? 0), 0)
  if (total <= 0) return null
  const scale = total > 100 ? 100 / total : 1 // Σ초과만 정규화, Σ미달(기타 생략)은 남는 폭을 그대로 여백으로 둔다
  const scaled = items.map((it) => ({ ...it, w: it.pct * scale }))
  const smallItems = scaled.filter((it) => it.w < LABEL_MIN_PCT)

  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', height: 20, borderRadius: 4, overflow: 'hidden', background: 'var(--bg-elev-2)' }}>
        {scaled.map((it) => (
          <div
            key={it.name}
            title={`${it.name} ${it.pct.toFixed(1)}%`}
            style={{ width: `${it.w}%`, background: colorMap[it.name] || DATA_COLORS[0], display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
          >
            {it.w >= LABEL_MIN_PCT && (
              // --data-N은 라이트=진한 잉크/다크=밝은 톤이라 고정 흰 글자는 다크테마에서 대비 ~2.2~2.7:1(WCAG AA 미달).
              // var(--bg)는 테마별로 반전(다크=거의 검정/라이트=크림)돼 양쪽 다 4.5:1+ 확보.
              //
              // 폭 규율(가토 ⑦): LABEL_MIN_PCT는 %라 좁은 뷰포트에서 px로는 모자랄 수 있다(모바일 390px에서
              // 긴 부문명이 조각을 125>86으로 넘겨 ellipsis 없이 잘리던 것을 라이브 프로브가 포착).
              // 줄어도 되는 것(부문명)만 ellipsis 상자에 넣고, 줄면 안 되는 수치는 flexShrink:0으로 고정한다.
              <span style={{ display: 'flex', alignItems: 'center', gap: 3, minWidth: 0, maxWidth: '100%', padding: '0 4px', fontSize: 9, fontWeight: 700, color: 'var(--bg)' }}>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
                <span style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{it.pct.toFixed(0)}%</span>
              </span>
            )}
          </div>
        ))}
      </div>
      {smallItems.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
          {smallItems.map((it) => (
            <span key={it.name} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: colorMap[it.name] || DATA_COLORS[0], flexShrink: 0 }} />
              {it.name} {it.pct.toFixed(1)}%
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function DistributionBars({ distribution, colorMap }) {
  if (!distribution.current.length && !distribution.prev.length) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
      {distribution.prev.length > 0 && <StackedBarRow label="전기" items={distribution.prev} colorMap={colorMap} />}
      {distribution.current.length > 0 && <StackedBarRow label="당기" items={distribution.current} colorMap={colorMap} />}
    </div>
  )
}

// ② 부문 카드 한 장. 같은 스케일 가로 막대 2줄(현재/전망 연도) 안에 자사 몫을 채운다.
function BarRow({ label, sizePct, fillPct, color }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{label}</span>
      <div style={{ height: 14, background: 'var(--bg-elev-2)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${sizePct}%`, height: '100%', background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${fillPct}%`, height: '100%', background: color }} />
        </div>
      </div>
    </div>
  )
}

function SegmentCard({ row, color }) {
  const {
    name, period, sharePct, shareDeltaPp, revenueChangePct,
    market, sharePctOfMarket, sharePctForecast, opportunityCurrent, opportunityForecast,
    scenarioLabel, note, sources,
  } = row

  const effectiveForecastPct = sharePctForecast ?? sharePctOfMarket
  const maxSize = Math.max(market?.size ?? 0, market?.sizeForecast ?? 0)
  const barPct = (size) => (size != null && maxSize > 0 ? Math.min(100, size / maxSize * 100) : null)
  const fillPct = (pct) => (pct != null ? Math.min(100, Math.max(0, pct)) : 0)

  const curBarPct = market ? barPct(market.size) : null
  const fcBarPct = market ? barPct(market.sizeForecast) : null
  const curFormula = market ? opportunityFormula(market.size, sharePctOfMarket, opportunityCurrent, market.unit) : null
  const fcFormula = market ? opportunityFormula(market.sizeForecast, effectiveForecastPct, opportunityForecast, market.unit) : null

  const marketSizeStat = market ? fmtMarketSize(market.size, market.unit, market.year) : null
  const marketForecastStat = market ? fmtMarketSize(market.sizeForecast, market.unit, market.forecastYear) : null

  return (
    <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      {/* 헤더 — 부문명만 ellipsis, 매출 비중은 flexShrink:0으로 고정(가토 ⑦) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <span style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </span>
        <span style={{ ...STAT_VAL, flexShrink: 0 }}>{sharePct != null ? `${sharePct.toFixed(1)}%` : '—'}</span>
      </div>

      {/* 증감 스탯 — 필/배지 행: flexWrap:wrap + 자식 whiteSpace:nowrap(가토 ⑨) */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <div style={STAT}>
          <span style={STAT_LABEL}>매출 비중{period ? ` (${period})` : ''}</span>
          <span style={{ ...STAT_VAL, whiteSpace: 'nowrap' }}>{sharePct != null ? `${sharePct.toFixed(1)}%` : '—'}</span>
        </div>
        {shareDeltaPp != null && (
          <div style={STAT}>
            <span style={STAT_LABEL}>비중 변화</span>
            <span style={{ ...STAT_VAL, whiteSpace: 'nowrap', color: shareDeltaPp >= 0 ? 'var(--up)' : 'var(--down)' }}>
              {fmtPctSigned(shareDeltaPp)}p
            </span>
          </div>
        )}
        {revenueChangePct != null && (
          <div style={STAT}>
            <span style={STAT_LABEL}>매출 증감</span>
            <span style={{ ...STAT_VAL, whiteSpace: 'nowrap', color: revenueChangePct >= 0 ? 'var(--up)' : 'var(--down)' }}>
              {fmtPctSigned(revenueChangePct)}
            </span>
          </div>
        )}
        {marketSizeStat && (
          <div style={STAT}>
            <span style={STAT_LABEL}>시장 규모</span>
            <span style={{ ...STAT_VAL, whiteSpace: 'nowrap' }}>{marketSizeStat}</span>
          </div>
        )}
        {market?.cagrPct != null && (
          <div style={STAT}>
            <span style={STAT_LABEL}>시장 CAGR</span>
            <span style={{ ...STAT_VAL, whiteSpace: 'nowrap' }}>{market.cagrPct.toFixed(1)}%</span>
          </div>
        )}
        {/* market 유무와 무관한 독립 칩 — market이 없으면(또는 size/sizeForecast 결측이면) 아래 자사 몫 막대가
            통째 생략되어 이 값이 화면 어디에도 안 나타나던 결함 수정(task#275 적대적 리뷰). */}
        {sharePctOfMarket != null && (
          <div style={STAT}>
            <span style={STAT_LABEL}>자사 점유율</span>
            <span style={{ ...STAT_VAL, whiteSpace: 'nowrap' }}>{sharePctOfMarket.toFixed(1)}%</span>
          </div>
        )}
        {sharePctForecast != null && (
          <div style={STAT}>
            <span style={STAT_LABEL}>전망 점유율</span>
            <span style={{ ...STAT_VAL, whiteSpace: 'nowrap' }}>{sharePctForecast.toFixed(1)}%</span>
          </div>
        )}
      </div>

      {/* 자사 몫 막대 — market이 없으면 통째 생략 */}
      {market && (curBarPct != null || fcBarPct != null) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {curBarPct != null && (
            <BarRow label={marketSizeStat ? `현재 · ${marketSizeStat}` : '현재'} sizePct={curBarPct} fillPct={fillPct(sharePctOfMarket)} color={color} />
          )}
          {fcBarPct != null && (
            <BarRow label={marketForecastStat ? `전망 · ${marketForecastStat}` : '전망'} sizePct={fcBarPct} fillPct={fillPct(effectiveForecastPct)} color={color} />
          )}
          {(curFormula || fcFormula) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {curFormula && <span className="mono tnum" style={{ fontSize: 11, color: 'var(--text-2)' }}>{curFormula}</span>}
              {fcFormula && <span className="mono tnum" style={{ fontSize: 11, color: 'var(--text-2)' }}>{fcFormula}</span>}
            </div>
          )}
          {fcBarPct != null && (
            <div>
              <span style={_CHIP('var(--text-2)')}>{scenarioLabel}</span>
            </div>
          )}
        </div>
      )}

      {note && <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.6 }}>{note}</div>}
      {sources.length > 0 && <div style={{ fontSize: 10, color: 'var(--text-3)' }}>출처: {sources.join(', ')}</div>}
    </div>
  )
}

export default function SegmentAnalysisSection({ market_outlook, financialsAnnual }) {
  const derived = deriveSegments(market_outlook, financialsAnnual)
  if (!derived) return null
  const { rows, distribution } = derived

  const colorMap = {}
  rows.forEach((r, i) => { if (r.name != null) colorMap[r.name] = DATA_COLORS[i % DATA_COLORS.length] })

  return (
    <div style={{ marginBottom: 20 }}>
      <SectionTitle>🧩 사업부문 시장 분석</SectionTitle>
      <DistributionBars distribution={distribution} colorMap={colorMap} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
        {rows.map((row, i) => (
          <SegmentCard key={row.name ?? i} row={row} color={DATA_COLORS[i % DATA_COLORS.length]} />
        ))}
      </div>
    </div>
  )
}
