import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import api from '../api'
import Card from '../components/ui/Card'
import Stat from '../components/ui/Stat'
import Skeleton from '../components/ui/Skeleton'
import { TECH_NAMES, formatMarketSummary } from '../components/reports/techReportUtils'

// 주요기술 리포트 목록 (ADR-0033, task#276 S5, 개명·저장모델 ADR-0038, 설비/운영 분할 ADR-0039) —
// 기술 단위 발행물, 기술당 최신 1행(slug당 1행 고정, 이력 누적 없음). 백엔드 TECH_TOPICS 등록
// 15종 중 발행된 것만 이 그리드에 실리고(실측 7종, 2026-08-20), 미발행 나머지는 아래 「발행 대기」
// 구역에 칩으로 뜬다(S3) — "대상 6종 고정"은 옛 서술이었다. /analyst-reports 목록과 동형 구조.

// 발행 대기 칩 — TechReport.jsx 목차/출처 칩과 동일 스타일(task#316, 34px 탭 타깃 핀). 모듈
// 상수로 호이스팅해 매 렌더·매 칩마다 새 객체를 만들지 않는다.
const PENDING_CHIP_STYLE = {
  fontSize: 11.5, lineHeight: '18px', padding: '7px 12px',
  border: '1px solid var(--border)', borderRadius: 12,
  color: 'var(--accent)', textDecoration: 'none', whiteSpace: 'nowrap',
}
const PENDING_TITLE_STYLE = { fontFamily: 'var(--font-serif)', color: 'var(--text)', fontSize: 14, margin: '0 0 10px' }

