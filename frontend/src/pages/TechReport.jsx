import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import api from '../api'
import Card from '../components/ui/Card'
import Skeleton from '../components/ui/Skeleton'
import { SectionTitle } from '../components/reports/reportUtils.jsx'
import { TECH_NAMES, formatMarketSummary, sortPlayers } from '../components/reports/techReportUtils'
import MarketGrowthChart from '../components/tech/MarketGrowthChart'
import ShareChart from '../components/tech/ShareChart'
import TechLevelBand from '../components/tech/TechLevelBand'
import TechGraph from '../components/tech/TechGraph'
import TechKpiStrip from '../components/tech/TechKpiStrip'
import PlayerTable from '../components/tech/PlayerTable'
import ProseSections from '../components/tech/ProseSections'

// 선도기술 리포트 상세 (ADR-0033, task#276 S5 + task#277 S5 + task#280 S1) — 기술 단위 발행물.
// 목록은 기술당 최신 1건이라 여기도 이력 없이 최신 판만 보여준다(과거 판 UI는 비목표, 결정 1).
//
// 순서(task#280에서 "산문 먼저" → "지표·표 먼저"로 재구성. CONTEXT.md 구성 서사도 이 순서다):
//   기술명 h1 → 리드 문단 → KPI 스트립 → (2/2 핵심 포인트) → (2/2 진척 타임라인) → 주요 업체 표
//   → 기술수준 밴드 → (2/2 계보 분류) → 점유율 → 난제 → 시장 규모 → 연관 기술
//   → 상세 설명(접힘) → 출처.
// 괄호 자리는 2/2(신규 필드 의존)가 채운다 — 자리를 비워 둬야 2/2가 배치를 다시 흔들지 않는다.
//
// ⚠️ 이 파일은 배선만 한다 — 업체 표시 규율(gap_years·share_pct·기술수준 라벨)은 PlayerTable이
// 단독 소유한다. 여기에 같은 필드의 두 번째 거동을 두면 한 페이지에서 한 필드가 두 얼굴을
// 갖게 된다(task#277 이탈 7 실사례).
// 같은 이유로 **업체 순서도 여기서 한 번만 정한다**(sortPlayers 1회 → 전 소비처 공유). 표만
// 정렬하고 밴드에 원배열을 넘기면 30px 간격의 두 섹션이 같은 9곳을 다른 순서로 나열한다
// (task#280 적대 리뷰 F1 실측: 4·5번째가 뒤바뀜). 재정렬은 멱등이라 소비처가 또 정렬해도 안전하다.
// components/tech/* 는 전부 순수 표시 컴포넌트 — 데이터가 없으면 조용히 생략한다(TechLevelBand는
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
  // 표·밴드·점유율이 공유하는 단일 순서(F1). 비파괴 정렬이라 report.players는 그대로 남는다.
  const ordered = sortPlayers(players)
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
      <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 26, fontWeight: 700, color: 'var(--text)', lineHeight: 1.3, margin: '6px 0 6px' }}>
        {TECH_NAMES[report.slug] || report.slug}
      </h1>
      {/* 리드 문단 — 제목(141자)은 이미 핵심 결론이라 자르지 않고 격을 바꾼다. ellipsis·line-clamp
          금지(가토 ⑦ — 잘림은 문자열 *끝*을 먹어 결론의 뒷부분부터 사라진다). 줄바꿈은 허용. */}
      {report.title && (
        <p data-testid="tech-report-lead"
           style={{ fontFamily: 'var(--font-serif)', fontSize: 17, lineHeight: 1.55, color: 'var(--text-2, var(--text))', margin: '0 0 20px' }}>
          {report.title}
        </p>
      )}

      {/* ── KPI 스트립 (난이도 배지는 여기 흡수 — 중복 표시하지 않는다) ── */}
      <div style={{ marginBottom: 30 }}>
        <TechKpiStrip report={report} />
      </div>

      {/* 2/2 자리: 핵심 포인트 카드(key_points) */}
      {/* 2/2 자리: 진척 타임라인(milestones) */}

      {/* ── 주요 업체 (표시 규율은 PlayerTable 단독 소유) ── */}
      {players.length > 0 && (
        <div style={{ marginBottom: 30 }}>
          <SectionTitle>주요 업체</SectionTitle>
          <PlayerTable players={ordered} holdings={holdings} />
        </div>
      )}

      {/* ── 기술수준 비교 (업체 × 5단계 밴드, task#277 S3) ── */}
      {players.length > 0 && (
        <div style={{ marginBottom: 30 }}>
          <SectionTitle>기술수준 비교</SectionTitle>
          <TechLevelBand players={ordered} />
        </div>
      )}

      {/* 2/2 자리: 계보 분류(players[].category) */}

      {/* ── 점유율 ── 게이트는 ShareChart 자신의 채택 조건(유한·음수 아님)과 같은 식이어야 한다.
          느슨하면(예: isFinite만) 전 업체가 음수인 판에서 제목만 남고 차트가 사라진다(task#277 S2). */}
      {players.some(p => Number.isFinite(p.share_pct) && p.share_pct >= 0) && (
        <div style={{ marginBottom: 30 }}>
          <SectionTitle>점유율</SectionTitle>
          <ShareChart players={ordered} shareBasis={report.market?.share_basis} />
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

      {/* ── 상세 설명 (산문 전문 — 첫 화면이 아니라 본문 끝, 출처 앞. 손실 0으로 접기만 한다) ──
          가드는 description·rationale 둘 다 봐야 한다 — rationale만 있는 판에서 제목이 dangling
          되거나(전자만 보면) 제목 없이 근거만 뜨는(후자만 보면) 일이 없게. */}
      {(report.description || report.difficulty?.rationale) && (
        <div style={{ marginBottom: 30 }}>
          <SectionTitle>상세 설명</SectionTitle>
          <ProseSections description={report.description} rationale={report.difficulty?.rationale} />
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
