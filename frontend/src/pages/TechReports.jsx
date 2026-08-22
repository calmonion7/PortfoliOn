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

// 카드 제목 = 발행물의 **결론 문장**이다(기술 이름은 위 eyebrow가 이미 말한다). 옛 판은 여기에
// `overflow:hidden + textOverflow:ellipsis + whiteSpace:nowrap`을 걸어 한 줄로 잘랐는데, 한국어는
// 술어가 끝에 오므로 **잘림이 결론부터 먹는다**(CONVENTIONS §9.7 축② 구현 짝 — "한국어 자유 서술
// 필드는 자르지 않는다"). 라이브 실측(2026-08-22, GET만): 15장 중 pc1440 10 · m390 8 · m350 9장이
// 잘려 있었고 최악은 2219px 중 258px만 보였다(11.6%). 게다가 복구 경로가 없다 — `title` 툴팁도
// 없었고 터치 기기엔 hover 자체가 없다(§9 ⑧).
// 그래서 자르지 않고 **흐르게** 한다. 두 속성이 쌍으로 필요하다:
//   wordBreak: 'keep-all'     — 어절(공백) 경계로만 접고 한 단어를 낱자로 쪼개지 않는다(task#324 선례).
//   overflowWrap: 'break-word'— 한 어절이 통째로 컨테이너보다 넓을 때의 안전망(그것 없이 keep-all만
//                               두면 긴 라틴 토큰 하나가 카드를 넘겨 페이지 가로 스크롤을 만든다).
// ⚠️ 안전망은 `anywhere`가 **아니라** `break-word`다. 두 값은 이 자리에서 결과가 **완전히 동일**한데
//    (Chromium 실측 258px 상자·60자 무공백 토큰: 둘 다 height 90 · scrollWidth 258 == clientWidth 258;
//     `keep-all` 단독은 scrollWidth **621**로 넘친다) 지원 범위가 갈린다 — `anywhere`는 Safari/iOS
//     **15.4+** 전용이고 `break-word`는 Safari 6.1+다. 미지원 브라우저는 `anywhere` 선언만 드롭해
//     `keep-all` 단독 상태로 떨어지므로, **그 브라우저에서만 페이지 가로 스크롤이 생긴다**. 이 앱은
//     iOS 설치형 PWA이고 이 파일 아래 히트 오버레이 주석이 이미 `inset`으로 iOS 14.5 하한을 걱정한다.
//     Chromium 전용 프로브(`uat331`의 `page-no-hscroll`·`title-inside-card`)는 이 차이에 **원리적으로
//     블라인드**하다(`inset` footgun과 같은 클래스). 두 값의 유일한 실질 차이는 min-content 산정인데
//     그리드 트랙 최소가 240px **고정값**이라 min-content가 쓰이지 않아 여기서는 무관하다.
//     ⚠️ 형제 `components/tech/PlayerTable.jsx`는 `anywhere`가 **필요하다**(스크롤러를 없애 min-content가
//     실제로 트랙 폭을 결정한다) — 거기 값을 이 근거로 바꾸지 말 것.
// ⚠️ 알고 감수하는 대가 — 카드가 높아진다. 라이브 what-if 실측(브라우저 안에서 이 스타일만 바꿔
// 재측정): 최대 카드높이 pc1440 252→455 · m390 234→392 · m350 252→432, 페이지 높이 1600→2194 /
// 4099→4999 / 4297→5377. 넘침 0 · 가로 스크롤 0 · 잘림 0/15(3뷰포트 전부). 그리드가
// `align-items: stretch`라 **한 행의 카드가 가장 긴 제목에 맞춰 함께 커진다**(이웃 열로의 비용
// 이전) — 열 수를 만지면 반대 뷰포트 밀도가 내려가므로(§9.7) 열 수는 그대로 두고 이 비용을 받는다.
// 짧은 카드의 남는 아래 공간은 히트 오버레이가 덮으므로 죽은 영역이 되지 않는다(task#316).
// ⚠️ 단 그것은 *클릭 가능성*에 대한 답일 뿐이고 **시각 결과는 따로 고쳐야 했다** — 아래
//    CARD_FOOTER_STYLE 주석 참조(구분선이 카드 중간에 떠 있던 결함).
const CARD_TITLE_STYLE = {
  fontFamily: 'var(--font-serif)', color: 'var(--text)', fontWeight: 700, fontSize: 15,
  margin: '4px 0 10px', wordBreak: 'keep-all', overflowWrap: 'break-word',
}

// 카드 루트를 column flex로 두고 이 footer에 `marginTop: 'auto'`를 준다.
// ⚠️ 그 쌍이 없으면: 그리드가 `align-items: stretch`라 **한 행의 카드가 가장 긴 제목에 맞춰 함께
//    커지는데**(제목 전문 노출의 의도된 대가) footer는 in-flow 마지막 요소라 자기 자연 위치에
//    머문다 → 짧은 제목 카드에서 **구분선이 카드 중간에 뜨고 그 아래가 통째로 빈다**. Chromium
//    합성 실측(pc1440·3열·cardW 292·titleClient 258): 같은 행에 207자 제목이 있으면 카드 519px,
//    13자 제목 카드의 `card.bottom − footer.bottom`이 **309.5px**(카드의 60%)였고, 79자 제목만
//    있는 행도 129.5px였다. 발행물 15종 중 7종이 90자 이상이라 대부분의 행이 그 상태가 된다.
//    옛 판은 제목이 항상 1줄(22.5px)이어서 이 격차가 원리적으로 없었다(B54 수정의 부산물).
// ⚠️ 대안으로 그리드에 `alignItems:'start'`(자연 높이·blank 0)도 가능하지만 카드 하단이 래그드해지고
//    프로브 축 `grid-row-heights-equal`이 요구하는 stretch 정렬을 포기해야 한다. 여기서는 정렬을
//    유지하고 **빈 공간을 구분선 *위*로 옮긴다** — 그러면 정상적인 카드 여백처럼 읽힌다.
// ⚠️ 상단 8px 간격은 `marginTop: 'auto'`가 먹으므로(자유공간 0이면 auto가 0으로 해소돼 구분선이
//    본문에 붙는다) 본문 Link의 `marginBottom: 8`이 그 최소 간격을 담당한다 — 쌍으로 유지할 것.
// m390·m350은 1열이라 blank가 전부 17px 수준으로 무영향 → 이 결함은 **pc 전용**이었다.
const CARD_FOOTER_STYLE = {
  display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10,
  marginTop: 'auto', borderTop: '1px solid var(--border)', paddingTop: 8, fontSize: 12,
}

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
                style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}
              >
                {/* ⚠️ 카드 전체가 <Link>였는데 해부 링크가 추가되며 풀었다 — 앵커 중첩은 무효
                    마크업이고 중첩된 링크는 브라우저마다 다르게 동작한다. 본문(제목·지표)은
                    여전히 하나의 큰 Link라 "카드를 눌러 리포트로" 동선은 그대로다. */}
                <Link to={`/tech-report/${r.slug}`} data-testid="card-to-report" style={{ textDecoration: 'none', display: 'block', marginBottom: 8 }}>
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
                {/* 제목은 자르지 않고 전문을 흘린다 — 근거·대가는 CARD_TITLE_STYLE 주석 참조.
                    testid는 vitest·라이브 프로브의 공유 앵커다(TESTING §6) — 스타일을 바꿀 때 유지할 것. */}
                <div data-testid="tech-report-card-title" style={CARD_TITLE_STYLE}>
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
                <div data-testid="tech-report-card-footer" style={CARD_FOOTER_STYLE}>
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
