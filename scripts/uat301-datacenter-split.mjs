// task#301 S7 라이브 UAT(신규) — data-center 은퇴 + ai-datacenter-equipment/-ops 분할(ADR-0039) +
// 업체를 축(계열) 그룹으로 묶는 재설계(PlayerTable 소제목행·ShareChart 그룹, task#301 S2)를 잰다.
//
// 이 커밋이 바꾼 동작 3가지 — 스테일 축은 이 어휘로 찾았다(testid가 아니라 동작 기준, TESTING.md
// §7.3ⓟ):
//   ⓐ 「계보 분류」 독립 섹션이 사라졌다(CategoryGroups.jsx 삭제, testid tech-report-categories 소멸,
//      목차 항목·SECTIONS 배열에서도 빠졌다).
//   ⓑ 점유율 막대가 한 줄로 늘어서지 않고 업체 분류(category) 축별로 그룹 묶임(PlayerTable 소제목행도
//      동형 — Σ 초과 경고가 전역합이 아니라 그룹 내 합으로 판정된다).
//   ⓒ 대상이 5종→6종. `data-center`가 은퇴하고 `ai-datacenter-equipment`·`ai-datacenter-ops`로 분할됐다.
//
// 축 10개(이 순서로 assert) ────────────────────────────────────────────────────
//   1. API — GET /api/tech-reports/data-center → 422(은퇴 slug, Literal 검증 탈락) ·
//      ai-datacenter-equipment/-ops → 200(신규 slug, 발행 유무 무관 — 빈 reports:[]도 200)
//   2. 목록 화면 — 「데이터 센터」 카드 0장 · 카드 총수 == API reports.length
//   3. category를 가진 판 상세에서 tech-report-categories 부재 + 목차에도 그 앵커 부재
//   4. 업체 표 — tech-report-player-group 소제목행 수 == groupByCategory 그룹 수, 각 행의 colSpan ==
//      헤더 th 수
//   5. 업체 행(tech-report-player-row) 총수 == 그 판 players.length(미분류 포함 — 그룹핑으로 업체가
//      사라지지 않는다)
//   6. 소제목 아래 행이 실제로 그 category 소속인지 대조(개수만 맞고 배정이 틀려도 통과하는 것을 막는다
//      — API의 players를 이름으로 대조)
//   7. 점유율 막대 그룹 수 == groupByCategory(share 보유 players) 그룹 수, 각 그룹 막대 수 일치,
//      Σ 경고가 **그룹 내** 합으로 판정됨(전역 합이 아니다 — ⓑ의 핵심)
//   8. 시각 — 소제목 행 computed style이 인접 업체 행과 다름(배경·굵기·border 중 1+) / 그룹 경계
//      세로분리 > 그룹 내 행간 분리 / 빈 섹션 제목 0건(업체 표 + 점유율 양쪽)
//   9. 회귀 — 본문 가로스크롤 0(4뷰포트) / 잘림 2계열(텍스트 leaf·overflow:hidden 컨테이너) 0건
//   10. 육안 캡처 4뷰포트(top + 업체표 scrollIntoView, fullPage 없음)
//
// ── 대상 slug 선택(추정 금지) ──────────────────────────────────────────────────
// GET /api/tech-reports를 1콜 찍어 실제로 category가 채워진 판을 찾는다(리터럴 slug 하드코딩 금지).
// 후보가 여럿이면 groupByCategory 그룹 수가 가장 많은 판을 고른다(다축 커버리지 최대화, 동수면 slug
// 오름차순). 그 판이 share_pct도 같이 가지면 축 7~8(점유율)도 같은 페이지에서 잰다 — 아니면
// share_pct+category를 함께 가진 다른 판을 전수 탐색해 별도 방문으로 축 7만 보강한다.
// **아무 판에도 category가 없으면 이 프로브의 전제가 성립하지 않으므로 즉시 exit**(추정 폴백 금지,
// TESTING.md §7.3⑧ⓘ).
//
// ── 판정 규율 ────────────────────────────────────────────────────────────────
//  · 조건부 단언 금지 — 전부 무조건 단언 + sentinel FAIL로 총계를 구조적으로 고정한다.
//  · 축마다 `*-domain` sentinel을 짝으로 둔다(표본 0 → DOMAIN_TOO_SMALL/EMPTY로 FAIL, 공허 통과 금지).
//  · 판정 범위는 main.page-wrap 본문으로 한정(전역 마스트헤드·탭바 배제).
//  · identity(h1==TECH_NAMES[slug], lead==title)를 판정축보다 먼저 확인 — 대상이 틀려도 통과하는
//    축을 만들지 않는다(§7.3⑧ⓘ).
//  · 그룹 매칭은 **label 문자열 키**로 한다(순서/인덱스 의존 X) — sortPlayers를 이 프로브가 다시
//    구현할 필요가 없다(카운트·배정 정합만 보면 되므로).
//  · 이 앱은 Service Worker가 /api/*를 가로챈다 — serviceWorkers:'block'(응답 주입은 이 파일에 없지만
//    캐시된 옛 응답을 돌려줄 여지를 없애기 위해 기본값을 따른다, TESTING.md §7.1·§7.2①).
//
// ── 이 프로브의 한계(착수 전에 적어둔다) ─────────────────────────────────────
//  · 라이브 데이터 의존 — category·share_pct를 가진 판이 지금 라이브에 존재한다는 전제 위에 있다.
//    없으면 판정 불가로 즉시 exit(FAIL이 아니라 exit — 관측 가능성 자체가 무너진 것이므로).
//  · Σ 초과 경고가 "그룹 내 합"으로 판정됨을 정확값 대조로 확인하지만, 전역합≠그룹합이 실제로
//    벌어지는 표본(그룹별로는 100% 안 넘는데 전역 합산은 넘는 경우)을 라이브 데이터가 우연히
//    제공하지 않으면 그 구분력(옛 전역판정과 신 그룹판정을 가르는 이빨)은 커버리지 로그에만 남고
//    단언되지는 않는다 — 이 파일은 합성 데이터를 주입하지 않는다(순수 실데이터 GET).
//  · 배정 대조(축 6)는 업체 **이름**으로 조인한다 — 동명 업체가 두 판에 걸쳐 있어도 이 판 *안*에서
//    동명이인이면(희귀) 모호해질 수 있다. 실측 로그에 조인 실패 건수를 남긴다.
import { chromium, devices } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat301';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const P = (ok, tag, msg) => results.push({ ok, tag, msg });
const cov = {};
const bump = (k, n = 1) => { cov[k] = (cov[k] || 0) + n; };
const eq = (tag, got, want, note = '') => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  P(ok, tag, `${ok ? 'PASS' : 'FAIL'} — got=${JSON.stringify(got)} want=${JSON.stringify(want)}${note ? ' · ' + note : ''}`);
};
const rawLog = [];

