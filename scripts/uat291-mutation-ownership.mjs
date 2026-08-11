// task#291 라이브 UAT — B50: `POST /report/{ticker}/refresh-analyst`·`POST /consensus/{ticker}/backfill`의
// 「소유권 OR admin」 게이트(`report._require_owner_or_admin`)가 실제로 막는가 + 그 경로가 정말
// 무쓰기인가(공유 `snapshots`·`daily_consensus_mart`·`raw_reports`).
//
// ⚠️ 새 코드가 라이브에 있어야 의미가 있다 — ⓔ축이 그것을 **먼저 단언**하므로, 배포 전에 돌리면
// ⓔ가 FAIL하고 왜 나머지가 틀렸는지가 출력에 남는다(조용한 거짓 FAIL을 만들지 않는다).
//
// ── 개정 경위(2026-08-11, fg-loop fork 해소 후) ────────────────────────────────
// 1차 저작판은 `backfill_consensus`가 `require_admin`이라는 전제로 ⓒ축을 「소유 종목이어도
// 비admin이면 403 "Admin only"」로 짰다. 사용자 fork 결정(A)으로 두 엔드포인트가 **같은
// 소유권 가드**를 쓰게 되어 그 축은 정상 구현에서 거짓 FAIL한다 → 「비소유 → 403」 대칭축으로 교체.
// 또 1차판의 owner-pass는 `POST /api/watchlist`로 관심종목을 임시 추가했는데, `watchlist.py`의
// 신규 티커 분기가 background 리포트 자동생성을 발동시켜 **공유 3테이블에 영구 쓰기**를 한다
// (계획 자신의 "어긋나면 즉시 중단" 지시와 모순). → in-container **읽기 전용** 술어 실측으로 교체.
//
// ── ⭐ 쓰기 위험 자체를 설계로 제거했다 ──────────────────────────────────────
// ⓐⓑ의 대상으로 **스냅샷이 0건인 비소유 티커**를 쓴다(라이브 실측 2026-08-11: `000000`·`008035`가
// tickers 마스터에서 유일하게 snapshots 0 · user_stocks 소유자 0). 가드가 있으면 403이고,
// **가드가 없어도** 스냅샷 부재로 404(refresh_analyst)/400(backfill)에서 멈춰 DB에 아무것도 안 쓴다.
// 1차판은 스냅샷 보유 티커(`000720`)를 써서 가드 부재 시 yfinance fetch + `UPDATE snapshots`를
// 실제로 실행했을 것이다 — 즉 프로브가 실패하는 순간 프로덕션을 오염시키는 설계였다.
// 403 vs 404/400은 코드로 갈리므로 판별력은 그대로다(가드는 스냅샷 조회 **앞**에 있다 —
// 이 순서 자체가 "거부가 DB에 닿지 않는다"의 증명이고, ⓔ가 구조로 재확인한다).
//
// ── 축과 "이 단언이 통과하면서도 깨질 수 있는 방식"(가토 ④ⓑ) ────────────────
//   ⓔ 라이브 코드 반영 — 헬퍼 정의 + 두 엔드포인트의 의존성 이름 + 가드가 query보다 앞.
//      이게 없으면 나머지 축이 "옛 코드에서 우연히 통과"할 수 있다(가토 ⑧ⓘ 대상 확정).
//   ⓟ 전제 — 계정 role ≠ admin. 이걸 안 재면 admin 계정으로 돌려 ⓐⓑ가 통째로 무의미해진다.
//   ⓐ refresh_analyst 비소유 → 403 "권한이 없습니다"
//   ⓑ backfill_consensus 비소유 → 403 "권한이 없습니다"  ← 두 엔드포인트 대칭(공통 헬퍼의 증거)
//      ⓐⓑ만 있으면 "막아야 할 때 막는다"만 증명된다 — 소유권 검사를 통째로 스킵하지 *않고*
//      무조건 403을 내는 구현도 통과한다. 그것을 ⓒ가 갈라 맡는다.
//   ⓒ 소유권 술어 in-container 읽기전용 전수 실측 — `find_ticker(get_all_stocks(uid), t)`가
//      **소유 티커 전건 non-None**(정당한 소유자가 403을 받지 않음) + **비소유 후보 전건 None**.
//      `find_ticker`는 `item["ticker"].upper() == t.upper()` exact 매칭이라 저장 형태가
//      어긋나면(시장 접미사·소문자·공백) 정당한 소유자가 거부된다 — fixture는 이걸 못 본다.
//   ⓓ 쓰기 0 — 4테이블 **전체 카운트** 엄격 불변(1차판의 "후보 2종 제외" 스코프가 불필요해졌다).
//
// ── 프로브 한계(재지 못하는 것 — 이름으로 명시) ──────────────────────────────
//   · **owner-pass의 HTTP 경로**: 소유 티커로 두 엔드포인트를 실제 호출하면 가드를 통과한 뒤
//     yfinance fetch + `UPDATE snapshots`(refresh_analyst) / `_pipeline.backfill`(backfill)이
//     **실제로 실행돼 공유 데이터를 쓴다**. test 계정의 26 소유 티커는 전부 스냅샷을 갖고 있어
//     "소유 + 스냅샷 없음" 무쓰기 조합이 라이브에 0건이다. → ⓒ가 술어를 실 DB 저장형태로
//     증명하고, 엔드포인트의 통과 분기는 `test_report_router.py`의 pytest 4+4케이스가 닫는다.
//   · **admin 통과 경로**: UAT 계정이 비admin이고 두 엔드포인트는 API 키를 안 받는다
//     (TESTING §7.5의 4회 반복 함정) — pytest `*_allowed_for_admin_non_owner` 2건 소관.
//
// git stash/checkout/restore/reset/commit/push, 프론트 빌드 — 전부 금지(이 스크립트는 안 한다).

