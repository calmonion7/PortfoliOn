// task#225 라이브 UAT — 칩 3열·카드 압축 / 발행물 목록 2행 우측 정렬 / EMA200 용어 매칭 / 플로팅 목록 pill(rect 불변).
// 테스트 계정은 비admin(task#222 선례) — admin 삭제 wrap은 vitest + 구조(wrap 제거)로 커버.
import { chromium, devices } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat225';
fs.mkdirSync(OUT, { recursive: true });

const r = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const { access_token, refresh_token } = await r.json();

const b = await chromium.launch({ headless: true });
const page = await (await b.newContext({ ...devices['Pixel 5'] })).newPage();
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.evaluate(([a, rr]) => {
  localStorage.setItem('access_token', a); localStorage.setItem('refresh_token', rr); localStorage.setItem('theme', 'light');
}, [access_token, refresh_token]);

const settle = async () => {
  await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
};
const out = {};

// ── ① 발행물 목록 — 뱃지/날짜 우측 열 일치 + wrap 없음 ─────────────
await page.goto(`${BASE}/analyst-reports`, { waitUntil: 'domcontentloaded' });
await settle();
out.list = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('a.card')];
  const rows = cards.map(c => {
    const badge = c.querySelector('.badge');
    const rowDivs = [...c.children];
    const [r1, r2] = rowDivs;
    const monos = [...c.querySelectorAll('span.mono')];
    return {
      name: c.querySelector('span')?.textContent.trim().slice(0, 18),
      badgeRight: badge ? Math.round(badge.getBoundingClientRect().right) : null,
      dateRight: monos.length ? Math.round(monos[monos.length - 1].getBoundingClientRect().right) : null,
      row1H: r1 ? Math.round(r1.getBoundingClientRect().height) : null,
      row2H: r2 ? Math.round(r2.getBoundingClientRect().height) : null,
      rowCount: rowDivs.length,
    };
  });
  const uniq = k => [...new Set(rows.map(r => r[k]))];
  return {
    n: rows.length,
    badgeRights: uniq('badgeRight'),
    dateRights: uniq('dateRight'),
    maxRowH: Math.max(...rows.flatMap(r => [r.row1H, r.row2H])),
    rowCounts: uniq('rowCount'),
    sample: rows.slice(0, 4),
  };
});
await page.screenshot({ path: `${OUT}/list.png`, fullPage: false });

// ── ② 포인트 카드 칩 — 3열 · 카드 높이 ─────────────────────────
const chipProbe = () => {
  const cards = [...document.querySelectorAll('.card')].filter(c => {
    const s = c.querySelector('span.tnum');
    return s && /^0\d$/.test(s.textContent.trim());
  });
  const h = e => (e ? Math.round(e.getBoundingClientRect().height) : null);
  return cards.map(c => {
    const grid = [...c.querySelectorAll('div')].find(d => getComputedStyle(d).display === 'grid');
    const chips = grid ? grid.children.length : 0;
    const cols = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0;
    const labelHs = grid ? [...grid.children].map(ch => Math.round(ch.firstElementChild.getBoundingClientRect().height)) : [];
    return {
      card: h(c), chips, cols, rows: cols ? Math.ceil(chips / cols) : 0,
      chipH: grid ? [...grid.children].map(ch => Math.round(ch.getBoundingClientRect().height)) : [],
      labelHs, labelsSingleLine: labelHs.every(x => x <= 14),
    };
  });
};

for (const [ticker, date] of [['GOOGL', '2026-07-27'], ['000660', '2026-07-27']]) {
  await page.goto(`${BASE}/analyst-report/${ticker}/${date}`, { waitUntil: 'domcontentloaded' });
  await settle();
  out[`chips_${ticker}`] = await page.evaluate(chipProbe);
  await page.evaluate(() => {
    const c = [...document.querySelectorAll('.card')].find(x => {
      const s = x.querySelector('span.tnum');
      return s && /^0\d$/.test(s.textContent.trim());
    });
    c?.scrollIntoView({ block: 'start' });
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/chips-${ticker}.png` });
}

// ── ③ 라틴+숫자 용어 매칭(EMA200 등) ───────────────────────────
out.glossaryLatinNum = await page.evaluate(() => {
  const terms = [...document.querySelectorAll('.glossary-term')].map(e => e.textContent.trim());
  const bodyText = document.body.innerText;
  const present = [...new Set((bodyText.match(/\b[A-Z]{2,}\d+\b/g) || []))];
  return { matchedLatinNum: terms.filter(t => /^[A-Za-z]+\d+$/.test(t)), inTextLatinNum: present, totalTerms: terms.length };
});

// ── ④ 플로팅 목록 pill — 스크롤 전후 rect 불변 · 조상 transform none · 하단 링크 부재 ──
const pillRect = () => page.evaluate(() => {
  const p = document.querySelector('.list-pill');
  if (!p) return null;
  const r = p.getBoundingClientRect();
  return { bottom: Math.round(r.bottom), right: Math.round(r.right), w: Math.round(r.width) };
});
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(300);
const before = await pillRect();
await page.evaluate(() => window.scrollTo(0, 1800));
await page.waitForTimeout(500);
const after = await pillRect();
out.pill = {
  before, after,
  stable: !!before && JSON.stringify(before) === JSON.stringify(after),
  viewportBottomGap: before ? await page.evaluate(() => window.innerHeight) - before.bottom : null,
  ancestorTransforms: await page.evaluate(() => {
    const p = document.querySelector('.list-pill');
    const bad = [];
    for (let el = p?.parentElement; el && el !== document.documentElement; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (cs.transform !== 'none' || cs.filter !== 'none' || cs.perspective !== 'none' || cs.willChange.includes('transform')) {
        bad.push({ tag: el.tagName, cls: el.className, transform: cs.transform, filter: cs.filter });
      }
    }
    return bad;
  }),
  bottomLinkGone: await page.evaluate(() =>
    ![...document.querySelectorAll('a')].some(a => a.textContent.trim() === '← 심층 리포트')),
  pillText: await page.evaluate(() => document.querySelector('.list-pill')?.textContent.trim() || null),
};
await page.screenshot({ path: `${OUT}/pill-scrolled.png` });

// 에러 상태 복귀 링크 유지(non-goal 보호) — 없는 발행물로 404 상태
await page.goto(`${BASE}/analyst-report/GOOGL/1999-01-01`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1800);
out.errorBackLink = await page.evaluate(() =>
  [...document.querySelectorAll('a')].some(a => a.textContent.includes('심층 리포트로 돌아가기')));

await b.close();
console.log(JSON.stringify(out, null, 2));

// 칩 열 수 규칙: ≤3개는 칩 수만큼(1행), 4개는 2열(트랙 140px — 3열 91px면 값이 접혀 칩이 커진다)
// + 칩 label은 전부 1줄(13px) — 줄바꿈이 카드 높이의 실제 동인
const chipsOk = ['GOOGL', '000660'].every(t => (out[`chips_${t}`] || []).every(c =>
  c.cols === (c.chips <= 3 ? c.chips : 2) && c.labelsSingleLine));
const listOk = out.list.badgeRights.length === 1 && out.list.dateRights.length === 1
  && out.list.rowCounts.length === 1 && out.list.rowCounts[0] === 2 && out.list.maxRowH <= 26;
const pillOk = out.pill.stable && out.pill.ancestorTransforms.length === 0 && out.pill.bottomLinkGone;
const verdict = { chipsOk, listOk, pillOk, errorBackLinkKept: out.errorBackLink };
console.log('VERDICT', JSON.stringify(verdict));
process.exit(Object.values(verdict).every(Boolean) ? 0 : 2);
