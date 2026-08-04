import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import MarketEstimates, { marketEstimatesLayout } from './MarketEstimates'

// task#282 S2 — 렌더 계약: 정상 렌더(내림차순·배수 캡션) · scope 결측 · is_basis 전무 ·
// 1건/min=0 배수 문구 생략 · 빈 입력 3종 null.

const usd = (value) => ({ value, currency: 'USD', unit: 'bn' })

describe('MarketEstimates — task#282 렌더 계약', () => {
  it('① 5기관: 막대 5개 · 폭이 내림차순으로 단조감소 · 최대 100% · 캡션에 3.4배', () => {
    const estimates = [
      { institution: 'A사', year: 2030, size: usd(300) },
      { institution: 'B사', year: 2030, size: usd(340) }, // 최대
      { institution: 'C사', year: 2030, size: usd(250) },
      { institution: 'D사', year: 2030, size: usd(150) },
      { institution: 'E사', year: 2030, size: usd(100) }, // 최소 — 340/100=3.4
    ]
    const { getAllByTestId, getByTestId } = render(<MarketEstimates estimates={estimates} />)

    const rows = getAllByTestId('market-estimate-row')
    expect(rows).toHaveLength(5)
    expect(rows[0].textContent).toContain('B사')
    expect(rows[4].textContent).toContain('E사')

    const widths = getAllByTestId('market-estimate-bar').map((el) => parseFloat(el.style.width))
    expect(widths[0]).toBe(100)
    for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeLessThan(widths[i - 1])

    expect(getByTestId('market-estimates-caption').textContent).toContain('3.4배')
    expect(getByTestId('market-estimates-caption').textContent).toContain('2030년')
  })

  it('② scope 결측 항목은 라벨만 표시하고 빈 부연 노드를 만들지 않는다', () => {
    const estimates = [
      { institution: 'A사', year: 2030, size: usd(100), scope: '글로벌' },
      { institution: 'B사', year: 2030, size: usd(50) }, // scope 없음
    ]
    const { getAllByTestId } = render(<MarketEstimates estimates={estimates} />)
    const rows = getAllByTestId('market-estimate-row')

    expect(rows[0].querySelector('span[title]').title).toBe('A사 · 글로벌')
    const bLabel = rows[1].querySelector('span[title]')
    expect(bLabel.title).toBe('B사')
    expect(bLabel.textContent).not.toContain('undefined')
    expect(bLabel.textContent).not.toContain('·')
  })

  it('③ is_basis가 전무하면 기준 마커가 0개 렌더된다', () => {
    const estimates = [
      { institution: 'A사', year: 2030, size: usd(100) },
      { institution: 'B사', year: 2030, size: usd(50), is_basis: false },
    ]
    const { queryAllByTestId } = render(<MarketEstimates estimates={estimates} />)
    expect(queryAllByTestId('market-estimate-basis-marker')).toHaveLength(0)
  })

  it('is_basis=true인 항목에만 기준 마커가 1개 렌더된다', () => {
    const estimates = [
      { institution: 'A사', year: 2030, size: usd(100), is_basis: true },
      { institution: 'B사', year: 2030, size: usd(50) },
    ]
    const { getAllByTestId, queryAllByTestId } = render(<MarketEstimates estimates={estimates} />)
    const markers = queryAllByTestId('market-estimate-basis-marker')
    expect(markers).toHaveLength(1)
    expect(getAllByTestId('market-estimate-row')[0].contains(markers[0])).toBe(true)
  })

  it('④ 1건뿐이면 배수 문구가 없다', () => {
    const estimates = [{ institution: 'A사', year: 2030, size: usd(100) }]
    const { getByTestId } = render(<MarketEstimates estimates={estimates} />)
    const caption = getByTestId('market-estimates-caption').textContent
    expect(caption).toContain('2030년')
    expect(caption).not.toContain('배')
  })

  it('⑤ 최소값이 0이면 배수 문구가 없고 Infinity·NaN 문자열이 출력에 없다', () => {
    const estimates = [
      { institution: 'A사', year: 2030, size: usd(50) },
      { institution: 'B사', year: 2030, size: usd(0) },
    ]
    const { container, getByTestId } = render(<MarketEstimates estimates={estimates} />)
    expect(getByTestId('market-estimates-caption').textContent).not.toContain('배')
    expect(container.textContent).not.toContain('Infinity')
    expect(container.textContent).not.toContain('NaN')
  })

  it('⑥ null/undefined/빈 배열이면 컴포넌트는 null을 반환하고 레이아웃 함수도 빈 목록을 준다', () => {
    expect(render(<MarketEstimates estimates={null} />).container.firstChild).toBeNull()
    expect(render(<MarketEstimates estimates={undefined} />).container.firstChild).toBeNull()
    expect(render(<MarketEstimates estimates={[]} />).container.firstChild).toBeNull()

    expect(marketEstimatesLayout(null).rows).toHaveLength(0)
    expect(marketEstimatesLayout(undefined).rows).toHaveLength(0)
    expect(marketEstimatesLayout([]).rows).toHaveLength(0)
  })

  it('⚠️ 회귀 잠금: size.value가 음수·비유한인 항목은 필터에서 제외된다(wrong<missing)', () => {
    const estimates = [
      { institution: 'A사', year: 2030, size: usd(100) },
      { institution: 'B사', year: 2030, size: usd(-5) },
      { institution: 'C사', year: 2030, size: { value: NaN, currency: 'USD', unit: 'bn' } },
    ]
    const { getAllByTestId } = render(<MarketEstimates estimates={estimates} />)
    expect(getAllByTestId('market-estimate-row')).toHaveLength(1)
  })

  it('기관명은 ellipsis 상자, 값은 flexShrink:0 형제로 분리돼 있다(잘림 축 회귀 방지)', () => {
    const estimates = [{ institution: '아주 긴 시장조사 기관명 컴퍼니 리서치', year: 2030, size: usd(12.3) }]
    const { getByTestId } = render(<MarketEstimates estimates={estimates} />)
    const row = getByTestId('market-estimate-row')
    const labelSpan = row.querySelector('span[title]')
    expect(labelSpan.style.textOverflow).toBe('ellipsis')
    expect(labelSpan.style.whiteSpace).toBe('nowrap')

    const valueSpan = [...row.querySelectorAll('span')].find((s) => s.textContent.includes('$'))
    expect(valueSpan.style.flexShrink).toBe('0')
  })

  // ⚠️ 라이브에서만 잡힌 결함의 구조적 대리지표(task#282 UAT). 트랙은 flex:1로 **잔여폭**을 먹으므로
  // 값·마커의 폭이 행마다 다르면 `width:N%`의 기준이 행마다 달라져 **더 작은 값이 더 긴 막대**가 된다
  // (실측: $12.5B→75.98px vs $9B→84.86px, 트랙 [153,103,160,146,160] — 모바일 4조합 FAIL).
  // jsdom엔 레이아웃이 없어 렌더 px 단조성은 **원리적으로 못 잰다** — 실제 게이트는 라이브 프로브의
  // est-bar-monotonic이고, 여기서는 그 원인이 되는 두 구조 조건만 못박는다.
  it('⚠️ 회귀 잠금: 값 예약폭이 행마다 동일하고 마커 슬롯이 전 행에 존재한다(막대 비교 가능성의 전제)', () => {
    const estimates = [
      { institution: 'A사', year: 2030, size: usd(30.5) }, // '$30.5B' 6자
      { institution: 'B사', year: 2030, size: usd(12.5), is_basis: true }, // 마커 보유 행
      { institution: 'C사', year: 2030, size: usd(9) }, // '$9B' 3자 — 자연폭이면 이 행 트랙이 넓어진다
    ]
    const { getAllByTestId, queryAllByTestId } = render(<MarketEstimates estimates={estimates} />)
    const rows = getAllByTestId('market-estimate-row')
    expect(rows).toHaveLength(3)

    // ① 값 span의 예약폭이 3행 모두 동일 + 자연폭에 맡기지 않았음(width 선언 존재)
    const widths = getAllByTestId('market-estimate-value').map((el) => el.style.width)
    expect(widths).toHaveLength(3)
    expect(widths[0]).not.toBe('')
    expect(new Set(widths).size).toBe(1)

    // ② 마커를 가진 행이 하나라도 있으면 마커 칸은 전 행에 존재해야 한다(한 행만 있으면 그 행 트랙이 좁아진다).
    //    숨김은 visibility로 — display:none이면 박스가 사라져 원인이 그대로 재발한다.
    const cells = [...queryAllByTestId('market-estimate-basis-marker'), ...queryAllByTestId('market-estimate-basis-slot')]
    expect(cells).toHaveLength(3)
    expect(queryAllByTestId('market-estimate-basis-marker')).toHaveLength(1)
    for (const c of queryAllByTestId('market-estimate-basis-slot')) {
      expect(c.style.visibility).toBe('hidden')
      expect(c.style.display).not.toBe('none')
    }
  })
})
