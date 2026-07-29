// task#238 라이브 UAT — 구루 상세의 목록복귀 pill이 우하단 하나로 일원화됐는지.
// 정상 상세 · 에러(없는 id) × PC · 모바일 4조합에서 불변식 4개를 단언한다:
//   ① pill bbox가 뷰포트 안  ② 모바일 탭바와 교차 0  ③ pill.right ≈ clientWidth − 20 (우측 정렬)
//   ④ 상단 '← 구루 매니저' 링크 0개 (= /guru 링크는 pill 하나뿐)
// 판정 상대(탭바·뷰포트·토스트)는 리터럴이 아니라 getBoundingClientRect() 실측으로 얻는다 —
// 추정한 기준 상자가 거짓 FAIL을 냈던 task#228 D3의 재발 방지.
import { chromium, devices } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat238';
const BAD_ID = 'does-not-exist-uat238';
fs.mkdirSync(OUT, { recursive: true });

const r = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const { access_token, refresh_token } = await r.json();

const mdata = await (await fetch(`${BASE}/api/guru/managers`, { headers: { Authorization: `Bearer ${access_token}` } })).json();
const gid = [...(mdata.managers || [])].sort((a, b) => (b.portfolio_value || 0) - (a.portfolio_value || 0))[0]?.id;

// 에러 분기가 실제로 에러로 떨어지는지 먼저 확인 — 200이면 프로브 전제가 깨진 것이므로 드러낸다
const badStatus = (await fetch(`${BASE}/api/guru/managers/${BAD_ID}`, { headers: { Authorization: `Bearer ${access_token}` } })).status;

const b = await chromium.launch({ headless: true });

const settle = async (page) => {
  await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
};

const seed = async (page) => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([a, rr]) => {
    localStorage.setItem('access_token', a); localStorage.setItem('refresh_token', rr); localStorage.setItem('theme', 'light');
  }, [access_token, refresh_token]);
};

const MEASURE = () => {
  const pill = document.querySelector('.list-pill');
  // 상단 이동 링크 잔존 여부 — 판정 범위는 *본문*(main.page-wrap)으로 좁힌다.
  // 전역 내비(PC 마스트헤드 .masthead-cat / 모바일 .tabbar)도 href="/guru"라 문서 전체를 세면
  // 둘이 늘 잡혀 거짓 FAIL이 난다(실측으로 정체 확인: 카테고리 칩·탭바 항목 — 삭제 대상 아님).
  const main = document.querySelector('main.page-wrap') || document.body;
  const bodyGuruLinks = [...main.querySelectorAll('a[href="/guru"]')];
  const topLinks = bodyGuruLinks.filter(a => !a.classList.contains('list-pill')).length;
  const arrowText = [...document.querySelectorAll('a')].filter(a => a.textContent.includes('← 구루 매니저')).length;
  const base = {
    pillCount: document.querySelectorAll('.list-pill').length, topLinks, arrowText,
    bodyGuruLinks: bodyGuruLinks.length,                               // pill 1개만이어야
    navGuruLinks: document.querySelectorAll('a[href="/guru"]').length - bodyGuruLinks.length,  // 참고(내비 2개)
  };
  if (!pill) return { ...base, present: false };

  const p = pill.getBoundingClientRect();
  // fixed 요소의 right 오프셋은 스크롤바를 제외한 clientWidth 기준으로 해석된다 — innerWidth를 쓰면 PC에서 어긋난다
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const overlaps = (a, c) => !!c && !(a.right <= c.left || a.left >= c.right || a.bottom <= c.top || a.top >= c.bottom);
  const tabEl = document.querySelector('.tabbar');
  const tab = tabEl ? tabEl.getBoundingClientRect() : null;

  // 토스트는 추정하지 않고 Toast.jsx 스타일을 재현한 노드로 실측(task#228 D3)
  const wrap = document.createElement('div');
  Object.assign(wrap.style, { position: 'fixed', bottom: '88px', left: '50%', transform: 'translateX(-50%)',
    zIndex: '9999', display: 'flex', flexDirection: 'column', alignItems: 'center', pointerEvents: 'none' });
  const t = document.createElement('div');
  Object.assign(t.style, { border: '1px solid transparent', borderRadius: '8px', padding: '10px 20px',
    fontSize: '13px', whiteSpace: 'pre-wrap', maxWidth: '280px', textAlign: 'center' });
  t.textContent = '관심종목에 추가했습니다 — 아주 긴 메시지로 최대 폭을 채웁니다';
  wrap.appendChild(t); document.body.appendChild(wrap);
  const tr = t.getBoundingClientRect();
  wrap.remove();

  return {
    ...base,
    present: true,
    text: pill.textContent.trim(),
    position: getComputedStyle(pill).position,
    rect: { l: Math.round(p.left), t: Math.round(p.top), r: Math.round(p.right), b: Math.round(p.bottom) },
    viewport: { w: vw, h: vh },
    inViewport: p.left >= 0 && p.top >= 0 && p.right <= vw && p.bottom <= vh,
    rightGap: Math.round(vw - p.right),          // .list-pill { right: 20px } → 20 이어야
    tabbarRect: tab ? { t: Math.round(tab.top), b: Math.round(tab.bottom) } : null,
    overlapsTabbar: tab ? overlaps(p, tab) : false,
    toastRect: { l: Math.round(tr.left), r: Math.round(tr.right) },
    overlapsToast: overlaps(p, tr),              // 참고값 — D4 기존 성질(무해 판정), FAIL 축 아님
  };
};

