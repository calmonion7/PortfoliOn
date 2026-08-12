// 주요기술 리포트 상세 「계보 분류」(task#281 S4) — players[].category로 업체를 묶은 그룹 칩.
//
// props: players: [{ name, category? }]  ← 페이지가 sortPlayers로 정한 단일 순서 그대로 받는다
//
// ★ DAG·트리 SVG를 만들지 않는다 — 계보는 *묶음*이 본질이고 분류 간 방향성 관계가 없다.
//   방향 없는 관계를 화살표로 그리면 그림이 데이터에 없는 사실을 말한다(CONTEXT.md「주요기술 리포트」가
//   related의 보완·경합을 관계도가 아니라 칩 그룹으로 분리한 것과 같은 근거).
// ★ category는 선택 필드이고 기술마다 분류 체계가 다르다(로봇·배터리엔 '노형' 개념이 없다) —
//   전무하면 **섹션째 생략**한다(빈 섹션을 만들지 않는다). 루틴이 못 채우는 것이 정상 입력이다.
// ⚠️ 구발행물(현 smr·reusable-rocket 실데이터)의 players[]에는 category 키 자체가 없다(undefined).
//   신규 판은 생략 시 null로 온다 — 두 형태를 같이 흡수해야 한다.
// ⚠️ 페이지가 SectionTitle을 감싸는 게이트는 반드시 groupByCategory(players).length > 0으로 쓸 것.
//   컴포넌트의 채택 조건과 다른 식(예: players.some(p => p.category))을 쓰면 공백 문자열만 있는 판에서
//   제목만 남고 본문이 사라진다(TechReport.jsx 점유율 섹션이 같은 함정을 주석으로 못박아 뒀다).

// ⚠️ 버킷 키와 표시 라벨을 분리한다 — category는 자유 문자열이고 루틴 프롬프트도 "통용 분류를 쓰라"만
//    지시하므로 루틴이 실제로 '미분류'를 쓸 수 있다. 리터럴을 Map 키로 겸용하면 그때 분류를 못 붙인
//    버킷과 **조용히 합쳐진다**(업체 총계는 그대로라 칩 수 단언으로도 안 잡힌다, task#281 F6).
//    Symbol은 어떤 데이터 문자열과도 같아질 수 없다.
const UNCLASSIFIED = Symbol('unclassified')   // 버킷 키 — 데이터와 충돌 불가
const UNCLASSIFIED_LABEL = '미분류'            // 표시 라벨(렌더 전용)

// 분류가 하나도 없으면 [] — 그래야 컴포넌트와 페이지 게이트가 같은 판정을 공유한다.
// 분류 순서는 입력 순서(= sortPlayers 결과)를 따르고, 미분류만 항상 마지막으로 민다.
export function groupByCategory(players) {
  const list = Array.isArray(players) ? players : []
  const name = (p) => (typeof p?.category === 'string' && p.category.trim() !== '' ? p.category.trim() : null)
  if (!list.some((p) => name(p) != null)) return []

  const groups = new Map()
  for (const p of list) {
    const key = name(p) ?? UNCLASSIFIED
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(p)
  }
  // 분류 없는 업체는 버리지 않는다 — 목록에 있는데 이 섹션에서만 사라지면 업체 수가 표와 어긋난다.
  const rest = groups.get(UNCLASSIFIED)
  if (rest) { groups.delete(UNCLASSIFIED); groups.set(UNCLASSIFIED, rest) }

  return [...groups].map(([key, members]) => ({
    category: key === UNCLASSIFIED ? UNCLASSIFIED_LABEL : key,
    players: members,
  }))
}

const WRAP = { display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }
// 라벨은 자기 칩들과 붙어야 한다(축4) — 그룹 간 16px > 라벨↔칩 8px이라야 한 덩어리로 읽힌다.
const LABEL = {
  margin: '0 0 var(--space-2)',
  fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--text-3)',
}
const CHIPS = { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }
// 칩에 white-space:nowrap을 주지 않는다(축3의 정석 조합에서 의도적으로 이탈) — 여기 담기는 건
// 짧은 라벨이 아니라 업체명이고, 'CNNC (중국핵공업집단)' 같은 이름은 350px에서 칩 하나가 컨테이너를
// 넘긴다(축1). overflowWrap:break-word는 폭이 남으면 한 줄, 모자랄 때만 접히므로 어느 폭에서도
// 문자가 사라지지 않는다 — PlayerTable의 업체명 셀이 같은 이유로 같은 선택을 했다.
const CHIP = {
  padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
  overflowWrap: 'break-word', fontSize: 'var(--font-size-sm)', color: 'var(--text)',
}

export default function CategoryGroups({ players = [] }) {
  const groups = groupByCategory(players)
  if (groups.length === 0) return null

  return (
    <div style={WRAP} data-testid="tech-report-categories">
      {/* key는 라벨이 아니라 인덱스 — 루틴이 '미분류'를 쓰면 라벨이 같은 그룹이 둘이 되고(위 F6),
          라벨을 key로 쓰면 React 중복 key가 된다. 그룹 순서는 매 렌더 안정적이라 인덱스로 충분하다. */}
      {groups.map(({ category, players: members }, gi) => (
        <div key={gi} data-testid="tech-report-category-group">
          <div style={LABEL}>{category}</div>
          <div style={CHIPS}>
            {members.map((p, i) => (
              <span key={p.ticker || p.name || i} style={CHIP} data-testid="tech-report-category-chip">{p.name}</span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
