# PortfoliOn 모바일 반응형 설계

**날짜:** 2026-05-25  
**범위:** 전체 6개 페이지 (종목관리·리서치·시장·분석·구루·설정)  
**목표:** 현재 PC 전용 레이아웃을 모바일(≤768px)에서도 완전히 사용 가능하게 만든다.

---

## 1. 브레이크포인트

| 구간 | 범위 | 설명 |
|------|------|------|
| Mobile | ≤ 768px | 하단 탭 바, 1열 레이아웃, 아코디언 |
| Desktop | > 768px | 기존 레이아웃 그대로 유지 |

---

## 2. 구현 방식: 하이브리드

### CSS @media 쿼리 (index.css / App.css)
레이아웃 수준 변경에 사용:
- 상단 nav 링크 숨김, 하단 탭 바 표시
- `main` padding 24px → 12px
- 그리드 레이아웃 → 1열 (`grid-template-columns: 1fr`)
- 테이블 scroll wrapper (`.table-mobile-wrap`)
- 첫 컬럼 sticky (`position: sticky; left: 0`)

### `useIsMobile` 훅 (조건부 렌더링)
구조가 다른 JSX가 필요한 경우에만 사용:
- 시장 섹션 아코디언 (펼침/접힘 state 관리)
- 하단 탭 "더보기" → 드로어 오픈

---

## 3. 내비게이션

### 데스크탑 (변경 없음)
기존 상단 수평 nav 그대로 유지.

### 모바일: 하단 탭 바 (`MobileNav` 컴포넌트)
- **위치:** 화면 하단 고정 (`position: fixed; bottom: 0`)
- **탭 구성:** 종목관리 · 리서치 · 시장 · 분석 · 더보기
- **더보기 탭:** 클릭 시 바텀 드로어 오픈 → 구루, 설정 링크 노출
- **상단 nav:** 모바일에서 링크 숨김, 로고·테마 버튼만 유지
- **main 하단 여백:** 하단 탭 바 높이(56px)만큼 padding-bottom 추가

```
App.jsx:
  <nav>
    <span>Portfolio Manager</span>          ← 로고: 항상 표시
    <NavLink>...</NavLink>                   ← 링크: .desktop-only (display:none on mobile)
    <ThemeButtons />                         ← 테마: 항상 표시
  </nav>
  <main>...</main>
  <MobileNav />                              ← 새 컴포넌트: .mobile-only (display:none on desktop)
```

---

## 4. 테이블 (종목관리·구루)

### 패턴: 첫 컬럼 고정 + 가로 스크롤

```html
<!-- 래퍼 div를 테이블 외부에 추가 -->
<div class="table-mobile-wrap">
  <table>
    <th class="col-sticky">티커</th>   ← 첫 컬럼에 sticky 클래스
    <td class="col-sticky">AAPL</td>
  </table>
</div>
```

**CSS:**
```css
@media (max-width: 768px) {
  .table-mobile-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .col-sticky { position: sticky; left: 0; z-index: 1; background: var(--bg-surface); }
}
```

적용 대상:
- `Portfolio.jsx` — 보유/관심 종목 테이블
- `Guru.jsx` — 구루 종목 테이블
- `GuruManagers.jsx` — 구루 운용역 테이블
- `GuruStats.jsx` — 구루 통계 테이블

---

## 5. 차트 섹션 (시장·분석)

### 패턴: 아코디언 (모바일에서만 접기/펼치기)

`market/` 8개 섹션 컴포넌트에 적용:
`FxSection`, `VixSection`, `CommoditiesSection`, `TreasurySection`,  
`EconIndicatorsSection`, `M7EarningsSection`, `KrTop2Section`, `KrExportsSection`

**동작:**
- 데스크탑: 기존과 동일, 항상 펼침
- 모바일: 섹션 헤더 클릭으로 접기/펼치기
- 기본 상태: 첫 번째 섹션(FX) 펼침, 나머지 접힘

**구조 (각 섹션 컴포넌트에 동일하게 적용):**
```jsx
const isMobile = useIsMobile()
const [open, setOpen] = useState(!isMobile || isFirst)

// 렌더링
<div>
  {isMobile && (
    <button onClick={() => setOpen(o => !o)} className="accordion-header">
      섹션 제목 {open ? '▲' : '▼'}
    </button>
  )}
  {(!isMobile || open) && <div>...기존 차트 내용...</div>}
</div>
```

