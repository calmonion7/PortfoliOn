import { chromium, devices } from 'playwright';
import fs from 'fs';

// task#254 라이브 UAT — 발행물 상세 '상승여력'이 부호에 따라 --up/--down으로 물드는지(M4).
// 판정축: computed color === :root 토큰 실측값(하드코딩 대조 금지 — 토큰은 테마별로 다르다, CLAUDE.md ③).
// 대상 유효성은 판정축과 분리해 먼저 단언한다(⑧ⓘ — nav처럼 콘텐츠와 독립인 축은 404 위에서도 통과한다).
const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat254';
fs.mkdirSync(OUT, { recursive: true });

const r = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const { access_token, refresh_token } = await r.json();

// 응답 봉투는 {reports:[{ticker, published_date, …}]} (task#251 확정 — 추정 금지).
const pubs = await (await fetch(`${BASE}/api/analyst-reports`, {
  headers: { Authorization: `Bearer ${access_token}` },
})).json();
const list = Array.isArray(pubs) ? pubs : pubs.reports || [];
// 상승여력은 밴드가 있어야 렌더된다 → 밴드 보유 발행물만 대상.
const targets = list.filter(p => p && p.ticker && p.published_date && p.fair_value_low != null && p.fair_value_high != null);
if (!targets.length) {
  console.error('대상 부재 — ticker/published_date/밴드를 가진 발행물이 없다. 추정 폴백 없이 종료.',
    JSON.stringify(list[0] || null).slice(0, 300));
  process.exit(1);
}
console.log(`발행물 ${list.length}건 · 밴드 보유(대상) ${targets.length}건`);

const checks = [];
const assert = (view, name, got, want, ticker) => {
  checks.push({ view, name, got, want, ticker, pass: JSON.stringify(got) === JSON.stringify(want) });
};

async function settle(page) {
  await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);
}

async function probe(page, ticker) {
  return page.evaluate((tk) => {
    // 토큰 → rgb 정규화: 임시 노드에 색을 실어 브라우저가 계산한 값을 되읽는다.
    const root = getComputedStyle(document.documentElement);
    const norm = (v) => {
      const el = document.createElement('span');
      el.style.color = (v || '').trim();
      document.body.appendChild(el);
      const c = getComputedStyle(el).color;
      el.remove();
      return c;
    };
    const stats = [...document.querySelectorAll('.stat')];
    const hit = stats.find(s => (s.querySelector('.stat__label')?.textContent || '').includes('상승여력'));
    const valEl = hit?.querySelector('.stat__value') || null;
    const txt = (valEl?.textContent || '').trim();
    const m = txt.match(/(-?)(\d+(?:\.\d+)?)%/);
    return {
      tickerOnPage: [...document.querySelectorAll('.mono')].some(e => e.textContent.trim() === tk),
      statCount: stats.length,
      upsideStatFound: !!valEl,
      valueText: txt,
      sign: m ? (m[1] === '-' ? 'down' : 'up') : null,
      color: valEl ? getComputedStyle(valEl).color : null,
      classes: valEl ? valEl.className : null,
      up: norm(root.getPropertyValue('--up')),
      down: norm(root.getPropertyValue('--down')),
      text: norm(root.getPropertyValue('--text')),
    };
  }, ticker);
}

async function run(view, ctxOpts) {
  const b = await chromium.launch({ headless: true });
  const page = await (await b.newContext(ctxOpts)).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([a, rr]) => { localStorage.setItem('access_token', a); localStorage.setItem('refresh_token', rr); }, [access_token, refresh_token]);

  // 부호 양쪽을 덮도록 최대 4건 순회(단언은 목표에만, 출력은 넓게 — ⑧ⓗ).
  const seen = new Set();
  for (const t of targets.slice(0, 4)) {
    const path = `/analyst-report/${t.ticker}/${t.published_date}`;
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await settle(page);
    let p = await probe(page, t.ticker);
    if (!p.sign) {  // 렌더 미완을 무음 스킵하지 않는다 — 1회 재시도 후에도 없으면 FAIL(⑧ⓑ).
      console.log(`[${view} · ${t.ticker}] sign 미검출 → 1회 재시도`);
      await page.waitForTimeout(1500);
      p = await probe(page, t.ticker);
    }
    console.log(`\n[${view} · ${t.ticker} ${path}]`, JSON.stringify(p, null, 1));

    // ── 대상 유효성(판정축과 분리, 먼저) ──
    assert(view, '대상 유효성: 페이지에 해당 티커 마커 존재', p.tickerOnPage, true, t.ticker);
    assert(view, '대상 유효성: 상승여력 stat 존재', p.upsideStatFound, true, t.ticker);
    assert(view, '대상 유효성: 상승여력 값이 %로 렌더', p.sign !== null, true, t.ticker);
    // 이빨 검증 — 토큰이 서로 달라야 이 프로브가 무엇이든 잡는다.
    assert(view, '이빨: --up/--down/--text가 서로 다름',
      new Set([p.up, p.down, p.text]).size, 3, t.ticker);

    // ── 판정축: computed color === 부호에 맞는 토큰 실측값 (무조건 단언 — 총계 고정) ──
    const want = p.sign === 'up' ? p.up : p.sign === 'down' ? p.down : 'SIGN_MISSING';
    assert(view, `상승여력 색 = --${p.sign || '?'}`, p.color, want, t.ticker);
    if (p.sign) seen.add(p.sign);
    if (view === 'pc' && !fs.existsSync(`${OUT}/pc-detail.png`)) {
      await page.screenshot({ path: `${OUT}/pc-detail.png`, fullPage: false });
    }
    await page.screenshot({ path: `${OUT}/${view}-${t.ticker}.png`, fullPage: false });
  }
  console.log(`[${view}] 관측된 부호: ${[...seen].join(',') || '없음'}`);
  if (errs.length) console.log(`[${view}] 콘솔 에러`, errs.slice(0, 5));
  await b.close();
  return { errs, seen: [...seen] };
}

const pc = await run('pc', { viewport: { width: 1440, height: 900 } });
const mo = await run('mobile', { ...devices['iPhone 13'] });

const failed = checks.filter(c => !c.pass);
const by = v => checks.filter(c => c.view === v).length;
console.log(`\n=== 커버리지: 단언 ${checks.length}건 (pc ${by('pc')} · mobile ${by('mobile')}) · 대상 ${targets.length}건 중 ${Math.min(4, targets.length)}건 순회 · 부호 pc[${pc.seen}] mobile[${mo.seen}] ===`);
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'} [${c.view} ${c.ticker}] ${c.name} — got=${JSON.stringify(c.got)} want=${JSON.stringify(c.want)}`);
console.log(failed.length ? `\n>>> FAIL ${failed.length}/${checks.length}` : `\n>>> ALL PASS ${checks.length}/${checks.length}`);
fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ targets: targets.length, checks }, null, 2));
process.exit(failed.length ? 1 : 0);
