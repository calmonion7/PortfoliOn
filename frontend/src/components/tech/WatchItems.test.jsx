import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import WatchItems, { watchItemsLayout, WI_LABEL, WI_NOT_SIGNAL_BADGE, WI_NOT_SIGNAL_TEXT } from './WatchItems'

// 「확인할 지표」(task#298 S3). vitest는 인라인 선언·클래스만 볼 수 있다 — **적용된 색**은 jsdom이
// 원리적으로 못 보므로 여기서는 선언이 서로 다름만 못박고, 실제 computed color는 uat298이 잰다(가토 ⑪).

const ITEMS = [
  { label: '링룽 1호의 계통연결이 IAEA에 등재되는가', detail: '등재 시각이 곧 상업운전 기준점이다.',
    not_signal: '파일럿 라인 준공·샘플 공개는 일정이 유지된다는 신호일 뿐이다.' },
  { label: '회전율 — 같은 기체를 몇 번 돌리는가', detail: null, not_signal: null },
  { label: '누적 가동시간', detail: '누적 인도 대수가 아니다.', not_signal: null },
]

describe('watchItemsLayout — 순수함수', () => {
  it('① 정상 입력에서 순서·필드 매핑 보존(not_signal → notSignal)', () => {
    const { items } = watchItemsLayout(ITEMS)
    expect(items.map((i) => i.label)).toEqual(ITEMS.map((i) => i.label))
    expect(items[0].notSignal).toBe(ITEMS[0].not_signal)
    expect(items[1].notSignal).toBeNull()
    expect(items[1].detail).toBeNull()
  })

  it('② label이 비면(결측·공백만) 그 항목을 버린다 — 라벨 없는 카드는 번호만 남는다', () => {
    const { items } = watchItemsLayout([
      { label: '유효' }, { label: '   ' }, { label: '' }, { label: null }, {}, { detail: '라벨 없음' },
    ])
    expect(items).toHaveLength(1)
    expect(items[0].label).toBe('유효')
  })

  it('③ 비배열·null·undefined가 예외 없이 빈 결과', () => {
    for (const bad of [null, undefined, {}, 'x', 42, true]) {
      expect(watchItemsLayout(bad)).toEqual({ items: [] })
    }
  })

  it('④ 공백만인 detail·not_signal은 null로 정규화 — 렌더가 빈 블록을 만들지 않게', () => {
    const { items } = watchItemsLayout([{ label: 'L', detail: '  ', not_signal: '\n\t' }])
    expect(items[0].detail).toBeNull()
    expect(items[0].notSignal).toBeNull()
  })
})

describe('WatchItems — 렌더', () => {
  it('⑤ items가 비면 null 반환(섹션째 생략 — 제목은 페이지가 소유한다)', () => {
    for (const bad of [null, undefined, [], [{ label: '  ' }]]) {
      const { container } = render(<WatchItems watchItems={bad} />)
      expect(container.firstChild).toBeNull()
    }
  })

  it('⑥ 항목마다 카드 + 번호(01~) + 라벨', () => {
    render(<WatchItems watchItems={ITEMS} />)
    const cards = screen.getAllByTestId('tech-report-watch-item')
    expect(cards).toHaveLength(3)
    expect(screen.getByText('01')).toBeTruthy()
    expect(screen.getByText('03')).toBeTruthy()
    expect(screen.getAllByTestId('tech-report-watch-item-label').map((e) => e.textContent))
      .toEqual(ITEMS.map((i) => i.label))
  })

  it('⑦ notSignal 없는 항목엔 「신호 아님」 라벨이 0개 — 유령 배지 금지', () => {
    render(<WatchItems watchItems={ITEMS} />)
    // 3항목 중 not_signal은 1건뿐이다
    expect(screen.getAllByTestId('tech-report-watch-item-not-signal-badge')).toHaveLength(1)
    const cards = screen.getAllByTestId('tech-report-watch-item')
    expect(within(cards[1]).queryByTestId('tech-report-watch-item-not-signal-badge')).toBeNull()
    expect(within(cards[2]).queryByTestId('tech-report-watch-item-not-signal-badge')).toBeNull()
  })

  it('⑧ notSignal 본문이 온전히 렌더된다(문자 손실 0)', () => {
    render(<WatchItems watchItems={ITEMS} />)
    expect(screen.getByTestId('tech-report-watch-item-not-signal-text').textContent)
      .toBe(ITEMS[0].not_signal)
  })

  it('⑨ 「신호 아님」 색 선언이 라벨 색 선언과 다르다 — 의미 상태는 --warn, 가격 방향(--up/--down) 금지', () => {
    // vitest가 볼 수 있는 것은 선언뿐이다(적용된 색은 uat298 `not-signal-color` 축이 잰다).
    expect(WI_NOT_SIGNAL_TEXT.color).toBe('var(--warn)')
    expect(WI_NOT_SIGNAL_BADGE.color).toBe('var(--warn)')
    expect(WI_LABEL.color).toBe('var(--text)')
    expect(WI_NOT_SIGNAL_TEXT.color).not.toBe(WI_LABEL.color)
    // 가격 방향 토큰이 새어들지 않았음을 선언 수준에서 못박는다(교차 사용 금지).
    for (const s of [WI_NOT_SIGNAL_TEXT, WI_NOT_SIGNAL_BADGE, WI_LABEL]) {
      expect(JSON.stringify(s)).not.toContain('--up')
      expect(JSON.stringify(s)).not.toContain('--down')
    }
  })

  it('⑩ 배지만 nowrap(1줄 유지)이고 본문은 접힌다 — 잘림 0', () => {
    expect(WI_NOT_SIGNAL_BADGE.whiteSpace).toBe('nowrap')
    expect(WI_NOT_SIGNAL_BADGE.flexShrink).toBe(0)
    expect(WI_NOT_SIGNAL_TEXT.whiteSpace).toBeUndefined()
    // 어느 폭에서도 문자를 잃지 않는다 — ellipsis 금지, `anywhere`여야 min-content가 실제로 줄어든다
    // (`break-word`는 스펙상 min-content에 영향이 없다 — task#296 라이브 회귀).
    expect(WI_NOT_SIGNAL_TEXT.overflowWrap).toBe('anywhere')
    expect(WI_LABEL.overflowWrap).toBe('anywhere')
    expect(JSON.stringify(WI_NOT_SIGNAL_TEXT)).not.toContain('ellipsis')
  })

  it('⑪ 라벨이 중복돼도 렌더가 깨지지 않는다(key는 인덱스 + label 조합)', () => {
    render(<WatchItems watchItems={[{ label: '같은 라벨' }, { label: '같은 라벨' }]} />)
    expect(screen.getAllByTestId('tech-report-watch-item')).toHaveLength(2)
  })
})
