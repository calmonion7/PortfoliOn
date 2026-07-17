// task#194 UAT — 전 화면 캡처 매트릭스 (무배포).
// 프론트: 로컬 vite preview(:5173, dist는 VITE_API_BASE_URL=prod로 빌드) / 백엔드: 라이브 prod API(CORS localhost:5173 allowlist).
// 읽기 전용 — 로그인 토큰만 발급, 아무 것도 쓰지 않음.
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_BASE = 'https://portfolion.taebro.com'; // 토큰 발급용
const LOCAL = 'http://localhost:5173'; // 프리뷰 서버 (빌드에 baked-in VITE_API_BASE_URL이 실제 호출처)
const OUT = path.join(__dirname, '..', 'screenshots-uat194');
fs.mkdirSync(OUT, { recursive: true });

async function getToken() {
  const r = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
  });
  if (!r.ok) throw new Error(`login failed: ${r.status}`);
  return r.json();
}

const VP = {
  pc: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};

const ROUTES = [
  ['/reports', 'reports'],
  ['/recommend', 'recommend'],
  ['/ranking', 'ranking'],
  ['/compare', 'compare'],
  ['/calendar', 'calendar'],
  ['/dividends', 'dividends'],
  ['/digest', 'digest'],
  ['/portfolio', 'portfolio-dash'],
  ['/market/indicators', 'market-indicators'],
  ['/market/flow', 'market-flow'],
  ['/guru', 'guru'],
  ['/dev/showcase', 'showcase'],
];

const DETAIL_TABS = [
  ['📊 요약', 'detail-summary'],
  ['📈 지표', 'detail-analysis'],
  ['📝 심층분석', 'detail-report'],
  ['📅 히스토리', 'detail-history'],
];

const consoleErrors = [];
const notes = [];

async function waitLoaded(page) {
  try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
  await page.waitForTimeout(700);
}

async function shot(page, name) {
  // /showcase(Sketches/Motion 섹션 포함)만 fullPage — 나머지는 기존대로 뷰포트 컷
  const fullPage = name.includes('-showcase.png');
  await page.screenshot({ path: path.join(OUT, name), fullPage });
}

async function checkEmpty(page, name) {
  // 스켈레톤/빈상태 지속 여부 대략 탐지 — 후속 라이브 API 대조는 notes에 기록
  const info = await page.evaluate(() => {
    const skel = document.querySelectorAll('[class*="skeleton" i], [class*="Skeleton" i]').length;
    const emptyText = [...document.querySelectorAll('body *')].some(el =>
      el.children.length === 0 && /데이터가 없습니다|없어요|비어/.test(el.textContent || '') && el.textContent.length < 40
    );
    return { skel, emptyText };
  });
  if (info.skel > 0) notes.push(`[${name}] 스켈레톤 ${info.skel}개 잔존 (로딩 지연 또는 데이터 없음 가능)`);
  if (info.emptyText) notes.push(`[${name}] 빈상태 텍스트 감지`);
}

async function run() {
  const { access_token, refresh_token } = await getToken();

  for (const theme of ['light', 'dark']) {
    for (const vpName of ['pc', 'mobile']) {
      const vp = VP[vpName];
      const browser = await chromium.launch({ headless: true });
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        isMobile: !!vp.isMobile,
        hasTouch: !!vp.hasTouch,
        deviceScaleFactor: vp.deviceScaleFactor || 1,
        serviceWorkers: 'block',
      });
      const page = await ctx.newPage();
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const t = m.text();
        if (/\/api\/events/.test(t)) return; // 502는 아티팩트 제외 (알려진 이슈, task 지시)
        consoleErrors.push(`[${vpName}-${theme}] ${t.slice(0, 300)}`);
      });
      page.on('pageerror', (e) => consoleErrors.push(`[${vpName}-${theme}] PAGE_EXC: ${String(e).slice(0, 300)}`));

      // 1) 로그인 화면 (무토큰)
      await page.goto(LOCAL, { waitUntil: 'domcontentloaded' });
      await page.evaluate((th) => { localStorage.clear(); localStorage.setItem('theme', th); }, theme);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitLoaded(page);
      await shot(page, `${vpName}-${theme}-login.png`);

      // 토큰 주입
      await page.evaluate(([a, rt, th]) => {
        localStorage.setItem('access_token', a);
        localStorage.setItem('refresh_token', rt);
        localStorage.setItem('theme', th);
      }, [access_token, refresh_token, theme]);

      // 2) 각 라우트
      for (const [route, name] of ROUTES) {
        await page.goto(LOCAL + route, { waitUntil: 'domcontentloaded' });
        await waitLoaded(page);
        await shot(page, `${vpName}-${theme}-${name}.png`);
        await checkEmpty(page, `${vpName}-${theme}-${name}`);
      }

      // 3) PC 전용: 리포트 상세 4탭 + 포트폴리오 분석탭
      if (vpName === 'pc') {
        // 리포트 상세
        await page.goto(LOCAL + '/reports', { waitUntil: 'domcontentloaded' });
        await waitLoaded(page);
        const card = page.locator('.stock-card').first();
        const cardCount = await page.locator('.stock-card').count();
        if (cardCount > 0) {
          await card.click();
          await waitLoaded(page);
          for (const [label, name] of DETAIL_TABS) {
            const tabBtn = page.getByText(label, { exact: true });
            if (await tabBtn.count() > 0) {
              await tabBtn.first().click();
              await page.waitForTimeout(900);
              await shot(page, `pc-${theme}-${name}.png`);
              await checkEmpty(page, `pc-${theme}-${name}`);
            } else {
              notes.push(`[pc-${theme}-${name}] 탭 버튼 없음 (ETF라 요약/심층분석 숨겨짐 가능)`);
            }
          }
        } else {
          notes.push(`[pc-${theme}-report-detail] 보유/관심 종목(.stock-card) 없음 — 상세 진입 스킵`);
        }

        // 포트폴리오 분석탭
        await page.goto(LOCAL + '/portfolio', { waitUntil: 'domcontentloaded' });
        await waitLoaded(page);
        const analysisBtn = page.getByText('분석', { exact: true });
        if (await analysisBtn.count() > 0) {
          await analysisBtn.first().click();
          await page.waitForTimeout(900);
          await shot(page, `pc-${theme}-portfolio-analysis.png`);
          await checkEmpty(page, `pc-${theme}-portfolio-analysis`);
        } else {
          notes.push(`[pc-${theme}-portfolio-analysis] 분석 탭 버튼 없음`);
        }
      }

      await ctx.close();
      await browser.close();
    }
  }

  const files = fs.readdirSync(OUT).sort();
  console.log('FILES:', files.length);
  for (const f of files) console.log(' -', f);
  console.log('CONSOLE_ERRORS:', consoleErrors.length);
  for (const e of consoleErrors) console.log(' !', e);
  console.log('NOTES:');
  for (const n of notes) console.log(' *', n);
}

run().catch((e) => { console.error('FATAL', e); process.exit(1); });
