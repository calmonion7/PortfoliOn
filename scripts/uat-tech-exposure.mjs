// task#307 라이브 UAT(신규) — 기술 노출 상한 카드 + 종목 상세 기술 칩 (ADR-0043).
// GET만 — POST/PUT/DELETE 없음, 라이브 프로덕션 쓰기 0.
//
// 실행: node scripts/uat-tech-exposure.mjs
//
// ── 판정 규율(live-uat-probes 스킬) ──────────────────────────────────────────────
//  · identity를 판정축보다 **먼저** — 노출 탭에 실제로 도달했는지부터 못박는다(⑧ⓘ).
//  · 축마다 `*-domain` sentinel — 표본 부재를 FAIL로 만든다(⑧ⓐ). 조건부 단언 금지.
//  · **대조군은 `page.route` 주입**으로 합성한다 — "매칭 0" 상태를 실계정에 만들 수 없고,
//    실데이터 상태에 의존하는 대조군은 데이터가 바뀌면 소멸한다(uat298 스테일 구조).
//  · **API 실값에서 기대치를 파생**한다 — 화면 숫자를 화면에서 읽어 자기 자신과 비교하면
//    아무것도 검증하지 않는다. 인덱스+대시보드를 직접 받아 상한을 재계산해 대조한다.
//  · 이 지표는 **Σ>100%가 정상**이다 — "합이 100" 축을 두면 그것이 회귀다.
import { chromium, devices } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-tech-exposure';
fs.mkdirSync(OUT, { recursive: true });
// task#323 육안 증거 전용 디렉터리(완료기준이 경로를 명시한다)
const OUT323 = '/Users/calmonion/Project/PortfoliOn/screenshots-uat323';
fs.mkdirSync(OUT323, { recursive: true });

const results = [];
const cov = {};
const rawLog = [];
const P = (ok, tag, msg) => results.push({ ok, tag, msg });
const bump = (k, n = 1) => { cov[k] = (cov[k] || 0) + n; };
const eq = (tag, got, want, note = '') => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  P(ok, tag, `${ok ? 'PASS' : 'FAIL'} — got=${JSON.stringify(got)} want=${JSON.stringify(want)}${note ? ' · ' + note : ''}`);
};

// ── 로그인 + API 실값으로 기대치 파생 ────────────────────────────────────────
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const { access_token, refresh_token } = await login.json();
if (!access_token) { console.error('로그인 실패 — access_token 없음. 종료.'); process.exit(1); }
const AUTH = { Authorization: `Bearer ${access_token}` };

const INDEX = (await (await fetch(`${BASE}/api/tech-reports/index`, { headers: AUTH })).json()).index || [];
const EXPO = await (await fetch(`${BASE}/api/portfolio/exposure`, { headers: AUTH })).json();
const WATCH = await (await fetch(`${BASE}/api/watchlist`, { headers: AUTH })).json();

const holdings = EXPO.holdings || [];
const wBy = new Map(holdings.map(h => [h.ticker, h.weight || 0]));
const watchSet = new Set((Array.isArray(WATCH) ? WATCH : []).map(w => w.ticker));

// 화면과 **독립적으로** 상한을 재계산한다 — 이게 대조 기준이다.
const rows = INDEX.map(t => {
  const tk = t.tickers || [];
  const mine = tk.filter(k => wBy.has(k));
  return {
    slug: t.slug, name: t.name,
    weight: mine.reduce((s, k) => s + wBy.get(k), 0),
    watchCount: tk.filter(k => watchSet.has(k) && !wBy.has(k)).length,
    unmatched: Math.max((t.players_total || 0) - tk.length, 0),
  };
}).sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));

const exposed = rows.filter(r => r.weight > 0);
const zero = rows.filter(r => r.weight <= 0);
const expWatch = exposed.reduce((n, r) => n + r.watchCount, 0);
const expUnmatched = exposed.reduce((n, r) => n + r.unmatched, 0);
const sumAll = rows.reduce((s, r) => s + r.weight, 0);

