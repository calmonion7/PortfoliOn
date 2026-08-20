// fg-loop(task#319·320·321) 정지조건 프로브 — **루프 소유의 독립 객관 체커**.
//
// 왜 태스크 프로브와 별도인가: 각 태스크의 S5/S6는 자기 프로브(uat276·280·281·282·296·298·299·301)에
// 축을 *추가*한다. 그러면 maker와 checker가 같은 드라이브가 되어 「자기가 짠 축으로 자기를 판정」한다.
// 이 파일은 착수 시점(구현 0줄)에 작성돼 목표 *결과*만 재므로, 구현이 축을 느슨하게 고르는 것을
// 원리적으로 막는다. 그래서 이 파일은 드라이브 중 **수정하지 않는다**(수정하면 독립성이 사라진다 —
// 셀렉터 계약이 틀렸음이 실측되면 그 사실을 loop.md에 적고 사람에게 fork로 넘긴다).
//
// 계약(이 파일이 못박는 DOM 인터페이스 — 구현은 이 이름을 써야 한다):
//   기존 : [data-tech-section]  ·  [data-testid="tech-toc-chip"]
//   신규 : [data-tech-chapter="overview|market-competition|progress-risk|evidence"]  (task#319 장 라벨)
//          [data-tech-comp-root]                                                     (task#320 뿌리·분모)
//          [data-tech-comp-item][data-share][data-comp-kind="ramp|other"]            (task#320 항목별 막대)
//          [data-tech-comp-bar]                                                      (task#320 막대 자체)
//          [data-tech-chapter-nav] > [data-tech-chapter-nav-chip][data-chapter][data-active] (task#321)
//
// 착수 실측(2026-08-20, GET /api/tech-reports/{slug}) — 기대값은 전부 여기서 계산하고 리터럴을 박지 않는다:
//   발행 7종 전부가 composition.tech를 보유(4~6항목 · share_pct Σ=100 · 5% 그리드).
//   「기타」 2판 — semiconductor-equipment `기타`(정확일치) · solid-state-battery `기타(팩·BMS·안전 통합)`
//     (접두일치만 잡는다 — 계획 #320의 startsWith 주장이 실측으로 참).
//   같은 지분 쌍 실재 — semiconductor-equipment 15×2 · robotics 25×2 · smr 20×2
//     (그래서 「색은 순위가 아니라 값에서」가 관측 가능한 구별이 된다).
//   related 4키는 대체로 채워져 있고 semiconductor-equipment.competitors만 0(빈 키 분기 표본).
//
// 판정 규율(이 저장소의 프로브 규약 준수):
//   · 조건부 단언 금지 — 축마다 *-domain sentinel을 둬 표본 0을 FAIL로 만든다(task#318 ⓨ:
//     신규 축이 「표본 0 — 미검증」으로 공허 통과하던 실측 결함).
//   · 리터럴 기대값 금지 — 섹션 표시 여부·항목 수·지분은 실응답에서 계산한다.
//   · identity 축을 먼저 둔다 — 판정축이 대상과 독립이면 틀린 페이지 위에서도 통과한다.
//   · 선재 결함 수입 금지(task#316) — m350 넘침 축은 「내가 만든 요소가 범인인가」로 좁힌다.
//     업체 표의 선재 넘침 3/7종(task#311 박제)은 이 프로브의 exit 코드를 죽이지 않는다.
//   · 이빨 — 섹션 순서 축은 「옛 순서와 다르다」를 쌍으로 단언해 no-op이 통과하지 못하게 한다.
import { chromium, devices } from 'playwright';

const BASE = 'https://portfolion.taebro.com';

const results = [];
const P = (ok, tag, msg) => results.push({ ok, tag, msg });
const cov = {};
const bump = (k, n = 1) => { cov[k] = (cov[k] || 0) + n; };
const eq = (tag, got, want, note = '') => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  P(ok, tag, `${ok ? 'PASS' : 'FAIL'} — got=${JSON.stringify(got)} want=${JSON.stringify(want)}${note ? ' · ' + note : ''}`);
};
const ok_ = (tag, cond, note) => P(!!cond, tag, `${cond ? 'PASS' : 'FAIL'} — ${note}`);