export default function TechReports() {
  const [reports, setReports] = useState(null)  // null=로딩, []=없음
  // null=모름(로딩 중이거나 topics 키 없는 옛 백엔드), 배열=응답에서 받음(길이 0 포함) — 조회
  // 실패/미확인을 빈 결과로 붕괴시키지 않는다(task#307 교훈, 이 파일 적용).
  const [topics, setTopics] = useState(null)
  const [error, setError] = useState(null)       // 실패는 빈 상태와 구별(에러 정직성)

  useEffect(() => {
    let ignore = false
    api.get('/api/tech-reports')
      .then(({ data }) => {
        if (ignore) return
        setReports(data.reports || [])
        setTopics(Array.isArray(data.topics) ? data.topics : null)
      })
      .catch((e) => {
        if (ignore) return
        console.error('[TechReports] 목록 조회 실패:', e)
        setError('목록을 불러오지 못했습니다.')
      })
    return () => { ignore = true }
  }, [])

  // 대기 = topics 중 발행물(reports)에 없는 slug. topics가 배열일 때만 계산(모름이면 []).
  const publishedSlugs = new Set((reports || []).map(r => r.slug))
  const pendingTopics = Array.isArray(topics)
    ? topics.filter(t => !publishedSlugs.has(t.slug)).sort((a, b) => a.order - b.order)
    : []

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
                style={{ display: 'block', position: 'relative' }}
              >
                {/* ⚠️ 카드 전체가 <Link>였는데 해부 링크가 추가되며 풀었다 — 앵커 중첩은 무효
                    마크업이고 중첩된 링크는 브라우저마다 다르게 동작한다. 본문(제목·지표)은
                    여전히 하나의 큰 Link라 "카드를 눌러 리포트로" 동선은 그대로다. */}
                <Link to={`/tech-report/${r.slug}`} data-testid="card-to-report" style={{ textDecoration: 'none', display: 'block' }}>
                {/* 카드 padding·하단 줄의 빈 공간이 죽은 클릭 영역이었다(task#316) — 본문 Link는
                    display:block이라 자기 텍스트 상자까지만 히트되고, 카드 하단 68~86px은 아무
                    동작이 없었다. 앵커를 중첩하지 않고(task#306 제약) 카드를 통째로 히트시키려면
                    이 Link 안의 절대배치 오버레이가 필요하다 — 그래서 Card에 position:relative를
                    주고 오프셋 0을 그 카드 상자(padding 포함)에 맞춘다. `::after` 의사요소가 정석이지만
                    이 파일은 인라인 스타일 관례이고 TechReports.css가 없어 CSS 파일을 신설하지 않는다.
                    ⚠️ `inset: 0` 단축이 아니라 top/right/bottom/left **롱핸드**로 쓴다 — `inset`은
                    Safari 14.1(iOS 14.5) 이상 전용이고, 미지원 브라우저는 그 선언을 무시해 오프셋이
                    전부 auto로 남는다 → 빈 span이 **0×0**으로 접혀 이 수정이 무음 no-op이 된다
                    (화면·콘솔은 정상이고 Chromium 프로브는 원리적으로 못 잡는다. 이 앱은 iOS 설치형
                    PWA다).
                    ⚠️ 대가(의도된 것): ⓐ 오버레이가 본문 위에 깔리므로 카드 **텍스트 선택이
                    막힌다** — 목록 카드에서 제목·수치를 복사할 동기가 낮아 감수한다(복사가 필요한
                    독자는 상세로 들어간다). ⓑ 하단 줄의 「해부」 버튼 **밖** 빈 공간을 누르면
                    이제 리포트로 이동한다(S3 완료기준 ⓒ가 요구하는 동작이다). 그 대가로 「해부」
                    칩(34px = 최소 타깃)이 **사방에서 리포트 링크에 포위**된다 — 위 8px(paddingTop) ·
                    아래 16px(카드 padding) · 오른쪽 잔여 폭 · radius 12의 코너 밖. 근접 오탭의 결과가
                    「무반응」에서 「원치 않는 내비게이션」으로 바뀌므로, 칩 경계 +3px 클릭이 무엇을
                    여는지 라이브 축으로 재야 한다(중앙만 재는 축은 이 밴드에 블라인드하다).
                    ⓒ 마우스 히트 영역은 카드 전체인데 **키보드 포커스 링은 본문 앵커 박스(카드
                    상단부)** 에만 뜬다 — 링을 카드에 맞추려면 카드 루트를 인터랙티브로 만들어야
                    하고 그건 앵커 중첩 금지(task#306)에 걸린다. 감수한다(포커스 링이 왜 작은지를
                    다음 사람이 새 버그로 다시 조사하지 않게 적어 둔다).
                    「해부」 자신은 position:relative + zIndex:1로 오버레이 위에 떠 있어야 삼켜지지
                    않는다(아래 참조 — 그 쌍이 없으면 이 오버레이가 해부 진입점을 통째로 가린다). */}
                <span aria-hidden="true" data-testid="card-hit-overlay"
                      style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} />
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
                    스타일은 TechReport의 목차 칩·출처 링크 칩과 **동일**하다(border 1px · radius 12 ·
                    accent · `padding: 7px 12px` · `lineHeight: '18px'`) — task#316이 그 둘도 같은
                    값으로 올렸으므로 「여기만 padding이 다르다」는 옛 서술은 더 이상 참이 아니다.
                    탭 타깃 = 7+7+18(lineHeight)+2(border) = 34px ≥ 32px. ⚠️ lineHeight를 지워도
                    30px로 떨어지지는 않는다 — content 높이는 폰트 메트릭이 아니라 **상속된
                    line-height**(`tokens.css` `body{line-height:1.5}` → 11.5×1.5 = 17.25px)에서
                    나오므로 33.25px이다(옛 `4px 10px` 칩 실측 27px = 4+4+17.25+2가 그 증거).
                    즉 lineHeight는 32px 임계의 조건이 아니라 **34px를 정확히 고정**하는 핀이다.
                    position:relative + zIndex:1은 위 히트 오버레이(task#316) **위**로 올리기 위한
                    것이다 — 오버레이는 절대배치라 in-flow인 이 앵커보다 뒤에 그려지고, 그러면
                    「해부」 클릭이 리포트로 새어 나간다. 지우지 말 것.
                    ⚠️ 그 가드는 **이 앵커 하나에만** 붙어 있다 — 이 줄에 형제(2번째 링크·버튼·배지)를
                    추가하면 그것은 오버레이 *아래*에 놓여 클릭이 조용히 리포트로 새어 나간다(화면은
                    정상이고 vitest는 새 요소를 모른다). **추가하는 요소에도 relative+zIndex:1을 함께
                    줄 것**(가드는 행이 아니라 링크에 있으니 형제를 세야 한다 — task#273). */}
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8, fontSize: 12 }}>
                  <Link to={`/tech-anatomy/${r.slug}`} data-testid="card-link-anatomy" className="mono"
                        style={{ position: 'relative', zIndex: 1, fontSize: 11.5, lineHeight: '18px', padding: '7px 12px', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--accent)', textDecoration: 'none', whiteSpace: 'nowrap' }}>
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
      {/* 발행 대기 구역 — 발행물 그리드와 독립. topics 가 배열이 아니면(모름·옛 백엔드) 렌더하지
          않고, 대기 0건이어도 빈 구역을 렌더하지 않는다(계약). */}
      {pendingTopics.length > 0 && (
        <div data-testid="tech-pending-section" style={{ marginTop: 24 }}>
          <h4 style={PENDING_TITLE_STYLE}>발행 대기 ({pendingTopics.length})</h4>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {pendingTopics.map(t => (
              <Link key={t.slug} to={`/tech-report/${t.slug}`}
                    data-testid="tech-pending-chip" data-slug={t.slug}
                    className="mono" style={PENDING_CHIP_STYLE}>
                {t.name}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