// ── 로그인(추정 폴백 없음) ────────────────────────────────────────────────────
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const { access_token, refresh_token } = await login.json();
if (!access_token) { console.error('로그인 실패 — access_token 없음. 종료.'); process.exit(1); }
const AUTH = { Authorization: `Bearer ${access_token}` };

// TECH_NAMES 미러 — techReportUtils.js(백엔드는 표시명을 응답에 싣지 않는다, ADR-0033 결정 2).
// task#301(ADR-0039)의 6종 정본. h1 identity 단언의 기대값 소스이므로 슬러그가 없으면 즉시 exit.
const TECH_NAMES = {
  'reusable-rocket': '재사용 로켓', 'solid-state-battery': '전고체 배터리',
  smr: 'SMR', robotics: '로봇',
  'ai-datacenter-equipment': 'AI 데이터센터 설비', 'ai-datacenter-ops': 'AI 데이터센터 운영',
};

// ══ 축 1 — API ════════════════════════════════════════════════════════════════
async function statusOf(slug) {
  const res = await fetch(`${BASE}/api/tech-reports/${slug}`, { headers: AUTH });
  return res.status;
}
const stRetired = await statusOf('data-center');
const stEquip = await statusOf('ai-datacenter-equipment');
const stOps = await statusOf('ai-datacenter-ops');
eq('api-retired-422', stRetired, 422, 'GET /api/tech-reports/data-center(은퇴 slug, Literal 검증 탈락 기대)');
eq('api-equipment-200', stEquip, 200, 'GET /api/tech-reports/ai-datacenter-equipment(신규 slug)');
eq('api-ops-200', stOps, 200, 'GET /api/tech-reports/ai-datacenter-ops(신규 slug)');
bump('api', 3);
console.log(`[축1] data-center=${stRetired} · ai-datacenter-equipment=${stEquip} · ai-datacenter-ops=${stOps}`);

// ── 실응답 수집(추정 금지) ──────────────────────────────────────────────────────
const listRes = await fetch(`${BASE}/api/tech-reports`, { headers: AUTH });
const listBody = await listRes.json();
const REPORTS = listBody.reports || [];
console.log(`[실응답] GET /api/tech-reports → ${REPORTS.length}건: ${REPORTS.map((r) => r.slug).join(', ') || '(없음)'}`);
for (const r of REPORTS) {
  if (!TECH_NAMES[r.slug]) { console.error(`TECH_NAMES 미러에 ${r.slug} 없음 — 미러 갱신 필요. 종료.`); process.exit(1); }
}

