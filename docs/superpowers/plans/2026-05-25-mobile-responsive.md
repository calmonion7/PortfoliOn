# Mobile Responsive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 현재 PC 전용 PortfoliOn을 768px 이하 모바일에서도 완전히 사용 가능하게 만든다.

**Architecture:** CSS `@media (max-width: 768px)` 로 레이아웃 변경, `useIsMobile` 훅으로 구조가 다른 JSX(아코디언)를 조건부 렌더링, 새 `MobileNav` 컴포넌트로 하단 탭 바 구현. 데스크탑 레이아웃은 변경 없음.

**Tech Stack:** React 18, Vite, plain CSS (no Tailwind), React Router v6, inline styles + CSS classes 혼용

---

## File Map

| 역할 | 파일 |
|------|------|
| NEW — 768px 훅 | `frontend/src/hooks/useIsMobile.js` |
| NEW — 하단 탭 바 | `frontend/src/components/MobileNav.jsx` |
| MOD — 유틸 CSS 클래스 | `frontend/src/App.css` |
| MOD — 글로벌 미디어쿼리 | `frontend/src/index.css` |
| MOD — nav + MobileNav 마운트 | `frontend/src/App.jsx` |
| MOD — 대시보드 그리드 + 테이블 래퍼 | `frontend/src/pages/Portfolio.jsx` |
| MOD — 서브탭 가로스크롤 | `frontend/src/pages/Research.jsx` |
| MOD — 서브탭 가로스크롤 | `frontend/src/pages/AnalysisHub.jsx` |
| MOD — 아코디언 8개 | `frontend/src/components/market/FxSection.jsx` |
| MOD — 아코디언 | `frontend/src/components/market/VixSection.jsx` |
| MOD — 아코디언 | `frontend/src/components/market/CommoditiesSection.jsx` |
| MOD — 아코디언 | `frontend/src/components/market/TreasurySection.jsx` |
| MOD — 아코디언 | `frontend/src/components/market/EconIndicatorsSection.jsx` |
| MOD — 아코디언 | `frontend/src/components/market/M7EarningsSection.jsx` |
| MOD — 아코디언 | `frontend/src/components/market/KrTop2Section.jsx` |
| MOD — 아코디언 | `frontend/src/components/market/KrExportsSection.jsx` |
| MOD — 아코디언 | `frontend/src/pages/SectorTab.jsx` |
| MOD — 아코디언 | `frontend/src/pages/MacroTab.jsx` |
| MOD — 테이블 래퍼 | `frontend/src/pages/Guru.jsx` |
| MOD — 테이블 래퍼 | `frontend/src/pages/GuruManagers.jsx` |
| MOD — 테이블 래퍼 | `frontend/src/pages/GuruStats.jsx` |

---

## Task 1: useIsMobile 훅 + CSS 유틸 클래스

**Files:**
- Create: `frontend/src/hooks/useIsMobile.js`
- Modify: `frontend/src/App.css`

- [ ] **Step 1: useIsMobile 훅 생성**

```js
// frontend/src/hooks/useIsMobile.js
import { useState, useEffect } from 'react'

const QUERY = '(max-width: 768px)'

export default function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    const handler = (e) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return isMobile
}
```

- [ ] **Step 2: App.css에 유틸 클래스 추가**

`frontend/src/App.css` 파일 끝에 아래를 추가한다:

```css
/* ── Mobile utilities ── */
.desktop-only { display: flex; }
.mobile-only  { display: none; }

.table-mobile-wrap { width: 100%; }

.accordion-header {
  width: 100%; text-align: left; background: none; border: none;
  border-bottom: 1px solid var(--border); padding: 10px 0;
  color: var(--text-heading); font-size: 15px; font-weight: 600;
  cursor: pointer; display: flex; justify-content: space-between; align-items: center;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}

@media (max-width: 768px) {
  .desktop-only { display: none !important; }
  .mobile-only  { display: flex !important; }

  .table-mobile-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .col-sticky {
    position: sticky; left: 0; z-index: 1;
    background: var(--bg-surface);
  }

  .dashboard-grid { grid-template-columns: 1fr; }
}
```

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/hooks/useIsMobile.js frontend/src/App.css
git commit -m "feat: useIsMobile hook + mobile CSS utilities"
```

---

## Task 2: MobileNav 컴포넌트

**Files:**
- Create: `frontend/src/components/MobileNav.jsx`

- [ ] **Step 1: MobileNav 작성**

```jsx
// frontend/src/components/MobileNav.jsx
import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'

