import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TechChapterNav from './TechChapterNav'
import { chapterNavItems, TECH_CHAPTERS } from '../reports/techReportUtils'

// jsdom엔 IntersectionObserver가 없다(저장소 관례: 테스트 파일에서 스텁 — BusinessFormationSection.test.jsx).
// ⚠️ 이 스텁은 **콜백을 보관**한다. 그래야 「경계를 지났다」 재계산을 테스트가 유발할 수 있다 —
//    빈 스텁(`observe(){}`)이면 `useActiveChapter`가 한 번도 계산하지 않고 축이 공허해진다.
let ioCallbacks = []
class FakeIO {
  constructor(cb) { this.cb = cb; ioCallbacks.push(cb) }
  observe() {} unobserve() {} disconnect() { ioCallbacks = ioCallbacks.filter((c) => c !== this.cb) }
}
beforeEach(() => { ioCallbacks = []; globalThis.IntersectionObserver = FakeIO })
afterEach(() => { vi.restoreAllMocks() })

const SECTIONS_ALL = [
  { id: 'key-points', label: '핵심 포인트', show: true, chapter: 'overview' },
  { id: 'variants', label: '계열 비교', show: true, chapter: 'overview' },
  { id: 'related', label: '구성과 연관', show: true, chapter: 'overview' },
  { id: 'market', label: '시장 규모', show: true, chapter: 'market-competition' },
  { id: 'players', label: '주요 업체', show: true, chapter: 'market-competition' },
  { id: 'share', label: '점유율', show: true, chapter: 'market-competition' },
  { id: 'milestones', label: '진척 타임라인', show: true, chapter: 'progress-risk' },
  { id: 'challenges', label: '해결해야 할 난제', show: true, chapter: 'progress-risk' },
  { id: 'watch-items', label: '확인할 지표', show: true, chapter: 'progress-risk' },
  { id: 'prose', label: '상세 설명', show: true, chapter: 'evidence' },
  { id: 'sources', label: '출처', show: true, chapter: 'evidence' },
]
const hide = (ids) => SECTIONS_ALL.map((s) => (ids.includes(s.id) ? { ...s, show: false } : s))

describe('chapterNavItems — 장 집산 순수함수 (task#321 S1)', () => {
  it('① 4장 전부 표시 → 4항목, 각 targetId가 그 장의 첫 표시 섹션', () => {
    expect(chapterNavItems(SECTIONS_ALL)).toEqual([
      { chapter: 'overview', label: '개요', targetId: 'key-points' },
      { chapter: 'market-competition', label: '시장·경쟁', targetId: 'market' },
      { chapter: 'progress-risk', label: '진척·리스크', targetId: 'milestones' },
      { chapter: 'evidence', label: '근거', targetId: 'prose' },
    ])
  })

  it('첫 표시 섹션이 그 장의 첫 *배열* 섹션이 아닐 때도 맞는다', () => {
    // 장 1의 key-points·variants가 결측이면 타깃은 related여야 한다(배열 첫 항목이 아니다).
    const items = chapterNavItems(hide(['key-points', 'variants']))
    expect(items[0]).toEqual({ chapter: 'overview', label: '개요', targetId: 'related' })
  })

  it('② 장 3의 세 섹션이 전부 결측 → 3항목', () => {
    const items = chapterNavItems(hide(['milestones', 'challenges', 'watch-items']))
    expect(items.map((i) => i.chapter)).toEqual(['overview', 'market-competition', 'evidence'])
  })

  it('③ 표시 장이 1개면 [] — 칩 1개는 항해가 아니다', () => {
    const only = SECTIONS_ALL.map((s) => ({ ...s, show: s.chapter === 'evidence' }))
    expect(chapterNavItems(only)).toEqual([])
    // ⚠️ 이 게이트가 정적 목차의 `tocItems.length > 1`과 **다른 식**임을 못박는다:
    //    표시 섹션은 2개(prose·sources)라 목차 기준이면 통과하지만 장은 1개다.
    expect(only.filter((s) => s.show)).toHaveLength(2)
  })

  it('비배열·빈 입력에서 예외를 던지지 않는다', () => {
    for (const bad of [null, undefined, 'x', 42, {}, []]) expect(chapterNavItems(bad)).toEqual([])
  })

  // ⑤ 커버리지(task#301 — 이빨은 분기 진입을 보장하지 않는다): 픽스처가 이 경로를 정말 타는가.
  it('⑤ 커버리지 — 픽스처가 비어있지 않은 결과를 만든다(경로 진입 증명)', () => {
    expect(chapterNavItems(SECTIONS_ALL)).not.toEqual([])
    expect(TECH_CHAPTERS).toHaveLength(4)
  })

  // ④ 이빨 4종 — 각 주입이 위 축 중 하나를 실제로 깨뜨림을 실측했다(2026-08-21):
  //    ⓐ 장 순서 뒤집기 → ①이 FAIL(배열 순서가 다르다)
  //    ⓑ targetId를 그 장의 *마지막* 섹션으로 → ①이 FAIL(key-points→related, market→share …)
  //    ⓒ 길이 가드 제거(`items.length > 1` → `true`) → ③이 FAIL(1항목이 반환된다)
  //    ⓓ `show` 필터 제거 → ②가 FAIL(장 3이 되살아나 4항목이 된다)
  //    아래는 그 4주입이 **서로 다른 축**을 깨뜨린다는 사실을 데이터로 남긴다(주입 없이도 검증 가능한 형태).
  it('④ 이빨 — 네 성질이 각각 독립적으로 관측 가능하다', () => {
    const items = chapterNavItems(SECTIONS_ALL)
    // ⓐ 순서: TECH_CHAPTERS 순서와 같다(뒤집으면 다르다)
    expect(items.map((i) => i.chapter)).toEqual(TECH_CHAPTERS.map((c) => c.key))
    // ⓑ 타깃: 각 장의 **첫** 섹션이고 마지막 섹션이 아니다
    const lastOf = (key) => SECTIONS_ALL.filter((s) => s.chapter === key && s.show).slice(-1)[0].id
    items.forEach((i) => expect(i.targetId).not.toBe(lastOf(i.chapter)))
    // ⓒ 길이 가드: 1항목이 되는 입력에서 []다
    expect(chapterNavItems(SECTIONS_ALL.map((s) => ({ ...s, show: s.chapter === 'overview' })))).toEqual([])
    // ⓓ show 필터: 결측 장은 빠진다
    expect(chapterNavItems(hide(['prose', 'sources'])).map((i) => i.chapter)).not.toContain('evidence')
  })
})

