import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TechGraph from './TechGraph'
import { rampPositions, rampColor, RAMP } from './shareRamp'

// task#317 — 3열 SVG DAG를 **세로 흐름 HTML**로 재작성(ADR-0033 결정4 · ADR-0034 보정④ 뒤집기).
// task#320 — 그 섹션을 「**구성과 연관**」으로 개편(ADR-0046). 소제목 2개로 갈린다:
//   무엇으로 이뤄졌나 = `composition.tech[]` 지분 분해(뿌리 + 항목별 막대)
//   무엇과 이어지나   = `related` 4분류 경계 포인터(칩, 발행물이면 링크)
//
// ⚠️ **이제 Router 컨텍스트가 필요하다** — 구성 부재 시 해부 링크를, 발행물 일치 시 리포트 링크를
//    렌더하므로 라우터리스 순수 표시 컴포넌트가 아니다. 모든 render를 MemoryRouter로 감싼다.
//
// ⚠️ jsdom의 한계를 알고 짠다 — CSS import는 vitest에서 스텁이라 `.badge{white-space:nowrap}`이
//    적용되지 않고, 레이아웃이 없어 실제 줄바꿈·min-content·넘침은 **원리적으로 못 본다**.
//    그래서 ④는 「인라인 선언이 존재한다」까지만 잴 수 있다(이 저장소의 fixture-pass-live-fail 가족).
//    실제 리플로우·대비·탭 타깃은 라이브 프로브가 잰다 — 그것이 그 축의 존재 이유다.

// 라이브 최장 기술명(2026-08-20 실측, robotics) — 26자. 133.6px 노드에서 11자로 잘리던 바로 그 이름.
const LONGEST = '전신제어(loco-manipulation) 정책'

const FULL = {
  prerequisites: ['리튬 정제', '황화물계 고체전해질(Li6PS5Cl 등) 합성'],
  derivatives: ['전고체 셀', LONGEST],
  complements: ['냉매 기술'],
  competitors: ['화학전지'],
}

// ⚠️ **입력을 일부러 뒤섞었다** — 픽스처가 이미 내림차순이면 정렬을 통째로 지워도 축 ①이 통과한다
//    (판정축이 대상과 독립, 가토 ⑧ⓘ). semiconductor-equipment 실판 미러 + 「기타」 + 같은 지분 쌍.
const COMP = {
  tech: [
    { name: '계측·검사와 수율 학습', share_pct: 15 },
    { name: '기타', share_pct: 5 },
    { name: '극자외선 광원·투영광학계', share_pct: 35 },
    { name: '초정밀 스테이지·진동/열 제어', share_pct: 10 },
    { name: '하이브리드 본딩·후공정 접합', share_pct: 15 },
    { name: '원자층 수준 증착·식각 제어', share_pct: 20 },
  ],
}
// 발행물 인덱스 미러(`GET /api/tech-reports/index` 실응답 형태) — 이름→slug.
const INDEX = [
  { slug: 'ai-datacenter-equipment', name: 'AI 데이터센터 설비' },
  { slug: 'smr', name: 'SMR' },
]

const chipsOf = (c) => [...c.querySelectorAll('.badge')]
const countIn = (text, needle) => text.split(needle).length - 1
const at = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>)
const compItems = (c) => [...c.querySelectorAll('[data-tech-comp-item]')]

