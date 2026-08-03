import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import api from '../api'
import Badge from '../components/ui/Badge'
import Card from '../components/ui/Card'
import Skeleton from '../components/ui/Skeleton'
import { SectionTitle } from '../components/reports/reportUtils.jsx'
import { TECH_NAMES, TECH_LEVEL_LABELS, formatMarketSummary } from '../components/reports/techReportUtils'
import MarketGrowthChart from '../components/tech/MarketGrowthChart'
import ShareChart from '../components/tech/ShareChart'
import TechLevelBand from '../components/tech/TechLevelBand'
import TechGraph from '../components/tech/TechGraph'

// 선도기술 리포트 상세 (ADR-0033, task#276 S5 + task#277 S5) — 기술 단위 발행물. 목록은 기술당
// 최신 1건이라 여기도 이력 없이 최신 판만 보여준다(과거 판 UI는 이번 비목표, ADR-0033 결정 1).
// 순서는 CONTEXT.md 정의 구성을 따른다: 기술설명 → 난이도 → 주요 업체 → 기술수준 밴드 →
// 점유율 → 난제 → 시장 규모(요약+성장곡선) → 연관기술(관계도) → 출처.
// components/tech/* 4종은 순수 표시 컴포넌트 — 데이터가 없으면 조용히 생략한다(TechLevelBand는
// 예외 — 업체가 있으면 항상 표시하고 결측 행은 "—", ShareChart/TechGraph는 섹션째 생략).

