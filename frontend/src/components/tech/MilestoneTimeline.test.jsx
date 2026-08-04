import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import MilestoneTimeline, { milestoneTimelineLayout, truncateLabel, milestoneAriaLabel } from './MilestoneTimeline'

// task#281 S3 — 진척 타임라인. TDD 대상은 milestoneTimelineLayout이고, 좌표는 **리터럴이 아니라
// 불변식**으로 단언한다(열 폭·행 높이를 정당하게 바꿔도 거짓 실패하지 않게). 렌더 테스트는 jsdom이
// 신뢰할 수 있는 것(DOM 구조·텍스트·인라인 스타일 문자열)만 본다 — 레이아웃 실측은 라이브 프로브 몫.

const SMR = [
  { year: 2020, actor: '로사톰', event: '로모노소프 가동', status: 'done' },
  { year: 2023, actor: '중국핵공업집단', event: 'HTR-PM 상업운전', status: 'done' },
  { year: 2026, actor: 'CNNC', event: '링룽 계통연결', status: 'in_progress' },
  { year: 2029, actor: 'GE Hitachi', event: 'BWRX-300 가동', status: 'planned' },
  { year: 2034, actor: '한수원', event: 'i-SMR 상용화', status: 'planned' },
]

describe('milestoneTimelineLayout — 좌표 불변식', () => {
  it('① 연도 오름차순 ↔ x 비감소 (입력이 뒤섞여 있어도 정렬된다)', () => {
    const shuffled = [SMR[3], SMR[0], SMR[4], SMR[2], SMR[1]]
    const { items, columns } = milestoneTimelineLayout({ milestones: shuffled })

    const years = columns.map((c) => c.year)
    expect(years).toEqual([...years].sort((a, b) => a - b))
    for (let i = 1; i < columns.length; i++) {
      expect(columns[i].x).toBeGreaterThan(columns[i - 1].x)
    }
    // 아이템 순서도 연도 오름차순이고 x는 비감소(같은 해면 동일 x)
    for (let i = 1; i < items.length; i++) {
      expect(items[i].year).toBeGreaterThanOrEqual(items[i - 1].year)
      expect(items[i].x).toBeGreaterThanOrEqual(items[i - 1].x)
    }
  })

  it('② 같은 연도 다중 이벤트는 서로 겹치지 않는다(행 간격 ≥ 행 높이)', () => {
    const { items } = milestoneTimelineLayout({
      milestones: [
        { year: 2026, event: '가동', status: 'done' },
        { year: 2026, event: '착공', status: 'in_progress' },
        { year: 2026, event: '인증', status: 'planned' },
        { year: 2030, event: '상용화', status: 'planned' },
      ],
    })
    const cols = new Set(items.map((it) => it.col))
    cols.forEach((col) => {
      const rows = items.filter((it) => it.col === col).sort((a, b) => a.y - b.y)
      expect(new Set(rows.map((r) => r.x)).size).toBe(1) // 같은 해는 x 동일
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i].y - rows[i - 1].y).toBeGreaterThanOrEqual(rows[i - 1].h - 1e-6)
      }
    })
  })

  it('③ 모든 마커·라벨 상자가 플롯 영역(0..width, 0..height) 내부', () => {
    const { items, columns, width, height } = milestoneTimelineLayout({
      milestones: [...SMR, { year: 2026, event: '두 번째 2026 이벤트', status: 'planned' }],
    })
    expect(width).toBeGreaterThan(0)
    expect(height).toBeGreaterThan(0)
    columns.forEach((c) => {
      expect(c.x).toBeGreaterThanOrEqual(0)
      expect(c.x).toBeLessThanOrEqual(width)
    })
    items.forEach((it) => {
      expect(it.markerX - it.r).toBeGreaterThanOrEqual(0)
      expect(it.markerX + it.r).toBeLessThanOrEqual(width + 1e-6)
      expect(it.markerY - it.r).toBeGreaterThanOrEqual(0)
      expect(it.markerY + it.r).toBeLessThanOrEqual(height + 1e-6)
      expect(it.labelX).toBeGreaterThanOrEqual(0)
      expect(it.labelX + it.labelW).toBeLessThanOrEqual(width + 1e-6)
      expect(it.y).toBeGreaterThanOrEqual(0)
      expect(it.y + it.h).toBeLessThanOrEqual(height + 1e-6)
    })
  })

  it('④ 한 해의 이벤트가 넘치면 접힘 표시의 N == 숨겨진 개수(표시와 실제가 어긋나면 wrong)', () => {
    const many = [1, 2, 3, 4, 5].map((n) => ({ year: 2026, event: `이벤트${n}`, status: 'planned' }))
    const { items } = milestoneTimelineLayout({ milestones: many })

    const fold = items.find((it) => it.fold)
    const shown = items.filter((it) => !it.fold)
    expect(fold).toBeTruthy()
    expect(fold.hidden).toBe(many.length - shown.length) // N == 실제로 숨긴 개수
    expect(fold.event).toBe(`+${fold.hidden}개`)
    expect(fold.hiddenEvents).toHaveLength(fold.hidden) // 접어도 원문은 보존한다
    // 접힌 것 + 표시된 것 == 입력 전부(유실 0)
    expect([...shown.map((s) => s.event), ...fold.hiddenEvents].sort())
      .toEqual(many.map((m) => m.event).sort())
  })

  it('④-b 행 상한 이하면 폴드가 생기지 않는다', () => {
    const { items } = milestoneTimelineLayout({
      milestones: [
        { year: 2026, event: 'a', status: 'done' },
        { year: 2026, event: 'b', status: 'done' },
        { year: 2026, event: 'c', status: 'done' },
      ],
    })
    expect(items).toHaveLength(3)
    expect(items.every((it) => !it.fold)).toBe(true)
  })

  it('⑤ 열이 늘면 설계폭도 늘어난다(축소가 아니라 스크롤로 흡수하기 위한 전제)', () => {
    const w2 = milestoneTimelineLayout({ milestones: SMR.slice(0, 2) }).width
    const w5 = milestoneTimelineLayout({ milestones: SMR }).width
    expect(w5).toBeGreaterThan(w2)
    // 같은 해가 늘면 폭이 아니라 높이가 는다
    const tall = milestoneTimelineLayout({
      milestones: [{ year: 2026, event: 'a', status: 'done' }, { year: 2026, event: 'b', status: 'done' }],
    })
    const short = milestoneTimelineLayout({ milestones: [{ year: 2026, event: 'a', status: 'done' }] })
    expect(tall.width).toBe(short.width)
    expect(tall.height).toBeGreaterThan(short.height)
  })

  it('⑥ 부재·빈 배열·무효 항목은 빈 레이아웃(섹션째 생략의 근거)', () => {
    const empty = { columns: [], items: [], width: 0, height: 0, axisY: expect.any(Number) }
    expect(milestoneTimelineLayout()).toMatchObject(empty)
    expect(milestoneTimelineLayout({ milestones: null })).toMatchObject(empty)
    expect(milestoneTimelineLayout({ milestones: [] })).toMatchObject(empty)
    expect(milestoneTimelineLayout({
      milestones: [
        { year: '2026', event: '연도가 문자열', status: 'done' },
        { year: 2026, event: '   ', status: 'done' },
        { year: Number.NaN, event: '연도 NaN', status: 'done' },
        null,
      ],
    })).toMatchObject(empty)
  })

  it('⑦ enum 밖 status·주체 결측은 죽지 않고 planned/null로 떨어진다', () => {
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

// ── F1(리뷰) 회귀 — 열 폭을 상수로 고정했더니 라벨이 116px에서 잘려 한국어 문장의 **끝**(동사 =
//    사건 종류)이 사라졌다. 스크롤러가 무한폭이므로 자를 이유가 없다 → 라벨 실측 최대폭에서 파생.
describe('milestoneTimelineLayout — 열 폭은 라벨에서 파생된다(F1)', () => {
  const LONG = '로모노소프 부유식 원전 상업운전' // 리뷰 재현 데이터(추정폭 179.4px > 옛 상한 116px)

  it('⑧ 긴 한국어 이벤트가 말줄임 없이 들어간다(가용폭이 옛 상수 116을 넘어선다)', () => {
    const { items } = milestoneTimelineLayout({
      milestones: [{ year: 2020, actor: '로사톰', event: LONG, status: 'done' }],
    })
    expect(items[0].labelW).toBeGreaterThan(116) // 옛 LABEL_MAX_W — 여기 고정돼 있으면 잘린다
    // 렌더가 쓰는 것과 같은 측정기(jsdom은 추정 폴백)로 재확인 — 말줄임이 끼지 않는다
    expect(truncateLabel(LONG, items[0].labelW, 12)).toBe(LONG)
    expect(truncateLabel('로사톰', items[0].labelW, 11)).toBe('로사톰')
  })

  it('⑨ 라벨이 짧으면 최소 폭(148)을 유지한다 — 긴 라벨만 열을 넓힌다', () => {
    const short = milestoneTimelineLayout({ milestones: [{ year: 2020, event: '가동', status: 'done' }] })
    const long = milestoneTimelineLayout({ milestones: [{ year: 2020, event: LONG, status: 'done' }] })
    expect(short.colW).toBe(148)
    expect(long.colW).toBeGreaterThan(short.colW)
    expect(long.width).toBeGreaterThan(short.width) // 넓어진 만큼 스크롤이 길어질 뿐
  })

  it('⑩ 측정기는 주입 가능하고 실제로 폭을 지배한다(라이브는 getComputedTextLength 실측)', () => {
    const wide = milestoneTimelineLayout(
      { milestones: [{ year: 2020, event: 'x', status: 'done' }] },
      { measure: () => 400 },
    )
    expect(wide.items[0].labelW).toBeGreaterThanOrEqual(400)
    expect(wide.colW).toBe(400 + 18 + 14)
  })

  it('⑪ 접힘 라벨("+N개")·주체도 폭 산정에 들어간다(가장 긴 것 하나만 잘려도 안 된다)', () => {
    const longActor = '아주아주 긴 운용주체 이름 주식회사'
    const { items } = milestoneTimelineLayout({
      milestones: [{ year: 2020, actor: longActor, event: '가동', status: 'done' }],
    })
    expect(truncateLabel(longActor, items[0].labelW, 11)).toBe(longActor)
  })
})

describe('truncateLabel', () => {
  it('가용폭을 넘는 라벨만 말줄임한다', () => {
    expect(truncateLabel('짧음', 116, 12)).toBe('짧음')
    const long = truncateLabel('아주 긴 한글 이벤트 라벨이 여기 들어간다', 116, 12)
    expect(long.endsWith('…')).toBe(true)
    expect(long.length).toBeLessThan('아주 긴 한글 이벤트 라벨이 여기 들어간다'.length)
  })
})

describe('MilestoneTimeline — 렌더', () => {
  it('milestones 부재·빈 배열이면 아무것도 렌더하지 않는다(구발행물 graceful)', () => {
    expect(render(<MilestoneTimeline />).container.firstChild).toBeNull()
    expect(render(<MilestoneTimeline milestones={null} />).container.firstChild).toBeNull()
    expect(render(<MilestoneTimeline milestones={[]} />).container.firstChild).toBeNull()
  })

  it('연도·이벤트·주체가 렌더되고 원문은 title에 보존된다', () => {
    // 이벤트 문자열은 <text>와 <title> 양쪽에 실려 매치가 2건 이상이다(TechGraph.test와 동일한 함정)
    const { getByText, getAllByText, container } = render(<MilestoneTimeline milestones={SMR} />)
    expect(getByText('2020')).toBeTruthy()
    expect(getByText('2034')).toBeTruthy()
    expect(getAllByText('링룽 계통연결').length).toBeGreaterThan(0)
    expect(getByText('중국핵공업집단')).toBeTruthy()
    const titles = [...container.querySelectorAll('title')].map((t) => t.textContent)
    expect(titles).toEqual(expect.arrayContaining(['로모노소프 가동', 'i-SMR 상용화']))
  })

  it('status별 마커가 구분된다 — done=채움 / in_progress=반채움 / planned=외곽선', () => {
    const { container } = render(<MilestoneTimeline milestones={SMR} />)
    const byStatus = (s) => container.querySelector(`[data-testid="milestone-item"][data-status="${s}"]`)

    expect(byStatus('done').querySelector('circle').style.fill).toBe('var(--color-success)')
    expect(byStatus('done').querySelector('path')).toBeNull()
    // 반채움은 외곽선 원 + 반원 path 조합이라 planned와 DOM으로 구별된다
    expect(byStatus('in_progress').querySelector('circle').style.stroke).toBe('var(--warn)')
    expect(byStatus('in_progress').querySelector('path')).toBeTruthy()
    expect(byStatus('planned').querySelector('circle').style.stroke).toBe('var(--text-3)')
    expect(byStatus('planned').querySelector('path')).toBeNull()
    // F3(리뷰) — planned는 `--bg-elev` 채움이었다. 이 SVG의 조상은 Card가 아니라 TechReport 루트라
    // 실제 배경은 `--bg`이고, 두 토큰이 달라(#f6f1e7 vs #fdfaf3) "비어 보여야 할 원"이 원반이 됐다.
    expect(byStatus('planned').querySelector('circle').style.fill).toBe('none')
    // in_progress는 반원이 읽히려면 베이스가 불투명해야 하므로 none이 아니라 배경색과 일치시킨다
    expect(byStatus('in_progress').querySelector('circle').style.fill).toBe('var(--bg)')
    expect(container.innerHTML).not.toContain('var(--bg-elev)')
  })

  it('F2 접근성 — 항목마다 연도·주체·이벤트·상태가 aria-label로 노출된다(role="img" 원자화 금지)', () => {
    const { container, getByTestId } = render(<MilestoneTimeline milestones={SMR} />)
    const svg = getByTestId('milestone-timeline-svg')

    // role="img"면 AT가 자손을 통째로 감춰 5건의 데이터가 접근성 트리에서 사라진다
    expect(svg.getAttribute('role')).not.toBe('img')
    expect(container.querySelector('[role="list"]')).toBeTruthy()

    const labels = [...container.querySelectorAll('[role="listitem"]')].map((g) => g.getAttribute('aria-label'))
    expect(labels).toHaveLength(SMR.length)
    expect(labels[0]).toBe('2020년 로사톰 로모노소프 가동 (완료)')
    expect(labels[2]).toBe('2026년 CNNC 링룽 계통연결 (진행 중)')
    expect(labels[4]).toBe('2034년 한수원 i-SMR 상용화 (예정)')
    // 5건 전부가 연도·주체·이벤트·상태 4요소를 갖는다
    SMR.forEach((m, i) => {
      expect(labels[i]).toContain(String(m.year))
      expect(labels[i]).toContain(m.actor)
      expect(labels[i]).toContain(m.event)
      expect(labels[i]).toContain({ done: '완료', in_progress: '진행 중', planned: '예정' }[m.status])
    })
    // 연도 눈금은 항목 라벨에 이미 들어가므로 중복 낭독하지 않는다
    expect(container.querySelector('[data-testid="milestone-column"]').closest('[aria-hidden="true"]')).toBeTruthy()
  })

  it('F2 접근성 — 주체 결측·폴드 행도 라벨을 잃지 않는다', () => {
    expect(milestoneAriaLabel({ year: 2027, actor: null, event: '착공', status: 'planned' }))
      .toBe('2027년 착공 (예정)')
    expect(milestoneAriaLabel({ year: 2026, fold: true, hidden: 2, hiddenEvents: ['a', 'b'] }))
      .toBe('2026년 그 외 2건: a, b')
    const many = [1, 2, 3, 4, 5].map((n) => ({ year: 2026, event: `이벤트${n}`, status: 'planned' }))
    const { container } = render(<MilestoneTimeline milestones={many} />)
    const foldLabel = container.querySelector('[data-testid="milestone-fold"]').getAttribute('aria-label')
    expect(foldLabel).toContain('이벤트5') // 접혀도 AT는 원문을 얻는다(wrong < missing)
  })

  it('F4 정량 축 오독 방지 — 전 구간 축선이 없고 등간격임을 텍스트로 고지한다', () => {
    const { container, getByTestId } = render(<MilestoneTimeline milestones={SMR} />)
    const svg = getByTestId('milestone-timeline-svg')

    // x는 연도값이 아니라 열 서수라(2026→2029=3년과 2029→2034=5년이 같은 148px) 전 구간을 잇는
    // 축선이 "가로 거리 = 경과 시간"이라는 정량 축 문법을 만든다 → 열별 눈금만 남긴 범주형 스트립.
    expect([...svg.children].filter((c) => c.tagName.toLowerCase() === 'line')).toHaveLength(0)
    expect(container.querySelectorAll('[data-testid="milestone-column"] line')).toHaveLength(5)
    expect(getByTestId('milestone-spacing-note').textContent).toContain('등간격')
    expect(svg.getAttribute('aria-label')).toContain('등간격')
  })

  it('가격 방향 토큰(--up/--down)을 쓰지 않는다 — 마일스톤은 의미 상태다', () => {
    const { container } = render(<MilestoneTimeline milestones={SMR} />)
    expect(container.innerHTML).not.toMatch(/var\(--up\b/)
    expect(container.innerHTML).not.toMatch(/var\(--down\b/)
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}\b/) // 하드코딩 hex 0건
  })

  it('범례는 실제로 존재하는 상태만 표시한다', () => {
    const { getByTestId } = render(<MilestoneTimeline milestones={SMR.slice(0, 2)} />)
    const legend = getByTestId('milestone-legend')
    expect(legend.textContent).toContain('완료')
    expect(legend.textContent).not.toContain('진행 중')
    expect(legend.textContent).not.toContain('예정')
  })

  it('SVG는 설계폭을 minWidth로 못박고 스크롤러에 담긴다(축소되면 라벨이 6~7px가 된다 — task#277)', () => {
    const { getByTestId } = render(<MilestoneTimeline milestones={SMR} />)
    const svg = getByTestId('milestone-timeline-svg')
    const { width, height } = milestoneTimelineLayout({ milestones: SMR })

    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${width} ${height}`)
    expect(svg.style.minWidth).toBe(`${width}px`)
    expect(svg.style.maxWidth).toBe(`${width}px`) // 확대도 막는다 — 라벨 폰트가 페이지와 어긋나지 않게
    expect(svg.parentElement.style.overflowX).toBe('auto')
  })

  it('폴드 행은 "+N개"로 렌더되고 숨은 원문을 title에 담는다', () => {
    const many = [1, 2, 3, 4, 5].map((n) => ({ year: 2026, event: `이벤트${n}`, status: 'planned' }))
    const { getByTestId, getAllByTestId } = render(<MilestoneTimeline milestones={many} />)
    const fold = getByTestId('milestone-fold')
    const shown = getAllByTestId('milestone-item')

    expect(fold.getAttribute('data-hidden')).toBe(String(many.length - shown.length))
    expect(fold.textContent).toContain(`+${many.length - shown.length}개`)
    expect(fold.querySelector('title').textContent).toContain('이벤트5')
  })
})
