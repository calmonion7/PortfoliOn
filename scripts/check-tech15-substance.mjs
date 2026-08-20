// fg-loop(task#322) 정지조건 C1·C2·C4 — 「차집합 0」과 「껍데기 아님」을 실측한다.
// GET만. 라이브 쓰기 0.
//
// 판정 규율(live-uat-probes): 필드 *존재*를 세지 말고 개수·합을 잰다 — 그것이 「껍데기 리포트」를
// 막는 유일한 축이다(plan S5②). 그리고 도메인을 baseline으로 고정한다: TARGET7(이 태스크가 책임지는
// 것)과 EXISTING8(선재분 — 클로버 방지 가드)은 2026-08-21 07:5x 실측으로 박제된 집합이며,
// 「지금 미발행인 것」으로 동적 계산하지 않는다(발행하면 집합이 비어 C2가 공허하게 통과한다).
import fs from 'fs';

const BASE = process.env.PF_BASE || 'https://portfolion.taebro.com';
const KEY = (fs.readFileSync('/Users/calmonion/Project/PortfoliOn/backend/.env.docker', 'utf8')
  .match(/^COWORK_API_KEY=(.*)$/m) || [])[1];
if (!KEY) { console.error('COWORK_API_KEY 없음'); process.exit(2); }

// ── baseline 고정 도메인 (S0 실측) ──────────────────────────────────────────
const TARGET7 = ['autonomous-driving', 'space-comms', 'quantum-computing', 'nuclear-fusion',
  'solar-pv', 'on-device-ai', 'unmanned-defense'];
const EXISTING8 = ['ai-datacenter-equipment', 'ai-datacenter-ops', 'obesity-drugs', 'reusable-rocket',
  'robotics', 'semiconductor-equipment', 'smr', 'solid-state-battery'];
// 선재 결함 baseline — smr 은 상장사 티커가 0건이다(내용 결함이지만 재발행은 비목표). 가드는
// 「이 값보다 나빠지지 않는다」로만 건다.
const PREEXISTING_TICK0 = ['smr'];

const res = await fetch(`${BASE}/api/tech-reports`, { headers: { 'X-API-Key': KEY } });
if (!res.ok) { console.error(`GET /api/tech-reports → ${res.status}`); process.exit(2); }
const { topics = [], reports = [] } = await res.json();
if (!Array.isArray(topics) || topics.length === 0) { console.error('topics 비었음 — 옛 백엔드?'); process.exit(2); }

const bySlug = new Map(reports.map((r) => [r.slug, r]));
const axsum = (a) => (Array.isArray(a) && a.length ? a.reduce((s, x) => s + (x.share_pct || 0), 0) : null);
const hosts = (r) => [...new Set((r.sources || []).map((s) => {
  try { return new URL(typeof s === 'string' ? s : s.url).host; } catch { return null; }
}).filter(Boolean))];

