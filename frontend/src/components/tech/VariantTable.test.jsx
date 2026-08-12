import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import VariantTable, { variantTableLayout, AXES_WRAP, AXIS_LABEL, NAME_TEXT } from './VariantTable'

// task#298 S1ⓐ+S2 — 계열 비교 표. 판정축은 "축 수 · 행 수 · 특징 셀 내용" 셋 + 표 규율(minWidth·
// overflowX·nowrap 0)이다(색·실제 간격 px는 jsdom이 못 보므로 라이브 프로브 몫 — TESTING.md §9).
// tokens.css 실측(space-6=24px > space-2=8px)을 아래 SPACE_PX로 박아 간격 불변식을 수치로 대조한다.
const SPACE_PX = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24 }
const spacePx = (token) => SPACE_PX[Number(/var\(--space-(\d+)\)/.exec(token)?.[1])]

// SMR 재사용 로켓 계열 비교를 본뜬 2축 입력 — 재사용 방식(3옵션) × 발사체 등급(2옵션)
const TWO_AXES = [
  {
    axis_label: '재사용 방식',
    options: [
      { name: '수직 착륙 회수', examples: ['Falcon 9', 'New Glenn'], strength: '정비 후 재사용 왕복 단축', tradeoff: '착륙 추진제 예비량 필요' },
      { name: '낙하산 회수', examples: ['Rocket Lab Electron'], strength: '착륙 연료가 필요 없다', tradeoff: null },
      { name: '완전 소모형', examples: null, strength: null, tradeoff: '단가 절감 압박이 상시적' },
    ],
  },
  {
    axis_label: '발사체 등급',
    options: [
      { name: '중형', examples: ['Falcon 9'], strength: '수요 대응 유연성', tradeoff: '대형 위성군엔 다회 발사 필요' },
      { name: '대형', examples: ['Starship'], strength: '대량 페이로드 단가 우위', tradeoff: '개발·인증 비용이 크다' },
    ],
  },
]

