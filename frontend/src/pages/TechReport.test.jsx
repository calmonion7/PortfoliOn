import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import TechReport from './TechReport'
import { groupByCategory } from '../components/reports/techReportUtils'
import api from '../api'

vi.mock('../api', () => ({ default: { get: vi.fn() } }))

const REPORT = {
  slug: 'reusable-rocket', published_date: '2026-08-03',
  title: '재사용 발사체, 궤도당 비용을 다시 쓴다',
  description: '1단 재사용이 발사비를 낮추는 구조를 설명한다.',
  difficulty: { score: 4, rationale: '극저온 추진제 재점화가 어렵다.' },
  players: [
    // leader_name은 "무엇 대비인지" = 선두 **업체명**이다(CLAUDE_COWORK_API.md 정의). 인명을 넣으면
    // `선두 대비 5년 · Elon Musk`처럼 오표기가 된다 — 이 픽스처의 옛 인명 값이 실제로 오도를 낳았다(task#277).
    { name: 'SpaceX', country: 'US', state_led: false, ticker: null, tech_level: 5, gap_years: 0, leader_name: 'SpaceX', share_pct: 60.0, note: '재사용 1위' },
    { name: 'CASC', country: 'CN', state_led: true, ticker: null, tech_level: 3, gap_years: 5, leader_name: 'SpaceX', share_pct: null, note: null },
  ],
  challenges: [{ title: '재점화 신뢰성', body: '다회 재점화 엔진 내구성.' }],
  related: { prerequisites: [], derivatives: [], complements: [], competitors: [] },
  market: {
    history: [{ year: 2024, size: { value: 12.5, currency: 'USD', unit: 'bn' } }],
    forecast: [{ year: 2030, size: { value: 30.5, currency: 'USD', unit: 'bn' } }],
    cagr_pct: 12.3, share_basis: '발사 횟수 기준', as_of: '2026-08-03',
  },
  sources: [{ title: 'NASA', url: null }],
}

// 실발행 SMR 판(2026-08-04)의 **형태**를 미러한 두 번째 픽스처 — players 9곳 · cagr_pct null ·
// share_pct 전무 · leader_name 짧음. reusable-rocket 판 하나만 보면 F1(표·밴드 두 순서)이 안 잡힌다:
// 그 판은 API 순서가 이미 정렬 순서와 같아 재정렬이 아무것도 바꾸지 않기 때문이다(실제로 그래서 놓쳤다).
// 여기 API 순서는 동단계(3단계) 안에서 격차 null이 먼저 오도록 두어 정렬이 순서를 **실제로 바꾼다**.
const SMR_REPORT = {
  slug: 'smr', published_date: '2026-08-04',
  title: '1호는 중국 링룽, 착공한 서방 설계는 2건 — 2026~28년 현금은 노형 경쟁이 아니라 주기기 공급망에서 난다',
  description: '[기술 개요]\n소형모듈원자로는 공장 제작·현장 조립을 전제로 한다.\n\n[시장 규모]\n2035년까지 완만히 늘어난다.',
  difficulty: { score: 4, rationale: '규제 인허가와 초도 제작이 동시 병목이다.' },
  players: [
    { name: 'CNNC', country: 'CN', state_led: true, ticker: null, tech_level: 5, gap_years: 0, leader_name: 'CNNC', share_pct: null, note: '링룽1호 세계 최초 상업 SMR.' },
    { name: 'NuScale', country: 'US', state_led: false, ticker: 'SMR', tech_level: 4, gap_years: 2, leader_name: 'CNNC', share_pct: null, note: 'NRC 설계인증 완료.' },
    { name: '롤스로이스SMR', country: 'GB', state_led: false, ticker: null, tech_level: 4, gap_years: 3, leader_name: 'CNNC', share_pct: null, note: '영국 GDA 3단계.' },
    // ↓ 이 두 곳이 F1의 실측 지점(4·5번째). API는 격차 미산정(null)을 먼저 주지만 정렬은 뒤로 보낸다.
    { name: '두산에너빌리티', country: 'KR', state_led: false, ticker: '034020', tech_level: 3, gap_years: null, leader_name: null, share_pct: null, note: '주기기 공급망.' },
    { name: 'GE히타치', country: 'US', state_led: false, ticker: null, tech_level: 3, gap_years: 4, leader_name: 'CNNC', share_pct: null, note: 'BWRX-300 캐나다 착공.' },
  ],
  challenges: [],
  related: { prerequisites: [], derivatives: [], complements: [], competitors: [] },
  market: {
    history: [{ year: 2025, size: { value: 6.2, currency: 'USD', unit: 'bn' } }],
    forecast: [{ year: 2035, size: { value: 14.4, currency: 'USD', unit: 'bn' } }],
    cagr_pct: null, share_basis: null, as_of: '2026-08-04',
  },
  sources: [{ title: 'IAEA', url: null }],
}

// ── task#281(2/2) 신규 필드 픽스처 ─────────────────────────────────────────
const KEY_POINTS = [
  {
    title: '2026~28년 현금은 주기기 공급망에서 난다',
    body: '노형 경쟁의 승자보다 주기기 납품이 먼저 매출로 바뀐다.',
    metrics: [
      { label: '착공', value: '2건', change_pct: null },          // 무표기
      { label: '평균 공기', value: '54개월', change_pct: -12.5 },  // 하락색
      { label: '수주잔고', value: '1.1조원', change_pct: 22.0 },   // 상승색
      { label: '가동 호기', value: '3기', change_pct: 0 },         // 0도 유효값(무표기 아님)
    ],
  },
  { title: '1호는 중국 링룽', body: '세계 최초 상업 SMR이다.', metrics: null },
]
const MILESTONES = [
  { year: 2023, actor: 'CNNC', event: 'HTR-PM 상업운전', status: 'done' },
  { year: 2026, actor: null, event: '링룽1호 계통연결', status: 'in_progress' },
  { year: 2029, actor: 'GE히타치', event: 'BWRX-300 가동', status: 'planned' },
]
const FULL_REPORT = {
  ...SMR_REPORT,
  key_points: KEY_POINTS,
  milestones: MILESTONES,
}

function mockReport(rep) {
  api.get.mockImplementation((url) =>
    url.startsWith('/api/tech-reports/')
      ? Promise.resolve({ data: { slug: rep.slug, reports: [rep] } })
      : Promise.resolve({ data: [] }))
}

const titlesOf = (container) => [...container.querySelectorAll('.rpt-title__text')].map((e) => e.textContent)

