// task#236 라이브 UAT — 구루 운용역·펀드 표기: 중복 2줄과 소개글 혼입 제거.
// 목록 카드 전수(모바일·PC 양쪽) + 상세 3표본에서 세 조건을 단언한다:
//   ① 제목 == 부제인 카드 0개  ② 부제 60자 초과 0개  ③ 부제가 제목으로 시작 0개
// 표본과 소개글 표식 문자열은 API 응답에서 도출한다(매니저명·문구 하드코딩 금지 — uat235 관용구).
// 시각 확인용 스크린샷도 남긴다(회고 #235: 프로브 PASS와 깨진 화면이 공존할 수 있다).
import { chromium, devices } from 'playwright';
import fs from 'fs';

const BASE = 'https://portfolion.taebro.com';
const OUT = '/Users/calmonion/Project/PortfoliOn/screenshots-uat236';
fs.mkdirSync(OUT, { recursive: true });
const MAX_SUB = 60;   // 부제 허용 길이 — 라이브 median 35자, 소개글 오염은 1455~7430자

const r = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@portfolion.com', password: 'test1234' }),
});
const { access_token, refresh_token } = await r.json();
const mdata = await (await fetch(`${BASE}/api/guru/managers`, { headers: { Authorization: `Bearer ${access_token}` } })).json();
const managers = mdata.managers || [];

// 표본은 API에서 도출 — ① 운용역+펀드 ② 펀드만(26명형) ③ 소개글 오염(12명형, firm이 name보다 크게 길다)
const blurbOf = (m) => (m.firm || '').startsWith(m.name) ? (m.firm || '').slice(m.name.length).trim() : '';
const polluted = managers.filter(m => blurbOf(m).length > 80).sort((a, b) => blurbOf(b).length - blurbOf(a).length);
const samples = [
  { tag: 'person-fund', m: managers.find(m => m.name.includes(' - ')) },
  { tag: 'fund-only',   m: managers.find(m => !m.name.includes(' - ')) },
  { tag: 'blurbed',     m: polluted[0] },
].filter(s => s.m);
// 오염 표본의 소개글에서 DOM 부재를 확인할 표식 문자열을 도출한다(첫 단어 5개)
const blurbMarker = polluted.length ? blurbOf(polluted[0]).split(/\s+/).slice(0, 5).join(' ') : null;

const results = [];
const fail = (tag, msg, data) => results.push({ ok: false, tag, msg, data });
const pass = (tag, msg, data) => results.push({ ok: true, tag, msg, data });

