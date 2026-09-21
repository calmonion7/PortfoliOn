// task#205 UAT — CRCL 사업분석 탭 7단 그룹 헤더(task#358 갱신)·경쟁사 R&D+edge·시장 전망 캡처 (pc-dark + mobile-light)
// + graceful 확인: enrich 안 된 종목 1개 (신규 섹션/열 미노출)
// uat184 패턴 재사용: 관심 임시 추가→캡처→DELETE 자가정리, DOM click 디스패치, 텍스트 기준 탭 클릭
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'https://portfolion.taebro.com';
const OUT = path.join(__dirname, '..', 'screenshots-uat205');
const TICKER = 'CRCL';

const COMBOS = [
  { key: 'pc-dark',      width: 1440, height: 900, isMobile: false, hasTouch: false, dsf: 1, theme: 'dark',  clickSel: '.report-item' },
  { key: 'mobile-light', width: 390,  height: 844, isMobile: true,  hasTouch: true,  dsf: 2, theme: 'light', clickSel: '.stock-card' },
];

async function api(token, method, p, body) {
  const r = await fetch(`${BASE}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => null) };
}
async function settle(page, ms = 1500) {
  try { await page.waitForFunction(() => !document.querySelector('.spinner, .loading-spinner, [data-loading="true"]'), { timeout: 6000 }); } catch {}
  await page.waitForTimeout(ms);
}

async function run() {
  const loginRes = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }) });
  const { access_token, refresh_token } = await loginRes.json();

  // CRCL이 목록에 없으면 임시 추가 (있으면 그대로)
  const list = await api(access_token, 'GET', '/api/report/list');
  const entries = Array.isArray(list.data) ? list.data : (list.data?.reports || []);
  const had = entries.some(e => (e.ticker || '') === TICKER);
  let added = false;
  if (!had) {
    const r = await api(access_token, 'POST', '/api/watchlist', { ticker: TICKER, name: 'Circle Internet Group' });
    added = r.status === 201 || r.status === 200;
    console.log(`CRCL 임시 추가: ${r.status}`);
  } else console.log('CRCL 기존 존재');

  const browser = await chromium.launch({ headless: true });
  try {
    for (const c of COMBOS) {
      console.log(`=== ${c.key} ===`);
      const ctx = await browser.newContext({ viewport: { width: c.width, height: c.height }, isMobile: c.isMobile, hasTouch: c.hasTouch, deviceScaleFactor: c.dsf });
      const page = await ctx.newPage();
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.evaluate(([a, r, t]) => { localStorage.setItem('access_token', a); localStorage.setItem('refresh_token', r); localStorage.setItem('theme', t); }, [access_token, refresh_token, c.theme]);
      await page.goto(BASE + '/reports', { waitUntil: 'domcontentloaded' });
      await settle(page);
      const domClick = (sel, text) => page.evaluate(([s, t]) => {
        const els = Array.from(document.querySelectorAll(s));
        const el = els.find(e => e.textContent && e.textContent.includes(t));
        if (el) { el.click(); return true } return false
      }, [sel, text]);
      // 관심 탭 → 하위칩 순회하며 CRCL 탐색
      await domClick('button', '관심'); await settle(page, 800);
      let found = false;
      for (const chip of [null, '목표<40%', '경고']) {
        if (chip) { await domClick('button', chip); await settle(page, 800); }
        if (await page.evaluate(sel => Array.from(document.querySelectorAll(sel)).some(e => /CRCL|Circle/i.test(e.textContent || '')), c.clickSel)) { found = true; break; }
      }
      if (!found) { console.log('   ⚠ CRCL 미발견'); await ctx.close(); continue; }
      await page.evaluate(sel => {
        const el = Array.from(document.querySelectorAll(sel)).find(e => /CRCL|Circle/i.test(e.textContent || ''))
        el && el.click()
      }, c.clickSel);
      await page.waitForSelector('.tab-btn', { state: 'attached', timeout: 6000 });
      await settle(page, 1200);
      await page.evaluate(() => {
        Array.from(document.querySelectorAll('.tab-btn')).filter(t => (t.textContent || '').includes('사업분석')).forEach(t => t.click())
      });
      await settle(page, 1500);
      // 검증 텍스트 존재 확인
      const checks = await page.evaluate(() => {
        const body = document.body.textContent || '';
        // 7단 뼈대(ADR `260921-091825` 결정 1) — 단의 섹션이 하나도 없으면 그 헤더는 미렌더이므로
        // 「전부 존재」가 아니라 **표준 순서의 부분수열인가**를 잰다. 이 대상(CRCL)은 갓 추가한
        // 미-enrich 종목이라 「확인할 것」만 나오는 것이 정답이고, 그래도 이 축은 유효하다.
        const CANON = ['시장', '경쟁', '우위', '전망', '리스크', '확인할 것'];
        const heads = Array.from(document.querySelectorAll('[data-testid="group-header"]'))
          .map(e => (e.textContent || '').trim());
        let i = 0;
        const groupOrderOk = heads.every(h => { i = CANON.indexOf(h, i); return i++ >= 0; });
        return {
          tabFound: Array.from(document.querySelectorAll('.tab-btn')).some(t => (t.textContent || '').includes('사업분석')),
          groupHeaders: heads,
          groupOrderOk,
          outlook: body.includes('시장 전망') || body.includes('스테이블코인'),
          rd: body.includes('R&D'),
        };
      });
      console.log('   검증:', JSON.stringify(checks));
      await page.screenshot({ path: path.join(OUT, `${c.key}-crcl-deepdive.png`), fullPage: true });
      console.log('   ✅ saved');
      await ctx.close();
    }
    // graceful 확인 (PC만): 목록 첫 enrich-미완 종목 대신 KR 종목 1개 열어 신규 섹션 미노출 확인
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(([a, r]) => { localStorage.setItem('access_token', a); localStorage.setItem('refresh_token', r); localStorage.setItem('theme', 'dark'); }, [access_token, refresh_token]);
    await page.goto(BASE + '/reports', { waitUntil: 'domcontentloaded' });
    await settle(page);
    // 보유 탭 첫 종목 (CRCL 아님)
    const opened = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('.report-item')).find(e => !/CRCL|Circle/i.test(e.textContent || ''));
      if (el) { el.click(); return (el.textContent || '').slice(0, 40) } return null
    });
    if (opened) {
      console.log(`=== graceful 확인: ${opened.trim()} ===`);
      await settle(page, 1200);
      await page.evaluate(() => {
        Array.from(document.querySelectorAll('.tab-btn')).filter(t => (t.textContent || '').includes('사업분석')).forEach(t => t.click())
      });
      await settle(page, 1500);
      const g = await page.evaluate(() => {
        const body = document.body.textContent || '';
        return { hasOutlookSection: body.includes('시장 전망'), hasRdChip: body.includes('R&D 집약도') };
      });
      console.log('   graceful:', JSON.stringify(g), '(enrich-미완 종목이면 둘 다 false 기대 — 단 이 종목이 enrich됐다면 true 가능)');
      await page.screenshot({ path: path.join(OUT, `pc-dark-graceful.png`), fullPage: true });
      console.log('   ✅ saved');
    }
    await ctx.close();
  } finally {
    if (added) {
      const d = await api(access_token, 'DELETE', `/api/watchlist/${TICKER}`);
      console.log(`CRCL 자가정리 DELETE: ${d.status}`);
    }
    await browser.close();
  }
}
run().catch(e => { console.error(e); process.exit(1); });