rawLog.push(`인덱스 ${INDEX.length}종 · 보유 ${holdings.length}종목 · 관심 ${watchSet.size}종목`);
rawLog.push(`노출>0 ${exposed.length}종 [${exposed.map(r => `${r.name}=${r.weight.toFixed(1)}%`).join(', ')}] · 노출0 ${zero.length}종`);
rawLog.push(`기대 부기 — 관심 ${expWatch}종목 · 미매칭 ${expUnmatched}개 · 기술간 합계 ${sumAll.toFixed(1)}%`);

// 표본 부재를 FAIL로 (⑧ⓐ) — 노출>0이 0종이면 이 프로브는 아무것도 못 잰다.
eq('domain-index', INDEX.length >= 6 ? 'OK' : `DOMAIN_TOO_SMALL(${INDEX.length})`, 'OK');
eq('domain-exposed', exposed.length >= 1 ? 'OK' : 'DOMAIN_TOO_SMALL(0) — 보유가 어느 기술에도 없어 막대 축을 잴 수 없다', 'OK');
bump('domain', 2);

// 헤더 칩 대상 — 기술에 등장하면서 내가 보유한 티커 하나
const chipTicker = holdings.map(h => h.ticker).find(k => INDEX.some(t => (t.tickers || []).includes(k)));
const chipTechs = INDEX.filter(t => (t.tickers || []).includes(chipTicker)).map(t => t.slug);
eq('domain-chip', chipTicker ? 'OK' : 'DOMAIN_TOO_SMALL(칩 대상 종목 없음)', 'OK');
bump('domain');
rawLog.push(`칩 대상 종목=${chipTicker} → 기술 [${chipTechs.join(', ')}]`);

// ══ task#323 — 「안 가진 업체」 후보 칩의 기대치를 **API에서 독립 재계산** ══════════
// 화면 숫자를 화면에서 읽어 자기 자신과 비교하면 아무것도 검증하지 않는다(가토 ④).
// 프론트 computeTechCandidates와 같은 규칙을 여기서 다시 구현해 대조한다.
const MAX_CHIPS = 3;
const expCand = new Map();
for (const t of INDEX) {
  const row = rows.find((r) => r.slug === t.slug);
  if (!row || row.weight <= 0) continue;           // 노출 0 기술은 후보를 내지 않는다
  const pool = (t.listed || []).filter((p) => p.ticker && !wBy.has(p.ticker) && !watchSet.has(p.ticker));
  pool.sort((a, b) => {
    const ga = a.gap_years ?? Number.MAX_SAFE_INTEGER;
    const gb = b.gap_years ?? Number.MAX_SAFE_INTEGER;
    return (b.tech_level || 0) - (a.tech_level || 0) || ga - gb
      // 로케일 명시 — 인자 없으면 Node와 Chrome이 갈려 이 기대치가 라이브와 어긋난다(실측).
      || String(a.name || '').localeCompare(String(b.name || ''), 'ko');
  });
  if (!pool.length) continue;
  expCand.set(t.slug, {
    chips: pool.slice(0, MAX_CHIPS).map((p) => p.ticker),
    names: pool.slice(0, MAX_CHIPS).map((p) => p.name),
    more: Math.max(pool.length - MAX_CHIPS, 0),
    total: pool.length,
  });
}
// ⚠️ 정의역 sentinel — 후보가 0이면 아래 축 전부가 **공허하게 통과**한다(가토 ⓩ).
//    이 계정의 보유 구성에 종속되므로 표본 부재를 FAIL로 만든다.
eq('domain-cand', expCand.size >= 1 ? 'OK' : 'DOMAIN_TOO_SMALL(후보 있는 노출 기술 0종)', 'OK');
eq('domain-cand-more', [...expCand.values()].some((v) => v.more > 0) ? 'OK'
   : 'DOMAIN_TOO_SMALL(+N 배지 표본 없음)', 'OK');
eq('domain-cand-kr', [...expCand.values()].some((v) => v.chips.some((t) => /^\d{6}$/.test(t))) ? 'OK'
   : 'DOMAIN_TOO_SMALL(KR 6자리 칩 표본 없음)', 'OK');
