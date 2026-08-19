#!/usr/bin/env node
/**
 * fg-loop 정지조건 체크 — 주요기술 리포트 대상 15종 확장(task#310 · task#312).
 *
 * C1 라이브 편입 · C2 미러 5자 일치 · C5 문서 동기 · C6 루틴 프롬프트.
 * C3(pytest+vitest)·C4(uat299·uat301)는 별도 명령으로 돈다 — 여기 넣으면 한 축의 실패가
 * 다른 축의 증거를 가린다.
 *
 * 기대 표(EXPECTED)는 ADR-0044 결정 1에서 **독립 하드코딩**한다 — 구현에서 파생하면
 * 자기참조라 무엇을 검증하는지 사라진다.
 *
 * 사용: node scripts/loopcheck-tech15.mjs        (전체)
 *       node scripts/loopcheck-tech15.mjs C2 C5  (일부)
 */
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const BASE = 'https://portfolion.taebro.com'
const CRED = { email: 'test@portfolion.com', password: 'test1234' }

// ADR-0044 결정 1 — slug → 표시명 15종(1~6은 기존, 7~15는 신규)
const EXPECTED = {
  'reusable-rocket': '재사용 로켓',
  'solid-state-battery': '전고체 배터리',
  smr: 'SMR',
  robotics: '로봇',
  'ai-datacenter-equipment': 'AI 데이터센터 설비',
  'ai-datacenter-ops': 'AI 데이터센터 운영',
  'autonomous-driving': '자율주행',
  'space-comms': '우주통신',
  'quantum-computing': '양자컴퓨팅',
  'nuclear-fusion': '핵융합',
  'solar-pv': '태양광',
  'semiconductor-equipment': '반도체 장비',
  'on-device-ai': '온디바이스 AI',
  'obesity-drugs': '비만·대사 치료제',
  'unmanned-defense': '무인 방산체계',
}
const ALL = Object.keys(EXPECTED)
const OLD6 = ALL.slice(0, 6)
const NEW9 = ALL.slice(6)

const results = []
const rec = (id, ok, evidence) => results.push({ id, ok, evidence })

const setEq = (a, b) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i])
const diff = (a, b) => ({ missing: b.filter((x) => !a.includes(x)), extra: a.filter((x) => !b.includes(x)) })

/** 파일 텍스트에서 `TECH_NAMES = { ... }` 객체 리터럴을 뽑아 평가한다(자체 파일이라 허용). */
function parseMirror(path) {
  const src = readFileSync(path, 'utf8')
  const m = src.match(/TECH_NAMES\s*=\s*(\{[^}]*\})/)
  if (!m) throw new Error(`${path}: TECH_NAMES 리터럴을 찾지 못함`)
  return new Function(`return (${m[1]})`)()
}

const want = (id) => {
  const argv = process.argv.slice(2).filter((a) => /^C\d$/.test(a))
  return argv.length === 0 || argv.includes(id)
}

// ── C1. 라이브 편입 ──────────────────────────────────────────────────────────
if (want('C1')) {
  try {
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(CRED),
    })
    const { access_token } = await login.json()
    if (!access_token) throw new Error('로그인 실패 — access_token 없음')
    const AUTH = { Authorization: `Bearer ${access_token}` }

    const codes = {}
    const bad = []
    for (const s of NEW9) {
      const r = await fetch(`${BASE}/api/tech-reports/${s}`, { headers: AUTH })
      codes[s] = r.status
      if (r.status !== 200) { bad.push(`${s}=${r.status}`); continue }
      const b = await r.json()
      if (b.slug !== s) bad.push(`${s}: slug 불일치(${b.slug})`)
      if (!Array.isArray(b.reports)) bad.push(`${s}: reports가 배열 아님(${JSON.stringify(b.reports)})`)
    }
    // 회귀: 기존 6종은 200 + 발행물 실재, index는 catch-all에 안 먹힘
    for (const s of OLD6) {
      const r = await fetch(`${BASE}/api/tech-reports/${s}`, { headers: AUTH })
      if (r.status !== 200) { bad.push(`회귀 ${s}=${r.status}`); continue }
      const b = await r.json()
      if (!Array.isArray(b.reports) || b.reports.length < 1) bad.push(`회귀 ${s}: 발행물 0건`)
    }
    const idx = await fetch(`${BASE}/api/tech-reports/index`, { headers: AUTH })
    if (idx.status !== 200) bad.push(`회귀 index=${idx.status}`)

    const n200 = Object.values(codes).filter((c) => c === 200).length
    rec('C1', bad.length === 0,
      `신규 9종 200=${n200}/9 (${Object.entries(codes).map(([k, v]) => `${k}:${v}`).join(' ')}) · 기존6+index 회귀 ${bad.filter((x) => x.startsWith('회귀')).length}건` +
      (bad.length ? ` · 위반: ${bad.join('; ')}` : ''))
  } catch (e) {
    rec('C1', false, `실행 실패: ${e.message}`)
  }
}