const TAB_STYLE = (active) => ({
  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
  justifyContent: 'center', gap: 2, padding: '6px 0',
  background: 'none', border: 'none', cursor: 'pointer',
  color: active ? 'var(--accent)' : 'var(--text-muted)',
  fontSize: 9, fontWeight: active ? 600 : 400,
})

const TABS = [
  { to: '/',         label: '종목관리', icon: '📊' },
  { to: '/research', label: '리서치',   icon: '📰' },
  { to: '/market',   label: '시장',     icon: '📈' },
  { to: '/analysis', label: '분석',     icon: '🔍' },
]

export default function MobileNav() {
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <>
      {/* 하단 탭 바 */}
      <nav style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 200,
        display: 'flex', background: 'var(--bg-nav)',
        borderTop: '2px solid var(--accent)', height: 56,
      }}>
        {TABS.map(({ to, label, icon }) => (
          <NavLink key={to} to={to} end={to === '/'} style={({ isActive }) => TAB_STYLE(isActive)}>
            <span style={{ fontSize: 16 }}>{icon}</span>
            {label}
          </NavLink>
        ))}
        <button style={TAB_STYLE(false)} onClick={() => setDrawerOpen(true)}>
          <span style={{ fontSize: 16 }}>⋯</span>
          더보기
        </button>
      </nav>

      {/* 더보기 드로어 */}
      {drawerOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', zIndex: 300 }}
          onClick={() => setDrawerOpen(false)}
        >
          <div
            style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              background: 'var(--bg-surface)', borderRadius: '12px 12px 0 0',
              padding: '16px 0 72px',
            }}
            onClick={e => e.stopPropagation()}
          >
            {[
              { to: '/guru',     label: '구루',  icon: '👤' },
              { to: '/settings', label: '설정',  icon: '⚙️' },
            ].map(({ to, label, icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => setDrawerOpen(false)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 24px',
                         color: 'var(--text)', textDecoration: 'none', fontSize: 15 }}
              >
                <span style={{ fontSize: 20 }}>{icon}</span> {label}
              </NavLink>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 2: 커밋**

```bash
git add frontend/src/components/MobileNav.jsx
git commit -m "feat: MobileNav component with bottom tab bar and drawer"
```

---

## Task 3: App.jsx — nav 링크 숨김 + MobileNav 마운트

**Files:**
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: App.jsx 상단 import에 MobileNav 추가**

현재:
```jsx
import './App.css'
```
변경 후:
```jsx
import MobileNav from './components/MobileNav'
import './App.css'
```

- [ ] **Step 2: nav 링크들에 desktop-only 클래스 추가**

현재 nav 링크 목록을 감싸는 부분:
```jsx
{[['/', '종목관리'], ['/research', '리서치'], ['/market', '시장'], ['/analysis', '분석'], ['/guru', '구루'], ['/settings', '설정']].map(([to, label]) => (
  <NavLink ...>{label}</NavLink>
))}
```
변경 후 (`<>...</>` 로 `className="desktop-only"` div 래핑):
```jsx
<div className="desktop-only" style={{ gap: 24, alignItems: 'center' }}>
  {[['/', '종목관리'], ['/research', '리서치'], ['/market', '시장'], ['/analysis', '분석'], ['/guru', '구루'], ['/settings', '설정']].map(([to, label]) => (
    <NavLink
      key={to}
      to={to}
      end={to === '/'}
      style={({ isActive }) => ({
        color: isActive ? 'var(--accent)' : 'var(--text-muted)',
        textDecoration: 'none',
        fontWeight: isActive ? 600 : 400,
      })}
    >
      {label}
    </NavLink>
  ))}
</div>
```

- [ ] **Step 3: main에 mobile padding-bottom 추가 + MobileNav 렌더링**

현재:
```jsx
<main style={{ padding: 24, background: 'var(--bg)', minHeight: 'calc(100vh - 49px)' }}>
```
변경 후:
```jsx
<main style={{ padding: 24, background: 'var(--bg)', minHeight: 'calc(100vh - 49px)', paddingBottom: 'max(24px, calc(24px + 56px))' }}>
```

`</BrowserRouter>` 닫기 직전에 MobileNav 추가:
```jsx
      </main>
      <MobileNav />
    </BrowserRouter>
```

> **참고**: `MobileNav` 내부 CSS class `.mobile-only { display: none }` 으로 데스크탑에서 숨겨지므로 별도 조건부 렌더링 불필요.

- [ ] **Step 4: 로컬에서 확인**

```bash
cd frontend && npm run dev
```

브라우저 DevTools → 375px 너비로 설정. 확인:
- 상단 nav 링크 사라짐, 로고·테마 버튼 유지
- 하단 탭 바 나타남
- 더보기 탭 클릭 시 구루·설정 드로어 오픈

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/App.jsx
git commit -m "feat: wire MobileNav into App, hide desktop nav links on mobile"
```

---

## Task 4: index.css 글로벌 미디어쿼리

**Files:**
- Modify: `frontend/src/index.css`

- [ ] **Step 1: index.css 파일 끝에 미디어쿼리 추가**

```css
/* ── Mobile layout ── */
@media (max-width: 768px) {
  main {
    padding: 12px !important;
  }

  /* 서브탭 (Research, AnalysisHub 등) 가로 스크롤 */
  .tab-scroll {
    overflow-x: auto;
    white-space: nowrap;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .tab-scroll::-webkit-scrollbar { display: none; }

  /* 모달 너비 이미 max-width: 95vw → 추가 조정 없음 */
}
```

- [ ] **Step 2: 확인**

브라우저 375px 너비에서 main padding이 12px로 줄어드는지 확인.

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/index.css
git commit -m "feat: global mobile media queries"
```

---

## Task 5: Portfolio.jsx — 대시보드 그리드 클래스 + 테이블 래퍼

**Files:**
- Modify: `frontend/src/pages/Portfolio.jsx`

- [ ] **Step 1: DashboardGrid 인라인 스타일 → CSS 클래스**

현재 (`Portfolio.jsx:111`):
```jsx
const DashboardGrid = ({ cards, loading }) => {
  ...
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
```
변경 후:
```jsx
const DashboardGrid = ({ cards, loading }) => {
  ...
  return (
    <div className="dashboard-grid">
```

- [ ] **Step 2: 보유종목 테이블 래퍼 + 첫 컬럼 sticky 클래스**

현재 (`Portfolio.jsx:300`):
```jsx
{activeTab === 'holdings' && (
  <table style={{ fontSize: 13 }}>
    <thead>
      <tr>
        <th style={{ fontSize: 11 }}>시장</th>
```
변경 후:
```jsx
{activeTab === 'holdings' && (
  <div className="table-mobile-wrap">
  <table style={{ fontSize: 13 }}>
    <thead>
      <tr>
        <th className="col-sticky" style={{ fontSize: 11 }}>시장</th>
```

보유종목 `</table>` 뒤에 `</div>` 닫기 추가.

각 `<tbody>` 의 `<td>` 첫 번째에도 `className="col-sticky"` 추가:
```jsx
<tr key={stock.ticker}>
  <td className="col-sticky"><MarketBadge market={stock.market || 'US'} /></td>
```

- [ ] **Step 3: 관심종목 테이블 동일하게 처리**

현재 (`Portfolio.jsx:340`):
```jsx
{activeTab === 'watchlist' && (
  <table style={{ fontSize: 13 }}>
    <thead>
      <tr>
        <th style={{ fontSize: 11 }}>시장</th>
```
변경 후:
```jsx
{activeTab === 'watchlist' && (
  <div className="table-mobile-wrap">
  <table style={{ fontSize: 13 }}>
    <thead>
      <tr>
        <th className="col-sticky" style={{ fontSize: 11 }}>시장</th>
```

관심종목 `</table>` 뒤에도 `</div>` 추가.

각 watchlist tbody 첫 `<td>` 에 `className="col-sticky"` 추가:
```jsx
<tr key={stock.ticker}>
  <td className="col-sticky"><MarketBadge market={stock.market || 'US'} /></td>
```

- [ ] **Step 4: 확인**

브라우저 375px. 대시보드 탭 → 카드 1열. 보유/관심 탭 → 가로 스크롤 시 시장 컬럼 고정.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/pages/Portfolio.jsx
git commit -m "feat: mobile dashboard grid + sticky table column in Portfolio"
```

---

## Task 6: Research.jsx + AnalysisHub.jsx 서브탭 가로스크롤

**Files:**
- Modify: `frontend/src/pages/Research.jsx`
- Modify: `frontend/src/pages/AnalysisHub.jsx`

- [ ] **Step 1: Research.jsx 서브탭 div에 tab-scroll 클래스 추가**

현재 (`Research.jsx:24`):
```jsx
<div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 24 }}>
```
변경 후:
```jsx
<div className="tab-scroll" style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 24 }}>
```

- [ ] **Step 2: AnalysisHub.jsx 서브탭 동일하게 처리**

AnalysisHub.jsx에서 서브탭을 렌더링하는 `display: 'flex'` div를 찾아 `className="tab-scroll"` 추가. 파일을 열어 탭 렌더링 부분 확인 후 적용.

- [ ] **Step 3: 확인**

375px에서 Research 서브탭(리포트·캘린더·다이제스트)이 가로 스크롤로 넘어가는지 확인.

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/pages/Research.jsx frontend/src/pages/AnalysisHub.jsx
git commit -m "feat: horizontal scroll for subtabs on mobile"
```