function renderAt(slug) {
  return render(
    <MemoryRouter initialEntries={[`/tech-report/${slug}`]}>
      <Routes>
        <Route path="/tech-report/:slug" element={<TechReport />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => vi.clearAllMocks())

describe('주요기술 리포트 상세 (task#276 S5)', () => {
  it('전 섹션 렌더 — 헤더·업체 표·난제·시장 규모·출처', async () => {
    api.get.mockImplementation((url) =>
      url === '/api/tech-reports/reusable-rocket'
        ? Promise.resolve({ data: { slug: 'reusable-rocket', reports: [REPORT] } })
        : Promise.resolve({ data: [] }))
    renderAt('reusable-rocket')
    // task#280 S1 — h1이 제목(141자)에서 기술명으로 격하되고, 제목은 그 아래 리드 문단이 됐다.
    // 옛 단언 `getByText(title)`/`getByText('재사용 로켓')`은 두 요소를 구별하지 않아 이 교체를
    // 통과시킨다(판정축이 대상과 독립 — 가토 ⑧ⓘ). 역할까지 못박는다.
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('재사용 로켓')
    // 리드는 제목과 **문자 그대로** 일치해야 한다 — 잘림·생략 0이 S1의 완료기준이다.
    expect(screen.getByTestId('tech-report-lead').textContent).toBe(REPORT.title)

    // 난이도는 Badge(`난이도 4/5`)에서 KPI 스트립 칩(label `기술난이도` + value `4/5`)으로
    // 흡수됐다 — 같은 값을 두 곳에 두지 않는다(중복 표시 금지).
    const kpis = within(screen.getByTestId('tech-report-kpis'))
    expect(kpis.getByText('기술난이도')).toBeTruthy()
    expect(kpis.getByText('4/5')).toBeTruthy()
    expect(screen.queryByText('난이도 4/5')).toBeNull()

    // 산문(description·rationale)은 첫 화면이 아니라 하단 「상세 설명」으로 이동했다 —
    // 텍스트 자체는 손실 0으로 남아 있어야 한다(접힘은 DOM에서 지우지 않는다).
    const prose = within(screen.getByTestId('tech-report-prose'))
    expect(prose.getByText('1단 재사용이 발사비를 낮추는 구조를 설명한다.')).toBeTruthy()
    expect(prose.getByText('극저온 추진제 재점화가 어렵다.')).toBeTruthy()

    // 업체 표 — 기술수준은 ADR-0041로 표 셀 안 5칸 밴드가 됐다(구 밴드 섹션 흡수, 별도 섹션 아님).
    // task#277 S5가 점유율 차트를 배선해 업체명·"현재 선두"가 페이지에 다시 등장한다(정당한 중복 —
    // 비교 섹션이라 같은 이름을 또 보여줘야 한다). 이 축(표를 특정)을 결정한 문서는 없다(부수적
    // 단언) — within(tech-report-players)로 표 자체를 스코프한다.
    const playersTable = within(screen.getByTestId('tech-report-players'))
    expect(playersTable.getByText('SpaceX')).toBeTruthy()
    // ADR-0041 — 기술수준은 텍스트가 아니라 5칸 밴드(role="img")다. 값은 aria-label로 노출된다.
    expect(playersTable.getByRole('img', { name: '5단계 · 양산상용' })).toBeTruthy()
    expect(playersTable.getByText('현재 선두')).toBeTruthy()   // gap_years === 0
    expect(playersTable.getByText('CASC')).toBeTruthy()
    expect(playersTable.getByRole('img', { name: '3단계 · 실증' })).toBeTruthy()
    // 적대 리뷰 F3 — 「선두 대비」 셀은 이제 격차만 담고 leader_name은 표 위 캡션으로 올라갔다.
    // 매 행 반복되던 `선두 대비 5년 · {leader_name}` nowrap 문자열이 이 열을 302px까지 부풀려
    // PC 1440(콘텐츠 748px)에서 표가 891px로 넘쳤다(점유율·티커 열이 초기 화면 밖).
    expect(playersTable.getByText('5년')).toBeTruthy()
    expect(screen.getByTestId('tech-report-players-leader').textContent).toBe('선두 = SpaceX')
    expect(playersTable.getByText('정부주도')).toBeTruthy()     // CASC만 state_led
    expect(screen.getByText('점유율 기준: 발사 횟수 기준')).toBeTruthy()

    expect(screen.getByText('재점화 신뢰성')).toBeTruthy()
    expect(screen.getByText('다회 재점화 엔진 내구성.')).toBeTruthy()

    // task#282 S3 — 요약 카드를 제거했다(formatMarketSummary가 history/forecast에서 파생돼 차트와
    // 항상 함께 있거나 함께 없는 구조적 100% 중복). MarketGrowthChart 캡션이 요약+기준을 흡수한다.
    // #264 판별 절차: 이 단언의 근거는 task#276 S6 스냅샷용 값 확인이지 기록된 결정이 아니다 —
    // 부수적 단언이라 뒤집는다.
    expect(screen.getByTestId('market-growth-caption').textContent).toBe('$12.5B (2024) → $30.5B (2030), CAGR 12.3% · 기준 2026-08-03')
    expect(screen.getByText('NASA')).toBeTruthy()
  })

  it('발행물 없음 — 빈 상태(에러와 구별)', async () => {
    api.get.mockResolvedValue({ data: { slug: 'robotics', reports: [] } })
    renderAt('robotics')
    expect(await screen.findByText(/아직 발행된 리포트가 없습니다/)).toBeTruthy()
  })

  it('조회 실패(404가 아닌 오류) — 에러 문구', async () => {
    api.get.mockRejectedValue({ response: { status: 500 } })
    renderAt('robotics')
    await waitFor(() => expect(screen.getByText('리포트를 불러오지 못했습니다.')).toBeTruthy())
  })

  it('미등록 slug(422) — 전용 에러 문구', async () => {
    api.get.mockRejectedValue({ response: { status: 422 } })
    renderAt('nonsense')
    await waitFor(() => expect(screen.getByText('존재하지 않는 기술입니다.')).toBeTruthy())
  })

  it('ticker 보유 종목이면 보유 배지 노출', async () => {
    const withTicker = { ...REPORT, players: [{ ...REPORT.players[0], ticker: 'RKLB' }] }
    api.get.mockImplementation((url) =>
      url === '/api/tech-reports/reusable-rocket'
        ? Promise.resolve({ data: { reports: [withTicker] } })
        : Promise.resolve({ data: [{ ticker: 'RKLB', name: 'Rocket Lab', type: 'holding', market: 'US' }] }))
    renderAt('reusable-rocket')
    // task#277 S5: 점유율 차트도 SpaceX를 표시하므로 표 스코프로 특정한다.
    await within(await screen.findByTestId('tech-report-players')).findByText('SpaceX')
    expect(await screen.findByText('보유')).toBeTruthy()
  })

  it('gap_years 음수는 표시하지 않는다 — 표와 밴드가 같은 규율을 쓴다', async () => {
    // backend Player.gap_years에 ge=0 제약이 없어 음수가 발행될 수 있고, 그러면 `선두 대비 -2년`이라는
    // 무의미한 문구가 렌더됐다(적대적 리뷰 렌즈1). 구 밴드 섹션은 고쳐졌는데 이 표는 안 고쳐져
    // **같은 필드가 같은 페이지에서 두 거동**을 갖고 있었다 — 한쪽 테스트가 다른 쪽을 보호하지 않는다.
    const negative = { ...REPORT, players: [{ ...REPORT.players[1], gap_years: -2 }] }
    api.get.mockImplementation((url) =>
      url === '/api/tech-reports/reusable-rocket'
        ? Promise.resolve({ data: { reports: [negative] } })
        : Promise.resolve({ data: [] }))
    renderAt('reusable-rocket')
    const table = within(await screen.findByTestId('tech-report-players'))
    expect(await table.findByText('CASC')).toBeTruthy()
    expect(table.queryByText(/-2년/)).toBeNull()
    // task#280 S3 — 카드형에선 `선두 대비`가 값에만 등장해 전역 부재를 단언할 수 있었으나,
    // 표에서는 그 문자열이 **열 머리글**이라 항상 존재한다(정상). 단언을 값 셀로 좁힌다.
    // ⚠️ task#296 S3(playerColumns)가 열 집합을 가변으로 바꿨다 — 이 픽스처(단일 업체·share_pct
    // null)는 점유율 열이 빠져 열이 [업체,기술수준,선두 대비] 3개뿐이다. 고정 인덱스(옛 3번째)는
    // 그 전제가 깨진 낡은 축이라(가토 ⑧ⓝ) 헤더 텍스트로 열을 찾아 흔들리지 않게 한다.
    const playersTable = screen.getByTestId('tech-report-players')
    const gapColIdx = [...playersTable.querySelectorAll('th')].map((th) => th.textContent).indexOf('선두 대비')
    const row = within(playersTable).getByTestId('tech-report-player-row')
    expect(row.cells[gapColIdx].textContent).toBe('—')
  })

  it('섹션 순서 — 지표·표가 산문보다 먼저 온다 (task#319 재배열 후)', async () => {
    // 이 재구성의 목적 자체를 못박는다. 개별 섹션의 존재 단언은 순서가 뒤집혀도 전부 통과하므로
    // (판정축이 대상과 독립 — 가토 ⑧ⓘ) DOM 순서를 별도 축으로 세운다.
    // ⚠️ **task#319가 이 배열을 갱신했다.** 옛 값은 task#280의 순서였는데, 그 순서는 「삽입 지점
    //    외에는 바꾸지 않는다」(수술적 변경)로만 정당화된 **상속물**이고 *이 순서가 옳다*고 논증된
    //    적이 없다(task#264 판별 절차: 계획서의 완료기준·비목표에 이름으로 등장하지 않는 부수 단언).
    //    task#319는 이것을 독자 질문 순서로 재배열했다 — 전체 파이(시장 규모)가 분할(점유율) 앞.
    //    **뒤집지 않은 것**: 「지표·표가 산문보다 먼저」라는 이 테스트의 *취지*는 그대로다
    //    (상세 설명은 여전히 본문 끝, 출처 앞 — task#280 S4·#296의 기록된 결정).
    api.get.mockImplementation((url) =>
      url === '/api/tech-reports/reusable-rocket'
        ? Promise.resolve({ data: { reports: [REPORT] } })
        : Promise.resolve({ data: [] }))
    const { container } = renderAt('reusable-rocket')
    await screen.findByTestId('tech-report-kpis')

    // related가 전 분류 0건인 픽스처라 「연관 기술」은 생략된다(조용한 생략이 정상 동작).
    expect([...container.querySelectorAll('.rpt-title__text')].map((e) => e.textContent))
      .toEqual(['시장 규모', '주요 업체', '점유율', '해결해야 할 난제', '상세 설명', '출처'])

    const anchors = ['tech-report-lead', 'tech-report-kpis', 'tech-report-players', 'tech-report-prose', 'tech-report-sources']
      .map((t) => screen.getByTestId(t))
    anchors.slice(1).forEach((node, i) => {
      // 4 = Node.DOCUMENT_POSITION_FOLLOWING (앞 앵커 기준 뒤에 온다)
      expect(anchors[i].compareDocumentPosition(node) & 4).toBeTruthy()
    })
  })

  // F1 재지정(ADR-0041 결정 1·S1 지시) — 「기술수준 비교」 밴드가 표 셀로 흡수되며 표↔밴드 쌍은
  // 이제 같은 <tr>이라 원리적으로 성립한다(더 이상 검증 대상이 아니다, ADR-0041 결과절). 그 계약
  // ("같은 업체 집합이 한 화면에서 서로 다른 걸로 나열되지 않는다")이 여전히 남는 쌍은 표↔점유율
  // (ShareChart, ADR-0041 결정 2가 범위 밖으로 남긴 섹션)이다.
  // ⚠️ 이 쌍엔 "순서" 동치를 그대로 옮길 수 없다 — ShareChart는 랭킹 시각화라 share_pct 내림차순으로
  // *스스로* 재정렬한다(정당한 설계, task#277 S2). 표는 sortPlayers(기술수준 내림차순) 순서다. 그래서
  // 재지정한 계약은 "순서"가 아니라 **"분류 소속"**이다 — 표와 점유율 차트가 각자 groupByCategory를
  // 독립 호출하므로, 같은 업체가 표에서는 분류 A인데 점유율 차트에서는 분류 B로 갈리는 자기모순이
  // 없는가를 확인한다(현재 둘 다 같은 `category` 필드를 그대로 읽으므로 회귀 방지 락에 가깝다).
  const CATEGORIZED_WITH_SHARE_REPORT = {
    ...SMR_REPORT,
    players: [
      { ...SMR_REPORT.players[0], name: 'CNNC', tech_level: 5, gap_years: 0, category: '경수형', share_pct: 31 },
      { ...SMR_REPORT.players[1], name: '중국핵공업 HTR', tech_level: 4, gap_years: 1, category: '고온가스로', share_pct: 5 },
      { ...SMR_REPORT.players[2], name: 'NuScale', tech_level: 3, gap_years: 3, category: '경수형', share_pct: 22.5 },
    ],
  }

  // 표: tbody 행을 순서대로 훑어 group 행을 만나면 "현재 분류"를 갱신하고 player 행을 그 분류에
  // 배정한다. 카테고리 텍스트에 ADR-0041 축6의 선두 병기(" · 선두 X")가 섞여 있을 수 있어 잘라낸다.
  function tableCategoryMap(playersTableEl) {
    const map = {}
    let current = null
    for (const tr of playersTableEl.querySelectorAll('tbody > tr')) {
      const testid = tr.getAttribute('data-testid')
      if (testid === 'tech-report-player-group') { current = tr.textContent.split(' · 선두 ')[0]; continue }
      if (testid === 'tech-report-player-row') {
        map[tr.querySelector('[data-testid="tech-report-player-name"]').textContent] = current
      }
    }
    return map
  }

  // 점유율 차트: 그룹 div의 첫 자식이 분류 라벨(Σ 초과 경고가 붙으면 뒤에 이어지므로 잘라낸다).
  function shareCategoryMap(container) {
    const map = {}
    for (const g of container.querySelectorAll('[data-testid="tech-share-chart-group"]')) {
      const category = g.children[0].textContent.split(' · 합계')[0]
      for (const row of g.querySelectorAll('[data-testid="tech-share-chart-row"] span[title]')) {
        map[row.textContent] = category
      }
    }
    return map
  }

  it('F1 재지정 — 표와 점유율 차트가 같은 업체를 서로 다른 분류로 나열하지 않는다', async () => {
    // 이빨 — 픽스처가 실제로 2개 분류 × 점유율 유효값을 가져야 판별력이 있다(공허한 초록 방지).
    expect(groupByCategory(CATEGORIZED_WITH_SHARE_REPORT.players).length).toBe(2)
    api.get.mockImplementation((url) =>
      url.startsWith('/api/tech-reports/')
        ? Promise.resolve({ data: { slug: CATEGORIZED_WITH_SHARE_REPORT.slug, reports: [CATEGORIZED_WITH_SHARE_REPORT] } })
        : Promise.resolve({ data: [] }))
    const { container } = renderAt(CATEGORIZED_WITH_SHARE_REPORT.slug)
    await screen.findByTestId('tech-report-players')
    await screen.findByTestId('tech-share-chart')

    const tableMap = tableCategoryMap(screen.getByTestId('tech-report-players'))
    const shareMap = shareCategoryMap(container)

    const shareNames = Object.keys(shareMap)
    expect(shareNames.length).toBeGreaterThan(0)   // 이빨 — 표본이 있어야 아래 단언이 뭔가를 본다
    shareNames.forEach((name) => expect(shareMap[name]).toBe(tableMap[name]))
  })
})

// ── task#281 (2/2) — 예약 자리에 신규 섹션 배선 ─────────────────────────────
// (계보 분류는 task#301 S3에서 제거됐다 — groupByCategory 자체는 techReportUtils.js로 옮겨
// 존속하지만 이 페이지는 더 이상 소비하지 않는다. 계약 테스트는 techReportUtils.test.js로 이동.)
// 두 섹션 모두 **선택 필드 의존**이라 라이브 발행물 2건(smr·reusable-rocket)에는 데이터가 없다.
// 그러므로 "있으면 렌더"보다 "없으면 화면이 이전과 완전히 동일"이 더 중요한 완료기준이다.
describe('주요기술 리포트 상세 — 핵심 포인트·진척 타임라인 (task#281)', () => {
  it('두 필드가 다 있는 판 — 두 섹션이 확정 순서대로 렌더', async () => {
    mockReport(FULL_REPORT)
    const { container } = renderAt('smr')
    await screen.findByTestId('tech-report-kpis')

    // 개별 존재 단언은 순서가 뒤집혀도 전부 통과한다(판정축이 대상과 독립 — 가토 ⑧ⓘ).
    // SMR 형태라 점유율(share_pct 전무)·난제(빈)·연관 기술(빈)은 정상 생략된다.
    // ⚠️ task#319 재배열 — 진척 타임라인이 장 3으로 내려가 **주요 업체 뒤**에 온다(옛 배열은 ②였다).
    //    두 섹션의 *인접*은 task#281의 요구사항이 아니었다(그 계획은 두 섹션의 존재와 내용만 못박았다).
    expect(titlesOf(container)).toEqual(
      ['핵심 포인트', '시장 규모', '주요 업체', '진척 타임라인', '상세 설명', '출처'])

    const anchors = ['tech-report-kpis', 'tech-key-points', 'tech-report-players', 'milestone-timeline']
      .map((t) => screen.getByTestId(t))
    // 4 = Node.DOCUMENT_POSITION_FOLLOWING
    anchors.slice(1).forEach((node, i) => expect(anchors[i].compareDocumentPosition(node) & 4).toBeTruthy())

    // 껍데기만 렌더되고 내용이 비는 경우를 막는다 — 두 섹션의 대표 값 1개씩.
    expect(within(screen.getByTestId('tech-key-points')).getByText('1.1조원')).toBeTruthy()
    expect(screen.getByTestId('milestone-timeline').querySelectorAll('[data-testid="milestone-item"]').length).toBe(MILESTONES.length)
  })

  // 라이브 두 판은 신규 키가 **아예 없고**(구 JSONB 박제), 신규 컬럼은 SQL NULL이라 `null`로 온다.
  // 배열 자리의 null에 .map/.length를 부르면 섹션이 아니라 페이지가 통째로 터지므로 두 형태를 함께 잰다.
  it.each([
    // 기대 배열은 task#319 재배열을 반영한다(시장 규모가 주요 업체 앞).
    ['reusable-rocket 실판(키 부재)', REPORT,
      ['시장 규모', '주요 업체', '점유율', '해결해야 할 난제', '상세 설명', '출처']],
    ['smr 실판(키 부재)', SMR_REPORT,
      ['시장 규모', '주요 업체', '상세 설명', '출처']],
    ['smr 실판(신규 키가 명시적 null)',
      { ...SMR_REPORT, key_points: null, milestones: null },
      ['시장 규모', '주요 업체', '상세 설명', '출처']],
  ])('구발행물 graceful — 두 섹션 부재 + 기존 섹션 무변화: %s', async (_label, rep, expected) => {
    mockReport(rep)
    const { container } = renderAt(rep.slug)
    await screen.findByTestId('tech-report-kpis')

    expect(screen.queryByTestId('tech-key-points')).toBeNull()
    expect(screen.queryByTestId('milestone-timeline')).toBeNull()
    // 제목까지 함께 사라져야 한다 — 본문 없이 제목만 남는 유령 섹션 금지.
    expect(titlesOf(container)).toEqual(expected)
  })

  it.each([
    ['key_points만', { key_points: KEY_POINTS }, 'tech-key-points'],
    ['milestones만', { milestones: MILESTONES }, 'milestone-timeline'],
  ])('일부 필드만 있는 판 — 그것만 렌더: %s', async (_label, patch, present) => {
    mockReport({ ...SMR_REPORT, ...patch })
    renderAt('smr')
    await screen.findByTestId('tech-report-kpis')
    expect(screen.getByTestId(present)).toBeTruthy()
    ;['tech-key-points', 'milestone-timeline']
      .filter((t) => t !== present)
      .forEach((t) => expect(screen.queryByTestId(t)).toBeNull())
  })

  // 제목을 페이지가 소유하는 섹션의 게이트는 **컴포넌트 자신의 채택 조건과 같은 식**이어야 한다.
  // 느슨한 게이트(milestones.length > 0)를 쓰면 아래 입력에서 제목만 남고 본문이 사라진다
  // (점유율 섹션이 task#277 S2에서 겪은 함정).
  it('본문이 채택하지 않는 값 → 제목까지 생략: year·event가 결측인 마일스톤만', async () => {
    mockReport({ ...SMR_REPORT, milestones: [{ year: null, event: '', status: 'done' }] })
    const { container } = renderAt('smr')
    await screen.findByTestId('tech-report-kpis')
    expect(screen.queryByTestId('milestone-timeline')).toBeNull()
    expect(titlesOf(container)).not.toContain('진척 타임라인')
  })
})

// ── task#296 S4 — 전역 목차 (SECTIONS 단일 소스에서 파생) ───────────────────────
// `[data-tech-section]`은 **상위 섹션 전용**이라 필터가 필요 없다 — 산문 소제목은 `data-tech-anchor`를
// 쓴다(처음엔 두 곳이 같은 속성을 재사용해 소비처마다 11-id 리터럴로 걸러야 했고, 그 목록이 이 파일·
// 페이지·프로브 3곳에 바이트 동일로 복제됐다. 섹션을 늘릴 때 한 곳만 고치는 재발 경로라 속성을 갈랐다).
describe('주요기술 리포트 상세 — 전역 목차 (task#296 S4)', () => {
  // 구발행물(REPORT)·전 필드(FULL_REPORT) 쌍 — 완료기준 "섹션이 조건부로 사라지면 칩도 사라진다"를
  // 두 형태로 함께 잰다. 라벨·순서는 기존 titlesOf 단언(줄 229-230·279-280)과 바이트 동일해야 한다
  // (목차와 본문 SectionTitle이 같은 SECTIONS 배열에서 파생하므로 어긋나면 둘 중 하나가 잘못됐다는 뜻).
  it.each([
    ['구발행물(REPORT) — 7섹션', REPORT, 'reusable-rocket',
      ['시장 규모', '주요 업체', '점유율', '해결해야 할 난제', '상세 설명', '출처']],
    ['전 필드(FULL_REPORT) — 7섹션', FULL_REPORT, 'smr',
      ['핵심 포인트', '시장 규모', '주요 업체', '진척 타임라인', '상세 설명', '출처']],
  ])('목차 칩 수 == 렌더된 섹션 수, 라벨·순서 일치: %s', async (_label, rep, slug, expectedLabels) => {
    mockReport(rep)
    const { container } = renderAt(slug)
    await screen.findByTestId('tech-report-toc')

    const chipEls = screen.getAllByTestId('tech-toc-chip')
    const chips = chipEls.map((a) => a.textContent)
    const sections = [...container.querySelectorAll('[data-tech-section]')]
    expect(chips).toEqual(expectedLabels)
    expect(chips.length).toBe(sections.length)

    // ⚠️ 개수·라벨만 단언하면 **재정렬을 원리적으로 못 잡는다**(적대 리뷰 렌즈2 F2, MED): SECTIONS가
    // 라벨·id·show를 주지만 JSX는 각 섹션을 손으로 배치하므로 두 순서의 일치는 구조가 아니라 손이
    // 지킨다. 한쪽만 재정렬하면 칩 순서와 시각 순서가 갈려 이 태스크의 목적(일관된 항해)이 조용히
    // 깨지는데, `chips === expectedLabels`(SECTIONS 파생)와 개수 단언은 둘 다 그대로 통과한다.
    // 그래서 리터럴이 아니라 **두 순서를 서로** 대조한다.
    expect(chipEls.map((a) => a.getAttribute('href').slice(1)))
      .toEqual(sections.map((el) => el.getAttribute('data-tech-section')))
  })

  it('칩 href는 문서 내 유일 요소로 해석된다 — id 중복 0', async () => {
    mockReport(FULL_REPORT)
    const { container } = renderAt('smr')
    const chips = await screen.findAllByTestId('tech-toc-chip')

    const ids = [...container.querySelectorAll('[data-tech-section]')].map((el) => el.id)
    expect(new Set(ids).size).toBe(ids.length)   // id 중복 0
    chips.forEach((a) => {
      const id = a.getAttribute('href').slice(1)
      expect(container.querySelectorAll(`#${id}`).length).toBe(1)
    })
  })

  it('섹션이 1개뿐이면(핵심 포인트·업체·산문 등 전부 결측, 시장 규모만 상시 렌더) 목차를 렌더하지 않는다', async () => {
    const minimal = {
      slug: 'robotics', published_date: '2026-08-05', title: null,
      description: null, difficulty: {}, players: [], challenges: [],
      related: { prerequisites: [], derivatives: [], complements: [], competitors: [] },
      market: { history: [], forecast: [], cagr_pct: null, share_basis: null, as_of: null },
      sources: [],
    }
    mockReport(minimal)
    renderAt('robotics')
    await screen.findByTestId('market-growth-chart')   // 유일한 상시 섹션이 렌더됐음을 먼저 확인
    expect(screen.queryByTestId('tech-report-toc')).toBeNull()
  })

  it('핵심 포인트 섹션에 목차 앵커가 정확히 배선된다 — id/data-tech-section == key-points', async () => {
    mockReport(FULL_REPORT)
    renderAt('smr')
    const kp = await screen.findByTestId('tech-key-points')
    expect(kp.id).toBe('key-points')
    expect(kp.getAttribute('data-tech-section')).toBe('key-points')
  })

  it('구발행물(key_points 없음)에는 그 칩도 유령 앵커도 없다', async () => {
    mockReport(REPORT)
    renderAt('reusable-rocket')
    await screen.findByTestId('tech-report-toc')
    expect(screen.queryByTestId('tech-key-points')).toBeNull()
    expect(screen.getAllByTestId('tech-toc-chip').map((a) => a.textContent)).not.toContain('핵심 포인트')
  })
})

// ── task#316 — 상호작용 칩(목차·출처 링크)의 탭 타깃 선언 핀 ────────────────────────────
// 이 태스크를 만든 회귀는 「padding만 키우고 lineHeight를 빠뜨려 약속한 34px이 조용히 미달」이었다
// (task#309). 그 회귀는 **어느 자동 게이트에도 안 걸렸다** — jsdom은 레이아웃이 없어 높이를 못 재고,
// 라이브 프로브에는 칩 높이 축이 없었고, 빌드는 인라인 스타일을 모른다. 그래서 여기서 재는 것은
// 높이가 아니라 **선언값**이고, 실제 34px은 라이브 프로브가 닫는다(frontend/CLAUDE.md 처방:
// 「vitest는 선언값을 못박고 실폭은 라이브 프로브가 잰다」).
// ⚠️ 부모의 `display: flex`도 함께 못박는다 — 34px 성립의 **전제**다. 부모가 block이 되면 칩이
// 순수 인라인이 되어 세로 padding이 줄 상자에 반영되지 않고(높이 미달) `clientWidth`가 0이 되어
// 프로브의 넘침 축까지 무의미해진다(task#309 짝). 그 리팩터는 여기서만 red가 된다.
describe('주요기술 리포트 상세 — 상호작용 칩 탭 타깃 (task#316)', () => {
  const WITH_SOURCE_URL = {
    ...FULL_REPORT,
    // 라이브 발행 7종의 출처 214개는 **전부 URL을 갖는다**(무URL 칩은 dormant) — 픽스처에
    // 링크 칩이 없으면 이 핀이 원리적으로 대상을 못 만나므로 URL 있는 출처를 넣는다.
    sources: [{ title: 'IAEA', url: 'https://www.iaea.org/' }, { title: '무URL', url: null }],
  }

  it('목차 칩·출처 링크 칩 — padding 7px 12px + lineHeight 18px, 부모는 flex', async () => {
    mockReport(WITH_SOURCE_URL)
    renderAt('smr')
    const chips = await screen.findAllByTestId('tech-toc-chip')
    chips.forEach((a) => {
      expect(a.style.padding).toBe('7px 12px')
      expect(a.style.lineHeight).toBe('18px')
    })
    expect(screen.getByTestId('tech-report-toc').style.display).toBe('flex')

    const sourceBox = screen.getByTestId('tech-report-sources')
    expect(sourceBox.style.display).toBe('flex')
    const links = [...sourceBox.querySelectorAll('a[href]')]
    expect(links.length).toBe(1)                       // 커버리지 sentinel — 0이면 이 핀은 공허하다
    expect(links[0].style.padding).toBe('7px 12px')
    expect(links[0].style.lineHeight).toBe('18px')
    // 무URL 칩은 상호작용 요소가 아니라 대상이 아니다(계획 비목표) — 그래서 옛 값 그대로임을
    // 못박아 「형제라서 같이 키웠다」는 표류를 막는다.
    const plain = [...sourceBox.querySelectorAll('span')].find((s) => s.textContent === '무URL')
    expect(plain.style.padding).toBe('4px 10px')
  })
})

// ── task#298 S4(2/2) — 「계열 비교」(점유율 바로 앞) + 「확인할 지표」(난제 바로 뒤) 배선.
// ⚠️ 두 섹션은 **같은 SECTIONS 배열**에서 목차 칩과 함께 파생된다 — 배열과 JSX를 한쪽만 고치면
// 위 task#296 순서 단언(칩 href 순서 == DOM data-tech-section 순서)이 잡는다.
const VARIANTS = [
  {
    axis_label: '재사용 방식',
    options: [
      { name: '수직 착륙 회수', examples: ['Falcon 9'], strength: '정비 후 재사용 왕복 단축', tradeoff: '착륙 추진제 예비량 필요' },
      { name: '낙하산 회수', examples: null, strength: '착륙 연료가 필요 없다', tradeoff: null },
    ],
  },
]
// FULL_REPORT(7섹션, task#281)에 variants만 추가 — key_points·milestones는 그대로
// 두어 7섹션 기준선을 재사용하고 「계열 비교」 삽입 효과만 격리한다.
const FULL_WITH_VARIANTS = { ...FULL_REPORT, variants: VARIANTS }
const WATCH_ITEMS = [
  { label: '링룽 1호의 계통연결이 IAEA에 등재되는가', detail: '등재 시각이 상업운전 기준점이다.',
    not_signal: '파일럿 라인 준공·샘플 공개는 일정 유지 신호일 뿐이다.' },
  { label: '회전율 — 같은 기체를 몇 번 돌리는가', detail: null, not_signal: null },
]
const FULL_WITH_BOTH = { ...FULL_REPORT, variants: VARIANTS, watch_items: WATCH_ITEMS }

describe('주요기술 리포트 상세 — 계열 비교 (task#298 S4)', () => {
  // ⚠️ task#319가 이 섹션을 ④→②(장 1 개요)로 옮겼다. task#298이 「점유율 바로 앞」에 둔 근거는
  //    「계보 분류 바로 앞」이었는데 **그 계보 분류가 ADR-0041로 업체 표에 흡수돼 더 이상 별도 섹션이
  //    아니다** — 근거가 낡았다(task#319가 명시적으로 뒤집은 1건). 여전히 참인 것은 「계열 비교가
  //    시장 규모보다 앞」이며 아래 DOM 단언이 그것을 계속 지킨다.
  it('계열 비교는 시장 규모보다 앞 — 형제 제목과의 DOM 순서 + 확정 순서 배열', async () => {
    mockReport(FULL_WITH_VARIANTS)
    const { container } = renderAt('smr')
    await screen.findByTestId('tech-report-kpis')

    expect(titlesOf(container)).toEqual(
      ['핵심 포인트', '계열 비교', '시장 규모', '주요 업체', '진척 타임라인', '상세 설명', '출처'])

    const variantsNode = screen.getByTestId('tech-report-variants')
    const marketNode = container.querySelector('[data-tech-section="market"]')
    // 4 = Node.DOCUMENT_POSITION_FOLLOWING — variants가 market보다 앞
    expect(variantsNode.compareDocumentPosition(marketNode) & 4).toBeTruthy()
  })

  it('variants가 null/undefined(구발행물)면 섹션·제목·목차 칩이 전부 부재 — 기존 7섹션 목록 무변화', async () => {
    mockReport({ ...FULL_REPORT, variants: null })
    const { container } = renderAt('smr')
    await screen.findByTestId('tech-report-kpis')
    expect(screen.queryByTestId('tech-report-variants')).toBeNull()
    expect(titlesOf(container)).not.toContain('계열 비교')
    expect(titlesOf(container)).toEqual(
      ['핵심 포인트', '시장 규모', '주요 업체', '진척 타임라인', '상세 설명', '출처'])
    expect(screen.getAllByTestId('tech-toc-chip').map((a) => a.textContent)).not.toContain('계열 비교')
  })

  // ⚠️ task#319 재배열 — 시장 규모가 장 2로 올라가 이제 **확인할 지표보다 앞**이다(옛 배열에선 뒤).
  //    task#298의 두 요구 중 **「난제 바로 뒤」는 기록된 결정으로 그대로 지킨다**(task#298: "안 풀린
  //    관문 → 지켜볼 신호"가 논리 순서 — task#319 비목표 4에 이름으로 등장한다). 뒤집힌 것은
  //    「시장 규모 앞」쪽이며, 그건 시장 규모의 *위치* 이동에서 파생된 결과다.
  it('확인할 지표 — 난제 바로 뒤(인접 유지) · 시장 규모는 이제 그보다 앞(전체 체인 순서)', async () => {
    mockReport({ ...FULL_WITH_BOTH, challenges: [{ title: '난제 A', body: 'b' }] })
    const { container } = renderAt('smr')
    await screen.findByTestId('tech-report-kpis')

    // 확정 순서 — 난제 < 확인할 지표 인접이 이 배열 안에서 드러나고, 시장 규모는 장 2에 있다.
    expect(titlesOf(container)).toEqual(
      ['핵심 포인트', '계열 비교', '시장 규모', '주요 업체', '진척 타임라인',
       '해결해야 할 난제', '확인할 지표', '상세 설명', '출처'])

    // DOM 순서로도 못박는다(제목 배열은 텍스트라 래퍼 배치가 어긋나도 통과할 수 있다).
    const watch = screen.getByTestId('tech-report-watch-items')
    const market = container.querySelector('[data-tech-section="market"]')
    const challenges = container.querySelector('[data-tech-section="challenges"]')
    expect(challenges.compareDocumentPosition(watch) & 4).toBeTruthy()   // 난제 → 확인할 지표 (인접 유지)
    expect(market.compareDocumentPosition(watch) & 4).toBeTruthy()       // 시장 규모 → 확인할 지표 (재배열)
  })

  it('watch_items가 null(구발행물)이면 섹션·제목·칩 전부 부재', async () => {
    mockReport({ ...FULL_REPORT, watch_items: null })
    const { container } = renderAt('smr')
    await screen.findByTestId('tech-report-kpis')
    expect(screen.queryByTestId('tech-report-watch-items')).toBeNull()
    expect(titlesOf(container)).not.toContain('확인할 지표')
    expect(screen.getAllByTestId('tech-toc-chip').map((a) => a.textContent)).not.toContain('확인할 지표')
  })

  it('두 필드가 함께 있으면 목차 칩이 정확히 2개 늘어난다 — 칩과 섹션이 같은 배열에서 파생', async () => {
    mockReport(FULL_REPORT)
    const base = renderAt('smr')
    const baseScope = within(base.container)
    await baseScope.findByTestId('tech-report-toc')
    const baseCount = baseScope.getAllByTestId('tech-toc-chip').length
    base.unmount()

    mockReport(FULL_WITH_BOTH)
    const { container } = renderAt('smr')
    await screen.findByTestId('tech-report-toc')
    const chipEls = screen.getAllByTestId('tech-toc-chip')
    expect(chipEls.length).toBe(baseCount + 2)
    expect(chipEls.map((a) => a.textContent)).toContain('계열 비교')
    expect(chipEls.map((a) => a.textContent)).toContain('확인할 지표')
    // 칩 수 == 섹션 수, 그리고 순서까지 일치(task#296 단언을 두 섹션 추가 후에도 재확인)
    const sections = [...container.querySelectorAll('[data-tech-section]')]
    expect(chipEls.length).toBe(sections.length)
    expect(chipEls.map((a) => a.getAttribute('href').slice(1)))
      .toEqual(sections.map((el) => el.getAttribute('data-tech-section')))
  })

  it('목차 칩 수 — FULL_REPORT(7) 대비 variants 추가 판(8)에서 정확히 1개 늘어난다', async () => {
    mockReport(FULL_REPORT)
    const base = renderAt('smr')
    const baseScope = within(base.container)
    await baseScope.findByTestId('tech-report-toc')
    const baseCount = baseScope.getAllByTestId('tech-toc-chip').length
    base.unmount()

    mockReport(FULL_WITH_VARIANTS)
    renderAt('smr')
    await screen.findByTestId('tech-report-toc')
    const chips = screen.getAllByTestId('tech-toc-chip')
    expect(chips.length).toBe(baseCount + 1)
    expect(chips.map((a) => a.textContent)).toContain('계열 비교')
  })
})

// ── task#319 — 섹션 IA 재배열 + 4장 위계 ─────────────────────────────────────
// 확정된 새 배열(계획서 「확정된 새 배열」):
//   장 1 개요       ① 핵심 포인트 ② 계열 비교 ③ 연관 기술
//   장 2 시장·경쟁   ④ 시장 규모   ⑤ 주요 업체 ⑥ 점유율
//   장 3 진척·리스크 ⑦ 진척 타임라인 ⑧ 해결해야 할 난제 ⑨ 확인할 지표
//   장 4 근거       ⑩ 상세 설명   ⑪ 출처
const TARGET_SECTION_ORDER = ['key-points', 'variants', 'related', 'market', 'players', 'share',
  'milestones', 'challenges', 'watch-items', 'prose', 'sources']
const OLD_SECTION_ORDER = ['key-points', 'milestones', 'players', 'variants', 'share', 'challenges',
  'watch-items', 'market', 'related', 'prose', 'sources']

// 11섹션이 **전부** 표시되는 픽스처 — 기존 픽스처(REPORT 6섹션 · FULL_REPORT 6섹션)로는 재배열이
// 옮기는 4건(연관 ⑨→③ · 계열 ④→② · 시장 ⑧→④ · 타임라인 ②→⑦) 중 일부만 관측된다.
// ⚠️ 게이트는 각 컴포넌트의 채택 조건과 같은 식이므로 픽스처도 그 조건을 실제로 만족해야 한다
//    (variants는 axis_label + options 2개 이상, watch_items는 label 존재, share는 유한 share_pct).
const ALL_REPORT = {
  ...FULL_REPORT,
  players: [
    { ...SMR_REPORT.players[0], share_pct: 40.0 },
    { ...SMR_REPORT.players[1], share_pct: 25.0 },
    ...SMR_REPORT.players.slice(2),
  ],
  challenges: [{ title: '규제 인허가', body: '비경수형 운전허가 선례가 없다.' }],
  variants: [{
    axis_label: '냉각 방식',
    options: [
      { name: '경수형', examples: ['NuScale'], strength: '규제 선례', tradeoff: '출력밀도 낮음' },
      { name: '용융염형', examples: ['TerraPower'], strength: '고온 열공급', tradeoff: '소재 미검증' },
    ],
  }],
  watch_items: [{ label: '착공 건수', detail: '연간 신규 착공', not_signal: 'MOU 체결' }],
  related: { prerequisites: ['고순도 석영·특수소재'], derivatives: [], complements: [], competitors: [] },
}
// 장 3(진척 타임라인·난제·확인할 지표)이 통째로 결측인 판 — 「유령 라벨 0」을 재기 위한 대조 픽스처.
const NO_CHAPTER3_REPORT = {
  ...ALL_REPORT,
  milestones: [], challenges: [], watch_items: [],
}

const sectionIdsOf = (container) =>
  [...container.querySelectorAll('[data-tech-section]')].map((el) => el.getAttribute('data-tech-section'))

describe('주요기술 리포트 상세 — 섹션 IA 재배열 (task#319 S2)', () => {
  it('① 표시 섹션의 DOM 순서가 새 배열과 정확히 일치한다 (11섹션 전부 표시)', async () => {
    mockReport(ALL_REPORT)
    const { container } = renderAt('smr')
    await screen.findByTestId('tech-report-kpis')
    expect(sectionIdsOf(container)).toEqual(TARGET_SECTION_ORDER)
  })

  it('② 목차 칩 href 순서가 섹션 DOM 순서와 일치한다', async () => {
    mockReport(ALL_REPORT)
    const { container } = renderAt('smr')
    await screen.findByTestId('tech-report-toc')
    expect(screen.getAllByTestId('tech-toc-chip').map((a) => a.getAttribute('href').slice(1)))
      .toEqual(sectionIdsOf(container))
  })

  // ③ 이빨 — 이 픽스처에서 목표 순서와 옛 순서가 실제로 다름을 못박는다. 두 배열이 같은 픽스처였다면
  //    SECTIONS를 옛 순서로 되돌려도 위 ①이 통과한다(판정축이 대상과 독립 — 가토 ⑧ⓘ).
  //    **실측 확인(2026-08-20, 구현 전 red-first 실행)**: ①은 옛 순서를 받아 FAIL했다.
  //    ⚠️ 그런데 **②는 그때 통과했다** — 목차와 본문이 *둘 다* `SECTIONS`에서 파생하므로 옛 순서에서도
  //    서로 *일치*하기 때문이다. 즉 ②는 순서의 **값**을 재는 축이 아니라 목차↔본문의 **정합**을 재는
  //    축이고, 그래서 ①이 따로 필요하다(②만 있으면 배열을 어떻게 재배열해도 통과한다).
  //    이 구별을 적어 두지 않으면 다음 사람이 ②를 순서 게이트로 오인한다.
  it('③ 이빨 — 이 픽스처에서 새 배열과 옛 배열이 서로 다르다', () => {
    expect(TARGET_SECTION_ORDER).not.toEqual(OLD_SECTION_ORDER)
    expect(TARGET_SECTION_ORDER.slice().sort()).toEqual(OLD_SECTION_ORDER.slice().sort())
  })
})

describe('주요기술 리포트 상세 — 4장 위계 라벨 (task#319 S3)', () => {
  const chapterEls = (container) => [...container.querySelectorAll('[data-tech-chapter]')]
  // 라벨의 문서상 **다음** 섹션 = 그 장의 첫 표시 섹션이어야 한다(라벨이 장 앞에 온다는 계약).
  const followedBy = (container) => {
    const nodes = [...container.querySelectorAll('[data-tech-section],[data-tech-chapter]')]
    return nodes.filter((n) => n.hasAttribute('data-tech-chapter')).map((el) => {
      for (let i = nodes.indexOf(el) + 1; i < nodes.length; i++) {
        if (nodes[i].hasAttribute('data-tech-section')) return nodes[i].getAttribute('data-tech-section')
      }
      return null
    })
  }

  it('① 4장이 모두 표시되는 판 — 라벨 4개가 각 장 첫 섹션 직전에 온다', async () => {
    mockReport(ALL_REPORT)
    const { container } = renderAt('smr')
    await screen.findByTestId('tech-report-kpis')
    expect(chapterEls(container).map((e) => e.getAttribute('data-tech-chapter')))
      .toEqual(['overview', 'market-competition', 'progress-risk', 'evidence'])
    expect(chapterEls(container).map((e) => e.textContent))
      .toEqual(['개요', '시장·경쟁', '진척·리스크', '근거'])
    expect(followedBy(container)).toEqual(['key-points', 'market', 'milestones', 'prose'])
  })

  it('② 장 3의 세 섹션이 전부 결측이면 그 장 라벨이 렌더되지 않는다 — 유령 UI 금지', async () => {
    mockReport(NO_CHAPTER3_REPORT)
    const { container } = renderAt('smr')
    await screen.findByTestId('tech-report-kpis')
    expect(chapterEls(container).map((e) => e.getAttribute('data-tech-chapter')))
      .toEqual(['overview', 'market-competition', 'evidence'])
    expect(followedBy(container)).toEqual(['key-points', 'market', 'prose'])
    expect(sectionIdsOf(container)).not.toContain('milestones')
  })

  // ③ 이빨 — 유령 가드(첫 *표시* 섹션에만 라벨)를 「장의 첫 섹션 id에 무조건 라벨」로 느슨하게 바꾸면
  //    ②가 실패해야 한다. 실측 확인(2026-08-20): 가드를 제거해 chapterHeadAt을 show 무시로 만들면
  //    ②의 기대 3개가 4개('progress-risk' 추가)로 나와 FAIL한다.
  it('③ 장 라벨은 장 안에 표시 섹션이 하나라도 있을 때만 존재한다', async () => {
    mockReport(NO_CHAPTER3_REPORT)
    const { container } = renderAt('smr')
    await screen.findByTestId('tech-report-kpis')
    const keys = chapterEls(container).map((e) => e.getAttribute('data-tech-chapter'))
    expect(keys).not.toContain('progress-risk')
    expect(keys.length).toBe(3)
  })
})

// ── task#321 — 플로팅 항해 바 배선(페이지 레벨) ──────────────────────────────
// 바 자체의 계약(칩 수·순서·활성 전이·유령 가드)은 `components/tech/TechChapterNav.test.jsx`가
// 잰다. 여기서 재는 것은 **페이지가 그것을 옳게 배선했는가**다 — sentinel의 위치와 초기 상태.
describe('주요기술 리포트 상세 — 플로팅 항해 바 배선 (task#321 S3)', () => {
  it('목차 자체가 관찰 대상이고, 초기(목차 가시)에는 바가 없다', async () => {
    mockReport(ALL_REPORT)
    const { container } = renderAt('smr')
    const toc = await screen.findByTestId('tech-report-toc')
    // ⚠️ 계획은 「목차 직후 0높이 sentinel」을 지시했지만 라이브 실측이 그것을 반박했다 —
    //    sentinel은 목차 *끝*에 있어 모바일(목차 bottom 768 > vh 664)에서 스크롤 0에 이미 밖이고,
    //    그래서 목차가 부분 가시인 채 바가 함께 떴다. 목차 **자체**를 관찰하면 「완전히 밖」에서만
    //    뜬다. 그 교체가 실제로 됐는지(= sentinel이 남아 있지 않은지) 여기서 못박는다.
    expect(screen.queryByTestId('tech-toc-sentinel')).toBeNull()
    expect(toc).toBeTruthy()
    // IO 스텁이 콜백을 부르지 않으므로 초기 상태는 「목차 화면 안」 = 바 부재다
    expect(container.querySelector('[data-tech-chapter-nav]')).toBeNull()
  })

  it('바 게이트와 목차 게이트가 다른 식이어도 모순이 없다 — 장 1개면 목차가 있어도 바는 없다', async () => {
    // 장이 1개(근거)뿐이면 chapterNavItems가 []를 준다. 목차는 섹션 2개라 렌더되지만 바는 없어야 한다.
    mockReport({ ...SMR_REPORT, players: [], key_points: null, milestones: null })
    const { container } = renderAt('smr')
    await screen.findByTestId('tech-report-kpis')
    expect(container.querySelector('[data-tech-chapter-nav]')).toBeNull()
  })
})
