# 포트폴리오 분석 탭 통합 설계

**날짜:** 2026-05-31  
**목표:** 개인용 분석 기능(섹터 모멘텀, 매크로 상관관계, 종목 상관관계)을 포트폴리오 페이지로 통합하고, 네비게이션을 단순화한다.

---

## 배경 및 문제

현재 세 가지 개인용 분석 기능이 잘못된 위치에 배치되어 있다:

| 기능 | 현재 위치 | 문제 |
|------|-----------|------|
| 섹터 모멘텀 (SectorTab) | `/analysis` | 보유 종목의 섹터를 ★ 표시 → 개인 데이터 의존 |
| 매크로 상관관계 (MacroTab) | `/analysis` | 사용자 보유종목 수익률 vs 매크로 → 순수 개인 분석 |
| 종목 상관관계 히트맵 (Analytics) | `/market` → 분석 탭 | 보유종목 간 상관계수 → 개인 포트폴리오 데이터 |

`/analysis` 라우트는 별도 네비게이션 항목으로 6개 메뉴를 차지하고 있으며,  
`/market`의 "분석" 탭은 시장 지표와 무관한 개인 분석을 혼재시킨다.

---

## 설계

### 1. Portfolio.jsx — "분석" 탭 추가

**탭 구성 (변경 후):**
```
보유종목 | 관심종목 | 대시보드 | 분석
```

**분석 탭 내 서브탭:**
```
섹터 | 매크로 | 상관관계
```
- 섹터: SectorTab (기존 AnalysisHub의 섹터 모멘텀)
- 매크로: MacroTab (기존 AnalysisHub의 매크로 상관관계)
- 상관관계: Analytics (기존 MarketHub의 종목 상관관계 히트맵)

**PC (데스크톱):**
- 기존 `.tabs` 버튼에 "분석" 버튼 추가
- 분석 탭 활성 시: `.tabs` 스타일의 서브탭 switcher를 탭 콘텐츠 영역 상단에 렌더링
- 검색/필터 row는 `tab !== 'dash' && tab !== 'analysis'` 조건으로 숨김

**모바일:**
- 기존 `.seg` 버튼에 "분석" 버튼 추가
- 분석 탭 활성 시: `.seg` 스타일의 서브탭 switcher 렌더링 (아래 `seg-pad` 영역)
- 검색/필터 row도 동일하게 숨김

**상태 관리:**
- 기존 `tab` state에 `'analysis'` 값 추가
- `analysisTab` state 추가 (기본값: `'sector'`)

### 2. MarketHub.jsx — Analytics 탭 제거

- `Analytics` import 및 탭 버튼 제거
- 탭 switcher 전체 제거 (탭이 하나뿐이므로)
- `Market` 컴포넌트만 직접 렌더링
- `useState` 제거 (더 이상 불필요)

### 3. App.jsx — 라우팅 및 TopNav 정리

- `AnalysisHub` import 제거
- TopNav `allItems`에서 `analysis` 항목 제거 (5개 메뉴로 축소)
- `/analysis` Route: `<Navigate to="/" replace />` 리다이렉트로 교체

### 4. MobileNav.jsx — 분석 탭 항목 제거

- ALL_TABS에서 `{ to: '/analysis', label: '분석', key: 'analysis', Icon: GridIcon }` 제거

### 5. AnalysisHub.jsx — 파일 삭제

- 라우트에서 제거되므로 삭제

### 6. backend/routers/admin.py — ALL_MENUS 업데이트

- `ALL_MENUS`에서 `"analysis"` 제거
- DB의 기존 `user_menu_permissions` 레코드 중 `menu='analysis'`는 고아 데이터가 되지만 실행에 영향 없음 (조회 시 무시됨)

---

## 변경 파일 목록

| 파일 | 변경 유형 |
|------|-----------|
| `frontend/src/pages/Portfolio.jsx` | 수정 — 분석 탭 + 서브탭 추가 |
| `frontend/src/pages/MarketHub.jsx` | 수정 — Analytics 탭 제거 |
| `frontend/src/App.jsx` | 수정 — AnalysisHub 제거, analysis 라우트 리다이렉트 |
| `frontend/src/components/MobileNav.jsx` | 수정 — analysis 탭 항목 제거 |
| `frontend/src/pages/AnalysisHub.jsx` | 삭제 |
| `backend/routers/admin.py` | 수정 — ALL_MENUS에서 analysis 제거 |

---

## 검증 기준

- [ ] Portfolio 페이지 PC: "분석" 탭 클릭 시 서브탭(섹터/매크로/상관관계) 정상 렌더링
- [ ] Portfolio 페이지 모바일: 동일하게 "분석" 탭 및 서브탭 동작
- [ ] 시장 페이지: 탭 switcher 없이 시장지표만 표시
- [ ] TopNav: "분석" 메뉴 항목 미표시 (5개 메뉴)
- [ ] MobileNav: "분석" 탭 항목 미표시 (5개 탭)
- [ ] `/analysis` URL 접근 시 `/`로 리다이렉트
