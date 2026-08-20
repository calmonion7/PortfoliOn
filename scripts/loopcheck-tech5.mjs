#!/usr/bin/env node
/**
 * fg-loop 정지조건 체크 — 주요기술 리포트 백로그 5건 완주
 * (task#313 필드보존 · #311 발행검증 · #314 광물충전 · #315 해부교차 · #316 탭타깃).
 *
 * ⚠️ 기대표(BASELINE·MEMBERS·NEW9)는 **드라이브 시작 시점 실측을 독립 하드코딩**한다 —
 *    구현에서 파생하면 자기참조라 무엇을 검증하는지 사라진다(loopcheck-tech15.mjs 선례).
 *
 * 사용: node scripts/loopcheck-tech5.mjs            (전체)
 *       node scripts/loopcheck-tech5.mjs C4 C8      (일부)
 *       node scripts/loopcheck-tech5.mjs --no-slow  (C7 프로브 제외 — 중간 점검용)
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { execSync } from 'node:child_process'

const BASE = 'https://portfolion.taebro.com'
const CRED = { email: 'test@portfolion.com', password: 'test1234' }
const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '')

// ── 드라이브 시작 baseline (2026-08-20 실측) ─────────────────────────────────
const PYTEST_FLOOR = 1722
const VITEST_FLOOR = 695

const MEMBERS = [
  'tech-report-field-preservation',      // task#313
  'key-tech-topics-expand-2of2',         // task#311
  'mineral-producers-partial-fill',      // task#314
  'tech-anatomy-holdings-crossing',      // task#315
  'tech-list-tap-targets-and-card-hit-area', // task#316
]

// ADR-0044 결정 1 — 신규 9종
const NEW9 = ['autonomous-driving', 'space-comms', 'quantum-computing', 'nuclear-fusion',
  'solar-pv', 'semiconductor-equipment', 'on-device-ai', 'obesity-drugs', 'unmanned-defense']

/** 라이브 7종의 필드 수치 baseline — 재발행이 조용히 지우면 감소로 드러난다(task#313의 방어 대상). */
const SNAP = {
  'semiconductor-equipment': { desc_len: 2153, players: 20, challenges: 4, key_points: 4, milestones: 8, variants: 2, watch_items: 5, tech: 6, minerals: 6, experts: 5, producers: 0, published_date: '2026-08-20' },
  'ai-datacenter-equipment': { desc_len: 2651, players: 25, challenges: 4, key_points: 4, milestones: 12, variants: 2, watch_items: 5, tech: 5, minerals: 5, experts: 4, producers: 0, published_date: '2026-08-13' },
  'ai-datacenter-ops': { desc_len: 2944, players: 22, challenges: 4, key_points: 4, milestones: 15, variants: 2, watch_items: 5, tech: 4, minerals: 0, experts: 4, producers: 0, published_date: '2026-08-13' },
  'reusable-rocket': { desc_len: 2676, players: 9, challenges: 4, key_points: 4, milestones: 21, variants: 2, watch_items: 5, tech: 5, minerals: 4, experts: 4, producers: 0, published_date: '2026-08-12' },
  robotics: { desc_len: 3465, players: 13, challenges: 4, key_points: 4, milestones: 21, variants: 2, watch_items: 5, tech: 4, minerals: 5, experts: 4, producers: 0, published_date: '2026-08-12' },
  smr: { desc_len: 2895, players: 11, challenges: 4, key_points: 4, milestones: 23, variants: 2, watch_items: 5, tech: 4, minerals: 5, experts: 4, producers: 0, published_date: '2026-08-12' },
  'solid-state-battery': { desc_len: 2749, players: 12, challenges: 4, key_points: 4, milestones: 23, variants: 2, watch_items: 5, tech: 5, minerals: 5, experts: 4, producers: 9, published_date: '2026-08-12' },
}
const SNAP_FIELDS = ['desc_len', 'players', 'challenges', 'key_points', 'milestones', 'variants', 'watch_items', 'tech', 'minerals', 'experts', 'producers']

