// task#321 라이브 UAT — 4장 플로팅 항해 바.
//
// **신규 프로브인 이유**: 기존 프로브(uat296 등)에 축을 넣으면 그 프로브가 이미 안고 있는 선재 FAIL을
// 이 태스크의 게이트가 수입하게 되고, 그러면 exit 코드가 영구히 죽는다(task#316·317 2연속 재발).
// 이 파일은 선재 0에서 시작하므로 「exit 0」이 이 태스크에 한해 의미를 갖는다.
//
// **C1 루프 프로브(uat-loop319-321-goal.mjs)와 겹치지 않는 것만 잰다.** 그쪽이 이미 재는 것:
//   바 존재/부재 등가 · 칩 수·순서 · 1줄 · 34px · 크롬 아래 등식 · 활성 3전이 · 문서 끝 마지막 장.
// 여기서만 재는 것 — **다크 테마**(C1은 m350-dark 하나뿐) + S4의 앵커 오프셋 + 레이아웃 이동 +
// reduced-motion. 특히 `anchor-not-covered`는 **S4(scroll-margin 상향)의 유일한 라이브 검증**이다.
//
// 실측 상수(2026-08-21 · S0): `.mobile-header` 53 · `.masthead-sticky` 80 · 바 높이 47(칩 34 + padding 12 + border 1).
// ⚠️ 기대값에 그 숫자를 박지 않는다 — **그 실행에서 잰 값**과 대조한다(계획의 숫자는 이미 한 번 틀렸다:
//    「4칩 폭합 225 ≤ 246」이 실측 272 > 238이었다).
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

// 로그인 — 유계 재시도(계측 실패를 판정 실패로 읽지 않는다, task#316)
let access_token = null, refresh_token = null;
for (let i = 1; i <= 3 && !access_token; i++) {
  try {
    const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }) });
    const j = await r.json(); access_token = j.access_token; refresh_token = j.refresh_token;
  } catch (e) { console.log(`  (로그인 재시도 ${i}/3) ${e}`); await new Promise((s) => setTimeout(s, 2000)); }
}
if (!access_token) { console.error('로그인 3회 실패 — 계측 불가(판정 아님). 종료.'); process.exit(2); }

const SLUGS = ['robotics', 'solid-state-battery', 'ai-datacenter-equipment'];
// DoD가 지정한 4조합 — **다크가 절반이다**(C1이 못 덮는 부분).
const VIEWS = [
  { key: 'm390-light', theme: 'light', opts: { ...devices['iPhone 13'] } },
  { key: 'm390-dark', theme: 'dark', opts: { ...devices['iPhone 13'] } },
  { key: 'pc1440-light', theme: 'light', opts: { viewport: { width: 1440, height: 1000 } } },
  { key: 'pc1440-dark', theme: 'dark', opts: { viewport: { width: 1440, height: 1000 } } },
];
const REDUCED = process.env.REDUCED === '1';   // 대조군 — prefers-reduced-motion 강제

