import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import TechGraph from './TechGraph'

// task#317 — 3열 SVG DAG를 **세로 흐름 HTML**로 재작성(ADR-0033 결정4 · ADR-0034 보정④ 뒤집기).
// 옛 테스트 16건 중 10건(techGraphLayout 좌표 불변식)과 3건(폴드·aria-hidden svg·sr-only 목록)은
// 대상 자체가 사라져 삭제, 1건(title 폴백)은 「말줄임이 없다」로 재작성, 2건(칩·null)은 유지.
//
// ⚠️ jsdom의 한계를 알고 짠다 — CSS import는 vitest에서 스텁이라 `.badge{white-space:nowrap}`이
//    적용되지 않고, 레이아웃이 없어 실제 줄바꿈·min-content·넘침은 **원리적으로 못 본다**.
//    그래서 ④는 「인라인 선언이 존재한다」까지만 잴 수 있다(이 저장소의 fixture-pass-live-fail 가족).
//    실제 리플로우는 scripts/uat282-tech-structure.mjs의 라이브 4축이 잰다 — 그것이 그 축의 존재 이유다.

// 라이브 최장 기술명(2026-08-20 실측, robotics) — 26자. 133.6px 노드에서 11자로 잘리던 바로 그 이름.
const LONGEST = '전신제어(loco-manipulation) 정책'

const FULL = {
  prerequisites: ['리튬 정제', '황화물계 고체전해질(Li6PS5Cl 등) 합성'],
  derivatives: ['전고체 셀', LONGEST],
  complements: ['냉매 기술'],
  competitors: ['화학전지'],
}

const chipsOf = (c) => [...c.querySelectorAll('.badge')]
const countIn = (text, needle) => text.split(needle).length - 1

