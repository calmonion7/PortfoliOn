import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import api from '../api'
import Card from '../components/ui/Card'
import Stat from '../components/ui/Stat'
import Skeleton from '../components/ui/Skeleton'
import { TECH_NAMES, formatMarketSummary } from '../components/reports/techReportUtils'

// 주요기술 리포트 목록 (ADR-0033, task#276 S5, 개명·저장모델 ADR-0038, 설비/운영 분할 ADR-0039) —
// 기술 단위 발행물, 기술당 최신 1행(slug당 1행 고정, 이력 누적 없음). 대상 6종 고정(백엔드
// TECH_TOPICS 정본)이라 페이지네이션 없음. /analyst-reports 목록과 동형 구조.

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
                hover
                padding="md"
                data-testid="tech-report-card"
                data-slug={r.slug}
                style={{ display: 'block' }}
              >
                {/* ⚠️ 카드 전체가 <Link>였는데 해부 링크가 추가되며 풀었다 — 앵커 중첩은 무효
                    마크업이고 중첩된 링크는 브라우저마다 다르게 동작한다. 본문(제목·지표)은
                    여전히 하나의 큰 Link라 "카드를 눌러 리포트로" 동선은 그대로다. */}
                <Link to={`/tech-report/${r.slug}`} data-testid="card-to-report" style={{ textDecoration: 'none', display: 'block' }}>
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
                </Link>
                {/* 진입점은 「해부」 하나다(task#309). 옛 판의 「리포트」 링크는 본문 Link와 목적지가
                    같은 두 번째 앵커였으므로 제거했다 — 카드를 눌러 리포트로 가는 동선은 그대로다.
                    해부 미작성이면 링크를 숨기지 않고 톤만 흐린다 — 숨기면 그런 화면이 있는 줄도
                    모르고, 해부 페이지는 빈 상태를 안내로 렌더하므로 고장난 링크가 아니다
                    (ADR-0042 결정 6 · task#306 S4). 폭이 모자라면 줄바꿈으로 흐르되 라벨 자체는
                    접히지 않는다(flex-wrap + nowrap, task#247 정석 조합).
                    스타일은 TechReport 목차 칩과 같은 계열(border 1px · radius 12 · accent)이고
                    padding만 4px 10px → 7px 12px로 키웠다. 탭 타깃 = 7+7+18(lineHeight)+2(border)
                    = 34px ≥ 32px — lineHeight를 명시하지 않으면 mono 11.5px의 normal이 ~14px이라
                    30px로 떨어진다. */}
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8, fontSize: 12 }}>
                  <Link to={`/tech-anatomy/${r.slug}`} data-testid="card-link-anatomy" className="mono"
                        style={{ fontSize: 11.5, lineHeight: '18px', padding: '7px 12px', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--accent)', textDecoration: 'none', whiteSpace: 'nowrap' }}>
                    {r.composition
                      ? '해부 보기 →'
                      : <span data-testid="card-anatomy-pending" style={{ color: 'var(--text-3)' }}>해부 미작성</span>}
                  </Link>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