// ── groupByCategory/관련 헬퍼 미러(techReportUtils.js 소스 직독, DOM 없이 노드에서 실행) ──────────
const UNCLASSIFIED_LABEL = '미분류';
const UNCLASSIFIED_SYM = Symbol('unclassified');
function mirrorGroupByCategory(players) {
  const list = Array.isArray(players) ? players : [];
  const catName = (p) => (typeof p?.category === 'string' && p.category.trim() !== '' ? p.category.trim() : null);
  if (!list.some((p) => catName(p) != null)) return [];
  const groups = new Map();
  for (const p of list) {
    const key = catName(p) ?? UNCLASSIFIED_SYM;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const rest = groups.get(UNCLASSIFIED_SYM);
  if (rest) { groups.delete(UNCLASSIFIED_SYM); groups.set(UNCLASSIFIED_SYM, rest); }
  return [...groups].map(([key, members]) => ({ category: key === UNCLASSIFIED_SYM ? UNCLASSIFIED_LABEL : key, players: members }));
}
const expectedLabelOf = (p) => (typeof p?.category === 'string' && p.category.trim() !== '' ? p.category.trim() : UNCLASSIFIED_LABEL);
const shareRowsOf = (players) => (players || []).filter((p) => p && Number.isFinite(p.share_pct) && p.share_pct >= 0).sort((a, b) => b.share_pct - a.share_pct);
const OVERFLOW_THRESHOLD = 100.5;
const overflowTextOf = (total) => ` · 합계 ${total.toFixed(1)}%(100% 초과 — 기준 상이 가능)`;

// ── 대상 선택(축 3~6): category 그룹이 가장 많은 판 ───────────────────────────
const catCandidates = REPORTS.map((r) => ({ rep: r, groups: mirrorGroupByCategory(r.players || []) }))
  .filter((c) => c.groups.length > 0)
  .sort((a, b) => b.groups.length - a.groups.length || a.rep.slug.localeCompare(b.rep.slug));
if (!catCandidates.length) {
  console.error('category를 가진 발행물이 하나도 없다 — 이 프로브의 전제가 성립하지 않는다. 종료(추정 폴백 없음).');
  console.error('전체 판별:', REPORTS.map((r) => `${r.slug}:groups=0`).join(' · ') || '(발행물 없음)');
  process.exit(1);
}
const PLAYER_TARGET = catCandidates[0];
console.log(`[대상 선택] PLAYER_TARGET=${PLAYER_TARGET.rep.slug} · 그룹 ${PLAYER_TARGET.groups.length}개` +
  `(${PLAYER_TARGET.groups.map((g) => `${g.category}:${g.players.length}`).join(', ')}) · players 총 ${(PLAYER_TARGET.rep.players || []).length}`);
if (!PLAYER_TARGET.rep.title) { console.error(`${PLAYER_TARGET.rep.slug}: title 부재 — identity 기대값 소스 없음. 종료.`); process.exit(1); }

// ── 대상 선택(축 7~8 점유율): PLAYER_TARGET이 겸하면 같은 페이지, 아니면 전수 탐색 ──────────────
const shareGroupsOfRep = (rep) => mirrorGroupByCategory(shareRowsOf(rep.players || []));
let SHARE_TARGET = null;
const playerTargetShareGroups = shareGroupsOfRep(PLAYER_TARGET.rep);
if (playerTargetShareGroups.length > 0) {
  SHARE_TARGET = { rep: PLAYER_TARGET.rep, groups: playerTargetShareGroups, coLocated: true };
} else {
  const shareCandidates = REPORTS.map((r) => ({ rep: r, groups: shareGroupsOfRep(r) }))
    .filter((c) => c.groups.length > 0)
    .sort((a, b) => b.groups.length - a.groups.length || a.rep.slug.localeCompare(b.rep.slug));
  if (shareCandidates.length) SHARE_TARGET = { ...shareCandidates[0], coLocated: false };
}
if (SHARE_TARGET) {
  console.log(`[대상 선택] SHARE_TARGET=${SHARE_TARGET.rep.slug}${SHARE_TARGET.coLocated ? '(=PLAYER_TARGET, 같은 페이지)' : '(별도 방문)'}` +
    ` · 그룹 ${SHARE_TARGET.groups.length}개(${SHARE_TARGET.groups.map((g) => `${g.category}:${g.players.length}`).join(', ')})`);
} else {
  console.log('[대상 선택] SHARE_TARGET 없음 — share_pct+category를 함께 가진 판이 라이브에 없다(축 7 domain-empty로 FAIL 처리).');
}
eq('share-target-domain', SHARE_TARGET ? 'OK' : 'SHARE_CATEGORY_TARGET_EMPTY', 'OK',
  SHARE_TARGET ? `${SHARE_TARGET.rep.slug}` : `후보 전수: ${REPORTS.map((r) => `${r.slug}:share=${shareRowsOf(r.players || []).length},cat=${mirrorGroupByCategory(r.players || []).length}`).join(' · ')}`);
bump('share-target-domain');

// ── 브라우저 안 측정기 ────────────────────────────────────────────────────────
const ROOT_SEL = 'main.page-wrap .page, main.page-wrap .m-page';

const measureDetail = (page) => page.evaluate((ROOT_SEL) => {
  const root = document.querySelector(ROOT_SEL);
  if (!root) return { found: false, why: 'ROOT_MISSING' };
  const h1 = root.querySelector('h1');
  const lead = root.querySelector('[data-testid="tech-report-lead"]');
  if (!h1 && !lead) return { found: false, why: 'HEADER_MISSING' };

  const txt = (el) => (el ? el.textContent.trim() : '');
  const cs = (el) => getComputedStyle(el);
  const isSR = (el) => el.closest && el.closest('.sr-only');
  const isHandled = (el) => {
    const c = cs(el);
    return c.textOverflow === 'ellipsis' || c.overflowWrap === 'anywhere' || c.overflowWrap === 'break-word';
  };

  // ⓐ 계보 분류 부재 + 목차 앵커 부재
  const catEl = root.querySelector('[data-testid="tech-report-categories"]');
  const tocChips = [...root.querySelectorAll('[data-testid="tech-toc-chip"]')].map((a) => ({ label: txt(a), href: a.getAttribute('href') }));

  // ⓑ 업체 표 — 소제목행/업체행을 문서 순서로 훑어 그룹 소속을 기록한다
  const table = root.querySelector('[data-testid="tech-report-players"]');
  const theadThCount = table ? table.querySelectorAll('thead th').length : 0;
  const tbody = table ? table.querySelector('tbody') : null;
  const trs = tbody ? [...tbody.children] : [];
  const groupRows = [];
  const playerRowAssign = [];
  let curGroupLabel = null;
  let orphanCount = 0;
  for (const tr of trs) {
    const testid = tr.getAttribute('data-testid');
    if (testid === 'tech-report-player-group') {
      const td = tr.children[0];
      curGroupLabel = td ? td.textContent.trim() : '';
      groupRows.push({ label: curGroupLabel, colSpan: td ? td.colSpan : null, tr });
    } else if (testid === 'tech-report-player-row') {
      const nameEl = tr.querySelector('[data-testid="tech-report-player-name"]');
      const name = nameEl ? nameEl.textContent.trim() : null;
      if (curGroupLabel == null) orphanCount += 1;
      playerRowAssign.push({ name, group: curGroupLabel, tr });
    }
    // note행(tech-report-player-note)은 무시 — 그룹 소속을 바꾸지 않는다
  }
  const padTopOf = (tr) => { const td = tr.children[0]; return td ? parseFloat(cs(td).paddingTop) : null; };
  const groupPadTops = groupRows.map((g) => padTopOf(g.tr));
  const normalPadTops = playerRowAssign.map((p) => padTopOf(p.tr)).filter((v) => v != null);
  const firstRowOfGroup = (label) => playerRowAssign.find((p) => p.group === label);
  const styleDiffs = groupRows.map((g) => {
    const gTd = g.tr.children[0];
    const first = firstRowOfGroup(g.label);
    const pTd = first ? first.tr.children[0] : null;
    if (!gTd || !pTd) return { label: g.label, diffs: [], reason: 'ROW_MISSING' };
    const gcs = cs(gTd), pcs = cs(pTd);
    const diffs = [];
    if (gcs.backgroundColor !== pcs.backgroundColor) diffs.push('bg');
    if (gcs.fontWeight !== pcs.fontWeight) diffs.push('fontWeight');
    if (gcs.borderBottomWidth !== pcs.borderBottomWidth || gcs.borderBottomColor !== pcs.borderBottomColor) diffs.push('border');
    return { label: g.label, diffs };
  });

  // 점유율 — 그룹 모드/평면 모드 둘 다 측정(그룹 0개면 평면)
  const shareEl = root.querySelector('[data-testid="tech-share-chart"]');
  const firstTextOf = (el) => {
    for (const n of el.childNodes) { if (n.nodeType === 3 && n.textContent.trim() !== '') return n.textContent.trim(); }
    return '';
  };
  const shareGroupEls = shareEl ? [...shareEl.querySelectorAll('[data-testid="tech-share-chart-group"]')] : [];
  const shareGroups = shareGroupEls.map((g) => {
    const labelDiv = g.children[0];
    return {
      label: labelDiv ? firstTextOf(labelDiv) : '',
      fullText: labelDiv ? labelDiv.textContent.trim() : '',
      rows: g.querySelectorAll('[data-testid="tech-share-chart-row"]').length,
    };
  });
  const shareFlatRows = shareEl ? shareEl.querySelectorAll(':scope > [data-testid="tech-share-chart-row"]').length : 0;

  // 넘침 2계열(정의역 = root 본문 전체)
  const all = [...root.querySelectorAll('*')].filter((el) => !isSR(el));
  const leafCandidates = all.filter((el) => el.children.length === 0 && el.textContent.trim() !== '');
  const leafOver = leafCandidates.filter((el) => el.scrollWidth > el.clientWidth + 1 && !isHandled(el))
    .map((el) => `${el.tagName.toLowerCase()}:"${el.textContent.trim().slice(0, 24)}"(${el.scrollWidth}>${el.clientWidth})`);
  const hiddenCandidates = all.filter((el) => cs(el).overflow === 'hidden');
  const hiddenOver = hiddenCandidates.filter((el) => el.scrollWidth > el.clientWidth + 1 && !isHandled(el))
    .map((el) => `${el.tagName.toLowerCase()}[testid=${el.getAttribute('data-testid')}](${el.scrollWidth}>${el.clientWidth})`);

  return {
    found: true,
    h1Text: txt(h1) || null,
    leadText: txt(lead) || null,
    hasCategoriesSection: !!catEl,
    tocChips,
    theadThCount,
    groupRows: groupRows.map((g) => ({ label: g.label, colSpan: g.colSpan })),
    playerRows: playerRowAssign.map((p) => ({ name: p.name, group: p.group })),
    orphanCount,
    groupPadTops, normalPadTops, styleDiffs,
    hasShareSection: !!shareEl,
    shareGroups, shareFlatRows,
    leafDomain: leafCandidates.length, leafOver,
    hiddenDomain: hiddenCandidates.length, hiddenOver,
    docScrollW: document.documentElement.scrollWidth,
    docClientW: document.documentElement.clientWidth,
  };
}, ROOT_SEL);

// ── 뷰포트×테마 4조합(가장 좁은 폭에 다크를 물려 최악 조합을 반드시 포함) ─────────────────────
const VIEWS = [
  { key: 'pc1440-light', theme: 'light', opts: { viewport: { width: 1440, height: 1000 } } },
  { key: 'pc1440-dark', theme: 'dark', opts: { viewport: { width: 1440, height: 1000 } } },
  { key: 'm390-light', theme: 'light', opts: { ...devices['iPhone 13'] } },
  { key: 'm350-dark', theme: 'dark', opts: { viewport: { width: 350, height: 700 } } },
];

const browser = await chromium.launch();

function newCtx(opts, theme) {
  return browser.newContext({ ...opts, serviceWorkers: 'block' }).then(async (ctx) => {
    await ctx.addInitScript(([a, r, th]) => {
      localStorage.setItem('access_token', a);
      localStorage.setItem('refresh_token', r);
      localStorage.setItem('theme', th);
      localStorage.setItem('pwa-install-dismissed-at', String(Date.now()));
    }, [access_token, refresh_token, theme]);
    return ctx;
  });
}

async function settle(page) {
  await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0).catch(() => {});
  await page.waitForTimeout(800);
}

