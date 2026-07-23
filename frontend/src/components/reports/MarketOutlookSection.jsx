import { SectionTitle, computeRevenueCagr } from './reportUtils.jsx'
import { GlossaryText } from '../Glossary.jsx'

// 시장 전망 — summary.market_outlook (AI 기입, 결측·부분결측 흔함 → 전 필드 optional graceful)
// { market_name, size_current:{value,unit,year}, size_forecast:{value,unit,year}, cagr_pct,
//   company_share_pct?, position?, sources:[], one_liner }
// 성장 대조는 summary.financials_annual(연간 실적, FinancialsChart와 동일 데이터)에서 매출 CAGR을 파생해 시장 CAGR과 병기.

const _CHIP = (color) => ({ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: 'var(--bg-elev-2)', color })
const STAT = { display: 'flex', flexDirection: 'column', background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 5, padding: '6px 10px', gap: 2, minWidth: 100 }
const STAT_LABEL = { fontSize: 10, color: 'var(--text-3)' }
const STAT_VAL = { fontSize: 13, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }

function fmtSize(s) {
  if (!s || s.value == null) return null
  return `${Number(s.value).toLocaleString()}${s.unit || ''}${s.year ? ` (${s.year})` : ''}`
}

export default function MarketOutlookSection({ market_outlook, financialsAnnual }) {
  if (!market_outlook) return null
  const mo = market_outlook

  const curSize = fmtSize(mo.size_current)
  const fcSize = fmtSize(mo.size_forecast)
  const hasCagr = typeof mo.cagr_pct === 'number' && Number.isFinite(mo.cagr_pct)
  const hasShare = typeof mo.company_share_pct === 'number' && Number.isFinite(mo.company_share_pct)

  if (!mo.market_name && !curSize && !fcSize && !hasCagr && !hasShare && !mo.one_liner) return null

  // 매출 시계열 2개년 미만이면 대조 생략(wrong<missing) — computeRevenueCagr가 그 경우 null 반환
  const revCagr = computeRevenueCagr(financialsAnnual)
  const showContrast = revCagr != null && hasCagr
  const faster = showContrast && revCagr.pct > mo.cagr_pct

  return (
    <div style={{ marginBottom: 20 }}>
      <SectionTitle right={mo.position && <span style={_CHIP('var(--text-2)')}>{mo.position}</span>}>
        🌐 시장 전망
      </SectionTitle>
      {mo.market_name && (
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>{mo.market_name}</div>
      )}
      {(curSize || fcSize || hasCagr || hasShare) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          {curSize && (
            <div style={STAT}>
              <span style={STAT_LABEL}>시장 규모(현재)</span>
              <span style={STAT_VAL}>{curSize}</span>
            </div>
          )}
          {fcSize && (
            <div style={STAT}>
              <span style={STAT_LABEL}>시장 규모(예상)</span>
              <span style={STAT_VAL}>{fcSize}</span>
            </div>
          )}
          {hasCagr && (
            <div style={STAT}>
              <span style={STAT_LABEL}>시장 CAGR</span>
              <span style={STAT_VAL}>{mo.cagr_pct.toFixed(1)}%</span>
            </div>
          )}
          {hasShare && (
            <div style={STAT}>
              <span style={STAT_LABEL}>자사 점유율</span>
              <span style={STAT_VAL}>{mo.company_share_pct.toFixed(1)}%</span>
            </div>
          )}
        </div>
      )}
      {showContrast && (
        <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.7, marginBottom: 10 }}>
          자사 매출 CAGR(최근 {revCagr.years}개년 실적) <b style={{ color: 'var(--text)' }}>{revCagr.pct.toFixed(1)}%</b>
          {' '}— 시장({mo.cagr_pct.toFixed(1)}%) 대비 <b style={{ color: 'var(--text)' }}>{faster ? '빠름' : '느림'}</b>
        </div>
      )}
      {mo.one_liner && (
        <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.7, padding: '8px 12px', background: 'var(--bg-elev-2)', borderRadius: 6, borderLeft: '3px solid var(--accent)', marginBottom: mo.sources?.length ? 8 : 0 }}>
          💡 <GlossaryText text={mo.one_liner} />
        </div>
      )}
      {mo.sources?.length > 0 && (
        <div style={{ fontSize: 10, color: 'var(--text-3)' }}>출처: {mo.sources.join(', ')}</div>
      )}
    </div>
  )
}
