# 2026-07-12 — 핵심자원 지표 차트 렌더 + 가이드 업종 표 9업종 확장 (task #184)

## Plan vs actual

- What went as planned: S1·S2 MET. `KeyResourceChart.jsx`(순수 헬퍼 3종 + recharts 이중축 차트: 1그룹 Line·2그룹 Bar좌+Line우·툴팁·범례·`--data-1..5` 고정 팔레트) + `Sections.jsx` `chartable` 분기(차트 우선, 불가 시 기존 테이블 폴백). 가이드 업종 표 4행 추가(금융·소비재/유통·미디어/게임·통신/유틸리티 → 9업종). vitest 77(+5)·build green. 커밋 `70494f0` push·라이브. UAT: PC다크·모바일라이트 Playwright 캡처로 BAH 이중축 차트 렌더 확인.
- Divergences:
  - dataviz 스킬의 "이중축(dual-axis) 금지" 원칙과 계획이 충돌 — **계획이 source of truth라 이중축 유지**(그릴링에서 명시 합의 + 기존 코드베이스 관례 M7EarningsSection·FinancialsChart가 이미 dual Y-axis). dataviz의 나머지(마크 스펙·범례·툴팁·팔레트 재사용)는 적용.
  - 차트 색은 신규 팔레트 검증 생략, 앱 표준 `--data-1..5` 토큰 재사용(이미 라이트/다크 정의).
  - UAT 자동화(Playwright)에서 계획 밖 우여곡절 3연속 — 아래 Learnings 본체.

## Learnings

- Do differently next time:
  - **리포트 목록 라이브 UAT 3중 함정 (재사용 스크립트로 박제: `scripts/uat184-keyresource.mjs`)**:
    ① **관심 탭 하위칩 기본값이 대상 종목을 숨긴다** — 관심 탭은 `목표≥40%/목표<40%/⚠경고` 하위칩으로 갈리고, 애널리스트 의견 부족 종목(BAH)은 '경고'칩에만 뜬다. 기본 노출 칩만 보면 "종목 없음"으로 오판. 특정 종목 UAT는 칩 순회 필수.
    ② **사이드바 컨테이너가 zero-height CSS라 Playwright `visible` 판정이 전부 실패** — `.report-item`이 DOM엔 있는데 부모가 `scrollHeight/clientHeight=0`이라 `:visible`·`.click()` 가시성 대기가 타임아웃. **DOM `element.click()` 직접 디스패치로 우회**. 라이브 캡처 스크립트는 visibility 대신 DOM 조작이 견고.
    ③ **`.tab-btn` 인덱스 클릭이 중복 탭셋(hidden 렌더)에 오적중** — 탭이 9개 잡히고(중복 렌더) nth(2)가 hidden 사본을 눌러 상세 미전환. **텍스트('심층분석') 기준 클릭**으로 해결.
  - **테스트 계정에 없는 종목은 관심 임시 추가→캡처→DELETE 자가정리** — 공개 read API로는 상세 진입 불가(딥링크 라우트 없음). prod 쓰기라 캡처 후 즉시 원복.
  - **스킬 원칙 vs 계획 충돌 시 계획 우선, 단 나머지 원칙은 적용** — dataviz "이중축 금지"는 이 앱의 KR 이중축 관례·그릴링 합의와 배치돼 기각했으나, 그건 dataviz 전체 기각이 아니라 한 규칙만 override. 스킬은 참조 fuel, source of truth는 plan/CONTEXT/ADR(fg 원칙과 동일).

## Doc updates

- CONTEXT.md promotion: none (핵심 자원 용어 기존 등록으로 충분).
- ADR added: none (가역적 렌더 변경 — 3조건 미달).
- 후속 후보: 코워크 재-enrich(3지표×4분기) 후 차트 자동 확장 확인(데이터 대기 — 태스크 아님).
