// fg-loop 정지조건 C6 하니스 — 시장지표 탭의 섹션 구성을 잰다.
//
// 왜 이 축이 따로 필요한가:
//   task#293·294·295는 시장지표 탭에 섹션을 3개 *추가*한다. 각 태스크의 uat 프로브는 자기 섹션만
//   보므로, 신규 섹션이 들어오면서 **기존 섹션을 깨뜨리는** 회귀에 원리적으로 블라인드하다.
//   이 하니스가 그 회귀 누수 축이다(fg-loop loop.md의 C6).
//
// 판정 대상의 자격(가토 ⑧ⓜ — "이 문자열이 *어떤 자격으로* 등장해야 통과인가"):
//   섹션 제목은 `marketUtils.jsx:69`의 `<span className="mkt-title">{title}</span>` 하나뿐이다.
//   그래서 `.mkt-title`의 textContent만 센다 — 본문 산문·범례에 같은 낱말이 있어도 세지 않는다.
//   범위는 `main`으로 한정한다(전역 마스트헤드·모바일 탭바 제외).
//
// 이 축이 **증명하지 않는 것**(의도된 경계 — 다른 축이 덮는다):
//   제목이 보인다 = 섹션이 렌더됐다. 그 섹션이 error 상태여도 제목은 나온다(`SectionCardError`).
//   내용 정합은 C4(라이브 데이터)·C5(uat 프로브)의 몫이다. 여기서 그것까지 재려 하면 축이 흐려진다.
//
// 판정 규율:
//   · 조건부 단언 금지 — 전부 무조건 단언. 미검출은 sentinel 기대값으로 FAIL시켜 총계를 고정한다.
//   · domain sentinel — 제목을 하나도 못 찾으면 `eq(존재목록, [])`류가 공허하게 통과한다. 하한을 건다.
//   · 커버리지 카운터 출력 — ALL PASS가 "아무것도 안 본 것"과 구별되게.
//   · SW가 /api/*를 가로채므로 컨텍스트는 serviceWorkers:'block'.
//
// 사용:
//   node scripts/loopcheck-market-sections.mjs        # 신규 3개 전부 기대(드라이브 종료 시점)
//   node scripts/loopcheck-market-sections.mjs 1      # 드라이브 중간(293만 착지한 시점)
//   node scripts/loopcheck-market-sections.mjs 0      # 배포 전 베이스라인(대조군 — 하니스가 관측 가능한지 실증)

import { chromium } from 'playwright'

const BASE = 'https://portfolion.taebro.com'
const EXPECTED_NEW = Number(process.argv[2] ?? 3)

// 2026-08-11 실측 — frontend/src/pages/Market.jsx indicators 탭(라인 23~35)의 13개 섹션.
// 제목 문자열은 각 컴포넌트의 title prop에서 직접 읽었다(추정 아님).
const EXISTING = [
  '주요 지수',
  '코스피200 선물',
  '미국 국채금리',
  '환율',
  '변동성지수 (VIX)',
  '공포·탐욕지수 (Fear & Greed)',
  '원자재',
  '경제지표 (미국)',
  '매크로 신호 (미국)',
  '코스피 방향 신호',
  'M7 vs 나머지 S&P 500 순이익',
  '삼성전자+SK하이닉스 vs KOSPI 나머지 전체 순이익',
  '한국 수출: 반도체 vs 비반도체',
]

// task#293·294·295가 추가하는 섹션(각 계획의 「완료 정의」에서 그대로).
const NEW = [
  '신규 창업 신청 (미국)',
  '고용 조사 격차 (미국)',
  '절사평균 물가 (미국)',
]

const VIEWS = [
  { name: 'pc1440', opts: { viewport: { width: 1440, height: 900 } } },
  { name: 'm390', opts: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
]

const results = []
let pass = 0
let fail = 0
const eq = (tag, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ok ? pass++ : fail++
  results.push(`${ok ? 'PASS' : 'FAIL'} ${tag}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
}

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
})
if (!login.ok) {
  console.error(`로그인 실패 ${login.status} — 하니스가 대상에 닿지 못했다. 판정 무효.`)
  process.exit(2)
}
const { access_token, refresh_token } = await login.json()

const browser = await chromium.launch()
const coverage = {}

for (const V of VIEWS) {
  const ctx = await browser.newContext({ ...V.opts, serviceWorkers: 'block' })
  await ctx.addInitScript(([a, r]) => {
    localStorage.setItem('access_token', a)
    localStorage.setItem('refresh_token', r)
    // PWA 설치 배너는 전역 프로모라 이 페이지의 레이아웃이 아니다 — 닫힌(정상) 상태로 고정.
    localStorage.setItem('pwa-install-dismissed-at', String(Date.now()))
  }, [access_token, refresh_token])

  const page = await ctx.newPage()
  await page.goto(`${BASE}/market/indicators`, { waitUntil: 'networkidle' })
  // 섹션 카드는 로딩 상태에서도 제목을 렌더한다(SectionCardLoading) → 제목 수가 안정될 때까지만 기다린다.
  await page.waitForSelector('main .mkt-title', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1500)

  const titles = await page.evaluate(() => {
    const root = document.querySelector('main')
    if (!root) return null
    return [...root.querySelectorAll('.mkt-title')].map((el) => el.textContent.trim())
  })

  // identity — 대상이 맞는가. 판정축(제목 존재)이 대상과 독립이라 엉뚱한 페이지에서도 통과할 수 있다.
  const onMarket = page.url().includes('/market/indicators')
  eq(`identity:${V.name}`, onMarket ? 'OK' : `WRONG_PAGE(${page.url()})`, 'OK')

  // domain sentinel — 제목을 못 찾으면 아래 존재 단언들이 전부 공허해진다.
  const n = titles ? titles.length : -1
  eq(`domain:${V.name}`, n >= EXISTING.length ? 'OK' : `DOMAIN_TOO_SMALL(${n})`, 'OK')

  // 기존 13종 — 무조건 단언(하나당 1건, 총계 고정).
  for (const t of EXISTING) {
    eq(`existing:${V.name}:${t}`, (titles ?? []).includes(t) ? 'present' : 'MISSING', 'present')
  }

  // 신규 3종 — 개별 실측치를 출력에 남기고, 게이트는 개수로 건다(드라이브 진행도에 따라 기대가 달라짐).
  const newPresent = NEW.filter((t) => (titles ?? []).includes(t))
  for (const t of NEW) {
    results.push(`INFO new:${V.name}:${t} = ${(titles ?? []).includes(t) ? 'present' : 'absent'}`)
  }
  eq(`new-count:${V.name}`, newPresent.length, EXPECTED_NEW)

  coverage[V.name] = { titles: n, existing_found: EXISTING.filter((t) => (titles ?? []).includes(t)).length, new_found: newPresent.length }
  await ctx.close()
}

await browser.close()

console.log(results.join('\n'))
console.log('\n── 커버리지 ──')
for (const [v, c] of Object.entries(coverage)) {
  console.log(`${v}: 제목 ${c.titles}개 · 기존 ${c.existing_found}/${EXISTING.length} · 신규 ${c.new_found}/${NEW.length}`)
}
console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAIL'} — 단언 ${pass + fail}건 (pass ${pass} · fail ${fail}) · 기대 신규 ${EXPECTED_NEW}개`)
process.exit(fail === 0 ? 0 : 1)