---

## Task 7: Market 섹션 아코디언 (8개 섹션)

**Files:**
- Modify: `frontend/src/components/market/FxSection.jsx` (기본값 open=true)
- Modify: `frontend/src/components/market/VixSection.jsx`
- Modify: `frontend/src/components/market/CommoditiesSection.jsx`
- Modify: `frontend/src/components/market/TreasurySection.jsx`
- Modify: `frontend/src/components/market/EconIndicatorsSection.jsx`
- Modify: `frontend/src/components/market/M7EarningsSection.jsx`
- Modify: `frontend/src/components/market/KrTop2Section.jsx`
- Modify: `frontend/src/components/market/KrExportsSection.jsx`

아코디언 패턴은 8개 파일 모두 동일. FxSection을 예시로 설명하고, 나머지는 동일하게 적용.

- [ ] **Step 1: FxSection.jsx 아코디언 적용 (기본 open)**

현재 imports:
```jsx
import { useState, useEffect } from 'react'
```
변경 후 (`useIsMobile` 추가):
```jsx
import { useState, useEffect } from 'react'
import useIsMobile from '../../hooks/useIsMobile'
```

컴포넌트 함수 내부 최상단에 추가:
```jsx
export default function FxSection() {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(true)   // FxSection은 기본 open
  const [data, setData] = useState(null)
  // ...기존 코드 유지...
```