/** 프로브 baseline. clean=exit 0 기대 · noisy=선재 FAIL 보유(신규 FAIL 축 0 + PASS 하한). */
const PROBES_CLEAN = { 'uat-tech-anatomy': 235, 'uat296-tech-outline': 624, 'uat299-tech-rename': 199, 'uat301-datacenter-split': 121 }
const PROBES_NOISY = { 'uat280-tech-report': { passFloor: 1074, failAxes: ['clip', 'kpi-visible'], failCount: 19 } }

// ── 하니스 ───────────────────────────────────────────────────────────────────
const results = []
const rec = (id, ok, evidence) => results.push({ id, ok, evidence })
const argv = process.argv.slice(2)
const NO_SLOW = argv.includes('--no-slow')
const sel = argv.filter((a) => /^C\d$/.test(a))
const want = (id) => (sel.length === 0 || sel.includes(id)) && !(NO_SLOW && id === 'C7')

const sh = (cmd, opts = {}) => execSync(cmd, { encoding: 'utf8', cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], ...opts })
const shSoft = (cmd, opts = {}) => { try { return sh(cmd, opts) } catch (e) { return `${e.stdout || ''}${e.stderr || ''}` } }

async function auth() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(CRED),
  })
  const { access_token } = await r.json()
  if (!access_token) throw new Error('로그인 실패 — access_token 없음')
  return { Authorization: `Bearer ${access_token}` }
}
const apiKey = () => {
  const m = readFileSync(`${ROOT}/backend/.env.docker`, 'utf8').match(/^COWORK_API_KEY=(.*)$/m)
  if (!m || !m[1].trim()) throw new Error('COWORK_API_KEY 없음')
  return m[1].trim()   // 값은 어떤 출력에도 싣지 않는다
}
const reportsOf = async (AUTH) => (await (await fetch(`${BASE}/api/tech-reports`, { headers: AUTH })).json()).reports || []
const countMin = (c) => (c?.minerals || []).reduce((s, m) => s + (m.producers || []).length, 0)
const countPct = (c) => (c?.minerals || []).reduce((s, m) => s + (m.producers || []).filter((p) => p.share_pct != null).length, 0)

// ── C1. 멤버 5건 완주 ────────────────────────────────────────────────────────
if (want('C1')) {
  const done = existsSync(`${ROOT}/.forge/done`) ? readdirSync(`${ROOT}/.forge/done`) : []
  const backlog = existsSync(`${ROOT}/.forge/backlog`) ? readdirSync(`${ROOT}/.forge/backlog`) : []
  const sealed = MEMBERS.filter((s) => done.some((d) => d.endsWith(`-${s}`)))
  const waiting = MEMBERS.filter((s) => backlog.includes(`${s}.md`))
  rec('C1', sealed.length === MEMBERS.length && waiting.length === 0,
    `봉인 ${sealed.length}/${MEMBERS.length}${waiting.length ? ` · 백로그 잔존 ${waiting.length}건 [${waiting.join(',')}]` : ' · 백로그 잔존 0'}`)
}

// ── C2. 백엔드 회귀 ──────────────────────────────────────────────────────────
if (want('C2')) {
  const out = shSoft('.venv/bin/python -m pytest -q 2>&1 | tail -4', { cwd: `${ROOT}/backend`, shell: '/bin/bash' })
  const p = out.match(/(\d+) passed/), f = out.match(/(\d+) failed/), e = out.match(/(\d+) error/)
  const passed = p ? +p[1] : -1, failed = f ? +f[1] : 0, errors = e ? +e[1] : 0
  const dirty = shSoft("git status --porcelain | grep -v '^??' || true", { shell: '/bin/bash' }).trim()
  rec('C2', passed >= PYTEST_FLOOR && failed === 0 && errors === 0 && dirty === '',
    `passed=${passed}(하한 ${PYTEST_FLOOR}) failed=${failed} errors=${errors} · 부수효과 ${dirty ? dirty.split('\n').length + '건: ' + dirty.split('\n').slice(0, 3).join(' | ') : '0'}`)
}