// ══ 축 2 — 목록 화면(뷰포트 무관 축, 1회) ══════════════════════════════════════
{
  const ctx = await newCtx(VIEWS[0].opts, 'light');
  const page = await ctx.newPage();
  await page.goto(`${BASE}/tech-reports`, { waitUntil: 'networkidle' }).catch((e) => console.log(`  goto 실패: ${e}`));
  await settle(page);
  const m = await page.evaluate((ROOT_SEL) => {
    const root = document.querySelector(ROOT_SEL);
    if (!root) return { found: false };
    const cards = [...root.querySelectorAll('[data-testid="tech-report-card"]')];
    return { found: true, total: cards.length, labels: cards.map((c) => (c.children[0] ? c.children[0].textContent.trim() : '')) };
  }, ROOT_SEL);
  eq('list-domain', m.found ? 'OK' : 'LIST_MISSING', 'OK');
  bump('list');
  if (m.found) {
    eq('list-count', m.total, REPORTS.length, `카드 ${m.total} vs API reports ${REPORTS.length}`);
    const dcCards = m.labels.filter((l) => l === '데이터 센터');
    eq('list-datacenter-absent', dcCards, [], `라벨 전수=${JSON.stringify(m.labels)}`);
    bump('list', 2);
    console.log(`[축2] 카드 ${m.total}장 · 라벨=${JSON.stringify(m.labels)}`);
  }
  await page.screenshot({ path: `${OUT}/list.png`, fullPage: false });
  await page.close();
  await ctx.close();
}

