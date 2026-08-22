import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TechReports from '../pages/TechReports'
import ShareChart from '../components/tech/ShareChart'
import api from '../api'

// task#331 — 주요기술 시각 표면의 **구조적 대리지표**를 잠근다(B54 목록 카드 제목 잘림 · B55 점유율
// 막대 트랙 폭 불균일).
//
// ⚠️ 이 파일이 무엇을 재고 무엇을 못 재는지 먼저 못박는다 — jsdom엔 레이아웃이 없으므로
// 「제목이 몇 줄로 접히는가」·「트랙 폭이 실제로 같은가」·「큰 값의 막대가 더 긴가」는 **원리적으로
// 못 잰다**(CONVENTIONS §9.7 · TESTING §9 ①②⑦). 여기서 재는 것은 그 불변식을 성립시키는
// **선언**이고, 픽셀 게이트는 라이브 프로브(`scripts/uat331-tech-visual.mjs`의
// `title-not-clipped` / `share-track-uniform` / `share-bar-monotonic`)다. 둘 중 하나만 남기지 말 것 —
// 선언 축은 라이브에서 무엇이 그려지는지 모르고, 프로브는 배포 후에만 돈다.
//
// 왜 각 축이 이빨을 갖는지(= 그 축이 없으면 무엇이 조용히 통과하는지)를 축마다 주석에 적는다.

vi.mock('../api', () => ({ default: { get: vi.fn() } }))

// 실발행 제목의 성격을 그대로 옮긴 픽스처 — 이 필드는 「기술 이름」이 아니라 **결론 문장**이다
// (라이브 실측 2026-08-22: 15종의 제목 길이 13~207자, 그중 7종이 90자 이상).
// 한국어는 술어가 끝에 오므로 끝을 자르면 결론이 먼저 사라진다 → 이 픽스처의 마지막 어절
// (`둘뿐이다`)이 DOM에 남아 있는지가 곧 「결론이 살아 있는가」다.
const LONG_TITLE = '중국 링룽 1호의 상업운전 시한은 최초 임계도 없이 지나갔고, 서방에서 콘크리트가 부어진 설계는 여전히 BWRX-300·Natrium 둘뿐이다'
const REPORTS = [{
  slug: 'smr', published_date: '2026-08-21', title: LONG_TITLE,
  difficulty: { score: 4, rationale: 'r' }, players: [{ name: 'NuScale' }],
}]

const renderList = () => render(<MemoryRouter><TechReports /></MemoryRouter>)

beforeEach(() => vi.clearAllMocks())