// ── 로그인(유계 재시도 — 계측 실패를 판정 실패로 읽지 않는다, task#316 부수) ─────────────
let access_token = null, refresh_token = null;
for (let i = 1; i <= 3 && !access_token; i++) {
  try {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
    });
    const j = await r.json();
    access_token = j.access_token; refresh_token = j.refresh_token;
  } catch (e) { console.log(`  (로그인 재시도 ${i}/3) ${e}`); await new Promise((s) => setTimeout(s, 2000)); }
}
if (!access_token) { console.error('로그인 3회 실패 — 계측 불가(판정 아님). 종료.'); process.exit(2); }

// ── 목표 계약 상수 ───────────────────────────────────────────────────────────
const TARGET_ORDER = ['key-points', 'variants', 'related', 'market', 'players', 'share',
  'milestones', 'challenges', 'watch-items', 'prose', 'sources'];
const OLD_ORDER = ['key-points', 'milestones', 'players', 'variants', 'share', 'challenges',
  'watch-items', 'market', 'related', 'prose', 'sources'];
const CHAPTERS = [
  { key: 'overview', label: '개요', ids: ['key-points', 'variants', 'related'] },
  { key: 'market-competition', label: '시장·경쟁', ids: ['market', 'players', 'share'] },
  { key: 'progress-risk', label: '진척·리스크', ids: ['milestones', 'challenges', 'watch-items'] },
  { key: 'evidence', label: '근거', ids: ['prose', 'sources'] },
];
const RELATED_LABEL = '구성과 연관';   // task#320 — 섹션 제목 개명
// 목차 칩 텍스트의 정본 — SECTIONS 배열의 label(현행 소스 직독 + related만 개명 반영)
const LABELS = {
  'key-points': '핵심 포인트', variants: '계열 비교', related: RELATED_LABEL,
  market: '시장 규모', players: '주요 업체', share: '점유율',
  milestones: '진척 타임라인', challenges: '해결해야 할 난제', 'watch-items': '확인할 지표',
  prose: '상세 설명', sources: '출처',
};
const OTHER_PREFIX = '기타';           // 잔여분 식별은 접두일치(정확일치는 조용히 오분류한다)

// WCAG 상대휘도 대비비 — 램프의 가장 연한 막대가 트랙 위에서 실제로 보이는지 재기 위한 것.
// 계획 #320이 검산에 한 번 반박당해 재조정한 값(라이트 1.49:1 · 다크 2.07:1)의 하한 1.4를 지킨다.
const parseRGB = (s) => {
  const m = /rgba?\(([^)]+)\)/.exec(s || '');
  if (!m) return null;
  const p = m[1].split(',').map((x) => parseFloat(x.trim()));
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
};
const lum = (c) => {
  const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
};
// 알파 합성 — 트랙이 알파 0.11 같은 반투명이면 배경 위에 합성한 실효색으로 재야 한다
const over = (fg, bg) => (fg.a >= 1 ? fg : {
  r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1,
});
const contrast = (aStr, bStr, pageBgStr) => {
  const a = parseRGB(aStr), b = parseRGB(bStr), pg = parseRGB(pageBgStr) || { r: 255, g: 255, b: 255, a: 1 };
  if (!a || !b) return null;
  const la = lum(over(a, pg)), lb = lum(over(b, pg));
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
};

// DoD 3종의 slug 합집합 — #319{robotics,ssb,adc-eq} ∪ #320{semi-eq,ssb,robotics} ∪ #321{robotics,ssb,adc-eq}
const SLUGS = ['semiconductor-equipment', 'solid-state-battery', 'robotics', 'ai-datacenter-equipment'];