bump('domain', 3);
rawLog.push(`후보 기대 — ${[...expCand.entries()].map(([k, v]) => `${k}:${v.chips.length}칩+${v.more}`).join(' · ')}`);

const VIEWS = [
  { name: 'm278', opts: { ...devices['iPhone SE'], viewport: { width: 278, height: 800 }, isMobile: true, hasTouch: true } },
  { name: 'm768', opts: { viewport: { width: 768, height: 1000 } } },
  { name: 'pc1280', opts: { viewport: { width: 1280, height: 1000 } } },
];

const gotoExposure = async (page) => {
  await page.goto(`${BASE}/portfolio`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1400);
  // 분석 탭 → 노출 서브탭.
  // ⚠️ PC와 모바일이 **다른 컨테이너**를 쓴다 — 데스크톱은 `.tabs`, 모바일은 `.seg`
  //    (Portfolio.jsx가 isMobile로 두 갈래를 각각 렌더한다). 한쪽 선택자만 쓰면 그 폭에서
  //    카드에 도달하지 못하고, 그 실패가 "앱이 안 그린다"로 오독된다(계측 실패 ≠ 앱 성질).
  const analysis = page.locator('button', { hasText: /^분석$/ }).first();
  if (await analysis.count() > 0) { await analysis.click().catch(() => {}); await page.waitForTimeout(700); }
  const expo = page.locator('.tabs button, .seg button').filter({ hasText: /^노출$/ }).first();
  if (await expo.count() > 0) { await expo.click().catch(() => {}); await page.waitForTimeout(1600); }
  // 모바일 ExposureTab은 아코디언이라 접혀 있을 수 있다 — 닫혀 있으면 연다.
  const acc = page.locator('button.accordion-header', { hasText: '노출' }).first();
  if (await acc.count() > 0) {
    const open = await page.locator('[data-testid="tech-exposure-card"]').count();
    if (!open) { await acc.click().catch(() => {}); await page.waitForTimeout(900); }
  }
};

