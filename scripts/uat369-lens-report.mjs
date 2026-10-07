// task#369 라이브 UAT — 심층 리포트 v2(구조 축·9렌즈) 화면. task#372: 렌즈 표시명·「?」 설명·m278 추가. read-only(GET만), 쓰기 0.
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
const gaugeLenses = lenses.filter(l => l.signal !== 'na' && (l.computed?.gauge || l.gauge));
const condLenses = lenses.filter(l => l.signal !== 'na' && !(l.computed?.gauge || l.gauge) && l.conditions?.length);
const JUDG = [1, 2, 6, 7, 9];
ok('api-judgment-structured', lenses.filter(l => JUDG.includes(l.id) && l.signal !== 'na').every(l => !!l.gauge !== !!l.conditions?.length), '판단 렌즈마다 gauge 또는 conditions 정확히 하나');
ok('api-three-colors', lenses.every(l => (!l.conditions || l.conditions.map(c => c.color).sort().join() === 'go,stop,wait') && (!l.gauge || l.gauge.zones.length === 3)), '조건·판단 게이지 모두 세 색');
ok('api-gauges-present', gaugeLenses.length > 0, `n=${gaugeLenses.length} — 0이면 게이지 축이 공허하게 통과한다`);

// task#372 — 렌즈 표시명(일반인 말)·「?」 설명. 이름은 API가 주지 않으므로 화면 정본을 여기 고정한다.
const NAMES = ['숫자의 신뢰도', '지금 매출 속도', '벌수록 남는 구조', '묶여 있는 비용', '망할 위험',
  '고객 이탈 위험', '경영진·대주주', '지금 주가 수준', '앞으로의 수요'];