const measure = (slug) => {
  const r = bySlug.get(slug);
  if (!r) return { slug, missing: true };
  const c = r.composition || null;
  return {
    slug,
    kp: (r.key_points || []).length,
    ms: (r.milestones || []).length,
    ch: (r.challenges || []).length,
    // ⚠️ `Object.keys(related).length` 를 기준으로 쓰면 **구조적으로 항상 4**다 — 백엔드 `Related`
    // 모델이 4키를 전부 `[]` 기본값으로 채우므로 어떤 발행물에서도 실패할 수 없다(실측 12/12 판 전부
    // keys=4). 「위반 0건」이 빈 정의역에서 공허하게 참이 되는 것과 같은 가족의 결함이라
    // (live-uat-probes ⓩ), 기준을 **채워진 키 수 + 총 항목 수**로 옮긴다.
    // 임계는 실측 분포에서 골랐다: 채워진 키 3~4 · 총 항목 7~20 → 3 / 6 이면 선재 8종 전부 도달
    // 가능하면서도 관계도가 빈 판은 실제로 FAIL한다(양방향 확인 — task#317 도달불가 / #318 이미도달).
    relKeys: Object.keys(r.related || {}).length,
    rel: Object.values(r.related || {}).filter((v) => Array.isArray(v) && v.length > 0).length,
    relN: Object.values(r.related || {}).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0),
    src: (r.sources || []).length,
    host: hosts(r).length,
    mkt: r.market != null,
    tick: (r.players || []).filter((p) => (p.ticker || '') !== '').length,
    comp: c ? [axsum(c.tech), axsum(c.minerals), axsum(c.experts)] : null,
  };
};
// 요약 레이어 기준. comp: 비어있지 않은 축은 반드시 합 100(빈 축은 null — 규약상 생략 가능).
const judge = (m, { needTicker }) => {
  if (m.missing) return { ok: false, why: '미발행' };
  const bad = [];
  if (!(m.kp >= 3 && m.kp <= 4)) bad.push(`key_points ${m.kp}(3~4)`);
  if (!(m.ms >= 1)) bad.push(`milestones ${m.ms}(≥1)`);
  if (!(m.ch >= 2 && m.ch <= 4)) bad.push(`challenges ${m.ch}(2~4)`);
  if (!(m.rel >= 3)) bad.push(`related 채워진 키 ${m.rel}개(≥3)`);
  if (!(m.relN >= 6)) bad.push(`related 총 항목 ${m.relN}개(≥6)`);
  if (!(m.src >= 1)) bad.push(`sources ${m.src}(≥1)`);
  if (!(m.host >= 3)) bad.push(`출처 호스트 ${m.host}종(≥3)`);
  if (!m.mkt) bad.push('market 없음');
  if (m.comp === null) bad.push('composition 없음');
  else if (m.comp.some((v) => v !== null && Math.abs(v - 100) > 0.01)) bad.push(`축합 ${JSON.stringify(m.comp)}(비어있지 않은 축은 100)`);
  if (needTicker && !(m.tick >= 1)) bad.push(`상장 players ticker ${m.tick}건(≥1)`);
  return { ok: bad.length === 0, why: bad.join(' · ') };
};

const line = (m, v) => `  ${v.ok ? 'OK ' : 'BAD'} ${m.slug.padEnd(24)} ` +
  (m.missing ? '미발행' : `kp=${m.kp} ms=${m.ms} ch=${m.ch} rel=${m.rel}/${m.relKeys}키·${m.relN}항 src=${m.src} host=${m.host} tick=${m.tick} comp=${JSON.stringify(m.comp)}`) +
  (v.ok ? '' : `  ← ${v.why}`);

// ── C1. 차집합 0 ────────────────────────────────────────────────────────────
const missing = topics.map((t) => t.slug).filter((s) => !bySlug.has(s));
const c1 = missing.length === 0;
console.log(`C1: ${c1 ? 'PASS' : 'FAIL'} — topics ${topics.length} · reports ${reports.length} · 미발행 ${missing.length}건${missing.length ? ` [${missing.join(',')}]` : ''}`);

// ── C2. TARGET7 실질 내용 ───────────────────────────────────────────────────
console.log(`C2: (대상 ${TARGET7.length}종 — baseline 고정 집합)`);
const t7 = TARGET7.map((s) => { const m = measure(s); return { m, v: judge(m, { needTicker: true }) }; });
t7.forEach(({ m, v }) => console.log(line(m, v)));
const c2 = t7.every(({ v }) => v.ok);
console.log(`C2: ${c2 ? 'PASS' : 'FAIL'} — 기준 충족 ${t7.filter(({ v }) => v.ok).length}/${TARGET7.length}`);

// ── C4. EXISTING8 클로버 방지 ───────────────────────────────────────────────
console.log(`C4: (선재 ${EXISTING8.length}종 — 재발행 비목표, 악화만 감시)`);
const e8 = EXISTING8.map((s) => {
  const m = measure(s);
  return { m, v: judge(m, { needTicker: !PREEXISTING_TICK0.includes(s) }) };
});
e8.forEach(({ m, v }) => console.log(line(m, v)));
const c4 = e8.every(({ v }) => v.ok);
console.log(`C4: ${c4 ? 'PASS' : 'FAIL'} — 기준 충족 ${e8.filter(({ v }) => v.ok).length}/${EXISTING8.length}` +
  ` (선재 예외: ${PREEXISTING_TICK0.join(',')} 의 ticker 0건은 baseline)`);

console.log(`\n판정: C1=${c1 ? 'PASS' : 'FAIL'} C2=${c2 ? 'PASS' : 'FAIL'} C4=${c4 ? 'PASS' : 'FAIL'}`);
process.exit(c1 && c2 && c4 ? 0 : 1);
