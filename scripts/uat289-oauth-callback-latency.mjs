// task#289 라이브 계측 — OAuth 콜백 지연을 감산으로 「우리 핸들러 비용」과 「네트워크 전송 레그」로 가른다.
// 프로덕션 코드 변경 0. Playwright 불필요 — 순수 HTTP 타이밍(Node 20+ 내장 fetch/undici)만 쓴다.
// git stash/checkout/restore/reset/commit/push, 프론트 빌드 — 전부 금지(이 스크립트는 그중 아무것도 안 한다).
//
// 축 3개(1콜씩 실측 확인 완료, 추정 금지):
//   ⓐ  GET /index.html                       — 순수 전송 레그(정적 파일, DB/백엔드 무관)
//   ⓐ′ GET /api/auth/oauth/google             — 전송 + nginx→backend 프록시 + FastAPI 오버헤드(무DB·무외부호출)
//        실측: 307, Location=https://accounts.google.com/...&state=<nonce>.<hmac20>
//   ⓑ  GET /api/auth/oauth/google/callback?code=<bogus>&state=<ⓐ′에서 추출한 state>
//        실측: 307, Location=https://portfolion.taebro.com/?error=oauth_failed
//        (bogus code → 구글 token 교환이 id_token 없이 실패 → auth.py:172-174가
//         upsert_oauth_user(:178) *이전에* early return. DB 쓰기 0 — 근거는 코드 리딩으로 확인,
//         이 스크립트의 DB count 게이트가 그 사실을 실측으로도 재확인한다.)
//
// 감산: ⓒ₂ = median(ⓑ) − median(ⓐ)   — 핸들러 전체 순비용
//       ⓒ₁ = median(ⓑ) − median(ⓐ′)  — 구글 토큰 교환 순비용(핵심)
//
// 한계(반드시 읽을 것): Node fetch는 undici 기반이라 같은 오리진(portfolion.taebro.com)에
// keep-alive 커넥션 풀을 재사용한다 — 즉 TCP+TLS 핸드셰이크가 첫 요청 이후 세 축 모두에서 워밍
// 상태로 측정된다. 세 축이 전부 같은 오리진·같은 프로세스라 감산(ⓒ₁·ⓒ₂)에서는 상쇄되지만,
// **절대값(median 자체)은 실기기 콜드 요청보다 낮게 나온다** — 이 스크립트가 재는 것은
// "핸들러/구글 교환의 상대 비용"이지 "사용자가 체감하는 절대 지연"이 아니다.

import { execSync } from 'node:child_process';

const BASE = 'https://portfolion.taebro.com';
const N = Number((process.argv.find(a => a.startsWith('--n=')) || '--n=7').split('=')[1]);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── 판정축 규약: 조건부 단언 금지 — 무조건 push, 미검출은 sentinel로 FAIL(§7.3 ⓑ) ──
const checks = [];
function assertEq(name, got, want) {
  checks.push({ name, got, want, pass: JSON.stringify(got) === JSON.stringify(want) });
}

// ── DB 쓰기 0 게이트(하드) ──
const DB_TABLES = ['users', 'refresh_tokens', 'user_menu_permissions'];
function dbCount(table) {
  const cmd = `docker exec portfolion-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select count(*) from ${table}"'`;
  return execSync(cmd, { encoding: 'utf8' }).trim();
}
function dbCounts() {
  return Object.fromEntries(DB_TABLES.map(t => [t, dbCount(t)]));
}

// 하드스톱은 반드시 after-count를 재고 나간다. process.exit()는 이후 동기 코드를 실행하지 않으므로
// 종료 직전에 여기서 대조하지 않으면 무쓰기 게이트가 그 경로에서만 통째로 비활성이 된다
// (적대적 리뷰 MED: 특히 ?oauth= 감지 경로 — 실제 쓰기 개연성이 가장 높은 자리가 무검증이었다).
function hardStop(msg, extra) {
  console.error(`\n>>> HARD STOP: ${msg}`);
  if (extra !== undefined) console.error(extra);
  try {
    const after = dbCounts();
    const mismatch = DB_TABLES.some(t => after[t] !== before[t]);
    console.error(`DB count (before): ${JSON.stringify(before)}`);
    console.error(`DB count (after):  ${JSON.stringify(after)}`);
    console.error(mismatch
      ? '>>> !!!!! 위험 !!!!! 중단 시점에 DB 쓰기가 감지됐다.'
      : '>>> DB 쓰기 0 확인(중단 경로에서도 대조함).');
  } catch (e) {
    console.error(`>>> after-count 조회 실패 — 무쓰기를 확인하지 못했다: ${e.message}`);
  }
  process.exit(1);
}