현재 return 구조:
```jsx
return (
  <div style={SECTION_STYLE}>
    <h3 style={SECTION_HEADER_STYLE}>환율</h3>
    <p style={DESC_STYLE}>...</p>
    {/* 차트 내용 */}
  </div>
)
```
변경 후:
```jsx
return (
  <div style={SECTION_STYLE}>
    {isMobile ? (
      <button className="accordion-header" onClick={() => setOpen(o => !o)}>
        <span style={SECTION_HEADER_STYLE}>환율</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
    ) : (
      <h3 style={SECTION_HEADER_STYLE}>환율</h3>
    )}
    {(!isMobile || open) && (
      <>
        <p style={DESC_STYLE}>...</p>
        {/* 기존 차트 내용 그대로 */}
      </>
    )}
  </div>
)
```

> loading/error early return은 변경하지 않는다.

- [ ] **Step 2: 나머지 7개 섹션 동일하게 적용 (기본 open=false)**

VixSection, CommoditiesSection, TreasurySection, EconIndicatorsSection, M7EarningsSection, KrTop2Section, KrExportsSection 각각에 동일한 패턴 적용.

차이점: `useState(false)` (기본 닫힘), 섹션 제목은 각각:
- VixSection → `'VIX 변동성'`
- CommoditiesSection → `'원자재'`
- TreasurySection → `'국채 금리'`
- EconIndicatorsSection → `'경제지표'`
- M7EarningsSection → `'M7 실적'`
- KrTop2Section → `'삼성·SK하이닉스 실적'`
- KrExportsSection → `'한국 수출'`

각 파일에서 정확한 섹션 제목은 기존 `<h3>` 내용을 그대로 사용.

- [ ] **Step 3: 확인**

