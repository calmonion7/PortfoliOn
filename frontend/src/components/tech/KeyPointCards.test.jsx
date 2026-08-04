import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import KeyPointCards from './KeyPointCards'

// task#281 S2 — 핵심 포인트 카드. 관측점 3개: 칩 열 수(task#225 역전 함정) · 구발행물 graceful ·
// 증감 색 클래스.
//
// ⚠️ jsdom은 스타일시트를 적용하지 않으므로 "클래스는 붙었는데 CSS 규칙이 없다"를 렌더로는 원리적으로
//    볼 수 없다(가토 ⑪ — 아무도 죽지 않고 색만 조용히 사라진다. vitest는 클래스명을 단언하니 수정
//    전에도 통과하고, 빌드는 미사용 CSS를 모른다). 그래서 tokens.css 원문을 fs로 직접 읽어
//    `.up`/`.down` 규칙의 실재를 함께 못박는다.
// ⚠️ CSS는 fs로 읽는다 — vitest는 `css: false`라 `?raw`까지 빈 문자열로 스텁한다(TechKpiStrip.test 선례).
const TOKENS = readFileSync(join(import.meta.dirname, '../../styles/tokens.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')   // 주석의 반례가 판정을 오염시키지 않게(가토 ⑧ⓜ)

const mk = (n) => Array.from({ length: n }, (_, i) => ({ label: `지표${i}`, value: `${i}조원` }))
const POINT = (over = {}) => ({ title: '포인트 제목', body: '근거 한두 문장.', ...over })

describe('KeyPointCards — 칩 열 수(task#225)', () => {
  it('4포인트 × 칩 4개면 전 카드가 2열이다 (3열로 깔면 label이 접혀 카드가 오히려 커진다)', () => {
    const points = Array.from({ length: 4 }, (_, i) => POINT({ title: `포인트${i}`, metrics: mk(4) }))
    render(<KeyPointCards points={points} />)
    const grids = screen.getAllByTestId('tech-key-point-chips')
    expect(grids.length).toBe(4)                       // 커버리지: 4카드 전수 판정(표본 스킵 0)
    grids.forEach((g) => expect(g.style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))'))
    expect(screen.getAllByTestId('tech-key-point').length).toBe(4)
  })

  it('칩 3개 이하면 칩 수만큼 열 — 1·2·3개 전수', () => {
    for (const n of [1, 2, 3]) {
      const { unmount } = render(<KeyPointCards points={[POINT({ metrics: mk(n) })]} />)
      expect(screen.getByTestId('tech-key-point-chips').style.gridTemplateColumns)
        .toBe(`repeat(${n}, minmax(0, 1fr))`)
      unmount()
    }
  })

  it('metrics가 null·빈 배열이면 칩 그리드 자체가 없고 제목·본문은 남는다', () => {
    render(<KeyPointCards points={[POINT({ metrics: null }), POINT({ title: '두번째', metrics: [] })]} />)
    expect(screen.queryByTestId('tech-key-point-chips')).toBeNull()
    expect(screen.getAllByTestId('tech-key-point').length).toBe(2)
    expect(screen.getByText('두번째')).toBeTruthy()
    expect(screen.getAllByText('근거 한두 문장.').length).toBe(2)
  })

  it('번호는 01부터 2자리로, 칩 label·value가 그대로 실린다', () => {
    render(<KeyPointCards points={[POINT({ metrics: [{ label: '발사비', value: '1.1조원' }] }), POINT()]} />)
    expect(screen.getByText('01')).toBeTruthy()
    expect(screen.getByText('02')).toBeTruthy()
    expect(screen.getByText('발사비')).toBeTruthy()
    expect(screen.getByText('1.1조원')).toBeTruthy()
  })
})

describe('KeyPointCards — 구발행물 graceful', () => {
  // 라이브 실데이터 2건(smr·reusable-rocket)은 컬럼이 SQL NULL이라 `key_points: null`로 온다.
  // 옛 판 본문(키 자체 없음)은 undefined다 — 둘 다 같은 자리에서 흡수돼야 한다.
  it.each([
    ['구발행물 null', null],
    ['키 자체 없음 undefined', undefined],
    ['빈 배열', []],
    ['배열 아닌 값', {}],
  ])('%s → 섹션 DOM 부재(제목 포함) + 형제 섹션 렌더 영향 0 + 콘솔 에러 0', (_label, points) => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { container } = render(
      <div>
        <p data-testid="sibling-before">주요 업체</p>
        <KeyPointCards points={points} />
        <p data-testid="sibling-after">기술수준 비교</p>
      </div>
    )
    expect(screen.queryByTestId('tech-key-points')).toBeNull()
    expect(screen.queryByText('핵심 포인트')).toBeNull()     // 제목만 남는 유령 섹션 금지
    expect(screen.queryByTestId('tech-key-point')).toBeNull()
    expect(screen.getByTestId('sibling-before')).toBeTruthy()
    expect(screen.getByTestId('sibling-after')).toBeTruthy()
    expect(container.firstChild.childNodes.length).toBe(2)   // 빈 래퍼 노드조차 남기지 않는다
    expect(errSpy).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('데이터가 있으면 섹션 제목과 함께 렌더된다(위 부재 단언의 대조군)', () => {
    render(<KeyPointCards points={[POINT()]} />)
    expect(screen.getByTestId('tech-key-points')).toBeTruthy()
    expect(screen.getByText('핵심 포인트')).toBeTruthy()
  })
})

describe('KeyPointCards — change_pct 색', () => {
  it('음수→down · 양수→up · null→무표기', () => {
    render(<KeyPointCards points={[POINT({
      metrics: [
        { label: '발사비', value: '1.1조원', change_pct: -22.0 },
        { label: '발사횟수', value: '22회', change_pct: 8.5 },
        { label: '가동기', value: '3기', change_pct: null },
      ],
    })]} />)
    const rows = screen.getAllByTestId('tech-key-point-change')
    expect(rows.length).toBe(2)                              // null은 행 자체가 없다(무표기)
    // ⚠️ className 부분문자열이 아니라 classList 토큰으로 판정한다 — `toContain('down')`은
    //    `chg-down`처럼 **CSS에 없는 이름**도 통과시켜(실측) 색 소실을 못 본다(가토 ⑪).
    expect(rows[0].classList.contains('down')).toBe(true)
    expect(rows[0].classList.contains('up')).toBe(false)
    // 부호는 화살표가 대신한다 — 값은 항상 |v|(정본 ChangeBadge와 같은 계약, task#281 F5).
    // 전엔 `▼-22%`로 음수가 두 번 표기됐다. 심층 리포트 지표 칩(AnalystReport.jsx)과 **같이** 고쳤다.
    expect(rows[0].textContent).toBe('▼22.0%')
    expect(rows[1].classList.contains('up')).toBe(true)
    expect(rows[1].classList.contains('down')).toBe(false)
    expect(rows[1].textContent).toBe('▲+8.5%')
  })

  it('change_pct 0은 삼켜지지 않는다 — `if (v)`가 아니라 `!= null` 분기', () => {
    render(<KeyPointCards points={[POINT({ metrics: [{ label: 'L', value: 'V', change_pct: 0 }] })] } />)
    const row = screen.getByTestId('tech-key-point-change')
    expect(row.textContent).toBe('▲+0.0%')
    expect(row.classList.contains('up')).toBe(true)
  })

  it('세 자리 이상 증감은 반올림해 소수 꼬리를 자른다', () => {
    render(<KeyPointCards points={[POINT({ metrics: [{ label: 'L', value: 'V', change_pct: 233.33 }] })] } />)
    expect(screen.getByTestId('tech-key-point-change').textContent).toBe('▲+233%')
  })

  it('음수는 이중 부호가 되지 않고 소수 자릿수도 정본을 따른다(task#281 F5)', () => {
    // 정본 ChangeBadge = `▼ 12.5%` — 화살표가 부호를 대신하고 toFixed(1). 세 자리 이상만 반올림.
    // AnalystReport.jsx 투자 포인트 칩과 같은 식이라 두 표면 회귀 테스트가 쌍으로 존재한다.
    const cases = [
      [-12.5, '▼12.5%'], [-150, '▼150%'], [-22.0, '▼22.0%'],
      [22.123456789, '▲+22.1%'], [-99.96, '▼100.0%'], [0.04, '▲+0.0%'],
    ]
    for (const [v, want] of cases) {
      const { unmount } = render(<KeyPointCards points={[POINT({ metrics: [{ label: 'L', value: 'V', change_pct: v }] })]} />)
      expect(screen.getByTestId('tech-key-point-change').textContent).toBe(want)
      unmount()
    }
    expect(cases.length).toBe(6)   // 커버리지: 표본 스킵 0
  })

  it('⚠️ 이빨 단언: 쓰는 클래스가 tokens.css에 실재하고 두 색 토큰이 서로 다르다', () => {
    expect(TOKENS).toMatch(/^\.up\s*\{[^}]*color:\s*var\(--up\)/m)
    expect(TOKENS).toMatch(/^\.down\s*\{[^}]*color:\s*var\(--down\)/m)
    // 토큰이 같은 값이면 위 클래스 단언은 아무것도 못 본 채 통과한다(라이트·다크 양쪽)
    const hex = (name, from) => from.match(new RegExp(`--${name}:\\s*([^;]+);`))[1].trim()
    const dark = TOKENS.slice(TOKENS.indexOf('[data-theme="dark"]'))
    expect(hex('up', TOKENS)).not.toBe(hex('down', TOKENS))
    expect(hex('up', dark)).not.toBe(hex('down', dark))
  })
})
