// 구루 카드 행 UI/UX 개선 라이브 UAT — 3탭(투자금·인기순·가중치) × 3뷰포트.
//
// 목표(대리지표 아님):
//  ① 순위·티커·값이 **한 줄(같은 line box)** 에 놓인다 — before: 값 t=473.5·티커 486.8·순위 499.3
//  ② 모바일 카드 높이가 줄었다 — before 102.5px
//  ③ 좁은 폭에서 **텍스트가 접히지 않는다**(필 행·헤드 행) — 넘침 0으로는 못 잡는 축(#247)
//  ④ 보이는 텍스트가 **잘리지 않는다**(scrollWidth 축, #241) — 이름칩만 의도된 ellipsis로 면제
//  ⑤ 비중 막대 불변식 — 1위=트랙 꽉 참 · 단조 비증가 · 모든 행 ≥2px(0폭이면 "없음"으로 오독)
//  ⑥ 액션 버튼이 채움 배경이 아니다(위계 하향) — before bg=rgb(234,226,207)
//  ⑦ 카드 자식이 카드 content box를 넘지 않는다
//
// 판정축 주의(회고 누적): ellipsis는 bbox를 넘지 않고(#241), flex 압축은 넘침 0으로 통과한다(#247)
// → 잘림은 scrollWidth, 접힘은 Range.getClientRects().length 로 **각각 별도 축**으로 잰다.
// 커버리지 카운터를 출력한다(#238 ⓐ) — ALL PASS가 "아무것도 안 본 것"과 구별되게.
import { chromium, devices } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = process.env.OUT || '/Users/calmonion/Project/PortfoliOn/screenshots-guru-row-ux';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const P = (ok, tag, msg) => results.push({ ok, tag, msg });
const cov = {};
const bump = (k, n = 1) => { cov[k] = (cov[k] || 0) + n; };

const r = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const { access_token, refresh_token } = await r.json();