describe('B54 — 목록 카드 제목은 잘리지 않는다 (task#331)', () => {
  it('제목 상자에 잘라내는 선언이 하나도 없다', async () => {
    api.get.mockResolvedValue({ data: { reports: REPORTS } })
    renderList()
    const title = await screen.findByTestId('tech-report-card-title')
    // 옛 판의 정확한 조합이 `overflow:hidden + textOverflow:ellipsis + whiteSpace:nowrap`이었다.
    // 셋을 낱개로 못박는다 — 하나만 되살아나도 결론이 다시 사라지고, 화면은 「깔끔해 보인다」.
    expect(title.style.overflow).not.toBe('hidden')
    expect(title.style.textOverflow).not.toBe('ellipsis')
    expect(title.style.whiteSpace).toBe('')
    // line-clamp도 같은 결과를 낸다(줄 수만 다르다) — ellipsis만 막으면 그쪽으로 우회한다.
    expect(title.style.getPropertyValue('-webkit-line-clamp')).toBe('')
    expect(title.style.getPropertyValue('line-clamp')).toBe('')
  })

  it('어절 줄바꿈 + 넘침 안전망이 **쌍으로** 선언돼 있다', async () => {
    api.get.mockResolvedValue({ data: { reports: REPORTS } })
    renderList()
    const title = await screen.findByTestId('tech-report-card-title')
    // keep-all 단독은 「낱자 적층」만 막고(task#324 선례) 한 어절이 컨테이너보다 넓을 때는
    // 카드를 넘겨 **페이지 가로 스크롤**을 만든다. anywhere 단독은 낱자로 쪼갠다.
    // 둘 중 하나만 남는 것이 가장 그럴듯한 회귀이므로 쌍으로 단언한다.
    expect(title.style.wordBreak).toBe('keep-all')
    // ⚠️ 안전망은 `break-word`로 **못박는다**(`anywhere`가 아니다). 두 값은 이 자리에서 결과가
    //    완전히 동일한데(Chromium 실측: 258px 상자·60자 무공백 토큰에서 둘 다 scrollWidth 258 ==
    //    clientWidth 258, `keep-all` 단독은 621) 지원 범위가 갈린다 — `anywhere`는 Safari/iOS
    //    **15.4+** 전용이라 그 미만에서는 선언만 드롭돼 `keep-all` 단독(=가로 스크롤)이 된다.
    //    이 앱은 iOS 설치형 PWA이고 Chromium 전용 라이브 프로브는 이 차이에 **원리적으로
    //    블라인드**하므로, 그 사각을 막는 유일한 게이트가 이 선언 축이다.
    expect(title.style.overflowWrap).toBe('break-word')
  })

  // ── B54 수정의 **시각 부산물** — 구분선이 카드 중간에 뜨던 것 ──────────────
  // stretch 그리드에서 한 행의 카드는 가장 긴 제목에 맞춰 함께 커지는데, footer(구분선 + 해부 칩)는
  // in-flow 마지막 요소라 자기 자연 위치에 머문다 → 짧은 제목 카드에서 구분선이 중간에 뜨고 그
  // 아래가 통째로 빈다(Chromium 합성 실측 pc1440: 최대 **309.5px** = 카드의 60%).
  // jsdom은 레이아웃이 없어 그 픽셀을 못 재고, 프로브 축 `grid-row-heights-equal`은 「행 높이가
  // 같다」를 *요구*하므로 이 결함을 **잡지 못한다**(오히려 고정한다). 여기서 재는 것은 그 결함을
  // 성립 불가하게 만드는 **선언 쌍**이고, 픽셀 게이트는 S9 프로브 `card-footer-at-bottom`이다.
  it('카드는 column flex이고 footer가 하단으로 밀린다 — 선언 쌍', async () => {
    api.get.mockResolvedValue({ data: { reports: REPORTS } })
    renderList()
    const card = await screen.findByTestId('tech-report-card')
    expect(card.style.display).toBe('flex')
    expect(card.style.flexDirection).toBe('column')
    const footer = within(card).getByTestId('tech-report-card-footer')
    expect(footer.style.marginTop).toBe('auto')
    // ⚠️ `marginTop:'auto'`는 자유공간이 0이면 0으로 해소돼 구분선이 본문에 달라붙는다.
    //    상단 8px 최소 간격은 본문 Link의 marginBottom이 담당하므로 **쌍으로** 못박는다.
    expect(within(card).getByTestId('card-to-report').style.marginBottom).toBe('8px')
  })

  it('히트 오버레이는 여전히 카드 전체를 덮는다 — column flex 전환의 부작용 가드', async () => {
    api.get.mockResolvedValue({ data: { reports: REPORTS } })
    renderList()
    const card = await screen.findByTestId('tech-report-card')
    expect(card.style.position).toBe('relative')   // 오버레이의 containing block
    const ov = within(card).getByTestId('card-hit-overlay')
    // `inset` 단축은 Safari 14.1 미만에서 무음 no-op이므로 롱핸드 4개를 유지한다(task#316).
    expect([ov.style.top, ov.style.right, ov.style.bottom, ov.style.left]).toEqual(['0px', '0px', '0px', '0px'])
    // 해부 칩은 오버레이 **위**에 있어야 클릭이 리포트로 새지 않는다(relative + zIndex 쌍).
    const anatomy = within(card).getByTestId('card-link-anatomy')
    expect(anatomy.style.position).toBe('relative')
    expect(anatomy.style.zIndex).toBe('1')
  })

  it('이빨: 제목 전문이 DOM에 있다 — 마지막 어절(술어)까지', async () => {
    api.get.mockResolvedValue({ data: { reports: REPORTS } })
    renderList()
    const title = await screen.findByTestId('tech-report-card-title')
    // ⚠️ 이 축은 **CSS 잘림에는 블라인드하다**(ellipsis는 DOM 텍스트를 지우지 않으므로 수정 전에도
    // 통과했다). 여기서 막는 것은 다음번의 다른 처방 — `title.slice(0, 40) + '…'`처럼 **JS로**
    // 자르는 것이다. 그건 위 두 축을 전부 통과하면서 결론을 지운다.
    expect(title.textContent).toBe(LONG_TITLE)
    expect(title.textContent.endsWith('둘뿐이다')).toBe(true)
    expect(title.textContent).not.toContain('…')
    // 픽스처가 이 축을 실제로 자극하는지(= 짧은 제목이면 잘림이 애초에 안 났다) 함께 못박는다.
    // 라이브 실측(2026-08-22) 제목 상자 clientWidth = pc1440 258px · m390 316px · m350 276px이고
    // 15px 세리프 한글은 대략 22~24자에서 그 폭을 넘는다(24자 제목이 285px로 pc1440·m350에서
    // 실제로 잘려 있었다) → 40자를 넘으면 옛 판에서 **반드시** 잘렸다.
    expect(LONG_TITLE.length).toBeGreaterThan(40)
  })

  it('제목 testid는 프로브·vitest 공유 앵커다 — 카드당 정확히 1개', async () => {
    api.get.mockResolvedValue({ data: { reports: REPORTS } })
    renderList()
    const card = await screen.findByTestId('tech-report-card')
    // 앵커가 사라지면 이 파일의 축 3개와 라이브 프로브의 title-* 축이 **동시에** 정의역을 잃는다
    // (그리고 프로브는 「대상 0개」를 통과로 셀 수 있다) → 앵커 자체를 축으로 둔다.
    expect(within(card).getAllByTestId('tech-report-card-title')).toHaveLength(1)
  })
})

