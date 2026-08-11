import Badge from '../ui/Badge'
import { TECH_LEVEL_LABELS, sortPlayers, playerColumns } from '../reports/techReportUtils'

// 선도기술 리포트 상세 「주요 업체」(task#280 S3, task#296 S3) — 세로 카드 N장 → 행=업체 표(스크롤러 없음).
// 카드형은 업체 간 비교가 성립하지 않았다(같은 축의 값이 세로로 흩어짐). 표는 열이 축이라
// 9곳을 한 화면에서 비교할 수 있다. 정렬은 techReportUtils.sortPlayers 단일 소스
// (기술수준 내림차순 → 동단계 내 격차 오름차순 → gap_years null 최후).
// 열 집합은 techReportUtils.playerColumns 단일 소스(name·level 항상 + gap·share는 전 행 결측이면
// 제외) — 국가·티커는 열이 아니라 업체 셀 내부(이름 아래 메타줄)로 들어간다(task#296 S1ⓐ 구조 계약).
//
// props:
//   players  [{ name, country, ticker, tech_level, gap_years, leader_name, share_pct, state_led, note }]
//   holdings { [ticker]: 'holding' | 'watchlist' }  — 보유/관심 배지용(없으면 배지 생략)
//
// 표시 규율(TechReport.jsx 카드 렌더에서 승계 — 같은 필드가 한 페이지에서 두 거동을 갖지 않게):
//   gap_years === 0 → '현재 선두' / > 0 → 'N년' / null·음수 → '—'
//     ⚠️ leader_name은 셀에 넣지 않는다(적대 리뷰 F3 실측) — 매 행 반복되는 nowrap 문자열이라
//     「선두 대비」 열이 302px까지 부풀어 PC 1440(콘텐츠 748px)에서 표가 891px로 넘쳤고 점유율·
//     티커 정보가 초기 화면 밖으로 밀렸다. 열 머리글이 이미 "선두 대비"이므로 셀에는 격차만 남기고,
//     "무엇 대비인지"는 표 위 캡션 한 줄로 올린다(고유값 2개 이상이면 ' · '로 이어 붙여 손실 0).
//   share_pct >= 0 → 표시 / 음수·비유한·결측 → '—'
//     ⚠️ '> 0'이 아니다(적대 리뷰 F7). 0은 결측이 아니라 값이고, 같은 페이지의 점유율 섹션 게이트와
//     ShareChart가 `Number.isFinite && >= 0`을 쓴다 — 한 필드가 한 페이지에서 두 얼굴을 갖지 않는다.
//   결측은 추정하지 않고 '—'(wrong < missing, ADR-0033 결정 3).
//
// ⚠️ task#296: 자체 overflow-x 스크롤러(옛 SCROLLER)와 TABLE.minWidth(600)를 제거했다 — 표는 이제
// 열 생략(playerColumns)과 기술수준 셀의 줄바꿈 허용으로 278px 모바일 폭에 맞춘다. 이건 task#277이
// 금지한 "폰트·좌표 축소"가 아니다(글자 크기는 그대로, 열 수·줄바꿈만 바뀐다) — 표는 표고 SVG처럼
// 좌표계를 갖지 않으니 그 가토는 이 표면에 적용되지 않는다.
const TABLE = { width: '100%', borderCollapse: 'collapse' }

// 캡션은 표 밖이다 — nowrap을 주면 페이지 본문이 가로로 넘친다(가토 ⑦·⑨). 접히게 둔다.
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
// 업체명만 접힐 수 있어야 한다 — 나머지 열은 원칙적으로 nowrap(수치는 접히면 안 된다)
const TD_NAME = { ...TD, whiteSpace: 'normal' }
// 기술수준만 별도로 줄바꿈을 허용한다(task#296 S3ⓒ) — "5단계 · 양산상용"(14자)이 278px 4열에서
// 넘친다. 수치 열(선두 대비·점유율)은 nowrap을 유지한다 — 수치는 접히면 안 된다.
const TD_LEVEL = { ...TD, whiteSpace: 'normal' }
// 수치 열은 tnum 고정폭 — 행 간 자릿수 비교가 목적이다
const TD_NUM = { ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }

// flex는 td가 아니라 내부 div에 건다(td에 display:flex를 주면 셀 박스가 표 레이아웃에서 빠진다)
const NAME_CELL = { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }
const NAME_INNER = { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }
// 국가·티커·보유배지 메타줄 — 업체 셀 내부(task#296 S3ⓑ, 열이 아니다). 폭이 모자라면 줄이 흐른다.
const NAME_META = { display: 'flex', alignItems: 'center', gap: 'var(--space-1)', flexWrap: 'wrap' }
// ⚠️ 국가에 nowrap을 주면 안 된다(적대 리뷰 렌즈1, MED-HIGH). flex-wrap은 *항목 간* 줄바꿈만 허용하고
// 각 항목 자신의 min-content는 그대로 강제하므로, `프랑스·독일·일본`(라이브 reusable-rocket 실측 9자)이
// 쪼갤 수 없는 한 덩어리로 **표 최소폭**에 반영된다. task#280 시절엔 그게 국가 *열*이었고 스크롤러
// (overflowX:auto)가 흡수했지만 이번에 그 안전망을 없앴다 → 그 최소폭이 곧 페이지 가로 스크롤이다.
// 국가는 산문성 값이라 접혀도 문자를 잃지 않는다(가토 ⑦: 줄어도 되는 것만 접는 상자에 넣는다).
const META_TEXT = { minWidth: 0, overflowWrap: 'anywhere', fontSize: 'var(--font-size-xs)', color: 'var(--text-3)' }
// 업체명은 자르지 않고 접는다(적대 리뷰 F14). 옛 `maxWidth:190 + ellipsis`는 표가 전혀 넘치지 않는
// PC에서도 무조건 잘랐고 복구 수단이 title뿐이라 터치 기기엔 전체 이름을 볼 방법이 없었다.
//
// ⚠️⚠️ `break-word`가 아니라 **`anywhere`**여야 한다 — 스크롤러를 없앤 뒤 이 차이가 결정적이다.
// 둘은 *렌더*가 같지만(폭이 모자랄 때만 단어 안에서 끊는다) **min-content 기여가 다르다**:
//   `break-word`는 스펙상 min-content 크기에 영향을 주지 않는다 → 최소폭이 여전히 "최장 단어"다.
//   `anywhere`는 그 끊김 기회가 min-content 계산에 **포함된다** → 표가 실제로 좁아질 수 있다.
// 표 자동 레이아웃은 min-content로 열 폭을 정하므로, `break-word`만으론 "문자를 잃지 않는다"는
// 만족시키면서도 표를 좁히지 못한다. 라이브 실측(reusable-rocket, m350): `ArianeGroup·ESA`(공백 없는
// 15자 ≈ 101px) + `정부주도` 배지가 같은 flex 줄에서 합산돼 업체 열 min-content가 **181px**이 되고,
// 4열 합계 360px > 가용 278px → 문서가 396px로 가로 스크롤했다(page-h-scroll 회귀방지축이 포착).
// 고정 상한(매직넘버)은 두지 않는다.
export const NAME_TEXT = {
  minWidth: 0, overflowWrap: 'anywhere',
  fontWeight: 'var(--font-weight-semibold)', color: 'var(--text)',
}
// 배지·티커는 줄면 안 되는 형제 — flex-shrink:0 + nowrap으로 고정(task#275)
const SHRINK0 = { flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', whiteSpace: 'nowrap' }
// 티커는 식별자다 — 쪼개지면 다른 티커로 읽힌다. 옛 코드는 SHRINK0 안에 있어 nowrap을 상속했는데
// 메타줄로 옮기며 그 래퍼를 잃었다(적대 리뷰 렌즈1 발견 2) → 명시적으로 되돌린다.
const TICKER = { flexShrink: 0, whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)', color: 'var(--text-3)' }

const NOTE_TD = { padding: 0, borderBottom: '1px solid var(--border)' }
// note는 이제 접기 없이 상시 렌더한다(task#296 S3 — 전문을 스크롤로 읽게 하는 방향 전환, ADR-0034
// 결정 1). 시각 라벨 "설명"은 사라졌지만 9개 note가 서로 구별되는 접근 이름은 잃지 않아야 한다 —
// aria-label만 단 순수 <div>는 접근성 트리에서 이름을 갖지 못하므로(이름이 노출되려면 role이 필요)
// role="group"을 함께 준다(가토 ⑭ 계열: 화면은 완벽한데 AT엔 아무것도 없는 상태를 만들지 않는다).
// ⚠️ overflowWrap은 지우지 말 것(적대 리뷰 렌즈2 F1, MED). 옛 스크롤러가 note 폭을 `100cqi`로 못박아
// 표의 min-content 계산에서 떼어놨는데 그 메커니즘이 사라졌다 — 이제 colSpan note <td>가 표 자동
// 레이아웃에 직접 참여하므로, 끊을 수 없는 긴 토큰(URL·영문 합성어) 하나가 표와 **페이지**를 가로로
// 밀어낸다(pre-wrap은 공백에서만 접는다). 산문이라 접어도 문자를 잃지 않는다.
// `anywhere`인 이유는 위 NAME_TEXT 주석과 같다 — `break-word`는 min-content를 줄이지 못한다.
export const NOTE_BODY = {
  boxSizing: 'border-box', padding: '8px 10px 10px', overflowWrap: 'anywhere',
  whiteSpace: 'pre-wrap', fontSize: 'var(--font-size-xs)', lineHeight: 1.7, color: 'var(--text-2)',
}
const HOLD_BADGE = { background: 'var(--tag-hold-bg)', color: 'var(--tag-hold-color)', borderColor: 'var(--tag-hold-border)' }
const WATCH_BADGE = { background: 'var(--tag-watch-bg)', color: 'var(--tag-watch-color)', borderColor: 'var(--tag-watch-border)' }

const DASH = '—'
const COL_LABEL = { name: '업체', level: '기술수준', gap: '선두 대비', share: '점유율' }

export default function PlayerTable({ players = [], holdings = {} }) {
  const rows = sortPlayers(players)
  const cols = playerColumns(players)

  // 셀에서 뺀 leader_name을 캡션으로 승격 — 원래 셀에 이름이 보이던 행(gap_years > 0)의 고유값만
  // 모은다(0=선두 자신·null·음수 행의 leader_name은 옛 렌더에서도 표시되지 않았다). 판마다 선두가
  // 갈릴 수 있어 고유값이 2개 이상이면 전부 잇는다 — 하나를 고르면 그게 정보 손실이다.
  const leaders = [...new Set(rows.filter((p) => p.gap_years > 0 && p.leader_name).map((p) => p.leader_name))]

  return (
    <div>
      {leaders.length > 0 && (
        <p style={CAPTION} data-testid="tech-report-players-leader">선두 = {leaders.join(' · ')}</p>
      )}
      <table style={TABLE} data-testid="tech-report-players">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c} scope="col" style={c === 'share' ? TH_NUM : TH}>{COL_LABEL[c]}</th>
            ))}
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

            const cellFor = {
              name: (
                <td key="name" style={TD_NAME}>
                  <div style={NAME_CELL}>
                    <div style={NAME_INNER}>
                      <span style={NAME_TEXT} data-testid="tech-report-player-name" title={p.name}>{p.name}</span>
                      {p.state_led && <span style={SHRINK0}><Badge variant="info" size="sm">정부주도</Badge></span>}
                    </div>
                    {(p.country || p.ticker || stockType) && (
                      <div style={NAME_META}>
                        {p.country && <span style={META_TEXT}>{p.country}</span>}
                        {p.country && p.ticker && <span style={META_TEXT}>·</span>}
                        {p.ticker && <span style={TICKER}>{p.ticker}</span>}
                        {stockType && (
                          <Badge variant="neutral" size="sm" style={stockType === 'holding' ? HOLD_BADGE : WATCH_BADGE}>
                            {stockType === 'holding' ? '보유' : '관심'}
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>
                </td>
              ),
              // 라벨이 없는 단계 값(스키마 드리프트)은 추정하지 않고 —
              level: <td key="level" style={TD_LEVEL}>{label ? `${p.tech_level}단계 · ${label}` : DASH}</td>,
              gap: <td key="gap" style={TD_MUTED}>{gapText}</td>,
              share: <td key="share" style={TD_NUM}>{hasShare ? `${p.share_pct}%` : DASH}</td>,
            }

            return [
              <tr key={key} data-testid="tech-report-player-row">
                {cols.map((c) => cellFor[c])}
              </tr>,
              p.note && (
                <tr key={`${key}-note`} data-testid="tech-report-player-note">
                  <td colSpan={cols.length} style={NOTE_TD}>
                    <div role="group" aria-label={`${p.name} 설명`} style={NOTE_BODY}>{p.note}</div>
                  </td>
                </tr>
              ),
            ]
          })}
        </tbody>
      </table>
    </div>
  )
}
