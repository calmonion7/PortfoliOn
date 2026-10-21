// task#369 라이브 UAT — 심층 리포트 v2(구조 축·9렌즈) 화면. task#372: 렌즈 표시명·「?」 설명·m278 추가. read-only(GET만), 쓰기 0.
// task#398: 「렌즈 상세」 절이 없어지고 상세는 신호 행 안에서 펼친다 — 접힘 기본을 먼저 재고, 「모두 펼치기」 뒤 펼침 소속·넘침을 잰다.
// 대상: 최신 발행물이 format 2인 종목(기본 CRCL, TICKER 환경변수로 변경). 기대값은 전부 API 응답에서 유도한다.
// 축 순서: ⓐ 대상에 닿았다(reached) → ⓑ identity(제목·신호 라벨이 API와 같다) → ⓒ 판정축.
// 「FAIL 0」만 보지 말고 단언 총계도 볼 것 — 총계가 기대치(뷰포트×테마×축)보다 작으면 미실행이다.
import { chromium } from 'playwright';
import fs from 'node:fs';

// BASE 로 dev 스택(http://127.0.0.1:8084)도 잴 수 있다(task#394)
const BASE = process.env.BASE || 'https://portfolion.taebro.com';
const TICKER = process.env.TICKER || 'CRCL';
const OUT = 'screenshots-uat369';
fs.mkdirSync(OUT, { recursive: true });

const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }) });
const { access_token, refresh_token } = await r.json();
const H = { Authorization: `Bearer ${access_token}` };
const latest = (await (await fetch(`${BASE}/api/analyst-reports/${TICKER}`, { headers: H })).json()).reports[0];
const rep = await (await fetch(`${BASE}/api/analyst-reports/${TICKER}/${latest.published_date}`, { headers: H })).json();

let pass = 0, fail = 0, samples10 = 0;
const ok = (name, cond, detail = '') => { if (cond) pass++; else fail++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };

ok('api-format-2', rep.format === 2, `format=${rep.format} date=${rep.published_date}`);
const LABEL = { go: '초록', wait: '노랑', stop: '빨강', na: '미산출' };
const lenses = [...(rep.lenses || [])].sort((a, b) => a.id - b.id);
const expEstimate = lenses.filter(l => l.computed?.estimate_based).length;
const expFlips = lenses.filter(l => l.signal !== 'na' && l.flip).length;
const gaugeLenses = lenses.filter(l => l.signal !== 'na' && (l.computed?.gauge || l.gauge));
const condLenses = lenses.filter(l => l.signal !== 'na' && !(l.computed?.gauge || l.gauge) && l.conditions?.length);
const JUDG = [1, 2, 6, 7, 9, 10];
// task#393 — 렌즈 10은 task#391에 붙고 task#392부터 새 판에 필수다. 그 이전의 9렌즈(옛) 판과 10렌즈 판이 공존한다. 개수는 API에서 유도한다.
const N = lenses.length;
ok('api-lens-ids', (N === 9 || N === 10) && lenses.every((l, i) => l.id === i + 1), `ids=${lenses.map(l => l.id)}`);
const L10 = lenses.find(l => l.id === 10 && l.signal !== 'na' && l.precedents?.length);
const OUTC = ['realized', 'partial', 'not_realized'];
// task#398 — 「상세」 버튼은 펼칠 내용이 있는 렌즈에만 있다(화면 hasDetail과 같은 정의)
const hasDetail = l => !!(l.metrics?.length || l.body || l.computed || Object.keys(l.inputs || {}).length || (l.id === 10 && l.precedents?.length));
const expToggles = lenses.filter(hasDetail).map(l => String(l.id));
const expBadges = { est: lenses.filter(l => l.computed?.estimate_based).length, cons: lenses.filter(l => l.computed?.consensus_based).length };
const squash = t => (t || '').replace(/\s+/g, '');
const OUT_LABEL = { realized: '현실화', partial: '부분 현실화', not_realized: '비현실화' };
ok('api-lens10-base-rate', !L10 || (L10.precedents.length >= 2 && L10.precedents.length <= 5 && L10.base_rate?.total === L10.precedents.length
  && OUTC.every(o => (L10.base_rate[o] || 0) === L10.precedents.filter(p => p.outcome === o).length)),
  L10 ? `precedents=${L10.precedents.length} base_rate=${JSON.stringify(L10.base_rate)}` : '표본 0 — 렌즈 10 사례 없는 판');