describe('B55 — 점유율 값 칸은 전 행 같은 폭을 예약한다 (task#331)', () => {
  // 값 문자열 길이가 **행마다 다른** 표본이어야 이 축이 자극된다. 라이브에서 그 조건을 만족하는
  // 발행물은 실측 2종이다(ai-datacenter-equipment 11행 `7.0%`↔`82.0%` · robotics 4행 `1.0%`↔`32.0%`).
  const MIXED = [
    { name: 'A사', share_pct: 100 },  // "100.0%" = 6자
    { name: 'B사', share_pct: 82 },   // "82.0%"  = 5자
    { name: 'C사', share_pct: 7 },    // "7.0%"   = 4자
  ]
  const values = (c) => [...c.querySelectorAll('[data-testid="tech-share-chart-value"]')]

  it('정의역 확인: 픽스처의 값 문자열 길이가 실제로 갈린다(안 갈리면 아래 축이 공허하다)', () => {
    const { container } = render(<ShareChart players={MIXED} shareBasis="기준" />)
    const texts = values(container).map((v) => v.textContent.trim())
    expect(texts).toEqual(['100.0%', '82.0%', '7.0%'])
    // 길이가 전부 같은 표본(solar-pv 4행이 실제로 그렇다 — 전부 `1x.x%`)에서는 트랙 폭이 이미
    // 균일하므로 폭 예약 축이 통과해도 아무것도 증명하지 않는다. 그 함정을 여기서 못박는다.
    expect(new Set(texts.map((t) => t.length)).size).toBeGreaterThan(1)
  })

  it('전 행의 값 칸 폭 선언이 동일하고, 비어 있지 않다', () => {
    const { container } = render(<ShareChart players={MIXED} shareBasis="기준" />)
    const widths = values(container).map((v) => v.style.width)
    // ⚠️ 「동일」만 보면 수정 전에도 통과한다 — 폭 선언이 전 행 `''`(자연폭)이어서 집합 크기가
    // 1이기 때문이다. 그게 바로 결함 상태이므로 **비어 있지 않음**을 쌍으로 단언한다.
    expect(new Set(widths).size).toBe(1)
    expect(widths[0]).not.toBe('')
    expect(values(container).every((v) => v.style.flexShrink === '0')).toBe(true)
  })

  it('예약폭은 상수가 아니라 **최장 값 문자열에서 파생**된다', () => {
    // 6자(`100.0%`)가 있으면 6ch, 없으면 5ch. 하드코딩 `width:'5ch'`는 위 축을 통과하면서
    // `100.0%`를 잘라내므로(값 칸이 nowrap이라 넘친다) 이 축이 그 우회를 막는다.
    const six = render(<ShareChart players={MIXED} shareBasis="기준" />)
    expect(values(six.container)[0].style.width).toBe('6ch')
    const five = render(<ShareChart players={[{ name: 'A사', share_pct: 82 }, { name: 'B사', share_pct: 7 }]} shareBasis="기준" />)
    expect(values(five.container)[0].style.width).toBe('5ch')
  })

  it('그룹 모드에서도 폭은 **전체 행** 기준이다 — 그룹별로 잡으면 그룹 간 막대 비교가 깨진다', () => {
    // 6자 값은 「가속기」 그룹에만 있다. 그룹별로 valueCh를 잡으면 「냉각」 그룹은 5ch가 되어
    // 두 그룹의 트랙 폭이 갈리고, 분류를 넘나드는 막대 길이 비교가 다시 무의미해진다.
    const GROUPED = [
      { name: 'NVIDIA', category: '가속기', share_pct: 100 },
      { name: 'AMD', category: '가속기', share_pct: 7 },
      { name: 'Vertiv', category: '냉각', share_pct: 11.3 },
    ]
    const { container } = render(<ShareChart players={GROUPED} shareBasis="기준" />)
    const groups = [...container.querySelectorAll('[data-testid="tech-share-chart-group"]')]
    expect(groups.length).toBe(2)
    const widths = values(container).map((v) => v.style.width)
    expect(widths).toHaveLength(3)
    expect(new Set(widths)).toEqual(new Set(['6ch']))
  })

  it('트랙·막대 testid가 존재한다 — 라이브 폭 축의 앵커', () => {
    const { container } = render(<ShareChart players={MIXED} shareBasis="기준" />)
    // 프로브가 형제 순서(children[1] 등)로 트랙을 찾으면 행 구조가 바뀌는 순간 조용히 다른 요소를
    // 재기 시작한다(그러고도 ALL PASS한다). 앵커를 계약으로 둔다.
    expect(container.querySelectorAll('[data-testid="tech-share-chart-track"]')).toHaveLength(3)
    expect(container.querySelectorAll('[data-testid="tech-share-chart-bar"]')).toHaveLength(3)
  })
})