const QUESTION3 = '매출이 늘 때 비용이 덜 느는가';
const VIEWPORTS = [['m278', { width: 278, height: 640 }, true], ['m390', { width: 390, height: 844 }, true], ['pc1440', { width: 1440, height: 900 }, false]];
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
        gauges: [...document.querySelectorAll('[data-lens-cell] [data-flip-gauge]')].map(g => ({ id: g.closest('[data-lens-cell]').getAttribute('data-lens-cell'), zone: g.getAttribute('data-current-zone'), origin: g.getAttribute('data-origin') })),
        conds: [...document.querySelectorAll('[data-lens-cell] [data-flip-conditions]')].map(c => ({ id: c.closest('[data-lens-cell]').getAttribute('data-lens-cell'), items: c.querySelectorAll('li').length,
          colors: [...c.querySelectorAll('[data-condition]')].map(e => e.getAttribute('data-condition')),
          current: [...c.querySelectorAll('[data-condition][data-current="true"]')].map(e => e.getAttribute('data-condition')) })),
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
        rowNames: [...document.querySelectorAll('[data-lens-name]')].map(e => e.textContent.replace(/^\d+/, '')),
        detailNames: [...document.querySelectorAll('[data-lens-detail-name]')].map(e => e.textContent),
        helpBtns: [...document.querySelectorAll('button[aria-label$="— 설명 보기"]')].map(e => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height }; }),
        // 낱자 세로 적층 감지 — 이름 상자의 폭이 글자 2개 폭보다 좁거나, 줄 수가 2를 넘으면 적층/과도 줄바꿈
        nameStack: [...document.querySelectorAll('[data-lens-name] > span:last-child, [data-lens-detail-name]')].map(e => {
          const cs = getComputedStyle(e), fs = parseFloat(cs.fontSize), lh = parseFloat(cs.lineHeight) || fs * 1.5, r = e.getBoundingClientRect();
          return { name: e.textContent, narrow: r.width < fs * 2, lines: Math.round(r.height / lh) };
        }).filter(x => x.narrow || x.lines > 2),
        headerOverflow: [...document.querySelectorAll('[data-lens-cell] > div:first-child')].map(e => e.scrollWidth - e.clientWidth).filter(v => v > 0).length,
      };
    });
    ok(`${tag} theme-applied`, m.theme === scheme, `data-theme=${m.theme}`);
    ok(`${tag} reached`, m.cellIds.length === 9, `cells=${m.cellIds.length}`);
    ok(`${tag} board-order`, JSON.stringify(m.cellIds) === JSON.stringify(lenses.map(l => String(l.id))));
    ok(`${tag} title-identity`, m.body.includes(rep.title));
    ok(`${tag} signal-labels`, lenses.every((l, i) => (m.cellText[i] || '').includes(LABEL[l.signal])));
    ok(`${tag} no-rating-badge`, m.ratingBadges === 0, `n=${m.ratingBadges}`);
    ok(`${tag} estimate-tags`, m.estimateTags === expEstimate, `${m.estimateTags} vs api ${expEstimate}`);
    // 조건 목록으로 그리는 렌즈는 같은 내용의 문장을 반복하지 않는다(화면 규칙과 같은 정의역)
    ok(`${tag} flips-shown`, lenses.filter(l => l.signal !== 'na' && l.flip && !condLenses.includes(l)).every(l => m.body.includes(l.flip)), `n=${expFlips - condLenses.length}`);
    ok(`${tag} no-h-scroll`, m.overflowX <= 0, `overflow=${m.overflowX}px`);
    // 바뀜 조건 게이지(task#369 UAT 피드백) — API에 게이지가 있는 렌즈 수만큼, 현재값 구간 = 신호
    ok(`${tag} gauges-count`, m.gauges.length === gaugeLenses.length, `${m.gauges.length} vs api ${gaugeLenses.length}`);
    ok(`${tag} gauge-zone=signal`, gaugeLenses.every(l => m.gauges.find(g => g.id === String(l.id))?.zone === l.signal));
    ok(`${tag} gauge-origin`, gaugeLenses.every(l => m.gauges.find(g => g.id === String(l.id))?.origin === (l.computed?.gauge ? 'server' : 'routine')));
    ok(`${tag} conditions-shown`, m.conds.length === condLenses.length && condLenses.every(l => m.conds.find(c => c.id === String(l.id))?.items === l.conditions.reduce((n, c) => n + c.when.length, 0)), `${m.conds.length} vs api ${condLenses.length}`);
    // 세 색 모두(사람 UAT 피드백 3) — 조건 목록도 게이지처럼 초록·노랑·빨강, 지금 색 하나만 「현재」
    ok(`${tag} conditions-three-colors`, condLenses.every(l => { const c = m.conds.find(x => x.id === String(l.id)); return c && JSON.stringify(c.colors) === '["go","wait","stop"]' && JSON.stringify(c.current) === JSON.stringify([l.signal]); }));
    ok(`${tag} rows-no-overflow`, m.rowOverflow === 0, `n=${m.rowOverflow}`);
    ok(`${tag} gauge-labels-no-overlap`, m.labelOverlaps === 0, `겹침 ${m.labelOverlaps}쌍`);
    // ── task#372 렌즈 표시명·「?」 ──
    ok(`${tag} lens-names-row`, JSON.stringify(m.rowNames) === JSON.stringify(NAMES), m.rowNames.join('|'));
    ok(`${tag} lens-names-detail`, JSON.stringify(m.detailNames) === JSON.stringify(NAMES), m.detailNames.join('|'));
    // 대상 도달 축 — 0건 클릭이 조용히 통과하지 않게(task#358) 버튼 개수를 먼저 단언한다
    ok(`${tag} help-buttons-reached`, m.helpBtns.length === 18, `n=${m.helpBtns.length}`);
    ok(`${tag} help-tap-32`, m.helpBtns.length > 0 && m.helpBtns.every(x => x.h >= 32 && x.w >= 32), `min h=${Math.min(...m.helpBtns.map(x => x.h))} w=${Math.min(...m.helpBtns.map(x => x.w))}`);
    const helpBtn = page.locator('[data-lens-cell="3"] button[aria-label="벌수록 남는 구조 — 설명 보기"]');
    const nHelp = await helpBtn.count();
    let tip = '';
    if (nHelp === 1) { await helpBtn.click(); tip = (await page.locator('[role="tooltip"]').first().textContent({ timeout: 3000 }).catch(() => '')) || ''; }
    ok(`${tag} help-popover-question`, nHelp === 1 && tip.includes('벌수록 남는 구조') && tip.includes(QUESTION3), `btn=${nHelp} tip="${tip}"`);
    if (nHelp === 1) await page.keyboard.press('Escape');
    ok(`${tag} names-no-stacking`, m.nameStack.length === 0, JSON.stringify(m.nameStack));
    ok(`${tag} lens-header-no-overflow`, m.headerOverflow === 0, `n=${m.headerOverflow}`);
    await page.screenshot({ path: `${OUT}/${TICKER}-${tag}.png`, fullPage: true });
    await ctx.close();
  }
}
await b.close();
console.log(`단언 총계 ${pass + fail} · PASS ${pass} · FAIL ${fail} (기대 총계 ${4 + VIEWPORTS.length * 2 * 23})`);
process.exit(fail ? 1 : 0);
