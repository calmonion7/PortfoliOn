import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import api from '../api'
import Card from '../components/ui/Card'
import Stat from '../components/ui/Stat'
import Skeleton from '../components/ui/Skeleton'
import { TECH_NAMES, formatMarketSummary } from '../components/reports/techReportUtils'

// 주요기술 리포트 목록 (ADR-0033, task#276 S5, 개명·저장모델 ADR-0038) — 기술 단위 발행물,
// 기술당 최신 1행(slug당 1행 고정, 이력 누적 없음). 대상 5종 고정(백엔드 TECH_TOPICS 정본)이라
// 페이지네이션 없음. /analyst-reports 목록과 동형 구조.

export default function TechReports() {
  const [reports, setReports] = useState(null)  // null=로딩, []=없음
  const [error, setError] = useState(null)       // 실패는 빈 상태와 구별(에러 정직성)

  useEffect(() => {
    let ignore = false
    api.get('/api/tech-reports')
      .then(({ data }) => { if (!ignore) setReports(data.reports || []) })
      .catch((e) => {
        if (ignore) return
        console.error('[TechReports] 목록 조회 실패:', e)
        setError('목록을 불러오지 못했습니다.')
      })
    return () => { ignore = true }
  }, [])

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <h3 style={{ fontFamily: 'var(--font-serif)', color: 'var(--text)', fontSize: 16, margin: '0 0 10px' }}>주요기술 리포트</h3>
      {reports === null && !error ? (
        <Skeleton variant="card" count={4} />
      ) : error ? (
        <p style={{ color: 'var(--text-3)', fontSize: 13 }}>{error}</p>
      ) : reports.length === 0 ? (
        <p style={{ color: 'var(--text-3)', fontSize: 13 }}>발행된 주요기술 리포트가 없습니다.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
          {reports.map(r => {
            const playerCount = (r.players || []).length
            const summary = formatMarketSummary(r.market)
            return (
              <Card
                key={r.slug}
                as={Link}
                to={`/tech-report/${r.slug}`}
                hover
                padding="md"
                data-testid="tech-report-card"
                data-slug={r.slug}
                style={{ textDecoration: 'none', display: 'block' }}
              >
                <div style={{ color: 'var(--text-3)', fontSize: 11, letterSpacing: '0.06em', fontWeight: 600 }}>
                  {TECH_NAMES[r.slug] || r.slug}
                </div>
                {/* 잘림 방어 — 제목만 ellipsis(줄어도 되는 것), 발행일·수치는 별도 flex-shrink:0 요소 */}
                <div style={{ fontFamily: 'var(--font-serif)', color: 'var(--text)', fontWeight: 700, fontSize: 15, margin: '4px 0 10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.title}
                </div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 10 }}>
                  {r.difficulty?.score != null && <Stat size="sm" label="기술난이도" value={`${r.difficulty.score}/5`} />}
                  <Stat size="sm" label="업체 수" value={`${playerCount}개`} />
                </div>
                {summary && (
                  <div className="mono tnum" style={{ color: 'var(--text-2, var(--text))', fontSize: 12, marginBottom: 8 }}>{summary}</div>
                )}
                <div className="mono" style={{ color: 'var(--text-3)', fontSize: 11 }}>{r.published_date} 갱신</div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
