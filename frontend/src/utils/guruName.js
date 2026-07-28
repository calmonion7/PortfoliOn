// 구루 매니저의 `name`은 "운용역 - 펀드" 또는 "펀드" 두 형태다(83명 전수 확인, task#236).
// 백엔드 `firm`은 71명이 name과 완전히 같고 12명은 소개글 전문(최대 7430자)이 붙어 있어
// 표시에 쓰지 않는다 — 표기는 `name` 하나에서 파생한다.
export function splitManagerName(name) {
  const s = (name || '').trim()
  const i = s.indexOf(' - ')
  if (i < 0) return { person: null, fund: s }
  const person = s.slice(0, i).trim()
  const fund = s.slice(i + 3).trim()
  // eco: 한쪽이 비면 분리 실패로 보고 전체를 펀드명으로 — 빈 부제 줄 방지
  if (!person || !fund) return { person: null, fund: s }
  return { person, fund }
}
