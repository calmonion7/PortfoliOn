import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import api from '../api'
import Skeleton from '../components/ui/Skeleton'
import useTrackedStocks from '../hooks/useTrackedStocks'
import { TECH_NAMES } from '../components/reports/techReportUtils'
import {
  AXIS_META, deriveAxes, joinLeaders, formatShare, itemCompanies, crossHoldings,
  buildCompanyIndex, trackedState, matchableTicker,
} from '../components/tech/techAnatomyUtils'
import './TechAnatomy.css'

// 기술 해부 (ADR-0042, task#306) — [[주요기술 리포트]]와 같은 기술 slug를 대상으로 하는
// **두 번째 시선**이다. 그쪽이 「지금 누가 어디까지 왔나」(지형)라면 이건 「이 기술 하나를
// 완성하려면 무엇이 얼마나 필요한가」(구조)다.
//
// 데이터는 발행 페이로드의 선택 필드 `composition` 하나에서 온다(전용 엔드포인트 없음 —
// 기술 축이 같은 페이로드의 `players[]`를 참조하므로 둘이 한 요청 본문에 있어야 발행 시점에
// 실재를 검증할 수 있다, ADR-0042 결정 1).
//
// ⚠️ 세 축은 **분모가 서로 다르다.** 합쳐서 하나로 읽으면 안 되고, 그래서 축마다 별도 막대이고
// 「기준」 문구가 **상시 노출**된다(접기·툴팁 아님). 세 축을 합친 요약 지표는 원리적으로 없다.
//
// ⚠️ 이 페이지는 「해부 없음」을 **섹션째 무음 생략하지 않는다.** 해부가 본문이라 생략하면
// 페이지 전체가 사라져 목록의 링크가 「고장난 링크」로 읽힌다 — `key_points`류의 무음 생략
// 관례와 갈리는 지점이니 그대로 베끼지 말 것(S4).

// ── 보유·관심 교차 마커 (task#315) ────────────────────────────────────────────
// 기호(◆/◇) + 범례로 둔다 — 칩에 「보유」 두 글자를 넣으면 278px에서 칩이 쪼개진다.
// **색은 상태별로 가른다**: ◆/◇의 fill 유무만이 단서면 11px(--font-size-xs) 칩에서 두 상태가
// 구별되지 않고, 범례는 3축 전부 아래(첫 화면 밖)에 있다. 토큰은 형제 화면
// `/tech-report`의 PlayerTable이 「보유」/「관심」 배지에 쓰는 그것과 **같은 어휘**다
// (--tag-hold-* / --tag-watch-*) — 한 클릭 거리의 두 화면이 같은 개념을 다른 색으로 말하면
// 사용자가 ◇를 보유로 읽는다. 가격 등락 토큰(--up/--down)은 여기서 쓰지 않는다: 추적 상태는
// 가격이 아니다(frontend/CLAUDE.md의 KR 색 관례 — 교차 사용 금지).
export const MARK = { holding: '◆', watchlist: '◇' }
export const MARK_LABEL = { holding: '보유', watchlist: '관심' }
export const MARK_COLOR = { holding: 'var(--tag-hold-color)', watchlist: 'var(--tag-watch-color)' }
// 마커는 칩(`white-space: nowrap`) **안**의 인라인 span이라 칩과 한 덩어리로 움직인다.
// `flex-shrink`를 주지 않는다 — 칩은 flex 컨테이너가 아니므로 그 선언이 무효이고, 무효한
// 선언을 남기면 다음 사람이 「여기 flex 규율이 걸려 있다」고 오독한다.
export const MARK_STYLE = { marginRight: 3 }
// 배지·요약 — 수치는 줄면 안 되므로 `flex-shrink: 0` + nowrap(축2·축3 규율).
// 색은 컨테이너가 아니라 상태별 자녀 span이 갖는다(혼재 배지 「◆ 2 ◇ 1」에서 둘이 갈린다).
export const BADGE_STYLE = {
  flex: '0 0 auto', whiteSpace: 'nowrap',
  fontSize: 'var(--font-size-xs)', fontVariantNumeric: 'tabular-nums',
}
export const CROSS_BOX_STYLE = {
  margin: '0 0 20px', padding: '8px 10px', borderRadius: 4,
  background: 'var(--accent-soft)', color: 'var(--text)', fontSize: 'var(--font-size-sm)',
}
export const CROSS_NOTE_STYLE = { margin: '2px 0 0', fontSize: 'var(--font-size-xs)', color: 'var(--text-3)', overflowWrap: 'anywhere' }
export const LEGEND_STYLE = { margin: '14px 0 0', fontSize: 'var(--font-size-xs)', color: 'var(--text-3)', overflowWrap: 'anywhere' }
const EMPTY_MAP = {}   // 참조 고정 — loaded 전·unknown일 때 stockMap 대신 넘긴다