// ── 실응답 수집(GET만·무쓰기) ────────────────────────────────────────────────
const DATA = {};
for (const slug of SLUGS) {
  let body = null;
  for (let i = 1; i <= 3 && !body; i++) {
    try {
      const res = await fetch(`${BASE}/api/tech-reports/${slug}`, { headers: { Authorization: `Bearer ${access_token}` } });
      body = await res.json();
    } catch (e) { console.log(`  (응답 재시도 ${i}/3) ${slug}: ${e}`); await new Promise((s) => setTimeout(s, 1500)); }
  }
  const rep = (body && (body.reports || [])[0]) || null;
  if (!rep) { console.error(`발행물 없음 — /api/tech-reports/${slug}. 계측 불가. 종료.`); process.exit(2); }
  const comp = ((rep.composition || {}).tech) || [];
  DATA[slug] = {
    rep,
    comp,
    compNames: comp.map((t) => t.name),
    compShares: comp.map((t) => Number(t.share_pct)),
    related: rep.related || {},
  };
  console.log(`  [실응답] ${slug}: composition ${comp.length}항목 [${comp.map((t) => `${t.name}=${t.share_pct}`).join(' | ')}]`
    + ` · related ${Object.entries(rep.related || {}).map(([k, v]) => `${k}:${(v || []).length}`).join(' ')}`);
}

const VIEWS = [
  { key: 'm390-light', theme: 'light', pc: false, opts: { ...devices['iPhone 13'] } },
  { key: 'm350-dark', theme: 'dark', pc: false, opts: { viewport: { width: 350, height: 700 } } },
  { key: 'pc1440-light', theme: 'light', pc: true, opts: { viewport: { width: 1440, height: 1000 } } },
];

// ── 브라우저 안 측정기 ───────────────────────────────────────────────────────
const measure = async (page) => page.evaluate(() => {
  const vis = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && (r.width > 0 || r.height > 0);
  };
  const secs = [...document.querySelectorAll('[data-tech-section]')].filter(vis);
  const chips = [...document.querySelectorAll('[data-testid="tech-toc-chip"]')].filter(vis);
  const chapEls = [...document.querySelectorAll('[data-tech-chapter]')].filter(vis);
  const compItems = [...document.querySelectorAll('[data-tech-comp-item]')].filter(vis);
  const compRoot = document.querySelector('[data-tech-comp-root]');

  // 장 라벨의 문서 순서상 다음 섹션 = 그 라벨이 여는 장의 첫 섹션이어야 한다
  const docOrder = [...document.querySelectorAll('[data-tech-section],[data-tech-chapter]')].filter(vis);
  const labelFollowedBy = chapEls.map((el) => {
    const i = docOrder.indexOf(el);
    for (let j = i + 1; j < docOrder.length; j++) {
      if (docOrder[j].hasAttribute('data-tech-section')) return docOrder[j].getAttribute('data-tech-section');
    }
    return null;
  });

  return {
    sectionOrder: secs.map((el) => el.getAttribute('data-tech-section')),
    tocTexts: chips.map((el) => (el.textContent || '').trim()),
    chapterKeys: chapEls.map((el) => el.getAttribute('data-tech-chapter')),
    chapterTexts: chapEls.map((el) => (el.textContent || '').trim()),
    labelFollowedBy,
    comp: compItems.map((el) => {
      const bar = el.querySelector('[data-tech-comp-bar]');
      const er = el.getBoundingClientRect();
      const pr = el.parentElement ? el.parentElement.getBoundingClientRect() : er;
      // 트랙 색 = 막대의 부모 배경(투명이면 조상으로 올라가며 첫 불투명색을 찾는다 —
      // 알파 합성 없이 rgba(0,0,0,0)과 대비를 재면 무의미한 값이 나온다)
      let trackColor = null;
      if (bar) {
        let p = bar.parentElement;
        while (p) {
          const bg = getComputedStyle(p).backgroundColor;
          if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') { trackColor = bg; break; }
          p = p.parentElement;
        }
      }
      return {
        share: Number(el.getAttribute('data-share')),
        kind: el.getAttribute('data-comp-kind'),
        name: (el.getAttribute('data-comp-name') || el.textContent || '').trim(),
        barColor: bar ? getComputedStyle(bar).backgroundColor : null,
        barBg: bar ? getComputedStyle(bar.parentElement || bar).backgroundColor : null,
        trackColor,
        overflowRight: Math.round(er.right - pr.right),
      };
    }),
    compRootText: compRoot ? (compRoot.textContent || '').trim() : null,
    // 링크 칩(경계) — related 섹션 안의 <a> 칩과 그 탭 타깃 높이
    relLinks: [...document.querySelectorAll('[data-tech-section="related"] a[href^="/tech-report/"]')]
      .filter(vis).map((a) => ({ text: (a.textContent || '').trim(), h: Math.round(a.getBoundingClientRect().height) })),
    docScroll: { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth },
    pageBg: getComputedStyle(document.body).backgroundColor,
  };
});

