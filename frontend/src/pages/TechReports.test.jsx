import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TechReports from './TechReports'
import api from '../api'

vi.mock('../api', () => ({ default: { get: vi.fn() } }))

const REPORTS = [
  {
    slug: 'smr', published_date: '2026-08-03', title: 'SMR, 원전의 다음 세대',
    difficulty: { score: 4, rationale: '인허가 리스크' },
    players: [{ name: 'NuScale' }, { name: 'Rosatom' }],
    market: {
      history: [{ year: 2024, size: { value: 5.2, currency: 'USD', unit: 'bn' } }],
      forecast: [{ year: 2035, size: { value: 40, currency: 'USD', unit: 'bn' } }],
      cagr_pct: 20.1, as_of: '2026-08-03',
    },
  },
]

function renderPage() {
  return render(<MemoryRouter><TechReports /></MemoryRouter>)
}

beforeEach(() => vi.clearAllMocks())

describe('주요기술 리포트 목록 (task#276 S5, 개명 ADR-0038)', () => {
  it('목록 카드 렌더 — 표시명·제목·갱신일·난이도·업체 수·시장 요약', async () => {
    api.get.mockResolvedValue({ data: { reports: REPORTS } })
    renderPage()
    expect(await screen.findByText('SMR, 원전의 다음 세대')).toBeTruthy()
    expect(screen.getByText('SMR')).toBeTruthy()
    expect(screen.getByText('4/5')).toBeTruthy()
    expect(screen.getByText('2개')).toBeTruthy()
    expect(screen.getByText('2026-08-03 갱신')).toBeTruthy()
    expect(screen.getByText('$5.2B (2024) → $40B (2035), CAGR 20.1%')).toBeTruthy()
    // ⚠️ task#306: 카드 전체가 <a>였는데 「해부」 링크가 추가되며 풀렸다(앵커 중첩은 무효 마크업).
    // 계약("카드를 눌러 리포트로 간다")은 그대로이고 그것을 담는 요소만 바뀌었으므로, 단언을
    // 카드 자신의 href에서 본문 Link로 옮긴다 — task#276 계획의 완료기준·비목표 어디에도
    // "카드 루트가 앵커일 것"은 없다(부수적 단언이지 기록된 결정이 아님, CLAUDE.md task#264 판별).
    const card = screen.getByTestId('tech-report-card')
    expect(card.getAttribute('href')).toBe(null)
    expect(within(card).getByTestId('card-to-report').getAttribute('href')).toBe('/tech-report/smr')
  })

  it('카드 앵커는 정확히 2개 — 본문(리포트) + 「해부」 버튼, 미작성이면 라벨이 흐려진다 (task#309)', async () => {
    api.get.mockResolvedValue({ data: { reports: REPORTS } })
    renderPage()
    const card = await screen.findByTestId('tech-report-card')
    // ⚠️ task#309: 옛 판은 하단에 「리포트」 링크(`card-link-report`)를 따로 뒀고 이 테스트가 그것을
    // 단언했다. 본문 Link(`card-to-report`)와 목적지가 같은 두 번째 앵커라 제거했고, 그래서 그
    // 단언도 뒤집는다 — task#306 계획의 완료기준은 "목록 → 해부 → 리포트 → 해부 왕복이 라이브에서
    // 동작"이고 비목표 어디에도 「두 링크」가 없다(부수적 단언이지 기록된 결정이 아님, task#264 판별).
    // 개수만 세면 본문 Link가 사라지고 해부 버튼이 2개인 판에서도 통과하므로 href **집합**을 본다.
    const hrefs = [...card.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'))
    expect(hrefs.length).toBe(2)
    expect(new Set(hrefs)).toEqual(new Set(['/tech-report/smr', '/tech-anatomy/smr']))
    expect(within(card).getByTestId('card-link-anatomy').getAttribute('href')).toBe('/tech-anatomy/smr')
    // 픽스처에 composition이 없으므로 미작성 라벨이 뜬다 — 이 픽스처가 그 분기를 실제로 타는지
    // 게이트 식을 직접 적용해 못박는다(이빨과 분기 커버리지는 다른 축, task#301).
    expect(REPORTS[0].composition == null).toBe(true)
    const pending = within(card).getByTestId('card-anatomy-pending')
    expect(pending.textContent).toBe('해부 미작성')
    expect(pending.style.color).toBe('var(--text-3)')
    // 톤만 흐려질 뿐 **여전히 클릭 가능**하다(ADR-0042 결정 6 — 숨기지 않는다).
    expect(within(card).getByTestId('card-link-anatomy').getAttribute('href')).toBeTruthy()
  })

  it('composition이 있으면 라벨이 「해부 보기 →」이고 미작성 표기가 없다 (반대 분기)', async () => {
    api.get.mockResolvedValue({ data: { reports: [{ ...REPORTS[0], composition: { experts: [] } }] } })
    renderPage()
    const card = await screen.findByTestId('tech-report-card')
    expect(within(card).getByTestId('card-link-anatomy').textContent).toBe('해부 보기 →')
    expect(within(card).queryByTestId('card-anatomy-pending')).toBeNull()
    expect([...card.querySelectorAll('a[href]')].length).toBe(2)
  })

  it('카드 히트 오버레이 — 앵커를 늘리지 않고 카드 전체를 덮고, 「해부」는 그 위에 뜬다 (task#316)', async () => {
    api.get.mockResolvedValue({ data: { reports: REPORTS } })
    renderPage()
    const card = await screen.findByTestId('tech-report-card')
    // 오버레이의 inset:0은 **가장 가까운 positioned 조상**을 기준으로 풀린다 — 본문 Link는
    // static이므로 Card가 relative여야 카드 상자(padding 포함) 전체를 덮는다. 이 한 줄이
    // 빠지면 오버레이가 조상 어딘가(또는 뷰포트)에 붙어 히트 영역이 통째로 어긋난다.
    expect(card.style.position).toBe('relative')
    const body = within(card).getByTestId('card-to-report')
    const overlay = within(body).getByTestId('card-hit-overlay')
    expect(overlay.tagName).toBe('SPAN')          // 앵커가 아니다(task#306 중첩 금지)
    expect(overlay.style.position).toBe('absolute')
    // 롱핸드 4개를 낱개로 못박는다 — `inset: 0` 단축은 Safari 14.1(iOS 14.5) 미만에서 무시되고
    // 그러면 오프셋이 auto로 남아 span이 0×0으로 접힌다(=이 수정이 무음 no-op). 이 앱은 iOS
    // 설치형 PWA이고 라이브 프로브는 Chromium 전용이라, 그 회귀를 잡을 수 있는 축은 여기뿐이다.
    expect([overlay.style.top, overlay.style.right, overlay.style.bottom, overlay.style.left])
      .toEqual(['0px', '0px', '0px', '0px'])
    expect(overlay.getAttribute('aria-hidden')).toBe('true')
    // 오버레이의 **유일한** 기능이 클릭 수신이다 — `pointerEvents: 'none'`을 더하면 결정 5 ⓐ
    // (텍스트 선택 차단)는 정확히 복구되면서 히트 영역이 통째로 사라지는데, 카드는 시각적으로
    // 동일하고 위 선언 축들도 전부 그대로 통과한다. 그래서 그 한 가지를 여기서 막는다.
    expect(overlay.style.pointerEvents).toBe('')
    // ⚠️ 이 축은 오버레이 도입 여부와 **무관하게** 통과한다(span은 앵커를 늘리지 않는다).
    // 오버레이의 증거가 아니라 회귀 방지용이다 — 오버레이를 <a>로 잘못 바꾸면 여기서 깨진다.
    expect([...card.querySelectorAll('a[href]')].length).toBe(2)
    // 오버레이는 절대배치라 in-flow인 「해부」 앵커보다 **뒤에** 그려진다 → 이 쌍이 없으면
    // 오버레이가 해부 진입점을 삼킨다. 실제로 삼키는지는 jsdom이 못 잰다(레이아웃·z축 없음) —
    // 여기서는 그 방어가 **선언돼 있는지**만 못박고, 클릭 결과는 라이브 프로브의 몫이다.
    const anatomy = within(card).getByTestId('card-link-anatomy')
    expect(anatomy.style.position).toBe('relative')
    expect(anatomy.style.zIndex).toBe('1')
    // 이 it 전체가 **선언** 축이다. 클릭이 실제로 어디로 가는지를 재는 유일한 게이트는 라이브
    // 프로브의 쌍 축(카드 padding 밴드 클릭 → /tech-report/<slug> · 「해부」 칩 클릭 →
    // /tech-anatomy/<slug> · 칩 경계 +3px 클릭 → 어느 쪽인지)이다. 그 프로브를 지우면 히트
    // 영역·z 순서에 대한 라이브 게이트가 0이 된다는 뜻이므로 함께 지우지 말 것.
  })

  it('빈 목록 — 빈 상태 문구', async () => {
    api.get.mockResolvedValue({ data: { reports: [] } })
    renderPage()
    expect(await screen.findByText('발행된 주요기술 리포트가 없습니다.')).toBeTruthy()
  })

  it('조회 실패 — 에러 문구(빈 상태와 구별, 에러 정직성)', async () => {
    api.get.mockRejectedValue(new Error('network'))
    renderPage()
    await waitFor(() => expect(screen.getByText('목록을 불러오지 못했습니다.')).toBeTruthy())
    expect(screen.queryByText('발행된 주요기술 리포트가 없습니다.')).toBeNull()
  })

  // S3: 발행 대기 구역 (task#317 후속) — topics 는 등록 15종, reports 는 발행 7종의 부분집합.
  // ⚠️ 배열 삽입 순서를 order 와 **일부러 어긋나게** 둔다(3,1,2). 오름차순으로 두면
  // filter 가 원 배열 순서를 보존하므로 `.sort((a,b)=>a.order-b.order)` 를 통째로 지워도
  // 기대 출력과 같아져 이 테스트가 계속 통과한다 — 즉 정렬 회귀에 눈이 먼 축이 된다
  // (적대 검토가 그 거짓 안심을 포착했다). 어긋나게 두면 정렬이 실제로 실행돼야만 통과한다.
  const TOPICS_15 = [
    { slug: 'autonomous-driving', name: '자율주행', order: 3 },
    { slug: 'quantum-computing', name: '양자컴퓨팅', order: 1 },
    { slug: 'smr', name: 'SMR', order: 2 },
  ]

  it('대기 칩 — order 순서를 따르고(배열·reports 순서 아님) 이름·slug·href가 정확하다', async () => {
    // 이빨 2겹: ⓐ 픽스처 배열 순서(autonomous→quantum)가 기대 출력(quantum→autonomous)과
    // 반대라 정렬을 지우면 FAIL 한다 ⓑ reports 순서(smr 하나뿐)와도 달라 "reports 순서 그대로"
    // 나 "topics 전부 렌더" 오구현도 통과할 수 없다.
    api.get.mockResolvedValue({ data: { reports: REPORTS, topics: TOPICS_15 } })
    renderPage()
    const section = await screen.findByTestId('tech-pending-section')
    const chips = within(section).getAllByTestId('tech-pending-chip')
    expect(chips.length).toBe(2)
    expect(chips.map(c => c.dataset.slug)).toEqual(['quantum-computing', 'autonomous-driving'])
    expect(chips.map(c => c.textContent)).toEqual(['양자컴퓨팅', '자율주행'])
    expect(chips[0].getAttribute('href')).toBe('/tech-report/quantum-computing')
    expect(chips[1].getAttribute('href')).toBe('/tech-report/autonomous-driving')
  })

  it('대기 0건 — topics 와 reports 가 같은 집합이면 구역 자체가 렌더되지 않는다', async () => {
    api.get.mockResolvedValue({
      data: { reports: REPORTS, topics: [{ slug: 'smr', name: 'SMR', order: 1 }] },
    })
    renderPage()
    await screen.findByTestId('tech-report-card')
    expect(screen.queryByTestId('tech-pending-section')).toBeNull()
  })

  it('응답에 topics 키가 없으면(옛 백엔드) 구역 미렌더 + 발행물 카드 수는 그대로', async () => {
    api.get.mockResolvedValue({ data: { reports: REPORTS } })
    renderPage()
    const cards = await screen.findAllByTestId('tech-report-card')
    expect(cards.length).toBe(1)
    expect(screen.queryByTestId('tech-pending-section')).toBeNull()
  })
})
