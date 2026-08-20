// task#311 S4 육안 + 계측 — 15종 확장 후 목록·신규 종 상세·해부 미작성 화면.
// GET만 — 라이브 프로덕션 쓰기 0.
//
// 판정 규율(live-uat-probes): identity를 판정축보다 먼저 · 축마다 domain sentinel(표본 부재를 FAIL로)
// · 대조군 · 잘림은 leaf scrollWidth + overflow 컨테이너 두 계열.
import { chromium, devices } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat311';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const cov = {};
const P = (ok, tag, msg) => results.push({ ok, tag, msg });
const bump = (k, n = 1) => { cov[k] = (cov[k] || 0) + n; };

// ── 라이브 사실 확보(identity 먼저) ──────────────────────────────────────────
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const { access_token, refresh_token } = await login.json();
if (!access_token) { console.error('로그인 실패'); process.exit(1); }
const A = { Authorization: `Bearer ${access_token}` };
const TECH = await (await fetch(`${BASE}/api/tech-reports`, { headers: A })).json();
const REPORTS = TECH.reports || [];
// topics 는 additive 신규 필드(task#311 S4a) — 없으면(옛 백엔드) null 로 둔다. 「대기 0건」과
// 「topics 키 자체가 없다」는 서로 다른 사실이라 혼동하면 안 된다(빈 배열로 뭉개면 옛 백엔드가
// "대기 0"으로 오독된다).
const TOPICS = Array.isArray(TECH.topics) ? TECH.topics : null;
const WITH = REPORTS.filter((r) => r.composition);
const WITHOUT = REPORTS.filter((r) => !r.composition);
const NEW9 = ['autonomous-driving', 'space-comms', 'quantum-computing', 'nuclear-fusion',
  'solar-pv', 'semiconductor-equipment', 'on-device-ai', 'obesity-drugs', 'unmanned-defense'];
const NEW_PUB = REPORTS.filter((r) => NEW9.includes(r.slug));
const UNPUB = NEW9.filter((s) => !REPORTS.some((r) => r.slug === s));
// 대기 칩(tech-pending-section)의 기대 집합 — TOPICS 가 null 이면 계산 불능이라 그대로 null 전파.
const PENDING_TOPICS = TOPICS === null ? null : TOPICS.filter((t) => !REPORTS.some((r) => r.slug === t.slug));

P(REPORTS.length >= 7, 'identity:rows', `발행물 ${REPORTS.length}종(하한 7) · 해부보유 ${WITH.length} · 미작성 ${WITHOUT.length}`);
P(NEW_PUB.length >= 1, 'identity:new-published', `신규 9종 중 발행 ${NEW_PUB.length}건 [${NEW_PUB.map((r) => r.slug).join(',')}]`);
P(UNPUB.length >= 1, 'identity:unpublished-exists', `미발행 신규 ${UNPUB.length}종 — 해부 미작성 화면의 대조군 표본이 존재한다`);

const DETAIL = NEW_PUB[0]?.slug;
const PENDING = UNPUB[0];            // 미발행 slug — 해부 화면이 안내를 렌더해야 한다

const MEASURE = () => {
  window.__m = {
    // 요소 배열의 leaf 잘림 + 부모 overflow 잘림을 함께 잰다
    probe: (sel) => [...document.querySelectorAll(sel)].map((e) => {
      const cs = getComputedStyle(e);
      return {
        text: (e.textContent || '').trim().slice(0, 40),
        sw: e.scrollWidth, cw: e.clientWidth, h: Math.round(e.getBoundingClientRect().height),
        display: cs.display, overflow: cs.overflow, color: cs.color,
      };
    }),
    doc: () => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }),
    hasText: (t) => document.body.innerText.includes(t),
    bodyLen: () => document.body.innerText.trim().length,
  };
};

const VIEWS = [
  { key: 'm278', opts: { ...devices['iPhone SE'], viewport: { width: 278, height: 700 }, isMobile: true, hasTouch: true } },
  { key: 'm768', opts: { viewport: { width: 768, height: 900 } } },
  { key: 'pc1280', opts: { viewport: { width: 1280, height: 900 } } },
];

