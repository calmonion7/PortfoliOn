import { parseDescriptionSections } from '../reports/techReportUtils'

// 선도기술 리포트 상세(ADR-0033, task#280 S4) — description 산문을 대괄호 헤딩 기준으로 소제목 승격 +
// 섹션별 접기. 순수 표시 컴포넌트(fetch 없음).
// props: description(report.description) · rationale(report.difficulty?.rationale)
//
// eco: 접기는 네이티브 <details>/<summary>다 — JS 상태 0, 키보드·스크린리더·Ctrl+F 검색이 전부 공짜고
// 닫힌 섹션의 텍스트도 DOM에 남는다(정보 손실 0의 절반이 플랫폼에서 온다).
// 첫 소제목 섹션만 open으로 시작 — 나머지는 접혀 소제목들이 목차로 읽힌다.
//
// ⚠️ 정보 손실 0이 절대 조건이다(대괄호 규약은 데이터 계약이 아니라 루틴의 자발적 습관이므로
// 파싱 실패가 정상 입력이다). 그래서 ① 소제목 없는 선행 문단은 접지 않고 항상 보이는 <p>로 남기고
// ② 파서가 0섹션을 주면 전문을 되살린다.

// 재사용 인라인 스타일 — 색은 항상 토큰 참조(하드코딩 hex 0). 본문 폰트·행간은 기존 산문 렌더와 동일.
export const PROSE_BODY = {
  color: 'var(--text-2, var(--text))',
  fontSize: 13,
  lineHeight: 1.75,
  whiteSpace: 'pre-wrap', // 원문 줄바꿈 보존 — 지우면 문단 구분이 통째 사라진다
  margin: '2px 0 12px',
}

export const PROSE_SUMMARY = {
  cursor: 'pointer',
  fontFamily: 'var(--font-serif)',
  fontSize: 14,
  fontWeight: 700,
  color: 'var(--text)',
  padding: '10px 0',
}

const ITEM = { borderBottom: '1px solid var(--border)' }

export default function ProseSections({ description, rationale }) {
  const parsed = parseDescriptionSections(description)
  // 손실 0 안전망: 산문이 있는데 파서가 0섹션을 주면 전문을 단일 섹션으로 되살린다.
  const hasProse = typeof description === 'string' && description.trim() !== ''
  const sections = parsed.length === 0 && hasProse ? [{ title: null, body: description }] : parsed

  const items = [...sections]
  if (typeof rationale === 'string' && rationale.trim() !== '') {
    items.push({ title: '기술난이도 근거', body: rationale.trim() })
  }
  if (items.length === 0) return null

  const firstTitled = items.findIndex((s) => s.title != null)

  return (
    <div data-testid="tech-report-prose">
      {items.map((s, i) => (s.title == null ? (
        // 소제목이 없으면 접을 라벨도 없다 — 접으면 목차도 못 되고 내용만 숨는다.
        <p key={i} data-testid="tech-prose-plain" style={PROSE_BODY}>{s.body}</p>
      ) : (
        <details key={i} data-testid="tech-prose-section" open={i === firstTitled} style={ITEM}>
          <summary style={PROSE_SUMMARY}>{s.title}</summary>
          <p style={PROSE_BODY}>{s.body}</p>
        </details>
      )))}
    </div>
  )
}