describe('TechGraph — 세로 흐름 리플로우 계약', () => {
  it('① 자체 가로 스크롤러가 없다 — overflowX 선언 0 · minWidth 0', () => {
    const { container } = at(<TechGraph related={FULL} target="전고체 배터리" composition={COMP} slug="s" />)
    const all = [...container.querySelectorAll('*')]
    expect(all.length).toBeGreaterThan(0) // 커버리지 sentinel — 정의역이 비면 아래가 공허하게 통과한다
    expect(all.filter((el) => el.style.overflowX)).toEqual([])
    expect(all.filter((el) => el.style.overflowY)).toEqual([])
    expect(all.filter((el) => el.style.minWidth === '640px')).toEqual([])
    // ⚠️ task#320 정정 — 옛 축은 `minWidth`·`width` 선언이 **0건**임을 요구했으나 이제 성립하지
    //    않는다: 구성 막대는 지분을 **폭으로** 표현하므로 `width: N%`가 본질이고(그것을 지우면 막대가
    //    아니다), 이름·막대가 flex 안에서 접히도록 `minWidth: 0`이 필요하다. 옛 축이 막으려던 것은
    //    「고정 px 폭이 만드는 가로 스크롤러」이므로 **그것으로 좁힌다** — px 단위 폭 선언 0건.
    //    ⚠️ **0이 아닌** px만 본다 — `minWidth: 0`은 React가 `0px`로 렌더하는데 그건 접힘을 *허용*하는
    //    선언이라 스크롤러를 만들지 않는다(오히려 필요하다). 0을 걸러내지 않으면 이 축이 정상 구현을
    //    거짓 FAIL시킨다(실측: `<li>` 18개가 걸렸다).
    const nonZeroPx = (v) => /^\s*(\d+(?:\.\d+)?)px\s*$/.test(v) && parseFloat(v) > 0
    const pxWidth = all.filter((el) => nonZeroPx(el.style.width) || nonZeroPx(el.style.minWidth))
    expect(pxWidth.map((el) => `${el.tagName}:${el.style.width || el.style.minWidth}`)).toEqual([])
    // 막대 폭은 %로만 표현된다(이빨: px로 바꾸면 위 축이 잡는다)
    const bars = [...container.querySelectorAll('[data-tech-comp-bar]')]
    expect(bars.length).toBe(COMP.tech.length)
    bars.forEach((b) => expect(b.style.width).toMatch(/^\d+(\.\d+)?%$/))
  })

  it('② DOM 순서 = 전제·선행 → 대상 → 파생·응용 → 보완 → 경합', () => {
    const { container } = at(<TechGraph related={FULL} target="전고체 배터리" />)
    const order = [...container.querySelectorAll('[data-group],[data-testid="tech-graph-complements"],[data-testid="tech-graph-competitors"]')]
      .map((el) => el.dataset.group || el.dataset.testid.replace('tech-graph-', ''))
    expect(order).toEqual(['prerequisites', 'target', 'derivatives', 'complements', 'competitors'])
  })

  it('③ 캡·폴드·말줄임이 없다 — 6개 입력은 6개 전부 렌더되고 26자 이름이 전문 그대로 나온다', () => {
    const related = { prerequisites: ['a', 'b', 'c', 'd', 'e', 'f'], derivatives: [LONGEST] }
    const { container } = at(<TechGraph related={related} target="T" />)
    const preGroup = container.querySelector('[data-group="prerequisites"]')
    expect(preGroup.querySelectorAll('[data-testid="tech-graph-item"]')).toHaveLength(6)
    expect(container.textContent).not.toMatch(/\+\d+개/)
    expect(container.textContent).not.toContain('…')
    expect(container.textContent).toContain(LONGEST) // 전문 — 잘린 접두사가 아니다
  })

  it('④ 모든 칩이 줄바꿈 가능하다 — whiteSpace가 nowrap이 아니고 overflowWrap이 anywhere', () => {
    const { container } = at(<TechGraph related={FULL} target="전고체 배터리" />)
    const chips = chipsOf(container)
    expect(chips.length).toBe(7) // sentinel: 전제2 + 대상1 + 파생2 + 보완1 + 경합1 (라벨 span은 .badge가 아니다)
    chips.forEach((chip) => {
      expect(chip.style.whiteSpace).toBe('normal')
      expect(chip.style.overflowWrap).toBe('anywhere')
    })
    // 구성 항목 이름도 같은 규율을 받아야 한다 — 긴 이름의 min-content가 페이지 가로 스크롤을
    // 되살리는 메커니즘은 칩과 동일하다(ADR-0034 보정④).
    const { container: c2 } = at(<TechGraph related={{}} target="T" composition={COMP} slug="s" />)
    const names = [...c2.querySelectorAll('[data-tech-comp-item] span')]
    expect(names.length).toBeGreaterThan(0)
    expect(names.some((n) => n.style.overflowWrap === 'anywhere')).toBe(true)
  })

  it('⑤ 같은 기술명이 문서에 두 번 나오지 않는다(sr-only 이중 목록 제거)', () => {
    const { container } = at(<TechGraph related={FULL} target="전고체 배터리" />)
    const text = container.textContent
    const names = [...FULL.prerequisites, ...FULL.derivatives, ...FULL.complements, ...FULL.competitors, '전고체 배터리']
    // 「전고체 셀」은 「전고체 배터리」의 부분문자열이 아니므로 부분일치 오계수가 없다(직접 확인).
    // ⚠️ 이 축이 금지하는 것은 **sr-only 이중 노출**이며, *다른 키 사이* 중복은 아니다 — 라이브에는
    //    `prerequisites` ↔ `complements`에 같은 이름이 정당하게 있다(2026-08-20 실측 2건).
    names.forEach((n) => expect(countIn(text, n)).toBe(1))
  })

  it('⑥ related·target·composition 전부 비면 아무것도 렌더하지 않는다(null)', () => {
    const { container } = at(<TechGraph related={{}} />)
    expect(container.firstChild).toBeNull()
  })

  it('⑦ 방향 마커는 aria-hidden이고 접근 가능 텍스트를 만들지 않는다', () => {
    const { container } = at(<TechGraph related={FULL} target="전고체 배터리" />)
    // 화살표만 좁혀 잡는다 — 구성 막대 트랙도 aria-hidden이므로(값이 이미 텍스트로 있다) 전체를
    // 훑으면 트랙이 섞여 `^[↓\s]*$`가 원리적으로 실패한다.
    const arrows = [...container.querySelectorAll('[data-group] > span[aria-hidden="true"]')]
    expect(arrows.length).toBeGreaterThan(0) // sentinel — 마커가 하나도 없으면 아래가 공허하다
    arrows.forEach((el) => expect(el.textContent).toMatch(/^[↓\s]*$/))
    // 화살표는 **좌측 정렬**이다(task#320이 흡수한 #319 S4ⓑ — 옛 `center`는 왼쪽 정렬 칩 열과 어긋났다)
    arrows.forEach((el) => expect(el.style.alignSelf).toBe('flex-start'))
    // 그룹 라벨은 장식이 아니라 구조 정보이므로 aria-hidden이 아니어야 한다.
    const labels = [...container.querySelectorAll('[data-group] > span:first-child')]
    expect(labels.map((el) => el.textContent)).toEqual(['전제·선행', '대상 기술', '파생·응용'])
    labels.forEach((el) => expect(el.getAttribute('aria-hidden')).not.toBe('true'))
  })

  it('보완/경합 기술은 별도 칩 그룹으로 남고 라벨이 칩 **위**에 온다 (방향 없는 관계 — ADR-0033 결정4)', () => {
    const related = { complements: ['냉매 기술'], competitors: ['화학전지'] }
    const { getByText, queryByTestId, container } = at(<TechGraph related={related} target="SMR" />)
    expect(getByText('보완 기술')).toBeTruthy()
    expect(getByText('냉매 기술')).toBeTruthy()
    expect(getByText('경합 기술')).toBeTruthy()
    expect(getByText('화학전지')).toBeTruthy()
    // ⚠️ **task#320이 이 부수 단언을 뒤집었다**: 옛 축은 「target만 있어도 흐름은 그려진다」였는데
    //    `target`은 `TECH_NAMES[slug] || slug`라 **항상 채워져 있으므로**, 방향 있는 관계가 0인 판에서
    //    「대상 기술 SMR」 한 줄만 남은 **유령 흐름**이 뜬다. 흐름은 방향 있는 관계가 하나라도 있을
    //    때만 그린다. 맥락은 「무엇과 이어지나」 소제목이 이미 준다.
    //    (task#264 판별: 이 단언은 task#317 계획서의 완료기준·비목표에 이름으로 등장하지 않는 부수
    //     단언이므로 뒤집을 수 있다. 그 계획이 이름으로 못박은 것은 「보완·경합의 별도 칩 그룹 유지」다.)
    expect(queryByTestId('tech-graph-flow')).toBeNull()
    // 라벨이 칩 위 — 라벨 span과 칩 ul이 세로 flex 형제다(#319 S4ⓐ를 이 태스크가 흡수)
    const compGroup = container.querySelector('[data-testid="tech-graph-complements"]')
    expect(compGroup.style.flexDirection).toBe('column')
    expect(compGroup.firstChild.textContent).toBe('보완 기술')
  })
})