const browser = await chromium.launch();
for (const V of VIEWS) {
  // SW가 /api/*를 가로채므로 차단 필수 — 안 하면 응답 기반 판정이 통째로 헛돈다.
  const ctx = await browser.newContext({ ...V.opts, serviceWorkers: 'block' });
  await ctx.addInitScript(([a, r]) => {
    localStorage.setItem('access_token', a);
    localStorage.setItem('refresh_token', r);
    localStorage.setItem('theme', 'light');
    localStorage.setItem('pwa-install-dismissed-at', String(Date.now()));
  }, [access_token, refresh_token]);
  const page = await ctx.newPage();

  await gotoExposure(page);

  // ── identity: 노출 탭의 기술 노출 카드에 실제로 도달했는가 (판정축보다 먼저) ──
  const ident = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="tech-exposure-card"]');
    return { present: !!card, h3: card ? (card.querySelector('h3')?.textContent || '').trim() : null };
  });
  eq(`identity:${V.name}`, ident.present && ident.h3 === '기술 노출', true, `h3="${ident.h3}"`);
  bump('identity');

  // ── ⓐ 막대 수 == 노출>0 기술 수 + 라벨·값이 API 파생 기대치와 일치 ──
  const card = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="tech-exposure-card"]');
    if (!c) return null;
    // 막대는 **전용 testid**로 센다(task#323). 옛 구조 휴리스틱(「자식 div + % span」)은
    // 후보 칩 래퍼가 생기면서 기술당 2개를 세어 거짓 FAIL을 냈다 — 앱은 정상이었고
    // 셀렉터가 DOM 구조에 결합돼 있던 것이 원인이다. testid는 그 결합을 끊는다.
    const bars = [...c.querySelectorAll('[data-testid="tech-exposure-bar"]')];
    const labels = [...c.querySelectorAll('span')].map(s => s.textContent.trim());
    return {
      text: c.textContent,
      basis: (c.querySelector('[data-testid="tech-exposure-basis"]')?.textContent || '').trim(),
      zero: (c.querySelector('[data-testid="tech-exposure-zero"]')?.textContent || '').trim(),
      watch: (c.querySelector('[data-testid="tech-exposure-watch"]')?.textContent || '').trim(),
      unmatched: (c.querySelector('[data-testid="tech-exposure-unmatched"]')?.textContent || '').trim(),
      empty: !!c.querySelector('[data-testid="tech-exposure-empty"]'),
      barCount: bars.length,
      barSlugs: bars.map((b) => b.getAttribute('data-slug')),
      labels,
    };
  });
  eq(`card-domain:${V.name}`, card ? 'OK' : 'DOMAIN_TOO_SMALL(카드 없음)', 'OK');
  eq(`bar-count:${V.name}`, card?.barCount, exposed.length, `노출>0 ${exposed.length}종`);
  // 개수만 세면 「어느 기술의 막대인가」를 모른다 — slug 순서까지 못박는다(노출% 내림차순).
  eq(`bar-slugs:${V.name}`, card?.barSlugs, exposed.map((r) => r.slug));
  bump('bar', 3);

  // 각 기술 이름이 실제로 카드에 있는가(커버리지 — 이름 하나라도 누락되면 렌더가 빠뜨린 것)
  for (const r of exposed) {
    eq(`bar-label:${V.name}:${r.slug}`, (card?.text || '').includes(r.name), true, `name="${r.name}"`);
    bump('bar');
  }

  // ── ⓑ 기준 문구 2문장 — 지표의 구성요소다(빠지면 지표가 거짓) ──
  eq(`basis-ceiling:${V.name}`, (card?.basis || '').includes('상한'), true, `basis="${(card?.basis || '').slice(0, 40)}"`);
  eq(`basis-over100:${V.name}`, (card?.basis || '').includes('100%를 넘을 수 있습니다'), true);
  bump('basis', 2);

  // ── ⓒ 부기 2종 — 관심 N종목 · 미매칭 N개 (기대치는 API에서 파생) ──
  eq(`note-watch:${V.name}`, expWatch > 0 ? (card?.watch || '').includes(`관심 ${expWatch}종목`) : (card?.watch || '') === '', true,
     `expWatch=${expWatch} got="${card?.watch}"`);
  eq(`note-unmatched:${V.name}`, expUnmatched > 0 ? (card?.unmatched || '').includes(`${expUnmatched}개`) : (card?.unmatched || '') === '', true,
     `expUnmatched=${expUnmatched} got="${card?.unmatched}"`);
  eq(`note-zero:${V.name}`, zero.length > 0 ? (card?.zero || '').includes(`나머지 ${zero.length}개`) : (card?.zero || '') === '', true,
     `zero=${zero.length} got="${card?.zero}"`);
  bump('note', 3);

  // 빈 상태 문구가 실데이터에서 잘못 뜨지 않는가(노출>0이 있는데 "겹치는 기술이 없습니다"면 회귀)
  eq(`no-false-empty:${V.name}`, card?.empty, false);
  bump('note');

  // ── ⓓ 가로 스크롤 0 ──
  const hs = await page.evaluate(() => {
    const de = document.documentElement;
    return { doc: de.scrollWidth - de.clientWidth, cw: de.clientWidth };
  });
  eq(`h-scroll:${V.name}`, hs.doc <= 0, true, `scrollWidth-clientWidth=${hs.doc} (cw=${hs.cw})`);
  bump('h-scroll');

  // ── ⓔ 잘림 두 계열 — 텍스트 leaf + overflow:hidden 컨테이너 ──
  const clip = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="tech-exposure-card"]');
    if (!c) return null;
    const leaf = [], box = [];
    for (const el of c.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      const txt = (el.textContent || '').trim().slice(0, 26);
      if (own && el.scrollWidth > el.clientWidth + 1) leaf.push(`${el.tagName}|${txt}`);
      // 막대 트랙은 overflow:hidden이 **의도**다(조각을 잘라 (100%로 채움) — 텍스트 없는 노드는 제외
      if ((cs.overflow === 'hidden' || cs.overflowX === 'hidden') && el.scrollWidth > el.clientWidth + 1 && txt)
        box.push(`${el.tagName}|${txt}`);
    }
    return { leaf, box, scanned: c.querySelectorAll('*').length };
  });
  eq(`clip-domain:${V.name}`, clip && clip.scanned > 10 ? 'OK' : `DOMAIN_TOO_SMALL(${clip?.scanned})`, 'OK');
  eq(`clip-leaf:${V.name}`, clip?.leaf || null, []);
  eq(`clip-box:${V.name}`, clip?.box || null, []);
  bump('clip', 3);

  // ══ task#323 후보 칩 — 노출>0 기술마다 최대 3칩 + 「+N」 ═════════════════════
  const cand = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="tech-exposure-card"]');
    if (!c) return null;
    const rows = [...c.querySelectorAll('[data-testid="tech-cand-row"]')].map((r) => {
      const chips = [...r.querySelectorAll('[data-testid="tech-cand-chip"]')].map((b) => {
        const bb = b.getBoundingClientRect();
        return {
          ticker: b.getAttribute('data-ticker'),
          market: b.getAttribute('data-market'),
          text: (b.textContent || '').trim(),
          h: Math.round(bb.height * 10) / 10,
          w: Math.round(bb.width * 10) / 10,
          // 넘침 — 칩은 flex 자식이라 clientWidth가 유효하다(frontend/CLAUDE.md 경계 정정)
          over: b.scrollWidth - b.clientWidth,
          // 가격 방향 토큰을 쓰지 않았는가(KR 색 관례)
          priceToken: /--up|--down/.test(b.outerHTML),
        };
      });
      const more = r.querySelector('[data-testid="tech-cand-more"]');
      return { slug: r.getAttribute('data-slug'), chips, more: more ? (more.textContent || '').trim() : null,
               label: !!r.querySelector('[data-testid="tech-cand-label"]') };
    });
    return { rows, cardRight: Math.round(c.getBoundingClientRect().right) };
  });

  // 어느 기술에 칩 구역이 붙었는가 — 노출>0 & 후보>0인 기술과 **정확히** 일치해야 한다.
  eq(`cand-rows:${V.name}`, (cand?.rows || []).map((r) => r.slug).sort(), [...expCand.keys()].sort());
  bump('cand');

  // 기술별 칩 티커·「+N」이 API 파생 기대와 일치하는가(귀속 + 정렬 + 상한을 한 번에 잰다)
  for (const [slug, exp] of expCand) {
    const got = (cand?.rows || []).find((r) => r.slug === slug);
    eq(`cand-chips:${V.name}:${slug}`, got ? got.chips.map((c) => c.ticker) : null, exp.chips,
       `총 후보 ${exp.total}종`);
    eq(`cand-more:${V.name}:${slug}`, got ? got.more : null, exp.more > 0 ? `+${exp.more}` : null);
    bump('cand', 2);
  }

  const allChips = (cand?.rows || []).flatMap((r) => r.chips);
  // ⚠️ 아래 3축은 `filter(위반).length === 0` 형태라 **표본 0에서 공허하게 참**이다(가토 ⓩ).
  //    그래서 술어에 정의역을 함께 넣는다 — 「위반 0건 AND 관측 > 0」.
  const domOK = allChips.length > 0;
  eq(`cand-tap:${V.name}`, domOK && allChips.filter((c) => c.h < 32).length === 0, true,
     `표본 ${allChips.length} · 최소높이 ${Math.min(...allChips.map((c) => c.h), Infinity)}`);
  eq(`cand-no-overflow:${V.name}`, domOK && allChips.filter((c) => c.over > 1).length === 0, true,
     `표본 ${allChips.length} · 최대넘침 ${Math.max(...allChips.map((c) => c.over), -1)}`);
  eq(`cand-no-price-token:${V.name}`, domOK && allChips.filter((c) => c.priceToken).length === 0, true,
     `표본 ${allChips.length}`);
  bump('cand', 3);

  // 시장 추론이 티커 형태와 일치하는가(6자리=KR / 그 외=US) — country가 아니라 형태가 규칙이다.
  const mkBad = allChips.filter((c) => c.market !== (/^\d{6}$/.test(c.ticker) ? 'KR' : 'US'));
  eq(`cand-market:${V.name}`, domOK && mkBad.length === 0, true,
     `표본 ${allChips.length} · 불일치 ${mkBad.map((c) => `${c.ticker}=${c.market}`).join(',')}`);
  bump('cand');

  // 메타줄 — `tech_level`이 있는 업체는 칩 본문에 `Lv<n>`이 실재해야 한다.
  // ⚠️ 섹터가 빠지면 tech_level 비교가 조용히 거짓이 되므로(기술 전체를 통짜 정렬한다)
  //    섹터 보유 업체는 그 문자열도 함께 단언한다.
  const metaExp = [];
  for (const [slug, exp] of expCand) {
    const t = INDEX.find((x) => x.slug === slug);
    for (const tk of exp.chips) {
      const p = (t.listed || []).find((x) => x.ticker === tk);
      if (p) metaExp.push({ slug, tk, lv: p.tech_level, cat: p.category });
    }
  }
  const metaBad = [];
  for (const m of metaExp) {
    const chip = allChips.find((c) => c.ticker === m.tk);
    if (!chip) { metaBad.push(`${m.tk}:칩없음`); continue; }
    if (m.lv != null && !chip.text.includes(`Lv${m.lv}`)) metaBad.push(`${m.tk}:Lv${m.lv}없음`);
    if (m.cat && !chip.text.includes(m.cat)) metaBad.push(`${m.tk}:섹터"${m.cat}"없음`);
  }
  eq(`cand-meta-domain:${V.name}`, metaExp.length >= 2 ? 'OK' : `DOMAIN_TOO_SMALL(${metaExp.length})`, 'OK');
  eq(`cand-meta:${V.name}`, metaBad, []);
  bump('cand', 2);

  // 라벨 — 칩이 무엇인지 말해 주는 한 줄이 각 구역에 있는가
  eq(`cand-label:${V.name}`, (cand?.rows || []).filter((r) => !r.label).length === 0 && domOK, true);
  bump('cand');

  await page.screenshot({ path: `${OUT}/${V.name}-exposure.png`, fullPage: true });

  // ── 육안 증거 — **칩이 화면에 있는 순간** 찍는다(가토 1: 단언 통과 ≠ 증거 확보) ──
  if (cand?.rows?.length) {
    await page.locator('[data-testid="tech-cand-row"]').first().scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT323}/${V.name}-exposure-candidates.png`, fullPage: false });
  }

  // ══ ⓖ 대조군 — 매칭 0을 **주입**으로 합성 ══════════════════════════════════
  // 실계정의 보유를 바꿀 수 없고(프로덕션 쓰기 금지), 실데이터 의존 대조군은 데이터가
  // 바뀌면 소멸한다. 인덱스의 tickers를 전부 비워 "겹치는 기술 0"을 만든다.
  let injected = 0;
  await page.route('**/api/tech-reports/index*', async (route) => {
    const res = await route.fetch();
    let body;
    try { body = await res.json(); } catch { return route.fulfill({ response: res }); }
    if (Array.isArray(body?.index)) {
      body.index = body.index.map(t => ({ ...t, tickers: [] }));
      injected += 1;
    }
    await route.fulfill({ response: res, body: JSON.stringify(body), contentType: 'application/json' });
  });
  await gotoExposure(page);
  const ctrl = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="tech-exposure-card"]');
    return {
      present: !!c,
      empty: !!c?.querySelector('[data-testid="tech-exposure-empty"]'),
      emptyText: (c?.querySelector('[data-testid="tech-exposure-empty"]')?.textContent || '').trim().slice(0, 40),
      watch: !!c?.querySelector('[data-testid="tech-exposure-watch"]'),
    };
  });
  eq(`control-injected:${V.name}`, injected > 0, true, `가로챈 응답 ${injected}건`);
  eq(`control-card:${V.name}`, ctrl.present, true);        // 카드는 있고
  eq(`control-empty:${V.name}`, ctrl.empty, true, `text="${ctrl.emptyText}"`);  // 안내 문구만
  eq(`control-nowatch:${V.name}`, ctrl.watch, false);      // 노출 0이므로 부기도 없다
  bump('control', 4);
  await page.screenshot({ path: `${OUT}/${V.name}-control.png`, fullPage: true });
  await page.unroute('**/api/tech-reports/index*');

  await ctx.close();
}

// ══ ⓕ 헤더 칩 왕복 — 클릭 → /tech-report/:slug 도달 → 뒤로가기 ═══════════════
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, serviceWorkers: 'block' });
  await ctx.addInitScript(([a, r]) => {
    localStorage.setItem('access_token', a); localStorage.setItem('refresh_token', r);
    localStorage.setItem('theme', 'light'); localStorage.setItem('pwa-install-dismissed-at', String(Date.now()));
  }, [access_token, refresh_token]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/reports`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const nav = { chips: 0, reached: false, back: false };
  // 리포트 목록의 종목을 클릭해야 상세가 열린다(uat212와 동일 경로) — 전용 testid가 없어
  // 사이드바/카드그리드 두 렌더러를 모두 시도한다.
  const side = page.locator(`.reports-sidebar >> text=${chipTicker}`).first();
  const cardI = page.locator(`.stock-card-grid >> text=${chipTicker}`).first();
  const target = (await side.isVisible().catch(() => false)) ? side
    : (await cardI.isVisible().catch(() => false)) ? cardI : null;
  if (target) { await target.click().catch(() => {}); await page.waitForTimeout(1800); }
  nav.opened = !!target;
  const chips = page.locator('[data-testid="header-tech-chip"]');
  nav.chips = await chips.count();
  // ⚠️ 캡처는 **클릭 전**에 — 왕복 뒤에 찍으면 목록 화면이 찍혀 칩의 육안 증거가 되지 못한다
  //    (첫 판이 그랬다: 단언은 통과했는데 스크린샷엔 칩이 없었다).
  await page.screenshot({ path: `${OUT}/pc1280-chip.png`, fullPage: false });
  if (nav.chips > 0) {
    const slug = await chips.first().getAttribute('data-slug');
    await chips.first().click();
    await page.waitForTimeout(1400);
    nav.reached = page.url().includes(`/tech-report/${slug}`);
    await page.goBack();
    await page.waitForTimeout(1200);
    nav.back = !page.url().includes('/tech-report/');
  }
  eq('chip-open-domain', nav.opened === true, true, `상세 진입 대상=${chipTicker} — 못 열면 칩 축은 측정 실패다`);
  eq('chip-count', nav.chips, chipTechs.length, `종목=${chipTicker}`);
  eq('chip-roundtrip', { reached: nav.reached, back: nav.back }, { reached: true, back: true });
  bump('chip', 3);
  await ctx.close();
}
await browser.close();