import { execSync } from 'node:child_process';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat291';
fs.mkdirSync(OUT, { recursive: true }); // 브라우저를 안 써 PNG는 없다 — result.json만.

const EMAIL = 'test@portfolion.com';
const PASSWORD = 'test1234';

// ⓐⓑ 대상 후보 — 스냅샷 0 · 소유자 0(라이브 실측 2026-08-11). 가드 부재 시에도 무쓰기.
// 드리프트(누군가 담거나 리포트가 생성됨) 대비 2종 + 그 사실을 ⓒ가 실측 재확인한다.
const NONOWNED_NOSNAP_CANDIDATES = ['000000', '008035'];

const AX = {
  e: 'ⓔ라이브코드',
  pre: 'ⓟ전제-비admin',
  ai: 'ⓐ-identity',
  a: 'ⓐ비소유403(refresh)',
  bi: 'ⓑ-identity',
  b: 'ⓑ비소유403(backfill)',
  c: 'ⓒ소유권술어',
  dom: '정의역-sentinel',
  d: 'ⓓ쓰기0',
};

const checks = [];
const cov = {};
const bump = (k, n = 1) => { cov[k] = (cov[k] || 0) + n; };
const assert = (ax, name, got, want, detail = '') => {
  checks.push({ ax, name, got, want, detail, pass: JSON.stringify(got) === JSON.stringify(want) });
  bump(ax);
};
const assertDomain = (tag, cnt) =>
  assert(AX.dom, `${tag} 정의역`, cnt > 0 ? 'OK' : `DOMAIN_EMPTY(${cnt})`, 'OK', `n=${cnt}`);
const die = (msg) => {
  console.error(`\n✗ 중단 — ${msg}`);
  fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ base: BASE, aborted: msg, cov, checks }, null, 2));
  process.exit(2);
};

// ── 컨테이너 호출(읽기 전용) ────────────────────────────────────────────────
function psql(sql) {
  const cmd = `docker exec portfolion-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -F"|" -c "${sql.replace(/"/g, '\\"')}"'`;
  return execSync(cmd, { encoding: 'utf8' }).trim();
}
// 단일 psql 호출로 4개 count를 원자적으로(개별 SELECT 간 레이스 방지) 얻는다.
function dbCounts() {
  const out = psql(
    'SELECT (SELECT count(*) FROM snapshots), (SELECT count(*) FROM daily_consensus_mart), ' +
    '(SELECT count(*) FROM raw_reports), (SELECT count(*) FROM user_stocks);'
  );
  const [snapshots, mart, raw, us] = out.split('|').map(Number);
  return { snapshots, mart, raw, us };
}
function containerPy(code) {
  const raw = execSync('docker exec -i portfolion-backend-1 python -', { input: code, encoding: 'utf8' });
  const line = raw.split('\n').find((l) => l.startsWith('JSON:'));
  if (!line) die(`컨테이너 python 출력에 JSON: 마커가 없다 — raw=${JSON.stringify(raw.slice(0, 800))}`);
  return JSON.parse(line.slice(5));
}