export default function TechReport() {
  const { slug } = useParams()
  const [report, setReport] = useState(undefined)  // undefined=로딩, null=발행물 없음(빈), object=있음
  const [error, setError] = useState(null)          // 실패는 빈 상태와 구별(에러 정직성)
  const [holdings, setHoldings] = useState({})      // ticker -> 'holding'|'watchlist' (보유/관심 배지용)

  useEffect(() => {
    let ignore = false
    setReport(undefined)
    setError(null)
    api.get(`/api/tech-reports/${slug}`)
      .then(({ data }) => { if (!ignore) setReport((data.reports || [])[0] ?? null) })
      .catch((e) => {
        if (ignore) return
        console.error('[TechReport] 리포트 조회 실패:', e)
        setError(e.response?.status === 422 ? '존재하지 않는 기술입니다.' : '리포트를 불러오지 못했습니다.')
      })
    return () => { ignore = true }
  }, [slug])

  // 보유/관심 배지 — 실패해도 배지만 생략(본문 표시를 막지 않는다)
  useEffect(() => {
    let ignore = false
    api.get('/api/stocks')
      .then(({ data }) => {
        if (ignore) return
        const map = {}
        ;(data || []).forEach(s => { map[s.ticker] = s.type })
        setHoldings(map)
      })
      .catch((e) => console.warn('[TechReport] 보유·관심 조회 실패(배지만 생략):', e))
    return () => { ignore = true }
  }, [])

  if (error) return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '48px 16px', textAlign: 'center', color: 'var(--text-3)' }}>
      <p>{error}</p>
      <Link to="/tech-reports" style={{ color: 'var(--accent)' }}>← 선도기술 리포트로 돌아가기</Link>
    </div>
  )

  if (report === undefined) return <div style={{ maxWidth: 780, margin: '0 auto', padding: '24px 16px' }}><Skeleton variant="row" count={8} /></div>

  if (report === null) return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '48px 16px', textAlign: 'center', color: 'var(--text-3)' }}>
      <p>{(TECH_NAMES[slug] || slug)} — 아직 발행된 리포트가 없습니다.</p>
      <Link to="/tech-reports" style={{ color: 'var(--accent)' }}>← 선도기술 리포트로 돌아가기</Link>
    </div>
  )

  const players = report.players || []
  const challenges = report.challenges || []
  const sources = report.sources || []
  const summary = formatMarketSummary(report.market)
  const related = report.related || {}
  const hasRelated = ['prerequisites', 'derivatives', 'complements', 'competitors']
    .some((k) => Array.isArray(related[k]) && related[k].length > 0)

  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '20px 16px 64px' }}>
      {/* ── 헤더 ─────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--text-3)', fontSize: 11, letterSpacing: '0.12em', fontWeight: 600 }}>TECH REPORT</span>
        <span className="mono" style={{ color: 'var(--text-3)', fontSize: 12, marginLeft: 'auto' }}>{report.published_date} 발행</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '8px 0 4px' }}>
        <span style={{ color: 'var(--text-3)', fontSize: 13, fontWeight: 600 }}>{TECH_NAMES[report.slug] || report.slug}</span>
        {report.difficulty?.score != null && <Badge variant="neutral">난이도 {report.difficulty.score}/5</Badge>}
      </div>
      <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 26, fontWeight: 700, color: 'var(--text)', lineHeight: 1.3, margin: '0 0 16px' }}>
        {report.title}
      </h1>

      {/* ── 상세 기술설명 ────────────────────────────────── */}
      {report.description && (
        <p style={{ color: 'var(--text-2, var(--text))', fontSize: 13, lineHeight: 1.75, whiteSpace: 'pre-wrap', margin: '0 0 20px' }}>
          {report.description}
        </p>
      )}

      {/* ── 기술난이도 근거 ──────────────────────────────── */}
      {report.difficulty?.rationale && (
        <div style={{ padding: '12px 16px', borderLeft: '3px solid var(--border-strong)', background: 'var(--bg-elev-2)', borderRadius: '0 6px 6px 0', marginBottom: 30 }}>
          <div style={{ color: 'var(--text-3)', fontSize: 11, marginBottom: 4 }}>기술난이도 근거</div>
          <p style={{ color: 'var(--text-2, var(--text))', fontSize: 13, lineHeight: 1.7, margin: 0 }}>{report.difficulty.rationale}</p>
        </div>
      )}

      {/* ── 주요 업체 ────────────────────────────────────── */}
      {players.length > 0 && (
        <div style={{ marginBottom: 30 }}>
          <SectionTitle>주요 업체</SectionTitle>
          <div data-testid="tech-report-players" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {players.map((p, i) => {
              const stockType = p.ticker ? holdings[p.ticker] : null
              const gapText = p.gap_years === 0
                ? '현재 선두'
                : p.gap_years != null && p.gap_years > 0
                  ? `선두 대비 ${p.gap_years}년${p.leader_name ? ` · ${p.leader_name}` : ''}`
                  : null
              return (
                <Card key={i} padding="sm" data-testid="tech-report-player-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {/* 업체명만 ellipsis(줄어도 되는 것) — 티커·배지는 flex-shrink:0 형제(task#275) */}
                    <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: 14, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.name}
                    </span>
                    <span style={{ marginLeft: 'auto', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {p.ticker && <span className="mono" style={{ color: 'var(--text-3)', fontSize: 11 }}>{p.ticker}</span>}
                      {stockType && (
                        <Badge
                          variant="neutral" size="sm"
                          style={stockType === 'holding'
                            ? { background: 'var(--tag-hold-bg)', color: 'var(--tag-hold-color)', borderColor: 'var(--tag-hold-border)' }
                            : { background: 'var(--tag-watch-bg)', color: 'var(--tag-watch-color)', borderColor: 'var(--tag-watch-border)' }}
                        >
                          {stockType === 'holding' ? '보유' : '관심'}
                        </Badge>
                      )}
                      {p.state_led && <Badge variant="info" size="sm">정부주도</Badge>}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 4, fontSize: 11.5, color: 'var(--text-3)' }}>
                    <span style={{ whiteSpace: 'nowrap' }}>{p.country}</span>
                    <span style={{ whiteSpace: 'nowrap' }}>{p.tech_level}단계 · {TECH_LEVEL_LABELS[p.tech_level]}</span>
                    {gapText && <span style={{ whiteSpace: 'nowrap' }}>{gapText}</span>}
                    {p.share_pct != null && <span className="mono tnum" style={{ whiteSpace: 'nowrap' }}>점유율 {p.share_pct}%</span>}
                  </div>
                  {p.note && <p style={{ color: 'var(--text-3)', fontSize: 11.5, margin: '6px 0 0' }}>{p.note}</p>}
                </Card>
              )
            })}
          </div>
        </div>
      )}

      {/* ── 기술수준 비교 (업체 × 5단계 밴드, task#277 S3) ── */}
      {players.length > 0 && (
        <div style={{ marginBottom: 30 }}>
          <SectionTitle>기술수준 비교</SectionTitle>
          <TechLevelBand players={players} />
        </div>
      )}

      {/* ── 점유율 (share_pct 전무 시 컴포넌트가 조용히 생략, task#277 S2) ── */}
      {players.some(p => Number.isFinite(p.share_pct)) && (
        <div style={{ marginBottom: 30 }}>
          <SectionTitle>점유율</SectionTitle>
          <ShareChart players={players} shareBasis={report.market?.share_basis} />
        </div>
      )}

      {/* ── 해결해야 할 난제 ─────────────────────────────── */}
      {challenges.length > 0 && (
        <div style={{ marginBottom: 30 }}>
          <SectionTitle>해결해야 할 난제</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {challenges.map((c, i) => (
              <Card key={i} padding="md">
                <div style={{ color: 'var(--text)', fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{c.title}</div>
                <p style={{ color: 'var(--text-2, var(--text))', fontSize: 13, lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap' }}>{c.body}</p>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ── 시장 규모 (텍스트 요약 + 그 아래 성장 곡선 차트, task#277 S1) ── */}
      <SectionTitle>시장 규모</SectionTitle>
      <Card padding="md" style={{ marginBottom: 16 }}>
        {summary ? (
          <p className="mono tnum" data-testid="tech-report-market-summary" style={{ color: 'var(--text)', fontSize: 15, fontWeight: 700, margin: 0 }}>{summary}</p>
        ) : (
          <p style={{ color: 'var(--text-3)', fontSize: 13, margin: 0 }}>시장 규모 데이터가 없습니다.</p>
        )}
        {report.market?.as_of && (
          <p style={{ color: 'var(--text-3)', fontSize: 11, margin: '8px 0 0' }}>{report.market.as_of} 기준</p>
        )}
      </Card>
      <div style={{ marginBottom: 30 }}>
        <MarketGrowthChart market={report.market} sources={sources} />
      </div>

      {/* ── 연관 기술 (전제→대상→파생 관계도, 관계 데이터 전무 시 조용히 생략, task#277 S4) ── */}
      {hasRelated && (
        <div style={{ marginBottom: 30 }}>
          <SectionTitle>연관 기술</SectionTitle>
          <TechGraph related={report.related} target={TECH_NAMES[report.slug] || report.slug} />
        </div>
      )}

      {/* ── 출처 ─────────────────────────────────────────── */}
      {sources.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <SectionTitle>출처</SectionTitle>
          <div data-testid="tech-report-sources" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {sources.map((s, i) => (
              s.url ? (
                <a key={i} href={s.url} target="_blank" rel="noreferrer" className="mono"
                   style={{ fontSize: 11.5, padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--accent)', textDecoration: 'none' }}>
                  {s.title}
                </a>
              ) : (
                <span key={i} className="mono" style={{ fontSize: 11.5, padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text-3)' }}>
                  {s.title}
                </span>
              )
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 32, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <span style={{ color: 'var(--text-3)', fontSize: 11 }}>본 문서는 발행 시점 조사 내용으로 박제된 판단 문서입니다 · 투자 판단의 책임은 투자자 본인에게 있습니다</span>
      </div>

      {/* 목록 복귀 — 우하단 플로팅 pill(analyst-report와 동형). fixed이므로 조상에 transform 금지(task#195) */}
      <Link to="/tech-reports" className="list-pill">☰ 목록</Link>
    </div>
  )
}