// ── C3. 프론트 회귀 ──────────────────────────────────────────────────────────
if (want('C3')) {
  const out = shSoft('npx vitest run --reporter=dot 2>&1 | tail -8', { cwd: `${ROOT}/frontend`, shell: '/bin/bash' })
  const m = out.match(/Tests\s+(\d+) passed/), fm = out.match(/(\d+) failed/)
  const passed = m ? +m[1] : -1, failed = fm ? +fm[1] : 0
  rec('C3', passed >= VITEST_FLOOR && failed === 0,
    `passed=${passed}(하한 ${VITEST_FLOOR}) failed=${failed}`)
}

// ── C4. task#313 라이브 계약 — 배포된 검증기 직접 프로브(쓰기 위험 0) ─────────
// ⚠️ 설계 이력: 처음엔 라이브 POST로 422를 재려 했는데 두 함정이 겹쳤다 —
//    ① `SlugPath = Literal[_SLUGS]`라 미등록 slug는 **본문 검증 전에** 422가 난다(needle이 안 나온다)
//    ② 실제 slug를 쓰면 313 배포 *전에는* 그 페이로드가 **유효**해서(description·players가 선택 필드)
//       진짜 리포트를 stub으로 **클로버**한다. 즉 체크가 데이터를 파괴할 설계였다.
//    → 컨테이너 안에서 `TechReportIn`을 직접 호출한다. 같은 배포 코드를 재고 쓰기 경로가 아예 없다.
if (want('C4')) {
  try {
    const PY = [
      'from routers.tech_reports import TechReportIn',
      'BASE={"published_date":"2026-01-01","title":"probe","difficulty":{"score":3,"rationale":"r"},"market":{"as_of":"2026-01-01"},"sources":[{"title":"s"}]}',
      'P=[{"name":"있는업체","country":"US","state_led":False,"tech_level":3}]',
      'T=[{"name":"기술-가","share_pct":40,"rationale":"r"},{"name":"기술-나","share_pct":35,"rationale":"r"},{"name":"기술-다","share_pct":25,"rationale":"r"}]',
      'M=lambda u:[{"name":"광물-가","share_pct":40,"rationale":"r","used_in":u},{"name":"광물-나","share_pct":35,"rationale":"r"},{"name":"광물-다","share_pct":25,"rationale":"r"}]',
      'def probe(l,b):',
      '    try:',
      '        TechReportIn(**b); print(l+"\\tNO_ERROR")',
      '    except Exception as e:',
      '        print(l+"\\tERROR\\t"+" ".join(str(e).split())[:400])',
      'probe("A",{**BASE,"players":P,"composition":{"tech":T,"minerals":M(["없는기술-XYZ"])}})',
      'probe("B",{**BASE,"players":P,"composition":{"tech":[{**T[0],"leaders":["없는업체-XYZ"]},T[1],T[2]]}})',
      'probe("C",{**BASE,"players":P,"composition":{"tech":[{**T[0],"leaders":["있는업체"]},T[1],T[2]],"minerals":M(["기술-가"])}})',
    ].join('\n')
    const out = shSoft(`docker exec -i portfolion-backend-1 python - <<'PYEOF'\n${PY}\nPYEOF`, { shell: '/bin/bash' })
    const line = (k) => (out.split('\n').find((l) => l.startsWith(k + '\t')) || '').slice(k.length + 1)
    const A = line('A'), B = line('B'), C = line('C')
    const bad = []
    // ⓐ used_in dangling → 반드시 거부 + 그 이름이 메시지에 실린다 (313이 추가하는 검증)
    if (!A.startsWith('ERROR')) bad.push(`ⓐ used_in dangling이 통과했다(${A || 'no output'}) — 검증 미배포`)
    else if (!A.includes('없는기술-XYZ')) bad.push('ⓐ 거부됐지만 메시지에 「없는기술-XYZ」 없음 — 다른 이유로 거부됐다')
    // ⓑ leaders dangling → 기존 검증의 회귀 가드
    if (!B.startsWith('ERROR')) bad.push(`ⓑ leaders dangling이 통과했다(${B || 'no output'}) — 기존 검증 회귀`)
    else if (!B.includes('없는업체-XYZ')) bad.push('ⓑ 거부됐지만 메시지에 「없는업체-XYZ」 없음')
    // ⓒ 대조군 — 유효 페이로드는 통과해야 한다(계측기가 전부 거부하는 것이 아님을 증명)
    if (!C.startsWith('NO_ERROR')) bad.push(`ⓒ 대조군(유효 페이로드)이 거부됐다 — 프로브가 고장났거나 계약이 바뀌었다: ${C.slice(0, 160)}`)
    // ⓓ 라이브 HTTP 경로 생존 — 빈 본문은 필수필드 누락으로 422이고 쓰기가 없다
    let http = 'skip'
    try {
      const K = apiKey()
      const r = await fetch(`${BASE}/api/tech-reports/smr`, {
        method: 'POST', headers: { 'X-API-Key': K, 'Content-Type': 'application/json' }, body: '{}',
      })
      http = String(r.status)
      const t = await r.text()
      if (r.status !== 422) bad.push(`ⓓ 빈 본문 POST가 ${r.status}(422 기대 — 403이면 인증, 500이면 서버)`)
      else if (!t.includes('published_date')) bad.push('ⓓ 422지만 필수필드 누락 사유가 아니다')
    } catch (e) { bad.push(`ⓓ 실행 실패: ${e.message}`) }
    rec('C4', bad.length === 0,
      `ⓐ used_in=${A.split('\t')[0] || 'n/a'} ⓑ leaders=${B.split('\t')[0] || 'n/a'} ⓒ 대조군=${C.split('\t')[0] || 'n/a'} ⓓ http=${http}` +
      (bad.length ? ` · 위반: ${bad.join(' | ')}` : ''))
  } catch (e) { rec('C4', false, `실행 실패: ${e.message}`) }
}

