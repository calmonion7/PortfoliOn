import { useState, useEffect } from 'react'
import api from '../../api'

// 종목 최신 공시 목록 (DART, 최신순). KR 전용.
// GET /api/report/{ticker}/disclosures → [{rcept_dt, report_nm, pblntf_ty, rcept_no, corp_name, dart_url}]
// 심층분석 탭의 'AI 최근 공시 & 뉴스'(RecentDisclosuresSection) 아래에 원본 공시 링크 목록으로 배치.

// DART pblntf_ty 단일문자 코드 → 한글 배지 라벨/색.
const _TY_CFG = {
  A: { label: '정기공시', color: '#64b5f6' },
  B: { label: '주요사항', color: '#ffb74d' },
  C: { label: '발행공시', color: '#9575cd' },
  D: { label: '지분공시', color: '#81c784' },
}

// YYYYMMDD → YYYY.MM.DD
function fmtDate(s) {
  if (!s) return ''
  const d = String(s)
  if (d.length === 8) return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}`
  return d
}

export default function LatestDisclosuresSection({ ticker, market }) {
  const [data, setData] = useState(null)   // null=로딩, []=없음
  const [error, setError] = useState(false)
  useEffect(() => {
    if (market !== 'KR') return
    let cancelled = false
    setData(null)
    setError(false)
    api.get(`/api/report/${ticker}/disclosures`)
      .then(({ data }) => { if (!cancelled) setData(Array.isArray(data) ? data : []) })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [ticker, market])

  if (market !== 'KR') return null
  // 공시 없음/에러는 graceful: 헤더 + 짧은 안내만.
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)', marginBottom: 8 }}>📑 최신 공시 (DART)</div>
      {error ? (
        <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>공시를 불러오지 못했습니다.</p>
      ) : data === null ? (
        <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>공시 불러오는 중…</p>
      ) : data.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>공시 없음</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {data.map((d) => {
            const tc = _TY_CFG[d.pblntf_ty] || { label: d.pblntf_ty || '', color: 'var(--text-3)' }
            return (
              <a
                key={d.rcept_no}
                href={d.dart_url}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 8px', borderRadius: 6, textDecoration: 'none',
                  background: 'var(--bg-elev)',
                }}
              >
                <span style={{ fontSize: 11, color: 'var(--text-3)', flexShrink: 0, fontVariantNumeric: 'tabular-nums', minWidth: 78 }}>
                  {fmtDate(d.rcept_dt)}
                </span>
                {tc.label && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: 'var(--bg-elev-2)', color: tc.color, flexShrink: 0 }}>
                    {tc.label}
                  </span>
                )}
                <span style={{ fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {d.report_nm}
                </span>
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}