// ── 브라우저 안 측정기 ───────────────────────────────────────────
// 범위는 본문으로 한정한다(#238 ⓒ) — 전역 내비/마스트헤드가 섞이면 정상 구현이 거짓 FAIL.
const measure = (sampleN) => {
  const bx = (el) => { const b = el.getBoundingClientRect(); return { l: +b.left.toFixed(1), r: +b.right.toFixed(1), t: +b.top.toFixed(1), b: +b.bottom.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
  const main = document.querySelector('.m-page') || document.querySelector('main.page-wrap') || document.querySelector('main') || document.body;
  // 렌더된 실제 줄 수 — 텍스트 노드에 Range를 걸어 line box를 센다(#247).
  const lines = (el) => {
    if (!el) return 0;
    let n = 0;
    for (const node of el.childNodes) {
      if (node.nodeType === 3 && node.textContent.trim()) {
        const rg = document.createRange(); rg.selectNodeContents(node);
        n = Math.max(n, rg.getClientRects().length);
      }
    }
    // 텍스트가 자식 엘리먼트 안에만 있으면(예: 조각 span) 그 중 최대 줄 수
    if (n === 0) for (const c of el.children) n = Math.max(n, lines(c));
    return n;
  };
  const clipX = (el) => !!el && el.scrollWidth > el.clientWidth + 1;
  const rows = [...main.querySelectorAll('.guru-stat-row')];
  const sample = rows.slice(0, sampleN);
  const cs = (el, p) => el ? getComputedStyle(el)[p] : null;

  return {
    vp: { w: innerWidth, h: innerHeight },
    rowTotal: rows.length,
    // 헤더 계열
    head: main.querySelector('.guru-alloc-head') ? bx(main.querySelector('.guru-alloc-head')) : null,
    caption: main.querySelector('.guru-alloc-caption') ? {
      ...bx(main.querySelector('.guru-alloc-caption')),
      text: main.querySelector('.guru-alloc-caption').textContent.trim(),
      // 조각별 nowrap이 걸렸는지 — 각 조각은 1줄이어야 한다(캡션 자체는 2줄로 흘러도 됨)
      pieces: [...main.querySelectorAll('.guru-alloc-caption > span')].map(s => ({
        text: s.textContent.trim(), lines: lines(s), white: cs(s, 'whiteSpace'), box: bx(s),
      })),
    } : null,
    infoChip: (() => {
      const c = main.querySelector('.guru-alloc-head > .filter-chip');
      return c ? { ...bx(c), text: c.textContent.trim(), expanded: c.getAttribute('aria-expanded') } : null;
    })(),
    scopes: main.querySelector('.guru-alloc-scopes') ? bx(main.querySelector('.guru-alloc-scopes')) : null,
    scopesParent: main.querySelector('.guru-alloc-scopes')?.parentElement ? bx(main.querySelector('.guru-alloc-scopes').parentElement) : null,
    scopeChildren: main.querySelector('.guru-alloc-scopes')
      ? [...main.querySelector('.guru-alloc-scopes').children].map(c => ({ text: c.textContent.trim(), box: bx(c), lines: lines(c), clipX: clipX(c) }))
      : [],
    firstRowDocTop: rows[0] ? +(rows[0].getBoundingClientRect().top + window.scrollY).toFixed(1) : null,
    // 행 계열 — 표본별 전 항목(#249 ⓗ: 단언 대상만 찍지 말고 계열 전체를 출력)
    rows: sample.map((el, i) => {
      const rank = el.querySelector('.guru-stat-rank');
      const headEl = el.querySelector('.guru-stat-head');
      const ticker = el.querySelector('.guru-stat-ticker');
      const value = el.querySelector('.guru-stat-value');
      const name = el.querySelector('.guru-stat-name');
      const bar = el.querySelector('.guru-alloc-bar');
      const fill = bar?.querySelector('span');
      const wl = el.querySelector('.guru-wl-btn');
      const held = el.querySelector('.guru-wl-held');
      // 카드 content box(패딩 안쪽) — 자식 넘침 판정의 기준 상자를 실측한다(#228)
      const st = getComputedStyle(el);
      const cbox = {
        l: el.getBoundingClientRect().left + parseFloat(st.paddingLeft) + parseFloat(st.borderLeftWidth),
        r: el.getBoundingClientRect().right - parseFloat(st.paddingRight) - parseFloat(st.borderRightWidth),
      };
      return {
        i,
        box: bx(el), cbox: { l: +cbox.l.toFixed(1), r: +cbox.r.toFixed(1) },
        hasHead: !!headEl,
        rank: rank ? { ...bx(rank), text: rank.textContent.trim(), lines: lines(rank), clipX: clipX(rank) } : null,
        ticker: ticker ? { ...bx(ticker), text: ticker.textContent.trim(), lines: lines(ticker), clipX: clipX(ticker) } : null,
        value: value ? { ...bx(value), text: value.textContent.trim(), lines: lines(value), clipX: clipX(value) } : null,
        name: name ? { ...bx(name), text: name.textContent.trim() } : null,
        bar: bar ? { track: bx(bar), fillW: fill ? +fill.getBoundingClientRect().width.toFixed(2) : null, styleW: fill?.style.width ?? null } : null,
        wl: wl ? { ...bx(wl), text: wl.textContent.trim(), bg: cs(wl, 'backgroundColor'), border: cs(wl, 'borderTopWidth'), color: cs(wl, 'color'), lines: lines(wl), clipX: clipX(wl) } : null,
        held: held ? { ...bx(held), text: held.textContent.trim() } : null,
      };
    }),
  };
};

const b = await chromium.launch({ headless: true });
const VIEWS = [
  { name: 'pc', ctx: { viewport: { width: 1440, height: 1000 } }, maxRowH: 76 },
  { name: 'mobile390', ctx: { ...devices['iPhone 13'] }, maxRowH: 88 },
  { name: 'narrow350', ctx: { viewport: { width: 350, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, maxRowH: 88 },
];
const TABS = [
  { label: '투자금', key: 'alloc', bar: true },
  { label: '인기순', key: 'pop', bar: false },
  { label: '가중치', key: 'weighted', bar: false },
];
const SAMPLE = 12;

for (const view of VIEWS) {
  const ctx = await b.newContext(view.ctx);
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([a, rr]) => {
    localStorage.setItem('access_token', a); localStorage.setItem('refresh_token', rr); localStorage.setItem('theme', 'light');
  }, [access_token, refresh_token]);
  await page.goto(`${BASE}/guru`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const V = view.name;

  for (const tab of TABS) {
    await page.getByRole('button', { name: tab.label, exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.guru-stat-row').length > 5, { timeout: 60000 })
      .catch(() => {});
    await page.waitForTimeout(tab.bar ? 1200 : 600);
    const m = await page.evaluate(measure, SAMPLE);
    const T = `${V}/${tab.key}`;

    // 표본이 비면 무음 스킵하지 않는다(#238 ⓑ) — 1회 재시도 후 FAIL
    if (m.rows.length === 0) {
      await page.waitForTimeout(2500);
      const m2 = await page.evaluate(measure, SAMPLE);
      if (m2.rows.length === 0) { bump(`${T}/sample`); P(false, `${T}/sample`, `카드 표본 0건 (재시도 후에도) — 측정 실패`); continue; }
      Object.assign(m, m2);
    }
    bump(`${T}/sample`);
    P(m.rows.length >= Math.min(SAMPLE, m.rowTotal), `${T}/sample`,
      `표본 ${m.rows.length}/${SAMPLE} (전체 ${m.rowTotal}행)`);

    // ① 스캔선 — 순위·티커가 같은 line box, 값도 같은 head 행 안
    let axisBad = [], headMissing = 0;
    for (const row of m.rows) {
      bump(`${T}/axis`);
      if (!row.hasHead) { headMissing++; continue; }
      const dRank = Math.abs(row.rank.t - row.ticker.t);
      const inHead = row.value && row.ticker && Math.abs(row.value.b - row.ticker.b) <= 4;
      if (dRank > 2 || !inHead) axisBad.push(`#${row.i}(rankΔ${dRank.toFixed(1)} valueΔ${row.value && row.ticker ? Math.abs(row.value.b - row.ticker.b).toFixed(1) : '?'})`);
    }
    P(headMissing === 0, `${T}/head-exists`, `.guru-stat-head 없는 행 ${headMissing}/${m.rows.length}`);
    P(axisBad.length === 0, `${T}/scan-axis`,
      `순위·티커·값 한 줄 — 어긋난 행 ${axisBad.length}${axisBad.length ? ': ' + axisBad.slice(0, 4).join(' ') : ''} (표본 rank.t=${m.rows[0].rank?.t} ticker.t=${m.rows[0].ticker?.t} value.b−ticker.b=${m.rows[0].value && m.rows[0].ticker ? (m.rows[0].value.b - m.rows[0].ticker.b).toFixed(1) : '?'})`);

    // ② 카드 높이 — 회귀 상한(before 모바일 102.5 / PC 64.5+막대)
    const hs = m.rows.map(r2 => r2.box.h);
    const maxH = Math.max(...hs);
    bump(`${T}/height`, m.rows.length);
    P(maxH <= view.maxRowH, `${T}/row-height`, `카드 높이 최대 ${maxH} ≤ ${view.maxRowH} (표본 ${hs.length}개: ${[...new Set(hs)].join(',')})`);

    // ③ 텍스트 접힘 0 — 넘침 검사로는 원리적으로 안 잡히는 축(#247)
    let wrapped = [];
    for (const row of m.rows) {
      for (const [k, el] of [['rank', row.rank], ['ticker', row.ticker], ['value', row.value], ['wl', row.wl]]) {
        if (!el) continue;
        bump(`${T}/lines`);
        if (el.lines > 1) wrapped.push(`#${row.i}.${k}:${el.lines}줄("${el.text}")`);
      }
    }
    P(wrapped.length === 0, `${T}/no-textwrap`,
      `행 텍스트 접힘 ${wrapped.length}${wrapped.length ? ': ' + wrapped.slice(0, 5).join(' ') : ''}`);

    // ④ 잘림 0 — scrollWidth 축. 이름칩(.guru-alloc-nm)은 **의도된** ellipsis라 면제(#241 설계)
    let clipped = [];
    for (const row of m.rows) {
      for (const [k, el] of [['rank', row.rank], ['ticker', row.ticker], ['value', row.value], ['wl', row.wl]]) {
        if (!el) continue;
        bump(`${T}/clip`);
        if (el.clipX) clipped.push(`#${row.i}.${k}("${el.text}")`);
      }
    }
    P(clipped.length === 0, `${T}/no-clip`,
      `행 텍스트 잘림 ${clipped.length}${clipped.length ? ': ' + clipped.slice(0, 5).join(' ') : ''} (이름칩은 의도된 ellipsis로 면제)`);

    // ⑦ 카드 자식이 content box 안
    let overflow = [];
    for (const row of m.rows) {
      for (const [k, el] of [['ticker', row.ticker], ['value', row.value], ['name', row.name], ['wl', row.wl], ['bar', row.bar?.track]]) {
        if (!el) continue;
        bump(`${T}/overflow`);
        if (el.r > row.cbox.r + 1 || el.l < row.cbox.l - 1) overflow.push(`#${row.i}.${k}(l=${el.l} r=${el.r} vs box ${row.cbox.l}~${row.cbox.r})`);
      }
    }
    P(overflow.length === 0, `${T}/no-overflow`,
      `카드 자식 넘침 ${overflow.length}${overflow.length ? ': ' + overflow.slice(0, 3).join(' ') : ''}`);

    // ⑥ 액션 버튼 — 채움 배경 아님(alpha 0) + 테두리 있음. 색 의미는 유지되는지 함께 출력
    const wls = m.rows.filter(r2 => r2.wl);
    let filled = 0, noBorder = 0;
    for (const row of wls) {
      bump(`${T}/wl-style`);
      const alpha = /rgba?\([^)]*?,\s*([0-9.]+)\s*\)$/.exec(row.wl.bg)?.[1];
      if (!(row.wl.bg === 'transparent' || alpha === '0')) filled++;
      if (parseFloat(row.wl.border) < 0.5) noBorder++;
    }
    P(filled === 0, `${T}/wl-not-filled`,
      `채움 배경 버튼 ${filled}/${wls.length} (표본 bg=${wls[0]?.wl.bg} border=${wls[0]?.wl.border} color=${wls[0]?.wl.color} "${wls[0]?.wl.text}")`);
    P(noBorder === 0, `${T}/wl-has-border`, `테두리 없는 버튼 ${noBorder}/${wls.length}`);
    // 「보유중」 라벨 행은 버튼이 없다 — 계열 전체 출력(단언 아님)
    console.log(`    · ${T}: 보유중 라벨 ${m.rows.filter(r2 => r2.held).length}행 · 버튼 ${wls.length}행`);

    // ⑤ 비중 막대 — 투자금 탭만. 1위 꽉 참 · 단조 비증가 · 모든 행 ≥2px
    if (tab.bar) {
      const bars = m.rows.filter(r2 => r2.bar);
      bump(`${T}/bar-exists`);
      P(bars.length === m.rows.length, `${T}/bar-exists`, `막대 ${bars.length}/${m.rows.length}행`);
      if (bars.length) {
        const first = bars[0];
        bump(`${T}/bar-top`);
        P(Math.abs(first.bar.fillW - first.bar.track.w) <= 1.5, `${T}/bar-top-full`,
          `1위 막대가 트랙을 꽉 채움: ${first.bar.fillW} vs 트랙 ${first.bar.track.w} (styleW=${first.bar.styleW})`);
        let nonMono = [], tooThin = [];
        for (let i = 1; i < bars.length; i++) {
          bump(`${T}/bar-mono`);
          if (bars[i].bar.fillW > bars[i - 1].bar.fillW + 1) nonMono.push(`#${bars[i].i}(${bars[i].bar.fillW}>${bars[i - 1].bar.fillW})`);
        }
        for (const bar of bars) { bump(`${T}/bar-min`); if (bar.bar.fillW < 2) tooThin.push(`#${bar.i}(${bar.bar.fillW})`); }
        P(nonMono.length === 0, `${T}/bar-monotonic`,
          `막대 폭 단조 비증가 위반 ${nonMono.length}${nonMono.length ? ': ' + nonMono.join(' ') : ''} (폭: ${bars.map(x => x.bar.fillW).join(' ')})`);
        P(tooThin.length === 0, `${T}/bar-min-width`, `2px 미만 막대 ${tooThin.length}${tooThin.length ? ': ' + tooThin.join(' ') : ''}`);
      }

      // 헤더 — 캡션 조각 nowrap · 칩이 캡션에 인접 · 필 행 1줄 + 넘침 0
      bump(`${T}/caption-pieces`, m.caption?.pieces.length ?? 0);
      const badPiece = (m.caption?.pieces || []).filter(p => p.lines > 1 || p.white !== 'nowrap');
      P((m.caption?.pieces.length ?? 0) >= 3 && badPiece.length === 0, `${T}/caption-atomic`,
        `캡션 조각 ${m.caption?.pieces.length}개 · 접힌/nowrap아닌 조각 ${badPiece.length} — "${m.caption?.text}" (h=${m.caption?.h})`);
      if (m.infoChip && m.caption) {
        bump(`${T}/chip-adjacent`);
        const gap = m.infoChip.l - m.caption.r;
        P(gap <= 24, `${T}/chip-adjacent`,
          `칩이 캡션에 인접: gap ${gap.toFixed(1)}px ≤ 24 (칩 l=${m.infoChip.l} 캡션 r=${m.caption.r})`);
        bump(`${T}/chip-aria`);
        P(m.infoChip.expanded === 'false', `${T}/chip-aria`, `aria-expanded=${m.infoChip.expanded} (접힘 상태)`);
      }
      let scopeWrap = [], scopeOver = 0;
      const pr = m.scopesParent?.r ?? m.scopes?.r ?? 0;
      for (const c of m.scopeChildren) {
        bump(`${T}/scope`);
        if (c.lines > 1) scopeWrap.push(`${c.text}:${c.lines}`);
        if (c.box.r > pr + 1) scopeOver++;
      }
      P(scopeWrap.length === 0, `${T}/scope-no-textwrap`,
        `필 행 텍스트 접힘 ${scopeWrap.length}${scopeWrap.length ? ': ' + scopeWrap.join(' ') : ''} (자식 ${m.scopeChildren.length}개, 행 h=${m.scopes?.h})`);
      P(scopeOver === 0, `${T}/scope-no-overflow`, `필 행 자식 넘침 ${scopeOver} (부모 r=${pr.toFixed(1)})`);
      console.log(`    · ${T}: 첫 카드 docTop=${m.firstRowDocTop}px · 필행 h=${m.scopes?.h} · 캡션 h=${m.caption?.h}`);
    }

    // ⑤ 하단 탭바 겹침 축(task#259 복원) — baseline이 bare `nav`로 masthead-nav(h=0)를
    // 잡아 "겹침 483px" 헛값을 냈고 축을 통째로 뺐던 자리(⑧ⓒ). 대상은 MobileNav의
    // `nav.tabbar`뿐이다(PC는 display:none이라 모바일 뷰에서만 잰다 — 조건부 스킵이
    // 아니라 축의 정의역). 없으면 sentinel FAIL(⑧ⓑ).
    if (V !== 'pc') {
      bump(`${T}/tabbar`);
      const tb = await page.evaluate(async () => {
        const el = document.querySelector('nav.tabbar');
        if (!el) return { err: 'TABBAR_MISSING' };
        // 목록 최하단까지 스크롤한 뒤 재야 화면 안 좌표다 — 스크롤 전에 재면 화면 밖 요소를 잰다.
        window.scrollTo(0, document.documentElement.scrollHeight);
        await new Promise(r => requestAnimationFrame(() => setTimeout(r, 150)));
        const rows = document.querySelectorAll('.guru-stat-row');
        const lastRow = rows[rows.length - 1];
        if (!lastRow) return { err: 'LAST_ROW_MISSING' };
        const r = el.getBoundingClientRect();
        const chain = [];
        for (let p = el; p; p = p.parentElement)
          chain.push(p.tagName.toLowerCase() + (p.className ? '.' + String(p.className).split(' ')[0] : ''));
        return {
          tabTop: +r.top.toFixed(1), tabH: +r.height.toFixed(1),
          pos: getComputedStyle(el).position, chain: chain.join(' < '),
          rowBottom: +lastRow.getBoundingClientRect().bottom.toFixed(1),
          scrollY: Math.round(window.scrollY),
        };
      });
      if (tb.err) {
        P(false, `${T}/tabbar-overlap`, `${tb.err} (sentinel — 무음 스킵 금지)`);
      } else {
        const margin = +(tb.tabTop - tb.rowBottom).toFixed(1);
        // 여유 픽셀 자체는 출력만(대리지표) — 단언은 "겹치지 않는다"(margin ≥ 0)에만.
        P(margin >= 0, `${T}/tabbar-overlap`,
          `마지막 행 하단(${tb.rowBottom}) vs 탭바 상단(${tb.tabTop}) — 여유 ${margin}px`
          + ` · 탭바 h=${tb.tabH} pos=${tb.pos} scrollY=${tb.scrollY} 체인[${tb.chain}]`);
      }
    }

    // 육안 — 시각 변경은 프로브 PASS 후에도 스크린샷 1장이 유일한 포착 수단이었던 적이 3회 있다(#235 ⓐ)
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/${V}-${tab.key}.png`, fullPage: false });
  }

  // 설명란 펼침 육안 — 요소 캡처(프레임 밖이면 무의미, #238 ⓓ)
  await page.getByRole('button', { name: '투자금', exact: true }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: '데이터 기준', exact: true }).click();
  await page.waitForTimeout(500);
  const mExp = await page.evaluate(measure, 3);
  bump(`${V}/panel-aria`);
  P(mExp.infoChip?.expanded === 'true', `${V}/panel-aria-expanded`,
    `펼친 뒤 aria-expanded=${mExp.infoChip?.expanded} · 칩 텍스트 "${mExp.infoChip?.text}"`);
  await page.locator('.guru-alloc-info-panel').scrollIntoViewIfNeeded();
  await page.locator('.guru-alloc-info-panel').screenshot({ path: `${OUT}/${V}-panel.png` }).catch(() => {});
  await ctx.close();
}
await b.close();

const failed = results.filter(x => !x.ok);
for (const x of results) console.log(`${x.ok ? 'PASS' : 'FAIL'} [${x.tag}] ${x.msg}`);
console.log('\n── 커버리지(계열별 검사 수 — 재실행 간 총계를 비교할 것) ──');
console.log(Object.entries(cov).map(([k, v]) => `${k}:${v}`).join(' · '));
console.log(`커버리지 합계 ${Object.values(cov).reduce((a, c) => a + c, 0)} · 단언 ${results.length}건`);
console.log('(task#259 탭바 겹침 축 복원 — 단언 +6: 모바일 2뷰 × 3탭. baseline 111 → 117)');
console.log(`\n${failed.length ? `❌ FAIL ${failed.length}` : '✅ ALL PASS'}`);
console.log(`스크린샷: ${OUT}`);
process.exit(failed.length ? 1 : 0);
