import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import ProseSections from './ProseSections'

// task#280 S4 — 산문 접기 렌더 계약. 절대 조건은 정보 손실 0이다:
// jsdom은 details를 숨기지 않으므로 "보이는가"는 여기서 잴 수 없다 — 열림 상태는 details.open으로,
// 손실 0은 textContent 포함으로 단언한다(라이브 가시성은 S6 프로브 몫).

const FOUR = `[기술 개요]
SMR은 소형 모듈 원자로다.

이어지는 문단.

[어디까지 왔나]
중국 링룽이 세계 1호다.

[시장 규모]
2030년까지 성장한다.

[투자 관점]
현금은 주기기 공급망에서 나온다.`

const titles = (c) => [...c.querySelectorAll('summary')].map((s) => s.textContent)

describe('ProseSections — task#280 S4 산문 접기', () => {
  it('① 대괄호 4섹션 → 소제목 4개가 목차로 렌더되고 첫 섹션만 펼쳐진다', () => {
    const { container, getAllByTestId } = render(<ProseSections description={FOUR} />)

    const sections = getAllByTestId('tech-prose-section')
    expect(sections).toHaveLength(4)
    expect(titles(container)).toEqual(['기술 개요', '어디까지 왔나', '시장 규모', '투자 관점'])
    // task#280 S4 뒤집음: 완료기준엔 이 열림상태가 없었고(파싱 4케이스만) 근거는
    // "접혀도 소제목 4줄이 목차로 읽힌다"였다 — 전부 접기는 그 의도를 밀어붙이는 것(부수적 단언, #264).
    expect(sections.map((d) => d.open)).toEqual([false, false, false, false])
  })

  it('① 손실 0: 접힌 섹션의 본문까지 전부 DOM에 남고 원문 줄바꿈(pre-wrap)이 보존된다', () => {
    const { container, getAllByTestId } = render(<ProseSections description={FOUR} />)

    for (const line of ['SMR은 소형 모듈 원자로다.', '이어지는 문단.', '중국 링룽이 세계 1호다.',
      '2030년까지 성장한다.', '현금은 주기기 공급망에서 나온다.']) {
      expect(container.textContent).toContain(line)
    }
    // 첫 섹션 본문은 빈 줄로 분리된 두 문단 — pre-wrap이 없으면 한 덩어리로 뭉친다
    const body = getAllByTestId('tech-prose-section')[0].querySelector('p')
    expect(body.style.whiteSpace).toBe('pre-wrap')
    expect(body.textContent).toBe('SMR은 소형 모듈 원자로다.\n\n이어지는 문단.')
  })

  it('② 대괄호 없는 통짜 입력 → 1섹션에 전문이 그대로 보존되고, 접을 소제목이 없으므로 접지 않는다', () => {
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

  it('④ rationale만 있고 description이 비면 「기술난이도 근거」 항목 하나만 렌더된다(펼친 채)', () => {
    const { container, getAllByTestId, queryAllByTestId } = render(
      <ProseSections description="" rationale="핵심 난제는 규제 승인이다." />
    )

    const sections = getAllByTestId('tech-prose-section')
    expect(sections).toHaveLength(1)
    expect(titles(container)).toEqual(['기술난이도 근거'])
    // task#280 S4 뒤집음: 소제목 있는 섹션은 전부 접힘으로 시작 — rationale도 예외 아님(#264).
    expect(sections[0].open).toBe(false)
    expect(sections[0].textContent).toContain('핵심 난제는 규제 승인이다.')
    expect(queryAllByTestId('tech-prose-plain')).toHaveLength(0)
  })

  it('rationale은 산문 섹션들 뒤에 같은 형태로 덧붙고 접힌 채 시작한다', () => {
    const { container, getAllByTestId } = render(<ProseSections description={FOUR} rationale="근거 문단." />)

    const sections = getAllByTestId('tech-prose-section')
    expect(sections).toHaveLength(5)
    expect(titles(container)[4]).toBe('기술난이도 근거')
    // task#280 S4 뒤집음: 첫 섹션도 더 이상 예외로 펼쳐지지 않는다(#264, 위 이유 동일).
    expect(sections.map((d) => d.open)).toEqual([false, false, false, false, false])
  })

  it('첫 헤딩 앞 선행 문단은 버려지지 않고 접히지도 않는다(항상 보이는 문단) — 소제목 섹션은 접힌다', () => {
    const { getByTestId, getAllByTestId } = render(
      <ProseSections description={'서두 문단이다.\n\n[본론]\n본론 내용.'} />
    )

    expect(getByTestId('tech-prose-plain').textContent).toBe('서두 문단이다.')
    const sections = getAllByTestId('tech-prose-section')
    expect(sections).toHaveLength(1)
    // task#280 S4 뒤집음: 선행 문단은 여전히 항상 보이는 <p>지만, 소제목 있는 섹션은 이제 접힌다(#264).
    expect(sections[0].open).toBe(false)
  })
})

// 주: ProseSections의 "파서가 0섹션을 주면 전문 되살리기" 안전망은 *현 파서로는 도달 불가*라
// 테스트를 두지 않았다 — 통과할 수 없는 경로를 단언하면 공허한 초록만 남는다(가토 ⑧ⓜ).
// parseDescriptionSections가 바뀌어 도달 가능해지면 그때 케이스를 추가할 것.