// ── C5. 데이터 무손실 ────────────────────────────────────────────────────────
if (want('C5')) {
  try {
    const AUTH = await auth()
    const reps = await reportsOf(AUTH)
    const bad = []; const exempt = []
    for (const [slug, want_] of Object.entries(SNAP)) {
      const x = reps.find((r) => r.slug === slug)
      if (!x) { bad.push(`${slug}: 라이브에서 사라짐`); continue }
      if (x.published_date > want_.published_date) { exempt.push(`${slug}(${want_.published_date}→${x.published_date})`); continue }
      const got = {
        desc_len: (x.description || '').length, players: (x.players || []).length, challenges: (x.challenges || []).length,
        key_points: (x.key_points || []).length, milestones: (x.milestones || []).length, variants: (x.variants || []).length,
        watch_items: (x.watch_items || []).length, tech: x.composition?.tech?.length ?? 0,
        minerals: x.composition?.minerals?.length ?? 0, experts: x.composition?.experts?.length ?? 0,
        producers: countMin(x.composition),
      }
      for (const f of SNAP_FIELDS) if (got[f] < want_[f]) bad.push(`${slug}.${f} ${want_[f]}→${got[f]}`)
    }
    rec('C5', bad.length === 0,
      `검사 ${Object.keys(SNAP).length}종 · 루틴 재발행 면제 ${exempt.length}건${exempt.length ? `[${exempt.join(',')}]` : ''}` +
      (bad.length ? ` · 감소 ${bad.length}건: ${bad.slice(0, 6).join(', ')}` : ' · 감소 0'))
  } catch (e) { rec('C5', false, `실행 실패: ${e.message}`) }
}