// ── 보고 ──────────────────────────────────────────────────────────────────────
const fails = results.filter((r) => !r.ok);
console.log('\n' + '═'.repeat(78));
console.log('커버리지 (계열별 검사 수 — 재실행 간 비교용, 줄면 통과가 아니라 측정 실패):');
for (const [k, v] of Object.entries(cov).sort()) console.log(`  ${k.padEnd(20)} ${v}`);
console.log(`  ${'(합계)'.padEnd(20)} ${Object.values(cov).reduce((a, b) => a + b, 0)}`);
console.log(`\n단언 총계: ${results.length}건 · PASS ${results.length - fails.length} · FAIL ${fails.length}`);
console.log('\n원시 실측(단언 아님):');
for (const l of rawLog) console.log(`  ${l}`);
console.log(`\n※ 육안 캡처 ${OUT}/ — {view}-{exposure|control}.png · pc1280-chip.png`);
console.log(`※ 후보 칩 캡처 ${OUT323}/ — {view}-exposure-candidates.png (${fs.readdirSync(OUT323).join(', ') || '없음'})`);
console.log('═'.repeat(78));
fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ cov, results, exposed, zero, expWatch, expUnmatched }, null, 2));
if (fails.length) {
  console.log('\nFAIL 상세:');
  for (const f of fails) console.log(`  ✗ ${f.tag}\n      ${f.msg}`);
  process.exit(1);
}
console.log(`\nALL PASS ${results.length}/${results.length}`);