describe('variantTableLayout — 순수함수', () => {
  it('① 2축 모두 유효하면 축 2개 그대로, 행 수는 유효 옵션 수와 같다', () => {
    const { axes } = variantTableLayout(TWO_AXES)
    expect(axes.length).toBe(2)
    expect(axes[0].axisLabel).toBe('재사용 방식')
    expect(axes[0].rows.length).toBe(3)
    expect(axes[1].axisLabel).toBe('발사체 등급')
    expect(axes[1].rows.length).toBe(2)
  })

  it('② examplesText는 · 로 이어붙이고, 결측·빈배열·비배열·전부공백은 null이다(빈 문자열이 아니다)', () => {
    const { axes } = variantTableLayout([{
      axis_label: '축',
      options: [
        { name: 'A', examples: ['x', 'y'] },
        { name: 'B', examples: [] },
        { name: 'C', examples: null },
        { name: 'D' },                       // examples 키 자체 없음
        { name: 'E', examples: 'not-array' },
        { name: 'F', examples: ['  ', 42, null] },
      ],
    }])
    const byName = Object.fromEntries(axes[0].rows.map((r) => [r.name, r]))
    expect(byName.A.examplesText).toBe('x · y')
    for (const n of ['B', 'C', 'D', 'E', 'F']) {
      expect(byName[n].examplesText).toBeNull()
    }
  })

  it('③ axis_label이 공백뿐이거나 결측이면 그 축을 버리고 나머지 축은 살아남는다', () => {
    const good = TWO_AXES[0]
    const { axes } = variantTableLayout([
      { axis_label: '   ', options: good.options },
      { axis_label: null, options: good.options },
      { options: good.options },              // axis_label 키 자체 없음
      good,
    ])
    expect(axes.length).toBe(1)
    expect(axes[0].axisLabel).toBe('재사용 방식')
  })

  it('④ 유효 행이 2개 미만이면 그 축을 버린다("1행 표는 비교가 아니라 서술이다")', () => {
    const oneValid = { axis_label: '축', options: [{ name: 'A' }, { name: '' }, { name: null }] }
    expect(variantTableLayout([oneValid]).axes).toEqual([])
    expect(variantTableLayout([{ axis_label: '축', options: [] }]).axes).toEqual([])
    expect(variantTableLayout([{ axis_label: '축', options: null }]).axes).toEqual([])
    expect(variantTableLayout([{ axis_label: '축' }]).axes).toEqual([])   // options 키 자체 없음
  })

  it('⑤ option의 name이 결측·공백이면 그 옵션만 버려지고 축은 나머지 유효 행으로 살아남는다', () => {
    const { axes } = variantTableLayout([{
      axis_label: '축',
      options: [{ name: 'A' }, { name: '  ' }, { name: null }, { name: 'B' }, {}],
    }])
    expect(axes.length).toBe(1)
    expect(axes[0].rows.map((r) => r.name)).toEqual(['A', 'B'])
  })

  it('⑥ strength·tradeoff는 한쪽만 있어도, 둘 다 없어도 행이 버려지지 않는다(스키마 최소 1개 요구는 백엔드 몫)', () => {
    const { axes } = variantTableLayout([{
      axis_label: '축',
      options: [
        { name: 'A', strength: '장점만' },
        { name: 'B', tradeoff: '단점만' },
        { name: 'C' },                        // 구발행물·드리프트 방어 — 둘 다 없음
      ],
    }])
    expect(axes[0].rows.length).toBe(3)
    expect(axes[0].rows.map((r) => [r.strength, r.tradeoff])).toEqual([
      ['장점만', null],
      [null, '단점만'],
      [null, null],
    ])
  })

  it('⑦ variants가 비배열·null·undefined여도 예외 없이 빈 결과', () => {
    expect(variantTableLayout()).toEqual({ axes: [] })
    expect(variantTableLayout(null)).toEqual({ axes: [] })
    expect(variantTableLayout(undefined)).toEqual({ axes: [] })
    expect(variantTableLayout('not-array')).toEqual({ axes: [] })
    expect(variantTableLayout({})).toEqual({ axes: [] })
  })

  it('⑧ 축 원소 자체가 null·비객체여도 죽지 않고 그 축만 버려진다', () => {
    const { axes } = variantTableLayout([null, undefined, 'x', 42, TWO_AXES[0]])
    expect(axes.length).toBe(1)
    expect(axes[0].axisLabel).toBe('재사용 방식')
  })
})