const browser = await chromium.launch();
for (const V of VIEWS) {
  const ctx = await browser.newContext({ ...V.opts, serviceWorkers: 'block',
    reducedMotion: REDUCED ? 'reduce' : 'no-preference' });
  await ctx.addInitScript(([a, r, th]) => {
    localStorage.setItem('access_token', a); localStorage.setItem('refresh_token', r);
    localStorage.setItem('theme', th); localStorage.setItem('pwa-install-dismissed-at', String(Date.now()));
  }, [access_token, refresh_token, V.theme]);

  for (const slug of SLUGS) {
    const tag = `${V.key}/${slug}`;
    const page = await ctx.newPage();
    try {
      await page.goto(`${BASE}/tech-report/${slug}`, { waitUntil: 'networkidle' }).catch(() => {});
      await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0).catch(() => {});
      await page.waitForTimeout(1100);

      // ── identity: 이 페이지가 그 slug의 리포트인가(판정축이 대상과 독립이면 틀린 페이지도 통과한다)
      const ident = await page.evaluate(() => ({
        h1: (document.querySelector('h1') || {}).textContent || '',
        secs: document.querySelectorAll('[data-tech-section]').length,
      }));
      eq(`identity:${tag}`, ident.secs >= 5 && ident.h1.trim().length > 0, true, `섹션 ${ident.secs} · h1 "${ident.h1.trim().slice(0, 20)}"`);
      bump('identity');

      // ── 바 등장 전 본문 좌표 스냅샷(레이아웃 이동 축의 before)
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(400);
      const before = await page.evaluate(() => {
        const out = {};
        for (const el of document.querySelectorAll('[data-tech-section]')) {
          out[el.getAttribute('data-tech-section')] = Math.round(el.getBoundingClientRect().top + window.scrollY);
        }
        return { tops: out, barPresent: !!document.querySelector('[data-tech-chapter-nav]') };
      });

      // ── 바가 뜨는 위치까지 스크롤
      const geom = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, vh: window.innerHeight }));
      await page.evaluate((y) => window.scrollTo(0, y), Math.round((geom.sh - geom.vh) * 0.5));
      await page.waitForTimeout(600);

      const m = await page.evaluate(() => {
        const vis = (el) => { if (!el) return false; const cs = getComputedStyle(el);
          return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getBoundingClientRect().height > 0; };
        const bar = document.querySelector('[data-tech-chapter-nav]');
        const chrome = [...document.querySelectorAll('.mobile-header, .masthead-sticky')].filter(vis);
        const chromeBottom = chrome.length ? Math.max(...chrome.map((e) => Math.round(e.getBoundingClientRect().bottom))) : 0;
        const tops = {};
        for (const el of document.querySelectorAll('[data-tech-section]')) {
          tops[el.getAttribute('data-tech-section')] = Math.round(el.getBoundingClientRect().top + window.scrollY);
        }
        if (!bar) return { present: false, chromeBottom, tops };
        const r = bar.getBoundingClientRect();
        const chips = [...bar.querySelectorAll('[data-tech-chapter-nav-chip]')];
        const cs = getComputedStyle(bar);
        return {
          present: true, chromeBottom, tops,
          top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height),
          bg: cs.backgroundColor, zIndex: cs.zIndex, position: cs.position,
          chipCount: chips.length,
          lines: [...new Set(chips.map((c) => Math.round(c.getBoundingClientRect().top)))].length,
          chipH: [...new Set(chips.map((c) => Math.round(c.getBoundingClientRect().height)))],
          chipTransition: chips.length ? getComputedStyle(chips[0]).transitionDuration : null,
          targets: chips.map((c) => (c.getAttribute('href') || '').slice(1)),
        };
      });

      eq(`bar-present-mid:${tag}`, m.present, true, '본문 중간에서 바가 떠 있어야 한다(정의역 sentinel)');
      bump('bar', m.present ? 1 : 0);

      // ⑦ 본문 섹션 좌표 불변 — `position: fixed`라 레이아웃을 밀지 않는다는 계약
      eq(`no-layout-shift:${tag}`, m.tops, before.tops,
        `바 등장 전/후 [data-tech-section] 문서 좌표 (before barPresent=${before.barPresent})`);
      bump('shift', Object.keys(m.tops).length);

      // 배경 불투명 — 반투명이면 스크롤 중 본문이 칩 뒤로 흘러 라벨을 읽을 수 없다(mobile.css 실측 선례)
      const alpha = (() => { const g = /rgba?\(([^)]+)\)/.exec(m.bg || ''); if (!g) return null;
        const p = g[1].split(',').map((x) => parseFloat(x.trim())); return p.length > 3 ? p[3] : 1; })();
      eq(`bar-opaque:${tag}`, alpha, 1, `배경 ${m.bg}`);
      eq(`bar-z-index:${tag}`, m.zIndex, '40', '페이지 레이어 위 · 크롬 50 아래');
      eq(`bar-fixed:${tag}`, m.position, 'fixed', 'sticky로 바꾸면 정적 레이아웃이 움직여 기록된 결정 1·2가 위험해진다');
      bump('style', 3);

      // ⑥ 앵커가 바에 가리지 않는가 — **S4(scroll-margin 상향)의 유일한 라이브 검증**
      const anchorChecks = [];
      for (const target of m.targets || []) {
        await page.evaluate((t) => { const el = document.getElementById(t); if (el) el.scrollIntoView(); }, target);
        await page.waitForTimeout(450);
        const r = await page.evaluate((t) => {
          const el = document.getElementById(t);
          const bar = document.querySelector('[data-tech-chapter-nav]');
          const title = el ? el.querySelector('.rpt-title__text, h3, h2') || el : null;
          return { titleTop: title ? Math.round(title.getBoundingClientRect().top) : null,
            barBottom: bar ? Math.round(bar.getBoundingClientRect().bottom) : 0 };
        }, target);
        // 제목 top이 바 bottom 이상이어야 가리지 않는다
        if (r.titleTop != null && r.titleTop < r.barBottom) anchorChecks.push(`${target}(title=${r.titleTop}<bar=${r.barBottom})`);
      }
      eq(`anchor-not-covered:${tag}`, anchorChecks, [], `칩 ${(m.targets || []).length}개 점프 후 제목이 바에 가리지 않는다`);
      bump('anchor', (m.targets || []).length);

      // 해시 직접 진입도 같은 축 — 네이티브 앵커 경로가 scroll-margin을 타는지
      const last = (m.targets || [])[(m.targets || []).length - 1];
      if (last) {
        await page.goto(`${BASE}/tech-report/${slug}#${last}`, { waitUntil: 'networkidle' }).catch(() => {});
        await page.waitForTimeout(1200);
        const h = await page.evaluate((t) => {
          const el = document.getElementById(t);
          const bar = document.querySelector('[data-tech-chapter-nav]');
          const title = el ? el.querySelector('.rpt-title__text, h3, h2') || el : null;
          return { titleTop: title ? Math.round(title.getBoundingClientRect().top) : null,
            barBottom: bar ? Math.round(bar.getBoundingClientRect().bottom) : 0, scrollY: Math.round(window.scrollY) };
        }, last);
        eq(`hash-entry-not-covered:${tag}`, h.titleTop == null || h.scrollY === 0 || h.titleTop >= h.barBottom, true,
          `#${last} 직접 진입 — 제목 ${h.titleTop} vs 바 bottom ${h.barBottom} (scrollY ${h.scrollY})`);
        bump('hash');
      }

      // reduced-motion 대조군 — REDUCED=1로 돌리면 전환이 0이어야 한다
      if (REDUCED) {
        eq(`reduced-motion:${tag}`, m.chipTransition, '0s', 'prefers-reduced-motion: reduce에서 전환 없음');
        bump('rm');
      }
    } catch (e) {
      P(false, `harness:${tag}`, `FAIL — 계측 예외: ${e}`);
    } finally { await page.close(); }
  }
  await ctx.close();
}
await browser.close();

const COMBOS = VIEWS.length * SLUGS.length;
console.log(`\n커버리지 — 조합 ${COMBOS}개 기준`);
for (const k of Object.keys(cov)) console.log(`  ${k}: ${cov[k]}`);
const fails = results.filter((r) => !r.ok);
console.log(`\n단언 총계: ${results.length}건 · PASS ${results.length - fails.length} · FAIL ${fails.length}`);
console.log(`※ 다크 테마 ${VIEWS.filter((v) => v.theme === 'dark').length}/${VIEWS.length} 뷰 — C1 루프 프로브가 못 덮는 부분이 이 파일의 존재 이유다.`);
console.log('※ REDUCED=1 로 돌리면 prefers-reduced-motion 축이 추가된다(대조군).');
if (fails.length) { console.log('\nFAIL 목록:'); for (const r of fails) console.log(`  ✗ ${r.tag} — ${r.msg}`); process.exit(1); }
console.log('ALL PASS');
