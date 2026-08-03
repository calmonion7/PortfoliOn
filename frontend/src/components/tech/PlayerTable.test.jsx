import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import PlayerTable, { SCROLLER, NAME_TEXT, NOTE_BODY, NOTE_SUMMARY } from './PlayerTable'

// task#280 S3 — 업체 카드 → 표. 정렬은 리터럴 순서가 아니라 **불변식**으로 단언한다
// (정당한 데이터 변경/타이브레이크 추가에 거짓 실패하지 않게).
//
// 픽스처는 라이브 두 판을 모두 덮는다 — 한쪽만 보면 놓친다(실제로 그래서 놓쳤다).
//   SMR    : players 9 · cagr_pct null · leader_name 짧음 · share_pct 0/음수/null 혼재
//   ROCKET : players 8 · leader_name에 부연 괄호(`SpaceX (Grasshopper 호핑 2013년)`) · 선두 2종
const PLAYERS = [
  { name: '두산에너빌리티', country: 'KR', ticker: '034020', tech_level: 4, gap_years: null, leader_name: 'NuScale', share_pct: null, state_led: false, note: '주기기 공급망의 핵심.' },
  { name: 'NuScale', country: 'US', ticker: 'SMR', tech_level: 5, gap_years: 0, leader_name: 'NuScale', share_pct: 22.5, state_led: false, note: '설계인증 취득.' },
  { name: '중국핵공업집단', country: 'CN', ticker: null, tech_level: 5, gap_years: 0, leader_name: '중국핵공업집단', share_pct: 31, state_led: true, note: '링룽1호 상용 착공.' },
  { name: 'X-energy', country: 'US', ticker: null, tech_level: 4, gap_years: 3, leader_name: 'NuScale', share_pct: 0, state_led: false, note: null },
  { name: 'Rolls-Royce SMR', country: 'UK', ticker: null, tech_level: 4, gap_years: 5, leader_name: 'NuScale', share_pct: -1, state_led: false, note: '영국 정부 지원.' },
  { name: 'GE Hitachi', country: 'US', ticker: null, tech_level: 4, gap_years: 1, leader_name: 'NuScale', share_pct: 8.2, state_led: false, note: null },
  { name: 'TerraPower', country: 'US', ticker: null, tech_level: 3, gap_years: 6, leader_name: 'NuScale', share_pct: null, state_led: false, note: '나트륨냉각 실증.' },
  { name: 'Rosatom', country: 'RU', ticker: null, tech_level: 3, gap_years: -2, leader_name: 'NuScale', share_pct: null, state_led: true, note: null },
  { name: '한국원자력연구원', country: 'KR', ticker: null, tech_level: null, gap_years: null, leader_name: null, share_pct: null, state_led: true, note: 'SMART 표준설계.' },
]

const LEADER_LONG = 'SpaceX (Grasshopper 호핑 2013년)'
const ROCKET = [
  { name: 'SpaceX', country: 'US', ticker: null, tech_level: 5, gap_years: 0, leader_name: LEADER_LONG, share_pct: 50.9, state_led: false, note: '팰컨9 1단 회수를 반복 수행.' },
  { name: 'Blue Origin', country: 'US', ticker: null, tech_level: 4, gap_years: 6, leader_name: LEADER_LONG, share_pct: 3.1, state_led: false, note: null },
  { name: 'Rocket Lab', country: 'US', ticker: 'RKLB', tech_level: 4, gap_years: 8, leader_name: LEADER_LONG, share_pct: 2.4, state_led: false, note: '뉴트론 개발 중.' },
  { name: 'CASC', country: 'CN', ticker: null, tech_level: 3, gap_years: 10, leader_name: LEADER_LONG, share_pct: 0, state_led: true, note: null },
  { name: 'ArianeGroup', country: 'EU', ticker: null, tech_level: 3, gap_years: 12, leader_name: LEADER_LONG, share_pct: null, state_led: false, note: '아리안6는 재사용 미적용.' },
  // 판마다 선두가 하나가 아닐 수 있다 — 캡션 다중값 케이스(F3)
  { name: 'iSpace', country: 'CN', ticker: null, tech_level: 2, gap_years: 13, leader_name: '중국항천과기집단', share_pct: null, state_led: false, note: null },
  { name: 'Roscosmos', country: 'RU', ticker: null, tech_level: 2, gap_years: 14, leader_name: LEADER_LONG, share_pct: -1, state_led: true, note: null },
  { name: 'JAXA/MHI', country: 'JP', ticker: null, tech_level: 2, gap_years: null, leader_name: null, share_pct: null, state_led: true, note: '재사용 실증 착수.' },
]

const byName = Object.fromEntries(PLAYERS.map((p) => [p.name, p]))

function renderedOrder() {
  return screen.getAllByTestId('tech-report-player-name').map((el) => el.textContent)
}

