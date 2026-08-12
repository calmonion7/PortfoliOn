import { parseDescriptionSections } from '../reports/techReportUtils'

// 주요기술 리포트 상세(ADR-0033) — description 산문을 대괄호 헤딩 기준으로 소제목 분해 + 문단별 렌더.
// 순수 표시 컴포넌트(fetch 없음). props: description(report.description) · rationale(report.difficulty?.rationale)
//
// task#296 S2: task#280 S4의 <details>/<summary> 섹션별 접기를 제거했다 — 사용자 결정(스크롤만으로
// 전문을 읽고, 리드 문단 밑 정적 전역 목차가 항해를 대신한다). 소제목은 항상 보이는 <h3>로, 본문은
// \n\n 기준 문단별 <p>로 렌더한다. 섹션 래퍼는 앵커 계약(id + data-tech-anchor, task#296 구조
// 계약)을 함께 지닌다 — scroll-margin-top은 이 속성을 타는 전역 CSS(다른 슬라이스 소유)가 매긴다.
//
// ⚠️ 정보 손실 0이 절대 조건이다(대괄호 규약은 데이터 계약이 아니라 루틴의 자발적 습관이므로
// 파싱 실패가 정상 입력이다). 그래서 ① 소제목 없는 선행 문단은 항상 보이는 <p>로 남기고
// ② 파서가 0섹션을 주면 전문을 되살린다.

// 재사용 인라인 스타일 — 색은 항상 토큰 참조(하드코딩 hex 0). 본문 폰트·행간은 기존 산문 렌더와 동일.
export const PROSE_BODY = {
  color: 'var(--text-2, var(--text))',
  fontSize: 13,
  lineHeight: 1.75,
  whiteSpace: 'pre-wrap', // 문단 *안* 줄바꿈 보존 — 지우면 문단 내부 개행이 사라진다
  margin: '2px 0 12px',
}

const HEADING = {
  fontFamily: 'var(--font-serif)',
  fontSize: 14,
  fontWeight: 700,
  color: 'var(--text)',
  margin: '10px 0 0',
}

const ITEM = { borderBottom: '1px solid var(--border)' }

// 소제목에서 유일 id 파생 — letter로 시작(CSS 셀렉터·href 안전), 한글은 CSS ident에서 unescape로
// 허용되므로 그대로 남긴다. 인덱스를 앞에 섞어 동일 소제목(중복)에서도 id가 충돌하지 않게 한다.
function sectionId(title, i) {
  const base = String(title).trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')
  return `tech-h-${i}${base ? '-' + base : ''}`
}

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

  return (
    <div data-testid="tech-report-prose">
      {items.map((s, i) => {
        if (s.title == null) {
          // 소제목이 없으면 목차 앵커도 없다 — 항상 보이는 문단으로만 남는다.
          return <p key={i} data-testid="tech-prose-plain" style={PROSE_BODY}>{s.body}</p>
        }
        const id = sectionId(s.title, i)
        return (
          <div key={i} id={id} data-tech-anchor={id} data-testid="tech-prose-section" style={ITEM}>
            <h3 style={HEADING}>{s.title}</h3>
            {/* 공백만 남는 조각은 버린다(적대 리뷰 렌즈1 발견 4) — `P1\n\n   \n\nP2`처럼 빈 줄에
                공백이 끼면 pre-wrap <p>가 자기 margin(2px 0 12px)을 갖고 렌더돼 설명 없는 유령 문단이
                된다. 글자를 지우는 게 아니라 공백만 버리므로 문자 손실 0은 그대로다(split이 이미
                구분자 `\n\n`를 버리는 것과 같은 성질). */}
            {s.body.split(/\n{2,}/).filter((para) => para.trim() !== '').map((para, pi) => (
              <p key={pi} style={PROSE_BODY}>{para}</p>
            ))}
          </div>
        )
      })}
    </div>
  )
}
