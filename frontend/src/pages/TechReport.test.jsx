import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import TechReport from './TechReport'
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

    // 업체 표 — 기술 성숙 단계는 텍스트로만(5칸 밴드는 별도 시각화)
    // task#277 S5가 TechLevelBand·ShareChart를 배선해 업체명·"현재 선두"가 페이지에 다시
    // 등장한다(정당한 중복 — 비교 섹션이라 같은 이름을 또 보여줘야 한다). 이 축(표를 특정)을
    // 결정한 문서는 없다(부수적 단언) — within(tech-report-players)로 표 자체를 스코프한다.
    const playersTable = within(screen.getByTestId('tech-report-players'))
    expect(playersTable.getByText('SpaceX')).toBeTruthy()
    expect(playersTable.getByText('5단계 · 양산상용')).toBeTruthy()
    expect(playersTable.getByText('현재 선두')).toBeTruthy()   // gap_years === 0
    expect(playersTable.getByText('CASC')).toBeTruthy()
    expect(playersTable.getByText('3단계 · 실증')).toBeTruthy()
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
    // task#277 S5: TechLevelBand·ShareChart도 SpaceX를 표시하므로 표 스코프로 특정한다.
    await within(await screen.findByTestId('tech-report-players')).findByText('SpaceX')
    expect(await screen.findByText('보유')).toBeTruthy()
  })

  it('gap_years 음수는 표시하지 않는다 — 표와 밴드가 같은 규율을 쓴다', async () => {
    // backend Player.gap_years에 ge=0 제약이 없어 음수가 발행될 수 있고, 그러면 `선두 대비 -2년`이라는
    // 무의미한 문구가 렌더됐다(적대적 리뷰 렌즈1). TechLevelBand는 고쳐졌는데 이 표는 안 고쳐져
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

  it('섹션 순서 — 지표·표가 산문보다 먼저 온다 (task#280 확정 순서)', async () => {
    // 이 재구성의 목적 자체를 못박는다. 개별 섹션의 존재 단언은 순서가 뒤집혀도 전부 통과하므로
    // (판정축이 대상과 독립 — 가토 ⑧ⓘ) DOM 순서를 별도 축으로 세운다. 2/2가 핵심 포인트·
    // 타임라인·계보를 끼워 넣을 때 이 순서를 흔들면 여기서 걸린다.
    api.get.mockImplementation((url) =>
      url === '/api/tech-reports/reusable-rocket'
        ? Promise.resolve({ data: { reports: [REPORT] } })
        : Promise.resolve({ data: [] }))
    const { container } = renderAt('reusable-rocket')
    await screen.findByTestId('tech-report-kpis')

    // related가 전 분류 0건인 픽스처라 「연관 기술」은 생략된다(조용한 생략이 정상 동작).
    expect([...container.querySelectorAll('.rpt-title__text')].map((e) => e.textContent))
      .toEqual(['주요 업체', '기술수준 비교', '점유율', '해결해야 할 난제', '시장 규모', '상세 설명', '출처'])

    const anchors = ['tech-report-lead', 'tech-report-kpis', 'tech-report-players', 'tech-report-prose', 'tech-report-sources']
      .map((t) => screen.getByTestId(t))
    anchors.slice(1).forEach((node, i) => {
      // 4 = Node.DOCUMENT_POSITION_FOLLOWING (앞 앵커 기준 뒤에 온다)
      expect(anchors[i].compareDocumentPosition(node) & 4).toBeTruthy()
    })
  })

  // 적대 리뷰 F1 — 같은 업체 집합이 30px 간격의 두 섹션(「주요 업체」 표 · 「기술수준 비교」 밴드)에서
  // **서로 다른 순서**로 나열됐다. 표만 sortPlayers를 태우고 밴드엔 API 원배열을 넘긴 탓이고, 변경 전에는
  // 둘 다 API 순서라 일치했으므로 task#280이 만든 회귀다. 개별 섹션의 존재·정렬 단언은 두 순서가 갈려도
  // 전부 통과하므로(판정축이 대상과 독립 — 가토 ⑧ⓘ) "두 소비처가 같은 배열을 본다"를 별도 축으로 세운다.
  // ⚠️ 위 두 픽스처는 category가 없어 groupByCategory가 []를 반환한다 — 즉 **그룹핑 경로에 원리적으로
  // 블라인드**하다. task#301이 업체 표를 분류 축별로 묶었을 때 이 테스트는 이빨 단언까지 갖춘 채로
  // 통과했고, 표와 밴드가 같은 업체를 서로 다른 순서로 나열하는 회귀는 **라이브 uat280 band-order가
  // 잡았다**(fixture-pass-live-fail). 그래서 분류 있는 픽스처를 세 번째 케이스로 못박는다.
  // 이 픽스처는 그룹 순서(경수형 2곳 → 고온가스로 1곳)가 평면 정렬(L5·L4·L3)과 **어긋나도록** 짰다 —
  // 어긋나지 않으면 그룹핑을 통째로 지워도 통과한다(공허한 초록).
  const CATEGORIZED_REPORT = {
    ...SMR_REPORT,
    players: [
      { ...SMR_REPORT.players[0], name: 'CNNC', tech_level: 5, gap_years: 0, category: '경수형' },
      { ...SMR_REPORT.players[1], name: '중국핵공업 HTR', tech_level: 4, gap_years: 1, category: '고온가스로' },
      { ...SMR_REPORT.players[2], name: 'NuScale', tech_level: 3, gap_years: 3, category: '경수형' },
    ],
  }

  it.each([
    ['smr 형태(동단계 안에서 격차 null이 API 선행)', SMR_REPORT],
    ['reusable-rocket 형태(API 순서 역전)', { ...REPORT, players: [REPORT.players[1], REPORT.players[0]] }],
    ['분류 있는 형태(그룹 순서 ≠ 평면 정렬 — task#301)', CATEGORIZED_REPORT],
  ])('표 행 순서 == 밴드 행 순서 — %s', async (_label, rep) => {
    api.get.mockImplementation((url) =>
      url.startsWith('/api/tech-reports/')
        ? Promise.resolve({ data: { slug: rep.slug, reports: [rep] } })
        : Promise.resolve({ data: [] }))
    const { container } = renderAt(rep.slug)

    const table = within(await screen.findByTestId('tech-report-players'))
    const tableNames = table.getAllByTestId('tech-report-player-name').map((e) => e.textContent)
    const bandNames = [...container.querySelectorAll('[data-testid="tech-level-band-row"] .tech-level-band__name')]
      .map((e) => e.textContent)

    expect(bandNames).toEqual(tableNames)
    expect(tableNames.length).toBe(rep.players.length)   // 표에서 사라진 업체 0
    expect(bandNames.length).toBe(rep.players.length)    // 밴드에서 사라진 업체 0
    // 이빨 — 픽스처가 실제로 재정렬을 유발해야 위 단언이 판별력을 갖는다.
    // API 순서와 렌더 순서가 같은 픽스처였다면 정렬을 통째로 지워도 통과한다(공허한 초록).
    expect(tableNames).not.toEqual(rep.players.map((p) => p.name))
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
    expect(titlesOf(container)).toEqual(
      ['핵심 포인트', '진척 타임라인', '주요 업체', '기술수준 비교', '시장 규모', '상세 설명', '출처'])

    const anchors = ['tech-report-kpis', 'tech-key-points', 'milestone-timeline', 'tech-report-players']
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
    ['reusable-rocket 실판(키 부재)', REPORT,
      ['주요 업체', '기술수준 비교', '점유율', '해결해야 할 난제', '시장 규모', '상세 설명', '출처']],
    ['smr 실판(키 부재)', SMR_REPORT,
      ['주요 업체', '기술수준 비교', '시장 규모', '상세 설명', '출처']],
    ['smr 실판(신규 키가 명시적 null)',
      { ...SMR_REPORT, key_points: null, milestones: null },
      ['주요 업체', '기술수준 비교', '시장 규모', '상세 설명', '출처']],
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
      ['주요 업체', '기술수준 비교', '점유율', '해결해야 할 난제', '시장 규모', '상세 설명', '출처']],
    ['전 필드(FULL_REPORT) — 7섹션', FULL_REPORT, 'smr',
      ['핵심 포인트', '진척 타임라인', '주요 업체', '기술수준 비교', '시장 규모', '상세 설명', '출처']],
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
  it('시장 규모 바로 앞에 삽입 — 형제 제목과의 DOM 순서 + 확정 순서 배열', async () => {
    mockReport(FULL_WITH_VARIANTS)
    const { container } = renderAt('smr')
    await screen.findByTestId('tech-report-kpis')

    expect(titlesOf(container)).toEqual(
      ['핵심 포인트', '진척 타임라인', '주요 업체', '기술수준 비교', '계열 비교', '시장 규모', '상세 설명', '출처'])

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
      ['핵심 포인트', '진척 타임라인', '주요 업체', '기술수준 비교', '시장 규모', '상세 설명', '출처'])
    expect(screen.getAllByTestId('tech-toc-chip').map((a) => a.textContent)).not.toContain('계열 비교')
  })

  it('확인할 지표 — 난제 바로 뒤·시장 규모 앞에 삽입(전체 체인 순서)', async () => {
    mockReport({ ...FULL_WITH_BOTH, challenges: [{ title: '난제 A', body: 'b' }] })
    const { container } = renderAt('smr')
    await screen.findByTestId('tech-report-kpis')

    // 확정 순서 — 난제 < 확인할 지표 < 시장 규모가 이 배열 안에서 함께 드러난다.
    expect(titlesOf(container)).toEqual(
      ['핵심 포인트', '진척 타임라인', '주요 업체', '기술수준 비교', '계열 비교',
       '해결해야 할 난제', '확인할 지표', '시장 규모', '상세 설명', '출처'])

    // DOM 순서로도 못박는다(제목 배열은 텍스트라 래퍼 배치가 어긋나도 통과할 수 있다).
    const watch = screen.getByTestId('tech-report-watch-items')
    const market = container.querySelector('[data-tech-section="market"]')
    const challenges = container.querySelector('[data-tech-section="challenges"]')
    expect(challenges.compareDocumentPosition(watch) & 4).toBeTruthy()   // 난제 → 확인할 지표
    expect(watch.compareDocumentPosition(market) & 4).toBeTruthy()       // 확인할 지표 → 시장 규모
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