// ── C2. 미러 5자 일치 (배포 상수 · 소스 상수 · 프론트 · uat299 · uat301) ────────
if (want('C2')) {
  const readPy = (cmd, label) => {
    try {
      return JSON.parse(execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim())
    } catch (e) {
      throw new Error(`${label} 읽기 실패: ${String(e.message).split('\n')[0]}`)
    }
  }
  try {
    const PYCODE = "import json; from services.tech_reports import TECH_TOPICS as T; print(json.dumps(T, ensure_ascii=False))"
    const deployed = readPy(`docker exec portfolion-backend-1 python -c ${JSON.stringify(PYCODE)}`, '배포 상수')
    const source = readPy(`cd backend && .venv/bin/python -c ${JSON.stringify(PYCODE)}`, '소스 상수')
    const front = parseMirror('frontend/src/components/reports/techReportUtils.js')
    const p299 = parseMirror('scripts/uat299-tech-rename.mjs')
    const p301 = parseMirror('scripts/uat301-datacenter-split.mjs')

    const bad = []
    const named = [
      ['배포', Object.fromEntries(deployed.map((t) => [t.slug, t.name]))],
      ['소스', Object.fromEntries(source.map((t) => [t.slug, t.name]))],
      ['프론트', front],
      ['uat299', p299],
      ['uat301', p301],
    ]
    for (const [label, map] of named) {
      const keys = Object.keys(map)
      if (!setEq(keys, ALL)) {
        const d = diff(keys, ALL)
        bad.push(`${label}(${keys.length}): 누락[${d.missing.join(',')}] 초과[${d.extra.join(',')}]`)
        continue
      }
      const wrong = ALL.filter((s) => map[s] !== EXPECTED[s]).map((s) => `${s}="${map[s]}"≠"${EXPECTED[s]}"`)
      if (wrong.length) bad.push(`${label} 표시명: ${wrong.join(', ')}`)
    }
    // order 1~15 중복 없음 (소스 기준)
    const orders = source.map((t) => t.order)
    if (new Set(orders).size !== orders.length) bad.push(`order 중복: ${orders.join(',')}`)

    rec('C2', bad.length === 0,
      `5자 개수 배포=${deployed.length} 소스=${source.length} 프론트=${Object.keys(front).length} uat299=${Object.keys(p299).length} uat301=${Object.keys(p301).length}` +
      (bad.length ? ` · 위반: ${bad.join(' | ')}` : ' · 표시명 15/15 바이트 동일'))
  } catch (e) {
    rec('C2', false, `실행 실패: ${e.message}`)
  }
}