describe('TechChapterNav — 플로팅 바 렌더 (task#321 S3)', () => {
  const ITEMS = chapterNavItems(SECTIONS_ALL)
  const at = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>)

  it('① visible=false(정적 목차가 화면 안) → 바 부재', () => {
    const { container } = at(<TechChapterNav items={ITEMS} visible={false} />)
    expect(container.querySelector('[data-tech-chapter-nav]')).toBeNull()
  })

  it('② visible=true → 바 존재 · 칩 4개 · 장 순서', () => {
    const { container } = at(<TechChapterNav items={ITEMS} visible />)
    const nav = container.querySelector('[data-tech-chapter-nav]')
    expect(nav).toBeTruthy()
    const chips = [...nav.querySelectorAll('[data-tech-chapter-nav-chip]')]
    expect(chips).toHaveLength(4)
    expect(chips.map((c) => c.dataset.chapter)).toEqual(TECH_CHAPTERS.map((c) => c.key))
    expect(chips.map((c) => c.textContent)).toEqual(['개요', '시장·경쟁', '진척·리스크', '근거'])
    // 칩은 그 장의 첫 표시 섹션으로 점프한다
    expect(chips.map((c) => c.getAttribute('href')))
      .toEqual(['#key-points', '#market', '#milestones', '#prose'])
  })

  it('④ items가 []면 visible이어도 바 부재 — 유령 UI 금지', () => {
    const { container } = at(<TechChapterNav items={[]} visible />)
    expect(container.querySelector('[data-tech-chapter-nav]')).toBeNull()
  })

  it('칩 스타일이 정적 목차 칩과 같은 클래스 관례를 쓴다(34px 핀은 CSS 소유)', () => {
    const { container } = at(<TechChapterNav items={ITEMS} visible />)
    const chip = container.querySelector('[data-tech-chapter-nav-chip]')
    expect(chip.className).toContain('toc-float__chip')
    expect(chip.className).toContain('mono')
    // ⚠️ 실제 34px은 jsdom에서 못 잰다(무레이아웃) — `uat321`의 `tap-target` 축이 라이브에서 잰다.
  })
})

