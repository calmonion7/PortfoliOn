// fg-loop(task#322) C5 — 신규 발행 7종 상세의 278px 육안 캡처.
// GET만. 라이브 쓰기 0.
//
// 왜 uat311 로 안 되나: uat311 은 DETAIL = NEW_PUB[0] 한 종만 캡처한다(신규 7종 전체가 아니다).
// 완료기준이 「신규 종 각각의 278px 육안 1장」이므로 캡처 대상을 축과 같은 정의역으로 맞춘다
// (live-uat-probes ①: 「각 축을 *측정하는 바로 그 지점에서* 찍어라」 — 여기선 대상 화면을 맞추는 쪽).
// 스크린샷만 남기지 않고 문서 폭도 함께 출력한다 — 278px 넘침은 players 표 「선두 대비」 열의
// **선재** 결함이므로(task#311 baseline) 육안에 그대로 찍힌다. 그 수치를 같이 남겨야
// 다음 사람이 「이번 회귀」로 오독하지 않는다.
import { chromium, devices } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat322';
fs.mkdirSync(OUT, { recursive: true });

const TARGET7 = ['autonomous-driving', 'space-comms', 'quantum-computing', 'nuclear-fusion',
  'solar-pv', 'on-device-ai', 'unmanned-defense'];

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const { access_token, refresh_token } = await login.json();
if (!access_token) { console.error('로그인 실패'); process.exit(1); }

const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices['iPhone SE'], viewport: { width: 278, height: 700 },
  isMobile: true, hasTouch: true, serviceWorkers: 'block',
});
await ctx.addInitScript(([a, r]) => {
  localStorage.setItem('access_token', a);
  localStorage.setItem('refresh_token', r);
  localStorage.setItem('theme', 'light');
  localStorage.setItem('pwa-install-dismissed-at', String(Date.now()));
}, [access_token, refresh_token]);
const page = await ctx.newPage();

const rows = [];
for (const slug of TARGET7) {
  await page.goto(`${BASE}/tech-report/${slug}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const f = `${OUT}/m278-${slug}.png`;
  await page.screenshot({ path: f, fullPage: true });
  const d = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
    len: document.body.innerText.length,
  }));
  const sz = fs.statSync(f).size;
  rows.push({ slug, ...d, kb: Math.round(sz / 1024) });
}
await ctx.close();
await browser.close();

console.log('신규 7종 m278 상세 캡처:');
for (const r of rows) {
  console.log(`  ${r.slug.padEnd(20)} 본문 ${String(r.len).padStart(6)}자 · 문서폭 ${r.sw}/${r.cw}` +
    `${r.sw > r.cw ? ` ⚠️ 넘침 ${r.sw - r.cw}px(선재 — players 표 「선두 대비」 열)` : ''} · ${r.kb}KB`);
}
const bad = rows.filter((r) => r.kb <= 10 || r.len < 2000);
console.log(`\n캡처 ${rows.length}/${TARGET7.length}종 · 빈약(10KB 이하 또는 본문 2000자 미만) ${bad.length}건` +
  `${bad.length ? ' ' + JSON.stringify(bad.map((r) => r.slug)) : ''}`);
console.log(`※ ${OUT}/`);
process.exit(rows.length === TARGET7.length && bad.length === 0 ? 0 : 1);