// ══ 축 3~6, 8(업체 표), 9, 10 — PLAYER_TARGET 상세(4뷰포트) ═════════════════════
// 축 7~8(점유율)도 PLAYER_TARGET이 SHARE_TARGET을 겸하면 같은 방문에서 함께 잰다.
const catExpectedLabels = new Set(PLAYER_TARGET.groups.map((g) => g.category));
const catExpectedCountByLabel = new Map(PLAYER_TARGET.groups.map((g) => [g.category, g.players.length]));
const catExpectedTotal = (PLAYER_TARGET.rep.players || []).length;
const nameToExpectedLabel = new Map((PLAYER_TARGET.rep.players || []).map((p) => [p.name, expectedLabelOf(p)]));

for (const V of VIEWS) {
  const ctx = await newCtx(V.opts, V.theme);
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errs.push(msg.text()); });
  page.on('pageerror', (e) => errs.push(String(e)));

  const tag = `${V.key}/${PLAYER_TARGET.rep.slug}`;
  await page.goto(`${BASE}/tech-report/${PLAYER_TARGET.rep.slug}`, { waitUntil: 'networkidle' }).catch((e) => errs.push(`goto:${e}`));
  await settle(page);

  let m = await measureDetail(page);
  if (!m.found) {
    console.log(`  (재시도) ${tag} — 본문 미검출(${m.why}), 1.8s 대기 후 재측정`);
    await page.waitForTimeout(1800);
    m = await measureDetail(page);
  }
  eq(`page-domain:${tag}`, m.found ? 'PRESENT' : `PAGE_MISSING(${m.why})`, 'PRESENT');
  bump('page');

  if (!m.found) {
    eq(`console:${tag}`, errs, [], '측정 불가 화면');
    bump('console');
    await page.screenshot({ path: `${OUT}/${V.key}-${PLAYER_TARGET.rep.slug}-fail.png`, fullPage: false });
    await page.close();
    await ctx.close();
    continue;
  }

  // ── identity(판정축보다 먼저) ──
  eq(`identity-h1:${tag}`, m.h1Text ?? 'H1_MISSING', TECH_NAMES[PLAYER_TARGET.rep.slug], '기술명(TECH_NAMES 미러)');
  eq(`identity-lead:${tag}`, m.leadText ?? 'LEAD_MISSING', PLAYER_TARGET.rep.title, `리드 = API title`);
  bump('identity', 2);

  // ══ 축 3 — 계보 분류 부재(ⓐ) ══
  eq(`categories-section-absent:${tag}`, m.hasCategoriesSection ? 'UNEXPECTED_SECTION' : 'ABSENT', 'ABSENT');
  const tocHasCategories = m.tocChips.some((c) => c.href === '#categories' || c.label === '계보 분류');
  eq(`categories-toc-absent:${tag}`, tocHasCategories ? 'UNEXPECTED_TOC_CHIP' : 'ABSENT', 'ABSENT', `목차=${JSON.stringify(m.tocChips)}`);
  bump('categories-absent', 2);

  // ══ 축 4 — 업체 표 소제목행 ══
  eq(`player-group-domain:${tag}`, m.groupRows.length > 0 ? 'OK' : 'GROUP_ROWS_EMPTY', 'OK', `소제목행 ${m.groupRows.length}개`);
  eq(`player-group-count:${tag}`, m.groupRows.length, PLAYER_TARGET.groups.length,
    `렌더 라벨=${JSON.stringify(m.groupRows.map((g) => g.label))} · 기대 라벨=${JSON.stringify([...catExpectedLabels])}`);
  eq(`player-group-labelset:${tag}`, [...new Set(m.groupRows.map((g) => g.label))].sort(), [...catExpectedLabels].sort(), '렌더 라벨 집합 == 기대 라벨 집합');
  eq(`player-group-colspan:${tag}`, m.groupRows.filter((g) => g.colSpan !== m.theadThCount).map((g) => `${g.label}:colSpan=${g.colSpan}`), [],
    `헤더 th ${m.theadThCount}개`);
  bump('player-group', m.groupRows.length + 3);

  // ══ 축 5 — 업체 행 총수(미분류 포함, 그룹핑으로 업체가 사라지지 않는다) ══
  eq(`player-row-total-domain:${tag}`, catExpectedTotal > 0 ? 'OK' : 'PLAYERS_DOMAIN_EMPTY', 'OK', `API players ${catExpectedTotal}`);
  eq(`player-row-total:${tag}`, m.playerRows.length, catExpectedTotal, `렌더 행 ${m.playerRows.length}`);
  bump('player-row-total', 2);

  // ══ 축 6 — 배정 대조(개수만 맞고 배정이 틀려도 통과하는 것을 막는다) ══
  const joinMiss = m.playerRows.filter((p) => p.name == null || !nameToExpectedLabel.has(p.name)).map((p) => p.name);
  eq(`player-assign-join-domain:${tag}`, joinMiss, [], '렌더된 업체명 ↔ API players 이름 조인');
  const mismatches = m.playerRows
    .filter((p) => p.name != null && nameToExpectedLabel.has(p.name))
    .filter((p) => p.group !== nameToExpectedLabel.get(p.name))
    .map((p) => `${p.name}: 렌더=${p.group} 기대=${nameToExpectedLabel.get(p.name)}`);
  eq(`player-assign:${tag}`, mismatches, [], `${m.playerRows.length}행 대조 · orphan(소제목 없는 행) ${m.orphanCount}`);
  bump('player-assign', 2);

  // ══ 축 8(업체 표 부분) — 시각 ══
  const emptyGroupLabels = m.groupRows.filter((g) => g.label.trim() === '').length;
  eq(`visual-player-empty-label:${tag}`, emptyGroupLabels, 0, `소제목 ${m.groupRows.length}개 중 빈 텍스트`);
  const styleUndiffed = m.styleDiffs.filter((d) => d.diffs.length === 0).map((d) => `${d.label}(${d.reason || 'NO_DIFF'})`);
  eq(`visual-player-style-diff:${tag}`, styleUndiffed, [], `${m.styleDiffs.length}개 그룹 · 실측=${JSON.stringify(m.styleDiffs)}`);
  const minGroupPad = m.groupPadTops.length ? Math.min(...m.groupPadTops) : null;
  const maxNormalPad = m.normalPadTops.length ? Math.max(...m.normalPadTops) : null;
  eq(`visual-player-gap-domain:${tag}`, (minGroupPad != null && maxNormalPad != null) ? 'OK' : `GAP_DOMAIN_EMPTY(group=${m.groupPadTops.length},normal=${m.normalPadTops.length})`, 'OK');
  eq(`visual-player-gap:${tag}`, (minGroupPad != null && maxNormalPad != null && minGroupPad > maxNormalPad) ? 'OK' : `GAP_NOT_GREATER(groupMin=${minGroupPad},normalMax=${maxNormalPad})`, 'OK',
    `그룹 padTop=${JSON.stringify(m.groupPadTops)} · 행 padTop=${JSON.stringify([...new Set(m.normalPadTops)])}`);
  bump('visual-player', 4);

  // ══ 축 9 — 회귀(4뷰포트) ══
  eq(`page-h-scroll:${tag}`, m.docScrollW <= m.docClientW + 1 ? 'OK' : `HSCROLL(${m.docScrollW}>${m.docClientW})`, 'OK');
  eq(`overflow-leaf-domain:${tag}`, m.leafDomain > 0 ? 'OK' : 'DOMAIN_EMPTY', 'OK', `leaf후보 ${m.leafDomain}개`);
  eq(`overflow-leaf:${tag}`, m.leafOver, [], `leaf ${m.leafDomain}개 대조`);
  eq(`overflow-hidden:${tag}`, m.hiddenOver, [], `hidden컨테이너 후보 ${m.hiddenDomain}개(콘텐츠 의존, sentinel 없음) 대조`);
  bump('page-h-scroll');
  bump('overflow-leaf', 1 + m.leafDomain);
  bump('overflow-hidden', 1 + m.hiddenDomain);

  eq(`console:${tag}`, errs, [], '');
  bump('console');

  // ══ 축 7~8(점유율) — SHARE_TARGET이 이 페이지와 같으면 여기서 잰다 ══
  if (SHARE_TARGET && SHARE_TARGET.coLocated) {
    const expectedShareLabels = new Set(SHARE_TARGET.groups.map((g) => g.category));
    const expectedShareCountByLabel = new Map(SHARE_TARGET.groups.map((g) => [g.category, g.players.length]));
    eq(`share-group-domain:${tag}`, m.shareGroups.length > 0 ? 'OK' : `SHARE_GROUPS_EMPTY(flat=${m.shareFlatRows})`, 'OK', `점유율 그룹 ${m.shareGroups.length}개`);
    eq(`share-group-count:${tag}`, m.shareGroups.length, SHARE_TARGET.groups.length,
      `렌더 라벨=${JSON.stringify(m.shareGroups.map((g) => g.label))} · 기대=${JSON.stringify([...expectedShareLabels])}`);
    const shareCountMiss = m.shareGroups.filter((g) => g.rows !== expectedShareCountByLabel.get(g.label)).map((g) => `${g.label}:렌더=${g.rows},기대=${expectedShareCountByLabel.get(g.label)}`);
    eq(`share-group-rows:${tag}`, shareCountMiss, [], '그룹별 막대 수 == groupByCategory 그룹별 업체 수');
    // Σ 경고 — 그룹 내 합으로 판정되는가(전역 합이 아니다, ⓑ의 핵심)
    let globalTotal = 0;
    const overflowMiss = [];
    for (const g of SHARE_TARGET.groups) {
      const groupTotal = g.players.reduce((s, p) => s + p.share_pct, 0);
      globalTotal += groupTotal;
      const expectOverflow = groupTotal > OVERFLOW_THRESHOLD;
      const rendered = m.shareGroups.find((r) => r.label === g.category);
      const gotOverflow = rendered ? rendered.fullText.includes('초과') : null;
      if (gotOverflow !== expectOverflow) overflowMiss.push(`${g.category}: groupTotal=${groupTotal.toFixed(1)} 기대overflow=${expectOverflow} 렌더=${gotOverflow}`);
    }
    eq(`share-overflow-per-group:${tag}`, overflowMiss, [],
      `그룹별 합=${JSON.stringify(SHARE_TARGET.groups.map((g) => `${g.category}:${g.players.reduce((s, p) => s + p.share_pct, 0).toFixed(1)}`))} · 전역합=${globalTotal.toFixed(1)}` +
      (globalTotal > OVERFLOW_THRESHOLD && SHARE_TARGET.groups.every((g) => g.players.reduce((s, p) => s + p.share_pct, 0) <= OVERFLOW_THRESHOLD)
        ? ' [이빨 관측: 전역합>100.5인데 그룹별은 전부 이하 — 옛 전역판정과 신 그룹판정이 실제로 갈리는 표본]'
        : ' [이 표본에서는 전역합/그룹합 판정이 우연히 같을 수 있음 — 커버리지 로그 참조]'));
    bump('share-group', 4);
    rawLog.push(`${tag} · 점유율 그룹 ${m.shareGroups.length}개 · ${JSON.stringify(m.shareGroups)}`);
  }

  rawLog.push(`${tag} · 소제목 ${m.groupRows.length}개 · 업체행 ${m.playerRows.length} · orphan ${m.orphanCount}` +
    ` · padTop group=${JSON.stringify(m.groupPadTops)} normal=${JSON.stringify([...new Set(m.normalPadTops)])}` +
    ` · overflow leaf=${m.leafOver.length}/${m.leafDomain} hidden=${m.hiddenOver.length}/${m.hiddenDomain}` +
    ` · docHscroll=${m.docScrollW}/${m.docClientW}`);

  // ══ 축 10 — 육안 캡처(top + 업체표 scrollIntoView, fullPage 없음) ══
  await page.screenshot({ path: `${OUT}/${V.key}-top.png`, fullPage: false });
  const playersLoc = page.locator('[data-testid="tech-report-players"]').first();
  if (await playersLoc.count()) {
    await playersLoc.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/${V.key}-players.png`, fullPage: false });
  }
  const shareLoc = page.locator('[data-testid="tech-share-chart"]').first();
  if (await shareLoc.count()) {
    await shareLoc.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/${V.key}-share.png`, fullPage: false });
  }

  await page.close();
  await ctx.close();
}