// ════════════════════════════════════════════════════════════════════════
// ⓔ 라이브 코드 반영 — 나머지 축의 대상이 맞는지를 **먼저** 확정한다(가토 ⑧ⓘ)
// ════════════════════════════════════════════════════════════════════════
console.log('=== ⓔ 라이브 코드 반영(컨테이너 안 report.py 구조 실측) ===');
const live = containerPy(`
import json, re
src = open('routers/report.py').read()
def body(name):
    m = re.search(r'^def ' + name + r'\\(.*?(?=^\\S)', src, re.M | re.S)
    return m.group(0) if m else ''
out = {'helper_defined': 'def _require_owner_or_admin(' in src}
for fn in ('refresh_analyst', 'backfill_consensus'):
    b = body(fn)
    sig = b.split('\\n')[0] if b else ''
    gi, qi = b.find('_require_owner_or_admin('), b.find('query(')
    out[fn] = {
        'found': bool(b),
        'deps': re.findall(r'Depends\\((\\w+)\\)', sig),
        'guard_called': gi != -1,
        'guard_before_query': gi != -1 and qi != -1 and gi < qi,
    }
print('JSON:' + json.dumps(out))
`);
assert(AX.e, 'ⓔ 헬퍼 _require_owner_or_admin이 라이브에 정의됨', live.helper_defined, true, JSON.stringify(live));
for (const fn of ['refresh_analyst', 'backfill_consensus']) {
  assert(AX.e, `ⓔ ${fn} 의존성 = [get_current_user](≠require_admin, ≠_or_api_key)`, live[fn].deps, ['get_current_user']);
  assert(AX.e, `ⓔ ${fn}이 가드를 호출`, live[fn].guard_called, true);
  assert(AX.e, `ⓔ ${fn}의 가드가 스냅샷 query보다 앞(거부가 DB에 닿지 않음의 구조적 증명)`, live[fn].guard_before_query, true);
}
if (checks.some((c) => c.ax === AX.e && !c.pass)) {
  console.error('\n[ⓔ FAIL] 라이브가 새 코드가 아니다 — 아래 축들의 결과는 옛 코드에 대한 것이므로 신뢰하지 말 것.');
}

// ── 로그인 + 대상 identity 확정(추정 폴백 금지) ─────────────────────────────
const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
const loginJson = await loginRes.json().catch(() => ({}));
const { access_token } = loginJson;
if (!access_token) die(`로그인 실패 — status=${loginRes.status} body=${JSON.stringify(loginJson)}`);
const AUTH = { Authorization: `Bearer ${access_token}` };

// GET /api/auth/me → {user_id, email, role, menu_permissions} (auth.py 직독 확정)
const me = await (await fetch(`${BASE}/api/auth/me`, { headers: AUTH })).json().catch(() => ({}));
if (!me?.role) die(`GET /api/auth/me에 role이 없다 — 추정 폴백 금지. body=${JSON.stringify(me)}`);
if (!me?.user_id) die(`GET /api/auth/me에 user_id가 없다 — ⓒ의 in-container 실측 대상을 특정할 수 없다.`);
assert(AX.pre, 'ⓟ 테스트 계정 role ≠ admin', me.role === 'admin' ? 'ADMIN' : 'NON_ADMIN', 'NON_ADMIN',
  `role=${me.role} email=${me.email ?? '—'}`);
if (me.role === 'admin') die('테스트 계정이 admin이다 — ⓐⓑ의 전제(비admin 거부)가 무의미해진다.');

// GET /api/stocks → [{ticker,name,type,market,enriched_at}]
const stocksJson = await (await fetch(`${BASE}/api/stocks`, { headers: AUTH })).json().catch(() => null);
if (!Array.isArray(stocksJson)) die(`GET /api/stocks 응답이 배열이 아니다 — body=${JSON.stringify(stocksJson)}`);
assertDomain('ⓟ전제·GET-stocks', stocksJson.length);
const ownedSet = new Set(stocksJson.map((s) => String(s.ticker).toUpperCase()));

