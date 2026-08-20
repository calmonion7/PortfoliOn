import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import TechAnatomy from './TechAnatomy'
import { deriveAxes, crossHoldings, itemCompanies } from '../components/tech/techAnatomyUtils'
import { LIVE_SSB } from '../components/tech/__fixtures__/techAnatomy.fixture'
import api from '../api'

// post/delete도 스텁으로 둔다 — 이 화면이 **읽기 전용**임을 「쓰기가 나가지 않는다」로 단언한다.
vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }))
// useTrackedStocks가 useToast를 요구한다. 라이브에선 App의 ToastProvider가 조상이므로(확인됨)
// 마운트에서 던지지 않고, 여기서는 프로바이더 대신 훅만 스텁한다.
vi.mock('../components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))

// 축이 실재하는 판 — experts 축 1개가 뜬다.
const WITH_ANATOMY = {
  slug: 'smr', title: 'SMR, 원전의 다음 세대', published_date: '2026-08-03',
  players: [{ name: 'NuScale', tech_level: 4 }],
  composition: { experts: [{ name: '원자로 설계', share_pct: 60, leaders: ['NuScale'] }, { name: '인허가', share_pct: 40 }] },
}

// 발행물은 있으나 해부가 없는 판 — 빈 상태 분기를 탄다.
const WITHOUT_ANATOMY = { slug: 'smr', title: 'SMR, 원전의 다음 세대', published_date: '2026-08-03', players: [] }

// 라이브 실발행분에서 복사한 판 — 기술·광물·전문가 3축이 다 있고 티커도 실재한다.
const CROSSABLE = { slug: 'solid-state-battery', title: '전고체 배터리', published_date: '2026-08-19', ...LIVE_SSB }

/** url별 라우팅 — 리포트와 `/api/stocks`를 따로 준다(둘 중 하나만 실패시키는 축이 필요하다). */
function mockApi({ report, stocks = [], stocksFail = false, stocksPending = false }) {
  api.get.mockImplementation((url) => {
    if (url === '/api/stocks') {
      if (stocksPending) return new Promise(() => {})   // 영원히 미해결 = loaded false
      return stocksFail ? Promise.reject(new Error('tracked down')) : Promise.resolve({ data: stocks })
    }
    return Promise.resolve({ data: { reports: report ? [report] : [] } })
  })
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/tech-anatomy/smr']}>
      <Routes><Route path="/tech-anatomy/:slug" element={<TechAnatomy />} /></Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('TechAnatomy 우하단 목록복귀 pill = 정상 상태의 유일한 목록 경로 (task#309 S3)', () => {
  // fixed 좌표는 jsdom이 블라인드 — 여기선 렌더·링크 대상만 단언하고 위치(뷰포트 안인지)는
  // 라이브 프로브 ⓘ가 boundingBox로 검증한다(형제 GuruDetail.test.jsx와 같은 분업).
  const expectPill = (container) => {
    const pills = container.querySelectorAll('.list-pill')
    expect(pills).toHaveLength(1)          // 중복 렌더 방지 — 개수까지 못박는다
    expect(pills[0].getAttribute('href')).toBe('/tech-reports')
    expect(pills[0].textContent).toBe('☰ 목록')
  }

  it('축이 있는 판 — pill 1개', async () => {
    mockApi({ report: WITH_ANATOMY })
    const { container } = renderPage()
    await screen.findByTestId('tech-anatomy')
    // 이 픽스처가 실제로 축 분기를 타는지 게이트 함수를 직접 적용해 못박는다(task#301 —
    // 이빨과 분기 커버리지는 다른 축이고, 전자가 후자의 알리바이가 되지 않는다).
    expect(deriveAxes(WITH_ANATOMY.composition).length).toBeGreaterThan(0)
    expectPill(container)
  })

  it('빈 상태(해부 미기입)에서도 pill 1개 — 같은 return 안이라 따라온다', async () => {
    mockApi({ report: WITHOUT_ANATOMY })
    const { container } = renderPage()
    await screen.findByTestId('anatomy-empty')
    // 이 픽스처가 실제로 빈 상태 분기를 타는지 게이트 함수로 직접 단언한다.
    expect(deriveAxes(WITHOUT_ANATOMY.composition)).toEqual([])
    expectPill(container)
  })

  it('에러 상태엔 pill이 없고 기존 중앙 텍스트 링크가 그대로다 (TechReport 동형)', async () => {
    api.get.mockRejectedValue(new Error('network'))
    const { container } = renderPage()
    await waitFor(() => expect(screen.getByText('리포트를 불러오지 못했습니다.')).toBeTruthy())
    expect(container.querySelectorAll('.list-pill')).toHaveLength(0)
    const back = screen.getByText('← 주요기술 리포트로 돌아가기')
    expect(back.getAttribute('href')).toBe('/tech-reports')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 보유·관심 교차 3계층 — 칩 마커(S2) · 항목 배지(S3) · 상단 요약 3상태(S4), task#315
//
// ⚠️ **광물 축은 라이브에서 dormant했다 — 2026-08-20 스냅샷**(테스트 계정 추적 26종목 ↔ 라이브
// `producers[].ticker` 17개 겹침 0건, 기술축은 4건). 두 집합 모두 하루 단위로 변하니 이 문장을
// 판정 근거로 쓰지 말 것 — 프로브가 실행 시점에 교집합을 **계산**해야 한다. 그동안 광물축
// 마커·배지는 **이 픽스처가 유일한 검증 수단**이고, 그 축 sentinel이 0이면 「통과」가 아니라
// **「미검증」**이다(라이브에서 밟으려고 종목을 추가하지 않는다 — 사용자 확정).
const TRACKED = [{ ticker: '006400', type: 'holding' }, { ticker: 'ALB', type: 'watchlist' }]
const TRACKED_MAP = { '006400': 'holding', ALB: 'watchlist' }
const AXES = deriveAxes(CROSSABLE.composition)

const summary = () => screen.queryByTestId('anatomy-cross-summary')
const marksOf = () => screen.queryAllByTestId('anatomy-chip-owned')
const badgesOf = () => screen.queryAllByTestId('anatomy-item-cross')
// ⚠️ testid 정규식은 **부분일치**다 — 앵커가 없으면 컨테이너(`...-chips`)까지 잡혀 「이 칩에
// 마커가 없다」가 「어느 칩에도 없다」로 뒤바뀐다(실제로 이 테스트가 그렇게 거짓 실패했다).
const chipByText = (t) => screen.getAllByTestId(/^anatomy-(leader|producer)-chip$/).find((c) => c.textContent.includes(t))

describe('교차 픽스처가 실제로 각 분기를 타는가 (게이트 함수 직접 적용, task#301)', () => {
  // 이빨(단언의 판별력)과 커버리지(분기 진입)는 다른 축이다 — 아래 3줄이 후자의 증명이다.
  it('이 판은 기술·광물·전문가 3축을 모두 갖는다 — 전문가 축 sentinel의 전제', () => {
    expect(AXES.map((a) => a.key)).toEqual(['tech', 'minerals', 'experts'])
  })

  it('기술 축과 광물 축 **양쪽**에서 hit이 난다 — 두 경로를 다 지나간다', () => {
    const r = crossHoldings({ axes: AXES, players: CROSSABLE.players, stockMap: TRACKED_MAP })
    expect(r.techItemHits).toBe(2)      // 006400(삼성SDI) = 대면적 성막 · 고전류밀도
    expect(r.mineralItemHits).toBe(1)   // ALB(앨버말) = 리튬
    expect(r.unmatchedCount).toBe(4)    // Gotion · 칭산홀딩스(티커 없음) + 간펑리튬 · CMOC(CN 6자리, finding 1)
    expect(r.measurable).toBe(true)
  })

  it('전문가 축 항목엔 업체 개념이 없다 — 배지 0건이 「축이 없어서」가 아님을 못박는다', () => {
    expect(itemCompanies('experts', CROSSABLE.composition.experts[0], CROSSABLE.players)).toEqual([])
  })
})

describe('S2·S3 — 칩 마커와 항목 배지 (겹침 있는 판)', () => {
  beforeEach(() => mockApi({ report: CROSSABLE, stocks: TRACKED }))

  it('매칭 칩에만 기호와 testid가 있다 — 미매칭 칩엔 둘 다 없다', async () => {
    renderPage()
    await screen.findByTestId('anatomy-cross-summary')
    // 006400은 기술 축 2항목, ALB는 광물 1항목에 등장 → 마커 3개
    const marks = marksOf()
    expect(marks).toHaveLength(3)
    expect(marks.filter((m) => m.dataset.owned === 'holding')).toHaveLength(2)
    expect(marks.filter((m) => m.dataset.owned === 'watchlist')).toHaveLength(1)
    expect(marks.map((m) => m.textContent)).toEqual(['◆', '◆', '◇'])
    // 이빨 — 미매칭 업체 칩에 마커가 새면 위 개수 단언이 무의미해진다
    expect(chipByText('삼성SDI').querySelector('[data-testid="anatomy-chip-owned"]')).toBeTruthy()
    expect(chipByText('토요타').querySelector('[data-testid="anatomy-chip-owned"]')).toBeNull()   // TM=미추적
    expect(chipByText('Gotion').querySelector('[data-testid="anatomy-chip-owned"]')).toBeNull()   // 티커 없음
    expect(chipByText('앨버말').querySelector('[data-testid="anatomy-chip-owned"]')).toBeTruthy()
    expect(chipByText('SQM').querySelector('[data-testid="anatomy-chip-owned"]')).toBeNull()
  })

  it('배지는 겹침 있는 항목에만 있고, 개수 합이 techItemHits + mineralItemHits와 일치한다', async () => {
    renderPage()
    await screen.findByTestId('anatomy-cross-summary')
    const r = crossHoldings({ axes: AXES, players: CROSSABLE.players, stockMap: TRACKED_MAP })
    const badges = badgesOf()
    expect(badges).toHaveLength(r.techItemHits + r.mineralItemHits)   // = 3
    expect(badges.map((b) => b.textContent)).toEqual(['◆ 1', '◆ 1', '◇ 1'])
    // 배지 있는 항목명 = 실제 겹친 항목 (배지가 엉뚱한 항목에 붙으면 개수만으론 안 잡힌다)
    const named = badges.map((b) => b.closest('[data-testid="anatomy-item"]').querySelector('[data-testid="anatomy-item-name"]').textContent)
    expect(named).toEqual(['대면적 전해질층 무결점 성막·적층', '고전류밀도 덴드라이트 억제', '리튬'])
  })

  it('전문가 축에는 배지가 하나도 없다 (ADR-0042 결정 4) — 축이 실재함을 함께 센다', async () => {
    const { container } = renderPage()
    await screen.findByTestId('anatomy-cross-summary')
    const experts = container.querySelector('[data-axis="experts"]')
    expect(experts).toBeTruthy()                                          // sentinel: 축이 실재한다
    expect(experts.querySelectorAll('[data-testid="anatomy-item"]').length).toBeGreaterThan(0)
    expect(experts.querySelectorAll('[data-testid="anatomy-item-cross"]')).toHaveLength(0)
    expect(experts.querySelectorAll('[data-testid="anatomy-chip-owned"]')).toHaveLength(0)
  })

  it('전문가 항목이 leaders·producers를 실어도 배지 0건이다 (대조군 — 「모든 축 균일 순회」 리팩터 방어)', async () => {
    const rigged = {
      ...CROSSABLE,
      composition: {
        ...CROSSABLE.composition,
        experts: CROSSABLE.composition.experts.map((e) => ({
          ...e, leaders: ['삼성SDI'], producers: [{ name: '앨버말', ticker: 'ALB' }],
        })),
      },
    }
    mockApi({ report: rigged, stocks: TRACKED })
    const { container } = renderPage()
    await screen.findByTestId('anatomy-cross-summary')
    const experts = container.querySelector('[data-axis="experts"]')
    expect(experts.querySelectorAll('[data-testid="anatomy-item-cross"]')).toHaveLength(0)
    expect(experts.querySelectorAll('[data-testid="anatomy-chip-owned"]')).toHaveLength(0)
  })

  it('읽기 전용 — 쓰기 요청이 나가지 않는다(`toggle` 미사용의 관측 가능한 형태)', async () => {
    renderPage()
    await screen.findByTestId('anatomy-cross-summary')
    expect(api.post).not.toHaveBeenCalled()
    expect(api.delete).not.toHaveBeenCalled()
  })
})

describe('S4 — 상단 요약의 4분기 (본문은 네 분기 모두에서 계속 렌더된다)', () => {
  const expectBodyAlive = () => expect(screen.getAllByTestId('anatomy-axis')).toHaveLength(3)

  it('ⓐ 겹침 있음 — 보유·관심을 구분하고, 걸린 항목 수와 미매칭 부기를 말한다', async () => {
    mockApi({ report: CROSSABLE, stocks: TRACKED })
    renderPage()
    const box = await screen.findByTestId('anatomy-cross-summary')
    expect(screen.getByTestId('anatomy-cross-found').textContent).toBe('◆ 보유 1 · ◇ 관심 1')
    // 축 이름표는 AXIS_META에서 파생한다 — 섹션 제목과 같은 낱말이어야 「어디에」를 짚는다
    expect(box.textContent).toContain('필요 기술 2곳 · 핵심 광물 1곳 등장')
    expect(box.textContent).toContain('대조할 수 없는 업체 4곳 제외')
    // 집계 범위를 화면에 밝힌다 — 안 밝히면 「3축 중 0곳」과 「잴 수 없는 축」이 섞여 읽힌다.
    // 문구는 그 판에 **실재하는 축**에서 파생한다(상수면 없는 축을 대조했다고 말한다).
    expect(box.textContent).toContain('전문가 축 제외 — 업체 없음')
    expect(screen.queryByTestId('anatomy-cross-none')).toBeNull()
    expect(screen.getByTestId('anatomy-cross-legend')).toBeTruthy()
    expectBodyAlive()
  })

  it('ⓐ′ 겹침 0 — 「없음」은 대조가 끝났다는 진술이고, 마커·배지·범례가 전부 없다', async () => {
    mockApi({ report: CROSSABLE, stocks: [{ ticker: 'AAPL', type: 'holding' }] })
    renderPage()
    const box = await screen.findByTestId('anatomy-cross-summary')
    expect(screen.getByTestId('anatomy-cross-none').textContent).toBe('없음')
    expect(box.textContent).toContain('필요 기술·핵심 광물 축 전체 대조')
    expect(box.textContent).toContain('대조할 수 없는 업체 4곳 제외')
    expect(marksOf()).toHaveLength(0)
    expect(badgesOf()).toHaveLength(0)
    expect(screen.queryByTestId('anatomy-cross-legend')).toBeNull()   // 설명할 기호가 없다
    expectBodyAlive()
  })

  it('ⓑ unknown(추적 조회 실패) — 요약을 그리지 않는다. 실패를 「없음」으로 말하지 않는다', async () => {
    mockApi({ report: CROSSABLE, stocksFail: true })
    renderPage()
    await screen.findByTestId('tech-anatomy')
    await waitFor(() => expectBodyAlive())
    expect(summary()).toBeNull()
    expect(screen.queryByTestId('anatomy-cross-none')).toBeNull()   // 「없음」이 새지 않았다
    expect(marksOf()).toHaveLength(0)
    expect(badgesOf()).toHaveLength(0)
    expect(screen.queryByTestId('anatomy-cross-legend')).toBeNull()
  })

  it('ⓒ measurable false(티커를 가진 업체가 없는 판) — 「0」이 아니라 「못 잼」이라 안 그린다', async () => {
    const nameless = {
      ...CROSSABLE,
      players: CROSSABLE.players.map((p) => ({ ...p, ticker: null })),
      composition: {
        ...CROSSABLE.composition,
        minerals: CROSSABLE.composition.minerals.map((m) => ({
          ...m, producers: (m.producers || []).map((p) => ({ ...p, ticker: null })),
        })),
      },
    }
    // 이 판이 정말 그 분기를 타는지 게이트 함수로 못박는다
    expect(crossHoldings({ axes: deriveAxes(nameless.composition), players: nameless.players, stockMap: TRACKED_MAP }).measurable).toBe(false)
    mockApi({ report: nameless, stocks: TRACKED })
    renderPage()
    await screen.findByTestId('tech-anatomy')
    await waitFor(() => expectBodyAlive())
    expect(summary()).toBeNull()
    expect(marksOf()).toHaveLength(0)
    expect(badgesOf()).toHaveLength(0)
  })

  it('ⓓ loaded false(추적 조회 미완) — 나중에 나타나는 것이 처음부터 「0」으로 보이는 것보다 낫다', async () => {
    mockApi({ report: CROSSABLE, stocksPending: true })
    renderPage()
    await screen.findByTestId('tech-anatomy')
    await waitFor(() => expectBodyAlive())
    expect(summary()).toBeNull()
    expect(marksOf()).toHaveLength(0)
    expect(badgesOf()).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 적대검토 후속 (task#315) — 마커·배지·요약의 실재 결함 8건
describe('마커·배지의 접근성과 판별 단서 (finding 5·7·14)', () => {
  beforeEach(() => mockApi({ report: CROSSABLE, stocks: TRACKED }))

  it('기호가 단어를 갖는다 — generic span의 title은 AT에 노출되지 않는다', async () => {
    renderPage()
    await screen.findByTestId('anatomy-cross-summary')
    expect(screen.getAllByLabelText('보유 종목')).toHaveLength(2)
    expect(screen.getAllByLabelText('관심 종목')).toHaveLength(1)
  })

  it('보유와 관심의 색이 갈린다 — fill 유무만이 단서면 11px에서 구별되지 않는다', async () => {
    renderPage()
    await screen.findByTestId('anatomy-cross-summary')
    const marks = marksOf()
    const hold = marks.find((m) => m.dataset.owned === 'holding')
    const watch = marks.find((m) => m.dataset.owned === 'watchlist')
    expect(hold.style.color).not.toBe(watch.style.color)
    // 형제 화면(/tech-report의 PlayerTable)과 같은 어휘를 쓴다 — 비-가격 2색 토큰
    expect(hold.style.color).toContain('--tag-hold-color')
    expect(watch.style.color).toContain('--tag-watch-color')
  })

  it('배지도 단어를 갖는다', async () => {
    renderPage()
    await screen.findByTestId('anatomy-cross-summary')
    expect(badgesOf().every((b) => (b.getAttribute('aria-label') || '').includes('보유') || (b.getAttribute('aria-label') || '').includes('관심'))).toBe(true)
  })
})

describe('퍼센트 열 정렬 (finding 8·13)', () => {
  it('배지가 퍼센트 **앞**에 온다 — 퍼센트가 항상 머리줄의 마지막 자녀다', async () => {
    mockApi({ report: CROSSABLE, stocks: TRACKED })
    const { container } = renderPage()
    await screen.findByTestId('anatomy-cross-summary')
    const heads = [...container.querySelectorAll('.tech-anatomy__head')]
    // sentinel — 배지가 실재하는 머리줄이 최소 1개여야 이 단언이 의미를 갖는다
    expect(heads.filter((h) => h.querySelector('[data-testid="anatomy-item-cross"]')).length).toBeGreaterThan(0)
    for (const h of heads) {
      expect(h.lastElementChild.getAttribute('data-testid')).toBe('anatomy-item-pct')
    }
  })
})

describe('배지 단위 = 티커 (finding 15)', () => {
  it('leaders에 같은 업체가 중복돼도 배지와 요약이 어긋나지 않는다', async () => {
    const dup = {
      ...CROSSABLE,
      composition: {
        tech: CROSSABLE.composition.tech.map((t, i) =>
          i === 0 ? { ...t, leaders: ['삼성SDI', '삼성SDI'] } : t),
      },
    }
    mockApi({ report: dup, stocks: TRACKED })
    renderPage()
    await screen.findByTestId('anatomy-cross-summary')
    const badges = badgesOf()
    expect(badges.map((b) => b.textContent)).toEqual(['◆ 1', '◆ 1'])
    expect(screen.getByTestId('anatomy-cross-found').textContent).toBe('◆ 보유 1')
  })
})

describe('요약 문구의 정직성 (finding 3·4·10·12)', () => {
  it('축 이름표가 섹션 제목과 같은 낱말이다 — 「난제」는 화면 어디에도 없다', async () => {
    mockApi({ report: CROSSABLE, stocks: TRACKED })
    renderPage()
    const box = await screen.findByTestId('anatomy-cross-summary')
    expect(box.textContent).toContain('필요 기술 2곳')
    expect(box.textContent).toContain('핵심 광물 1곳')
    expect(box.textContent).not.toContain('난제')
  })

  it('원인을 단정하지 않는다 — 「티커 미등록」은 세 원인 중 하나일 뿐이다', async () => {
    mockApi({ report: CROSSABLE, stocks: TRACKED })
    renderPage()
    const box = await screen.findByTestId('anatomy-cross-summary')
    expect(box.textContent).toContain('대조할 수 없는 업체 4곳')
    expect(box.textContent).not.toContain('티커 미등록')
  })

  it('그 판에 없는 축을 「대조했다」고 말하지 않는다 — 기술 축만 있는 판', async () => {
    const techOnly = { ...CROSSABLE, composition: { tech: CROSSABLE.composition.tech } }
    // 이 판이 정말 그 분기를 타는지 게이트 함수로 못박는다
    expect(deriveAxes(techOnly.composition).map((a) => a.key)).toEqual(['tech'])
    mockApi({ report: techOnly, stocks: TRACKED })
    renderPage()
    const box = await screen.findByTestId('anatomy-cross-summary')
    expect(box.textContent).toContain('필요 기술')
    expect(box.textContent).not.toContain('광물')
    expect(box.textContent).not.toContain('전문가')
  })

  it('부기가 한 문장이다 — 같은 사실을 두 번 말하지 않는다(세로 예산)', async () => {
    mockApi({ report: CROSSABLE, stocks: [{ ticker: 'AAPL', type: 'holding' }] })
    renderPage()
    const box = await screen.findByTestId('anatomy-cross-summary')
    expect(box.textContent).not.toContain('모두 대조한 결과입니다')
    expect(box.querySelectorAll('p')).toHaveLength(2)
  })
})

describe('추적 조회는 마운트당 1회다 (finding 2 — 3상태 논거의 실제 전제)', () => {
  it('/api/stocks를 정확히 1번만 부른다 — 재조회가 붙는 날 이 단언이 깨져 다시 판단하게 한다', async () => {
    mockApi({ report: CROSSABLE, stocks: TRACKED })
    renderPage()
    await screen.findByTestId('anatomy-cross-summary')
    expect(api.get.mock.calls.filter((c) => c[0] === '/api/stocks')).toHaveLength(1)
  })
})