375px에서 시장 페이지 열기. 환율 섹션만 펼쳐져 있고, 나머지 7개는 접혀 있어야 함. 각 헤더 탭 클릭 시 토글 동작 확인.

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/components/market/
git commit -m "feat: accordion for market sections on mobile"
```

---

## Task 8: SectorTab.jsx + MacroTab.jsx 아코디언

**Files:**
- Modify: `frontend/src/pages/SectorTab.jsx`
- Modify: `frontend/src/pages/MacroTab.jsx`

- [ ] **Step 1: SectorTab.jsx 파일 구조 확인 후 아코디언 적용**

파일을 열어 차트/섹션을 감싸는 최상위 div 구조를 파악. 섹션별로 나뉘어 있다면 Task 7과 동일한 패턴으로 각 섹션에 아코디언 적용. 단일 섹션이면 전체를 하나의 아코디언으로 래핑.

import 경로 주의 — SectorTab/MacroTab은 `pages/` 에 있으므로:
```jsx
import useIsMobile from '../hooks/useIsMobile'
```

`open` state 추가 (기본 true), 섹션 헤더에 accordion-header 버튼 추가.

- [ ] **Step 2: MacroTab.jsx 동일하게 적용**

- [ ] **Step 3: 확인**

375px에서 분석 페이지 → 섹터 탭, 매크로 탭 각각 아코디언 동작 확인.

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/pages/SectorTab.jsx frontend/src/pages/MacroTab.jsx
git commit -m "feat: accordion for SectorTab and MacroTab on mobile"
```

---

## Task 9: Guru 페이지 테이블 래퍼

**Files:**
- Modify: `frontend/src/pages/Guru.jsx`
- Modify: `frontend/src/pages/GuruManagers.jsx`
- Modify: `frontend/src/pages/GuruStats.jsx`

- [ ] **Step 1: Guru.jsx 서브탭 가로스크롤 추가**

Guru.jsx에서 서브 탭(구루 운용역·통계·크롤링설정 등)을 렌더링하는 `display: 'flex'` div를 찾아 `className="tab-scroll"` 추가:
```jsx
<div className="tab-scroll" style={{ display: 'flex', borderBottom: '1px solid var(--border)', ... }}>
```

- [ ] **Step 2: 각 파일에서 `<table` 을 찾아 table-mobile-wrap 래핑**

각 파일마다:
1. 파일을 열어 `<table` 위치 확인
2. `<table` 위에 `<div className="table-mobile-wrap">` 추가
3. `</table>` 아래에 `</div>` 추가
4. 첫 번째 `<th>` 와 각 `<tr>` 의 첫 번째 `<td>` 에 `className="col-sticky"` 추가

- [ ] **Step 3: 확인**

375px에서 구루 페이지, 구루 운용역, 구루 통계 각각 테이블 가로 스크롤 + 첫 컬럼 고정 확인. 구루 서브탭 가로스크롤 동작 확인.

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/pages/Guru.jsx frontend/src/pages/GuruManagers.jsx frontend/src/pages/GuruStats.jsx
git commit -m "feat: sticky table column + subtab scroll for Guru pages on mobile"
```

---

## Task 10: 최종 검증

- [ ] **Step 1: 개발 서버 실행**

```bash
cd frontend && npm run dev
```

- [ ] **Step 2: 성공 기준 체크리스트**

브라우저 DevTools 375px (iPhone SE) 기준:

- [ ] 종목관리: 하단 탭으로 접근, 대시보드 카드 1열, 테이블 가로스크롤+첫컬럼고정
- [ ] 리서치: 서브탭 가로스크롤, 콘텐츠 정상 표시
- [ ] 시장: FX 섹션 열림, 나머지 접힘, 각 섹션 토글 동작
- [ ] 분석: 서브탭 가로스크롤, 섹터/매크로 아코디언 동작
- [ ] 구루: 테이블 가로스크롤+첫컬럼고정
- [ ] 설정: 폼 필드 정상 표시
- [ ] 더보기 탭 → 구루·설정 드로어 오픈/닫힘
- [ ] 데스크탑(1280px): 기존 레이아웃 변화 없음, 하단 탭 숨김

- [ ] **Step 3: 최종 커밋**

```bash
git add -A
git commit -m "feat: mobile responsive complete — all 6 pages"
```
