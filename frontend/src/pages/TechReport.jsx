import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import api from '../api'
import Card from '../components/ui/Card'
import Skeleton from '../components/ui/Skeleton'
import { SectionTitle } from '../components/reports/reportUtils.jsx'
import { TECH_NAMES, sortPlayers, groupByCategory } from '../components/reports/techReportUtils'
import MarketGrowthChart from '../components/tech/MarketGrowthChart'
import MarketEstimates, { marketEstimatesLayout } from '../components/tech/MarketEstimates'
import ShareChart from '../components/tech/ShareChart'
import TechGraph from '../components/tech/TechGraph'
import TechKpiStrip from '../components/tech/TechKpiStrip'
import PlayerTable from '../components/tech/PlayerTable'
import ProseSections from '../components/tech/ProseSections'
import KeyPointCards from '../components/tech/KeyPointCards'
import MilestoneTimeline, { milestoneTimelineLayout } from '../components/tech/MilestoneTimeline'
import VariantTable, { variantTableLayout } from '../components/tech/VariantTable'
import WatchItems, { watchItemsLayout } from '../components/tech/WatchItems'
import './TechReport.css'

// 주요기술 리포트 상세 (ADR-0033, task#276 S5 + task#277 S5 + task#280 S1, 개명·저장모델
// ADR-0038) — 기술 단위 발행물. slug당 1행으로 고정돼 있어(ADR-0038 결정 2) 과거 판이 원천적으로
// 없다 — 재발행은 그 행을 덮어쓰기만 한다(과거 판 UI는 비목표, 결정 1).
//
// 순서(task#280에서 "산문 먼저" → "지표·표 먼저"로, **task#319에서 독자 질문 순서 + 4장 위계**로
// 재구성. CONTEXT.md 구성 서사도 이 순서다. ADR-0045):
//   기술명 h1 → 리드 문단 → KPI 스트립 → 해부 링크 → 전역 목차   ← 여기까지 불변(장 밖)
//   장 1 개요        핵심 포인트 → 계열 비교 → 연관 기술
//   장 2 시장·경쟁    시장 규모 → 주요 업체 → 점유율
//   장 3 진척·리스크  진척 타임라인 → 해결해야 할 난제 → 확인할 지표
//   장 4 근거        상세 설명(상시 노출) → 출처
// task#319가 옮긴 것 4건: 연관 기술 ⑨→③ · 계열 비교 ④→② · 시장 규모 ⑧→④ · 진척 타임라인 ②→⑦.
// 근거는 독자의 질문 순서다 — 전체 파이(시장 규모)를 모른 채 분할(점유율)을 볼 수 없고, 맥락(연관
// 기술)은 앞쪽 성격인데 9번째였다. 「계열 비교」의 옛 위치 근거(「계보 분류 바로 앞」)는 그 계보 분류가
// ADR-0041로 업체 표에 흡수돼 **낡았다**.
// ADR-0041: 「기술수준 비교」 밴드 섹션은 업체 표의 「기술수준」 셀로 흡수돼 별도 섹션이 아니다.
// task#281(2/2)이 신규 3필드(key_points·milestones·players[].category)로 그 예약 자리를 채웠다.
// task#297(1/2)이 발행 스키마에 2필드(variants·watch_items)를 추가하고 task#298(2/2)이 그것으로
// 「계열 비교」(점유율 바로 앞)·「확인할 지표」(난제 바로 뒤)를 렌더한다. 다섯 필드 전부
// **선택 필드**이고 구발행물엔 없다(라이브 4종 전부 두 필드 `null`) — 없으면 조용히 생략되어
// 화면이 이전과 동일해야 하고, 그 사실 자체가 회귀 축이다.
//
// task#296: <details> 섹션 접기를 전부 제거하고(스크롤만으로 전문을 읽는다, ADR-0034 결정 1) 대신
// KPI 스트립 아래 정적 전역 목차를 둔다(리드 밑이 아니다 — 그러면 스트립이 첫 화면 밖으로 밀린다,
// 아래 목차 블록 주석의 실측 참조). 목차·본문 SectionTitle은 **SECTIONS 배열 하나**에서 파생한다
// (DOM을 훑어 제목을 수집하지 않는다) — show는 각 섹션의 기존 렌더 게이트 식을 그대로 옮긴 것이라
// 느슨하게 하면 목차 칩만 남고 본문이 사라지는 함정(아래 여러 주석이 경고)이 목차에도 옮는다.
//
// ⚠️ 이 파일은 배선만 한다 — 업체 표시 규율(gap_years·share_pct·기술수준 라벨)은 PlayerTable이
// 단독 소유한다. 여기에 같은 필드의 두 번째 거동을 두면 한 페이지에서 한 필드가 두 얼굴을
// 갖게 된다(task#277 이탈 7 실사례).
// 같은 이유로 **업체 순서도 여기서 한 번만 정한다**(sortPlayers 1회 → 전 소비처 공유). ADR-0041로
// 「기술수준 비교」 밴드가 표 셀로 흡수돼 표↔밴드 순서 불일치 위험(task#280 적대 리뷰 F1, 같은 업체를
// 두 섹션이 다른 순서로 나열)은 같은 <tr>이라 원리적으로 사라졌다. 남은 별도 섹션은 점유율
// (ShareChart)뿐이라 여전히 같은 `ordered`를 공유해야 한다. 재정렬은 멱등이라 소비처가 또 정렬해도
// 안전하다. components/tech/* 는 전부 순수 표시 컴포넌트 — 데이터가 없으면 조용히 생략한다
// (ShareChart/TechGraph는 섹션째 생략).

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
      <Link to="/tech-reports" style={{ color: 'var(--accent)' }}>← 주요기술 리포트로 돌아가기</Link>
    </div>
  )

  if (report === undefined) return <div style={{ maxWidth: 780, margin: '0 auto', padding: '24px 16px' }}><Skeleton variant="row" count={8} /></div>

  if (report === null) return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '48px 16px', textAlign: 'center', color: 'var(--text-3)' }}>
      <p>{(TECH_NAMES[slug] || slug)} — 아직 발행된 리포트가 없습니다.</p>
      <Link to="/tech-reports" style={{ color: 'var(--accent)' }}>← 주요기술 리포트로 돌아가기</Link>
    </div>
  )

  const players = report.players || []
  // 표·밴드·점유율이 공유하는 단일 순서(F1). 비파괴 정렬이라 report.players는 그대로 남는다.
  // ⚠️ task#301: 업체 표가 분류 축별로 묶이면서 **화면 순서 = 그룹 평탄화 순서**가 됐다. 여기서
  // 그 순서를 확정해 세 섹션에 같은 배열을 넘기지 않으면, 30px 간격의 표와 밴드가 같은 업체 11곳을
  // 서로 다른 순서로 나열해 화면이 자기모순이 된다(라이브 uat280 `band-order`가 실측으로 포착 —
  // 적대 리뷰 두 렌즈는 "ordered 배열 하나만 넘기는가"라는 *문자*만 보고 통과시켰다).
  // 각 컴포넌트는 여전히 자기 입력을 스스로 정렬·그룹화한다(계약 무변경) — 여기서는 그 결과와
  // 같은 순서를 만들어 밴드에도 넘길 뿐이다.
  const sorted = sortPlayers(players)
  const orderGroups = groupByCategory(sorted)
  const ordered = orderGroups.length > 0 ? orderGroups.flatMap((g) => g.players) : sorted
  const challenges = report.challenges || []
  const sources = report.sources || []
  const related = report.related || {}
  const hasRelated = ['prerequisites', 'derivatives', 'complements', 'competitors']
    .some((k) => Array.isArray(related[k]) && related[k].length > 0)
  // 신규 3필드 게이트 — 제목을 페이지가 소유하는 두 섹션은 게이트가 **컴포넌트 자신의 채택 조건과
  // 같은 식**이어야 한다. 느슨하면(예: milestones.length > 0) year·event가 결측인 항목만 담긴 판에서
  // 제목만 남고 본문이 사라진다(점유율 섹션이 task#277 S2에서 겪은 함정). 그래서 판정을 추측하지 않고
  // 각 컴포넌트가 export한 순수함수를 그대로 호출한다. 핵심 포인트는 제목까지 컴포넌트가 소유해
  // 예전엔 페이지 게이트가 없었지만, 목차 칩이 그 섹션도 가리켜야 하므로(task#296) `hasKeyPoints`를
  // 둔다 — 식은 KeyPointCards가 null을 반환하는 조건과 **같아야** 한다(어긋나면 죽은 칩이 생긴다).
  const hasMilestones = milestoneTimelineLayout({ milestones: report.milestones }).items.length > 0
  const hasVariants = variantTableLayout(report.variants).axes.length > 0
  const hasWatchItems = watchItemsLayout(report.watch_items).items.length > 0
  const hasPlayers = players.length > 0
  const hasKeyPoints = Array.isArray(report.key_points) && report.key_points.length > 0
  const hasShare = players.some((p) => Number.isFinite(p.share_pct) && p.share_pct >= 0)
  const hasChallenges = challenges.length > 0
  const hasSources = sources.length > 0
  // ⚠️ truthy 검사가 아니라 **공백 제외 비어있지 않음**이다(적대 리뷰 렌즈1 발견 3). ProseSections는
  // 내부에서 `trim() !== ''`로 판정해 공백만이면 null을 반환하는데, 페이지 게이트가 truthy면
  // `"   "`에서 **제목만 남은 유령 섹션 + 그것을 가리키는 죽은 목차 칩**이 생긴다. 게이트는 컴포넌트
  // 자신의 채택 조건과 같은 식이어야 한다는 이 페이지의 규율(위 주석)이 산문 섹션에도 적용된다.
  const nonBlank = (v) => typeof v === 'string' && v.trim() !== ''
  const hasProse = nonBlank(report.description) || nonBlank(report.difficulty?.rationale)

  // 목차·본문 제목 단일 소스(task#296 S4) — show는 각 섹션의 기존 게이트 식을 그대로 옮긴 것이다
  // (느슨화 금지 — 아래 각 섹션 주석 참조).
  // ⚠️ **배열 순서 == JSX 렌더 순서**여야 한다(task#319 S2). 둘이 어긋나면 목차 칩이 본문과 다른
  //    순서를 가리키는데, 개수·라벨 단언은 둘 다 통과하므로 조용히 깨진다. 그래서 테스트가 두 순서를
  //    서로 대조한다(칩 href 순서 === DOM data-tech-section 순서).
  // 순서는 task#319에서 **독자 질문 순서**로 재배열했다 — 전체 파이(시장 규모)를 분할(점유율)보다
  // 앞에 두고, 맥락(연관 기술)을 앞쪽으로 올린다. 이동 4건: 연관 ⑨→③ · 계열 ④→② · 시장 ⑧→④ ·
  // 타임라인 ②→⑦. 뒤집지 않은 것: KPI 스트립 첫 화면 · 목차는 스트립 아래 · 상세 설명은 본문 끝 ·
  // 난제→확인할 지표 인접(장 3 안에서 유지).
  const SECTIONS = [
    { id: 'key-points', label: '핵심 포인트', show: hasKeyPoints, chapter: 'overview' },
    { id: 'variants', label: '계열 비교', show: hasVariants, chapter: 'overview' },
    { id: 'related', label: '연관 기술', show: hasRelated, chapter: 'overview' },
    { id: 'market', label: '시장 규모', show: true, chapter: 'market-competition' },
    { id: 'players', label: '주요 업체', show: hasPlayers, chapter: 'market-competition' },
    { id: 'share', label: '점유율', show: hasShare, chapter: 'market-competition' },
    { id: 'milestones', label: '진척 타임라인', show: hasMilestones, chapter: 'progress-risk' },
    { id: 'challenges', label: '해결해야 할 난제', show: hasChallenges, chapter: 'progress-risk' },
    { id: 'watch-items', label: '확인할 지표', show: hasWatchItems, chapter: 'progress-risk' },
    { id: 'prose', label: '상세 설명', show: hasProse, chapter: 'evidence' },
    { id: 'sources', label: '출처', show: hasSources, chapter: 'evidence' },
  ]
  const tocItems = SECTIONS.filter((s) => s.show)

  // 4장 위계(task#319 S3) — 11섹션을 전부 동급으로 나열하면 무엇이 결론이고 무엇이 근거인지 화면이
  // 말하지 않는다. 장 라벨 한 줄 + 얇은 구분선으로 위계를 만든다(공유 프리미티브 `SectionTitle`의
  // 격은 건드리지 않는다 — 파장이 이 페이지 밖으로 나간다).
  // ⚠️ **유령 UI 금지** — 라벨은 그 장의 **첫 *표시* 섹션**에만 붙는다. 아래 map이 `show`를 보므로,
  //    장의 섹션이 전부 결측이면 그 장은 키가 없어 라벨도 렌더되지 않는다(이 페이지의 기존 규율
  //    「게이트는 컴포넌트 자신의 채택 조건과 같은 식」의 장 라벨판). `show`를 무시하면 데이터 없는
  //    판에서 라벨만 남는다.
  const CHAPTERS = [
    { key: 'overview', label: '개요' },
    { key: 'market-competition', label: '시장·경쟁' },
    { key: 'progress-risk', label: '진척·리스크' },
    { key: 'evidence', label: '근거' },
  ]
  const chapterHeadAt = {}
  for (const c of CHAPTERS) {
    const first = SECTIONS.find((s) => s.chapter === c.key && s.show)
    if (first) chapterHeadAt[first.id] = c
  }
  // 섹션 블록마다 앞에 놓인다 — 그 섹션이 자기 장의 첫 표시 섹션일 때만 라벨이 된다(그 외엔 null).
  // 섹션의 게이트 *밖*에 두어도 안전하다: 표시되지 않는 섹션은 chapterHeadAt의 키가 될 수 없다.
  const Chap = ({ id }) => {
    const c = chapterHeadAt[id]
    if (!c) return null
    return (
      <div data-tech-chapter={c.key}
           style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-3)', marginBottom: 'var(--space-3)',
                    fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-medium)',
                    color: 'var(--text-3)', letterSpacing: '0.08em' }}>
        {c.label}
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '20px 16px 64px' }}>
      {/* ── 헤더 ─────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--text-3)', fontSize: 11, letterSpacing: '0.12em', fontWeight: 600 }}>TECH REPORT</span>
        <span className="mono" style={{ color: 'var(--text-3)', fontSize: 12, marginLeft: 'auto' }}>{report.published_date} 갱신</span>
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

      {/* 기술 해부로 가는 상호링크 (ADR-0042 결정 6 — 해부는 리포트의 두 번째 시선이지 여섯 번째
          nav 섹션이 아니다).

          ⚠️ **위치가 계약이다.** 처음엔 리드 문단 바로 아래(= KPI 스트립 *위*)에 뒀는데, 그 한 줄이
          세로 ~37px(줄 17 + 여백 20)을 먹어 **모바일에서 KPI 스트립이 첫 화면 밖으로 밀렸다**
          (uat280 `kpi-visible` 선재 3 → 5+로 증가). task#280이 목차를 리드 밑이 아니라 스트립
          *아래*에 둔 것과 같은 이유이고, 가토 ⑰ 「비용이 이웃으로 이전된다」의 세로판이다.
          여기(스트립 아래·목차 위)로 옮기면 그 비용이 첫 화면 예산에서 빠진다.

          해부가 없어도 링크는 남기고 배지로 표시한다 — 링크를 숨기면 "그런 화면이 있는 줄도
          모르는" 상태가 되고, 해부 페이지는 빈 상태를 안내로 렌더하므로 고장난 링크가 아니다.

          ⚠️ **알고도 미룬 결함(task#316) — 의도된 트레이드오프가 아니다.** 이 링크의 탭 타깃은
          `--font-size-xs` 11px × 상속 line-height 1.5 = **16.5px**로 기준 32px의 절반이고,
          task#316이 34px로 키운 칩들의 *수정 전* 높이(27px)보다도 작다. 하필 해부로 가는 1차
          진입점이다(ADR-0042 결정 6). 닫으려면 padding만으로는 안 되고(인라인 요소의 세로 padding은
          줄 상자에 반영되지 않는다 — task#309) `display: inline-block` + padding으로 바꿔야 하는데
          그건 이 문단의 레이아웃을 바꾸는 시각 변경이라 라이브 실측·육안이 필요해 범위 밖으로 뒀다.
          ⚠️ 이 결함은 `grep 'padding: 4px 10px'`류 **리터럴 감사에 원리적으로 안 걸린다**(padding이
          아예 없다) — 탭 타깃 감사는 리터럴이 아니라 성질로 셀 것: 「32px 미달 상호작용 요소 집합」
          (`document.querySelectorAll('a,button,[role=button]')`의 rect 높이). */}
      <p style={{ margin: '0 0 20px', fontSize: 'var(--font-size-xs)' }}>
        <Link to={`/tech-anatomy/${report.slug}`} data-testid="report-to-anatomy" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
          이 기술의 해부 →
        </Link>
        {!report.composition && (
          <span data-testid="report-anatomy-pending" style={{ marginLeft: 6, color: 'var(--text-3)' }}>미작성</span>
        )}
      </p>

      {/* ── 전역 목차 (task#296 S4) — sticky 아님. 항목 1개 이하면 렌더하지 않는다(유령 UI 금지).
          칩 스타일은 출처 칩 관례 재사용(아래 「출처」 섹션 참조). gap으로만 정렬해 한 덩어리로
          읽히게 하고(가토 ⑩), flexWrap으로 좁은 폭에서 줄바꿈시키되 칩 텍스트는 접지 않는다(가토 ⑨).

          ⚠️ 위치가 계획(“리드 문단 바로 아래”)과 다르다 — **KPI 스트립 *아래*여야 한다.** 계획대로
          리드 밑에 두면 목차가 128px(높이 98 + 여백 30)을 먹어 KPI 스트립이 첫 화면 밖으로 밀린다
          (라이브 실측: m390 스트립 bottom 686 > 가용 603 · m350 733 > 639 → uat280 `kpi-visible` 4건 FAIL).
          그 축은 task#280이 스트립을 압축해 어렵게 green으로 만든 **기록된 결정**이라 뒤집을 수 없고
          (task#264 절차), **리드 밑 대안**은 목차가 여러 줄이라 목차 자체를 34px 한 줄로 줄여 비용을
          상쇄하는 것도 원리적으로 불가하다 — 즉 그 문장은 *위치 대안*의 기각 근거이지 칩 높이의
          상한이 아니다. 스트립 아래로 옮기면 스트립이 task#280 당시 좌표로 돌아가 두 결정이
          함께 성립한다 (m390 bottom 549 < 603). 목차는 여전히 본문 섹션 전체보다 위이므로 항해 목적은
          유지된다.
          ⚠️ 그 축은 **현재 green이 아니다** — 2026-08-20 실측 선재 FAIL 3건(`m390-light/smr` ·
          `m390-light/ai-datacenter-equipment` · `m350-dark/smr`). *결정*은 유지되나 증감 판정은
          총계가 아니라 이 내역과 대조할 것(선재를 내 회귀로, 내 회귀를 선재로 오귀속하는 것을
          막는 유일한 수단이다).

          그래서 task#316이 칩을 탭 타깃 34px(padding 7·12 + lineHeight 18 + border 1·2)로 키운 것은
          이 결정과 충돌하지 않는다 — 근거는 **하나뿐이다**: 목차가 스트립 *아래*라 칩이 커져도
          `kpi-visible`이 재는 스트립 bottom이 움직이지 않는다. ⚠️ 스트립 여유(2026-08-20 실측
          m278 +209 · m390 +97 · m768 +453 · pc1280 +444)를 **목차 성장의 예산으로 읽지 말 것** —
          목차는 그 여유의 소비자가 아니고, 애초에 첫 화면에 들어가지도 않는다(m390: 목차 top ≈ 573
          + nav 133 = 706 > 가용 603 — 변경 *전부터* 그렇고 요구사항이 아니다).
          줄 수도 추정하지 말 것: 최다 칩 slug(`semiconductor-equipment`, 11칩)의 nav 실측 높이는
          m278 168 · m390 133 · m768·pc1280 63이고, 칩 27.25px·gap 8로 역산하면 **5 · 4 · 2줄**이다
          (옛 주석의 "278px에서 3줄"은 실측과 다르다). 34px 칩이면 같은 줄 수에서 202 · 160 · 76이고,
          칩이 4px 넓어져 m278에서 줄이 하나 늘면 244가 된다 → **배포 후 라이브 재측정으로 닫는다.**
          목차를 스트립 *위*로 되돌리면 이 상쇄가 사라지니 위치와 칩 높이는 함께 봐야 한다.

          칩 높이의 메커니즘 — `frontend/CLAUDE.md`(task#309)의 「content 높이는 폰트 메트릭에서
          나온다(mono 11.5px normal ≈ 14px)」는 실측에 반증됐다. 실제 출처는 **상속된 line-height**다:
          `styles/tokens.css`의 `body { line-height: 1.5 }`가 단위 없는 값이라 11.5px 칩의 used
          line-height는 17.25px이고, `4px 10px` 칩의 실측 27px = 4+4+17.25+2이 그것을 확증한다
          (폰트 메트릭 모델이면 24px이었어야 한다). 따라서 `padding: 7px 12px`만으로도
          7+7+17.25+2 = **33.25px ≥ 32px**이고, `lineHeight: '18px'`은 32px 임계의 조건이 아니라
          **34px를 정확히 고정**해 프로브가 `=== 34`로 단언할 수 있게 하는 핀이다(폰트 폴백 보험 겸).
          전역 `body` line-height를 바꾸면 lineHeight 미선언 칩들의 높이가 조용히 따라 움직인다. */}
      {tocItems.length > 1 && (
        <nav data-testid="tech-report-toc" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 30 }}>
          {tocItems.map((s) => (
            <a key={s.id} href={`#${s.id}`} data-testid="tech-toc-chip" className="mono"
               style={{ fontSize: 11.5, padding: '7px 12px', lineHeight: '18px', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--accent)', textDecoration: 'none', whiteSpace: 'nowrap' }}>
              {s.label}
            </a>
          ))}
        </nav>
      )}

      <Chap id="key-points" />
      {/* ── 핵심 포인트 (task#281 S2) ── 여기만 SectionTitle·바깥 여백을 컴포넌트가 소유한다.
          래퍼(<div marginBottom:30>)로 감싸면 데이터가 없어 null을 반환한 자리에 30px 유령 간격이
          남으므로 감싸지 않는다. */}
      <KeyPointCards points={report.key_points} sectionId="key-points" />


      <Chap id="variants" />
      {/* ── 계열 비교 (task#298 S4) ── 점유율 바로 앞. 계열의 *성질*을 담는다(업체의 *소속*을
          담는 계보 분류와는 다른 사실 — 병존, 흡수하지 않는다). 게이트는 VariantTable 자신의
          채택 조건과 같은 식(variantTableLayout(...).axes.length > 0). ── */}
      {hasVariants && (
        <div id="variants" data-tech-section="variants" style={{ marginBottom: 30 }}>
          <SectionTitle>계열 비교</SectionTitle>
          <VariantTable variants={report.variants} />
        </div>
      )}


      <Chap id="related" />
      {/* ── 연관 기술 (전제→대상→파생 관계도, 관계 데이터 전무 시 조용히 생략, task#277 S4) ── */}
      {hasRelated && (
        <div id="related" data-tech-section="related" style={{ marginBottom: 30 }}>
          <SectionTitle>연관 기술</SectionTitle>
          <TechGraph related={report.related} target={TECH_NAMES[report.slug] || report.slug} />
        </div>
      )}


      <Chap id="market" />
      {/* ── 시장 규모 (task#282 S3 — 텍스트 요약 카드를 제거했다. formatMarketSummary가
          history/forecast에서 파생되므로 차트가 빈 상태면 요약도 항상 null이었다(둘은 항상 같이
          있거나 같이 없다) — 구조적으로 100% 중복. 유일한 고유 정보였던 as_of는 이제
          MarketGrowthChart 캡션이 받는다. 기관별 추정치(MarketEstimates)는 같은 절 안의
          하위 표시라 별도 SectionTitle을 두지 않는다. ── */}
      <div id="market" data-tech-section="market">
        <SectionTitle>시장 규모</SectionTitle>
        <div style={{ marginBottom: 30 }}>
          <MarketGrowthChart market={report.market} />
        </div>
        {marketEstimatesLayout(report.market?.estimates).rows.length > 0 && (
          <div style={{ marginBottom: 30 }}>
            <MarketEstimates estimates={report.market.estimates} />
          </div>
        )}
      </div>


      <Chap id="players" />
      {/* ── 주요 업체 (표시 규율은 PlayerTable 단독 소유) ── */}
      {hasPlayers && (
        <div id="players" data-tech-section="players" style={{ marginBottom: 30 }}>
          <SectionTitle>주요 업체</SectionTitle>
          <PlayerTable players={ordered} holdings={holdings} />
        </div>
      )}


      <Chap id="share" />
      {/* ── 점유율 ── 게이트는 ShareChart 자신의 채택 조건(유한·음수 아님)과 같은 식이어야 한다.
          느슨하면(예: isFinite만) 전 업체가 음수인 판에서 제목만 남고 차트가 사라진다(task#277 S2). */}
      {hasShare && (
        <div id="share" data-tech-section="share" style={{ marginBottom: 30 }}>
          <SectionTitle>점유율</SectionTitle>
          <ShareChart players={ordered} shareBasis={report.market?.share_basis} />
        </div>
      )}


      <Chap id="milestones" />
      {/* ── 진척 타임라인 (task#281 S3) ── */}
      {hasMilestones && (
        <div id="milestones" data-tech-section="milestones" style={{ marginBottom: 30 }}>
          <SectionTitle>진척 타임라인</SectionTitle>
          <MilestoneTimeline milestones={report.milestones} />
        </div>
      )}


      <Chap id="challenges" />
      {/* ── 해결해야 할 난제 ─────────────────────────────── */}
      {hasChallenges && (
        <div id="challenges" data-tech-section="challenges" style={{ marginBottom: 30 }}>
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


      <Chap id="watch-items" />
      {/* ── 확인할 지표 (task#298 S4) ── 난제 바로 뒤·시장 규모 앞. 난제(*지금 무엇이 안 풀렸나*)
          → 확인할 지표(*무엇을 지켜보면 풀렸는지 아는가*)가 논리 순서다. 게이트는 WatchItems 자신의
          채택 조건과 같은 식이어야 한다 — 느슨하면 label이 전부 빈 판에서 제목만 남는다. */}
      {hasWatchItems && (
        <div id="watch-items" data-tech-section="watch-items" style={{ marginBottom: 30 }}>
          <SectionTitle>확인할 지표</SectionTitle>
          <WatchItems watchItems={report.watch_items} />
        </div>
      )}


      <Chap id="prose" />
      {/* ── 상세 설명 (산문 전문 — 첫 화면이 아니라 본문 끝, 출처 앞. task#296: <details> 접기를
          없애고 스크롤로 전문을 읽는다 — 항해는 위 전역 목차가 대신한다) ──
          가드는 description·rationale 둘 다 봐야 한다 — rationale만 있는 판에서 제목이 dangling
          되거나(전자만 보면) 제목 없이 근거만 뜨는(후자만 보면) 일이 없게. */}
      {hasProse && (
        <div id="prose" data-tech-section="prose" style={{ marginBottom: 30 }}>
          <SectionTitle>상세 설명</SectionTitle>
          <ProseSections description={report.description} rationale={report.difficulty?.rationale} />
        </div>
      )}


      <Chap id="sources" />
      {/* ── 출처 ───────────────────────────────────────────
          ⚠️ 이 컨테이너는 `alignItems`를 지정하지 않으므로 기본 **stretch**다 — 제목이 길어 여러 줄이
          된 칩(2026-08-20 m278 실측 148/114/79px)이 같은 wrap 줄에 있으면 짧은 칩도 그 줄 높이로
          늘어난다. 그래서 「출처 칩 34px」류 라이브 축은 **1줄 칩 표본에만** 유효하다: 1줄 표본이
          없으면 PASS가 아니라 미검증(FAIL)으로 보고해야 하고, 하한 `>= 34`는 stretch에 끌려간 칩에서
          이빨이 0이다(padding을 되돌려도 통과한다).
          ⚠️ task#316이 가로 padding을 10→12px로 키운 만큼 칩 안 텍스트 가용폭이 4px 줄어 **넘침
          임계가 내려갔다** — 이 칩엔 `whiteSpace: nowrap`이 없어 한글은 접히지만 공백 없는 라틴
          토큰(기관 약어·URL 조각)은 끊기지 않는다. uat280 `clip` 건수와 m278 h-scroll 집합을
          baseline과 대조할 것(트립하면 padding 완화가 아니라 `overflowWrap: 'anywhere'`가 정석 —
          task#296 선례). */}
      {hasSources && (
        <div id="sources" data-tech-section="sources" style={{ marginBottom: 8 }}>
          <SectionTitle>출처</SectionTitle>
          <div data-testid="tech-report-sources" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {sources.map((s, i) => (
              s.url ? (
                <a key={i} href={s.url} target="_blank" rel="noreferrer" className="mono"
                   style={{ fontSize: 11.5, padding: '7px 12px', lineHeight: '18px', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--accent)', textDecoration: 'none' }}>
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
        <span style={{ color: 'var(--text-3)', fontSize: 11 }}>본 문서는 갱신 시점 조사 내용입니다 · 투자 판단의 책임은 투자자 본인에게 있습니다</span>
      </div>

      {/* 목록 복귀 — 우하단 플로팅 pill(analyst-report와 동형). fixed이므로 조상에 transform 금지(task#195) */}
      <Link to="/tech-reports" className="list-pill">☰ 목록</Link>
    </div>
  )
}