// ── C5. 문서 동기 ────────────────────────────────────────────────────────────
if (want('C5')) {
  const DOCS = ['API_SPEC.md', 'CLAUDE_COWORK_API.md', 'README.md', 'backend/app_schema.sql',
    'backend/services/tech_reports.py', '.forge/CONTEXT.md', 'scripts/cowork-routine-prompt.md']
  // 「6종」·「6개 slug」는 현재 전 히트가 주요기술 맥락임을 확인했으므로 0건이 유효 목표다.
  const STALE = [/6종/g, /6개 slug/g]
  const COUNT_PIN = [/현재 [0-9]+종/g, /라이브 [0-9]+종/g]
  const bad = []
  for (const f of DOCS) {
    let txt
    try { txt = readFileSync(f, 'utf8') } catch { bad.push(`${f}: 읽기 실패`); continue }
    txt.split('\n').forEach((line, i) => {
      for (const re of STALE) if (line.match(re)) bad.push(`${f}:${i + 1} 「${line.match(re)[0]}」`)
    })
  }
  for (const f of ['API_SPEC.md', 'CLAUDE_COWORK_API.md', 'README.md']) {
    const txt = readFileSync(f, 'utf8')
    txt.split('\n').forEach((line, i) => {
      for (const re of COUNT_PIN) if (line.match(re)) bad.push(`${f}:${i + 1} 개수박제 「${line.match(re)[0]}」`)
    })
  }
  // 신규 9 slug이 두 API 문서에 실재
  for (const f of ['API_SPEC.md', 'CLAUDE_COWORK_API.md']) {
    const txt = readFileSync(f, 'utf8')
    const miss = NEW9.filter((s) => !txt.includes(s))
    if (miss.length) bad.push(`${f}: 신규 slug 미기재 [${miss.join(',')}]`)
  }
  // fg-map은 `파일::심볼`·§N 앵커만 쓴다 → 줄번호 포인터 0건이 정상 기대값(task#290)
  let ptr = ''
  try {
    ptr = execSync(`grep -n 'tech_reports.py:[0-9]\\|techReportUtils.js:[0-9]\\|uat299-tech-rename.mjs:[0-9]\\|uat301-datacenter-split.mjs:[0-9]\\|cowork-routine-prompt.md:[0-9]' .forge/codebase/*.md || true`,
      { encoding: 'utf8' }).trim()
  } catch { /* grep 0건은 exit 1 */ }
  if (ptr) bad.push(`codebase 줄번호 포인터: ${ptr.split('\n').length}건`)

  rec('C5', bad.length === 0,
    bad.length ? `위반 ${bad.length}건: ${bad.slice(0, 8).join(' | ')}${bad.length > 8 ? ' …' : ''}`
      : `stale「6종/6개 slug」0건 · 개수박제 0건 · 신규 9 slug 2문서 실재 · 줄번호 포인터 0건`)
}

// ── C6. 루틴 프롬프트 (task#312) ─────────────────────────────────────────────
if (want('C6')) {
  const f = 'scripts/cowork-routine-prompt.md'
  const txt = readFileSync(f, 'utf8')
  const lines = txt.split('\n')
  const bad = []
  const missing = ALL.filter((s) => !txt.includes(s))
  if (missing.length) bad.push(`slug 미기재 [${missing.join(',')}]`)
  // 신규 9종은 경계 줄을 가진다: 그 slug를 담은 줄 중 하나가 `related`를 함께 담아야 한다
  // (결정된 형태 = 「대상은 X, X가 아닌 것은 Y이며 Y는 related로」 — 배제를 안 적으면 넓게 조사한다)
  const noBoundary = NEW9.filter((s) => !lines.some((l) => l.includes(s) && l.includes('related')))
  if (noBoundary.length) bad.push(`경계 줄 없음(related 미포함) [${noBoundary.join(',')}]`)
  rec('C6', bad.length === 0,
    bad.length ? `위반: ${bad.join(' | ')}`
      : `15 slug 전원 기재 · 신규 9종 경계 줄(related 포함) 9/9`)
}

// ── 출력 ─────────────────────────────────────────────────────────────────────
for (const r of results) console.log(`${r.id} ${r.ok ? 'PASS' : 'FAIL'} — ${r.evidence}`)
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} PASS${failed.length ? ` · FAIL: ${failed.map((r) => r.id).join(',')}` : ''}`)
process.exit(failed.length ? 1 : 0)
