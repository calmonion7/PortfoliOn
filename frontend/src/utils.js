// 표시 포매터 정본 (task#271).
// 이름에 **입력 단위**를 박는다 — 단위 오적용이 호출부에서 문법적으로 눈에 걸리게 하기 위함이다.
// (`krFmt`가 '억원' 입력 가정인 줄 모르고 주식수를 넘겨 "541.4조"가 뜨던 부류의 재발 방지.)
// 빈값은 5종 모두 '—'(em dash)로 통일.

// 절대 가격. KR=₩ 정수 locale / US=$ 소수 2자리 locale.
export const fmtPrice = (val, market) => {
  if (val == null || !Number.isFinite(Number(val))) return '—'
  if (market === 'KR') return `₩${Number(val).toLocaleString('ko-KR', { maximumFractionDigits: 0 })}`
  return `$${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// 입력 단위: USD 원단위(달러). T·B·M·K 축약, 1e3 미만은 전액.
export const fmtUsdCompact = (v) => {
  if (!v || v <= 0) return '—'
  if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${Math.round(v / 1e3)}K`
  return `$${Math.round(v).toLocaleString()}`
}

// 입력 단위: **억원**. 1조(=10000억) 이상은 '조'.
// 원(₩) 단위 값을 그대로 넘기면 1e8배 오표기 — 호출측에서 /1e8 하고 넘길 것.
export const fmtEokWon = (v) => {
  if (v == null) return '—'
  if (Math.abs(v) >= 10000) return `${(v / 10000).toFixed(1)}조`
  return `${Math.round(v).toLocaleString()}억`
}

// 입력 단위: **주(株)**, 국내. 억·만 축약. 순매도 누적이 음수라 부호를 보존한다.
export const fmtSharesKr = (v) => {
  if (v == null) return '—'
  const n = Number(v)
  const sign = n < 0 ? '-' : ''
  const a = Math.abs(n)
  if (a >= 1e8) return `${sign}${(a / 1e8).toFixed(1)}억`
  if (a >= 1e4) return `${sign}${Math.round(a / 1e4)}만`
  return `${sign}${Math.round(a)}`
}

// 입력 단위: **주(株)**, 해외. B·M·K 축약.
// 임계 비교는 **절대값**으로 한다 — 부호 있는 값(내부자 순매수/순매도 net_shares)에서
// 원값 비교를 쓰면 음수가 전 티어를 통과해 `-1,500,000,000`처럼 전액이 찍힌다(B34).
// 부호는 축약 뒤에 다시 붙인다(형제 `fmtSharesKr`과 같은 형태).
// ⚠️ 소비처(`components/reports/UsInsiderSection.jsx`)가 양수에만 '+'를 직접 붙이므로
// 여기서 넣는 부호는 '-'뿐이다 — '+'까지 넣으면 `++1.20B`로 이중 부호가 된다.
export const fmtSharesUs = (n) => {
  if (n == null) return '—'
  const v = Number(n)
  const sign = v < 0 ? '-' : ''
  const a = Math.abs(v)
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(1)}K`
  return v.toLocaleString()
}
