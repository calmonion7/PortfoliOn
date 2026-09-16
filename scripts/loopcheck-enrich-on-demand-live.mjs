// fg-loop 정지조건 C6 — 온디맨드 갱신 엔드포인트 **라이브** 스모크 (ADR 260916-132605 결정 2).
//
// 부작용 0으로 설계했다: 7일 안에 enrich된(=fresh) 종목을 라이브 DB에서 골라 호출하므로
// 서버는 fire를 쏘지 않고 `{fired:false, reason:'fresh'}`만 돌려준다. 비용 $0.
//
// 판정 4축(전부 통과해야 exit 0):
//   ① 무토큰 POST → 401                     (인증 게이팅 — 면제 경로가 아니라 실제 경로로 잰다)
//   ② 유효 토큰 + fresh 종목 → 200 · fired===false · reason==='fresh'
//   ③ 유효 토큰 + 없는 종목 → 404
//   ④ 응답 JSON에 `fired`·`reason` 키가 있다 (계약 형태)
//
// 배포 창: 라우트가 아직 없으면(fresh 종목이 404·연결 거부) 최대 8분 재시도한다 — 배포 직후
// 백엔드가 Up이어도 포트가 수 분 늦게 열리는 실측(task#250) 때문이다. 재시도 소진 시 exit 1.
// 실행: node scripts/loopcheck-enrich-on-demand-live.mjs [BASE]
import { execSync } from 'node:child_process'

const BASE = process.argv[2] || 'https://portfolion.taebro.com'
const CRED = { email: 'test@portfolion.com', password: 'test1234' }
const DEADLINE = Date.now() + 8 * 60 * 1000

const psql = (sql) =>
  execSync(`docker exec portfolion-postgres-1 psql -U portfolion -d portfolion -tAc "${sql}"`, { encoding: 'utf8' }).trim()

const fresh = psql("SELECT ticker FROM tickers WHERE enriched_at > now() - interval '6 days' ORDER BY enriched_at DESC LIMIT 1")
if (!fresh) { console.log('BLOCKED: 7일 내 enrich된 종목이 없어 부작용 0 스모크를 만들 수 없다'); process.exit(2) }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(CRED) })
  if (!r.ok) throw new Error(`login ${r.status}`)
  return (await r.json()).access_token
}

let last = ''
while (Date.now() < DEADLINE) {
  try {
    const token = await login()
    const auth = { Authorization: `Bearer ${token}` }
    const anon = await fetch(`${BASE}/api/stocks/${fresh}/enrich/request`, { method: 'POST' })
    const ok = await fetch(`${BASE}/api/stocks/${fresh}/enrich/request`, { method: 'POST', headers: auth })
    if (ok.status === 404 || anon.status === 404) { last = `route 404 (미배포?) fresh=${fresh}`; await sleep(15000); continue }
    const body = await ok.json().catch(() => ({}))
    const missing = await fetch(`${BASE}/api/stocks/ZZZZNOPE/enrich/request`, { method: 'POST', headers: auth })
    const checks = [
      ['anon→401', anon.status === 401, anon.status],
      ['fresh→200', ok.status === 200, ok.status],
      ['fired===false', body.fired === false, body.fired],
      ["reason==='fresh'", body.reason === 'fresh', body.reason],
      ['missing→404', missing.status === 404, missing.status],
      ['keys fired,reason', 'fired' in body && 'reason' in body, Object.keys(body).join(',')],
    ]
    let fail = 0
    for (const [name, pass, got] of checks) { console.log(`${pass ? '✓' : '✗'} ${name} (got ${got})`); if (!pass) fail++ }
    console.log(`ticker=${fresh} · 단언 총계 ${checks.length} · FAIL ${fail}`)
    process.exit(fail ? 1 : 0)
  } catch (e) {
    last = String(e)
    await sleep(15000)
  }
}
console.log(`FAIL: 8분 내 라이브에 닿지 못했다 — ${last}`)
process.exit(1)