const b = await chromium.launch({ headless: true });
const seed = async (page) => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([a, rr]) => {
    localStorage.setItem('access_token', a); localStorage.setItem('refresh_token', rr); localStorage.setItem('theme', 'light');
  }, [access_token, refresh_token]);
};
const settle = async (page, ms = 1600) => {
  await page.waitForFunction(() => document.querySelectorAll('.skeleton-block').length === 0, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(ms);
};

// 목록 카드 전수 읽기 — 제목·부제 텍스트 쌍
const readCards = () => [...document.querySelectorAll('.guru-card')].map(c => ({
  title: (c.querySelector('.guru-name')?.textContent || '').trim(),
  sub: c.querySelector('.guru-fund') ? (c.querySelector('.guru-fund').textContent || '').trim() : null,
}));

// 세 조건 판정 — 목록·상세 공통
function judge(tag, pairs, expectedN) {
  if (expectedN != null) {
    (pairs.length === expectedN ? pass : fail)(`${tag}`, `카드 ${pairs.length}개 = API 매니저 ${expectedN}명`, { rendered: pairs.length, api: expectedN });
  }
  const dup = pairs.filter(p => p.sub != null && p.sub === p.title);
  (dup.length === 0 ? pass : fail)(`${tag}`, '① 제목 == 부제인 항목 0개', { n: dup.length, sample: dup.slice(0, 3) });

  const long = pairs.filter(p => p.sub != null && p.sub.length > MAX_SUB);
  (long.length === 0 ? pass : fail)(`${tag}`, `② 부제 ${MAX_SUB}자 초과 0개`, { n: long.length, sample: long.slice(0, 3).map(p => ({ title: p.title, len: p.sub.length, head: p.sub.slice(0, 50) })) });

  const prefixed = pairs.filter(p => p.sub != null && p.title && p.sub.startsWith(p.title));
  (prefixed.length === 0 ? pass : fail)(`${tag}`, '③ 부제가 제목으로 시작 0개', { n: prefixed.length, sample: prefixed.slice(0, 3) });

  const empty = pairs.filter(p => p.sub != null && !p.sub);
  (empty.length === 0 ? pass : fail)(`${tag}`, '부제 노드가 있으면 내용도 있다(빈 줄 0개)', { n: empty.length });
}

// ══ ① 목록 — 모바일 ════════════════════════════════════════
const ctx = await b.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
await seed(page);
await page.goto(`${BASE}/guru`, { waitUntil: 'domcontentloaded' });
await settle(page);
const mCards = await page.evaluate(readCards);
await page.screenshot({ path: `${OUT}/m-list.png` });
judge('S3/list-mobile', mCards, managers.length);

// ══ ② 상세 3표본 — 모바일 ══════════════════════════════════
for (const s of samples) {
  await page.goto(`${BASE}/guru/${s.m.id}`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  const d = await page.evaluate(() => {
    const h1 = document.querySelector('.appbar h1');
    const sub = document.querySelector('.m-page > a + p.muted');   // 복귀 링크 바로 다음 문단 = 부제
    return {
      title: (h1?.textContent || '').trim(),
      sub: sub ? (sub.textContent || '').trim() : null,
      bodyText: document.body.innerText,
    };
  });
  await page.screenshot({ path: `${OUT}/m-detail-${s.tag}.png` });
  judge(`S3/detail-m/${s.tag}`, [{ title: d.title, sub: d.sub }]);
  if (blurbMarker) {
    (!d.bodyText.includes(blurbMarker) ? pass : fail)(`S3/detail-m/${s.tag}`, '소개글 표식 문자열 DOM 부재', { marker: blurbMarker.slice(0, 40) });
  }
  // 펀드만인 표본은 부제가 아예 없어야 한다
  if (!s.m.name.includes(' - ')) {
    (d.sub === null ? pass : fail)(`S3/detail-m/${s.tag}`, '펀드만인 매니저 → 부제 문단 부재', { sub: d.sub });
  } else {
    (d.sub && d.sub === s.m.name.split(' - ').slice(1).join(' - ').trim() ? pass : fail)(`S3/detail-m/${s.tag}`, '부제 = name의 펀드 부분', { sub: d.sub, expect: s.m.name.split(' - ').slice(1).join(' - ').trim() });
  }
}

// ══ ③ 목록·상세 — PC ══════════════════════════════════════
const ctx2 = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p2 = await ctx2.newPage();
await seed(p2);
await p2.goto(`${BASE}/guru`, { waitUntil: 'domcontentloaded' });
await settle(p2, 2000);
const pcCards = await p2.evaluate(readCards);
await p2.screenshot({ path: `${OUT}/pc-list.png` });
judge('S3/list-pc', pcCards, managers.length);

for (const s of samples) {
  await p2.goto(`${BASE}/guru/${s.m.id}`, { waitUntil: 'domcontentloaded' });
  await settle(p2, 2000);
  const d = await p2.evaluate(() => {
    const head = document.querySelector('.page-head');
    return {
      title: (head?.querySelector('.page-title')?.textContent || '').trim(),
      sub: head?.querySelector('p.muted') ? (head.querySelector('p.muted').textContent || '').trim() : null,
      bodyText: document.body.innerText,
    };
  });
  await p2.screenshot({ path: `${OUT}/pc-detail-${s.tag}.png` });
  judge(`S3/detail-pc/${s.tag}`, [{ title: d.title, sub: d.sub }]);
  // PC 제목도 전체 이름이 아니라 파생값 — 제목 안에 펀드명이 반복되지 않는다
  (!d.title.includes(' - ') ? pass : fail)(`S3/detail-pc/${s.tag}`, 'PC 제목에 " - " 부재(전체 이름 미표시)', { title: d.title });
  if (blurbMarker) {
    (!d.bodyText.includes(blurbMarker) ? pass : fail)(`S3/detail-pc/${s.tag}`, '소개글 표식 문자열 DOM 부재', { marker: blurbMarker.slice(0, 40) });
  }
}

await b.close();

const failed = results.filter(x => !x.ok);
console.log(`\nAPI 매니저 ${managers.length}명 · 소개글 오염 ${polluted.length}명(최대 ${polluted.length ? blurbOf(polluted[0]).length : 0}자)`);
console.log(`표본: ${samples.map(s => `${s.tag}=${s.m.name}`).join(' / ')}`);
for (const x of results) console.log(`${x.ok ? 'PASS' : 'FAIL'}  [${x.tag}] ${x.msg}  ${JSON.stringify(x.data)}`);
console.log(`\n=== ${failed.length === 0 ? 'ALL PASS' : `${failed.length} FAIL`} (${results.length}건) ===`);
process.exit(failed.length === 0 ? 0 : 1);