const measureNav = async (page) => page.evaluate(() => {
  const vis = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && r.height > 0;
  };
  const nav = document.querySelector('[data-tech-chapter-nav]');
  const chrome = [...document.querySelectorAll('.mobile-header, .masthead-sticky')].filter(vis);
  const chromeBottom = chrome.length ? Math.max(...chrome.map((e) => Math.round(e.getBoundingClientRect().bottom))) : 0;
  if (!nav || !vis(nav)) return { present: false, chromeBottom };
  const r = nav.getBoundingClientRect();
  const chips = [...nav.querySelectorAll('[data-tech-chapter-nav-chip]')].filter(vis);
  return {
    present: true, chromeBottom,
    top: Math.round(r.top), height: Math.round(r.height),
    chipCount: chips.length,
    chipTops: [...new Set(chips.map((c) => Math.round(c.getBoundingClientRect().top)))],
    chipHeights: [...new Set(chips.map((c) => Math.round(c.getBoundingClientRect().height)))],
    chapters: chips.map((c) => c.getAttribute('data-chapter')),
    active: chips.filter((c) => c.getAttribute('data-active') === 'true').map((c) => c.getAttribute('data-chapter')),
    navScroll: { sw: nav.scrollWidth, cw: nav.clientWidth },
  };
});

const browser = await chromium.launch();