console.log(`\n대상: ${BASE} · 계정: ${EMAIL} (role=${me.role}, uid=${me.user_id}) · 소유 ${stocksJson.length}건`);

// ── 대상 후보 선정 — 스냅샷 0 · 비소유를 라이브로 재확인(계획의 "작성 시점 스냅샷" 규율) ──
const candState = containerPy(`
import json
from services.db import query
cands = ${JSON.stringify(NONOWNED_NOSNAP_CANDIDATES)}
out = {}
for t in cands:
    snaps = query("SELECT count(*) AS n FROM snapshots WHERE ticker = %s", (t,))[0]['n']
    owners = query("SELECT count(*) AS n FROM user_stocks WHERE ticker = %s", (t,))[0]['n']
    out[t] = {'snaps': int(snaps), 'owners': int(owners)}
print('JSON:' + json.dumps(out))
`);
const usable = NONOWNED_NOSNAP_CANDIDATES.filter(
  (t) => candState[t].snaps === 0 && candState[t].owners === 0 && !ownedSet.has(t.toUpperCase())
);
assertDomain('ⓐⓑ무쓰기후보', usable.length);
if (!usable.length) {
  die(`ⓐⓑ — 후보 ${NONOWNED_NOSNAP_CANDIDATES.join(',')} 전부 사용 불가(${JSON.stringify(candState)}). ` +
      `스냅샷 0·소유자 0인 티커를 다시 골라야 한다 — 스냅샷 보유 티커로 대체하면 가드 부재 시 프로덕션에 쓰게 된다.`);
}
const target = usable[0];
console.log(`ⓐⓑ 대상 = ${target} (snaps=${candState[target].snaps} owners=${candState[target].owners} — 가드 부재 시에도 무쓰기)`);

const T0 = dbCounts();
console.log(`쓰기0 baseline: ${JSON.stringify(T0)}`);

// ════════════════════════════════════════════════════════════════════════
// ⓐ refresh_analyst · 비소유 → 403
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== ⓐ refresh_analyst 비소유 → 403 ===');
assert(AX.ai, `ⓐ 대상(${target})이 비소유임을 GET /api/stocks로 확인`,
  ownedSet.has(target.toUpperCase()) ? 'OWNED' : 'NOT_OWNED', 'NOT_OWNED', `owned n=${stocksJson.length}`);
assert(AX.ai, `ⓐ 대상(${target})의 스냅샷 0(가드 부재 시 404로 멈춤 = 무쓰기 보장)`, candState[target].snaps, 0);

const rfA = await fetch(`${BASE}/api/report/${target}/refresh-analyst`, { method: 'POST', headers: AUTH });
const rfAJson = await rfA.json().catch(() => ({}));
assert(AX.a, `ⓐ POST refresh-analyst(${target}) → 403(가드 부재면 404가 나온다)`, rfA.status, 403, `body=${JSON.stringify(rfAJson)}`);
assert(AX.a, 'ⓐ detail === "권한이 없습니다"(스냅샷 존재 여부를 노출하지 않는다)', rfAJson.detail, '권한이 없습니다', `ticker=${target}`);

const T_a = dbCounts();
for (const k of ['snapshots', 'mart', 'raw', 'us']) {
  assert(AX.d, `ⓐ 이후 ${k} 불변`, T_a[k], T0[k], `before=${T0[k]} after=${T_a[k]}`);
}

// ════════════════════════════════════════════════════════════════════════
// ⓑ backfill_consensus · 비소유 → 403 (두 엔드포인트가 같은 헬퍼를 쓴다는 증거)
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== ⓑ backfill_consensus 비소유 → 403 ===');
assert(AX.bi, `ⓑ 대상(${target}) — ⓐ와 동일 입력이라 두 엔드포인트의 판정을 직접 대조한다`,
  ownedSet.has(target.toUpperCase()) ? 'OWNED' : 'NOT_OWNED', 'NOT_OWNED');

const bfB = await fetch(`${BASE}/api/consensus/${target}/backfill`, { method: 'POST', headers: AUTH });
const bfBJson = await bfB.json().catch(() => ({}));
assert(AX.b, `ⓑ POST backfill(${target}) → 403(가드 부재면 400 "리포트를 먼저 생성하세요")`, bfB.status, 403, `body=${JSON.stringify(bfBJson)}`);
assert(AX.b, 'ⓑ detail === "권한이 없습니다"(refresh_analyst와 바이트 동일 — 공통 헬퍼)', bfBJson.detail, '권한이 없습니다', `ticker=${target}`);

