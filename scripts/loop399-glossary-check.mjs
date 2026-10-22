// fg-loop 정지조건 프로브 — 심층 리포트 용어 링크 확대(task#399·#400). read-only(GET만), 쓰기 0.
// dev 스택(기본 http://127.0.0.1:8084)의 발행물 전 종목 최신판을 열어
//   collapsed = 접힌 상태 [data-lens-cell] 안 .glossary-term:not(.lens-help) 개수
//   terms     = 「모두 펼치기」 뒤 페이지 전체 .glossary-term:not(.lens-help) 텍스트의 집합
// 을 잰다. 단언은 하지 않고 JSON 한 줄을 낸다 — 판정은 loop.md 의 정지조건이 한다.
// 「대상에 닿았다」(cells>0·toggle 발견)를 함께 내므로 0을 성공으로 읽지 말 것.
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:8084';
const DUMP = process.env.DUMP || '';
const login = async () => {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }) });
      if (r.ok) return r.json();
    } catch {}
    await new Promise(res => setTimeout(res, 2000));
  }
  throw new Error('login failed');
};
const { access_token, refresh_token } = await login();
const H = { Authorization: `Bearer ${access_token}` };
const list = await (await fetch(`${BASE}/api/analyst-reports`, { headers: H })).json();
const items = list.reports || list.items || list;
const latest = new Map();
for (const it of items) if (!latest.has(it.ticker) || it.published_date > latest.get(it.ticker)) latest.set(it.ticker, it.published_date);

const b = await chromium.launch();
const out = { reports: {}, terms: [] };
const all = new Set();
const dump = {};
for (const [ticker, date] of [...latest].sort()) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  await ctx.addInitScript(([a, rr]) => {
    localStorage.setItem('access_token', a); localStorage.setItem('refresh_token', rr);
    localStorage.setItem('pwa-install-dismissed-at', String(Date.now()));
  }, [access_token, refresh_token]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/analyst-report/${ticker}/${date}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-lens-cell]', { timeout: 20000 }).catch(() => {});
  const collapsed = await page.evaluate(() => ({
    cells: document.querySelectorAll('[data-lens-cell]').length,
    n: document.querySelectorAll('[data-lens-cell] .glossary-term:not(.lens-help)').length,
  }));
  const toggle = page.getByRole('button', { name: '모두 펼치기' });
  const toggleFound = (await toggle.count()) === 1;
  if (toggleFound) { await toggle.click(); await page.waitForTimeout(300); }
  const expanded = await page.evaluate(() => {
    const t = [...document.querySelectorAll('.glossary-term:not(.lens-help)')].map(e => e.textContent.trim());
    return { n: t.length, texts: t, body: document.querySelector('main')?.innerText || document.body.innerText };
  });
  expanded.texts.forEach(t => all.add(t));
  out.reports[ticker] = { date, cells: collapsed.cells, collapsed: collapsed.n, toggleFound, expanded: expanded.n };
  dump[ticker] = expanded.body;
  await ctx.close();
}
await b.close();
out.terms = [...all].sort();
out.distinct = out.terms.length;
if (DUMP) fs.writeFileSync(DUMP, JSON.stringify(dump, null, 1));
console.log(JSON.stringify(out));

// 판정 — 기대값은 loop.md 계약과 같다(드라이브 중 수정 금지).
// C4: 대상 10건 전부 도달 + 접힌 계수 ≥ task#399 기대값(2/2 어휘 추가로 늘 수 있어 ≥)
const EXP = { '000660': 19, '005380': 11, '005930': 22, CRCL: 2, GOOGL: 10, LHX: 8, LLY: 8, MRVL: 16, MU: 6, SPCX: 2 };
// C5: 착수 시 baseline 22종 보존 + 신규 16종이 각각 어떤 버튼 텍스트에 포함
const BASELINE = ['EPS', 'EV/EBITDA', 'FCF', 'PBR', 'PER', 'PSR', 'QoQ', 'R&D집약도', 'YoY', 'forward PER', '가이던스', '목표가', '배당', '수급',
  '수주잔고', '순이익', '시가총액', '영업이익', '영업이익률', '자사주', '자사주 매입', '컨센서스'];
const TARGETS = ['GAAP', '감가상각', '주주환원', '희석', '매출총이익', '레버리지', '설비투자', '계약부채', '순현금', '감사의견', '런레이트',
  '이익수익률', '무위험 금리', '런웨이', '이자보상', '한계 분배율'];
const c4 = Object.entries(EXP).map(([t, e]) => {
  const r = out.reports[t];
  const okR = !!r && r.cells >= 9 && r.toggleFound && r.collapsed >= e;
  return [t, okR, r ? `cells=${r.cells} toggle=${r.toggleFound} collapsed=${r.collapsed}/≥${e}` : 'missing'];
});
const lost = BASELINE.filter(t => !all.has(t));
const missing = TARGETS.filter(t => !out.terms.some(x => x.includes(t)));
const C4 = c4.every(x => x[1]) && Object.keys(out.reports).length === 10;
const C5 = lost.length === 0 && missing.length === 0;
for (const [t, o, d] of c4) console.log(`${o ? '✓' : '✗'} C4 ${t} ${d}`);
console.log(`${C4 ? '✓' : '✗'} C4 reports=${Object.keys(out.reports).length}/10`);
console.log(`${C5 ? '✓' : '✗'} C5 lost=[${lost}] missing=[${missing}] (${TARGETS.length - missing.length}/${TARGETS.length})`);
process.exit(C4 && C5 ? 0 : 1);