/** `{holding, watchlist}` 개수 → 표시 조각. `withLabel`이면 「◆ 보유 2」, 아니면 「◆ 2」. */
function crossParts(counts, withLabel) {
  const out = []
  for (const k of ['holding', 'watchlist']) {
    if (counts[k] > 0) out.push(withLabel ? `${MARK[k]} ${MARK_LABEL[k]} ${counts[k]}` : `${MARK[k]} ${counts[k]}`)
  }
  return out
}

/** 항목 하나에 걸린 내 종목 수 — 매칭 규칙은 `itemCompanies`+`trackedState` **한 곳**에서만
    온다(S1). 전문가 축은 그 함수가 항상 `[]`를 주므로 배지가 원리적으로 0이다(ADR-0042 결정 4).
    ⚠️ 단위는 **티커**다(업체 항목 수가 아니다) — `leaders: ['삼성SDI','삼성SDI']`처럼 중복이
    발행에서 막히지 않으므로, 항목 수로 세면 배지 「◆ 2」와 요약 「◆ 보유 1」이 같은 화면에서
    모순된다(요약은 티커 Set으로 센다). */
function itemCross(axisKey, item, players, marks, companyIndex) {
  const counts = { holding: 0, watchlist: 0 }
  const seen = new Set()
  for (const c of itemCompanies(axisKey, item, players, companyIndex)) {
    const state = trackedState(marks, c)
    if (!state) continue
    const t = matchableTicker(c.ticker, c.country)
    if (seen.has(t)) continue
    seen.add(t)
    counts[state] += 1
  }
  return counts
}

/** 칩 앞의 추적 마커 — 미매칭이면 **기호도 testid도 없다**(존재 자체가 판정축이다).
    `role="img"`+`aria-label`로 기호가 **단어를 갖는다** — generic span의 `title`은 접근성
    이름으로 안정적으로 노출되지 않아, 그것만 두면 스크린리더 사용자에게 「내 종목이 여기
    걸려 있다」는 이 화면의 핵심 정보가 통째로 전달되지 않는다(같은 파일 `anatomy-bar`와 동형). */
function Mark({ state }) {
  if (state !== 'holding' && state !== 'watchlist') return null
  return (
    <span
      data-testid="anatomy-chip-owned" data-owned={state} role="img"
      aria-label={`${MARK_LABEL[state]} 종목`} title={`${MARK_LABEL[state]} 종목`}
      style={{ ...MARK_STYLE, color: MARK_COLOR[state] }}
    >
      {MARK[state]}
    </span>
  )
}

function LeaderChips({ chips, marks = EMPTY_MAP, companyIndex }) {
  if (!chips || chips.length === 0) return null
  return (
    <div className="tech-anatomy__chips" data-testid="anatomy-leader-chips">
      {chips.map((c, i) => (
        // key에 인덱스를 섞는다 — `leaders` 중복이 발행에서 막히지 않아 이름만으론 유일하지 않다.
        <span key={`${c.name}-${i}`} className="tech-anatomy__chip" data-testid="anatomy-leader-chip">
          <Mark state={trackedState(marks, c, companyIndex)} />
          {c.name}
          {Number.isFinite(c.tech_level) && (
            <span className="tech-anatomy__chip-lv" data-testid="anatomy-leader-level">{c.tech_level}단계</span>
          )}
        </span>
      ))}
    </div>
  )
}

function ProducerChips({ producers, marks = EMPTY_MAP, companyIndex }) {
  if (!producers || producers.length === 0) return null
  return (
    <div className="tech-anatomy__chips" data-testid="anatomy-producer-chips">
      {producers.map((p, i) => (
        <span key={`${p.name}-${i}`} className="tech-anatomy__chip" data-testid="anatomy-producer-chip">
          <Mark state={trackedState(marks, p, companyIndex)} />
          {p.name}{p.country ? `(${p.country})` : ''}
          {Number.isFinite(p.share_pct) && (
            <span className="tech-anatomy__chip-lv">{formatShare(p.share_pct)}</span>
          )}
        </span>
      ))}
    </div>
  )
}