describe('VariantTable — 렌더', () => {
  it('⑨ axes가 비면(=variantTableLayout(...).axes.length === 0) 아무것도 렌더하지 않는다', () => {
    expect(render(<VariantTable />).container.firstChild).toBeNull()
    expect(render(<VariantTable variants={null} />).container.firstChild).toBeNull()
    expect(render(<VariantTable variants={[]} />).container.firstChild).toBeNull()
    // 모든 축이 무효(1행뿐)인 입력도 섹션째 생략
    expect(render(<VariantTable variants={[{ axis_label: '축', options: [{ name: 'A' }] }]} />)
      .container.firstChild).toBeNull()
  })

  it('⑩ 2축 입력에서 표 2개 + 소제목(axisLabel) 2개가 렌더된다', () => {
    render(<VariantTable variants={TWO_AXES} />)
    expect(screen.getAllByTestId('tech-report-variant-table').length).toBe(2)
    const axisEls = screen.getAllByTestId('tech-report-variant-axis')
    expect(axisEls.length).toBe(2)
    expect(axisEls[0].textContent).toContain('재사용 방식')
    expect(axisEls[1].textContent).toContain('발사체 등급')
  })

  it('⑪ 계열 셀 — examplesText가 있으면 이름 아래 표시되고, 없으면 · 잔여 없이 부재한다', () => {
    render(<VariantTable variants={TWO_AXES} />)
    const rows = screen.getAllByTestId('tech-report-variant-row')
    const rowFor = (name) => rows.find((r) => within(r).getByTestId('tech-report-variant-name').textContent === name)

    const vertical = rowFor('수직 착륙 회수')
    expect(within(vertical).getByTestId('tech-report-variant-examples').textContent).toBe('Falcon 9 · New Glenn')

    const consumable = rowFor('완전 소모형')                       // examples: null
    expect(within(consumable).queryByTestId('tech-report-variant-examples')).toBeNull()
    expect(consumable.textContent).not.toContain('·')
  })

  it('⑫ 특징 셀 — strength만·tradeoff만·둘 다 없음 세 경우를 각각 렌더한다', () => {
    render(<VariantTable variants={TWO_AXES} />)
    const rows = screen.getAllByTestId('tech-report-variant-row')
    const rowFor = (name) => rows.find((r) => within(r).getByTestId('tech-report-variant-name').textContent === name)

    const strengthOnly = within(rowFor('낙하산 회수')).getByTestId('tech-report-variant-feature')
    expect(strengthOnly.textContent).toContain('+ 착륙 연료가 필요 없다')
    expect(strengthOnly.textContent).not.toContain('−')

    const tradeoffOnly = within(rowFor('완전 소모형')).getByTestId('tech-report-variant-feature')
    // 완전 소모형은 examples도 null이라 이 행은 strength=null·tradeoff만 있음(TWO_AXES 픽스처 그대로)
    expect(tradeoffOnly.textContent).toContain('− 단가 절감 압박이 상시적')
    expect(tradeoffOnly.textContent).not.toContain('+')

    // 둘 다 있는 행(참조)과 둘 다 없는 행(합성 입력)도 함께 확인
    const both = within(rowFor('수직 착륙 회수')).getByTestId('tech-report-variant-feature')
    expect(both.textContent).toContain('+ 정비 후 재사용 왕복 단축')
    expect(both.textContent).toContain('− 착륙 추진제 예비량 필요')
  })

  it('⑬ strength·tradeoff 둘 다 없는 행은 특징 셀에 —만 렌더한다(레이아웃이 버리지 않는 경우)', () => {
    render(<VariantTable variants={[{
      axis_label: '축',
      options: [{ name: 'A', strength: '있음' }, { name: 'B' }],   // B: 둘 다 없음, 축은 2행이라 생존
    }]} />)
    const rows = screen.getAllByTestId('tech-report-variant-row')
    const bCell = within(rows[1]).getByTestId('tech-report-variant-feature')
    expect(bCell.textContent).toBe('—')
  })

  it('⑭ minWidth·overflowX 선언이 없고, whiteSpace:nowrap을 쓰는 요소가 없다', () => {
    const { container } = render(<VariantTable variants={TWO_AXES} />)
    const styled = container.querySelectorAll('[style]')
    expect(styled.length).toBeGreaterThan(0)
    styled.forEach((el) => {
      expect(el.style.minWidth).toBe('')
      expect(el.style.overflowX).toBe('')
      expect(el.style.whiteSpace).not.toBe('nowrap')
    })
  })

  it('⑮ 축 사이 간격이 소제목↔표 간격보다 크다(가토 ⑩ — 축은 한 덩어리, 축끼리는 분리)', () => {
    expect(spacePx(AXES_WRAP.gap)).toBeGreaterThan(spacePx(AXIS_LABEL.margin.split(' ').pop()))
  })

  it('⑯ 이름·특징 텍스트는 anywhere로 접고 break-word를 쓰지 않는다(task#296 정정 승계)', () => {
    expect(NAME_TEXT.overflowWrap).toBe('anywhere')
    expect(NAME_TEXT.overflowWrap).not.toBe('break-word')
    expect(NAME_TEXT.minWidth).toBeUndefined()
  })

  it('⑰ 라벨·이름이 중복돼도 React key 충돌 경고가 없다(CategoryGroups와 같은 함정)', () => {
    const dup = [
      { axis_label: '같은 라벨', options: [{ name: 'X' }, { name: 'X' }, { name: 'Y' }] },
      { axis_label: '같은 라벨', options: [{ name: 'Z' }, { name: 'W' }] },
    ]
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<VariantTable variants={dup} />)
    expect(errSpy).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('⑱ variants 미전달·비배열이어도 죽지 않는다', () => {
    const { unmount } = render(<VariantTable />)
    expect(screen.queryByTestId('tech-report-variants')).toBeNull()
    unmount()
    render(<VariantTable variants="not-array" />)
    expect(screen.queryByTestId('tech-report-variants')).toBeNull()
  })
})
