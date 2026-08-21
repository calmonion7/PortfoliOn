import { describe, it, expect } from 'vitest'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { render, screen, fireEvent, within } from '@testing-library/react'
import PlayerTable, { NAME_TEXT, NOTE_BODY } from './PlayerTable'
import { groupByCategory, TECH_LEVEL_LABELS } from '../reports/techReportUtils'

// task#280 S3 → task#296 S3(스크롤러 제거·note 상시 노출·열 재구성). 정렬은 리터럴 순서가 아니라
// **불변식**으로 단언한다(정당한 데이터 변경/타이브레이크 추가에 거짓 실패하지 않게).
//
// 픽스처는 라이브 두 판을 모두 덮는다 — 한쪽만 보면 놓친다(실제로 그래서 놓쳤다).
//   SMR    : players 9 · cagr_pct null · leader_name 짧음 · share_pct 0/음수/null 혼재
//   ROCKET : players 8 · leader_name에 부연 괄호(`SpaceX (Grasshopper 호핑 2013년)`) · 선두 2종
//
// ⚠️ 열 인덱스 표기 — playerColumns(PLAYERS)와 playerColumns(ROCKET)은 둘 다 gap_years·share_pct가
// 일부 행에 유효값을 가져 4열(['name','level','gap','share'])로 렌더된다. 국가·티커가 별도 열이던
// 시절의 옛 인덱스(gap=3·share=4)는 국가·티커가 업체 셀 내부로 옮겨가며 gap=2·share=3으로 당겨졌다.
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

// task#296 S3 완료기준 — 열 게이트가 실제로 열 수를 바꾸는지 라이브 두 형태로 확인.
//   SMR_SHAPE     : ticker·share_pct 전 행 결측 → gap만 조건부 포함 → name+level+gap = 3열
//   ROBOTICS_SHAPE: ticker·share_pct 둘 다 유효값 존재            → name+level+gap+share = 4열
const SMR_SHAPE = [
  { name: 'A사', country: 'KR', ticker: null, tech_level: 5, gap_years: 0, leader_name: null, share_pct: null, state_led: false, note: 'A사 노트.' },
  { name: 'B사', country: 'US', ticker: null, tech_level: 3, gap_years: 4, leader_name: 'A사', share_pct: null, state_led: false, note: null },
]
const ROBOTICS_SHAPE = [
  { name: 'C사', country: 'KR', ticker: '005930', tech_level: 5, gap_years: 0, leader_name: null, share_pct: 12.3, state_led: false, note: 'C사 노트.' },
  { name: 'D사', country: 'US', ticker: 'IRBT', tech_level: 4, gap_years: 2, leader_name: 'C사', share_pct: 4.5, state_led: false, note: null },
]