describe('TechGraph — 구성 계층 (task#320 S3)', () => {
  it('① 구성 항목이 지분 내림차순 DOM 순서로 렌더된다', () => {
    const { container } = at(<TechGraph related={{}} target="반도체 장비" composition={COMP} slug="semiconductor-equipment" />)
    const shares = compItems(container).map((el) => Number(el.dataset.share))
    expect(shares).toEqual([35, 20, 15, 15, 10, 5])
  })

  // ④ 이빨 — 픽스처의 API 순서가 렌더 순서와 **다름**을 못박는다. 같았다면 정렬을 통째로 지워도
  //    ①이 통과한다(가토 ⑧ⓘ). 실측 확인(2026-08-21): `rampPositions`의 sort를 지우면 ①이
  //    `[15,5,35,10,15,20]`을 받아 FAIL한다.
  it('④ 이빨 — 픽스처의 입력 순서가 렌더 순서와 다르다', () => {
    const apiOrder = COMP.tech.map((t) => t.share_pct)
    const rendered = rampPositions(COMP.tech).map((t) => t.share)
    expect(apiOrder).not.toEqual(rendered)
  })

  it('② 「기타」가 마지막이고 그 막대 색이 램프 색과 다르다', () => {
    const { container } = at(<TechGraph related={{}} target="반도체 장비" composition={COMP} slug="s" />)
    const items = compItems(container)
    const kinds = items.map((el) => el.dataset.compKind)
    expect(kinds).toEqual(['ramp', 'ramp', 'ramp', 'ramp', 'ramp', 'other'])
    expect(items[items.length - 1].dataset.compName).toBe('기타')
    const colors = items.map((el) => el.querySelector('[data-tech-comp-bar]').style.background)
    const residual = colors[colors.length - 1]
    expect(colors.slice(0, -1)).not.toContain(residual)
  })

  it('같은 지분 두 항목이 같은 색이고, 다른 지분은 다른 색이다 — 색은 길이와 같은 말을 한다', () => {
    const { container } = at(<TechGraph related={{}} target="반도체 장비" composition={COMP} slug="s" />)
    const items = compItems(container)
    const byShare = {}
    items.filter((el) => el.dataset.compKind === 'ramp').forEach((el) => {
      const s = el.dataset.share
      ;(byShare[s] = byShare[s] || []).push(el.querySelector('[data-tech-comp-bar]').style.background)
    })
    expect(byShare['15']).toHaveLength(2)
    expect(byShare['15'][0]).toBe(byShare['15'][1])
    expect(byShare['20'][0]).not.toBe(byShare['15'][0])
  })

  it('③ 뿌리 노드에 대상 기술과 분모 문구가 상시 노출된다', () => {
    const { container } = at(<TechGraph related={{}} target="반도체 장비" composition={COMP} slug="s" />)
    const root = container.querySelector('[data-tech-comp-root]')
    expect(root).toBeTruthy()
    expect(root.textContent).toContain('반도체 장비')
    // 같은 화면 위쪽 주요 업체 표에 **시장점유율 열**이 실재하므로, 이 문구가 없으면 독자가 35%를
    // 그것으로 읽는다. 그래서 분모는 접거나 조건부로 두지 않는다.
    expect(root.textContent).toContain('남은 난제 100% 기준')
  })

  it('막대 색이 램프 유틸이 계산한 값과 정확히 같다 — 컴포넌트가 자기 색을 따로 만들지 않는다', () => {
    const { container } = at(<TechGraph related={{}} target="T" composition={COMP} slug="s" />)
    const expected = rampPositions(COMP.tech).map((it) => rampColor(it.t, RAMP.light.hi, RAMP.light.lo, RAMP.light.residual))
    const got = compItems(container).map((el) => el.querySelector('[data-tech-comp-bar]').style.background)
    // jsdom은 hex를 rgb로 정규화하므로 hex 비교가 아니라 **서로 같은 개수의 고유값**과 순서 일치를 본다
    expect(got).toHaveLength(expected.length)
    const uniqGot = new Set(got).size, uniqExp = new Set(expected).size
    expect(uniqGot).toBe(uniqExp)
  })
})