// ── C6. task#311 발행 파이프라인 ─────────────────────────────────────────────
if (want('C6')) {
  try {
    const AUTH = await auth()
    const reps = await reportsOf(AUTH)
    const newPub = reps.filter((r) => NEW9.includes(r.slug))
    const bad = []
    if (reps.length < 7) bad.push(`행 수 ${reps.length}<7`)
    if (newPub.length < 1) bad.push('신규 9종 발행 0건')
    for (const x of newPub) {
      if (!x.title) bad.push(`${x.slug}: title 빔`)
      if (!x.description) bad.push(`${x.slug}: description 빔`)
      if (!(x.players || []).length) bad.push(`${x.slug}: players 빔`)
    }
    rec('C6', bad.length === 0,
      `행 수=${reps.length} · 신규 9종 발행=${newPub.length}건 [${newPub.map((x) => x.slug).join(',')}]` +
      (bad.length ? ` · 위반: ${bad.join('; ')}` : ' · title/description/players 전원 비어있지 않음'))
  } catch (e) { rec('C6', false, `실행 실패: ${e.message}`) }
}

// ── C7. 라이브 프로브 회귀 ───────────────────────────────────────────────────
if (want('C7')) {
  const lines = []
  const bad = []
  for (const [p, floor] of Object.entries(PROBES_CLEAN)) {
    if (!existsSync(`${ROOT}/scripts/${p}.mjs`)) { bad.push(`${p}: 파일 없음`); continue }
    const out = shSoft(`node scripts/${p}.mjs 2>&1`)
    const m = out.match(/ALL PASS (\d+)\/(\d+)/)
    const tot = out.match(/단언 총계:\s*(\d+)건 · PASS (\d+) · FAIL (\d+)/)
    const passed = m ? +m[1] : (tot ? +tot[2] : -1)
    const failed = tot ? +tot[3] : (m ? 0 : -1)
    lines.push(`${p}: PASS ${passed}/${floor} FAIL ${failed}`)
    if (failed !== 0) bad.push(`${p}: FAIL ${failed}건(0 기대)`)
    if (passed < floor) bad.push(`${p}: PASS ${passed}<${floor}(단언 삭제 의심)`)
  }
  for (const [p, b] of Object.entries(PROBES_NOISY)) {
    if (!existsSync(`${ROOT}/scripts/${p}.mjs`)) { bad.push(`${p}: 파일 없음`); continue }
    const out = shSoft(`node scripts/${p}.mjs 2>&1`)
    const tot = out.match(/단언 총계:\s*(\d+)건 · PASS (\d+) · FAIL (\d+)/)
    const passed = tot ? +tot[2] : -1, failed = tot ? +tot[3] : -1
    const axes = [...new Set([...out.matchAll(/✗\s+([A-Za-z0-9_-]+):/g)].map((x) => x[1]))]
    const newAxes = axes.filter((a) => !b.failAxes.includes(a))
    lines.push(`${p}: PASS ${passed}/${b.passFloor} FAIL ${failed}(선재 ${b.failCount}) 축[${axes.join(',')}]`)
    if (passed < b.passFloor) bad.push(`${p}: PASS ${passed}<${b.passFloor}`)
    if (newAxes.length) bad.push(`${p}: 신규 FAIL 축 [${newAxes.join(',')}]`)
  }
  rec('C7', bad.length === 0, `${lines.join(' · ')}${bad.length ? ` · 위반: ${bad.join(' | ')}` : ''}`)
}