function rowOf(name) {
  return screen.getAllByTestId('tech-report-player-row')
    .find((r) => within(r).getByTestId('tech-report-player-name').textContent === name)
}

// note 행은 해당 업체 행 바로 다음 형제다(있을 때만 렌더). 없으면 null.
function noteRowOf(name) {
  const next = rowOf(name).nextElementSibling
  return next?.getAttribute('data-testid') === 'tech-report-player-note' ? next : null
}

describe('PlayerTable (task#280 S3)', () => {
  it('업체 수만큼 행을 렌더하고 루트 data-testid를 유지한다 — 두 판 모두', () => {
    const { unmount } = render(<PlayerTable players={PLAYERS} />)
    // 기존 TechReport.test.jsx가 within()으로 이 앵커를 쓴다 — 스타일이 바뀌어도 유지 대상
    expect(screen.getByTestId('tech-report-players')).toBeTruthy()
    expect(screen.getAllByTestId('tech-report-player-row').length).toBe(9)
    unmount()

    render(<PlayerTable players={ROCKET} />)
    expect(screen.getAllByTestId('tech-report-player-row').length).toBe(8)
  })

  it('정렬 불변식 ① 기술수준이 비증가한다(결측은 최하단)', () => {
    render(<PlayerTable players={PLAYERS} />)
    const levels = renderedOrder().map((n) => byName[n].tech_level ?? -Infinity)
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeLessThanOrEqual(levels[i - 1])
  })

  it('정렬 불변식 ② 같은 기술수준 구간 안에서 격차가 비감소하고 null이 그 구간의 마지막이다', () => {
    render(<PlayerTable players={PLAYERS} />)
    const order = renderedOrder().map((n) => byName[n])
    for (let i = 1; i < order.length; i++) {
      if ((order[i].tech_level ?? null) !== (order[i - 1].tech_level ?? null)) continue // 구간 경계
      const prev = order[i - 1].gap_years, cur = order[i].gap_years
      expect(prev != null || cur == null).toBe(true)          // null 뒤에 값이 오지 않는다
      if (prev != null && cur != null) expect(cur).toBeGreaterThanOrEqual(prev)
    }
  })

  it('정렬은 원본 배열을 변형하지 않는다', () => {
    const snapshot = PLAYERS.map((p) => p.name)
    render(<PlayerTable players={PLAYERS} />)
    expect(PLAYERS.map((p) => p.name)).toEqual(snapshot)
  })

  // ── 적대 리뷰 F9 회귀 ─────────────────────────────────────────────────────
  // ⚠️ 옛 테스트('note는 기본 접힘이고, 토글로 펼쳤다 다시 접을 수 있다')를 대체한다.
  // 옛 구현은 접히면 note 행을 DOM에서 통째 제거해 Ctrl+F·스크린리더·프로브가 못 찾았고,
  // 그 테스트는 `queryAllByTestId(...).length === 0`으로 **그 소멸을 잠그고** 있었다.
  // 접기는 네이티브 <details>로 옮겼다(ProseSections.jsx가 못박은 규율). jsdom은 details를
  // 숨기지 않으므로 "보이는가"는 여기서 못 잰다 — 열림은 details.open, 손실 0은 textContent로.
  it('F9 — 접힌 note도 DOM에 남는다(details 닫힘 + 본문 텍스트 존재)', () => {
    render(<PlayerTable players={PLAYERS} />)
    const noteRow = noteRowOf('NuScale')
    expect(noteRow).toBeTruthy()
    expect(noteRow.querySelector('details').open).toBe(false)   // 기본 접힘(표의 목적은 비교)
    expect(noteRow.textContent).toContain('설계인증 취득.')       // 접혀도 검색·스크린리더가 닿는다
    // 다른 업체의 note도 마찬가지 — 하나만 사는 구조가 아니다
    expect(noteRowOf('두산에너빌리티').textContent).toContain('주기기 공급망의 핵심.')
    expect(screen.getAllByTestId('tech-report-player-note').length)
      .toBe(PLAYERS.filter((p) => p.note).length)
  })

  it('note가 없는 업체는 note 행 자체가 없다', () => {
    render(<PlayerTable players={PLAYERS} />)
    expect(noteRowOf('GE Hitachi')).toBeNull()
    expect(within(rowOf('GE Hitachi')).queryByRole('button')).toBeNull()
  })

  // ── 적대 리뷰 F10 회귀 ────────────────────────────────────────────────────
  it('F10 — note 펼치기 컨트롤은 summary이고 히트영역 하한 24px + 접근 이름에 업체명', () => {
    render(<PlayerTable players={PLAYERS} />)
    // 옛 ▸ 버튼은 실측 5×11px(WCAG 최소 24×24의 1/10)이었다. summary는 블록이라 폭은 행 전체,
    // 높이는 minHeight로 하한한다(패딩은 그 위에 더해진다).
    expect(NOTE_SUMMARY.minHeight).toBeGreaterThanOrEqual(24)
    const summary = noteRowOf('NuScale').querySelector('summary')
    expect(summary.style.minHeight).toBe('24px')
    // 9개 summary의 시각 라벨이 전부 '설명'이라 접근 이름으로 구별돼야 한다
    expect(summary.getAttribute('aria-label')).toBe('NuScale 설명')
    expect(noteRowOf('두산에너빌리티').querySelector('summary').getAttribute('aria-label'))
      .toBe('두산에너빌리티 설명')
  })

  // ── 적대 리뷰 F3 회귀 ─────────────────────────────────────────────────────
  it('F3 — 「선두 대비」 셀은 격차만 담는다(leader_name 미포함)', () => {
    render(<PlayerTable players={ROCKET} />)
    // 옛 렌더는 매 행 `선두 대비 13년 · SpaceX (Grasshopper 호핑 2013년)`을 nowrap으로 담아
    // 이 열이 302px까지 부풀었고 표가 PC 1440(콘텐츠 748px)에서 891px로 넘쳤다.
    expect(rowOf('SpaceX').cells[3].textContent).toBe('현재 선두')   // gap 0은 유효값
    expect(rowOf('Blue Origin').cells[3].textContent).toBe('6년')
    expect(rowOf('JAXA/MHI').cells[3].textContent).toBe('—')        // null
    expect(rowOf('Roscosmos').cells[3].textContent).toBe('14년')
    // 표 안 어디에도 leader_name 문자열이 없다(캡션은 표 밖이라 이 스코프에 안 잡힌다)
    expect(within(screen.getByTestId('tech-report-players')).queryByText(new RegExp('Grasshopper'))).toBeNull()
    expect(screen.getByTestId('tech-report-players').textContent).not.toContain('선두 대비 6년')
  })

  it('F3 — leader_name은 표 위 캡션으로 승격되고 고유값이 2개 이상이면 전부 잇는다(손실 0)', () => {
    const { unmount } = render(<PlayerTable players={ROCKET} />)
    expect(screen.getByTestId('tech-report-players-leader').textContent)
      .toBe(`선두 = ${LEADER_LONG} · 중국항천과기집단`)
    unmount()

    // SMR 판은 격차 양수 행의 leader_name이 한 종류 — 캡션 한 줄
    render(<PlayerTable players={PLAYERS} />)
    expect(screen.getByTestId('tech-report-players-leader').textContent).toBe('선두 = NuScale')
  })

  it('F3 — 격차가 양수인 행이 없으면 캡션 자체를 렌더하지 않는다', () => {
    // gap_years가 0·null·음수뿐이면 옛 셀에도 leader_name이 안 보였다 — 캡션도 없어야 한다
    render(<PlayerTable players={PLAYERS.filter((p) => !(p.gap_years > 0))} />)
    expect(screen.queryByTestId('tech-report-players-leader')).toBeNull()
  })

  it('선두 대비 4케이스 — 0=현재 선두 · 양수=N년 · null과 음수는 표시하지 않는다', () => {
    render(<PlayerTable players={PLAYERS} />)
    expect(rowOf('NuScale').cells[3].textContent).toBe('현재 선두')
    expect(rowOf('GE Hitachi').cells[3].textContent).toBe('1년')
    // null(격차 미산정) · 음수(백엔드에 ge=0 제약 없음) 둘 다 추정하지 않고 —
    expect(rowOf('두산에너빌리티').cells[3].textContent).toBe('—')
    expect(rowOf('Rosatom').cells[3].textContent).toBe('—')
  })

  // ── 적대 리뷰 F7 회귀 ─────────────────────────────────────────────────────
  // ⚠️ 옛 테스트('점유율은 > 0 일 때만 표시하고 0·음수·결측은 —')를 뒤집는다.
  // 0은 결측이 아니라 값이다. 같은 페이지의 점유율 섹션 게이트·ShareChart가 `>= 0`을 쓰는데
  // 표만 `> 0`이라 share_pct === 0이 한 페이지에서 두 얼굴이었고(차트엔 0.0% 막대, 표엔 —),
  // 변경 전 카드는 `점유율 0%`를 보였으므로 0에 한해 회귀였다.
  it('F7 — 점유율은 0을 값으로 표시하고 음수·비유한·결측만 —', () => {
    const { unmount } = render(<PlayerTable players={PLAYERS} />)
    expect(rowOf('NuScale').cells[4].textContent).toBe('22.5%')
    expect(rowOf('X-energy').cells[4].textContent).toBe('0%')            // 0 = 값
    expect(rowOf('Rolls-Royce SMR').cells[4].textContent).toBe('—')      // 음수
    expect(rowOf('TerraPower').cells[4].textContent).toBe('—')           // null
    unmount()

    render(<PlayerTable players={ROCKET} />)
    expect(rowOf('SpaceX').cells[4].textContent).toBe('50.9%')
    expect(rowOf('CASC').cells[4].textContent).toBe('0%')
    expect(rowOf('ArianeGroup').cells[4].textContent).toBe('—')
  })

  // ── 적대 리뷰 F4 회귀 ─────────────────────────────────────────────────────
  it('F4 — note 본문 폭은 뷰포트가 아니라 스크롤러에 묶인다(100cqi)', () => {
    // 옛 `width: min(100%, calc(100vw - 32px))`는 "페이지 인셋 좌우 16px"을 가정했는데
    // 모바일 래퍼(.m-page)가 20px을 더해 전 뷰포트에서 40~123px씩 잘렸다. 뷰포트 기준
    // 하드코딩은 이 레이아웃에서 원리적으로 맞출 수 없다 — 컨테이너(스크롤러) 기준으로만 맞는다.
    expect(SCROLLER.containerType).toBe('inline-size')   // 이게 없으면 cqi가 뷰포트로 폴백한다
    expect(NOTE_BODY.width).toBe('100cqi')
    expect(JSON.stringify(NOTE_BODY)).not.toContain('vw')
    // 가시폭에 정확히 맞추려면 셀 패딩이 폭을 밀지 않아야 한다(패딩은 본문 안쪽으로)
    expect(NOTE_BODY.boxSizing).toBe('border-box')
    expect(NOTE_BODY.position).toBe('sticky')            // 가로 스크롤해도 화면 안에 머문다
  })

  // ── 적대 리뷰 F14 회귀 ────────────────────────────────────────────────────
  it('F14 — 업체명은 자르지 않고 접는다(어느 폭에서도 문자 손실 0)', () => {
    render(<PlayerTable players={PLAYERS} />)
    // 옛 `maxWidth: 190 + ellipsis`는 표가 전혀 넘치지 않는 PC에서도 무조건 잘랐고,
    // 복구 수단이 title뿐이라 터치 기기에선 전체 이름을 볼 방법이 없었다.
    expect(NAME_TEXT.maxWidth).toBeUndefined()
    expect(NAME_TEXT.textOverflow).toBeUndefined()
    expect(NAME_TEXT.overflowWrap).toBe('break-word')
    // 접히려면 셀이 nowrap이 아니어야 한다(다른 열은 nowrap 유지 — 수치는 접히면 안 된다)
    expect(rowOf('Rolls-Royce SMR').cells[0].style.whiteSpace).toBe('normal')
    expect(rowOf('Rolls-Royce SMR').cells[3].style.whiteSpace).toBe('nowrap')
    // 이름 문자열 자체는 온전하고 title 앵커도 유지된다
    const nameEl = within(rowOf('Rolls-Royce SMR')).getByTestId('tech-report-player-name')
    expect(nameEl.textContent).toBe('Rolls-Royce SMR')
    expect(nameEl.getAttribute('title')).toBe('Rolls-Royce SMR')
  })

  it('기술수준 결측 행은 —를 렌더한다(추정 금지)', () => {
    render(<PlayerTable players={PLAYERS} />)
    expect(within(rowOf('한국원자력연구원')).queryByText(/단계/)).toBeNull()
  })

  it('보유·관심 배지는 holdings 맵에 있는 티커에만 붙는다', () => {
    render(<PlayerTable players={PLAYERS} holdings={{ SMR: 'holding', '034020': 'watchlist' }} />)
    expect(within(rowOf('NuScale')).getByText('보유')).toBeTruthy()
    expect(within(rowOf('두산에너빌리티')).getByText('관심')).toBeTruthy()
    expect(within(rowOf('X-energy')).queryByText(/보유|관심/)).toBeNull()  // 티커 없음
  })

  it('정부주도 배지는 state_led 업체에만 붙는다', () => {
    render(<PlayerTable players={PLAYERS} />)
    expect(within(rowOf('중국핵공업집단')).getByText('정부주도')).toBeTruthy()
    expect(within(rowOf('NuScale')).queryByText('정부주도')).toBeNull()
  })

  it('빈 입력·비배열에도 헤더만 렌더하고 예외가 없다', () => {
    const { unmount } = render(<PlayerTable players={[]} />)
    expect(screen.getByTestId('tech-report-players')).toBeTruthy()
    expect(screen.queryAllByTestId('tech-report-player-row').length).toBe(0)
    expect(screen.queryByTestId('tech-report-players-leader')).toBeNull()
    unmount()
    render(<PlayerTable />)
    expect(screen.getByTestId('tech-report-players')).toBeTruthy()
  })
})