function MineralMeta({ item }) {
  const parts = []
  if (item.top_source_country) {
    parts.push(`주요 산지 ${item.top_source_country}${Number.isFinite(item.top_source_pct) ? ` ${formatShare(item.top_source_pct)}` : ''}`)
  }
  if (Array.isArray(item.used_in) && item.used_in.length > 0) parts.push(`쓰임 → ${item.used_in.join(' · ')}`)
  if (parts.length === 0) return null
  return <div className="tech-anatomy__meta" data-testid="anatomy-mineral-meta">{parts.join(' · ')}</div>
}

function Axis({ axis, players, mineralsBasis, marks = EMPTY_MAP, companyIndex }) {
  // 기술 축만 players[]와 이름으로 조인한다(다른 두 축은 참조가 없다).
  const items = axis.key === 'tech' ? joinLeaders(axis.items, players, companyIndex) : axis.items
  // 막대의 aria-label — role="img"는 ARIA leaf라 자손이 접근성 트리에서 프루닝되지만,
  // 같은 값이 바로 아래 목록에 **텍스트로 전부** 있으므로 정보 손실이 없다(task#281 ⑭와 대비되는
  // 안전한 사용례: 거기선 SVG 텍스트가 화면 어디에도 중복되지 않아 정보가 통째로 사라졌다).
  const label = `${axis.title} 지분(${axis.basis}) — ` + items.map((i) => `${i.name} ${formatShare(i.share_pct)}`).join(', ')
  return (
    <section className="tech-anatomy__axis" data-testid="anatomy-axis" data-axis={axis.key}>
      <h2 className="tech-anatomy__axis-title" data-testid="anatomy-axis-title">{axis.title}</h2>
      <p className="tech-anatomy__basis" data-testid="anatomy-basis">{axis.basis}</p>

      <div className="tech-anatomy__bar" role="img" aria-label={label} data-testid="anatomy-bar">
        {items.map((it, idx) => (
          // 조각 안에 텍스트 없음 — 라벨은 전부 아래 목록에 있다(CSS 헤더 주석 참조).
          <span
            key={`${it.name}-${idx}`}
            className="tech-anatomy__seg"
            data-testid="anatomy-seg"
            style={{ flex: `0 0 ${it.share_pct}%`, background: it.color }}
          />
        ))}
      </div>

      <ul className="tech-anatomy__items">
        {items.map((it, idx) => {
          // 0이면 배지를 **아예 안 그린다** — 0을 그리면 세 축 모든 항목에 「0」이 깔려 노이즈가 된다.
          const cross = itemCross(axis.key, it, players, marks, companyIndex)
          const badge = crossParts(cross, false)
          return (
          <li key={`${it.name}-${idx}`} className="tech-anatomy__item" data-testid="anatomy-item">
            <div className="tech-anatomy__head">
              <span className="tech-anatomy__swatch" style={{ background: it.color }} aria-hidden="true" />
              <span className="tech-anatomy__name" data-testid="anatomy-item-name">{it.name}</span>
              {/* 배지는 퍼센트 **앞**이다 — 뒤에 두면 배지 있는 항목만 퍼센트가 배지폭만큼
                  왼쪽으로 밀려 축 안에서 % 열이 지그재그가 된다(축 하나가 Σ=100이라 사용자는
                  값들을 세로로 비교한다 — tabular-nums까지 준 자리다). 이름 트랙이 좁아지는
                  비용은 그대로지만 그건 `overflow-wrap: anywhere`가 접는다. */}
              {badge.length > 0 && (
                <span
                  data-testid="anatomy-item-cross" data-holding={cross.holding} data-watchlist={cross.watchlist}
                  aria-label={`내 종목 ${crossParts(cross, true).join(' · ')}`}
                  title={`내 종목 ${crossParts(cross, true).join(' · ')}`} style={BADGE_STYLE}
                >
                  {['holding', 'watchlist'].filter((k) => cross[k] > 0).map((k, bi) => (
                    <span key={k} style={{ color: MARK_COLOR[k] }}>{bi > 0 ? ' ' : ''}{MARK[k]} {cross[k]}</span>
                  ))}
                </span>
              )}
              <span className="tech-anatomy__pct" data-testid="anatomy-item-pct">{formatShare(it.share_pct)}</span>
            </div>
            {it.rationale && <p className="tech-anatomy__rationale" data-testid="anatomy-rationale">{it.rationale}</p>}
            {axis.key === 'minerals' && <MineralMeta item={it} />}
            {axis.key === 'tech' && <LeaderChips chips={it.leaderChips} marks={marks} companyIndex={companyIndex} />}
            {axis.key === 'minerals' && <ProducerChips producers={it.producers} marks={marks} companyIndex={companyIndex} />}
          </li>
          )
        })}
      </ul>

      {/* 광물 점유의 기준 문구 — 어느 채굴사든 점유율을 실으면 발행이 이걸 요구한다.
          `market.share_basis`(그 기술 *시장*의 점유)와 자가 다르므로 따로 표기한다. */}
      {axis.key === 'minerals' && mineralsBasis && (
        <p className="tech-anatomy__basis" data-testid="anatomy-minerals-basis">채굴·정제 점유율: {mineralsBasis}</p>
      )}
    </section>
  )
}

