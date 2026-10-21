import { chromium, devices } from 'playwright';
import fs from 'fs';

// task#251 라이브 UAT — nav 경로 단일 소스화 후 세 표면이 "지금 어디인가"를 보이는지.
// 판정축: 넘침/잘림이 아니라 **active className 존재**(DOM). 육안 캡처는 별도(CLAUDE.md ④ⓐ).
// task#375: ADR-0047로 nav의 「심층 리포트」 항목이 사라져 그 라벨을 찾던 4축이 영구 FAIL이었다.
// 의도(「문서 경로에서도 현재 위치를 잃지 않는다」)는 그대로 두고, 이제 그 경로에서 켜져야 하는 「리포트」로 교체했다.
// task#396: 리서치 탭이 「리포트·심층·기술·추천·랭킹·비교」가 되어 목록·문서 경로의 주인이 「심층」으로 바뀌었다.
// 「리포트」는 더 이상 그 경로에서 켜지면 안 되므로 「정확히 1개 active」 축을 목록·문서에도 건다.
// 좁은 폭(m360·m278)에서 6탭이 한 줄에 잘림 없이 들어가는지(seg-fit)도 함께 잰다.
const ACTIVE_LABEL = '심층';
const RESEARCH_ORDER = ['리포트', '심층', '기술', '추천', '랭킹', '비교'];
const BASE = process.env.BASE || 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat251-nav';
fs.mkdirSync(OUT, { recursive: true });

const r = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const { access_token, refresh_token } = await r.json();

// 실제 발행물 하나를 목록 API에서 집어 상세 경로를 만든다(경로 추정 금지).
const pubs = await (await fetch(`${BASE}/api/analyst-reports`, {
  headers: { Authorization: `Bearer ${access_token}` },
})).json();
const list = Array.isArray(pubs) ? pubs : pubs.reports || [];
const first = list[0];
if (!first || !first.ticker || !first.published_date) {
  console.error('발행물/필드 부재 — 상세 경로를 만들 수 없다', JSON.stringify(first || null).slice(0, 200));
  process.exit(1);
}
const DETAIL = `/analyst-report/${first.ticker}/${first.published_date}`;
const LIST = '/analyst-reports';
console.log('대상 상세 경로:', DETAIL, `(발행물 ${list.length}건, ${first.name})`);

const checks = [];   // {view, path, name, got, want, pass}
let counted = 0;
const assert = (view, path, name, got, want) => {
  counted++;
  const pass = got === want;
  checks.push({ view, path, name, got, want, pass });
};

