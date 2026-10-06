// task#369 라이브 UAT — 심층 리포트 v2(구조 축·9렌즈) 화면. read-only(GET만), 쓰기 0.
// 대상: 최신 발행물이 format 2인 종목(기본 CRCL, TICKER 환경변수로 변경). 기대값은 전부 API 응답에서 유도한다.
// 축 순서: ⓐ 대상에 닿았다(reached) → ⓑ identity(제목·신호 라벨이 API와 같다) → ⓒ 판정축.
// 「FAIL 0」만 보지 말고 단언 총계도 볼 것 — 총계가 기대치(뷰포트×테마×축)보다 작으면 미실행이다.
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'https://portfolion.taebro.com';
const TICKER = process.env.TICKER || 'CRCL';
const OUT = 'screenshots-uat369';
fs.mkdirSync(OUT, { recursive: true });

const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }) });
const { access_token, refresh_token } = await r.json();
const H = { Authorization: `Bearer ${access_token}` };
const latest = (await (await fetch(`${BASE}/api/analyst-reports/${TICKER}`, { headers: H })).json()).reports[0];
const rep = await (await fetch(`${BASE}/api/analyst-reports/${TICKER}/${latest.published_date}`, { headers: H })).json();

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) pass++; else fail++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };

ok('api-format-2', rep.format === 2, `format=${rep.format} date=${rep.published_date}`);
const LABEL = { go: '초록', wait: '노랑', stop: '빨강', na: '미산출' };
const lenses = [...(rep.lenses || [])].sort((a, b) => a.id - b.id);
const expEstimate = lenses.filter(l => l.computed?.estimate_based).length;
const expFlips = lenses.filter(l => l.signal !== 'na' && l.flip).length;
const gaugeLenses = lenses.filter(l => l.signal !== 'na' && l.computed?.gauge);
ok('api-gauges-present', gaugeLenses.length > 0, `n=${gaugeLenses.length} — 0이면 게이지 축이 공허하게 통과한다`);

const VIEWPORTS = [['m390', { width: 390, height: 844 }, true], ['pc1440', { width: 1440, height: 900 }, false]];
const b = await chromium.launch();
for (const [vp, viewport, isMobile] of VIEWPORTS) {
  for (const scheme of ['light', 'dark']) {
    const tag = `${vp}-${scheme}`;
    const ctx = await b.newContext({ viewport, isMobile, hasTouch: isMobile, deviceScaleFactor: 2, colorScheme: scheme, serviceWorkers: 'block' });
    await ctx.addInitScript(([a, rr, s]) => {
      localStorage.setItem('access_token', a); localStorage.setItem('refresh_token', rr);
      localStorage.setItem('pwa-install-dismissed-at', String(Date.now()));
      localStorage.setItem('theme', s);
    }, [access_token, refresh_token, scheme]);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/analyst-report/${TICKER}/${rep.published_date}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-lens-cell]', { timeout: 20000 }).catch(() => {});
    const m = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('[data-lens-cell]')];
      const html = document.documentElement;
      return {
        cellIds: cells.map(c => c.getAttribute('data-lens-cell')),
        cellText: cells.map(c => c.textContent),
        body: document.body.innerText,
        estimateTags: [...document.querySelectorAll('.badge')].filter(e => e.textContent.trim() === '추정 기반').length,
        ratingBadges: [...document.querySelectorAll('.badge')].filter(e => ['매수', '중립', '매도'].includes(e.textContent.trim())).length,
        overflowX: html.scrollWidth - window.innerWidth,
        gauges: [...document.querySelectorAll('[data-lens-cell] [data-flip-gauge]')].map(g => ({ id: g.closest('[data-lens-cell]').getAttribute('data-lens-cell'), zone: g.getAttribute('data-current-zone') })),
        rowOverflow: cells.map(c => c.scrollWidth - c.clientWidth).filter(v => v > 0).length,
        labelOverlaps: [...document.querySelectorAll('[data-flip-gauge]')].reduce((n, g) => {
          const rs = [...g.querySelectorAll('[data-boundary]')].map(e => e.getBoundingClientRect());
          for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
            const a = rs[i], b = rs[j];
            if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) n++;
          }
          return n;
        }, 0),
        theme: html.getAttribute('data-theme') || 'light',
      };
    });
    ok(`${tag} theme-applied`, m.theme === scheme, `data-theme=${m.theme}`);
    ok(`${tag} reached`, m.cellIds.length === 9, `cells=${m.cellIds.length}`);
    ok(`${tag} board-order`, JSON.stringify(m.cellIds) === JSON.stringify(lenses.map(l => String(l.id))));
    ok(`${tag} title-identity`, m.body.includes(rep.title));
    ok(`${tag} signal-labels`, lenses.every((l, i) => (m.cellText[i] || '').includes(LABEL[l.signal])));
    ok(`${tag} no-rating-badge`, m.ratingBadges === 0, `n=${m.ratingBadges}`);
    ok(`${tag} estimate-tags`, m.estimateTags === expEstimate, `${m.estimateTags} vs api ${expEstimate}`);
    ok(`${tag} flips-shown`, lenses.filter(l => l.signal !== 'na' && l.flip).every(l => m.body.includes(l.flip)), `n=${expFlips}`);
    ok(`${tag} no-h-scroll`, m.overflowX <= 0, `overflow=${m.overflowX}px`);
    // 바뀜 조건 게이지(task#369 UAT 피드백) — API에 게이지가 있는 렌즈 수만큼, 현재값 구간 = 신호
    ok(`${tag} gauges-count`, m.gauges.length === gaugeLenses.length, `${m.gauges.length} vs api ${gaugeLenses.length}`);
    ok(`${tag} gauge-zone=signal`, gaugeLenses.every(l => m.gauges.find(g => g.id === String(l.id))?.zone === l.signal));
    ok(`${tag} rows-no-overflow`, m.rowOverflow === 0, `n=${m.rowOverflow}`);
    ok(`${tag} gauge-labels-no-overlap`, m.labelOverlaps === 0, `겹침 ${m.labelOverlaps}쌍`);
    await page.screenshot({ path: `${OUT}/${TICKER}-${tag}.png`, fullPage: true });
    await ctx.close();
  }
}
await b.close();
console.log(`단언 총계 ${pass + fail} · PASS ${pass} · FAIL ${fail} (기대 총계 ${2 + VIEWPORTS.length * 2 * 13})`);
process.exit(fail ? 1 : 0);
