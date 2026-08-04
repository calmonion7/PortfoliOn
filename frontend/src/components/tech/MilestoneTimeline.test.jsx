import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import MilestoneTimeline, { milestoneTimelineLayout } from './MilestoneTimeline'

// task#282 — 가로 SVG → 세로 HTML 목록. 좌표 불변식은 사라졌고(좌표 자체가 없다) 판정축은
// **구조·내용 불변식**이다: 유실 0(원문 완전일치)·연도 그룹핑·마커 클래스 실재·시맨틱 목록.
// jsdom은 스타일시트를 적용하지 않으므로 마커 색은 클래스명만으로 단언할 수 없다 → CSS 원문을
// 직접 읽어 3규칙이 실재하는지 대조한다(가토 ⑪ — 클래스는 붙는데 규칙이 없으면 색이 조용히 사라지고
// vitest·빌드 어디에도 안 걸린다). 실제 렌더 색 검증은 라이브 프로브 몫.
// ⚠️ CSS는 fs로 읽는다 — vitest는 `css: false`라 `?raw`까지 빈 문자열로 스텁한다(TechKpiStrip.test 선례).
//    주석은 제거한다: 이 CSS의 주석이 "ellipsis·line-clamp 금지"라는 **반례**를 담고 있어 그대로 두면
//    금지 검사가 자기 주석에 걸려 거짓 FAIL한다(가토 ⑧ⓜ).
const CSS = readFileSync(join(import.meta.dirname, 'MilestoneTimeline.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')

// 라이브 발행물(smr)과 같은 형태 — event가 짧은 라벨이 아니라 한국어 완성 문장이고,
// 같은 해에 여러 건이 몰리며, 17건이다(가로 SVG가 무너진 실데이터 규모).
const MANY = [
  { year: 2020, actor: '로사톰', event: '부유식 원전 아카데믹 로모노소프(KLT-40S 2기·합계 70MWe) 상업운전 개시 — 세계 최초 상용 SMR', status: 'done' },
  { year: 2021, actor: '중국핵공업집단', event: 'HTR-PM 실증로 초임계 도달', status: 'done' },
  { year: 2021, actor: 'NuScale', event: 'NRC 표준설계인증 취득', status: 'done' },
  { year: 2022, actor: '한수원', event: 'i-SMR 기술개발사업 예비타당성조사 통과', status: 'done' },
  { year: 2023, actor: '중국핵공업집단', event: 'HTR-PM 상업운전 개시', status: 'done' },
  { year: 2023, actor: 'NuScale', event: 'UAMPS 카본프리 전력프로젝트 취소', status: 'done' },
  { year: 2024, actor: 'CNNC', event: '링룽1호 원자로 압력용기 설치', status: 'done' },
  { year: 2024, actor: 'GE Hitachi', event: 'BWRX-300 다링턴 부지 준비공사 착수', status: 'done' },
  { year: 2025, actor: '한수원', event: 'i-SMR 표준설계 인가 신청', status: 'in_progress' },
  { year: 2025, actor: 'X-energy', event: 'Xe-100 도우케미컬 시브룩 부지 건설허가 심사', status: 'in_progress' },
  { year: 2026, actor: 'CNNC', event: '링룽1호 계통연결 예정', status: 'in_progress' },
  { year: 2027, actor: 'TerraPower', event: 'Natrium 실증로 원자로 건물 착공', status: 'planned' },
  { year: 2028, actor: 'Rolls-Royce', event: '영국 SMR 1호기 부지 확정 및 장납기 기자재 발주', status: 'planned' },
  { year: 2029, actor: 'GE Hitachi', event: 'BWRX-300 다링턴 1호기 가동', status: 'planned' },
  { year: 2030, actor: 'NuScale', event: 'RoPower 도이체슈티 프로젝트 상업운전', status: 'planned' },
  { year: 2032, actor: '한수원', event: 'i-SMR 국내 초호기 준공', status: 'planned' },
  { year: 2034, actor: '한수원', event: 'i-SMR 수출 1호기 상용화 목표', status: 'planned' },
]

const eventTexts = (c) => [...c.querySelectorAll('.mstone__event-text')].map((e) => e.textContent)

describe('milestoneTimelineLayout — 연도 그룹핑', () => {
  it('① 입력이 뒤섞여 있어도 연도 오름차순이고 같은 연도는 한 그룹으로 묶인다', () => {
    const shuffled = [MANY[9], MANY[0], MANY[16], MANY[4], MANY[2], MANY[1]]
    const { groups, items } = milestoneTimelineLayout({ milestones: shuffled })

    const years = groups.map((g) => g.year)
    expect(years).toEqual([...years].sort((a, b) => a - b))
    expect(new Set(years).size).toBe(years.length) // 같은 연도가 두 그룹으로 쪼개지지 않는다
    expect(groups.find((g) => g.year === 2021).items).toHaveLength(2)
    // 그룹 전개 == 전체 항목(유실·중복 0)
    expect(groups.flatMap((g) => g.items)).toEqual(items)
    expect(items).toHaveLength(shuffled.length)
  })

  it('② 같은 연도 안에서는 입력 순서를 유지한다', () => {
    const { groups } = milestoneTimelineLayout({
      milestones: [
        { year: 2026, event: '나중', status: 'done' },
        { year: 2020, event: '먼저', status: 'done' },
        { year: 2026, event: '더 나중', status: 'done' },
      ],
    })
    expect(groups.map((g) => g.year)).toEqual([2020, 2026])
    expect(groups[1].items.map((it) => it.event)).toEqual(['나중', '더 나중'])
  })

  it('③ 부재·빈 배열·전부 무효면 빈 결과(섹션째 생략의 근거 — TechReport 게이트가 이 식을 쓴다)', () => {
    const empty = { groups: [], items: [] }
    expect(milestoneTimelineLayout()).toEqual(empty)
    expect(milestoneTimelineLayout({ milestones: null })).toEqual(empty)
    expect(milestoneTimelineLayout({ milestones: [] })).toEqual(empty)
    expect(milestoneTimelineLayout({
      milestones: [
        { year: '2026', event: '연도가 문자열', status: 'done' },
        { year: 2026, event: '   ', status: 'done' },
        { year: Number.NaN, event: '연도 NaN', status: 'done' },
        null,
      ],
    })).toEqual(empty)
  })

  it('④ enum 밖 status·주체 결측은 죽지 않고 planned/null로 떨어진다', () => {
    const { items } = milestoneTimelineLayout({
      milestones: [
        { year: 2026, event: 'a', status: '완료' },
        { year: 2027, event: 'b' },
        { year: 2028, actor: '  ', event: 'c', status: 'done' },
      ],
    })
    expect(items.map((it) => it.status)).toEqual(['planned', 'planned', 'done'])
    expect(items.every((it) => it.actor === null)).toBe(true)
  })
})

describe('MilestoneTimeline — 렌더', () => {
  it('⑤ milestones 부재·빈 배열이면 아무것도 렌더하지 않는다(구발행물 graceful)', () => {
    expect(render(<MilestoneTimeline />).container.firstChild).toBeNull()
    expect(render(<MilestoneTimeline milestones={null} />).container.firstChild).toBeNull()
    expect(render(<MilestoneTimeline milestones={[]} />).container.firstChild).toBeNull()
    expect(render(<MilestoneTimeline milestones={[{ year: null, event: '', status: 'done' }]} />)
      .container.firstChild).toBeNull()
  })

  it('⑥ 17건 전부가 항목으로 렌더되고 이벤트 문장이 원문 그대로 남는다(유실 0)', () => {
    const { container } = render(<MilestoneTimeline milestones={MANY} />)
    const rows = container.querySelectorAll('li[data-testid="milestone-item"]')

    expect(rows).toHaveLength(17)
    // 부분일치가 아니라 **완전일치** — 잘림(…)·접힘(+N개)이 끼면 여기서 깨진다
    expect(eventTexts(container)).toEqual(MANY.map((m) => m.event))
    // 주체도 전부 원문
    expect([...container.querySelectorAll('.mstone__actor')].map((e) => e.textContent))
      .toEqual(MANY.map((m) => m.actor))
    // 접힘 폴드("+N개")·말줄임·툴팁 의존이 남아있지 않다
    expect(container.textContent).not.toMatch(/\+\d+개/)
    expect(container.textContent).not.toContain('…')
    expect(container.querySelectorAll('title, [title]')).toHaveLength(0)
  })

  it('⑦ 연도 헤더는 오름차순 1회씩이고 그 그룹 항목의 data-year와 일치한다', () => {
    const { container } = render(<MilestoneTimeline milestones={MANY} />)
    const uniqueYears = [...new Set(MANY.map((m) => m.year))]

    expect([...container.querySelectorAll('[data-testid="milestone-year"]')].map((e) => e.textContent))
      .toEqual(uniqueYears.map(String))

    container.querySelectorAll('.mstone__group').forEach((group, i) => {
      const year = String(uniqueYears[i])
      expect(group.querySelector('[data-testid="milestone-year"]').textContent).toBe(year)
      const rows = [...group.querySelectorAll('li[data-testid="milestone-item"]')]
      expect(rows.length).toBeGreaterThan(0)
      rows.forEach((r) => expect(r.getAttribute('data-year')).toBe(year))
    })
  })

  it('⑧ status 3값이 서로 다른 마커 클래스를 받고, 그 클래스가 CSS에 실재한다(가토 ⑪)', () => {
    const { container } = render(<MilestoneTimeline milestones={MANY} />)
    // sentinel — CSS를 실제로 읽었는가. 빈 문자열이면 아래 대조가 통째로 공허해진다(가토 ⑧ⓐ)
    expect(CSS).toContain('.mstone__marker {')

    const markerOf = (s) => container
      .querySelector(`li[data-status="${s}"] .mstone__marker`).getAttribute('class')

    const classes = ['done', 'in_progress', 'planned'].map(markerOf)
    expect(new Set(classes).size).toBe(3) // 3값이 실제로 갈린다
    classes.forEach((cls, i) => {
      const variant = cls.split(' ').find((c) => c.includes('--'))
      expect(variant).toBe(`mstone__marker--${['done', 'in_progress', 'planned'][i]}`)
      // 클래스만 조립하고 CSS 규칙이 없으면 색이 조용히 사라진다 → 원문에 선언이 있는지 대조
      expect(CSS).toContain(`.${variant} {`)
    })
    // 3규칙이 서로 다른 선언이어야 시각적으로도 갈린다(색 토큰이 실제로 다르다)
    expect(CSS).toMatch(/\.mstone__marker--done \{[^}]*var\(--color-success\)/)
    expect(CSS).toMatch(/\.mstone__marker--in_progress \{[^}]*var\(--warn\)/)
    expect(CSS).toMatch(/\.mstone__marker--planned \{[^}]*var\(--text-3\)/)
  })

  it('⑨ 시맨틱 목록 — ol/ul + li이고 마커는 장식, 상태는 텍스트로도 전달된다', () => {
    const { container } = render(<MilestoneTimeline milestones={MANY.slice(0, 3)} />)

    expect(container.querySelector('ol.mstone__list')).toBeTruthy()
    expect(container.querySelectorAll('ul.mstone__events')).toHaveLength(2) // 2020·2021 두 그룹
    // 항목은 진짜 <li> — role="img" 원자화로 자손을 접근성 트리에서 감추지 않는다
    container.querySelectorAll('[data-testid="milestone-item"]').forEach((el) => {
      expect(el.tagName).toBe('LI')
    })
    expect(container.querySelector('[role="img"]')).toBeNull()

    // 마커는 장식이므로 감추고, 상태는 시각적으로 숨긴 텍스트로 준다
    container.querySelectorAll('.mstone__marker').forEach((m) => {
      expect(m.getAttribute('aria-hidden')).toBe('true')
    })
    const srTexts = [...container.querySelectorAll('.mstone__event .sr-only')].map((e) => e.textContent)
    expect(srTexts).toEqual(['완료', '완료', '완료'])
    expect(render(<MilestoneTimeline milestones={[MANY[10]]} />)
      .container.querySelector('.sr-only').textContent).toBe('진행 중')
    expect(render(<MilestoneTimeline milestones={[MANY[16]]} />)
      .container.querySelector('.sr-only').textContent).toBe('예정')
  })

  it('⑩ 이벤트 문장을 자르지 않는다 — CSS에 ellipsis·line-clamp가 없다', () => {
    expect(CSS).not.toContain('ellipsis')
    expect(CSS).not.toContain('line-clamp')
    // 잘림은 nowrap과 짝을 이루므로 이벤트 문장 규칙에 nowrap이 끼면 안 된다(범례 칩은 예외)
    expect(CSS).toMatch(/\.mstone__event-text \{[^}]*word-break: keep-all/)
    expect(CSS).not.toMatch(/\.mstone__event-text \{[^}]*nowrap/)
  })

  it('⑪ 가격 방향 토큰(--up/--down)·하드코딩 hex를 쓰지 않는다 — 마일스톤은 의미 상태다', () => {
    const { container } = render(<MilestoneTimeline milestones={MANY} />)
    ;[container.innerHTML, CSS].forEach((src) => {
      expect(src).not.toMatch(/var\(--up\b/)
      expect(src).not.toMatch(/var\(--down\b/)
      expect(src).not.toMatch(/#[0-9a-fA-F]{3,6}\b/)
    })
  })

  it('⑫ 범례는 실제로 존재하는 상태만 표시하고, 등간격 고지는 사라졌다', () => {
    const { getByTestId, container } = render(<MilestoneTimeline milestones={MANY.slice(0, 2)} />)
    const legend = getByTestId('milestone-legend')
    expect(legend.textContent).toContain('완료')
    expect(legend.textContent).not.toContain('진행 중')
    expect(legend.textContent).not.toContain('예정')
    // 가로 축이 사라졌으므로 "가로 간격은 등간격입니다" 경고도 함께 사라져야 한다(죽은 문구 금지)
    expect(container.textContent).not.toContain('등간격')
    expect(container.querySelector('[data-testid="milestone-spacing-note"]')).toBeNull()
    expect(container.querySelector('svg')).toBeNull() // SVG를 버렸다
  })
})
