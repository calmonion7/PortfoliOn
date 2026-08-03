import Badge from '../ui/Badge'
import { TECH_LEVEL_LABELS, sortPlayers } from '../reports/techReportUtils'

// 선도기술 리포트 상세 「주요 업체」(task#280 S3) — 세로 카드 N장 → 행=업체 표.
// 카드형은 업체 간 비교가 성립하지 않았다(같은 축의 값이 세로로 흩어짐). 표는 열이 축이라
// 9곳을 한 화면에서 비교할 수 있다. 정렬은 techReportUtils.sortPlayers 단일 소스
// (기술수준 내림차순 → 동단계 내 격차 오름차순 → gap_years null 최후).
//
// props:
//   players  [{ name, country, ticker, tech_level, gap_years, leader_name, share_pct, state_led, note }]
//   holdings { [ticker]: 'holding' | 'watchlist' }  — 보유/관심 배지용(없으면 배지 생략)
//
// 표시 규율(TechReport.jsx 카드 렌더에서 승계 — 같은 필드가 한 페이지에서 두 거동을 갖지 않게):
//   gap_years === 0 → '현재 선두' / > 0 → 'N년' / null·음수 → '—'
//     ⚠️ leader_name은 셀에 넣지 않는다(적대 리뷰 F3 실측) — 매 행 반복되는 nowrap 문자열이라
//     「선두 대비」 열이 302px까지 부풀어 PC 1440(콘텐츠 748px)에서 표가 891px로 넘쳤고 점유율·
//     티커 열이 초기 화면 밖으로 밀렸다. 열 머리글이 이미 "선두 대비"이므로 셀에는 격차만 남기고,
//     "무엇 대비인지"는 표 위 캡션 한 줄로 올린다(고유값 2개 이상이면 ' · '로 이어 붙여 손실 0).
//   share_pct >= 0 → 표시 / 음수·비유한·결측 → '—'
//     ⚠️ '> 0'이 아니다(적대 리뷰 F7). 0은 결측이 아니라 값이고, 같은 페이지의 점유율 섹션 게이트와
//     ShareChart가 `Number.isFinite && >= 0`을 쓴다 — 한 필드가 한 페이지에서 두 얼굴을 갖지 않는다.
//   결측은 추정하지 않고 '—'(wrong < missing, ADR-0033 결정 3).
//
// ⚠️ 모바일: 표를 축소하지 않는다. SVG width:100%처럼 폭에 비례해 줄이면 한글이 6~7px이 되어
// 기하 축(넘침·잘림·겹침)이 전부 통과하면서 읽을 수 없게 된다(task#277 실측). minWidth로 설계
// 폭을 지키고 자체 overflow-x 스크롤러에 담는다 — 페이지 본문은 가로 스크롤하지 않는다.

// 스크롤러는 note 본문의 컨테이너 쿼리 기준자다(아래 NOTE_BODY 주석) — container-type을 지우면
// 100cqi가 초기 컨테이닝 블록으로 폴백해 note가 다시 뷰포트 폭으로 넘친다.
export const SCROLLER = { overflowX: 'auto', containerType: 'inline-size' }
const TABLE = { width: '100%', minWidth: 600, borderCollapse: 'collapse' }

// 캡션은 스크롤러 *밖*이다 — nowrap을 주면 페이지 본문이 가로로 넘친다(가토 ⑦·⑨). 접히게 둔다.
const CAPTION = {
  margin: '0 0 6px', lineHeight: 1.5,
  fontSize: 'var(--font-size-xs)', color: 'var(--text-3)',
}

const TH = {
  padding: '8px 10px', textAlign: 'left', whiteSpace: 'nowrap',
  fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-medium)',
  color: 'var(--text-3)', borderBottom: '1px solid var(--border)',
}
const TH_NUM = { ...TH, textAlign: 'right' }