// ── HTTP 타이밍 헬퍼 — redirect:'manual' 고정(추적 금지, 후속 문서까지 재면 오염) ──
async function timeReq(url, opts) {
  const t0 = performance.now();
  const res = await fetch(url, { redirect: 'manual', ...opts });
  await res.arrayBuffer().catch(() => {});
  const t1 = performance.now();
  return { ms: t1 - t0, status: res.status, location: res.headers.get('location') };
}
async function timeReqRetry(url, opts, label) {
  try {
    return await timeReq(url, opts);
  } catch (e) {
    console.log(`[${label}] fetch 실패 → 1회 재시도: ${e.message}`);
    await sleep(300);
    try {
      return await timeReq(url, opts);
    } catch (e2) {
      console.log(`[${label}] 재시도도 실패 — 이 표본은 도메인에서 빠진다: ${e2.message}`);
      return null;
    }
  }
}

// ── 라운드 1개 = ⓐ→ⓐ′→ⓑ 순차 실행(§ 규약: 인터리브, 블록 아님) ──
async function runRound(idx, record) {
  const ra = await timeReqRetry(`${BASE}/index.html`, { headers: { 'Cache-Control': 'no-store' } }, `a[${idx}]`);
  // ⓐ에도 상태코드 단언이 필요하다: 이 축만 무검증이면 CF 봇완화/WAF 챌린지 응답이 끼어도
  // 27건 전부 PASS하면서 ⓒ₂만 조용히 오염된다(적대적 리뷰 MED — ⓐ′·ⓑ는 307 단언이 있어 잡힌다).
  if (record) assertEq(`a status[${idx}]`, ra ? ra.status : 'FETCH_FAIL', 200);

  const rap = await timeReqRetry(`${BASE}/api/auth/oauth/google`, {}, `a'[${idx}]`);
  let state = null;
  if (rap && rap.location) {
    try { state = new URL(rap.location).searchParams.get('state'); } catch { /* keep null */ }
  }
  if (record) assertEq(`a' status[${idx}]`, rap ? rap.status : 'FETCH_FAIL', 307);

  if (!state) {
    hardStop(`ⓐ′ 응답(round ${idx})에서 state 추출 실패 — 폴백 추정 없이 종료.`, `rap: ${JSON.stringify(rap)}`);
  }

  const code = `uat289-bogus-${idx}`;
  const cbUrl = `${BASE}/api/auth/oauth/google/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
  const rb = await timeReqRetry(cbUrl, {}, `b[${idx}]`);

  if (rb) {
    if (rb.status === 400) {
      hardStop(`ⓑ 400 응답(round ${idx}) — state 추출/검증이 깨졌다. 다른 state로 재시도하지 않고 즉시 종료.`);
    }
    let loc = null;
    try { loc = new URL(rb.location, BASE); } catch { /* keep null */ }
    const hasOauthSuccess = loc ? loc.searchParams.has('oauth') : String(rb.location || '').includes('oauth=');
    if (hasOauthSuccess) {
      hardStop(`!!!!! 위험 !!!!! ⓑ Location에 ?oauth=가 감지됐다(round ${idx}) — 실제 로그인 성공(DB 기록) 가능성. 즉시 중단.`,
        `location: ${rb.location}`);
    }
    if (record) {
      assertEq(`b status[${idx}]`, rb.status, 307);
      const hasErrFailed = loc
        ? loc.searchParams.get('error') === 'oauth_failed'
        : String(rb.location || '').includes('error=oauth_failed');
      assertEq(`b location has error=oauth_failed[${idx}]`, hasErrFailed, true);
    }
  } else if (record) {
    assertEq(`b status[${idx}]`, 'FETCH_FAIL', 307);
  }

  return { a: ra ? ra.ms : null, ap: rap ? rap.ms : null, b: rb ? rb.ms : null };
}

// ── 통계: median·min·max·표준편차(모집단) ──
function stats(arr) {
  const v = arr.filter(x => x != null).sort((a, b) => a - b);
  const n = v.length;
  if (!n) return { median: null, min: null, max: null, std: null, n: 0 };
  const median = n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
  const mean = v.reduce((s, x) => s + x, 0) / n;
  const std = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / n);
  return { median, min: v[0], max: v[n - 1], std, n };
}

// ══════════════════════════════ 실행 ══════════════════════════════
console.log(`=== uat289 OAuth 콜백 지연 — N=${N} (라운드로빈 ⓐ→ⓐ′→ⓑ) ===`);

const before = dbCounts();
console.log(`DB count (before): ${JSON.stringify(before)}`);

console.log('\n워밍업 1회 실행 — 집계에서 제외.');
await runRound('warmup', false);

const timesA = [], timesAP = [], timesB = [];
for (let i = 0; i < N; i++) {
  const r = await runRound(i, true);
  timesA.push(r.a); timesAP.push(r.ap); timesB.push(r.b);
  console.log(`[round ${i}] a=${r.a?.toFixed(1) ?? 'null'}ms  a'=${r.ap?.toFixed(1) ?? 'null'}ms  b=${r.b?.toFixed(1) ?? 'null'}ms`);
}