describe('TechGraph — 세로 흐름 리플로우 계약', () => {
  it('① 자체 가로 스크롤러가 없다 — overflowX 선언 0 · minWidth 0', () => {
    const { container } = render(<TechGraph related={FULL} target="전고체 배터리" />)
    const all = [...container.querySelectorAll('*')]
    expect(all.length).toBeGreaterThan(0) // 커버리지 sentinel — 정의역이 비면 아래가 공허하게 통과한다
    expect(all.filter((el) => el.style.overflowX)).toEqual([])
    expect(all.filter((el) => el.style.overflowY)).toEqual([])
    expect(all.filter((el) => el.style.minWidth)).toEqual([])
    // 적대 리뷰 LOW-1: minWidth만 보면 `width:'640px'` 고정폭을 통과시킨다. 현재 인라인 width 선언은 0건.
    expect(all.filter((el) => el.style.width)).toEqual([])
  })

  it('② DOM 순서 = 전제·선행 → 대상 → 파생·응용 → 보완 → 경합', () => {
    const { container } = render(<TechGraph related={FULL} target="전고체 배터리" />)
    const order = [...container.querySelectorAll('[data-group],[data-testid="tech-graph-complements"],[data-testid="tech-graph-competitors"]')]
      .map((el) => el.dataset.group || el.dataset.testid.replace('tech-graph-', ''))
    expect(order).toEqual(['prerequisites', 'target', 'derivatives', 'complements', 'competitors'])
  })

  it('③ 캡·폴드·말줄임이 없다 — 6개 입력은 6개 전부 렌더되고 26자 이름이 전문 그대로 나온다', () => {
    const related = { prerequisites: ['a', 'b', 'c', 'd', 'e', 'f'], derivatives: [LONGEST] }
    const { container } = render(<TechGraph related={related} target="T" />)
    const preGroup = container.querySelector('[data-group="prerequisites"]')
    expect(preGroup.querySelectorAll('[data-testid="tech-graph-item"]')).toHaveLength(6)
    expect(container.textContent).not.toMatch(/\+\d+개/)
    expect(container.textContent).not.toContain('…')
    expect(container.textContent).toContain(LONGEST) // 전문 — 잘린 접두사가 아니다
  })

  it('④ 모든 칩이 줄바꿈 가능하다 — whiteSpace가 nowrap이 아니고 overflowWrap이 anywhere', () => {
    const { container } = render(<TechGraph related={FULL} target="전고체 배터리" />)
    const chips = chipsOf(container)
    expect(chips.length).toBe(7) // sentinel: 전제2 + 대상1 + 파생2 + 보완1 + 경합1 (라벨 span은 .badge가 아니다)
    chips.forEach((chip) => {
      expect(chip.style.whiteSpace).toBe('normal')
      expect(chip.style.overflowWrap).toBe('anywhere')
    })
  })

  it('⑤ 같은 기술명이 문서에 두 번 나오지 않는다(sr-only 이중 목록 제거)', () => {
    const { container } = render(<TechGraph related={FULL} target="전고체 배터리" />)
    const text = container.textContent
    const names = [...FULL.prerequisites, ...FULL.derivatives, ...FULL.complements, ...FULL.competitors, '전고체 배터리']
    // 「전고체 셀」은 「전고체 배터리」의 부분문자열이 아니므로 부분일치 오계수가 없다(직접 확인).
    // ⚠️ 이 축이 금지하는 것은 **sr-only 이중 노출**이며, *다른 키 사이* 중복은 아니다 — 라이브에는
    //    `prerequisites` ↔ `complements`에 같은 이름이 정당하게 있다(2026-08-20 실측 2건: ai-datacenter-ops
    //    「AI 데이터센터 설비」· solid-state-battery 「건식 전극 공정」). 픽스처는 그 교차 중복을 담지 않는다.
    names.forEach((n) => expect(countIn(text, n)).toBe(1))
  })

  it('⑥ related·target 전부 비면 아무것도 렌더하지 않는다(null)', () => {
    const { container } = render(<TechGraph related={{}} />)
    expect(container.firstChild).toBeNull()
  })

  it('⑦ 방향 마커는 aria-hidden이고 접근 가능 텍스트를 만들지 않는다', () => {
    const { container } = render(<TechGraph related={FULL} target="전고체 배터리" />)
    const arrows = [...container.querySelectorAll('[aria-hidden="true"]')]
    expect(arrows.length).toBeGreaterThan(0) // sentinel — 마커가 하나도 없으면 아래가 공허하다
    arrows.forEach((el) => expect(el.textContent).toMatch(/^[↓\s]*$/))
    // 그룹 라벨은 장식이 아니라 구조 정보이므로 aria-hidden이 아니어야 한다.
    // ⚠️ 적대 리뷰 MED-3: `textContent`는 aria-hidden을 무시하므로 텍스트 존재만으로는 이걸 못 잰다
    //    (라벨에 실수로 aria-hidden이 붙어도 통과한다). 라벨 엘리먼트의 속성을 직접 단언한다.
    // `> span`만 쓰면 화살표 span까지 잡힌다(둘 다 그룹 li의 직계 자식) — 라벨은 첫 자식이다.
    const labels = [...container.querySelectorAll('[data-group] > span:first-child')]
    expect(labels.map((el) => el.textContent)).toEqual(['전제·선행', '대상 기술', '파생·응용'])
    labels.forEach((el) => expect(el.getAttribute('aria-hidden')).not.toBe('true'))
  })

  it('보완/경합 기술은 별도 칩 그룹으로 남는다(방향 없는 관계 — ADR-0033 결정4의 구별은 유지)', () => {
    const related = { complements: ['냉매 기술'], competitors: ['화학전지'] }
    const { getByText, queryByTestId } = render(<TechGraph related={related} target="SMR" />)
    expect(getByText('보완 기술')).toBeTruthy()
    expect(getByText('냉매 기술')).toBeTruthy()
    expect(getByText('경합 기술')).toBeTruthy()
    expect(getByText('화학전지')).toBeTruthy()
    expect(queryByTestId('tech-graph-flow')).toBeTruthy() // target만 있어도 흐름은 그려진다
  })
})