const TD = {
  padding: '8px 10px', whiteSpace: 'nowrap', verticalAlign: 'middle',
  fontSize: 'var(--font-size-sm)', color: 'var(--text)',
  borderBottom: '1px solid var(--border)',
}
const TD_MUTED = { ...TD, color: 'var(--text-3)' }
// 업체명만 접힐 수 있어야 한다 — 나머지 열은 nowrap 그대로(수치는 접히면 안 된다)
const TD_NAME = { ...TD, whiteSpace: 'normal' }
// 수치 열은 tnum 고정폭 — 행 간 자릿수 비교가 목적이다
const TD_NUM = { ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }

// flex는 td가 아니라 내부 div에 건다(td에 display:flex를 주면 셀 박스가 표 레이아웃에서 빠진다)
const NAME_INNER = { display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }
// 업체명은 자르지 않고 접는다(적대 리뷰 F14). 옛 `maxWidth:190 + ellipsis`는 표가 전혀 넘치지 않는
// PC에서도 무조건 잘랐고 복구 수단이 title뿐이라 터치 기기엔 전체 이름을 볼 방법이 없었다.
// overflowWrap:break-word는 min-content를 "가장 긴 단어"로 두므로, 폭이 남으면 한 줄로 온전히 보이고
// 모자랄 때만 접힌다 — 어느 폭에서도 문자가 사라지지 않는다. 고정 상한(매직넘버)을 두지 않는다.
export const NAME_TEXT = {
  minWidth: 0, overflowWrap: 'break-word',
  fontWeight: 'var(--font-weight-semibold)', color: 'var(--text)',
}
// 배지·티커는 줄면 안 되는 형제 — flex-shrink:0 + nowrap으로 고정(task#275)
const SHRINK0 = { flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', whiteSpace: 'nowrap' }
const TICKER = { fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)', color: 'var(--text-3)' }

const NOTE_TD = { padding: 0, borderBottom: '1px solid var(--border)' }
// 접기는 네이티브 <details>/<summary>다 — ProseSections.jsx가 못박은 규율을 그대로 따른다(JS 상태 0,
// 키보드·스크린리더·Ctrl+F 검색이 공짜, 닫힌 본문도 DOM에 남는다). 옛 구현은 접히면 note가 DOM에서
// 통째 사라져 검색·스크린리더·프로브 어느 것도 못 찾았다(적대 리뷰 F9).
// 히트영역: 옛 ▸ 버튼은 실측 5×11px로 WCAG 최소 24×24의 1/10이었다(F10) — summary는 블록이라
// 폭은 행 전체, 높이는 minHeight로 24를 하한한다.
export const NOTE_SUMMARY = {
  cursor: 'pointer', minHeight: 24, padding: '6px 10px', boxSizing: 'border-box',
  fontSize: 'var(--font-size-xs)', lineHeight: 1.5, color: 'var(--text-3)',
}
// note는 산문이다 — 표 설계폭(600px)으로 흘리면 모바일에서 줄마다 가로 스크롤해야 읽힌다.
// 폭 기준은 뷰포트가 아니라 **스크롤러**다(적대 리뷰 F4): 옛 `calc(100vw - 32px)`는 "페이지 인셋
// 좌우 16px"을 가정했는데 모바일 래퍼(.m-page)가 20px을 더해 전 뷰포트에서 40~123px씩 잘렸다.
// 100cqi = 스크롤러 content box 폭이라 래퍼 인셋이 몇이든 정확히 가시폭에 맞는다.
// sticky left:0은 표를 가로로 스크롤해도 본문이 화면 안에 머물게 한다.
export const NOTE_BODY = {
  position: 'sticky', left: 0, width: '100cqi', boxSizing: 'border-box', padding: '0 10px 10px',
  whiteSpace: 'pre-wrap', fontSize: 'var(--font-size-xs)', lineHeight: 1.7, color: 'var(--text-2)',
}
const HOLD_BADGE = { background: 'var(--tag-hold-bg)', color: 'var(--tag-hold-color)', borderColor: 'var(--tag-hold-border)' }
const WATCH_BADGE = { background: 'var(--tag-watch-bg)', color: 'var(--tag-watch-color)', borderColor: 'var(--tag-watch-border)' }

const DASH = '—'

export default function PlayerTable({ players = [], holdings = {} }) {
  const rows = sortPlayers(players)

  // 셀에서 뺀 leader_name을 캡션으로 승격 — 원래 셀에 이름이 보이던 행(gap_years > 0)의 고유값만
  // 모은다(0=선두 자신·null·음수 행의 leader_name은 옛 렌더에서도 표시되지 않았다). 판마다 선두가
  // 갈릴 수 있어 고유값이 2개 이상이면 전부 잇는다 — 하나를 고르면 그게 정보 손실이다.
  const leaders = [...new Set(rows.filter((p) => p.gap_years > 0 && p.leader_name).map((p) => p.leader_name))]

  return (
    <div>
      {leaders.length > 0 && (
        <p style={CAPTION} data-testid="tech-report-players-leader">선두 = {leaders.join(' · ')}</p>
      )}
      <div style={SCROLLER}>
        <table style={TABLE} data-testid="tech-report-players">
          <thead>
            <tr>
              <th scope="col" style={TH}>업체</th>
              <th scope="col" style={TH}>국가</th>
              <th scope="col" style={TH}>기술수준</th>
              <th scope="col" style={TH}>선두 대비</th>
              <th scope="col" style={TH_NUM}>점유율</th>
              <th scope="col" style={TH}>티커</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => {
              const key = p.ticker || p.name || i
              const label = TECH_LEVEL_LABELS[p.tech_level]
              const stockType = p.ticker ? holdings[p.ticker] : null
              // gap_years === 0은 유효값이다(선두 자신) — falsy로 흘리면 선두를 통째 놓친다.
              const gapText = p.gap_years === 0 ? '현재 선두' : p.gap_years > 0 ? `${p.gap_years}년` : DASH
              const hasShare = Number.isFinite(p.share_pct) && p.share_pct >= 0

              return [
                <tr key={key} data-testid="tech-report-player-row">
                  <td style={TD_NAME}>
                    <div style={NAME_INNER}>
                      <span style={NAME_TEXT} data-testid="tech-report-player-name" title={p.name}>{p.name}</span>
                      {p.state_led && <span style={SHRINK0}><Badge variant="info" size="sm">정부주도</Badge></span>}
                    </div>
                  </td>
                  <td style={TD_MUTED}>{p.country || DASH}</td>
                  {/* 라벨이 없는 단계 값(스키마 드리프트)은 추정하지 않고 — */}
                  <td style={TD}>{label ? `${p.tech_level}단계 · ${label}` : DASH}</td>
                  <td style={TD_MUTED}>{gapText}</td>
                  <td style={TD_NUM}>{hasShare ? `${p.share_pct}%` : DASH}</td>
                  <td style={TD}>
                    <span style={SHRINK0}>
                      {p.ticker ? <span style={TICKER}>{p.ticker}</span> : <span style={{ color: 'var(--text-3)' }}>{DASH}</span>}
                      {stockType && (
                        <Badge variant="neutral" size="sm" style={stockType === 'holding' ? HOLD_BADGE : WATCH_BADGE}>
                          {stockType === 'holding' ? '보유' : '관심'}
                        </Badge>
                      )}
                    </span>
                  </td>
                </tr>,
                p.note && (
                  <tr key={`${key}-note`} data-testid="tech-report-player-note">
                    <td colSpan={6} style={NOTE_TD}>
                      <details>
                        {/* 시각 라벨은 짧게, 접근 이름엔 업체명을 실어 9개 summary가 서로 구별되게 한다 */}
                        <summary style={NOTE_SUMMARY} aria-label={`${p.name} 설명`}>설명</summary>
                        <div style={NOTE_BODY}>{p.note}</div>
                      </details>
                    </td>
                  </tr>
                ),
              ]
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