for (const V of VIEWS) {
  const ctx = await browser.newContext({ ...V.opts, serviceWorkers: 'block' });
  await ctx.addInitScript(([a, r, th]) => {
    localStorage.setItem('access_token', a);
    localStorage.setItem('refresh_token', r);
    localStorage.setItem('theme', th);
    localStorage.setItem('pwa-install-dismissed-at', String(Date.now()));
  }, [access_token, refresh_token, V.theme]);

  for (const slug of SLUGS) {
    const D = DATA[slug];
    const tag = `${V.key}/${slug}`;
    const page = await ctx.newPage();
    try {
      await page.goto(`${BASE}/tech-report/${slug}`, { waitUntil: 'networkidle' }).catch(() => {});
      await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0).catch(() => {});
      await page.waitForTimeout(1200);
      let m = await measure(page);
      if (!m.sectionOrder.length) { await page.waitForTimeout(1800); m = await measure(page); }

      // ── identity: 이 페이지가 진짜 그 slug의 리포트인가 ───────────────────
      const h1 = await page.evaluate(() => (document.querySelector('h1') || {}).textContent || '');
      ok_(`identity:${tag}`, m.sectionOrder.length >= 5 && h1.trim().length > 0,
        `섹션 ${m.sectionOrder.length}개 · h1="${h1.trim().slice(0, 24)}"`);
      bump('identity');

      // ═══ G1 (task#319) 섹션 DOM 순서 ═══════════════════════════════════
      const obs = m.sectionOrder;
      bump('g1-domain', obs.length ? 1 : 0);
      ok_(`g1-domain:${tag}`, obs.length >= 5, `표본 — 표시 섹션 ${obs.length}개(5 이상이어야 축이 성립)`);
      eq(`g1-order:${tag}`, obs, TARGET_ORDER.filter((id) => obs.includes(id)),
        '목표 배열을 관측 집합으로 필터한 값과 정확히 일치해야 한다');
      // 이빨 — 옛 순서와 다름을 쌍으로 단언(no-op이 통과하지 못하게)
      const oldFiltered = OLD_ORDER.filter((id) => obs.includes(id));
      const targetFiltered = TARGET_ORDER.filter((id) => obs.includes(id));
      ok_(`g1-teeth:${tag}`, JSON.stringify(targetFiltered) !== JSON.stringify(oldFiltered),
        `이 표본에서 목표순서≠옛순서여야 축에 판별력이 있다 (옛=${oldFiltered.join('>')})`);
      ok_(`g1-not-old:${tag}`, JSON.stringify(obs) !== JSON.stringify(oldFiltered),
        '관측이 옛 순서와 같으면 아무것도 안 바뀐 것이다');

      // ═══ G2 (task#319+320) 목차 칩 순서 == 섹션 순서, related 라벨 개명 ══
      bump('g2-domain', m.tocTexts.length ? 1 : 0);
      ok_(`g2-domain:${tag}`, m.tocTexts.length === obs.length,
        `목차 칩 ${m.tocTexts.length}개 == 표시 섹션 ${obs.length}개`);
      ok_(`g2-related-label:${tag}`, !obs.includes('related') || m.tocTexts.includes(RELATED_LABEL),
        `related 표시 시 목차에 「${RELATED_LABEL}」 칩이 있어야 한다 (칩=${JSON.stringify(m.tocTexts)})`);
      // 목차 칩 텍스트가 섹션 순서와 정확히 대응 — 목차가 본문과 다른 순서를 가리키면 잡는다
      eq(`g2-toc-labels:${tag}`, m.tocTexts, obs.map((id) => LABELS[id] || `?${id}`),
        '목차 칩 텍스트 = 표시 섹션 순서의 라벨');

      // ═══ G3 (task#319) 장 라벨 ═════════════════════════════════════════
      const expectChapters = CHAPTERS.filter((c) => c.ids.some((id) => obs.includes(id)));
      bump('g3-domain', m.chapterKeys.length ? 1 : 0);
      ok_(`g3-domain:${tag}`, m.chapterKeys.length > 0, `장 라벨 ${m.chapterKeys.length}개 검출(0이면 미구현/셀렉터 불일치)`);
      eq(`g3-keys:${tag}`, m.chapterKeys, expectChapters.map((c) => c.key),
        '표시 섹션이 1개 이상인 장만, 장 순서대로');
      eq(`g3-texts:${tag}`, m.chapterTexts, expectChapters.map((c) => c.label), '라벨 문자열');
      eq(`g3-position:${tag}`, m.labelFollowedBy,
        expectChapters.map((c) => c.ids.filter((id) => obs.includes(id))[0]),
        '각 라벨의 문서상 다음 섹션 = 그 장의 첫 표시 섹션');
      // 유령 라벨 0 — 표시 섹션이 없는 장의 라벨은 렌더되지 않아야 한다
      const ghost = m.chapterKeys.filter((k) => !expectChapters.some((c) => c.key === k));
      eq(`g3-no-ghost:${tag}`, ghost, [], '표시 섹션 0인 장의 라벨');

      // ═══ G4 (task#320) 구성 막대 ═══════════════════════════════════════
      bump('g4-domain', m.comp.length ? 1 : 0);
      ok_(`g4-domain:${tag}`, m.comp.length === D.comp.length,
        `구성 항목 ${m.comp.length}개 == 실응답 composition.tech ${D.comp.length}개`);
      ok_(`g4-root:${tag}`, !!m.compRootText && m.compRootText.includes('100%'),
        `뿌리 노드에 분모가 상시 노출돼야 한다 (got=${JSON.stringify((m.compRootText || '').slice(0, 40))})`);
      // 지분 내림차순 + 「기타」는 항상 마지막
      const ramp = m.comp.filter((c) => c.kind === 'ramp');
      const other = m.comp.filter((c) => c.kind === 'other');
      const expOther = D.compNames.filter((n) => n.startsWith(OTHER_PREFIX)).length;
      eq(`g4-other-count:${tag}`, other.length, expOther, `「${OTHER_PREFIX}」 접두 항목 수(정확일치가 아니라 접두일치)`);
      ok_(`g4-desc:${tag}`, ramp.every((c, i) => i === 0 || ramp[i - 1].share >= c.share),
        `램프 항목이 지분 내림차순 (got=${ramp.map((c) => c.share).join('>')})`);
      ok_(`g4-other-last:${tag}`, other.length === 0 || m.comp[m.comp.length - 1].kind === 'other',
        '「기타」는 항상 마지막이다');
      // 같은 지분 → 같은 색 · 다른 지분 → 다른 색(색은 길이와 같은 말을 해야 한다)
      const byShare = {};
      for (const c of ramp) { (byShare[c.share] = byShare[c.share] || []).push(c.barColor); }
      const sameShareDiffColor = Object.entries(byShare).filter(([, cs]) => new Set(cs).size > 1).map(([s]) => s);
      eq(`g4-same-share-same-color:${tag}`, sameShareDiffColor, [], '같은 지분인데 색이 다른 지분값');
      const diffShareSameColor = [];
      for (let i = 0; i < ramp.length; i++) for (let j = i + 1; j < ramp.length; j++) {
        if (ramp[i].share !== ramp[j].share && ramp[i].barColor && ramp[i].barColor === ramp[j].barColor) {
          diffShareSameColor.push(`${ramp[i].share}=${ramp[j].share}`);
        }
      }
      eq(`g4-diff-share-diff-color:${tag}`, diffShareSameColor, [], '다른 지분인데 같은 색인 쌍');
      ok_(`g4-other-neutral:${tag}`,
        other.every((o) => !ramp.some((r) => r.barColor && r.barColor === o.barColor)),
        '「기타」 색은 램프 밖(어느 램프 항목과도 같지 않다)');
      // 가장 연한 막대가 트랙 위에서 실제로 보이는가(라이트·다크 각각 1.4:1 이상)
      const lightest = ramp.length ? ramp.reduce((a, c) => (c.share < a.share ? c : a), ramp[0]) : null;
      const cr = lightest ? contrast(lightest.barColor, lightest.trackColor, m.pageBg) : null;
      ok_(`g4-contrast:${tag}`, cr != null && cr >= 1.4,
        `가장 연한 막대(${lightest && lightest.share}%) 대비 ${cr}:1 ≥ 1.4 · bar=${lightest && lightest.barColor} track=${lightest && lightest.trackColor} pageBg=${m.pageBg}`);
      // 넘침 — **내가 만든 요소만** 본다(업체 표의 선재 넘침을 수입하지 않는다, task#316)
      const compOver = m.comp.filter((c) => c.overflowRight > 1).map((c) => `${c.share}:${c.overflowRight}px`);
      eq(`g4-no-overflow:${tag}`, compOver, [], '구성 항목이 부모를 넘는 것 0 (선재 업체표 넘침은 이 축의 대상이 아니다)');
      // 문서 가로 스크롤 — 현재 clean이므로 회귀 가드로 안전
      eq(`g4-doc-h-scroll:${tag}`, m.docScroll.sw - m.docScroll.cw, 0,
        `doc scrollW=${m.docScroll.sw}/clientW=${m.docScroll.cw}`);

      // ═══ G5 (task#320) 경계 링크 칩 ════════════════════════════════════
      const relCount = Object.values(D.related).reduce((a, v) => a + (v || []).length, 0);
      bump('g5-domain', m.relLinks.length ? 1 : 0);
      ok_(`g5-domain:${tag}`, relCount === 0 || m.relLinks.length > 0,
        `related 항목 ${relCount}개 중 발행물 링크 칩 ${m.relLinks.length}개(발행 7종과 이름 일치분)`);
      const smallTap = m.relLinks.filter((l) => l.h < 32).map((l) => `${l.text}:${l.h}px`);
      eq(`g5-tap-target:${tag}`, smallTap, [], '링크 칩 탭 타깃 32px 이상');

      // ═══ G6 (task#321) 플로팅 항해 바 ══════════════════════════════════
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(400);
      const nav0 = await measureNav(page);
      ok_(`g6-absent-at-top:${tag}`, nav0.present === false, `스크롤 0에서 바가 없어야 한다 (present=${nav0.present})`);

      // 정적 목차가 화면 밖으로 나갈 만큼 내린 뒤
      const sh = await page.evaluate(() => document.documentElement.scrollHeight);
      const vh = await page.evaluate(() => window.innerHeight);
      const actives = [];
      let navMid = null;
      const steps = 8;
      for (let s = 1; s <= steps; s++) {
        const y = Math.round(((sh - vh) * s) / steps);
        await page.evaluate((yy) => window.scrollTo(0, yy), y);
        await page.waitForTimeout(350);
        const n = await measureNav(page);
        if (s === Math.ceil(steps / 2)) navMid = n;
        if (n.present && n.active.length) actives.push(n.active[0]);
      }
      bump('g6-domain', navMid && navMid.present ? 1 : 0);
      ok_(`g6-domain:${tag}`, !!(navMid && navMid.present), `본문 중간에서 바가 떠 있어야 한다 (present=${navMid && navMid.present})`);
      const nm = navMid || {};
      eq(`g6-chip-count:${tag}`, nm.chipCount || 0, expectChapters.length, '칩 수 = 표시 섹션이 있는 장 수');
      eq(`g6-chapters:${tag}`, nm.chapters || [], expectChapters.map((c) => c.key), '칩이 장 순서대로');
      eq(`g6-one-line:${tag}`, (nm.chipTops || []).length, 1, `칩 offsetTop 고유값 1개여야 1줄 (got=${JSON.stringify(nm.chipTops)})`);
      eq(`g6-chip-34px:${tag}`, nm.chipHeights || [], [34], '탭 타깃 34px 핀(task#316)');
      eq(`g6-below-chrome:${tag}`, nm.present ? Math.abs(nm.top - nm.chromeBottom) <= 1 : false, true,
        `바 top=${nm.top} == 크롬 bottom=${nm.chromeBottom} (그 실행에서 잰 값, 계획의 숫자 아님)`);
      eq(`g6-no-h-scroll:${tag}`, nm.navScroll ? nm.navScroll.sw - nm.navScroll.cw : -1, 0,
        `바 자체 가로 스크롤 0 (sw=${nm.navScroll && nm.navScroll.sw}/cw=${nm.navScroll && nm.navScroll.cw})`);
      const distinct = [...new Set(actives)];
      ok_(`g6-active-transitions:${tag}`, distinct.length >= 3,
        `스크롤 ${steps}단계에서 활성 장이 ${distinct.length}종 관측(3 이상 — 「존재한다」만 재면 첫 장 고정도 통과한다) [${actives.join('>')}]`);
      // 문서 끝에서 마지막 장이 활성
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(600);
      const navEnd = await measureNav(page);
      eq(`g6-last-active-at-end:${tag}`, (navEnd.active || [])[0] || null,
        expectChapters[expectChapters.length - 1].key, '문서 끝에서 마지막 장이 활성');
    } catch (e) {
      P(false, `harness:${tag}`, `FAIL — 계측 예외: ${e}`);
    } finally {
      await page.close();
    }
  }
  await ctx.close();
}
await browser.close();

// ── 커버리지 카운터(표본 0을 통과로 위장하지 않기 위한 것) ────────────────────
const COMBOS = VIEWS.length * SLUGS.length;
console.log('\n커버리지 — 표본이 실제로 관측된 조합 수 / 전체 조합 수:');
for (const k of ['identity', 'g1-domain', 'g2-domain', 'g3-domain', 'g4-domain', 'g5-domain', 'g6-domain']) {
  console.log(`  ${k}: ${cov[k] || 0}/${COMBOS}`);
}

const fails = results.filter((r) => !r.ok);
for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.tag} — ${r.msg}`);
console.log(`\n단언 총계: ${results.length}건 · PASS ${results.length - fails.length} · FAIL ${fails.length}`);
if (fails.length) {
  console.log('\nFAIL 목록:');
  for (const r of fails) console.log(`  ✗ ${r.tag} — ${r.msg}`);
  process.exit(1);
}
console.log('ALL PASS — fg-loop 정지조건 G1~G6 충족.');
