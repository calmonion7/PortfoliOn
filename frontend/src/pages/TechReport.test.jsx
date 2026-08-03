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

describe('선도기술 리포트 상세 (task#276 S5)', () => {
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

    expect(screen.getByTestId('tech-report-market-summary').textContent).toBe('$12.5B (2024) → $30.5B (2030), CAGR 12.3%')
    expect(screen.getByText('2026-08-03 기준')).toBeTruthy()
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
    // 표에서는 그 문자열이 **열 머리글**이라 항상 존재한다(정상). 단언을 값 셀로 좁힌다:
    // 4번째 열(업체·국가·기술수준·**선두 대비**·점유율·티커)이 결측 표시 —여야 한다.
    const row = within(screen.getByTestId('tech-report-players')).getByTestId('tech-report-player-row')
    expect(row.cells[3].textContent).toBe('—')
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
  it.each([
    ['smr 형태(동단계 안에서 격차 null이 API 선행)', SMR_REPORT],
    ['reusable-rocket 형태(API 순서 역전)', { ...REPORT, players: [REPORT.players[1], REPORT.players[0]] }],
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