`AnalysisHub` 내 `SectorTab`, `MacroTab`도 동일 패턴 적용.

---

## 6. 페이지별 레이아웃 변경

### 종목관리 (Portfolio.jsx)
- 대시보드 카드 그리드: `grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))` → 모바일 1열
- 보유/관심 종목 테이블: `.table-mobile-wrap` + `.col-sticky`
- 탭 버튼(보유종목/관심종목): 전체 너비 균등 분할

### 리서치 (Research.jsx)
- 서브탭(리포트·캘린더·다이제스트): 가로 스크롤 허용 (`overflow-x: auto; white-space: nowrap`)
- 리포트 카드 목록: 1열 스택

### 시장 (MarketHub.jsx + market/ 컴포넌트들)
- 8개 섹션 전체 아코디언 적용
- 섹션 내 2열 차트 그리드 → 1열

### 분석 (AnalysisHub.jsx)
- 서브탭(섹터·매크로): 가로 스크롤
- SectorTab, MacroTab 내부 차트: 아코디언 + 1열

### 구루 (Guru.jsx + 서브페이지)
- 구루 테이블: `.table-mobile-wrap` + `.col-sticky`
- 서브 설정 탭: 가로 스크롤

### 설정 (Settings.jsx)
- 폼 필드: 이미 `width: 100%` → 추가 변경 미미

---

## 7. 새로 생성되는 파일

| 파일 | 역할 |
|------|------|
| `frontend/src/hooks/useIsMobile.js` | `window.matchMedia('(max-width: 768px)')` 훅 |
| `frontend/src/components/MobileNav.jsx` | 하단 탭 바 + 더보기 드로어 |

---

## 8. 수정되는 파일

| 파일 | 변경 내용 |
|------|-----------|
| `frontend/src/index.css` | `@media (max-width: 768px)` 규칙 추가 |
| `frontend/src/App.css` | `.table-mobile-wrap`, `.col-sticky`, `.accordion-header`, `.desktop-only`, `.mobile-only` 클래스 추가 |
| `frontend/src/App.jsx` | `MobileNav` 마운트, nav 링크에 `.desktop-only` 적용, main에 mobile padding-bottom |
| `frontend/src/pages/Portfolio.jsx` | 그리드 CSS 클래스 적용, 테이블 래퍼 추가 |
| `frontend/src/pages/Research.jsx` | 서브탭 overflow 처리 |
| `frontend/src/pages/MarketHub.jsx` | 섹션 컴포넌트 아코디언 래핑 |
| `frontend/src/components/market/*.jsx` | 아코디언 헤더 추가 (8개 파일) |
| `frontend/src/pages/AnalysisHub.jsx` | 서브탭 overflow 처리 |
| `frontend/src/pages/SectorTab.jsx` | 차트 아코디언 적용 |
| `frontend/src/pages/MacroTab.jsx` | 차트 아코디언 적용 |
| `frontend/src/pages/Guru.jsx` | 테이블 래퍼 추가 |
| `frontend/src/pages/GuruManagers.jsx` | 테이블 래퍼 추가 |
| `frontend/src/pages/GuruStats.jsx` | 테이블 래퍼 추가 |

---

## 9. 제외 범위

- 터치 제스처(스와이프 내비게이션) — 별도 요청 시 추가
- PWA / 홈 화면 추가 — 별도 요청 시 추가
- 폰트 크기 동적 조정 — CSS 기본 스케일링으로 충분
- 다크모드 이외 테마 모바일 최적화 — 테마 토큰이 이미 전역 적용됨

---

## 10. 성공 기준

- [ ] iPhone/Android 기본 브라우저에서 6개 페이지 모두 가로 스크롤 없이 표시
- [ ] 하단 탭으로 모든 페이지 접근 가능
- [ ] 종목 테이블에서 티커 컬럼 고정된 채 가로 스크롤 동작
- [ ] 시장 섹션 아코디언 정상 동작
- [ ] 데스크탑(768px+)에서 기존 레이아웃 변화 없음
