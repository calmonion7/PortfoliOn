# 2026-07-12 — 모바일 IA를 PC 사이드바 5섹션과 미러 (task#178, F23 후속)

## Plan vs actual
- What went as planned: S1(하단 5탭·일정·인컴 분리)·S3(appbar groupLabel)·S4(seg 섹션별 분리) 계획대로. 라이브 캡처로 /reports·/calendar에서 5탭·활성탭·appbar 라벨·seg 분리 전건 확인.
- Divergences:
  - **S2 설계 in-run 전환(핵심 발산)**: 처음엔 설정·admin을 개별 아이콘 버튼(GearIcon/GridIcon)으로 mobile-header에 직접 넣었으나, **라이브 캡처에서 GearIcon(설정)이 테마 Sun과 형태가 거의 동일**(둘 다 중앙 원 r=2.5 + 8방사선)해 다크 기본 상단바에서 구분 불가함을 포착. 계획이 명시 허용한 "더보기" 드롭다운(MoreIcon 점3개 + 텍스트 라벨 메뉴)으로 전환(커밋 dde3b11). 아이콘 충돌 + 버튼 혼잡 동시 해소.
  - 진입점 위치를 페이지별 `.appbar`(5곳) 대신 전역 `mobile-header`(App.jsx, `<Routes>` 밖·모바일 전용) 단일 지점으로 — 설정·admin은 로그아웃·테마 같은 전역 유틸리티라 자연스러운 홈.
  - `.tabbar` 그리드는 인라인 동적(`repeat(tabs.length)`) 대신 CSS 6→5로 최소 변경(기존 고정 그리드 스타일 준수).

## Learnings
- Do differently next time: **아이콘 버튼을 기존 아이콘 바에 추가할 땐 glyph 형태 충돌을 먼저 의심**하라 — 특히 이 프로젝트의 `GearIcon`(설정)과 `Sun`(테마)은 "원 + 8방사선"으로 사실상 동일 형태라, 같은 바에 나란히 두면 구분 불가. vitest·컴파일·DOM 구조 검증은 이걸 못 잡고 **라이브 시각 캡처만 잡는다**(fixture-pass-live-fail / KR 색 토큰 UI 리뷰와 같은 계열). 2차 유틸리티가 2개 이상이면 개별 아이콘보다 "더보기" 드롭다운(텍스트 라벨)이 충돌·혼잡을 함께 피하는 기본값.
- 권한 게이트 재사용: 상단 진입점의 노출 조건(`menuPermissions.includes('settings')` / `role==='admin'`)을 기존 하단 탭 게이트와 동일 술어로 두면 "탭 이동으로 인한 접근 상실 없음"이 구성상 보장된다.

## Doc updates
- CONTEXT.md promotion: none
- ADR added: none (ADR-0025 "모바일은 하단 MobileNav 유지"의 5섹션 매핑 실행 = 그 완성. 신규 결정 아님. 더보기 진입점은 구현 세부. 아이콘 충돌 교훈은 기존 라이브-UI-리뷰 계열의 한 사례라 retro에 기록으로 충분.)