/**
 * 상단 요약 — **세 상태를 구분해 말한다**(task#307의 규율). 「없음」은 조회가 성공하고 대조까지
 * 끝났을 때만 할 수 있는 말이다. 조회 실패(`unknown`)·로딩 중(`loaded === false`)·잴 대상이
 * 없는 판(`measurable === false`)에서는 호출측이 이 블록을 **아예 렌더하지 않는다** — 셋 다
 * 「없다」가 아니라 「모른다/못 잼」이고, 그걸 「없습니다」로 말하면 화면이 거짓 진술을 한다.
 *
 * 집계 범위(기술·광물 축)를 문구에 **밝힌다** — 안 밝히면 독자가 「3축 중 0곳」과 「잴 수 없는
 * 축」을 섞어 읽는다. 그리고 축을 가로질러 합산하지 않는다(ADR-0042 결정 2): 세는 것은 항목
 * 개수뿐이고 지분(%)은 섞지 않는다.
 */
function CrossSummary({ cross, axes }) {
  // 축 이름표는 `AXIS_META`에서 파생한다 — 화면 섹션 제목과 **같은 낱말**이어야 요약이
  // 「어디에」를 짚어 준다. 예전엔 요약이 「난제 2곳」이라 말하는데 그 섹션 제목은 「필요 기술」
  // 이어서, 사용자가 「난제」를 찾다 못 찾고 세 축을 다시 훑었다(요약의 존재 이유가 무너진다).
  const title = Object.fromEntries(AXIS_META.map((m) => [m.key, m.title]))
  // ⚠️ 집계 범위·「잴 수 없는 축」 문구를 **상수로 두지 않는다.** `deriveAxes`는 항목 0인 축을
  // 통째로 드롭하고 세 축이 전부 Optional이므로, 상수 문구는 그 판에 없는 축의 채굴사를
  // 「모두 대조했다」고 말하거나 없는 전문가 축을 「잴 수 없다」고 변명한다.
  const keys = (axes || []).map((a) => a.key)
  const scope = ['tech', 'minerals'].filter((k) => keys.includes(k)).map((k) => title[k])
  const found = crossParts({ holding: cross.holdingTickers.length, watchlist: cross.watchTickers.length }, true)
  const where = []
  if (cross.techItemHits > 0) where.push(`${title.tech} ${cross.techItemHits}곳`)
  if (cross.mineralItemHits > 0) where.push(`${title.minerals} ${cross.mineralItemHits}곳`)
  // 부기는 **조각 나열 한 줄**이다 — 예전엔 「모두 대조한 결과입니다」와 「기술·광물 축만
  // 셉니다」가 같은 사실을 두 번 말해 278px에서 요약이 5줄(104px)을 먹고 첫 축을 그만큼
  // 밀어냈다. 그리고 「어디에」는 **이 문단**에 둔다(--font-size-xs라 같은 글자가 위 문단보다
  // 싸다 — 위는 sm이다). 세로 예산은 줄 수이지 문장 수가 아니다.
  const notes = [where.length > 0 ? `${where.join(' · ')} 등장` : `${scope.join('·')} 축 전체 대조`]
  if (keys.includes('experts')) notes.push(`${title.experts} 축 제외 — 업체 없음`)
  // 원인을 단정하지 않는다 — 이 수는 비상장·이름 조인 실패·다른 시장의 6자리 코드 **셋**을
  // 합친 것이라 「티커 미등록」이라 말하면 상장사를 미등록으로 분류하는 거짓이 된다.
  if (cross.unmatchedCount > 0) notes.push(`대조할 수 없는 업체 ${cross.unmatchedCount}곳 제외`)
  return (
    <div data-testid="anatomy-cross-summary" style={CROSS_BOX_STYLE}>
      <p style={{ margin: 0 }}>
        이 기술에 걸린 내 종목 — {found.length > 0
          ? <strong data-testid="anatomy-cross-found">{found.join(' · ')}</strong>
          : <span data-testid="anatomy-cross-none">없음</span>}
      </p>
      <p style={CROSS_NOTE_STYLE}>{notes.join(' · ')}</p>
    </div>
  )
}