// task#301 S2 — 분류 소제목 행. 2개 분류(경수형 2명 · 고온가스형 1명) + 분류 없는 1명(미분류로
// 흡수). gap_years·share_pct가 일부 유효값을 가져 열은 4개([name,level,gap,share])다.
const CATEGORIZED = [
  { name: 'A사', country: 'KR', ticker: null, tech_level: 5, gap_years: 0, leader_name: null, share_pct: 20, state_led: false, note: null, category: '경수형' },
  { name: 'B사', country: 'US', ticker: null, tech_level: 4, gap_years: 2, leader_name: 'A사', share_pct: 10, state_led: false, note: null, category: '경수형' },
  { name: 'C사', country: 'CN', ticker: null, tech_level: 3, gap_years: 5, leader_name: 'A사', share_pct: null, state_led: true, note: '고온가스 실증 중.', category: '고온가스형' },
  { name: 'D사', country: 'RU', ticker: null, tech_level: 3, gap_years: 6, leader_name: 'A사', share_pct: null, state_led: true, note: null },
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

function headerLabels() {
  return within(screen.getByTestId('tech-report-players')).getAllByRole('columnheader').map((th) => th.textContent)
}

describe('PlayerTable (task#280 S3 → task#296 S3)', () => {
  it('업체 수만큼 행을 렌더하고 루트 data-testid를 유지한다 — 두 판 모두', () => {
    const { unmount } = render(<MemoryRouter><PlayerTable players={PLAYERS} /></MemoryRouter>)
    // 기존 TechReport.test.jsx가 within()으로 이 앵커를 쓴다 — 스타일이 바뀌어도 유지 대상
    expect(screen.getByTestId('tech-report-players')).toBeTruthy()
    expect(screen.getAllByTestId('tech-report-player-row').length).toBe(9)
    unmount()

    render(<MemoryRouter><PlayerTable players={ROCKET} /></MemoryRouter>)
    expect(screen.getAllByTestId('tech-report-player-row').length).toBe(8)
  })

  it('정렬 불변식 ① 기술수준이 비증가한다(결측은 최하단)', () => {
    render(<MemoryRouter><PlayerTable players={PLAYERS} /></MemoryRouter>)
    const levels = renderedOrder().map((n) => byName[n].tech_level ?? -Infinity)
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeLessThanOrEqual(levels[i - 1])
  })

  it('정렬 불변식 ② 같은 기술수준 구간 안에서 격차가 비감소하고 null이 그 구간의 마지막이다', () => {
    render(<MemoryRouter><PlayerTable players={PLAYERS} /></MemoryRouter>)
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
    render(<MemoryRouter><PlayerTable players={PLAYERS} /></MemoryRouter>)
    expect(PLAYERS.map((p) => p.name)).toEqual(snapshot)
  })

  // ── 적대 리뷰 F9 회귀 → task#296 S3에서 재차 뒤집는다 ────────────────────────
  // ⚠️ F9는 원래 "접어도(details 닫힘) DOM에 남는다"를 확인했다(그 이전 구현은 접히면 note를
  // DOM에서 통째 제거해 Ctrl+F·스크린리더·프로브가 못 찾았다). task#296은 접기 자체를 없앤다 —
  // note가 처음부터 항상 렌더되므로 details가 없어도 "감출 여지가 없다"는 더 강한 성질을 갖는다.
  it('note는 접힘 없이 상시 렌더된다(details 부재 · 본문 텍스트 항상 존재)', () => {
    render(<MemoryRouter><PlayerTable players={PLAYERS} /></MemoryRouter>)
    const noteRow = noteRowOf('NuScale')
    expect(noteRow).toBeTruthy()
    expect(noteRow.querySelector('details')).toBeNull()          // 접기 메커니즘 자체가 없다
    expect(noteRow.textContent).toContain('설계인증 취득.')        // 처음부터 보인다
    expect(noteRowOf('두산에너빌리티').textContent).toContain('주기기 공급망의 핵심.')
    expect(screen.getAllByTestId('tech-report-player-note').length)
      .toBe(PLAYERS.filter((p) => p.note).length)
  })

  it('note가 없는 업체는 note 행 자체가 없다', () => {
    render(<MemoryRouter><PlayerTable players={PLAYERS} /></MemoryRouter>)
    expect(noteRowOf('GE Hitachi')).toBeNull()
    expect(within(rowOf('GE Hitachi')).queryByRole('button')).toBeNull()
  })

  // ── 적대 리뷰 F10 회귀 → task#296 S3에서 무효화, 접근 이름 이관으로 대체 ──────
  // ⚠️ F10은 옛 <summary> 히트영역(24px 하한)을 확인했다. summary·details가 없으니 히트영역
  // 자체가 무의미해졌다 — 시각 라벨 "설명"이 사라진 대신 role="group" + aria-label로 9개 note가
  // 여전히 접근 이름으로 구별되는지를 확인한다(getByRole 매칭 성공 자체가 "role 없는 aria-label은
  // 접근성 트리에 노출되지 않는다"의 반증이다).
  it('note 컨테이너는 summary/details 없이 role="group" + 업체명 접근 이름을 갖는다', () => {
    render(<MemoryRouter><PlayerTable players={PLAYERS} /></MemoryRouter>)
    const noteRow = noteRowOf('NuScale')
    expect(noteRow.querySelector('summary')).toBeNull()
    expect(noteRow.querySelector('details')).toBeNull()
    expect(within(noteRow).getByRole('group', { name: 'NuScale 설명' })).toBeTruthy()
    expect(within(noteRowOf('두산에너빌리티')).getByRole('group', { name: '두산에너빌리티 설명' })).toBeTruthy()
  })

  // ── 적대 리뷰 F3 회귀 ─────────────────────────────────────────────────────
  it('F3 — 「선두 대비」 셀은 격차만 담는다(leader_name 미포함)', () => {
    render(<MemoryRouter><PlayerTable players={ROCKET} /></MemoryRouter>)
    // 옛 렌더는 매 행 `선두 대비 13년 · SpaceX (Grasshopper 호핑 2013년)`을 nowrap으로 담아
    // 이 열이 302px까지 부풀었고 표가 PC 1440(콘텐츠 748px)에서 891px로 넘쳤다.
    // cells[2] = 「선두 대비」(국가·티커가 업체 셀 내부로 옮겨 인덱스가 3→2로 당겨졌다)
    expect(rowOf('SpaceX').cells[2].textContent).toBe('현재 선두')   // gap 0은 유효값
    expect(rowOf('Blue Origin').cells[2].textContent).toBe('6년')
    expect(rowOf('JAXA/MHI').cells[2].textContent).toBe('—')        // null
    expect(rowOf('Roscosmos').cells[2].textContent).toBe('14년')
    // 표 안 어디에도 leader_name 문자열이 없다(캡션은 표 밖이라 이 스코프에 안 잡힌다)
    expect(within(screen.getByTestId('tech-report-players')).queryByText(new RegExp('Grasshopper'))).toBeNull()
    expect(screen.getByTestId('tech-report-players').textContent).not.toContain('선두 대비 6년')
  })

  it('F3 — leader_name은 표 위 캡션으로 승격되고 고유값이 2개 이상이면 전부 잇는다(손실 0)', () => {
    const { unmount } = render(<MemoryRouter><PlayerTable players={ROCKET} /></MemoryRouter>)
    expect(screen.getByTestId('tech-report-players-leader').textContent)
      .toBe(`선두 = ${LEADER_LONG} · 중국항천과기집단`)
    unmount()

    // SMR 판은 격차 양수 행의 leader_name이 한 종류 — 캡션 한 줄
    render(<MemoryRouter><PlayerTable players={PLAYERS} /></MemoryRouter>)
    expect(screen.getByTestId('tech-report-players-leader').textContent).toBe('선두 = NuScale')
  })

  it('F3 — 격차가 양수인 행이 없으면 캡션 자체를 렌더하지 않는다', () => {
    // gap_years가 0·null·음수뿐이면 옛 셀에도 leader_name이 안 보였다 — 캡션도 없어야 한다
    render(<MemoryRouter><PlayerTable players={PLAYERS.filter((p) => !(p.gap_years > 0))} /></MemoryRouter>)
    expect(screen.queryByTestId('tech-report-players-leader')).toBeNull()
  })

  it('선두 대비 4케이스 — 0=현재 선두 · 양수=N년 · null과 음수는 표시하지 않는다', () => {
    render(<MemoryRouter><PlayerTable players={PLAYERS} /></MemoryRouter>)
    expect(rowOf('NuScale').cells[2].textContent).toBe('현재 선두')
    expect(rowOf('GE Hitachi').cells[2].textContent).toBe('1년')
    // null(격차 미산정) · 음수(백엔드에 ge=0 제약 없음) 둘 다 추정하지 않고 —
    expect(rowOf('두산에너빌리티').cells[2].textContent).toBe('—')
    expect(rowOf('Rosatom').cells[2].textContent).toBe('—')
  })

  // ── 적대 리뷰 F7 회귀 ─────────────────────────────────────────────────────
  // ⚠️ 옛 테스트('점유율은 > 0 일 때만 표시하고 0·음수·결측은 —')를 뒤집는다.
  // 0은 결측이 아니라 값이다. 같은 페이지의 점유율 섹션 게이트·ShareChart가 `>= 0`을 쓰는데
  // 표만 `> 0`이라 share_pct === 0이 한 페이지에서 두 얼굴이었고(차트엔 0.0% 막대, 표엔 —),
  // 변경 전 카드는 `점유율 0%`를 보였으므로 0에 한해 회귀였다.
  it('F7 — 점유율은 0을 값으로 표시하고 음수·비유한·결측만 —', () => {
    const { unmount } = render(<MemoryRouter><PlayerTable players={PLAYERS} /></MemoryRouter>)
    // cells[3] = 「점유율」(국가·티커 이동으로 인덱스가 4→3으로 당겨졌다)
    expect(rowOf('NuScale').cells[3].textContent).toBe('22.5%')
    expect(rowOf('X-energy').cells[3].textContent).toBe('0%')            // 0 = 값
    expect(rowOf('Rolls-Royce SMR').cells[3].textContent).toBe('—')      // 음수
    expect(rowOf('TerraPower').cells[3].textContent).toBe('—')           // null
    unmount()

    render(<MemoryRouter><PlayerTable players={ROCKET} /></MemoryRouter>)
    expect(rowOf('SpaceX').cells[3].textContent).toBe('50.9%')
    expect(rowOf('CASC').cells[3].textContent).toBe('0%')
    expect(rowOf('ArianeGroup').cells[3].textContent).toBe('—')
  })

  // ── 적대 리뷰 F4 회귀 → task#296 S3에서 뒤집는다(스크롤러·컨테이너쿼리 자체를 제거) ─────
  // ⚠️ F4는 "note 본문 폭이 뷰포트가 아니라 스크롤러(컨테이너쿼리)에 묶인다"를 확인했다. 표에
  // 이제 자체 overflow-x 스크롤러가 없으므로(옆으로 안 스크롤한다) 그 기준자 자체가 무의미해졌다 —
  // note는 표 폭을 그대로 따르고, containerType·100cqi·sticky·left는 전부 정리 대상 고아다.
  it('F4 대체 — note 본문은 스크롤러·컨테이너쿼리 없이 표 폭을 그대로 따른다', () => {
    expect(NOTE_BODY.width).toBeUndefined()
    expect(JSON.stringify(NOTE_BODY)).not.toContain('cqi')
    expect(NOTE_BODY.position).toBeUndefined()          // 가로 스크롤이 없으니 sticky도 불필요
    expect(NOTE_BODY.left).toBeUndefined()
    expect(NOTE_BODY.boxSizing).toBe('border-box')       // 패딩이 폭을 밀지 않게는 여전히 유효
  })

  it('표에는 자체 가로 스크롤러가 없다(overflowX 선언 0 · minWidth 0)', () => {
    render(<MemoryRouter><PlayerTable players={PLAYERS} /></MemoryRouter>)
    const table = screen.getByTestId('tech-report-players')
    expect(table.parentElement.style.overflowX).toBe('')
    expect(table.style.minWidth).toBe('')
  })

  // ── 적대 리뷰 F14 회귀 ────────────────────────────────────────────────────
  it('F14 — 업체명은 자르지 않고 접는다(어느 폭에서도 문자 손실 0)', () => {
    render(<MemoryRouter><PlayerTable players={PLAYERS} /></MemoryRouter>)
    // 옛 `maxWidth: 190 + ellipsis`는 표가 전혀 넘치지 않는 PC에서도 무조건 잘랐고,
    // 복구 수단이 title뿐이라 터치 기기에선 전체 이름을 볼 방법이 없었다.
    expect(NAME_TEXT.maxWidth).toBeUndefined()
    expect(NAME_TEXT.textOverflow).toBeUndefined()
    // ⚠️ `break-word` → `anywhere`로 강화(task#296 배포 후 라이브 회귀). 둘은 렌더가 같지만
    // **min-content 기여가 다르다**: `break-word`는 스펙상 min-content에 영향이 없어 최소폭이
    // "최장 단어"로 남는다. 표 자동 레이아웃이 그 값으로 열 폭을 정하므로, 스크롤러를 없앤 뒤에는
    // `break-word`만으론 표가 좁아지지 못해 문서가 가로 스크롤했다(라이브 reusable-rocket m350:
    // 업체 열 181px → 4열 360px > 가용 278px → doc 396px). jsdom엔 레이아웃이 없어 이 차이를
    // 원리적으로 볼 수 없으므로, 여기서는 **선언값을 못박고** 실제 폭은 uat296 page-h-scroll이 잰다.
    expect(NAME_TEXT.overflowWrap).toBe('anywhere')
    // 접히려면 이름 셀이 nowrap이 아니어야 한다. 수치 열(선두 대비, cells[2])은 nowrap 유지.
    expect(rowOf('Rolls-Royce SMR').cells[0].style.whiteSpace).toBe('normal')
    expect(rowOf('Rolls-Royce SMR').cells[2].style.whiteSpace).toBe('nowrap')
    // 이름 문자열 자체는 온전하고 title 앵커도 유지된다
    const nameEl = within(rowOf('Rolls-Royce SMR')).getByTestId('tech-report-player-name')
    expect(nameEl.textContent).toBe('Rolls-Royce SMR')
    expect(nameEl.getAttribute('title')).toBe('Rolls-Royce SMR')
  })

  // ── ADR-0041 S1 — 「기술수준 비교」 밴드가 표 셀로 흡수된다. 텍스트 "5단계 · 양산상용"은
  // 5칸 밴드(+ 단계 숫자)로 교체되고, 그 값은 aria-label로 접근성 트리에 노출된다(아래 축1·7).
  it('축1 — 기술수준 셀은 칸 5개를 렌더하고 채워진 칸 수가 tech_level과 일치한다', () => {
    render(<MemoryRouter><PlayerTable players={PLAYERS} /></MemoryRouter>)
    const nuscale = within(rowOf('NuScale')).getByRole('img')   // tech_level 5
    expect(nuscale.querySelectorAll('.tech-level-band__cell').length).toBe(5)
    expect(nuscale.querySelectorAll('.tech-level-band__cell--filled').length).toBe(5)
    const terra = within(rowOf('TerraPower')).getByRole('img')  // tech_level 3
    expect(terra.querySelectorAll('.tech-level-band__cell--filled').length).toBe(3)
    expect(rowOf('NuScale').cells[1].style.whiteSpace).toBe('nowrap')  // 밴드는 접히지 않는다
  })

  it('축2 — 기술수준 결측 행은 칸이 0개이고 —를 렌더한다(추정 금지)', () => {
    render(<MemoryRouter><PlayerTable players={PLAYERS} /></MemoryRouter>)
    const cell = rowOf('한국원자력연구원').cells[1]
    expect(within(cell).queryByRole('img')).toBeNull()
    expect(cell.querySelectorAll('.tech-level-band__cell').length).toBe(0)
    expect(cell.textContent).toBe('—')
  })

  it('축3 — 표 위에 5단계 라벨 범례가 전수 렌더된다', () => {
    render(<MemoryRouter><PlayerTable players={PLAYERS} /></MemoryRouter>)
    for (let lv = 1; lv <= 5; lv++) expect(screen.getByText(`${lv} ${TECH_LEVEL_LABELS[lv]}`)).toBeTruthy()
    const legend = screen.getByText(`1 ${TECH_LEVEL_LABELS[1]}`).closest('.tech-level-band__legend')
    expect(legend).toBeTruthy()
    // 4 = Node.DOCUMENT_POSITION_FOLLOWING — 표가 범례 뒤에 온다("표 위" 배치)
    expect(legend.compareDocumentPosition(screen.getByTestId('tech-report-players')) & 4).toBeTruthy()
  })

  it('축4 — 선두 합집합: gap_years:null이면서 leader_name===name인 행은 「현재 선두」다', () => {
    // 정본(gap_years===0)만 썼다면 A사는 여전히 —다. B사가 gap_years 유효값을 가져 gap 열 자체는
    // 생긴다(playerColumns 게이트, A사만 있으면 열이 아예 안 생겨 판별력이 없다).
    const players = [
      { name: 'A사', country: 'KR', ticker: null, tech_level: 5, gap_years: null, leader_name: 'A사', share_pct: null, state_led: false, note: null },
      { name: 'B사', country: 'US', ticker: null, tech_level: 3, gap_years: 4, leader_name: 'A사', share_pct: null, state_led: false, note: null },
    ]
    render(<MemoryRouter><PlayerTable players={players} /></MemoryRouter>)
    expect(rowOf('A사').cells[2].textContent).toBe('현재 선두')
    expect(rowOf('B사').cells[2].textContent).toBe('4년')
  })

  it('축5 — 음수 격차는 leader_name 일치가 없으면 아무 문구도 보이지 않는다(wrong<missing)', () => {
    const players = [
      { name: 'C사', country: 'RU', ticker: null, tech_level: 3, gap_years: -2, leader_name: 'A사', share_pct: null, state_led: false, note: null },
    ]
    render(<MemoryRouter><PlayerTable players={players} /></MemoryRouter>)
    expect(rowOf('C사').cells[2].textContent).toBe('—')
    expect(screen.queryByText(/-2년/)).toBeNull()
  })

  it('축6 — 분야 소제목에 그 분야의 선두가 병기되고, 분류 없는 판은 기존 캡션이 그대로다', () => {
    const grouped = [
      { name: 'A사', country: 'KR', ticker: null, tech_level: 5, gap_years: 0, leader_name: 'A사', share_pct: null, state_led: false, note: null, category: '경수형' },
      { name: 'B사', country: 'US', ticker: null, tech_level: 4, gap_years: 2, leader_name: 'A사', share_pct: null, state_led: false, note: null, category: '경수형' },
      { name: 'C사', country: 'CN', ticker: null, tech_level: 3, gap_years: 5, leader_name: 'D사', share_pct: null, state_led: true, note: null, category: '고온가스형' },
      { name: 'D사', country: 'RU', ticker: null, tech_level: 5, gap_years: 0, leader_name: 'D사', share_pct: null, state_led: false, note: null, category: '고온가스형' },
    ]
    // 이빨 — 픽스처가 실제로 그룹핑 분기를 탄다(task#301 재발 방지 가토)
    expect(groupByCategory(grouped)).not.toEqual([])
    const { unmount } = render(<MemoryRouter><PlayerTable players={grouped} /></MemoryRouter>)
    const groups = screen.getAllByTestId('tech-report-player-group')
    expect(groups.map((g) => g.textContent)).toEqual(['경수형 · 선두 A사', '고온가스형 · 선두 D사'])
    unmount()

    // 분류 없는 판은 기존 캡션(그룹 병기 도입 이전부터 있던 것)이 그대로 렌더된다.
    render(<MemoryRouter><PlayerTable players={PLAYERS} /></MemoryRouter>)
    expect(groupByCategory(PLAYERS)).toEqual([])
    expect(screen.getByTestId('tech-report-players-leader')).toBeTruthy()
    expect(screen.queryAllByTestId('tech-report-player-group').length).toBe(0)
  })

  it('축7 — 기술수준 칸 묶음은 role="img"+aria-label("N단계 · 라벨")로 값을 접근성 트리에 노출한다', () => {
    render(<MemoryRouter><PlayerTable players={PLAYERS} /></MemoryRouter>)
    expect(within(rowOf('NuScale')).getByRole('img').getAttribute('aria-label')).toBe('5단계 · 양산상용')
    expect(within(rowOf('중국핵공업집단')).getByRole('img').getAttribute('aria-label')).toBe('5단계 · 양산상용')
    expect(within(rowOf('TerraPower')).getByRole('img').getAttribute('aria-label')).toBe('3단계 · 실증')
  })

  it('보유·관심 배지는 holdings 맵에 있는 티커에만 붙는다', () => {
    render(<MemoryRouter><PlayerTable players={PLAYERS} holdings={{ SMR: 'holding', '034020': 'watchlist' }} /></MemoryRouter>)
    expect(within(rowOf('NuScale')).getByText('보유')).toBeTruthy()
    expect(within(rowOf('두산에너빌리티')).getByText('관심')).toBeTruthy()
    expect(within(rowOf('X-energy')).queryByText(/보유|관심/)).toBeNull()  // 티커 없음
  })

  it('정부주도 배지는 state_led 업체에만 붙는다', () => {
    render(<MemoryRouter><PlayerTable players={PLAYERS} /></MemoryRouter>)
    expect(within(rowOf('중국핵공업집단')).getByText('정부주도')).toBeTruthy()
    expect(within(rowOf('NuScale')).queryByText('정부주도')).toBeNull()
  })

  it('빈 입력·비배열에도 헤더만 렌더하고 예외가 없다', () => {
    const { unmount } = render(<MemoryRouter><PlayerTable players={[]} /></MemoryRouter>)
    expect(screen.getByTestId('tech-report-players')).toBeTruthy()
    expect(screen.queryAllByTestId('tech-report-player-row').length).toBe(0)
    expect(screen.queryByTestId('tech-report-players-leader')).toBeNull()
    unmount()
    render(<MemoryRouter><PlayerTable /></MemoryRouter>)
    expect(screen.getByTestId('tech-report-players')).toBeTruthy()
  })

  // ── task#296 S3 완료기준 — 열 게이트(playerColumns) 연동 ────────────────────
  describe('열 게이트 — smr 형태 vs robotics 형태(ADR-0034)', () => {
    it('smr 형태(ticker·share 전 행 결측)에서 열이 3개다(점유율 헤더 없음) + colSpan 3 + 티커 미노출', () => {
      render(<MemoryRouter><PlayerTable players={SMR_SHAPE} /></MemoryRouter>)
      expect(headerLabels()).toEqual(['업체', '기술수준', '선두 대비'])
      expect(noteRowOf('A사').querySelector('td').getAttribute('colspan')).toBe('3')
      // ticker가 전 행 null이므로 표 어디에도 티커 문자열이 나타나지 않는다
      expect(screen.getByTestId('tech-report-players').textContent).not.toMatch(/005930|IRBT/)
    })

    it('robotics 형태(ticker·share 둘 다 유효)에서 열이 4개다(점유율 헤더 있음) + colSpan 4 + 티커 렌더', () => {
      render(<MemoryRouter><PlayerTable players={ROBOTICS_SHAPE} /></MemoryRouter>)
      expect(headerLabels()).toEqual(['업체', '기술수준', '선두 대비', '점유율'])
      expect(noteRowOf('C사').querySelector('td').getAttribute('colspan')).toBe('4')
      expect(rowOf('C사').textContent).toContain('005930')
      expect(rowOf('D사').textContent).toContain('IRBT')
      expect(rowOf('C사').cells[3].textContent).toBe('12.3%')
    })

    it('국가·티커는 더 이상 별도 열이 아니다 — 업체 셀 내부로 이동(정보 손실 0)', () => {
      render(<MemoryRouter><PlayerTable players={PLAYERS} /></MemoryRouter>)
      expect(headerLabels()).not.toContain('국가')
      expect(headerLabels()).not.toContain('티커')
      expect(rowOf('두산에너빌리티').textContent).toContain('KR')
      expect(rowOf('두산에너빌리티').textContent).toContain('034020')
    })
  })

  // ── task#301 S2 완료기준 — 분류 소제목 행(groupByCategory 연동) ──────────────
  describe('분류 소제목 행(groupByCategory 연동)', () => {
    it('그룹 있는 입력 — 소제목 행 수 == groupByCategory 그룹 수, 업체 행 총수 == players.length(미분류 포함)', () => {
      render(<MemoryRouter><PlayerTable players={CATEGORIZED} /></MemoryRouter>)
      const expectedGroups = groupByCategory(CATEGORIZED).length
      // 이빨 — 픽스처가 실제로 3그룹(경수형·고온가스형·미분류)을 만들어야 위 단언이 판별력을 갖는다.
      expect(expectedGroups).toBe(3)
      expect(screen.getAllByTestId('tech-report-player-group').length).toBe(expectedGroups)
      // ADR-0041 결정 4 — 소제목에 그 그룹의 선두가 병기된다. 경수형=A사(gap0)만 선두, 고온가스형·
      // 미분류는 gap_years>0뿐이라 선두가 없어 병기가 생략된다(값 없으면 생략).
      expect(screen.getAllByTestId('tech-report-player-group').map((r) => r.textContent))
        .toEqual(['경수형 · 선두 A사', '고온가스형', '미분류'])
      // 미분류(D사)도 사라지지 않는다 — 업체 총수는 그룹핑과 무관하게 보존된다.
      expect(screen.getAllByTestId('tech-report-player-row').length).toBe(CATEGORIZED.length)
    })

    it('소제목 행 colSpan은 헤더 열 수와 같다', () => {
      render(<MemoryRouter><PlayerTable players={CATEGORIZED} /></MemoryRouter>)
      expect(headerLabels().length).toBe(4)   // CATEGORIZED는 gap·share가 일부 유효값을 가져 4열
      for (const r of screen.getAllByTestId('tech-report-player-group')) {
        expect(r.querySelector('td').getAttribute('colspan')).toBe('4')
      }
    })

    it('분류 전무 입력에서는 소제목 행이 0개이고 평면 표가 그대로 보존된다', () => {
      render(<MemoryRouter><PlayerTable players={PLAYERS} /></MemoryRouter>)
      expect(groupByCategory(PLAYERS)).toEqual([])   // 이빨 — PLAYERS엔 category 필드가 없다
      expect(screen.queryAllByTestId('tech-report-player-group').length).toBe(0)
      expect(screen.getAllByTestId('tech-report-player-row').length).toBe(PLAYERS.length)
    })

    // 삭제된 CategoryGroups.test.jsx가 갖고 있던 중복 key 가드(task#281 F6)를 새 소비처로 이식한다.
    // 그룹 렌더는 인덱스가 그룹마다 0부터 재시작하므로 ticker 없고 name이 빈 업체가 두 그룹에 하나씩만
    // 있어도 key가 충돌한다 — 백엔드 Player.name엔 min_length가 없어 스키마상 도달 가능한 입력이다.
    it('행 key는 그룹을 가로질러 고유하다 — 빈 이름·티커 없는 업체가 두 그룹에 있어도 중복 key 경고 0', () => {
      const NAMELESS = [
        { name: '', ticker: null, tech_level: 4, category: '전력' },
        { name: '있는이름A', ticker: null, tech_level: 4, category: '전력' },
        { name: '', ticker: null, tech_level: 3, category: '냉각' },
        { name: '있는이름B', ticker: null, tech_level: 3, category: '냉각' },
      ]
      expect(groupByCategory(NAMELESS).length).toBe(2)   // 이빨 — 실제로 두 그룹이다

      const errors = []
      const orig = console.error
      console.error = (...args) => { errors.push(args.join(' ')) }
      try {
        render(<MemoryRouter><PlayerTable players={NAMELESS} /></MemoryRouter>)
      } finally {
        console.error = orig
      }
      expect(errors.filter((m) => /same key|duplicate key/i.test(m))).toEqual([])
      expect(screen.getAllByTestId('tech-report-player-row').length).toBe(NAMELESS.length)
    })
  })

  // ── 적대 검토 확증 결함의 회귀 잠금 (task#304 in-run fix) ──
  describe('선두 주장이 한 화면에서 충돌하지 않는다 (적대 검토 HIGH)', () => {
    // 분류가 있으면 분야별 소제목이 이미 「그 분야의 선두」를 말한다. 페이지 전체를 대상으로 한
    // 평면 캡션이 함께 뜨면 서로 모순되는 선두 주장이 동시에 보인다.
    const TWO_LEADERS = [
      { name: 'A사', tech_level: 5, gap_years: 0, leader_name: null, category: '가' },
      { name: '뒤처진1', tech_level: 3, gap_years: 4, leader_name: 'Z사', category: '가' },
      { name: 'B사', tech_level: 5, gap_years: 0, leader_name: null, category: '나' },
      { name: '뒤처진2', tech_level: 3, gap_years: 6, leader_name: 'Z사', category: '나' },
    ]

    it('분류가 있으면 평면 캡션을 렌더하지 않는다', () => {
      // 픽스처가 그룹핑 분기를 실제로 타는지 먼저 증명한다(task#301의 실패 형태 — 이빨 있는
      // 단언이 분기를 안 타고 초록으로 통과했다).
      expect(groupByCategory(TWO_LEADERS)).not.toEqual([])
      render(<MemoryRouter><PlayerTable players={TWO_LEADERS} /></MemoryRouter>)
      expect(screen.queryByTestId('tech-report-players-leader')).toBeNull()
    })

    it('분류가 없으면 평면 캡션이 그대로 남는다 (게이트가 캡션을 통째로 죽이지 않았다)', () => {
      const FLAT = TWO_LEADERS.map(({ category, ...rest }) => rest)
      expect(groupByCategory(FLAT)).toEqual([])   // 정의역 확인 — 이 픽스처는 그룹핑을 타지 않는다
      render(<MemoryRouter><PlayerTable players={FLAT} /></MemoryRouter>)
      expect(screen.getByTestId('tech-report-players-leader').textContent).toContain('Z사')
    })
  })

  describe('단계 숫자는 고정폭 클래스를 쓴다 (적대 검토 MED — 폭 결정론)', () => {
    // jsdom은 레이아웃에 블라인드하므로 실제 폭은 라이브 프로브가 잰다. 여기서는 글리프 폭
    // 추정에 기대지 않는다는 **구조 조건**만 못박는다: 숫자가 인라인 style이 아니라 고정폭
    // 클래스를 쓴다. 인라인 marginLeft로 되돌리면 flex gap과 합쳐진 min-content를 코드에서
    // 읽을 수 없게 되고, 그 추정 위에서 여유가 1.3px까지 얇아졌던 것이 이 결함이었다.
    it('숫자 span이 .tech-level-band__digit 이고 인라인 폭 스타일이 없다', () => {
      const { container } = render(<MemoryRouter><PlayerTable players={PLAYERS} /></MemoryRouter>)
      const digits = [...container.querySelectorAll('.tech-level-band__digit')]
      expect(digits.length).toBe(PLAYERS.filter((p) => TECH_LEVEL_LABELS[p.tech_level]).length)
      for (const d of digits) {
        expect(d.getAttribute('style')).toBeNull()
        expect(d.textContent).toMatch(/^[1-5]$/)
      }
    })
  })
})

// ── task#324 S5 (ADR-0047) — 기술 축은 N:M이라 화면을 합치지 않고 **연결**한다.
// 업체 표의 상장 티커가 그 종목 리포트 상세로 가는 진입점이 된다.
// `/reports` 딥링크 관례는 쿼리파라미터가 아니라 location.state.ticker이므로(task#131),
// href만 재면 관례 위반을 못 잡는다 → 클릭 후 착지 화면에서 state를 읽어 단언한다.
function LandedReports() {
  const loc = useLocation()
  return <div data-testid="landed">{loc.state?.ticker ?? 'NO_STATE'}</div>
}

describe('업체 표 티커 → 종목 리포트 딥링크 (task#324)', () => {
  const renderRouted = () => render(
    <MemoryRouter initialEntries={['/tech-report/smr']}>
      <Routes>
        <Route path="/tech-report/:slug" element={<PlayerTable players={PLAYERS} holdings={{ '034020': 'holding', SMR: 'watchlist' }} />} />
        <Route path="/reports" element={<LandedReports />} />
      </Routes>
    </MemoryRouter>
  )

  it('상장 티커는 링크이고 클릭하면 state.ticker를 싣고 종목 리포트로 간다', () => {
    renderRouted()
    const link = screen.getByRole('link', { name: '034020' })
    expect(link.getAttribute('href')).toBe('/reports')
    fireEvent.click(link)
    expect(screen.getByTestId('landed').textContent).toBe('034020')
  })

  it('대조군 — 티커 없는 업체 행에는 링크가 없다', () => {
    renderRouted()
    // 픽스처의 비상장 업체(중국핵공업집단·X-energy 등)는 ticker=null이다
    const links = screen.getAllByRole('link')
    expect(links.length).toBe(2)                                  // 034020·SMR 두 행만
    expect(links.map(a => a.textContent.trim()).sort()).toEqual(['034020', 'SMR'])
    expect(screen.getByText('중국핵공업집단')).toBeTruthy()          // 그 행 자체는 렌더된다
  })

  it('보유/관심 배지는 링크 밖에 있다 — 배지는 상태 표시이지 진입점이 아니다', () => {
    renderRouted()
    for (const [tk, badge] of [['034020', '보유'], ['SMR', '관심']]) {
      const link = screen.getByRole('link', { name: tk })
      expect(link.textContent).not.toContain(badge)
      expect(link.querySelector('*')).toBeNull()                  // 링크 안에 자식 요소가 없다
    }
    expect(screen.getByText('보유')).toBeTruthy()                   // 배지 자체는 살아 있다
    expect(screen.getByText('관심')).toBeTruthy()
  })
})
