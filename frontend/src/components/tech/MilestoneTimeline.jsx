import './MilestoneTimeline.css'

// 진척 타임라인(task#281 S3 → task#282에서 가로 SVG를 버리고 세로 HTML 목록으로 재작성).
// milestones[]{year, actor?, event, status} → 연도 그룹 + 상태 마커의 세로 목록.
//
// ⚠️ 왜 SVG를 버렸나(라이브 실측): 연도를 가로 열로 놓으면 열 폭이 최장 문장에 끌려 설계폭이
//    4,479~7,027px가 됐고 PC 748px·모바일 278px 가시폭에선 첫 이벤트 하나만 보였다. SVG <text>는
//    줄바꿈을 못 하므로 "가로 축 + 완성 문장" 조합 자체가 구조적 결함이다(자를 수도 없다 —
//    한국어는 동사가 끝에 와 ellipsis가 사건 종류부터 지운다, 가토 ⑦). 세로 HTML은 자연 줄바꿈하고
//    Ctrl+F·스크린리더·폰트 스케일이 함께 살아난다. 그래서 좌표 계산·문자폭 실측·말줄임이 전부 사라졌다.
//
// 접근성: 진짜 DOM이므로 시맨틱 목록(<ol>/<ul>)을 쓴다. 이전 SVG 구현은 role="img" 원자화로 자손을
// 접근성 트리에서 감추는 함정이 있었다 — 마커만 aria-hidden(장식)이고 상태는 sr-only 텍스트로 준다.
//
// 색은 토큰만 — 마커는 **의미 상태**(success/warn/neutral)이지 가격 방향이 아니므로 --up/--down을
// 절대 쓰지 않는다. 클래스 접미사는 조립하지만 status가 아래 화이트리스트로 정규화된 뒤라 CSS에 없는
// 값이 들어갈 수 없다(가토 ⑪ — CSS 규칙이 없으면 색이 조용히 사라진다. 3규칙 실재를 테스트가 대조).

const STATUSES = ['done', 'in_progress', 'planned']
const STATUS_LABEL = { done: '완료', in_progress: '진행 중', planned: '예정' }

// milestones[] → { groups, items }. 순수함수 — DOM·좌표에 의존하지 않는다.
// 연도 오름차순(같은 해는 입력 순서 유지)으로 정렬하고 같은 해를 한 그룹으로 묶는다.
// ⚠️ 이름·`items` 키는 TechReport.jsx의 섹션 게이트(`.items.length > 0`)가 소비하는 계약이다.
export function milestoneTimelineLayout({ milestones } = {}) {
  const items = (Array.isArray(milestones) ? milestones : [])
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m && typeof m.year === 'number' && Number.isFinite(m.year)
      && typeof m.event === 'string' && m.event.trim().length > 0)
    .sort((a, b) => a.m.year - b.m.year || a.i - b.i)
    .map(({ m }, idx) => ({
      id: `${m.year}-${idx}`,
      year: m.year,
      event: m.event,
      actor: typeof m.actor === 'string' && m.actor.trim() ? m.actor : null,
      status: STATUSES.includes(m.status) ? m.status : 'planned',
    }))

  const groups = []
  for (const it of items) {
    const last = groups[groups.length - 1]
    if (last && last.year === it.year) last.items.push(it)
    else groups.push({ year: it.year, items: [it] })
  }

  return { groups, items }
}

// 순수 표시 컴포넌트(fetch 없음). 데이터가 없으면 섹션째 생략되도록 null을 반환한다
// (구발행물은 milestones가 SQL NULL로 오므로 `?? []`가 아니라 배열 여부로 판정).
export default function MilestoneTimeline({ milestones }) {
  const { groups, items } = milestoneTimelineLayout({ milestones })
  if (items.length === 0) return null

  const legend = STATUSES.filter((s) => items.some((it) => it.status === s))

  return (
    <div className="mstone" data-testid="milestone-timeline">
      <ol className="mstone__list">
        {groups.map((g) => (
          <li className="mstone__group" key={g.year}>
            <div className="mstone__year" data-testid="milestone-year">{g.year}</div>
            <ul className="mstone__events">
              {g.items.map((it) => (
                <li
                  className="mstone__event"
                  key={it.id}
                  data-testid="milestone-item"
                  data-year={it.year}
                  data-status={it.status}
                >
                  <span className={`mstone__marker mstone__marker--${it.status}`} aria-hidden="true" />
                  <span className="sr-only">{STATUS_LABEL[it.status]}</span>
                  <span className="mstone__event-text">{it.event}</span>
                  {it.actor && <span className="mstone__actor">{it.actor}</span>}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <div className="mstone__legend" data-testid="milestone-legend">
        {legend.map((s) => (
          <span className="mstone__legend-item" key={s}>
            <span className={`mstone__marker mstone__marker--${s}`} aria-hidden="true" />
            {STATUS_LABEL[s]}
          </span>
        ))}
      </div>
    </div>
  )
}