async function settle(page) {
  await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

// 판정 범위를 nav 표면으로 한정(문서 전체 count 금지 — CLAUDE.md ⑧ⓒ).
async function probe(page) {
  return page.evaluate((label) => {
    const cls = el => (el ? el.className.toString() : null);
    const byText = (sel, t) => [...document.querySelectorAll(sel)].find(e => e.textContent.trim() === t) || null;
    const subbar = document.querySelector('.masthead-subbar');
    const subLink = subbar ? [...subbar.querySelectorAll('a')].find(a => a.textContent.trim() === label) : null;
    // 카테고리 링크는 아이콘 <title>도 같은 라벨이라 textContent 완전일치가 안 잡힌다 → span으로 좁힘.
    const cat = [...document.querySelectorAll('.masthead-cat')]
      .find(a => [...a.querySelectorAll('span')].some(s => s.textContent.trim() === '리서치')) || null;
    const tabbar = document.querySelector('nav.tabbar');
    const tab = tabbar ? [...tabbar.querySelectorAll('a')].find(a => a.textContent.trim() === '리서치') : null;
    const seg = document.querySelector('.seg');
    const segLinks = seg ? [...seg.querySelectorAll('a')] : [];
    const segLink = seg ? [...seg.querySelectorAll('a')].find(a => a.textContent.trim() === label) : null;
    return {
      subbarExists: !!subbar,
      subbarLinks: subbar ? [...subbar.querySelectorAll('a')].map(a => a.textContent.trim()) : [],
      subLinkClass: cls(subLink), catClass: cls(cat),
      tabbarExists: !!tabbar,
      tabLabels: tabbar ? [...tabbar.querySelectorAll('a')].map(a => a.textContent.trim()) : [],
      tabClass: cls(tab),
      segExists: !!seg,
      segLabels: seg ? [...seg.querySelectorAll('a')].map(a => a.textContent.trim()) : [],
      segLinkClass: cls(segLink),
      // seg-fit: 컨테이너 가로 스크롤 없음 + 라벨마다 잘림 없음(라벨은 nowrap — 넘치면 scrollWidth가 커진다)
      segFit: seg ? { sw: seg.scrollWidth, cw: seg.clientWidth,
        clipped: segLinks.filter(a => a.scrollWidth > a.clientWidth).map(a => `${a.textContent.trim()}:${a.scrollWidth}>${a.clientWidth}`),
        rows: new Set(segLinks.map(a => Math.round(a.getBoundingClientRect().top))).size } : null,
      groupLabel: (document.querySelector('.appbar h1') || {}).textContent || null,
    };
  }, ACTIVE_LABEL);
}

async function run(view, ctxOpts) {
  const b = await chromium.launch({ headless: true });
  const page = await (await b.newContext(ctxOpts)).newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([a, rr]) => { localStorage.setItem('access_token', a); localStorage.setItem('refresh_token', rr); }, [access_token, refresh_token]);

  for (const [name, path] of [['목록', LIST], ['상세', DETAIL]]) {
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await settle(page);
    const p = await probe(page);
    console.log(`\n[${view} · ${name} ${path}]`, JSON.stringify(p, null, 1));
    await page.screenshot({ path: `${OUT}/${view}-${name}.png`, fullPage: false });

    const activeHere = await page.evaluate(sel => [...document.querySelectorAll(sel)]
      .filter(a => /(^|\s)is-active(\s|$)/.test(a.className.toString())).map(a => a.textContent.trim()).join(','),
      view === 'pc' ? '.masthead-subbar a' : '.seg a');
    assert(view, path, `active 정확히 1개(${ACTIVE_LABEL}) — 「리포트」 비활성 대조군`, activeHere, ACTIVE_LABEL);
    if (view === 'pc') {
      assert(view, path, 'PC 서브바 존재', p.subbarExists, true);
      assert(view, path, `PC 서브바 "${ACTIVE_LABEL}" active`, /is-active/.test(p.subLinkClass || ''), true);
      assert(view, path, 'PC 카테고리 "리서치" active', /is-active/.test(p.catClass || ''), true);
    } else {
      assert(view, path, '모바일 탭바 "리서치" active', /is-active/.test(p.tabClass || ''), true);
      assert(view, path, `모바일 seg "${ACTIVE_LABEL}" active`, /is-active/.test(p.segLinkClass || ''), true);
      assert(view, path, '모바일 groupLabel = 리서치', (p.groupLabel || '').trim(), '리서치');
      assert(view, path, '모바일 seg 6탭 순서', p.segLabels.join(','), RESEARCH_ORDER.join(','));
      assert(view, path, `seg-fit 컨테이너 scrollWidth(${p.segFit?.sw}) <= clientWidth(${p.segFit?.cw})`, !!p.segFit && p.segFit.sw <= p.segFit.cw, true);
      assert(view, path, 'seg-fit 라벨 잘림 0', (p.segFit?.clipped || ['seg 없음']).join(','), '');
      assert(view, path, 'seg-fit 한 줄', p.segFit?.rows, 1);
    }
    if (view === 'pc') assert(view, path, 'PC 서브바 6탭 순서', p.subbarLinks.join(','), RESEARCH_ORDER.join(','));
  }
  // 함정③ — subLink/seg를 NavLink isActive에서 접두사 판정으로 바꿨으니 형제 탭이 상호 오염되지 않는지.
  // 목표 자체("정확히 1개만 active")를 재고, 어느 라벨이 켜졌는지 실측치를 함께 출력한다.
  for (const [path, want] of [['/reports', '리포트'], ['/tech-reports', '기술'], ['/calendar', '캘린더'], ['/market/indicators', '시장지표']]) {
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await settle(page);
    const act = await page.evaluate(() => {
      const pick = sel => [...document.querySelectorAll(sel)]
        .filter(a => /(^|\s)is-active(\s|$)/.test(a.className.toString())).map(a => a.textContent.trim());
      return { sub: pick('.masthead-subbar a'), seg: pick('.seg a') };
    });
    const bar = view === 'pc' ? act.sub : act.seg;
    console.log(`[${view} · 형제 ${path}] active=${JSON.stringify(bar)}`);
    assert(view, path, `형제탭 active 정확히 1개(${want})`, bar.join(','), want);
  }
  if (errs.length) console.log(`\n[${view}] 콘솔 에러`, errs.slice(0, 5));
  await b.close();
  return errs;
}

const e1 = await run('pc', { viewport: { width: 1440, height: 900 } });
const e2 = await run('mobile', { ...devices['iPhone 13'] });
const e3 = await run('m360', { ...devices['iPhone 13'], viewport: { width: 360, height: 780 } });
const e4 = await run('m278', { ...devices['iPhone 13'], viewport: { width: 278, height: 640 } });

const failed = checks.filter(c => !c.pass);
console.log(`\n=== 커버리지: 단언 ${counted}건 (${['pc', 'mobile', 'm360', 'm278'].map(v => `${v} ${checks.filter(c => c.view === v).length}`).join(' · ')}) ===`);
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'} [${c.view}] ${c.name} — got=${JSON.stringify(c.got)} want=${JSON.stringify(c.want)} @${c.path}`);
console.log(failed.length ? `\n>>> FAIL ${failed.length}/${counted}` : `\n>>> ALL PASS ${counted}/${counted}`);
fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ detail: DETAIL, checks, consoleErrors: [...e1, ...e2, ...e3, ...e4] }, null, 2));
process.exit(failed.length ? 1 : 0);