const CASES = [
  { key: 'pc-detail', ctx: { viewport: { width: 1440, height: 900 } }, path: `/guru/${gid}`, mobile: false },
  { key: 'm-detail', ctx: { ...devices['iPhone 13'] }, path: `/guru/${gid}`, mobile: true },
  { key: 'pc-error', ctx: { viewport: { width: 1440, height: 900 } }, path: `/guru/${BAD_ID}`, mobile: false },
  { key: 'm-error', ctx: { ...devices['iPhone 13'] }, path: `/guru/${BAD_ID}`, mobile: true },
];

const out = { gid, badStatus, cases: {} };
for (const c of CASES) {
  const page = await (await b.newContext(c.ctx)).newPage();
  await seed(page);
  await page.goto(`${BASE}${c.path}`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  out.cases[c.key] = await page.evaluate(MEASURE);
  await page.screenshot({ path: `${OUT}/${c.key}.png` });
  // pill 탭 → /guru 복귀 확인
  await page.click('.list-pill').catch(() => {});
  await page.waitForTimeout(800);
  out.cases[c.key].urlAfterTap = new URL(page.url()).pathname;
  await page.context().close();
}
await b.close();

// ── 판정 ──────────────────────────────────────────────────
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); return cond; };
ok(badStatus >= 400, `전제: /api/guru/managers/${BAD_ID} 가 에러여야 하는데 ${badStatus}`);
for (const [k, m] of Object.entries(out.cases)) {
  ok(m.present, `${k}: .list-pill 미렌더`);
  if (!m.present) continue;
  ok(m.pillCount === 1, `${k}: pill ${m.pillCount}개 (1이어야)`);
  ok(m.text === '☰ 목록', `${k}: 라벨 "${m.text}" (☰ 목록이어야)`);
  ok(m.inViewport, `${k}: pill 뷰포트 밖 ${JSON.stringify(m.rect)} vs ${JSON.stringify(m.viewport)}`);
  ok(Math.abs(m.rightGap - 20) <= 2, `${k}: 우측 여백 ${m.rightGap}px (20±2 여야)`);
  ok(!m.overlapsTabbar, `${k}: 탭바와 교차 ${JSON.stringify(m.tabbarRect)}`);
  ok(m.topLinks === 0, `${k}: 본문에 pill 외 /guru 링크 ${m.topLinks}개 잔존`);
  ok(m.bodyGuruLinks === 1, `${k}: 본문 /guru 링크 ${m.bodyGuruLinks}개 (pill 1개만이어야)`);
  ok(m.arrowText === 0, `${k}: '← 구루 매니저' 링크 ${m.arrowText}개 잔존`);
  ok(m.urlAfterTap === '/guru', `${k}: pill 탭 후 경로 ${m.urlAfterTap}`);
}

console.log(JSON.stringify(out, null, 2));
console.log('\n' + '='.repeat(60));
if (fails.length) {
  console.log(`FAIL ${fails.length}건`);
  fails.forEach(f => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log(`ALL PASS — 4조합 × 불변식(pill 1개·라벨·뷰포트내·우측20px·탭바교차0·상단링크0·탭후 /guru)`);
console.log(`스샷: ${OUT}/{pc,m}-{detail,error}.png — 육안 확인 필요(task#235 가토 ⓐ)`);
