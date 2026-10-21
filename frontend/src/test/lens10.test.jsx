import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import LensReport, { isLensReport, LENS_INFO } from '../components/reports/LensReport'

// 렌즈 10 「위험의 전례」(위험 기저율, task#391) — task#392부터 새 판에 필수. 10렌즈 판과 그 이전의 9렌즈(옛) 판이 공존한다.
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

  it('ⓔ 사례 행 머리는 모든 행에서 2줄 — head(제목) 1개 · meta(배지+기간) 1개, 배지·기간은 head에 없다(task#395)', () => {
    const { container } = render(<LensReport report={TEN} />)
    const rows = [...container.querySelectorAll('#lens-10 [data-precedent]')]
    expect(rows.length).toBe(PRECEDENTS.length)
    rows.forEach((row, i) => {
      const heads = row.querySelectorAll('[data-precedent-head]')
      const metas = row.querySelectorAll('[data-precedent-meta]')
      expect([heads.length, metas.length]).toEqual([1, 1])
      const label = { realized: '현실화', partial: '부분 현실화', not_realized: '비현실화' }[PRECEDENTS[i].outcome]
      expect(heads[0].textContent).toContain(PRECEDENTS[i].case)
      expect(heads[0].textContent).not.toContain(PRECEDENTS[i].period)
      expect(heads[0].textContent).not.toContain(label)
      expect(metas[0].querySelector('.badge')?.textContent).toBe(label)
      expect(metas[0].textContent).toContain(PRECEDENTS[i].period)
      // 기간은 mono가 아니다(자간 벌어짐 제거)
      expect([...metas[0].querySelectorAll('.mono')].length).toBe(0)
    })
  })

  it('ⓕ 펼침 — 「같은 점: A. 다른 점: B.」는 라벨 열로 나뉘고, 표지 없는 note는 라벨 없이 원문 그대로(task#395)', () => {
    const split = { case: '분리 사례', period: '2019~2020', outcome: 'partial', note: '같은 점: 증설이 수요를 앞질렀다. 다른 점: 이번엔 장기 계약이 있다.', ref: '출처 S' }
    const diffOnly = { case: '다른 점만', period: '2015', outcome: 'realized', note: '다른 점: 금리 환경이 반대였다', ref: '출처 D' }
    const rep = { ...TEN, lenses: [...nine(), judg(10, 'wait', { risk: 'r', precedents: [split, PRECEDENTS[0], diffOnly, PRECEDENTS[3]], base_rate: { realized: 3, partial: 1, not_realized: 0, total: 4 } })] }
    const { container } = render(<LensReport report={rep} />)
    const rows = [...container.querySelectorAll('#lens-10 [data-precedent]')]
    rows.forEach(r => fireEvent.click(r.querySelector('button')))
    // ⓐ 두 표지 → 같은 점·다른 점이 각각 제 칸에, 마침표·공백 정리
    expect(rows[0].querySelector('[data-precedent-same]').textContent).toBe('증설이 수요를 앞질렀다')
    expect(rows[0].querySelector('[data-precedent-diff]').textContent).toBe('이번엔 장기 계약이 있다')
    expect(rows[0].textContent).toContain('출처 S')
    // ⓑ 표지 없는 note → 원문 그대로, 「같은 점」 라벨 0회
    expect(rows[1].querySelector('[data-precedent-note]').textContent).toBe('수요 예측이 같은 방식으로 빗나갔다')
    expect(rows[1].querySelector('[data-precedent-same]')).toBeNull()
    expect(rows[1].textContent).not.toContain('같은 점')
    expect(rows[1].textContent).not.toContain('다른 점')
    // 한쪽 표지만 → 그쪽만 라벨
    expect(rows[2].querySelector('[data-precedent-diff]').textContent).toBe('금리 환경이 반대였다')
    expect(rows[2].querySelector('[data-precedent-same]')).toBeNull()
    expect(rows[2].textContent).not.toContain('같은 점')
    expect(rows[3].querySelector('[data-precedent-same]').textContent).toBe('증설 직후')
    expect(rows[3].querySelector('[data-precedent-diff]')).toBeNull()
    // ⓒ 어떤 경우에도 옛 바깥 라벨 「같은 점·다른 점」 0회
    expect(container.querySelector('#lens-10').textContent).not.toContain('같은 점·다른 점')
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
