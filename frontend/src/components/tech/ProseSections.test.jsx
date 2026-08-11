import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import ProseSections from './ProseSections'
import { parseDescriptionSections } from '../reports/techReportUtils'

// task#296 S2 — 산문 펼치기 제거 렌더 계약. 절대 조건은 정보 손실 0이다:
// 소제목은 항상 보이는 <h3>, 본문은 \n\n 기준 문단별 <p>. 손실 0은 textContent 포함/글자수 보존으로
// 단언한다(라이브 스크롤·목차 항해는 S6 프로브 몫).
//
// task#264 절차 준수: 아래 "펼침/접힘" 관련 옛 단언 4건은 task#280 S4가 기록한 결정(전부 접힘으로
// 시작)을 뒤집는다 — 뒤집는 근거는 그 결정 자체가 아니라 task#296 계획(사용자 결정: 스크롤+전역
// 목차로 항해를 대신하므로 접기가 더 이상 필요 없다)이다. 삭제하지 않고 동작 기준으로 교체한다.

const FOUR = `[기술 개요]
SMR은 소형 모듈 원자로다.

이어지는 문단.

[어디까지 왔나]
중국 링룽이 세계 1호다.

[시장 규모]
2030년까지 성장한다.

[투자 관점]
현금은 주기기 공급망에서 나온다.`

const titles = (c) => [...c.querySelectorAll('h3')].map((h) => h.textContent)

