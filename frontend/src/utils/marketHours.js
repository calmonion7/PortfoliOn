// 장중 자동폴링 게이팅 (Phase 3 part 1). 순수 함수 — Date를 받아 시장 개장 여부 판정.
// Intl로 타임존 wall-clock을 구해 DST(미국)까지 정확. 공휴일은 다루지 않음(요일+시간만).

function _zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date)
  const get = (t) => parts.find((p) => p.type === t)?.value
  const weekday = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[get('weekday')]
  let h = parseInt(get('hour'), 10)
  if (h === 24) h = 0 // 일부 환경은 자정을 '24'로
  return { weekday, minutes: h * 60 + parseInt(get('minute'), 10) }
}

function _openIn(timeZone, openMin, closeMin, date) {
  const { weekday, minutes } = _zonedParts(date, timeZone)
  return weekday >= 1 && weekday <= 5 && minutes >= openMin && minutes <= closeMin
}

// KR 거래시간: NXT 확장시간 외곽 08:00~20:00 KST 평일(프리 08:00~/애프터 ~20:00).
// 시세를 통합(SOR) 코드로 받으므로 확장시간에도 가격이 갱신됨 → 폴링도 그 창에서.
// (08:50~09:00:30·15:20~15:40 휴장 구간엔 값이 안 변할 뿐 폴링은 무해하게 계속.)
export function isKrMarketOpen(date = new Date()) {
  return _openIn('Asia/Seoul', 8 * 60, 20 * 60, date)
}

// US 정규장: 09:30~16:00 America/New_York 평일 (DST 자동 반영, ≈23:30~06:00 KST).
export function isUsMarketOpen(date = new Date()) {
  return _openIn('America/New_York', 9 * 60 + 30, 16 * 60, date)
}

// 어느 시장이든 열려 있나 (폴링 on/off 판단)
export function isAnyMarketOpen(date = new Date()) {
  return isKrMarketOpen(date) || isUsMarketOpen(date)
}