// ══ 축 7~8(점유율) — SHARE_TARGET이 PLAYER_TARGET과 다른 판이면 별도 방문으로 보강 ══
if (SHARE_TARGET && !SHARE_TARGET.coLocated) {
  const expectedShareLabels = new Set(SHARE_TARGET.groups.map((g) => g.category));
  const expectedShareCountByLabel = new Map(SHARE_TARGET.groups.map((g) => [g.category, g.players.length]));
  for (const V of VIEWS) {
    const ctx = await newCtx(V.opts, V.theme);
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    const tag = `${V.key}/${SHARE_TARGET.rep.slug}(share별도방문)`;
    await page.goto(`${BASE}/tech-report/${SHARE_TARGET.rep.slug}`, { waitUntil: 'networkidle' }).catch((e) => errs.push(`goto:${e}`));
    await settle(page);
    let m = await measureDetail(page);
    if (!m.found) { await page.waitForTimeout(1800); m = await measureDetail(page); }
    eq(`page-domain:${tag}`, m.found ? 'PRESENT' : `PAGE_MISSING(${m.why})`, 'PRESENT');
    bump('page');
    if (m.found) {
      eq(`share-group-domain:${tag}`, m.shareGroups.length > 0 ? 'OK' : `SHARE_GROUPS_EMPTY(flat=${m.shareFlatRows})`, 'OK', `점유율 그룹 ${m.shareGroups.length}개`);
      eq(`share-group-count:${tag}`, m.shareGroups.length, SHARE_TARGET.groups.length,
        `렌더 라벨=${JSON.stringify(m.shareGroups.map((g) => g.label))} · 기대=${JSON.stringify([...expectedShareLabels])}`);
      const shareCountMiss = m.shareGroups.filter((g) => g.rows !== expectedShareCountByLabel.get(g.label)).map((g) => `${g.label}:렌더=${g.rows},기대=${expectedShareCountByLabel.get(g.label)}`);
      eq(`share-group-rows:${tag}`, shareCountMiss, [], '그룹별 막대 수 == groupByCategory 그룹별 업체 수');
      let globalTotal = 0;
      const overflowMiss = [];
      for (const g of SHARE_TARGET.groups) {
        const groupTotal = g.players.reduce((s, p) => s + p.share_pct, 0);
        globalTotal += groupTotal;
        const expectOverflow = groupTotal > OVERFLOW_THRESHOLD;
        const rendered = m.shareGroups.find((r) => r.label === g.category);
        const gotOverflow = rendered ? rendered.fullText.includes('초과') : null;
        if (gotOverflow !== expectOverflow) overflowMiss.push(`${g.category}: groupTotal=${groupTotal.toFixed(1)} 기대overflow=${expectOverflow} 렌더=${gotOverflow}`);
      }
      eq(`share-overflow-per-group:${tag}`, overflowMiss, [], `그룹별 합=${JSON.stringify(SHARE_TARGET.groups.map((g) => g.category))} · 전역합=${globalTotal.toFixed(1)}`);
      bump('share-group', 4);
      const emptyShareLabels = m.shareGroups.filter((g) => g.label.trim() === '').length;
      eq(`visual-share-empty-label:${tag}`, emptyShareLabels, 0, `점유율 소라벨 ${m.shareGroups.length}개 중 빈 텍스트`);
      bump('visual-share-empty-label');
      eq(`page-h-scroll:${tag}`, m.docScrollW <= m.docClientW + 1 ? 'OK' : `HSCROLL(${m.docScrollW}>${m.docClientW})`, 'OK');
      bump('page-h-scroll');
      await page.screenshot({ path: `${OUT}/${V.key}-sharetarget-top.png`, fullPage: false });
      const shareLoc = page.locator('[data-testid="tech-share-chart"]').first();
      if (await shareLoc.count()) {
        await shareLoc.scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(200);
        await page.screenshot({ path: `${OUT}/${V.key}-sharetarget-share.png`, fullPage: false });
      }
      rawLog.push(`${tag} · 점유율 그룹 ${m.shareGroups.length}개(별도 방문) · ${JSON.stringify(m.shareGroups)}`);
    }
    eq(`console:${tag}`, errs, [], '');
    bump('console');
    await page.close();
    await ctx.close();
  }
} else if (!SHARE_TARGET) {
  // domain sentinel(share-target-domain)이 이미 FAIL시켰으므로 여기서 추가 단언은 불필요 —
  // 다만 뷰포트별 커버리지 총계가 줄지 않게 4회분 no-op 표시만 로그로 남긴다(단언 아님).
  for (const V of VIEWS) rawLog.push(`${V.key} · share 축 — SHARE_TARGET 없음(share-target-domain이 이미 FAIL)`);
}