const after = dbCounts();
console.log(`\nDB count (after):  ${JSON.stringify(after)}`);
for (const t of DB_TABLES) assertEq(`db-writes-zero:${t}`, after[t], before[t]);
const dbMismatch = DB_TABLES.some(t => after[t] !== before[t]);
if (dbMismatch) {
  console.error('\n>>> !!!!! 위험 !!!!! DB 쓰기 감지 — before/after count 불일치. 즉시 중단.');
  console.error(JSON.stringify({ before, after }, null, 2));
  process.exit(1);
}

// ── 축별 커버리지 sentinel(§7.3 ⓐ·§7.3의 domain 규칙) ──
const domA = timesA.filter(x => x != null).length;
const domAP = timesAP.filter(x => x != null).length;
const domB = timesB.filter(x => x != null).length;
assertEq('a-domain', domA >= N ? 'OK' : `DOMAIN_TOO_SMALL(${domA})`, 'OK');
assertEq("a'-domain", domAP >= N ? 'OK' : `DOMAIN_TOO_SMALL(${domAP})`, 'OK');
assertEq('b-domain', domB >= N ? 'OK' : `DOMAIN_TOO_SMALL(${domB})`, 'OK');

const sA = stats(timesA), sAP = stats(timesAP), sB = stats(timesB);
const c1 = sB.median != null && sAP.median != null ? sB.median - sAP.median : null; // 구글 교환 순비용
const c2 = sB.median != null && sA.median != null ? sB.median - sA.median : null;   // 핸들러 전체 순비용

function label(c, spreadSum) {
  if (c == null || spreadSum == null) return '미확정(측정 실패)';
  return Math.abs(c) > spreadSum ? '확정' : '미확정(산포 안에 묻힘)';
}
const c1Label = label(c1, (sAP.std ?? 0) + (sB.std ?? 0));
const c2Label = label(c2, (sA.std ?? 0) + (sB.std ?? 0));

console.log('\n=== 축별 통계(ms) ===');
for (const [name, s] of [['ⓐ  index.html', sA], ["ⓐ′ oauth/google", sAP], ['ⓑ  callback', sB]]) {
  console.log(`${name}: n=${s.n} median=${s.median?.toFixed(1)} min=${s.min?.toFixed(1)} max=${s.max?.toFixed(1)} std=${s.std?.toFixed(1)}`);
}
console.log(`\nⓒ₁ = median(ⓑ) − median(ⓐ′) = ${c1?.toFixed(1)}ms  [${c1Label}]  (기준: ⓐ′산포+ⓑ산포 = ${((sAP.std ?? 0) + (sB.std ?? 0)).toFixed(1)}ms)`);
console.log(`ⓒ₂ = median(ⓑ) − median(ⓐ)  = ${c2?.toFixed(1)}ms  [${c2Label}]  (기준: ⓐ산포+ⓑ산포 = ${((sA.std ?? 0) + (sB.std ?? 0)).toFixed(1)}ms)`);

console.log(`\n=== 커버리지: ⓐ ${domA} · ⓐ′ ${domAP} · ⓑ ${domB} (N=${N}, 워밍업 1회 별도·집계 제외) · 단언 ${checks.length}건 ===`);
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.name} — got=${JSON.stringify(c.got)} want=${JSON.stringify(c.want)}`);

const failed = checks.filter(c => !c.pass);
console.log(failed.length ? `\n>>> FAIL ${failed.length}/${checks.length}` : `\n>>> ALL PASS ${checks.length}/${checks.length}`);
process.exit(failed.length ? 1 : 0);
