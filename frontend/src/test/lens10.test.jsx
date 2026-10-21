import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import LensReport, { isLensReport, LENS_INFO } from '../components/reports/LensReport'

// 렌즈 10 「위험의 전례」(위험 기저율, task#391) — 1부: 렌즈 10은 선택. 10렌즈 판과 9렌즈(옛) 판이 공존한다.
const judg = (id, signal = 'wait', extra = {}) => ({ id, summary: `요약${id}`, body: `본문${id}`, metrics: [], signal,
  flip: signal === 'na' ? null : `바뀜${id}`, na_reason: signal === 'na' ? `사유${id}` : null, ...extra })

const PRECEDENTS = [
  { case: '2001 닷컴 붕괴 후 광통신 증설', period: '2000~2002', outcome: 'realized', note: '수요 예측이 같은 방식으로 빗나갔다', ref: 'Fed 보고서 2003' },
  { case: '2011 DRAM 치킨게임', period: '2010~2012', outcome: 'partial', note: '범용 제품만 무너지고 고부가는 남았다', ref: 'SEMI 2013' },
  { case: '2017 낸드 증설', period: '2017~2018', outcome: 'not_realized', note: null, ref: 'TrendForce 2019' },
  { case: '2022 재고 조정', period: '2022~2023', outcome: 'realized', note: '같은 점: 증설 직후', ref: 'Gartner 2023' },
]
// 서버 집계값 — 렌더러는 다시 세지 않고 이 값을 그대로 그린다
const BASE_RATE = { realized: 2, partial: 1, not_realized: 1, total: 4 }

const nine = () => [1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => judg(i, i === 9 ? 'na' : 'wait'))
const TEN = {
  format: 2, title: '전례가 말하는 공급 과잉', tally: { go: 0, wait: 9, stop: 0, na: 1 },
  lenses: [...nine(), judg(10, 'wait', { risk: '증설 경쟁으로 단가가 무너진다', precedents: PRECEDENTS, base_rate: BASE_RATE })],
}
const NINE = { format: 2, title: '옛 판', tally: { go: 0, wait: 8, stop: 0, na: 1 }, lenses: nine() }
const NA10 = { ...TEN, lenses: [...nine(), judg(10, 'na', { na_reason: '비슷한 전례를 찾지 못함' })] }

const cellIds = (c) => [...c.querySelectorAll('[data-lens-cell]')].map(e => e.getAttribute('data-lens-cell'))

describe('렌즈 10 「위험의 전례」 (task#391)', () => {
  it('LENS_INFO는 발행 계약의 렌즈 id 1~10을 빠짐없이 덮는다(task#391 회고 — 렌즈 수를 바꾸면 여기와 백엔드 LensIn.id 상한을 함께)', () => {
    expect(Object.keys(LENS_INFO).map(Number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(Object.values(LENS_INFO).every(v => v.name && v.question)).toBe(true)
  })

  it('분기 게이트 — 세 픽스처 모두 v2 렌더러를 탄다', () => {
    expect([TEN, NINE, NA10].every(isLensReport)).toBe(true)
  })

  it('ⓐ 10렌즈 판: 신호판 10행 · 상세 카드에 이름·대상 위험·서버 집계 캡션·사례 행 수 == precedents', () => {
    const { container } = render(<LensReport report={TEN} />)
    expect(cellIds(container)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'])
    const card = container.querySelector('#lens-10')
    expect(card.querySelector('[data-lens-detail-name="10"]').textContent).toBe('위험의 전례')
    expect(card.querySelector('[data-lens10-risk]').textContent).toContain('증설 경쟁으로 단가가 무너진다')
    expect(card.querySelector('[data-base-rate-caption]').textContent)
      .toBe('전례 4건 중 현실화 2 · 부분 현실화 1 · 비현실화 1')
    // 비율 막대 — 결과별 칸이 서버 건수 비율로(0건 결과는 칸이 없다)
    const segs = [...card.querySelectorAll('[data-outcome-seg]')].map(s => [s.getAttribute('data-outcome-seg'), s.style.flexGrow])
    expect(segs).toEqual([['realized', '2'], ['partial', '1'], ['not_realized', '1']])
    expect(card.querySelectorAll('[data-precedent]').length).toBe(PRECEDENTS.length)
    // 결과 배지는 라벨로도 말한다(색만으로 말하지 않는다)
    expect(card.querySelector('[data-precedent="1"]').textContent).toContain('부분 현실화')
    // 9렌즈 안내는 10렌즈 판에 없다
    expect(container.querySelector('[data-lens10-absent]')).toBeNull()
  })

  it('ⓑ 사례 행을 누르면 같은 점·다른 점(note)과 출처(ref)가 보인다', () => {
    const { container } = render(<LensReport report={TEN} />)
    const row = container.querySelector('[data-precedent="0"]')
    expect(row.textContent).not.toContain('Fed 보고서 2003')
    const btn = row.querySelector('button')
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(row.textContent).toContain('수요 예측이 같은 방식으로 빗나갔다')
    expect(row.textContent).toContain('Fed 보고서 2003')
    // note 없는 사례도 출처는 보인다
    const row2 = container.querySelector('[data-precedent="2"]')
    fireEvent.click(row2.querySelector('button'))
    expect(row2.textContent).toContain('TrendForce 2019')
  })

  it('ⓒ 9렌즈 판: 렌즈 10 행·카드 없음 + 「렌즈 10 도입 전」 안내 1줄', () => {
    const { container } = render(<LensReport report={NINE} />)
    expect(cellIds(container)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9'])
    expect(container.querySelector('#lens-10')).toBeNull()
    const notes = container.querySelectorAll('[data-lens10-absent]')
    expect(notes.length).toBe(1)
    expect(notes[0].textContent).toContain('렌즈 10 도입 전')
    expect(screen.getByTestId('lens-tally').textContent).toMatch(/노랑\s*8.*미산출\s*1/)
  })

  it('ⓓ na 렌즈 10: 막대·사례 없이 미산출 사유', () => {
    const { container } = render(<LensReport report={NA10} />)
    expect(cellIds(container)).toContain('10')
    expect(container.querySelector('[data-lens-cell="10"]').textContent).toContain('미산출 사유: 비슷한 전례를 찾지 못함')
    const card = container.querySelector('#lens-10')
    expect(card).not.toBeNull()
    expect(card.querySelector('[data-base-rate-caption]')).toBeNull()
    expect(card.querySelectorAll('[data-precedent]').length).toBe(0)
    expect(container.querySelector('[data-lens10-absent]')).toBeNull()
  })
})
