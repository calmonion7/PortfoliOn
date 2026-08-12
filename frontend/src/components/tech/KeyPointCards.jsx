import Card from '../ui/Card'
import { SectionTitle } from '../reports/reportUtils.jsx'

// 주요기술 리포트 핵심 포인트 카드(ADR-0033, task#281 S2) — 지금까지 description 산문에만 있던
// 결론을 발행 필드 key_points[]{title, metrics[≤4]{label,value,change_pct?}, body}로 받아 렌더한다.
// AnalystReport.jsx의 「투자 포인트」 블록을 그대로 미러링한다(task#218 "한눈 구조화"의 원형).
// 순수 표시 컴포넌트 — fetch 0, 산문 요약·추출 0(루틴이 쓴 것만 표시한다, wrong < missing).
//
// ⚠️ 구발행물(라이브 smr·reusable-rocket 2건)은 이 컬럼이 SQL NULL이라 응답에 `key_points: null`,
//    metrics 생략도 `null`(빈 배열 아님)로 온다 — 배열 자리의 null에 .map/.length를 직접 부르면
//    섹션이 아니라 페이지가 통째로 터진다. 정규화 한 줄로 흡수한다.
//
// ⚠️ SectionTitle과 바깥 여백을 이 컴포넌트가 **함께 소유**한다. 데이터가 없으면 섹션째 사라져야
//    하는데(제목만 남은 유령 섹션 금지), 페이지가 <div style={{marginBottom:30}}>로 감싸면 null을
//    반환해도 그 래퍼의 여백이 남아 30px 유령 간격이 생긴다 → 페이지에선 래퍼 없이 그대로 둘 것.

// 재사용 인라인 상수 — 색은 항상 토큰 참조(하드코딩 hex 0). AnalystReport의 numeralStyle과 동형.
export const KP_NUMERAL = {
  fontFamily: 'var(--font-serif)', fontSize: 26, fontWeight: 700, lineHeight: 1,
  color: 'var(--accent)', opacity: 0.85, flexShrink: 0, width: 38,
}

export const KP_CHIP = { background: 'var(--bg-elev-2)', borderRadius: 6, padding: '6px 8px' }

// 증감 값 표기 — 부호는 화살표가 대신하므로 값은 항상 |v|다(정본 `ui/Badge.jsx` ChangeBadge와 같은 계약:
// `▼ 12.5%`). 세 자리 이상만 반올림해 소수 꼬리를 자르고, 그 미만은 정본대로 소수 1자리로 고정한다.
// ⚠️ AnalystReport.jsx 투자 포인트 칩과 **같은 식**이다(이 컴포넌트가 그 블록의 미러) — 한쪽만 고치면
//    두 표면 표기가 갈라진다. 양쪽에 같은 케이스의 회귀 테스트가 쌍으로 있다(task#281 F5).
export const fmtChangePct = (v) =>
  (Math.abs(v) >= 100 ? String(Math.round(Math.abs(v))) : Math.abs(v).toFixed(1))

export default function KeyPointCards({ points, sectionId }) {  // points: report.key_points (null·undefined 허용) · sectionId: 목차 앵커(task#296 S4, 페이지가 준다)
  const list = Array.isArray(points) ? points : []
  if (list.length === 0) return null   // 구발행물 graceful — 제목까지 포함해 섹션째 생략

  return (
    <div id={sectionId} data-tech-section={sectionId} data-testid="tech-key-points" style={{ marginBottom: 30 }}>
      <SectionTitle>핵심 포인트</SectionTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {list.map((p, i) => {
          const chips = Array.isArray(p.metrics) ? p.metrics : []
          return (
            <Card key={i} padding="md" data-testid="tech-key-point">
              {/* 번호는 좌측 컬럼이 아니라 제목 행에 인라인 — 컬럼으로 두면 38+gap12=50px이 카드
                  전체 높이에 걸쳐 칩 그리드 폭까지 좁힌다(task#225 실측 295→237px). */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
                <span className="tnum" style={KP_NUMERAL}>{String(i + 1).padStart(2, '0')}</span>
                <div style={{ color: 'var(--text)', fontWeight: 700, fontSize: 14, minWidth: 0 }}>{p.title}</div>
              </div>
              <div style={{ minWidth: 0 }}>
                {chips.length > 0 && (
                  // 열 수는 칩 수에 맞춘다 — ≤3개는 1행, 4개는 2열 2행. 높이 동인은 열 수가 아니라
                  // 칩 내부 줄바꿈이라, 4개를 3열(트랙 91px)로 깔면 label·값이 접혀 칩이 45→94px로
                  // 오히려 커진다(task#225 실측: 카드 384→431px). 열을 늘리면 압축된다는 직관에는
                  // 역전 지점이 있다.
                  <div data-testid="tech-key-point-chips"
                       style={{ display: 'grid', gridTemplateColumns: `repeat(${chips.length <= 3 ? chips.length : 2}, minmax(0, 1fr))`, gap: 8, marginBottom: 10 }}>
                    {chips.map((m, j) => (
                      <div key={j} style={KP_CHIP}>
                        <div style={{ color: 'var(--text-3)', fontSize: 10, marginBottom: 3, lineHeight: 1.3 }}>{m.label}</div>
                        <div className="mono tnum" style={{ color: 'var(--text)', fontWeight: 700, fontSize: 15, lineHeight: 1.15 }}>{m.value}</div>
                        {/* 증감은 `0`도 유효값이라 `!= null`로 분기한다(`if (change_pct)`는 0을 삼킨다).
                            색은 전역 유틸 클래스 `.up`/`.down`(styles/tokens.css)만 쓴다 — CSS에 실재하는
                            이름이어야 한다(없는 이름을 조립하면 아무도 죽지 않고 색만 조용히 사라진다).
                            수치 증감 방향은 심층 리포트 지표 칩과 같은 계약이며, 의미 상태(성공·경고)에는
                            이 토큰을 쓰지 않는다. 0은 미러대로 상승 취급(`>= 0`).
                            값 표기는 fmtChangePct — 부호는 화살표가 대신한다(이중 부호 금지). */}
                        {m.change_pct != null && (
                          <div data-testid="tech-key-point-change"
                               className={`mono tnum ${m.change_pct >= 0 ? 'up' : 'down'}`}
                               style={{ fontSize: 11, marginTop: 2 }}>
                            {m.change_pct >= 0 ? '▲+' : '▼'}{fmtChangePct(m.change_pct)}%
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <p style={{ color: 'var(--text-2, var(--text))', fontSize: 13, lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap' }}>{p.body}</p>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
