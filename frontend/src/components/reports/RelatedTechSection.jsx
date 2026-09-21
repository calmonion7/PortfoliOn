import { Link } from 'react-router-dom'
import useTechIndex, { techsForTicker } from '../../hooks/useTechIndex'
import { TECH_LEVEL_LABELS } from './techReportUtils'
import { SectionTitle } from './reportUtils.jsx'

// 사업분석 탭 「경쟁」 단 — 이 종목이 등장하는 주요기술 리포트로의 역방향 연결(ADR-0043·ADR `260921-091825` 결정 3).
// 기술 인덱스(`GET /api/tech-reports/index`)만 쓴다 — 추가 fetch·스키마 변경 없음.
//
// ⚠️ 3상태 규율(CLAUDE.md task#307) — 빈 배열의 의미가 셋이라 「관련 기술 없음」류 *문구*를 절대 렌더하지 않는다:
//   ⓐ `failed`(조회 실패)  → 섹션 미렌더. 「없다」가 아니라 *물어보지 못한 것*이라 문구를 쓰면 거짓 진술이 된다.
//   ⓑ 0건(조회 성공·등장 없음) → 섹션 미렌더. 이건 사실이지만 빈 섹션 제목만 남기는 것은 항해가 아니다.
//   ⓒ 1건 이상 → 기술당 한 행.
// 두 경우 모두 `null`이라 호출부는 분기할 필요가 없다. 「없음」 문구나 액션을 추가하려는 순간
// ⓐ와 ⓑ를 반드시 갈라야 한다. 옛 상세 헤더 칩은 `failed`를 쓰지 않아도 무방했는데(칩 부재는
// 아무 문구도 말하지 않으므로) 이 섹션은 제목을 가지므로 그 면제가 성립하지 않는다.
// 「경쟁」 그룹 헤더의 표시 여부를 부모(ReportDetailTabs)가 판정하려면 이 섹션이 렌더될지를
// 미리 알아야 한다 — 그래서 판정만 떼어 export한다. 훅은 모듈 캐시(`_cache`)를 쓰므로
// 부모와 자식이 함께 호출해도 네트워크 호출은 1회다(구독만 둘).
export function useRelatedTechs(ticker) {
  const { techIndex, failed } = useTechIndex()
  const techs = failed ? [] : techsForTicker(techIndex, ticker)
  return { techs, visible: !failed && techs.length > 0 }
}

export default function RelatedTechSection({ ticker }) {
  const { techs, visible } = useRelatedTechs(ticker)
  if (!visible) return null

  return (
    <div style={{ marginBottom: 20 }}>
      <SectionTitle>🔗 관련 기술</SectionTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {techs.map(t => {
          // `listed[]`는 `tickers` 순서와 항등이지만(라우터 주석) 여기서는 ticker로 직접 찾는다 —
          // 인덱스 정렬이 바뀌어도 이 행이 엉뚱한 업체의 단계를 보여주지 않게.
          const me = (t.listed || []).find(p => p.ticker === ticker)
          const level = me?.tech_level != null ? TECH_LEVEL_LABELS[me.tech_level] : null
          const gap = me?.gap_years
          return (
            <div
              key={t.slug}
              data-testid="related-tech-row"
              data-slug={t.slug}
              style={{
                display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
                fontSize: 12, color: 'var(--text-2)',
                padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 4,
                background: 'var(--bg-elev-2)',
              }}
            >
              {/* 한국어 자유 서술은 자르지 않는다 — 어절 경계로만 접고 긴 라틴 토큰만 안전망으로 끊는다
                  (frontend/CLAUDE.md task#331 B54; `anywhere`는 Safari 15.4+ 전용이라 쓰지 않는다) */}
              <span style={{ fontWeight: 700, color: 'var(--text)', wordBreak: 'keep-all', overflowWrap: 'break-word' }}>
                {t.name}
              </span>
              {level && (
                <span className="mono" style={{ color: 'var(--text-3)' }}>
                  이 종목 {level}
                  {gap != null && ` (선두 격차 ${gap}년)`}
                </span>
              )}
              {t.players_total != null && (
                <span className="mono tnum" style={{ color: 'var(--text-3)' }}>
                  참여 업체 {t.players_total}개
                </span>
              )}
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, whiteSpace: 'nowrap' }}>
                <Link to={`/tech-report/${t.slug}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>리포트 →</Link>
                <Link to={`/tech-anatomy/${t.slug}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>해부 →</Link>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