const T_b = dbCounts();
for (const k of ['snapshots', 'mart', 'raw', 'us']) {
  assert(AX.d, `ⓑ 이후 ${k} 불변(_pipeline.backfill이 실행되지 않았음)`, T_b[k], T_a[k], `before=${T_a[k]} after=${T_b[k]}`);
}

// ════════════════════════════════════════════════════════════════════════
// ⓒ 소유권 술어 — in-container 읽기 전용 전수 실측(쓰기 0, fixture가 못 보는 저장형태)
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== ⓒ 소유권 술어 전수 실측(읽기 전용) ===');
const pred = containerPy(`
import json
from services import storage
from services.utils import find_ticker
uid = ${JSON.stringify(me.user_id)}
stocks = storage.get_all_stocks(uid)
owned = sorted({str(s.get('ticker') or '') for s in stocks})
misses = [t for t in owned if find_ticker(stocks, t) is None]
non = ${JSON.stringify(NONOWNED_NOSNAP_CANDIDATES)}
hits = [t for t in non if find_ticker(stocks, t) is not None]
print('JSON:' + json.dumps({
    'owned_n': len(owned), 'owned': owned, 'misses': misses,
    'nonowned_false_hits': hits,
    'raw_forms': [t for t in owned if t != t.upper() or t.strip() != t],
}))
`);
assertDomain('ⓒ소유티커', pred.owned_n);
assert(AX.c, `ⓒ 소유 ${pred.owned_n}건 전부 find_ticker 매치(정당한 소유자가 403을 받지 않음)`, pred.misses, [],
  `owned_n=${pred.owned_n} misses=${JSON.stringify(pred.misses)}`);
assert(AX.c, 'ⓒ 비소유 후보는 find_ticker 미매치(술어가 실제로 판별한다 — 무조건 통과 아님)', pred.nonowned_false_hits, [],
  `후보=${NONOWNED_NOSNAP_CANDIDATES.join(',')}`);
assert(AX.c, 'ⓒ 저장형태가 exact 매칭과 정합(소문자·공백 티커 0건 — 접미사 함정 부재)', pred.raw_forms, [],
  `find_ticker는 item["ticker"].upper() == t.upper() exact 매칭`);
assert(AX.c, 'ⓒ GET /api/stocks 소유 건수 == in-container get_all_stocks 건수(같은 원천)', pred.owned_n, stocksJson.length,
  `api=${stocksJson.length} container=${pred.owned_n}`);

// ── 전체런 쓰기 0(시작=최종) ────────────────────────────────────────────────
const T_end = dbCounts();
for (const k of ['snapshots', 'mart', 'raw', 'us']) {
  assert(AX.d, `전체런 · ${k} 시작=최종`, T_end[k], T0[k], `T0=${T0[k]} 최종=${T_end[k]}`);
}

// ── 판정 ────────────────────────────────────────────────────────────────
const failed = checks.filter((c) => !c.pass);
console.log('\n=== task#291 — B50 소유권 게이트 · 무쓰기 라이브 실측 ===\n');
for (const c of checks) {
  console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.ax} — ${c.name} · got=${JSON.stringify(c.got)} want=${JSON.stringify(c.want)}${c.detail ? ` · ${c.detail}` : ''}`);
}
console.log('\n=== 커버리지(축별 단언 수) ===');
console.log(`   ${Object.entries(cov).map(([k, v]) => `${k}:${v}`).join(' · ')}`);
console.log(`   단언 합계 ${checks.length}건 · PASS ${checks.length - failed.length} · FAIL ${failed.length}`);

fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({
  base: BASE, me: { role: me.role, email: me.email }, target, candState, cov, checks,
  predicate: { owned_n: pred.owned_n, misses: pred.misses, nonowned_false_hits: pred.nonowned_false_hits },
  dbCounts: { T0, T_end },
  assertionSet: checks.map((c) => `${c.ax}|${c.name}`),
}, null, 2));
console.log(`   결과 JSON: ${OUT}/result.json`);

console.log(failed.length ? `\n>>> FAIL ${failed.length}/${checks.length}` : `\n>>> ALL PASS ${checks.length}/${checks.length}`);
process.exit(failed.length ? 1 : 0);
