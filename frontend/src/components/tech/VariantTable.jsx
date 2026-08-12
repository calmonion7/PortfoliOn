// 선도기술 리포트 상세 「계열 비교」(task#298 S1ⓐ+S2, ADR-0034) — variants[]{axis_label, options[]}를
// 축별 2열 표(계열/특징)로 렌더한다. layout 순수함수 export 패턴은 MilestoneTimeline.jsx를 따른다.
//
// 축은 최대 2개(스키마 제약)이지만 여기서 상한을 세지 않는다 — 드리프트로 더 와도 있는 만큼 그린다
// (다른 형제 레이아웃 함수도 입력 개수를 세지 않고 유효성만 본다).
//
// ⚠️ 채택 조건 = 반환값의 비어있음. 페이지 게이트가 `variantTableLayout(variants).axes.length > 0`을
// 그대로 호출한다(plan.md — 느슨한 자체 판정을 쓰면 options가 필터된 판에서 제목만 남고 본문이 사라진다,
// CategoryGroups·MilestoneTimeline과 같은 함정).
//
// 채택 규칙:
//   - axis_label이 공백뿐이면 그 축을 버린다.
//   - option은 name이 있어야 행이 된다(name 결측·공백은 그 옵션만 버린다 — 축 자체는 살 수 있다).
//   - 유효 행이 2개 미만이면 그 축을 버린다("1행 표는 비교가 아니라 서술이다").
//   - strength·tradeoff는 **한쪽만 있어도 정상 입력**이다(스키마가 최소 하나만 요구) — 레이아웃은
//     둘 다 없는 행도 버리지 않는다. "둘 다 없음"의 표시(—)는 렌더러의 몫이다.
//
// examplesText: examples[]를 ' · '로 이어 붙인 문자열. 결측·빈 배열·비배열·전부 공백/비문자열이면
// **null**(빈 문자열이 아니다 — 렌더가 구분자만 남기지 않게).

function buildRow(o) {
  const name = typeof o?.name === 'string' && o.name.trim() !== '' ? o.name : null
  if (!name) return null
  const examples = Array.isArray(o?.examples)
    ? o.examples.filter((e) => typeof e === 'string' && e.trim() !== '')
    : []
  const examplesText = examples.length > 0 ? examples.join(' · ') : null
  const strength = typeof o?.strength === 'string' && o.strength.trim() !== '' ? o.strength : null
  const tradeoff = typeof o?.tradeoff === 'string' && o.tradeoff.trim() !== '' ? o.tradeoff : null
  return { name, examplesText, strength, tradeoff }
}

function buildAxis(v) {
  const axisLabel = typeof v?.axis_label === 'string' && v.axis_label.trim() !== '' ? v.axis_label : null
  if (!axisLabel) return null
  const options = Array.isArray(v?.options) ? v.options : []
  const rows = options.map(buildRow).filter(Boolean)
  if (rows.length < 2) return null
  return { axisLabel, rows }
}

// variants(비배열·null·undefined 포함 임의 입력) → { axes: [{ axisLabel, rows }] }. 예외를 던지지 않는다.
export function variantTableLayout(variants) {
  const list = Array.isArray(variants) ? variants : []
  return { axes: list.map(buildAxis).filter(Boolean) }
}

const DASH = '—'

// 축 사이 간격(24px) > 소제목↔표 간격(8px) — 붙어야 할 것과 떨어져야 할 것을 gap/margin으로 직접
// 분리한다(가토 ⑩, "남는 공간" 정렬에 의존하지 않는다). 값은 frontend/src/styles/tokens.css 실측
// (--space-2: 8px · --space-6: 24px).
export const AXES_WRAP = { display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }
export const AXIS_LABEL = {
  margin: '0 0 var(--space-2)',
  fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--text)',
}
const TABLE = { width: '100%', borderCollapse: 'collapse' }
const TH = {
  padding: '8px 10px', textAlign: 'left',
  fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-medium)',
  color: 'var(--text-3)', borderBottom: '1px solid var(--border)',
}
const TD = {
  padding: '8px 10px', verticalAlign: 'top',
  fontSize: 'var(--font-size-sm)', color: 'var(--text)',
  borderBottom: '1px solid var(--border)',
}
// 두 열 다 overflowWrap: 'anywhere' — 'break-word'가 아니다. min-content 기여가 다르다(task#296 정정,
// PlayerTable.jsx 주석 참조): break-word는 표 자동 레이아웃의 최소폭을 줄이지 못해 스크롤러 없는 표에서
// 문서가 가로로 밀린다. minWidth·overflowX·nowrap은 이 파일 어디에도 선언하지 않는다.
export const NAME_TEXT = { overflowWrap: 'anywhere', fontWeight: 'var(--font-weight-semibold)', color: 'var(--text)' }
const EXAMPLES_TEXT = { marginTop: 2, overflowWrap: 'anywhere', fontSize: 'var(--font-size-xs)', color: 'var(--text-3)' }
const FEATURE_LINE = { overflowWrap: 'anywhere' }
const STRENGTH_LINE = { ...FEATURE_LINE, color: 'var(--text)' }
const TRADEOFF_LINE = { ...FEATURE_LINE, marginTop: 2, color: 'var(--text-2)' }

export default function VariantTable({ variants }) {
  const { axes } = variantTableLayout(variants)
  if (axes.length === 0) return null

  return (
    <div style={AXES_WRAP} data-testid="tech-report-variants">
      {axes.map((axis, ai) => (
        <div key={`${ai}-${axis.axisLabel}`} data-testid="tech-report-variant-axis">
          <div style={AXIS_LABEL}>{axis.axisLabel}</div>
          <table style={TABLE} data-testid="tech-report-variant-table">
            <thead>
              <tr>
                <th scope="col" style={TH}>계열</th>
                <th scope="col" style={TH}>특징</th>
              </tr>
            </thead>
            <tbody>
              {axis.rows.map((row, ri) => (
                <tr key={`${ri}-${row.name}`} data-testid="tech-report-variant-row">
                  <td style={TD}>
                    <div style={NAME_TEXT} data-testid="tech-report-variant-name">{row.name}</div>
                    {row.examplesText && (
                      <div style={EXAMPLES_TEXT} data-testid="tech-report-variant-examples">{row.examplesText}</div>
                    )}
                  </td>
                  <td style={TD} data-testid="tech-report-variant-feature">
                    {row.strength && <div style={STRENGTH_LINE}>+ {row.strength}</div>}
                    {row.tradeoff && <div style={TRADEOFF_LINE}>− {row.tradeoff}</div>}
                    {!row.strength && !row.tradeoff && DASH}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