const browser = await chromium.launch();
for (const V of VIEWS) {
  const ctx = await browser.newContext({ ...V.opts, serviceWorkers: 'block' });
  await ctx.addInitScript(([a, r]) => {
    localStorage.setItem('access_token', a);
    localStorage.setItem('refresh_token', r);
    localStorage.setItem('theme', 'light');
    localStorage.setItem('pwa-install-dismissed-at', String(Date.now()));
  }, [access_token, refresh_token]);
  const page = await ctx.newPage();
  await page.addInitScript(MEASURE);

  // ── ① 목록 ────────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/tech-reports`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${V.key}-list.png`, fullPage: true });

  const cards = await page.evaluate(() => window.__m.probe('[data-testid="card-to-report"]'));
  const pend = await page.evaluate(() => window.__m.probe('[data-testid="card-anatomy-pending"]'));
  const anat = await page.evaluate(() => window.__m.probe('[data-testid="card-link-anatomy"]'));
  const doc1 = await page.evaluate(() => window.__m.doc());

  // card-count·anatomy-link-domain 은 발행물(REPORTS) 기준을 그대로 유지한다 — 대기 칩은 카드도
  // 해부 링크도 아니므로 이 두 축의 정의역은 변경 대상이 아니다(계획 결정 4).
  bump(`${V.key}:cards`, cards.length);
  P(cards.length === REPORTS.length, `${V.key}/list:card-count`,
    `카드 ${cards.length}장 == API 행 ${REPORTS.length}종 (하드코딩이 아니라 데이터 파생)`);
  P(doc1.sw <= doc1.cw, `${V.key}/list:no-hscroll`, `문서 scrollWidth ${doc1.sw} <= clientWidth ${doc1.cw}`);
  const clipped = cards.filter((c) => c.sw > c.cw + 1);
  P(clipped.length === 0, `${V.key}/list:name-not-clipped`,
    `표시명 잘림 ${clipped.length}건${clipped.length ? ' ' + JSON.stringify(clipped.map((c) => [c.text, c.sw, c.cw])) : ''} · 최장 "${cards.map((c)=>c.text).sort((a,b)=>b.length-a.length)[0]||'-'}"`);
  bump(`${V.key}:anatomy-link`, anat.length);
  P(anat.length === REPORTS.length, `${V.key}/list:anatomy-link-domain`,
    `해부 링크 ${anat.length}개 == 발행물 ${REPORTS.length}종`);
  // 「해부 미작성」 칩 — 라이브 표본이 0이면 통과가 아니라 **미검증**이다
  bump(`${V.key}:pending-chip`, pend.length);
  P(pend.length === WITHOUT.length, `${V.key}/list:pending-chip-matches-data`,
    `미작성 칩 ${pend.length}개 == composition 없는 종 ${WITHOUT.length}개` +
    (WITHOUT.length === 0 ? ' ⚠️ 라이브 표본 0 — 이 축은 통과가 아니라 **미검증**이다' : ''));

  // ── topics 파생 대기 칩(tech-pending-section) 신규 3축(task#311 S4a) ────────
  // 조건부 스킵 금지(⑧ⓑ) — 무조건 실행하고, TOPICS 부재/대기 0건은 메시지에 "미검증"으로 명시한다.
  // 리터럴을 박지 않는다 — 기대값은 전부 TOPICS/REPORTS 파생(PENDING_TOPICS)이다.
  const pendChips = await page.evaluate(() => window.__m.probe('[data-testid="tech-pending-chip"]'));
  bump(`${V.key}:pending-chip-topics`, pendChips.length);
  const pendWant = PENDING_TOPICS === null ? 0 : PENDING_TOPICS.length;
  const domainNote = TOPICS === null
    ? ' ⚠️ topics 키 부재(옛 백엔드) — 이 축은 통과가 아니라 **미검증**이다'
    : pendWant === 0
      ? ' ⚠️ 대기 topics 0건(라이브 표본 0) — 이 축은 통과가 아니라 **미검증**이다'
      : '';
  // ⓐ 칩 개수 == PENDING_TOPICS 길이
  P(pendChips.length === pendWant, `${V.key}/list:pending-chip-count-topics`,
    `대기 칩(topics파생) ${pendChips.length}개 == 기대 ${pendWant}개` + domainNote);
  // ⓑ 칩 텍스트 집합 == 미발행 slug 의 topics[].name 집합(정렬 후 비교)
  const gotNames = pendChips.map((c) => c.text).sort();
  const wantNames = PENDING_TOPICS === null ? [] : PENDING_TOPICS.map((t) => t.name).sort();
  P(JSON.stringify(gotNames) === JSON.stringify(wantNames), `${V.key}/list:pending-chip-name-set`,
    `칩 텍스트 ${JSON.stringify(gotNames)} == topics[].name ${JSON.stringify(wantNames)}` + domainNote);
  // ⓒ 칩 rect 높이(선언이 아니라 실측) >= 32px — 전 칩
  // ⚠️ 이 축의 한계(적대 검토 지적): 이것은 **32px 탭 타깃 문턱** 검사이지 「정확히 34px」 핀의
  //    보증이 아니다. PENDING_CHIP_STYLE 에서 lineHeight:'18px' 를 지우면 상속 line-height
  //    (1.5 × 11.5 = 17.25)로 떨어져 7+7+17.25+2 = 33.25px 가 되는데, 33.25 >= 32 이므로 이 축은
  //    **그대로 통과한다**. 즉 이 축을 「34px 핀이 지켜지는 증거」로 읽지 말 것 — 문턱만 지킨다.
  //    (핀 자체를 지키려면 h === 34 정밀 단언이 필요하나, 폰트·토큰 변경에 취약해 문턱으로 둔다.)
  const shortChips = pendChips.filter((c) => c.h < 32);
  P(shortChips.length === 0, `${V.key}/list:pending-chip-height`,
    `대기 칩 ${pendChips.length}개 중 32px 미만 ${shortChips.length}건 · 높이=[${pendChips.map((c) => c.h).join(',')}]`
    + ' (32px 문턱 — 34px 핀 보증 아님)' + domainNote);

  // ── ② 상세 — 신규 종은 스크린샷, 278px에서는 **전 종의 넘침 집합**을 baseline과 대조 ──
  //
  // ⚠️ 이 축을 「신규 종이 안 넘친다」로 두면 **판별력이 없다**: 278px 넘침은 선재 결함이고
  //    신규 종만 재면 「내가 깼다」와 「원래 그랬다」가 구별되지 않는다(규칙 ⓔ 대조군).
  //    실측(2026-08-20): 7종 중 3종이 넘치고 그중 2종은 이 태스크와 무관한 기존 종이다 —
  //    reusable-rocket 306 · ai-datacenter-ops 298 · semiconductor-equipment 296 (cw 278).
  //    원인은 「업체」 표(players TABLE)의 `선두 대비` 열이 문서 폭을 밀어내는 것.
  //    그래서 축을 **집합 동일성**으로 둔다 — 새 slug가 이 집합에 들어오면 회귀다.
  if (DETAIL) {
    await page.goto(`${BASE}/tech-report/${DETAIL}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/${V.key}-detail-${DETAIL}.png`, fullPage: true });
    const len = await page.evaluate(() => window.__m.bodyLen());
    bump(`${V.key}:detail`, 1);
    P(len > 2000, `${V.key}/detail:not-blank`, `본문 ${len}자(백지 아님)`);
  }
  if (V.key === 'm278') {
    const OVERFLOW_BASELINE = ['ai-datacenter-ops', 'reusable-rocket', 'semiconductor-equipment'];
    const over = [];
    for (const r of REPORTS) {
      await page.goto(`${BASE}/tech-report/${r.slug}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(600);
      const d = await page.evaluate(() => window.__m.doc());
      bump('m278:detail-measured', 1);
      if (d.sw > d.cw) over.push(`${r.slug}(${d.sw})`);
    }
    const set = over.map((x) => x.split('(')[0]).sort();
    P(JSON.stringify(set) === JSON.stringify(OVERFLOW_BASELINE), 'm278/detail:hscroll-set-is-baseline',
      `278px 넘침 ${over.length}/${REPORTS.length}종 [${over.join(' ')}] · baseline [${OVERFLOW_BASELINE.join(' ')}] — ` +
      `선재 결함(players 표의 「선두 대비」 열). 신규 진입이 있으면 회귀다`);
  }

  // ── ③ 해부 미작성(미발행 slug) — 대조군 ────────────────────────────────────
  if (PENDING) {
    await page.goto(`${BASE}/tech-anatomy/${PENDING}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/${V.key}-anatomy-pending-${PENDING}.png`, fullPage: true });
    const pill = await page.evaluate(() => window.__m.probe('.list-pill'));
    const len = await page.evaluate(() => window.__m.bodyLen());
    const hasGuide = await page.evaluate(() => window.__m.hasText('리포트 보기'));
    const doc3 = await page.evaluate(() => window.__m.doc());
    bump(`${V.key}:pending-screen`, 1);
    P(len > 40, `${V.key}/pending:not-blank`, `본문 ${len}자 — 백지가 아니다`);
    P(hasGuide, `${V.key}/pending:guide`, `안내(「리포트 보기」) 노출=${hasGuide}`);
    // ⚠️ 미작성 안내는 **하위 문구가 둘**이다(TechAnatomy.jsx:165 vs :166) — 이 구별을 기록해야
    //    「미작성 분기를 라이브에서 밟았다」가 어느 쪽인지 흐려지지 않는다.
    //    ⓐ 미발행 slug → 「아직 발행된 리포트가 없습니다」  ← 이 프로브가 밟는 쪽
    //    ⓑ 발행됐지만 composition 없음 → 「리포트는 있지만 … 기입되지 않았습니다」  ← 라이브 표본 0이라 dormant
    const subA = await page.evaluate(() => window.__m.hasText('아직 발행된 리포트가 없습니다'));
    const subB = await page.evaluate(() => window.__m.hasText('아직 기입되지 않았습니다'));
    bump(`${V.key}:pending-sub-unpublished`, subA ? 1 : 0);
    bump(`${V.key}:pending-sub-no-composition`, subB ? 1 : 0);
    P(subA, `${V.key}/pending:sub-unpublished`, `미발행 문구=${subA}(이 축이 라이브에서 밟히는 쪽)`);
    P(subB === (WITHOUT.length > 0), `${V.key}/pending:sub-no-composition-matches-data`,
      `「기입되지 않았습니다」 문구=${subB} · composition 없는 발행종 ${WITHOUT.length}개` +
      (WITHOUT.length === 0 ? ' ⚠️ 라이브 표본 0 — 그 하위 분기는 통과가 아니라 **미검증**이다' : ''));
    P(pill.length === 1, `${V.key}/pending:list-pill`, `list-pill ${pill.length}개(task#309 계약)`);
    P(doc3.sw <= doc3.cw, `${V.key}/pending:no-hscroll`, `문서 ${doc3.sw} <= ${doc3.cw}`);
  }
  await ctx.close();
}
await browser.close();

// ── 출력 ─────────────────────────────────────────────────────────────────────
for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.tag}\n      ${r.ok ? 'PASS' : 'FAIL'} — ${r.msg}`);
console.log('\n[커버리지 sentinel]');
for (const [k, v] of Object.entries(cov)) console.log(`  ${k} = ${v}${v === 0 ? '  ⚠️ 0건 — 그 축은 미검증' : ''}`);
console.log(`\n※ 육안 캡처 ${OUT}/`);
const f = results.filter((r) => !r.ok);
console.log(`\n단언 총계: ${results.length}건 · PASS ${results.length - f.length} · FAIL ${f.length}`);
process.exit(f.length ? 1 : 0);