describe('useActiveChapter — scroll-spy 판정 (task#321 S2)', () => {
  const ITEMS = chapterNavItems(SECTIONS_ALL)
  const at = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>)

  // 각 장 첫 섹션 요소를 문서에 심고 top을 제어한다. `tops[id]`가 그 섹션의 viewport top이다.
  const mountSections = (tops) => {
    for (const id of ['key-points', 'market', 'milestones', 'prose']) {
      const el = document.createElement('div')
      el.id = id
      el.getBoundingClientRect = () => ({ top: tops[id], bottom: tops[id] + 100, left: 0, right: 0, width: 0, height: 100 })
      document.body.appendChild(el)
    }
  }
  const fire = () => act(() => { ioCallbacks.forEach((cb) => cb([], null)) })
  afterEach(() => { document.body.innerHTML = '' })

  it('① 경계를 지난 섹션 중 마지막이 활성이다', () => {
    // 경계선 = offset(0, jsdom에선 rect가 0) + 히스테리시스 4. market·key-points가 위로 지났다.
    mountSections({ 'key-points': -500, market: -100, milestones: 300, prose: 900 })
    const { container } = at(<TechChapterNav items={ITEMS} visible />)
    fire()
    const activeChips = [...container.querySelectorAll('[data-active="true"]')]
    expect(activeChips).toHaveLength(1)
    expect(activeChips[0].dataset.chapter).toBe('market-competition')
  })

  it('② 문서 끝(전 섹션이 경계 위) → **마지막 장**이 활성 — scroll-spy의 고전적 결함 가드', () => {
    mountSections({ 'key-points': -2000, market: -1500, milestones: -900, prose: -200 })
    const { container } = at(<TechChapterNav items={ITEMS} visible />)
    fire()
    expect(container.querySelector('[data-active="true"]').dataset.chapter).toBe('evidence')
  })

  it('아직 아무 섹션도 경계를 지나지 않으면 첫 장이 활성이다 — 하이라이트 없는 프레임을 만들지 않는다', () => {
    mountSections({ 'key-points': 400, market: 900, milestones: 1500, prose: 2200 })
    const { container } = at(<TechChapterNav items={ITEMS} visible />)
    fire()
    expect(container.querySelector('[data-active="true"]').dataset.chapter).toBe('overview')
  })

  it('활성 칩이 스크롤에 따라 실제로 **바뀐다** — 「존재한다」만 재면 첫 장 고정도 통과한다', () => {
    mountSections({ 'key-points': -100, market: 500, milestones: 1200, prose: 2000 })
    const { container } = at(<TechChapterNav items={ITEMS} visible />)
    fire()
    const seen = [container.querySelector('[data-active="true"]').dataset.chapter]
    // 스크롤을 내린 것과 같은 효과: 각 섹션 top을 끌어올린다
    for (const shift of [700, 1400, 2200]) {
      for (const id of ['key-points', 'market', 'milestones', 'prose']) {
        const el = document.getElementById(id)
        const base = { 'key-points': -100, market: 500, milestones: 1200, prose: 2000 }[id] - shift
        el.getBoundingClientRect = () => ({ top: base, bottom: base + 100, left: 0, right: 0, width: 0, height: 100 })
      }
      fire()
      seen.push(container.querySelector('[data-active="true"]').dataset.chapter)
    }
    expect([...new Set(seen)]).toHaveLength(4)
    expect(seen).toEqual(['overview', 'market-competition', 'progress-risk', 'evidence'])
  })

  it('③ unmount에서 IO를 disconnect한다 — 누수 가드', () => {
    mountSections({ 'key-points': 0, market: 500, milestones: 1000, prose: 1500 })
    const { unmount } = at(<TechChapterNav items={ITEMS} visible />)
    expect(ioCallbacks.length).toBeGreaterThan(0)
    unmount()
    expect(ioCallbacks).toHaveLength(0)
  })

  it('④ 이빨 — 판정이 「지금 교차 중」이면 ②가 깨진다(문서 끝에서 아무것도 교차하지 않는다)', () => {
    // 이 축의 판별력: 전 섹션이 경계 **위**에 있는 상태에서도 활성이 나온다는 것 자체가
    // 「지금 교차 중」 판정으로는 불가능하다(교차 중인 섹션이 0개다).
    mountSections({ 'key-points': -3000, market: -2500, milestones: -2000, prose: -1000 })
    const { container } = at(<TechChapterNav items={ITEMS} visible />)
    fire()
    const active = container.querySelector('[data-active="true"]')
    expect(active).toBeTruthy()
    expect(active.dataset.chapter).toBe('evidence')
  })
})