// ── C8. task#314 광물축 — 하한 + 완결성 ──────────────────────────────────────
if (want('C8')) {
  try {
    const AUTH = await auth()
    const reps = await reportsOf(AUTH)
    // ADR-0042 보정의 보류 선언: `- 보류: <slug>/<광물명> — <이유>` (slug 또는 광물명에 `*` 허용)
    const adrPath = `${ROOT}/.forge/adr/0042-tech-anatomy-three-share-axes.md`
    const adr = existsSync(adrPath) ? readFileSync(adrPath, 'utf8') : ''
    const held = [...adr.matchAll(/^\s*-\s*보류:\s*([^\s/]+)\/([^—\n]+?)\s*—/gm)].map((m) => [m[1].trim(), m[2].trim()])
    const isHeld = (slug, name) => held.some(([s, n]) => (s === '*' || s === slug) && (n === '*' || n === name))

    let total = 0, filled = 0, heldN = 0
    const unclassified = []; const basisMissing = []
    for (const x of reps) {
      const basis = x.composition?.minerals_share_basis ?? null
      for (const m of (x.composition?.minerals || [])) {
        total++
        const pct = (m.producers || []).filter((p) => p.share_pct != null)
        if (pct.length) { filled++; if (!basis) basisMissing.push(`${x.slug}/${m.name}`) }
        else if (isHeld(x.slug, m.name)) heldN++
        else unclassified.push(`${x.slug}/${m.name}`)
      }
    }
    const bad = []
    if (filled < 1) bad.push('share_pct 충전 광물 0개(하한 1 미달)')
    if (basisMissing.length) bad.push(`basis 누락 ${basisMissing.length}건: ${basisMissing.slice(0, 4).join(', ')}`)
    if (unclassified.length) bad.push(`미분류 ${unclassified.length}건: ${unclassified.slice(0, 6).join(', ')}`)
    rec('C8', bad.length === 0,
      `광물항목 ${total}개 = 충전 ${filled} + 보류 ${heldN} + 미분류 ${unclassified.length} · ADR 보류선언 ${held.length}줄` +
      (bad.length ? ` · 위반: ${bad.join(' | ')}` : ''))
  } catch (e) { rec('C8', false, `실행 실패: ${e.message}`) }
}

// ── C9. 정합·배포 ────────────────────────────────────────────────────────────
if (want('C9')) {
  const bad = []
  const head = shSoft('git rev-parse HEAD').trim()
  shSoft('git fetch origin main --quiet')
  const origin = shSoft('git rev-parse origin/main').trim()
  if (head !== origin) bad.push(`HEAD(${head.slice(0, 7)}) != origin/main(${origin.slice(0, 7)}) — 폴러가 되돌린다`)
  const run = shSoft(`gh run list --limit 1 --json conclusion,status,headSha --jq '.[0]|"\\(.status) \\(.conclusion) \\(.headSha)"'`).trim()
  if (!run.startsWith('completed success')) bad.push(`최신 배포: ${run || '조회 실패'}`)
  else if (!run.includes(head)) bad.push(`최신 배포 sha가 HEAD와 다름: ${run.split(' ')[2]?.slice(0, 7)}`)
  const pin = shSoft(`grep -rn "라이브 [0-9]*종\\|현재 [0-9]*종\\|[0-9]*개 광물" API_SPEC.md CLAUDE_COWORK_API.md README.md || true`).trim()
  if (pin) bad.push(`개수박제 ${pin.split('\n').length}건: ${pin.split('\n')[0].slice(0, 90)}`)
  const ptr = shSoft(`grep -n '\\.py:[0-9]\\|\\.jsx:[0-9]\\|\\.js:[0-9]\\|\\.mjs:[0-9]\\|\\.md:[0-9]' .forge/codebase/*.md || true`).trim()
  if (ptr) bad.push(`codebase 줄번호 포인터 ${ptr.split('\n').length}건(0 기대 — task#290)`)
  const prior = shSoft('node scripts/loopcheck-tech15.mjs 2>&1').trim()
  const priorOk = /\b4\/4 PASS\b/.test(prior)
  if (!priorOk) bad.push(`선행 루프 체크(loopcheck-tech15) 회귀: ${prior.split('\n').pop()}`)
  rec('C9', bad.length === 0,
    `HEAD==origin ${head === origin} · 배포 ${run.split(' ').slice(0, 2).join(' ')} · 개수박제 ${pin ? pin.split('\n').length : 0} · 줄번호 포인터 ${ptr ? ptr.split('\n').length : 0} · tech15 ${priorOk ? '4/4' : 'FAIL'}` +
    (bad.length ? ` · 위반: ${bad.join(' | ')}` : ''))
}

// ── 출력 ─────────────────────────────────────────────────────────────────────
for (const r of results) console.log(`${r.id} ${r.ok ? 'PASS' : 'FAIL'} — ${r.evidence}`)
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} PASS${failed.length ? ` · FAIL: ${failed.map((r) => r.id).join(',')}` : ''}`)
process.exit(failed.length ? 1 : 0)