export default function TechAnatomy() {
  const { slug } = useParams()
  const [report, setReport] = useState(undefined)  // undefined=로딩, null=발행물 없음, object=있음
  const [error, setError] = useState(null)          // 실패는 빈 상태와 구별(에러 정직성)
  // 추적 상태는 **읽기만** 한다 — `toggle`을 꺼내지 않는 것이 「해부 화면은 읽기 전용」 계약의
  // 코드적 고정이다(task#306·#315 비목표).
  //
  // ⚠️ **3상태(있음·없음·모름)가 성립하는 근거는 「toggle 미사용」이 아니다.**
  // `useTrackedStocks`의 `trusted.current`는 **reload 성공만으로도 켜지고**(그 훅의 reload 성공
  // 분기), 켜진 뒤의 실패는 `unknown`을 true로 만들지 않는다. 이 화면이 안전한 실제 이유는
  // **`/api/stocks` fetch가 마운트당 1회**라서 「trusted 점등 후 실패」 상태가 존재하지 않는
  // 것이다. 훅에 재조회(포커스 복귀·pull-to-refresh·슬러그 변경·다른 소비처의 reload)가 붙는
  // 순간 `unknown`이 false로 남아 **낡은 맵으로 「없음」을 말한다** — `marks`와 `showSummary`가
  // 둘 다 같은 플래그를 보므로 두 겹 방어가 동시에 무력해진다. 그 전제는 테스트가 「호출 1회」로
  // 못박아 두었으니, 재조회를 붙이는 사람은 그 테스트가 깨지는 자리에서 다시 판단할 것.
  const { stockMap, unknown, loaded } = useTrackedStocks()

  useEffect(() => {
    let ignore = false
    setReport(undefined)
    setError(null)
    api.get(`/api/tech-reports/${slug}`)
      .then(({ data }) => { if (!ignore) setReport((data.reports || [])[0] ?? null) })
      .catch((e) => {
        if (ignore) return
        console.error('[TechAnatomy] 리포트 조회 실패:', e)
        setError(e.response?.status === 422 ? '존재하지 않는 기술입니다.' : '리포트를 불러오지 못했습니다.')
      })
    return () => { ignore = true }
  }, [slug])

  const name = TECH_NAMES[slug] || slug

  if (error) return (
    <div className="tech-anatomy" style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--text-3)' }}>
      <p>{error}</p>
      <Link to="/tech-reports" style={{ color: 'var(--accent)' }}>← 주요기술 리포트로 돌아가기</Link>
    </div>
  )

  if (report === undefined) return <div className="tech-anatomy" style={{ padding: '24px 16px' }}><Skeleton variant="row" count={6} /></div>

  const axes = deriveAxes(report?.composition)
  // 조회 실패·로딩 중에는 **빈 맵**을 넘긴다 — 「훅이 실패 시 stockMap을 비운다」는 내부 성질에
  // 기대지 않고 3상태를 이 화면에서 구조적으로 고정한다(그 성질이 바뀌어도 마커가 새지 않는다).
  // ⚠️ 이 줄은 아래 `showSummary`와 **중복 방어**다 — 주입 실측(task#315): 이 줄을 `stockMap`
  // 직통으로 바꿔도 16개가 전부 통과한다(현재 훅이 실패 시 맵을 비우므로). 즉 단독 load-bearing이
  // 아니고, 훅이 「마지막 성공 맵을 유지」로 바뀌는 날에만 값을 한다(CLAUDE.md task#305의 구별).
  // 같은 주입을 반복하지 않도록 여기 남긴다.
  const marks = loaded && !unknown ? stockMap : EMPTY_MAP
  const companyIndex = buildCompanyIndex({ axes, players: report?.players })
  const cross = crossHoldings({ axes, players: report?.players, stockMap: marks })
  const showSummary = loaded && !unknown && cross.measurable
  const markedCount = cross.holdingTickers.length + cross.watchTickers.length

  return (
    <div className="tech-anatomy" data-testid="tech-anatomy">
      <p className="tech-anatomy__nav">
        <Link to={`/tech-report/${slug}`} data-testid="anatomy-to-report">← {name} 리포트</Link>
      </p>
      <h1 style={{ fontFamily: 'var(--font-serif)', color: 'var(--text)', fontSize: 18, margin: '0 0 4px' }}>
        {name} 해부
      </h1>
      <p style={{ color: 'var(--text-3)', fontSize: 'var(--font-size-xs)', margin: '0 0 20px' }}>
        이 기술 하나를 완성하려면 무엇이 얼마나 필요한가 — 축마다 분모가 다르니 합쳐 읽지 마세요.
      </p>

      {/* 요약은 **본문과 형제**다 — 요약이 없어도(모름·로딩·못 잼) 축 목록은 그대로 렌더된다.
          요약 실패가 화면을 삼키지 않는다(task#307의 「카드만 숨기고 본문은 계속」 두 축). */}
      {showSummary && <CrossSummary cross={cross} axes={axes} />}

      {axes.length === 0 ? (
        // S4 빈 상태 — 백지가 아니라 안내. 무엇이 없는지 + 리포트로 가는 길을 명시한다.
        <div data-testid="anatomy-empty" style={{ padding: '32px 0', color: 'var(--text-3)', fontSize: 'var(--font-size-sm)' }}>
          <p style={{ margin: '0 0 6px', color: 'var(--text)', fontWeight: 600 }}>아직 해부되지 않았습니다.</p>
          <p style={{ margin: '0 0 12px' }}>
            {report === null
              ? `${name}은(는) 아직 발행된 리포트가 없습니다.`
              : `${name} 리포트는 있지만 필요 기술·핵심 광물·전문가 지분이 아직 기입되지 않았습니다. 자동 수집 소스가 없어 전량 조사·기입이라 시간이 걸립니다.`}
          </p>
          <Link to={`/tech-report/${slug}`} style={{ color: 'var(--accent)' }}>{name} 리포트 보기 →</Link>
        </div>
      ) : (
        axes.map((axis) => (
          <Axis key={axis.key} axis={axis} players={report.players || []} marks={marks} companyIndex={companyIndex} mineralsBasis={report.composition?.minerals_share_basis} />
        ))
      )}

      {/* 범례 — 기호가 **실제로 렌더된 판에서만** 나온다(마커 0건이면 설명할 것이 없다). */}
      {showSummary && markedCount > 0 && (
        <p data-testid="anatomy-cross-legend" style={LEGEND_STYLE}>
          {/* 범례의 기호도 마커와 **같은 색**이어야 매핑이 성립한다(색이 갈렸는데 범례가
              단색이면 「이 색은 무슨 뜻인가」가 다시 미해결로 남는다). */}
          <span style={{ color: MARK_COLOR.holding }}>{MARK.holding} 보유</span>
          {' · '}
          <span style={{ color: MARK_COLOR.watchlist }}>{MARK.watchlist} 관심</span>
          {' — 내 종목이 등장하는 업체·항목에 표시됩니다.'}
        </p>
      )}

      {/* 목록 복귀 — 우하단 플로팅 pill(tech-report·analyst-report·guru-detail과 바이트 동형).
          fixed이므로 조상에 transform 금지(task#195). 이 return 안이라 축이 있는 판과 빈 상태
          둘 다에 따라오고, 에러/로딩 분기는 위에서 일찍 반환하므로 pill이 없다(TechReport 동형). */}
      <Link to="/tech-reports" className="list-pill">☰ 목록</Link>
    </div>
  )
}