ok('api-judgment-structured', lenses.filter(l => JUDG.includes(l.id) && l.signal !== 'na').every(l => !!l.gauge !== !!l.conditions?.length), '판단 렌즈마다 gauge 또는 conditions 정확히 하나');
ok('api-three-colors', lenses.every(l => (!l.conditions || l.conditions.map(c => c.color).sort().join() === 'go,stop,wait') && (!l.gauge || l.gauge.zones.length === 3)), '조건·판단 게이지 모두 세 색');
ok('api-gauges-present', gaugeLenses.length > 0, `n=${gaugeLenses.length} — 0이면 게이지 축이 공허하게 통과한다`);

// task#372 — 렌즈 표시명(일반인 말)·「?」 설명. 이름은 API가 주지 않으므로 화면 정본을 여기 고정한다.
const NAMES = ['숫자의 신뢰도', '지금 매출 속도', '벌수록 남는 구조', '묶여 있는 비용', '망할 위험',
  '고객 이탈 위험', '경영진·대주주', '지금 주가 수준', '앞으로의 수요', '위험의 전례'].slice(0, N);
const QUESTION3 = '매출이 늘 때 비용이 덜 느는가';
// pc1440을 먼저 잰다 — content-preserved 축이 모바일을 그 값과 대조한다(task#394)
const VIEWPORTS = [['pc1440', { width: 1440, height: 900 }, false], ['m278', { width: 278, height: 640 }, true], ['m350', { width: 350, height: 760 }, true], ['m390', { width: 390, height: 844 }, true]];
let pcContent = null;
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
    const m = await page.evaluate((W) => {
      const cells = [...document.querySelectorAll('[data-lens-cell]')];
      const html = document.documentElement;
      // 가로 스크롤 컨테이너 안은 넘쳐도 정상(의도된 스크롤)
      const inScroller = e => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) if (/auto|scroll/.test(getComputedStyle(p).overflowX)) return true; return false; };
      return {
        innerWidth: window.innerWidth,
        scrollWidth: html.scrollWidth,
        // overflow:hidden 으로 잘라 숨겨도 요소 상자는 남는다 — 상자 자체를 본다
        beyond: [...document.querySelectorAll('body *')].filter(e => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.right > W + 0.5 && getComputedStyle(e).visibility !== 'hidden' && !inScroller(e);
        }).map(e => `${e.tagName.toLowerCase()}${e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : ''} r=${Math.round(e.getBoundingClientRect().right)}`),
        // display:none 으로 숨기면 innerText 에서 빠진다 — pc 대비 내용 보존 확인용
        segShare: (document.body.innerText.match(/매출 비중/g) || []).length,
        dates: [...new Set(document.body.innerText.match(/\d{4}-\d{2}-\d{2}/g) || [])].sort().join(','),
        cellIds: cells.map(c => c.getAttribute('data-lens-cell')),
        cellText: cells.map(c => c.textContent),
        body: document.body.innerText,
        estimateTags: [...document.querySelectorAll('.badge')].filter(e => e.textContent.trim() === '추정 기반').length,
        ratingBadges: [...document.querySelectorAll('.badge')].filter(e => ['매수', '중립', '매도'].includes(e.textContent.trim())).length,
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
        helpBtns: [...document.querySelectorAll('button[aria-label$="— 설명 보기"]')].map(e => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height }; }),
        // 낱자 세로 적층 감지 — 이름 상자의 폭이 글자 2개 폭보다 좁거나, 줄 수가 2를 넘으면 적층/과도 줄바꿈
        nameStack: [...document.querySelectorAll('[data-lens-name] > span:last-child')].map(e => {
          const cs = getComputedStyle(e), fs = parseFloat(cs.fontSize), lh = parseFloat(cs.lineHeight) || fs * 1.5, r = e.getBoundingClientRect();
          return { name: e.textContent, narrow: r.width < fs * 2, lines: Math.round(r.height / lh) };
        }).filter(x => x.narrow || x.lines > 2),
        headerOverflow: [...document.querySelectorAll('[data-lens-cell] > div:first-child')].map(e => e.scrollWidth - e.clientWidth).filter(v => v > 0).length,
        // task#393 렌즈 10 표면
        absent10: document.querySelectorAll('[data-lens10-absent]').length,
        detail10: !!document.querySelector('[data-lens-cell="10"]'),
        bars: document.querySelectorAll('[data-base-rate-bar]').length,
        segs: [...document.querySelectorAll('[data-base-rate-bar] [data-outcome-seg]')].map(e => e.getAttribute('data-outcome-seg')),
        caption: document.querySelector('[data-base-rate-caption]')?.textContent || '',
        risk10: document.querySelector('[data-lens10-risk]')?.textContent || '',
        precRows: document.querySelectorAll('[data-precedent]').length,
        // ── task#398 접힘 기본 ──
        toggles: [...document.querySelectorAll('[data-lens-detail-toggle]')].map(t => ({ id: t.getAttribute('data-lens-detail-toggle'), tag: t.tagName,
          exp: t.getAttribute('aria-expanded'), h: t.getBoundingClientRect().height, owner: t.closest('[data-lens-cell]')?.getAttribute('data-lens-cell') })),
        expandAll: (() => { const t = document.querySelector('[data-lens-expand-all]'); return t ? { text: t.textContent.trim(), h: t.getBoundingClientRect().height } : null; })(),
        details: document.querySelectorAll('[data-lens-detail]').length,
        headBadges: cells.map(c => { const bs = [...(c.firstElementChild?.querySelectorAll('.badge') || [])].map(e => e.textContent.trim());
          return { id: c.getAttribute('data-lens-cell'), est: bs.filter(x => x === '추정 기반').length, cons: bs.filter(x => x === '애널 추정치').length }; }),
        lensAnchors: document.querySelectorAll('a[href^="#lens-"], [id^="lens-"]').length,
        oldDetailTitle: [...document.querySelectorAll('.rpt-title__text')].filter(e => e.textContent.includes('렌즈 상세')).length,
      };
    }, viewport.width);
    ok(`${tag} theme-applied`, m.theme === scheme, `data-theme=${m.theme}`);
    ok(`${tag} reached`, m.cellIds.length === N, `cells=${m.cellIds.length} vs api ${N}`);
    ok(`${tag} board-order`, JSON.stringify(m.cellIds) === JSON.stringify(lenses.map(l => String(l.id))));
    ok(`${tag} title-identity`, m.body.includes(rep.title));
    ok(`${tag} signal-labels`, lenses.every((l, i) => (m.cellText[i] || '').includes(LABEL[l.signal])));
    ok(`${tag} no-rating-badge`, m.ratingBadges === 0, `n=${m.ratingBadges}`);
    ok(`${tag} estimate-tags`, m.estimateTags === expEstimate, `${m.estimateTags} vs api ${expEstimate}`);
    // 조건 목록으로 그리는 렌즈는 같은 내용의 문장을 반복하지 않는다(화면 규칙과 같은 정의역)
    ok(`${tag} flips-shown`, lenses.filter(l => l.signal !== 'na' && l.flip && !condLenses.includes(l)).every(l => m.body.includes(l.flip)), `n=${expFlips - condLenses.length}`);
    // 설정 폭과 비교한다 — 모바일 에뮬레이션은 넘치는 콘텐츠에 맞춰 레이아웃 뷰포트(innerWidth)를 넓히므로
    // innerWidth 기준 비교는 그 넘침에 블라인드다(task#393 실측 m278 → innerWidth 296·314, task#394 정정)
    ok(`${tag} no-h-scroll`, m.innerWidth === viewport.width && m.scrollWidth <= viewport.width, `innerWidth=${m.innerWidth} scrollWidth=${m.scrollWidth} vs ${viewport.width}`);
    ok(`${tag} no-element-beyond-viewport`, m.beyond.length === 0, `n=${m.beyond.length} ${m.beyond.slice(0, 3).join(' | ')}`);
    if (!isMobile) pcContent = { segShare: m.segShare, dates: m.dates };
    ok(`${tag} content-preserved`, !!pcContent && m.segShare === pcContent.segShare && m.dates === pcContent.dates,
      `매출 비중 ${m.segShare} vs pc ${pcContent?.segShare} · 날짜 ${m.dates.split(',').length} vs pc ${pcContent?.dates.split(',').length}`);
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
    // 대상 도달 축 — 0건 클릭이 조용히 통과하지 않게(task#358) 버튼 개수를 먼저 단언한다. 상세 헤더가 없어져 신호 행 한 곳뿐(task#398)
    ok(`${tag} help-buttons-reached`, m.helpBtns.length === N, `n=${m.helpBtns.length} vs ${N}`);
    ok(`${tag} help-tap-32`, m.helpBtns.length > 0 && m.helpBtns.every(x => x.h >= 32 && x.w >= 32), `min h=${Math.min(...m.helpBtns.map(x => x.h))} w=${Math.min(...m.helpBtns.map(x => x.w))}`);
    const helpBtn = page.locator('[data-lens-cell="3"] button[aria-label="벌수록 남는 구조 — 설명 보기"]');
    const nHelp = await helpBtn.count();
    let tip = '';
    // 스크롤 중 레이아웃 이동으로 이웃 셀·탭바가 클릭을 순간 가로챌 수 있다(task#393 실측 — 겹침 아님, elementFromPoint는 버튼 자신)
    // → 1회 재시도, 그래도 안 되면 프로브를 죽이지 말고 축 FAIL로 남긴다
    // 기본은 Playwright click. 실패하면(000660 m278 — 이웃 셀·탭바가 가로챔) 가운데로 스크롤 → 정착 대기 → hit-test가
    // 대상 자신일 때만 좌표로 탭한다(가려져 있으면 false → 축 FAIL). ⚠️ m278에서 이 폴백까지 실패하면 먼저 레이아웃 폭을 볼 것:
    // 콘텐츠가 278보다 넓으면 모바일 에뮬레이션이 레이아웃 뷰포트를 넓혀(innerWidth 296·314) 터치 좌표가 어긋난다(task#393 실측 —
    // 사업부문 카드·날짜 span이 밀어낸다, 렌즈 10 무관 — task#394에서 수정). no-h-scroll은 설정 폭 기준이라 그 넘침을 잡는다.
    const click = async (loc) => {
      if (await loc.click({ timeout: 5000 }).then(() => true, () => false)) return true;
      await loc.evaluate(e => e.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(600);
      const pt = await loc.evaluate(e => {
        const r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
        return e.contains(document.elementFromPoint(x, y)) ? { x, y } : null;
      });
      if (!pt) return false;
      if (isMobile) await page.touchscreen.tap(pt.x, pt.y); else await page.mouse.click(pt.x, pt.y);
      return true;
    };
    if (nHelp === 1 && await click(helpBtn)) { tip = (await page.locator('[role="tooltip"]').first().textContent({ timeout: 3000 }).catch(() => '')) || ''; }
    ok(`${tag} help-popover-question`, nHelp === 1 && tip.includes('벌수록 남는 구조') && tip.includes(QUESTION3), `btn=${nHelp} tip="${tip}"`);
    if (nHelp === 1) await page.keyboard.press('Escape');
    ok(`${tag} names-no-stacking`, m.nameStack.length === 0, JSON.stringify(m.nameStack));
    ok(`${tag} lens-header-no-overflow`, m.headerOverflow === 0, `n=${m.headerOverflow}`);
    // ── task#398 ① 접힘 기본 · ③ 배지 위치 · ④ 탭 높이 — 「렌즈 상세」 절·앵커가 없고, 상세 버튼은 제 행 안에 전부 접힌 채 ──
    ok(`${tag} no-detail-section`, m.oldDetailTitle === 0 && m.lensAnchors === 0, `title=${m.oldDetailTitle} anchors=${m.lensAnchors}`);
    ok(`${tag} collapsed-default`, expToggles.length > 0 && JSON.stringify(m.toggles.map(t => t.id)) === JSON.stringify(expToggles)
      && m.toggles.every(t => t.tag === 'BUTTON' && t.exp === 'false' && t.owner === t.id) && m.details === 0,
      `toggles=${m.toggles.map(t => `${t.id}:${t.exp}`).join(',')} vs api ${expToggles} details=${m.details}`);
    ok(`${tag} toggle-tap-44`, m.toggles.length > 0 && m.toggles.every(t => t.h >= 44) && (m.expandAll?.h || 0) >= 44,
      `min toggle h=${Math.min(...m.toggles.map(t => t.h))} expandAll h=${m.expandAll?.h}`);
    const badgeBad = lenses.filter(l => { const hb = m.headBadges.find(x => x.id === String(l.id)); return !hb || hb.est !== (l.computed?.estimate_based ? 1 : 0) || hb.cons !== (l.computed?.consensus_based ? 1 : 0); }).map(l => l.id);
    ok(`${tag} badges-in-head`, badgeBad.length === 0, `불일치 ${badgeBad.join(',') || '없음'} · 표본 추정 기반 ${expBadges.est} · 애널 추정치 ${expBadges.cons}${expBadges.est + expBadges.cons === 0 ? ' — 표본 없음(미검증)' : ''}`);
    // ── 「모두 펼치기」 → ② 펼침 소속(내용이 제 행의 자손 + 상자 ⊂ 행 상자) · ⑤ 펼친 상태 넘침 0 ──
    const expBtn = page.locator('[data-lens-expand-all]');
    const expClicked = await expBtn.count() === 1 && await click(expBtn);
    await page.waitForTimeout(300);
    const e = await page.evaluate((W) => {
      const inScroller = el => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (/auto|scroll/.test(getComputedStyle(p).overflowX)) return true; return false; };
      return {
        expandAllText: document.querySelector('[data-lens-expand-all]')?.textContent.trim(),
        open: [...document.querySelectorAll('[data-lens-detail-toggle]')].filter(t => t.getAttribute('aria-expanded') === 'true').map(t => t.getAttribute('data-lens-detail-toggle')),
        dets: [...document.querySelectorAll('[data-lens-detail]')].map(d => {
          const c = d.closest('[data-lens-cell]'), cr = c?.getBoundingClientRect(), dr = d.getBoundingClientRect();
          return { id: d.getAttribute('data-lens-detail'), owner: c?.getAttribute('data-lens-cell') || null, h: dr.height, text: d.textContent,
            inside: !!c && dr.left >= cr.left - 0.5 && dr.right <= cr.right + 0.5 && dr.top >= cr.top - 0.5 && dr.bottom <= cr.bottom + 0.5 };
        }),
        summaryCounts: [...document.querySelectorAll('[data-lens-cell]')].map(c => ({ id: c.getAttribute('data-lens-cell'), text: c.textContent })),
        innerWidth: window.innerWidth, scrollWidth: document.documentElement.scrollWidth,
        beyond: [...document.querySelectorAll('body *')].filter(el => { const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.right > W + 0.5 && getComputedStyle(el).visibility !== 'hidden' && !inScroller(el); }).length,
        rowOverflow: [...document.querySelectorAll('[data-lens-cell]')].map(c => c.scrollWidth - c.clientWidth).filter(v => v > 0).length,
        headerOverflow: [...document.querySelectorAll('[data-lens-cell] > div:first-child')].map(el => el.scrollWidth - el.clientWidth).filter(v => v > 0).length,
      };
    }, viewport.width);
    ok(`${tag} expand-all`, expClicked && JSON.stringify(e.open) === JSON.stringify(expToggles) && e.expandAllText === '모두 접기', `clicked=${expClicked} open=${e.open} label=${e.expandAllText}`);
    const detBad = e.dets.filter(d => d.owner !== d.id || !d.inside || d.h <= 0).map(d => `${d.id}:owner=${d.owner},inside=${d.inside},h=${Math.round(d.h)}`);
    ok(`${tag} expanded-in-own-row`, e.dets.length === expToggles.length && detBad.length === 0, `dets=${e.dets.length} bad=${detBad.join('|') || '없음'}`);
    // 본문이 그 행의 펼침 영역 안에 있다(identity — 빈 상자가 소속만 맞고 통과하지 않게)
    const bodyBad = lenses.filter(l => l.body && !squash(e.dets.find(d => d.id === String(l.id))?.text).includes(squash(l.body).slice(0, 40))).map(l => l.id);
    ok(`${tag} expanded-body-identity`, bodyBad.length === 0, `본문 불일치 ${bodyBad.join(',') || '없음'} (본문 있는 렌즈 ${lenses.filter(l => l.body).length})`);
    // 요약은 행마다 한 번(상세 머리의 중복 제거)
    const sumBad = lenses.filter(l => l.summary && (e.summaryCounts.find(c => c.id === String(l.id))?.text.split(l.summary).length - 1) !== 1).map(l => l.id);
    ok(`${tag} summary-once`, sumBad.length === 0, `중복·누락 ${sumBad.join(',') || '없음'}`);
    ok(`${tag} expanded-no-overflow`, e.innerWidth === viewport.width && e.scrollWidth <= viewport.width && e.beyond === 0 && e.rowOverflow === 0 && e.headerOverflow === 0,
      `innerWidth=${e.innerWidth} scrollWidth=${e.scrollWidth} beyond=${e.beyond} row=${e.rowOverflow} head=${e.headerOverflow}`);
    if (scheme === 'light') await page.screenshot({ path: `${OUT}/${TICKER}-${tag}-expanded.png`, fullPage: true });
    // ── task#393 렌즈 10 — 9렌즈 판은 안내 한 줄, 10렌즈 판은 렌즈 10 행. 사례 있는 판은 막대·캡션·행이 API 집계와 같다 ──
    ok(`${tag} lens10-presence`, N === 10 ? (m.absent10 === 0 && m.detail10) : (m.absent10 === 1 && !m.detail10), `N=${N} absent=${m.absent10} detail=${m.detail10}`);
    const br = L10?.base_rate;
    ok(`${tag} lens10-base-rate`, L10
      ? m.bars === 1 && JSON.stringify(m.segs) === JSON.stringify(OUTC.filter(o => br[o] > 0))
        && m.caption.includes(`전례 ${br.total}건`) && OUTC.every(o => m.caption.includes(`${OUT_LABEL[o]} ${br[o] || 0}`)) && m.risk10.includes(L10.risk)
      : m.bars === 0, `bars=${m.bars} segs=${m.segs} caption="${m.caption}"`);
    // 사례 목록은 펼침 안(task#398) — 접힘에선 0, 펼친 뒤엔 API 수와 같고 전부 렌즈 10 행의 자손
    const precOpen = await page.evaluate(() => ({ n: document.querySelectorAll('[data-precedent]').length, in10: document.querySelectorAll('[data-lens-cell="10"] [data-precedent]').length }));
    ok(`${tag} lens10-precedent-rows`, m.precRows === 0 && precOpen.n === (L10?.precedents.length || 0) && precOpen.in10 === precOpen.n,
      `접힘 ${m.precRows} · 펼침 ${precOpen.n}(렌즈 10 행 안 ${precOpen.in10}) vs api ${L10?.precedents.length || 0}`);
    let expanded = '';
    const row0 = page.locator('[data-precedent="0"] button');
    if (L10 && await row0.count() === 1 && await click(row0)) { expanded = (await page.locator('[data-precedent="0"]').textContent()) || ''; }
    ok(`${tag} lens10-expand-ref`, !L10 || (expanded.includes(L10.precedents[0].ref) && (await row0.getAttribute('aria-expanded')) === 'true'), L10 ? `ref 표시=${expanded.includes(L10.precedents[0].ref)}` : '표본 0');
    const lens10Overflow = await page.evaluate(() => [...document.querySelectorAll('[data-lens-cell="10"], [data-lens-cell="10"] *')].filter(el => el.scrollWidth - el.clientWidth > 1 && getComputedStyle(el).display !== 'inline').length);
    ok(`${tag} lens10-no-overflow`, lens10Overflow === 0, `n=${lens10Overflow}`);
    // ── task#395 사례 행 모양 — 넘침 축이 못 보는 「행마다 줄바꿈이 갈림」. 모든 행이 [제목+화살표] / [배지+기간] 2줄이고
    //    제목이 낱자로 눌리지 않는다. 행 1도 펼쳐 2행 펼침 스크린샷을 남기고, 펼친 행의 note 분리를 API note 표지와 대조한다 ──
    const row1 = page.locator('[data-precedent="1"] button');
    if (L10 && await row1.count() === 1) await click(row1);
    const shape = await page.evaluate(() => [...document.querySelectorAll('[data-precedent]')].map(li => {
      const h = li.querySelectorAll('[data-precedent-head]'), mt = li.querySelectorAll('[data-precedent-meta]');
      if (h.length !== 1 || mt.length !== 1) return { i: li.dataset.precedent, bad: `head=${h.length} meta=${mt.length}` };
      const hr = h[0].getBoundingClientRect(), mr = mt[0].getBoundingClientRect(), t = h[0].firstElementChild, fs = parseFloat(getComputedStyle(t).fontSize);
      return { i: li.dataset.precedent, metaBelow: mr.top >= hr.bottom - 0.5, titleW: Math.round(t.getBoundingClientRect().width), narrow: t.getBoundingClientRect().width < fs * 4,
        badgeInMeta: !!mt[0].querySelector('.badge'), open: li.querySelector('button').getAttribute('aria-expanded') === 'true',
        same: li.querySelector('[data-precedent-same]')?.textContent ?? null, diff: li.querySelector('[data-precedent-diff]')?.textContent ?? null,
        oldLabel: li.textContent.includes('같은 점·다른 점'), overflow: [...li.querySelectorAll('*')].filter(e => e.scrollWidth - e.clientWidth > 1 && getComputedStyle(e).display !== 'inline').length };
    }));
    const badShape = shape.filter(s => s.bad || !s.metaBelow || s.narrow || !s.badgeInMeta);
    ok(`${tag} lens10-row-shape`, shape.length === (L10?.precedents.length || 0) && badShape.length === 0,
      `rows=${shape.length} bad=${JSON.stringify(badShape)} titleW=${shape.map(s => s.titleW).join(',')}`);
    const opened = shape.filter(s => s.open);
    const splitOk = s => { const note = L10.precedents[+s.i].note || ''; return !s.oldLabel && s.overflow === 0
      && (s.same !== null) === note.includes('같은 점:') && (s.diff !== null) === note.includes('다른 점:'); };
    ok(`${tag} lens10-note-split`, !L10 || (opened.length >= Math.min(2, L10.precedents.length) && opened.every(splitOk)),
      L10 ? `opened=${opened.length} ${JSON.stringify(opened.map(s => ({ i: s.i, same: !!s.same, diff: !!s.diff, old: s.oldLabel, ov: s.overflow })))}` : '표본 0');
    if (L10) samples10++;
    await page.screenshot({ path: `${OUT}/${TICKER}-${tag}.png`, fullPage: true });
    await ctx.close();
  }
}
await b.close();
// 표본 0이면 렌즈 10 축은 통과가 아니라 미검증이다(task#318)
console.log(`표본 lens10(사례 있는 판 × 컨텍스트)=${samples10}${samples10 === 0 ? ' — 미검증' : ''} · 렌즈 수 N=${N}`);
console.log(`단언 총계 ${pass + fail} · PASS ${pass} · FAIL ${fail} (기대 총계 ${6 + VIEWPORTS.length * 2 * 40})`);
process.exit(fail ? 1 : 0);