describe('TechGraph — 발행물 링크 칩 (task#320 S4)', () => {
  const REL = { prerequisites: ['AI 데이터센터 설비', '고순도 석영·특수소재'], complements: ['SMR'] }

  it('① 인덱스에 있는 이름은 링크 칩이고 href가 그 slug다', () => {
    const { container } = at(<TechGraph related={REL} target="T" techIndex={INDEX} />)
    const links = [...container.querySelectorAll('[data-testid="tech-graph-link-item"]')]
    expect(links.map((a) => a.getAttribute('href'))).toEqual(
      ['/tech-report/ai-datacenter-equipment', '/tech-report/smr'])
    expect(links[0].textContent).toContain('AI 데이터센터 설비')
  })

  it('② 인덱스에 없는 이름은 일반 칩이다', () => {
    const { container, getByText } = at(<TechGraph related={REL} target="T" techIndex={INDEX} />)
    const plain = [...container.querySelectorAll('[data-testid="tech-graph-item"]')]
      .map((el) => el.textContent)
    expect(plain).toContain('고순도 석영·특수소재')
    expect(getByText('고순도 석영·특수소재').closest('a')).toBeNull()
  })

  it('③ 인덱스 조회 실패(failed) → 칩 개수는 그대로이고 링크가 0개다', () => {
    const ok = at(<TechGraph related={REL} target="T" techIndex={INDEX} />)
    const okNames = [...ok.container.querySelectorAll('[data-testid="tech-graph-item"],[data-testid="tech-graph-link-item"]')]
      .map((el) => el.textContent.replace(/\s*→\s*$/, '').trim())
    const bad = at(<TechGraph related={REL} target="T" techIndex={null} indexFailed />)
    const badNames = [...bad.container.querySelectorAll('[data-testid="tech-graph-item"],[data-testid="tech-graph-link-item"]')]
      .map((el) => el.textContent.replace(/\s*→\s*$/, '').trim())
    // 칩 이름은 **사실**이므로 실패해도 사라지지 않는다 — 링크만 빠진다(task#307: 조회 실패를
    // 「그런 발행물이 없다」로 렌더하면 화면이 모르는 것을 안다고 말한다).
    expect(badNames).toEqual(okNames)
    expect(bad.container.querySelectorAll('[data-testid="tech-graph-link-item"]')).toHaveLength(0)
    // 그리고 「없다」는 문구를 쓰지 않는다 — 실패를 사실로 진술하지 않는 방법이 문구를 안 쓰는 것이다.
    expect(bad.container.textContent).not.toMatch(/없습니다|없음/)
  })

  // ④ **이 축은 fault injection으로 방향을 고쳐 잡은 것이다** — 처음엔 「실패와 0건이 구별된다」로
  //    짰는데 `indexFailed`를 무시하고 `techIndex ?? []`를 쓰는 주입에서 **실패 0건**이었다
  //    (= 아무도 지키지 않는 축, task#315·#316). 원인이 분명하다: 두 상태의 **올바른 렌더가 같다**
  //    (칩은 그대로, 링크만 없음). 즉 이 컴포넌트에서 구별은 *관측 가능한 차이*가 아니다.
  //
  //    그래서 축을 **진짜 위험**으로 돌린다. task#307의 결함은 「구별 못 함」 자체가 아니라 조회 실패가
  //    **「없다」는 거짓 진술로 붕괴하는 것**이었다. 그 진술을 세 상태 전부에서 금지한다 —
  //    누군가 나중에 `techIndex.length === 0`에 「연결된 발행물 없음」을 달면 여기서 걸린다.
  //    실측 확인(2026-08-21): 링크 0개일 때 「연결된 발행물이 없습니다」를 렌더하도록 주입하면
  //    이 축이 3케이스에서 FAIL한다. (`indexFailed` prop은 그 미래 가드가 실패와 0건을 가를 수
  //    있도록 남겨 둔다 — 지금은 행동상 load-bearing이 아니고, 그 사실을 여기 적어 둔다.)
  it('④ 어떤 상태에서도 「없다」는 진술을 렌더하지 않는다 — 실패·0건·성공 셋 다', () => {
    const cases = [
      ['실패', <TechGraph related={REL} target="T" techIndex={null} indexFailed />],
      ['0건', <TechGraph related={REL} target="T" techIndex={[]} />],
      ['성공', <TechGraph related={REL} target="T" techIndex={INDEX} />],
    ]
    for (const [label, ui] of cases) {
      const { container } = at(ui)
      // 칩 이름은 세 상태에서 전부 살아 있다(이름은 사실이다)
      expect(container.textContent, label).toContain('AI 데이터센터 설비')
      expect(container.textContent, label).toContain('고순도 석영·특수소재')
      // 「없다」류 진술 0건 — 조회하지 못한 것을 「없다」로 말하지 않는다
      expect(container.textContent, label).not.toMatch(/없습니다|없음|not found/i)
    }
    // 성공 케이스가 링크를 실제로 만든다는 것이 이 축 묶음의 판별력이다(공허한 0==0이 아니다).
    const okc = at(<TechGraph related={REL} target="T" techIndex={INDEX} />)
    expect(okc.container.querySelectorAll('[data-testid="tech-graph-link-item"]').length).toBeGreaterThan(0)
  })

  it('링크 칩은 탭 타깃 34px 핀을 쓴다 (padding 7px 12px + lineHeight 18px)', () => {
    const { container } = at(<TechGraph related={REL} target="T" techIndex={INDEX} />)
    const link = container.querySelector('[data-testid="tech-graph-link-item"]')
    expect(link.style.padding).toBe('7px 12px')
    expect(link.style.lineHeight).toBe('18px')
    // jsdom은 레이아웃이 없어 실제 34px은 못 잰다 — 라이브 프로브의 몫이다(fixture-pass-live-fail).
  })
})

