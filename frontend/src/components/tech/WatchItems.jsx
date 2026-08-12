import Card from '../ui/Card'

// 선도기술 리포트 상세 「확인할 지표」(ADR-0034 Amendment task#297·298 S3) — 앞으로 무엇이 관측되면
// 진척으로 인정하는가를 미리 못 박은 판정 신호를 번호 체크리스트로 렌더한다.
// 순수 표시 컴포넌트 — fetch 0, 산문 추출 0(루틴이 쓴 것만 표시한다, wrong < missing).
//
// ⚠️ 「해결해야 할 난제」(challenges)와 담는 사실이 다르다 — 난제는 *지금 무엇이 안 풀렸나*(기술 관문),
// 확인할 지표는 *무엇을 지켜보면 풀렸는지 아는가*(관측 신호)다. 그래서 두 섹션이 병존한다.
//
// ⚠️ 항목마다 짝으로 오는 **오독 경고**(`not_signal`)가 이 섹션의 핵심이다 — 파일럿 라인 준공·샘플
// 공개·양산 목표 재확인·캐파 발표는 *일정이 유지된다*는 신호일 뿐 진척이 아닌데, 그걸 진척으로 읽는
// 것이 이 섹터들의 대표적 오독이다. 그래서 본문과 **시각적으로 분리**해 기록한다.
//
// 색 규율: `not_signal`은 **의미 상태**이므로 `--warn`/`--warn-soft`(오커, 양 테마 모두 정의됨)만 쓴다.
// `--up`/`--down`은 **가격 방향 전용**이라 여기 쓰면 안 된다(이 저장소에서 그 교차 사용이 차단급
// 회귀를 낸 전례가 있다). 클래스 접미사를 문자열로 조립하지도 않는다 — CSS에 없는 이름을 만들면
// 아무도 죽지 않고 색만 조용히 사라진다. 토큰을 인라인으로 직접 참조한다.

// 번호는 좌측 컬럼이 아니라 제목 행에 인라인으로 둔다 — 컬럼으로 두면 그 폭(38 + gap)이 카드 전체
// 높이에 걸쳐 본문 폭까지 좁힌다(KeyPointCards가 task#225 실측으로 못박은 교훈을 승계).
export const WI_NUMERAL = {
  fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 700, lineHeight: 1,
  color: 'var(--accent)', opacity: 0.85, flexShrink: 0,
}

export const WI_LABEL = { color: 'var(--text)', fontWeight: 700, fontSize: 14, minWidth: 0, overflowWrap: 'anywhere' }
const WI_DETAIL = {
  margin: '6px 0 0', color: 'var(--text-2, var(--text))', fontSize: 13, lineHeight: 1.7,
  whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
}

// 「신호 아님」 블록 — 라벨 배지 + 본문. 배지만 nowrap(1줄 유지)이고 본문은 접히게 둔다.
const WI_NOT_SIGNAL_WRAP = {
  display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)', flexWrap: 'wrap',
  marginTop: 8, padding: '6px 8px', borderRadius: 6, background: 'var(--warn-soft)',
}
export const WI_NOT_SIGNAL_BADGE = {
  flexShrink: 0, whiteSpace: 'nowrap',
  fontSize: 'var(--font-size-xs)', fontWeight: 700, color: 'var(--warn)',
}
export const WI_NOT_SIGNAL_TEXT = {
  minWidth: 0, overflowWrap: 'anywhere',
  fontSize: 13, lineHeight: 1.6, color: 'var(--warn)',
}

// items[].label이 비면 그 항목을 버린다 — 라벨 없는 카드는 번호만 남는다.
// **채택 조건이 곧 items의 비어있음**이어야 한다: 페이지 게이트가 이 함수를 그대로 호출하므로,
// 여기서 버린 항목을 페이지가 다르게 세면 제목만 남고 본문이 사라진다(같은 필드의 두 얼굴 금지).
export function watchItemsLayout(watchItems) {
  const list = Array.isArray(watchItems) ? watchItems : []
  const str = (v) => (typeof v === 'string' && v.trim() !== '' ? v : null)
  const items = []
  for (const w of list) {
    const label = str(w?.label)
    if (label == null) continue
    items.push({ label, detail: str(w?.detail), notSignal: str(w?.not_signal) })
  }
  return { items }
}

export default function WatchItems({ watchItems }) {
  const { items } = watchItemsLayout(watchItems)
  if (items.length === 0) return null   // 데이터 없으면 섹션째 생략(제목은 페이지가 소유한다)

  return (
    <div data-testid="tech-report-watch-items" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map((it, i) => (
        // key는 인덱스 + label 조합 — label만 쓰면 중복 라벨에서 key가 충돌한다(CategoryGroups가
        // 같은 함정을 주석으로 못박아 뒀다).
        <Card key={`${i}-${it.label}`} padding="md" data-testid="tech-report-watch-item">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span className="tnum" style={WI_NUMERAL}>{String(i + 1).padStart(2, '0')}</span>
            <div style={WI_LABEL} data-testid="tech-report-watch-item-label">{it.label}</div>
          </div>
          {it.detail && <p style={WI_DETAIL}>{it.detail}</p>}
          {it.notSignal && (
            <div style={WI_NOT_SIGNAL_WRAP}>
              <span style={WI_NOT_SIGNAL_BADGE} data-testid="tech-report-watch-item-not-signal-badge">
                신호 아님
              </span>
              <span style={WI_NOT_SIGNAL_TEXT} data-testid="tech-report-watch-item-not-signal-text">
                {it.notSignal}
              </span>
            </div>
          )}
        </Card>
      ))}
    </div>
  )
}