describe('ProseSections — task#296 S2 펼치기 제거 + 문단 분리', () => {
  it('① 대괄호 4섹션 → 소제목 4개가 h3로 렌더되고 details 요소가 0개다(전부 항상 보임)', () => {
    const { container, getAllByTestId } = render(<ProseSections description={FOUR} />)

    const sections = getAllByTestId('tech-prose-section')
    expect(sections).toHaveLength(4)
    expect(titles(container)).toEqual(['기술 개요', '어디까지 왔나', '시장 규모', '투자 관점'])
    // task#296 뒤집음(#264): task#280 S4는 "전부 접힘으로 시작"을 기록했으나, 이제 접기 자체가
    // 없다 — 스크롤 + 전역 목차가 항해를 대신한다(사용자 결정, task#296 plan.md).
    expect(container.querySelectorAll('details')).toHaveLength(0)
    expect(container.querySelectorAll('summary')).toHaveLength(0)
  })

  it('① 손실 0: 문단이 분리돼도 본문 전체가 DOM에 남고, 문단 안 줄바꿈(pre-wrap)이 보존된다', () => {
    const { container, getAllByTestId } = render(<ProseSections description={FOUR} />)

    for (const line of ['SMR은 소형 모듈 원자로다.', '이어지는 문단.', '중국 링룽이 세계 1호다.',
      '2030년까지 성장한다.', '현금은 주기기 공급망에서 나온다.']) {
      expect(container.textContent).toContain(line)
    }
    // 첫 섹션 본문은 빈 줄로 분리된 두 문단 — \n\n 기준으로 별도 <p> 2개가 된다(구조 계약 ③).
    const firstSection = getAllByTestId('tech-prose-section')[0]
    const paragraphs = [...firstSection.querySelectorAll('p')]
    expect(paragraphs).toHaveLength(2)
    expect(paragraphs.map((p) => p.textContent)).toEqual(['SMR은 소형 모듈 원자로다.', '이어지는 문단.'])
    // pre-wrap은 문단 *안* 단일 줄바꿈 보존용으로 각 <p>에 유지된다(문단 사이 \n\n 소실은 허용).
    for (const p of paragraphs) expect(p.style.whiteSpace).toBe('pre-wrap')
  })

  it('② 대괄호 없는 통짜 입력 → 1섹션에 전문이 그대로 보존되고, 소제목이 없어 section이 생기지 않는다', () => {
    const text = '헤딩 없이 흐르는 산문이다.\n두 번째 줄도 있다.'
    const { getByTestId, queryAllByTestId } = render(<ProseSections description={text} />)

    expect(getByTestId('tech-prose-plain').textContent).toBe(text)
    expect(queryAllByTestId('tech-prose-section')).toHaveLength(0)
  })

  it('③ 빈 입력(없음·빈 문자열·공백)이면 아무것도 렌더하지 않는다 — 섹션째 생략', () => {
    expect(render(<ProseSections />).container.firstChild).toBeNull()
    expect(render(<ProseSections description="" rationale="" />).container.firstChild).toBeNull()
    expect(render(<ProseSections description={'   \n  '} rationale={'  '} />).container.firstChild).toBeNull()
  })

  it('④ rationale만 있고 description이 비면 「기술난이도 근거」 항목 하나만 항상 보이는 채 렌더된다', () => {
    const { container, getAllByTestId, queryAllByTestId } = render(
      <ProseSections description="" rationale="핵심 난제는 규제 승인이다." />
    )

    const sections = getAllByTestId('tech-prose-section')
    expect(sections).toHaveLength(1)
    expect(titles(container)).toEqual(['기술난이도 근거'])
    // task#296 뒤집음(#264): "접힌 채 시작"은 더 이상 성립하지 않는다 — details 자체가 없다.
    expect(container.querySelectorAll('details')).toHaveLength(0)
    expect(sections[0].textContent).toContain('핵심 난제는 규제 승인이다.')
    expect(queryAllByTestId('tech-prose-plain')).toHaveLength(0)
  })

  it('rationale은 산문 섹션들 뒤에 같은 형태로 덧붙고 항상 보이는 채 렌더된다', () => {
    const { container, getAllByTestId } = render(<ProseSections description={FOUR} rationale="근거 문단." />)

    const sections = getAllByTestId('tech-prose-section')
    expect(sections).toHaveLength(5)
    expect(titles(container)[4]).toBe('기술난이도 근거')
    // task#296 뒤집음(#264): 5섹션 전부 details 없이 항상 보인다.
    expect(container.querySelectorAll('details')).toHaveLength(0)
  })

  it('첫 헤딩 앞 선행 문단은 버려지지 않고, 소제목 섹션도 항상 보인다', () => {
    const { getByTestId, getAllByTestId, container } = render(
      <ProseSections description={'서두 문단이다.\n\n[본론]\n본론 내용.'} />
    )

    expect(getByTestId('tech-prose-plain').textContent).toBe('서두 문단이다.')
    const sections = getAllByTestId('tech-prose-section')
    expect(sections).toHaveLength(1)
    // task#296 뒤집음(#264): 선행 문단은 원래도 항상 보였고, 이제 소제목 섹션도 접히지 않는다.
    expect(container.querySelectorAll('details')).toHaveLength(0)
  })

  it('⑤ 소제목마다 유일한 id를 갖는다(동일 소제목이 중복돼도 충돌하지 않는다)', () => {
    // "[개요]"가 두 번 등장하는 인공 입력 — 실 데이터에 없는 경우까지 방어하는지 확인.
    const dup = '[개요]\n첫 번째.\n\n[개요]\n두 번째.'
    const { container, getAllByTestId } = render(<ProseSections description={dup} rationale="근거." />)

    const sections = getAllByTestId('tech-prose-section')
    expect(sections).toHaveLength(3) // 개요×2 + 기술난이도 근거
    const ids = sections.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    // CSS 셀렉터·href로 안전: letter로 시작 + 공백·따옴표·`#.:[]<>` 등 셀렉터 특수문자 없음
    // (한글은 CSS ident에서 unescape 허용이라 남아 있어도 안전).
    for (const id of ids) {
      expect(id).toMatch(/^[a-zA-Z][^\s"'#.:[\]<>]*$/)
      expect(container.querySelector('#' + id)).not.toBeNull()
      // 산문 소제목은 `data-tech-anchor`다 — `data-tech-section`은 전역 목차가 가리키는 상위 섹션
      // 전용이다(둘을 같은 속성으로 두면 `[data-tech-section]` 개수가 목차 칩 수와 달라져 소비처마다
      // 11-id 리터럴 필터가 필요해진다). scroll-margin CSS는 두 속성을 함께 잡는다(TechReport.css).
      expect(container.querySelector(`[data-tech-anchor="${id}"]`)).toBe(container.querySelector('#' + id))
      expect(container.querySelector(`[data-tech-section="${id}"]`)).toBeNull()
    }
  })

  it('⑥ 손실 0: 소제목·문단이 나뉘어도 렌더 텍스트에 원문 글자가 하나도 빠지지 않는다', () => {
    const rationale = '근거 문단.'
    const { container } = render(<ProseSections description={FOUR} rationale={rationale} />)

    const stripWs = (s) => s.replace(/\s+/g, '')
    const parsed = parseDescriptionSections(FOUR)
    const expected = parsed.map((s) => stripWs(s.title) + stripWs(s.body)).join('')
      + stripWs('기술난이도 근거') + stripWs(rationale)
    expect(stripWs(container.textContent)).toBe(expected)
  })
})

// 주: ProseSections의 "파서가 0섹션을 주면 전문 되살리기" 안전망은 *현 파서로는 도달 불가*라
// 테스트를 두지 않았다 — 통과할 수 없는 경로를 단언하면 공허한 초록만 남는다(가토 ⑧ⓜ).
// parseDescriptionSections가 바뀌어 도달 가능해지면 그때 케이스를 추가할 것.