await browser.close();

// ── 전역 이빨 단언 — 축 4/6/7이 최소 2개 이상 그룹을 실제로 관측했는가(1그룹뿐이면 그룹핑 vs
//    미분류-단일버킷을 구별하지 못한다) ──────────────────────────────────────────
eq('player-group-teeth', PLAYER_TARGET.groups.length >= 2 ? 'OK' : `TOO_FEW_GROUPS(${PLAYER_TARGET.groups.length})`, 'OK',
  `PLAYER_TARGET(${PLAYER_TARGET.rep.slug}) 그룹 ${PLAYER_TARGET.groups.length}개`);
bump('player-group-teeth');

// ── 보고 ──────────────────────────────────────────────────────────────────────
const fails = results.filter((r) => !r.ok);
console.log('\n' + '═'.repeat(78));
console.log('커버리지 (계열별 검사 수 — 재실행 간 비교용, 줄면 통과가 아니라 측정 실패):');
for (const [k, v] of Object.entries(cov).sort()) console.log(`  ${k.padEnd(28)} ${v}`);
console.log(`  ${'(합계)'.padEnd(28)} ${Object.values(cov).reduce((a, b) => a + b, 0)}`);
console.log(`\n단언 총계: ${results.length}건 · PASS ${results.length - fails.length} · FAIL ${fails.length}`);
console.log(`대상: PLAYER_TARGET=${PLAYER_TARGET.rep.slug}(그룹 ${PLAYER_TARGET.groups.length}) · SHARE_TARGET=${SHARE_TARGET ? SHARE_TARGET.rep.slug : '없음'}`);
console.log('\n원시 실측(단언 아님):');
for (const l of rawLog) console.log(`  ${l}`);
console.log(`\n※ 육안 캡처 ${OUT}/ — {view}-{top|players|share}.png`);
console.log('═'.repeat(78));
fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({
  cov, results,
  playerTarget: PLAYER_TARGET.rep.slug, shareTarget: SHARE_TARGET ? SHARE_TARGET.rep.slug : null,
  reportsAtRun: REPORTS.map((r) => r.slug),
}, null, 2));
if (fails.length) {
  console.log('\nFAIL 상세:');
  for (const f of fails) console.log(`  ✗ ${f.tag}\n      ${f.msg}`);
  process.exit(1);
}
console.log(`\nALL PASS ${results.length}/${results.length}`);