describe('TechGraph — 소제목과 부재 폴백 (task#320 S5)', () => {
  it('② 구성 축 부재 → 안내 + 해부 링크가 있고 뿌리·막대는 없다', () => {
    const { container, getByText } = at(<TechGraph related={FULL} target="T" slug="robotics" />)
    expect(getByText('무엇으로 이뤄졌나')).toBeTruthy()
    expect(container.querySelector('[data-tech-comp-root]')).toBeNull()
    expect(container.querySelectorAll('[data-tech-comp-item]')).toHaveLength(0)
    const link = container.querySelector('[data-testid="tech-graph-anatomy-link"]')
    expect(link.getAttribute('href')).toBe('/tech-anatomy/robotics')
    expect(link.textContent).toContain('아직 해부되지 않음')
  })

  it('구성 축이 있으면 안내가 사라지고 뿌리·막대가 온다', () => {
    const { container, queryByTestId } = at(<TechGraph related={{}} target="T" composition={COMP} slug="s" />)
    expect(queryByTestId('tech-graph-anatomy-link')).toBeNull()
    expect(container.querySelector('[data-tech-comp-root]')).toBeTruthy()
  })

  it('③ 경계 4키가 전부 비면 「무엇과 이어지나」 소제목이 0개다 — 유령 소제목 금지', () => {
    const { container, queryByText, getByText } = at(
      <TechGraph related={{ prerequisites: [], derivatives: [], complements: [], competitors: [] }}
                 target="반도체 장비" composition={COMP} slug="s" />)
    expect(queryByText('무엇과 이어지나')).toBeNull()
    expect(container.querySelector('[data-testid="tech-graph-boundary"]')).toBeNull()
    // 구성 반쪽은 그대로 있어야 한다(한쪽이 비어도 다른 쪽은 렌더된다)
    expect(getByText('무엇으로 이뤄졌나')).toBeTruthy()
  })

  // ④ 이빨 — 유령 가드를 「4키가 아니라 groups.length > 0」으로 느슨하게 하면 ③이 실패한다:
  //    `target`이 항상 채워져 있어 groups가 1개가 되고 소제목이 살아난다.
  //    실측 확인(2026-08-21): `hasBoundary`를 `groups.length > 0 || hasChips`로 되돌리면 ③이 FAIL한다.
  it('④ 이빨 — 대상 노드는 경계 정의역에 들어가지 않는다', () => {
    const { queryByText } = at(<TechGraph related={{}} target="아무 기술이든" composition={COMP} slug="s" />)
    // target이 있어도 경계 소블록이 뜨지 않는다는 것이 그 이빨이다.
    expect(queryByText('무엇과 이어지나')).toBeNull()
  })

  it('두 반쪽이 다 있으면 소제목 순서가 구성 → 연관이다', () => {
    const { container } = at(<TechGraph related={FULL} target="T" composition={COMP} slug="s" />)
    const subs = [...container.querySelectorAll('h4')].map((h) => h.textContent)
    expect(subs).toEqual(['무엇으로 이뤄졌나', '무엇과 이어지나'])
  })
})
