# 2026-06-16 — FRED 매크로 신호판 (task #53)

## Plan vs actual

- **계획대로(저-divergence)**: S1~S5 done, 적대적 리뷰 PASS, backend pytest 696, npm build OK, 포착 회귀 없음. FRED 4종(T10Y2Y·BAMLH0A0HYM2·M2SL·DFF) `macro.py` 수집·`evaluate_signals`(역전·HY 임계)·`macro_signals_fetch` 일배치(market=US/해외)·`GET /api/market/macro-signals`(저장값만)·시장지표 탭 `MacroSignalsSection`. 기존 경제지표(CPI/UNRATE)·MacroTab 불변. 20배치. Dynamic Workflow 4에이전트, FRED 패턴 재사용이라 가벼웠다.
- **Divergences(경미)**:
  - **FRED 시리즈 ID 라이브 미검증**: 워크플로우 env에 FRED_API_KEY 없어 keyless FRED가 series_id 검증 전 400 → 4종 ID 라이브 확인 불가. 표준 ID·기존 econ 동일 응답형태라 같은 파서 재사용, 첫 prod 배치(.env.docker 키)에서 확인 예정.
  - `macro.py`가 econ `_fetch_series`를 import 안 하고 로컬 복제 — econ것은 `_fetch_and_save_econ_indicators` 내부 클로저(start만 받고 api_key 캡처)라 시그니처 달라 직접 재사용 불가 + store 분리 원칙상 econ 편집 회피.
  - HY_STRESS_THRESHOLD=5.0% 절대 임계(플랜 허용 범위, 모듈 상수).

## Learnings

- **Do differently next time**:
  - **외부 API 라이브 검증은 자격증명이 워크플로우 env에 있어야 가능** — 이번 FRED는 키 없이는 series_id 검증조차 400이라 ID 실검증을 첫 prod 배치로 미뤘다(KIS "키 미설정=휴면"·키움 "라이브 대조"의 변형). 키 없는 외부 API 작업은 **fixture로 로직 고정 + "첫 prod 실행서 실데이터 확인"을 verified 노트·글랜스 항목에 명시**가 현실적 패턴(이번에 그렇게 처리). repo 관행([[feedback-verification]] 배포 후 검증)과 일관.
  - **(follow-up, low) FRED `_fetch_series` 중복 정리**: econ(클로저)·macro(모듈 로컬)가 같은 FRED observations fetch 로직을 따로 가짐. 향후 FRED 시리즈가 또 늘면 모듈 레벨 공용 `_fetch_series(series_id, api_key, start)`로 추출해 econ+macro 공유 권장(이번엔 store 분리·클로저 제약상 복제가 surgical).
- **검증 게이트**: 자동 게이트 pytest 696·TDD 20·적대적 리뷰 PASS·요청경로 FRED 0(get_macro_signals=_mc_load만, S2 테스트가 requests.get에 AssertionError 주입)·메인 재확인으로 `verified: yes`. 커밋 504b6e09 push. 잔여 글랜스: 시장지표 탭 매크로 신호 섹션·FRED 실데이터(prod 키).

## Doc updates

- CONTEXT.md promotion: none ([[매크로 신호]]는 fg-ask 때 등록 — 매크로 상관과 구분).
- ADR added: none (ADR-0013 시장분류·FRED 패턴 범위 내, 하드 결정 없음).
- CLAUDE.md: macro.py 서비스·매크로 신호≠매크로 상관 gotcha는 실행 중 docs 에이전트가 작성(이번 회고 신규 승격 없음 — 저-divergence).
- 코드: commit 504b6e09(기능, main push). 회고 발 코드/문서 변경 없음.
- **follow-up 후보(low)**: FRED `_fetch_series` 공용 헬퍼 추출(econ+macro 중복).
